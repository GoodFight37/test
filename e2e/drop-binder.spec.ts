import { expect, test, gotoDeck } from "./fixtures";
import creatorData from "../src/data/creators.json";

test("le Drop garde l’ouverture à portée et mène au Binder", async ({ page }) => {
  await gotoDeck(page);
  await expect(page.getByRole("heading", { name: "Un sachet. Cinq créateurs." })).toBeVisible();
  const open = page.getByRole("button", { name: "Ouvrir le booster", exact: true });
  await expect(open).toBeEnabled();
  await expect(open).toBeInViewport();
  const details = page.locator(".drop-pack-details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details.getByRole("button", { name: /Utiliser 1 sablier/ })).toBeVisible();
  await page.getByRole("button", { name: "Mon Binder", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Mon classeur" })).toBeVisible();
  await page.getByRole("button", { name: "Retour au Drop", exact: true }).click();
  await expect(open).toBeEnabled();
});

test("les pages à compléter montrent leurs manquantes ; les dernières reçues retrouvent les obtenues", async ({ page }) => {
  await gotoDeck(page);
  const creators = creatorData.filter((creator) => creator.region === "S01").slice(0, 3);
  await page.evaluate((cards) => {
    const key = Object.keys(localStorage).find((entry) => /^creatordeck.save.v\d+$/.test(entry));
    if (!key) throw new Error("La sauvegarde de départ doit exister.");
    const state = JSON.parse(localStorage.getItem(key)!);
    state.cards = cards.map((creator, index) => ({ id: `fixture-${index}`, creatorSlug: creator.slug, rarity: creator.rarity,
      variant: "standard", obtainedAt: Date.now() - (2 - index) * 1000, rareDrop: false }));
    state.updatedAt = Date.now();
    localStorage.setItem(key, JSON.stringify(state));
  }, creators);
  await page.reload();
  await page.locator(".mini-card-row .creator-card").first().click();
  const finding = page.getByRole("dialog", { name: /^Carte de / });
  await expect(finding).toBeVisible();
  await expect(finding).toBeInViewport();
  await expect(page.locator(".app-shell")).toHaveJSProperty("inert", true);
  await finding.locator(".odds-head").getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveJSProperty("inert", false);
  await expect(page.locator(".mini-card-row .creator-card").first()).toBeFocused();
  await page.getByRole("button", { name: "Binder", exact: true }).click();
  const goals = page.getByRole("region", { name: "Pages à compléter" });
  await expect(goals).toBeVisible();
  await goals.getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "À découvrir", exact: true })).toHaveAttribute("aria-pressed", "true");
  const cards = page.locator(".collection-grid .creator-card");
  await expect(cards).toHaveCount(12);
  const labels = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
  expect(labels.every((label) => label?.includes("non obtenue"))).toBe(true);
  for (const creator of creators) expect(labels.some((label) => label?.startsWith(`${creator.displayName},`))).toBe(false);
  await page.getByRole("button", { name: "Dernières reçues" }).click();
  await expect(page.locator(".binder-active-page")).toHaveCount(0);
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute("aria-label", new RegExp(`^${creators[2].displayName},`));
});

test("Drop et Binder restent contenus à 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await gotoDeck(page);
  for (const name of ["Drop", "Binder"] as const) {
    if (name === "Drop") await expect(page.getByRole("button", { name: "Ouvrir le booster", exact: true })).toBeInViewport();
    if (name === "Binder") await page.getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeInViewport();
  }
});
