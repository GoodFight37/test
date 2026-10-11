import { type Page } from "@playwright/test";
import { expect, test, gotoDeck } from "./fixtures";

/**
 * Ce que ces tests vérifient, et rien d'autre :
 *
 *   * la barre du bas montre **quatre piliers**, dans l'ordre ;
 *   * chaque onglet s'ouvre et se marque comme actif (`aria-current="page"`) ;
 *   * « Toi » propose bien d'ouvrir son compte ;
 *   * la simulation de streameur (« Ta chaîne ») n'est **nulle part** : ni
 *     onglet, ni ligne d'accueil, ni écran (retirée le 8 octobre 2026) ;
 *   * rien ne casse côté navigateur : **aucune erreur console**, aucune
 *     exception, sur un tour complet des quatre piliers.
 *
 * Ce qui n'est pas testé ici : tout ce qui demande un compte connecté. Les
 * tests tournent sans `.env.local`, donc sans cloud — c'est voulu, ils doivent
 * marcher sur n'importe quelle machine qui clone le dépôt.
 */

/** Les quatre piliers, dans l'ordre de la barre. */
const TABS = ["Drop", "Binder", "Craft", "Toi"] as const;

/** La barre du bas (`aria-label="Navigation principale"`). */
function bar(page: Page) {
  return page.getByRole("navigation", { name: "Navigation principale" });
}

/** Le bouton d'un onglet. */
function tab(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

/**
 * Ouvre le jeu et attend qu'il soit prêt.
 *
 * On attend un élément, jamais « le réseau au repos » (`networkidle`) : l'app
 * a des minuteurs (l'horloge du direct, la recharge des boosters) et le réseau
 * n'est donc jamais silencieux pour de bon.
 */
async function openDeck(page: Page): Promise<void> {
  await gotoDeck(page);
  await expect(tab(page, "Drop")).toBeVisible({ timeout: 30_000 });
}

test("la barre du bas montre les quatre piliers, dans l'ordre", async ({ page }) => {
  await openDeck(page);
  await expect(bar(page).getByRole("button")).toHaveCount(TABS.length);
  for (const label of TABS) {
    await expect(tab(page, label)).toBeVisible();
  }
});

test("la simulation de streameur n'est plus nulle part", async ({ page }) => {
  await openDeck(page);
  // Ni ligne d'accueil, ni onglet, ni écran : elle a été retirée le 8 octobre
  // 2026. C'est une absence qu'on vérifie, pas une présence.
  await expect(page.getByText(/abonnés/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Ta chaîne" })).toHaveCount(0);
  await expect(tab(page, "Studio")).toHaveCount(0);
});

test("chaque onglet s'ouvre et se marque comme actif", async ({ page }) => {
  await openDeck(page);
  // On part de l'accueil : « Drop » est actif, les autres non.
  await expect(tab(page, "Drop")).toHaveAttribute("aria-current", "page");

  for (const label of TABS.slice(1)) {
    await tab(page, label).click();
    await expect(tab(page, label)).toHaveAttribute("aria-current", "page");
    for (const other of TABS) {
      if (other !== label) await expect(tab(page, other)).not.toHaveAttribute("aria-current", "page");
    }
  }

  // Et l'on revient à l'accueil.
  await tab(page, "Drop").click();
  await expect(tab(page, "Drop")).toHaveAttribute("aria-current", "page");
});

test("« Toi » propose d'ouvrir son compte", async ({ page }) => {
  await openDeck(page);
  await tab(page, "Toi").click();
  await expect(tab(page, "Toi")).toHaveAttribute("aria-current", "page");
  // Une seule ligne, un seul nom : « Mon compte ». L'écran ne s'appelle plus
  // par le nom de l'infrastructure qu'il range.
  const account = page.getByRole("button", { name: "Mon compte", exact: true });
  await expect(account.first()).toBeVisible();
});

test("la barre du bas reste utilisable sur un écran de téléphone", async ({ page }) => {
  await openDeck(page);
  const nav = bar(page);
  await expect(nav).toBeVisible();
  // Chaque onglet est cliquable — donc ni recouvert, ni hors de l'écran.
  for (const label of TABS) {
    await expect(tab(page, label)).toBeEnabled();
    await expect(tab(page, label)).toBeInViewport();
  }
  await tab(page, "Binder").click();
  await expect(tab(page, "Binder")).toHaveAttribute("aria-current", "page");
  await tab(page, "Drop").click();
  await expect(tab(page, "Drop")).toHaveAttribute("aria-current", "page");
});

test("aucune erreur console pendant un tour complet des onglets", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`exception : ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console : ${message.text()}`);
  });
  // Une requête ratée dit **laquelle** : sans cette ligne, un échec afficherait
  // « Failed to load resource » sans dire si c'est le jeu, le cloud ou le
  // réseau de la machine. (La favicon est ignorée : on ne la compte pas.)
  page.on("requestfailed", (request) => {
    if (request.url().includes("favicon")) return;
    const failure = request.failure()?.errorText ?? "échec";
    problems.push(`réseau : ${request.url()} — ${failure}`);
  });

  await openDeck(page);
  for (const label of ["Binder", "Craft", "Toi", "Drop"] as const) {
    await tab(page, label).click();
    await expect(tab(page, label)).toHaveAttribute("aria-current", "page");
  }
  // Une dernière seconde au cas où une erreur arriverait après le dernier clic.
  await page.waitForTimeout(1_000);

  expect(problems).toEqual([]);
});
