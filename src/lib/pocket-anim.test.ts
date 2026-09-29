import { describe, expect, it } from "vitest";
import { PACK_TIMINGS, flipDurationMs, timingsFor } from "@/lib/pack-animation";
import { POCKET_CLIPS } from "@/lib/pocket-anim";

/**
 * Les durées d'ouverture doivent rester calées sur les clips réels du jeu
 * (`GoodFight37/pkmn`) : si quelqu'un touche à `PACK_TIMINGS`, ce test le
 * rappelle en citant le clip d'origine.
 */
describe("poche Pocket ↔ timings", () => {
  it("sealedFloat suit la boucle réelle de C_PackOpen_Pack_float", () => {
    expect(PACK_TIMINGS.sealedFloat).toBe(POCKET_CLIPS.float.cycleMs);
    expect(POCKET_CLIPS.float.loop).toBe(true);
  });

  it("cardRevealFlip suit la durée réelle de C_CardGet_Card_flip_L", () => {
    expect(PACK_TIMINGS.cardRevealFlip).toBe(POCKET_CLIPS.flip.clipMs);
    expect(flipDurationMs({ rarity: "common", variant: "standard" })).toBe(
      POCKET_CLIPS.flip.clipMs,
    );
  });

  it("la sortie des cartes reprend l'accélération mesurée du clip", () => {
    expect(POCKET_CLIPS.cardRise.holdMs + POCKET_CLIPS.cardRise.riseMs).toBeCloseTo(
      POCKET_CLIPS.cardRise.clipMs,
      0,
    );
    expect(POCKET_CLIPS.cardRise.ease).toBe("cubic-bezier(0.45, 0, 0.55, 1)");
  });

  it("les courbes citées existent bien dans le module", () => {
    expect(POCKET_CLIPS.flip.ease).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(POCKET_CLIPS.flip.clipMs).toBe(500);
    expect(POCKET_CLIPS.sway.durationMs).toBe(833);
    expect(POCKET_CLIPS.flapOpen.durationMs).toBe(1167);
  });

  it("le mode « réduit les animations » garde bien l'échelle", () => {
    const reduced = timingsFor(true);
    expect(reduced.sealedFloat).toBe(
      Math.round(POCKET_CLIPS.float.cycleMs * 0.35),
    );
  });
});
