import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACKS } from "@/lib/catalog";
import { SAVE_KEY } from "@/lib/save-store";

/**
 * Le store est un singleton de module : chaque test le ré-importe à neuf
 * (`vi.resetModules`) au-dessus d'un `window` factice doté d'un localStorage
 * en mémoire.
 */
function fakeWindow() {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  const win = {
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { win, data };
}

async function freshStore() {
  vi.resetModules();
  return (await import("@/lib/game-store")).gameStore;
}

describe("gameStore", () => {
  let data: Map<string, string>;

  beforeEach(() => {
    const fake = fakeWindow();
    data = fake.data;
    vi.stubGlobal("window", fake.win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previewPack tire sans jamais toucher à la sauvegarde (mode test)", async () => {
    const store = await freshStore();
    store.subscribe(() => {});

    const before = store.getSnapshot();
    const savedBefore = data.get(SAVE_KEY);
    expect(before).not.toBeNull();

    const cards = store.previewPack("live");

    // Le tirage est réel (bonne taille, ids uniques)…
    expect(cards).toHaveLength(PACKS.live.size);
    expect(new Set(cards.map((card) => card.id)).size).toBe(PACKS.live.size);

    // …mais rien n'a bougé : même référence d'état, aucune écriture stockée.
    expect(store.getSnapshot()).toBe(before);
    expect(data.get(SAVE_KEY)).toBe(savedBefore);
  });

  it("previewPack calcule les nouveautés sur la vraie collection", async () => {
    const store = await freshStore();
    store.subscribe(() => {});

    // Toute carte appartenant déjà à la collection n'est pas signalée NEW.
    const first = store.previewPack("archive");
    const owned = new Set(store.getSnapshot()!.cards.map((card) => card.creatorSlug));
    for (const card of first) {
      if (owned.has(card.creatorSlug)) expect(card.isNew).toBe(false);
    }
    expect(first.some((card) => card.isNew)).toBe(true); // collection vide au départ
  });

  it("ne lit rien avant le premier abonnement, puis crée et persiste une partie", async () => {
    const store = await freshStore();
    expect(store.getSnapshot()).toBeNull();
    expect(store.getServerSnapshot()).toBeNull();

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const state = store.getSnapshot();
    expect(state).not.toBeNull();
    expect(state?.livePacks).toBe(2);
    expect(data.has(SAVE_KEY)).toBe(true);
    unsubscribe();
  });

  it("recharge une sauvegarde existante", async () => {
    const first = await freshStore();
    first.subscribe(() => {});
    const cards = first.openPack("live", Date.now());
    expect(cards).toHaveLength(PACKS.live.size);
    const persisted = first.getSnapshot();

    const second = await freshStore();
    second.subscribe(() => {});
    expect(second.getSnapshot()).toEqual(persisted);
    expect(second.getSnapshot()?.cards).toHaveLength(PACKS.live.size);
  });

  it("notifie les abonnés à chaque mutation et persiste", async () => {
    const store = await freshStore();
    const listener = vi.fn();
    store.subscribe(listener);
    listener.mockClear();

    store.openPack("archive");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(data.get(SAVE_KEY) ?? "{}").openings).toBe(1);

    store.useHourglass("archive");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(data.get(SAVE_KEY) ?? "{}").hourglasses).toBe(11);
  });

  it("propage les erreurs du moteur sans corrompre l'état", async () => {
    const store = await freshStore();
    store.subscribe(() => {});
    store.openPack("archive");
    const before = store.getSnapshot();
    expect(() => store.openPack("archive")).toThrowError(/booster/i);
    expect(store.getSnapshot()).toBe(before);
  });

  it("réinitialise et importe une sauvegarde", async () => {
    const store = await freshStore();
    store.subscribe(() => {});
    store.openPack("live");
    const exported = store.exportSave();
    const playerId = store.getSnapshot()?.playerId;

    store.reset();
    expect(store.getSnapshot()?.cards).toHaveLength(0);
    expect(store.getSnapshot()?.playerId).not.toBe(playerId);

    store.importSave(exported);
    expect(store.getSnapshot()?.playerId).toBe(playerId);
    expect(store.getSnapshot()?.cards).toHaveLength(PACKS.live.size);
    expect(() => store.importSave("nope")).toThrowError(/JSON/);
  });
});
