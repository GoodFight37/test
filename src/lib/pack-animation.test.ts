import { describe, expect, it } from "vitest";
import { PACKS } from "@/lib/catalog";
import { drawPack, type DrawnCard } from "@/lib/game-engine";
import {
  PACK_PHASE_ORDER,
  PACK_TIMINGS,
  REDUCED_MOTION_SCALE,
  SWIPE_MAX_ROTATION,
  SWIPE_THRESHOLD,
  SWIPE_VELOCITY,
  TEAR_THRESHOLD,
  TEAR_VELOCITY,
  TILT_MAX_DEG,
  TILT_MAX_DEG_SCROLL_SAFE,
  CAROUSEL_SPACING_PX,
  CAROUSEL_VISIBILITY,
  cardRank,
  clamp,
  carouselDeltaToSlots,
  carouselSlot,
  carouselSnap,
  clamp01,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  effectIntensity,
  flipDurationMs,
  hasReachedPhase,
  isRareOrBetter,
  lerp,
  particleCountFor,
  pileSlot,
  revealOrder,
  summaryDelayMs,
  swipeProgress,
  swipeReveals,
  swipeRotation,
  crimpClipPath,
  tearBaseClipPath,
  tearClipPath,
  tearCompletes,
  tearProgress,
  timingsFor,
} from "@/lib/pack-animation";

function card(overrides: Partial<DrawnCard> = {}): DrawnCard {
  return {
    id: "card-1",
    creatorSlug: "squeezie",
    rarity: "common",
    variant: "standard",
    isNew: false,
    ...overrides,
  };
}

describe("utilitaires numériques", () => {
  it("borne clamp01 et gère NaN", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });

  it("borne clamp sur un intervalle", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(4, 0, 10)).toBe(4);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it("interpole avec lerp", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 5)).toBe(10);
  });

  it("garde les courbes d'animation dans [0, 1]", () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(ease(t)).toBeGreaterThanOrEqual(0);
        expect(ease(t)).toBeLessThanOrEqual(1);
      }
    }
    expect(easeOutCubic(1)).toBe(1);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("easeOutBack dépasse légèrement 1 puis retombe dessus", () => {
    expect(easeOutBack(0)).toBe(0);
    expect(easeOutBack(1)).toBe(1);
    // L'overshoot est l'effet recherché à l'atterrissage de la pile.
    expect(easeOutBack(0.75)).toBeGreaterThan(1);
  });
});

describe("timingsFor", () => {
  it("renvoie les durées nominales sans réduction de mouvement", () => {
    expect(timingsFor(false)).toBe(PACK_TIMINGS);
  });

  it("réduit toutes les durées avec prefers-reduced-motion", () => {
    const reduced = timingsFor(true);
    for (const key of Object.keys(PACK_TIMINGS) as (keyof typeof PACK_TIMINGS)[]) {
      expect(reduced[key]).toBe(Math.round(PACK_TIMINGS[key] * REDUCED_MOTION_SCALE));
      expect(reduced[key]).toBeLessThan(PACK_TIMINGS[key]);
    }
  });

  it("conserve le retournement rare plus long que le retournement classique", () => {
    const reduced = timingsFor(true);
    expect(reduced.rareFlip).toBeGreaterThan(reduced.cardRevealFlip);
  });
});

describe("raretes et ordre de revelation", () => {
  it("identifie les cartes rares ou mieux", () => {
    expect(isRareOrBetter("common")).toBe(false);
    expect(isRareOrBetter("uncommon")).toBe(false);
    expect(isRareOrBetter("rare")).toBe(true);
    expect(isRareOrBetter("epic")).toBe(true);
    expect(isRareOrBetter("legendary")).toBe(true);
  });

  it("classe une gold au-dessus d'une holo de meme rarete", () => {
    expect(cardRank(card({ rarity: "epic", variant: "gold" }))).toBeGreaterThan(
      cardRank(card({ rarity: "epic", variant: "holo" })),
    );
    expect(cardRank(card({ rarity: "rare", variant: "gold" }))).toBeLessThan(
      cardRank(card({ rarity: "epic", variant: "standard" })),
    );
  });

  it("place la meilleure carte en dernier, sans changer le contenu", () => {
    const drawn = [
      card({ id: "a", rarity: "legendary", variant: "gold" }),
      card({ id: "b", rarity: "common" }),
      card({ id: "c", rarity: "epic", variant: "holo" }),
      card({ id: "d", rarity: "uncommon" }),
    ];
    const ordered = revealOrder(drawn);
    expect(ordered.map((item) => item.id)).toEqual(["b", "d", "c", "a"]);
    expect([...ordered].sort((x, y) => x.id.localeCompare(y.id))).toEqual(
      [...drawn].sort((x, y) => x.id.localeCompare(y.id)),
    );
  });

  it("est stable a egalite de rang", () => {
    const drawn = [card({ id: "1" }), card({ id: "2" }), card({ id: "3" })];
    expect(revealOrder(drawn).map((item) => item.id)).toEqual(["1", "2", "3"]);
  });

  it("revele toujours une rare ou mieux en dernier sur un vrai tirage", () => {
    for (let run = 0; run < 60; run += 1) {
      const packType = run % 2 === 0 ? "live" : "archive";
      const ordered = revealOrder(drawPack(packType, new Set()));
      expect(ordered).toHaveLength(PACKS[packType].size);
      const last = ordered[ordered.length - 1];
      expect(isRareOrBetter(last.rarity)).toBe(true);
      const maxRank = Math.max(...ordered.map(cardRank));
      expect(cardRank(last)).toBe(maxRank);
    }
  });
});

describe("effectIntensity", () => {
  it("monte avec la rarete", () => {
    const values = ["common", "uncommon", "rare", "epic", "legendary"] as const;
    for (let index = 1; index < values.length; index += 1) {
      expect(effectIntensity(values[index], "standard")).toBeGreaterThan(
        effectIntensity(values[index - 1], "standard"),
      );
    }
  });

  it("monte avec la variante", () => {
    const variants = ["standard", "live", "holo", "gold"] as const;
    for (let index = 1; index < variants.length; index += 1) {
      expect(effectIntensity("rare", variants[index])).toBeGreaterThan(
        effectIntensity("rare", variants[index - 1]),
      );
    }
  });

  it("reste dans [0, 1], y compris pour une legendaire gold", () => {
    expect(effectIntensity("legendary", "gold")).toBe(1);
    expect(effectIntensity("common", "standard")).toBeGreaterThan(0);
  });
});

describe("durees derivees", () => {
  it("donne un retournement lent aux rares ou mieux", () => {
    expect(flipDurationMs(card({ rarity: "rare" }))).toBe(PACK_TIMINGS.rareFlip);
    expect(flipDurationMs(card({ rarity: "common" }))).toBe(PACK_TIMINGS.cardRevealFlip);
    expect(flipDurationMs(card({ rarity: "common" }), timingsFor(true))).toBe(
      Math.round(PACK_TIMINGS.cardRevealFlip * REDUCED_MOTION_SCALE),
    );
  });

  it("borne le nombre de particules", () => {
    expect(particleCountFor(0)).toBe(0);
    expect(particleCountFor(0.05)).toBe(8);
    expect(particleCountFor(1)).toBe(46);
    expect(particleCountFor(5)).toBe(46);
  });

  it("decale les cartes du recapitulatif en cascade", () => {
    expect(summaryDelayMs(0)).toBe(0);
    expect(summaryDelayMs(3)).toBe(3 * PACK_TIMINGS.summaryStagger);
    expect(summaryDelayMs(-2)).toBe(0);
  });
});

describe("geste de dechirure", () => {
  it("atteint 1 quand le doigt a parcouru le seuil", () => {
    const height = 400;
    expect(tearProgress(0, height)).toBe(0);
    expect(tearProgress(height * TEAR_THRESHOLD, height)).toBeCloseTo(1, 5);
    expect(tearProgress(height, height)).toBe(1);
  });

  it("ignore un deplacement negatif et une hauteur invalide", () => {
    expect(tearProgress(-50, 400)).toBe(0);
    expect(tearProgress(50, 0)).toBe(0);
    expect(tearProgress(50, -10)).toBe(0);
  });

  it("est monotone croissant", () => {
    let previous = -1;
    for (let delta = 0; delta <= 220; delta += 10) {
      const value = tearProgress(delta, 400);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("valide la dechirure par la distance ou par la vitesse", () => {
    // Sous le seuil et sans vitesse : le geste n'est pas acquis.
    expect(tearCompletes(0.5, 0)).toBe(false);
    expect(tearCompletes(0.99, TEAR_VELOCITY - 0.01)).toBe(false);
    // Distance franchie OU geste assez vif : la dechirure part.
    expect(tearCompletes(1, 0)).toBe(true);
    expect(tearCompletes(0.3, TEAR_VELOCITY)).toBe(true);
    expect(tearCompletes(0.4, TEAR_VELOCITY + 0.1)).toBe(true);
  });

  it("produit le complement exact du rabat superieur", () => {
    const top = tearClipPath(0.4).slice("polygon(".length, -1).split(", ");
    const base = tearBaseClipPath(0.4).slice("polygon(".length, -1).split(", ");
    // Même dentelure, dans le même ordre : les deux pièces s'emboîtent.
    expect(base.slice(2)).toEqual(top.slice(2));
    expect(top.slice(0, 2)).toEqual(["0% 0%", "100% 0%"]);
    expect(base.slice(0, 2)).toEqual(["0% 100%", "100% 100%"]);
  });

  it("produit un polygon CSS valide et borne", () => {
    let previousAverage = Number.POSITIVE_INFINITY;
    for (const progress of [0, 0.25, 0.6, 1]) {
      const path = tearClipPath(progress);
      expect(path.startsWith("polygon(")).toBe(true);
      expect(path.endsWith(")")).toBe(true);
      const points = path.slice("polygon(".length, -1).split(", ");
      // 2 coins superieurs + (teeth + 1) points de la dentelure.
      expect(points).toHaveLength(12);
      for (const point of points) {
        const [x, y] = point.split(" ").map((value) => Number.parseFloat(value));
        expect(Number.isNaN(x)).toBe(false);
        expect(Number.isNaN(y)).toBe(false);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
      // La ligne de dechirure remonte a mesure que le rabat est tire.
      const edge = points.slice(2).map((point) => Number.parseFloat(point.split(" ")[1]));
      const average = edge.reduce((sum, value) => sum + value, 0) / edge.length;
      // Les coordonnees sont arrondies a 2 decimales dans le polygon : on
      // compare au centieme pres, pas a l'epsilon.
      expect(average).toBeCloseTo(52 - progress * 16, 1);
      expect(average).toBeLessThan(previousAverage);
      previousAverage = average;
      // Les dents alternent : la dentelure est bien visible.
      expect(Math.max(...edge) - Math.min(...edge)).toBeGreaterThan(0);
    }
  });
});

describe("pile de cartes", () => {
  it("ne decale pas la carte du dessus", () => {
    expect(pileSlot(2, 2)).toMatchObject({ x: 0, y: 0, rotate: 0, scale: 1, z: 0, hidden: false });
  });

  it("empile et masque au-dela de la profondeur utile", () => {
    const below = pileSlot(4, 2);
    expect(below.y).toBe(-14);
    expect(below.scale).toBeLessThan(1);
    expect(below.hidden).toBe(false);
    expect(pileSlot(20, 2).hidden).toBe(true);
  });

  it("ignore un index deja retire de la pile", () => {
    expect(pileSlot(0, 3)).toMatchObject({ x: 0, y: 0, rotate: 0, hidden: false });
  });
});

describe("balayage d'une carte", () => {
  it("normalise le deplacement par rapport a la largeur", () => {
    expect(swipeProgress(0, 300)).toBe(0);
    expect(swipeProgress(300 * SWIPE_THRESHOLD, 300)).toBe(1);
    expect(swipeProgress(-300 * SWIPE_THRESHOLD, 300)).toBe(-1);
    expect(swipeProgress(900, 300)).toBe(1);
    expect(swipeProgress(100, 0)).toBe(0);
  });

  it("revele par la distance ou par la vitesse, dans les deux sens", () => {
    expect(swipeReveals(0.2, 0.1)).toBe(false);
    expect(swipeReveals(1, 0)).toBe(true);
    expect(swipeReveals(-1, 0)).toBe(true);
    expect(swipeReveals(-0.3, -SWIPE_VELOCITY)).toBe(true);
  });

  it("borne la rotation de la carte", () => {
    expect(swipeRotation(0)).toBe(0);
    expect(swipeRotation(1)).toBe(SWIPE_MAX_ROTATION);
    expect(swipeRotation(-1)).toBe(-SWIPE_MAX_ROTATION);
    expect(swipeRotation(-40)).toBe(-SWIPE_MAX_ROTATION);
  });
});

describe("phases", () => {
  it("suit l'ordre de lecture du joueur", () => {
    expect(PACK_PHASE_ORDER[0]).toBe("sealed");
    expect(PACK_PHASE_ORDER[PACK_PHASE_ORDER.length - 1]).toBe("summary");
    expect(hasReachedPhase("pile", "burst")).toBe(true);
    expect(hasReachedPhase("sealed", "burst")).toBe(false);
    expect(hasReachedPhase("burst", "burst")).toBe(true);
  });

  it("garde l'inclinaison du classeur plus discrete que celle de la revelation", () => {
    expect(TILT_MAX_DEG_SCROLL_SAFE).toBeLessThan(TILT_MAX_DEG);
  });
});


describe("soudures du sachet (crimp)", () => {
  it("produit un polygon CSS valide et borné", () => {
    for (const edge of ["top", "bottom"] as const) {
      const path = crimpClipPath(22, edge);
      expect(path.startsWith("polygon(")).toBe(true);
      const points = path.slice("polygon(".length, -1).split(", ");
      expect(points.length).toBe(25); // 2 coins + (22 dents + 1)
      for (const point of points) {
        const [x, y] = point.split(" ").map((value) => Number.parseFloat(value));
        expect(Number.isNaN(x)).toBe(false);
        expect(Number.isNaN(y)).toBe(false);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("crante le bord intérieur et laisse le bord extérieur plat", () => {
    const path = (edge: "top" | "bottom") =>
      crimpClipPath(8, edge)
        .slice("polygon(".length, -1)
        .split(", ")
        .map((point) => Number.parseFloat(point.split(" ")[1]));

    // Soudure du haut : bord extérieur = 0 %, bord intérieur dentelé vers 100 %.
    const top = path("top");
    expect(top[0]).toBe(0);
    expect(top[1]).toBe(0);
    expect(Math.max(...top.slice(2))).toBe(100);
    expect(Math.min(...top.slice(2))).toBeLessThan(100); // les dents mordent
    expect(Math.min(...top.slice(2))).toBeGreaterThan(80);

    // Soudure du bas : bord extérieur = 100 %, bord intérieur dentelé vers 0 %.
    const bottom = path("bottom");
    expect(bottom[0]).toBe(100);
    expect(bottom[1]).toBe(100);
    expect(Math.min(...bottom.slice(2))).toBe(0);
    expect(Math.max(...bottom.slice(2))).toBeGreaterThan(0);
    expect(Math.max(...bottom.slice(2))).toBeLessThan(20);
  });

  it("est déterministe et tolère des bornes absurdes", () => {
    expect(crimpClipPath(22, "top")).toBe(crimpClipPath(22, "top"));
    expect(crimpClipPath(1, "top")).not.toBe("");
    expect(crimpClipPath(0, "top").split(", ").length).toBeGreaterThan(3);
  });
});

describe("carrousel 3D des boosters", () => {
  it("centre le paquet sélectionné", () => {
    expect(carouselSlot(1, 1)).toMatchObject({ x: 0, z: 0, rotateY: 0, scale: 1, hidden: false });
  });

  it("écarte, enfonce et pivote les voisins", () => {
    const right = carouselSlot(2, 1);
    const left = carouselSlot(0, 1);
    expect(right.x).toBe(CAROUSEL_SPACING_PX);
    expect(right.z).toBeLessThan(0);
    expect(right.scale).toBeLessThan(1);
    expect(right.hidden).toBe(false);
    // Symétrie : le voisin de gauche est le miroir exact (position et angle).
    expect(left.x).toBe(-right.x);
    expect(left.z).toBe(right.z);
    expect(left.rotateY).toBe(-right.rotateY);
    expect(left.scale).toBe(right.scale);
  });

  it("fait pivoter les paquets vers l'intérieur de l'arc", () => {
    // À droite : le bord droit doit s'éloigner (rotateY positif) pour que la
    // face du paquet regarde le centre de l'arc.
    expect(carouselSlot(2, 1).rotateY).toBeGreaterThan(0);
    expect(carouselSlot(0, 1).rotateY).toBeLessThan(0);
  });

  it("masque les paquets trop éloignés", () => {
    expect(carouselSlot(1 + CAROUSEL_VISIBILITY, 1).hidden).toBe(false);
    expect(carouselSlot(1 + CAROUSEL_VISIBILITY + 1, 1).hidden).toBe(true);
  });

  it("inverse le sens du glissement (on tire vers soi pour avancer)", () => {
    expect(carouselDeltaToSlots(CAROUSEL_SPACING_PX)).toBe(-1);
    expect(carouselDeltaToSlots(-CAROUSEL_SPACING_PX)).toBe(1);
  });

  it("cale l'index sur le cran le plus proche et le borne", () => {
    const count = 3;
    expect(carouselSnap(1, 0, count)).toBe(1);
    expect(carouselSnap(1, -CAROUSEL_SPACING_PX, count)).toBe(2);
    expect(carouselSnap(1, CAROUSEL_SPACING_PX, count)).toBe(0);
    expect(carouselSnap(2, -CAROUSEL_SPACING_PX * 3, count)).toBe(2); // borné à count-1
    expect(carouselSnap(0, CAROUSEL_SPACING_PX * 9, count)).toBe(0); // borné à 0
    expect(carouselSnap(0, 0, 0)).toBe(0);
    expect(carouselSnap(1, -CAROUSEL_SPACING_PX * 0.4, count)).toBe(1);
  });
});
