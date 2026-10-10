/**
 * L'état public du cloud (`CloudState`) et les types de réponse que l'écran
 * Compte manipule : compte, boosters, échanges, hôtel, Last Pack, Arène.
 *
 * Ils vivent hors de `cloud-store.ts` pour que le magasin reste lisible : ici,
 * il n'y a que des formes de données et leur état initial.
 */
/**
 * État du compte et de la synchronisation, exposé à React.
 *
 * Le store ne connaît ni React ni le DOM : on l'instancie avec ses dépendances
 * (`createCloudStore`), ce qui permet de le tester avec un faux client et une
 * fausse partie (`src/lib/cloud/cloud-store.test.ts`). L'instance utilisée par
 * l'application est exportée en bas du fichier.
 *
 * Règle de conduite : **jamais de perte silencieuse**. Si le cloud est plus
 * récent, on ne remplace pas la partie locale tout seul — on le dit, et le
 * joueur décide.
 */
import {
  applyLastPackSteal,
  applyScenePackResult,
  applyMarketPurchase,
  applyMarketSale,
  applyPackResult,
  applyPackStatus,
  applyServerProgression,
  applyTradeResult,
  type DrawnCard,
  type StreakRewardGrant,
  type OwnedCard,
  type PlayerState,
  type TradeCard as EngineTradeCard,
} from "@/lib/game-engine";
import type { KeyValueStorage } from "@/lib/save-store";
import { sanitizeState } from "@/lib/save-store";
import { CLOUD_DISABLED_HINT, cloudConfig, type CloudConfig } from "@/lib/cloud/config";
import {
  CloudApi,
  CloudError,
  type ArenaBoard,
  type ArenaMine,
  type LeaderboardMetric,
  type LeaderboardRow,
  type LastPackShelf,
  type MarketListing,
  type PlayerProfile,
  type PlayerSearchResult,
  type TradeListItem,
} from "@/lib/cloud/api";
import {
  EMPTY_FRIEND_LISTS,
  type FriendLists,
  type Friendship,
  type SendFriendRequestOutcome,
} from "@/lib/social/friends";
import { applyAcceptedTrades, describeCards } from "@/lib/cloud/trades";
import { buildInbox, seenKey, unreadCount, type InboxItem } from "@/lib/social/inbox";
import { emailProblem, passwordProblem } from "@/lib/cloud/credentials";
import { parseOAuthReturn } from "@/lib/cloud/twitch";
import { applyArenaReward, arenaRankLabel, arenaWeekLabel } from "@/lib/arena";
import { CREATOR_BY_SLUG, type CardVariant, type Rarity } from "@/lib/catalog";
import { decideSync, stateFingerprint, syncStats, type SyncAction } from "@/lib/cloud/sync";
import { MAX_SHOWCASE, normalizeShowcase } from "@/lib/cloud/showcase";
import { deviceStorage } from "@/lib/storage";
import { gameStore, onPersist } from "@/lib/game-store";
import { createCloudStore } from "@/lib/cloud/cloud-store";

/** Délai après la dernière action avant l'envoi automatique de la partie. */
export const AUTO_PUSH_DEBOUNCE_MS = 20_000;

/** Tri du classement : le type vient du client (`leaderboard()` en base). */
export type { LeaderboardMetric };

export type CloudState = {
  /** Un projet Supabase est-il configuré dans ce build ? */
  configured: boolean;
  /** Adresse e-mail du compte connecté, sinon `null` (compte invité). */
  email: string | null;
  /**
   * Adresse en attente de confirmation par code : Supabase l'a acceptée mais
   * ne l'a pas encore appliquée (le code attend dans la boîte mail). `null`
   * quand rien n'est en attente.
   */
  pendingEmail: string | null;
  /** Nom affiché au classement, tel qu'enregistré côté serveur. */
  displayName: string | null;
  /** Cartes épinglées sur le profil public (0 à 4 slugs, dans l'ordre choisi). */
  showcase: string[];
  /**
   * Le créateur que le joueur cherche — sa wishlist (`0015_wishlist.sql`). Un
   * seul slug, ou `null`. Publié ici parce que trois écrans le lisent : le
   * bloc du classeur, le carnet (direct de l'épinglé) et la fiche publique.
   */
  wishlistSlug: string | null;
  /** Un enregistrement de wishlist est en cours (le bouton attend). */
  wishlistBusy: boolean;
  userId: string | null;
  /** Nom court du projet Supabase (affiché pour rassurer). */
  project: string | null;
  /** Un appel est en cours. */
  busy: boolean;
  /** Dernier message à afficher (succès ou erreur). */
  message: string | null;
  isError: boolean;
  /** Dernière décision de synchronisation calculée. */
  decision: SyncAction | null;
  /** Horodatage serveur de la sauvegarde cloud connue. */
  remoteUpdatedAt: number | null;
  lastSyncAt: number | null;
  /** Des changements locaux attendent d'être envoyés. */
  pending: boolean;
  leaderboard: LeaderboardRow[];
  leaderboardMetric: LeaderboardMetric;
  /**
   * Famille affichée dans le classement, quand le tri est `family`. Gardée dans
   * l'état (et non dans la feuille) pour la même raison que les amis : l'écran
   * lit, le store écrit.
   */
  leaderboardRegion: string | null;
  /**
   * Profil public ouvert (`player_profile`) : celui d'un autre joueur ou le
   * sien. `null` tant qu'aucune fiche n'est affichée — c'est aussi ce qui ferme
   * la fiche.
   */
  profile: PlayerProfile | null;
  /** La fiche affichée est en cours de chargement. */
  profileBusy: boolean;
  /**
   * Ce que le joueur de la fiche affichée a déposé à l'hôtel (« En vente »).
   * Chargé avec la fiche : la section arrive déjà remplie, sans deuxième rendu.
   */
  profileMarket: MarketListing[];
  /** Offres d'échange du joueur, en attente d'abord (serveur = source de vérité). */
  trades: TradeListItem[];
  /** Horodatage local du dernier chargement des offres. */
  tradesAt: number | null;
  /**
   * Les amis et les demandes en attente, tels que le serveur les a donnés au
   * dernier chargement. Ils vivent ici — et non dans la feuille — pour que
   * l'écran se contente de lire : un chargement déclenché à l'ouverture ne fait
   * alors aucun rendu en cascade (voir la règle `set-state-in-effect`), et
   * l'actualisation manuelle passe par le même chemin que l'ouverture.
   */
  friends: FriendLists;
  /** Horodatage local du dernier chargement des amis. */
  friendsAt: number | null;
  /** Un chargement des amis est en cours. */
  friendsBusy: boolean;
  /**
   * Le comptoir de l'hôtel des ventes (`market_shelf`) : les doublons des
   * autres joueurs, sans les siens ni les annonces périmées.
   */
  market: MarketListing[];
  /** Horodatage local du dernier chargement du comptoir. */
  marketAt: number | null;
  /** Un chargement du comptoir est en cours. */
  marketBusy: boolean;
  /**
   * Le carnet : ce qui est arrivé au joueur (offres, réponses, amis, ventes,
   * vols de Last Pack), reconstruit à partir des mêmes faits que le serveur
   * garde déjà. Aucune table « notifications » côté serveur : voir
   * `src/lib/social/inbox.ts`.
   */
  inbox: InboxItem[];
  /** Horodatage local du dernier chargement du carnet. */
  inboxAt: number | null;
  /** Nombre de lignes arrivées depuis la dernière visite du carnet. */
  inboxUnread: number;
  /** Un chargement du carnet est en cours. */
  inboxBusy: boolean;
  onboarding: { tutorialCompleted: boolean; giftAvailable: boolean; giftRemaining: number; message: string } | null;
  onboardingBusy: boolean;
  /**
   * L'étagère des Last Packs : les paquets encore exposés (les miens et ceux
   * de mes amis), tels que le serveur les donne. `null` = pas encore chargée
   * (ou `0012_last_pack.sql` pas collée).
   */
  lastPacks: LastPackShelf | null;
  /** Horodatage local du dernier chargement de l'étagère. */
  lastPacksAt: number | null;
  /** Un chargement de l'étagère est en cours. */
  lastPacksBusy: boolean;
  /**
   * L'arène : le classement de la semaine et le dépôt du joueur, tels que le
   * serveur les a donnés au dernier chargement.
   *
   * Rien de l'arène ne vit ici en propre : le score est recalculé côté serveur
   * à partir du direct réel, les arènes déposées y sont, et le draft aussi.
   * L'écran lit, le store écrit — la partie locale ne sert qu'à choisir ses
   * cinq cartes dans le classeur.
   */
  arena: ArenaBoard | null;
  /** Mon arène de la semaine : dépôt, rang, draft, récompenses en attente. */
  arenaMine: ArenaMine | null;
  /**
   * Les quinze propositions du draft du week-end : cinq emplacements de trois
   * cartes. Tirées par le serveur, dans la collection réelle — l'écran les
   * affiche, il ne les invente pas.
   */
  arenaDraftSlots: string[][] | null;
  /** Le tirage du draft est en cours. */
  arenaDraftBusy: boolean;
  /** Horodatage local du dernier chargement de l'arène. */
  arenaAt: number | null;
  /** Un appel d'arène est en cours (dépôt, draft ou encaissement). */
  arenaBusy: boolean;
  /**
   * Les notifications de direct : `true` quand cet appareil est inscrit et que
   * le joueur les veut, `false` quand il les a coupées, `null` tant qu'on ne
   * sait rien (pas de greffon, pas de compte, pas encore inscrit).
   */
  pushLive: boolean | null;
  /**
   * Sur combien d'appareils le compte reçoit les notifications. `null` tant
   * qu'on ne le sait pas : c'est ce que le serveur répond au lancement
   * (`0024_push_state.sql`), sans quoi l'interrupteur affiche un état inventé.
   */
  pushDevices: number | null;
  /** Une inscription ou un changement d'interrupteur est en cours. */
  pushBusy: boolean;
};

/**
 * Résultat d'une demande d'ouverture côté serveur.
 *
 * `drawn` : le serveur a tiré les cartes, elles sont déjà dans la partie
 * locale. `unavailable` : rien n'a été tiré ; `reason` dit quoi corriger —
 * `offline`/`no-session` → se connecter (`offline` = cloud configuré mais
 * réseau injoignable), `no-packs` → attendre la recharge, `not-configured` →
 * build sans cloud, `error` → autre refus du serveur.
 */
export type PackOpenOutcome =
  | {
      status: "drawn";
      cards: DrawnCard[];
      /**
       * Ce que la série a payé pour ce booster : le jour coché et ce qu'il
       * rapporte. `null` quand le jour ne paie rien (le 7ᵉ, c'est le jackpot).
       */
      streakReward?: StreakRewardGrant | null;
    }
  | {
      status: "unavailable";
      reason: "offline" | "no-session" | "no-packs" | "not-configured" | "error";
      message: string;
    };

/**
 * Résultat d'une action cloud : soit faite, soit refusée avec une explication.
 *
 * `reason` dit quoi corriger — `no-session`/`offline` → se connecter,
 * `not-configured` → build sans cloud, `error` → refus du serveur (message
 * déjà en français).
 */
export type CloudActionOutcome =
  /**
   * `delta` : ce que le serveur a réellement versé ou prélevé, quand l'action
   * en déplace (un mouvement de points à rejouer vaut `0`). Les écrans s'en
   * servent pour annoncer le bon chiffre — jamais celui qu'ils espéraient.
   */
  | { status: "done"; message: string; delta?: number }
  /**
   * Une étape reste à faire, mais tout va bien : c'est le cas d'un changement
   * d'adresse qui attend son code par e-mail. Rien n'est perdu, rien n'est en
   * erreur — l'écran doit juste demander le code.
   */
  | { status: "pending"; message: string }
  | {
      status: "unavailable";
      reason: "offline" | "no-session" | "not-configured" | "error";
      message: string;
    };

/**
 * Résultat d'une séance du Tribunal des Bannis encaissée.
 *
 * Le karma et le multiplicateur viennent du **serveur** : l'écran les affiche,
 * il ne les décide pas pour la récompense. `delta` est ce qui a réellement été
 * versé — 0 si la journée était déjà payée, et l'écran n'annonce alors aucun
 * gain.
 */
export type TribunalOutcome =
  | {
      status: "done";
      message: string;
      delta: number;
      karma: number;
      multiplicateur: number;
      paye: boolean;
    }
  | {
      status: "unavailable";
      reason: "offline" | "no-session" | "not-configured" | "error";
      message: string;
    };

/**
 * Résultat d'une action d'échange.
 *
 * `done` : le serveur a tranché et l'appareil s'est aligné. `unavailable` :
 * rien n'a bougé ; `reason` dit quoi corriger — `no-session`/`offline` → se
 * connecter, `not-configured` → build sans cloud, `error` → refus du serveur
 * (message déjà en français).
 */
export type TradeOutcome = CloudActionOutcome;

/**
 * Résultat d'un retour de connexion (Twitch). `none` : l'adresse examinée
 * n'était pas un retour de connexion, il n'y a rien à dire.
 */
export type OAuthOutcome = CloudActionOutcome | { status: "none" };

/** Résultat d'une action sur le compte (adresse, mot de passe). */
export type AccountOutcome = CloudActionOutcome;

/** Réponse de la recherche de partenaires (message déjà prêt à afficher). */
export type PlayerSearchOutcome = {
  players: PlayerSearchResult[];
  message: string | null;
  isError: boolean;
  /** Vrai si la recherche a bien été posée (et non refusée faute de compte). */
  asked: boolean;
};

/** Carte proposée au serveur : la rareté est relue au catalogue, jamais envoyée. */
export type TradeOfferCard = { creatorSlug: string; variant: string };

export type CloudDeps = {
  config: () => CloudConfig | null;
  storage: () => KeyValueStorage | null;
  api: (config: CloudConfig, storage: KeyValueStorage | null) => CloudApi;
  readState: () => PlayerState | null;
  applyState: (state: PlayerState) => void;
  now: () => number;
};

/** État neutre : sert aussi de snapshot serveur (pré-rendu statique). */
export const EMPTY_CLOUD_STATE: CloudState = Object.freeze({
  configured: false,
  email: null,
  displayName: null,
  showcase: [],
  wishlistSlug: null,
  wishlistBusy: false,
  userId: null,
  project: null,
  busy: false,
  message: null,
  isError: false,
  pendingEmail: null,
  decision: null,
  remoteUpdatedAt: null,
  lastSyncAt: null,
  pending: false,
  leaderboard: [],
  leaderboardMetric: "unique_creators",
  leaderboardRegion: null,
  profile: null,
  profileBusy: false,
  profileMarket: [],
  trades: [],
  tradesAt: null,
  friends: EMPTY_FRIEND_LISTS,
  friendsAt: null,
  friendsBusy: false,
  market: [],
  marketAt: null,
  marketBusy: false,
  inbox: [],
  inboxAt: null,
  inboxUnread: 0,
  inboxBusy: false,
  onboarding: null,
  onboardingBusy: false,
  lastPacks: null,
  lastPacksAt: null,
  lastPacksBusy: false,
  arena: null,
  arenaMine: null,
  arenaDraftSlots: null,
  arenaDraftBusy: false,
  arenaAt: null,
  arenaBusy: false,
  pushLive: null,
  pushDevices: null,
  pushBusy: false,
});

const EMPTY = EMPTY_CLOUD_STATE;

export type CloudStore = ReturnType<typeof createCloudStore>;
