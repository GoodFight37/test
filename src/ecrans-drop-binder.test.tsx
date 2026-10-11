import { act } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { creerBanc, type Banc } from "@/ecrans-banc";
import { CREATORS } from "@/lib/catalog";
import { SEASON_BY_ID } from "@/lib/seasons";
import { createInitialState, getGameView } from "@/lib/game-engine";
import { CollectionView } from "@/components/binder-view";

const NOW = Date.UTC(2026, 9, 11, 12);
vi.mock("@/hooks/use-game", () => ({ useNow: () => NOW }));
vi.mock("@/hooks/use-live", () => ({ useLive: () => ({ byLogin: new Map(), count: 0, stale: true, configured: false }) }));

describe("le Binder guide la collection sans inventer de progression", () => {
  let banc: Banc;
  beforeEach(() => { banc = creerBanc(); banc.preparer(); });
  afterEach(() => banc.nettoyer());

  async function collection(slugs: string[]) {
    const state = createInitialState(NOW);
    state.cards = slugs.map((slug, index) => ({ id: `owned-${index}`, creatorSlug: slug,
      rarity: CREATORS.find((creator) => creator.slug === slug)!.rarity,
      variant: "standard" as const, obtainedAt: NOW - index * 1000, rareDrop: false }));
    const game = getGameView(state, NOW);
    const onGoDrop = vi.fn();
    await banc.monter(<CollectionView game={game} onCraft={async () => true} onGoDrop={onGoDrop} />);
    return { game, onGoDrop };
  }

  it("le classeur vide propose le Drop et n’invente pas de page avancée", async () => {
    const { onGoDrop } = await collection([]);
    expect(document.querySelector(".binder-next-pages")).toBeNull();
    banc.appuyer("Retour au Drop");
    expect(onGoDrop).toHaveBeenCalledOnce();
  });

  it("les doublons ne gonflent pas les pages et leurs filtres ne montrent que les manquantes", async () => {
    const family = CREATORS.filter((creator) => creator.region === "S01").slice(0, 2);
    const { game } = await collection([family[0].slug, family[0].slug, family[1].slug]);
    const goal = document.querySelector<HTMLButtonElement>(".binder-next-pages > button")!;
    const season = game.seasons.find((entry) => goal.textContent?.includes(entry.name))!;
    expect(goal.textContent).toContain(`2 / ${season.total}`);
    act(() => goal.click());
    const allowed = new Set(SEASON_BY_ID.get(season.id)!.slugs);
    const labels = [...document.querySelectorAll(".collection-grid .creator-card")].map((node) => node.getAttribute("aria-label")!);
    expect(labels).toHaveLength(12);
    for (const label of labels) {
      expect(label).toContain("non obtenue");
      const creator = CREATORS.find((entry) => label.startsWith(`${entry.displayName},`))!;
      expect(allowed.has(creator.slug)).toBe(true);
      expect(family.some((entry) => entry.slug === creator.slug)).toBe(false);
    }
    banc.appuyer("Dernières reçues");
    expect(document.querySelector(".binder-active-page")).toBeNull();
    expect(document.querySelectorAll(".collection-grid .creator-card")).toHaveLength(2);
  });

  it("999 cartes ne sont pas annoncées comme une collection complète", async () => {
    await collection(CREATORS.slice(0, -1).map((creator) => creator.slug));
    expect(document.querySelector(".collection-score")?.textContent).toContain("99%");
  });
});
