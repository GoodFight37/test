import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { haptic, playPackSound } from "@/lib/pack-sound";

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
  return (await import("@/lib/sound-settings")).soundSettings;
}

describe("soundSettings", () => {
  let data: Map<string, string>;

  beforeEach(() => {
    const fake = fakeWindow();
    data = fake.data;
    vi.stubGlobal("window", fake.win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("est activé par défaut (comme Pocket), côté serveur aussi", async () => {
    const store = await freshStore();
    expect(store.getServerSnapshot()).toBe(true);
    expect(store.getSnapshot()).toBe(true);
  });

  it("persiste sous sa propre clé, jamais sous la sauvegarde", async () => {
    const store = await freshStore();
    store.subscribe(() => {});

    store.set(false);
    expect(store.getSnapshot()).toBe(false);
    expect(data.get("creatordeck.sound.v1")).toBe("0");

    store.set(true);
    expect(store.getSnapshot()).toBe(true);
    expect(data.get("creatordeck.sound.v1")).toBe("1");

    // Aucune écriture ailleurs (surtout pas la sauvegarde de jeu).
    expect([...data.keys()]).toEqual(["creatordeck.sound.v1"]);
  });

  it("relit la préférence au nouveau montage", async () => {
    const first = await freshStore();
    first.subscribe(() => {});
    first.set(false);

    const reimported = await freshStore();
    reimported.subscribe(() => {});
    expect(reimported.getSnapshot()).toBe(false);
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
      },
    });
    const store = await freshStore();
    store.subscribe(() => {});
    expect(() => store.set(false)).not.toThrow();
    expect(store.getSnapshot()).toBe(false);
  });
});

describe("pack-sound", () => {
  it("ne plante jamais sans AudioContext (ni sans navigator.vibrate)", () => {
    // Environnement de test : ni Web Audio, ni vibration.
    expect(() => playPackSound("tear")).not.toThrow();
    expect(() => playPackSound("rare")).not.toThrow();
    expect(() => haptic(30)).not.toThrow();
    expect(() => haptic([10, 20, 30])).not.toThrow();
  });
});
