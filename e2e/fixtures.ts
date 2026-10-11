import { expect, type Page } from "@playwright/test";
export { expect, test } from "@playwright/test";

/** Préparer le joueur via les trois étapes réelles, après hydratation. */
export async function gotoDeck(page: Page, tutorial = true): Promise<void> {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Tutoriel CreatorDeck" });
  if (tutorial) {
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continuer", exact: true }).click();
    await dialog.getByRole("button", { name: "Continuer", exact: true }).click();
    await dialog.getByRole("button", { name: "Terminer", exact: true }).click();
  }
  await expect(dialog).toHaveCount(0);
}
