"use client";

/**
 * L'écran **Drop** : le booster qu'on tire, le geste qui l'ouvre, le Paquet
 * Scène de sa famille, les dernières trouvailles et les raccourcis du jour.
 *
 * C'est le seul écran qui porte un geste (tirer vers le haut) : son verdict vit
 * dans `src/lib/pull.ts`, jamais ici.
 */
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { ArrowUp, ChevronRight, CircleUserRound, Clock3, Coins, Gavel, Gem, Hourglass, Layers3, LoaderCircle, ShieldCheck, Swords, Users, Zap } from "lucide-react";

import { CreatorCard } from "@/components/creator-card";
import { CardInspectModal } from "@/components/card-inspect-modal";
import { useBackHandler } from "@/hooks/use-back-handler";
import { usePresentationFocus } from "@/hooks/use-presentation-focus";

import { useCloud } from "@/hooks/use-cloud";

import { useNow } from "@/hooks/use-game";

import { useLive } from "@/hooks/use-live";
import { CATALOG_EDITION_NUMBER, CATALOG_SIZE, CREATOR_BY_SLUG, PACKS } from "@/lib/catalog";

import { formatViewers, liveFor } from "@/lib/live";

import { arenaDraftWindow } from "@/lib/arena";
import { craftableRetired } from "@/lib/retired";

import { buzz } from "@/lib/haptics";

import { TEAR_HAPTIC } from "@/lib/reveal";
import { playTear } from "@/lib/sfx";
import { type GameView } from "@/lib/game-engine";
import { pullVerdict, type PullVerdict } from "@/lib/pull";
import { cardEffectsAllowed } from "@/lib/tilt";


function formatCountdown(date: number | null, now: number) {
  if (!date) return "Réserve pleine";
  const remaining = Math.max(0, date - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}


export function PackArtwork({ onClick, disabled }: { onClick: (event: MouseEvent<HTMLButtonElement>) => void; disabled: boolean }) {
  return (
    <button type="button" className="pack-artwork pack-live" onClick={onClick}
      disabled={disabled} aria-label="Ouvrir le sachet Live Drop">
      <span className="pack-3d-object" aria-hidden="true">
        <span className="pack-3d-side pack-3d-side-left" />
        <span className="pack-3d-side pack-3d-side-right" />
        <span className="pack-3d-side pack-3d-side-bottom" />
        <span className="pack-3d-front">
          <Image
            className="pack-foil-image"
            src="/packs/live-foil.svg"
            alt=""
            fill
            sizes="(max-width: 390px) 46vw, 180px"
            draggable={false}
            priority
          />
          <span className="pack-specular" />
        </span>
      </span>
    </button>
  );
}

export function HomeView({
  game,
  friendsOpening,
  onShowInbox,
  onShowCollection,
  onOpen,
  onUseHourglass,
  onShowOdds,
  onShowMissions,
  onShowAtelier,
  onShowArena,
  onOpenScene,
  onShowTribunal,
  tribunalRestants,
  tribunalClose,
  opening,
  usingHourglass,
  sceneBusy,
  now,
  serverReserve,
  needsAccount,
}: {
  game: GameView;
  /** Combien d'amis ont ouvert un booster dans l'heure (0 = rien à dire). */
  friendsOpening: number;
  /** La ligne des amis ouvre le carnet, qui porte les ouvertures en détail. */
  onShowInbox: () => void;
  onShowCollection: () => void;
  onOpen: () => void;
  onOpenScene: () => void;
  sceneBusy: boolean;
  onUseHourglass: () => void;
  onShowOdds: () => void;
  onShowMissions: () => void;
  /** Les Sortants : la ligne d'accueil mène à l'Atelier. */
  onShowAtelier: () => void;
  /** La ligne d'arène mène à l'écran Arène (dépôt, draft, classement). */
  onShowArena: () => void;
  /** Ouvre le Tribunal des Bannis (muet : on se déplace). */
  onShowTribunal: () => void;
  /** Dossiers encore à juger aujourd'hui (0 = séance terminée). */
  tribunalRestants: number;
  /** Vrai quand les cinq verdicts du jour ont été rendus. */
  tribunalClose: boolean;
  opening: boolean;
  usingHourglass: boolean;
  now: number;
  /** La réserve vient du serveur : le sablier local ne peut pas l'avancer. */
  serverReserve: boolean;
  /** Build avec cloud sans compte connecté : l'ouverture demande une connexion. */
  needsAccount: boolean;
}) {
  const pack = PACKS.live;
  const stock = game.player.packs;
  const nextAt = game.player.nextPackAt;
  // Le seul compteur au format mm:ss du jeu : il bat à la seconde, et il ne
  // re-rend que ce panneau (le minuteur est local à l'écran Drop).
  const tick = useNow(1_000);
  // Le compteur de malchance en une phrase. À 1 restant, c'est **ce** booster
  // qui est garanti : le dire autrement ferait croire à un booster de plus.
  /*
   * Le geste d'ouverture : le doigt (ou la souris) part du booster, tire vers le
   * haut, et relâche. La règle vit dans `src/lib/pull.ts` (pure, testée) ; ici
   * il n'y a que le doigt, le son et le geste.
   *
   * Trois garde-fous : on ne tire que si le booster est vraiment ouvrable (pas
   * de geste qui ne mène nulle part), **un geste retiré n'ouvre rien** (voir
   * `pullCancel`), et le **bouton « Ouvrir » reste** — c'est le repli pour la
   * souris, le clavier, et les doigts qui n'aiment pas tirer.
   */
  const pullRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const draggedRef = useRef(false);
  // Le dernier verdict, en **référence** : `pointerup` peut arriver avant que
  // React ait re-rendu l'état, et relire `pull.armed` à cet instant serait
  // relire le geste d'avant (l'ouverture partait alors sur un mouvement périmé).
  const armedRef = useRef(false);
  const [pull, setPull] = useState<PullVerdict>({ progress: 0, armed: false, active: false });
  const canPull = !opening && !needsAccount && stock > 0;

  function pullStart(event: PointerEvent<HTMLElement>) {
    if (!canPull || event.button !== 0 || event.isPrimary === false) return;
    pullRef.current = { x: event.clientX, y: event.clientY, t: performance.now() };
    draggedRef.current = false;
    armedRef.current = false;
    // Le doigt continue de piloter le geste même s'il sort de la zone du pack.
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>(".pack-artwork");
    (target ?? event.currentTarget).setPointerCapture(event.pointerId);
  }

  function pullMove(event: PointerEvent<HTMLElement>) {
    const start = pullRef.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) draggedRef.current = true;
    const packArtwork = event.currentTarget.querySelector<HTMLButtonElement>(".pack-artwork");
    if (packArtwork) {
      const bounds = packArtwork.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - .5) * 2));
      const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - .5) * 2));
      if (cardEffectsAllowed()) {
        packArtwork.style.setProperty("--pack-tilt-x", `${-y * 6}deg`);
        packArtwork.style.setProperty("--pack-tilt-y", `${x * 8}deg`);
      }
      event.currentTarget.style.setProperty("--pack-shadow-x", `${x * 18}px`);
      event.currentTarget.style.setProperty("--pack-shadow-scale", `${1 - Math.abs(x) * .12}`);
    }
    const verdict = pullVerdict(start.y - event.clientY, performance.now() - start.t);
    // Le seuil est franchi : une vibration courte et le bruit de l'objet qu'on
    // ouvre, **une seule fois** — pas à chaque pixel.
    if (verdict.armed && !armedRef.current) {
      buzz(TEAR_HAPTIC);
      playTear();
    }
    armedRef.current = verdict.armed;
    setPull(verdict);
  }

  /** Le doigt se lève : si le geste a armé, le booster s'ouvre. */
  function clearPullPose(stage: HTMLElement) {
    stage.querySelector<HTMLButtonElement>(".pack-artwork")?.style.removeProperty("--pack-tilt-x");
    stage.querySelector<HTMLButtonElement>(".pack-artwork")?.style.removeProperty("--pack-tilt-y");
    stage.style.removeProperty("--pack-shadow-x");
    stage.style.removeProperty("--pack-shadow-scale");
  }

  function pullEnd(event: PointerEvent<HTMLElement>) {
    const armed = armedRef.current;
    pullRef.current = null;
    armedRef.current = false;
    clearPullPose(event.currentTarget);
    setPull({ progress: 0, armed: false, active: false });
    if (armed) onOpen();
  }

  /**
   * Le geste est **retiré** (le navigateur reprend la main : défilement, appel
   * entrant, changement d'application, deuxième doigt) : ça n'ouvre **rien**.
   * C'est la différence entre relâcher et se faire couper — sans elle, un
   * `pointercancel` au mauvais moment ouvrait un booster que personne n'avait
   * tiré.
   */
  function pullCancel(event: PointerEvent<HTMLElement>) {
    draggedRef.current = true;
    pullRef.current = null;
    armedRef.current = false;
    clearPullPose(event.currentTarget);
    setPull({ progress: 0, armed: false, active: false });
  }

  function openArtwork(event: MouseEvent<HTMLButtonElement>) {
    // A drag's generated click must neither reopen nor turn an abandoned pull
    // into a tap. Keyboard activation remains available after any gesture.
    if (event.detail > 0 && draggedRef.current) return;
    if (opening || (!needsAccount && stock <= 0)) return;
    event.currentTarget.focus();
    onOpen();
  }

  const pityCopy =
    game.pity.remaining <= 1
      ? "Ce booster contient un Légendaire garanti"
      : `Légendaire garanti dans ${game.pity.remaining} booster${game.pity.remaining > 1 ? "s" : ""}`;
  // La série se dit sur la même ligne : les deux récompenses attendent au même
  // endroit, le prochain booster.
  const packCopy = game.streak.jackpot ? `${pityCopy} · Perfect du 7ᵉ jour garanti` : pityCopy;
  const [inspectCard, setInspectCard] = useState<GameView["cards"][number] | null>(null);
  useBackHandler(inspectCard !== null, () => setInspectCard(null));
  const findingFocus = usePresentationFocus(inspectCard !== null);
  const inspectedCreator = inspectCard ? CREATOR_BY_SLUG.get(inspectCard.creatorSlug) : null;
  const latest = [...game.cards].sort((a, b) => b.obtainedAt - a.obtainedAt).slice(0, 4);
  const dailyMission = game.missions.find((mission) => !mission.done)
    ?? game.missions.find((mission) => mission.done && !mission.claimed)
    ?? null;
  // Les Sortants encore artisanables : ils ont quitté le classement (plus
  // tirables, hors complétion) mais leur fenêtre d'artisanat reste ouverte
  // pendant l'édition de leur départ. Ce sont les dernières cartes à rejoindre
  // — et elles se fabriquent, elles ne se tirent plus. On compte celles qu'il
  // reste à obtenir : à zéro, la ligne disparaît.
  const retiredLeft = useMemo(
    () =>
      craftableRetired().filter(
        (creator) => !game.cards.some((card) => card.creatorSlug === creator.slug),
      ).length,
    [game.cards],
  );
  const live = useLive();
  const cloud = useCloud();
  // La ligne d'arène de l'accueil : ce qui compte pour le joueur, dans l'ordre
  // — une récompense qui attend, un draft ouvert (une décision à prendre), ce
  // qu'il a déjà déposé, ou rien du tout. Aucune ligne n'apparaît sans compte :
  // l'arène n'existe qu'en ligne, et un bouton qui refuse est un piège.
  const arenaNow = useNow(30_000);
  const arenaLine = useMemo(() => {
    if (!cloud.configured || !cloud.userId) return null;
    const pending = cloud.arenaMine?.pending.length ?? 0;
    if (pending > 0) {
      return {
        tone: "reward" as const,
        label:
          pending === 1
            ? "Une récompense d'arène t'attend"
            : `${pending} récompenses d'arène t'attendent`,
      };
    }
    const window = arenaDraftWindow(arenaNow);
    if (cloud.arenaMine?.draftOpen ?? window.open) {
      const left = Math.max(0, window.closesAt - arenaNow);
      const hours = Math.floor(left / 3_600_000);
      const minutes = Math.floor((left % 3_600_000) / 60_000);
      return {
        tone: "hot" as const,
        label: `Draft du week-end ouvert · ${hours} h ${String(minutes).padStart(2, "0")} min pour le boucler`,
      };
    }
    const entry = cloud.arenaMine?.entry;
    if (entry) {
      const rank = cloud.arenaMine?.rank;
      return {
        tone: "done" as const,
        label: `Ton arène : ${entry.score.toLocaleString("fr-FR")} viewers${rank ? ` · ${rank === 1 ? "1er" : `${rank}e`}` : ""}`,
      };
    }
    return {
      tone: "idle" as const,
      label: "Arène : aucune équipe cette semaine",
    };
  }, [cloud.configured, cloud.userId, cloud.arenaMine, arenaNow]);
  // Le direct le plus regardé parmi les créateurs du Top 1000, pour le bandeau :
  // c'est le « lower third » d'une régie — une ligne, un chiffre, un nom.
  const featured = useMemo(() => {
    if (live.stale || !live.count) return null;
    let top: { login: string; viewers: number } | null = null;
    for (const stream of live.byLogin.values()) {
      if (!top || stream.viewers > top.viewers) top = { login: stream.login, viewers: stream.viewers };
    }
    return top;
  }, [live]);

  return (
    <div className="view home-view">
      <header className="drop-intro">
        <div className="drop-edition"><span>LE DROP</span><span>ÉDITION {String(CATALOG_EDITION_NUMBER).padStart(2, "0")}</span></div>
        <h1>Un sachet.<br /><em>Cinq créateurs.</em></h1>
        <p>{needsAccount ? "Connecte-toi. Ta collection t’attend." : stock > 0 ? "Le prochain nom de ta collection est peut-être dedans." : "Le prochain sachet se prépare. Ton Binder reste ouvert."}</p>
      </header>

      {/* Le bandeau du direct. Il n'apparaît que si l'app sait vraiment qui
          streame (données fraîches) : sinon il n'y a rien à dire. Il est
          cliquable parce qu'il annonce quelque chose sur le tirage — les
          créateurs en direct pèsent plus lourd et eux seuls peuvent sortir en
          variante Live. Un appui ouvre les taux publiés, qui le disent. */}
      {featured ? (
        <button
          type="button"
          className="live-bar"
          onClick={onShowOdds}
          aria-label={`${live.count} créateurs en direct. Bonus Direct actif : voir les taux publiés.`}
        >
          <i aria-hidden="true" />
          <span className="live-bar-tag">En direct</span>
          <span className="live-bar-who">
            {live.count} sur {CATALOG_SIZE}
            {` · @${featured.login}`}
            {featured.viewers > 0 ? ` ${formatViewers(featured.viewers)}` : ""}
          </span>
          <span className="live-bar-boost">Bonus Direct</span>
        </button>
      ) : null}

      <section
        className={`pack-stage stage-live${pull.active ? " pulling" : ""}`}
        style={{ "--pull": pull.progress } as CSSProperties}
        onPointerDown={pullStart}
        onPointerMove={pullMove}
        onPointerUp={pullEnd}
        onPointerCancel={pullCancel}
        aria-label={`${pack.label} : appuie sur le sachet ou tire-le vers le haut pour ouvrir`}
      >
        <div className="pack-shadow" />
        <PackArtwork onClick={openArtwork} disabled={opening || (!needsAccount && stock <= 0)} />
        {/* La couture : elle s'ouvre avec le geste, avant que ça arme. Le joueur
            voit où il en est, le seuil n'est pas une surprise. */}
        <div className="pull-seam" aria-hidden="true" />
        <div className="pack-copy">
          <h2 tabIndex={-1} data-presentation-focus-fallback>{pack.label}</h2>
          <span>{pack.description}</span>
        </div>
        {/* Le mode d'emploi, toujours écrit — et il s'efface à mesure que le
            geste avance : au bout de deux boosters, on ne le lit plus. */}
        <p className="pull-hint">
          <ArrowUp size={14} />
          Appuie sur le sachet ou tire-le vers le haut.
        </p>
      </section>

      <section className="open-panel">
        <div className="stock-row">
          <div>
            <span>Ta réserve</span>
            <strong>
              {stock}<small>/{pack.max}</small>
            </strong>
          </div>
          {/* Réserve pleine : l'état change de couleur, il ne clignote pas — le
              jeu n'a aucune animation perpétuelle. */}
          <div className={`timer-copy${nextAt === null ? " full" : ""}`}>
            <Clock3 size={14} />
            <span>{nextAt === null ? "Réserve pleine" : `+1 dans ${formatCountdown(nextAt, tick)}`}</span>
          </div>
        </div>
        <button
          className="primary-action"
          onClick={onOpen}
          disabled={opening || (!needsAccount && stock <= 0)}
        >
          {opening ? (
            <LoaderCircle className="spin" size={19} />
          ) : needsAccount ? (
            <CircleUserRound size={19} />
          ) : (
            <Zap size={19} />
          )}
          <span>
            {needsAccount ? "Se connecter pour ouvrir" : stock > 0 ? "Ouvrir le booster" : "Recharge en cours"}
          </span>
          {needsAccount || stock > 0 ? <ChevronRight size={19} /> : null}
        </button>
        <div className="guarantee-row">
          <ShieldCheck size={14} />
          <span>1 Rare ou mieux garantie · Live si son créateur streame · aucun doublon</span>
        </div>

        {/* Le plancher de malchance, écrit sur l'écran d'accueil : c'est un
            chiffre, pas une promesse en l'air — et il vient du même compteur
            que celui qui décidera du tirage. Un appui ouvre les taux publiés,
            qui portent la même règle. */}
        <button
          type="button"
          className={`pity-row${game.pity.remaining <= 1 ? " now" : ""}`}
          onClick={onShowOdds}
          aria-label={`Plancher de malchance : ${packCopy}`}
        >
          <Gem size={14} />
          <span>{packCopy}</span>
          <ChevronRight size={14} />
        </button>

        <details className="drop-pack-details">
          <summary>Jetons et sabliers <ChevronRight size={15} /></summary>
        {/* Les jetons : la monnaie lente des boosters, dépensée à l'Atelier. */}
        <div className="token-row">
          <Coins size={14} />
          <span>
            <strong>{game.tokens.count}</strong> jetons · +{game.tokens.perPack} par booster
            {game.tokens.primeTime ? " (Prime Time)" : ""}
          </span>
          <span className="token-goal">
            {game.tokens.missing > 0 ? `encore ${game.tokens.missing}` : "une carte au choix"}
          </span>
        </div>
        <button
          className="secondary-action"
          onClick={onUseHourglass}
          disabled={serverReserve || stock >= pack.max || game.player.hourglasses <= 0 || usingHourglass}
        >
          <Hourglass size={15} />
          <span>
            {serverReserve
              ? "Sablier indisponible en ligne"
              : `Utiliser 1 sablier (${game.player.hourglasses} disp.) · avance de 15 min`}
          </span>
        </button>
        </details>
      </section>

      <section className="drop-activities" aria-label="À jouer aujourd’hui">
        <div className="drop-section-label"><span>APRÈS LE DROP</span><span>À TON RYTHME</span></div>
        <div className="home-links">
          <button type="button" className="daily-goal" onClick={onShowMissions} aria-label="Voir l’objectif du jour">
            <span>OBJECTIF DU JOUR</span>
            {dailyMission ? (
              <>
                <strong>{dailyMission.label}</strong>
                <small>{dailyMission.done ? "Terminé · récompense à réclamer" : `${dailyMission.progress} / ${dailyMission.target}`}</small>
              </>
            ) : (
              <>
                <strong>Tes missions du jour sont terminées</strong>
                <small>Reviens demain pour un nouvel objectif.</small>
              </>
            )}
            <ChevronRight size={17} />
          </button>
          <button type="button" className="text-link" onClick={onShowMissions}>
            <span>Objectifs et saisons</span>
            <ChevronRight size={15} />
          </button>
          <button type="button" className="text-link" onClick={onShowOdds}>
            <span>Taux de drop publiés</span>
            <ChevronRight size={15} />
          </button>
        </div>

        {friendsOpening > 0 ? (
          <button
            type="button"
            className="pity-row friends-row"
            onClick={onShowInbox}
            aria-label={`Ouvrir le carnet : ${friendsOpening} ami${
              friendsOpening > 1 ? "s ont" : " a"
            } ouvert un booster il y a moins d'une heure`}
          >
            <Users size={14} />
            <span>
              {friendsOpening} ami{friendsOpening > 1 ? "s ont" : " a"} ouvert un booster · moins
              d&apos;une heure
            </span>
            <ChevronRight size={14} />
          </button>
        ) : null}

        {retiredLeft > 0 ? (
          <button
            type="button"
            className="pity-row retired-row"
            onClick={onShowAtelier}
            aria-label={`Ouvrir l'Atelier : ${retiredLeft} Sortant${
              retiredLeft > 1 ? "s" : ""
            } encore artisanable${retiredLeft > 1 ? "s" : ""} cette édition`}
          >
            <Clock3 size={14} />
            <span>
              {retiredLeft} Sortant{retiredLeft > 1 ? "s" : ""} encore artisanable
              {retiredLeft > 1 ? "s" : ""} · dernière édition
            </span>
            <ChevronRight size={14} />
          </button>
        ) : null}

        {arenaLine ? (
          <button
            type="button"
            className={`pity-row arena-row ${arenaLine.tone}`}
            onClick={onShowArena}
            aria-label={`Ouvrir l'arène : ${arenaLine.label}`}
          >
            <Swords size={14} />
            <span>{arenaLine.label}</span>
            <ChevronRight size={14} />
          </button>
        ) : null}

        {/* Le Tribunal des Bannis : l'accroche du jour. Le compte dit la
            vérité — il reste tant d'appels à juger, et pas un de plus. */}
        <button
          type="button"
          className={`pity-row tribunal-row${tribunalClose ? " done" : ""}`}
          onClick={onShowTribunal}
          aria-label={
            tribunalClose
              ? "Ouvrir le Tribunal des Bannis : séance close, bilan disponible"
              : `Ouvrir le Tribunal des Bannis : ${tribunalRestants} dossier(s) en attente`
          }
        >
          <Gavel size={14} />
          <span>
            Tribunal des Bannis ·{" "}
            {tribunalRestants > 0
              ? `${tribunalRestants} dossier${tribunalRestants > 1 ? "s" : ""} en attente`
              : "séance close, bilan disponible"}
          </span>
          <ChevronRight size={14} />
        </button>

      </section>

      {/* Le second paquet, et le seul autre : celui de **ta** famille, une fois
          par jour de jeu. Il ne se recharge pas (le sablier n'y peut rien), il
          ne contient aucune Légendaire, et il ne touche ni au compteur de
          malchance ni à la série — c'est un paquet de complétion. */}
      <section className={`scene-block${game.scene.opened ? " done" : ""}`}>
        <div className="scene-head">
          <div>
            <h2 tabIndex={-1} data-presentation-focus-fallback>{game.scene.label}</h2>
            <span>{PACKS.scene.description}</span>
          </div>
          <span className="scene-state">
            {game.scene.opened ? "Ouvert aujourd'hui" : "Disponible"}
          </span>
        </div>

        {game.scene.family ? (
          <div className="scene-family">
            <div className="scene-family-copy">
              <strong>{game.scene.family.name}</strong>
              <span>
                {game.scene.family.owned}/{game.scene.family.total} découverts · il t&apos;en
                manque {game.scene.family.total - game.scene.family.owned}
              </span>
            </div>
            <div className="progress-track">
              <i
                style={{
                  width: `${Math.round(
                    (game.scene.family.owned / game.scene.family.total) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <span className="scene-empty">
            Aucune famille n&apos;est assez grande pour un paquet — le Live Drop reste là.
          </span>
        )}

        <button
          type="button"
          className="scene-action"
          onClick={onOpenScene}
          disabled={sceneBusy || game.scene.opened || !game.scene.family}
        >
          {sceneBusy ? (
            <LoaderCircle className="spin" size={17} />
          ) : game.scene.opened ? (
            <Clock3 size={17} />
          ) : (
            <Layers3 size={17} />
          )}
          <span>
            {sceneBusy
              ? "Ouverture…"
              : game.scene.opened
                ? "Reviens demain (nouvelle journée à 6 h UTC)"
                : `Ouvrir le ${game.scene.label}`}
          </span>
        </button>
      </section>

      <section className="section-block drop-findings">
        <div className="section-heading">
          <div>
            <span className="drop-section-kicker">LES NOMS QUI RESTENT</span>
            <h2>Dernières trouvailles</h2>
          </div>
          <button type="button" className="drop-binder-link" onClick={onShowCollection}>Mon Binder <ChevronRight size={15} /></button>
        </div>
        {latest.length ? (
          <div className="mini-card-row">
            {latest.map((card) => {
              const creator = CREATOR_BY_SLUG.get(card.creatorSlug);
              return creator ? (
                <CreatorCard
                  key={card.id}
                  creator={creator}
                  variant={card.variant}
                  compact
                  onClick={() => setInspectCard(card)}
                  liveStream={liveFor(live, creator.login, now)}
                />
              ) : null;
            })}
          </div>
        ) : (
          <div className="empty-collection">
            <Layers3 size={25} />
            <div>
              <strong>Ton classeur de {CATALOG_SIZE} streameurs t’attend</strong>
              <span>Ouvre ton premier booster pour lancer la collection.</span>
            </div>
          </div>
        )}
      </section>
      {inspectCard && inspectedCreator ? createPortal(
        <div ref={findingFocus} tabIndex={-1}>
        <CardInspectModal creator={inspectedCreator} variant={inspectCard.variant}
          ownedCount={game.cards.filter((card) => card.creatorSlug === inspectCard.creatorSlug && card.variant === inspectCard.variant).length}
          liveStream={liveFor(live, inspectedCreator.login, now)} onClose={() => setInspectCard(null)} />
        </div>, document.body
      ) : null}
    </div>
  );
}

