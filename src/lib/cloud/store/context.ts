import { accountActions } from "./account";
import { packActions } from "./pack";
import { socialActions } from "./social";
import { marketActions } from "./market";
import { arenaActions } from "./arena";
import { walletActions } from "./wallet";
import { streamerActions } from "./streamer";
import type { CloudApi, TradeListItem } from "@/lib/cloud/api";
import type { PlayerState, TradeCard as EngineTradeCard } from "@/lib/game-engine";
import type {
  CloudActionOutcome,
  CloudDeps,
  CloudState,
} from "./types";

/**
 * Ce qu'une action du magasin reçoit : l'état courant, de quoi publier, les
 * helpers de synchronisation, et `actions` (l'objet complet) pour les appels
 * d'une action à l'autre (`this.loadMarket()` d'avant).
 */
export type CloudStoreContext = {
  readonly deps: CloudDeps;
  state(): CloudState;
  publish(patch: Partial<CloudState>): void;
  snapshot(): CloudState;
  resolve(): CloudApi | null;
  refreshIdentity(): CloudApi | null;
  currentUserId(): string | null;
  readSeen(userId: string | null): string | null;
  fail(error: unknown, fallback: string): void;
  networkReady(api: CloudApi | null): api is CloudApi;
  push(saveVersion: number, deviceUpdatedAt: number, force: boolean): Promise<void>;
  pushAfterServer(): Promise<void>;
  pull(): Promise<void>;
  creatorNames(): Map<string, string>;
  asEngineCards(cards: readonly { creatorSlug: string; variant: string; rarity: string }[]): EngineTradeCard[];
  cloudRefusal(error: unknown, fallback: string): Extract<CloudActionOutcome, { status: "unavailable" }>;
  tradeApi(): { api: CloudApi } | { refusal: Extract<CloudActionOutcome, { status: "unavailable" }> };
  refreshTrades(api: CloudApi, prefix?: string): Promise<{ list: TradeListItem[]; applied: number; blocked: number }>;
  adoptCloudIfEmpty(): Promise<number>;
  connectedMessage(adopted: number): string;
  fetchPackStatus(): Promise<{ packs: number; nextPackAt: string | null } | null>;
  /** L'objet complet des actions — posé juste après la construction. */
  actions: CloudStoreActions;
};

/** L'ensemble des actions exposées à l'interface. */
export type CloudStoreActions = {
  requestCode: ReturnType<typeof accountActions>["requestCode"];
  verifyCode: ReturnType<typeof accountActions>["verifyCode"];
  signInAsGuest: ReturnType<typeof accountActions>["signInAsGuest"];
  signInWithPassword: ReturnType<typeof accountActions>["signInWithPassword"];
  keepAccount: ReturnType<typeof accountActions>["keepAccount"];
  confirmEmailCode: ReturnType<typeof accountActions>["confirmEmailCode"];
  resendEmailCode: ReturnType<typeof accountActions>["resendEmailCode"];
  rename: ReturnType<typeof accountActions>["rename"];
  setShowcase: ReturnType<typeof accountActions>["setShowcase"];
  ping: ReturnType<typeof accountActions>["ping"];
  signOut: ReturnType<typeof accountActions>["signOut"];
  sync: ReturnType<typeof accountActions>["sync"];
  loadProfile: ReturnType<typeof accountActions>["loadProfile"];
  openProfile: ReturnType<typeof accountActions>["openProfile"];
  closeProfile: ReturnType<typeof accountActions>["closeProfile"];
  loadLeaderboard: ReturnType<typeof accountActions>["loadLeaderboard"];
  loadInbox: ReturnType<typeof accountActions>["loadInbox"];
  markInboxSeen: ReturnType<typeof accountActions>["markInboxSeen"];
  clearInbox: ReturnType<typeof accountActions>["clearInbox"];
  twitchSignInUrl: ReturnType<typeof accountActions>["twitchSignInUrl"];
  completeTwitchSignIn: ReturnType<typeof accountActions>["completeTwitchSignIn"];
  loadWishlist: ReturnType<typeof accountActions>["loadWishlist"];
  setWishlist: ReturnType<typeof accountActions>["setWishlist"];
  clearWishlist: ReturnType<typeof accountActions>["clearWishlist"];
  fingerprint: ReturnType<typeof accountActions>["fingerprint"];
  registerPush: ReturnType<typeof accountActions>["registerPush"];
  setPushLive: ReturnType<typeof accountActions>["setPushLive"];
  syncPushState: ReturnType<typeof accountActions>["syncPushState"];
  openPack: ReturnType<typeof packActions>["openPack"];
  openScenePack: ReturnType<typeof packActions>["openScenePack"];
  packStatus: ReturnType<typeof packActions>["packStatus"];
  syncWallet: ReturnType<typeof walletActions>["syncWallet"];
  recycleDoublon: ReturnType<typeof walletActions>["recycleDoublon"];
  craftWithPoints: ReturnType<typeof walletActions>["craftWithPoints"];
  syncTokens: ReturnType<typeof walletActions>["syncTokens"];
  openStreamer: ReturnType<typeof streamerActions>["openStreamer"];
  publishStreamerVideo: ReturnType<typeof streamerActions>["publishStreamerVideo"];
  chooseStreamerEvent: ReturnType<typeof streamerActions>["chooseStreamerEvent"];
  buyStreamerSetup: ReturnType<typeof streamerActions>["buyStreamerSetup"];
  sacrificeStreamerSetup: ReturnType<typeof streamerActions>["sacrificeStreamerSetup"];
  setStreamerGuest: ReturnType<typeof streamerActions>["setStreamerGuest"];
  craftWithTokens: ReturnType<typeof walletActions>["craftWithTokens"];
  claimMilestone: ReturnType<typeof walletActions>["claimMilestone"];
  claimSeason: ReturnType<typeof walletActions>["claimSeason"];
  tribunalRecompense: ReturnType<typeof walletActions>["tribunalRecompense"];
  redeemPromoCode: ReturnType<typeof packActions>["redeemPromoCode"];
  resetProgress: ReturnType<typeof packActions>["resetProgress"];
  onboardingStatus: ReturnType<typeof packActions>["onboardingStatus"];
  refreshOnboarding: ReturnType<typeof packActions>["refreshOnboarding"];
  completeTutorial: ReturnType<typeof packActions>["completeTutorial"];
  claimReturnGift: ReturnType<typeof packActions>["claimReturnGift"];
  openReturnGiftPack: ReturnType<typeof packActions>["openReturnGiftPack"];
  searchPlayers: ReturnType<typeof socialActions>["searchPlayers"];
  playerVariants: ReturnType<typeof socialActions>["playerVariants"];
  loadTrades: ReturnType<typeof socialActions>["loadTrades"];
  proposeTrade: ReturnType<typeof socialActions>["proposeTrade"];
  respondTrade: ReturnType<typeof socialActions>["respondTrade"];
  cancelTrade: ReturnType<typeof socialActions>["cancelTrade"];
  loadFriends: ReturnType<typeof socialActions>["loadFriends"];
  clearFriends: ReturnType<typeof socialActions>["clearFriends"];
  sendFriendRequest: ReturnType<typeof socialActions>["sendFriendRequest"];
  acceptFriendRequest: ReturnType<typeof socialActions>["acceptFriendRequest"];
  rejectFriendRequest: ReturnType<typeof socialActions>["rejectFriendRequest"];
  cancelFriendRequest: ReturnType<typeof socialActions>["cancelFriendRequest"];
  removeFriend: ReturnType<typeof socialActions>["removeFriend"];
  loadMarket: ReturnType<typeof marketActions>["loadMarket"];
  sellCard: ReturnType<typeof marketActions>["sellCard"];
  buyCard: ReturnType<typeof marketActions>["buyCard"];
  clearMarket: ReturnType<typeof marketActions>["clearMarket"];
  loadLastPacks: ReturnType<typeof marketActions>["loadLastPacks"];
  stealLastPack: ReturnType<typeof marketActions>["stealLastPack"];
  clearLastPacks: ReturnType<typeof marketActions>["clearLastPacks"];
  loadArena: ReturnType<typeof arenaActions>["loadArena"];
  submitArena: ReturnType<typeof arenaActions>["submitArena"];
  pickDraft: ReturnType<typeof arenaActions>["pickDraft"];
  claimArena: ReturnType<typeof arenaActions>["claimArena"];
  loadDraftSlots: ReturnType<typeof arenaActions>["loadDraftSlots"];
  clearArena: ReturnType<typeof arenaActions>["clearArena"];
};
