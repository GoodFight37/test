import { expect, test, gotoDeck } from "./fixtures";

test("closing a consumed Scene pack returns focus to its section heading", async ({ page }) => {
  await gotoDeck(page);
  const open = page.locator(".scene-action");
  await expect(open).toBeEnabled();
  await open.focus();
  await open.click();
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  await reveal.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(open).toBeDisabled();
  await expect(page.locator(".scene-head h2")).toBeFocused();
  await expect(page.locator(".app-shell")).toHaveJSProperty("inert", false);
});

test("the revealed card keeps the extracted card's size and center in a full-screen scene", async ({ page }) => {
  await gotoDeck(page);
  await page.getByRole("button", { name: "Ouvrir le booster" }).click();
  const pack = page.getByRole("dialog", { name: "Ouvrir le booster" });
  await pack.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const extracted = await pack.locator(".foil-card-chamber").evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished));
    const bounds = node.getBoundingClientRect();
    return { width: bounds.width, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  });
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveJSProperty("inert", true);
  await expect(reveal).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reveal.locator(".reveal-next")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(reveal.locator(".reveal-header button").first()).toBeFocused();
  const anchor = reveal.locator(".reveal-anchor");
  if (await anchor.count()) {
    const bounds = await anchor.boundingBox();
    expect(Math.abs(bounds!.width - extracted.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - extracted.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds!.y + bounds!.height / 2 - extracted.y)).toBeLessThanOrEqual(1);
  } else {
    await expect(reveal.locator(".reveal-perfect-grid .reveal-card")).toHaveCount(5);
  }
  for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 915 }, { width: 1920, height: 915 }]) {
    await page.setViewportSize(viewport);
    const panel = await reveal.boundingBox();
    expect(panel!.x).toBe(0);
    expect(panel!.width).toBe(viewport.width);
    expect(panel!.height).toBe(viewport.height);
    const action = await reveal.locator(".reveal-next").boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(viewport.height);
    if (await anchor.count()) {
      const card = await anchor.boundingBox();
      const name = await reveal.locator(".reveal-name").boundingBox();
      expect(Math.abs(card!.x + card!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
      expect(card!.y + card!.height).toBeLessThan(name!.y);
      expect(name!.y + name!.height).toBeLessThan(action!.y);
    }
  }
  await expect(reveal.getByRole("button", { name: "Fermer", exact: true })).toBeEnabled();
  await reveal.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveJSProperty("inert", false);
  await expect(page.getByRole("button", { name: "Ouvrir le booster", exact: true })).toBeFocused();
});

test("reduced motion reveals a stationary front without a hidden card", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoDeck(page);
  await page.getByRole("button", { name: "Ouvrir le booster", exact: true }).click();
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  await expect(reveal.locator(".reveal-card").first()).toBeVisible();
  const motion = await reveal.locator(".reveal-flip-face").first().evaluate((node) => ({
    animation: getComputedStyle(node).animationName,
    transform: getComputedStyle(node).transform,
  }));
  expect(motion).toEqual({ animation: "none", transform: "none" });
});

test("home pack artwork, title and gesture hint do not overlap", async ({ page }) => {
  await gotoDeck(page);
  await expect(page.getByRole("button", { name: "Ouvrir le booster" })).toBeVisible();
  for (const width of [320, 360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    const artwork = await page.locator(".pack-stage .pack-artwork").boundingBox();
    const copy = await page.locator(".pack-stage .pack-copy").boundingBox();
    const hint = await page.locator(".pack-stage .pull-hint").boundingBox();
    expect(artwork).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(artwork!.y + artwork!.height, `illustration au-dessus du titre à ${width}px`).toBeLessThanOrEqual(copy!.y);
    expect(copy!.y + copy!.height, `consigne sous la description à ${width}px`).toBeLessThanOrEqual(hint!.y);
    expect(hint!.x).toBeGreaterThanOrEqual(0);
    expect(hint!.x + hint!.width).toBeLessThanOrEqual(width);
  }
});

/** Pack is a single printed image, finger tears its weld, and cards emerge before the reveal. */
test("home pack and opening use the same printed sachet, no WebGL or slider", async ({ page }) => {
  await gotoDeck(page);
  const open = page.getByRole("button", { name: "Ouvrir le booster" });
  await expect(open).toBeVisible({ timeout: 30_000 });
  const homeArt = page.locator(".pack-stage .pack-foil-image");
  await expect(homeArt).toBeVisible();
  await expect(homeArt).toHaveAttribute("src", "/packs/live-foil.svg");
  await expect(page.locator(".pack-stage .pack-3d-side")).toHaveCount(3);
  await expect(page.locator(".pack-stage .pack-specular")).toBeAttached();
  expect(await page.locator(".pack-stage .pack-specular").evaluate((node) => getComputedStyle(node).animationName))
    .toBe("pack-specular-pass");
  await expect(page.locator(".pack-stage .pack-people")).toHaveCount(0);
  await open.click();

  const dialog = page.getByRole("dialog", { name: "Ouvrir le booster" });
  await expect(dialog).toBeVisible();
  expect(await dialog.locator(".booster-physical-scene").evaluate((node) =>
    getComputedStyle(node, "::after").animationName,
  )).toBe("opening-foil-specular");
  const panel = await dialog.boundingBox();
  expect(panel).not.toBeNull();
  expect(Math.abs(panel?.y ?? Infinity)).toBeLessThanOrEqual(1);
  expect(panel?.height).toBeGreaterThan(500);
  await expect(page.locator(".opening-loader")).toHaveCount(0);
  await expect(dialog.locator(".foil-printed-art")).toHaveCount(2);
  await expect(dialog.locator('.foil-printed-art[src="/packs/live-foil.svg"]')).toHaveCount(2);
  await expect(dialog.locator("canvas")).toHaveCount(0);
  await expect(dialog.locator(".booster-tear-handle")).toHaveCount(0);
  await expect(dialog.locator(".booster-premium-gesture")).toHaveCount(0);
  await expect(dialog.locator(".foil-back-card")).toHaveCount(5);
  const cut = dialog.getByRole("button", { name: "Déchirer le sachet en passant le doigt sur sa soudure" });
  await expect(cut).toBeVisible();
  await page.screenshot({ path: "test-results/booster-" + test.info().project.name + "-sealed.png" });
  await page.waitForTimeout(2600);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Résultat du booster" })).not.toBeVisible();

  await cut.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".booster-foil-open")).toBeVisible();
  await expect(dialog.locator(".foil-top-piece")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Résultat du booster" }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".booster-interactive")).toHaveCount(0);
});

test("reduced motion and the card-reflection switch stop the heavy pack and foil effects", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoDeck(page);
  const homeSpecular = page.locator(".pack-specular");
  await expect(homeSpecular).toBeAttached();
  expect(await homeSpecular.evaluate((node) => getComputedStyle(node).display)).toBe("none");

  await page.getByRole("button", { name: "Ouvrir le sachet Live Drop" }).click();
  const openingPack = page.locator(".booster-physical-scene");
  const reducedSeam = page.getByRole("button", { name: /D.chirer le sachet en passant le doigt/ });
  const reducedBounds = (await reducedSeam.boundingBox())!;
  await page.mouse.move(reducedBounds.x + reducedBounds.width * .15, reducedBounds.y + reducedBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(reducedBounds.x + reducedBounds.width * .45, reducedBounds.y + reducedBounds.height / 2);
  expect(await openingPack.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--opening-tilt-y")))
    .toBe("");
  await page.mouse.up();
  expect(await openingPack.evaluate((node) => getComputedStyle(node, "::after").display)).toBe("none");
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  expect(await reveal.locator(".card-foil").first().evaluate((node) => getComputedStyle(node).display))
    .toBe("none");
  await reveal.getByRole("button", { name: "Fermer", exact: true }).click();

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { document.documentElement.dataset.cardFx = "off"; });
  expect(await homeSpecular.evaluate((node) => getComputedStyle(node).display)).toBe("none");
  await page.getByRole("button", { name: "Ouvrir le sachet Live Drop" }).click();
  const offPack = page.locator(".booster-physical-scene");
  const offSeam = page.getByRole("button", { name: /D.chirer le sachet en passant le doigt/ });
  const offBounds = (await offSeam.boundingBox())!;
  await page.mouse.move(offBounds.x + offBounds.width * .15, offBounds.y + offBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(offBounds.x + offBounds.width * .45, offBounds.y + offBounds.height / 2);
  expect(await offPack.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--opening-tilt-y")))
    .toBe("");
  await page.mouse.up();
  expect(await page.locator(".booster-physical-scene").evaluate((node) => getComputedStyle(node, "::after").display))
    .toBe("none");
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  await expect(page.getByRole("dialog", { name: "Résultat du booster" })).toBeVisible();
  expect(await page.locator(".reveal-game .card-foil").first().evaluate((node) => getComputedStyle(node).display))
    .toBe("none");
});

test("finger cuts the plastic where it passes, top peels, backs rise, then reveal", async ({ page }) => {
  await gotoDeck(page);
  await page.getByRole("button", { name: "Ouvrir le booster" }).click();
  const dialog = page.getByRole("dialog", { name: "Ouvrir le booster" });
  await expect(dialog).toBeVisible();
  const zone = dialog.getByRole("button", { name: "Déchirer le sachet en passant le doigt sur sa soudure" });
  const bounds = await zone.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const x = bounds.x + Math.max(16, bounds.width * .08);
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 8 });
  const slit = dialog.locator(".foil-cut-slit");
  await expect.poll(async () => (await slit.boundingBox())?.width ?? 0).toBeGreaterThan(10);
  await page.screenshot({ path: "test-results/booster-" + test.info().project.name + "-swiping.png" });
  await page.mouse.move(x + 167, y, { steps: 8 });
  await page.mouse.up();
  await expect(dialog.locator(".booster-foil-open")).toBeVisible();
  expect(await dialog.locator(".foil-top-piece").evaluate((node) => getComputedStyle(node).animationName))
    .toBe("scene-cap-fold");
  expect(await dialog.locator(".foil-body-piece").evaluate((node) => getComputedStyle(node).animationName))
    .toBe("scene-body-fold");
  const cascade = await dialog.locator(".foil-back-card").last().evaluate((node) => {
    const style = getComputedStyle(node);
    return { duration: style.animationDuration, delay: style.animationDelay };
  });
  const milliseconds = (value: string) => parseFloat(value) * (value.endsWith("ms") ? 1 : 1_000);
  expect(milliseconds(cascade.duration)).toBeCloseTo(700, 0);
  expect(milliseconds(cascade.duration) + milliseconds(cascade.delay)).toBeLessThanOrEqual(1_000);

  // The cut reveals a chamber of card backs; no hard cut while cap is still aloft.
  await page.waitForTimeout(1100);
  await expect(dialog.locator(".foil-card-chamber")).toBeVisible();
  await expect(dialog.locator(".foil-back-card")).toHaveCount(5);
  await expect(page.getByRole("dialog", { name: "Résultat du booster" })).not.toBeVisible();
  await page.screenshot({ path: "test-results/booster-" + test.info().project.name + "-opening.png" });
  await expect(page.getByRole("dialog", { name: "Résultat du booster" }))
    .toBeVisible({ timeout: 15_000 });
  await expect(dialog).toHaveCount(0);
});

test("DIVERRON portrait never resolves to the damaged green webp", async ({ page }) => {
  await gotoDeck(page);
  const url = await page.evaluate(async () => {
    const response = await fetch("/creators/diverron-fallback.svg");
    return { status: response.status, body: await response.text() };
  });
  expect(url.status).toBe(200);
  expect(url.body).toContain("DIVERRON");
});

test("home sachet tap opens once and returns focus to the sachet", async ({ page }, testInfo) => {
  await gotoDeck(page);
  const sachet = page.getByRole("button", { name: "Ouvrir le sachet Live Drop" });
  await expect(sachet).toBeEnabled();
  const stock = Number((await page.locator(".stock-row strong").innerText()).split("/")[0]);
  if (testInfo.project.name === "téléphone") await sachet.tap();
  else await sachet.click();
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  await reveal.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator(".stock-row strong")).toHaveText(`${stock - 1}/4`);
  await expect(sachet).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toBeVisible();
});

test("an abandoned home drag does not become a tap and an armed pull opens once", async ({ page }) => {
  await gotoDeck(page);
  const sachet = page.locator(".pack-artwork");
  await expect(sachet).toBeEnabled();
  const stock = Number((await page.locator(".stock-row strong").innerText()).split("/")[0]);
  const bounds = (await sachet.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 30, { steps: 5 });
  expect(await sachet.evaluate((node) => (node as HTMLElement).style.getPropertyValue("--pack-tilt-x")))
    .not.toBe("");
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toHaveCount(0);
  await expect(page.locator(".stock-row strong")).toHaveText(`${stock}/4`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 110, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Ouvrir le booster" })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir sans déchirer" }).click();
  const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
  await expect(reveal).toBeVisible();
  await reveal.getByRole("button", { name: "Fermer", exact: true }).click();
  await expect(page.locator(".stock-row strong")).toHaveText(`${stock - 1}/4`);
});

test("compact sachet keeps the weld within thumb reach and accepts both swipe directions", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoDeck(page);
  await expect(page.getByRole("button", { name: "Ouvrir le sachet Live Drop" })).toBeEnabled();
  const stock = Number((await page.locator(".stock-row strong").innerText()).split("/")[0]);
  const touch = await page.context().newCDPSession(page);
  for (const reverse of [false, true]) {
    await page.getByRole("button", { name: "Ouvrir le sachet Live Drop" }).click();
    const dialog = page.getByRole("dialog", { name: "Ouvrir le booster" });
    for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 800 }, { width: 412, height: 915 }]) {
      await page.setViewportSize(viewport);
      const pack = (await dialog.locator(".booster-physical-scene").boundingBox())!;
      const seam = (await dialog.locator(".booster-tear-track").boundingBox())!;
      const action = (await dialog.locator(".booster-open-button").boundingBox())!;
      expect(pack.width).toBeLessThanOrEqual(viewport.width * .65);
      expect(pack.height).toBeLessThanOrEqual(viewport.height * .45);
      const seamCenter = seam.y + seam.height / 2;
      expect(seamCenter).toBeGreaterThan(viewport.height * .4);
      expect(seamCenter).toBeLessThan(viewport.height * .6);
      expect(pack.y + pack.height).toBeLessThan(action.y);
      expect(action.y + action.height).toBeLessThanOrEqual(viewport.height);
    }
    const seam = (await dialog.locator(".booster-tear-track").boundingBox())!;
    const from = reverse ? .88 : .12;
    const to = reverse ? .12 : .88;
    const y = seam.y + seam.height / 2;
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: seam.x + seam.width * from, y }] });
    // A short trace is reversible and must not open the packet.
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: seam.x + seam.width * (from + (to - from) * .2), y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await expect(dialog.locator(".booster-foil-open")).toHaveCount(0);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: seam.x + seam.width * from, y }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: seam.x + seam.width * (from + (to - from) * step / 8), y }] });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(dialog.locator(".booster-foil-open")).toBeVisible();
    const reveal = page.getByRole("dialog", { name: "Résultat du booster" });
    await expect(reveal).toBeVisible();
    await reveal.getByRole("button", { name: "Fermer", exact: true }).click();
  }
  await touch.detach();
  await expect(page.locator(".stock-row strong")).toHaveText(`${stock - 2}/4`);
  if (stock === 2) {
    await expect(page.getByRole("button", { name: "Ouvrir le sachet Live Drop" })).toBeDisabled();
    await expect(page.locator(".pack-copy h2")).toBeFocused();
  }
});
