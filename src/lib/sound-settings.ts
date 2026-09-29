/**
 * Son & vibrations de l'ouverture — réglage local, **hors sauvegarde**.
 *
 * Clé `creatordeck.sound.v1` : `"0"` = coupé, tout le reste (ou rien) = activé
 * par défaut, comme dans Pokémon TCG Pocket. `creatordeck.save.v1` et son
 * `SAVE_VERSION` ne sont jamais touchés.
 *
 * Même ossature que `test-mode.ts` : store miniature, effet `subscribe`
 * unique, snapshot stable, `getServerSnapshot()` constant pour le pré-rendu.
 */

const SOUND_KEY = "creatordeck.sound.v1";

type Listener = () => void;

let enabled = true;
let loaded = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    enabled = window.localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    // Stockage indisponible : le son reste activé pour cette session.
    enabled = true;
  }
}

export const soundSettings = {
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
    return true;
  },

  set(value: boolean): void {
    ensureLoaded();
    enabled = value;
    try {
      window.localStorage.setItem(SOUND_KEY, value ? "1" : "0");
    } catch {
      // La valeur reste en mémoire pour la session en cours.
    }
    emit();
  },
};
