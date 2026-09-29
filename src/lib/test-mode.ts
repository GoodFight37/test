/**
 * Mode test — ouvertures illimitées, **sans jamais toucher à la sauvegarde**.
 *
 * Objectif : pouvoir rejouer la cinématique d'ouverture en boucle pour la
 * juger, alors que la recharge réelle est d'1 h (Live) et 4 h (Archives).
 *
 * Choix d'implémentation :
 *  - stockage **séparé** (`creatordeck.testmode.v1`), pas dans
 *    `creatordeck.save.v1` : le format de sauvegarde et son `SAVE_VERSION`
 *    ne changent pas, donc aucune ancienne sauvegarde n'est touchée ;
 *  - store miniature calqué sur `game-store.ts` : effet `subscribe` unique,
 *    snapshot stable, `getServerSnapshot` qui renvoie `false` pour le
 *    pré-rendu statique.
 *
 * Le tirage simulé lui-même vit dans `gameStore.previewPack()` : même
 * `drawPack()` que la vraie ouverture (donc mêmes raretés, mêmes doublons
 * interdits, mêmes badges NEW), mais sans persistance ni consommation.
 */

const TEST_KEY = "creatordeck.testmode.v1";

type Listener = () => void;

let enabled = false;
let loaded = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    enabled = window.localStorage.getItem(TEST_KEY) === "1";
  } catch {
    // Stockage indisponible : le mode test reste éteint pour cette session.
    enabled = false;
  }
}

export const testModeStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    const wasLoaded = loaded;
    ensureLoaded();
    if (!wasLoaded && loaded) listener();
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): boolean {
    return enabled;
  },

  getServerSnapshot(): boolean {
    return false;
  },

  set(value: boolean): void {
    ensureLoaded();
    enabled = value;
    try {
      if (value) window.localStorage.setItem(TEST_KEY, "1");
      else window.localStorage.removeItem(TEST_KEY);
    } catch {
      // La valeur reste en mémoire pour la session en cours.
    }
    emit();
  },
};
