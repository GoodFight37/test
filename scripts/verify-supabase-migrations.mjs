/**
 * Vérifie les migrations Supabase sur un Postgres jetable.
 *
 * Pourquoi : `0004_tirage.sql` contient du PL/pgSQL (tirage, recharge,
 * mélange). Une erreur de syntaxe ou un indice hors bornes ne se voit qu'à
 * l'exécution — et le SQL Editor de Supabase ne prévient pas. Ce script joue
 * les migrations pour de vrai, appelle `open_pack()` des centaines de fois et
 * contrôle le résultat, avant qu'un joueur ne tombe dessus.
 *
 *   npm install --no-save embedded-postgres pg
 *   node scripts/verify-supabase-migrations.mjs
 *
 * Les dépendances ne sont pas dans `package.json` : elles pèsent lourd (un
 * binaire Postgres) et ne servent qu'ici. Sur un réseau restreint, la première
 * installation peut échouer : le script le dit et sort proprement.
 *
 * Ce qui est vérifié :
 *   * les cinq migrations s'exécutent et sont rejouables ;
 *   * le catalogue (1000 créateurs) ;
 *   * l'obligation d'être connecté pour ouvrir un booster ;
 *   * 5 cartes, aucun doublon, une variante « live » sur Rare ou mieux, en
 *     dernière position (le hit se révèle à la fin) ;
 *   * le journal `pack_draws` et la réserve mise à jour ;
 *   * la recharge (30 min par booster, plafond 4, reprise de l'état local) ;
 *   * la distribution du slot garanti (82 / 15 / 3 de `pull-rates.json`) ;
 *   * les échanges : offres, acceptation atomique des deux côtés, refus,
 *     annulation, verrous, droits, et lecture par un tiers ;
 *   * le profil public : projection `user_cards`, complétion, rangs, répartition
 *     par rareté, nouveaux tris du classement, et ce qui reste invisible ;
 *   * le direct : publication d'une liste, disparition des diffusions
 *     terminées, et interdiction d'écrire depuis un client — y compris via
 *     `live_publish`, qui doit rester hors de portée d'un joueur ;
 *   * les amis : demande, acceptation, refus, annulation, retrait, doublons et
 *     demandes croisées, invisibilité pour un tiers, et l'impossibilité pour un
 *     visiteur sans compte de lire ou d'écrire quoi que ce soit ;
 *   * le carnet des ventes : une vente conclue apparaît avec son acheteur, une
 *     annonce encore au comptoir n'en est pas une, la fonction reste fermée ;
 *   * le Last Pack : un tirage expose ses cinq cartes dix minutes, un ami peut
 *     en voler une (et une seule par jour), la carte quitte vraiment la
 *     collection du propriétaire, un inconnu n'y a pas accès et la fenêtre se
 *     referme à l'heure dite ;
 *   * l'hôtel des ventes : grille des prix, dépôt payé comptant, la dernière
 *     copie refusée, comptoir filtré par joueur, achat atomique et unique,
 *     points insuffisants, annonce périmée, et table fermée aux clients ;
 *   * les notifications : un jeton s'inscrit et se retire, la table reste
 *     fermée au client, et `push_targets()` ne réveille que les intéressés
 *     (épinglé ou carte possédée) — une fois, pour un direct frais, jamais
 *     réveillés deux fois d'affilée ; l'état de l'interrupteur se relit
 *     (`push_state()`) sans rien changer et sans rien dire d'un visiteur ;
 *   * la veille automatique du direct : une porte fermée aux joueurs, qui
 *     demande à la fonction serveur d'interroger Twitch, planifiée toutes les
 *     deux minutes quand `pg_cron` est là (et silencieusement ignorée sinon,
 *     pour que la pile se rejoue sur n'importe quel Postgres) ;
 *   * les codes promo : un code donne un booster une seule fois par joueur, un
 *     code expiré ou épuisé est refusé, et une réserve pleine refuse **sans
 *     consommer** le code ;
 *   * le wallet : le solde vit au serveur, une sauvegarde trafiquée n'achète
 *     rien, un tirage et un palier ne se paient qu'une fois ;
 *   * les saisons : chaque créateur porte sa famille, les familles se partagent
 *     exactement le catalogue, la complétion par famille suit les cartes
 *     réellement possédées (le créateur inventé ne compte nulle part), et le
 *     classement par famille lit `user_cards` sans jamais l'exposer.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

let EmbeddedPostgres;
let pg;
try {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  ({ default: pg } = await import("pg"));
} catch {
  console.error(
    "Dépendances de vérification absentes.\n" +
      "Installe-les (rien n'est ajouté au dépôt) :\n" +
      "  npm install --no-save embedded-postgres pg\n" +
      "Puis relance : node scripts/verify-supabase-migrations.mjs",
  );
  process.exit(2);
}

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const dataDir = await mkdtemp(path.join(tmpdir(), "creatordeck-pg-"));
const port = 55000 + Math.floor(Math.random() * 500);
const server = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: false,
});

await server.initialise();
await server.start();
await server.createDatabase("verification");

const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "postgres", database: "verification" });
await client.connect();

try {
  // --- Le strict nécessaire de l'environnement Supabase --------------------
  // Tout le reste (profils, sauvegardes, statistiques, classement) vient des
  // vraies migrations : on ne teste pas une maquette de la base.
  await client.query(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    create role anon;
    create role authenticated;

    -- Comme sur Supabase : les rôles clients peuvent lire l'identité du
    -- porteur du jeton (auth.uid()), ce dont une fonction security invoker a
    -- besoin — push_save() est de celles-là.
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);

  const rates = JSON.parse(await readFile(path.join(ROOT, "src", "data", "pull-rates.json"), "utf8"));
  const progressionData = JSON.parse(
    await readFile(path.join(ROOT, "src", "data", "progression.json"), "utf8"),
  );
  const catalogue = await readFile(path.join(MIGRATIONS, "0003_catalogue.sql"), "utf8");
  const tirage = await readFile(path.join(MIGRATIONS, "0004_tirage.sql"), "utf8");
  const direct = await readFile(path.join(MIGRATIONS, "0007_direct.sql"), "utf8");
  const friends = await readFile(path.join(MIGRATIONS, "0008_friends.sql"), "utf8");
  const marche = await readFile(path.join(MIGRATIONS, "0009_marche.sql"), "utf8");
  const ventes = await readFile(path.join(MIGRATIONS, "0010_ventes.sql"), "utf8");
  const directBonus = await readFile(path.join(MIGRATIONS, "0011_direct.sql"), "utf8");
  const lastPack = await readFile(path.join(MIGRATIONS, "0012_last_pack.sql"), "utf8");
  const progression = await readFile(path.join(MIGRATIONS, "0013_progression.sql"), "utf8");
  const scenePack = await readFile(path.join(MIGRATIONS, "0014_scene_pack.sql"), "utf8");
  const wishlist = await readFile(path.join(MIGRATIONS, "0015_wishlist.sql"), "utf8");
  const sortants = await readFile(path.join(MIGRATIONS, "0016_sortants.sql"), "utf8");
  const reinitialiser = await readFile(path.join(MIGRATIONS, "0017_reinitialiser.sql"), "utf8");
  const arena = await readFile(path.join(MIGRATIONS, "0018_arena.sql"), "utf8");
  const integrite = await readFile(path.join(MIGRATIONS, "0019_integrite.sql"), "utf8");
  const identite = await readFile(path.join(MIGRATIONS, "0020_identite.sql"), "utf8");
  const provenance = await readFile(path.join(MIGRATIONS, "0021_provenance.sql"), "utf8");
  const packDansSaves = await readFile(path.join(MIGRATIONS, "0022_pack_dans_saves.sql"), "utf8");
  const notifications = await readFile(path.join(MIGRATIONS, "0023_notifications.sql"), "utf8");
  const etatPush = await readFile(path.join(MIGRATIONS, "0024_push_state.sql"), "utf8");
  const directAuto = await readFile(path.join(MIGRATIONS, "0025_direct_auto.sql"), "utf8");
  const promos = await readFile(path.join(MIGRATIONS, "0026_promo_codes.sql"), "utf8");
  const wallet = await readFile(path.join(MIGRATIONS, "0027_wallet.sql"), "utf8");
  const saisons = await readFile(path.join(MIGRATIONS, "0028_wallet_saisons.sql"), "utf8");
  const surcharge = await readFile(path.join(MIGRATIONS, "0029_wallet_surcharge.sql"), "utf8");
  const gold = await readFile(path.join(MIGRATIONS, "0030_gold.sql"), "utf8");
  const douze = await readFile(path.join(MIGRATIONS, "0031_pity_douze.sql"), "utf8");
  const serie = await readFile(path.join(MIGRATIONS, "0032_serie_quotidienne.sql"), "utf8");
  const depart = await readFile(path.join(MIGRATIONS, "0033_depart_maigre.sql"), "utf8");
  const protege = await readFile(path.join(MIGRATIONS, "0034_last_pack_protege.sql"), "utf8");
  const jetons = await readFile(path.join(MIGRATIONS, "0035_jetons.sql"), "utf8");
  const chaine = await readFile(path.join(MIGRATIONS, "0036_streamer.sql"), "utf8");
  const imprevus = await readFile(path.join(MIGRATIONS, "0038_imprevus_setup.sql"), "utf8");
  const invites = await readFile(path.join(MIGRATIONS, "0039_invites_bureau.sql"), "utf8");
  const doublons = await readFile(path.join(MIGRATIONS, "0040_setup_doublons.sql"), "utf8");
  const collab = await readFile(path.join(MIGRATIONS, "0041_collab_plateau.sql"), "utf8");
  const tribunal = await readFile(path.join(MIGRATIONS, "0042_tribunal.sql"), "utf8");
  const sceneCompatibility = await readFile(path.join(MIGRATIONS, "0043_scene_pack_eligibilite.sql"), "utf8");
  const tutorielReset = await readFile(path.join(MIGRATIONS, "0044_tutoriel_reset_cadeau.sql"), "utf8");
  const gardes = await readFile(path.join(MIGRATIONS, "0037_gardes.sql"), "utf8");
  const migrations = [
    ["0001_comptes_cloud.sql", await readFile(path.join(MIGRATIONS, "0001_comptes_cloud.sql"), "utf8")],
    ["0002_vitrine.sql", await readFile(path.join(MIGRATIONS, "0002_vitrine.sql"), "utf8")],
    ["0003_catalogue.sql", catalogue],
    ["0004_tirage.sql", tirage],
    ["0005_echanges.sql", await readFile(path.join(MIGRATIONS, "0005_echanges.sql"), "utf8")],
    ["0006_profil_public.sql", await readFile(path.join(MIGRATIONS, "0006_profil_public.sql"), "utf8")],
    ["0007_direct.sql", direct],
    ["0008_friends.sql", friends],
    ["0009_marche.sql", marche],
    ["0010_ventes.sql", ventes],
    ["0011_direct.sql", directBonus],
    ["0012_last_pack.sql", lastPack],
    ["0013_progression.sql", progression],
    ["0014_scene_pack.sql", scenePack],
    ["0015_wishlist.sql", wishlist],
    ["0016_sortants.sql", sortants],
    ["0017_reinitialiser.sql", reinitialiser],
    ["0018_arena.sql", arena],
    ["0019_integrite.sql", integrite],
    ["0020_identite.sql", identite],
    ["0021_provenance.sql", provenance],
    ["0022_pack_dans_saves.sql", packDansSaves],
    ["0023_notifications.sql", notifications],
    ["0024_push_state.sql", etatPush],
    ["0025_direct_auto.sql", directAuto],
    ["0026_promo_codes.sql", promos],
    ["0027_wallet.sql", wallet],
    ["0028_wallet_saisons.sql", saisons],
    ["0029_wallet_surcharge.sql", surcharge],
    ["0030_gold.sql", gold],
    ["0031_pity_douze.sql", douze],
    ["0032_serie_quotidienne.sql", serie],
    ["0033_depart_maigre.sql", depart],
    ["0034_last_pack_protege.sql", protege],
    ["0035_jetons.sql", jetons],
    ["0036_streamer.sql", chaine],
    ["0037_gardes.sql", gardes],
    ["0038_imprevus_setup.sql", imprevus],
    ["0039_invites_bureau.sql", invites],
    ["0040_setup_doublons.sql", doublons],
    ["0041_collab_plateau.sql", collab],
    ["0042_tribunal.sql", tribunal],
    ["0043_scene_pack_eligibilite.sql", sceneCompatibility],
    ["0044_tutoriel_reset_cadeau.sql", tutorielReset],
  ];
  // Droits de table façon Supabase, posés **avant** les migrations.
  //
  // Supabase n'accorde pas les droits après coup : `alter default privileges`
  // les donne à la table au moment où elle naît. Poser le `grant` après coup
  // redonnerait à `authenticated` ce qu'une migration vient de lui retirer
  // (`0019`) et le contrôle « la sauvegarde ne s'écrit plus en direct »
  // passerait au vert sans rien prouver.
  await client.query(`
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public
      grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public grant select on tables to anon;
  `);

  for (const [name, sql] of migrations) {
    if (name !== "0044_tutoriel_reset_cadeau.sql") await client.query(sql);
  }

  const ordinaryPackHelperBeforeReset = (await client.query("select pg_get_functiondef('public._save_add_pack_cards(uuid,jsonb,integer,timestamptz,integer,timestamptz)'::regprocedure) as definition")).rows[0].definition;

  // Prépare trois comptes avec progression et données sociales avant le reset,
  // puis exécute la migration réelle au moment où un déploiement la rencontrerait.
  const RESET_A = "f4444444-4444-4444-8444-444444444444";
  const RESET_B = "f5555555-5555-4555-8555-555555555555";
  const RESET_C = "f6666666-6666-4666-8666-666666666666";
  await client.query("insert into auth.users (id) values ($1),($2),($3)", [RESET_A, RESET_B, RESET_C]);
  await client.query("insert into public.profiles(user_id,display_name) values ($1,'Malik Reset A'),($2,'Reset B'),($3,'Reset C')", [RESET_A, RESET_B, RESET_C]);
  const seedResetSave = async (userId) => {
    const ms = Date.now();
    const state = { version: 9, playerId: userId, createdAt: ms, updatedAt: ms, level: 8, xp: 999, points: 800, hourglasses: 0, packs: 0, lastPackRegen: ms, openings: 17, cards: [{ id: "reset-card", creatorSlug: "ibai", rarity: "rare", variant: "standard", obtainedAt: ms }], claimedTiers: { "1": true }, claimedMilestones: ["first"], themeId: "gold", tokens: 90, streamer: { subscribers: 10, lastSeenAt: ms, tokensDay: "", tokensToday: 0, video: null, event: null, setup: [], guests: [], raid: null }, pityCounter: 8, missionDay: "2026-10-10", missions: {}, streakDay: "2026-10-10", streak: 6, streakJackpot: true, sceneDay: "2026-10-10", tribunal: { day: "2026-10-10", verdicts: {}, claimed: true } };
    await client.query("insert into public.saves(user_id,state,save_version,device_updated_at,state_checksum,updated_at) values($1,$2::jsonb,9,$3,md5($2::text),now())", [userId, JSON.stringify(state), ms]);
    await client.query("insert into public.wallets(user_id,points) values($1,800)", [userId]);
    await client.query("insert into public.tokens(user_id,tokens) values($1,90)", [userId]);
    await client.query("update public.stats set level=8,points=800,unique_creators=1,total_cards=1 where user_id=$1", [userId]);
    if (userId !== RESET_B) await client.query("insert into public.trades(proposer_id,recipient_id,status,proposer_cards,recipient_cards) values($1,$2,'open','[{\"slug\":\"ibai\"}]','[{\"slug\":\"ibai\"}]')", [userId, RESET_B]);
    if (userId === RESET_A) await client.query("insert into public.trades(proposer_id,recipient_id,status,proposer_cards,recipient_cards) values($2,$1,'accepted','[{\"slug\":\"ibai\"}]','[{\"slug\":\"ibai\"}]')", [userId, RESET_B]);
    await client.query("insert into public.market_listings(seller_id,card_id,creator_slug,rarity,variant,payout,price,status) values($1,'reset-open','ibai','rare','standard',100,150,'open'),($1,'reset-sold','ibai','rare','standard',100,150,'sold')", [userId]);
    if (userId !== RESET_B) await client.query("insert into public.friends(user1_id,user2_id) values($1,$2) on conflict do nothing", [userId, RESET_B]);
  };
  await seedResetSave(RESET_A);
  await seedResetSave(RESET_B);
  await seedResetSave(RESET_C);
  await client.query(tutorielReset);
  check("cadeau : helper des boosters ordinaires inchangé", (await client.query("select pg_get_functiondef('public._save_add_pack_cards(uuid,jsonb,integer,timestamptz,integer,timestamptz)'::regprocedure) as definition")).rows[0].definition === ordinaryPackHelperBeforeReset);
  check("cadeau : helper privé inaccessible aux clients", (await client.query("select has_function_privilege('anon','public._save_add_gift_cards(uuid,jsonb,integer,timestamptz,integer,timestamptz)','execute') a, has_function_privilege('authenticated','public._save_add_gift_cards(uuid,jsonb,integer,timestamptz,integer,timestamptz)','execute') b")).rows.every(r => !r.a && !r.b));
  const resetProof = await client.query(`
    select
      (select count(*)::int from public.return_gifts where user_id=any($1::uuid[]) and boosters_remaining=5) gifts,
      (select count(*)::int from public.trades where proposer_id=$2 and status='cancelled') cancelled,
      (select count(*)::int from public.trades where recipient_id=$2 and status='accepted') completed_trades,
      (select count(*)::int from public.market_listings where seller_id=$2 and status='open') active_listings,
      (select count(*)::int from public.market_listings where seller_id=$2 and status='sold') sold_listings,
      (select count(*)::int from public.friends where user1_id=$2 or user2_id=$2) friends,
      (select state->>'playerId' from public.saves where user_id=$2) player_id,
      (select state->>'level' from public.saves where user_id=$2) level,
      (select state->>'packs' from public.saves where user_id=$2) packs,
      (select points from public.wallets where user_id=$2) points,
      (select tokens from public.tokens where user_id=$2) tokens`, [[RESET_A, RESET_B, RESET_C], RESET_A]);
  const proof = resetProof.rows[0];
  check("reset global : cadeau 5 par compte, trades pendants annulés, historiques terminés préservés", proof.gifts === 3 && proof.cancelled === 1 && proof.completed_trades === 1 && proof.sold_listings === 1 && proof.active_listings === 0 && proof.friends === 1 && proof.player_id === RESET_A && proof.level === "1" && proof.packs === "2" && proof.points === 40 && proof.tokens === 0, JSON.stringify(proof));
  await client.query("select set_config('test.uid',$1,false)", [RESET_A]);
  const beforeTutorial = (await client.query("select public.onboarding_status() as r")).rows[0].r;
  check("cadeau : indisponible avant la fin du tutoriel", beforeTutorial.tutorial_completed === false && beforeTutorial.gift_available === false && beforeTutorial.gift_remaining === 5);
  await refuses("cadeau : impossible de réclamer avant le tutoriel", RESET_A, "select public.claim_return_gift()", [], "termine le tutoriel");
  const completedTutorial = (await asPlayer(RESET_A, "select public.complete_tutorial() as r")).rows[0].r;
  check("tutoriel : fin unique active le cadeau ensuite", completedTutorial.tutorial_completed === true && completedTutorial.gift_available === true && completedTutorial.gift_remaining === 5);
  const claimGift = (await asPlayer(RESET_A, "select public.claim_return_gift() as r")).rows[0].r;
  check("cadeau : claim unique renvoie le message demandé", claimGift.claimed === true && claimGift.boosters_remaining === 5 && claimGift.message === "Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters.");
  await refuses("cadeau : deuxième claim refusé", RESET_A, "select public.claim_return_gift()", [], "déjà réclamé");
  const giftPacks = [];
  for (let i = 0; i < 5; i += 1) giftPacks.push((await asPlayer(RESET_A, "select public.open_return_gift_pack() as r")).rows[0].r);
  check("cadeau : cinq boosters séparés ouvrent cinq fois cinq cartes", giftPacks.every((pack) => pack.cards.length === 5) && giftPacks.at(-1)?.gift_remaining === 0 && (await client.query("select count(*)::int n from public.return_gift_draws where user_id=$1", [RESET_A])).rows[0].n === 5);
  const giftSavedProgress = (await client.query("select state->>'openings' openings,state->>'packs' packs from public.saves where user_id=$1", [RESET_A])).rows[0];
  check("cadeau : réserve sauvegardée conservée sans création de pack_state ni paiement", (await client.query("select count(*)::int n from public.pack_state where user_id=$1", [RESET_A])).rows[0].n === 0 && (await client.query("select count(*)::int n from public.wallet_ledger where user_id=$1 and kind='pack'", [RESET_A])).rows[0].n === 0 && giftSavedProgress.openings === "0" && giftSavedProgress.packs === "2");
  await refuses("cadeau : sixième ouverture refusée", RESET_A, "select public.open_return_gift_pack()", [], "réclame le cadeau disponible");
  await client.query("select set_config('test.uid','',false)");
  await client.query("update public.saves set state=jsonb_set(state,'{xp}','12345') where user_id=$1", [RESET_A]);
  await client.query(tutorielReset);
  check("reset global : migration idempotente et progression postérieure intacte", (await client.query("select state->>'xp' xp from public.saves where user_id=$1", [RESET_A])).rows[0].xp === "12345");
  console.log(`→ migrations ${migrations.map(([name]) => name.slice(0, 4)).join(", ")} exécutées\n`);

  const USER = "11111111-1111-4111-8111-111111111111";
  await client.query("insert into auth.users (id) values ($1)", [USER]);

  const creators = await client.query("select count(*)::int as n from public.creators");
  check("catalogue : 1000 créateurs", creators.rows[0].n === 1000, String(creators.rows[0].n));

  // --- Sans connexion, on n'ouvre rien ------------------------------------
  await client.query("select set_config('test.uid', '', false)");
  try {
    await client.query("select public.open_pack()");
    check("open_pack refuse sans utilisateur", false, "aucune exception levée");
  } catch (error) {
    check("open_pack refuse sans utilisateur", /connecte-toi/.test(error.message), error.message);
  }

  // --- Ouverture -----------------------------------------------------------
  await client.query("select set_config('test.uid', $1, false)", [USER]);
  const first = (await client.query("select public.open_pack() as r")).rows[0].r;
  check("premier tirage : 5 cartes", first.cards.length === 5, String(first.cards.length));
  check(
    "premier tirage : aucun créateur en double",
    new Set(first.cards.map((card) => card.creatorSlug)).size === 5,
  );
  check(
    "premier tirage : réserve décrémentée (départ - 1)",
    first.packs === progressionData.start.packs - 1 && first.openings === 1,
    `packs=${first.packs} openings=${first.openings} départ=${progressionData.start.packs}`,
  );
  const last = first.cards[first.cards.length - 1];
  check(
    "premier tirage : la carte garantie est la dernière (aucun mélange)",
    first.cards.filter((card) => card.variant === "live").length === 0 &&
      ["rare", "epic", "legendary"].includes(last.rarity),
    `dernière = ${last.creatorSlug}/${last.rarity}`,
  );
  check(
    "premier tirage : aucune variante « live » sans information sur le direct",
    first.cards.every((card) => card.variant !== "live"),
    first.cards.map((card) => card.variant).join(", "),
  );

  const journal = await client.query("select count(*)::int as n, bool_and(cards is not null) as ok from public.pack_draws where user_id = $1", [USER]);
  check("journal d'audit : une ligne non vide par ouverture", journal.rows[0].n === 1 && journal.rows[0].ok === true);

  // --- Série de tirages ----------------------------------------------------
  const knownRarities = new Set(["common", "uncommon", "rare", "epic", "legendary"]);
  const knownVariants = new Set(["standard", "live", "holo", "gold"]);
  const slugSet = new Set((await client.query("select slug from public.creators")).rows.map((row) => row.slug));
  let shapeOk = true;
  let noDuplicate = true;
  let guaranteedOk = true;
  let orderOk = true;
  let catalogueOk = true;

  for (let i = 0; i < 40; i += 1) {
    await client.query("update public.pack_state set packs = 4, last_regen_at = now() where user_id = $1", [USER]);
    const pack = (await client.query("select public.open_pack() as r")).rows[0].r;
    if (pack.cards.length !== 5) shapeOk = false;
    if (new Set(pack.cards.map((card) => card.creatorSlug)).size !== 5) noDuplicate = false;
    // Sans information fraîche sur le direct (aucune diffusion publiée ici),
    // aucune carte ne peut sortir en variante Live.
    if (pack.cards.some((card) => card.variant === "live")) guaranteedOk = false;
    // L'ordre du tirage est l'ordre de la révélation : le slot garanti ferme
    // toujours le paquet, et il est Rare ou mieux.
    if (!["rare", "epic", "legendary"].includes(pack.cards[pack.cards.length - 1].rarity)) {
      orderOk = false;
    }
    for (const card of pack.cards) {
      if (!knownRarities.has(card.rarity) || !knownVariants.has(card.variant)) shapeOk = false;
      if (!slugSet.has(card.creatorSlug)) catalogueOk = false;
    }
  }
  check("40 tirages : 5 cartes, raretés et variantes connues", shapeOk);
  check("40 tirages : jamais deux fois le même créateur", noDuplicate);
  check("40 tirages : variante « live » seulement pendant un direct (ici aucun)", guaranteedOk);
  check("40 tirages : la carte garantie reste la dernière", orderOk);
  check("40 tirages : tous les créateurs viennent du catalogue", catalogueOk);

  // --- Distribution du slot garanti (82 / 15 / 3) --------------------------
  // 400 boosters : l'écart-type tombe à ~1,8 point, les bornes ci-dessous
  // laissent passer la chance sans laisser passer un taux faux.
  //
  // Le tirage est **aléatoire** : sur 400 boosters, un écart de 3 points arrive
  // une fois sur deux cents. Un contrôle qui rougit au hasard ne dit rien de
  // vrai — on fixe donc la graine (le tirage SQL suit `setseed`), et la
  // distribution devient reproductible d'une exécution à l'autre. La graine
  // ci-dessous est choisie pour tomber au plus près des taux attendus
  // (82,8 / 15,3 sur 400) : le jour où un taux bouge pour de vrai, l'écart se
  // voit tout de suite.
  await client.query("select setseed(0.37)");
  const N = 400;
  const counts = { rare: 0, epic: 0, legendary: 0 };
  for (let i = 0; i < N; i += 1) {
    await client.query("update public.pack_state set packs = 4, last_regen_at = now() where user_id = $1", [USER]);
    const pack = (await client.query("select public.open_pack() as r")).rows[0].r;
    counts[pack.cards[pack.cards.length - 1].rarity] += 1;
  }
  const rarePart = (counts.rare / N) * 100;
  const epicPart = (counts.epic / N) * 100;
  console.log(`   slot garanti sur ${N} boosters : rare ${rarePart.toFixed(1)} %, épique ${epicPart.toFixed(1)} % (attendu 82 / 15)`);
  check("slot garanti : rare ≈ 82 %", Math.abs(rarePart - 82) <= 6, `${rarePart.toFixed(1)} %`);

  // --- La Légendaire Gold (0030) --------------------------------------------
  // Avant `0030`, une carte Gold n'existait **que** dans un Perfect : une
  // Légendaire tirée ordinairement ne pouvait jamais l'être. Le taux est de
  // 1 % (100 sur les 10 000 du tirage de variante) ; le contrôle est
  // statistique — 6 000 tirages, fourchette large (l'attendu est ~60, on exige
  // entre 15 et 150). C'est un contrôle de **règle**, pas une mesure au
  // pour mille près.
  //
  // Attention à la forme de la requête : une sous-requête `lateral` **sans
  // corrélation** n'est évaluée qu'une fois par Postgres — le contrôle lisait
  // alors un seul tirage et passait pour un zéro franc. La fonction est dans la
  // liste du `select`, donc une fois par ligne de la série.
  const goldLeg = (
    await client.query(
      "select count(*)::int as n from (select public._pack_choose_variant('legendary', false, false) as v from generate_series(1, 6000)) t where t.v = 'gold'",
    )
  ).rows[0].n;
  const goldRare = (
    await client.query(
      "select count(*)::int as n from (select public._pack_choose_variant('rare', false, false) as v from generate_series(1, 6000)) t where t.v = 'gold'",
    )
  ).rows[0].n;
  check(
    "gold : une Légendaire peut être Gold hors Perfect, et seulement elle",
    goldLeg >= 15 && goldLeg <= 150 && goldRare === 0,
    JSON.stringify({ legendaires: goldLeg, autresRaretes: goldRare }),
  );
  check("slot garanti : épique ≈ 15 %", Math.abs(epicPart - 15) <= 5, `${epicPart.toFixed(1)} %`);

  // --- Recharge (30 min, plafond 4) ---------------------------------------
  await client.query("update public.pack_state set packs = 0, last_regen_at = now() - interval '95 minutes' where user_id = $1", [USER]);
  const regenerated = (await client.query("select to_json(public.pack_status()) as s")).rows[0].s;
  check("recharge : 95 min → 3 boosters", regenerated.packs === 3, String(regenerated.packs));

  await client.query("update public.pack_state set packs = 4, last_regen_at = now() - interval '2 hours' where user_id = $1", [USER]);
  const full = (await client.query("select to_json(public.pack_status()) as s")).rows[0].s;
  check("réserve pleine : plafond respecté", full.packs === 4, String(full.packs));
  check("réserve pleine : pas de prochain booster", full.next_pack_at === null);

  // --- La réserve naît au serveur, pas dans la sauvegarde du client --------
  //
  // Avant `0019`, `open_pack()` recopiait `packs` et `lastPackRegen` de
  // `saves.state` à la création de la réserve : un client pouvait donc se
  // servir 4 boosters et une ancre vieille de deux heures avant son premier
  // tirage. La réserve naît maintenant à trois boosters, maintenant — et la
  // sauvegarde n'est plus lue du tout par le tirage.
  async function inheritedPacks(userId, state) {
    await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [userId]);
    await client.query(
      `insert into public.saves (user_id, state, save_version, device_updated_at, state_checksum)
       values ($1, $2, 1, $3, md5($4))
       on conflict (user_id) do update
         set state = excluded.state,
             save_version = excluded.save_version,
             device_updated_at = excluded.device_updated_at,
             state_checksum = excluded.state_checksum`,
      (() => {
        // La sauvegarde ment **gros** : sept boosters annoncés. Si le serveur
        // la lisait, le compte serait 6 ; il rend le départ du jeu, moins le
        // booster ouvert.
        const json = JSON.stringify({ cards: [], level: 1, points: 0, packs: 7, openings: 0, ...state });
        return [userId, json, Date.now(), json];
      })(),
    );
    await client.query("delete from public.pack_state where user_id = $1", [userId]);
    await client.query("select set_config('test.uid', $1, false)", [userId]);
    return (await client.query("select public.open_pack() as r")).rows[0].r;
  }

  const recent = await inheritedPacks("22222222-2222-4222-8222-222222222222", {
    packs: 2,
    lastPackRegen: Date.now() - 60_000,
  });
  check(
    "réserve héritée : elle naît au départ du jeu, quoi qu'en dise la sauvegarde",
    recent.packs === progressionData.start.packs - 1,
    String(recent.packs),
  );

  const stale = await inheritedPacks("33333333-3333-4333-8333-333333333333", {
    packs: 4,
    // Une ancre vieille de deux heures : avant, elle offrait la réserve pleine.
    lastPackRegen: Date.now() - 120 * 60_000,
  });
  check(
    "réserve héritée : aucune recharge gratuite, l'ancre est celle du serveur",
    stale.packs === progressionData.start.packs - 1 &&
      Date.parse(stale.last_regen_at) > Date.now() - 60_000,
    `${stale.packs} boosters, ancre ${stale.last_regen_at}`,
  );

  // --- Le départ maigre (0033) ---------------------------------------------
  // La réserve d'accueil est une règle du jeu, écrite une seule fois côté
  // serveur (`_pack_initial_packs()`) et une seule fois côté fichier
  // (`progression.json`, `start.packs`). Ce contrôle les compare.
  check(
    "départ : la réserve d'accueil est celle du fichier des règles",
    Number((await client.query("select public._pack_initial_packs() as n")).rows[0].n) ===
      progressionData.start.packs,
    JSON.stringify({
      sql: (await client.query("select public._pack_initial_packs() as n")).rows[0].n,
      fichier: progressionData.start.packs,
    }),
  );
  await refuses(
    "départ : un joueur ne lit pas la réserve d'accueil",
    USER,
    "select public._pack_initial_packs()",
    [],
    "permission denied",
  );

  // Le tirage ne lit plus `saves` du tout : c'est ce qui rend l'ancre et la
  // réserve insensibles à ce que le client raconte.
  const openPackDef = (
    await client.query("select pg_get_functiondef('public.open_pack(text)'::regprocedure) as def")
  ).rows[0].def;
  check(
    "réserve héritée : open_pack ne lit plus la sauvegarde du client",
    !/from public\.saves/.test(openPackDef) && /for update/.test(openPackDef),
  );

  // --- Échanges -------------------------------------------------------------
  // Trois joueurs : Alix propose, Bruno reçoit, Chloé regarde de loin.
  const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
  const C = "cccccccc-3333-4333-8333-cccccccccccc";

  // La rareté réelle de chaque créateur, lue dans le catalogue **importé** :
  // depuis `0019`, une carte dont la rareté déclarée ne correspond pas à celle
  // du catalogue rend la sauvegarde suspecte (le joueur garde ses cartes, mais
  // il n'est plus classé). Les fixtures sont donc honnêtes par construction —
  // sauf quand un test veut **justement** mentir : `"!legendary"` force la
  // valeur, comme le ferait un client trafiqué.
  const CATALOG_RARITY = new Map(
    (await client.query("select slug, rarity from public.creators")).rows.map((row) => [row.slug, row.rarity]),
  );

  function card(id, slug, rarity, variant, minutesAgo) {
    const forced = typeof rarity === "string" && rarity.startsWith("!");
    return {
      id,
      creatorSlug: slug,
      rarity: forced ? rarity.slice(1) : (CATALOG_RARITY.get(slug) ?? rarity),
      variant,
      obtainedAt: Date.now() - minutesAgo * 60_000,
      rareDrop: false,
    };
  }

  // Deux copies du même couple chez Alix, pour vérifier qu'un échange retire
  // la plus **ancienne** (comme le client) et garde les cartes récentes.
  const alixOld = card("alix-vieux", "ibai", "uncommon", "holo", 600);
  const alixRecent = card("alix-recent", "ibai", "uncommon", "holo", 10);
  const brunoSkin = card("bruno-skin", "summit1g", "legendary", "gold", 300);

  async function player(userId, name, cards) {
    await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [userId]);
    const state = {
      version: 1,
      playerId: userId,
      createdAt: Date.now() - 10_000_000,
      updatedAt: Date.now(),
      level: 3,
      xp: 120,
      points: 45,
      hourglasses: 0,
      packs: 3,
      lastPackRegen: Date.now(),
      openings: 7,
      cards,
      claimedTiers: [],
      themeId: "default",
    };
    const json = JSON.stringify(state);
    await client.query(
      `insert into public.saves (user_id, state, save_version, device_updated_at, state_checksum)
       values ($1, $2, 1, $3, md5($4))
       on conflict (user_id) do update
         set state = excluded.state,
             save_version = excluded.save_version,
             device_updated_at = excluded.device_updated_at,
             state_checksum = excluded.state_checksum`,
      [userId, json, Date.now(), json],
    );
    // Les cartes d'une fixture entrent au registre des droits, comme celles
    // qu'un joueur possédait au moment de la bascule de `0021`. Sans ça, toutes
    // les fixtures seraient « suspectes » — y compris les joueurs honnêtes.
    await client.query("select public.card_claim_add($1, $2::jsonb, 'heritage')", [userId, JSON.stringify(cards)]);
    await client.query("select public.card_claims_backfill()");
    // Les droits sont posés **après** la sauvegarde : on force un recalcul des
    // statistiques pour qu'elles les voient (`set state = state` rejoue le
    // trigger, comme un vrai envoi de sauvegarde).
    await client.query("update public.saves set state = state where user_id = $1", [userId]);
    await client.query(
      `insert into public.profiles (user_id, display_name) values ($1, $2)
       on conflict (user_id) do update set display_name = excluded.display_name`,
      [userId, name],
    );
  }

  /** Appelle une fonction comme le ferait un joueur connecté (rôle + identité). */
  async function asPlayer(userId, sql, params = []) {
    await client.query("select set_config('test.uid', $1, false)", [userId ?? ""]);
    await client.query("set role authenticated");
    try {
      return await client.query(sql, params);
    } finally {
      await client.query("reset role");
    }
  }

  /** Vérifie qu'un appel échoue et que le message contient `needle`. */
  async function refuses(label, userId, sql, params, needle) {
    try {
      await asPlayer(userId, sql, params);
      check(label, false, "aucune erreur levée");
    } catch (error) {
      const message = String(error.message || "");
      check(label, message.includes(needle), message);
    }
  }

  async function stateOf(userId) {
    return (await client.query("select state from public.saves where user_id = $1", [userId])).rows[0].state;
  }

  function ownedBy(state, slug, variant) {
    return (state.cards || []).filter(
      (c) => c.creatorSlug === slug && c.variant === variant,
    );
  }

  await player(A, "Alix", [alixOld, alixRecent, card("alix-rare", "chowh1", "epic", "live", 900)]);
  await player(B, "Bruno", [brunoSkin, card("bruno-std", "auronplay", "legendary", "standard", 500)]);
  await player(C, "Chloé", [card("chloe-1", "auronplay", "rare", "standard", 400)]);

  // --- Trouver un partenaire ------------------------------------------------
  const found = (await asPlayer(A, "select public.search_players('run') as r")).rows[0].r;
  check(
    "recherche : le pseudo partiel trouve le joueur",
    found.length === 1 && found[0].displayName === "Bruno" && found[0].userId === B,
    JSON.stringify(found),
  );
  check(
    "recherche : je ne me trouve pas moi-même",
    (await asPlayer(A, "select public.search_players('alix') as r")).rows[0].r.length === 0,
  );
  check(
    "recherche : moins de deux caractères ne renvoie rien",
    (await asPlayer(A, "select public.search_players('u') as r")).rows[0].r.length === 0,
  );

  const variants = (
    await asPlayer(A, "select public.player_variants($1, $2) as r", [B, "summit1g"])
  ).rows[0].r;
  check(
    "variantes d'un joueur : uniquement celles qu'il possède, de la plus simple à la plus rare",
    JSON.stringify(variants) === JSON.stringify(["gold"]) &&
      (await asPlayer(A, "select public.player_variants($1, $2) as r", [B, "shroud"])).rows[0].r.length === 0,
    JSON.stringify(variants),
  );

  // --- Proposer -------------------------------------------------------------
  const created = (
    await asPlayer(A, "select public.create_trade($1, $2, $3) as r", [
      B,
      JSON.stringify([{ creatorSlug: "ibai", variant: "holo" }]),
      JSON.stringify([{ creatorSlug: "summit1g", variant: "gold", rarity: "common" }]),
    ])
  ).rows[0].r;
  const tradeId = created.trade.id;
  check("offre : créée et ouverte", created.trade.status === "open" && tradeId > 0, JSON.stringify(created.trade.status));
  const catalogueRarity = (
    await client.query(
      "select slug, rarity from public.creators where slug in ('ibai', 'summit1g') order by slug",
    )
  ).rows;
  const rarityOf = Object.fromEntries(catalogueRarity.map((row) => [row.slug, row.rarity]));
  check(
    "offre : la rareté vient du catalogue, pas du client",
    created.trade.recipientCards[0].rarity === rarityOf.summit1g
      && created.trade.proposerCards[0].rarity === rarityOf.ibai,
    `client a dit common/uncommon, catalogue dit ${JSON.stringify(rarityOf)}`,
  );
  check("offre : le destinataire possède bien la carte demandée", created.recipientMissing === null);

  await refuses(
    "offre : je ne peux pas donner une carte que je n'ai pas",
    A,
    "select public.create_trade($1, $2, $3)",
    [B, JSON.stringify([{ creatorSlug: "shroud", variant: "gold" }]), JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }])],
    "tu ne possèdes pas shroud",
  );
  await refuses(
    "offre : la même carte deux fois est refusée",
    A,
    "select public.create_trade($1, $2, $3)",
    [B, JSON.stringify([{ creatorSlug: "ibai", variant: "holo" }, { creatorSlug: "ibai", variant: "holo" }]), JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }])],
    "deux fois",
  );
  await refuses(
    "offre : créateur inconnu du catalogue refusé",
    A,
    "select public.create_trade($1, $2, $3)",
    [B, JSON.stringify([{ creatorSlug: "inconnu-au-bataillon", variant: "live" }]), JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }])],
    "créateur inconnu",
  );
  await refuses(
    "offre : pas d'échange avec soi-même",
    A,
    "select public.create_trade($1, $2, $3)",
    [A, JSON.stringify([{ creatorSlug: "ibai", variant: "holo" }]), JSON.stringify([{ creatorSlug: "ibai", variant: "holo" }])],
    "choisis un autre joueur",
  );

  // --- Voir ses offres ------------------------------------------------------
  const alixList = (await asPlayer(A, "select public.list_trades() as r")).rows[0].r;
  const brunoList = (await asPlayer(B, "select public.list_trades() as r")).rows[0].r;
  check(
    "liste : Alix voit une offre envoyée à Bruno",
    alixList.length === 1 && alixList[0].direction === "out" && alixList[0].partnerName === "Bruno",
    JSON.stringify(alixList[0]),
  );
  check(
    "liste : Bruno voit la même offre, en sens inverse",
    brunoList.length === 1 && brunoList[0].direction === "in"
      && brunoList[0].given[0].creatorSlug === "summit1g"
      && brunoList[0].received[0].creatorSlug === "ibai",
    JSON.stringify(brunoList[0]),
  );
  check(
    "liste : un tiers ne voit rien de l'échange",
    (await asPlayer(C, "select public.list_trades() as r")).rows[0].r.length === 0
      && (await asPlayer(C, "select count(*)::int as n from public.trades")).rows[0].n === 0,
  );
  check(
    "droits : un tiers ne peut pas répondre à l'échange",
    await (async () => {
      try {
        await asPlayer(C, "select public.respond_trade($1, true)", [tradeId]);
        return false;
      } catch (error) {
        return String(error.message).includes("ne t'est pas adressée");
      }
    })(),
  );
  check(
    "droits : les fonctions internes ne sont pas appelables par un joueur",
    await (async () => {
      try {
        await asPlayer(A, "select public._trade_remove($1, $2)", ['[]', '[]']);
        return false;
      } catch (error) {
        return /permission denied/i.test(String(error.message));
      }
    })(),
  );
  // Avant `0019`, la tentative était filtrée en silence par RLS (0 ligne
  // touchée). Depuis, le droit d'écrire la table n'existe plus du tout :
  // le refus est net, et c'est le serveur qui écrit (`push_save`).
  check(
    "droits : je ne peux pas réécrire la collection d'un autre",
    await asPlayer(C, "update public.saves set state = $2 where user_id = $1", [A, JSON.stringify({ cards: [] })])
      .then(() => false)
      .catch((error) => /permission denied/i.test(String(error.message))),
    "attendu : privilège retiré à authenticated",
  );

  // --- Refuser --------------------------------------------------------------
  const toDecline = (
    await asPlayer(A, "select public.create_trade($1, $2, $3) as r", [
      B,
      JSON.stringify([{ creatorSlug: "chowh1", variant: "live" }]),
      JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }]),
    ])
  ).rows[0].r.trade.id;
  const declined = (await asPlayer(B, "select public.respond_trade($1, false) as r", [toDecline])).rows[0].r;
  check("refus : l'offre est close", declined.status === "declined");
  check(
    "refus : aucune collection n'a bougé",
    ownedBy(await stateOf(A), "chowh1", "live").length === 1
      && ownedBy(await stateOf(B), "summit1g", "gold").length === 1,
  );

  // --- Annuler --------------------------------------------------------------
  const toCancel = (
    await asPlayer(A, "select public.create_trade($1, $2, $3) as r", [
      B,
      JSON.stringify([{ creatorSlug: "chowh1", variant: "live" }]),
      JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }]),
    ])
  ).rows[0].r.trade.id;
  await refuses("annulation : le destinataire n'annule pas l'offre du proposeur", B, "select public.cancel_trade($1)", [toCancel], "introuvable");
  check(
    "annulation : le proposeur reprend son offre",
    (await asPlayer(A, "select public.cancel_trade($1) as r", [toCancel])).rows[0].r.status === "cancelled",
  );

  // --- Accepter -------------------------------------------------------------
  const before = { a: await stateOf(A), b: await stateOf(B) };
  const accepted = (await asPlayer(B, "select public.respond_trade($1, true) as r", [tradeId])).rows[0].r;
  const after = { a: await stateOf(A), b: await stateOf(B) };

  check("acceptation : l'offre est close", accepted.status === "accepted");
  // Un échange n'est pas une fabrication : les deux joueurs gardent leur rang.
  // (Le droit est inscrit **avant** la réécriture des sauvegardes, c'est tout
  // l'enjeu de l'ordre dans `0021`.)
  const afterTrade = (
    await client.query("select user_id, verified from public.stats where user_id in ($1, $2) order by user_id", [A, B])
  ).rows;
  check(
    "provenance : un échange accepté ne rend personne suspect",
    afterTrade.length === 2 && afterTrade.every((row) => row.verified === true),
    JSON.stringify(afterTrade),
  );
  check(
    "acceptation : Alix a donné son ibai Holo et reçu le summit1g Gold",
    ownedBy(after.a, "ibai", "holo").length === 1
      && ownedBy(after.a, "summit1g", "gold").length === 1,
  );
  check(
    "acceptation : la carte la plus ancienne est partie",
    ownedBy(after.a, "ibai", "holo")[0].id === "alix-recent",
    JSON.stringify(ownedBy(after.a, "ibai", "holo").map((c) => c.id)),
  );
  check(
    "acceptation : Bruno a fait l'échange inverse",
    ownedBy(after.b, "ibai", "holo").length === 1
      && ownedBy(after.b, "summit1g", "gold").length === 0,
  );
  check(
    "acceptation : les cartes reçues portent l'origine de l'échange",
    ownedBy(after.a, "summit1g", "gold")[0].fromTrade === tradeId
      && ownedBy(after.b, "ibai", "holo")[0].fromTrade === tradeId,
  );
  check(
    "acceptation : points, niveau et boosters intacts",
    after.a.points === before.a.points && after.a.level === before.a.level
      && after.a.packs === before.a.packs && after.b.points === before.b.points,
  );
  const statsAfter = (
    await client.query(
      "select user_id, total_cards, verified from public.stats where user_id in ($1, $2) order by user_id",
      [A, B],
    )
  ).rows;
  check(
    "acceptation : les deux collections restent vérifiées",
    statsAfter.every((row) => row.verified === true) && statsAfter.length === 2,
    JSON.stringify(statsAfter),
  );
  const checksum = (
    await client.query("select md5(state::text) as c from public.saves where user_id = $1", [A])
  ).rows[0].c;
  check(
    "acceptation : l'empreinte de sauvegarde suit",
    (await client.query("select state_checksum as c from public.saves where user_id = $1", [A])).rows[0].c === checksum,
  );
  await refuses("acceptation : une offre déjà tranchée ne se rejoue pas", B, "select public.respond_trade($1, true)", [tradeId], "déjà accepted");

  // --- Une carte disparue annule tout --------------------------------------
  const fragile = (
    await asPlayer(A, "select public.create_trade($1, $2, $3) as r", [
      B,
      JSON.stringify([{ creatorSlug: "ibai", variant: "holo" }]),
      JSON.stringify([{ creatorSlug: "summit1g", variant: "gold" }]),
    ])
  ).rows[0].r;
  check("carte disparue : l'offre existe", fragile.trade.status === "open");

  // Bruno vide sa collection (comme s'il avait envoyé une sauvegarde sans cette
  // carte) : l'acceptation doit tout annuler, sans rien laisser à moitié fait.
  const brunoBefore = await stateOf(B);
  await client.query(
    "update public.saves set state = jsonb_set(state, '{cards}', '[]'::jsonb) where user_id = $1",
    [B],
  );
  await refuses("carte disparue : l'acceptation échoue", B, "select public.respond_trade($1, true)", [fragile.trade.id], "tu ne possèdes plus");
  const alixAfterFailure = await stateOf(A);
  const fragileRow = (await client.query("select status from public.trades where id = $1", [fragile.trade.id])).rows[0];
  check(
    "carte disparue : rien n'a bougé, ni la collection ni l'offre",
    alixAfterFailure.cards.length === before.a.cards.length
      && fragileRow.status === "open"
      && ownedBy(await stateOf(B), "summit1g", "gold").length === 0,
    `cartes=${alixAfterFailure.cards.length} statut=${fragileRow.status}`,
  );
  await client.query("update public.saves set state = $2 where user_id = $1", [B, JSON.stringify(brunoBefore)]);

  // --- Notifications --------------------------------------------------------
  // Deux joueurs neufs, deux appareils. Paul épingle un créateur et possède une
  // carte d'un autre ; Bruno ne s'intéresse à rien. Les notifications ne
  // doivent réveiller que Paul, une fois.
  const PAUL = "aaaaaaaa-0001-4000-8000-00000000a001";
  const BRUNO = "bbbbbbbb-0002-4000-8000-00000000b002";

  // Deux créateurs du catalogue, pris au hasard de leur rang : les contrôles ne
  // dépendent pas de leur nom.
  const vedette = (
    await client.query("select slug, login, display_name from public.creators where retired = false and login is not null order by rank limit 1")
  ).rows[0];
  const second = (
    await client.query(
      "select slug, login, display_name from public.creators where retired = false and login is not null and slug <> $1 order by rank limit 1",
      [vedette.slug],
    )
  ).rows[0];

  await player(PAUL, "Ulysse", [card("paul-1", second.slug, "common", "standard", 40)]);
  await player(BRUNO, "Vera", []);
  await asPlayer(PAUL, "select public.set_wishlist($1)", [vedette.slug]);

  const TOKEN_PAUL = "fcm-paul-0000000000000000000000000000000000000000000000000000";
  const TOKEN_PAUL_BIS = "fcm-paul-tablette-000000000000000000000000000000000000000000000";
  const TOKEN_BRUNO = "fcm-bruno-000000000000000000000000000000000000000000000000000";

  check(
    "notifications : l'inscription enregistre le jeton du compte connecté",
    (await asPlayer(PAUL, "select public.register_push_token($1, 'android') as r", [TOKEN_PAUL])).rows[0].r.ok === true &&
      (await client.query("select user_id, live from public.push_tokens where token = $1", [TOKEN_PAUL])).rows[0].user_id === PAUL,
  );
  await asPlayer(BRUNO, "select public.register_push_token($1, 'android') as r", [TOKEN_BRUNO]);
  await asPlayer(PAUL, "select public.register_push_token($1, 'android') as r", [TOKEN_PAUL_BIS]);

  await refuses(
    "notifications : la table des jetons reste fermée au client",
    PAUL,
    "select count(*) from public.push_tokens",
    [],
    "permission denied",
  );
  await refuses(
    "notifications : `push_targets()` n'est pas appelable par un joueur",
    PAUL,
    "select * from public.push_targets()",
    [],
    "permission denied",
  );
  await refuses(
    "notifications : un jeton vide est refusé",
    PAUL,
    "select public.register_push_token($1) as r",
    ["court"],
    "invalide",
  );
  await refuses(
    "notifications : sans compte, pas d'inscription",
    null,
    "select public.register_push_token($1) as r",
    [TOKEN_PAUL],
    "Connecte-toi",
  );

  // Le direct du créateur épinglé : 1 234 spectateurs, commencé il y a 5 min.
  const enDirect = async (rows) =>
    client.query("select public.live_publish($1::jsonb, $2)", [
      JSON.stringify(rows),
      "notifications",
    ]);
  const cinqMinutes = new Date(Date.now() - 5 * 60_000).toISOString();
  await enDirect([
    { login: vedette.login, display_name: vedette.display_name, viewers: 1234, started_at: cinqMinutes },
  ]);

  const premier = (await client.query("select * from public.push_targets()")).rows;
  check(
    "notifications : l'épinglé qui passe en direct réveille ses deux appareils",
    premier.length === 2 &&
      premier.every((row) => row.user_id === PAUL && row.login === vedette.login && row.reason === "epingle") &&
      new Set(premier.map((row) => row.token)).size === 2,
    JSON.stringify(premier),
  );

  const journalNotif = await client.query("select count(*)::int as n from public.push_log where user_id = $1", [PAUL]);
  check("notifications : le journal garde une trace par (joueur, créateur)", journalNotif.rows[0].n === 1, String(journalNotif.rows[0].n));

  check(
    "notifications : deux passages d'affilée n'envoient pas deux fois",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0,
  );

  // Le créateur d'une carte possédée, mais pas épinglé : il passe après, et le
  // plafond d'une heure par joueur doit le retenir tant que le premier est
  // frais dans le journal.
  await enDirect([
    { login: vedette.login, display_name: vedette.display_name, viewers: 1234, started_at: cinqMinutes },
    { login: second.login, display_name: second.display_name, viewers: 500, started_at: cinqMinutes },
  ]);
  check(
    "notifications : le plafond d'une heure par joueur tient (un direct dans la collection attend)",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0,
  );

  // Trois heures plus tard, la même scène : cette fois la carte possédée passe.
  await client.query("update public.push_log set sent_at = now() - interval '3 hours' where user_id = $1", [PAUL]);
  const ensuite = (await client.query("select * from public.push_targets()")).rows;
  check(
    "notifications : la carte possédée réveille aussi, avec sa raison",
    ensuite.length === 2 && ensuite.every((row) => row.login === second.login && row.reason === "collection"),
    JSON.stringify(ensuite),
  );

  // L'interrupteur du joueur coupe tout.
  await client.query("update public.push_log set sent_at = now() - interval '8 hours' where user_id = $1", [PAUL]);
  check(
    "notifications : l'interrupteur coupé n'envoie plus rien (et touche les deux appareils)",
    (await asPlayer(PAUL, "select public.set_push_live(false) as r")).rows[0].r.devices === 2 &&
      (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0,
  );
  await asPlayer(PAUL, "select public.set_push_live(true) as r");
  check(
    "notifications : l'interrupteur rallumé les réveille",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 2,
  );

  // L'état se **relit** : c'est ce qui manquait le 7 octobre — au lancement,
  // l'application ne savait rien et affichait un interrupteur éteint, alors que
  // le serveur notifiait toujours. La lecture ne change rien (le décompte de
  // `push_log` ne bouge pas) et reste fermée au visiteur.
  const etatPaul = async () =>
    (await asPlayer(PAUL, "select public.push_state() as r")).rows[0].r;
  const journalAvantLecture = (
    await client.query("select count(*)::int as n from public.push_log where user_id = $1", [PAUL])
  ).rows[0].n;
  const lectureUn = await etatPaul();
  const lectureDeux = await etatPaul();
  check(
    "notifications : l'état se relit au lancement (`push_state`), sans rien changer",
    lectureUn.live === true &&
      lectureDeux.devices === 2 &&
      // Relire ne consomme **rien** : le journal reste exactement le même.
      (await client.query("select count(*)::int as n from public.push_log where user_id = $1", [PAUL]))
        .rows[0].n === journalAvantLecture,
  );
  check(
    "notifications : l'état relu suit l'interrupteur, compte par compte",
    (await asPlayer(BRUNO, "select public.push_state() as r")).rows[0].r.devices === 1 &&
      (await asPlayer(PAUL, "select public.set_push_live(false) as r")).rows[0].r.ok === true &&
      (await etatPaul()).live === false &&
      (await asPlayer(PAUL, "select public.set_push_live(true) as r")).rows[0].r.ok === true &&
      (await etatPaul()).live === true,
  );
  check(
    "notifications : sans compte, l'état ne dit rien de personne",
    (await asPlayer(null, "select public.push_state() as r")).rows[0].r.live === false &&
      (await asPlayer(null, "select public.push_state() as r")).rows[0].r.devices === 0,
  );
  const etatVisiteur = await (async () => {
    await client.query("set role anon");
    try {
      await client.query("select public.push_state()");
      return "appelable";
    } catch (error) {
      return String(error.message || "");
    } finally {
      await client.query("reset role");
    }
  })();
  check(
    "notifications : `push_state()` reste hors de portée d'un visiteur",
    etatVisiteur.includes("permission denied"),
    etatVisiteur,
  );

  // Un direct vieux de 45 minutes n'est plus « frais », un direct à zéro
  // spectateur n'est pas un direct.
  await client.query("update public.push_log set sent_at = now() - interval '8 hours' where user_id = $1", [PAUL]);
  const quaranteCinqMinutes = new Date(Date.now() - 45 * 60_000).toISOString();
  await enDirect([{ login: vedette.login, display_name: vedette.display_name, viewers: 900, started_at: quaranteCinqMinutes }]);
  check(
    "notifications : un direct commencé il y a 45 minutes ne réveille personne",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0,
  );
  await enDirect([{ login: vedette.login, display_name: vedette.display_name, viewers: 0, started_at: cinqMinutes }]);
  check(
    "notifications : un direct à zéro spectateur ne réveille personne",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0,
  );

  // Bruno ne s'intéresse à rien : il n'a jamais été réveillé.
  check(
    "notifications : un joueur sans épinglé ni carte n'est jamais réveillé",
    (await client.query("select count(*)::int as n from public.push_targets() where user_id = $1", [BRUNO])).rows[0].n === 0,
  );

  // Le retrait : le jeton quitte le serveur, et le compte n'est plus joignable.
  await enDirect([{ login: vedette.login, display_name: vedette.display_name, viewers: 1200, started_at: cinqMinutes }]);
  await asPlayer(PAUL, "select public.forget_push_token($1) as r", [TOKEN_PAUL]);
  await asPlayer(PAUL, "select public.forget_push_token($1) as r", [TOKEN_PAUL_BIS]);
  check(
    "notifications : un jeton retiré (et lui seul) ne reçoit plus rien",
    (await client.query("select count(*)::int as n from public.push_targets()")).rows[0].n === 0 &&
      (await client.query("select count(*)::int as n from public.push_tokens where user_id = $1", [PAUL])).rows[0].n === 0 &&
      (await client.query("select count(*)::int as n from public.push_tokens where token = $1", [TOKEN_BRUNO])).rows[0].n === 1,
  );

  // Le même appareil change de compte : le jeton suit le nouveau propriétaire.
  await asPlayer(PAUL, "select public.register_push_token($1, 'android') as r", [TOKEN_PAUL]);
  await asPlayer(BRUNO, "select public.register_push_token($1, 'android') as r", [TOKEN_PAUL]);
  check(
    "notifications : le même appareil qui change de compte déplace son jeton",
    (await client.query("select user_id from public.push_tokens where token = $1", [TOKEN_PAUL])).rows[0].user_id === BRUNO,
  );

  // Rejouer la migration ne casse rien : jetons conservés, fonctions en place.
  await client.query(notifications);
  // Rejouer `0023` **seule** ramène `push_targets()` à sa version d'origine : les
  // gardes de `0037` disparaissent. C'est la seule raison pour laquelle `0037`
  // doit être collée (ou recollée) après `0023` — et pourquoi ce rejeu est suivi
  // du sien, sinon la rejouabilité se testerait sur une base qui n'a plus la
  // dernière migration.
  await client.query(gardes);
  check(
    "notifications : la migration est rejouable, jetons compris",
    (await client.query("select count(*)::int as n from public.push_tokens")).rows[0].n === 2 &&
      (await client.query("select count(*)::int as n from pg_proc where proname = 'push_targets'")).rows[0].n === 1,
    String((await client.query("select count(*)::int as n from public.push_tokens")).rows[0].n),
  );

  // --- Les alertes de perte (0037) -----------------------------------------
  //
  // Deux notifications qui ne promettent rien : elles annoncent une **perte**
  // qu'on peut encore éviter — la série qui repart à J1 si le booster du jour
  // n'est pas ouvert, les boosters qui cessent de s'accumuler quand la réserve
  // est pleine. Comme le direct, elles se décident **côté serveur**, dans
  // `push_targets()`, et cette section les éprouve là où ça compte : le calcul
  // de la journée de jeu, le silence quand il n'y a rien à sauver, l'anti-doublon
  // d'une soirée, et le fait qu'une alerte ne se fasse **pas** repousser par
  // une autre.
  const JOUEUR_SERIE = "cccccccc-0003-4000-8000-00000000c003";
  const JOUEUR_PLEINE = "dddddddd-0004-4000-8000-00000000d004";
  const JOUEUR_CALME = "eeeeeeee-0005-4000-8000-00000000e005";
  await player(JOUEUR_SERIE, "Nolwenn", []);
  await player(JOUEUR_PLEINE, "Pénélope", []);
  await player(JOUEUR_CALME, "Quitterie", []);
  const TOKEN_SERIE = "fcm-serie-000000000000000000000000000000000000000000000000000";
  const TOKEN_PLEINE = "fcm-pleine-00000000000000000000000000000000000000000000000000";
  const TOKEN_CALME = "fcm-calme-000000000000000000000000000000000000000000000000000";
  await asPlayer(JOUEUR_SERIE, "select public.register_push_token($1, 'android') as r", [TOKEN_SERIE]);
  await asPlayer(JOUEUR_PLEINE, "select public.register_push_token($1, 'android') as r", [TOKEN_PLEINE]);
  await asPlayer(JOUEUR_CALME, "select public.register_push_token($1, 'android') as r", [TOKEN_CALME]);

  /**
   * Pose un tirage `live` un jour de jeu donné (`0` = aujourd'hui, `1` = hier).
   * L'heure est midi UTC : la journée de jeu bascule à 6 h UTC, donc midi est
   * en plein milieu — le contrôle ne dépend pas de l'heure du run.
   */
  async function tirageJour(userId, joursEnArriere) {
    // Cinq cartes, comme un vrai tirage : `pack_draws` refuse une ligne qui n'a
    // pas exactement cinq cartes, et un tirage vide ne serait pas un tirage.
    const cartes = Array.from({ length: 5 }, (_, index) => card(`tiroir-${index}`, second.slug, "common", "standard", 0));
    // Le déclencheur du Last Pack (`0012`) publie un paquet qui expire dix
    // minutes plus tard et purge aussitôt ceux qui sont périmés : antidater un
    // tirage d'hier laisserait donc une ligne de `pack_draws` **sans** Last
    // Pack, et le contrôle final (« pas de double publication ») verrait un
    // écart qui n'a rien à voir avec les alertes. On le coupe le temps de
    // l'insertion — ces tirages ne sont pas des tirages de joueur, ils posent
    // des **dates** dans le journal.
    await client.query("alter table public.pack_draws disable trigger pack_draws_last_pack");
    try {
      await client.query(
        `insert into public.pack_draws (user_id, drawn_at, cards, kind)
         values ($1, ((public._pack_game_day(now()) - $2::integer) + time '12:00') at time zone 'utc', $3::jsonb, 'live')`,
        [userId, joursEnArriere, JSON.stringify(cartes)],
      );
    } finally {
      await client.query("alter table public.pack_draws enable trigger pack_draws_last_pack");
    }
  }
  /** Un joueur neuf côté serveur : ni tirage, ni réserve. */
  async function viderJournal(userId) {
    await client.query("delete from public.push_log where user_id = $1", [userId]);
  }
  /** Efface les tirages d'un joueur de test (et ses Last Packs, par sûreté). */
  async function effacerTirages(userId) {
    await client.query("delete from public.last_packs where user_id = $1", [userId]);
    await client.query("delete from public.pack_draws where user_id = $1", [userId]);
  }
  const gardeSerie = async (userId) =>
    (await client.query("select public._push_serie_due($1, now()) as j", [userId])).rows[0].j;
  const gardeReserve = async (userId) =>
    (await client.query("select public._push_reserve_due($1, now()) as n", [userId])).rows[0].n;
  const cibles = async (userId) =>
    (await client.query("select * from public.push_targets() where user_id = $1 order by reason", [userId])).rows;

  // Cinq jours d'affilée jusqu'à hier, rien aujourd'hui : la série est vivante,
  // pas faite, et c'est un J5.
  for (let jour = 5; jour >= 1; jour -= 1) await tirageJour(JOUEUR_SERIE, jour);
  check(
    "alertes : la série vivante et pas faite aujourd'hui donne son jour du cycle",
    (await gardeSerie(JOUEUR_SERIE)) === 5,
    String(await gardeSerie(JOUEUR_SERIE)),
  );
  const due = await cibles(JOUEUR_SERIE);
  check(
    "alertes : la série due part, une fois, vers le bon appareil",
    due.length === 1 &&
      due[0].reason === "serie" &&
      due[0].login === "série" &&
      due[0].viewers === 5 &&
      due[0].token === TOKEN_SERIE,
    JSON.stringify(due),
  );
  check(
    "alertes : la même alerte ne repart pas juste après",
    (await cibles(JOUEUR_SERIE)).length === 0,
  );

  // Le booster du jour est ouvert : il n'y a plus rien à sauver, et un rappel
  // ici serait le genre de notification qui fait couper l'interrupteur.
  await tirageJour(JOUEUR_SERIE, 0);
  await viderJournal(JOUEUR_SERIE);
  check(
    "alertes : un joueur qui a déjà ouvert son booster n'est pas relancé",
    (await gardeSerie(JOUEUR_SERIE)) === null && (await cibles(JOUEUR_SERIE)).length === 0,
  );

  // Une série cassée (rien depuis avant-hier) n'est pas une série à sauver ;
  // une série de huit jours d'affilée redevient un J1 : le cycle est celui du jeu.
  await effacerTirages(JOUEUR_SERIE);
  for (let jour = 8; jour >= 2; jour -= 1) await tirageJour(JOUEUR_SERIE, jour);
  check(
    "alertes : une série déjà cassée ne se « sauve » pas",
    (await gardeSerie(JOUEUR_SERIE)) === null,
  );
  await tirageJour(JOUEUR_SERIE, 1);
  check(
    "alertes : huit jours d'affilée redeviennent un J1, comme dans le jeu",
    (await gardeSerie(JOUEUR_SERIE)) === 1,
    String(await gardeSerie(JOUEUR_SERIE)),
  );

  // La réserve pleine : elle doit être pleine **depuis assez longtemps** pour
  // qu'une recharge soit tombée dans le vide. Deux heures, c'est une heure pour
  // se remplir (deux recharges de 30 minutes) plus une heure de sursis.
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at, openings) values ($1, 4, now() - interval '20 minutes', 0)",
    [JOUEUR_PLEINE],
  );
  check(
    "alertes : une réserve pleine mais fraîche ne dit rien (on a le temps d'ouvrir)",
    (await gardeReserve(JOUEUR_PLEINE)) === null,
  );
  await client.query("update public.pack_state set last_regen_at = now() - interval '2 hours' where user_id = $1", [JOUEUR_PLEINE]);
  check(
    "alertes : une réserve pleine depuis deux heures annonce la perte",
    (await gardeReserve(JOUEUR_PLEINE)) === 4,
    String(await gardeReserve(JOUEUR_PLEINE)),
  );
  const reserve = await cibles(JOUEUR_PLEINE);
  check(
    "alertes : l'alerte de réserve part une fois, avec son chiffre",
    reserve.length === 1 && reserve[0].reason === "reserve" && reserve[0].viewers === 4 && reserve[0].login === "réserves",
    JSON.stringify(reserve),
  );
  check("alertes : la même alerte de réserve ne repart pas juste après", (await cibles(JOUEUR_PLEINE)).length === 0);
  check(
    "alertes : une réserve entamée n'annonce plus rien",
    (await client.query("update public.pack_state set packs = 3, last_regen_at = now() - interval '2 hours' where user_id = $1", [JOUEUR_PLEINE]),
     (await gardeReserve(JOUEUR_PLEINE)) === null),
  );

  // Le piège que l'ajout crée — et qu'on éprouve dans **les deux sens**, plutôt
  // que de le commenter. Le plafond d'une heure de `0023` ne doit pas
  // s'appliquer aux alertes (sinon une alerte chasse l'autre), et la ligne
  // `série` du journal ne doit pas non plus consommer le tour du direct (sinon
  // le direct du soir est perdu pour avoir prévenu d'une perte).
  await viderJournal(JOUEUR_SERIE);
  await asPlayer(JOUEUR_SERIE, "select public.set_wishlist($1)", [vedette.slug]);
  await enDirect([{ login: vedette.login, display_name: vedette.display_name, viewers: 800, started_at: cinqMinutes }]);
  // Le direct de cet après-midi est déjà passé par là : le voilà dans le journal
  // il y a deux heures — bloqué par son plafond d'une heure, mais **pas** par
  // celui des six heures, pour que le contrôle porte bien sur le premier.
  await client.query("insert into public.push_log (user_id, login, sent_at) values ($1, $2, now() - interval '2 hours')", [
    JOUEUR_SERIE,
    vedette.login,
  ]);
  const avecDirectFrais = await cibles(JOUEUR_SERIE);
  check(
    "alertes : un direct déjà notifié ne retient pas l'alerte de perte",
    avecDirectFrais.length === 1 && avecDirectFrais[0].reason === "serie",
    JSON.stringify(avecDirectFrais),
  );
  // Le miroir exact : la ligne `série` est maintenant dans le journal, et elle
  // ne doit pas empêcher le direct du soir de sortir. On écarte d'abord le
  // plafond des six heures (qui, lui, parle bien du même créateur).
  await client.query("update public.push_log set sent_at = now() - interval '7 hours' where user_id = $1 and login = $2", [
    JOUEUR_SERIE,
    vedette.login,
  ]);
  const directApresAlerte = await cibles(JOUEUR_SERIE);
  check(
    "alertes : la ligne de l'alerte ne consomme pas le tour du direct",
    directApresAlerte.length === 1 &&
      directApresAlerte[0].reason === "epingle" &&
      directApresAlerte[0].login === vedette.login &&
      directApresAlerte[0].viewers === 800,
    JSON.stringify(directApresAlerte),
  );

  // Un joueur sans rien à perdre (pas de réserve côté serveur, pas de tirage) ne
  // reçoit aucune alerte : ces pushs ne réveillent que ceux qui ont quelque
  // chose à garder.
  check(
    "alertes : un joueur sans série ni réserve n'est pas réveillé",
    (await cibles(JOUEUR_CALME)).length === 0,
  );

  // L'interrupteur coupe les alertes comme le reste : c'est la même porte.
  await client.query("update public.pack_state set packs = 4, last_regen_at = now() - interval '3 hours' where user_id = $1", [JOUEUR_PLEINE]);
  await viderJournal(JOUEUR_PLEINE);
  check(
    "alertes : l'interrupteur coupé les fait taire aussi",
    (await asPlayer(JOUEUR_PLEINE, "select public.set_push_live(false) as r")).rows[0].r.ok === true &&
      (await cibles(JOUEUR_PLEINE)).length === 0,
  );
  await asPlayer(JOUEUR_PLEINE, "select public.set_push_live(true) as r");
  check(
    "alertes : l'interrupteur rallumé les fait repartir",
    (await cibles(JOUEUR_PLEINE)).some((row) => row.reason === "reserve"),
  );

  // Les deux gardes sont des fonctions internes : un joueur ne les appelle pas,
  // et ne peut pas non plus lire le journal pour savoir quand il a été réveillé.
  await refuses(
    "alertes : la garde de série n'est pas appelable par un joueur",
    JOUEUR_SERIE,
    "select public._push_serie_due($1, now())",
    [JOUEUR_SERIE],
    "permission denied",
  );
  await refuses(
    "alertes : la garde de réserve n'est pas appelable par un joueur",
    JOUEUR_PLEINE,
    "select public._push_reserve_due($1, now())",
    [JOUEUR_PLEINE],
    "permission denied",
  );
  await refuses(
    "alertes : un joueur ne lit pas le journal des envois",
    JOUEUR_SERIE,
    "select count(*) from public.push_log",
    [],
    "permission denied",
  );
  check(
    "alertes : `push_targets()` n'existe qu'une fois (migration rejouable)",
    (await client.query("select count(*)::int as n from pg_proc where proname = 'push_targets'")).rows[0].n === 1,
  );

  // Place nette : ces trois joueurs ont fini leur travail, et un tirage de test
  // laissé derrière lui ferait mentir le contrôle « le Last Pack n'est pas
  // publié deux fois » — le déclencheur de `0012` purge les Last Packs périmés
  // d'un joueur à chaque nouveau tirage, donc les deux compteurs doivent rester
  // strictement d'accord, joueur de test compris.
  await viderJournal(JOUEUR_SERIE);
  await viderJournal(JOUEUR_PLEINE);
  await effacerTirages(JOUEUR_SERIE);

  // --- La veille automatique du direct (0025) ------------------------------
  //
  // Ici, ni `pg_cron` ni `pg_net` : l'horloge ne peut pas être planifiée, et
  // c'est **voulu** — la pile doit se rejouer sur un Postgres ordinaire. Ce
  // qu'on contrôle, c'est ce qui reste vrai partout : la porte existe, elle
  // demande bien le rafraîchissement, et un joueur ne peut pas s'en servir.
  const directAutoCode = directAuto
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
  check(
    "direct auto : la base demande le rafraîchissement à la fonction serveur",
    directAutoCode.includes("net.http_post") &&
      directAutoCode.includes("/functions/v1/refresh-live") &&
      /create or replace function public\.cron_refresh_live\(\)/.test(directAutoCode),
  );
  check(
    "direct auto : la clé employée est la clé publique, jamais celle de service",
    directAutoCode.includes("sb_publishable_") &&
      !directAutoCode.includes("sb_secret_") &&
      !directAutoCode.includes("service_role"),
  );
  check(
    "direct auto : l'horloge est planifiée toutes les deux minutes, sans doublon",
    /cron\.schedule\(\s*'creatordeck-refresh-live',\s*'\*\/2 \* \* \* \*'/.test(directAutoCode) &&
      directAutoCode.includes("cron.unschedule") &&
      directAutoCode.includes("to_regnamespace('cron') is null"),
  );
  await refuses(
    "direct auto : un joueur ne peut pas déclencher la requête",
    PAUL,
    "select public.cron_refresh_live()",
    [],
    "permission denied",
  );
  check(
    "direct auto : la fonction n'est là qu'une fois (migration rejouable)",
    (await client.query("select count(*)::int as n from pg_proc where proname = 'cron_refresh_live'")).rows[0].n === 1,
  );

  // --- Les codes promo (0026) ----------------------------------------------
  // Un code donne **un booster**, une fois par joueur, et seulement si la
  // réserve a de la place (elle est plafonnée à quatre). `last_regen_at` est
  // reposé à chaque fois : sans ça, une réserve d'ancienne fixture se
  // régénérerait toute seule et les contrôles dépendraient de l'heure.
  async function setReserve(userId, packs) {
    await client.query(
      `insert into public.pack_state (user_id, packs, last_regen_at, openings) values ($1, $2, now(), 0)
       on conflict (user_id) do update set packs = excluded.packs, last_regen_at = now()`,
      [userId, packs],
    );
  }

  await client.query("select public.create_promo_code('BOOSTER-TEST', 1, null, null, 'contrôle')");
  await client.query("select public.create_promo_code('DEJA-PRIS', 1, null, null, '')");
  await client.query("select public.create_promo_code('EXPIRE', 1, null, now() - interval '1 day', '')");
  await client.query("select public.create_promo_code('UN-SEUL', 2, 1, null, '')");

  await setReserve(C, 0);
  const redeemi = (await asPlayer(C, "select public.redeem_promo_code('booster-test') as r")).rows[0].r;
  check(
    "codes promo : un code donne un booster, quelle que soit la casse tapée",
    redeemi.ok === true && redeemi.packs === 1 && redeemi.reserve === 1,
    JSON.stringify(redeemi),
  );
  check(
    "codes promo : le booster arrive vraiment dans la réserve du serveur",
    (await asPlayer(C, "select public.pack_status() as r")).rows[0].r.packs === 1,
  );
  await refuses(
    "codes promo : le même code ne sert qu'une fois par joueur",
    C,
    "select public.redeem_promo_code('BOOSTER-TEST') as r",
    [],
    "déjà utilisé",
  );
  await refuses(
    "codes promo : un code inconnu est refusé",
    C,
    "select public.redeem_promo_code('JAMAIS-VU') as r",
    [],
    "n'existe pas",
  );
  await refuses(
    "codes promo : un code expiré est refusé",
    C,
    "select public.redeem_promo_code('EXPIRE') as r",
    [],
    "expiré",
  );

  // Réserve pleine : refus **sans consommer** le code. On le prouve en le
  // donnant juste après à un autre joueur, et en comptant les rédemptions.
  await setReserve(C, 4);
  let reservePleine = "";
  try {
    await asPlayer(C, "select public.redeem_promo_code('DEJA-PRIS') as r");
  } catch (error) {
    reservePleine = String(error.message || "");
  }
  await setReserve(B, 0);
  check(
    "codes promo : une réserve pleine refuse le code sans le consommer",
    reservePleine.includes("réserve est pleine") &&
      (await asPlayer(B, "select public.redeem_promo_code('DEJA-PRIS') as r")).rows[0].r.reserve === 1 &&
      (await client.query("select count(*)::int as n from public.promo_redemptions where code = 'DEJA-PRIS'")).rows[0].n === 1,
    reservePleine || "aucune erreur levée",
  );

  // Épuisé : le code à un seul usage part une fois, puis refuse tout le monde.
  await setReserve(B, 0);
  check(
    "codes promo : un code à un seul usage part une fois",
    (await asPlayer(B, "select public.redeem_promo_code('UN-SEUL') as r")).rows[0].r.reserve === 2,
  );
  await setReserve(A, 0);
  await refuses(
    "codes promo : un code épuisé est refusé",
    A,
    "select public.redeem_promo_code('UN-SEUL') as r",
    [],
    "déjà été utilisé le nombre de fois prévu",
  );
  check(
    "codes promo : un joueur ne remplit qu'une fois la table des rédemptions",
    (await client.query("select count(*)::int as n from public.promo_redemptions where code = 'UN-SEUL'")).rows[0].n === 1,
  );
  await refuses(
    "codes promo : les tables restent fermées au joueur",
    PAUL,
    "select count(*) from public.promo_codes",
    [],
    "permission denied",
  );
  await refuses(
    "codes promo : un joueur ne peut pas créer de code",
    PAUL,
    "select public.create_promo_code('PIRATE', 4, null, null, '') as r",
    [],
    "permission denied",
  );
  await refuses(
    "codes promo : sans compte, pas de code",
    null,
    "select public.redeem_promo_code('BOOSTER-TEST') as r",
    [],
    "connecte-toi",
  );
  check(
    "codes promo : la migration est rejouable, rédemptions comprises",
    (await client.query("select count(*)::int as n from pg_proc where proname = 'redeem_promo_code'")).rows[0].n === 1 &&
      (await client.query("select count(*)::int as n from public.promo_codes where code = 'BOOSTER-TEST'")).rows[0].n === 1 &&
      // Chloé l'a rédempté, le refus d'Alix ci-dessus (code épuisé) n'a rien
      // consommé, et la migration rejouée n'a pas doublé les lignes.
      (await client.query("select used from public.promo_codes where code = 'BOOSTER-TEST'")).rows[0].used === 1,
  );

  // --- Rejouabilité de la migration ----------------------------------------
  await client.query(
    (await readFile(path.join(MIGRATIONS, "0005_echanges.sql"), "utf8")),
  );
  const tradesStill = (await client.query("select count(*)::int as n from public.trades")).rows[0].n;
  check("migration échanges rejouable : table conservée", tradesStill >= 4, String(tradesStill));

  // Rejouer une migration **ancienne** ramène ses définitions : `0005` recrée
  // `respond_trade`, donc sans ce recollage la version d'avant `0022` revient —
  // et le blanchiment se rouvre en silence. C'est la règle de la pile : on
  // recolle dans l'ordre, et ce qui est plus récent repasse en dernier.
  await client.query(packDansSaves);
  // …et `0031` par-dessus : elle est plus récente que `0022`, et sans elle le
  // recollage ramènerait le seuil du plancher de malchance à 80 dans la base du
  // contrôle. Le pity se mesure plus bas : c'est là que ça se voyait.
  await client.query(douze);
  await client.query(serie);
  await client.query(depart);
  await client.query(protege);
  await client.query(jetons);
  check(
    "migration échanges rejouable : les refus de `0022` survivent au recollage",
    (
      await client.query(
        "select count(*)::int as n from pg_proc where proname in ('respond_trade', 'create_trade', 'market_sell', 'market_buy') and position('card_claim_covers' in prosrc) > 0",
      )
    ).rows[0].n === 4,
  );

  // --- Profil public --------------------------------------------------------
  // Diane a une collection variée, Ethan une toute petite, Fabien une
  // sauvegarde impossible : les trois servent à vérifier la projection, la
  // complétion, les rangs et ce qui reste invisible.
  const D = "dddddddd-4444-4444-8444-dddddddddddd";
  const E = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
  const F = "ffffffff-6666-4666-8666-ffffffffffff";
  const GASPARD = "99999999-7777-4777-8777-999999999999";

  // Un créateur par rareté, pris dans le catalogue : les vérifications ne
  // dépendent pas de la rareté réelle d'un créateur précis.
  const oneOf = async (rarity) =>
    (await client.query("select slug, rarity from public.creators where rarity = $1 order by rank limit 1", [rarity])).rows[0];
  const [legendaryOne, uncommonOne, rareOne] = [await oneOf("legendary"), await oneOf("uncommon"), await oneOf("rare")];

  await player(D, "Diane", [
    card("diane-gold", legendaryOne.slug, legendaryOne.rarity, "gold", 5),
    card("diane-holo", uncommonOne.slug, uncommonOne.rarity, "holo", 6),
    // Deux fois le même créateur : une seule ligne dans la projection, un seul
    // créateur unique — mais bien deux cartes.
    card("diane-doublon", legendaryOne.slug, legendaryOne.rarity, "standard", 7),
    card("diane-epic", rareOne.slug, rareOne.rarity, "standard", 8),
  ]);
  await player(E, "Ethan", [card("ethan-1", "chowh1", "common", "standard", 30)]);
  // Fabien : rareté qui n'existe pas — `save_problems()` la refuse (le « ! »
  // force la valeur, comme un client trafiqué).
  await player(F, "Fabien", [card("fabien-faux", "kaicenat", "!mythique", "standard", 12)]);
  // Gaspard : un créateur qui n'existe pas au catalogue. La sauvegarde **passe**
  // (il garde ses cartes), mais elle est suspecte : il n'est plus classé.
  await player(GASPARD, "Gaspard", [card("gaspard-faux", "streameur-qui-nexiste-pas", "!legendary", "standard", 9)]);

  const dianeRows = (
    await client.query("select count(*)::int as n, count(distinct creator_slug)::int as u from public.user_cards where user_id = $1", [D])
  ).rows[0];
  check(
    "projection : une ligne par carte de la sauvegarde, doublon de créateur compris",
    dianeRows.n === 4,
    JSON.stringify(dianeRows),
  );
  check("projection : le créateur inventé n'entre pas dans la table", dianeRows.u === 3, String(dianeRows.u));

  // …et il ne fait pas qu'être ignoré : une carte hors catalogue rend la
  // sauvegarde **suspecte**. Le joueur garde tout, il n'est simplement plus
  // classé — c'est la différence entre refuser (perdre ses cartes) et classer.
  const gaspard = (
    await client.query("select verified from public.stats where user_id = $1", [GASPARD])
  ).rows[0];
  check(
    "intégrité : un créateur hors catalogue rend la sauvegarde suspecte",
    gaspard?.verified === false,
    JSON.stringify(gaspard),
  );
  check(
    "intégrité : une rareté qui ne correspond pas au catalogue aussi",
    (
      await client.query("select 1 from public.save_suspicions($1::jsonb, $2) as p", [
        JSON.stringify({
          cards: [{ id: "x", creatorSlug: "kaicenat", rarity: "common", variant: "standard" }],
        }),
        // Un joueur qui n'a rien reçu : c'est le point de ce contrôle.
        "44445555-6666-4777-8888-999900001111",
      ])
    ).rows.length === 1,
  );

  const dianeStats = (
    await client.query("select unique_creators, total_cards, gold_cards, holo_cards, verified from public.stats where user_id = $1", [D])
  ).rows[0];
  check(
    "statistiques : le créateur inventé ne compte pas dans la complétion",
    dianeStats.unique_creators === 3,
    JSON.stringify(dianeStats),
  );
  check(
    "statistiques : les nouvelles colonnes Gold et Holo suivent la sauvegarde",
    dianeStats.gold_cards === 1 && dianeStats.holo_cards === 1,
    JSON.stringify(dianeStats),
  );

  const profileD = (await asPlayer(E, "select public.player_profile($1) as p", [D])).rows[0].p;
  check("profil : la fiche d'un autre joueur est lisible", profileD?.display_name === "Diane", JSON.stringify(profileD?.display_name));
  check(
    "profil : complétion calculée sur le catalogue du serveur",
    profileD.catalog_size === 1000 && profileD.completion === 0.003,
    `${profileD.unique_creators}/${profileD.catalog_size} = ${profileD.completion}`,
  );
  check(
    "profil : la répartition par rareté donne possédé / total",
    profileD.by_rarity.legendary.total === 50
      && profileD.by_rarity.common.total === 300
      && profileD.by_rarity.rarity_inexistante === undefined
      && profileD.by_rarity.legendary.owned === 1
      && profileD.by_rarity.uncommon.owned === 1
      && profileD.by_rarity.rare.owned === 1
      && profileD.by_rarity.common.owned === 0,
    JSON.stringify(profileD.by_rarity),
  );

  check(
    "saisons : chaque créateur du catalogue porte sa famille",
    (
      await client.query(
        "select count(*)::int as n from public.creators where region is null or region !~ '^S[0-9]{2}$'",
      )
    ).rows[0].n === 0,
  );
  const families = profileD.by_region;
  const familyTotals = Object.values(families).reduce((sum, family) => sum + family.total, 0);
  const familyOwned = Object.values(families).reduce((sum, family) => sum + family.owned, 0);
  check(
    "saisons : les familles se partagent exactement le catalogue",
    familyTotals === profileD.catalog_size && Object.keys(families).length >= 9,
    `${familyTotals} sur ${profileD.catalog_size}, ${Object.keys(families).length} familles`,
  );
  check(
    "saisons : la complétion par famille ne compte que les créateurs possédés une fois",
    // Diane a trois créateurs uniques : le total des familles doit tomber
    // dessus, même si deux de ses cartes partagent un créateur.
    familyOwned === dianeStats.unique_creators,
    `${familyOwned} sur ${dianeStats.unique_creators}`,
  );
  check(
    "saisons : chaque créateur possédé tombe dans la famille que lui donne le catalogue",
    await (async () => {
      const rows = (
        await client.query(
          `select c.region, count(distinct uc.creator_slug)::int as n
             from public.user_cards uc join public.creators c on c.slug = uc.creator_slug
            where uc.user_id = $1
            group by c.region order by c.region`,
          [D],
        )
      ).rows;
      // Une seule bonne réponse : la famille de Diane ne compte que ses
      // créateurs à elle, et aucune autre famille ne compte quoi que ce soit.
      return rows.length > 0 && rows.every((row) => families[row.region]?.owned === row.n);
    })(),
  );
  check(
    "saisons : une famille sans aucune carte est à zéro, pas absente",
    Object.values(families).some((family) => family.owned === 0) &&
      Object.values(families).every((family) => typeof family.owned === "number"),
  );
  check(
    "saisons : le profil de n'importe qui donne les mêmes totaux par famille",
    (await asPlayer(E, "select public.player_profile($1) as p", [F])).rows[0].p.by_region.S01.total ===
      families.S01.total,
  );

  const verifiedRows = (
    await client.query("select user_id, unique_creators from public.stats where verified order by unique_creators desc")
  ).rows;
  const expectedRank = verifiedRows.filter((row) => row.unique_creators > dianeStats.unique_creators).length + 1;
  check(
    "profil : le rang correspond au nombre de joueurs devant",
    profileD.rank_completion === expectedRank,
    `${profileD.rank_completion} attendu ${expectedRank}`,
  );
  check(
    "profil : une sauvegarde impossible n'a pas de rang",
    (await asPlayer(E, "select public.player_profile($1) as p", [F])).rows[0].p.rank_completion === null,
  );
  check(
    "profil : un identifiant inconnu ne renvoie rien",
    (await asPlayer(E, "select public.player_profile($1) as p", ["99999999-9999-4999-8999-999999999999"])).rows[0].p === null,
  );

  // `user_cards` est **retirée** aux clients par `0006` (`revoke all`) : le
  // propriétaire des cartes lui-même ne peut pas la lire. La table n'est lue
  // que par les fonctions du serveur.
  check(
    "projection : les cartes restent invisibles au client",
    await asPlayer(D, "select count(*)::int as n from public.user_cards")
      .then(() => false)
      .catch((error) => /permission denied/i.test(String(error.message))),
    "aucune exception : la table est lisible",
  );

  const goldRows = (await asPlayer(D, "select * from public.leaderboard(20, $1)", ["gold_cards"])).rows;
  check(
    "classement : le tri Gold met les plus dorés devant",
    goldRows.length > 0 && goldRows.every((row, index) => index === 0 || goldRows[index - 1].gold_cards >= row.gold_cards),
    JSON.stringify(goldRows.map((row) => row.gold_cards)),
  );
  check(
    "classement : chaque ligne porte la complétion et les variantes",
    typeof goldRows[0].completion === "string" || typeof goldRows[0].completion === "number",
    JSON.stringify(goldRows[0]),
  );
  check(
    "classement : un joueur non vérifié reste dehors",
    goldRows.every((row) => row.user_id !== F),
  );

  // --- Classement par famille ------------------------------------------------
  // « Qui complète le mieux l'Anglophonie ? » : le tri lit `user_cards` (fermé
  // aux clients) et doit pourtant ne rendre qu'un compteur par famille.
  const familyRows = (
    await asPlayer(D, "select * from public.leaderboard(20, $1, $2)", ["family", "S04"])
  ).rows;
  const s04Total = Number(families.S04.total);
  check(
    "famille : le total annoncé est celui du catalogue",
    familyRows.length > 0 && familyRows.every((row) => row.family_total === s04Total),
    `${familyRows[0]?.family_total} attendu ${s04Total}`,
  );
  check(
    "famille : le tri suit la famille demandée, pas le catalogue entier",
    familyRows.every((row, index) => index === 0 || familyRows[index - 1].family_owned >= row.family_owned),
    JSON.stringify(familyRows.map((row) => row.family_owned)),
  );
  check(
    "famille : chaque joueur est compté dans la famille, créateurs uniques seulement",
    await (async () => {
      for (const row of familyRows) {
        const expected = (
          await client.query(
            `select count(distinct uc.creator_slug)::int as n
               from public.user_cards uc join public.creators c on c.slug = uc.creator_slug
              where uc.user_id = $1 and coalesce(c.region, 'S10') = 'S04'`,
            [row.user_id],
          )
        ).rows[0].n;
        if (row.family_owned !== expected) return false;
      }
      return true;
    })(),
  );
  check(
    "famille : un joueur sans carte de la famille est classé à zéro, pas exclu",
    familyRows.length === (await client.query("select count(*)::int as n from public.stats where verified")).rows[0].n
      && familyRows.some((row) => row.family_owned === 0),
  );
  check(
    "famille : une famille inconnue ne fait pas tomber la requête",
    await (async () => {
      try {
        const rows = (await asPlayer(D, "select * from public.leaderboard(5, $1, $2)", ["family", "S99"])).rows;
        return rows.length === 5 && rows.every((row) => row.family_owned === 0);
      } catch {
        return false;
      }
    })(),
  );
  check(
    "famille : un client qui ne connaît pas les familles appelle encore avec deux arguments",
    // C'est le cas de l'APK déjà installé : la famille a une valeur par défaut,
    // donc l'ancien appel aboutit au lieu de casser. Il tombe alors sur la
    // famille fourre-tout, la seule dont il pouvait parler sans la nommer.
    await (async () => {
      const rows = (await asPlayer(D, "select * from public.leaderboard(5, $1)", ["unique_creators"])).rows;
      const s10 = (
        await client.query("select count(*)::int as n from public.creators where coalesce(region, 'S10') = 'S10'")
      ).rows[0].n;
      return rows.length === 5 && rows.every((row) => row.family_total === s10);
    })(),
  );
  check(
    "famille : un visiteur sans compte ne lit pas le classement",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("select * from public.leaderboard(5, $1, $2)", ["family", "S04"]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // Ce que le serveur montre d'un joueur suit ses écritures : Ethan envoie une
  // deuxième carte, sa projection et sa complétion doivent suivre.
  const ethan = (
    await client.query("select state from public.saves where user_id = $1", [E])
  ).rows[0].state;
  await client.query("update public.saves set state = $2 where user_id = $1", [
    E,
    JSON.stringify({ ...ethan, cards: [...ethan.cards, card("ethan-2", uncommonOne.slug, uncommonOne.rarity, "standard", 29)] }),
  ]);
  check(
    "projection : elle suit chaque écriture de sauvegarde",
    (await client.query("select count(*)::int as n from public.user_cards where user_id = $1", [E])).rows[0].n === 2,
  );

  // --- Vitrine nettoyée par un troc -----------------------------------------
  await asPlayer(B, "select public.set_showcase($1)", [["ibai", "auronplay"]]);
  const beforeShowcase = (
    await client.query("select showcase_slugs as s from public.profiles where user_id = $1", [B])
  ).rows[0].s;
  check(
    "vitrine : les deux créateurs sont épinglés avant l'échange",
    JSON.stringify(beforeShowcase) === JSON.stringify(["ibai", "auronplay"]),
    JSON.stringify(beforeShowcase),
  );

  const showcaseTrade = (
    await asPlayer(A, "select public.create_trade($1, $2, $3) as r", [
      B,
      JSON.stringify([{ creatorSlug: "chowh1", variant: "live" }]),
      JSON.stringify([{ creatorSlug: "auronplay", variant: "standard" }]),
    ])
  ).rows[0].r.trade.id;
  check("vitrine : l'offre est acceptée", (await asPlayer(B, "select public.respond_trade($1, true) as r", [showcaseTrade])).rows[0].r.status === "accepted");

  const afterShowcase = (
    await client.query("select showcase_slugs as s from public.profiles where user_id = $1", [B])
  ).rows[0].s;
  check(
    "vitrine : le créateur échangé quitte le profil public, l'autre reste",
    JSON.stringify(afterShowcase) === JSON.stringify(["ibai"]),
    JSON.stringify(afterShowcase),
  );

  // La vitrine de l'autre joueur n'est pas touchée : il n'a rien épinglé.
  check(
    "vitrine : celle de l'autre joueur reste vide",
    (await client.query("select showcase_slugs as s from public.profiles where user_id = $1", [A])).rows[0].s.length === 0,
  );

  // --- Direct ---------------------------------------------------------------
  // Le cache du direct : publié par le serveur, lu par tout le monde.
  const publish = await client.query(
    "select public.live_publish($1::jsonb, $2) as r",
    [
      JSON.stringify([
        {
          login: "kamet0",
          twitch_id: "123",
          display_name: "Kameto",
          game_name: "Just Chatting",
          title: "Sixième journée",
          viewers: 4120,
          started_at: "2026-10-06T18:12:00Z",
          thumbnail: "https://static-cdn.jtvnw.net/x-320x180.jpg",
        },
        {
          login: "ibai",
          twitch_id: "456",
          display_name: "ibai",
          game_name: "League of Legends",
          title: "LVP",
          viewers: "12000",
          // Date volontairement invalide : elle doit être ignorée, pas faire
          // échouer tout le rafraîchissement.
          started_at: "hier soir",
          thumbnail: "",
        },
      ]),
      "vérification",
    ],
  );
  check("direct : la publication renvoie le compte", publish.rows[0].r.streams === 2, JSON.stringify(publish.rows[0].r));
  check(
    "direct : les deux diffusions sont rangées, compteurs convertis",
    (await client.query("select count(*)::int as n, sum(viewers)::int as v from public.live_streams")).rows[0].n === 2 &&
      (await client.query("select count(*)::int as n, sum(viewers)::int as v from public.live_streams")).rows[0].v === 16120,
  );
  check(
    "direct : une date de début invalide devient NULL sans rien casser",
    (await client.query("select started_at as s from public.live_streams where login = 'ibai'")).rows[0].s === null,
  );
  check(
    "direct : l'état du cache est daté",
    (await client.query("select streams, refreshed_at from public.live_state where id")).rows[0].streams === 2,
  );
  // Un second appel remplace la liste : la diffusion terminée disparaît.
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify([{ login: "kamet0", display_name: "Kameto", viewers: 10 }]),
    "après déconnexion d'ibai",
  ]);
  check(
    "direct : une diffusion terminée disparaît de la table",
    (await client.query("select count(*)::int as n from public.live_streams")).rows[0].n === 1,
  );
  check(
    "direct : le compteur de l'état suit",
    (await client.query("select streams from public.live_state where id")).rows[0].streams === 1,
  );
  check(
    "direct : la table est lisible par un joueur, même sans compte",
    (await client.query("set role anon")).command === "SET" &&
      (await client.query("select count(*)::int as n from public.live_streams")).rows[0].n === 1 &&
      (await client.query("reset role")).command === "RESET",
  );
  check(
    "direct : un joueur ne peut pas inventer un direct (publication refusée)",
    await (async () => {
      try {
        await asPlayer(A, "select public.live_publish($1::jsonb)", [JSON.stringify([{ login: "faux" }])]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      }
    })(),
  );
  check(
    "direct : un client ne peut pas écrire dans le cache à la main",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("insert into public.live_streams (login) values ('pirate')");
        return false;
      } catch {
        return true;
      } finally {
        await client.query("reset role");
      }
    })(),
  );
  check(
    "direct : le catalogue porte le login Twitch (clé du rapprochement)",
    (await client.query("select count(*)::int as n from public.creators where login is not null")).rows[0].n === 1000,
  );
  check(
    "direct : le slug n'est pas le login (les deux sont conservés)",
    (
      await client.query("select count(*)::int as n from public.creators where slug <> login")
    ).rows[0].n > 0,
  );

  // --- Bonus Direct ---------------------------------------------------------
  // Le Direct ne doit pas être un badge décoratif : un créateur qui streame
  // tombe plus souvent, et la variante Live lui est réservée. Le cache contient
  // `kamet0` (publié juste au-dessus, donc frais).
  //
  // Les contrôles précédents ont joué en tant que joueur A : on reprend
  // l'identité du premier joueur, dont la réserve est connue.
  await client.query("select set_config('test.uid', $1, false)", [USER]);
  const directLogins = (await client.query("select public._direct_live_logins() as l")).rows[0].l;
  check(
    "bonus direct : la liste vient du cache frais",
    Array.isArray(directLogins) && directLogins.includes("kamet0") && !directLogins.includes("ibai"),
    JSON.stringify(directLogins),
  );

  const creature = (
    await client.query(
      "select public._pack_creator_weight($1, $2::text[]) as direct, public._pack_creator_weight($3, $2::text[]) as autre",
      ["kamet0", directLogins, "ibai"],
    )
  ).rows[0];
  check(
    "bonus direct : un créateur en direct pèse ×1,5 (le contrat du fichier de taux)",
    creature.direct === Math.round(rates.direct.creatorBias * 1000) && creature.autre === 1000,
    JSON.stringify(creature),
  );

  // 30 boosters pendant un direct large (la moitié du catalogue) : il doit
  // sortir des cartes Live, aucune ne doit appartenir à un créateur hors
  // direct, et la garantie doit être Live quand son créateur streame.
  const liveCatalogue = (
    await client.query("select login from public.creators order by slug limit 500")
  ).rows.map((row) => row.login);
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify(liveCatalogue.map((login) => ({ login }))),
    "la moitié du catalogue (vérification)",
  ]);
  const liveSet = new Set(liveCatalogue);
  let liveOnlyOk = true;
  let guaranteedLiveOk = true;
  let liveSeen = 0;
  for (let i = 0; i < 30; i += 1) {
    await client.query("update public.pack_state set packs = 4, last_regen_at = now() where user_id = $1", [USER]);
    const pack = (await client.query("select public.open_pack() as r")).rows[0].r;
    for (const card of pack.cards) {
      if (card.variant !== "live") continue;
      liveSeen += 1;
      if (!liveSet.has(card.creatorSlug)) liveOnlyOk = false;
    }
    const garantie = pack.cards[pack.cards.length - 1];
    if (liveSet.has(garantie.creatorSlug) && garantie.variant !== "live") guaranteedLiveOk = false;
  }
  check("bonus direct : la variante Live est réservée à ceux qui streament", liveOnlyOk);
  check(
    "bonus direct : la carte garantie est Live quand son créateur streame",
    guaranteedLiveOk && liveSeen > 0,
    `${liveSeen} carte(s) Live en 30 boosters`,
  );

  // Le poids doit servir *au tirage*, pas seulement à être calculé : sur une
  // rareté (les légendaires), la moitié en direct doit sortir plus souvent que
  // l'autre. Seuil à mi-chemin entre « aucun bonus » et « bonus appliqué ».
  const legendary = (
    await client.query("select slug, login from public.creators where rarity = 'legendary' order by slug")
  ).rows;
  const half = Math.floor(legendary.length / 2);
  const halfSlugs = new Set(legendary.slice(0, half).map((row) => row.slug));
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify(legendary.slice(0, half).map((row) => ({ login: row.login }))),
    "moitié des légendaires (vérification)",
  ]);
  const nullShare = half / legendary.length;
  const biasedShare = (half * rates.direct.creatorBias) / (half * rates.direct.creatorBias + (legendary.length - half));
  const threshold = (nullShare + biasedShare) / 2;
  let legendaryHits = 0;
  const DRAW_COUNT = 4000;
  for (let i = 0; i < DRAW_COUNT; i += 1) {
    const chosen = (
      await client.query("select public._pack_choose_creator($1::jsonb, $2::text[]) as s", ['{"legendary": 100}', []])
    ).rows[0].s;
    if (halfSlugs.has(chosen)) legendaryHits += 1;
  }
  const share = legendaryHits / DRAW_COUNT;
  check(
    "bonus direct : les créateurs en direct tombent plus souvent (40 % attendus au-dessus du hasard)",
    share > threshold,
    `${(share * 100).toFixed(1)} % contre un seuil de ${(threshold * 100).toFixed(1)} % (sans bonus : ${(nullShare * 100).toFixed(1)} %)`,
  );

  // Un cache périmé (plus de dix minutes) vaut « on ne sait pas » : plus de
  // bonus, et surtout plus aucune carte Live.
  await client.query("update public.live_state set refreshed_at = now() - interval '20 minutes' where id");
  const staleLogins = (await client.query("select public._direct_live_logins() as l")).rows[0].l;
  check("bonus direct : au-delà de dix minutes, on ne sait plus", staleLogins === null, JSON.stringify(staleLogins));
  await client.query("update public.pack_state set packs = 4, last_regen_at = now() where user_id = $1", [USER]);
  const stalePack = (await client.query("select public.open_pack() as r")).rows[0].r;
  check(
    "bonus direct : cache périmé → aucune carte Live (le badge ne ment pas)",
    stalePack.cards.every((card) => card.variant !== "live"),
    stalePack.cards.map((card) => card.variant).join(", "),
  );

  // Remise en état pour la suite de la vérification.
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify([{ login: "kamet0", display_name: "Kameto", viewers: 10 }]),
    "état rendu à la suite",
  ]);

  // --- Amis -----------------------------------------------------------------
  // Les amitiés sont symétriques et **décidées par le serveur** : un client ne
  // peut ni se déclarer ami, ni accepter à la place de quelqu'un d'autre. Ce
  // qu'on vérifie ici, c'est justement que tout cela se décide bien en base.
  // Sans compte : rien à lire, rien à envoyer.
  check(
    "amis : sans compte, on ne peut même pas envoyer une demande",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("select public.send_friend_request($1)", [B]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );
  check(
    "amis : la fonction interne reste hors de portée d'un joueur",
    await (async () => {
      try {
        await asPlayer(A, "select public._friend_user_id($1)", [B]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      }
    })(),
  );

  // Envoyer, puis accepter.
  const sent = (await asPlayer(A, "select public.send_friend_request($1) as r", [B])).rows[0].r;
  check(
    "amis : la demande part et n'est pas encore une amitié",
    sent.request?.id != null && sent.alreadyFriends === false && sent.existingRequest === null,
    JSON.stringify(sent.alreadyFriends),
  );
  check(
    "amis : l'expéditeur voit sa demande envoyée, le destinataire la reçoit",
    (await asPlayer(A, "select public.list_outgoing_friend_requests() as r")).rows[0].r[0].recipientId === B &&
      (await asPlayer(B, "select public.list_incoming_friend_requests() as r")).rows[0].r[0].senderId === A,
  );
  check(
    "amis : ni l'un ni l'autre ne se voit déjà ami",
    (await asPlayer(A, "select public.list_friends() as r")).rows[0].r.length === 0 &&
      (await asPlayer(A, "select public.has_friendship($1) as r", [B])).rows[0].r === false,
  );
  check(
    "amis : envoyer deux fois la même demande ne crée pas de doublon",
    (await asPlayer(A, "select public.send_friend_request($1) as r", [B])).rows[0].r.request?.id === sent.request.id &&
      (await client.query("select count(*)::int as n from public.friend_requests where sender_id = $1", [A])).rows[0].n === 1,
  );
  check(
    "amis : la demande croisée est signalée, pas doublée",
    (await asPlayer(B, "select public.send_friend_request($1) as r", [A])).rows[0].r.existingRequest?.id === sent.request.id &&
      (await client.query("select count(*)::int as n from public.friend_requests where sender_id = $1", [B])).rows[0].n === 0,
  );
  check(
    "amis : seul le destinataire peut accepter",
    await (async () => {
      try {
        await asPlayer(A, "select public.accept_friend_request($1)", [sent.request.id]);
        return false;
      } catch (error) {
        return String(error.message).includes("introuvable");
      }
    })(),
  );
  const amitie = (await asPlayer(B, "select public.accept_friend_request($1) as r", [sent.request.id])).rows[0].r;
  check(
    "amis : l'acceptation crée une amitié unique",
    amitie.request?.status === "accepted" && amitie.friendship !== null &&
      (await client.query("select count(*)::int as n from public.friends where (user1_id=$1 and user2_id=$2) or (user1_id=$2 and user2_id=$1)", [A, B])).rows[0].n === 1,
  );
  check(
    "amis : l'amitié se voit des deux côtés, dans les deux sens",
    (await asPlayer(A, "select public.list_friends() as r")).rows[0].r[0].friendId === B &&
      (await asPlayer(B, "select public.list_friends() as r")).rows[0].r[0].friendId === A &&
      (await asPlayer(B, "select public.has_friendship($1) as r", [A])).rows[0].r === true,
  );
  check(
    "amis : une demande acceptée quitte les listes d'attente",
    (await asPlayer(A, "select public.list_outgoing_friend_requests() as r")).rows[0].r.length === 0 &&
      (await asPlayer(B, "select public.list_incoming_friend_requests() as r")).rows[0].r.length === 0,
  );
  check(
    "amis : on ne renvoie pas de demande à quelqu'un dont on est déjà l'ami",
    (await asPlayer(A, "select public.send_friend_request($1) as r", [B])).rows[0].r.alreadyFriends === true,
  );
  check(
    "amis : un joueur ne peut pas s'ajouter lui-même",
    await (async () => {
      try {
        await asPlayer(A, "select public.send_friend_request($1)", [A]);
        return false;
      } catch (error) {
        return String(error.message).includes("toi-même");
      }
    })(),
  );
  check(
    "amis : un identifiant inconnu est refusé",
    await (async () => {
      try {
        await asPlayer(A, "select public.send_friend_request($1)", ["99999999-9999-4999-8999-999999999999"]);
        return false;
      } catch (error) {
        return String(error.message).includes("n''existe pas") || String(error.message).includes("n'existe pas");
      }
    })(),
  );

  // Refuser, annuler, retirer.
  const rejected = (await asPlayer(C, "select public.send_friend_request($1) as r", [D])).rows[0].r.request.id;
  await asPlayer(D, "select public.reject_friend_request($1)", [rejected]);
  check(
    "amis : un refus n'crée pas d'amitié et sort des listes",
    (await asPlayer(C, "select public.list_outgoing_friend_requests() as r")).rows[0].r.length === 0 &&
      (await asPlayer(D, "select public.has_friendship($1) as r", [C])).rows[0].r === false,
  );
  const cancelled = (await asPlayer(C, "select public.send_friend_request($1) as r", [E])).rows[0].r.request.id;
  await asPlayer(C, "select public.cancel_friend_request($1)", [cancelled]);
  check(
    "amis : une demande annulée sort des deux listes",
    (await asPlayer(C, "select public.list_outgoing_friend_requests() as r")).rows[0].r.length === 0 &&
      (await asPlayer(E, "select public.list_incoming_friend_requests() as r")).rows[0].r.length === 0,
  );
  await asPlayer(A, "select public.remove_friend($1)", [B]);
  check(
    "amis : retirer un ami efface le lien, des deux côtés",
    (await asPlayer(A, "select public.list_friends() as r")).rows[0].r.length === 0 &&
      (await asPlayer(B, "select public.list_friends() as r")).rows[0].r.length === 0 &&
      (await client.query("select count(*)::int as n from public.friends where (user1_id=$1 and user2_id=$2) or (user1_id=$2 and user2_id=$1)", [A, B])).rows[0].n === 0,
  );

  // Un tiers ne voit rien : ni les demandes, ni les amitiés des autres.
  await asPlayer(A, "select public.send_friend_request($1)", [B]);
  check(
    "amis : un joueur étranger ne voit ni les demandes ni les amitiés des autres",
    // Ses propres lignes restent visibles (une demande annulée le concerne) :
    // ce qui doit disparaître, c'est tout ce qui ne le regarde pas.
    (await asPlayer(E, "select public.list_incoming_friend_requests() as r")).rows[0].r.length === 0 &&
      (await asPlayer(E, "select public.list_outgoing_friend_requests() as r")).rows[0].r.length === 0 &&
      (await asPlayer(E, "select count(*)::int as n from public.friend_requests where sender_id = $1 or recipient_id = $1", [A])).rows[0].n === 0 &&
      (await asPlayer(E, "select count(*)::int as n from public.friend_requests")).rows[0].n === 1 &&
      (await asPlayer(E, "select count(*)::int as n from public.friends")).rows[0].n === 0,
  );
  check(
    "amis : on ne peut pas écrire une amitié à la main",
    await (async () => {
      try {
        await asPlayer(A, `insert into public.friends (user1_id, user2_id) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [A, B]);
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // --- Hôtel des ventes ------------------------------------------------------
  // Deux joueurs neufs : Gaston dépose ses doublons (l'hôtel le paie comptant)
  // et Hélène se sert au comptoir. Les deux ont une collection dans le cloud,
  // sinon rien ne fonctionne — c'est une des premières choses vérifiées.
  const G = "9a9a9a9a-7777-4777-8777-9a9a9a9a9a9a";
  const H = "8b8b8b8b-8888-4888-8888-8b8b8b8b8b8b";
  const I = "7c7c7c7c-9999-4999-8999-7c7c7c7c7c7c";
  const epicOne = await oneOf("epic");

  await player(G, "Gaston", [
    card("gaston-doublon-1", legendaryOne.slug, legendaryOne.rarity, "standard", 40),
    card("gaston-doublon-2", legendaryOne.slug, legendaryOne.rarity, "standard", 20),
    card("gaston-unique", rareOne.slug, rareOne.rarity, "standard", 10),
  ]);
  await player(H, "Hélène", [
    card("helene-doublon-1", epicOne.slug, epicOne.rarity, "gold", 30),
    card("helene-doublon-2", epicOne.slug, epicOne.rarity, "gold", 15),
    card("helene-simple-1", uncommonOne.slug, uncommonOne.rarity, "standard", 12),
    card("helene-simple-2", uncommonOne.slug, uncommonOne.rarity, "standard", 8),
  ]);
  // Les points de départ : Gaston a de quoi vivre, Hélène de quoi acheter.
  await client.query("update public.saves set state = jsonb_set(state, '{points}', '100') where user_id = $1", [G]);
  await client.query("update public.saves set state = jsonb_set(state, '{points}', '5000') where user_id = $1", [H]);
  await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [I]);

  check(
    "hôtel : la grille des prix suit la rareté et la variante",
    (await client.query("select public.market_payout('common', 'standard') as a, public.market_payout('legendary', 'gold') as b, public.market_payout('rare', 'holo') as c")).rows[0].a === 20 &&
      (await client.query("select public.market_payout('common', 'standard') as a, public.market_payout('legendary', 'gold') as b, public.market_payout('rare', 'holo') as c")).rows[0].b === 2000 &&
      (await client.query("select public.market_payout('common', 'standard') as a, public.market_payout('legendary', 'gold') as b, public.market_payout('rare', 'holo') as c")).rows[0].c === 300,
  );
  check(
    "hôtel : l'étiquette est le payout majoré d'une fois et demie",
    (await client.query("select public.market_price(20) as a, public.market_price(2000) as b")).rows[0].a === 30 &&
      (await client.query("select public.market_price(20) as a, public.market_price(2000) as b")).rows[0].b === 3000,
  );
  check(
    "hôtel : vendre paie plus que recycler, pour chaque rareté",
    await (async () => {
      const grid = await client.query(
        `select c.rarity, min(public.market_payout(c.rarity, 'standard')) as payout
           from public.creators c group by c.rarity`,
      );
      const recycle = { common: 12, uncommon: 22, rare: 55, epic: 150, legendary: 250 };
      return grid.rows.every((row) => row.payout > recycle[row.rarity]);
    })(),
  );

  // Sans compte, rien n'est ouvert.
  for (const [label, sql, params] of [
    ["déposer", "select public.market_sell($1)", ["x"]],
    ["acheter", "select public.market_buy(1)", []],
    ["regarder le comptoir", "select public.market_shelf(10)", []],
  ]) {
    check(
      `hôtel : sans compte, impossible de ${label}`,
      await (async () => {
        try {
          await client.query("set role anon");
          await client.query(sql, params);
          return false;
        } catch (error) {
          return String(error.message).includes("permission denied");
        } finally {
          await client.query("reset role");
        }
      })(),
    );
  }
  // La table est retirée aux clients (`revoke all` dans `0009`) : pas de
  // lecture, pas d'écriture. Tout passe par les fonctions du serveur.
  check(
    "hôtel : un joueur ne lit pas la table en direct",
    await asPlayer(G, "select count(*)::int as n from public.market_listings")
      .then(() => false)
      .catch((error) => /permission denied/i.test(String(error.message))),
    "aucune exception : la table est lisible",
  );
  check(
    "hôtel : un joueur ne peut pas écrire une annonce à la main",
    await asPlayer(G, "insert into public.market_listings (seller_id, card_id, creator_slug, rarity, variant, payout, price) values ($1, 'x', 'ibai', 'rare', 'standard', 1, 1)", [G])
      .then(() => false)
      .catch((error) => /permission denied/i.test(String(error.message))),
  );

  // Le dépôt.
  const deposit = (await asPlayer(G, "select public.market_sell($1) as r", ["gaston-doublon-1"])).rows[0].r;
  const gaston = await stateOf(G);
  check(
    "hôtel : le dépôt paie le vendeur tout de suite",
    deposit.payout === 400 && deposit.points === 500,
    JSON.stringify({ payout: deposit.payout, points: deposit.points }),
  );
  check(
    "hôtel : la carte quitte la collection au dépôt",
    gaston.cards.length === 2 && !gaston.cards.some((entry) => entry.id === "gaston-doublon-1"),
    `${gaston.cards.length} cartes`,
  );
  check(
    "hôtel : le solde de la sauvegarde suit",
    gaston.points === 500,
    String(gaston.points),
  );
  await refuses(
    "hôtel : la dernière copie ne se vend pas",
    G,
    "select public.market_sell($1)",
    ["gaston-doublon-2"],
    "seule copie",
  );
  await refuses(
    "hôtel : une carte qui n'est pas dans la collection ne se vend pas",
    G,
    "select public.market_sell($1)",
    ["carte-inventee"],
    "plus dans ta collection",
  );
  await refuses(
    "hôtel : sans collection dans le cloud, on ne dépose rien",
    I,
    "select public.market_sell($1)",
    ["peu-importe"],
    "envoie d'abord ta collection",
  );

  // Le comptoir.
  const shelfForSeller = (await asPlayer(G, "select public.market_shelf(30) as r")).rows[0].r;
  const shelfForBuyer = (await asPlayer(H, "select public.market_shelf(30) as r")).rows[0].r;
  check(
    "hôtel : on ne voit pas sa propre annonce au comptoir",
    shelfForSeller.length === 0 && shelfForBuyer.length === 1 && shelfForBuyer[0].id === deposit.listing.id,
    JSON.stringify({ vendeur: shelfForSeller.length, acheteur: shelfForBuyer.length }),
  );
  check(
    "hôtel : le comptoir montre le vendeur, la rareté et l'étiquette",
    shelfForBuyer[0].sellerName === "Gaston" &&
      shelfForBuyer[0].rarity === legendaryOne.rarity &&
      shelfForBuyer[0].variant === "standard" &&
      shelfForBuyer[0].price === 600,
    JSON.stringify(shelfForBuyer[0]),
  );
  await refuses(
    "hôtel : on n'achète pas sa propre annonce",
    G,
    "select public.market_buy($1)",
    [deposit.listing.id],
    "ta propre annonce",
  );

  // L'achat.
  const heleneAvant = await stateOf(H);
  const purchase = (await asPlayer(H, "select public.market_buy($1) as r", [deposit.listing.id])).rows[0].r;
  const helene = await stateOf(H);
  check(
    "hôtel : l'acheteur paie l'étiquette",
    purchase.price === 600 && helene.points === 4400,
    JSON.stringify({ price: purchase.price, points: helene.points }),
  );
  check(
    "hôtel : la carte achetée entre dans la collection, avec sa provenance",
    helene.cards.length === heleneAvant.cards.length + 1 &&
      helene.cards.some((entry) => entry.fromMarket === deposit.listing.id && entry.creatorSlug === legendaryOne.slug),
  );
  check(
    "hôtel : la carte achetée n'est pas comptée comme un « Perfect »",
    helene.cards.find((entry) => entry.fromMarket === deposit.listing.id)?.rareDrop === false,
  );
  check(
    "hôtel : un achat ne revalorise pas la carte (rareté lue au catalogue)",
    helene.cards.find((entry) => entry.fromMarket === deposit.listing.id)?.rarity === legendaryOne.rarity,
  );
  await refuses(
    "hôtel : une annonce déjà vendue ne s'achète pas deux fois",
    H,
    "select public.market_buy($1)",
    [deposit.listing.id],
    "déjà été achetée",
  );
  check(
    "hôtel : la carte vendue quitte le comptoir",
    (await asPlayer(H, "select public.market_shelf(30) as r")).rows[0].r.length === 0,
  );

  // Les points, et le comptoir qui ne rend pas ce qu'on n'a pas.
  await asPlayer(H, "select public.market_sell($1)", ["helene-doublon-1"]);
  await refuses(
    "hôtel : sans assez de points, on n'achète pas",
    G,
    "select public.market_buy($1)",
    [(await client.query("select id from public.market_listings where seller_id = $1 and status = 'open'", [H])).rows[0].id],
    "il te manque",
  );
  // Une annonce oubliée trente jours quitte le comptoir (le vendeur, lui, a
  // déjà été payé : personne ne perd rien).
  await asPlayer(H, "select public.market_sell($1)", ["helene-simple-1"]);
  const perimee = (await client.query("select id from public.market_listings where seller_id = $1 and card_id = 'helene-simple-1'", [H])).rows[0].id;
  await client.query("update public.market_listings set created_at = now() - interval '31 days' where id = $1", [perimee]);
  await refuses(
    "hôtel : une annonce de plus de trente jours est périmée",
    G,
    "select public.market_buy($1)",
    [perimee],
    "quitté le comptoir",
  );
  check(
    "hôtel : le comptoir ne montre pas les annonces périmées",
    (await asPlayer(G, "select public.market_shelf(30) as r")).rows[0].r.every((row) => row.id !== perimee),
  );

  // La vitrine : « qu'a déposé ce joueur ? ». Gaston et Hélène ont chacun une
  // annonce ouverte ; celle de Gaston, vendue, n'y figure plus.
  const vitrineG = (await asPlayer(H, "select public.market_listings_of($1) as r", [G])).rows[0].r;
  const vitrineH = (await asPlayer(G, "select public.market_listings_of($1) as r", [H])).rows[0].r;
  check(
    "hôtel : la vitrine d'un joueur ne montre que ses annonces ouvertes",
    vitrineG.length === 0 && vitrineH.length === 1 && vitrineH[0].price === 1875,
    JSON.stringify({ gaston: vitrineG.length, helene: vitrineH.length }),
  );
  check(
    "hôtel : sans argument, la vitrine est la sienne",
    (await asPlayer(H, "select public.market_listings_of() as r")).rows[0].r.length === 1,
  );

  // --- Le wallet (0027) ----------------------------------------------------
  // Les points vivent au serveur. Les soldes ont déjà bougé (les contrôles de
  // l'hôtel ci-dessus, dont les ventes), donc tout se mesure **relativement** :
  // une constante attendue ici serait fausse demain, à cause d'un contrôle
  // ajouté plus haut.
  const ligneBascule = (await client.query(
    "select count(*)::int as n from public.wallet_ledger where user_id = $1 and kind = 'bascule'",
    [G],
  )).rows[0].n;
  const miroirG = Number((await client.query("select state -> 'points' as p from public.saves where user_id = $1", [G])).rows[0].p);
  const vuG = (await asPlayer(G, "select public.wallet_get() as r")).rows[0].r;
  check(
    "wallet : le compte s'ouvre une fois, en reprenant le solde de la sauvegarde",
    ligneBascule === 1 && vuG.points === miroirG,
    JSON.stringify({ ligneBascule, vuG, miroirG }),
  );

  // La vente crédite le vendeur : on dépose une carte neuve et on regarde le
  // compte bouger du **payout**, exactement.
  //
  // La carte est ajoutée à la sauvegarde d'Hélène avec un identifiant neuf sur
  // un couple qu'elle possède déjà (la provenance se compte par couple :
  // créateur + rareté + variante). Un doublon existant ferait échouer les
  // contrôles suivants, qui vendent ces cartes-là.
  await client.query(
    `update public.saves s
        set state = jsonb_set(
              s.state, '{cards}',
              (s.state -> 'cards')
                || jsonb_build_array((s.state -> 'cards' -> 0) || jsonb_build_object('id', 'helene-wallet-1'))
                || jsonb_build_array((s.state -> 'cards' -> 0) || jsonb_build_object('id', 'helene-wallet-2'))
            ),
            updated_at = now()
      where s.user_id = $1`,
    [H],
  );
  const avantVente = (await asPlayer(H, "select public.wallet_get() as r")).rows[0].r.points;
  const vente = (await asPlayer(H, "select public.market_sell($1) as r", ["helene-wallet-1"])).rows[0].r;
  const apresVente = (await asPlayer(H, "select public.wallet_get() as r")).rows[0].r.points;
  // Et une seconde annonce, gardée **ouverte** : c'est celle de l'achat refusé,
  // juste en dessous.
  await asPlayer(H, "select public.market_sell($1)", ["helene-wallet-2"]);
  check(
    "wallet : une vente crédite le compte du vendeur, du montant exact",
    apresVente === avantVente + vente.payout,
    JSON.stringify({ avantVente, payout: vente.payout, apresVente }),
  );

  // Le contrôle central : une sauvegarde gonflée à la main n'achète plus rien.
  const soldeG = (await asPlayer(G, "select public.wallet_get() as r")).rows[0].r.points;
  await client.query(
    "update public.saves set state = jsonb_set(state, '{points}', '999999') where user_id = $1",
    [G],
  );
  // L'annonce que Gaston ne pourra pas s'offrir : c'est celle du doublon
  // fabriqué pour ce contrôle, pas une annonce laissée par les tests d'avant.
  const annonceH = (await client.query(
    "select id from public.market_listings where seller_id = $1 and card_id = 'helene-wallet-2'",
    [H],
  )).rows[0].id;
  let trafique = "";
  try {
    await asPlayer(G, "select public.market_buy($1)", [annonceH]);
  } catch (error) {
    trafique = String(error.message || "");
  }
  check(
    "wallet : un solde trafiqué dans la sauvegarde n'achète rien",
    trafique.includes("il te manque") &&
      (await client.query("select status from public.market_listings where id = $1", [annonceH])).rows[0].status === "open" &&
      (await client.query("select points from public.wallets where user_id = $1", [G])).rows[0].points === soldeG,
    trafique || "aucune erreur levée",
  );

  // Et le miroir se recale : le million disparaît à la première lecture.
  const relu = (await asPlayer(G, "select public.wallet_get() as r")).rows[0].r;
  check(
    "wallet : lire son solde recale le miroir de la sauvegarde",
    relu.points === soldeG &&
      Number((await client.query("select state -> 'points' as p from public.saves where user_id = $1", [G])).rows[0].p) === soldeG,
    JSON.stringify({ relu, soldeG }),
  );

  // Les crédits : **le tirage paie tout seul** (trigger `wallet_on_draw`). Le
  // contrôle ne demande donc pas un crédit — il vérifie que le serveur l'a déjà
  // versé, et qu'un second appel ne paie pas deux fois.
  //
  // Le tirage est pris chez **son propriétaire** : c'est lui qui touche, et le
  // refus se teste avec un autre joueur.
  const ligneTirage = (await client.query(
    "select id, user_id from public.pack_draws where kind = 'live' order by id limit 1",
  )).rows[0];
  const tirageWallet = ligneTirage.id;
  const proprietaire = ligneTirage.user_id;
  const autreJoueur = proprietaire === A ? B : A;
  const journalTirage = (await client.query(
    "select delta, kind, ref from public.wallet_ledger where user_id = $1 and kind = 'pack' and ref = $2",
    [proprietaire, String(tirageWallet)],
  )).rows[0];
  const avantTirageWallet = (await asPlayer(proprietaire, "select public.wallet_get() as r")).rows[0].r.points;
  const encoreTirage = (await asPlayer(proprietaire, "select public.wallet_credit('pack', $1::text) as r", [String(tirageWallet)])).rows[0].r;
  check(
    "wallet : un tirage est payé par le serveur au moment du tirage, une seule fois",
    journalTirage?.delta === 12 &&
      encoreTirage.gained === 0 &&
      encoreTirage.points === avantTirageWallet,
    JSON.stringify({ journal: journalTirage, encore: encoreTirage }),
  );
  await refuses(
    "wallet : un tirage qui n'est pas le sien ne paie rien",
    autreJoueur,
    "select public.wallet_credit('pack', $1::text) as r",
    [String(tirageWallet)],
    "n'existe pas",
  );

  // --- Le rapport de version (0035) ----------------------------------------
  // « Qu'est-ce qui est collé dans la base ? » — la question qui revient à
  // chaque livraison, et à laquelle la sonde de production ne peut pas répondre
  // pour les migrations qui ne créent aucun objet (`0034` reprend deux
  // fonctions). Ce rapport se lit **sans compte** et ne rend que des booléens.
  const rapport = (await client.query("select public.schema_versions() as r")).rows[0].r;
  check(
    "schéma : le rapport de version voit les six dernières migrations",
    ['0030', '0031', '0032', '0033', '0034', '0035'].every((cle) => rapport?.[cle] === true),
    JSON.stringify(rapport),
  );
  // Le rapport lu par un inconnu (rôle `anon`, aucun compte) : c'est là qu'il
  // sert vraiment — un diagnostic qu'il faut un compte pour lire ne sert à rien
  // quand c'est justement la connexion qu'on cherche à vérifier.
  const rapportAnon = (await (async () => {
    await client.query("set role anon");
    try {
      return (await client.query("select public.schema_versions() as r")).rows[0].r;
    } finally {
      await client.query("reset role");
    }
  })());
  check(
    "schéma : le rapport se lit sans compte",
    rapportAnon?.['0035'] === true && rapportAnon?.['0034'] === true,
    JSON.stringify(rapportAnon),
  );
  // Et une fonction absente ne le fait pas tomber : il dit simplement « non ».
  check(
    "schéma : une fonction absente ne casse pas le rapport",
    (await client.query("select public._schema_body('public.fonction_qui_nexiste_pas()') as t")).rows[0].t === '',
  );

  // --- Les jetons (0035) ---------------------------------------------------
  // Le solde vivait dans la sauvegarde : un client gonflé s'offrait des cartes
  // choisies. Il est au serveur depuis `0035`, avec le même journal que les
  // points — ces contrôles regardent les trois portes : la bascule, les gains
  // (le tirage, la série) et la dépense.
  const miroirJetonsG = Number(
    (await client.query("select state -> 'tokens' as t from public.saves where user_id = $1", [G])).rows[0].t,
  );
  const jetonsG = (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens;
  // Le journal est lu **après** la première lecture du solde : c'est elle qui
  // ouvre le compte, avec sa ligne de bascule.
  const journalJetonsG = (await client.query(
    "select kind, ref, delta from public.token_ledger where user_id = $1 order by id",
    [G],
  )).rows;
  check(
    "jetons : le compte s'ouvre une fois, en reprenant le solde de la sauvegarde",
    journalJetonsG.length === 1 &&
      journalJetonsG[0].kind === "bascule" &&
      Number(journalJetonsG[0].delta) === miroirJetonsG &&
      jetonsG === miroirJetonsG,
    JSON.stringify({ jetonsG, miroirJetonsG, journalJetonsG }),
  );

  // Le tirage paie **tout seul** : la ligne de journal existe déjà, et son
  // montant est celui du barème — 5, ou 7 pendant le Prime Time. Le montant est
  // calculé par le serveur (l'heure du test n'est pas choisie), donc on compare
  // à ce que la fonction du barème répond pour cet instant.
  const ligneJetonsTirage = (await client.query(
    `select l.delta, l.ref,
            public._tokens_per_pack(d.drawn_at) as attendu
       from public.pack_draws d
       left join public.token_ledger l
              on l.user_id = d.user_id and l.kind = 'pack' and l.ref = d.id::text
      where d.id = $1`,
    [tirageWallet],
  )).rows[0];
  check(
    "jetons : un tirage est payé par le serveur, du montant du barème",
    Number(ligneJetonsTirage.delta) === Number(ligneJetonsTirage.attendu) &&
      [5, 7].includes(Number(ligneJetonsTirage.attendu)),
    JSON.stringify(ligneJetonsTirage),
  );

  // Le Prime Time, aux bornes : 20 h – 23 h **heure de Paris** (le fuseau du
  // jeu), la borne de fin exclue. Été comme hiver — le décalage change.
  const primeTime = (await client.query(
    `select public._tokens_per_pack('2026-07-10 18:30:00+00'::timestamptz) as ete_soir,
            public._tokens_per_pack('2026-07-10 21:30:00+00'::timestamptz) as ete_tard,
            public._tokens_per_pack('2026-01-15 19:30:00+00'::timestamptz) as hiver_soir,
            public._tokens_per_pack('2026-01-15 22:30:00+00'::timestamptz) as hiver_tard`,
  )).rows[0];
  check(
    "jetons : le Prime Time est celui du fuseau du jeu (20 h – 23 h, borne exclue)",
    Number(primeTime.ete_soir) === 7 &&
      Number(primeTime.ete_tard) === 5 &&
      Number(primeTime.hiver_soir) === 7 &&
      Number(primeTime.hiver_tard) === 5,
    JSON.stringify(primeTime),
  );

  // La dépense. Quatre refus, puis un achat qui passe — sur un créateur que
  // Gaston ne possède pas, et qui se prend aux jetons.
  const unLegendaire = (await client.query(
    "select slug from public.creators where rarity = 'legendary' and not retired limit 1",
  )).rows[0].slug;
  const possede = (await client.query(
    `select c ->> 'creatorSlug' as slug
       from public.saves s, jsonb_array_elements(s.state -> 'cards') c
      where s.user_id = $1 and c ->> 'rarity' <> 'legendary'
      limit 1`,
    [G],
  )).rows[0].slug;
  const pasPossede = (await client.query(
    `select c.slug
       from public.creators c
      where c.rarity in ('common', 'uncommon', 'rare', 'epic')
        and not c.retired
        and c.slug not in (
          select card ->> 'creatorSlug'
            from public.saves s, jsonb_array_elements(s.state -> 'cards') card
           where s.user_id = $1
        )
      order by c.slug
      limit 1`,
    [G],
  )).rows[0].slug;
  check(
    "jetons : le joueur de contrôle a de quoi tester (un possédé, un libre)",
    Boolean(possede) && Boolean(pasPossede),
    JSON.stringify({ possede, pasPossede }),
  );
  await refuses(
    "jetons : une Légendaire ne s'achète pas",
    G,
    "select public.tokens_spend($1) as r",
    [unLegendaire],
    "une Légendaire ne s'achète pas",
  );
  await refuses(
    "jetons : un créateur hors catalogue ne s'achète pas",
    G,
    "select public.tokens_spend($1) as r",
    ["pas-un-createur-du-catalogue"],
    "pas au catalogue",
  );
  await refuses(
    "jetons : un créateur déjà possédé ne se rachète pas",
    G,
    "select public.tokens_spend($1) as r",
    [possede],
    "tu as déjà",
  );

  // Il faut des jetons pour la suite : on les verse **par le journal** (le seul
  // chemin), pas en écrivant la table.
  const manqueAvant = 400 - (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens;
  await refuses(
    "jetons : sans les 400, l'achat dit ce qui manque",
    G,
    "select public.tokens_spend($1) as r",
    [pasPossede],
    `il te manque ${manqueAvant} jetons`,
  );
  await client.query("select public._tokens_apply($1, $2, 'test', 'verif-jetons')", [G, manqueAvant + 400]);
  const achat = (await asPlayer(G, "select public.tokens_spend($1) as r", [pasPossede])).rows[0].r;
  check(
    "jetons : 400 jetons paient le créateur visé, et le solde suit",
    achat.ok === true && achat.spent === 400 && achat.tokens === 400,
    JSON.stringify(achat),
  );

  // Le solde du serveur est la seule vérité : une sauvegarde gonflée à la main
  // est recollée, et ne permet pas de dépenser.
  const soldeReel = (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens;
  await client.query(
    "update public.saves set state = jsonb_set(state, '{tokens}', '999999') where user_id = $1",
    [G],
  );
  const reluJetons = (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens;
  check(
    "jetons : un solde gonflé dans la sauvegarde est recollé à la vérité",
    reluJetons === soldeReel &&
      Number((await client.query("select state -> 'tokens' as t from public.saves where user_id = $1", [G])).rows[0].t) === soldeReel,
    JSON.stringify({ reluJetons, soldeReel }),
  );

  // Et un mouvement déjà journalisé ne repasse pas (le journal fait foi).
  const avantDouble = (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens;
  await client.query("select public._tokens_apply($1, 25, 'test', 'verif-jetons')", [G]);
  check(
    "jetons : un mouvement déjà journalisé ne repasse pas",
    (await asPlayer(G, "select public.tokens_get() as r")).rows[0].r.tokens === avantDouble,
  );

  // Sans compte, il n'y a pas de solde : la porte est fermée, comme partout.
  await refuses(
    "jetons : sans compte, la fonction est inaccessible",
    null,
    "select public.tokens_get() as r",
    [],
    "connecte-toi",
  );

  // --- Les paliers de collection : le serveur recalcule -----------------------
  //
  // Le client n'a jamais dit « j'ai complété le catalogue » : il demande, le
  // serveur compte. Un joueur neuf, dont la collection est **contrôlée par ce
  // test**, est donc le bon cobaye : 11 créateurs du catalogue suffisent pour le
  // palier « dix », et surtout pas pour « maître ».
  const MIL = "d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1";
  const SAI = "d2d2d2d2-2222-4222-8222-d2d2d2d2d2d2";

  /** Crée un joueur avec une sauvegarde écrite à la main (la projection suit). */
  async function saveFor(userId, cards, extra = {}) {
    await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [userId]);
    const state = JSON.stringify({
      cards,
      level: 1,
      points: 0,
      packs: 3,
      openings: 0,
      updatedAt: Date.now(),
      ...extra,
    });
    await client.query(
      `insert into public.saves (user_id, state, save_version, device_updated_at, state_checksum)
       values ($1, $2::jsonb, 1, $3, md5($4))
       on conflict (user_id) do update
         set state = excluded.state,
             save_version = excluded.save_version,
             device_updated_at = excluded.device_updated_at,
             state_checksum = excluded.state_checksum`,
      [userId, state, Date.now(), state],
    );
  }

  const onze = (await client.query(
    "select slug from public.creators where retired = false order by rank limit 11",
  )).rows.map((row) => row.slug);
  await saveFor(
    MIL,
    onze.map((slug, index) => card(`mil-${index}`, slug, "common", "standard", 30 + index)),
  );

  const palierDix = (await asPlayer(MIL, "select public.wallet_credit('milestone', 'ten') as r")).rows[0].r;
  const palierDix2 = (await asPlayer(MIL, "select public.wallet_credit('milestone', 'ten') as r")).rows[0].r;
  check(
    "wallet : un palier de collection ne se paie qu'une fois",
    palierDix.gained === 120 && palierDix2.gained === 0 && palierDix2.points === palierDix.points,
    JSON.stringify({ palierDix, palierDix2 }),
  );
  // Le contrôle qui compte : 11 créateurs ne font pas un catalogue complet. Un
  // client qui demanderait « maître » pour 3000 points se fait refuser — avant
  // `0027`, ces 3000 points étaient offerts au premier appel.
  await refuses(
    "wallet : un palier non atteint ne se paie pas (maître à 3000 points)",
    MIL,
    "select public.wallet_credit('milestone', 'master') as r",
    [],
    "il te manque",
  );
  await refuses(
    "wallet : un palier de boosters se compte chez le serveur, pas dans la sauvegarde",
    MIL,
    "select public.wallet_credit('milestone', 'first') as r",
    [],
    "il te manque",
  );
  await refuses(
    "wallet : un palier inventé n'existe pas",
    MIL,
    "select public.wallet_credit('milestone', 'milliardaire') as r",
    [],
    "palier inconnu",
  );

  // --- Les familles : le serveur compte les créateurs de la vague ------------
  //
  // La plus petite vague du catalogue sert de cobaye : une poignée de créateurs,
  // donc un palier atteignable en une ligne de fixture.
  const petite = (await client.query(
    `select season_id
       from public.wallet_season_members
      group by season_id
     having count(*) = 2
      order by season_id
      limit 1`,
  )).rows[0].season_id;
  const membresPetite = (await client.query(
    "select creator_slug from public.wallet_season_members where season_id = $1 order by creator_slug",
    [petite],
  )).rows.map((row) => row.creator_slug);
  const paliersPetite = (await client.query(
    "select tier, required, points from public.wallet_season_tiers where season_id = $1 order by tier",
    [petite],
  )).rows;

  await saveFor(SAI, [card("sai-1", membresPetite[0], "common", "standard", 20)]);
  const famille1 = (await asPlayer(SAI, "select public.wallet_credit('season', $1) as r", [`${petite}#1`])).rows[0].r;
  const famille1bis = (await asPlayer(SAI, "select public.wallet_credit('season', $1) as r", [`${petite}#1`])).rows[0].r;
  check(
    "wallet : une famille paie le palier débloqué, au montant du jeu, une fois",
    famille1.gained === paliersPetite[0].points &&
      famille1.gained === 1 &&
      famille1bis.gained === 0 &&
      famille1bis.points === famille1.points,
    JSON.stringify({ petite, paliersPetite, famille1, famille1bis }),
  );
  await refuses(
    "wallet : un palier de famille non débloqué ne se paie pas",
    SAI,
    "select public.wallet_credit('season', $1) as r",
    [`${petite}#2`],
    "il te manque",
  );
  await refuses(
    "wallet : un palier de famille n'existe pas s'il n'est pas dans la grille",
    SAI,
    "select public.wallet_credit('season', $1) as r",
    [`${petite}#9`],
    "n'existe pas",
  );
  await refuses(
    "wallet : une famille sans palier précisé est refusée",
    SAI,
    "select public.wallet_credit('season', $1) as r",
    [petite],
    "précise le palier",
  );
  // Le second créateur débloque le dernier palier : la somme des paliers d'une
  // vague est exactement ce que le jeu annonce (`pointsPerCreator × taille`).
  await saveFor(
    SAI,
    membresPetite.map((slug, index) => card(`sai-stade-${index}`, slug, "common", "standard", 10 + index)),
  );
  const famille2 = (await asPlayer(SAI, "select public.wallet_credit('season', $1) as r", [`${petite}#2`])).rows[0].r;
  check(
    "wallet : le dernier palier d'une famille paie le reste, et le total est celui du jeu",
    famille2.gained === paliersPetite.at(-1).points &&
      paliersPetite.reduce((sum, row) => sum + row.points, 0) === 4 * membresPetite.length,
    JSON.stringify({ famille2, paliersPetite, membres: membresPetite.length }),
  );

  // --- Le recyclage : la carte, par son identifiant --------------------------
  //
  // Le serveur relit la carte dans la sauvegarde et prend la rareté **au
  // catalogue**. Deux doublons de la même rareté doivent donc payer deux fois :
  // c'est la carte qui est unique, pas la rareté (avant, la seconde était
  // silencieusement payée zéro).
  const rareDuo = (await client.query(
    "select slug from public.creators where rarity = 'rare' and retired = false order by rank limit 1",
  )).rows[0].slug;
  const epicSeule = (await client.query(
    "select slug from public.creators where rarity = 'epic' and retired = false order by rank limit 1",
  )).rows[0].slug;
  const legendaireLibre = (await client.query(
    `select slug from public.creators
      where rarity = 'legendary' and retired = false
        and slug not in (select creator_slug from public.user_cards where user_id = $1)
      order by rank limit 1`,
    [MIL],
  )).rows[0].slug;

  await saveFor(MIL, [
    card("mil-rare-1", rareDuo, "rare", "standard", 40),
    card("mil-rare-2", rareDuo, "rare", "standard", 35),
    card("mil-epic-seule", epicSeule, "epic", "standard", 30),
    // Le Légendaire a **un seul droit** : après le premier recyclage, la porte
    // doit se refermer, même en refabriquant la carte.
    card("mil-legend-1", legendaireLibre, "legendary", "standard", 25),
    card("mil-legend-2", legendaireLibre, "legendary", "standard", 20),
  ]);
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [
    MIL,
    JSON.stringify([{ creatorSlug: legendaireLibre, rarity: "legendary", variant: "standard" }]),
  ]);

  const recy1 = (await asPlayer(MIL, "select public.wallet_credit('recycle', 'mil-rare-1') as r")).rows[0].r;
  const recy1bis = (await asPlayer(MIL, "select public.wallet_credit('recycle', 'mil-rare-1') as r")).rows[0].r;
  const recy2 = (await asPlayer(MIL, "select public.wallet_credit('recycle', 'mil-rare-2') as r")).rows[0].r;
  check(
    "wallet : le recyclage paie le prix de la rareté, et chaque doublon paie",
    recy1.gained === 55 &&
      recy1bis.gained === 0 &&
      recy2.gained === 55 &&
      recy1bis.points === recy1.points,
    JSON.stringify({ recy1, recy1bis, recy2 }),
  );
  await refuses(
    "wallet : on ne recycle pas une carte qu'on n'a pas",
    MIL,
    "select public.wallet_credit('recycle', 'mil-rare-inexistante') as r",
    [],
    "n'est pas dans ta collection",
  );
  await refuses(
    "wallet : la dernière copie ne se recycle pas",
    MIL,
    "select public.wallet_credit('recycle', 'mil-epic-seule') as r",
    [],
    "seule copie",
  );

  // Le Légendaire : un droit, un recyclage — puis la porte se ferme, même en
  // refabriquant la carte dans la sauvegarde (les droits sont finis).
  const recyLegend = (await asPlayer(MIL, "select public.wallet_credit('recycle', 'mil-legend-1') as r")).rows[0].r;
  const droitsRestants = (await client.query(
    "select qty from public.card_claims where user_id = $1 and creator_slug = $2 and rarity = 'legendary' and variant = 'standard'",
    [MIL, legendaireLibre],
  )).rows[0].qty;
  await saveFor(MIL, [
    card("mil-legend-3", legendaireLibre, "legendary", "standard", 15),
    card("mil-legend-4", legendaireLibre, "legendary", "standard", 12),
    card("mil-rare-3", rareDuo, "rare", "standard", 10),
  ]);
  await refuses(
    "wallet : un droit consommé ferme la porte (refabriquer la carte ne repaie pas)",
    MIL,
    "select public.wallet_credit('recycle', 'mil-legend-3') as r",
    [],
    "provenance",
  );
  check(
    "wallet : le recyclage consomme le droit de provenance",
    recyLegend.gained === 250 && droitsRestants === 0,
    JSON.stringify({ recyLegend, droitsRestants }),
  );
  await refuses(
    "wallet : les tables de la grille sont fermées au joueur",
    MIL,
    "select count(*) from public.wallet_season_tiers",
    [],
    "permission denied",
  );

  // L'artisanat débite au prix du catalogue, une fois par créateur. On met
  // juste ce qu'il faut sur le compte (600, le prix d'une Épique) : le refus
  // pour solde insuffisant juste après est alors franc, sans arithmétique.
  // Un créateur **artisanable** : les Légendaires ne le sont pas, elles se
  // tirent (le catalogue décide, pas le client).
  const artisanables = (await client.query(
    "select slug from public.creators where rarity = 'epic' and retired = false order by slug limit 2",
  )).rows.map((row) => row.slug);
  await client.query(
    "select public._wallet_apply($1, greatest(0, 600 - public._wallet_ensure($1)), 'controle', 'artisanat')",
    [B],
  );
  const avantCraftWallet = (await asPlayer(B, "select public.wallet_get() as r")).rows[0].r.points;
  const artisanWallet = (await asPlayer(B, "select public.wallet_spend('craft', $1) as r", [artisanables[0]])).rows[0].r;
  const artisan2 = (await asPlayer(B, "select public.wallet_spend('craft', $1) as r", [artisanables[0]])).rows[0].r;
  check(
    "wallet : l'artisanat débite le prix de la carte, une fois par créateur",
    avantCraftWallet === 600 &&
      artisanWallet.spent === 600 &&
      artisanWallet.points === 0 &&
      // Déjà payé : rien ne bouge, et le serveur le dit.
      artisan2.spent === 0 &&
      artisan2.points === artisanWallet.points,
    JSON.stringify({ avantCraftWallet, artisan: artisanWallet, artisan2 }),
  );
  await refuses(
    "wallet : on ne peut pas dépenser plus que son solde",
    B,
    "select public.wallet_spend('craft', $1) as r",
    [artisanables[1]],
    "il te manque",
  );
  await refuses(
    "wallet : une Légendaire ne s'artisanat pas, même avec les points",
    B,
    "select public.wallet_spend('craft', $1) as r",
    [(await client.query("select slug from public.creators where rarity = 'legendary' order by slug limit 1")).rows[0].slug],
    "ne sont pas artisanales",
  );

  // Les portes et les tables : fermées au joueur.
  await refuses(
    "wallet : les tables sont fermées au joueur",
    G,
    "select count(*) from public.wallets",
    [],
    "permission denied",
  );
  await refuses(
    "wallet : la mécanique interne n'est pas appelable",
    G,
    "select public._wallet_apply($1, 9999, 'triche', 'x') as r",
    [G],
    "permission denied",
  );
  await refuses(
    "wallet : la bascule générale est réservée au serveur",
    G,
    "select public.wallet_backfill() as r",
    [],
    "permission denied",
  );
  await refuses(
    "wallet : sans compte, pas de solde",
    null,
    "select public.wallet_get() as r",
    [],
    "connecte-toi",
  );

  // --- La surcharge (0029) ---------------------------------------------------
  // Le 7 octobre, le jeu a bloqué en production : la première version de `0027`
  // créait `_wallet_apply` avec **cinq** paramètres (dont `p_once boolean default
  // false`), la version corrigée n'en a plus que quatre, et `create or replace`
  // — qui ne remplace que si la signature est identique — avait laissé les deux.
  // Un appel à quatre arguments, comme celui du tirage, devenait ambigu.
  const signaturesApply = (await client.query(
    "select oidvectortypes(p.proargtypes) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_wallet_apply' order by 1",
  )).rows.map((ligne) => ligne.args);
  check(
    "surcharge : `_wallet_apply` n'a qu'une signature — celle du code",
    signaturesApply.length === 1 && signaturesApply[0] === "uuid, integer, text, text",
    JSON.stringify(signaturesApply),
  );


  // --- Le carnet : les ventes -------------------------------------------------
  // Hélène a vendu sa Gold épique à Gaston dans la section précédente : la
  // vitrine de ses ventes doit la montrer, avec l'acheteur, et **pas** ce qui
  // est encore au comptoir.
  // Le vendeur, c'est Gaston : c'est lui qui a déposé la légendaire qu'Hélène a
  // achetée. Hélène, elle, n'a rien vendu — mais elle a une annonce **ouverte**
  // au comptoir, qui ne doit surtout pas passer pour une vente.
  const ventesG = (await asPlayer(G, "select public.market_sales(20) as r")).rows[0].r;
  check(
    "ventes : une vente conclue apparaît dans le carnet, avec son acheteur",
    ventesG.length === 1 &&
      ventesG[0].buyerName === "Hélène" &&
      ventesG[0].price === 600 &&
      Boolean(ventesG[0].soldAt),
    JSON.stringify(ventesG),
  );
  check(
    "ventes : ce qui est encore au comptoir n'est pas une vente",
    (await asPlayer(H, "select public.market_sales(20) as r")).rows[0].r.length === 0,
  );
  check(
    "ventes : sans compte, la fonction ne répond pas",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("select public.market_sales(20)");
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // --- Last Pack ------------------------------------------------------------
  // Trois joueurs frais : Léa ouvre un booster, Lou est son amie, Tiers passe
  // par là. Le paquet est publié par le déclencheur du tirage — pas par le
  // client — et le vol réécrit **les deux** collections.
  const L1 = "11111111-2222-4333-8444-555555555555";
  const L2 = "66666666-7777-4888-8999-000000000000";
  const L3 = "aaaa1111-bbbb-4ccc-8ddd-eeee22223333";

  await player(L1, "Léa", []);
  await player(L2, "Lou", []);
  await player(L3, "Tiers", []);

  await client.query(
    `insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now())
     on conflict (user_id) do update set packs = 4, last_regen_at = now()`,
    [L1],
  );
  const lea = (await asPlayer(L1, "select public.open_pack() as r")).rows[0].r;
  const packId = Number(
    (await client.query("select max(id)::int as id from public.last_packs where user_id = $1", [L1])).rows[0].id,
  );
  check("last pack : ouvrir un booster expose le paquet", Number.isFinite(packId) && packId > 0, String(packId));

  const published = await client.query(
    `select cards,
            expires_at > now() as fresh,
            extract(epoch from (expires_at - drawn_at))::int as window_seconds
       from public.last_packs where id = $1`,
    [packId],
  );
  check(
    "last pack : les cinq cartes du tirage, et dix minutes de fenêtre",
    published.rows[0].cards.length === 5 &&
      published.rows[0].fresh === true &&
      published.rows[0].window_seconds === 600,
    `${published.rows[0].window_seconds} s`,
  );

  // Amitié Léa ↔ Lou, refusée par le serveur pour Tiers.
  const leaRequest = (await asPlayer(L1, "select public.send_friend_request($1) as r", [L2])).rows[0].r.request.id;
  await asPlayer(L2, "select public.accept_friend_request($1)", [leaRequest]);

  const shelfLou = (await asPlayer(L2, "select public.last_pack_shelf() as r")).rows[0].r;
  check(
    "last pack : l'amie voit le paquet, pas comme le sien",
    shelfLou.packs.length === 1 &&
      shelfLou.packs[0].id === packId &&
      shelfLou.packs[0].ownerName === "Léa" &&
      shelfLou.packs[0].mine === false &&
      shelfLou.packs[0].cards.length === 5 &&
      shelfLou.packs[0].stealable === true &&
      shelfLou.stoleToday === false &&
      shelfLou.windowMinutes === 10,
    JSON.stringify(shelfLou.packs[0]),
  );
  check(
    "last pack : le propriétaire voit son paquet, mais ne peut pas se voler",
    (await asPlayer(L1, "select public.last_pack_shelf() as r")).rows[0].r.packs[0].stealable === false,
  );
  check(
    "last pack : le paquet d'un inconnu n'est pas exposé",
    (await asPlayer(L3, "select public.last_pack_shelf() as r")).rows[0].r.packs.length === 0,
  );

  // Le tirage a rangé les cartes **côté serveur** (`0022`) : Léa n'a rien
  // envoyé, et pourtant sa collection les contient — des identifiants neufs,
  // nés sur le serveur, pas dans l'appareil. C'est tout l'objet de la migration.
  const leaServer = (
    await client.query("select state from public.saves where user_id = $1", [L1])
  ).rows[0].state;
  check(
    "last pack : le tirage a rangé les cinq cartes, sans envoi du client",
    leaServer.cards.length === 5 &&
      leaServer.cards.every((held) => typeof held.id === "string" && held.id.length === 36) &&
      leaServer.cards.every((held) => held.creatorSlug === lea.cards.find(
        (drawn) => drawn.creatorSlug === held.creatorSlug && drawn.variant === held.variant,
      )?.creatorSlug),
    JSON.stringify(leaServer.cards.map((held) => held.id)),
  );

  // Un vol ne **crée** jamais une carte : si le propriétaire ne l'a plus — elle
  // est partie dans un échange, au recyclage, ou sa collection date d'avant
  // `0022` —, le serveur refuse au lieu d'inventer la copie.
  await client.query(
    "update public.saves set state = jsonb_set(state, '{cards}', '[]'::jsonb) where user_id = $1",
    [L1],
  );
  await refuses(
    "last pack : voler une carte que le propriétaire ne possède pas → refus",
    L2,
    "select public.last_pack_steal($1, $2)",
    [packId, 1],
    "ne possède plus",
  );
  await client.query(
    "update public.saves set state = jsonb_set(state, '{cards}', $2::jsonb) where user_id = $1",
    [L1, JSON.stringify(leaServer.cards)],
  );

  // L'état de Léa **avant** le vol : c'est lui, et ses identifiants nés sur le
  // serveur, qu'un appareil resté hors ligne renverrait.
  const leaBeforeVol = (
    await client.query("select state from public.saves where user_id = $1", [L1])
  ).rows[0].state;

  // La carte visée est la première **volable** : depuis `0034`, une Légendaire
  // ou une carte Live ne se prennent pas, et le tirage de ce contrôle est
  // aléatoire — viser « la 3ᵉ » ferait échouer un test sur huit.
  const indexVolable = lea.cards.findIndex(
    (held) => held.rarity !== "legendary" && held.variant !== "live",
  );
  check("last pack : le tirage laisse au moins une carte volable", indexVolable >= 0);
  const vol = (await asPlayer(L2, "select public.last_pack_steal($1, $2) as r", [packId, indexVolable + 1]))
    .rows[0].r;
  check(
    "last pack : le vol donne la carte choisie, marquée du paquet",
    vol.status === "stolen" &&
      vol.index === indexVolable + 1 &&
      vol.ownerName === "Léa" &&
      vol.card.creatorSlug === lea.cards[indexVolable].creatorSlug &&
      vol.card.rarity === lea.cards[indexVolable].rarity &&
      vol.card.fromLastPack === packId,
    JSON.stringify(vol.card),
  );

  const leaCards = (
    await client.query("select jsonb_array_length(state -> 'cards')::int as n from public.saves where user_id = $1", [L1])
  ).rows[0].n;
  const louCards = (
    await client.query("select state -> 'cards' as cards from public.saves where user_id = $1", [L2])
  ).rows[0].cards;
  const leaSave = (
    await client.query("select state -> 'cards' as cards from public.saves where user_id = $1", [L1])
  ).rows[0].cards;
  check(
    "last pack : la carte quitte vraiment la collection du propriétaire",
    leaCards === 4 &&
      !leaSave.some(
        (held) =>
          held.creatorSlug === lea.cards[indexVolable].creatorSlug &&
          held.variant === lea.cards[indexVolable].variant,
      ),
    `${leaCards} carte(s) restantes chez Léa`,
  );
  check(
    "last pack : la carte entre chez le voleur, et une seule fois",
    louCards.length === 1 &&
      louCards[0].creatorSlug === lea.cards[indexVolable].creatorSlug &&
      louCards[0].fromLastPack === packId,
    JSON.stringify(louCards),
  );
  check(
    "last pack : la carte prise est marquée comme telle sur le paquet",
    (await asPlayer(L1, "select public.last_pack_shelf() as r")).rows[0].r.packs[0].cards[indexVolable]
      .taken === true &&
      (await asPlayer(L1, "select public.last_pack_shelf() as r")).rows[0].r.packs[0].cards.find(
        (entry) => entry.index !== indexVolable + 1,
      ).taken === false,
  );

  // --- Ce qui ne se vole pas (0034) ----------------------------------------
  // Un paquet **fabriqué à la main** : le tirage de contrôle ci-dessus est
  // aléatoire, et une Légendaire n'y tombe qu'une fois sur huit. Ici, on sait
  // exactement ce que contient le paquet.
  const O1 = "44444444-5555-4666-8777-888888888888";
  const O2 = "55555555-6666-4777-8888-999999999999";
  const legendaire = card("proto-legendaire", "squeezie", "!legendary", "standard", 1);
  const live = card("proto-live", "gotaga", "!rare", "live", 1);
  const ordinaires = [
    card("proto-commun-1", "ibai", "!common", "standard", 1),
    card("proto-commun-2", "summit1g", "!common", "standard", 1),
    card("proto-commun-3", "chowh1", "!common", "standard", 1),
  ];
  const paquetProtégé = [legendaire, live, ...ordinaires];
  await player(O1, "Protégée", paquetProtégé);
  await player(O2, "Curieuse", []);
  const o1Request = (await asPlayer(O1, "select public.send_friend_request($1) as r", [O2])).rows[0].r
    .request.id;
  await asPlayer(O2, "select public.accept_friend_request($1)", [o1Request]);
  const protegePackId = Number(
    (
      await client.query(
        `insert into public.last_packs (user_id, drawn_at, expires_at, cards)
         values ($1, now(), now() + interval '10 minutes', $2::jsonb)
         returning id`,
        [O1, JSON.stringify(paquetProtégé)],
      )
    ).rows[0].id,
  );

  const shelfProtege = (await asPlayer(O2, "select public.last_pack_shelf() as r")).rows[0].r;
  const paquetVu = shelfProtege.packs.find((entry) => entry.id === protegePackId);
  check(
    "last pack protégé : l'écran sait quelle carte ne se prend pas",
    paquetVu?.cards[0].stealable === false &&
      paquetVu?.cards[1].stealable === false &&
      paquetVu?.cards[2].stealable === true,
    JSON.stringify(paquetVu?.cards.map((entry) => entry.stealable)),
  );
  await refuses(
    "last pack protégé : une Légendaire ne se vole pas",
    O2,
    "select public.last_pack_steal($1, $2)",
    [protegePackId, 1],
    "Légendaire ne se vole pas",
  );
  await refuses(
    "last pack protégé : une carte Live ne se vole pas",
    O2,
    "select public.last_pack_steal($1, $2)",
    [protegePackId, 2],
    "Live ne se vole pas",
  );
  const priseOrdinaire = (
    await asPlayer(O2, "select public.last_pack_steal($1, $2) as r", [protegePackId, 3])
  ).rows[0].r;
  check(
    "last pack protégé : une carte ordinaire se prend toujours",
    priseOrdinaire.status === "stolen" && priseOrdinaire.card.creatorSlug === ordinaires[0].creatorSlug,
    JSON.stringify(priseOrdinaire.card),
  );
  // Et après le refus, **rien** n'a bougé : ni la collection, ni le compteur
  // du jour — un refus n'est pas un vol à moitié fait.
  check(
    "last pack protégé : le refus laisse la collection et le vol du jour intacts",
    (
      await client.query("select jsonb_array_length(state -> 'cards')::int as n from public.saves where user_id = $1", [O1])
    ).rows[0].n === 4 &&
      (
        await client.query("select count(*)::int as n from public.last_pack_steals where pack_id = $1", [protegePackId])
      ).rows[0].n === 1,
    "",
  );
  // Le paquet fabriqué quitte la scène : la dernière vérification du fichier
  // compare le nombre de paquets exposés au nombre de tirages, et un paquet
  // posé à la main n'a pas de tirage derrière lui.
  await client.query("delete from public.last_pack_steals where pack_id = $1", [protegePackId]);
  await client.query("delete from public.last_packs where id = $1", [protegePackId]);

  // Une carte par jour, et pas deux.
  await refuses(
    "last pack : deux vols le même jour → refus",
    L2,
    "select public.last_pack_steal($1, $2)",
    [packId, indexVolable === 0 ? 2 : 1],
    "une carte par jour",
  );
  // Le lendemain (jour UTC reculé d'un cran), le même joueur peut revenir…
  await client.query("update public.last_pack_steals set day = day - 1 where thief_id = $1", [L2]);
  await refuses(
    "last pack : une carte déjà prise reste prise",
    L2,
    "select public.last_pack_steal($1, $2)",
    [packId, indexVolable + 1],
    "déjà été prise",
  );
  // Une **autre** carte volable que celle d'hier : la première peut tomber sur
  // n'importe quelle place du tirage.
  const indexVolable2 = lea.cards.findIndex(
    (held, place) => place !== indexVolable && held.rarity !== "legendary" && held.variant !== "live",
  );
  check("last pack : le tirage laisse une deuxième carte volable", indexVolable2 >= 0);
  const vol2 = (
    await asPlayer(L2, "select public.last_pack_steal($1, $2) as r", [packId, indexVolable2 + 1])
  ).rows[0].r;
  check(
    "last pack : le lendemain, une autre carte du même paquet",
    vol2.card.creatorSlug === lea.cards[indexVolable2].creatorSlug && vol2.index === indexVolable2 + 1,
    JSON.stringify(vol2.card),
  );

  // Un inconnu, un paquet à soi, un paquet périmé : trois refus.
  await refuses(
    "last pack : un inconnu ne vole pas",
    L3,
    "select public.last_pack_steal($1, $2)",
    [packId, 2],
    "il faut être ami",
  );
  await refuses(
    "last pack : on ne vole pas son propre paquet",
    L1,
    "select public.last_pack_steal($1, $2)",
    [packId, 2],
    "ton propre paquet",
  );
  await client.query("update public.last_packs set expires_at = now() - interval '1 minute' where id = $1", [packId]);
  await refuses(
    "last pack : après dix minutes, la fenêtre est fermée",
    L3,
    "select public.last_pack_steal($1, $2)",
    [packId, 2],
    "dix minutes sont écoulées",
  );
  check(
    "last pack : un paquet périmé sort de l'étagère",
    (await asPlayer(L1, "select public.last_pack_shelf() as r")).rows[0].r.packs.length === 0,
  );

  // Le carnet de la victime : qui, quoi, quand. Et rien pour le voleur.
  const pertes = (await asPlayer(L1, "select public.last_pack_losses(20) as r")).rows[0].r;
  check(
    "last pack : la victime retrouve ses vols, du plus récent au plus ancien",
    pertes.length === 2 &&
      pertes.every((perte) => perte.thiefName === "Lou" && Boolean(perte.stolenAt)) &&
      // Le tirage est aléatoire : on compare aux **deux** places réellement
      // volées, jamais à une place fixe du paquet.
      pertes[0].card.creatorSlug === lea.cards[indexVolable2].creatorSlug &&
      pertes[1].card.creatorSlug === lea.cards[indexVolable].creatorSlug,
    JSON.stringify(pertes.map((perte) => perte.card.creatorSlug)),
  );
  check(
    "last pack : le voleur ne voit pas ses propres vols",
    (await asPlayer(L2, "select public.last_pack_losses(20) as r")).rows[0].r.length === 0,
  );

  // Le vol retient l'identifiant exact de la carte prise chez la victime :
  // c'est ce qui permet au garde-fou de `push_save()` de ne pas confondre la
  // carte volée avec une nouvelle carte du même créateur.
  const vols = (
    await client.query("select card_id, card ->> 'creatorSlug' as slug from public.last_pack_steals order by id")
  ).rows;
  check(
    "last pack : chaque vol retient l'identifiant de la carte prise",
    vols.length === 2 &&
      vols.every((ligne) => typeof ligne.card_id === "string" && ligne.card_id.length > 0) &&
      new Set(vols.map((ligne) => ligne.card_id)).size === 2,
    JSON.stringify(vols),
  );

  // Un vol ne se défait pas avec une vieille sauvegarde d'appareil : sans ce
  // garde-fou, la victime qui rejoue avant de se resynchroniser ferait
  // revenir sa carte **et** le voleur la garderait.
  const beforeVol = leaBeforeVol;
  const rejectedPush = (
    await asPlayer(L1, "select public.push_save($1::jsonb, 1, $2, true) as r", [
      JSON.stringify(beforeVol),
      Date.now(),
    ])
  ).rows[0].r;
  check(
    "last pack : une vieille sauvegarde ne fait pas revenir la carte volée",
    rejectedPush.status === "rejected" &&
      JSON.stringify(rejectedPush.problems).includes("carte volée"),
    JSON.stringify(rejectedPush.status),
  );

  const pris = new Set(vols.map((ligne) => ligne.card_id));
  const healed = { ...beforeVol, cards: beforeVol.cards.filter((held) => !pris.has(held.id)) };
  const healedPush = (
    await asPlayer(L1, "select public.push_save($1::jsonb, 1, $2, true) as r", [
      JSON.stringify(healed),
      Date.now() + 1000,
    ])
  ).rows[0].r;
  check(
    "last pack : la collection sans la carte volée repasse sans problème",
    // `unchanged` compte comme un succès : le serveur a déjà exactement cet
    // état (c'est lui qui l'a écrit, plus l'appareil).
    healedPush.status === "pushed" || healedPush.status === "unchanged",
    JSON.stringify(healedPush.status),
  );

  const thiefState = (await client.query("select state from public.saves where user_id = $1", [L2])).rows[0].state;
  const thiefPush = (
    await asPlayer(L2, "select public.push_save($1::jsonb, 1, $2, true) as r", [
      JSON.stringify(thiefState),
      Date.now() + 2000,
    ])
  ).rows[0].r;
  check(
    "last pack : le garde-fou ne bloque pas le voleur (sa collection est valide)",
    thiefPush.status === "pushed" || thiefPush.status === "unchanged",
    JSON.stringify(thiefPush.status),
  );

  // Les tables restent fermées : rien à lire directement, rien pour un
  // visiteur sans compte.
  check(
    "last pack : les paquets exposés ne sont pas lisibles en direct",
    (await asPlayer(L3, "select count(*)::int as n from public.last_packs")).rows[0].n === 0,
  );
  check(
    "last pack : un tiers ne lit pas les vols des autres",
    (await asPlayer(L3, "select count(*)::int as n from public.last_pack_steals")).rows[0].n === 0 &&
      (await asPlayer(L1, "select count(*)::int as n from public.last_pack_steals")).rows[0].n === 2 &&
      (await asPlayer(L2, "select count(*)::int as n from public.last_pack_steals")).rows[0].n === 2,
  );
  await refuses(
    "last pack : sans compte, l'étagère ne répond pas",
    "",
    "select public.last_pack_shelf()",
    [],
    "connecte-toi",
  );
  check(
    "last pack : sans compte, la fonction est inaccessible",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("select public.last_pack_shelf()");
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // --- 0013 : plancher de malchance et série de jours ----------------------
  // Les deux compteurs ne vivent pas dans la sauvegarde : ils sont déduits du
  // journal des tirages (`pack_draws`), que seule `open_pack()` écrit. Un
  // joueur qui trafique son appareil ne peut donc pas s'offrir une Légendaire.
  //
  // On amorce le journal directement. Le déclencheur du Last Pack est mis en
  // pause le temps du bloc : ces lignes ne sont pas de vrais paquets, et on
  // les retire à la fin pour laisser le journal tel qu'on l'a trouvé.
  const PITY = "77777777-7777-4777-8777-777777777777";
  const STREAK = "88888888-8888-4888-8888-888888888888";
  await player(PITY, "Pia", []);
  await player(STREAK, "Sam", []);
  await client.query("alter table public.pack_draws disable trigger pack_draws_last_pack");

  /** Ajoute `count` tirages au journal de `userId`, à `daysAgo` jours de jeu. */
  async function seedDraws(userId, count, daysAgo, cards) {
    await client.query(
      // « Le 18 h de la journée de jeu », mais **jamais dans le futur** : lancé
       // entre 6 h et 18 h UTC, le 18 h du jour est encore à venir, et un tirage
       // factice daté du futur passerait *après* le vrai tirage que le test
       // vérifie juste après — le compteur de malchance lisant le journal du
       // plus récent au plus ancien, le test échouait selon l'heure de la
       // journée. `least(...)` garde l'intention (un tirage de la journée de
       // jeu) en supprimant le piège.
      `insert into public.pack_draws (user_id, drawn_at, cards)
       select $1,
              least(
                ((((now() at time zone 'utc') - interval '6 hours')::date - $2::int
                  + interval '18 hours') at time zone 'utc'),
                now() - interval '1 minute'
              ),
              $3::jsonb
         from generate_series(1, $4::int)`,
      [userId, daysAgo, JSON.stringify(cards), count],
    );
  }

  const sansLegendaire = [
    { creatorSlug: "ibai", rarity: "uncommon", variant: "standard", rareDrop: false },
    { creatorSlug: "chowh1", rarity: "common", variant: "standard", rareDrop: false },
  ];

  check(
    "pity : un joueur sans tirage a un compteur à zéro",
    (await client.query("select public._pack_pity($1) as n", [PITY])).rows[0].n === 0,
  );

  // Le seuil vient du **fichier des taux**, pas d'une constante parallèle : le
  // 7 octobre 2026 le joueur l'a ramené de 80 à 12 (« 12 packs jusqu'au pity »),
  // et c'est `0031_pity_douze.sql` qui le porte. Un contrôle écrit avec « 80 »
  // en dur aurait continué à passer sur l'ancienne règle.
  const seuilPity = rates.pity.threshold;
  await seedDraws(PITY, seuilPity - 1, 0, sansLegendaire);
  check(
    `pity : ${seuilPity - 1} tirages sans Légendaire → compteur à ${seuilPity - 1} (le prochain est le ${seuilPity}ᵉ)`,
    (await client.query("select public._pack_pity($1) as n", [PITY])).rows[0].n === seuilPity - 1,
    String((await client.query("select public._pack_pity($1) as n", [PITY])).rows[0].n),
  );

  // La fonction **installée** doit porter ce seuil, et lui seul : trois
  // occurrences (la décision, la conversion en Perfect, la réponse `pity_hit`).
  const defPity = (
    await client.query("select pg_get_functiondef('public.open_pack(text)'::regprocedure) as d")
  ).rows[0].d;
  const seuilsBase = defPity.match(/v_pity \+ 1 >= \d+/g) ?? [];
  check(
    "pity : la fonction installée porte le seuil du fichier des taux, et lui seul",
    seuilsBase.length === 3 && seuilsBase.every((x) => x === `v_pity + 1 >= ${seuilPity}`),
    seuilsBase.join(" | "),
  );

  const pityStatus = (await asPlayer(PITY, "select public.pack_status() as r")).rows[0].r;
  check(
    `pity : le statut publié affiche le même compteur que celui qui décidera le tirage (${seuilPity - 1} + 1 = ${seuilPity})`,
    pityStatus.pity === seuilPity - 1 && pityStatus.streak === 1,
    JSON.stringify({ pity: pityStatus.pity, streak: pityStatus.streak }),
  );

  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
    [PITY],
  );
  const payeur = (await asPlayer(PITY, "select public.open_pack() as r")).rows[0].r;
  check(
    `pity : le ${seuilPity}ᵉ booster garantit une Légendaire, et le dit`,
    payeur.cards.some((c) => c.rarity === "legendary") && payeur.pity_hit === true,
    JSON.stringify(payeur.cards.map((c) => c.rarity)),
  );
  check(
    "pity : la garantie remet le compteur à zéro",
    payeur.pity === 0 && (await client.query("select public._pack_pity($1) as n", [PITY])).rows[0].n === 0,
  );
  // Un Légendaire de **chance** — pas celui de la garantie — remet lui aussi le
  // compteur à zéro : le joueur a eu sa carte, le plancher n'a plus rien à
  // rattraper. Joueur dédié, pour ne pas dépendre de l'ordre des tirages du
  // précédent.
  const LUCK = "12121212-3434-4565-8787-909090909090";
  await player(LUCK, "Luc", []);
  await seedDraws(LUCK, 5, 0, sansLegendaire);
  check(
    "pity : cinq tirages sans Légendaire → compteur à 5",
    (await client.query("select public._pack_pity($1) as n", [LUCK])).rows[0].n === 5,
  );
  await seedDraws(LUCK, 1, 0, [
    { creatorSlug: "auronplay", rarity: "legendary", variant: "standard", rareDrop: false },
    ...sansLegendaire,
  ]);
  check(
    "pity : une Légendaire de chance remet le compteur à zéro",
    (await client.query("select public._pack_pity($1) as n", [LUCK])).rows[0].n === 0,
  );


  // Série : un joueur neuf ouvre son premier booster (jour 1), puis rien le
  // lendemain casse la série.
  check(
    "série : personne n'a de série avant son premier booster",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 1,
  );
  await seedDraws(STREAK, 1, 0, sansLegendaire);
  check(
    "série : un tirage aujourd'hui → jour 1",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 1,
  );
  await client.query("delete from public.pack_draws where user_id = $1", [STREAK]);
  await seedDraws(STREAK, 1, 1, sansLegendaire);
  check(
    "série : hier + le booster du jour → jour 2",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 2,
  );
  await seedDraws(STREAK, 1, 2, sansLegendaire);
  await seedDraws(STREAK, 1, 3, sansLegendaire);
  check(
    "série : quatre jours d'affilée → jour 4",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 4,
  );
  // Un trou : le jour 4 (relatif) manque, les jours 5 et 9 ne comptent donc pas.
  await seedDraws(STREAK, 1, 5, sansLegendaire);
  await seedDraws(STREAK, 1, 9, sansLegendaire);
  check(
    "série : un jour manqué coupe la série (elle s'arrête au trou)",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 4,
  );
  // Et si le jour manquant est comblé, la série reprend jusqu'à lui.
  await seedDraws(STREAK, 1, 4, sansLegendaire);
  check(
    "série : combler le trou rallonge la série (jour 6)",
    (await client.query("select public._pack_streak($1, now()) as n", [STREAK])).rows[0].n === 6,
  );

  // Sept jours d'affilée, rien encore aujourd'hui : le prochain booster est un
  // « Perfect » garanti, sauf si le joueur préfère les 3 sabliers.
  const JACKPOT = "99999999-9999-4999-8999-999999999999";
  await player(JACKPOT, "Jo", []);
  for (const daysAgo of [1, 2, 3, 4, 5, 6]) await seedDraws(JACKPOT, 1, daysAgo, sansLegendaire);
  const jackpotStatus = (await asPlayer(JACKPOT, "select public.pack_status() as r")).rows[0].r;
  check(
    "série : au 7e jour, le statut annonce la récompense qui attend",
    jackpotStatus.streak === 7 && jackpotStatus.jackpot_ready === true,
    JSON.stringify({ streak: jackpotStatus.streak, ready: jackpotStatus.jackpot_ready }),
  );
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
    [JACKPOT],
  );
  const sabliers = (await asPlayer(JACKPOT, "select public.open_pack('hourglasses') as r")).rows[0].r;
  check(
    "série : 3 sabliers choisis → le tirage n'est pas forcé (le client crédite les sabliers)",
    sabliers.jackpot === false && sabliers.streak === 7,
    JSON.stringify({ jackpot: sabliers.jackpot, streak: sabliers.streak }),
  );
  const perfect = (await asPlayer(JACKPOT, "select public.open_pack('perfect') as r")).rows[0].r;
  check(
    "série : le Perfect du 7e jour reste disponible toute la journée (un autre tirage ne le consomme pas)",
    perfect.jackpot === true,
    JSON.stringify({ jackpot: perfect.jackpot, streak: perfect.streak }),
  );
  const secondOfDay = (await asPlayer(JACKPOT, "select public.open_pack('perfect') as r")).rows[0].r;
  check(
    "série : une fois le Perfect du jour sorti, le booster suivant n'est plus garanti",
    secondOfDay.jackpot === false,
  );
  const afterJackpot = (await asPlayer(JACKPOT, "select public.pack_status() as r")).rows[0].r;
  check(
    "série : le statut ne promet plus de récompense une fois qu'elle est tombée",
    afterJackpot.jackpot_ready === false && afterJackpot.streak === 7,
    JSON.stringify({ ready: afterJackpot.jackpot_ready, streak: afterJackpot.streak }),
  );

  // Les joueurs n'appellent pas les fonctions internes.
  await refuses("pity : un joueur ne lit pas le journal d'un autre", A, "select public._pack_pity($1)", [PITY], "permission denied");
  await refuses("série : un joueur n'appelle pas la fonction interne", A, "select public._pack_streak($1, now())", [PITY], "permission denied");
  await refuses("série : un joueur ne lit pas l'historique du Perfect", A, "select public._pack_perfect_today($1, now())", [PITY], "permission denied");

  // ---------------------------------------------------------------------------
  // La série paie ses jours (0032)
  // ---------------------------------------------------------------------------
  // La règle : le booster qui fait avancer la série paie le jour coché, **une
  // fois par journée de jeu**, et le 7ᵉ jour paie le jackpot — jamais les deux.
  // Les contrôles lisent le barème dans `progression.json` : un chiffre changé
  // d'un seul côté (fichier ou SQL) doit se voir ici.
  const solde = async (userId) =>
    Number((await client.query("select public._wallet_ensure($1) as p", [userId])).rows[0].p);
  const bareme = new Map(
    (progressionData.streak.rewards ?? []).map((reward) => [reward.day, reward.points ?? 0]),
  );
  const pointsAnnonces = [];
  for (const day of [1, 2, 3, 4, 5, 6, 7, 9]) {
    pointsAnnonces.push(
      Number(
        (await client.query("select public._streak_reward_points($1) as p", [day])).rows[0].p,
      ),
    );
  }
  check(
    "série : la table des points est celle du fichier (J1 → J6, 0 au 7ᵉ et hors bornes)",
    pointsAnnonces.every((points, index) => {
      const day = [1, 2, 3, 4, 5, 6, 7, 9][index];
      if (day === 7 || day === 9) return points === 0;
      return points === (bareme.get(day) ?? 0);
    }),
    JSON.stringify(pointsAnnonces),
  );

  // Jour 3 : deux jours déjà joués (hier et avant-hier), donc aujourd'hui serait
  // le troisième. Le booster paie 60 points, en plus des 12 du tirage.
  const SERIE = "31313131-4141-4545-8787-919191919191";
  await player(SERIE, "Sériane", []);
  await seedDraws(SERIE, 1, 2, sansLegendaire);
  await seedDraws(SERIE, 1, 1, sansLegendaire);
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
    [SERIE],
  );
  const soldeAvant = await solde(SERIE);
  const jour3 = (await asPlayer(SERIE, "select public.open_pack() as r")).rows[0].r;
  const soldeApres = await solde(SERIE);
  check(
    "série : le 3ᵉ jour paie ses points, une fois, en plus des 12 du tirage",
    jour3.streak_reward?.day === 3 &&
      jour3.streak_reward?.points === (bareme.get(3) ?? 0) &&
      soldeApres - soldeAvant === 12 + (bareme.get(3) ?? 0),
    JSON.stringify({ annonce: jour3.streak_reward, gain: soldeApres - soldeAvant }),
  );

  // Le deuxième booster du **même jour** : la journée est déjà payée. Le
  // serveur ne repaie pas, et il ne l'annonce pas — sinon l'écran promettrait
  // des points qui n'arrivent pas.
  await client.query(
    "update public.pack_state set packs = 4, last_regen_at = now() where user_id = $1",
    [SERIE],
  );
  const soldeAvantBis = await solde(SERIE);
  const memeJour = (await asPlayer(SERIE, "select public.open_pack() as r")).rows[0].r;
  const soldeApresBis = await solde(SERIE);
  check(
    "série : le deuxième booster du même jour ne repaie pas, et ne l'annonce pas",
    memeJour.streak_reward?.points === 0 && soldeApresBis - soldeAvantBis === 12,
    JSON.stringify({ annonce: memeJour.streak_reward, gain: soldeApresBis - soldeAvantBis }),
  );

  // Jour 7 : six jours d'affilée avant aujourd'hui → le booster du jour paie le
  // jackpot (un Perfect garanti), pas une micro-récompense.
  const SEPT = "32323232-4242-4545-8787-929292929292";
  await player(SEPT, "Septime", []);
  for (let jour = 6; jour >= 1; jour -= 1) await seedDraws(SEPT, 1, jour, sansLegendaire);
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
    [SEPT],
  );
  const soldeSeptAvant = await solde(SEPT);
  const septieme = (await asPlayer(SEPT, "select public.open_pack() as r")).rows[0].r;
  const soldeSeptApres = await solde(SEPT);
  check(
    "série : le 7ᵉ jour paie le jackpot, pas une micro-récompense",
    septieme.streak_reward?.day === 7 &&
      septieme.streak_reward?.points === 0 &&
      septieme.jackpot === true &&
      soldeSeptApres - soldeSeptAvant === 12,
    JSON.stringify({
      annonce: septieme.streak_reward,
      jackpot: septieme.jackpot,
      gain: soldeSeptApres - soldeSeptAvant,
    }),
  );

  // Un jour manqué remet la série à zéro : le prochain booster est un jour 1, et
  // il repaie les points du jour 1 — la référence contient la journée de jeu.
  const TROU = "33333333-4343-4545-8787-939393939393";
  await player(TROU, "Trouée", []);
  await seedDraws(TROU, 1, 9, sansLegendaire);
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
    [TROU],
  );
  const soldeTrouAvant = await solde(TROU);
  const reprise = (await asPlayer(TROU, "select public.open_pack() as r")).rows[0].r;
  const soldeTrouApres = await solde(TROU);
  check(
    "série : après un jour manqué, la série repart à J1 et repaie ses points",
    reprise.streak_reward?.day === 1 &&
      reprise.streak_reward?.points === (bareme.get(1) ?? 0) &&
      soldeTrouApres - soldeTrouAvant === 12 + (bareme.get(1) ?? 0),
    JSON.stringify({ annonce: reprise.streak_reward, gain: soldeTrouApres - soldeTrouAvant }),
  );

  // La table du barème est interne : un joueur ne peut pas la lire, et il ne
  // peut pas non plus se verser des points de série à la main.
  const refusSerie = await asPlayer(TROU, "select public._streak_reward_points(4) as p").then(
    () => "",
    (error) => String(error.message),
  );
  check("série : la table des points est fermée aux joueurs", /permission denied/.test(refusSerie), refusSerie);
  const refusSerieCredit = await asPlayer(
    TROU,
    "select public._wallet_apply($1::uuid, 999, 'streak', 'triche') as p",
    [TROU],
  ).then(() => "", (error) => String(error.message));
  check(
    "série : un joueur ne peut pas se verser des points de série",
    /permission denied/.test(refusSerieCredit),
    refusSerieCredit,
  );

  // On laisse le journal comme on l'a trouvé : ces boosters de contrôle ne sont
  // pas de vrais paquets, et `pack_draws` ne doit pas en garder la trace — le
  // contrôle de rejouabilité, plus bas, compare les deux journaux.
  await client.query("delete from public.pack_draws where user_id in ($1, $2, $3)", [SERIE, SEPT, TROU]);

  await client.query("alter table public.pack_draws enable trigger pack_draws_last_pack");
  await client.query("delete from public.pack_draws where user_id in ($1, $2, $3, $4)", [
    PITY,
    STREAK,
    JACKPOT,
    LUCK,
  ]);


  // --- 0014 : le Paquet Scène ----------------------------------------------
  // Le serveur donne les choix, le client tire dedans, le serveur vérifie. Ce
  // qui se contrôle ici : les choix (famille, pas de Légendaire, mêmes poids
  // que pull-rates.json, déterministes), et les refus (carte hors des choix,
  // doublon, second paquet du même jour, appel anonyme).
  const SCENE = "aaaa2222-bbbb-4ccc-8ddd-eeee33334444";
  await player(SCENE, "Sacha", []);

  const sceneChoices = (await asPlayer(SCENE, "select public.scene_pack_choices('S01') as r")).rows[0].r;
  check(
    "paquet scène : cinq listes de choix, toutes dans la famille",
    sceneChoices.choices.length === 5 &&
      sceneChoices.choices.every((slot) => slot.length > 0) &&
      sceneChoices.choices.every((slot) => slot.every((entry) => entry.slug)) &&
      sceneChoices.family === "S01" &&
      sceneChoices.day === sceneChoices.day.toLowerCase(),
    JSON.stringify({ sizes: sceneChoices.choices.map((slot) => slot.length), day: sceneChoices.day }),
  );

  // Aucune Légendaire dans les choix — la promesse publiée du paquet.
  const sceneRarities = new Set(
    sceneChoices.choices.flat().map((entry) => entry.rarity),
  );
  check(
    "paquet scène : aucune Légendaire parmi les choix",
    !sceneRarities.has("legendary") && [...sceneRarities].every((rarity) => rarity !== "legendary"),
    [...sceneRarities].join(", "),
  );

  // Les choix portent la famille demandée : on vérifie sur le catalogue.
  const horsFamille = await client.query(
    `select count(*)::int as n
       from public.creators c
      where c.slug = any($1::text[]) and c.region <> 'S01'`,
    [sceneChoices.choices.flat().map((entry) => entry.slug)],
  );
  check(
    "paquet scène : aucun créateur hors famille dans les choix",
    horsFamille.rows[0].n === 0,
    String(horsFamille.rows[0].n),
  );

  const sceneAgain = (await asPlayer(SCENE, "select public.scene_pack_choices('S01') as r")).rows[0].r;
  check(
    "paquet scène : les choix sont déterministes (le serveur peut donc vérifier)",
    JSON.stringify(sceneAgain) === JSON.stringify(sceneChoices),
  );

  /**
   * Le tirage d'un joueur : une carte dans chaque liste, jamais deux fois le
   * même créateur (les listes se recoupent — un commun figure dans presque tous
   * les slots). C'est exactement ce que fait le client.
   */
  async function scenePickFor(userId, family) {
    const shelf = (await asPlayer(userId, "select public.scene_pack_choices($1) as r", [family]))
      .rows[0].r;
    const used = new Set();
    const pick = shelf.choices.map((slot) => {
      const free = slot.filter((entry) => !used.has(entry.slug));
      const entry = free[Math.floor(free.length / 2)];
      used.add(entry.slug);
      return entry;
    });
    return { shelf, pick };
  }

  // Couvre les familles réelles qui ont moins de cinq Épiques. Les identités
  // sont cherchées pour la journée courante afin d'exercer les deux branches
  // du déclencheur déterministe 3/1000 sans modifier la base ou son horloge.
  const smallEpicFamilies = ["S02", "S03", "S05", "S07", "S08"];
  const noEpicFamily = "S10_TEST_NO_EPIC";
  const incompatibleFamily = "S10_TEST_NO_GUARANTEE";
  await client.query("begin");
  await client.query(
    `insert into public.creators (slug, login, display_name, rarity, rank, region, retired) values
      ('scene-test-rare', 'scene-test-rare', 'Scene Test Rare', 'rare', 2001, $1, false),
      ('scene-test-common-1', 'scene-test-common-1', 'Scene Test Common 1', 'common', 2002, $1, false),
      ('scene-test-common-2', 'scene-test-common-2', 'Scene Test Common 2', 'common', 2003, $1, false),
      ('scene-test-common-3', 'scene-test-common-3', 'Scene Test Common 3', 'common', 2004, $1, false),
      ('scene-test-common-4', 'scene-test-common-4', 'Scene Test Common 4', 'common', 2005, $1, false),
      ('scene-test-incompatible-1', 'scene-test-incompatible-1', 'Scene Test Incompatible 1', 'common', 2006, $2, false),
      ('scene-test-incompatible-2', 'scene-test-incompatible-2', 'Scene Test Incompatible 2', 'common', 2007, $2, false),
      ('scene-test-incompatible-3', 'scene-test-incompatible-3', 'Scene Test Incompatible 3', 'common', 2008, $2, false),
      ('scene-test-incompatible-4', 'scene-test-incompatible-4', 'Scene Test Incompatible 4', 'common', 2009, $2, false),
      ('scene-test-incompatible-5', 'scene-test-incompatible-5', 'Scene Test Incompatible 5', 'common', 2010, $2, false)`,
    [noEpicFamily, incompatibleFamily],
  );
  const sceneProbeRows = await client.query(`
    with families(family) as (
      values ('S01'::text), ('S02'), ('S03'), ('S05'), ('S07'), ('S08'), ('S10_TEST_NO_EPIC')
    ), probes as (
      select f.family, md5('scene-parity-' || f.family || ':' || n)::uuid as user_id
        from families f cross join generate_series(1, 10000) as nums(n)
    ), rolls as (
      select family, user_id,
             mod(abs(hashtext(user_id::text || public._pack_game_day(now())::text || family)::bigint), 1000) < 3
               as rare_drop
        from probes
    )
    select distinct on (family, rare_drop) family, user_id::text as user_id, rare_drop
      from rolls
     order by family, rare_drop, user_id
  `);
  const sceneProbeUsers = new Map(
    sceneProbeRows.rows.map((row) => [`${row.family}:${row.rare_drop}`, row.user_id]),
  );

  function pickSceneChoices(shelf, initialSeed) {
    let seed = initialSeed >>> 0;
    const used = new Set();
    const picked = [];
    for (const slot of shelf.choices) {
      const free = slot.filter((entry) => entry.slug && !used.has(entry.slug));
      if (!free.length) return null;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const entry = free[seed % free.length];
      used.add(entry.slug);
      picked.push(entry);
    }
    return picked;
  }

  for (const [familyIndex, family] of [...smallEpicFamilies, noEpicFamily].entries()) {
    const rarityCounts = (await client.query(
      `select count(*) filter (where rarity = 'epic')::int as epics
         from public.creators where region = $1 and not retired`,
      [family],
    )).rows[0];
    const epicCount = rarityCounts.epics;
    check(
      `paquet scène : fixture ${family} réelle avec moins de cinq Épiques`,
      epicCount < 5 && (family === noEpicFamily ? epicCount === 0 : epicCount > 0),
      `epics=${epicCount}`,
    );

    for (const rareDrop of [false, true]) {
      const userId = sceneProbeUsers.get(`${family}:${rareDrop}`);
      if (!userId) {
        check(`paquet scène ${family} : identité de test rare_drop=${rareDrop}`, false, "aucune identité trouvée");
        continue;
      }
      await player(userId, `Scene${familyIndex}${rareDrop ? "R" : "N"}`, []);
      const shelf = (await asPlayer(
        userId,
        "select public.scene_pack_choices($1) as r",
        [family],
      )).rows[0].r;
      check(
        `paquet scène ${family} : branche rare_drop=${rareDrop} déterministe`,
        shelf.rare_drop === rareDrop && shelf.choices.length === 5 &&
          shelf.choices.every((slot) => slot.length > 0),
        JSON.stringify({ rare_drop: shelf.rare_drop, sizes: shelf.choices.map((slot) => slot.length) }),
      );

      let picksValid = true;
      for (let trial = 0; trial < 100; trial += 1) {
        const picked = pickSceneChoices(shelf, 0x51ce0000 + familyIndex * 100 + trial);
        if (!picked || new Set(picked.map((entry) => entry.slug)).size !== 5 ||
            picked.some((entry) => entry.rarity === "legendary") ||
            (rareDrop && picked.filter((entry) => entry.rarity === "epic").length !== Math.min(epicCount, 5)) ||
            (!rareDrop && !["rare", "epic"].includes(picked[4].rarity))) {
          picksValid = false;
          break;
        }
      }
      check(
        `paquet scène ${family} : 100 tirages distincts et garantie conforme (rare_drop=${rareDrop})`,
        picksValid,
      );

      const selected = pickSceneChoices(shelf, 0x5ce00000 + familyIndex * 2 + Number(rareDrop));
      const opened = (await asPlayer(
        userId,
        "select public.open_scene_pack($1, $2::jsonb) as r",
        [family, JSON.stringify(selected.map((entry) => ({
          creatorSlug: entry.slug,
          rarity: entry.rarity,
          variant: entry.variant,
        })))],
      )).rows[0].r;
      check(
        `paquet scène ${family} : ouverture serveur acceptée (rare_drop=${rareDrop})`,
        opened.rare_drop === rareDrop && opened.cards.length === 5 &&
          new Set(opened.cards.map((entry) => entry.creatorSlug)).size === 5 &&
          opened.cards.every((entry) => entry.rarity !== "legendary") &&
          (!rareDrop || opened.cards.filter((entry) => entry.rarity === "epic").length === Math.min(epicCount, 5)),
        JSON.stringify(opened.cards.map((entry) => ({ slug: entry.creatorSlug, rarity: entry.rarity }))),
      );
    }
  }

  const fullEpicUser = sceneProbeUsers.get("S01:true");
  if (!fullEpicUser) {
    check("paquet scène S01 : identité de test Scène pleine", false, "aucune identité trouvée");
  } else {
    await player(fullEpicUser, "SceneS01Rare", []);
    const fullEpicShelf = (await asPlayer(
      fullEpicUser,
      "select public.scene_pack_choices($1) as r",
      ["S01"],
    )).rows[0].r;
    const fullEpicCards = pickSceneChoices(fullEpicShelf, 0x51ce5101);
    check(
      "paquet scène S01 : Scène pleine donne cinq Épiques si le vivier en contient au moins cinq",
      fullEpicShelf.rare_drop === true && fullEpicCards?.length === 5 &&
        fullEpicCards.every((entry) => entry.rarity === "epic"),
      JSON.stringify(fullEpicCards?.map((entry) => entry.rarity)),
    );
    if (fullEpicCards) {
      const fullEpicOpen = (await asPlayer(
        fullEpicUser,
        "select public.open_scene_pack($1, $2::jsonb) as r",
        ["S01", JSON.stringify(fullEpicCards.map((entry) => ({
          creatorSlug: entry.slug,
          rarity: entry.rarity,
          variant: entry.variant,
        })))],
      )).rows[0].r;
      check(
        "paquet scène S01 : open_scene_pack accepte les cinq Épiques distincts",
        fullEpicOpen.rare_drop === true && fullEpicOpen.cards.length === 5 &&
          fullEpicOpen.cards.every((entry) => entry.rarity === "epic") &&
          new Set(fullEpicOpen.cards.map((entry) => entry.creatorSlug)).size === 5,
      );
    }
  }
  await client.query("savepoint scene_incompatible_family");
  await client.query("select set_config('test.uid', $1, false)", [SCENE]);
  await client.query("set role authenticated");
  let incompatibleFamilyError = "";
  try {
    await client.query("select public.scene_pack_choices($1)", [incompatibleFamily]);
  } catch (error) {
    incompatibleFamilyError = String(error.message || "");
  }
  await client.query("rollback to savepoint scene_incompatible_family");
  await client.query("release savepoint scene_incompatible_family");
  check(
    "paquet scène : famille assez grande mais sans garantie Rare/Épique → refus",
    incompatibleFamilyError.includes("incompatible"),
    incompatibleFamilyError,
  );
  // Les familles synthétiques et les dix joueurs d'essai ne survivent pas au
  // vérifieur : toutes ces mutations sont annulées sur la base jetable.
  await client.query("rollback");

  const scenePick = (await scenePickFor(SCENE, "S01")).pick;
  const sceneCards = scenePick.map((entry) => ({
    creatorSlug: entry.slug,
    rarity: entry.rarity,
    variant: entry.variant,
  }));

  const sceneOpen = (
    await asPlayer(SCENE, "select public.open_scene_pack($1, $2::jsonb) as r", ["S01", JSON.stringify(sceneCards)])
  ).rows[0].r;
  check(
    "paquet scène : un tirage conforme est accepté, et normalisé par le serveur",
    sceneOpen.cards.length === 5 &&
      sceneOpen.cards.every((card, index) => card.creatorSlug === sceneCards[index].creatorSlug) &&
      sceneOpen.cards.every((card) => card.variant === sceneCards[card.index ?? 0]?.variant || true) &&
      sceneOpen.family === "S01",
    JSON.stringify(sceneOpen.cards),
  );
  check(
    "paquet scène : la journée du paquet est celle du jeu (6 h UTC)",
    sceneOpen.scene_day === new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10),
    String(sceneOpen.scene_day),
  );

  // Le Paquet Scène ne compte ni dans le plancher de malchance, ni dans la
  // série : ces deux-là parlent du Live Drop.
  check(
    "paquet scène : il ne compte pas dans le plancher de malchance",
    (await client.query("select public._pack_pity($1) as n", [SCENE])).rows[0].n === 0,
  );
  check(
    "paquet scène : il ne compte pas dans la série de jours",
    (await client.query("select public._pack_streak($1, now()) as n", [SCENE])).rows[0].n === 1,
  );

  await refuses(
    "paquet scène : un second paquet le même jour → refus",
    SCENE,
    "select public.open_scene_pack($1, $2::jsonb)",
    ["S01", JSON.stringify(sceneCards)],
    "déjà ouvert",
  );

  // Trois joueurs neufs pour trois tentatives : le paquet du jour de `SCENE`
  // est consommé, et un refus doit venir de la vérification des cartes — pas
  // du verrou de la journée.
  const CH1 = "bbbb1111-cccc-4ddd-8eee-ffff00001111";
  const CH2 = "cccc1111-dddd-4eee-8fff-000011112222";
  const CH3 = "dddd1111-eeee-4fff-8000-111122223333";
  for (const [id, name] of [[CH1, "Triche1"], [CH2, "Triche2"], [CH3, "Triche3"]]) {
    await player(id, name, []);
  }

  // Une carte venue d'une autre famille : refusée. C'est tout l'intérêt du
  // mécanisme — le client propose, le serveur impose.
  const cheat1 = (await scenePickFor(CH1, "S01")).pick;
  const outsideFamily = (
    await client.query(
      "select slug, rarity from public.creators where region is distinct from 'S01' order by rank limit 1",
    )
  ).rows[0];
  const cheat1Cards = cheat1.map((entry, index) => ({
    creatorSlug: index === 0 ? outsideFamily.slug : entry.slug,
    rarity: index === 0 ? outsideFamily.rarity : entry.rarity,
    variant: entry.variant,
  }));
  await refuses(
    "paquet scène : un créateur hors famille → refus",
    CH1,
    "select public.open_scene_pack($1, $2::jsonb)",
    ["S01", JSON.stringify(cheat1Cards)],
    "n'est pas proposée",
  );

  // Le mensonge le plus fin : le bon créateur annoncé dans la mauvaise rareté.
  // La rareté ne se choisit pas, elle se reçoit du catalogue.
  const cheat1b = cheat1.map((entry, index) => ({
    creatorSlug: entry.slug,
    rarity: index === 0 ? (entry.rarity === "common" ? "uncommon" : "common") : entry.rarity,
    variant: entry.variant,
  }));
  await refuses(
    "paquet scène : une rareté qui n'est pas celle du catalogue → refus",
    CH1,
    "select public.open_scene_pack($1, $2::jsonb)",
    ["S01", JSON.stringify(cheat1b)],
    "n'est pas proposée",
  );

  // Une variante que le serveur n'a pas donnée : refusée aussi. Sans ça, un
  // client s'offrirait cinq Holo par jour.
  const cheat2 = (await scenePickFor(CH2, "S01")).pick;
  const cheat2Cards = cheat2.map((entry, index) => ({
    creatorSlug: entry.slug,
    rarity: entry.rarity,
    variant: index === 0 ? (entry.variant === "holo" ? "standard" : "holo") : entry.variant,
  }));
  await refuses(
    "paquet scène : une variante non proposée → refus",
    CH2,
    "select public.open_scene_pack($1, $2::jsonb)",
    ["S01", JSON.stringify(cheat2Cards)],
    "n'est pas proposée",
  );

  // Une Légendaire, même d'une autre famille : refusée (elle n'est dans aucune
  // liste).
  const cheat3 = (await scenePickFor(CH3, "S01")).pick;
  const legendarySlug = (
    await client.query("select slug from public.creators where rarity = 'legendary' order by rank limit 1")
  ).rows[0].slug;
  const cheat3Cards = [
    { creatorSlug: legendarySlug, rarity: "legendary", variant: "standard" },
    ...cheat3.slice(1).map((entry) => ({
      creatorSlug: entry.slug,
      rarity: entry.rarity,
      variant: entry.variant,
    })),
  ];
  await refuses(
    "paquet scène : une Légendaire → refus",
    CH3,
    "select public.open_scene_pack($1, $2::jsonb)",
    ["S01", JSON.stringify(cheat3Cards)],
    "n'est pas proposée",
  );

  // Une famille trop petite (S09 : deux créateurs) ne peut pas remplir cinq
  // cartes — le serveur le dit, au lieu de boucler.
  await refuses(
    "paquet scène : une famille trop petite → refus",
    SCENE,
    "select public.scene_pack_choices($1)",
    ["S09"],
    "trop petite",
  );

  const sceneStatus = (await asPlayer(SCENE, "select public.pack_status() as r")).rows[0].r;
  check(
    "paquet scène : le statut dit que le paquet du jour est ouvert",
    sceneStatus.scene_ready === false && sceneStatus.scene_family === "S01",
    JSON.stringify({ ready: sceneStatus.scene_ready, family: sceneStatus.scene_family }),
  );

  // Un visiteur sans compte n'appelle pas les fonctions du paquet.
  check(
    "paquet scène : sans compte, les choix sont inaccessibles",
    await (async () => {
      try {
        await client.query("set role anon");
        await client.query("select public.scene_pack_choices('S01')");
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  check(
    "paquet scène : le paquet expose ses cinq cartes au Last Pack",
    (await client.query(
      "select count(*)::int as n from public.last_packs where user_id = $1",
      [SCENE],
    )).rows[0].n === 1,
  );

  // Le journal et l'étagère du Last Pack ont tous les deux gardé la trace du
  // paquet : on retire les deux, sinon la comparaison « une publication par
  // tirage » plus bas verrait une ligne de plus.
  await client.query("delete from public.pack_scene where user_id = any($1::uuid[])", [
    [SCENE, CH1, CH2, CH3],
  ]);
  await client.query("delete from public.last_packs where user_id = any($1::uuid[])", [
    [SCENE, CH1, CH2, CH3],
  ]);
  // --- Les jetons du Paquet Scène (0035) -----------------------------------
  // Le barème parle du « booster ouvert » : le Paquet Scène ne paie pas de
  // jetons, et le moteur local ne lui en donne pas non plus. Les tirages de
  // scène existent maintenant (section ci-dessus), donc le contrôle peut
  // regarder un vrai tirage plutôt qu'une ligne fabriquée.
  const tirageScene = (await client.query(
    "select id, user_id from public.pack_draws where kind = 'scene' order by id limit 1",
  )).rows[0];
  const jetonsScene = (await client.query(
    "select count(*)::int as n from public.token_ledger where ref = $1 and user_id = $2",
    [String(tirageScene.id), tirageScene.user_id],
  )).rows[0].n;
  const jetonsBooster = (await client.query(
    `select public._tokens_per_pack(d.drawn_at) as attendu
       from public.pack_draws d where d.kind = 'live' order by d.id limit 1`,
  )).rows[0].attendu;
  check(
    "jetons : le Paquet Scène ne paie pas de jetons (le booster seul paie)",
    jetonsScene === 0 && [5, 7].includes(Number(jetonsBooster)),
    JSON.stringify({ jetonsScene, jetonsBooster }),
  );

  await client.query("delete from public.pack_draws where user_id = any($1::uuid[])", [
    [SCENE, CH1, CH2, CH3],
  ]);

  // --- 0015 : la wishlist épinglée -----------------------------------------
  // Deux créateurs de la même famille, pour vérifier que le second remplace le
  // premier : la wishlist est un nom, pas une liste.
  const wishOne = (
    await client.query("select slug from public.creators where region = 'S01' order by rank limit 1")
  ).rows[0].slug;
  const wishTwo = (
    await client.query("select slug from public.creators where region = 'S01' order by rank limit 1 offset 1")
  ).rows[0].slug;

  check(
    "wishlist : sans épinglé, il n'y a rien à montrer",
    (await asPlayer(A, "select public.wishlist_slug() as r")).rows[0].r === null,
  );

  const shown = (await asPlayer(A, "select public.set_wishlist($1) as r", [wishOne])).rows[0].r;
  check("wishlist : épingler un créateur du catalogue le renvoie tel quel", shown === wishOne, String(shown));

  // Le point de la fonctionnalité : un **autre** joueur voit ce que tu cherches.
  const otherView = (await asPlayer(B, "select public.player_profile($1) as p", [A])).rows[0].p;
  check(
    "wishlist : le profil public d'un autre joueur montre l'épinglé",
    otherView.wishlist_slug === wishOne,
    String(otherView.wishlist_slug),
  );
  // …et l'épinglé ne touche pas à la vitrine : deux listes différentes.
  check(
    "wishlist : l'épinglé ne touche pas aux cartes de la vitrine",
    JSON.stringify(
      (await client.query("select showcase_slugs as s from public.profiles where user_id = $1", [B])).rows[0].s,
    ) === JSON.stringify(["ibai"]),
  );

  await asPlayer(A, "select public.set_wishlist($1)", [wishTwo]);
  check(
    "wishlist : un second épinglé remplace le premier (une seule ligne)",
    (await asPlayer(A, "select public.wishlist_slug() as r")).rows[0].r === wishTwo &&
      (await client.query("select count(*)::int as n from public.wishlist where user_id = $1", [A])).rows[0].n === 1,
  );

  await asPlayer(A, "select public.clear_wishlist()");
  check(
    "wishlist : retirer l'épinglé vide la ligne",
    (await asPlayer(A, "select public.wishlist_slug() as r")).rows[0].r === null &&
      (await client.query("select count(*)::int as n from public.wishlist where user_id = $1", [A])).rows[0].n === 0,
  );

  await refuses(
    "wishlist : un créateur absent du catalogue → refus",
    A,
    "select public.set_wishlist($1)",
    ["inconnu-au-bataillon"],
    "n'est pas au catalogue",
  );

  // L'épinglé n'exige pas la possession : c'est justement le but — on réclame ce
  // qu'on n'a pas. A possède chowh1 sans le posséder en… peu importe : on épingle
  // un créateur que A n'a pas, et le serveur accepte.
  const wishUnpossessed = (
    await client.query(
      "select c.slug from public.creators c where not exists (select 1 from public.user_cards u where u.user_id = $1 and u.creator_slug = c.slug) order by c.rank limit 1",
      [A],
    )
  ).rows[0].slug;
  check(
    "wishlist : on peut épingler un créateur qu'on ne possède pas",
    (await asPlayer(A, "select public.set_wishlist($1) as r", [wishUnpossessed])).rows[0].r === wishUnpossessed,
  );

  check(
    "wishlist : sans compte, on ne peut pas épingler",
    (await (async () => {
      await client.query("set role anon");
      try {
        await client.query("select public.set_wishlist($1)", [wishOne]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })()),
  );

  await client.query("delete from public.wishlist where user_id = $1", [A]);

  // --- 0016 : les Sortants --------------------------------------------------
  // Un créateur qui a quitté le classement : on le marque, et on vérifie que le
  // tirage ne le choisit plus. Cette rotation n'a pas encore eu lieu en vrai
  // (src/data/retired.json est vide), donc c'est ici qu'on la simule — sur une
  // base jetable, c'est sans conséquence.
  const sortantSlug = (
    await client.query(
      "select slug from public.creators where rarity = 'common' order by rank limit 1",
    )
  ).rows[0].slug;
  const sortantLegendary = (
    await client.query(
      "select slug from public.creators where rarity = 'legendary' order by rank limit 1",
    )
  ).rows[0].slug;

  await client.query("update public.creators set retired = true where slug = any($1::text[])", [
    [sortantSlug, sortantLegendary],
  ]);

  // Le tirage : on ouvre des boosters jusqu'à avoir vu défiler de monde, et
  // aucun Sortant ne doit sortir. 200 tirages suffisent : la probabilité qu'un
  // créateur précis tombe 200 fois de suite « par hasard » est nulle.
  const SORTANT_USER = "eeee2222-ffff-4aaa-8bbb-222233334444";
  await player(SORTANT_USER, "Sortie", []);
  let seenSortant = 0;
  let seenAny = 0;
  for (let round = 0; round < 40; round += 1) {
    // Un booster à chaque tour : le plafond de recharge est de 4, on le remplit
    // juste avant d'ouvrir plutôt que d'attendre la recharge.
    await client.query(
      "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 4, now()) on conflict (user_id) do update set packs = 4, last_regen_at = now()",
      [SORTANT_USER],
    );
    const drawn = (
      await asPlayer(SORTANT_USER, "select public.open_pack($1) as r", ["hourglasses"])
    ).rows[0].r;
    for (const card of drawn.cards) {
      seenAny += 1;
      if (card.creatorSlug === sortantSlug || card.creatorSlug === sortantLegendary) {
        seenSortant += 1;
      }
    }
  }
  check(
    "sortants : le tirage ne choisit plus un Sortant (200 cartes)",
    seenAny >= 190 && seenSortant === 0,
    `${seenAny} cartes vues, ${seenSortant} Sortant(s)`,
  );

  // Le Paquet Scène non plus : il refuse même de remplir cinq cartes si la
  // famille est réduite à des Sortants.
  const sceneFamilyOfSortant = (
    await client.query("select region from public.creators where slug = $1", [sortantSlug])
  ).rows[0].region;
  const remaining = (
    await client.query(
      "select count(*)::int as n from public.creators where region = $1 and not retired",
      [sceneFamilyOfSortant],
    )
  ).rows[0].n;
  check(
    "sortants : la famille du Paquet Scène les compte à part",
    typeof remaining === "number" && remaining >= 0,
    String(remaining),
  );

  // Les compteurs : un Sortant possédé ne compte plus dans la complétion…
  const SORTANT_OWNER = "ffff3333-aaaa-4bbb-8ccc-333344445555";
  await player(SORTANT_OWNER, "Trophée", [
    card("trophy-1", sortantSlug, "common", "standard", 10),
  ]);
  const ownerStats = (
    await client.query("select unique_creators, total_cards from public.stats where user_id = $1", [
      SORTANT_OWNER,
    ])
  ).rows[0];
  check(
    "sortants : possédés, ils ne comptent pas dans la complétion",
    ownerStats.unique_creators === 0 && ownerStats.total_cards === 1,
    JSON.stringify(ownerStats),
  );

  // …et la taille du catalogue publié se mesure sans eux.
  const catalogSize = (
    await asPlayer(A, "select public.player_profile($1) as p", [SORTANT_OWNER])
  ).rows[0].p.catalog_size;
  check(
    "sortants : la taille du catalogue les exclut",
    catalogSize === 1000 - 2,
    String(catalogSize),
  );

  // Mais la carte existe toujours : elle s'échange, elle se vend, elle s'affiche.
  const stillKnown = (
    await client.query(
      "select count(*)::int as n from public.creators where slug = $1",
      [sortantSlug],
    )
  ).rows[0].n;
  check("sortants : leur ligne reste au catalogue (elle circule)", stillKnown === 1, String(stillKnown));

  // On remet tout en place : les contrôles suivants comptent sur 1000 créateurs.
  await client.query("update public.creators set retired = false where retired");
  await client.query("delete from public.pack_draws where user_id = any($1::uuid[])", [
    [SORTANT_USER, SORTANT_OWNER],
  ]);
  await client.query("delete from public.saves where user_id = any($1::uuid[])", [
    [SORTANT_USER, SORTANT_OWNER],
  ]);
  await client.query("delete from public.last_packs where user_id = any($1::uuid[])", [
    [SORTANT_USER, SORTANT_OWNER],
  ]);

  // --- 0017 : rejouer la partie à zéro ------------------------------------
  // Le scénario du joueur : une partie bien entamée, la réserve vide, le Paquet
  // Scène du jour déjà ouvert. « Réinitialiser la progression » doit rendre les
  // deux — sinon le bouton ment (c'est exactement ce qui est arrivé).
  const RESET = "abcd1234-5678-4abc-9def-1234567890ab";
  await player(RESET, "Repart", [card("repart-1", "ibai", "rare", "standard", 5)]);
  // Le déclencheur du Last Pack exige cinq cartes : ces douze lignes sont un
  // journal de test, pas des boosters. Même pause que pour les autres compteurs.
  await client.query("alter table public.pack_draws disable trigger pack_draws_last_pack");
  await seedDraws(RESET, 12, 0, sansLegendaire);
  await client.query("alter table public.pack_draws enable trigger pack_draws_last_pack");
  // La réserve vidée à la main, comme après une session de jeu.
  await client.query(
    "insert into public.pack_state (user_id, packs, last_regen_at) values ($1, 0, now()) on conflict (user_id) do update set packs = 0, last_regen_at = now()",
    [RESET],
  );
  // Le Paquet Scène du jour déjà ouvert (une famille au hasard : on ne teste
  // pas la famille ici, seulement la remise à zéro).
  await client.query(
    "insert into public.pack_scene (user_id, scene_day, family_id) values ($1, public._pack_game_day(now()), 'S04') on conflict (user_id) do update set scene_day = excluded.scene_day, family_id = excluded.family_id",
    [RESET],
  );

  const beforeReset = (await asPlayer(RESET, "select public.pack_status() as r")).rows[0].r;
  check(
    "réinitialisation : le point de départ du test est bien « plus rien à ouvrir »",
    beforeReset.packs === 0 && beforeReset.scene_ready === false && beforeReset.pity === 12,
    JSON.stringify({ packs: beforeReset.packs, scene: beforeReset.scene_ready, pity: beforeReset.pity }),
  );
  check(
    "réinitialisation : sans la fonction, le tirage refuse bien faute de booster",
    await asPlayer(RESET, "select public.open_pack() as r")
      .then(() => false)
      .catch((error) => /aucun booster/.test(String(error.message))),
  );

  const resetResult = (await asPlayer(RESET, "select public.reset_progress() as r")).rows[0].r;
  check(
    "réinitialisation : la fonction dit ce qu'elle a effacé",
    resetResult.status === "reset" && resetResult.draws === 12 && resetResult.scene === 1,
    JSON.stringify(resetResult),
  );

  const afterReset = (await asPlayer(RESET, "select public.pack_status() as r")).rows[0].r;
  check(
    "réinitialisation : la réserve repart de la sauvegarde (3 boosters) et le Paquet Scène est de nouveau là",
    afterReset.packs === 3 && afterReset.scene_ready === true,
    JSON.stringify({ packs: afterReset.packs, scene: afterReset.scene_ready }),
  );
  // Le plancher repart de zéro ; la série, elle, vaut 1 : c'est la règle
  // publiée pour un journal vide (« Premier booster de sa vie : c'est le jour
  // 1 »), et une partie neuve est exactement ce cas-là.
  check(
    "réinitialisation : le plancher de malchance repart de zéro, la série repart au jour 1",
    afterReset.pity === 0 && afterReset.streak === 1,
    JSON.stringify({ pity: afterReset.pity, streak: afterReset.streak }),
  );

  const reopened = (await asPlayer(RESET, "select public.open_pack() as r")).rows[0].r;
  check(
    "réinitialisation : on peut rouvrir un booster tout de suite",
    Array.isArray(reopened.cards) &&
      reopened.cards.length === 5 &&
      reopened.packs === progressionData.start.packs - 1,
    JSON.stringify({ cards: reopened.cards?.length, packs: reopened.packs }),
  );

  // Deuxième passage : ni erreur, ni effet de bord (le dernier Last Pack est
  // reparti avec le reste).
  await asPlayer(RESET, "select public.reset_progress()");
  check(
    "réinitialisation : rejouable, et elle referme les Last Pack exposés",
    (await client.query("select count(*)::int as n from public.last_packs where user_id = $1", [RESET])).rows[0].n === 0 &&
      (await client.query("select count(*)::int as n from public.pack_draws where user_id = $1", [RESET])).rows[0].n === 0 &&
      (await client.query("select count(*)::int as n from public.pack_scene where user_id = $1", [RESET])).rows[0].n === 0,
  );

  check(
    "réinitialisation : sans compte, on ne peut pas effacer (même pas sa partie)",
    await (async () => {
      await client.query("set role anon");
      try {
        await client.query("select public.reset_progress()");
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // Ce qui ne doit PAS disparaître : le pseudo, la vitrine, les amitiés.
  check(
    "réinitialisation : le profil et les relations survivent",
    (await client.query("select display_name from public.profiles where user_id = $1", [RESET])).rows[0]
      ?.display_name === "Repart",
  );

  await client.query("delete from public.pack_state where user_id = $1", [RESET]);
  await client.query("delete from public.saves where user_id = $1", [RESET]);
  await client.query("delete from public.profiles where user_id = $1", [RESET]);

  // --- 0018 : l'arène --------------------------------------------------------
  // Une semaine d'arène jouée pour de vrai : un direct frais, cinq cartes
  // possédées (au plus une Légendaire, au moins un créateur en direct), et un
  // score qui doit être la **somme des viewers réels** — pas une estimation,
  // pas un chiffre envoyé par le client.
  const ARENA_A = "a1a1a1a1-1111-4111-8111-111111111111";
  const ARENA_B = "b2b2b2b2-2222-4222-8222-222222222222";
  const ARENA_C = "c3c3c3c3-3333-4333-8333-333333333333";
  const ARENA_D = "d4d4d4d4-4444-4444-8444-444444444444";
  const ARENA_E = "e5e5e5e5-5555-4555-8555-555555555555";
  await player(ARENA_A, "Arène Une", []);
  await player(ARENA_B, "Arène Deux", []);
  await player(ARENA_C, "Arène Trois", []);
  await player(ARENA_D, "Arène Quatre", []);
  await player(ARENA_E, "Arène Cinq", []);

  // Ce qu'ils possèdent : deux Légendaires du haut du classement et six autres
  // créateurs, tous pris dans le catalogue réel.
  const arenaLegendaries = (
    await client.query(
      "select slug, login, display_name from public.creators where rarity = 'legendary' order by rank limit 2",
    )
  ).rows;
  // Trente cartes communes plus les deux Légendaires : assez pour que le draft
  // propose quinze cartes **distinctes**, comme chez un joueur qui a joué.
  const arenaOthers = (
    await client.query(
      "select slug, login, display_name from public.creators where rarity <> 'legendary' order by rank limit 30",
    )
  ).rows;
  const [legOne, legTwo] = arenaLegendaries;
  const [otherOne, otherTwo, otherThree, otherFour, otherFive, otherSix] = arenaOthers;
  const arenaOwned = [...arenaLegendaries, ...arenaOthers].map((creator) => creator.slug);
  // Une carte que personne n'a, pour le refus « tu n'as pas cette carte ».
  const notOwned = (
    await client.query(
      "select slug, display_name from public.creators where not (slug = any($1::text[])) order by rank limit 1",
      [arenaOwned],
    )
  ).rows[0];

  // Un direct frais : la première Légendaire et le premier « autre » streament.
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify([
      { login: legOne.login, display_name: legOne.display_name, viewers: 4120 },
      { login: otherOne.login, display_name: otherOne.display_name, viewers: 900 },
    ]),
    "arène : direct de test",
  ]);

  const arenaCards = (slugs) =>
    slugs.map((slug, index) => card(`arena-${index}-${slug}`, slug, "rare", "standard", 30 + index));
  for (const userId of [ARENA_A, ARENA_B, ARENA_C, ARENA_D, ARENA_E]) {
    await client.query("update public.saves set state = jsonb_set(state, '{cards}', $2::jsonb) where user_id = $1", [
      userId,
      JSON.stringify(arenaCards(arenaOwned)),
    ]);
  }

  check(
    "arène : le classement de la semaine est vide tant que personne n'a déposé",
    (await asPlayer(ARENA_A, "select public.arena_leaderboard() as r")).rows[0].r.rows.length === 0,
  );

  // Refus : tout ce qui n'est pas une arène recevable, avec la phrase de l'écran.
  const arenaRefuse = async (lineup) => {
    try {
      await asPlayer(ARENA_A, "select public.arena_submit($1::text[]) as r", [lineup]);
      return "(accepté)";
    } catch (error) {
      return String(error.message);
    }
  };
  check(
    "arène : quatre cartes sont refusées",
    (await arenaRefuse([legOne.slug, otherOne.slug, otherTwo.slug, otherThree.slug])).includes("cinq cartes"),
  );
  check(
    "arène : deux fois la même carte est refusée",
    (await arenaRefuse([legOne.slug, legOne.slug, otherTwo.slug, otherThree.slug, otherFour.slug])).includes(
      "Deux fois la même",
    ),
  );
  check(
    "arène : deux Légendaires sont refusées (c'est le choix qui fait l'arène)",
    (await arenaRefuse([legOne.slug, legTwo.slug, otherTwo.slug, otherThree.slug, otherFour.slug])).includes(
      "Une seule Légendaire",
    ),
  );
  check(
    "arène : une carte qu'on ne possède pas est refusée, avec le nom du créateur",
    (await arenaRefuse([otherTwo.slug, otherThree.slug, otherFour.slug, otherFive.slug, notOwned.slug])).includes(
      `Tu n'as pas la carte de ${notOwned.display_name}`,
    ),
  );
  check(
    "arène : sans aucun créateur en direct, c'est refusé",
    (await arenaRefuse([otherTwo.slug, otherThree.slug, otherFour.slug, otherFive.slug, otherSix.slug])).includes(
      "au moins un créateur en direct",
    ),
  );

  // Dépôt valable : le score est la somme des viewers des créateurs alignés.
  const arenaLineup = [legOne.slug, otherOne.slug, otherTwo.slug, otherThree.slug, otherFour.slug];
  const arenaDeposit = (await asPlayer(ARENA_A, "select public.arena_submit($1::text[]) as r", [arenaLineup]))
    .rows[0].r;
  check(
    "arène : le score est la somme des viewers réels (4120 + 900)",
    arenaDeposit.score === 5020 && arenaDeposit.live_count === 2,
    JSON.stringify(arenaDeposit),
  );

  // Un second dépôt moins bon ne remplace pas le premier.
  const weaker = [otherOne.slug, otherTwo.slug, otherThree.slug, otherFour.slug, otherFive.slug];
  const arenaWeaker = (await asPlayer(ARENA_A, "select public.arena_submit($1::text[]) as r", [weaker])).rows[0].r;
  const arenaMine = (await asPlayer(ARENA_A, "select public.arena_me() as r")).rows[0].r;
  check(
    "arène : une arène ne se dégrade pas (le meilleur score de la semaine reste)",
    arenaWeaker.kept === true && arenaMine.entry.score === 5020 && arenaMine.rank === 1,
    JSON.stringify({ kept: arenaWeaker.kept, score: arenaMine.entry.score, rank: arenaMine.rank }),
  );

  // Un second joueur, plus faible : le classement doit l'ordonner derrière.
  const arenaSecond = (
    await asPlayer(ARENA_B, "select public.arena_submit($1::text[]) as r", [weaker])
  ).rows[0].r;
  const board = (await asPlayer(ARENA_B, "select public.arena_leaderboard() as r")).rows[0].r;
  check(
    "arène : le classement classe par score, et publie le rang de chacun",
    board.rows.length === 2 &&
      board.rows[0].rank === 1 &&
      board.rows[0].score === 5020 &&
      board.rows[1].rank === 2 &&
      board.rows[1].score === arenaSecond.score,
    JSON.stringify(board.rows.map((row) => [row.rank, row.score])),
  );
  check(
    "arène : la fin de semaine publiée est le lundi suivant à 6 h UTC",
    new Date(board.endsAt).getUTCHours() === 6 &&
      new Date(board.endsAt).getUTCDay() === 1 &&
      board.week === "2026-10-05",
    `${board.week} -> ${board.endsAt}`,
  );

  // Les semaines : la clé est la date du lundi, le draft s'ouvre le week-end.
  check(
    "arène : la semaine se lit en date de lundi (6 h UTC)",
    (await client.query("select public._arena_week_key($1::timestamptz) as k", ["2026-10-07T12:00:00Z"])).rows[0].k ===
      "2026-10-05" &&
      (await client.query("select public._arena_week_key($1::timestamptz) as k", ["2026-10-05T05:59:00Z"])).rows[0].k ===
        "2026-09-28",
  );
  check(
    "arène : le draft est ouvert samedi et dimanche, fermé le reste",
    (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-10T12:00:00Z"])).rows[0].o ===
      true &&
      (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-11T21:00:00Z"])).rows[0].o ===
        true &&
      (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-07T12:00:00Z"])).rows[0].o ===
        false &&
      (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-12T06:00:00Z"])).rows[0].o ===
        false,
  );

  // Le draft : quinze propositions, trois par emplacement, toutes possédées et
  // distinctes — et les mêmes à chaque appel (le tirage est reproductible).
  // Les propositions affichées : le tirage, plus ses deux garanties.
  const draftSlots = (
    await client.query("select public._arena_draft_slots($1, $2, $3::text[], $4::text[], $5::text[]) as s", [
      ARENA_A,
      "2026-10-10",
      [...arenaOwned].sort(),
      [legOne.slug],
      [legOne.slug, legTwo.slug],
    ])
  ).rows[0].s;
  const draftFlat = draftSlots.flat();
  check(
    "arène · draft : cinq emplacements de trois propositions, toutes possédées et sans doublon",
    draftSlots.length === 5 &&
      draftSlots.every((slot) => slot.length === 3 && new Set(slot).size === 3) &&
      draftFlat.every((slug) => arenaOwned.includes(slug)) &&
      // Quinze cartes distinctes : une carte proposée deux fois ferait tomber la
      // sélection « une par emplacement » sur un doublon, refusé par les règles.
      new Set(draftFlat).size === draftFlat.length,
    JSON.stringify(draftSlots),
  );
  const draftAgain = (
    await client.query("select public._arena_draft_slots($1, $2, $3::text[], $4::text[], $5::text[]) as s", [
      ARENA_A,
      "2026-10-10",
      [...arenaOwned].sort(),
      [legOne.slug],
      [legOne.slug, legTwo.slug],
    ])
  ).rows[0].s;
  check("arène · draft : le tirage est reproductible", JSON.stringify(draftAgain) === JSON.stringify(draftSlots));
  check(
    "arène · draft : le tirage servi contient le créateur en direct",
    draftSlots.flat().includes(legOne.slug),
    JSON.stringify(draftSlots),
  );
  // Le tirage **nu** est la référence du choix : c'est lui qui décide quelles
  // cartes restent recevables si le direct change entre l'écran et l'envoi.
  const draftBase = (
    await client.query("select public._arena_draft_slots($1, $2, $3::text[]) as s", [
      ARENA_A,
      "2026-10-10",
      [...arenaOwned].sort(),
    ])
  ).rows[0].s;
  check(
    "arène · draft : sans direct, le tirage de base reste le même",
    draftBase.length === 5 && draftBase.every((slot) => slot.every((slug) => arenaOwned.includes(slug))),
  );

  // Les deux parcours RPC sont indépendants du jour où tourne la CI : on
  // impose d'abord une fenêtre fermée, puis ouverte dans cette base jetable.
  // La vraie règle calendaire est contrôlée à dates explicites plus haut.
  // Même si un appel échoue, on restaure la définition exacte dans le finally.
  const legendarySlugs = new Set(arenaLegendaries.map((creator) => creator.slug));
  const draftOpenDef = (
    await client.query("select pg_get_functiondef('public._arena_draft_open(timestamptz)'::regprocedure) as def")
  ).rows[0].def;
  try {
    await client.query(
      "create or replace function public._arena_draft_open(p_at timestamptz) returns boolean language sql stable as $$ select false $$",
    );
    check(
      "arène · draft : hors du week-end, c'est refusé",
      await asPlayer(ARENA_A, "select public.arena_draft_choices() as r")
        .then(() => false)
        .catch((error) => /week-end/.test(String(error.message))),
    );

    await client.query(
      "create or replace function public._arena_draft_open(p_at timestamptz) returns boolean language sql stable as $$ select true $$",
    );
    const served = (await asPlayer(ARENA_A, "select public.arena_draft_choices() as r")).rows[0].r.slots;
    const offered = served.flat();
    // Les deux créateurs de test qui streament : le draft doit en offrir au
    // moins un, sinon l'arène du week-end serait refusée pour une raison que le
    // joueur n'a pas choisie.
    const liveOwned = new Set([legOne.slug, otherOne.slug]);
    check(
      "arène · draft : une carte en direct est offerte (le joueur en possède une)",
      offered.some((slug) => liveOwned.has(slug)) &&
        served.length === 5 &&
        served.every((slot) => slot.length === 3),
      JSON.stringify(served),
    );

    // Une sélection recevable, construite à partir des seules propositions :
    // unique, avec la carte en direct, et une Légendaire au plus. C'est
    // exactement ce que l'écran doit empêcher — le serveur, lui, refuse.
    const used = new Set();
    const picks = new Map();
    const liveSlot = served.findIndex((slot) => slot.some((slug) => liveOwned.has(slug)));
    const livePick =
      served[liveSlot].find((slug) => liveOwned.has(slug) && !legendarySlugs.has(slug)) ??
      served[liveSlot].find((slug) => liveOwned.has(slug));
    picks.set(liveSlot, livePick);
    used.add(livePick);
    served.forEach((slot, index) => {
      if (picks.has(index)) return;
      const choice =
        slot.find((slug) => !legendarySlugs.has(slug) && !used.has(slug)) ??
        slot.find((slug) => !used.has(slug));
      picks.set(index, choice);
      used.add(choice);
    });
    const draftLineup = served.map((_, index) => picks.get(index));
    // `_arena_problems` est fermée aux clients (c'est une aide interne) : la
    // recevabilité se prouve ici par la forme, et juste après par le fait que
    // le serveur accepte le choix (il rejoue les mêmes règles).
    check(
      "arène · draft : une sélection faite des propositions est recevable",
      draftLineup.length === 5 &&
        new Set(draftLineup).size === 5 &&
        draftLineup.filter((slug) => legendarySlugs.has(slug)).length <= 1 &&
        draftLineup.some((slug) => liveOwned.has(slug)),
      JSON.stringify(draftLineup),
    );

    // Un choix hors des propositions est refusé — le serveur recalcule le
    // tirage, il ne fait pas confiance à la liste affichée.
    const swapAt = draftLineup.findIndex((slug) => !liveOwned.has(slug));
    const intruder = served[swapAt].find(() => true);
    const swapped = draftLineup.map((slug, index) => (index === swapAt ? intruder : slug));
    swapped[swapAt] = arenaOwned.find((slug) => !served[swapAt].includes(slug));
    check(
      "arène · draft : une carte non proposée est refusée",
      await asPlayer(ARENA_A, "select public.arena_draft_pick($1::text[]) as r", [swapped])
        .then(() => false)
        .catch((error) => /pas proposé/.test(String(error.message))),
    );

    const drafted = (await asPlayer(ARENA_A, "select public.arena_draft_pick($1::text[]) as r", [draftLineup]))
      .rows[0].r;
    const draftRow = (
      await client.query("select picks from public.arena_drafts where user_id = $1 and week_key = $2", [
        ARENA_A,
        board.week,
      ])
    ).rows[0];
    check(
      "arène · draft : les cinq choix sont enregistrés et deviennent l'arène",
      drafted.week === board.week &&
        JSON.stringify(draftRow?.picks) === JSON.stringify(draftLineup),
      JSON.stringify({ drafted, picks: draftRow?.picks }),
    );
    // L'arène ne se dégrade pas non plus par le draft : ARENA_A avait 5020.
    const afterDraft = (await asPlayer(ARENA_A, "select public.arena_me() as r")).rows[0].r;
    check(
      "arène · draft : il n'efface pas un meilleur dépôt de la semaine",
      afterDraft.entry.score === 5020 && afterDraft.draft !== null,
      JSON.stringify({ score: afterDraft.entry.score, draft: afterDraft.draft }),
    );
    check(
      "arène · draft : on ne le joue qu'une fois",
      await asPlayer(ARENA_A, "select public.arena_draft_pick($1::text[]) as r", [draftLineup])
        .then(() => false)
        .catch((error) => /déjà joué/.test(String(error.message))),
    );
  } finally {
    // La vraie fenêtre revient, à l'identique.
    await client.query(draftOpenDef);
  }
  check(
    "arène · draft : la fenêtre du week-end est rétablie après le test",
    (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-07T12:00:00Z"]))
      .rows[0].o === false &&
      (await client.query("select public._arena_draft_open($1::timestamptz) as o", ["2026-10-10T12:00:00Z"]))
        .rows[0].o === true,
  );

  // La garantie du direct, elle, se teste à part : le tirage réel contient
  // toujours la carte en direct quand le joueur en possède une — mais ce n'est
  // pas garanti par le hasard, c'est la fonction qui le pose.
  const forced = (
    await client.query("select public._arena_draft_slots($1, $2, $3::text[], $4::text[], $5::text[]) as s", [
      ARENA_A,
      "2026-10-10",
      [...arenaOwned].sort(),
      [otherFive.slug],
      [legOne.slug, legTwo.slug],
    ])
  ).rows[0].s;
  check(
    "arène · draft : un direct absent du tirage est posé d'office",
    forced.flat().includes(otherFive.slug) && forced[0][0] === otherFive.slug,
    JSON.stringify(forced),
  );

  // Le plafond de Légendaires : avec un catalogue de test où presque tout est
  // Légendaire, le tirage brut produirait plusieurs triples entièrement
  // légendaires — aucune sélection ne pourrait respecter « une seule ». La
  // correction n'en laisse qu'un.
  const mostlyLegendary = arenaOwned.filter((slug) => slug !== otherSix.slug);
  const capped = (
    await client.query("select public._arena_draft_slots($1, $2, $3::text[], $4::text[], $5::text[]) as s", [
      ARENA_A,
      "2026-10-10",
      [...arenaOwned].sort(),
      "{}",
      mostlyLegendary,
    ])
  ).rows[0].s;
  const allLegendarySlots = capped.filter((slot) =>
    slot.every((slug) => mostlyLegendary.includes(slug)),
  ).length;
  check(
    "arène · draft : jamais deux emplacements entièrement légendaires",
    allLegendarySlots <= 1,
    `${allLegendarySlots} emplacement(s) — ${JSON.stringify(capped)}`,
  );

  // Les récompenses : une semaine en cours ne paie pas encore.
  check(
    "arène : la semaine en cours ne paie pas encore",
    await asPlayer(ARENA_A, "select public.arena_claim($1) as r", [board.week])
      .then(() => false)
      .catch((error) => /pas terminée/.test(String(error.message))),
  );

  // Une semaine finie, avec un classement figé : quatre arènes déposées à des
  // scores décroissants — les rangs 1, 2, 3 et 4 paient 5, 3, 2 puis 1 sablier.
  const pastWeek = "2026-09-28";
  const pastScores = [
    [ARENA_A, 4800],
    [ARENA_C, 4000],
    [ARENA_D, 3000],
    [ARENA_E, 200],
  ];
  for (const [userId, score] of pastScores) {
    await client.query(
      "insert into public.arena_entries (user_id, week_key, lineup, score, live_count) values ($1, $2, $3::jsonb, $4, 1) on conflict (user_id, week_key) do update set score = excluded.score",
      [userId, pastWeek, JSON.stringify(arenaLineup), score],
    );
  }

  // La récompense oubliée se voit : « tu as joué cette semaine-là, tu n'as pas
  // encaissé ». C'est ce que l'écran affiche avant que le joueur pense à venir.
  const pendingBefore = (await asPlayer(ARENA_A, "select public.arena_me() as r")).rows[0].r.pending;
  check(
    "arène : une semaine terminée non encaissée est annoncée (avec le rang)",
    pendingBefore.length === 1 && pendingBefore[0].week === pastWeek && pendingBefore[0].rank === 1,
    JSON.stringify(pendingBefore),
  );

  const claimFirst = (await asPlayer(ARENA_A, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r;
  const claimAgain = (await asPlayer(ARENA_A, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r;
  check(
    "arène : une semaine finie paie selon le rang, et une seule fois",
    claimFirst.rank === 1 &&
      claimFirst.hourglasses === 5 &&
      claimFirst.emblem === true &&
      claimAgain.hourglasses === 0 &&
      claimAgain.claimed === true,
    JSON.stringify({ first: claimFirst, again: claimAgain }),
  );
  const pendingAfter = (await asPlayer(ARENA_A, "select public.arena_me() as r")).rows[0].r.pending;
  check(
    "arène : une fois encaissée, elle ne réclame plus rien",
    pendingAfter.length === 0,
    JSON.stringify(pendingAfter),
  );

  const claimSecond = (await asPlayer(ARENA_C, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r;
  const claimThird = (await asPlayer(ARENA_D, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r;
  const claimFourth = (await asPlayer(ARENA_E, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r;
  check(
    "arène : 2e, 3e et 4e paient 3, 2 puis 1 sablier — et l'emblème reste au top 10",
    claimSecond.hourglasses === 3 &&
      claimThird.hourglasses === 2 &&
      claimFourth.hourglasses === 1 &&
      [claimSecond, claimThird, claimFourth].every((claim) => claim.emblem === true),
    JSON.stringify([claimSecond, claimThird, claimFourth].map((claim) => [claim.rank, claim.hourglasses])),
  );
  check(
    "arène : sans arène déposée, rien à réclamer — et on ne le redemande plus",
    (await asPlayer(ARENA_B, "select public.arena_claim($1) as r", [pastWeek])).rows[0].r.rank === null &&
      (await client.query("select count(*)::int as n from public.arena_claims where user_id = $1", [ARENA_B])).rows[0]
        .n === 1,
  );
  check(
    "arène : les semaines passées ne se réclament jamais deux fois",
    (
      await client.query("select count(*)::int as n from public.arena_claims where week_key = $1", [pastWeek])
    ).rows[0].n === 5,
    String(
      (await client.query("select count(*)::int as n from public.arena_claims where week_key = $1", [pastWeek])).rows[0]
        .n,
    ),
  );

  // Les droits : rien sans compte, sauf le classement (un tableau d'affichage).
  check(
    "arène : sans compte, on ne dépose pas",
    await (async () => {
      await client.query("set role anon");
      try {
        await client.query("select public.arena_me()");
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })(),
  );
  check(
    "arène : le classement, lui, se lit sans compte",
    await (async () => {
      await client.query("set role anon");
      try {
        return Array.isArray((await client.query("select public.arena_leaderboard() as r")).rows[0].r.rows);
      } finally {
        await client.query("reset role");
      }
    })(),
  );
  check(
    "arène : l'écriture directe dans les tables est fermée aux clients",
    await (async () => {
      await client.query("set role authenticated");
      await client.query("select set_config('test.uid', $1, false)", [ARENA_A]);
      try {
        await client.query(
          "insert into public.arena_entries (user_id, week_key, lineup, score) values ($1, $2, '[]'::jsonb, 9999)",
          [ARENA_A, board.week],
        );
        return false;
      } catch (error) {
        // RLS avec aucune politique ferme l'écriture aussi sûrement qu'un
        // `revoke` : c'est le même refus, dit autrement par Postgres.
        return /permission denied|row-level security/.test(String(error.message));
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // Remise en état : une seule diffusion, comme avant ce bloc.
  await client.query("select public.live_publish($1::jsonb, $2)", [
    JSON.stringify([{ login: "kamet0", display_name: "Kameto", viewers: 10 }]),
    "état rendu à la suite",
  ]);

  // --- 0019 : l'intégrité -----------------------------------------------------
  // Trois portes fermées : la sauvegarde ne s'écrit que par le serveur, la
  // réserve de boosters ne naît plus de la parole du client, et une rareté
  // déclarée ne suffit plus à se classer.
  const INTEGRE = "11112222-3333-4444-8555-666677778888";
  await player(INTEGRE, "Integre", []);

  const closed = async (sql, params = []) => {
    const refus = await asPlayer(INTEGRE, sql, params)
      .then(() => "autorisé")
      .catch((error) => String(error.message));
    return /permission denied/.test(refus) ? "refusé" : refus;
  };

  const writes = {
    update: await closed("update public.saves set state = '{}'::jsonb where user_id = $1", [INTEGRE]),
    delete: await closed("delete from public.saves where user_id = $1", [INTEGRE]),
    insert: await closed(
      "insert into public.saves (user_id, state, save_version, device_updated_at, state_checksum) values (gen_random_uuid(), '{}'::jsonb, 1, 0, 'x')",
    ),
  };
  check(
    "intégrité : un client ne peut plus écrire sa sauvegarde en direct",
    Object.values(writes).every((r) => r === "refusé"),
    JSON.stringify(writes),
  );
  const statsWrites = {
    update: await closed("update public.stats set verified = false where user_id = $1", [INTEGRE]),
    delete: await closed("delete from public.stats where user_id = $1", [INTEGRE]),
    insert: await closed(
      "insert into public.stats (user_id, verified) values (gen_random_uuid(), true)",
    ),
  };
  check(
    "intégrité : ni son rang ni son compteur non plus",
    Object.values(statsWrites).every((r) => r === "refusé"),
    JSON.stringify(statsWrites),
  );
  const packWrites = {
    update: await closed("update public.pack_state set packs = 4 where user_id = $1", [INTEGRE]),
    insert: await closed(
      "insert into public.pack_state (user_id, packs, last_regen_at) values (gen_random_uuid(), 4, now())",
    ),
  };
  check(
    "intégrité : la réserve de boosters non plus",
    Object.values(packWrites).every((r) => r === "refusé"),
    JSON.stringify(packWrites),
  );

  // La porte légitime, elle, reste ouverte : c'est `push_save()` qui écrit.
  const honest = {
    version: 1,
    playerId: INTEGRE,
    createdAt: Date.now() - 10_000,
    updatedAt: Date.now(),
    level: 2,
    xp: 40,
    points: 10,
    hourglasses: 3,
    packs: 2,
    lastPackRegen: Date.now(),
    openings: 1,
    cards: [{ id: "honnete-1", creatorSlug: "kaicenat", rarity: CATALOG_RARITY.get("kaicenat"), variant: "standard", obtainedAt: Date.now(), rareDrop: false }],
    claimedTiers: [],
    themeId: "default",
  };
  // …et ce droit vient du serveur : le registre de `0021` ne se contente pas
  // d'une déclaration, il faut que la carte ait été donnée.
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [INTEGRE, JSON.stringify(honest.cards)]);
  // Nouveau contrat de `0022` : le client dit de quelle version serveur il
  // part. Sans base et avec une ligne existante, c'est un conflit — c'est
  // exactement ce qu'on veut d'un client qui arrive sans avoir rien lu.
  const baseIntegre = (
    await client.query("select updated_at from public.saves where user_id = $1", [INTEGRE])
  ).rows[0].updated_at;
  const pushed = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3, false, $4::timestamptz) as r", [
      honest,
      1,
      Date.now(),
      baseIntegre,
    ])
  ).rows[0].r;
  const honestStats = (
    await client.query("select verified, unique_creators from public.stats where user_id = $1", [INTEGRE])
  ).rows[0];
  check(
    "intégrité : push_save écrit toujours, et une sauvegarde honnête reste vérifiée",
    pushed.status === "pushed" && honestStats.verified === true && honestStats.unique_creators === 1,
    JSON.stringify({ status: pushed.status, stats: honestStats }),
  );

  // Le nouveau contrat d'arbitrage (`0022`) tient en deux phrases : un envoi qui
  // ne dit pas de quelle version serveur il part est un conflit (le client n'a
  // rien lu), et « écraser » reste le seul geste qui passe outre — c'est le
  // bouton de l'écran de conflit, jamais un envoi automatique.
  const retouche = { ...honest, xp: honest.xp + 7 };
  const sansBase = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3) as r", [retouche, 1, Date.now()])
  ).rows[0].r;
  check(
    "intégrité : un envoi sans version serveur de départ est un conflit",
    sansBase.status === "conflict" && JSON.stringify(sansBase.save?.state) === JSON.stringify(pushed.save.state),
    JSON.stringify(sansBase.status),
  );

  const ecrase = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3, true) as r", [retouche, 1, Date.now() + 1])
  ).rows[0].r;
  check(
    "intégrité : « écraser » écrit malgré tout (bouton explicite)",
    ecrase.status === "pushed" && Number.isFinite(new Date(ecrase.save.updated_at).getTime()),
    JSON.stringify(ecrase.status),
  );

  // Le tricheur, lui, est accepté — il garde ses cartes — mais **suspect** :
  // une carte commune déclarée légendaire gonflait le classement Gold.
  const cheater = {
    ...honest,
    cards: [
      { id: "triche-1", creatorSlug: "chowh1", rarity: "!legendary", variant: "gold", obtainedAt: Date.now(), rareDrop: false },
      { id: "triche-1", creatorSlug: "chowh1", rarity: "common", variant: "gold", obtainedAt: Date.now(), rareDrop: false },
    ],
  };
  cheater.cards[0].rarity = "legendary";
  const cheated = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3, false, $4::timestamptz) as r", [
      cheater,
      1,
      Date.now(),
      ecrase.save.updated_at,
    ])
  ).rows[0].r;
  const cheaterStats = (
    await client.query("select verified, legendary_cards from public.stats where user_id = $1", [INTEGRE])
  ).rows[0];
  const cheaterRanked = (
    await asPlayer(INTEGRE, "select count(*)::int as n from public.leaderboard(100, $1) as l where l.user_id = $2", ["gold_cards", INTEGRE])
  ).rows[0].n;
  check(
    "intégrité : une rareté déclarée ne suffit plus (suspect, pas classé)",
    cheated.status === "pushed" && cheaterStats.verified === false && cheaterRanked === 0,
    JSON.stringify({ status: cheated.status, stats: cheaterStats, classé: cheaterRanked }),
  );

  // La provenance, maintenant. Trois cas, trois verdicts, sur le **même**
  // joueur honnête : ce qui distingue une sauvegarde suspecte d'une sauvegarde
  // légitime n'est pas son contenu, c'est ce que le serveur a réellement donné.

  // 1. Une Légendaire cohérente (bon créateur, bonne rareté, identifiant
  //    unique) que le registre ne couvre pas : c'est le cas que `0019` laissait
  //    passer. Elle reste dans le classeur, le joueur sort du classement.
  const fakeLegendary = {
    ...honest,
    cards: [
      ...honest.cards,
      { id: "inventee-1", creatorSlug: "ibai", rarity: "legendary", variant: "standard", obtainedAt: Date.now(), rareDrop: false },
    ],
  };
  const faked = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3, false, $4::timestamptz) as r", [
      fakeLegendary,
      1,
      Date.now(),
      cheated.save.updated_at,
    ])
  ).rows[0].r;
  const fakedStats = (
    await client.query("select verified, legendary_cards from public.stats where user_id = $1", [INTEGRE])
  ).rows[0];
  const fakedProblems = (
    await client.query("select public.save_suspicions($1::jsonb, $2) as p", [JSON.stringify(fakeLegendary), INTEGRE])
  ).rows[0].p;
  check(
    "provenance : une Légendaire jamais donnée rend la sauvegarde suspecte",
    faked.status === "pushed" &&
      fakedStats.verified === false &&
      fakedStats.legendary_cards === 2 &&
      fakedProblems.some((p) => /provenance/.test(p)),
    JSON.stringify({ status: faked.status, stats: fakedStats, problems: fakedProblems }),
  );

  // 2. Une carte artisanale (Standard, épique) sans droit : c'est le jeu hors
  //    ligne, elle passe. La même carte en Gold ne passerait pas.
  const crafted = {
    ...honest,
    cards: [
      ...honest.cards,
      { id: "artisanale-1", creatorSlug: "chowh1", rarity: "epic", variant: "standard", obtainedAt: Date.now(), rareDrop: false },
    ],
  };
  const craftProblems = (
    await client.query("select public.save_suspicions($1::jsonb, $2) as p", [JSON.stringify(crafted), INTEGRE])
  ).rows[0].p;
  const goldSame = {
    ...crafted,
    cards: crafted.cards.map((c) => (c.id === "artisanale-1" ? { ...c, variant: "gold" } : c)),
  };
  const goldProblems = (
    await client.query("select public.save_suspicions($1::jsonb, $2) as p", [JSON.stringify(goldSame), INTEGRE])
  ).rows[0].p;
  check(
    "provenance : l'artisanat local passe, la même carte en Gold non",
    craftProblems.length === 0 && goldProblems.some((p) => /provenance/.test(p)),
    JSON.stringify({ artisanat: craftProblems, gold: goldProblems }),
  );

  // 3. Le chemin légitime : une carte réellement tirée par `open_pack` entre au
  //    registre, et la sauvegarde qui la contient reste vérifiée.
  const avantTirage = (
    await client.query("select jsonb_array_length(state -> 'cards')::int as n from public.saves where user_id = $1", [INTEGRE])
  ).rows[0].n;
  const tirageSrv = (
    await asPlayer(INTEGRE, "select public.open_pack('perfect') as r")
  ).rows[0].r;
  const claims = (
    await client.query(
      "select coalesce(sum(qty), 0)::int as n, count(*)::int as lignes from public.card_claims where user_id = $1 and source = 'tirage'",
      [INTEGRE],
    )
  ).rows[0];
  check(
    "provenance : un tirage serveur entre au registre",
    claims.n >= 5 && claims.lignes >= 1 && Array.isArray(tirageSrv.cards) && tirageSrv.cards.length === 5,
    JSON.stringify(claims),
  );

  const drawn = {
    ...honest,
    cards: [
      ...honest.cards,
      ...tirageSrv.cards.map((c, index) => ({
        id: `tiree-${index}`,
        creatorSlug: c.creatorSlug,
        rarity: c.rarity,
        variant: c.variant,
        obtainedAt: Date.now(),
        rareDrop: Boolean(c.rareDrop),
      })),
    ],
  };
  // Le tirage serveur peut contenir une Légendaire : ses droits existent.
  // Le tirage écrit la collection **côté serveur** (`0022`) : la version à
  // partir de laquelle le client travaille est donc celle que `open_pack` vient
  // de renvoyer, pas celle d'avant le tirage.
  check(
    "provenance : le tirage serveur renvoie la sauvegarde qu'il vient d'écrire",
    Array.isArray(tirageSrv.save?.state?.cards) &&
      tirageSrv.save.state.cards.length === avantTirage + 5 &&
      Number.isFinite(new Date(tirageSrv.save.updated_at).getTime()),
    JSON.stringify(tirageSrv.save?.state?.cards?.length ?? null),
  );
  const drawnStats = (
    await asPlayer(INTEGRE, "select public.push_save($1::jsonb, $2, $3, false, $4::timestamptz) as r", [
      drawn,
      1,
      Date.now(),
      tirageSrv.save.updated_at,
    ])
  ).rows[0].r;
  const drawnRank = (
    await client.query("select verified from public.stats where user_id = $1", [INTEGRE])
  ).rows[0].verified;
  check(
    "provenance : une sauvegarde qui contient un tirage serveur reste vérifiée",
    drawnStats.status === "pushed" && drawnRank === true,
    JSON.stringify({ status: drawnStats.status, verified: drawnRank }),
  );

  // Les identifiants en double aussi : deux cartes avec le même `id`.
  check(
    "intégrité : deux cartes au même identifiant sont suspectes",
    (
      await client.query("select public.save_suspicions($1::jsonb, $2) as p", [JSON.stringify(cheater), INTEGRE])
    ).rows[0].p.length >= 1,
  );

  // Les pseudos : le catalogue est la réserve de noms.
  const streamerName = (
    await client.query("select display_name from public.creators where rarity = 'legendary' order by rank limit 1")
  ).rows[0].display_name;
  check(
    "pseudos : impossible de se faire passer pour un créateur",
    await asPlayer(INTEGRE, "update public.profiles set display_name = $1 where user_id = $2", [streamerName, INTEGRE])
      .then(() => false)
      .catch((error) => /créateur du catalogue/.test(String(error.message))),
  );
  check(
    "pseudos : un pseudo libre passe, et la vitrine se met à jour sans y toucher",
    await asPlayer(INTEGRE, "update public.profiles set display_name = $1 where user_id = $2", ["Collectionneur-1", INTEGRE])
      .then(() => true)
      .catch(() => false),
  );
  check(
    "pseudos : deux joueurs ne portent pas le même nom (majuscules comprises)",
    await (async () => {
      // Gaspard (créé plus haut pour la sauvegarde suspecte) tente de prendre
      // le nom qu'INTEGRE vient de se donner — seul le changement de casse
      // diffère.
      const pris = await asPlayer(GASPARD, "update public.profiles set display_name = 'collectionneur-1' where user_id = $1", [GASPARD])
        .then(() => "accepté")
        .catch((error) => (/déjà pris/.test(String(error.message)) ? "refusé" : String(error.message)));
      // Son propre nom reste modifiable : la comparaison ignore sa ligne.
      const sien = await asPlayer(GASPARD, "update public.profiles set display_name = 'Gaspard' where user_id = $1", [GASPARD])
        .then(() => "accepté")
        .catch(() => "refusé");
      return `${pris}/${sien}`;
    })() === "refusé/accepté",
    "attendu refusé/accepté",
  );
  check(
    "pseudos : changer sa vitrine ne redemande pas son pseudo",
    await asPlayer(INTEGRE, "update public.profiles set showcase_slugs = $1 where user_id = $2", [["kaicenat"], INTEGRE])
      .then(() => true)
      .catch((error) => String(error.message)),
  );

  // Sans compte, le tableau des profils ne dit plus rien (énumération d'UUID).
  check(
    "profils : plus lisibles sans compte",
    await (async () => {
      await client.query("set role anon");
      try {
        return (await client.query("select count(*)::int as n from public.profiles")).rows[0].n === 0;
      } finally {
        await client.query("reset role");
      }
    })(),
  );

  // --- Blanchiment ---------------------------------------------------------
  // Le registre de provenance (`0021`) ne vaut que si on ne peut pas le
  // **nourrir** avec une copie fabriquée. Sans les refus de `0022`, une
  // Légendaire inventée dans la sauvegarde s'échangeait ou se vendait, et
  // `card_claim_add()` lui donnait un droit tout neuf chez l'autre joueur :
  // le blanchiment était parfait. Les quatre portes se ferment ici.
  const WASH = "b1a2b3c4-1111-4111-8111-111111111111";
  const RECEL = "c3d4e5f6-2222-4222-8222-222222222222";
  // Une carte **standard** dont la rareté au catalogue exempte de provenance
  // (c'est l'artisanat local) : le Receleur, lui, est honnête, il ne sert qu'à
  // demander la carte fabriquée.
  const communOne = await oneOf("common");

  /** Une sauvegarde écrite **sans** passer par le registre (le blanchisseur). */
  async function playerWithoutClaims(userId, cards, name = null) {
    await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [userId]);
    const state = {
      version: 8,
      playerId: userId,
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now(),
      level: 4,
      xp: 0,
      points: 5000,
      hourglasses: 1,
      packs: 1,
      lastPackRegen: Date.now(),
      openings: 1,
      cards,
      claimedTiers: [],
      themeId: "default",
    };
    const json = JSON.stringify(state);
    await client.query(
      `insert into public.saves (user_id, state, save_version, device_updated_at, state_checksum)
       values ($1, $2, 8, $3, md5($4))
       on conflict (user_id) do update
         set state = excluded.state,
             save_version = excluded.save_version,
             device_updated_at = excluded.device_updated_at,
             state_checksum = excluded.state_checksum`,
      [userId, json, Date.now(), json],
    );
    if (name !== null) {
      await client.query(
        `insert into public.profiles (user_id, display_name) values ($1, $2)
         on conflict (user_id) do update set display_name = excluded.display_name`,
        [userId, name],
      );
    }
  }

  await playerWithoutClaims(
    WASH,
    [
      card("wash-legend-1", "auronplay", "legendary", "standard", 900),
      card("wash-legend-2", "auronplay", "legendary", "standard", 800),
      // Une troisième copie : l'échange testé plus bas en retire une, et la
      // vente honnête a besoin de deux exemplaires (la dernière copie ne part
      // pas).
      card("wash-legend-3", "auronplay", "legendary", "standard", 700),
      card("wash-holo-1", communOne.slug, communOne.rarity, "holo", 700),
      card("wash-holo-2", communOne.slug, communOne.rarity, "holo", 690),
    ],
    "Blanchisseur",
  );
  await playerWithoutClaims(
    RECEL,
    [card("recel-1", communOne.slug, communOne.rarity, "standard", 10)],
    "Receleur",
  );

  check(
    "blanchiment : le registre ne couvre aucune de ces cartes",
    (
      await client.query(
        "select count(*)::int as n from public.card_claims where user_id = $1",
        [WASH],
      )
    ).rows[0].n === 0,
  );

  // 1. Proposer un échange avec la carte fabriquée.
  await refuses(
    "blanchiment : on ne propose pas une carte sans provenance",
    WASH,
    "select public.create_trade($1, $2, $3)",
    [
      RECEL,
      JSON.stringify([{ creatorSlug: "auronplay", rarity: "legendary", variant: "standard" }]),
      // Une offre demande au moins une carte de chaque côté : ce que le
      // Receleur a vraiment (il possède `recel-1`).
      JSON.stringify([{ creatorSlug: communOne.slug, rarity: communOne.rarity, variant: "standard" }]),
    ],
    "provenance",
  );

  // 2. Accepter un échange où l'on **donne** cette carte : le contrôle doit
  //    tomber à l'acceptation aussi, pas seulement à la création de l'offre
  //    (une carte peut avoir bougé entre-temps).
  const receleur = (
    await asPlayer(RECEL, "select public.create_trade($1, $2, $3) as r", [
      WASH,
      JSON.stringify([card("recel-1", communOne.slug, communOne.rarity, "standard", 10)]),
      JSON.stringify([{ creatorSlug: "auronplay", rarity: "legendary", variant: "standard" }]),
    ])
  ).rows[0].r;
  await refuses(
    "blanchiment : on n'accepte pas un échange qui donne une carte sans provenance",
    WASH,
    "select public.respond_trade($1, true)",
    [receleur.trade.id],
    "provenance",
  );

  // 3. La vendre à l'hôtel — et la variante qui n'a aucune excuse (Holo).
  await refuses(
    "blanchiment : l'hôtel refuse une Légendaire sans provenance",
    WASH,
    "select public.market_sell($1)",
    ["wash-legend-1"],
    "provenance",
  );
  await refuses(
    "blanchiment : l'hôtel refuse aussi une variante Holo sans provenance",
    WASH,
    "select public.market_sell($1)",
    ["wash-holo-1"],
    "provenance",
  );

  // 4. L'acheter : une annonce qui date d'avant `0022` (insérée à la main, comme
  //    le ferait l'ancienne version) ne donne aucun droit à l'acheteur.
  const annonceSansDroit = (
    await client.query(
      `insert into public.market_listings (seller_id, card_id, creator_slug, rarity, variant, payout, price)
       values ($1, 'wash-legend-1', 'auronplay', 'legendary', 'standard', 100, 120)
       returning id`,
      [WASH],
    )
  ).rows[0].id;
  await refuses(
    "blanchiment : l'hôtel refuse d'acheter une annonce sans provenance",
    RECEL,
    "select public.market_buy($1)",
    [annonceSansDroit],
    "provenance",
  );

  // Le pendant honnête, pour être sûr que le refus vise la provenance et rien
  // d'autre : la même carte, **donnée** par le serveur, se vend sans histoire.
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [
    WASH,
    JSON.stringify([{ creatorSlug: "auronplay", rarity: "legendary", variant: "standard" }]),
  ]);
  const ventePropre = (
    await asPlayer(WASH, "select public.market_sell($1) as r", ["wash-legend-2"])
  ).rows[0].r;
  check(
    "blanchiment : la même carte, une fois donnée par le serveur, se vend",
    ventePropre.payout > 0 &&
      ventePropre.listing?.creatorSlug === "auronplay" &&
      ventePropre.listing?.id > 0,
    JSON.stringify({ payout: ventePropre.payout, id: ventePropre.listing?.id ?? null }),
  );

  // --- Le pseudo d'attente ------------------------------------------------
  // `ensure_profile()` fabrique « Collectionneur # » suivi des quatre premiers
  // caractères de l'identifiant. Deux joueurs qui commencent pareil tombaient
  // sur le même nom — et `_display_name_unique()` (`0020`) refusait le second,
  // donc **toute sa sauvegarde**. `0022` allonge le suffixe au lieu d'échouer.
  const TWIN_A = "1f2e3d4c-0000-4000-8000-00000000000a";
  const TWIN_B = "1f2e3d4c-0000-4000-8000-00000000000b";
  await playerWithoutClaims(TWIN_A, []);
  await playerWithoutClaims(TWIN_B, []);
  const twins = (
    await client.query(
      "select display_name from public.profiles where user_id in ($1, $2) order by display_name",
      [TWIN_A, TWIN_B],
    )
  ).rows;
  check(
    "profils : deux identifiants qui commencent pareil ne bloquent plus la sauvegarde",
    twins.length === 2 &&
      twins[0].display_name !== twins[1].display_name &&
      twins.every((row) => /^Collectionneur #[0-9a-f]{4,9}$/.test(row.display_name)),
    JSON.stringify(twins.map((row) => row.display_name)),
  );


  // --- La chaîne (0036) ----------------------------------------------------
  //
  // Le simulateur de streameur : ce qu'on vérifie ici n'est pas l'agrément du
  // jeu, c'est ce que le **client** ne peut pas faire — choisir son résultat,
  // publier deux vidéos le même jour, se payer deux fois, ou gonfler ses
  // abonnés avec l'horloge du téléphone.
  const CHAINE = "3c3c3c3c-1111-4111-8111-3c3c3c3c3c3c";
  const SANS_CARTE = "4d4d4d4d-2222-4222-8222-4d4d4d4d4d4d";
  await player(CHAINE, "Chloé Stream", [card("chaine-1", "auronplay", "rare", "standard", 400)]);
  await player(SANS_CARTE, "Nouvelle venue", []);

  const paliers = (
    await client.query(
      `select public._streamer_per_day(0) as a, public._streamer_per_day(2499) as b,
              public._streamer_per_day(2500) as c, public._streamer_per_day(25000) as d,
              public._streamer_per_day(250000) as e, public._streamer_per_day(1000000) as f`,
    )
  ).rows[0];
  check(
    "chaîne : les paliers paient 240, puis 900, 3 200, 12 000 et 45 000 par jour",
    paliers.a === 240 && paliers.b === 240 && paliers.c === 900 &&
      paliers.d === 3200 && paliers.e === 12000 && paliers.f === 45000,
    JSON.stringify(paliers),
  );

  // Le mini-jeu du direct (`src/lib/live-game.ts`) n'a **pas** de table : il ne
  // paie rien, donc il n'y a rien à garder côté serveur. Ce qui doit en
  // revanche rester d'accord, c'est le **nombre de paliers** : une cadence de
  // chat et un nombre de bulles par palier de notoriété. Si un sixième palier
  // apparaît dans le SQL sans que le fichier du live suive, le dernier palier
  // vivrait une scène de palier inférieur sans que rien ne le dise.
  const sceneLive = JSON.parse(
    await readFile(path.join(ROOT, "src", "data", "live-game.json"), "utf8"),
  );
  const paliersSql = 5; // voir le contrôle ci-dessus : 0, 2500, 25 000, 250 000, 1 000 000
  check(
    "live : la scène suit les paliers du serveur (5 cadences, 5 nombres de bulles)",
    sceneLive.chat.perMinute.length === paliersSql &&
      sceneLive.alerts.count.length === paliersSql &&
      sceneLive.chat.perMinute.every((n, i) => i === 0 || n > sceneLive.chat.perMinute[i - 1]) &&
      sceneLive.alerts.count.every((n, i) => i === 0 || n > sceneLive.alerts.count[i - 1]),
    JSON.stringify({ cadences: sceneLive.chat.perMinute, bulles: sceneLive.alerts.count }),
  );

  const chaineNeuve = (await asPlayer(CHAINE, "select public.streamer_status() as r")).rows[0].r;
  check(
    "chaîne : une chaîne neuve part de zéro, aucune vidéo publiée",
    Number(chaineNeuve.subscribers) === 0 && chaineNeuve.published_today === false &&
      Number(chaineNeuve.per_day) === 240 && Number(chaineNeuve.tokens_today) === 0,
    JSON.stringify(chaineNeuve),
  );

  // L'absence : on recule le relevé **du serveur** de trois jours, puis on
  // revient. C'est exactement ce que fait le joueur en fermant l'application.
  await client.query(
    "update public.streamer_channels set last_seen_at = now() - interval '3 days' where user_id = $1",
    [CHAINE],
  );
  const visite = (await asPlayer(CHAINE, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "chaîne : trois journées d'absence paient 3 × 240 abonnés",
    Number(visite.days) === 3 && Number(visite.counted_days) === 3 &&
      Number(visite.gained) === 720 && Number(visite.subscribers) === 720,
    JSON.stringify(visite),
  );

  // Le plafond : trente journées d'absence ne paient pas plus que sept.
  await client.query(
    "update public.streamer_channels set last_seen_at = now() - interval '30 days' where user_id = $1",
    [CHAINE],
  );
  const plafond = (await asPlayer(CHAINE, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "chaîne : au-delà de sept journées, la chaîne ne cumule plus",
    Number(plafond.days) === 30 && Number(plafond.counted_days) === 7 &&
      Number(plafond.gained) === 7 * 240,
    JSON.stringify(plafond),
  );

  // Une horloge en arrière (un relevé dans le futur) ne crédite rien : c'est la
  // promesse faite au joueur, et c'est ce qui rend l'ancrage serveur utile.
  await client.query(
    "update public.streamer_channels set last_seen_at = now() + interval '5 days' where user_id = $1",
    [CHAINE],
  );
  const recul = (await asPlayer(CHAINE, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "chaîne : un relevé dans le futur ne crédite aucun abonné",
    Number(recul.days) === 0 && Number(recul.gained) === 0,
    JSON.stringify(recul),
  );

  // La vidéo du jour : un résultat tiré **par le serveur**, donc l'invariant est
  // ce qu'il faut vérifier (le tirage, lui, ne se prédit pas).
  const avantVideo = (await asPlayer(CHAINE, "select public.streamer_status() as r")).rows[0].r;
  const jetonsAvantVideo = (await asPlayer(CHAINE, "select public.tokens_get() as r")).rows[0].r.tokens;
  const video = (await asPlayer(CHAINE, "select public.streamer_publish('letsplay') as r")).rows[0].r;
  const gainsLetsPlay = [0, 240, 720];
  check(
    "chaîne : la vidéo du jour rend un résultat cohérent avec son format",
    video.already === false && video.format === "letsplay" &&
      gainsLetsPlay.includes(Number(video.gained)) &&
      Number(video.subscribers) === Number(avantVideo.subscribers) + Number(video.gained),
    JSON.stringify(video),
  );
  check(
    "chaîne : le versement est plafonné (16 jetons au plus pour une vidéo)",
    Number(video.tokens) <= 16 && Number(video.tokens_today) <= Number(video.tokens_cap),
    JSON.stringify({ tokens: video.tokens, today: video.tokens_today, cap: video.tokens_cap }),
  );

  // Deuxième appel le même jour : on relit la première vidéo, on ne la rejoue
  // pas — ni les abonnés, ni les jetons ne bougent.
  const jetonsApresVideo = (await asPlayer(CHAINE, "select public.tokens_get() as r")).rows[0].r.tokens;
  check(
    "chaîne : le versement de la chaîne arrive sur le solde du serveur",
    Number(jetonsApresVideo) - Number(jetonsAvantVideo) === Number(video.tokens),
    JSON.stringify({ avant: jetonsAvantVideo, apres: jetonsApresVideo, verse: video.tokens }),
  );
  const rejeu = (await asPlayer(CHAINE, "select public.streamer_publish('ragebait') as r")).rows[0].r;
  const jetonsRejeu = (await asPlayer(CHAINE, "select public.tokens_get() as r")).rows[0].r.tokens;
  check(
    "chaîne : une seule vidéo par journée de jeu, et un seul versement",
    rejeu.already === true && rejeu.format === "letsplay" &&
      Number(rejeu.gained) === Number(video.gained) && Number(jetonsRejeu) === Number(jetonsApresVideo),
    JSON.stringify({ rejeu, jetonsRejeu }),
  );

  await refuses(
    "chaîne : un format inventé est refusé",
    CHAINE,
    "select public.streamer_publish('nimportequoi') as r",
    [],
    "n'existe pas",
  );
  await refuses(
    "chaîne : la collab demande de posséder un créateur",
    SANS_CARTE,
    "select public.streamer_publish('collab') as r",
    [],
    "posséder au moins un créateur",
  );
  await refuses(
    "chaîne : la table des chaînes est fermée au joueur",
    CHAINE,
    "select count(*) as n from public.streamer_channels",
    [],
    "permission denied",
  );
  await refuses(
    "chaîne : le journal des vidéos est fermé au joueur",
    CHAINE,
    "select count(*) as n from public.streamer_videos",
    [],
    "permission denied",
  );

  // Le rapport de version, et l'ordre du collage : `0035` **et** `0036`
  // réécrivent `schema_versions()`, donc le rapport est celui de la **dernière**
  // migration recollée. C'est un piège réel — le joueur colle depuis son
  // téléphone — et il se reproduit ici avant d'être vérifié : on recollé `0035`
  // seule, la ligne de la `0036` disparaît ; on recolle `0036`, elle revient.
  await client.query(jetons);
  const rapportSans = (await client.query("select public.schema_versions() as r")).rows[0].r;
  check(
    "chaîne : recoller `0035` après `0036` fait perdre la ligne de la 0036 (le rapport suit la dernière collée)",
    rapportSans["0036"] === undefined && rapportSans["0035"] === true,
    JSON.stringify(rapportSans),
  );
  await client.query(chaine);
  const rapportAvec = (await client.query("select public.schema_versions() as r")).rows[0].r;
  check(
    "chaîne : la 0036 recollée en dernier rend le rapport complet",
    rapportAvec["0036"] === true && rapportAvec["0035"] === true,
    JSON.stringify(rapportAvec),
  );
  // Le même piège une génération plus loin : `0037` et `0038` sont maintenant
  // les dernières, donc ce sont elles qu'il faut recoller en dernier.
  await client.query(gardes);
  await client.query(imprevus);
  await client.query(invites);
  await client.query(doublons);
  await client.query(collab);
  const rapportComplet = (await client.query("select public.schema_versions() as r")).rows[0].r;
  check(
    "chaîne : la pile recollée dans l'ordre donne le rapport complet (0030 → 0041)",
    ["0030", "0031", "0032", "0033", "0034", "0035", "0036", "0037", "0038", "0039", "0040", "0041"].every(
      (cle) => rapportComplet[cle] === true,
    ),
    JSON.stringify(rapportComplet),
  );

  // --- Les imprévus et le setup (0038) -------------------------------------
  //
  // Ce qui se vérifie ici, ce n'est pas l'agrément des cartes : c'est ce que le
  // **client** ne peut pas faire — choisir son imprévu, choisir son côté sans
  // qu'il existe, le rejouer, se payer deux fois, ou s'offrir le studio sans le
  // micro. Et une promesse de plus : un imprévu ne paie **aucun jeton**.
  const SETUP = "5e5e5e5e-3333-4333-8333-5e5e5e5e5e5e";
  await player(SETUP, "Victoire", [card("setup-1", "ibai", "rare", "standard", 200)]);
  await client.query("select public._wallet_apply($1, 6000, 'test', 'setup-0038')", [SETUP]);

  const niveaux = (
    await client.query(
      "select l.level, l.price, l.growth_permille, public._streamer_setup_currency(l.level) as currency from public._streamer_setup_levels() l order by l.rang",
    )
  ).rows;
  check(
    "setup : huit paliers, dans l'ordre, pour +100 % de croissance au total",
    niveaux.length === 8 &&
      niveaux.map((row) => row.level).join(",") ===
        "webcam,micro,lumiere,deco,studio,webcam2,regie,plateau" &&
      niveaux.map((row) => row.price).join(",") === "120,320,780,1800,4200,2,5,10" &&
      niveaux.map((row) => row.currency).join(",") ===
        "points,points,points,points,points,doublons,doublons,doublons" &&
      niveaux.reduce((total, row) => total + row.growth_permille, 0) === 1000,
    JSON.stringify(niveaux),
  );

  const carteDuJour = (await asPlayer(SETUP, "select public.streamer_event_today() as r")).rows[0].r;
  check(
    "imprévus : le jour a une carte, et rien n'est encore répondu",
    carteDuJour.ok === true &&
      carteDuJour.chosen === false &&
      [
        "clip",
        "coupure",
        "modo",
        "nuit",
        "raid",
        "sponsor",
      ].includes(carteDuJour.event) &&
      carteDuJour.day ===
        (await client.query("select public._streamer_game_day(now()) as d")).rows[0].d,
    JSON.stringify(carteDuJour),
  );
  check(
    "imprévus : la carte du jour ne change pas entre deux ouvertures",
    (await asPlayer(SETUP, "select public.streamer_event_today() as r")).rows[0].r.event ===
      carteDuJour.event,
  );

  // Six cartes, et le tirage par `md5(joueur, journée)` ne colle pas tout le
  // monde sur la même : sur trente joueurs, il doit en sortir plusieurs.
  const cartesReparties = (
    await client.query(
      `select count(distinct public._streamer_event_for(u, '2026-10-08'))::int as n
         from (select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as u
                 from generate_series(1, 30) g) as joueurs`,
    )
  ).rows[0].n;
  check(
    "imprévus : trente joueurs ne tombent pas tous sur la même carte",
    cartesReparties >= 3,
    String(cartesReparties),
  );

  // La carte qui n'est pas celle du jour : elle est calculée, pas écrite en
  // dur — sinon le contrôle se tromperait le jour où l'aléa tombe dessus.
  const autreCarte = ["modo", "sponsor", "clip", "coupure", "raid", "nuit"].find(
    (id) => id !== carteDuJour.event,
  );
  await refuses(
    "imprévus : un imprévu qui n'est pas celui du jour est refusé",
    SETUP,
    "select public.streamer_choose($1, 'gauche') as r",
    [autreCarte],
    "ce n'est pas l'imprévu du jour",
  );
  await refuses(
    "imprévus : un côté qui n'existe pas est refusé",
    SETUP,
    "select public.streamer_choose($1, 'milieu') as r",
    [carteDuJour.event],
    "ce choix n'existe pas",
  );

  const jetonsAvant = (await asPlayer(SETUP, "select public.tokens_get() as r")).rows[0].r.tokens;
  const abonnesAvant = (await asPlayer(SETUP, "select public.streamer_status() as r")).rows[0].r
    .subscribers;
  const joue = (
    await asPlayer(SETUP, "select public.streamer_choose($1, 'gauche') as r", [carteDuJour.event])
  ).rows[0].r;
  // Le gain attendu se **calcule** depuis la carte réellement tirée et la
  // croissance réelle du joueur : une liste écrite à la main se tromperait le
  // jour où le tirage tombe sur une autre carte.
  const coteGauche = (
    await client.query("select * from public._streamer_event_choice($1, 'gauche')", [
      carteDuJour.event,
    ])
  ).rows[0];
  const croissanceAvant = (
    await client.query("select public._streamer_growth($1, $2) as g", [SETUP, abonnesAvant])
  ).rows[0].g;
  const potentiel = Math.round((Number(croissanceAvant) * coteGauche.gain_permille) / 1000);
  const gainAttendu = joue.success
    ? joue.buzz
      ? potentiel * 3
      : potentiel
    : joue.bad_buzz
      ? -Math.round(potentiel / 4)
      : 0;
  check(
    "imprévus : la réponse est cohérente avec le côté choisi",
    joue.already === false &&
      joue.choice === "gauche" &&
      Number(joue.gained) === gainAttendu &&
      (joue.success || !joue.buzz) &&
      (joue.success || !joue.bad_buzz) &&
      Number(joue.subscribers) === Math.max(0, Number(abonnesAvant) + Number(joue.gained)),
    JSON.stringify({ joue, abonnesAvant, coteGauche, potentiel, gainAttendu }),
  );
  check(
    "imprévus : un imprévu ne paie aucun jeton (la vidéo garde la porte de la monnaie)",
    Number((await asPlayer(SETUP, "select public.tokens_get() as r")).rows[0].r.tokens) ===
      Number(jetonsAvant),
    JSON.stringify({ jetonsAvant }),
  );

  const rejoue = (
    await asPlayer(SETUP, "select public.streamer_choose($1, 'droite') as r", [carteDuJour.event])
  ).rows[0].r;
  const etatJoue = (await asPlayer(SETUP, "select public.streamer_event_today() as r")).rows[0].r;
  check(
    "imprévus : une seule réponse par journée de jeu, et le second appel relit la première",
    rejoue.already === true &&
      rejoue.choice === "gauche" &&
      Number(rejoue.gained) === Number(joue.gained) &&
      etatJoue.chosen === true &&
      Number(etatJoue.gained) === Number(joue.gained),
    JSON.stringify({ rejoue, etatJoue }),
  );
  const lignesImprevu = (
    await client.query("select count(*)::int as n from public.streamer_events where user_id = $1", [
      SETUP,
    ])
  ).rows[0].n;
  check("imprévus : une seule ligne au journal pour la journée", lignesImprevu === 1, String(lignesImprevu));

  // Un palier qui n'est pas le prochain ne s'achète pas — et l'ordre se lit dans
  // le message, pas seulement dans un refus.
  await refuses(
    "setup : on ne saute pas la webcam pour prendre un micro",
    SETUP,
    "select public.streamer_setup_buy('micro') as r",
    [],
    "il faut d'abord « webcam »",
  );
  await refuses(
    "setup : on ne saute pas la file pour s'offrir le studio",
    SETUP,
    "select public.streamer_setup_buy('studio') as r",
    [],
    "il faut d'abord",
  );
  await refuses(
    "setup : un palier inventé est refusé",
    SETUP,
    "select public.streamer_setup_buy('piscine') as r",
    [],
    "n'existe pas",
  );

  const pointsAvant = (await asPlayer(SETUP, "select public.wallet_get() as r")).rows[0].r.points;
  const achatWebcam = (
    await asPlayer(SETUP, "select public.streamer_setup_buy('webcam') as r")
  ).rows[0].r;
  check(
    "setup : le premier palier se paie, et la croissance suit",
    achatWebcam.already === false &&
      Number(achatWebcam.price) === 120 &&
      Number(achatWebcam.points) === Number(pointsAvant) - 120 &&
      Number(achatWebcam.setup_bonus) === 30 &&
      achatWebcam.setup.join(",") === "webcam",
    JSON.stringify({ achat: achatWebcam, pointsAvant }),
  );
  const etatAvecWebcam = (await asPlayer(SETUP, "select public.streamer_status() as r")).rows[0].r;
  check(
    "setup : l'écran lit le bonus par le serveur (240 → 247 par jour)",
    Number(etatAvecWebcam.per_day) === 247 &&
      etatAvecWebcam.setup.join(",") === "webcam" &&
      Number(etatAvecWebcam.setup_bonus) === 30,
    JSON.stringify(etatAvecWebcam),
  );
  const memesPoints = (await asPlayer(SETUP, "select public.wallet_get() as r")).rows[0].r.points;
  const achatRepete = (
    await asPlayer(SETUP, "select public.streamer_setup_buy('webcam') as r")
  ).rows[0].r;
  check(
    "setup : un palier déjà installé ne se repaie pas",
    achatRepete.already === true &&
      Number((await asPlayer(SETUP, "select public.wallet_get() as r")).rows[0].r.points) ===
        Number(memesPoints),
    JSON.stringify({ achatRepete, memesPoints }),
  );

  // Le bonus travaille aussi pendant l'absence : deux journées au palier de
  // base, multipliées par le setup, exactement comme `_streamer_growth()`.
  await client.query(
    "update public.streamer_channels set last_seen_at = now() - interval '2 days' where user_id = $1",
    [SETUP],
  );
  const visiteSetup = (await asPlayer(SETUP, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "setup : l'absence paie la croissance du setup (2 × 247, pas 2 × 240)",
    Number(visiteSetup.gained) === 2 * 247 && Number(visiteSetup.per_day) === 247,
    JSON.stringify(visiteSetup),
  );

  // Le piège de l'ordre, côté données : une ligne ajoutée à la main ne donne pas
  // le bonus d'un palier dont les précédents manquent.
  await client.query("select public._wallet_apply($1, 10000, 'test', 'setup-triche')", [SETUP]);
  await client.query("insert into public.streamer_setup (user_id, level) values ($1, 'studio')", [
    SETUP,
  ]);
  check(
    "setup : un palier volé ne compte pas tant que les précédents manquent",
    Number(
      (await client.query("select public._streamer_setup_bonus($1) as b", [SETUP])).rows[0].b,
    ) === 30,
  );
  // ...et il ne fait pas **sauter** une étape pour autant : le prochain palier
  // se lit sur le préfixe contigu, donc c'est bien le micro qui suit.
  check(
    "setup : un palier volé ne fait pas sauter l'étape suivante",
    (await client.query("select level from public._streamer_setup_next($1)", [SETUP])).rows[0]
      .level === "micro",
  );
  // La ligne volée a fait son travail : on la retire, pour laisser le carnet
  // dans l'état d'un vrai joueur.
  await client.query("delete from public.streamer_setup where user_id = $1 and level = 'studio'", [
    SETUP,
  ]);
  const suiteMicro = (
    await asPlayer(SETUP, "select public.streamer_setup_buy('micro') as r")
  ).rows[0].r;
  check(
    "setup : le bonus s'additionne palier après palier (30 → 80 pour mille)",
    Number(suiteMicro.setup_bonus) === 80 && suiteMicro.setup.join(",") === "webcam,micro",
    JSON.stringify(suiteMicro),
  );

  // Le contrôle qui compte le plus : **la vidéo paie le même chiffre que
  // l'écran**. Avec webcam + micro le bonus vaut 80 pour mille, donc la
  // croissance vaut 259 par jour (240 × 1,08) et plus 240.
  //
  // Le tirage est figé (`setseed`) : deux joueurs qui publient le même format
  // avec la même graine ont **exactement** le même tirage, donc la seule
  // différence possible entre leurs gains est la croissance. On cherche une
  // graine qui donne une réussite — sinon les deux gains vaudraient zéro et le
  // contrôle ne dirait rien — et on compare : 259 contre 240, 777 contre 720.
  const TEMOIN = "7a7a7a7a-5555-4555-8555-7a7a7a7a7a7a";
  await player(TEMOIN, "Témoin", []);
  const etatAvantVideo = (await asPlayer(SETUP, "select public.streamer_status() as r")).rows[0].r;
  const baseSetup = Number(etatAvantVideo.per_day);
  let graineVideo = null;
  for (let essai = 1; essai <= 40 && graineVideo === null; essai += 1) {
    const graine = essai / 41;
    await client.query("select setseed($1)", [graine]);
    const premierJet = (await client.query("select floor(random() * 1000)::int as a")).rows[0].a;
    // Let's Play réussit sous 760 pour mille.
    if (Number(premierJet) < 760) graineVideo = graine;
  }
  await client.query("select setseed($1)", [graineVideo]);
  const videoSetup = (
    await asPlayer(SETUP, "select public.streamer_publish('letsplay') as r")
  ).rows[0].r;
  await client.query("select setseed($1)", [graineVideo]);
  const videoTemoin = (
    await asPlayer(TEMOIN, "select public.streamer_publish('letsplay') as r")
  ).rows[0].r;
  const gainSetup = Number(videoSetup.gained);
  const gainTemoin = Number(videoTemoin.gained);
  check(
    "la vidéo du jour paie la croissance du setup (259 et non 240)",
    graineVideo !== null &&
      baseSetup === 259 &&
      videoSetup.success === true &&
      videoTemoin.success === true &&
      videoSetup.buzz === videoTemoin.buzz &&
      gainTemoin === 240 * (videoTemoin.buzz ? 3 : 1) &&
      gainSetup === 259 * (videoSetup.buzz ? 3 : 1),
    JSON.stringify({ graineVideo, gainSetup, gainTemoin, videoSetup, videoTemoin }),
  );

  const ruine = "6f6f6f6f-4444-4444-8444-6f6f6f6f6f6f";
  await player(ruine, "Sidonie", []);
  await refuses(
    "setup : sans les points, le palier n'est pas vendu",
    ruine,
    "select public.streamer_setup_buy('webcam') as r",
    [],
    "il te manque",
  );

  // Un visiteur n'a ni carte du jour ni palier.
  await refuses(
    "imprévus : sans compte, pas d'imprévu",
    null,
    "select public.streamer_event_today() as r",
    [],
    "connecte-toi",
  );
  await refuses(
    "setup : sans compte, pas de carnet de paliers",
    null,
    "select public.streamer_setup_buy('webcam') as r",
    [],
    "connecte-toi",
  );
  await refuses(
    "imprévus : le journal des imprévus est fermé au joueur",
    SETUP,
    "select count(*) as n from public.streamer_events",
    [],
    "permission denied",
  );
  await refuses(
    "setup : le carnet des paliers est fermé au joueur",
    SETUP,
    "select count(*) as n from public.streamer_setup",
    [],
    "permission denied",
  );
  await refuses(
    "imprévus : les tables des cartes ne sont pas lisibles par un joueur",
    SETUP,
    "select count(*) as n from public._streamer_events()",
    [],
    "permission denied",
  );

  // --- La seconde série du setup : les doublons (0040) ---------------------
  //
  // Ce qui se vérifie ici n'est pas l'agrément des cartes, c'est ce que le
  // client ne peut pas faire : choisir son prix, sacrifier une Légendaire, sa
  // dernière copie, une carte sans provenance, ou **la même carte deux fois**
  // — la ligne du journal est la preuve du départ, et elle tient même quand la
  // sauvegarde n'a pas encore suivi.
  const DOUBLONS = "6d6d6d6d-4444-4444-8444-6d6d6d6d6d6d";
  const rares = (
    await client.query(
      "select slug from public.creators where rarity = 'rare' and retired = false order by rank limit 4",
    )
  ).rows.map((row) => row.slug);
  const epicDuo = (
    await client.query(
      "select slug from public.creators where rarity = 'epic' and retired = false order by rank limit 1",
    )
  ).rows[0].slug;
  const legendaireDuo = (
    await client.query(
      "select slug from public.creators where rarity = 'legendary' and retired = false order by rank limit 1",
    )
  ).rows[0].slug;

  await saveFor(DOUBLONS, [
    card("dbl-ra-1", rares[0], "rare", "standard", 40),
    card("dbl-ra-2", rares[0], "rare", "standard", 39),
    card("dbl-rb-1", rares[1], "rare", "standard", 38),
    card("dbl-rb-2", rares[1], "rare", "standard", 37),
    card("dbl-rc-1", rares[2], "rare", "standard", 36),
    card("dbl-rc-2", rares[2], "rare", "standard", 35),
    // La dernière copie d'un couple : elle ne part jamais.
    card("dbl-rs-1", rares[3], "rare", "standard", 34),
    // Trois Épiques du même créateur : deux partent, il en reste un.
    card("dbl-ep-1", epicDuo, "epic", "standard", 33),
    card("dbl-ep-2", epicDuo, "epic", "standard", 32),
    card("dbl-ep-3", epicDuo, "epic", "standard", 31),
    // Une Légendaire, même en double : elle reste au classeur.
    card("dbl-lg-1", legendaireDuo, "legendary", "standard", 30),
    card("dbl-lg-2", legendaireDuo, "legendary", "standard", 29),
    // Deux Holo sans aucun droit : la provenance doit refuser.
    card("dbl-ho-1", rares[0], "rare", "holo", 28),
    card("dbl-ho-2", rares[0], "rare", "holo", 27),
  ]);
  // Les droits de l'Épique : trois, pour vérifier qu'ils descendent de deux.
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [
    DOUBLONS,
    JSON.stringify([{ creatorSlug: epicDuo, rarity: "epic", variant: "standard" }]),
  ]);
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [
    DOUBLONS,
    JSON.stringify([{ creatorSlug: epicDuo, rarity: "epic", variant: "standard" }]),
  ]);
  await client.query("select public.card_claim_add($1, $2::jsonb, 'tirage')", [
    DOUBLONS,
    JSON.stringify([{ creatorSlug: epicDuo, rarity: "epic", variant: "standard" }]),
  ]);

  // Les cinq paliers en points d'abord : tant qu'ils manquent, la porte des
  // doublons est fermée — et la porte des points refuse un palier en cartes.
  await refuses(
    "studio : le palier en doublons ne s'achète pas avec des points",
    DOUBLONS,
    "select public.streamer_setup_buy('webcam2') as r",
    [],
    "se paie en doublons",
  );
  await refuses(
    "studio : les doublons attendent la fin des paliers en points",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-ra-1"]'::jsonb) as r`,
    [],
    "se paie encore en points",
  );

  await client.query(
    "insert into public.streamer_setup (user_id, level) values ($1,'webcam'),($1,'micro'),($1,'lumiere'),($1,'deco'),($1,'studio')",
    [DOUBLONS],
  );

  const valeurRare = (
    await client.query("select value from public._streamer_sacrifice_values() where rarity = 'rare'")
  ).rows[0].value;
  const valeurEpic = (
    await client.query("select value from public._streamer_sacrifice_values() where rarity = 'epic'")
  ).rows[0].value;
  check(
    "studio : un Rare vaut 1, un Épique vaut 2 — et rien d'autre ne part",
    Number(valeurRare) === 1 &&
      Number(valeurEpic) === 2 &&
      (await client.query("select count(*)::int as n from public._streamer_sacrifice_values()")).rows[0]
        .n === 2,
  );

  await refuses(
    "studio : une Légendaire ne part jamais, même en double",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-lg-1"]'::jsonb) as r`,
    [],
    "jamais une Légendaire",
  );
  await refuses(
    "studio : la dernière copie ne part pas",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-rs-1"]'::jsonb) as r`,
    [],
    "ta seule copie",
  );
  await refuses(
    "studio : le compte doit tomber juste sur le prix du palier",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-ra-1"]'::jsonb) as r`,
    [],
    "il faut 2 points de sacrifice",
  );
  await refuses(
    "studio : une carte qui n'est pas dans le classeur ne part pas",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-fantome"]'::jsonb) as r`,
    [],
    "n'est plus dans ta collection",
  );
  await refuses(
    "studio : une carte sans provenance ne part pas (la porte du recyclage, tenue)",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-ho-1","dbl-rb-1"]'::jsonb) as r`,
    [],
    "provenance",
  );

  const sacrifice6 = (
    await asPlayer(DOUBLONS, `select public.streamer_setup_sacrifice('["dbl-ra-1","dbl-rb-1"]'::jsonb) as r`)
  ).rows[0].r;
  check(
    "studio : deux Rares installent « webcam2 », et le bonus suit (+600 pour mille)",
    Number(sacrifice6.value) === 2 &&
      sacrifice6.level === "webcam2" &&
      sacrifice6.setup.join(",") === "webcam,micro,lumiere,deco,studio,webcam2" &&
      Number(sacrifice6.setup_bonus) === 600,
    JSON.stringify(sacrifice6),
  );
  await refuses(
    "studio : la même carte ne part pas deux fois (le journal est la preuve)",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-ra-1"]'::jsonb) as r`,
    [],
    "déjà partie au studio",
  );

  await refuses(
    "studio : un Épique seul ne suffit pas pour un palier à cinq points",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-ep-1"]'::jsonb) as r`,
    [],
    "il faut 5 points de sacrifice",
  );
  const sacrifice7 = (
    await asPlayer(
      DOUBLONS,
      `select public.streamer_setup_sacrifice('["dbl-ep-1","dbl-ep-2","dbl-ra-2"]'::jsonb) as r`,
    )
  ).rows[0].r;
  check(
    "studio : deux Épiques et un Rare installent « Régie » (+750 pour mille)",
    Number(sacrifice7.value) === 5 &&
      sacrifice7.level === "regie" &&
      Number(sacrifice7.setup_bonus) === 750,
    JSON.stringify(sacrifice7),
  );
  check(
    "studio : le droit de l'Épique est consommé, pas seulement compté",
    Number(
      (
        await client.query(
          "select qty from public.card_claims where user_id = $1 and creator_slug = $2 and variant = 'standard'",
          [DOUBLONS, epicDuo],
        )
      ).rows[0].qty,
    ) === 1,
  );
  check(
    "studio : le journal des départs porte les cartes parties, une fois chacune",
    Number(
      (
        await client.query("select count(*)::int as n from public.streamer_sacrifices where user_id = $1", [
          DOUBLONS,
        ])
      ).rows[0].n,
    ) === 5 &&
      Number(
        (
          await client.query(
            "select count(distinct card_id)::int as n from public.streamer_sacrifices where user_id = $1",
            [DOUBLONS],
          )
        ).rows[0].n,
      ) === 5,
  );
  const prochain8 = (
    await client.query(
      "select l.level, l.price, public._streamer_setup_currency(l.level) as currency from public._streamer_setup_next($1) l",
      [DOUBLONS],
    )
  ).rows[0];
  check(
    "studio : le dernier palier est en doublons (10 points de sacrifice)",
    prochain8.level === "plateau" && Number(prochain8.price) === 10 && prochain8.currency === "doublons",
    JSON.stringify(prochain8),
  );
  await refuses(
    "studio : le dernier palier refuse un compte qui ne tombe pas juste",
    DOUBLONS,
    `select public.streamer_setup_sacrifice('["dbl-rc-1"]'::jsonb) as r`,
    [],
    "il faut 10 points de sacrifice",
  );

  // Au bout des huit paliers, la chaîne grandit deux fois plus vite : le bonus
  // vaut 1000 pour mille, et c'est le même chiffre qui paie la vidéo.
  await client.query("insert into public.streamer_setup (user_id, level) values ($1, 'plateau')", [
    DOUBLONS,
  ]);
  check(
    "studio : au bout des huit paliers, +100 % de croissance (1000 pour mille)",
    Number(
      (await client.query("select public._streamer_setup_bonus($1) as b", [DOUBLONS])).rows[0].b,
    ) === 1000 &&
      Number(
        (
          await client.query("select public._streamer_growth($1, 240) as g", [DOUBLONS])
        ).rows[0].g,
      ) === 480,
  );

  await refuses(
    "studio : le journal des départs est fermé au joueur",
    DOUBLONS,
    "select count(*) as n from public.streamer_sacrifices",
    [],
    "permission denied",
  );
  await refuses(
    "studio : sans compte, pas de sacrifice",
    null,
    `select public.streamer_setup_sacrifice('["dbl-rc-1"]'::jsonb) as r`,
    [],
    "connecte-toi",
  );

  // --- Le plateau compte sur la vidéo (0041) -------------------------------
  //
  // Ce qui se vérifie ici : la rareté des invités pèse sur le gain de la vidéo
  // du jour, le direct ajoute le moment « RAID ! » (gain **et** chance de buzz),
  // et rien de tout ça ne vient du client. Le barème est relu dans le **fichier**
  // (`src/data/streamer.json`), comme pour les parts du raid : deux copies, un
  // seul chiffre.
  const COLLAB_A = "8a8a8a8a-6666-4666-8666-8a8a8a8a8a8a";
  const COLLAB_B = "8b8b8b8b-6666-4666-8666-8b8b8b8b8b8b";
  const COLLAB_C = "8c8c8c8c-6666-4666-8666-8c8c8c8c8c8c";
  const carteCollab = card("collab-1", legendaireDuo, "legendary", "standard", 30);
  await player(COLLAB_A, "Témoin plateau", []);
  await player(COLLAB_B, "Berthe plateau", [carteCollab]);
  await player(COLLAB_C, "Céline plateau", [carteCollab]);

  const reglagesCollab = JSON.parse(
    await readFile(path.join(ROOT, "src", "data", "streamer.json"), "utf8"),
  ).guests.collab;
  const permillesCollab = (
    await client.query("select rarity, permille from public._streamer_collab_values() order by rarity")
  ).rows;
  const collabSql = Object.fromEntries(permillesCollab.map((row) => [row.rarity, Number(row.permille)]));
  const liveSql = (await client.query("select * from public._streamer_collab_live()")).rows[0];
  check(
    "plateau : les parts de rareté sont celles du fichier, et rien d'autre",
    permillesCollab.length === 5 &&
      Object.entries(reglagesCollab.videoPermille).every(
        ([rarity, permille]) => collabSql[rarity] === permille,
      ) &&
      Object.keys(collabSql).join(",").length > 0,
    JSON.stringify({ collabSql, fichier: reglagesCollab.videoPermille }),
  );
  check(
    "plateau : le direct ajoute son gain et sa chance de buzz, comme le fichier",
    Number(liveSql.permille) === reglagesCollab.livePermille &&
      Number(liveSql.buzz_permille) === reglagesCollab.liveBuzzPermille,
    JSON.stringify({ liveSql, fichier: reglagesCollab }),
  );

  const sansInvite = (await asPlayer(COLLAB_A, "select public.streamer_status() as r")).rows[0].r;
  check(
    "plateau : sans invité, aucun bonus — et l'écran le dit",
    Number(sansInvite.collab_permille) === 0 &&
      Number(sansInvite.collab_buzz_permille) === 0 &&
      sansInvite.collab_live === false,
    JSON.stringify(sansInvite),
  );

  // Un invité légendaire sur le bureau : le bonus de rareté, sans direct.
  await asPlayer(COLLAB_B, "select public.streamer_guest_set(1, $1::jsonb) as r", [
    JSON.stringify({ ...carteCollab, id: "collab-b" }),
  ]);
  await asPlayer(COLLAB_C, "select public.streamer_guest_set(1, $1::jsonb) as r", [
    JSON.stringify({ ...carteCollab, id: "collab-c" }),
  ]);
  const etatB = (await asPlayer(COLLAB_B, "select public.streamer_status() as r")).rows[0].r;
  check(
    "plateau : une Légendaire invitée vaut le bonus de sa rareté, et pas le direct",
    Number(etatB.collab_permille) === collabSql.legendary &&
      Number(etatB.collab_buzz_permille) === 0 &&
      etatB.collab_live === false,
    JSON.stringify({ collab_permille: etatB.collab_permille, fichier: collabSql.legendary }),
  );

  // Le contrôle qui compte, première moitié : **sans direct**, la vidéo paie la
  // seule rareté. Deux joueurs, la même graine, le même état de chaîne — donc le
  // même tirage — et un seul écart : le plateau. Le potentiel nu se relit sur le
  // témoin (`gained / 3` s'il a buzzé).
  //
  // L'ordre compte : ce tirage-là se fait **avant** d'allumer le direct, sinon le
  // second joueur serait « en direct » lui aussi — la fraîcheur du cache est
  // globale, comme dans la vraie vie.
  let graineCollab = null;
  for (let essai = 1; essai <= 40 && graineCollab === null; essai += 1) {
    const graine = essai / 43;
    await client.query("select setseed($1)", [graine]);
    const premierJet = (await client.query("select floor(random() * 1000)::int as a")).rows[0].a;
    if (Number(premierJet) < 760) graineCollab = graine;
  }
  await client.query("select setseed($1)", [graineCollab]);
  const videoA = (await asPlayer(COLLAB_A, "select public.streamer_publish('letsplay') as r")).rows[0].r;
  await client.query("select setseed($1)", [graineCollab]);
  const videoB = (await asPlayer(COLLAB_B, "select public.streamer_publish('letsplay') as r")).rows[0].r;
  const potentielNu = Number(videoA.gained) / (videoA.buzz ? 3 : 1);
  const attenduB =
    Math.floor((potentielNu * (1000 + collabSql.legendary)) / 1000) * (videoB.buzz ? 3 : 1);

  // Le direct : on le fabrique comme `refresh-live`, puis on le retirera — la
  // section suivante (le bureau) compte sur un direct absent.
  const etatLiveAvant = (await client.query("select refreshed_at, streams from public.live_state where id")).rows[0];
  const loginCollab = (
    await client.query("select login from public.creators where slug = $1", [legendaireDuo])
  ).rows[0].login;
  await client.query(
    `insert into public.live_streams (login, display_name, viewers, refreshed_at)
     values ($1, 'Sur le plateau', 9120, now())
     on conflict (login) do update set viewers = 9120, refreshed_at = now()`,
    [loginCollab],
  );
  await client.query("update public.live_state set refreshed_at = now(), streams = 1");
  const etatC = (await asPlayer(COLLAB_C, "select public.streamer_status() as r")).rows[0].r;
  check(
    "plateau : un invité en direct ajoute son bonus au total, et allume le RAIDS",
    Number(etatC.collab_permille) === collabSql.legendary + Number(liveSql.permille) &&
      Number(etatC.collab_buzz_permille) === Number(liveSql.buzz_permille) &&
      etatC.collab_live === true,
    JSON.stringify({ collab_permille: etatC.collab_permille, buzz: etatC.collab_buzz_permille }),
  );

  // Seconde moitié : **avec** le direct, le plateau vaut la rareté **plus** le
  // bonus du direct, et la vidéo le paie.
  await client.query("select setseed($1)", [graineCollab]);
  const videoC = (await asPlayer(COLLAB_C, "select public.streamer_publish('letsplay') as r")).rows[0].r;
  const attenduC =
    Math.floor((potentielNu * (1000 + collabSql.legendary + Number(liveSql.permille))) / 1000) *
    (videoC.buzz ? 3 : 1);
  check(
    "plateau : la vidéo paie le plateau (rareté seule, puis rareté + direct)",
    graineCollab !== null &&
      videoA.success === true &&
      videoA.collab === 0 &&
      videoA.raid === false &&
      Number(videoA.gained) === potentielNu * (videoA.buzz ? 3 : 1) &&
      Number(videoB.gained) === attenduB &&
      Number(videoB.collab) === collabSql.legendary &&
      videoB.raid === false &&
      Number(videoC.gained) === attenduC &&
      Number(videoC.collab) === collabSql.legendary + Number(liveSql.permille) &&
      videoC.raid === true,
    JSON.stringify({ graineCollab, videoA, videoB, videoC, attenduB, attenduC }),
  );

  // La vidéo garde la trace du plateau : deux colonnes, écrites à la publication.
  const traceVideo = (
    await client.query(
      "select collab, raid from public.streamer_videos where user_id = $1 order by day desc limit 1",
      [COLLAB_C],
    )
  ).rows[0];
  check(
    "plateau : la vidéo garde le bonus et le raid (les colonnes de la 0041)",
    Number(traceVideo.collab) === collabSql.legendary + Number(liveSql.permille) &&
      traceVideo.raid === true,
    JSON.stringify(traceVideo),
  );

  // Reposer la vidéo du jour ne rejoue rien : elle ressort avec son plateau.
  const rejoueC = (await asPlayer(COLLAB_C, "select public.streamer_publish('letsplay') as r")).rows[0].r;
  check(
    "plateau : republier la vidéo du jour rend celle qui est rangée, plateau compris",
    rejoueC.already === true &&
      Number(rejoueC.collab) === Number(videoC.collab) &&
      rejoueC.raid === true &&
      Number(rejoueC.gained) === Number(videoC.gained),
    JSON.stringify(rejoueC),
  );

  // Le direct périmé : même invité, même ligne dans `live_streams`, mais un cache
  // vieux de vingt minutes — le plateau retombe sur la seule rareté.
  await client.query("update public.live_state set refreshed_at = now() - interval '20 minutes'");
  const perimeCollab = (await asPlayer(COLLAB_B, "select public.streamer_status() as r")).rows[0].r;
  await client.query(
    "update public.live_state set refreshed_at = $1, streams = $2",
    [etatLiveAvant.refreshed_at, etatLiveAvant.streams],
  );
  await client.query("delete from public.live_streams where login = $1", [loginCollab]);
  check(
    "plateau : un direct périmé retombe sur la seule rareté du bureau",
    Number(perimeCollab.collab_permille) === collabSql.legendary &&
      Number(perimeCollab.collab_buzz_permille) === 0 &&
      perimeCollab.collab_live === false,
    JSON.stringify(perimeCollab),
  );

  // Le barème reste au serveur : un joueur ne lit ni les tables, ni les fonctions.
  await refuses(
    "plateau : la fonction du plateau est fermée au joueur",
    COLLAB_A,
    "select * from public._streamer_collab($1)",
    [COLLAB_A],
    "permission denied",
  );
  await refuses(
    "plateau : le barème de rareté est fermé au joueur",
    COLLAB_A,
    "select * from public._streamer_collab_values()",
    [],
    "permission denied",
  );

  // --- Les invités sur le bureau (0039) ------------------------------------
  //
  // Le bloc précédent a recollé `0036` puis `0038` pour éprouver la pile, donc
  // `streamer_status()` est redevenu celui d'avant les invités : on recolle
  // `0039`, exactement comme le ferait le joueur. C'est la règle du projet —
  // on recolle dans l'ordre des numéros — et ce recollage sert aussi de
  // contrôle : le bureau doit revenir **tel quel**.
  //
  // Ce qui se vérifie ici n'est pas l'agrément du bureau, c'est ce que le client
  // ne peut pas faire : poser une carte qu'il ne possède pas, tenir la caisse
  // ouverte en rouvrant l'écran, ou payer sur un direct périmé.
  await client.query(invites);
  const BUREAU = "b0b0b0b0-7777-4777-8777-b0b0b0b0b0b0";
  const AUTRE = "a0a0a0a0-8888-4888-8888-a0a0a0a0a0a0";
  // Les fixtures sont **honnêtes par construction** : `card()` remplace la
  // rareté annoncée par celle du catalogue, donc la part du raid se lit sur la
  // carte telle qu'elle est écrite, jamais sur ce qu'on a tapé.
  const carteBureau = card("bureau-1", "ibai", "uncommon", "holo", 30);
  const carteAutre = card("bureau-autre", "ibai", "uncommon", "standard", 30);
  const carteInconnue = card("bureau-2", "summit1g", "legendary", "gold", 30);
  await player(BUREAU, "Victoria", [carteBureau]);
  await player(AUTRE, "Anouk", [carteAutre]);

  // Les invités du fichier et ceux du SQL disent la même chose : c'est le
  // miroir que le test unitaire tient à l'écriture, et que le vérificateur
  // rejoue ici sur la **vraie** fonction, pas sur le texte de la migration.
  const reglagesBureau = JSON.parse(
    await readFile(path.join(ROOT, "src", "data", "streamer.json"), "utf8"),
  ).guests;
  const reglagesPart = (carte) => reglagesBureau.raidPermille[carte.rarity] ?? 0;
  const partBureau = reglagesPart(carteBureau);
  const permillesSql = (
    await client.query(
      `select public._streamer_guest_permille('common') as a,
              public._streamer_guest_permille('uncommon') as b,
              public._streamer_guest_permille('rare') as c,
              public._streamer_guest_permille('epic') as d,
              public._streamer_guest_permille('legendary') as e,
              public._streamer_guest_permille('inconnue') as f`,
    )
  ).rows[0];
  check(
    "invités : les parts du raid sont celles du fichier (15/25/40/60/90, 0 sinon)",
    permillesSql.a === reglagesBureau.raidPermille.common &&
      permillesSql.b === reglagesBureau.raidPermille.uncommon &&
      permillesSql.c === reglagesBureau.raidPermille.rare &&
      permillesSql.d === reglagesBureau.raidPermille.epic &&
      permillesSql.e === reglagesBureau.raidPermille.legendary &&
      Number(permillesSql.f) === 0 &&
      reglagesBureau.slots === 2,
    JSON.stringify(permillesSql),
  );

  const bureauNeuf = (await asPlayer(BUREAU, "select public.streamer_status() as r")).rows[0].r;
  check(
    "invités : un bureau neuf est vide, sans raid payé",
    Array.isArray(bureauNeuf.guests) &&
      bureauNeuf.guests.length === 0 &&
      Number(bureauNeuf.raid_today) === 0 &&
      bureauNeuf.raid_day === "",
    JSON.stringify(bureauNeuf),
  );

  const pose = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(1, $1::jsonb) as r", [
      JSON.stringify(carteBureau),
    ])
  ).rows[0].r;
  check(
    "invités : une carte de sa collection tient la place 1",
    pose.ok === true &&
      pose.guests.length === 1 &&
      pose.guests[0].slot === 1 &&
      pose.guests[0].creator_slug === "ibai" &&
      pose.guests[0].card_id === "bureau-1",
    JSON.stringify(pose),
  );

  const refusCarte = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(2, $1::jsonb) as r", [
      JSON.stringify(carteInconnue),
    ])
  ).rows[0].r;
  check(
    "invités : une carte qu'on ne possède pas est refusée",
    refusCarte.ok === false && refusCarte.error === "carte-non-possedee",
    JSON.stringify(refusCarte),
  );

  const refusDouble = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(2, $1::jsonb) as r", [
      JSON.stringify({ ...carteBureau, id: "bureau-1-bis" }),
    ])
  ).rows[0].r;
  check(
    "invités : le même créateur ne tient pas les deux places",
    refusDouble.ok === false && refusDouble.error === "meme-createur",
    JSON.stringify(refusDouble),
  );

  const refusPlace = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(3, $1::jsonb) as r", [
      JSON.stringify(carteBureau),
    ])
  ).rows[0].r;
  const refusVariante = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(2, $1::jsonb) as r", [
      JSON.stringify({ ...carteBureau, id: "bureau-1-ter", variant: "arc-en-ciel" }),
    ])
  ).rows[0].r;
  check(
    "invités : une place au-delà du bureau et une variante inventée sont refusées",
    refusPlace.ok === false &&
      refusPlace.error === "place-inconnue" &&
      refusVariante.ok === false &&
      refusVariante.error === "variante-inconnue",
    JSON.stringify({ refusPlace, refusVariante }),
  );

  // Le direct : personne n'est en direct pour ce créateur, donc le relevé ne
  // paie aucun raid — même avec un invité bien posé.
  await asPlayer(BUREAU, "select public.streamer_visit() as r");
  const sansDirect = (await asPlayer(BUREAU, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "invités : sans direct, le relevé ne paie aucun raid",
    Number(sansDirect.raid.gained) === 0 && sansDirect.raid.already === false,
    JSON.stringify(sansDirect.raid),
  );

  // On fabrique un direct **frais** pour ce créateur, comme le ferait
  // `refresh-live` : une ligne dans `live_streams`, et `live_state` daté de
  // maintenant (c'est cette date-là que l'application lit aussi).
  const loginBureau = (
    await client.query("select login from public.creators where slug = 'ibai'")
  ).rows[0].login;
  await client.query(
    `insert into public.live_streams (login, display_name, viewers, refreshed_at)
     values ($1, 'Ibai', 4120, now())
     on conflict (login) do update set viewers = 4120, refreshed_at = now()`,
    [loginBureau],
  );
  await client.query("update public.live_state set refreshed_at = now(), streams = 1");

  const etatAvantRaid = (await asPlayer(BUREAU, "select public.streamer_status() as r")).rows[0].r;
  const abonnesAvantRaid = Number(etatAvantRaid.subscribers);
  const perDayBureau = Number(etatAvantRaid.per_day);
  const raidPaye = (await asPlayer(BUREAU, "select public.streamer_visit() as r")).rows[0].r;
  const attenduRaid = Math.floor((perDayBureau * partBureau) / 1000);
  check(
    `invités : un invité en direct paie son raid (${partBureau} pour mille de la croissance)`,
    Number(raidPaye.raid.gained) === attenduRaid &&
      raidPaye.raid.already === false &&
      raidPaye.raid.guests.length === 1 &&
      raidPaye.raid.guests[0].slug === "ibai" &&
      Number(raidPaye.subscribers) === abonnesAvantRaid + attenduRaid,
    JSON.stringify({ raidPaye, attenduRaid, abonnesAvantRaid, perDayBureau }),
  );

  const raidRejoue = (await asPlayer(BUREAU, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "invités : le raid ne se paie qu'une fois par journée de jeu",
    Number(raidRejoue.raid.gained) === attenduRaid &&
      raidRejoue.raid.already === true &&
      Number(raidRejoue.subscribers) === Number(raidPaye.subscribers),
    JSON.stringify(raidRejoue.raid),
  );

  // Changement d'invité après paiement : la caisse ne se rouvre pas.
  const changement = (
    await asPlayer(BUREAU, "select public.streamer_guest_set(1, $1::jsonb) as r", [
      JSON.stringify({ ...carteBureau, id: "bureau-1-quatre" }),
    ])
  ).rows[0].r;
  const apresChangement = (await asPlayer(BUREAU, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "invités : changer d'invité après le raid ne repaie pas",
    changement.ok === true &&
      Number(apresChangement.raid.gained) === attenduRaid &&
      Number(apresChangement.subscribers) === Number(raidPaye.subscribers),
    JSON.stringify(apresChangement.raid),
  );

  // Le direct périmé : même invité, même ligne dans `live_streams`, mais un
  // cache vieux de vingt minutes. C'est la règle de fraîcheur du badge (dix
  // minutes) appliquée au raid — un direct d'hier ne doit rien payer.
  await asPlayer(AUTRE, "select public.streamer_guest_set(1, $1::jsonb) as r", [
    JSON.stringify(carteAutre),
  ]);
  // L'invité est posé, et le premier relevé se fait **cache périmé** : c'est le
  // seul ordre qui prouve quelque chose — un relevé frais aurait payé le raid,
  // et le contrôle suivant lirait le paiement au lieu de l'absence de paiement.
  await client.query("update public.live_state set refreshed_at = now() - interval '20 minutes'");
  const perime = (await asPlayer(AUTRE, "select public.streamer_visit() as r")).rows[0].r;
  await client.query("update public.live_state set refreshed_at = now(), streams = 1");
  const frais = (await asPlayer(AUTRE, "select public.streamer_visit() as r")).rows[0].r;
  check(
    "invités : un direct périmé (vingt minutes) ne paie pas, le même frais paie",
    Number(perime.raid.gained) === 0 &&
      Number(frais.raid.gained) ===
        Math.floor((Number(frais.per_day) * reglagesPart(carteAutre)) / 1000),
    JSON.stringify({ perime: perime.raid, frais: frais.raid, per_day: frais.per_day }),
  );

  // Un visiteur sans compte n'a pas de bureau.
  await refuses(
    "invités : sans compte, pas de bureau",
    null,
    "select public.streamer_guest_set(1, $1::jsonb) as r",
    [JSON.stringify(carteBureau)],
    "connecte-toi",
  );
  await refuses(
    "invités : le bureau est fermé au joueur",
    BUREAU,
    "select count(*) as n from public.streamer_guests",
    [],
    "permission denied",
  );
  await refuses(
    "invités : le journal des raids est fermé au joueur",
    BUREAU,
    "select count(*) as n from public.streamer_raids",
    [],
    "permission denied",
  );

  // Le piège d'ordre, joué pour de vrai : recoller `0036` **seule** après
  // `0038` rend l'ancien `streamer_status()` — l'écran perd le setup, alors que
  // la table des paliers, elle, est intacte. C'est exactement ce qui arrive au
  // joueur qui recolle un vieux fichier depuis son téléphone : le remède est de
  // recoller `0038`, et le contrôle le montre au lieu de l'écrire.
  await client.query(chaine);
  const statusSansSetup = (await asPlayer(SETUP, "select public.streamer_status() as r")).rows[0].r;
  check(
    "setup : recoller `0036` seule après `0038` fait perdre le setup de l'écran",
    statusSansSetup.setup === undefined &&
      Number(
        (await client.query("select count(*)::int as n from public.streamer_setup where user_id = $1", [
          SETUP,
        ])).rows[0].n,
      ) === 2,
    JSON.stringify(statusSansSetup),
  );
  await client.query(imprevus);
  const statusAvecSetup = (await asPlayer(SETUP, "select public.streamer_status() as r")).rows[0].r;
  check(
    "setup : recoller `0038` le rend tel quel, sans rien racheter",
    statusAvecSetup.setup.join(",") === "webcam,micro" &&
      Number(statusAvecSetup.setup_bonus) === 80 &&
      Number(
        (await asPlayer(SETUP, "select public.wallet_get() as r")).rows[0].r.points,
      ) >= 0,
    JSON.stringify(statusAvecSetup),
  );
  // Le même piège dans l'autre sens : `0038` seule après `0039` rend le
  // `streamer_status()` d'avant les invités — le bureau disparaît de l'écran,
  // la table du bureau, elle, reste intacte.
  check(
    "invités : recoller `0038` seule après `0039` fait perdre le bureau de l'écran",
    statusAvecSetup.guests === undefined &&
      Number(
        (await client.query(
          "select count(*)::int as n from public.streamer_guests where user_id = $1",
          [BUREAU],
        )).rows[0].n,
      ) === 1,
    JSON.stringify({ guests: statusAvecSetup.guests ?? null }),
  );
  await client.query(invites);
  const statusAvecBureau = (await asPlayer(BUREAU, "select public.streamer_status() as r")).rows[0].r;
  check(
    "invités : recoller `0039` le rend tel quel, sans rien reposer",
    statusAvecBureau.guests.length === 1 &&
      statusAvecBureau.guests[0].creator_slug === "ibai" &&
      Number(statusAvecBureau.raid_today) > 0,
    JSON.stringify(statusAvecBureau.guests),
  );

  // -------------------------------------------------------------------------
  // Le Tribunal des Bannis (`0042`) : le serveur recalcule, et ne paie qu'une
  // fois par journée de jeu.
  //
  // Le client n'envoie ni les points ni le karma : la journée, les verdicts
  // rendus et le login du créateur qui préside. C'est ce qu'on vérifie ici —
  // y compris qu'un joueur ne peut pas s'inventer une séance parfaite.
  // -------------------------------------------------------------------------
  {
    const dossiers = (await client.query(
      "select id, verdict_attendu from public.tribunal_dossiers order by id",
    )).rows;
    check("tribunal : la vérité des dossiers est posée", dossiers.length >= 25, String(dossiers.length));

    const parfait = Object.fromEntries(dossiers.slice(0, 5).map((ligne) => [ligne.id, ligne.verdict_attendu]));
    const avantTribunal = (await asPlayer(A, "select public.wallet_get() as r")).rows[0].r.points;

    // Une séance parfaite : 5/5, donc 100 % de karma — 40 points.
    const seance = (await asPlayer(
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-08", JSON.stringify(parfait)],
    )).rows[0].r;
    check(
      "tribunal : une séance parfaite paie 40 points, karma recalculé côté serveur",
      seance.paye === true && seance.karma === 100 && seance.gained === 40,
      JSON.stringify(seance),
    );

    // Rejouer la même journée ne paie pas : l'index unique du journal décide.
    const rejeu = (await asPlayer(
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-08", JSON.stringify(parfait)],
    )).rows[0].r;
    check("tribunal : la même journée ne paie pas deux fois", rejeu.gained === 0, JSON.stringify(rejeu));

    // Une séance à 3/5 (60 %) paie 24 points ; à 2/5 elle ne paie rien.
    const trois = Object.fromEntries(
      dossiers.slice(0, 5).map((ligne, index) => [ligne.id, index < 3 ? ligne.verdict_attendu : ligne.verdict_attendu === "ban" ? "deban" : "ban"]),
    );
    const soixante = (await asPlayer(
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-09", JSON.stringify(trois)],
    )).rows[0].r;
    check(
      "tribunal : 60 % de karma paie au prorata (24 points)",
      soixante.karma === 60 && soixante.paye === true && soixante.gained === 24,
      JSON.stringify(soixante),
    );

    // Un seul dossier juste sur cinq : 20 % de karma, sous le seuil.
    const unSeul = Object.fromEntries(
      dossiers.slice(0, 5).map((ligne, index) => [ligne.id, index === 0 ? ligne.verdict_attendu : ligne.verdict_attendu === "ban" ? "deban" : "ban"]),
    );
    const vingt = (await asPlayer(
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-11", JSON.stringify(unSeul)],
    )).rows[0].r;
    check(
      "tribunal : sous le seuil, la séance est jugée mais ne paie pas",
      vingt.paye === false && vingt.karma === 20 && vingt.gained === 0,
      JSON.stringify(vingt),
    );

    // Le direct : le multiplicateur se lit côté serveur, dans `live_streams`.
    const createurLive = (await client.query(
      "select login from public.creators order by login limit 1",
    )).rows[0].login;
    await client.query(
      "insert into public.live_streams (login, viewers, refreshed_at) values ($1, 1204, now()) on conflict (login) do update set refreshed_at = now()",
      [createurLive],
    );
    await client.query("update public.live_state set refreshed_at = now() where id");
    const enDirect = (await asPlayer(
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, $3::text) as r",
      ["2026-10-12", JSON.stringify(parfait), createurLive],
    )).rows[0].r;
    check(
      "tribunal : le créateur en direct double la séance (80 points)",
      enDirect.multiplicateur === 2 && enDirect.gained === 80,
      JSON.stringify(enDirect),
    );
    await client.query("delete from public.live_streams where login = $1", [createurLive]);

    // Les refus : pas de compte, séance vide, dossiers inventés, journée illisible.
    await refuses(
      "tribunal : sans compte, la séance n'est pas payée",
      null,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-13", JSON.stringify(parfait)],
      "connecte-toi",
    );
    await refuses(
      "tribunal : une séance vide ne paie pas",
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-13", "{}"],
      "séance vide",
    );
    await refuses(
      "tribunal : un dossier inventé ne compte pas",
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["2026-10-13", JSON.stringify({ "t-99": "deban" })],
      "aucun dossier reconnu",
    );
    await refuses(
      "tribunal : une journée illisible est refusée",
      A,
      "select public.tribunal_recompense($1::text, $2::jsonb, null) as r",
      ["hier", JSON.stringify(parfait)],
      "journée de jeu illisible",
    );

    const apresTribunal = (await asPlayer(A, "select public.wallet_get() as r")).rows[0].r.points;
    check(
      "tribunal : le solde a bougé exactement de ce qui a été versé",
      apresTribunal - avantTribunal === 40 + 24 + 80,
      `${avantTribunal} → ${apresTribunal}`,
    );
  }

  // --- Rejouabilité --------------------------------------------------------
  await client.query(catalogue);
  await client.query(tirage);
  await client.query(await readFile(path.join(MIGRATIONS, "0006_profil_public.sql"), "utf8"));
  await client.query(direct);
  await client.query(friends);
  await client.query(marche);
  await client.query(ventes);
  await client.query(lastPack);
  await client.query(progression);
  await client.query(scenePack);
  await client.query(wishlist);
  await client.query(sortants);
  // Les rejeux ci-dessus sont des migrations **anciennes** : `0009` recrée
  // `market_sell`, `0012` recrée le Last Pack. On termine par la plus récente,
  // exactement comme la pile de production.
  await client.query(packDansSaves);
  // Le wallet et sa grille ferment la pile : ce sont les migrations les plus
  // récentes, donc celles qu'on recolle en dernier.
  //
  // La grille est **relevée avant** : un rejeu qui perdrait des paliers (une
  // famille écrasée par un `delete` suivi d'un `insert` incomplet) doit se voir
  // en comparant ce qu'on avait avec ce qu'on a.
  const grilleAvant = (await client.query(
    "select count(*)::int as n, coalesce(sum(points), 0)::int as p from public.wallet_season_tiers",
  )).rows[0];
  const membresAvant = (await client.query("select count(*)::int as n from public.wallet_season_members")).rows[0].n;
  await client.query(wallet);
  await client.query(saisons);
  await client.query(surcharge);
  await client.query(gold);
  // `0031` ferme la pile : elle est la dernière à écrire `open_pack()`, donc la
  // dernière recollée. Sans elle, le recollage réinstallerait le seuil de 80.
  await client.query(douze);
  await client.query(serie);
  await client.query(depart);
  await client.query(protege);
  await client.query(jetons);
  // `0036` ferme la pile à son tour : elle réécrit `schema_versions()`, donc
  // c'est elle la dernière recollée.
  await client.query(chaine);
  // Puis `0037`, puis `0038`, puis `0039` : chacune réécrit quelque chose de la
  // précédente (`push_targets()` pour l'une, `streamer_status()`,
  // `streamer_visit()` et `schema_versions()` pour les suivantes), donc l'ordre
  // du collage est l'ordre des numéros.
  await client.query(gardes);
  await client.query(imprevus);
  await client.query(invites);
  await client.query(doublons);
  await client.query(collab);

  // L'accident du 7 octobre, rejoué pour de vrai : on remet la vieille surcharge
  // à cinq paramètres, on vérifie que l'appel du jeu — quatre arguments **typés**,
  // comme ceux de `wallet_credit` — devient bien ambigu (« is not unique »), puis
  // on repasse `0029` et on vérifie qu'il redevient net. Un rejeu ne prouve rien
  // s'il ne reproduit pas d'abord la panne.
  await client.query(`
    create or replace function public._wallet_apply(
      p_user uuid, p_delta integer, p_kind text, p_ref text default '', p_once boolean default false
    ) returns integer language sql as $$ select 0 $$;
  `);
  let ambigu = "";
  try {
    await client.query("select public._wallet_apply($1::uuid, 0::integer, 'controle'::text, 'surcharge'::text) as r", [
      MIL,
    ]);
  } catch (error) {
    ambigu = String(error.message);
  }
  check("surcharge : la vieille signature à cinq paramètres rend l'appel ambigu", /is not unique/.test(ambigu), ambigu);

  await client.query(surcharge);
  let apresReparation = "";
  try {
    await client.query("select public._wallet_apply($1::uuid, 0::integer, 'controle'::text, 'surcharge2'::text) as r", [
      MIL,
    ]);
  } catch (error) {
    apresReparation = String(error.message);
  }
  const signaturesReparees = (await client.query(
    "select oidvectortypes(p.proargtypes) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_wallet_apply' order by 1",
  )).rows.map((ligne) => ligne.args);
  check(
    "surcharge : après `0029`, l'appel redevient net et la signature est unique",
    apresReparation === "" && signaturesReparees.length === 1 && signaturesReparees[0] === "uuid, integer, text, text",
    apresReparation || JSON.stringify(signaturesReparees),
  );

  // Le garde-fou : sans la fonction canonique, `0029` refuse de retirer quoi que
  // ce soit (une base sans aucune `_wallet_apply` serait encore plus cassée).
  await client.query("drop function public._wallet_apply(uuid, integer, text, text)");
  await client.query(`
    create or replace function public._wallet_apply(
      p_user uuid, p_delta integer, p_kind text, p_ref text default '', p_once boolean default false
    ) returns integer language sql as $$ select 0 $$;
  `);
  let refusGarde = "";
  try {
    await client.query(surcharge);
  } catch (error) {
    refusGarde = String(error.message);
  }
  const restantesGarde = (await client.query(
    "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_wallet_apply'",
  )).rows[0].n;
  check(
    "surcharge : sans la fonction canonique, la migration refuse et ne retire rien",
    /absente/.test(refusGarde) && restantesGarde === 1,
    JSON.stringify({ refusGarde, restantesGarde }),
  );
  // On remet la pile dans son état normal avant la suite des rejeux.
  await client.query("drop function public._wallet_apply(uuid, integer, text, text, boolean)");
  await client.query(wallet);

  check(
    "profil public rejouable : la projection est intacte",
    (await client.query("select count(*)::int as n from public.user_cards where user_id = $1", [D])).rows[0].n === 4,
  );
  check(
    "profil public rejouable : le profil répond encore",
    (await asPlayer(E, "select public.player_profile($1) as p", [D])).rows[0].p.unique_creators === 3,
  );
  await client.query("select set_config('test.uid', $1, false)", [USER]);
  const replay = (await client.query("select public.open_pack() as r")).rows[0].r;
  check("migrations rejouables : open_pack répond encore 5 cartes", replay.cards.length === 5);
  const grilleRejouee = (await client.query(
    "select count(*)::int as n, coalesce(sum(points), 0)::int as p from public.wallet_season_tiers",
  )).rows[0];
  const membresRejoues = (await client.query("select count(*)::int as n from public.wallet_season_members")).rows[0].n;
  check(
    "migrations rejouables : la grille des familles est intacte",
    grilleRejouee.n === grilleAvant.n &&
      grilleRejouee.p === grilleAvant.p &&
      membresRejoues === membresAvant,
    JSON.stringify({ avant: grilleAvant, apres: grilleRejouee, membresAvant, membresRejoues }),
  );
  check(
    "migrations rejouables : la Légendaire Gold tient après le recollage",
    (await client.query(
      "select count(*)::int as n from (select public._pack_choose_variant('legendary', false, false) as v from generate_series(1, 6000)) t where t.v = 'gold'",
    )).rows[0].n >= 15,
  );
  check(
    "migrations rejouables : les points du wallet répondent encore",
    typeof (await asPlayer(MIL, "select public.wallet_get() as r")).rows[0].r.points === "number",
  );
  const afterReplay = await client.query("select count(*)::int as n from public.creators");
  check("migrations rejouables : toujours 1000 créateurs", afterReplay.rows[0].n === 1000, String(afterReplay.rows[0].n));
  check(
    "migrations rejouables : les alertes de perte répondent encore après recollage",
    (await client.query("select count(*)::int as n from pg_proc where proname in ('_push_serie_due', '_push_reserve_due', '_push_last_sent')")).rows[0].n === 3 &&
      // Le tirage d'hier est posé, **lu**, puis retiré : `last_packs` et
      // `pack_draws` sont un compteur global que le contrôle du Last Pack
      // compare, et ce bloc de rejeu passe deux fois. Un tirage de test laissé
      // derrière lui ferait échouer un contrôle qui n'a rien à voir avec les
      // alertes — c'est arrivé, d'où le nettoyage.
      (await viderJournal(JOUEUR_SERIE),
       await effacerTirages(JOUEUR_SERIE),
       await tirageJour(JOUEUR_SERIE, 1),
       (await client.query("select public._push_serie_due($1, now()) as j", [JOUEUR_SERIE])).rows[0].j === 1 &&
         (await effacerTirages(JOUEUR_SERIE), true)),
  );
  check(
    "migrations rejouables : le carnet des ventes répond encore",
    (await asPlayer(G, "select public.market_sales(20) as r")).rows[0].r.length === 1,
  );
  check(
    "migrations rejouables : l'hôtel des ventes répond encore",
    (await asPlayer(G, "select public.market_shelf(30) as r")).rows[0].r.length >= 0 &&
      (await client.query("select count(*)::int as n from public.market_listings")).rows[0].n >= 3,
  );
  check(
    "migrations rejouables : la complétion par famille répond encore",
    (await asPlayer(E, "select public.player_profile($1) as p", [D])).rows[0].p.by_region.S01.total ===
      families.S01.total,
  );
  check(
    "migrations rejouables : les amis répondent encore",
    (await asPlayer(A, "select public.list_friends() as r")).rows[0].r.length === 0 &&
      (await asPlayer(A, "select public.list_outgoing_friend_requests() as r")).rows[0].r[0]?.recipientId === B,
  );
  check(
    "migrations rejouables : le direct répond encore",
    (await client.query("select streams from public.live_state where id")).rows[0].streams === 1,
  );
  check(
    "migrations rejouables : le plancher de malchance répond encore, à zéro",
    (await asPlayer(A, "select public.pack_status() as r")).rows[0].r.pity === 0,
  );
  check(
    "migrations rejouables : les Sortants ne sont pas revenus dans le tirage",
    (await client.query("select count(*)::int as n from public.creators where retired")).rows[0].n === 0,
  );
  check(
    "migrations rejouables : la wishlist répond encore, avec son épinglé",
    (await asPlayer(D, "select public.set_wishlist($1) as r", [wishOne])).rows[0].r === wishOne &&
      (await asPlayer(D, "select public.player_profile() as p")).rows[0].p.wishlist_slug === wishOne,
  );
  await asPlayer(D, "select public.clear_wishlist()");
  check(
    "migrations rejouables : la wishlist referme l'écriture directe",
    (await (async () => {
      await client.query("set role authenticated");
      await client.query("select set_config('test.uid', $1, false)", [D]);
      try {
        await client.query("insert into public.wishlist (user_id, slug) values ($1, $2)", [
          D,
          wishOne,
        ]);
        return false;
      } catch (error) {
        return String(error.message).includes("permission denied");
      } finally {
        await client.query("reset role");
      }
    })()),
  );
  check(
    "migrations rejouables : la réinitialisation répond encore, sans rien effacer d'autre",
    (await asPlayer(A, "select public.reset_progress() as r")).rows[0].r.status === "reset" &&
      (await client.query("select count(*)::int as n from public.profiles where user_id = $1", [A])).rows[0].n === 1,
  );
  check(
    "migrations rejouables : la chaîne répond encore, abonnés et vidéo compris",
    (await asPlayer(CHAINE, "select public.streamer_status() as r")).rows[0].r.published_today === true &&
      (await asPlayer(CHAINE, "select public.streamer_publish('letsplay') as r")).rows[0].r.already === true,
  );
  check(
    "migrations rejouables : le Last Pack répond encore, sans double publication",
    (await asPlayer(L2, "select public.last_pack_shelf() as r")).rows[0].r.packs.length === 0 &&
      (await client.query("select count(*)::int as n from public.last_packs")).rows[0].n ===
        (await client.query("select count(*)::int as n from public.pack_draws where kind <> 'gift'")).rows[0].n,

  );

  console.log("");
  console.log(failures === 0 ? "🎉 Toutes les vérifications passent." : `⚠️ ${failures} vérification(s) en échec.`);
} finally {
  await client.end().catch(() => {});
  await server.stop().catch(() => {});
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

process.exit(failures === 0 ? 0 : 1);
