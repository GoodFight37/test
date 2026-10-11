"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { BookOpen, CircleUserRound, Hammer, X, Zap } from "lucide-react";
import { AccountSheet } from "@/components/account-sheet";
import { LoadingScreen, TopBar } from "@/components/app-chrome";
import { CollectionView } from "@/components/binder-view";
import { HomeView } from "@/components/drop-view";
import { MissionsView } from "@/components/missions-view";
import { ProfileView } from "@/components/profile-view";

import { FriendsSheet } from "@/components/friends-sheet";
import { MarketSheet } from "@/components/market-sheet";
import { LastPackSheet } from "@/components/last-pack-sheet";
import { ArenaSheet } from "@/components/arena-sheet";
import { NotificationsSheet } from "@/components/notifications-sheet";
import type { AccountFocus } from "@/lib/account-display";
import type { InboxTarget } from "@/lib/social/inbox";
import { friendsOpenedRecently } from "@/lib/social/inbox";
import { AtelierView } from "@/components/atelier-view";

import { PackTear } from "@/components/pack-tear";
import { PackOddsSheet } from "@/components/pack-odds-sheet";
import { RevealOverlay } from "@/components/reveal-overlay";
import { TribunalView, type TribunalPayout } from "@/components/tribunal-view";
import { WishlistSheet } from "@/components/wishlist-sheet";
import { PublicProfileSheet } from "@/components/public-profile-sheet";
import { StudioSheet } from "@/components/studio-sheet";
import { ThemeSheet } from "@/components/theme-sheet";

import { useCloud, useCloudAutoSync } from "@/hooks/use-cloud";
import { usePackOpening } from "@/hooks/use-pack-opening";
import { usePoints } from "@/hooks/use-points";
import { usePush } from "@/hooks/use-push";
import { useInbox } from "@/hooks/use-inbox";
import { useGame, useNow } from "@/hooks/use-game";
import { useTwitchReturn } from "@/hooks/use-twitch-return";
import { minimizeApp, useAndroidBack } from "@/hooks/use-android-back";
import { useBackHandler } from "@/hooks/use-back-handler";
import { useLive, useLivePolling } from "@/hooks/use-live";
import { readySteals } from "@/lib/last-pack";

import { buzz } from "@/lib/haptics";
import {
  SFX_USUELS,
  playCoins,
  playPackOpening,
  playReward,
  preloadSamples,
} from "@/lib/sfx";
import { getGameView, type DrawnCard, type StreakRewardGrant } from "@/lib/game-engine";
import { gameDay } from "@/lib/progression";
import {
  PACK_TEAR_HAPTIC,
} from "@/lib/reveal";
import { dossiersDuJour } from "@/lib/tribunal";

import { THEME_VAR_NAMES } from "@/lib/cosmetics";
import { gameStore } from "@/lib/game-store";
import { cloudStore } from "@/lib/cloud/cloud-store";


type Tab = "home" | "collection" | "missions" | "atelier" | "profile";

/*
 * **Quatre piliers, et c'est tout** : Drop, Binder, Craft, Toi. Les Objectifs
 * restent hors de la barre — c'est un rendez-vous quotidien, pas un endroit où
 * l'on vit — et s'ouvrent depuis le Drop et depuis le menu.
 *
 * La simulation de streameur (« Ta chaîne ») a quitté l'application le
 * 8 octobre 2026 : ni onglet, ni ligne d'accueil, ni écran. Son moteur est
 * resté dans le dépôt (`src/lib/streamer.ts`, `src/data/streamer.json`, les
 * migrations) — mais rien de tout ça n'est affiché.
 */
const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Drop", icon: <Zap size={22} /> },
  { id: "collection", label: "Binder", icon: <BookOpen size={22} /> },
  { id: "atelier", label: "Craft", icon: <Hammer size={22} /> },
  { id: "profile", label: "Toi", icon: <CircleUserRound size={22} /> },
];


export function CreatorDeckApp() {
  // L'aiguille de preuve sociale : « N amis ont ouvert un booster il y a moins
  // d'une heure ». Elle se lit dans le carnet (aucun appel serveur en plus) et
  // se recalcule à la minute, pour qu'elle disparaisse toute seule.
  const { items: inboxItems } = useInbox();
  const friendsNow = useNow(60_000);
  const friendsOpening = friendsOpenedRecently(inboxItems, friendsNow).count;
  // Termine une connexion Twitch si l'on revient d'un aller-retour navigateur.
  useTwitchReturn();
  const state = useGame();
  const cloud = useCloud();
  // Qui paie les points : le serveur quand le joueur est connecté (voir
  // `usePoints`), l'appareil sinon.
  const points = usePoints();
  // Le carnet de notifications se remplit à l'ouverture, puis toutes les cinq
  // minutes : c'est lui qui porte la pastille du menu « Toi ». Les dépendances
  // sont les deux valeurs qui comptent (et non l'objet cloud, qui change à
  // chaque publication) : sinon le minuteur repartirait sans arrêt.
  const inboxReady = cloud.configured && Boolean(cloud.userId);
  useEffect(() => {
    if (!inboxReady) return;
    void cloudStore.loadInbox();
    const timer = setInterval(() => void cloudStore.loadInbox(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [inboxReady]);
  // L'étagère des Last Packs suit la même règle que le carnet — à l'ouverture,
  // puis régulièrement — mais plus souvent : un paquet n'est exposé que dix
  // minutes, et c'est la pastille qui doit faire sortir le joueur de son siège.
  useEffect(() => {
    if (!inboxReady) return;
    // L'étagère des Last Packs se recharge à deux vitesses : toutes les 30 s
    // tant qu'un paquet est exposé (sa fenêtre de vol dure dix minutes — la
    // manquer pour un poll de trois minutes, c'est rater *le* moment du jeu),
    // et toutes les trois minutes le reste du temps. Le minuteur se reprogramme
    // à chaque tour : il lit l'état frais du magasin, jamais une capture.
    let timer: number | undefined;
    const schedule = () => {
      void cloudStore.loadLastPacks();
      const snapshot = cloudStore.getSnapshot();
      const at = Date.now();
      const exposed = readySteals(snapshot.lastPacks, snapshot.lastPacksAt ?? at, at) > 0;
      timer = window.setTimeout(schedule, exposed ? 30_000 : 3 * 60_000);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [inboxReady]);
  // L'arène se lit au démarrage et toutes les dix minutes : c'est ce qui allume
  // la pastille « récompense à encaisser » du menu, et ce qui rafraîchit le
  // classement sans que le joueur ait à ouvrir l'écran.
  useEffect(() => {
    if (!inboxReady) return;
    void cloudStore.loadArena();
    const timer = setInterval(() => void cloudStore.loadArena(), 10 * 60_000);
    return () => clearInterval(timer);
  }, [inboxReady]);
  // Trente secondes suffisent à l'écran entier : le seul endroit qui vit à la
  // seconde est le compte à rebours de la réserve, et il a son propre
  // minuteur **local** (`HomeView`). Un `useNow(1_000)` ici re-rendait les
  // mille cartes de la collection une fois par seconde, pour rien.
  const now = useNow(30_000);
  // Le direct se rafraîchit tant que l'écran principal est monté (lecture au
  // démarrage, toutes les trois minutes, et au retour dans l'app).
  useLivePolling();
  // Le direct, lu dans le cache : il dit si le créateur qui préside le Tribunal
  // est à l'antenne (badge rouge, et multiplicateur de la séance).
  const live = useLive();
  // Les bruitages du TCG sont chargés une fois pour toutes : le premier
  // retournement de carte ne sera pas muet. (Le Studio a sa propre liste, il la
  // charge à l'ouverture de son onglet.)
  useEffect(() => {
    preloadSamples(SFX_USUELS);
  }, []);
  const [tab, setTab] = useState<Tab>("home");
  const [opening, setOpening] = useState(false);
  const [usingHourglass, setUsingHourglass] = useState(false);
  const [drawnCards, setDrawnCards] = useState<DrawnCard[]>([]);
  // Ce que la série a payé pour le booster qu'on est en train de révéler : le
  // badge de l'écran de révélation, effacé avec les cartes.
  const [streakGain, setStreakGain] = useState<StreakRewardGrant | null>(null);
  const [revealIndex, setRevealIndex] = useState(0);
  // Quel paquet la révélation montre (le tirage rare ne se raconte pas pareil).
  const [revealKind, setRevealKind] = useState<"live" | "scene">("live");
  const [sceneOpening, setSceneOpening] = useState(false);
  /** Le paquet est en train de s'ouvrir : le moment entre le geste et la carte. */
  const [tearing, setTearing] = useState(false);
  const [tearKind, setTearKind] = useState<"live" | "scene">("live");
  const tearResolve = useRef<(() => void) | null>(null);
  const [presentationReturnFocus, setPresentationReturnFocus] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Raccourci affiché dans le bandeau d'erreur (« Mon compte »).
  const [errorHint, setErrorHint] = useState<"account" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oddsOpen, setOddsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lastPackOpen, setLastPackOpen] = useState(false);
  const [arenaOpen, setArenaOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [tribunalOpen, setTribunalOpen] = useState(false);
  // La pastille de la barre : combien de paquets d'amis sont prenables là,
  // maintenant. Même calcul que la ligne du menu, même horloge (celle du
  // serveur) — une pastille qui resterait allumée après la fenêtre serait un
  // mensonge.
  const navLastPack = readySteals(cloud.lastPacks, cloud.lastPacksAt ?? now, now);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFocus, setAccountFocus] = useState<AccountFocus>(null);
  // L'onglet sur lequel ouvrir la feuille des amis : le carnet sait qu'une
  // demande d'ami attend une réponse, la feuille des amis sait où elle range
  // les demandes. Le carnet le dit, la feuille l'applique.
  const [friendsTab, setFriendsTab] = useState<"friends" | "incoming" | "outgoing">("friends");

  /**
   * Ouvrir et fermer une feuille : **muet**, et c'est une décision (8 octobre
   * 2026 — « enlève le son quand on clique sur des onglets ou des paramètres »).
   * Se déplacer ne sonne pas : ce qui sonne, c'est ce qu'on **fait** une fois
   * arrivé (ouvrir un booster, encaisser une récompense).
   *
   * Les deux fonctions restent écrites une seule fois, et le bouton retour
   * d'Android passe par les mêmes : peu importe comment on referme.
   */
  function ouvrirFeuille(set: (value: boolean) => void) {
    return () => set(true);
  }

  function fermerFeuille(set: (value: boolean) => void) {
    return () => set(false);
  }

  /**
   * Un tap dans le carnet : on ferme le carnet, et on ouvre l'endroit visé.
   *
   * C'est **le seul endroit** qui connaît à la fois les onglets et les feuilles.
   * Le carnet, lui, ne connaît que des familles (`InboxTarget`) : il n'a ni
   * l'identifiant de la carte, ni le numéro de l'échange, et il n'en a pas
   * besoin — chaque famille n'a qu'un bon endroit dans le jeu.
   *
   * Muet : on se déplace d'un écran à un autre (voir `ouvrirFeuille`).
   */
  function ouvrirDepuisLeCarnet(target: InboxTarget, section?: string) {
    setNotificationsOpen(false);
    if (target === "classeur") {
      setTab("collection");
      return;
    }
    if (target === "compte") {
      // Le carnet dit « échanges » ; la feuille sait ouvrir sa section des
      // échanges et la mettre sous les yeux. Toute autre section ouvre la
      // feuille en haut, comme avant.
      setAccountFocus(section === "trades" ? "trades" : null);
      setAccountOpen(true);
      return;
    }
    if (target === "amis") {
      setFriendsTab(section === "incoming" ? "incoming" : section === "outgoing" ? "outgoing" : "friends");
      setFriendsOpen(true);
      return;
    }
    if (target === "last-pack") {
      setLastPackOpen(true);
      return;
    }
    if (target === "hotel") {
      setMarketOpen(true);
      return;
    }
  }

  // ------------------------------------------------------------------
  // Le bouton retour d'Android
  // ------------------------------------------------------------------
  // L'écran du dessus se ferme, sinon on revient à l'accueil, sinon l'app se
  // met de côté. L'ordre d'inscription est l'ordre du dessus vers le dessous :
  // le dernier inscrit est le premier servi (`src/lib/back-stack.ts`).
  useBackHandler(drawnCards.length > 0, closeReveal);
  useBackHandler(themeOpen, fermerFeuille(setThemeOpen));
  useBackHandler(Boolean(cloud.profile || cloud.profileBusy), () => cloudStore.closeProfile());
  useBackHandler(accountOpen, () => {
    setAccountOpen(false);
    setAccountFocus(null);
  });
  useBackHandler(notificationsOpen, fermerFeuille(setNotificationsOpen));
  useBackHandler(wishlistOpen, fermerFeuille(setWishlistOpen));
  useBackHandler(arenaOpen, fermerFeuille(setArenaOpen));
  useBackHandler(tribunalOpen, fermerFeuille(setTribunalOpen));
  useBackHandler(lastPackOpen, fermerFeuille(setLastPackOpen));
  useBackHandler(marketOpen, fermerFeuille(setMarketOpen));
  useBackHandler(friendsOpen, fermerFeuille(setFriendsOpen));
  useBackHandler(studioOpen, fermerFeuille(setStudioOpen));
  useBackHandler(oddsOpen, fermerFeuille(setOddsOpen));

  useAndroidBack(() => {
    // Plus rien à fermer : on revient à l'accueil, et si on y est déjà, l'app
    // se met de côté. Quitter l'APK est un geste volontaire, pas un retour raté.
    if (tab !== "home") {
      setTab("home");
      return;
    }
    void minimizeApp().catch(() => {});
  });

  // Envoi automatique (débounce) quand un compte est connecté : aucun appel
  // réseau sinon, la partie reste strictement locale.
  useCloudAutoSync();
  usePush();

  // Lien de partage : `?profil=<identifiant>` ouvre la fiche publique au
  // démarrage. C'est la seule forme de « route publique » possible sans
  // serveur — l'export statique ne peut pas fabriquer une page par joueur.
  // Le serveur reste juge : sans cloud configuré, l'écran le dit simplement.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("profil");
    if (target) void cloudStore.openProfile(target);
  }, []);

  // Vue dérivée : la recharge passive est recalculée à chaque tick d'horloge,
  // donc les boosters « arrivent » à l'écran sans action de l'utilisateur.
  const game = useMemo(() => (state ? getGameView(state, now) : null), [state, now]);

  /**
   * Le Tribunal du jour, en un coup d'œil : combien de dossiers attendent, et
   * si la séance est déjà close.
   *
   * Le tirage est recalculé ici **pour l'affichage seulement** : le Tribunal,
   * lui, se retire tout seul (même fonction, même journée, même joueur), donc
   * les deux ne peuvent pas se contredire.
   */
  const tribunal = useMemo(() => {
    const jour = gameDay(now);
    if (!state) return { restants: 5, close: false };
    const seance = state.tribunal.day === jour ? state.tribunal : null;
    const rendus = seance ? Object.keys(seance.verdicts).length : 0;
    const total = dossiersDuJour(jour, state.playerId).length;
    return { restants: Math.max(0, total - rendus), close: rendus >= total && total > 0 };
  }, [state, now]);

  // Un seul endroit décide qui tire (le serveur ou l'appareil) : l'écran ne
  // fait qu'afficher ce qui revient — l'overlay 16:9 passe par le même module.
  const { openLivePack, openScenePack } = usePackOpening(game);

  const showError = useCallback((message: string, hint: "account" | null = null) => {
    setNotice(null);
    setError(message);
    setErrorHint(hint);
  }, []);
  const showNotice = useCallback((message: string) => {
    setError(null);
    setErrorHint(null);
    setNotice(message);
  }, []);

  // Un compte est connecté : la réserve de boosters affichée est celle du
  // serveur (`pack_status()` ne consomme rien, elle recale aussi l'ancre de
  // recharge). Silencieux si le réseau ne répond pas.
  useEffect(() => {
    if (!cloud.configured || !cloud.userId) return;
    void cloudStore.packStatus();
    void cloudStore.refreshOnboarding();
    // Le solde aussi : depuis `0027_wallet.sql`, c'est le serveur qui tient la
    // caisse, et une sauvegarde bricolée est recollée à la vérité ici.
    void cloudStore.syncWallet();
  }, [cloud.configured, cloud.userId]);

  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [giftBusy, setGiftBusy] = useState(false);
  const welcomeKey = `creatordeck-tutorial:${cloud.userId ?? "local"}`;
  const [welcomeSeenKey, setWelcomeSeenKey] = useState<string | null>(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(welcomeKey) === "done" ? welcomeKey : `not-done:${welcomeKey}`; }
    catch { return `not-done:${welcomeKey}`; }
  });
  const welcomeSeen = welcomeSeenKey === welcomeKey;
  const tutorialCompletionKey = `creatordeck-tutorial:completed:${cloud.userId ?? "local"}`;
  const [completedTutorialKey, setCompletedTutorialKey] = useState<string | null>(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem(tutorialCompletionKey) === "done" ? tutorialCompletionKey : null; }
    catch { return null; }
  });
  const completedTutorial = completedTutorialKey === tutorialCompletionKey;
  const onboardingReady = !cloud.configured || Boolean(cloud.userId && cloud.onboarding && !cloud.onboardingBusy);
  const showTutorial = tutorialStep !== null || (!welcomeSeen && (completedTutorialKey === null || completedTutorial) && onboardingReady && !cloud.onboarding?.tutorialCompleted && !completedTutorial);

  function replayWelcomeTutorial() {
    try {
      window.localStorage.removeItem(welcomeKey);
      window.localStorage.removeItem(tutorialCompletionKey);
    } catch { /* Le tutoriel reste rejouable dans cette session. */ }
    setWelcomeSeenKey(null);
    setCompletedTutorialKey(null);
    setTutorialStep(0);
    setTab("home");
  }

  async function finishWelcomeTutorial() {
    if (cloud.configured && cloud.userId) {
      const saved = await cloudStore.completeTutorial();
      if (!saved) { showError("Impossible d’enregistrer la fin du tutoriel. Réessaie."); return; }
    }
    try { window.localStorage.setItem(welcomeKey, "done"); } catch { /* Le serveur conserve les comptes connectés. */ }
    try { window.localStorage.setItem(tutorialCompletionKey, "done"); } catch { /* La fin n'est mémorisée que sur cet appareil. */ }
    setTutorialStep(null);
    setWelcomeSeenKey(welcomeKey);
    setCompletedTutorialKey(tutorialCompletionKey);
  }

  async function claimAndOpenWelcomeGift() {
    if (giftBusy) return;
    setGiftBusy(true);
    try {
      if (!cloud.onboarding?.giftClaimed) {
        const claim = await cloudStore.claimReturnGift();
        if (claim.status !== "done") { showError(claim.message, claim.status === "unavailable" && claim.reason === "no-session" ? "account" : null); return; }
        setNotice("Cadeau réclamé : 5 boosters distincts de ta réserve t’attendent.");
      }
      setTutorialStep(null);
      setWelcomeSeenKey(welcomeKey);
      const result = await cloudStore.openReturnGiftPack();
      if (result.status !== "drawn") { showError(result.message); return; }
      setRevealKind("live");
      setDrawnCards(result.cards);
      setStreakGain(null);
      setRevealIndex(0);
    } finally { setGiftBusy(false); }
  }

  /**
   * Show the real booster from the first tap, while the server draws the cards.
   * The tear can finish before the network does; the wrapper stays mounted
   * until both the draw and the gesture have completed, with no empty frame.
   */
  function commencerDechirure(kind: "live" | "scene"): Promise<void> {
    // Capture before the opening button is disabled, and keep it through reveal.
    setPresentationReturnFocus(document.activeElement instanceof HTMLElement
      ? document.activeElement : null);
    setTearKind(kind);
    setTearing(true);
    return new Promise<void>((resolve) => {
      tearResolve.current = resolve;
    });
  }

  function terminerDechirure(): void {
    tearResolve.current?.();
    tearResolve.current = null;
  }

  async function handleOpenPack() {
    if (!game || opening) return;
    setOpening(true);
    setError(null);
    setErrorHint(null);
    const dechirureTerminee = commencerDechirure("live");
    try {
      // The server/local engine draws while the physical booster stays visible.
      const result = await openLivePack();
      if (result.status === "drawn") {
        await dechirureTerminee;
        // All four states commit together: the revealed card replaces the foil.
        setRevealKind("live");
        setDrawnCards(result.cards);
        setStreakGain(result.streakReward ?? null);
        setRevealIndex(0);
        setTearing(false);
        return;
      }
      setTearing(false);
      terminerDechirure();
      showError(result.message, result.needAccount ? "account" : null);
    } catch (caught) {
      setTearing(false);
      terminerDechirure();
      showError(caught instanceof Error ? caught.message : "Ouverture impossible.");
    } finally {
      setOpening(false);
    }
  }

  /**
   * Same continuous transition for the Scene pack, without a second loader.
   */
  async function handleOpenScenePack() {
    if (!game || sceneOpening || game.scene.opened) return;
    const family = game.scene.family;
    if (!family) {
      showError("Aucune famille n'est assez grande pour un Paquet Scène.");
      return;
    }
    setSceneOpening(true);
    setError(null);
    setErrorHint(null);
    const dechirureTerminee = commencerDechirure("scene");
    try {
      const result = await openScenePack();
      if (result.status === "drawn") {
        await dechirureTerminee;
        setRevealKind("scene");
        setDrawnCards(result.cards);
        setRevealIndex(0);
        setTearing(false);
        return;
      }
      setTearing(false);
      terminerDechirure();
      showError(result.message, result.needAccount ? "account" : null);
    } catch (caught) {
      setTearing(false);
      terminerDechirure();
      showError(caught instanceof Error ? caught.message : "Ouverture impossible.");
    } finally {
      setSceneOpening(false);
    }
  }

  function handleUseHourglass() {
    if (!game || usingHourglass) return;
    setUsingHourglass(true);
    setError(null);
    try {
      gameStore.useHourglass();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Impossible d'utiliser un sablier.");
    } finally {
      setUsingHourglass(false);
    }
  }

  /**
   * Rejoindre un créateur **depuis le classeur** : la fiche d'une carte
   * manquante propose le prix, ce geste le paie. Il passe par `usePoints`,
   * exactement comme l'Atelier — une seule caisse, donc le serveur décide quand
   * il y a un compte, et l'appareil sinon.
   */
  async function handleCraftFromBinder(slug: string): Promise<boolean> {
    try {
      const paid = await points.craft(slug, false);
      if (paid.status === "refused") {
        showError(paid.message);
        return false;
      }
      playReward();
      showNotice(paid.message ?? "Créateur rejoint.");
      return true;
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Créateur indisponible.");
      return false;
    }
  }

  async function handleClaimSeason(seasonId: string) {
    // La vue d'avant le clic décrit exactement ce qui vient d'être crédité.
    const before = game?.seasons.find((entry) => entry.id === seasonId);
    try {
      // Le serveur paie (il compte les créateurs de la famille) : hors ligne ou
      // sans compte, `usePoints` dit quoi faire plutôt que de payer en local.
      const credited = await points.claimSeason(seasonId);
      if (credited.status === "refused") return showError(credited.message);
      // Le serveur peut répondre « déjà payé » (réclamation faite sur un autre
      // appareil) : on le dit, au lieu d'annoncer des points qui ne sont pas
      // arrivés.
      if (credited.delta === 0) return showNotice(credited.message ?? "Cette famille était déjà payée.");
      const parts = [
        before && before.claimablePoints > 0 ? `+${before.claimablePoints} points` : "",
        before && before.claimableHourglasses > 0 ? `+${before.claimableHourglasses} sabliers` : "",
        before && before.claimable > 1 ? `${before.claimable} paliers` : "",
      ].filter(Boolean);
      const emblem = before?.tiers.some((tier) => tier.emblem && !tier.claimed && tier.unlocked);
      // **Un geste, un son.** Une récompense de saison se paie en points, en
      // sabliers, en paliers et en emblème : c'est de l'argent qui tombe, et
      // les pièces le disent mieux qu'un carillon doublé — le joueur entendait
      // deux sons à la fois pour un seul appui.
      playCoins();
      showNotice(
        before
          ? `Saison ${before.id} : ${parts.join(", ") || "récompense réclamée"}${emblem ? " — emblème obtenu !" : ""}`
          : "Récompense de saison réclamée.",
      );
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Récompense indisponible.");
    }
  }

  async function handleClaimMilestone(milestoneId: string) {
    // La vue d'avant le clic décrit exactement ce qui va tomber.
    const before = game?.milestones.find((entry) => entry.id === milestoneId);
    try {
      const credited = await points.claimMilestone(milestoneId);
      if (credited.status === "refused") return showError(credited.message);
      if (credited.delta === 0) return showNotice(credited.message ?? "Ce palier était déjà payé.");
      playReward();
      const gains = before
        ? [
            before.reward.points > 0 ? `+${before.reward.points} points` : "",
            before.reward.hourglasses > 0
              ? `+${before.reward.hourglasses} sablier${before.reward.hourglasses > 1 ? "s" : ""}`
              : "",
          ]
            .filter(Boolean)
            .join(", ")
        : "";
      showNotice(gains ? `Objectif atteint : ${gains} !` : "Récompense d'objectif réclamée.");
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Récompense indisponible.");
    }
  }

  // Le thème est un jeu de variables CSS posé **sur le classeur**, pas sur
  // `<html>` : le chrome de l'application (noir studio, blanc chaud, rouge live)
  // ne change jamais, et un thème reste un objet qu'on équipe pour son binder.
  const themeStyle = useMemo(() => {
    const equipped = game?.themes.find((theme) => theme.equipped);
    if (!equipped) return undefined;
    const style: Record<string, string> = {};
    for (const [token, name] of Object.entries(THEME_VAR_NAMES)) {
      style[name] = equipped.tokens[token as keyof typeof THEME_VAR_NAMES];
    }
    return style as CSSProperties;
  }, [game?.themes]);

  function handleEquipTheme(themeId: string) {
    try {
      gameStore.equipTheme(themeId);
      showNotice("Thème appliqué au classeur.");
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Thème indisponible.");
    }
  }

  function closeReveal() {
    setDrawnCards([]);
    setRevealIndex(0);
    // La récompense de série s'efface avec les cartes : elle appartient à ce
    // booster-là, pas au suivant.
    setStreakGain(null);
  }

  if (!game) return <LoadingScreen />;

  return (
    <main className="app-shell">
      {showTutorial ? (
        <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Tutoriel CreatorDeck">
          <section className="welcome-card">
            <span className="welcome-eyebrow">CREATORDECK · PREMIERS PAS</span>
            <span className="welcome-count">{(tutorialStep ?? 0) + 1} / 3</span>
            <h1>{["Ouvre un booster", "Construis ton Binder", "Reviens au Drop"][tutorialStep ?? 0]}</h1>
            <p>{[
              "Déchire un booster pour découvrir cinq créateurs. La dernière carte garde son moment de révélation.",
              "Chaque tirage rejoint ta collection. Les doublons peuvent ensuite servir à façonner ta collection.",
              "Tes missions et tes amis t’attendent dans les autres espaces. Le cadeau de reprise arrive juste après ce tutoriel.",
            ][tutorialStep ?? 0]}</p>
            <div className="welcome-actions">
              {(tutorialStep ?? 0) > 0 ? <button type="button" className="welcome-secondary" onClick={() => setTutorialStep((step) => Math.max(0, (step ?? 1) - 1))}>Retour</button> : null}
              <button type="button" className="welcome-primary" onClick={() => (tutorialStep ?? 0) < 2 ? setTutorialStep((tutorialStep ?? 0) + 1) : void finishWelcomeTutorial()}>
                {(tutorialStep ?? 0) < 2 ? "Continuer" : "Terminer"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {welcomeSeen && cloud.userId && cloud.onboarding?.giftAvailable && !drawnCards.length ? (
        <div className="welcome-gift-card" role="status">
          <div><strong>Un cadeau t’attend</strong><p>{cloud.onboarding.message || "Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et il vous offre 5 boosters."}</p></div>
          <button type="button" disabled={giftBusy} onClick={() => void claimAndOpenWelcomeGift()}>{giftBusy ? "Préparation…" : cloud.onboarding.giftClaimed ? `Ouvrir un booster cadeau · ${cloud.onboarding.giftRemaining} restants` : "Réclamer mes 5 boosters"}</button>
        </div>
      ) : null}
      <TopBar game={game} />
      <div className="app-content">
        {tab === "home" ? (
          <HomeView
            game={game}
            friendsOpening={friendsOpening}
            onShowInbox={() => setNotificationsOpen(true)}
            onOpen={() => void handleOpenPack()}
            onUseHourglass={handleUseHourglass}
            onShowOdds={ouvrirFeuille(setOddsOpen)}
            onShowMissions={() => setTab("missions")}
            onShowAtelier={() => setTab("atelier")}
            onShowArena={ouvrirFeuille(setArenaOpen)}
            onOpenScene={() => void handleOpenScenePack()}
            onShowTribunal={ouvrirFeuille(setTribunalOpen)}
            tribunalRestants={tribunal.restants}
            tribunalClose={tribunal.close}
            opening={opening}
            usingHourglass={usingHourglass}
            sceneBusy={sceneOpening}
            now={now}
            serverReserve={cloud.configured}
            needsAccount={cloud.configured && !cloud.userId}
          />
        ) : null}
        {tab === "collection" ? (
          <CollectionView game={game} themeStyle={themeStyle} onCraft={handleCraftFromBinder} />
        ) : null}
        {tab === "missions" ? (
          <MissionsView
            game={game}
            onClaimSeason={handleClaimSeason}
            onClaimMilestone={handleClaimMilestone}
            onNotice={showNotice}
            onError={showError}
          />
        ) : null}
        {tab === "atelier" ? (
          <AtelierView game={game} onNotice={showNotice} onError={showError} onGoDrop={() => setTab("home")} />
        ) : null}
        {tab === "profile" ? (
          <ProfileView
            onProgressReset={replayWelcomeTutorial}
            game={game}
            onNotice={showNotice}
            onError={showError}
            onShowOdds={ouvrirFeuille(setOddsOpen)}
            onShowMissions={() => setTab("missions")}
            onShowThemes={ouvrirFeuille(setThemeOpen)}
            onShowStudio={ouvrirFeuille(setStudioOpen)}
            onShowAccount={() => {
              setAccountFocus(null);
              setAccountOpen(true);
            }}
            onShowLeaderboard={() => {
              setAccountFocus("leaderboard");
              setAccountOpen(true);
            }}
            onShowFriends={ouvrirFeuille(setFriendsOpen)}
            onShowMarket={ouvrirFeuille(setMarketOpen)}
            onShowLastPack={ouvrirFeuille(setLastPackOpen)}
            onShowArena={ouvrirFeuille(setArenaOpen)}
            onShowWishlist={ouvrirFeuille(setWishlistOpen)}
            onShowNotifications={ouvrirFeuille(setNotificationsOpen)}
            onShowOwnProfile={() => {
              if (cloud.userId) void cloudStore.openProfile(cloud.userId);
            }}
          />
        ) : null}
      </div>

      <nav className="bottom-nav" aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            // Changer d'onglet **ne sonne pas** : on se déplace (8 octobre
            // 2026). Le son du jeu accompagne ce qu'on fait, pas où l'on va.
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
            {/* La pastille du Last Pack : « il y a un paquet à prendre, là,
                maintenant ». Elle vit sur l'onglet qui mène au menu, comme
                celle du carnet — pas de cinquième onglet. */}
            {item.id === "profile" && navLastPack > 0 ? (
              <b className="nav-badge" aria-label={`${navLastPack} paquet(s) à prendre`}>
                {navLastPack}
              </b>
            ) : null}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="toast-error" role="alert">
          <span>{error}</span>
          <div className="toast-actions">
            {errorHint === "account" ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  setError(null);
                  setErrorHint(null);
                  setAccountOpen(true);
                }}
              >
                Mon compte
              </button>
            ) : null}
            <button
              onClick={() => {
                setError(null);
                setErrorHint(null);
              }}
              aria-label="Fermer"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="toast-error toast-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Fermer"><X size={15} /></button>
        </div>
      ) : null}
      {tearing ? <PackTear kind={tearKind} returnFocusTo={presentationReturnFocus} onTear={() => {
        playPackOpening();
        buzz(PACK_TEAR_HAPTIC);
      }} onComplete={terminerDechirure} /> : null}
      {oddsOpen ? (
        <PackOddsSheet onClose={fermerFeuille(setOddsOpen)} current={game} />
      ) : null}
      {studioOpen ? <StudioSheet onClose={fermerFeuille(setStudioOpen)} /> : null}
      {friendsOpen ? <FriendsSheet initialTab={friendsTab} onClose={fermerFeuille(setFriendsOpen)} /> : null}
      {marketOpen ? <MarketSheet onClose={fermerFeuille(setMarketOpen)} /> : null}
      {lastPackOpen ? <LastPackSheet onClose={fermerFeuille(setLastPackOpen)} /> : null}
      {arenaOpen ? <ArenaSheet onClose={fermerFeuille(setArenaOpen)} /> : null}
      {wishlistOpen ? <WishlistSheet onClose={fermerFeuille(setWishlistOpen)} /> : null}
      {notificationsOpen ? (
        <NotificationsSheet
          onClose={fermerFeuille(setNotificationsOpen)}
          onGo={ouvrirDepuisLeCarnet}
        />
      ) : null}
      {accountOpen ? (
        <AccountSheet
          focus={accountFocus}
          onClose={() => {
            setAccountOpen(false);
            setAccountFocus(null);
          }}
        />
      ) : null}
      {cloud.profile || cloud.profileBusy ? <PublicProfileSheet /> : null}
      {themeOpen && game ? (
        <ThemeSheet
          themes={game.themes}
          onEquip={handleEquipTheme}
          onClose={fermerFeuille(setThemeOpen)}
        />
      ) : null}
      {tribunalOpen && state ? (
        <TribunalView
          playerId={state.playerId}
          seance={state.tribunal}
          cards={state.cards}
          live={live}
          now={now}
          onVerdict={(dossierId, verdict) => gameStore.recordVerdict(dossierId, verdict, now)}
          onClaim={async (request): Promise<TribunalPayout> => {
            // Le versement passe par `use-points` : le serveur paie quand un
            // compte est connecté, l'appareil sinon — jamais les deux.
            const outcome = await points.claimTribunal(request);
            if (outcome.status === "refused") showError(outcome.message);
            return { message: outcome.message, delta: outcome.delta };
          }}
          onClose={fermerFeuille(setTribunalOpen)}
        />
      ) : null}
      {drawnCards.length ? (
        <RevealOverlay
          // Une clé par paquet : les compteurs de refus et le verrou du Perfect
          // repartent de zéro à chaque ouverture, sans effet de réinitialisation.
          key={drawnCards[0]?.id ?? "reveal"}
          cards={drawnCards}
          index={revealIndex}
          kind={revealKind}
          returnFocusTo={presentationReturnFocus}
          streakReward={streakGain}
          onSkipAll={() => setRevealIndex(drawnCards.length - 1)}
          onNext={() => setRevealIndex((value) => Math.min(value + 1, drawnCards.length - 1))}
          onClose={closeReveal}
        />
      ) : null}
    </main>
  );
}
