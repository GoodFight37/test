"use client";

import { useSyncExternalStore } from "react";
import { testModeStore } from "@/lib/test-mode";

/**
 * Mode test — ouvertures illimitées.
 *
 * `false` côté serveur (pré-rendu statique), relu côté client au premier
 * abonnement. L'état est persisté hors sauvegarde : l'activer ne modifie ni
 * les boosters, ni la collection, ni le format `creatordeck.save.v1`.
 */
export function useTestMode(): boolean {
  return useSyncExternalStore(
    testModeStore.subscribe,
    testModeStore.getSnapshot,
    testModeStore.getServerSnapshot,
  );
}
