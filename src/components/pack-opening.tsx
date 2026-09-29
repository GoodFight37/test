"use client";

/**
 * Cinématique d'ouverture de booster, dans l'esprit Pokémon TCG Pocket :
 *
 *   0. `choosing`  — carrousel 3D : on fait glisser les paquets au doigt pour
 *                     choisir celui qu'on ouvre (uniquement s'il y a plusieurs
 *                     boosteurs ; un seul → on démarre directement en
 *                     `sealed`) ;
 *   1. `sealed`    — le pack fermé lévite au centre ;
 *   2. `tearing`   — on trace le pack du doigt (à travers le haut, façon
 *                     Pocket, ou vers le haut) : le rabat se soulève, la
 *                     dentelure se creuse et le pack tremble ;
 *   3. `burst`     — la déchirure aboutit, le tirage est effectué à cet instant
 *                     précis (jamais avant) et les cartes jaillissent ;
 *   4. `pile`      — les cartes retombent en pile, faces cachées ;
 *   5. `revealing` — on balaie la carte du dessus, elle sort de la pile et se
 *                     retourne ;
 *   6. `rare-flip` — la dernière carte (rare ou mieux, voir `revealOrder`) a un
 *                     retournement LENT, un reflet holo et des particules ;
 *   7. `summary`   — récapitulatif des cartes obtenues.
 *
 * Tout ce qui est durée, seuil ou intensité vient de `src/lib/pack-animation.ts`
 * (module pur, testé) : ce composante ne fait que projeter ces valeurs sur le
 * DOM. Le tirage lui-même reste dans `game-store` / `game-engine`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hand, Sparkles, X } from "lucide-react";
import { Card3D } from "@/components/card3d";
import { CreatorCard } from "@/components/creator-card";
import { Booster3D } from "@/components/booster3d";
import { ParticleBurst } from "@/components/particle-burst";
import {
  UnityPackOpening,
  useUnityBuildAvailable,
} from "@/components/unity-pack-opening";
import { usePointerGesture } from "@/hooks/use-pointer-gesture";
import { haptic, playPackSound } from "@/lib/pack-sound";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import {
  CREATOR_BY_SLUG,
  PACKS,
  RARITY_META,
  type PackType,
} from "@/lib/catalog";
import type { DrawnCard } from "@/lib/game-engine";

import {
  CAROUSEL_SPACING_PX,
  carouselSlot,
  carouselSnap,
  clamp01,
  effectIntensity,
  easeOutCubic,
  flipDurationMs,
  isRareOrBetter,
  pileSlot,
  revealOrder,
  summaryDelayMs,
  swipeProgress,
  swipeReveals,
  swipeRotation,
  tearBaseClipPath,
  tearClipPath,
  tearCompletes,
  tearProgress,
  timingsFor,
  TEAR_SHAKE_PX,
  type PackPhase,
  type PackTimings,
} from "@/lib/pack-animation";

/**
 * Les boosters proposés dans le carrousel, dans l'ordre de l'arc.
 * Un seul booster pour l'instant : le second concept reviendra plus tard —
 * il suffira de le ré-ajouter à cette liste pour réactiver le carrousel.
 */
const PACK_TYPES: PackType[] = ["live"];

/**
 * Étapes locales de la cinématique :
 *  - `choosing`  : carrousel 3D, on choisit le booster au doigt ;
 *  - `revealed`  : la carte a fini de se retourner.
 * Ce sont des écrans d'entrée/sortie, pas des phases de la chorégraphie de
 * déchirure (cf. `PackPhase`), d'où ce type étendu local.
 */
type Stage = PackPhase | "choosing" | "revealed";

/** Pas de carrousel de choix quand il n'y a rien à choisir : on démarre sur
 * le pack fermé. Le scénario repasse par `choosing` dès qu'un second booster
 * rejoint `PACK_TYPES`. */
const START_STAGE: Stage = PACK_TYPES.length > 1 ? "choosing" : "sealed";

export type PackOpeningProps = {
  packType: PackType;
  /** Effectue le tirage. Appelé une seule fois, au moment où la déchirure aboutit. */
  onDraw: () => DrawnCard[];
  onClose: () => void;
  onError: (message: string) => void;
  /** Le choix du carrousel remonte au parent (il pilote `onDraw`). */
  onSelectPackType?: (packType: PackType) => void;
};

/** Petits délais chaînés, tous annulés au démontage. */
function useScheduler() {
  const ids = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const schedule = useCallback((callback: () => void, ms: number) => {
    const id = window.setTimeout(callback, Math.max(0, ms));
    ids.current.push(id);
    return id;
  }, []);
  const frame = useCallback((callback: FrameRequestCallback) => {
    const id = requestAnimationFrame(callback);
    frames.current.push(id);
    return id;
  }, []);
  useEffect(
    () => () => {
      ids.current.forEach((id) => clearTimeout(id));
      frames.current.forEach((id) => cancelAnimationFrame(id));
      ids.current = [];
      frames.current = [];
    },
    [],
  );
  return { schedule, frame };
}

export function PackOpening({
  packType,
  onDraw,
  onClose,
  onError,
  onSelectPackType,
}: PackOpeningProps) {
  // Appelé avant tout `return` conditionnel : les hooks doivent s'exécuter dans
  // le même ordre à chaque rendu, que Unity soit là ou non.
  const unityDetected = useUnityBuildAvailable();
  const reducedMotion = usePrefersReducedMotion();
  const timings = useMemo<PackTimings>(() => timingsFor(reducedMotion), [reducedMotion]);
  const { schedule, frame } = useScheduler();

  const [stage, setStageState] = useState<Stage>(START_STAGE);
  const [activeSlot, setActiveSlot] = useState(() =>
    Math.max(0, PACK_TYPES.indexOf(packType)),
  );
  const [carouselDragging, setCarouselDragging] = useState(false);
  const [cards, setCards] = useState<DrawnCard[]>([]);
  const [index, setIndexState] = useState(0);
  const [revealedCount, setRevealedCount] = useState(0);
  const [particles, setParticles] = useState(false);
  // Dès qu'un build Unity échoue à démarrer, on bascule définitivement en web :
  // pas de nouvelle tentative de contexte WebGL à chaque rendu.
  const [unityFailed, setUnityFailed] = useState(false);
  const unityStatus = unityFailed ? "absent" : unityDetected;

  // Refs synchrones : les gestes peuvent se déclencher deux fois dans le même
  // tick (tilt + balayage), il faut donc verrouiller sans attendre le render.
  const stageRef = useRef<Stage>(START_STAGE);
  const indexRef = useRef(0);
  const tearRef = useRef(0);
  const itemsRef = useRef<Array<HTMLElement | null>>([]);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const carouselStartRef = useRef(0);
  /** Le crissement du foil ne joue qu'une fois par déchirure. */
  const tearSoundedRef = useRef(false);
  /** Dernière distance de glissement : sépare le clic du glissement. */
  const lastDragPx = useRef(0);

  const timingsRef = useRef(timings);
  // Les handlers de geste lisent les durées au moment du geste, pas au render.
  useEffect(() => {
    timingsRef.current = timings;
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const packRef = useRef<HTMLDivElement | null>(null);
  const pileRef = useRef<HTMLDivElement | null>(null);

  const setStage = useCallback((next: Stage) => {
    stageRef.current = next;
    setStageState(next);
  }, []);
  const setIndex = useCallback((next: number) => {
    indexRef.current = next;
    setIndexState(next);
  }, []);

  const pack = PACKS[packType];
  const current = cards[index];
  const currentCreator = current ? CREATOR_BY_SLUG.get(current.creatorSlug) : undefined;

  /* ------------------------------------------------------------------ *
   * Focus clavier à l'ouverture.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Sans bouton en pied d'écran, le clavier agit depuis le dialogue : si le
  // focus retombe sur <body> (élément focalisé démonté au changement de
  // phase), on le ravitaille pour que la touche d'activation continue de
  // fonctionner.
  useEffect(() => {
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root || !active || active === document.body) root?.focus();
  }, [stage]);

  /* ------------------------------------------------------------------ *
   * Déchirure du pack.
   * ------------------------------------------------------------------ */
  const paintTear = useCallback((value: number) => {
    const node = packRef.current;
    if (!node) return;
    node.style.setProperty("--tear", value.toFixed(4));
    node.style.setProperty("--shake-amp", (TEAR_SHAKE_PX * value).toFixed(2));
    node.style.setProperty("--tear-clip", tearClipPath(value));
    node.style.setProperty("--tear-base-clip", tearBaseClipPath(value));
  }, []);

  const completeTear = useCallback(() => {
    if (stageRef.current !== "sealed" && stageRef.current !== "tearing") return;
    if (!tearSoundedRef.current) {
      tearSoundedRef.current = true;
      playPackSound("tear");
    }
    playPackSound("whoosh");
    haptic([25, 30, 45]);
    let drawn: DrawnCard[];
    try {
      drawn = onDraw();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Ouverture impossible.");
      onClose();
      return;
    }
    // La meilleure carte est révélée en dernier : c'est elle qui a droit au
    // retournement lent.
    setCards(revealOrder(drawn));
    setRevealedCount(0);
    setIndex(0);
    setStage("burst");
    const node = packRef.current;
    if (node) {
      node.style.setProperty("--tear", "1");
      node.style.setProperty("--tear-clip", tearClipPath(1));
      node.style.setProperty("--tear-base-clip", tearBaseClipPath(1));
    }
    schedule(() => setStage("pile"), timingsRef.current.burst + timingsRef.current.pileSettle);
  }, [onDraw, onClose, onError, schedule, setIndex, setStage]);

  /** Ramène le rabat à plat quand le geste est relâché trop tôt. */
  const snapBack = useCallback(() => {
    const from = tearRef.current;
    if (from <= 0) return;
    const startedAt = performance.now();
    const duration = Math.max(1, timingsRef.current.tearSnapBack);
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const value = from * (1 - easeOutCubic(t));
      tearRef.current = value;
      paintTear(value);
      if (t < 1) frame(tick);
    };
    frame(tick);
  }, [frame, paintTear]);

  const packGesture = usePointerGesture({
    // Pocket trace à travers le haut du pack ; le glissement vers le haut,
    // accepté depuis la première version, le reste aussi.
    axis: "any",
    disabled: stage !== "sealed" && stage !== "tearing",
    onStart: () => {
      tearSoundedRef.current = false;
      setStage("tearing");
    },
    onMove: (snapshot) => {
      const progress = Math.max(
        tearProgress(Math.abs(snapshot.dx), snapshot.width),
        // Le doigt monte : `dy` est négatif.
        tearProgress(-snapshot.dy, snapshot.height),
      );
      tearRef.current = progress;
      paintTear(progress);
      // Dès que le foil « cède », le crissement suit le doigt.
      if (!tearSoundedRef.current && progress >= 0.12) {
        tearSoundedRef.current = true;
        playPackSound("tear");
        haptic(30);
      }
    },
    onEnd: (end) => {
      if (end.isTap || tearCompletes(tearRef.current, end.velocity)) {
        completeTear();
      } else {
        setStage("sealed");
        snapBack();
      }
    },
  });

  /* ------------------------------------------------------------------ *
   * Carrousel 3D : parcourir et choisir le booster au doigt.
   *
   * Pendant le geste, l'index courant est fractionnaire et chaque paquet est
   * peint directement en variables CSS (aucun re-render par frame) ; au
   * relâchement, `carouselSnap` cale sur l'entier le plus proche et la
   * transition CSS fait l'animation d'accroche.
   * ------------------------------------------------------------------ */
  const paintCarousel = useCallback((activeFloat: number, dragging: boolean) => {
    const track = trackRef.current;
    track?.classList.toggle("is-dragging", dragging);
    PACK_TYPES.forEach((type, index) => {
      const node = itemsRef.current[index];
      if (!node) return;
      const slot = carouselSlot(index, activeFloat);
      node.style.setProperty("--cx", `${slot.x}px`);
      node.style.setProperty("--cz", `${slot.z}px`);
      node.style.setProperty("--cang", `${slot.rotateY}deg`);
      node.style.setProperty("--cs", slot.scale.toFixed(3));
      node.style.setProperty(
        "--sheen",
        clamp01(0.5 + slot.rotateY / 120).toFixed(3),
      );
      node.classList.toggle("is-out", slot.hidden);
      node.classList.toggle("is-active", index === Math.round(activeFloat));
    });
  }, []);

  useEffect(() => {
    if (stage === "choosing") paintCarousel(activeSlot, false);
  }, [stage, activeSlot, paintCarousel]);

  const choosePack = useCallback(() => {
    if (stageRef.current !== "choosing") return;
    setStage("sealed");
    playPackSound("tick");
    haptic(8);
  }, [setStage]);

  const handleCarouselItemClick = useCallback(
    (index: number) => {
      // Un glissement vient de se terminer au-dessus du paquet : ce n'est pas
      // un clic, on n'en tient pas compte.
      if (lastDragPx.current > 12) return;
      const type = PACK_TYPES[index];
      if (!type) return;
      if (index === activeSlot) {
        choosePack();
        return;
      }
      setActiveSlot(index);
      if (type !== packType) onSelectPackType?.(type);
    },
    [activeSlot, choosePack, onSelectPackType, packType],
  );

  const carouselGesture = usePointerGesture({
    axis: "x",
    capture: false,
    disabled: stage !== "choosing",
    onStart: () => {
      carouselStartRef.current = activeSlot;
      setCarouselDragging(true);
      paintCarousel(activeSlot, true);
    },
    onMove: (snapshot) => {
      const activeFloat = carouselStartRef.current - snapshot.dx / CAROUSEL_SPACING_PX;
      paintCarousel(activeFloat, true);
    },
    onEnd: (end) => {
      setCarouselDragging(false);
      lastDragPx.current = Math.abs(end.dx);
      // Tap pur : c'est le clic sur un paquet qui décide (voir plus bas).
      if (end.cancelled || end.isTap) {
        paintCarousel(activeSlot, false);
        return;
      }
      const next = carouselSnap(carouselStartRef.current, end.dx, PACK_TYPES.length);
      const type = PACK_TYPES[next] ?? packType;
      setActiveSlot(next);
      paintCarousel(next, false);
      if (type !== packType) onSelectPackType?.(type);
    },
  });

  /* ------------------------------------------------------------------ *
   * Balayage de la carte du dessus.
   * ------------------------------------------------------------------ */
  const paintSwipe = useCallback((deltaPx: number, widthPx: number) => {
    const node = pileRef.current;
    if (!node) return;
    const progress = swipeProgress(deltaPx, widthPx);
    node.style.setProperty("--drag-x", `${Math.round(deltaPx)}px`);
    node.style.setProperty("--drag-rot", `${swipeRotation(progress).toFixed(2)}deg`);
    node.style.setProperty("--drag-lift", `${(Math.abs(progress) * 12).toFixed(1)}px`);
  }, []);

  const resetSwipe = useCallback(() => {
    const node = pileRef.current;
    if (!node) return;
    node.style.setProperty("--drag-x", "0px");
    node.style.setProperty("--drag-rot", "0deg");
    node.style.setProperty("--drag-lift", "0px");
  }, []);

  const revealTop = useCallback(() => {
    if (stageRef.current !== "pile") return;
    const card = cards[indexRef.current];
    if (!card) return;
    const slow = isRareOrBetter(card.rarity);
    const slowState: Stage = slow ? "rare-flip" : "revealing";
    const otherState: Stage = slow ? "revealing" : "rare-flip";
    setStage(slowState);
    if (slow) setParticles(true);
    playPackSound("flip");
    if (slow) {
      playPackSound("rare");
      haptic([15, 35, 30]);
    } else {
      haptic(12);
    }
    resetSwipe();
    const active = timingsRef.current;
    const flipMs = flipDurationMs(card, active);
    // La carte sort d'abord de la pile, puis se retourne en vol.
    // Chaque transition est re-vérifiée au moment où elle expire : si le joueur
    // a passé la carte entre-temps, elle ne doit plus rien changer.
    schedule(() => {
      if (stageRef.current !== slowState && stageRef.current !== otherState) return;
      setRevealedCount((current) => Math.max(current, indexRef.current + 1));
    }, active.cardLift);
    schedule(() => {
      if (stageRef.current !== slowState && stageRef.current !== otherState) return;
      setStage("revealed");
    }, active.cardLift + flipMs);
  }, [cards, resetSwipe, schedule, setStage]);

  const pileGesture = usePointerGesture({
    axis: "x",
    // La carte du dessus capture déjà le pointeur pour son inclinaison : si le
    // conteneur capturait aussi, les `pointermove` n'atteindraient plus la carte.
    capture: false,
    disabled:
      (stage !== "pile" && stage !== "revealed") || cards.length === 0,
    onMove: (snapshot) => paintSwipe(snapshot.dx, snapshot.width),
    onEnd: (end) => {
      if (end.cancelled) {
        resetSwipe();
        return;
      }
      const progress = swipeProgress(end.dx, end.width);
      const advance = end.isTap || swipeReveals(progress, end.velocity);
      if (stageRef.current === "revealed") {
        // Carte déjà retournée : le balayage (ou le tap) enchaîne la suivante.
        resetSwipe();
        if (advance) goToNextCard();
        return;
      }
      if (advance) {
        revealTop();
      } else {
        resetSwipe();
      }
    },
  });

  /* ------------------------------------------------------------------ *
   * Navigation entre les cartes.
   * ------------------------------------------------------------------ */
  const goToNextCard = useCallback(() => {
    if (stageRef.current !== "revealed") return;
    if (indexRef.current >= cards.length - 1) {
      setParticles(false);
      setStage("summary");
      playPackSound("chime");
      haptic([10, 40, 12]);
      return;
    }
    setParticles(false);
    setIndex(indexRef.current + 1);
    setStage("pile");
    playPackSound("tick");
    haptic(8);
  }, [cards.length, setIndex, setStage]);

  const handleClose = useCallback(() => {
    setParticles(false);
    onClose();
  }, [onClose]);

  /**
   * Aucun bouton visible dans la cinématique : le clavier enchaîne les phases
   * depuis le dialogue lui-même. Le geste au doigt reste la façon amusante de
   * faire, pas la seule.
   */
  const handleRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowRight") {
        return;
      }
      // Un <button> focalisé (paquet, croix) gère sa propre touche : on n'agit
      // que quand la frappe arrive au dialogue, pour éviter le double déclenchement.
      const target = event.target as HTMLElement | null;
      if ((event.key === "Enter" || event.key === " ") && target?.closest("button")) {
        return;
      }
      event.preventDefault();
      switch (stageRef.current) {
        case "choosing":
          choosePack();
          break;
        case "sealed":
        case "tearing":
          completeTear();
          break;
        case "pile":
          revealTop();
          break;
        case "revealed":
          goToNextCard();
          break;
        case "summary":
          handleClose();
          break;
        default:
          // burst / revealing / rare-flip : on laisse l'animation se jouer.
          break;
      }
    },
    [choosePack, completeTear, revealTop, goToNextCard, handleClose],
  );

  /* ------------------------------------------------------------------ *
   * Repli : si un build Unity est présent, il pilote la cinématique.
   * Sans build (cas normal), on passe directement sur l'implémentation web.
   * ------------------------------------------------------------------ */
  if (unityStatus === "checking") {
    return (
      <div className="pack-cinema stage-sealed" role="dialog" aria-modal="true" aria-label="Ouverture du booster">
        <div className="pack-cinema-ambient" aria-hidden="true" />
        <p className="pack-cinema-hint" style={{ margin: "auto" }}>
          Préparation de l&apos;ouverture…
        </p>
      </div>
    );
  }
  if (unityStatus === "available") {
    return (
      <UnityPackOpening
        packType={packType}
        onDraw={onDraw}
        onClose={onClose}
        onError={onError}
        onUnavailable={() => setUnityFailed(true)}
      />
    );
  }

  const stageHint = (() => {
    switch (stage) {
      case "choosing":
        return "Glisse pour choisir · touche le pack pour l’ouvrir";
      case "sealed":
      case "tearing":
        return "Glisse à travers le haut du pack pour le déchirer";
      case "burst":
        return "";
      case "pile":
        return "Balaie la carte du dessus pour la révéler";
      case "revealing":
      case "rare-flip":
        return "";
      case "revealed":
        // L'étiquette du haut (`reveal-name`) affiche déjà rang et catégorie.
        return "Glisse pour continuer";
      case "summary":
        return "Touche pour ranger dans le classeur";
      default:
        return "";
    }
  })();

  const showPack = stage === "sealed" || stage === "tearing" || stage === "burst";
  const showCarousel = stage === "choosing";
  const showPile = cards.length > 0 && stage !== "summary";
  // Le nom n'apparaît qu'une fois le retournement terminé : l'afficher pendant
  // le flip gâcherait la surprise de la carte rare.
  const showName = stage === "revealed" && Boolean(currentCreator);

  return (
    <div
      ref={rootRef}
      className={`pack-cinema is-light stage-${stage} rarity-${current?.rarity ?? "common"}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Ouverture du booster ${pack.label}`}
      tabIndex={-1}
      onKeyDown={handleRootKeyDown}
    >
      <div className={`pack-cinema-ambient pack-${packType}`} aria-hidden="true" />

      <header className="pack-cinema-header">
        <span>
          {cards.length ? `${Math.min(index + 1, cards.length)} / ${cards.length}` : pack.label}
        </span>
        <div className="pack-cinema-dots" aria-hidden="true">
          {cards.map((card, dotIndex) => (
            <i key={card.id} className={dotIndex < revealedCount ? "done" : ""} />
          ))}
        </div>
        <button type="button" onClick={handleClose} aria-label="Fermer l'ouverture">
          <X size={20} />
        </button>
      </header>

      {showCarousel ? (
        <section className="carousel-screen" aria-label="Choix du booster">
          <div
            className={`carousel-stage ${carouselDragging ? "is-dragging" : ""}`}
            {...carouselGesture.handlers}
          >
            <div className="carousel-glow" aria-hidden="true" />
            <div className="carousel-floor" aria-hidden="true" />
            <div className="carousel-track" ref={trackRef}>
              {PACK_TYPES.map((type, index) => (
                <button
                  type="button"
                  key={type}
                  ref={(node) => {
                    itemsRef.current[index] = node;
                  }}
                  className={`carousel-item ${index === activeSlot ? "is-active" : ""}`}
                  onClick={() => handleCarouselItemClick(index)}
                  aria-label={`Choisir ${PACKS[type].label}`}
                  aria-pressed={index === activeSlot}
                >
                  <Booster3D packType={type} reflection />
                </button>
              ))}
            </div>
          </div>

          <div className="carousel-caption">
            <p className="eyebrow">{PACKS[packType].eyebrow}</p>
            <h2>{PACKS[packType].label}</h2>
            <p>{PACKS[packType].description}</p>
            <span className="carousel-hint">
              <Hand size={14} />
              Glisse pour changer de booster
            </span>
          </div>

          <div className="carousel-dots" aria-hidden="true">
            {PACK_TYPES.map((type, index) => (
              <i key={type} className={index === activeSlot ? "active" : ""} />
            ))}
          </div>
        </section>
      ) : stage === "summary" ? (
        <section
          className="pack-summary"
          aria-label="Récapitulatif du booster"
          onClick={handleClose}
        >
          <h2>{pack.label}</h2>
          <p className="pack-summary-gain">
            +{pack.points} points · +{pack.xp} XP
          </p>
          <ul className="pack-summary-grid">
            {cards.map((card, cardIndex) => {
              const creator = CREATOR_BY_SLUG.get(card.creatorSlug);
              if (!creator) return null;
              return (
                <li
                  key={card.id}
                  className={`pack-summary-item rarity-${card.rarity}`}
                  style={{ animationDelay: `${summaryDelayMs(cardIndex, timings)}ms` }}
                >
                  <CreatorCard creator={creator} variant={card.variant} compact />
                  {card.isNew ? (
                    <span className="pack-summary-new">
                      <Sparkles size={9} /> NEW
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="pack-cinema-stage">
          {showPack ? (
            <div
              ref={packRef}
              className="pack-tear-wrap"
              style={
                {
                  "--tear": "0",
                  "--shake-amp": "0",
                  "--tear-clip": tearClipPath(0),
                  "--tear-base-clip": tearBaseClipPath(0),
                  "--burst-ms": `${timings.burst}ms`,
                  "--settle-ms": `${timings.pileSettle}ms`,
                  // Lévitation du pack fermé : période du clip réel du jeu.
                  "--float-ms": `${timings.sealedFloat}ms`,
                } as React.CSSProperties
              }
              {...packGesture.handlers}
            >
              <div className="pack-tear-inside" aria-hidden="true" />
              <div className="pack-tear-base">
                <Booster3D packType={packType} />
              </div>
              <div className="pack-tear-flap" aria-hidden="true">
                <Booster3D packType={packType} />
              </div>
              <div className="pack-tear-seam" aria-hidden="true" />
              <p className="pack-tear-hint">
                <Hand size={15} />
                Glisse pour déchirer
              </p>
            </div>
          ) : null}

          {showPile ? (
            <div ref={pileRef} className="card-pile" {...pileGesture.handlers}>
              {cards.map((card, cardIndex) => {
                const creator = CREATOR_BY_SLUG.get(card.creatorSlug);
                if (!creator) return null;
                const slot = pileSlot(cardIndex, index);
                const isActive = cardIndex === index;
                const collected = cardIndex < index;
                const faceUp = cardIndex < revealedCount;
                const slow = isActive && isRareOrBetter(card.rarity);
                return (
                  <div
                    key={card.id}
                    className={[
                      "card-pile-slot",
                      isActive ? "is-active" : "",
                      collected ? "is-collected" : "",
                      slot.hidden ? "is-hidden" : "",
                      slow ? "is-rare" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      {
                        "--slot-x": `${slot.x}px`,
                        "--slot-y": `${slot.y}px`,
                        "--slot-z": `${slot.z}px`,
                        "--slot-rot": `${slot.rotate}deg`,
                        "--slot-scale": slot.scale.toFixed(3),
                        "--flip-ms": `${flipDurationMs(card, timings)}ms`,
                        "--lift-ms": `${timings.cardLift}ms`,
                        "--stagger": `${cardIndex * 55}`,
                        zIndex: 100 - cardIndex,
                      } as React.CSSProperties
                    }
                  >
                    <div className="card-pile-drag">
                      <Card3D
                        rarity={card.rarity}
                        variant={card.variant}
                        faceUp={faceUp}
                        mode="free"
                        tilt={!collected}
                        stack
                        restAngle={
                          stage === "revealed" && isActive
                            ? { x: 7, y: -18 }
                            : undefined
                        }
                        onFlip={isActive && stage === "pile" ? revealTop : undefined}
                        flipDurationMs={flipDurationMs(card, timings)}
                        flipLabel={`Révéler ${creator.displayName}`}
                        className="pile-card"
                        face={<CreatorCard creator={creator} variant={card.variant} />}
                      />
                      {isActive && particles ? (
                        <ParticleBurst
                          intensity={effectIntensity(card.rarity, card.variant)}
                          color={RARITY_META[card.rarity].color}
                          durationMs={timings.rareParticles}
                          running={particles}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {showName && current ? (
            <div className="reveal-name">
              <p>
                #{currentCreator?.rank} · {RARITY_META[current.rarity].label}
                {current.variant !== "standard" ? ` · ${current.variant}` : ""}
              </p>
              <h2>{currentCreator?.displayName}</h2>
              {current.isNew ? (
                <span className="new-badge">
                  <Sparkles size={12} /> NOUVELLE CARTE
                </span>
              ) : (
                <span>Déjà dans ton classeur</span>
              )}
            </div>
          ) : null}
        </div>
      )}

      <footer className="pack-cinema-footer">
        {/* Plus aucun bouton : gestes au doigt, clavier via `handleRootKeyDown`. */}
        <p className="pack-cinema-hint" aria-live="polite">
          {stageHint}
        </p>
      </footer>
    </div>
  );
}

