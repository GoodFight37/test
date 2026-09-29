"use client";

/**
 * Inclinaison 3D d'une carte au doigt.
 *
 * Le geste est lu par `usePointerGesture` et traduit en variables CSS écrites
 * directement sur le nœud (`--tilt-rx`, `--tilt-ry`, `--shine-x`, `--shine-y`) :
 *  - `rotateX` / `rotateY` donnent l'inclinaison ;
 *  - `--shine-*` déplace le reflet holo, qui suit donc l'angle de la carte ;
 *  - aucun re-render React par frame.
 *
 * `restX` / `restY` définissent l'**angle de repos** : sur la référence, la
 * carte à l'écran est tenue en 3/4, jamais à plat. Le doigt s'ajoute à cet
 * angle puis la carte y revient au relâchement.
 *
 * Deux modes :
 *  - `free` : les deux axes suivent le doigt (`touch-action: none` en CSS).
 *    Utilisé sur la scène de révélation, où il n'y a rien à faire défiler.
 *  - `scroll-safe` : le défilement vertical du classeur est préservé
 *    (`touch-action: pan-y`). Quand le navigateur réclame le geste, il envoie
 *    `pointercancel` et la carte revient à son angle de repos.
 */
import { useCallback, useEffect, useRef } from "react";
import { usePointerGesture } from "@/hooks/use-pointer-gesture";
import { TILT_MAX_DEG, TILT_MAX_DEG_SCROLL_SAFE, clamp } from "@/lib/pack-animation";

export type TiltMode = "free" | "scroll-safe";

export type TiltOptions = {
  mode?: TiltMode;
  /** Amplitude maximale en degrés. Défaut selon le mode. */
  maxDeg?: number;
  enabled?: boolean;
  /** Appui court sans déplacement : exploité pour le retournement dos/face. */
  onTap?: () => void;
  /** Angle de repos en degrés (voir en-tête du module). */
  restX?: number;
  restY?: number;
};

export function useTilt({
  mode = "free",
  maxDeg,
  enabled = true,
  onTap,
  restX = 0,
  restY = 0,
}: TiltOptions = {}) {
  const limit = maxDeg ?? (mode === "scroll-safe" ? TILT_MAX_DEG_SCROLL_SAFE : TILT_MAX_DEG);
  const nodeRef = useRef<HTMLElement | null>(null);
  const tapRef = useRef(onTap);
  // Synchronisé dans un effet : React 19 interdit d'écrire un ref pendant le
  // rendu, et le callback n'est de toute façon lu qu'au relâcher du doigt.
  useEffect(() => {
    tapRef.current = onTap;
  });

  /** Pose la carte à son angle de repos, reflet recentré, à plat. */
  const applyRest = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    node.style.setProperty("--tilt-rx", `${restX}deg`);
    node.style.setProperty("--tilt-ry", `${restY}deg`);
    node.style.setProperty("--shine-x", "50%");
    node.style.setProperty("--shine-y", "50%");
    node.style.setProperty("--tilt-scale", "1");
    node.dataset.tiltDragging = "false";
  }, [restX, restY]);

  const apply = useCallback(
    (nx: number, ny: number, active: boolean) => {
      const node = nodeRef.current;
      if (!node) return;
      const x = clamp(nx, -1, 1);
      const y = clamp(ny, -1, 1);
      // Le doigt s'ajoute à l'angle de repos : la carte reste « tenue en main ».
      node.style.setProperty("--tilt-ry", `${(restY + x * limit).toFixed(2)}deg`);
      node.style.setProperty("--tilt-rx", `${(restX - y * limit).toFixed(2)}deg`);
      node.style.setProperty("--shine-x", `${(50 + x * 50).toFixed(1)}%`);
      node.style.setProperty("--shine-y", `${(50 + y * 50).toFixed(1)}%`);
      node.style.setProperty("--tilt-scale", active ? "1.035" : "1");
      node.dataset.tiltDragging = active ? "true" : "false";
    },
    [limit, restX, restY],
  );

  const reset = useCallback(() => applyRest(), [applyRest]);

  const { handlers, active } = usePointerGesture({
    disabled: !enabled,
    onStart: (snapshot) => apply(snapshot.nx, snapshot.ny, true),
    onMove: (snapshot) => apply(snapshot.nx, snapshot.ny, true),
    onEnd: (end) => {
      if (end.isTap) tapRef.current?.();
      reset();
    },
  });

  const ref = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      if (!node) return;
      applyRest();
    },
    [applyRest],
  );

  // L'angle de repos peut changer au fil de la cinématique (la carte « se
  // pose en main » à la fin du retournement) : on la repose sans geste.
  useEffect(() => {
    if (active) return;
    applyRest();
  }, [active, applyRest]);

  return { ref, handlers, dragging: active, reset };
}
