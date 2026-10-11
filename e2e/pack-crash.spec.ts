import { type Page } from "@playwright/test";
import { expect, test, gotoDeck } from "./fixtures";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Le contrat « un tirage ne se perd pas ».
 *
 * Le 7 octobre, le serveur tirait les cinq cartes mais ne les rangeait nulle
 * part : c'est le client qui renvoyait sa collection juste après, et si le
 * téléphone plantait entre les deux — ou si un second appareil poussait sa
 * version d'avant — les cartes disparaissaient sans trace. `0022` corrige ça
 * côté serveur ; ces deux tests vérifient ce que le joueur voit, c'est-à-dire
 * les cinq mêmes cartes après un rechargement de la page (le « crash » le plus
 * simple à provoquer).
 *
 *   1. **Sans cloud** (le cas de n'importe quel clone du dépôt) : le tirage
 *      local doit survivre au rechargement.
 *   2. **Avec un cloud configuré** (`.env.local`, donc le poste du joueur) : le
 *      tirage vient d'un serveur simulé, et le client ne doit **plus** renvoyer
 *      sa collection derrière — l'état du serveur est la vérité. C'est le
 *      garde-fou du prompt : « plus de `push(..., true)` après un tirage ».
 */

const SAVE_KEY_PREFIX = "creatordeck.save.v";
const SESSION_KEY = "creatordeck.cloud.session";

/** Le `.env.local` du joueur, s'il existe : sans lui, pas de cloud à tester. */
function cloudUrl(): string | null {
  for (const file of [".env.local", ".env"]) {
    try {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      const match = content.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*"?([^"\n]+)"?/m);
      if (match?.[1]) return match[1].trim();
    } catch {
      // Pas de fichier : on essaie le suivant.
    }
  }
  return null;
}

/** Ouvre le jeu et attend que le bouton d'ouverture soit là. */
async function openDeck(page: Page, tutorial = true): Promise<void> {
  await gotoDeck(page, tutorial);
  await expect(page.getByRole("button", { name: /Ouvrir le booster|Se connecter pour ouvrir|Recharge en cours/ })).toBeVisible({
    timeout: 30_000,
  });
}

/** La partie telle que l'appareil l'a écrite. */
async function savedCards(page: Page): Promise<Array<{ id: string; creatorSlug: string }>> {
  return page.evaluate((prefix) => {
    // Ne pas figer ici la version d'une sauvegarde : la clé courante suit
    // SAVE_VERSION dans le moteur (actuellement v9). Une ancienne clé v8 est
    // une clé de migration, pas la sauvegarde que le jeu vient d'écrire.
    const keys = Object.keys(window.localStorage)
      .filter((key) => {
        if (!key.startsWith(prefix)) return false;
        return /^\d+$/.test(key.slice(prefix.length));
      })
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    const key = keys[0];
    // L'état initial peut ne pas encore avoir été écrit avant le premier geste.
    // Le test vérifie plus bas qu'un tirage, lui, est bien persisté.
    if (!key) return [];
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const state = JSON.parse(raw) as { cards?: Array<{ id: string; creatorSlug: string }> };
    return (state.cards ?? []).map((card) => ({ id: card.id, creatorSlug: card.creatorSlug }));
  }, SAVE_KEY_PREFIX);
}

test("sans cloud : le tirage local survit à un rechargement", async ({ page }) => {
  await openDeck(page);
  const open = page.getByRole("button", { name: "Ouvrir le booster" });
  if (!(await open.isVisible())) {
    test.skip(true, "Ce build a un cloud configuré : c'est le second test qui s'applique.");
  }
  const avant = await savedCards(page);
  await open.click();
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  await expect(page.getByRole("dialog", { name: "Résultat du booster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Fermer" }).click();
  const apresTirage = await savedCards(page);
  const sauvegardes = await page.evaluate((prefix) =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(prefix))
      .map((key) => {
        try {
          const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as { cards?: unknown[] };
          return { key, cards: value?.cards?.length ?? null };
        } catch {
          return { key, cards: "JSON illisible" };
        }
      }),
    SAVE_KEY_PREFIX,
  );
  expect(
    apresTirage.length,
    `La collection doit être persistée après le tirage. Avant=${avant.length}, après=${apresTirage.length}, clés=${JSON.stringify(sauvegardes)}`,
  ).toBeGreaterThan(avant.length);

  // Le « crash » : la page est rechargée, rien d'autre.
  await page.reload();
  await expect(page.getByRole("button", { name: /Ouvrir le booster|Recharge en cours/ })).toBeVisible({ timeout: 30_000 });
  expect(await savedCards(page)).toEqual(apresTirage);
});

test("avec le serveur : les cartes du tirage sont celles du serveur, et rien n'est renvoyé", async ({ page }) => {
  const url = cloudUrl();
  test.skip(!url, "Pas de `.env.local` : ce test demande un projet Supabase configuré.");

  // Cinq cartes qui n'existent que « côté serveur » : identifiants fixes, donc
  // reconnaissables si le client fabriquait les siennes.
  const drawn = [
    { creatorSlug: "kaicenat", rarity: "legendary", variant: "live" },
    { creatorSlug: "ibai", rarity: "epic", variant: "holo" },
    { creatorSlug: "ninja", rarity: "rare", variant: "standard" },
    { creatorSlug: "auronplay", rarity: "uncommon", variant: "standard" },
    { creatorSlug: "rubius", rarity: "common", variant: "standard" },
  ].map((card, index) => ({
    ...card,
    id: `5e2f0000-0000-4000-8000-00000000000${index}`,
    obtainedAt: 1_770_000_000_000,
    rareDrop: false,
  }));

  const pushes: string[] = [];
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const call = route.request().url().split("/rpc/")[1] ?? "";
    let body: { p_state?: unknown } | null = null;
    try {
      body = route.request().postDataJSON() as { p_state?: unknown };
    } catch {
      body = null;
    }
    const answer = (value: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });

    if (call === "onboarding_status") {
      return answer({ tutorial_completed: true, gift_available: false, gift_claimed: false, gift_remaining: 0, message: "" });
    }
    if (call.startsWith("open_pack")) {
      return answer({
        packs: 2,
        last_regen_at: new Date().toISOString(),
        openings: 4,
        cards: drawn.map((card) => ({
          creatorSlug: card.creatorSlug,
          rarity: card.rarity,
          variant: card.variant,
          rareDrop: false,
        })),
        // La ligne que `0022` écrit dans la même transaction : cinq cartes,
        // des identifiants nés du serveur, un horodatage serveur.
        save: {
          state: {
            version: 8,
            playerId: "11111111-1111-4111-8111-111111111111",
            createdAt: 1_760_000_000_000,
            updatedAt: 1_770_000_000_000,
            level: 3,
            xp: 120,
            points: 45,
            hourglasses: 0,
            packs: 2,
            lastPackRegen: 1_770_000_000_000,
            openings: 4,
            cards: drawn,
            claimedTiers: [],
            themeId: "default",
          },
          save_version: 8,
          device_updated_at: 1_770_000_000_000,
          state_checksum: "abc",
          updated_at: "2026-03-01T10:00:05Z",
          verified: true,
        },
      });
    }
    if (call.startsWith("push_save")) {
      // Le prompt est précis : après un tirage, le client ne pousse **plus**
      // rien. On note l'appel (et son `p_force`) pour le reprocher au test.
      pushes.push(JSON.stringify(body?.p_state ?? null).slice(0, 40));
      return answer({
        status: "conflict",
        save: {
          state: {
            version: 8,
            playerId: "11111111-1111-4111-8111-111111111111",
            createdAt: 1_760_000_000_000,
            updatedAt: 1_770_000_000_000,
            level: 3,
            xp: 120,
            points: 45,
            hourglasses: 0,
            packs: 2,
            lastPackRegen: 1_770_000_000_000,
            openings: 4,
            cards: drawn,
            claimedTiers: [],
            themeId: "default",
          },
          save_version: 8,
          device_updated_at: 1_770_000_000_000,
          state_checksum: "abc",
          updated_at: "2026-03-01T10:00:05Z",
          verified: true,
        },
      });
    }
    if (call.startsWith("pack_status")) {
      return answer({ packs: 3, last_regen_at: new Date().toISOString(), openings: 3, pity: 0, streak: 1, scene_day: null });
    }
    return answer({});
  });

  // Une session déjà là : l'app n'a plus qu'à tirer.
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      SESSION_KEY,
      JSON.stringify({
        accessToken: "jeton-de-test",
        refreshToken: "rafraichissement-de-test",
        expiresAt: Date.now() + 3_600_000,
        userId: "11111111-1111-4111-8111-111111111111",
        email: null,
      }),
    ] as const,
  );

  await openDeck(page, false);
  await expect(page.getByRole("dialog", { name: "Tutoriel CreatorDeck" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ouvrir le booster" }).click();
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  await expect(page.getByRole("dialog", { name: "Résultat du booster" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Fermer" }).click();

  // Les cinq cartes présentes sont **celles du serveur**, identifiants compris.
  const apresTirage = await savedCards(page);
  expect(apresTirage.map((card) => card.id)).toEqual(drawn.map((card) => card.id));
  expect(pushes).toEqual([]);

  // Et le « crash » ne change rien : le rechargement relit le même état.
  await page.reload();
  await expect(page.getByRole("button", { name: /Ouvrir le booster|Recharge en cours/ })).toBeVisible({ timeout: 30_000 });
  expect(await savedCards(page)).toEqual(apresTirage);
  expect(pushes).toEqual([]);
});
