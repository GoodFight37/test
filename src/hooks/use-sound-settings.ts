"use client";

import { useSyncExternalStore } from "react";
import { soundSettings } from "@/lib/sound-settings";

/**
 * Son & vibrations de l'ouverture — `true` côté serveur (par défaut activé),
 * relu côté client au premier abonnement. Persisté hors sauvegarde.
 */
export function useSoundSettings(): boolean {
  return useSyncExternalStore(
    soundSettings.subscribe,
    soundSettings.getSnapshot,
    soundSettings.getServerSnapshot,
  );
}
