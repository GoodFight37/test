"use client";

/**
 * Détection de geste au doigt, partagée par la déchirure du booster, le
 * balayage des cartes et l'inclinaison 3D.
 *
 * Choix d'implémentation :
 *  - aucune `setState` pendant `pointermove` : les valeurs sont poussées vers
 *    les callbacks (qui écrivent directement des variables CSS). Sur un
 *    WebView Android à 60-120 Hz, un re-render React par frame ferait tomber
 *    des images.
 *  - le rectangle de l'élément est mesuré une fois au `pointerdown`, pas à
 *    chaque déplacement (pas de `getBoundingClientRect` en boucle).
 *  - la vitesse est un déplacement / durée lissé par moyenne mobile
 *    exponentielle : c'est elle qui permet de valider un geste vif même quand
 *    la distance parcourue est courte.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TAP_MAX_MOVE_PX, TAP_MAX_MS } from "@/lib/pack-animation";

export type GestureSnapshot = {
  active: boolean;
  /** Déplacement horizontal depuis l'appui, en px. */
  dx: number;
  /** Déplacement vertical depuis l'appui, en px. */
  dy: number;
  /** Déplacement sur l'axe dominant, signé. */
  dominant: number;
  /** Vitesse lissée sur l'axe dominant, en px/ms. */
  velocity: number;
  /** Largeur / hauteur de l'élément au moment de l'appui. */
  width: number;
  height: number;
  /** Position du pointeur dans l'élément, normalisée de -1 à 1. */
  nx: number;
  ny: number;
  /** Axe sur lequel le geste s'est engagé. */
  axis: "x" | "y" | "none";
};

export type GestureEnd = GestureSnapshot & {
  /** Appui court et quasi immobile : exploité pour le retournement au tap. */
  isTap: boolean;
  /** Le geste a été volé par le navigateur (scroll du classeur). */
  cancelled: boolean;
};

export type GestureOptions = {
  onStart?: (snapshot: GestureSnapshot) => void;
  onMove?: (snapshot: GestureSnapshot) => void;
  onEnd?: (end: GestureEnd) => void;
  /** Restreint le geste à un axe. `any` par défaut. */
  axis?: "any" | "x" | "y";
  tapMaxMovePx?: number;
  tapMaxMs?: number;
  /** Ignore le geste (ex. pendant une autre phase de la cinématique). */
  disabled?: boolean;
  /**
   * Capture du pointeur (défaut). À couper sur un conteneur parent dont les
   * enfants capturent déjà le pointeur : la capture la plus haute gagnerait et
   * les descendants ne recevraient plus aucun `pointermove`.
   */
  capture?: boolean;
};

const IDLE: GestureSnapshot = {
  active: false,
  dx: 0,
  dy: 0,
  dominant: 0,
  velocity: 0,
  width: 0,
  height: 0,
  nx: 0,
  ny: 0,
  axis: "none",
};

/** Durée minimale entre deux mesures de vitesse, pour éviter les divisions folles. */
const MIN_DT_MS = 8;
/** Facteur de lissage de la vitesse (0 → 1, plus c'est haut plus c'est réactif). */
const VELOCITY_SMOOTHING = 0.55;

export function usePointerGesture(options: GestureOptions = {}) {
  const ref = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  const track = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    startTime: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
    rect: null as DOMRect | null,
    axis: "none" as GestureSnapshot["axis"],
  });

  const build = useCallback((clientX: number, clientY: number, isActive: boolean): GestureSnapshot => {
    const current = track.current;
    const rect = current.rect;
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    const dx = clientX - current.startX;
    const dy = clientY - current.startY;
    const useAxis = optionsRef.current.axis ?? "any";
    const axis =
      current.axis !== "none"
        ? current.axis
        : useAxis === "any"
          ? Math.abs(dx) >= Math.abs(dy)
            ? "x"
            : "y"
          : useAxis;
    return {
      active: isActive,
      dx,
      dy,
      dominant: axis === "y" ? dy : dx,
      velocity: current.velocity,
      width,
      height,
      nx: width > 0 ? ((clientX - (rect?.left ?? 0)) / width) * 2 - 1 : 0,
      ny: height > 0 ? ((clientY - (rect?.top ?? 0)) / height) * 2 - 1 : 0,
      axis,
    };
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (optionsRef.current.disabled) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.currentTarget;
      track.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: event.timeStamp,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        velocity: 0,
        rect: target.getBoundingClientRect(),
        axis: optionsRef.current.axis && optionsRef.current.axis !== "any" ? optionsRef.current.axis : "none",
      };
      // La capture garde les `pointermove` même si le doigt sort de l'élément.
      if (optionsRef.current.capture !== false && typeof target.setPointerCapture === "function") {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // Certains WebViews refusent la capture : le geste reste utilisable.
        }
      }
      setActive(true);
      optionsRef.current.onStart?.(build(event.clientX, event.clientY, true));
    },
    [build],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = track.current;
      if (current.pointerId !== event.pointerId) return;
      const dt = Math.max(MIN_DT_MS, event.timeStamp - current.lastTime);
      const axis = optionsRef.current.axis ?? "any";
      const stepX = event.clientX - current.lastX;
      const stepY = event.clientY - current.lastY;
      const step = axis === "y" ? stepY : axis === "x" ? stepX : Math.abs(stepX) >= Math.abs(stepY) ? stepX : stepY;
      const instant = Math.abs(step) / dt;
      current.velocity =
        current.velocity * (1 - VELOCITY_SMOOTHING) + instant * VELOCITY_SMOOTHING;
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      current.lastTime = event.timeStamp;
      optionsRef.current.onMove?.(build(event.clientX, event.clientY, true));
    },
    [build],
  );

  const finish = useCallback(
    (event: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
      const current = track.current;
      if (current.pointerId !== event.pointerId) return;
      const end = build(event.clientX, event.clientY, false);
      const maxMove = optionsRef.current.tapMaxMovePx ?? TAP_MAX_MOVE_PX;
      const maxMs = optionsRef.current.tapMaxMs ?? TAP_MAX_MS;
      const distance = Math.hypot(end.dx, end.dy);
      track.current = { ...track.current, pointerId: -1, velocity: 0 };
      setActive(false);
      optionsRef.current.onEnd?.({
        ...end,
        cancelled,
        isTap: !cancelled && distance <= maxMove && event.timeStamp - current.startTime <= maxMs,
      });
    },
    [build],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => finish(event, false),
    [finish],
  );
  // `pointercancel` = le navigateur a pris le geste (scroll du classeur).
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => finish(event, true),
    [finish],
  );

  return {
    ref,
    active,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
