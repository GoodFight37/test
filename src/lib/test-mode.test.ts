import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_KEY } from "@/lib/save-store";

/**
 * Le mode test vit DANS une clé de stockage séparée : il ne doit jamais
 * altérer `creatordeck.save.v1`, ni changer son format.
 */
function fakeWindow() {
  const data = new Map<string, string>();
  return {
    data,
    win: {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  };
}

async function freshStore() {
  vi.resetModules();
  return (await import("@/lib/test-mode")).testModeStore;
}

describe("testModeStore", () => {
  let data: Map<string, string>;

  beforeEach(() => {
    const fake = fakeWindow();
    data = fake.data;
    vi.stubGlobal("window", fake.win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("est éteint par défaut, y compris côté serveur", async () => {
    const store = await freshStore();
    expect(store.getServerSnapshot()).toBe(false);
    expect(store.getSnapshot()).toBe(false);
  });

  it("persiste sous sa propre clé, jamais sous la sauvegarde", async () => {
    data.set(SAVE_KEY, '{"version":1,"sentinelel":"ne-pas-toucher"}');
    const store = await freshStore();
    store.subscribe(() => {});

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(true);
    expect(store.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalled();
    expect(data.get("creatordeck.testmode.v1")).toBe("1");
    // La sauvegarde est strictement identique.
    expect(data.get(SAVE_KEY)).toBe('{"version":1,"sentinelel":"ne-pas-toucher"}');

    store.set(false);
    expect(store.getSnapshot()).toBe(false);
    expect(data.has("creatordeck.testmode.v1")).toBe(false);
    expect(data.get(SAVE_KEY)).toBe('{"version":1,"sentinelel":"ne-pas-toucher"}');
    unsubscribe();
  });

  it("revient à l'état persisté au nouveau montage", async () => {
    const store = await freshStore();
    store.subscribe(() => {});
    store.set(true);

    const reimported = await freshStore(); // `vi.resetModules` = nouvelle vie
    reimported.subscribe(() => {});
    expect(reimported.getSnapshot()).toBe(true);
  });

  it("ne lève pas d'erreur si le stockage est indisponible", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("bloqué");
        },
        setItem: () => {
          throw new Error("bloqué");
        },
        removeItem: () => {
          throw new Error("bloqué");
        },
      },
    });
    const store = await freshStore();
    store.subscribe(() => {});
    expect(() => store.set(true)).not.toThrow();
    expect(store.getSnapshot()).toBe(true);
  });
});
