import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLOUD_SESSION_KEY, CloudApi, CloudError } from "@/lib/cloud/api";
import type { CloudFetch } from "@/lib/cloud/transport";
import type { KeyValueStorage } from "@/lib/save-store";

const CONFIG = { url: "https://projet.supabase.co", anonKey: "anon-key-de-test-suffisamment-longue" };

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

/**
 * Joue un appel qui doit échouer et rend les deux faces de la panne :
 * ce que le **joueur** lit, et ce que le **journal** garde.
 *
 * C'est le contrat de rédaction de cette passe : à l'écran, une phrase de jeu
 * (« Les échanges ne sont pas encore ouverts ») ; au journal, le détail qui
 * permet à l'exploitant de réparer (« 0005_echanges absente du projet »).
 */
async function panne(run: () => Promise<unknown>): Promise<{ message: string; journal: string }> {
  const vus: string[] = [];
  const espion = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    vus.push(args.map((a) => String(a)).join(" "));
  });
  const silence = process.env.CREATORDECK_SILENCE_JOURNAL;
  delete process.env.CREATORDECK_SILENCE_JOURNAL;
  let message = "";
  try {
    await run();
    message = "(aucune erreur : l'appel a réussi)";
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (silence === undefined) delete process.env.CREATORDECK_SILENCE_JOURNAL;
  else process.env.CREATORDECK_SILENCE_JOURNAL = silence;
  espion.mockRestore();
  return { message, journal: vus.join("\n") };
}

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined, index: number) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>,
) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const target = String(url);
    const result = await handler(target, init as unknown as RequestInit, calls.length);
    calls.push({ url: target, init: init as unknown as RequestInit });
    const status = result.status ?? 200;
    const text = result.body === undefined ? "" : JSON.stringify(result.body);
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as CloudFetch;
  return { impl, calls };
}

const SESSION_BODY = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  expires_in: 3600,
  user: { id: "11111111-1111-4111-8111-111111111111", email: "joueur@exemple.fr" },
};

function client(handler: Parameters<typeof fakeFetch>[0], storage = memoryStorage()) {
  const { impl, calls } = fakeFetch(handler);
  return { api: new CloudApi(CONFIG, storage, impl), calls, storage };
}

describe("authentification par code", () => {
  it("demande un code sans créer de session", async () => {
    const { api, calls, storage } = client(() => ({ body: {} }));
    await api.requestOtp("joueur@exemple.fr");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/otp");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "joueur@exemple.fr", create_user: true });
    expect((calls[0]?.init?.headers as Record<string, string>).apikey).toBe(CONFIG.anonKey);
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(false);
  });

  it("valide le code et mémorise la session", async () => {
    const { api, calls, storage } = client(() => ({ body: SESSION_BODY }));
    const session = await api.verifyOtp("joueur@exemple.fr", " 123456 ");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      email: "joueur@exemple.fr",
      token: "123456",
      type: "email",
    });
    expect(session.email).toBe("joueur@exemple.fr");
    expect(session.userId).toBe(SESSION_BODY.user.id);
    expect(api.session()?.accessToken).toBe("access-1");
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(true);
  });

  it("explique un code refusé sans jargon", async () => {
    const { api } = client(() => ({ status: 401, body: { error_code: "otp_expired", msg: "Token has expired" } }));
    await expect(api.verifyOtp("joueur@exemple.fr", "000000")).rejects.toThrowError(/Code incorrect ou expiré/);
    await expect(api.verifyOtp("joueur@exemple.fr", "000000")).rejects.toBeInstanceOf(CloudError);
  });

  it("signale les tentatives trop nombreuses", async () => {
    const { api } = client(() => ({ status: 429, body: { msg: "Too many requests" } }));
    await expect(api.requestOtp("joueur@exemple.fr")).rejects.toThrowError(/Trop de tentatives/);
  });

  it("oublie une session illisible", () => {
    const storage = memoryStorage();
    storage.setItem(CLOUD_SESSION_KEY, "{pas du json");
    const { api } = client(() => ({ body: {} }), storage);
    expect(api.session()).toBeNull();
  });

  it("efface la session à la déconnexion, même si le réseau tombe", async () => {
    const storage = memoryStorage();
    storage.setItem(CLOUD_SESSION_KEY, JSON.stringify({ ...SESSION_BODY, expiresAt: Date.now() + 3600_000 }));
    const { api } = client(() => {
      throw new Error("réseau coupé");
    }, storage);
    await api.signOut();
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(false);
  });
});

describe("compte invité et profil", () => {
  it("crée un compte sans e-mail et mémorise la session", async () => {
    const { api, calls, storage } = client(() => ({
      body: { ...SESSION_BODY, user: { id: SESSION_BODY.user.id } },
    }));
    const session = await api.signInAnonymously();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/signup");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ data: {}, gotrue_meta_security: {} });
    expect(session.userId).toBe(SESSION_BODY.user.id);
    expect(session.email).toBeNull();
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(true);
  });

  it("dit simplement que le compte invité n'est pas ouvert ici", async () => {
    const { api } = client(() => ({ status: 422, body: { error_code: "anonymous_provider_disabled" } }));
    const { message, journal } = await panne(() => api.signInAnonymously());
    expect(message).toMatch(/n'est pas ouvert ici/);
    expect(journal).toContain("Anonymous");
  });

  it("lit et modifie le nom affiché", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    const { api, calls } = client((url) =>
      url.startsWith("https://projet.supabase.co/rest/v1/profiles?user_id=eq.")
        ? { body: [{ display_name: "Kaicenat", showcase_slugs: ["kaicenat"] }] }
        : { body: null },
      storage,
    );
    const profile = await api.profile(SESSION_BODY.user.id);
    expect(profile).toEqual({ displayName: "Kaicenat", showcaseSlugs: ["kaicenat"] });

    const { api: patching, calls: patchCalls } = client(() => ({ body: null }), storage);
    await patching.updateDisplayName(SESSION_BODY.user.id, "  Mon pseudo  ");
    expect(patchCalls[0]?.init?.method).toBe("PATCH");
    expect(patchCalls[0]?.url).toContain("profiles?user_id=eq.");
    expect(JSON.parse(String(patchCalls[0]?.init?.body))).toMatchObject({ display_name: "Mon pseudo" });
  });
});

describe("jetons", () => {
  it("rafraîchit un jeton expiré avant d'appeler le serveur", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({
        accessToken: "vieux",
        refreshToken: "refresh-1",
        expiresAt: Date.now() - 1000,
        userId: SESSION_BODY.user.id,
        email: "joueur@exemple.fr",
      }),
    );
    const { api, calls } = client((url) =>
      url.includes("grant_type=refresh_token")
        ? { body: { ...SESSION_BODY, access_token: "neuf" } }
        : { body: { status: "pushed", save: { state: {}, save_version: 5, device_updated_at: 7, state_checksum: "x", updated_at: "2026-03-01T10:00:00Z" } } },
      storage,
    );
    const result = await api.pushSave({ cards: [] }, 7, 5);
    expect(result.status).toBe("pushed");
    expect(calls[0]?.url).toContain("grant_type=refresh_token");
    expect((calls[1]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer neuf");
  });

  it("retente une fois après un 401 puis abandonne proprement", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({
        accessToken: "jeton",
        refreshToken: "refresh-1",
        expiresAt: Date.now() + 3600_000,
        userId: SESSION_BODY.user.id,
        email: null,
      }),
    );
    let rpcCalls = 0;
    const { api } = client((url) => {
      if (url.includes("grant_type=refresh_token")) return { body: { ...SESSION_BODY, access_token: "encore-neuf" } };
      rpcCalls += 1;
      return rpcCalls === 1 ? { status: 401, body: { message: "JWT expired" } } : { body: { status: "unchanged", save: { state: {}, save_version: 5, device_updated_at: 7, state_checksum: "x", updated_at: "2026-03-01T10:00:00Z" } } };
    }, storage);
    await expect(api.pushSave({}, 7, 5)).resolves.toMatchObject({ status: "unchanged" });
    expect(rpcCalls).toBe(2);
  });
});

describe("sauvegardes", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("envoie la partie et transmet les bons paramètres", async () => {
    const { api, calls, storage } = client(() => ({
      body: { status: "pushed", save: { state: {}, save_version: 5, device_updated_at: 42, state_checksum: "abc", updated_at: "2026-03-01T10:00:00Z", verified: true } },
    }));
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    // `p_base_updated_at` est la version serveur que le client a reçue : sans
    // elle, le serveur refuse d'écrire par-dessus une partie qu'il n'a pas vue.
    const result = await api.pushSave({ cards: [] }, 42, 5, true, "2026-03-01T09:00:00.000Z");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_state: { cards: [] },
      p_save_version: 5,
      p_device_updated_at: 42,
      p_force: true,
      p_base_updated_at: "2026-03-01T09:00:00.000Z",
    });
    expect(result).toMatchObject({ status: "pushed" });
    if (result.status === "pushed") expect(result.save.deviceUpdatedAt).toBe(42);
  });

  it("remonte un refus du serveur tel quel", async () => {
    const { api, storage } = client(() => ({
      body: { status: "rejected", problems: ["carte sans créateur"] },
    }));
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    await expect(api.pushSave({}, 1, 5)).resolves.toEqual({ status: "rejected", problems: ["carte sans créateur"] });
  });

  it("distingue un conflit d'un succès", async () => {
    const { api, storage } = client(() => ({
      body: { status: "conflict", save: { state: {}, save_version: 5, device_updated_at: 99, state_checksum: "z", updated_at: "2026-03-01T11:00:00Z" } },
    }));
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    const result = await api.pushSave({}, 1, 5);
    expect(result.status).toBe("conflict");
  });

  it("renvoie null quand le compte n'a rien dans le cloud", async () => {
    const { api, storage } = client(() => ({ body: null }));
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    expect(await api.pullSave()).toBeNull();
  });

  it("refuse d'écrire sans session", async () => {
    const { api } = client(() => ({ body: {} }));
    await expect(api.pushSave({}, 1, 5)).rejects.toThrowError(/Connecte-toi/);
  });

  it("ne plante pas sans réseau et le dit en français", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    const { api } = client(() => {
      throw new TypeError("fetch failed");
    }, storage);
    await expect(api.pullSave()).rejects.toThrowError(/Réseau injoignable/);
  });
});

describe("classement", () => {
  /** Session en mémoire, comme le ferait un joueur connecté. */
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("lit les lignes renvoyées par le serveur", async () => {
    const storage = signedIn();
    const { api, calls } = client(() => ({
      body: [
        {
          rank: 1,
          user_id: "u1",
          display_name: "Kaicenat",
          unique_creators: 940,
          total_cards: 5100,
          legendary_cards: 48,
          level: 62,
          points: 12_000,
          showcase_slugs: ["kaicenat"],
        },
      ],
    }), storage);
    const rows = await api.leaderboard(20, "legendary_cards");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_limit: 20, p_metric: "legendary_cards", p_region: null });
    expect(rows[0]).toMatchObject({
      rank: 1,
      displayName: "Kaicenat",
      legendaryCards: 48,
      showcaseSlugs: ["kaicenat"],
      // Champs ajoutés par `0006_profil_public.sql` : une réponse d'une version
      // antérieure du serveur ne doit pas casser l'écran (zéro par défaut).
      epicCards: 0,
      goldCards: 0,
      holoCards: 0,
      completion: 0,
    });
  });

  it("transmet la famille demandée et lit son compteur", async () => {
    const { api, calls } = client(
      () => ({
        body: [
          {
            rank: 1,
            user_id: "u2",
            display_name: "Diane",
            unique_creators: 137,
            total_cards: 402,
            legendary_cards: 9,
            epic_cards: 31,
            gold_cards: 3,
            holo_cards: 12,
            level: 12,
            points: 640,
            completion: 0.137,
            showcase_slugs: [],
            family_owned: 97,
            family_total: 402,
          },
        ],
      }),
      signedIn(),
    );
    const rows = await api.leaderboard(20, "family", "S04");

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_limit: 20,
      p_metric: "family",
      p_region: "S04",
    });
    expect(rows[0]?.familyOwned).toBe(97);
    expect(rows[0]?.familyTotal).toBe(402);
  });

  it("transmet le tri Gold et lit la complétion", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    const { api, calls } = client(() => ({
      body: [
        {
          rank: 1,
          user_id: "u2",
          display_name: "Diane",
          unique_creators: 137,
          total_cards: 402,
          legendary_cards: 9,
          epic_cards: 31,
          gold_cards: 3,
          holo_cards: 12,
          level: 12,
          points: 640,
          // PostgREST renvoie `numeric` en nombre, le pilote local en chaîne :
          // les deux formes doivent être lues.
          completion: "0.1370",
          showcase_slugs: [],
        },
      ],
    }), storage);
    const rows = await api.leaderboard(20, "gold_cards");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_limit: 20, p_metric: "gold_cards", p_region: null });
    expect(rows[0]).toMatchObject({ goldCards: 3, holoCards: 12, epicCards: 31, completion: 0.137 });
  });

  it("tolère une réponse vide ou inattendue", async () => {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    const { api } = client(() => ({ body: { pas: "un tableau" } }), storage);
    expect(await api.leaderboard()).toEqual([]);
  });
});

describe("profil public", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  const PROFILE = {
    user_id: "u2",
    display_name: "Diane",
    level: 12,
    points: 640,
    verified: true,
    unique_creators: 137,
    total_cards: 402,
    legendary_cards: 9,
    epic_cards: 31,
    gold_cards: 3,
    holo_cards: 12,
    catalog_size: 1000,
    completion: 0.137,
    rank_completion: 42,
    rank_cards: 118,
    showcase_slugs: ["kaicenat", "ibai"],
    wishlist_slug: "kamet0",
    by_rarity: {
      common: { owned: 60, total: 300 },
      legendary: { owned: 4, total: 50 },
      rare: { owned: 40, total: 230 },
    },
    by_region: {
      S01: { owned: 10, total: 155 },
      S04: { owned: 100, total: 402 },
      S02: { owned: 0, total: 62 },
    },
  };

  it("lit un profil complet, du plus rare au plus commun", async () => {
    const { api, calls } = client(() => ({ body: PROFILE }), signedIn());
    const profile = await api.playerProfile("u2");

    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/player_profile");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_user_id: "u2" });
    expect(profile).toMatchObject({
      userId: "u2",
      displayName: "Diane",
      completion: 0.137,
      rankCompletion: 42,
      goldCards: 3,
      catalogSize: 1000,
      showcaseSlugs: ["kaicenat", "ibai"],
      wishlistSlug: "kamet0",
    });
    // Les raretés absentes de la réponse ne sont pas inventées, et l'ordre est
    // celui de l'affichage (legendary → common), pas celui du hasard de JSON.
    expect(profile?.byRarity.map((row) => row.rarity)).toEqual(["legendary", "rare", "common"]);
  });

  it("lit la complétion par famille, la plus avancée d'abord", async () => {
    const { api } = client(() => ({ body: PROFILE }), signedIn());
    const profile = await api.playerProfile("u2");

    // L'ordre suit la progression, pas l'ordre des clés JSON ; une famille à
    // zéro est gardée (c'est justement ce qui reste à collectionner).
    expect(profile?.byRegion.map((family) => family.regionId)).toEqual(["S04", "S01", "S02"]);
    expect(profile?.byRegion[0]).toEqual({ regionId: "S04", owned: 100, total: 402 });
  });

  it("se passe d'un serveur qui ne calcule pas encore les familles", async () => {
    // Une migration pas encore recollée : le champ manque, la fiche s'affiche
    // sans la section — elle ne casse pas.
    const { api } = client(() => ({ body: { ...PROFILE, by_region: undefined } }), signedIn());
    expect((await api.playerProfile("u2"))?.byRegion).toEqual([]);
  });

  it("se passe d'un profil qui ne connaît pas encore la wishlist", async () => {
    // `0015_wishlist.sql` pas encore collée : le champ manque, la fiche
    // s'affiche sans la ligne — elle ne casse pas.
    const { api } = client(() => ({ body: { ...PROFILE, wishlist_slug: undefined } }), signedIn());
    expect((await api.playerProfile("u2"))?.wishlistSlug).toBeNull();
  });

  it("lit l'épinglé d'un joueur, et le sien sans identifiant", async () => {
    const { api, calls } = client((url) => ({ body: url.includes("wishlist_slug") ? "kamet0" : null }), signedIn());
    expect(await api.wishlistSlug("u2")).toBe("kamet0");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/wishlist_slug");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_user_id: "u2" });
    await api.wishlistSlug();
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ p_user_id: null });
  });

  it("renvoie null quand personne n'est épinglé", async () => {
    const { api } = client(() => ({ body: null }), signedIn());
    expect(await api.wishlistSlug()).toBeNull();
    const { api: empty } = client(() => ({ body: "" }), signedIn());
    expect(await empty.wishlistSlug()).toBeNull();
  });

  it("épingle un créateur et retient le slug que le serveur a gardé", async () => {
    const { api, calls } = client(() => ({ body: "kamet0" }), signedIn());
    expect(await api.setWishlist("kamet0")).toBe("kamet0");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/set_wishlist");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_slug: "kamet0" });
    // Un serveur qui répond autre chose (slug normalisé) fait foi.
    const { api: other } = client(() => ({ body: "ibai" }), signedIn());
    expect(await other.setWishlist("IBai")).toBe("ibai");
  });

  it("remonte le refus du serveur quand le créateur n'est pas au catalogue", async () => {
    const { api } = client(
      () => ({
        status: 400,
        body: { code: "P0001", message: "wishlist : ce créateur n'est pas au catalogue" },
      }),
      signedIn(),
    );
    await expect(api.setWishlist("inconnu")).rejects.toThrowError(/pas au catalogue/);
  });

  it("retire l'épinglé", async () => {
    const { api, calls } = client(() => ({ body: null }), signedIn());
    await api.clearWishlist();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/clear_wishlist");
  });

  it("dit que la wishlist n'est pas encore ouverte", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: {
          code: "PGRST202",
          message: "Could not find the function public.wishlist_slug(p_user_id) in the schema cache",
        },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.wishlistSlug());
    expect(message).toMatch(/wishlist n'est pas encore ouverte/);
    expect(journal).toContain("0015_wishlist");
  });

  it("dit que les jetons ne sont pas encore ouverts", async () => {
    // `0035` est la dernière arrivée : tant qu'elle n'est pas collée, le solde
    // de jetons et l'achat aux jetons répondent « fonction inconnue ». Le
    // message doit nommer le fichier, comme les autres migrations.
    const { api } = client(
      () => ({
        status: 404,
        body: {
          code: "PGRST202",
          message: "Could not find the function public.tokens_get() in the schema cache",
        },
      }),
      signedIn(),
    );
    const lecture = await panne(() => api.tokensGet());
    expect(lecture.message).toMatch(/jetons ne sont pas encore ouverts/);
    expect(lecture.journal).toContain("0035_jetons");
    const achat = await panne(() => api.tokensSpend("ibai"));
    expect(achat.message).toMatch(/jetons ne sont pas encore ouverts/);
  });

  it("ne demande aucun identifiant pour son propre profil", async () => {
    const { api, calls } = client(() => ({ body: PROFILE }), signedIn());
    await api.playerProfile();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_user_id: null });
  });

  it("renvoie null quand le joueur n'a jamais envoyé sa partie", async () => {
    const { api } = client(() => ({ body: null }), signedIn());
    expect(await api.playerProfile("u3")).toBeNull();
  });

  it("ne montre aucun rang à un joueur non vérifié", async () => {
    const { api } = client(() => ({ body: { ...PROFILE, verified: false, rank_completion: null, rank_cards: null } }), signedIn());
    const profile = await api.playerProfile("u2");
    expect(profile?.verified).toBe(false);
    expect(profile?.rankCompletion).toBeNull();
  });
});

describe("vitrine", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("épingle les cartes par la fonction dédiée", async () => {
    const { api, calls } = client(() => ({ body: ["kaicenat", "ibai"] }), signedIn());
    const saved = await api.setShowcase(["kaicenat", "ibai"]);
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/set_showcase");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_slugs: ["kaicenat", "ibai"] });
    expect(saved).toEqual(["kaicenat", "ibai"]);
  });

  it("remonte le refus du serveur en clair", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "vitrine : carte non possédée (kaicenat)" } }),
      signedIn(),
    );
    await expect(api.setShowcase(["kaicenat"])).rejects.toThrowError(/carte non possédée/);
  });

  it("tolère une réponse inattendue sans casser la vitrine", async () => {
    const { api } = client(() => ({ body: null }), signedIn());
    expect(await api.setShowcase(["kaicenat"])).toEqual([]);
  });
});

describe("tirage serveur", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("ouvre un booster et renvoie les cartes + compteurs", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          packs: 2,
          last_regen_at: "2026-01-01T12:30:00Z",
          openings: 7,
          cards: [
            { creatorSlug: "kaicenat", rarity: "legendary", variant: "live", rareDrop: false },
            { creatorSlug: "ibai", rarity: "epic", variant: "holo", rareDrop: false },
            { creatorSlug: "ninja", rarity: "rare", variant: "standard", rareDrop: false },
            { creatorSlug: "auronplay", rarity: "uncommon", variant: "standard", rareDrop: false },
            { creatorSlug: "rubius", rarity: "common", variant: "standard", rareDrop: false },
          ],
        },
      }),
      signedIn(),
    );
    const result = await api.openPack();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/open_pack");
    expect(result.packs).toBe(2);
    expect(result.openings).toBe(7);
    expect(result.cards).toHaveLength(5);
    expect(result.cards[0]).toMatchObject({ creatorSlug: "kaicenat", rarity: "legendary", variant: "live" });
  });

  it("suit le statut onboarding, distingue le claim du stock restant, puis tire via RPC dédiées", async () => {
    const { api, calls } = client(() => ({ body: { tutorial_completed: true, gift_available: true, gift_claimed: true, gift_remaining: 4, cards: Array.from({ length: 5 }, (_, i) => ({ creatorSlug: ["kaicenat", "ibai", "ninja", "auronplay", "rubius"][i], rarity: "rare", variant: "standard", rareDrop: false })), save: null } }), signedIn());
    await expect(api.onboardingStatus()).resolves.toMatchObject({ tutorialCompleted: true, giftAvailable: true, giftClaimed: true, giftRemaining: 4 });
    await api.completeTutorial();
    await api.claimReturnGift();
    const gift = await api.openReturnGiftPack();
    expect(gift.cards).toHaveLength(5);
    expect(calls.map((call) => call.url.split("/").at(-1))).toEqual(["onboarding_status", "complete_tutorial", "claim_return_gift", "open_return_gift_pack"]);
  });

  it("refuse sans session", async () => {
    const { api } = client(() => ({ body: {} }));
    await expect(api.openPack()).rejects.toThrowError(/Connecte-toi/);
  });

  it("renvoie une erreur lisible si le serveur refuse le tirage", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "tirage : aucun booster disponible pour le moment" } }),
      signedIn(),
    );
    await expect(api.openPack()).rejects.toThrowError(/Aucun booster/);
  });

  it("répare un message du serveur collé depuis la console Windows", async () => {
    // Le cas réel : « paquet scène : ton paquet du jour est déjà ouvert » arrive
    // avec ses accents doublement encodés parce que la migration a été collée
    // par le presse-papiers de PowerShell. L'écran doit afficher du français.
    const { api } = client(
      () => ({
        status: 400,
        body: {
          code: "P0001",
          message:
            "paquet sc\u251c\u00bfne : ton paquet du jour est d\u251c\u00aej\u251c\u00e1 ouvert",
        },
      }),
      signedIn(),
    );
    await expect(api.scenePackChoices("S04")).rejects.toThrowError(
      "paquet scène : ton paquet du jour est déjà ouvert",
    );
  });

  it("lit le statut de la réserve sans rien consommer", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          packs: 3,
          last_regen_at: "2026-01-01T12:00:00Z",
          openings: 5,
          next_pack_at: "2026-01-01T12:30:00Z",
        },
      }),
      signedIn(),
    );
    const status = await api.packStatus();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/pack_status");
    expect(status.packs).toBe(3);
    expect(status.nextPackAt).toBe("2026-01-01T12:30:00Z");
  });

  it("teste la joignabilité du projet en lecture seule", async () => {
    const { api, calls } = client(() => ({ body: { version: "1.0" } }));
    const result = await api.ping();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/health");
    expect((calls[0]?.init?.headers as Record<string, string>).apikey).toBe(CONFIG.anonKey);
    expect(result.host).toBe("projet.supabase.co");
  });

  it("nomme l'hôte injoignable plutôt que d'accuser le réseau à tort", async () => {
    const { api } = client(() => {
      throw new TypeError("fetch failed");
    });
    await expect(api.ping()).rejects.toThrowError(/projet\.supabase\.co\/auth\/v1\/health/);
  });

  it("dit que le tirage en ligne n'est pas encore ouvert", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: {
          code: "PGRST202",
          message: "Could not find the function public.open_pack() in the schema cache",
        },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.openPack());
    expect(message).toMatch(/tirage en ligne n'est pas encore ouvert/);
    expect(journal).toContain("0003_catalogue");
    const statut = await panne(() => api.packStatus());
    expect(statut.message).toMatch(/pas encore ouvert/);
  });

  it("distingue le tirage en cours de mise à jour du tirage absent", async () => {
    // `open_pack` existe, mais pas dans sa version à argument : c'est 0013 qui
    // manque, pas 0003/0004 — le message doit dire la bonne migration.
    const { api } = client(
      () => ({
        status: 404,
        body: {
          code: "PGRST202",
          message:
            "Could not find the function public.open_pack(p_jackpot) in the schema cache",
        },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.openPack());
    expect(message).toMatch(/mise à jour/);
    expect(journal).toContain("0013_progression");
  });

  it("dit que le Paquet Scène n'est pas encore ouvert", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: {
          code: "PGRST202",
          message: "Could not find the function public.scene_pack_choices(p_family) in the schema cache",
        },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.scenePackChoices("S01"));
    expect(message).toMatch(/Paquet Scène n'est pas encore ouvert/);
    expect(journal).toContain("0014_scene_pack");
  });

  it("dit qu'une partie du jeu n'est pas prête, sans montrer l'erreur brute", async () => {
    const { api } = client(
      () => ({ status: 404, body: { code: "42P01", message: 'relation "public.pack_state" does not exist' } }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.openPack());
    expect(message).toMatch(/n'est pas encore prête en ligne/);
    expect(message).not.toContain("relation");
    expect(journal).toContain("public.pack_state");
  });

  it("traduit une coupure réseau en phrase française, avec le nom d'hôte", async () => {
    const { api } = client(() => {
      throw new TypeError("fetch failed");
    }, signedIn());
    await expect(api.openPack()).rejects.toThrowError(/Réseau injoignable/);
    // L'hôte et le chemin sont nommés : un échec réseau se distingue d'une
    // adresse erronée, et on sait quel appel a échoué.
    await expect(api.openPack()).rejects.toThrowError(/projet\.supabase\.co\/rest\/v1\/rpc\/open_pack/);
    await expect(api.packStatus()).rejects.toThrowError(/Réseau injoignable/);
  });

  it("refuse un serveur qui répond autre chose que le tirage attendu", async () => {
    const { api } = client(() => ({ body: { packs: 2, cards: "pas un tableau" } }), signedIn());
    const result = await api.openPack();
    // Un `cards` illisible ne fabrique pas de cartes : liste vide, compteurs lus.
    expect(result.cards).toEqual([]);
    expect(result.packs).toBe(2);
  });

  it("renvoie next_pack_at=null quand la réserve est pleine", async () => {
    const { api } = client(
      () => ({
        body: {
          packs: 4,
          last_regen_at: "2026-01-01T12:00:00Z",
          openings: 10,
          next_pack_at: null,
        },
      }),
      signedIn(),
    );
    const status = await api.packStatus();
    expect(status.packs).toBe(4);
    expect(status.nextPackAt).toBeNull();
  });
});

describe("les points au serveur (wallet)", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("lit le solde du serveur", async () => {
    const { api, calls } = client(() => ({ body: { ok: true, points: 1234 } }), signedIn());
    expect(await api.walletGet()).toBe(1234);
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/wallet_get");
  });

  it("envoie la raison du gain, jamais un montant", async () => {
    const { api, calls } = client(() => ({ body: { ok: true, kind: "recycle", gained: 55, points: 1289 } }), signedIn());
    const gain = await api.walletCredit("recycle", "rare");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/wallet_credit");
    // Le corps ne porte qu'une raison et une référence : si le client pouvait
    // annoncer « +9999 », le serveur le croirait.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_kind: "recycle", p_ref: "rare" });
    expect(gain).toEqual({ delta: 55, points: 1289 });
  });

  it("rapporte un gain de zéro quand l'événement était déjà payé", async () => {
    const { api } = client(() => ({ body: { ok: true, kind: "milestone", gained: 0, points: 1289 } }), signedIn());
    expect((await api.walletCredit("milestone", "ten")).delta).toBe(0);
  });

  it("paie une dépense et lit ce qui a bougé", async () => {
    const { api, calls } = client(() => ({ body: { ok: true, kind: "craft", spent: 600, points: 689 } }), signedIn());
    const spend = await api.walletSpend("craft", "kaicenat");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_kind: "craft", p_ref: "kaicenat" });
    expect(spend).toEqual({ delta: -600, points: 689 });
  });

  it("relaie tel quel le refus du serveur", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "solde : il te manque des points pour ce mouvement" } }),
      signedIn(),
    );
    await expect(api.walletSpend("craft", "kaicenat")).rejects.toThrowError(/il te manque des points/);
  });

  it("n'invente pas un solde quand la réponse est illisible", async () => {
    const { api } = client(() => ({ body: {} }), signedIn());
    await expect(api.walletGet()).rejects.toThrowError(/illisible/);
  });
});

describe("la chaîne (le simulateur de streameur)", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("lit l'état de la chaîne", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          ok: true,
          subscribers: 2640,
          per_day: 900,
          day: "2026-10-08",
          published_today: false,
          tokens_today: 6,
          tokens_cap: 40,
        },
      }),
      signedIn(),
    );
    const etat = await api.streamerStatus();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_status");
    // Les champs de `0038` sont optionnels côté serveur : une base qui ne les
    // envoie pas encore (ou un serveur plus ancien) donne des valeurs neutres
    // plutôt qu'une erreur — l'écran de la chaîne s'ouvre quand même.
    expect(etat).toEqual({
      subscribers: 2640,
      perDay: 900,
      day: "2026-10-08",
      publishedToday: false,
      chosenToday: false,
      tokensToday: 6,
      tokensCap: 40,
      setup: [],
      setupBonus: 0,
      // `0039` : une base qui ne l'a pas encore répond `undefined` — le bureau
      // est alors vide, comme le carnet du setup juste au-dessus.
      guests: [],
      raidToday: 0,
      raidDay: "",
      // `0041` : le plateau. Même règle que les deux blocs du dessus — une base
      // d'avant rend des valeurs neutres plutôt qu'une erreur.
      collabPermille: 0,
      collabBuzzPermille: 0,
      collabLive: false,
    });
  });

  it("lit le plateau du moment quand le serveur le connaît (0041)", async () => {
    const { api } = client(
      () => ({
        body: {
          ok: true,
          subscribers: 2640,
          per_day: 900,
          day: "2026-10-08",
          collab_permille: 270,
          collab_buzz_permille: 250,
          collab_live: true,
        },
      }),
      signedIn(),
    );
    const etat = await api.streamerStatus();
    // Rareté **et** direct : c'est ce total-là que la vidéo paiera.
    expect(etat.collabPermille).toBe(270);
    expect(etat.collabBuzzPermille).toBe(250);
    expect(etat.collabLive).toBe(true);
  });

  it("rend le résumé du retour, journées comptées comprises", async () => {
    const { api, calls } = client(
      () => ({
        body: { ok: true, days: 30, counted_days: 7, gained: 1680, subscribers_before: 2500, subscribers: 4180, per_day: 240 },
      }),
      signedIn(),
    );
    const retour = await api.streamerVisit();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_visit");
    // Trente journées d'absence, sept payées : c'est le serveur qui tranche, et
    // c'est ce chiffre-là que l'écran résume.
    expect(retour.days).toBe(30);
    expect(retour.countedDays).toBe(7);
    expect(retour.gained).toBe(1680);
    expect(retour.before).toBe(2500);
    expect(retour.subscribers).toBe(4180);
  });

  it("n'envoie qu'un nom de format, jamais un résultat", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          ok: true,
          already: false,
          format: "ragebait",
          success: true,
          buzz: false,
          bad_buzz: false,
          collab: 270,
          raid: true,
          gained: 1920,
          tokens: 6,
          subscribers: 4560,
          tokens_today: 6,
          tokens_cap: 40,
        },
      }),
      signedIn(),
    );
    const video = await api.streamerPublish("ragebait");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_publish");
    // Si le client pouvait annoncer « réussite » ou un gain, le joueur
    // s'offrirait une Légende… un buzz à volonté.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_format: "ragebait" });
    // `0041` : la vidéo revient avec le plateau qu'elle a payé, et le raid.
    expect(video.collab).toBe(270);
    expect(video.raid).toBe(true);
    expect(video.success).toBe(true);
    expect(video.gained).toBe(1920);
  });

  it("rend le bureau et le raid, tels que le serveur les écrit", async () => {
    // `0039` : l'état porte le bureau, et le relevé porte le raid de la
    // journée — avec `already` pour ne pas confondre « payé à l'instant » et
    // « payé plus tôt aujourd'hui ».
    const { api } = client(
      () => ({
        body: {
          ok: true,
          subscribers: 3000,
          per_day: 900,
          day: "2026-10-08",
          published_today: false,
          chosen_today: false,
          tokens_today: 0,
          tokens_cap: 40,
          setup: [],
          setup_bonus: 0,
          guests: [
            { slot: 2, card_id: "carte-b", creator_slug: "kamet0", rarity: "legendary", variant: "gold" },
            { slot: 1, card_id: "carte-a", creator_slug: "ibai", rarity: "uncommon", variant: "holo" },
            { slot: 3, card_id: "", creator_slug: "", rarity: "inconnue", variant: "standard" },
          ],
          raid_today: 42,
          raid_day: "2026-10-08",
        },
      }),
      signedIn(),
    );
    const etat = await api.streamerStatus();
    // Le bureau est **rangé** par place, et une ligne illisible est écartée
    // plutôt que de casser l'écran (une base d'une autre époque).
    expect(etat.guests).toEqual([
      { slot: 1, cardId: "carte-a", slug: "ibai", rarity: "uncommon", variant: "holo" },
      { slot: 2, cardId: "carte-b", slug: "kamet0", rarity: "legendary", variant: "gold" },
    ]);
    expect(etat.raidToday).toBe(42);
    expect(etat.raidDay).toBe("2026-10-08");
  });

  it("pose un invité avec sa carte, et ne décide de rien d'autre", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          ok: true,
          changed: true,
          guests: [{ slot: 1, card_id: "carte-a", creator_slug: "ibai", rarity: "uncommon", variant: "standard" }],
        },
      }),
      signedIn(),
    );
    const bureau = await api.streamerGuestSet(1, {
      id: "carte-a",
      creatorSlug: "ibai",
      rarity: "uncommon",
      variant: "standard",
    });
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_guest_set");
    // Le client envoie la carte **telle qu'elle est** : ni prix, ni part du
    // raid, ni « en direct » — le serveur relit tout ça lui-même.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_slot: 1,
      p_card: { id: "carte-a", creatorSlug: "ibai", rarity: "uncommon", variant: "standard" },
    });
    expect(bureau.changed).toBe(true);
    expect(bureau.guests).toHaveLength(1);

    // Retirer un invité : une carte nulle, et le serveur libère la place.
    const { api: api2, calls: calls2 } = client(() => ({ body: { ok: true, changed: true, guests: [] } }), signedIn());
    await api2.streamerGuestSet(2, null);
    expect(JSON.parse(String(calls2[0]?.init?.body))).toEqual({ p_slot: 2, p_card: null });
  });

  it("relit la vidéo du jour sans la rejouer", async () => {
    const { api } = client(
      () => ({
        body: { ok: true, already: true, format: "letsplay", success: true, buzz: false, bad_buzz: false, gained: 240, tokens: 6, subscribers: 2640, tokens_today: 6, tokens_cap: 40 },
      }),
      signedIn(),
    );
    const video = await api.streamerPublish("letsplay");
    expect(video.already).toBe(true);
    expect(video.tokens).toBe(6);
  });

  it("relaie le refus du serveur (collab sans créateur)", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "chaîne : une collab demande de posséder au moins un créateur" } }),
      signedIn(),
    );
    await expect(api.streamerPublish("collab")).rejects.toThrowError(/posséder au moins un créateur/);
  });

  it("dit que le Studio n'est pas encore ouvert", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: { code: "PGRST202", message: "Could not find the function public.streamer_status() in the schema cache" },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.streamerStatus());
    expect(message).toMatch(/Studio n'est pas encore ouvert/);
    expect(journal).toContain("0036_streamer");
  });

  it("n'invente pas un état quand la réponse est illisible", async () => {
    const { api } = client(() => ({ body: {} }), signedIn());
    await expect(api.streamerVisit()).rejects.toThrowError(/illisible/);
  });

  it("lit la carte du jour, et n'envoie que le côté choisi", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          ok: true,
          day: "2026-10-08",
          event: "raid",
          chosen: false,
          choice: "",
          success: false,
          buzz: false,
          bad_buzz: false,
          gained: 0,
        },
      }),
      signedIn(),
    );
    const carte = await api.streamerEventToday();
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_event_today");
    expect(carte.event).toBe("raid");
    expect(carte.chosen).toBe(false);

    await api.streamerChoose("raid", "gauche");
    expect(calls[1]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_choose");
    // Le client dit **quel côté**, jamais l'issue : la réussite, le buzz et le
    // bad buzz se tirent côté serveur, comme pour une vidéo.
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ p_event: "raid", p_choice: "gauche" });
  });

  it("relaie la lecture d'un imprévu déjà joué", async () => {
    const { api } = client(
      () => ({
        body: { ok: true, day: "2026-10-08", event: "nuit", chosen: true, choice: "droite", success: false, buzz: false, bad_buzz: true, gained: -120 },
      }),
      signedIn(),
    );
    const carte = await api.streamerEventToday();
    expect(carte.chosen).toBe(true);
    expect(carte.choice).toBe("droite");
    expect(carte.badBuzz).toBe(true);
  });

  it("paie un palier de setup par son nom, jamais par son prix", async () => {
    const { api, calls } = client(
      () => ({ body: { ok: true, already: false, level: "micro", price: 320, setup: ["webcam", "micro"], setup_bonus: 80, points: 5025 } }),
      signedIn(),
    );
    const achat = await api.streamerSetupBuy("micro");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_setup_buy");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_level: "micro" });
    expect(achat.price).toBe(320);
    expect(achat.setupBonus).toBe(80);
  });

  it("sacrifie des doublons par leurs identifiants, jamais par leur prix", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          ok: true,
          level: "webcam2",
          price: 2,
          value: 2,
          cards: ["dbl-ra-1", "dbl-rb-1"],
          setup: ["webcam", "micro", "lumiere", "deco", "studio", "webcam2"],
          setup_bonus: 600,
        },
      }),
      signedIn(),
    );
    const sacrifice = await api.streamerSetupSacrifice(["dbl-ra-1", "dbl-rb-1"]);
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/streamer_setup_sacrifice");
    // Le corps ne porte **que** la liste : ni rareté, ni valeur, ni prix.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_cards: ["dbl-ra-1", "dbl-rb-1"],
    });
    // Et le verdict dit quelles cartes sont vraiment parties.
    expect(sacrifice.cards).toEqual(["dbl-ra-1", "dbl-rb-1"]);
    expect(sacrifice.value).toBe(2);
    expect(sacrifice.setupBonus).toBe(600);
  });

  it("relaie le refus d'un palier acheté dans le désordre", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "chaîne : il faut d'abord « micro »" } }),
      signedIn(),
    );
    await expect(api.streamerSetupBuy("deco")).rejects.toThrowError(/il faut d'abord/);
  });
});

describe("codes promo", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("envoie le code au serveur et lit la réserve qu'il a écrite", async () => {
    const { api, calls } = client(
      () => ({ body: { ok: true, packs: 1, reserve: 4, note: "stream du 7 octobre" } }),
      signedIn(),
    );
    const result = await api.redeemPromoCode("booster-2026");
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/redeem_promo_code");
    // Le code part tel quel : c'est le serveur qui normalise (majuscules, sans
    // espaces) — un contrôle dans l'application serait un contrôle qu'on peut
    // s'accorder.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_code: "booster-2026" });
    expect(result).toEqual({ granted: 1, reserve: 4, note: "stream du 7 octobre" });
  });

  it("affiche le refus du serveur tel quel", async () => {
    const { api } = client(
      () => ({
        status: 400,
        body: {
          code: "P0001",
          message: "code promo : ta réserve est pleine (4 boosters sur 4) : ouvre un booster, puis retape ce code",
        },
      }),
      signedIn(),
    );
    // La phrase du serveur dit déjà quoi faire : elle ne doit pas être
    // remplacée par un « une erreur est survenue ».
    await expect(api.redeemPromoCode("BOOSTER-2026")).rejects.toThrowError(
      "code promo : ta réserve est pleine (4 boosters sur 4) : ouvre un booster, puis retape ce code",
    );
  });

  it("n'invente pas de booster quand la réponse est illisible", async () => {
    const { api } = client(() => ({ body: {} }), signedIn());
    await expect(api.redeemPromoCode("BOOSTER-2026")).rejects.toThrowError(/illisible/);
  });
});

describe("échanges", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  const TRADE = {
    id: 7,
    status: "open",
    proposerId: SESSION_BODY.user.id,
    recipientId: "22222222-2222-4222-8222-222222222222",
    proposerCards: [{ creatorSlug: "ibai", rarity: "legendary", variant: "holo" }],
    recipientCards: [{ creatorSlug: "kaicenat", rarity: "legendary", variant: "gold" }],
    createdAt: "2026-03-01T10:00:00Z",
    resolvedAt: null,
  };

  it("propose un échange en envoyant les cartes sans rareté inventée", async () => {
    const { api, calls } = client(
      () => ({ body: { trade: TRADE, recipientMissing: null } }),
      signedIn(),
    );
    const result = await api.createTrade(
      TRADE.recipientId,
      [{ creatorSlug: "ibai", variant: "holo" }],
      [{ creatorSlug: "kaicenat", variant: "gold" }],
    );

    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/create_trade");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      p_recipient: TRADE.recipientId,
      p_given: [{ creatorSlug: "ibai", variant: "holo" }],
      p_wanted: [{ creatorSlug: "kaicenat", variant: "gold" }],
    });
    expect(result.trade.proposerCards[0]).toEqual({ creatorSlug: "ibai", rarity: "legendary", variant: "holo" });
    expect(result.trade.status).toBe("open");
    expect(result.recipientMissing).toBeNull();
  });

  it("signale la carte que le destinataire ne possède pas", async () => {
    const { api } = client(
      () => ({ body: { trade: TRADE, recipientMissing: { creatorSlug: "kaicenat", rarity: "legendary", variant: "gold" } } }),
      signedIn(),
    );
    const result = await api.createTrade(TRADE.recipientId, [{ creatorSlug: "ibai", variant: "holo" }], [{ creatorSlug: "kaicenat", variant: "gold" }]);
    expect(result.recipientMissing?.creatorSlug).toBe("kaicenat");
  });

  it("accepte un échange et lit ce qui est donné et reçu", async () => {
    const { api, calls } = client(
      () => ({
        body: {
          status: "accepted",
          trade: { ...TRADE, status: "accepted", resolvedAt: "2026-03-01T10:06:00Z" },
          given: TRADE.recipientCards,
          received: TRADE.proposerCards,
        },
      }),
      signedIn(),
    );
    const result = await api.respondTrade(7, true);

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_trade: 7, p_accept: true });
    expect(result.status).toBe("accepted");
    expect(result.given[0]?.creatorSlug).toBe("kaicenat");
    expect(result.received[0]?.creatorSlug).toBe("ibai");
  });

  it("refuse une offre sans toucher aux cartes", async () => {
    const { api, calls } = client(
      () => ({ body: { status: "declined", trade: { ...TRADE, status: "declined" }, given: [], received: [] } }),
      signedIn(),
    );
    const result = await api.respondTrade(7, false);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_trade: 7, p_accept: false });
    expect(result.status).toBe("declined");
    expect(result.given).toEqual([]);
  });

  it("annule une offre en attente", async () => {
    const { api, calls } = client(
      () => ({ body: { ...TRADE, status: "cancelled", resolvedAt: "2026-03-01T10:07:00Z" } }),
      signedIn(),
    );
    const trade = await api.cancelTrade(7);
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/cancel_trade");
    expect(trade.status).toBe("cancelled");
  });

  it("lit la liste des offres, sens compris", async () => {
    const { api } = client(
      () => ({
        body: [
          {
            id: 9,
            direction: "in",
            status: "open",
            partnerId: TRADE.recipientId,
            partnerName: "Bruno",
            given: TRADE.recipientCards,
            received: TRADE.proposerCards,
            createdAt: "2026-03-01T10:00:00Z",
            resolvedAt: null,
          },
          { id: "bizarre" },
        ],
      }),
      signedIn(),
    );
    const list = await api.listTrades();
    expect(list).toHaveLength(1);
    expect(list[0]?.direction).toBe("in");
    expect(list[0]?.partnerName).toBe("Bruno");
    expect(list[0]?.given[0]?.variant).toBe("gold");
  });

  it("cherche un partenaire et lit les variantes qu'il possède", async () => {
    const search = client(
      () => ({ body: [{ userId: TRADE.recipientId, displayName: "Bruno", level: 4, uniqueCreators: 120 }] }),
      signedIn(),
    );
    const players = await search.api.searchPlayers("Brun");
    expect(search.calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/search_players");
    expect(JSON.parse(String(search.calls[0]?.init?.body))).toEqual({ p_query: "Brun" });
    expect(players[0]).toEqual({ userId: TRADE.recipientId, displayName: "Bruno", level: 4, uniqueCreators: 120 });

    const variants = client(() => ({ body: ["standard", "holo"] }), signedIn());
    expect(await variants.api.playerVariants(TRADE.recipientId, "ibai")).toEqual(["standard", "holo"]);
    expect(JSON.parse(String(variants.calls[0]?.init?.body))).toEqual({
      p_user: TRADE.recipientId,
      p_slug: "ibai",
    });
  });

  it("dit au joueur que les échanges ne sont pas encore ouverts, sans nommer de fichier", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: { code: "PGRST202", message: "Could not find the function public.create_trade" },
      }),
      signedIn(),
    );
    // Le détail (« 0005_echanges ») part au journal : à l'écran, une phrase.
    const { message, journal } = await panne(() => api.createTrade(TRADE.recipientId, [], []));
    expect(message).toMatch(/pas encore ouverts/);
    expect(message).not.toContain("0005");
    expect(journal).toContain("0005_echanges");
  });

  it("garde le message du serveur quand il dit déjà quoi faire", async () => {
    const { api } = client(
      () => ({ status: 400, body: { code: "P0001", message: "echange : connecte-toi pour proposer un échange" } }),
      signedIn(),
    );
    await expect(api.createTrade(TRADE.recipientId, [], [])).rejects.toThrow(/connecte-toi pour proposer un échange/);
  });

  it("refuse d'échanger sans session", async () => {
    const { api } = client(() => ({ body: {} }));
    await expect(api.listTrades()).rejects.toThrow(/Connecte-toi/);
  });
});

describe("amis", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  const JOUEUR = "22222222-2222-4222-8222-222222222222";

  it("lit la liste d'amis telle que le serveur la renvoie", async () => {
    const { api, calls } = client(
      () => ({
        body: [
          { id: 11, friendId: JOUEUR, friendName: "Kameto", createdAt: "2026-10-01T10:00:00Z" },
          { id: 12, friendId: "33333333-3333-4333-8333-333333333333", friendName: "Ibai", createdAt: "2026-10-02T10:00:00Z" },
        ],
      }),
      signedIn(),
    );
    const friends = await api.listFriends();
    expect(friends).toEqual([
      { id: 11, friendId: JOUEUR, friendName: "Kameto", createdAt: "2026-10-01T10:00:00Z" },
      { id: 12, friendId: "33333333-3333-4333-8333-333333333333", friendName: "Ibai", createdAt: "2026-10-02T10:00:00Z" },
    ]);
    expect(calls[0]?.url).toBe("https://projet.supabase.co/rest/v1/rpc/list_friends");
  });

  it("ignore une ligne illisible au lieu de perdre toute la liste", async () => {
    const { api } = client(
      () => ({ body: [{ id: 11, friendId: JOUEUR, friendName: "Kameto", createdAt: "" }, { id: 12, friendName: "Sans identifiant" }] }),
      signedIn(),
    );
    const friends = await api.listFriends();
    expect(friends.map((friend) => friend.friendName)).toEqual(["Kameto"]);
  });

  it("distingue une demande envoyée d'une demande croisée", async () => {
    const { api } = client(
      () => ({ body: { request: { id: 5, status: "pending" }, alreadyFriends: false, existingRequest: null } }),
      signedIn(),
    );
    expect(await api.sendFriendRequest(JOUEUR)).toEqual({ sent: true, existing: false, alreadyFriends: false });

    const croise = client(
      () => ({ body: { request: null, alreadyFriends: false, existingRequest: { id: 4, senderId: JOUEUR } } }),
      signedIn(),
    );
    expect(await croise.api.sendFriendRequest(JOUEUR)).toEqual({ sent: false, existing: true, alreadyFriends: false });

    const dejaAmis = client(
      () => ({ body: { request: null, alreadyFriends: true, existingRequest: null } }),
      signedIn(),
    );
    expect(await dejaAmis.api.sendFriendRequest(JOUEUR)).toEqual({ sent: false, existing: false, alreadyFriends: true });
  });

  it("accepte une demande sur le statut que le serveur a écrit, pas sur un objet absent", async () => {
    // Le serveur ne renvoie pas toujours la ligne `friends` (insertion sans
    // conflit) : ce qui compte, c'est que la demande soit passée à « accepted ».
    const { api } = client(
      () => ({ body: { request: { id: 5, status: "accepted" }, friendship: null } }),
      signedIn(),
    );
    expect(await api.acceptFriendRequest(5)).toBe(true);

    const rate = client(() => ({ body: { request: null, friendship: null } }), signedIn());
    expect(await rate.api.acceptFriendRequest(5)).toBe(false);
  });

  it("dit que les amis ne sont pas encore ouverts, sans nommer de fichier", async () => {
    const { api } = client(
      () => ({
        status: 404,
        body: { code: "PGRST202", message: "Could not find the function public.send_friend_request" },
      }),
      signedIn(),
    );
    const { message, journal } = await panne(() => api.sendFriendRequest(JOUEUR));
    expect(message).toMatch(/amis ne sont pas encore ouverts/);
    expect(journal).toContain("0008_friends");
  });
});

describe("compte : adresse et mot de passe", () => {
  function signedIn(email: string | null = null) {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, email, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("attache une adresse et un mot de passe au compte invité", async () => {
    const storage = signedIn(null);
    const { api, calls } = client(() => ({ body: { id: SESSION_BODY.user.id, email: "joueur@exemple.fr" } }), storage);

    const result = await api.updateAccount({ email: " joueur@exemple.fr ", password: "azerty1234" });

    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/user");
    expect(calls[0]?.init?.method).toBe("PUT");
    // Le mot de passe part avec l'adresse : un seul appel, aucune confirmation.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "joueur@exemple.fr", password: "azerty1234" });
    expect(result).toEqual({ applied: true, pendingEmail: null, email: "joueur@exemple.fr" });
    // La session enregistrée connaît la nouvelle adresse (l'écran Compte l'affiche).
    expect(api.session()?.email).toBe("joueur@exemple.fr");
  });

  it("comprend qu'une confirmation par e-mail est en attente", async () => {
    const storage = signedIn(null);
    const { api } = client(() => ({ body: { id: SESSION_BODY.user.id, new_email: "joueur@exemple.fr" } }), storage);

    const result = await api.updateAccount({ email: "joueur@exemple.fr", password: "azerty1234" });

    expect(result.applied).toBe(false);
    expect(result.pendingEmail).toBe("joueur@exemple.fr");
    // Rien n'est appliqué : la session reste sans adresse.
    expect(api.session()?.email).toBeNull();
  });

  it("change le mot de passe seul quand l'adresse est déjà là", async () => {
    const { api, calls } = client(() => ({ body: { id: SESSION_BODY.user.id, email: "joueur@exemple.fr" } }), signedIn("joueur@exemple.fr"));
    const result = await api.updateAccount({ password: "azerty1234" });

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ password: "azerty1234" });
    expect(result.applied).toBe(true);
    expect(result.email).toBe("joueur@exemple.fr");
  });

  it("refuse d'écrire sans session et sans rien à changer", async () => {
    const { api } = client(() => ({ body: {} }));
    await expect(api.updateAccount({ password: "azerty1234" })).rejects.toThrow(/Connecte-toi/);

    const idem = client(() => ({ body: {} }), signedIn(null));
    await expect(idem.api.updateAccount({})).rejects.toThrow(/Rien à enregistrer/);
  });

  it("se connecte par adresse et mot de passe", async () => {
    const { api, calls, storage } = client(() => ({ body: SESSION_BODY }));
    const session = await api.signInWithPassword(" joueur@exemple.fr ", "azerty1234");

    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/token?grant_type=password");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ email: "joueur@exemple.fr", password: "azerty1234" });
    expect(session.userId).toBe(SESSION_BODY.user.id);
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(true);
  });

  it("traduit les refus de connexion en français", async () => {
    const wrong = client(() => ({ status: 400, body: { error_code: "invalid_grant", msg: "Invalid login credentials" } }));
    await expect(wrong.api.signInWithPassword("joueur@exemple.fr", "oublie")).rejects.toThrow(
      /E-mail ou mot de passe incorrect/,
    );

    const unconfirmed = client(() => ({ status: 400, body: { error_code: "email_not_confirmed" } }));
    await expect(unconfirmed.api.signInWithPassword("joueur@exemple.fr", "azerty1234")).rejects.toThrow(
      /pas encore confirmée/,
    );
  });

  it("ne laisse pas le joueur devant « adresse refusée » quand un invité veut attacher son adresse", async () => {
    // GoTrue valide une adresse vide pour un compte anonyme quand « Confirm
    // email » est actif (supabase/auth#2847) : le joueur lit une issue
    // praticable (« choisis un mot de passe »), l'exploitant retrouve le
    // réglage dans le journal.
    const { api } = client(
      () => ({ status: 400, body: { error_code: "email_address_invalid", msg: 'Email address "" is invalid' } }),
      signedIn(null),
    );
    const { message, journal } = await panne(() =>
      api.updateAccount({ email: "joueur@exemple.fr", password: "azerty1234" }),
    );
    expect(message).toMatch(/mot de passe/);
    expect(message).not.toContain("Confirm email");
    expect(journal).toContain("Confirm email");
  });

  it("dit qu'une adresse appartient déjà à un autre compte", async () => {
    const { api } = client(
      () => ({ status: 422, body: { error_code: "email_exists", msg: "A user with this email address has already been registered" } }),
      signedIn(null),
    );
    await expect(api.updateAccount({ email: "pris@exemple.fr", password: "azerty1234" })).rejects.toThrow(/déjà utilisée/);
  });
});

describe("hôtel des ventes", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  const LISTING = {
    id: 12,
    creatorSlug: "ibai",
    rarity: "legendary",
    variant: "gold",
    price: 3000,
    payout: 2000,
    createdAt: "2026-10-06T18:00:00Z",
    sellerName: "Diane",
  };

  it("lit le comptoir, sans les annonces illisibles", async () => {
    const { api, calls } = client(() => ({ body: [LISTING, { rarity: "rare" }] }), signedIn());
    const shelf = await api.marketShelf(20);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/market_shelf");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_limit: 20 });
    expect(shelf).toHaveLength(1);
    expect(shelf[0]).toMatchObject({
      id: 12,
      creatorSlug: "ibai",
      rarity: "legendary",
      variant: "gold",
      price: 3000,
      payout: 2000,
      sellerName: "Diane",
    });
  });

  it("dépose une carte et lit le payout payé par le serveur", async () => {
    const { api, calls } = client(() => ({ body: { listing: LISTING, payout: 2000, price: 3000, points: 2450 } }), signedIn());
    const result = await api.marketSell("carte-1");
    expect(calls[0]?.url).toContain("/rest/v1/rpc/market_sell");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_card_id: "carte-1" });
    expect(result.payout).toBe(2000);
    expect(result.points).toBe(2450);
    expect(result.listing.id).toBe(12);
  });

  it("refuse une réponse de dépôt sans annonce", async () => {
    const { api } = client(() => ({ body: { payout: 2000 } }), signedIn());
    await expect(api.marketSell("carte-1")).rejects.toThrow("illisible");
  });

  it("achète une carte et garde la marque de l'annonce", async () => {
    const { api, calls } = client(() => ({
      body: {
        card: {
          id: "neuve",
          creatorSlug: "ibai",
          rarity: "legendary",
          variant: "gold",
          obtainedAt: 1_760_000_000_000,
          rareDrop: false,
          fromMarket: 12,
        },
        price: 3000,
        points: 2000,
      },
    }), signedIn());
    const result = await api.marketBuy(12);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/market_buy");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_listing: 12 });
    expect(result.card.fromMarket).toBe(12);
    expect(result.price).toBe(3000);
    expect(result.points).toBe(2000);
  });

  it("refuse une carte achetée sans marque d'annonce", async () => {
    // Sans `fromMarket`, l'appareil ne peut pas reconnaître la carte s'il
    // rejoue l'achat : mieux vaut refuser que risquer un doublon.
    const { api } = client(() => ({
      body: { card: { id: "neuve", creatorSlug: "ibai", rarity: "rare", variant: "standard" }, price: 30, points: 0 },
    }), signedIn());
    await expect(api.marketBuy(12)).rejects.toThrow("illisible");
  });

  it("lit la vitrine d'un joueur", async () => {
    const { api, calls } = client(() => ({ body: [LISTING] }), signedIn());
    const listings = await api.marketListingsOf("u2");
    expect(calls[0]?.url).toContain("/rest/v1/rpc/market_listings_of");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_user: "u2" });
    expect(listings[0]?.price).toBe(3000);
  });

  it("sans identifiant, la vitrine demande la sienne", async () => {
    const { api, calls } = client(() => ({ body: [] }), signedIn());
    await api.marketListingsOf();
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_user: null });
  });

  it("lit les ventes récentes du carnet", async () => {
    const { api, calls } = client(() => ({ body: [
      { id: 7, creatorSlug: "ibai", price: 600, soldAt: "2026-10-06T18:00:00Z", buyerName: "Diane" },
      { id: "pas un identifiant" },
    ] }), signedIn());
    const sales = await api.marketSales(20);
    expect(calls[0]?.url).toContain("/rest/v1/rpc/market_sales");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ p_limit: 20 });
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ id: 7, creatorSlug: "ibai", price: 600, buyerName: "Diane" });
  });

  it("rend une liste vide si le serveur répond autre chose qu'une liste", async () => {
    const { api } = client(() => ({ body: { message: "non" } }), signedIn());
    expect(await api.marketShelf()).toEqual([]);
  });
});

describe("connexion Twitch", () => {
  function signedIn() {
    const storage = memoryStorage();
    storage.setItem(
      CLOUD_SESSION_KEY,
      JSON.stringify({ ...SESSION_BODY, accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, userId: SESSION_BODY.user.id }),
    );
    return storage;
  }

  it("construit l'adresse Supabase du dialogue Twitch", () => {
    const { api } = client(() => ({ body: {} }));
    const url = new URL(api.twitchAuthorizeUrl("com.creatordeck.app://auth"));
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("twitch");
    expect(url.searchParams.get("redirect_to")).toBe("com.creatordeck.app://auth");
  });

  it("installe la session à partir des jetons, en demandant d'abord qui est l'utilisateur", async () => {
    const storage = memoryStorage();
    const { api, calls } = client(() => ({ body: { id: "u-twitch", email: "joueur@exemple.fr" } }), storage);
    const session = await api.adoptSession({ accessToken: "jeton", refreshToken: "renouvellement", expiresIn: 3600 });

    expect(calls[0]?.url).toBe("https://projet.supabase.co/auth/v1/user");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer jeton");
    expect(session.userId).toBe("u-twitch");
    expect(session.email).toBe("joueur@exemple.fr");
    // La session est enregistrée : l'appareil est connecté, comme après un code.
    expect(api.session()?.userId).toBe("u-twitch");
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(true);
  });

  it("n'enregistre rien si le serveur ne rend pas d'utilisateur", async () => {
    const storage = memoryStorage();
    const { api } = client(() => ({ status: 401, body: { message: "invalid token" } }), storage);
    await expect(api.adoptSession({ accessToken: "jeton", refreshToken: "r", expiresIn: 60 })).rejects.toThrow("Twitch");
    expect(storage.data.has(CLOUD_SESSION_KEY)).toBe(false);
  });
});
