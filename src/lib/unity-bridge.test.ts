import { describe, expect, it } from "vitest";
import {
  isUnityCard,
  parseUnityEvent,
  serializeDrawPayload,
  UNITY_LOADER,
} from "@/lib/unity-bridge";
import type { DrawnCard } from "@/lib/game-engine";

const card: DrawnCard = {
  id: "abc-123",
  creatorSlug: "squeezie",
  rarity: "epic",
  variant: "holo",
  isNew: true,
};

describe("serializeDrawPayload", () => {
  it("émet un JSON versionné et stable", () => {
    const json = serializeDrawPayload({ packType: "archive", cards: [card] });
    expect(json).toBe(
      JSON.stringify({
        v: 1,
        packType: "archive",
        cards: [
          { id: "abc-123", slug: "squeezie", rarity: "epic", variant: "holo", isNew: true },
        ],
      }),
    );
    expect(serializeDrawPayload({ packType: "archive", cards: [card] })).toBe(json);
  });

  it("encode un booster vide sans erreur", () => {
    expect(JSON.parse(serializeDrawPayload({ packType: "live", cards: [] }))).toMatchObject({
      v: 1,
      packType: "live",
      cards: [],
    });
  });
});

describe("parseUnityEvent", () => {
  it("accepte les événements attendus", () => {
    expect(parseUnityEvent(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready" });
    expect(parseUnityEvent(JSON.stringify({ type: "tear-complete" }))).toEqual({
      type: "tear-complete",
    });
    expect(parseUnityEvent(JSON.stringify({ type: "summary-shown" }))).toEqual({
      type: "summary-shown",
    });
    expect(parseUnityEvent(JSON.stringify({ type: "close" }))).toEqual({ type: "close" });
  });

  it("borne la progression de déchirure entre 0 et 1", () => {
    expect(parseUnityEvent(JSON.stringify({ type: "tear-progress", progress: 0.42 }))).toEqual({
      type: "tear-progress",
      progress: 0.42,
    });
    expect(parseUnityEvent(JSON.stringify({ type: "tear-progress", progress: 4 }))).toEqual({
      type: "tear-progress",
      progress: 1,
    });
    expect(parseUnityEvent(JSON.stringify({ type: "tear-progress", progress: -3 }))).toEqual({
      type: "tear-progress",
      progress: 0,
    });
  });

  it("valide l'index de carte révélée", () => {
    expect(parseUnityEvent(JSON.stringify({ type: "card-revealed", index: 2 }))).toEqual({
      type: "card-revealed",
      index: 2,
    });
    expect(parseUnityEvent(JSON.stringify({ type: "card-revealed", index: -1 }))).toBeNull();
    expect(parseUnityEvent(JSON.stringify({ type: "card-revealed", index: 1.5 }))).toBeNull();
    expect(parseUnityEvent(JSON.stringify({ type: "card-revealed" }))).toBeNull();
  });

  it("porte les messages d'erreur Unity", () => {
    expect(parseUnityEvent(JSON.stringify({ type: "error", message: "WebGL." }))).toEqual({
      type: "error",
      message: "WebGL.",
    });
    expect(parseUnityEvent(JSON.stringify({ type: "error" }))).toEqual({
      type: "error",
      message: "Erreur Unity.",
    });
  });

  it("rejette tout message malformé — le repli web reste utilisable", () => {
    expect(parseUnityEvent("")).toBeNull();
    expect(parseUnityEvent("pas du json")).toBeNull();
    expect(parseUnityEvent(null)).toBeNull();
    expect(parseUnityEvent(42)).toBeNull();
    expect(parseUnityEvent(JSON.stringify({ type: "inconnu" }))).toBeNull();
    expect(parseUnityEvent(JSON.stringify({ progress: 0.5 }))).toBeNull();
    expect(parseUnityEvent(JSON.stringify({ type: "tear-progress", progress: "1" }))).toBeNull();
    expect(parseUnityEvent(JSON.stringify(null))).toBeNull();
  });
});

describe("isUnityCard", () => {
  it("valide une carte complète", () => {
    expect(isUnityCard(card)).toBe(true);
  });

  it("refuse une carte tronquée ou une rareté inconnue", () => {
    expect(isUnityCard({ ...card, rarity: "mythique" })).toBe(false);
    expect(isUnityCard({ ...card, variant: "shiny" })).toBe(false);
    expect(isUnityCard({ ...card, id: 7 })).toBe(false);
    expect(isUnityCard(undefined)).toBe(false);
    expect(isUnityCard("card")).toBe(false);
  });
});

describe("emplacement du build", () => {
  it("pointe vers le loader public", () => {
    expect(UNITY_LOADER).toBe("/unity/Build/creatordeck.loader.js");
  });
});
