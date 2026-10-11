import type { CloudCore } from "./core";
import type { PushSaveResult, RemoteSaveRow } from "./types";
import { CloudError, asRecord, parseSaveRow } from "./core";
import { repairMojibake } from "@/lib/cloud/mojibake";

/**
 * Résultat d'un tirage serveur : cartes tirées + compteurs mis à jour.
 *
 * Les cartes sont infalsifiables : le serveur les a tirées avec le même
 * algorithme que le moteur local, et le client ne peut pas les modifier.
 */
export async function openPack(
  core: CloudCore,
  /**
   * Récompense de série : `perfect` (défaut) force le tirage si le 7ᵉ jour
   * est atteint, `hourglasses` prévient le serveur que le joueur préfère les
   * trois sabliers — le serveur ne les crédite pas, ils vivent sur
   * l'appareil, il se contente de ne pas forcer le tirage.
   */
  jackpot: "perfect" | "hourglasses" = "perfect",
): Promise<{
  packs: number;
  lastRegenAt: string;
  openings: number;
  cards: Array<{
    creatorSlug: string;
    rarity: string;
    variant: string;
    rareDrop: boolean;
  }>;
  /** Boosters ouverts depuis le dernier Légendaire, après ce tirage. */
  pity: number;
  /** Jours de jeu d'affilée, ce tirage compris. */
  streak: number;
  /** Ce booster a payé la garantie des 12 boosters (`pity_hit`). */
  pityHit: boolean;
  /** Ce booster a payé le Perfect du 7ᵉ jour. */
  jackpot: boolean;
  /**
   * Ce que la série a payé pour ce booster (`0032_serie_quotidienne.sql` et
   * `0035_jetons.sql`) : le jour coché, les points versés, et les jetons
   * versés. `null` quand le jour ne paie rien (le 7ᵉ jour, c'est le jackpot)
   * ou sur un projet qui n'a pas encore collé `0032` — le client retombe alors
   * sur la table locale.
   *
   * `tokens` vaut `0` quand le jour ne paie pas de jetons **ou** quand il a
   * déjà été payé : l'écran ne doit annoncer que du vrai.
   */
  streakReward: { day: number; points: number; tokens: number } | null;
  /**
   * La sauvegarde **telle que le serveur vient de l'écrire** (`0022`) : les
   * cinq cartes y sont déjà, avec des identifiants nés côté serveur. Le
   * client l'adopte au lieu de pousser la sienne — c'est ce qui empêche un
   * plantage ou un second appareil de perdre le tirage.
   *
   * `null` sur un projet qui n'a pas encore collé `0022` : l'ancien
   * comportement (le client envoie sa collection) reste alors le seul.
   */
  save: RemoteSaveRow | null;
}> {
  const result = await core.rpc("open_pack", { p_jackpot: jackpot });
  const record = asRecord(result);
  if (!record) {
    throw new CloudError("Réponse de tirage illisible.", "invalid_response", 0);
  }
  const cards = Array.isArray(record.cards)
    ? record.cards.map((card) => {
        const c = asRecord(card);
        if (!c) {
          throw new CloudError("Carte de tirage illisible.", "invalid_response", 0);
        }
        return {
          creatorSlug: String(c.creatorSlug ?? ""),
          rarity: String(c.rarity ?? ""),
          variant: String(c.variant ?? ""),
          rareDrop: Boolean(c.rareDrop),
        };
      })
    : [];
  return {
    packs: Number(record.packs ?? 0),
    lastRegenAt: String(record.last_regen_at ?? ""),
    openings: Number(record.openings ?? 0),
    cards,
    // Un serveur plus ancien (migration 0013 pas encore collée) ne renvoie
    // pas ces champs : on retombe sur les compteurs locaux plutôt que de
    // refuser un tirage déjà effectué.
    pity: Number(record.pity ?? 0),
    streak: Number(record.streak ?? 0),
    pityHit: record.pity_hit === true,
    jackpot: record.jackpot === true,
    streakReward: (() => {
      const reward = asRecord(record.streak_reward);
      if (!reward) return null;
      const day = Number(reward.day ?? 0);
      if (!Number.isFinite(day) || day <= 0) return null;
      return { day, points: Number(reward.points ?? 0), tokens: Number(reward.tokens ?? 0) };
    })(),
    save: parseSaveRow(record.save),
  };
}

/**
 * Les choix du **Paquet Scène** : cinq listes de cartes éligibles, décidées
 * par le serveur (rareté et variante comprises), plus le tirage rare du jour.
 *
 * Le même joueur, le même jour et la même famille rendent exactement la même
 * réponse : c'est ce qui permet à `openScenePack()` de la vérifier ensuite.
 */
export async function scenePackChoices(core: CloudCore, family: string): Promise<{
  day: string;
  family: string;
  rareDrop: boolean;
  choices: Array<Array<{ slug: string; rarity: string; variant: string }>>;
}> {
  const result = await core.rpc("scene_pack_choices", { p_family: family });
  const record = asRecord(result);
  if (!record) {
    throw new CloudError("Choix du Paquet Scène illisibles.", "invalid_response", 0);
  }
  const choices = Array.isArray(record.choices)
    ? record.choices.map((slot) =>
        Array.isArray(slot)
          ? slot.map((entry) => {
              const item = asRecord(entry);
              return {
                slug: String(item?.slug ?? ""),
                rarity: String(item?.rarity ?? ""),
                variant: String(item?.variant ?? "standard"),
              };
            })
          : [],
      )
    : [];
  return {
    day: String(record.day ?? ""),
    family: String(record.family ?? family),
    rareDrop: record.rare_drop === true,
    choices,
  };
}

/**
 * Valide un Paquet Scène : le serveur recalcule ses choix et refuse toute
 * carte qui n'y figure pas. Renvoie les cartes normalisées — c'est cette
 * réponse qu'on range, jamais ce qu'on a envoyé.
 */
export async function openScenePack(
  core: CloudCore,
  family: string,
  cards: Array<{ creatorSlug: string; rarity: string; variant: string }>,
): Promise<{
  family: string;
  sceneDay: string;
  rareDrop: boolean;
  cards: Array<{ creatorSlug: string; rarity: string; variant: string; rareDrop: boolean }>;
  /** La sauvegarde écrite par le serveur (`0022`), comme pour `openPack`. */
  save: RemoteSaveRow | null;
}> {
  const result = await core.rpc("open_scene_pack", { p_family: family, p_cards: cards });
  const record = asRecord(result);
  if (!record) {
    throw new CloudError("Réponse du Paquet Scène illisible.", "invalid_response", 0);
  }
  const returned = Array.isArray(record.cards)
    ? record.cards.map((card) => {
        const c = asRecord(card);
        return {
          creatorSlug: String(c?.creatorSlug ?? ""),
          rarity: String(c?.rarity ?? ""),
          variant: String(c?.variant ?? "standard"),
          rareDrop: c?.rareDrop === true,
        };
      })
    : [];
  return {
    family: String(record.family ?? family),
    sceneDay: String(record.scene_day ?? ""),
    rareDrop: record.rare_drop === true,
    cards: returned,
    save: parseSaveRow(record.save),
  };
}

/**
 * Statut de la réserve de boosters (sans rien consommer).
 *
 * Le client appelle cette fonction à la connexion pour afficher le bon
 * compteur de boosters et la date du prochain, même avant d'ouvrir.
 */
export async function packStatus(core: CloudCore): Promise<{
  packs: number;
  lastRegenAt: string;
  openings: number;
  nextPackAt: string | null;
  /** Boosters ouverts depuis le dernier Légendaire (compteur du serveur). */
  pity: number;
  /** Jours de jeu d'affilée. */
  streak: number;
  /** Le Perfect du 7ᵉ jour attend d'être dépensé. */
  jackpotReady: boolean;
  /** Journée de jeu du dernier Paquet Scène ouvert (`null` si aucun). */
  sceneDay: string | null;
  /** Le Paquet Scène du jour est-il encore là ? */
  sceneReady: boolean;
}> {
  const result = await core.rpc("pack_status", {});
  const record = asRecord(result);
  if (!record) {
    throw new CloudError("Réponse de statut illisible.", "invalid_response", 0);
  }
  return {
    packs: Number(record.packs ?? 0),
    lastRegenAt: String(record.last_regen_at ?? ""),
    openings: Number(record.openings ?? 0),
    nextPackAt: record.next_pack_at ? String(record.next_pack_at) : null,
    pity: Number(record.pity ?? 0),
    streak: Number(record.streak ?? 0),
    jackpotReady: record.jackpot_ready === true,
    sceneDay: record.scene_day ? String(record.scene_day) : null,
    // Un projet qui n'a pas encore collé `0014` ne renvoie pas le champ :
    // sans information, on laisse le paquet disponible (le serveur refusera
    // le second, avec sa propre phrase).
    sceneReady: record.scene_day === undefined ? true : record.scene_ready === true,
  };
}

/**
 * Rédème un **code promo** (`0026_promo_codes.sql`).
 *
 * Le code donne un booster **à ouvrir** : le serveur l'écrit dans sa réserve
 * (`pack_state`) et renvoie la réserve telle qu'elle est **après**. Le code
 * lui-même n'est jamais jugé ici — ni la casse, ni la date, ni les usages : le
 * serveur seul sait ce qui existe.
 *
 * Le refus du serveur est déjà une phrase française qui dit quoi faire (« code
 * promo : ce code n'existe pas », « code promo : ta réserve est pleine… ouvre un
 * booster, puis retape ce code ») : elle remonte telle quelle.
 */
export async function redeemPromoCode(
  core: CloudCore,
  code: string,
): Promise<{
  /** Combien de boosters ce code a donnés. */
  granted: number;
  /** La réserve totale du serveur après la rédemption. */
  reserve: number;
  /** La note que l'organisateur avait mise sur le code (souvent vide). */
  note: string;
}> {
  const result = await core.rpc("redeem_promo_code", { p_code: code });
  const record = asRecord(result);
  if (!record || record.ok !== true) {
    throw new CloudError("Réponse de code promo illisible.", "invalid_response", 0);
  }
  return {
    granted: Number(record.packs ?? 1),
    reserve: Number(record.reserve ?? 0),
    note: String(record.note ?? ""),
  };
}

/**
/**
 * Envoie la partie au serveur.
 *
 * `force` est le bouton « Envoyer / écraser » de l'écran de conflit : jamais
 * un envoi automatique. `baseUpdatedAt` est la version serveur que le client
 * a reçue au dernier échange (pull, envoi, tirage) : sans elle, le serveur
 * répond `conflict` plutôt que d'écraser une partie qu'il n'a pas vue —
 * c'est ce qui remplace l'arbitrage par l'horloge de l'appareil.
 */
export async function pushSave(
  core: CloudCore,
  state: unknown,
  deviceUpdatedAt: number,
  saveVersion: number,
  force = false,
  baseUpdatedAt: string | null = null,
): Promise<PushSaveResult> {
  const result = await core.rpc("push_save", {
    p_state: state,
    p_save_version: saveVersion,
    p_device_updated_at: deviceUpdatedAt,
    p_force: force,
    p_base_updated_at: baseUpdatedAt,
  });
  const record = asRecord(result);
  const status = record?.status;
  if (status === "rejected") {
    const problems = Array.isArray(record?.problems)
      ? record.problems.map((problem) => repairMojibake(String(problem)))
      : ["sauvegarde refusée"];
    return { status: "rejected", problems };
  }
  const save = parseSaveRow(record?.save);
  if (!save) throw new CloudError("Réponse d'envoi illisible.", "invalid_response", 0);
  if (status === "conflict") return { status: "conflict", save };
  if (status === "unchanged") return { status: "unchanged", save };
  return { status: "pushed", save };
}

export async function pullSave(core: CloudCore): Promise<RemoteSaveRow | null> {
  const result = await core.rpc("pull_save", {});
  return parseSaveRow(result);
}

/**
 * Rejoue la partie à zéro **côté serveur** (`0017_reinitialiser.sql`).
 *
 * Sans ça, « Réinitialiser la progression » ne remettait à zéro que
 * l'appareil : le serveur gardait sa réserve de boosters, son journal de
 * tirages et le Paquet Scène du jour, si bien qu'un joueur qui repartait de
 * zéro attendait quand même la recharge de la partie qu'il venait d'effacer.
 */
export async function resetProgress(core: CloudCore): Promise<void> {
  await core.rpc("reset_progress", {});
}

export async function onboardingStatus(core: CloudCore): Promise<{ tutorialCompleted: boolean; giftAvailable: boolean; giftClaimed: boolean; giftRemaining: number; message: string }> {
  const record = asRecord(await core.rpc("onboarding_status", {}));
  if (!record) throw new CloudError("Statut du tutoriel illisible.", "invalid_response", 0);
  return { tutorialCompleted: record.tutorial_completed === true, giftAvailable: record.gift_available === true, giftClaimed: record.gift_claimed === true, giftRemaining: Number(record.gift_remaining ?? 0), message: String(record.message ?? "") };
}

export async function completeTutorial(core: CloudCore): Promise<void> {
  await core.rpc("complete_tutorial", {});
}

export async function claimReturnGift(core: CloudCore): Promise<void> {
  await core.rpc("claim_return_gift", {});
}

export async function openReturnGiftPack(core: CloudCore): Promise<{ cards: Array<{ creatorSlug: string; rarity: string; variant: string; rareDrop: boolean }>; giftRemaining: number; save: RemoteSaveRow | null }> {
  const record = asRecord(await core.rpc("open_return_gift_pack", {}));
  if (!record || !Array.isArray(record.cards)) throw new CloudError("Réponse du cadeau illisible.", "invalid_response", 0);
  return {
    cards: record.cards.map((item) => { const card = asRecord(item); return { creatorSlug: String(card?.creatorSlug ?? ""), rarity: String(card?.rarity ?? ""), variant: String(card?.variant ?? "standard"), rareDrop: card?.rareDrop === true }; }),
    giftRemaining: Number(record.gift_remaining ?? 0),
    save: parseSaveRow(record.save),
  };
}
