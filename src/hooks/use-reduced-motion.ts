"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function read() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Respecte le réglage système « réduire les animations ». Les durées de la
 * cinématique sont alors multipliées par `REDUCED_MOTION_SCALE`
 * (voir `timingsFor` dans `src/lib/pack-animation.ts`) ; les gestes pilotés au
 * doigt restent inchangés, puisqu'ils suivent déjà le doigt.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
