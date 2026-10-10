/**
 * Client Supabase minimal, écrit à la main : authentification par code à 6
 * chiffres, sauvegarde, tirage, échanges, hôtel, arène.
 *
 * Pourquoi pas `@supabase/supabase-js` ? L'application n'a pas de serveur et
 * doit rester légère dans l'APK : on n'utilise ici qu'une poignée de routes,
 * sans dépendance supplémentaire à maintenir et à auditer.
 *
 * Cette classe ne garde que **la session, le transport et les délégations** :
 * le travail par domaine vit à côté — `account.ts` (compte, profil,
 * classement), `pack.ts` (boosters, sauvegarde), `social.ts` (échanges, amis),
 * `market.ts` (hôtel, Last Pack), `arena.ts` (Arène).
 */
import type { KeyValueStorage } from "@/lib/save-store";
import type { CloudConfig } from "@/lib/cloud/config";
import { cloudRequest, type CloudFetch } from "@/lib/cloud/transport";
import type {
  Friendship,
  IncomingRequest,
  OutgoingRequest,
  SendFriendRequestOutcome,
} from "@/lib/social/friends";
import { CLOUD_SESSION_KEY, CloudError, REFRESH_MARGIN_MS, asRecord, messageFor, parseSession, type CloudCore } from "./core";
import { repairMojibake } from "@/lib/cloud/mojibake";
import type { ArenaBoard, ArenaClaim, ArenaDeposit, ArenaMine, CloudSession, LastPackLoss, LastPackShelf, LastPackSteal, LeaderboardMetric, LeaderboardRow, MarketListing, MarketPurchase, MarketSale, PlayerProfile, PlayerSearchResult, PushSaveResult, RemoteSaveRow, Trade, TradeCard, TradeListItem, TradeStatus, TribunalRecompense } from "./types";
import * as account from "./account";
import * as pack from "./pack";
import * as social from "./social";
import * as market from "./market";
import * as arena from "./arena";
import type {
  StreamerEventResult,
  StreamerEventToday,
  StreamerGuestsResult,
  StreamerReturn,
  StreamerSetupPurchase,
  StreamerSetupSacrifice,
  StreamerStatus,
  StreamerVideo,
} from "./streamer";
import * as wallet from "./wallet";
import * as streamer from "./streamer";
import * as tribunal from "./tribunal";

// Tout ce que le reste de l'application importait depuis `@/lib/cloud/api`
// continue de fonctionner : les types viennent de `types.ts`.
export * from "./types";
export type {
  StreamerEventResult,
  StreamerEventToday,
  StreamerGuestRow,
  StreamerGuestsResult,
  StreamerRaidShare,
  StreamerRaidToday,
  StreamerReturn,
  StreamerSetupPurchase,
  StreamerSetupSacrifice,
  StreamerStatus,
  StreamerVideo,
} from "./streamer";
export { CLOUD_SESSION_KEY, CloudError, familyRatio } from "./core";

export class CloudApi {
  /**
   * Le contrat donné aux domaines : ils ne voient ni le stockage ni le
   * transport, seulement la session et les deux portes réseau.
   */
  private readonly core: CloudCore;

  constructor(
    private readonly config: CloudConfig,
    private readonly storage: KeyValueStorage | null,
    // Transport par défaut : client HTTP natif dans l'APK, `fetch` ailleurs
    // (voir src/lib/cloud/transport.ts). Les tests injectent un faux transport.
    private readonly request: CloudFetch = cloudRequest,
  ) {
    this.core = {
      config,
      session: () => this.session(),
      setSession: (session) => this.setSession(session),
      setSessionEmail: (email) => this.setSessionEmail(email),
      accessToken: () => this.accessToken(),
      refresh: (refreshToken) => this.refresh(refreshToken),
      request: this.request,
      headers: (token) => this.headers(token),
      send: (url, init) => this.send(url, init),
      rpc: (name, payload) => this.rpc(name, payload),
    };
  }

  // ---------------------------------------------------------------- session

  /** Session enregistrée sur l'appareil, si elle est encore lisible. */
  session(): CloudSession | null {
    const raw = this.storage?.getItem(CLOUD_SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CloudSession>;
      if (
        typeof parsed.accessToken !== "string" ||
        typeof parsed.refreshToken !== "string" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.expiresAt !== "number"
      ) {
        return null;
      }
      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        userId: parsed.userId,
        email: typeof parsed.email === "string" ? parsed.email : null,
      };
    } catch {
      return null;
    }
  }

  private setSession(session: CloudSession | null) {
    if (!this.storage) return;
    if (session) this.storage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
    else this.storage.removeItem(CLOUD_SESSION_KEY);
  }

  /** Met à jour l'e-mail retenu par la session enregistrée (après un ajout). */
  private setSessionEmail(email: string | null) {
    const session = this.session();
    if (!session) return;
    this.setSession({ ...session, email });
  }

  /** Connecté et jeton utilisable (rafraîchit si nécessaire). */
  async accessToken(): Promise<string | null> {
    const session = this.session();
    if (!session) return null;
    if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.accessToken;
    const refreshed = await this.refresh(session.refreshToken);
    return refreshed?.accessToken ?? null;
  }

  private async refresh(refreshToken: string): Promise<CloudSession | null> {
    try {
      const response = await this.request(`${this.config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        this.setSession(null);
        return null;
      }
      const session = parseSession(await response.json());
      this.setSession(session);
      return session;
    } catch {
      // Réseau coupé : on garde la session, elle resservira plus tard.
      return null;
    }
  }

  // ------------------------------------------------------------------ HTTP

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      apikey: this.config.anonKey,
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /** Enveloppe un appel : messages français, jamais de fuite de JSON brut. */
  private async send(
    url: string,
    init: { method: string; body?: string; raw?: boolean; token?: string },
  ): Promise<{ body: unknown; status: number }> {
    let response: { status: number; ok: boolean; text(): Promise<string> };
    try {
      response = await this.request(url, {
        method: init.method,
        headers: this.headers(init.token),
        body: init.body,
      });
    } catch (error) {
      // Message auto-diagnostic : sans le nom d'hôte, le chemin ni la cause
      // technique, un échec réseau est indiscernable d'une adresse de projet
      // mal recopiée ou d'un refus du WebView.
      let where = "";
      try {
        const parsed = new URL(url);
        where = `${parsed.host}${parsed.pathname}`;
      } catch {
        where = "";
      }
      const cause = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : "";
      const detail = [where, cause].filter(Boolean).join(" — ");
      throw new CloudError(
        detail
          ? `Réseau injoignable : impossible de joindre ${detail}. Vérifie ta connexion — ta partie locale est intacte.`
          : messageFor(0, "", ""),
        "network_error",
        0,
      );
    }

    const text = await response.text().catch(() => "");
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const record = asRecord(body);
      const code = typeof record?.error_code === "string" ? record.error_code : typeof record?.code === "string" ? record.code : "";
      // Le message brut vient de la base : si la migration a été collée depuis
      // la console Windows, ses accents y sont doublement encodés (« sc├¿ne »).
      // On le répare ici, une fois pour toutes les phrases du serveur.
      const raw = repairMojibake(
        typeof record?.msg === "string"
          ? record.msg
          : typeof record?.message === "string"
            ? record.message
            : text.slice(0, 200),
      );
      throw new CloudError(messageFor(response.status, code, raw), code || `http_${response.status}`, response.status);
    }
    if (init.raw) return { body, status: response.status };
    return { body, status: response.status };
  }

  /** Appelle une fonction Postgres (`/rest/v1/rpc/...`), avec un rafraîchissement de jeton sur 401. */
  private async rpc(name: string, payload: unknown): Promise<unknown> {
    const call = async (token: string | null) =>
      this.send(`${this.config.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        body: JSON.stringify(payload),
        token: token ?? undefined,
        raw: true,
      });

    let token = await this.accessToken();
    if (!token) throw new CloudError("Connecte-toi pour jouer en ligne.", "no_session", 401);
    try {
      const { body } = await call(token);
      return body;
    } catch (error) {
      const isAuthError = error instanceof CloudError && (error.status === 401 || error.status === 403);
      if (!isAuthError) throw error;
      // Jeton refusé (révoqué, projet migré) : une seule seconde chance.
      const session = await this.refresh(this.session()?.refreshToken ?? "");
      token = session?.accessToken ?? null;
      if (!token) throw new CloudError("Session expirée : reconnecte-toi.", "no_session", 401);
      const { body } = await call(token);
      return body;
    }
  }

  // ------------------------------------------------------------------- auth

  /** Envoie un code à 6 chiffres (création de compte incluse). */
  async requestOtp(email: string): Promise<void> {
    return account.requestOtp(this.core, email);
  }

  /** Vérifie le code et mémorise la session. */
  async verifyOtp(email: string, token: string): Promise<CloudSession> {
    return account.verifyOtp(this.core, email, token);
  }

  /**
   * Valide le changement d'adresse par le code à 6 chiffres reçu par e-mail.
   *
   * C'est la seule façon de terminer un changement d'adresse depuis l'app : un
   * lien de confirmation renverrait vers une page web, et il n'y a pas de
   * serveur pour la recevoir. Le modèle « Change email address » doit contenir
   * `{{ .Token }}` (docs/cloud-supabase.md, § 2).
   */
  async verifyEmailChange(email: string, token: string): Promise<CloudSession> {
    return account.verifyEmailChange(this.core, email, token);
  }

  /** Redemande un code de changement d'adresse (le précédent a expiré). */
  async resendEmailChange(email: string): Promise<void> {
    return account.resendEmailChange(this.core, email);
  }

  async signOut(): Promise<void> {
    return account.signOut(this.core);
  }

  /**
   * Compte invité : Supabase crée un utilisateur sans adresse e-mail.
   *
   * C'est la voie la plus rapide pour avoir un identifiant cloud — aucun SMTP,
   * aucun domaine, aucun envoi d'e-mail. En contrepartie, le compte vit avec la
   * session enregistrée sur l'appareil : perdre la session (réinstallation,
   * données effacées) perd l'accès au compte. On pourra y attacher une adresse
   * e-mail plus tard, quand un SMTP existera.
   */
  async signInAnonymously(): Promise<CloudSession> {
    return account.signInAnonymously(this.core);
  }

  /**
   * Attache une adresse e-mail et/ou un mot de passe au compte connecté.
   *
   * C'est la voie de secours d'un **compte invité** : le mot de passe ne
   * déclenche aucun envoi d'e-mail, donc il fonctionne sans SMTP (contrairement
   * au code à 6 chiffres). Deux réponses possibles :
   *
   *   * appliqué — l'adresse est enregistrée tout de suite (projet réglé avec
   *     « Confirm email » désactivé, le seul réglage qui marche pour un invité) ;
   *   * en attente — Supabase a envoyé un lien de confirmation à la nouvelle
   *     adresse : il faut le cliquer, donc un SMTP configuré.
   *
   * Le jeton d'accès reste valable : on met simplement à jour l'adresse de la
   * session enregistrée pour que l'écran Compte affiche la bonne.
   */
  async updateAccount(update: { email?: string; password?: string }): Promise<{
    /** La demande a pris effet tout de suite. */
    applied: boolean;
    /** Adresse en attente de confirmation, le cas échéant. */
    pendingEmail: string | null;
    /** Adresse retenue par le compte après l'appel. */
    email: string | null;
  }> {
    return account.updateAccount(this.core, update);
  }

  /**
   * Connexion par adresse e-mail et mot de passe.
   *
   * Ne demande aucun envoi d'e-mail : c'est le chemin de récupération d'un
   * compte invité auquel on a attaché un mot de passe, sur un autre appareil.
   */
  async signInWithPassword(email: string, password: string): Promise<CloudSession> {
    return account.signInWithPassword(this.core, email, password);
  }

  /** Profil public du joueur (nom affiché, vitrine), ou `null` s'il n'existe pas. */
  async profile(userId: string): Promise<{ displayName: string; showcaseSlugs: string[] } | null> {
    return account.profile(this.core, userId);
  }

  /**
   * Épingle jusqu'à 4 cartes de sa collection sur son profil public.
   *
   * Le contrôle est côté serveur : une carte que le joueur ne possède pas fait
   * échouer l'appel (message en français remonté tel quel). Le serveur renvoie
   * la vitrine enregistrée, dans l'ordre où il l'a rangée.
   */
  async setShowcase(slugs: string[]): Promise<string[]> {
    return account.setShowcase(this.core, slugs);
  }

  /**
   * Le créateur épinglé (wishlist) — le sien par défaut, ou celui d'un autre
   * joueur. `null` quand il n'y en a pas.
   */
  async wishlistSlug(userId?: string): Promise<string | null> {
    return account.wishlistSlug(this.core, userId);
  }

  /**
   * Épingle un créateur. Aucune possession n'est exigée : c'est justement le
   * but — réclamer celui qu'on n'a pas. Le serveur vérifie seulement qu'il
   * existe au catalogue, et renvoie le slug retenu.
   */
  async setWishlist(slug: string): Promise<string> {
    return account.setWishlist(this.core, slug);
  }

  /** Retire l'épinglé. Sans épinglé, l'appel ne fait rien (et ne casse rien). */
  async clearWishlist(): Promise<void> {
    return account.clearWishlist(this.core);
  }

  /** Change le nom affiché au classement (ligne `profiles` du joueur). */
  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    return account.updateDisplayName(this.core, userId, displayName);
  }

  /**
   * Teste la joignabilité du projet : `GET /auth/v1/health`, lecture pure,
   * aucune donnée modifiée. Sert au bouton « Tester la connexion » de l'écran
   * Compte — et à distinguer une panne réseau d'une configuration erronée.
   */
  async ping(): Promise<{ host: string }> {
    return account.ping(this.core);
  }

  // --------------------------------------------------------------- Twitch

  /**
   * L'adresse à ouvrir pour se connecter avec Twitch. Supabase (et non
   * l'appareil) détient le secret du client Twitch ; l'appareil ne fait
   * qu'ouvrir la porte et attendre le retour.
   */
  twitchAuthorizeUrl(redirectTo: string): string {
    return account.twitchAuthorizeUrl(this.core, redirectTo);
  }

  /**
   * Installe une session obtenue par OAuth (Twitch).
   *
   * Le fragment d'une redirection Supabase ne contient que les jetons, pas
   * l'utilisateur : on demande donc `/auth/v1/user` avec le jeton frais, puis on
   * enregistre la session comme les autres. C'est ce qui rend la connexion
   * Twitch indiscernable du reste de l'app une fois installée.
   */
  async adoptSession(tokens: { accessToken: string; refreshToken: string; expiresIn: number }): Promise<CloudSession> {
    return account.adoptSession(this.core, tokens);
  }

  async leaderboard(
    limit = 20,
    metric: LeaderboardMetric = "unique_creators",
    region: string | null = null,
  ): Promise<LeaderboardRow[]> {
    return account.leaderboard(this.core, limit, metric, region);
  }

  /**
   * Le profil public d'un joueur (`player_profile`) : identité, chiffres,
   * complétion, rangs et vitrine. Sans identifiant, celui du compte connecté.
   * `null` si ce joueur n'a jamais envoyé sa partie au cloud.
   */
  async playerProfile(userId?: string): Promise<PlayerProfile | null> {
    return account.playerProfile(this.core, userId);
  }

  /** Inscrit le jeton de notification de cet appareil (`0023`). */
  async registerPushToken(token: string, platform = "android"): Promise<void> {
    return account.registerPushToken(this.core, token, platform);
  }

  /** L'état des notifications du compte : lecture seule (`0024`). */
  async pushState(): Promise<{ live: boolean; devices: number }> {
    return account.pushState(this.core);
  }

  /** Retire le jeton de cet appareil : plus rien n'arrive ici. */
  async forgetPushToken(token: string): Promise<void> {
    return account.forgetPushToken(this.core, token);
  }

  /** L'interrupteur des notifications de direct, sur tous les appareils. */
  async setPushLive(enabled: boolean): Promise<number> {
    return account.setPushLive(this.core, enabled);
  }

  // ---------------------------------------------------------------- boosters

  /**
   * Résultat d'un tirage serveur : cartes tirées + compteurs mis à jour.
   *
   * Les cartes sont infalsifiables : le serveur les a tirées avec le même
   * algorithme que le moteur local, et le client ne peut pas les modifier.
   */
  async openPack(
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
    /** Ce que la série a payé (`0032`) : le jour coché et ses points. */
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
    return pack.openPack(this.core, jackpot);
  }

  /**
   * Les choix du **Paquet Scène** : cinq listes de cartes éligibles, décidées
   * par le serveur (rareté et variante comprises), plus le tirage rare du jour.
   *
   * Le même joueur, le même jour et la même famille rendent exactement la même
   * réponse : c'est ce qui permet à `openScenePack()` de la vérifier ensuite.
   */
  async scenePackChoices(family: string): Promise<{
    day: string;
    family: string;
    rareDrop: boolean;
    choices: Array<Array<{ slug: string; rarity: string; variant: string }>>;
  }> {
    return pack.scenePackChoices(this.core, family);
  }

  /**
   * Valide un Paquet Scène : le serveur recalcule ses choix et refuse toute
   * carte qui n'y figure pas. Renvoie les cartes normalisées — c'est cette
   * réponse qu'on range, jamais ce qu'on a envoyé.
   */
  async openScenePack(
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
    return pack.openScenePack(this.core, family, cards);
  }

  /**
   * Statut de la réserve de boosters (sans rien consommer).
   *
   * Le client appelle cette fonction à la connexion pour afficher le bon
   * compteur de boosters et la date du prochain, même avant d'ouvrir.
   */
  async packStatus(): Promise<{
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
    return pack.packStatus(this.core);
  }

  /**
   * Rédème un code promo (réglages → « J'ai un code »).
   *
   * Le code donne un booster à ouvrir ; c'est le magasin qui relit ensuite
   * `pack_status()` pour le faire remonter à la partie locale.
   */
  async redeemPromoCode(code: string): Promise<{ granted: number; reserve: number; note: string }> {
    return pack.redeemPromoCode(this.core, code);
  }

  // ----------------------------------------------------------------- wallet

  /**
   * Le solde du joueur, côté serveur (`0027_wallet.sql`).
   *
   * C'est **lui** qui fait foi : la partie locale en garde un miroir, pour
   * l'affichage, et le serveur le recale à chaque lecture.
   */
  async walletGet(): Promise<number> {
    return wallet.walletGet(this.core);
  }

  /** Demande un gain. Le montant vient du serveur, jamais de l'appelant. */
  async walletCredit(kind: string, ref = ""): Promise<{ delta: number; points: number }> {
    return wallet.walletCredit(this.core, kind, ref);
  }

  /** Paie une dépense (l'artisanat). Le coût est recalculé par le serveur. */
  async walletSpend(kind: string, ref = ""): Promise<{ delta: number; points: number }> {
    return wallet.walletSpend(this.core, kind, ref);
  }

  /** Le solde de jetons du serveur (`0035_jetons.sql`). */
  async tokensGet(): Promise<number> {
    return wallet.tokensGet(this.core);
  }

  /** Rejoint un créateur contre 400 jetons — le serveur relit le prix. */
  async tokensSpend(slug: string): Promise<{ spent: number; tokens: number }> {
    return wallet.tokensSpend(this.core, slug);
  }

  // ------------------------------------------------------------------ chaîne

  /**
   * L'état de la chaîne (`0036_streamer.sql`).
   *
   * C'est le serveur qui porte les abonnés : la partie locale en garde un
   * miroir pour l'affichage, jamais l'autorité.
   */
  async streamerStatus(): Promise<StreamerStatus> {
    return streamer.streamerStatus(this.core);
  }

  /**
   * Le retour du joueur : la chaîne a grandi pendant son absence.
   *
   * Les journées comptées viennent de l'horloge **du serveur**, plafonnées à
   * sept ; reculer l'horloge du téléphone ne crédite rien.
   */
  async streamerVisit(): Promise<StreamerReturn> {
    return streamer.streamerVisit(this.core);
  }

  /**
   * Publie la vidéo du jour et rend son résultat.
   *
   * Le tirage est fait par le serveur : le client envoie un nom de format et
   * rien d'autre. Une seconde publication le même jour relit la première.
   */
  async streamerPublish(format: string): Promise<StreamerVideo> {
    return streamer.streamerPublish(this.core, format);
  }

  /**
   * La carte d'imprévu du jour (`0038_imprevus_setup.sql`).
   *
   * Le serveur ne renvoie qu'un identifiant de carte : le texte vit dans
   * `src/data/streamer.json`. Un imprévu déjà joué ressort avec sa réponse.
   */
  async streamerEventToday(): Promise<StreamerEventToday> {
    return streamer.streamerEventToday(this.core);
  }

  /**
   * Répond à l'imprévu du jour : on envoie la carte **et** le côté choisi.
   *
   * Le serveur refuse une carte qui n'est pas celle du jour et relit la
   * première réponse si on appelle deux fois — comme la vidéo, l'imprévu ne se
   * rejoue pas.
   */
  async streamerChoose(event: string, choice: string): Promise<StreamerEventResult> {
    return streamer.streamerChoose(this.core, event, choice);
  }

  /**
   * Achète un palier de **setup** (`0038_imprevus_setup.sql`) : le prix est
   * celui du serveur, la dépense passe par le wallet, et le palier ne
   * s'installe qu'une fois, dans l'ordre.
   */
  async streamerSetupBuy(level: string): Promise<StreamerSetupPurchase> {
    return streamer.streamerSetupBuy(this.core, level);
  }

  /**
   * Sacrifie des **doublons** pour le prochain palier du studio (`0040`) : les
   * cartes quittent le classeur, et le serveur renvoie celles qu'il a prises.
   */
  async streamerSetupSacrifice(cardIds: string[]): Promise<StreamerSetupSacrifice> {
    return streamer.streamerSetupSacrifice(this.core, cardIds);
  }

  /**
   * Pose un invité sur le **bureau**, ou libère sa place (`0039`).
   *
   * Le client envoie la carte telle qu'elle est dans sa collection ; le serveur
   * vérifie qu'elle est bien au joueur (même règle que les échanges et
   * l'hôtel), refuse deux fois le même créateur, et renvoie le bureau complet.
   */
  async streamerGuestSet(
    slot: number,
    card: { id: string; creatorSlug: string; rarity: string; variant: string } | null,
  ): Promise<StreamerGuestsResult> {
    return streamer.streamerGuestSet(this.core, slot, card);
  }

  // ------------------------------------------------------------------ saves

  /**
   * Envoie la partie au serveur.
   *
   * `force` est le bouton « Envoyer / écraser » de l'écran de conflit : jamais
   * un envoi automatique. `baseUpdatedAt` est la version serveur que le client
   * a reçue au dernier échange (pull, envoi, tirage) : sans elle, le serveur
   * répond `conflict` plutôt que d'écraser une partie qu'il n'a pas vue —
   * c'est ce qui remplace l'arbitrage par l'horloge de l'appareil.
   */
  async pushSave(
    state: unknown,
    deviceUpdatedAt: number,
    saveVersion: number,
    force = false,
    baseUpdatedAt: string | null = null,
  ): Promise<PushSaveResult> {
    return pack.pushSave(this.core, state, deviceUpdatedAt, saveVersion, force, baseUpdatedAt);
  }

  async pullSave(): Promise<RemoteSaveRow | null> {
    return pack.pullSave(this.core);
  }

  /**
   * Rejoue la partie à zéro **côté serveur** (`0017_reinitialiser.sql`).
   *
   * Sans ça, « Réinitialiser la progression » ne remettait à zéro que
   * l'appareil : le serveur gardait sa réserve de boosters, son journal de
   * tirages et le Paquet Scène du jour, si bien qu'un joueur qui repartait de
   * zéro attendait quand même la recharge de la partie qu'il venait d'effacer.
   */
  async resetProgress(): Promise<void> {
    return pack.resetProgress(this.core);
  }

  async onboardingStatus(): ReturnType<typeof pack.onboardingStatus> { return pack.onboardingStatus(this.core); }
  async completeTutorial(): Promise<void> { return pack.completeTutorial(this.core); }
  async claimReturnGift(): Promise<void> { return pack.claimReturnGift(this.core); }
  async openReturnGiftPack(): ReturnType<typeof pack.openReturnGiftPack> { return pack.openReturnGiftPack(this.core); }

  // ---------------------------------------------------------------- échanges

  /**
   * Cherche un joueur par son pseudo (2 caractères minimum, hors soi-même).
   *
   * Réservé au serveur : la fonction ne renvoie que pseudo, niveau et nombre de
   * créateurs uniques — jamais les collections, qui restent privées.
   */
  async searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    return social.searchPlayers(this.core, query);
  }

  /**
   * Variantes qu'un joueur possède pour un créateur donné.
   *
   * La collection des autres reste privée : la réponse ne concerne qu'un seul
   * créateur, et ne dit que les variantes (jamais les comptes). Sert à formuler
   * une offre qui a une chance d'aboutir.
   */
  async playerVariants(userId: string, slug: string): Promise<string[]> {
    return social.playerVariants(this.core, userId, slug);
  }

  /**
   * Propose un échange : `given` (ce que j'offre) contre `wanted` (ce que je
   * demande). Le serveur recopie la rareté depuis le catalogue et vérifie que je
   * possède bien ce que j'offre, sur ma **sauvegarde cloud**.
   *
   * `recipientMissing` renseigne une carte que le destinataire ne possède pas
   * (d'après sa dernière sauvegarde) : l'offre part quand même, l'appareil
   * prévient le joueur qu'elle restera sans doute sans réponse.
   */
  async createTrade(
    recipientId: string,
    given: Array<{ creatorSlug: string; variant: string }>,
    wanted: Array<{ creatorSlug: string; variant: string }>,
  ): Promise<{ trade: Trade; recipientMissing: TradeCard | null }> {
    return social.createTrade(this.core, recipientId, given, wanted);
  }

  /**
   * Répond à une offre reçue. Accepter déplace les cartes des **deux** côtés
   * dans la même transaction : le serveur ne croit ni l'un ni l'autre sur
   * parole, il relit les deux collections avant de bouger quoi que ce soit.
   *
   * `given` / `received` sont renvoyés du point de vue de l'appelant, pour que
   * l'appareil applique exactement le même changement à sa partie locale.
   */
  async respondTrade(
    tradeId: number,
    accept: boolean,
  ): Promise<{ status: TradeStatus; trade: Trade; given: TradeCard[]; received: TradeCard[] }> {
    return social.respondTrade(this.core, tradeId, accept);
  }

  /** Retire une offre encore en attente (seul le proposeur peut l'annuler). */
  async cancelTrade(tradeId: number): Promise<Trade> {
    return social.cancelTrade(this.core, tradeId);
  }

  /**
   * Offres du joueur : reçues et envoyées, en attente d'abord.
   *
   * L'appareil s'en sert aussi pour appliquer une offre acceptée pendant qu'il
   * était ailleurs : les cartes sont déjà écrites côté serveur, la partie locale
   * se réaligne dessus (`applyTradeResult`).
   */
  async listTrades(): Promise<TradeListItem[]> {
    return social.listTrades(this.core);
  }

  // -------------------------------------------------------------- Amis
  //
  // Le serveur décide tout (voir `0008_friends.sql`) : ces méthodes ne font que
  // lire ses réponses et les mettre en forme. Chacune est **tolérante** — une
  // ligne illisible est ignorée plutôt que de faire échouer toute la liste —
  // parce qu'un écran d'amis qui ne s'ouvre pas est pire qu'un ami manquant.

  async listFriends(): Promise<Friendship[]> {
    return social.listFriends(this.core);
  }

  async listIncomingFriendRequests(): Promise<IncomingRequest[]> {
    return social.listIncomingFriendRequests(this.core);
  }

  async listOutgoingFriendRequests(): Promise<OutgoingRequest[]> {
    return social.listOutgoingFriendRequests(this.core);
  }

  /**
   * Envoie une demande d'ami. `recipientId` est l'identifiant du **joueur**
   * (`profiles.user_id`) — on le trouve par `searchPlayers()`, jamais en le
   * devinant : un identifiant inventé ne peut pas aboutir côté serveur.
   */
  async sendFriendRequest(recipientId: string): Promise<SendFriendRequestOutcome> {
    return social.sendFriendRequest(this.core, recipientId);
  }

  /**
   * Accepte une demande reçue. Vrai si le serveur a bien basculé la demande.
   *
   * On lit `request.status` et non `friendship` : si la relation existait déjà,
   * le serveur ne renvoie pas de ligne `friends` (insertion sans conflit) alors
   * que la demande, elle, a bien été acceptée.
   */
  async acceptFriendRequest(requestId: number): Promise<boolean> {
    return social.acceptFriendRequest(this.core, requestId);
  }

  async rejectFriendRequest(requestId: number): Promise<void> {
    return social.rejectFriendRequest(this.core, requestId);
  }

  async cancelFriendRequest(requestId: number): Promise<void> {
    return social.cancelFriendRequest(this.core, requestId);
  }

  async removeFriend(friendId: string): Promise<void> {
    return social.removeFriend(this.core, friendId);
  }

  /** Deux joueurs sont-ils amis ? Sert au profil public (« Ajouter en ami »). */
  async hasFriendship(userId: string): Promise<boolean> {
    return social.hasFriendship(this.core, userId);
  }

  // ------------------------------------------------------------------ hôtel

  /**
   * Le comptoir : les cartes des autres joueurs, les plus récentes d'abord.
   * Les siennes sont exclues, comme les annonces de plus de trente jours.
   */
  async marketShelf(limit = 30): Promise<MarketListing[]> {
    return market.marketShelf(this.core, limit);
  }

  /**
   * Dépose un doublon à l'hôtel. Le serveur vérifie que la carte est bien dans
   * la collection envoyée, que ce n'est pas la dernière copie, et **paie tout
   * de suite** : `points` est le nouveau solde, à appliquer côté appareil.
   */
  async marketSell(cardId: string): Promise<{ listing: MarketListing; payout: number; points: number }> {
    return market.marketSell(this.core, cardId);
  }

  /**
   * Les annonces ouvertes d'un joueur (« qu'a-t-il déposé à l'hôtel ? »).
   * Sans identifiant, les siennes. Sert à la vitrine de la fiche publique.
   */
  async marketListingsOf(userId?: string): Promise<MarketListing[]> {
    return market.marketListingsOf(this.core, userId);
  }

  /**
   * Tes ventes récentes à l'hôtel (`market_sales()`), de quoi remplir le carnet
   * de notifications — le comptoir, lui, ne montre que ce qui est encore à
   * vendre.
   *
   * Vide si la fonction n'est pas encore collée sur le projet : le carnet vit
   * sans les ventes, et l'appelant n'a rien à faire de spécial.
   */
  async marketSales(limit = 20): Promise<MarketSale[]> {
    return market.marketSales(this.core, limit);
  }

  /**
   * Achète une carte au comptoir. Le serveur débite les points, écrit la carte
   * dans la sauvegarde et referme l'annonce ; `card` est exactement ce que
   * l'appareil doit ajouter à sa collection.
   */
  async marketBuy(listingId: number): Promise<{ card: MarketPurchase; price: number; points: number }> {
    return market.marketBuy(this.core, listingId);
  }

  /**
   * L'étagère des Last Packs : mes paquets et ceux de mes amis, tant qu'ils
   * sont frais (dix minutes), avec les cartes déjà prises.
   *
   * Renvoie `null` quand `0012_last_pack.sql` n'est pas encore collée : la
   * feuille dit alors qu'il n'y a rien d'exposé plutôt que d'afficher une
   * erreur réseau. Rien n'est deviné côté client : c'est le serveur qui sait
   * qui est exposé, et pour combien de temps.
   */
  async lastPackShelf(): Promise<LastPackShelf | null> {
    return market.lastPackShelf(this.core);
  }

  /**
   * Vole une carte dans le paquet d'un ami. Le serveur vérifie tout (amitié,
   * fenêtre, une carte par jour, carte encore là) et réécrit **les deux**
   * collections ; `card` est ce que l'appareil doit ajouter à la sienne.
   */
  async lastPackSteal(packId: number, index: number): Promise<LastPackSteal> {
    return market.lastPackSteal(this.core, packId, index);
  }

  /**
   * Ce qu'on t'a pris (`last_pack_losses()`) : de quoi remplir le carnet de
   * notifications. Vide si la migration n'est pas collée.
   */
  async lastPackLosses(limit = 20): Promise<LastPackLoss[]> {
    return market.lastPackLosses(this.core, limit);
  }

  // ------------------------------------------------------------------- arène

  /**
   * Dépose une arène (cinq slugs alignés).
   *
   * Le score n'est pas envoyé : c'est le serveur qui le calcule, à partir du
   * direct frais qu'il connaît. Le client ne peut donc pas s'inventer un score
   * — il choisit cinq cartes, et c'est tout.
   */
  async arenaSubmit(lineup: string[]): Promise<ArenaDeposit> {
    return arena.arenaSubmit(this.core, lineup);
  }

  /** Mon arène de la semaine : dépôt, rang, draft, récompenses en attente. */
  async arenaMe(): Promise<ArenaMine> {
    return arena.arenaMe(this.core);
  }

  /** Le classement d'une semaine (`null` = la semaine en cours). */
  async arenaLeaderboard(week?: string | null): Promise<ArenaBoard> {
    return arena.arenaLeaderboard(this.core, week);
  }

  /**
   * Réclame la récompense d'une semaine terminée.
   *
   * Le serveur répond une seule fois `hourglasses > 0` : les sabliers sont
   * crédités par l'appareil (comme les points et l'XP), mais le fait de les
   * avoir reçus est enregistré côté serveur — deux appareils ne peuvent pas
   * toucher deux fois la même semaine.
   */
  async arenaClaim(week: string): Promise<ArenaClaim> {
    return arena.arenaClaim(this.core, week);
  }

  /** Les quinze propositions du draft du week-end (cinq emplacements de trois). */
  async arenaDraftChoices(): Promise<{ week: string; slots: string[][] }> {
    return arena.arenaDraftChoices(this.core);
  }

  /** Enregistre les cinq choix du draft : ils deviennent l'arène de la semaine. */
  async arenaDraftPick(lineup: string[]): Promise<ArenaDeposit> {
    return arena.arenaDraftPick(this.core, lineup);
  }

  /**
   * Fait payer une séance du Tribunal par le serveur (`0042_tribunal.sql`).
   *
   * Le client envoie la journée, les verdicts et le login du créateur qui
   * préside ; le serveur recalcule le karma et les points, et ne paie qu'une
   * fois par journée de jeu.
   */
  async tribunalRecompense(
    day: string,
    verdicts: Record<string, string>,
    login: string | null,
  ): Promise<TribunalRecompense> {
    return tribunal.tribunalRecompense(this.core, day, verdicts, login);
  }
}
