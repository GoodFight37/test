/**
 * Store client de la partie : charge la sauvegarde locale, applique les
 * actions du moteur (src/lib/game-engine.ts) et persiste après chaque
 * mutation. Exposé à React via `useSyncExternalStore` (src/hooks/use-game.ts).
 *
 * Module sans effet à l'import : rien n'est lu tant qu'un composant ne
 * s'abonne pas, ce qui reste compatible avec le pré-rendu statique.
 */
import type { PackType } from "@/lib/catalog";
import {
  createInitialState,
  drawPack,
  ownedSlugs,
  openPack as engineOpenPack,
  spendHourglass as engineSpendHourglass,
  type DrawnCard,
  type PlayerState,
} from "@/lib/game-engine";
import {
  SAVE_KEY,
  clearState,
  exportSave,
  importSave,
  loadState,
  saveState,
  type KeyValueStorage,
} from "@/lib/save-store";

type Listener = () => void;

let state: PlayerState | null = null;
let loaded = false;
const listeners = new Set<Listener>();

function storage(): KeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Stockage désactivé (navigation privée stricte, quota…) : la partie
    // vivra en mémoire le temps de la session.
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function persist(next: PlayerState) {
  state = next;
  const target = storage();
  if (target) {
    try {
      saveState(target, next);
    } catch {
      // Quota dépassé ou stockage indisponible : on garde l'état en mémoire.
    }
  }
  emit();
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const target = storage();
  const restored = target ? loadState(target) : null;
  state = restored ?? createInitialState();
  if (!restored && target) {
    try {
      saveState(target, state);
    } catch {
      /* voir persist() */
    }
  }
}

function handleStorageEvent(event: StorageEvent) {
  // Un autre onglet a modifié la sauvegarde : on se réaligne dessus.
  if (event.key !== SAVE_KEY || event.storageArea !== window.localStorage) return;
  const target = storage();
  const fresh = target ? loadState(target) : null;
  if (fresh) {
    state = fresh;
    emit();
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const wasLoaded = loaded;
  ensureLoaded();
  if (!wasLoaded) {
    // Premier abonné : l'état vient d'être chargé, on prévient React.
    listener();
  }
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

export function getSnapshot(): PlayerState | null {
  return state;
}

export function getServerSnapshot(): PlayerState | null {
  return null;
}

function current(): PlayerState {
  ensureLoaded();
  return state as PlayerState;
}

export const gameStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot,

  openPack(packType: PackType, now = Date.now()): DrawnCard[] {
    const result = engineOpenPack(current(), packType, now);
    persist(result.state);
    return result.cards;
  },

  /**
   * Mode test : même `drawPack()` que la vraie ouverture (mêmes pondérations,
   * aucun doublon interne, badges NEW calculés sur la vraie collection), mais
   * **sans persistance** — ni booster consommé, ni carte/XP/points crédités.
   * Sert à rejouer la cinématique en boucle (voir `src/lib/test-mode.ts`).
   */
  previewPack(packType: PackType): DrawnCard[] {
    return drawPack(packType, ownedSlugs(current()));
  },

  useHourglass(packType: PackType, now = Date.now()): void {
    persist(engineSpendHourglass(current(), packType, now));
  },

  reset(now = Date.now()): void {
    const target = storage();
    if (target) clearState(target);
    persist(createInitialState(now));
  },

  exportSave(): string {
    return exportSave(current());
  },

  importSave(json: string, now = Date.now()): void {
    persist(importSave(json, now));
  },
};
