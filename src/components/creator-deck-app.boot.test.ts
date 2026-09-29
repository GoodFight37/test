// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, test } from "vitest";
import { CreatorDeckApp } from "./creator-deck-app";

/**
 * Test de fumée du démarrage : le premier rendu (écran « Préparation du Top
 * 500… ») doit basculer automatiquement vers l'application dès que le store
 * local est lu. C'est exactement le passage qui reste bloqué quand le bundle
 * côté client ne s'exécute pas — voir incident aperçu avec le serveur coupé.
 *
 * jsdom n'offre pas `matchMedia` / `ResizeObserver` / `scrollTo` : on les
 * stubbe comme le ferait le navigateur réel.
 */

window.matchMedia = ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.scrollTo = () => {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  window.localStorage.clear();
});

test("le boot sort de l'écran de chargement et affiche l'application", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(CreatorDeckApp));
  });

  const text = container.textContent ?? "";
  expect(text).not.toContain("Préparation du Top 500");
  expect(text).toContain("CreatorDeck");
  // Un seul booster : le libellé « Archives » n'a plus rien à faire à l'accueil.
  expect(text).not.toContain("Archives");

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
