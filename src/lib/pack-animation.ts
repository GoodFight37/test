/**
 * Chorégraphie de l'ouverture de booster — module PUR.
 *
 * Aucune dépendance au DOM, à React ni à Node : ce fichier ne contient que des
 * constantes de durée et des fonctions de calcul. C'est volontaire :
 *  - la chorégraphie est testable unitairement (Vitest, environnement node) ;
 *  - les composants d'animation (`pack-opening.tsx`, `card3d.tsx`) restent de
 *    simples projections de ces valeurs, donc remplaçables par un autre moteur
 *    de rendu (voir `unity-bridge.ts`) sans toucher à la logique de jeu.
 *
 * Toutes les durées sont centralisées dans `PACK_TIMINGS` : c'est la source de
 * vérité documentée dans la PR.
 */
import { RARITY_META, type CardVariant, type Rarity } from "@/lib/catalog";
import type { DrawnCard } from "@/lib/game-engine";

/** Les étapes de la cinématique, dans l'ordre de lecture du joueur. */
export type PackPhase =
  /** Pack fermé, en lévitation au centre : on attend le geste. */
  | "sealed"
  /** Le doigt tire le haut du pack vers le haut. */
  | "tearing"
  /** Le pack se déchire, les cartes jaillissent. */
  | "burst"
  /** La pile de cartes est posée, faces cachées. */
  | "pile"
  /** Une carte est balayée puis retournée face visible. */
  | "revealing"
  /** Retournement LENT de la carte rare ou mieux (+ reflet holo, particules). */
  | "rare-flip"
  /** Récapitulatif des cartes obtenues. */
  | "summary";

/** Ordre linéaire des phases — sert à savoir si une étape est déjà passée. */
export const PACK_PHASE_ORDER: PackPhase[] = [
  "sealed",
  "tearing",
  "burst",
  "pile",
  "revealing",
  "rare-flip",
  "summary",
];

/**
 * Durées de la cinématique, en millisecondes.
 *
 * | Clé                | Durée  | Ce que le joueur voit                                  |
 * |--------------------|--------|--------------------------------------------------------|
 * | sealedIn           | 320 ms | le pack fermé apparaît et se pose au centre             |
 * | sealedFloat        | 3333 ms| lévitation du pack (clip réel `C_PackOpen_Pack_float`)  |
 * | tearSnapBack       | 260 ms | retour élastique quand le geste est relâché trop tôt    |
 * | burst              | 620 ms | déchirure du pack + projection des cartes               |
 * | pileSettle         | 340 ms | atterrissage de la pile                                 |
 * | cardRevealFlip     | 500 ms | retournement d'une carte (clip réel `C_CardGet_Card_flip_L`) |
 * | cardLift           | 240 ms | la carte balayée sort de la pile                        |
 * | rareFlip           | 1500 ms| retournement lent de la rare ou mieux                   |
 * | rareParticles      | 1200 ms| durée de vie de l'effet de particules                   |
 * | rareHold           | 900 ms | temps de lecture avant que le bouton suivant n'apparaisse|
 * | summaryIn          | 420 ms | fondu du panneau récapitulatif                          |
 * | summaryStagger     | 60 ms  | décalage entre chaque carte du récapitulatif            |
 */
export const PACK_TIMINGS = {
  sealedIn: 320,
  /** Vrai cycle du jeu : `POCKET_CLIPS.float.cycleMs` (voir pocket-anim.ts). */
  sealedFloat: 3333,
  tearSnapBack: 260,
  burst: 620,
  pileSettle: 340,
  /** Durée du clip réel `C_CardGet_Card_flip_L` (voir pocket-anim.ts). */
  cardRevealFlip: 500,
  cardLift: 240,
  rareFlip: 1500,
  rareParticles: 1200,
  rareHold: 900,
  summaryIn: 420,
  summaryStagger: 60,
} as const;

export type PackTimings = typeof PACK_TIMINGS;

/**
 * Facteur appliqué aux durées quand `prefers-reduced-motion: reduce` est actif.
 * Les gestes pilotés au doigt ne sont pas concernés (ils suivent le doigt).
 */
export const REDUCED_MOTION_SCALE = 0.35;

/** Geste de déchirure : fraction de la hauteur du pack à parcourir. */
export const TEAR_THRESHOLD = 0.55;
/** Vitesse (px/ms) au-delà de laquelle la déchirure part d'un seul coup. */
export const TEAR_VELOCITY = 1.35;
/** Distance minimale avant de considérer que le joueur a commencé à tirer. */
export const TEAR_MIN_DISTANCE_PX = 18;
/** Amplitude du tremblement du pack pendant la déchirure, en px. */
export const TEAR_SHAKE_PX = 7;

/** Balayage d'une carte : fraction de la largeur à parcourir pour la révéler. */
export const SWIPE_THRESHOLD = 0.42;
/** Vitesse (px/ms) au-delà de laquelle le balayage déclenche la révélation. */
export const SWIPE_VELOCITY = 0.9;
/** Rotation maximale de la carte pendant qu'elle suit le doigt, en degrés. */
export const SWIPE_MAX_ROTATION = 16;

/** Inclinaison maximale d'une carte 3D, en degrés (pilotée au doigt). */
export const TILT_MAX_DEG = 15;
/** Inclinaison maximale en mode « scroll préservé » (classeur). */
export const TILT_MAX_DEG_SCROLL_SAFE = 9;
/** Distance (px) en deçà de laquelle un appui est un tap → retournement. */
export const TAP_MAX_MOVE_PX = 12;
/** Durée (ms) au-delà de laquelle un appui n'est plus un tap. */
export const TAP_MAX_MS = 450;

/** Poids d'une variante pour départager deux cartes de même rareté. */
const VARIANT_WEIGHT: Record<CardVariant, number> = {
  standard: 0,
  live: 1,
  holo: 2,
  gold: 3,
};

/** Intensité de base des effets (0 → 1) par rareté. */
const RARITY_INTENSITY: Record<Rarity, number> = {
  common: 0.16,
  uncommon: 0.3,
  rare: 0.55,
  epic: 0.78,
  legendary: 1,
};

/** Bonus d'intensité apporté par la variante de la carte. */
const VARIANT_BONUS: Record<CardVariant, number> = {
  standard: 0,
  live: 0.1,
  holo: 0.26,
  gold: 0.38,
};

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Rebond léger — utilisé pour l'atterrissage de la pile et du récap. */
export function easeOutBack(t: number, overshoot = 1.35): number {
  const x = clamp01(t);
  const c1 = overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Durées réduites pour `prefers-reduced-motion`. Le contrat de type est conservé. */
export function timingsFor(reducedMotion: boolean): PackTimings {
  if (!reducedMotion) return PACK_TIMINGS;
  return Object.fromEntries(
    Object.entries(PACK_TIMINGS).map(([key, value]) => [
      key,
      Math.round((value as number) * REDUCED_MOTION_SCALE),
    ]),
  ) as PackTimings;
}

/** Vrai pour une carte Rare, Épique ou Légendaire. */
export function isRareOrBetter(rarity: Rarity): boolean {
  return RARITY_META[rarity].order >= RARITY_META.rare.order;
}

/** Rang comparable d'une carte : rareté d'abord, variante ensuite. */
export function cardRank(card: Pick<DrawnCard, "rarity" | "variant">): number {
  return RARITY_META[card.rarity].order * 10 + VARIANT_WEIGHT[card.variant];
}

/**
 * Ordre de révélation d'un booster : tri stable du plus faible au plus fort,
 * donc la meilleure carte (rare ou mieux garantie) est révélée en dernier et
 * bénéficie du retournement lent.
 */
export function revealOrder(cards: readonly DrawnCard[]): DrawnCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => cardRank(a.card) - cardRank(b.card) || a.index - b.index)
    .map((entry) => entry.card);
}

/**
 * Intensité des effets 3D d'une carte (0 → 1) : la rareté donne la base, la
 * variante (`standard` / `live` / `holo` / `gold`) ajoute un bonus. C'est cette
 * valeur unique qui pilote l'opacité du reflet holo, le nombre de particules et
 * la durée du retournement.
 */
export function effectIntensity(rarity: Rarity, variant: CardVariant): number {
  return clamp01(RARITY_INTENSITY[rarity] + VARIANT_BONUS[variant]);
}

/** Durée du retournement d'une carte : lent pour une rare ou mieux. */
export function flipDurationMs(
  card: Pick<DrawnCard, "rarity" | "variant">,
  timings: PackTimings = PACK_TIMINGS,
): number {
  return isRareOrBetter(card.rarity) ? timings.rareFlip : timings.cardRevealFlip;
}

/** Nombre de particules de l'effet de révélation, borné pour rester fluide. */
export function particleCountFor(intensity: number): number {
  if (intensity <= 0) return 0;
  return Math.round(clamp(intensity * 46, 8, 46));
}

/**
 * Progression de la déchirure (0 → 1) à partir du déplacement vertical du doigt.
 * La résistance augmente en fin de course : les derniers millimètres demandent
 * un peu plus d'effort, ce qui rend l'ouverture plus « matière ».
 */
export function tearProgress(deltaPx: number, heightPx: number): number {
  if (!(heightPx > 0)) return 0;
  const target = heightPx * TEAR_THRESHOLD;
  const raw = clamp01(deltaPx / target);
  return clamp01(raw * (1.12 - 0.12 * raw));
}

/** La déchirure est-elle acquise (distance franchie ou geste assez vif) ? */
export function tearCompletes(progress: number, velocityPxPerMs: number): boolean {
  return progress >= 1 || velocityPxPerMs >= TEAR_VELOCITY;
}

/**
 * Découpe dentelée du rabat supérieur du pack, en `polygon()` CSS.
 * `progress` fait descendre la ligne de déchirure et creuse les dents : la
 * trace du doigt devient visible sur le carton.
 */
export function tearClipPath(progress: number, teeth = 9): string {
  const p = clamp01(progress);
  const baseline = 52 - p * 16;
  const depth = 3 + p * 11;
  const round = (value: number) => Math.round(value * 100) / 100;
  const points: string[] = ["0% 0%", "100% 0%"];
  for (let index = teeth; index >= 0; index -= 1) {
    const x = (index / teeth) * 100;
    const y = baseline + (index % 2 === 0 ? -depth : depth) * 0.5;
    points.push(`${round(x)}% ${round(clamp(y, 0, 100))}%`);
  }
  return `polygon(${points.join(", ")})`;
}

/**
 * Complément de `tearClipPath` : la portion basse du pack, bordée par la même
 * dentelure. Le rabat supérieur (clipé par `tearClipPath`) et le pack résiduel
 * (clipé par cette fonction) forment alors deux pièces d'un même carton qui se
 * séparent : c'est ce qui crée l'écart par lequel la lumière du dedans filtre.
 */
export function tearBaseClipPath(progress: number, teeth = 9): string {
  const p = clamp01(progress);
  const baseline = 52 - p * 16;
  const depth = 3 + p * 11;
  const round = (value: number) => Math.round(value * 100) / 100;
  const points: string[] = ["0% 100%", "100% 100%"];
  for (let index = teeth; index >= 0; index -= 1) {
    const x = (index / teeth) * 100;
    const y = baseline + (index % 2 === 0 ? -depth : depth) * 0.5;
    points.push(`${round(x)}% ${round(clamp(y, 0, 100))}%`);
  }
  return `polygon(${points.join(", ")})`;
}

export type PileSlot = {
  /** Décalage horizontal, en px. */
  x: number;
  /** Décalage vertical, en px (négatif = vers le haut de l'écran). */
  y: number;
  /** Rotation, en degrés. */
  rotate: number;
  scale: number;
  /** Profondeur sur l'axe Z, en px. */
  z: number;
  /** Au-delà de la profondeur utile, la carte est masquée. */
  hidden: boolean;
};

/** Position d'une carte dans la pile, relative à la carte du dessus. */
export function pileSlot(index: number, topIndex: number, maxVisible = 5): PileSlot {
  const depth = Math.max(0, index - topIndex);
  return {
    x: depth * 2.2,
    // `depth === 0` explicite : `-0 * 7` produirait un `-0` qui casse
    // l'égalité stricte (Object.is) côté tests et côté `translate3d`.
    y: depth === 0 ? 0 : -depth * 7,
    rotate: depth === 0 ? 0 : depth % 2 === 0 ? depth * 1.1 : -depth * 1.4,
    scale: 1 - Math.min(depth, maxVisible) * 0.018,
    z: depth === 0 ? 0 : -depth * 6,
    hidden: depth > maxVisible,
  };
}

/**
 * Progression d'un balayage (0 → 1) à partir du déplacement horizontal.
 * Signée : le joueur peut balayer à gauche comme à droite.
 */
export function swipeProgress(deltaPx: number, widthPx: number): number {
  if (!(widthPx > 0)) return 0;
  return clamp(deltaPx / (widthPx * SWIPE_THRESHOLD), -1, 1);
}

/** Le balayage déclenche-t-il la révélation ? */
export function swipeReveals(progress: number, velocityPxPerMs: number): boolean {
  return Math.abs(progress) >= 1 || Math.abs(velocityPxPerMs) >= SWIPE_VELOCITY;
}

/** Rotation de la carte qui suit le doigt pendant le balayage. */
export function swipeRotation(progress: number): number {
  return clamp(progress, -1, 1) * SWIPE_MAX_ROTATION;
}

/**
 * Décalage appliqué au récapitulatif : les cartes arrivent en cascade, du plus
 * faible au plus fort, avec le même ordre que la révélation.
 */
export function summaryDelayMs(index: number, timings: PackTimings = PACK_TIMINGS): number {
  return Math.max(0, index) * timings.summaryStagger;
}

/** L'étape `phase` est-elle déjà passée (ou en cours) ? */
export function hasReachedPhase(phase: PackPhase, target: PackPhase): boolean {
  return PACK_PHASE_ORDER.indexOf(phase) >= PACK_PHASE_ORDER.indexOf(target);
}

/* =========================================================================
 * GÉOMÉTRIE DU PAQUET ET DU CARROUSEL
 * ========================================================================= */

/**
 * Découpe dentelée d'une soudure de sachet (le « crimp » en haut et en bas
 * d'un vrai booster). La dentelure est du point de vue de l'observateur :
 * `top` crante le bord bas de la bande du haut, `bottom` le bord haut de la
 * bande du bas. C'est ce qui donne au paquet son aspect de sachet soufflé et
 * scellé plutôt que de simple rectangle.
 *
 * Pure et testée : la forme du sachet est une donnée de jeu comme une autre.
 */
export function crimpClipPath(
  teeth = 22,
  edge: "top" | "bottom" = "top",
  toothPct = 3.4,
): string {
  const count = Math.max(2, Math.round(teeth));
  const depth = clamp(toothPct, 0.4, 14);
  // On parcourt toujours de droite à gauche : la première dent tombe pile sur
  // le coin droit, la dernière sur le coin gauche (aucun point dédoublonné).
  const tooth = (index: number): { x: number; y: number } => {
    const x = 100 - (index / count) * 100;
    const inner = index % 2 === 0;
    const y =
      edge === "top"
        ? inner
          ? 100 - depth
          : 100
        : inner
          ? depth
          : 0;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  };

  const points: string[] =
    edge === "top"
      ? ["0% 0%", "100% 0%"] // bord extérieur du haut, bien plat
      : ["100% 100%", "0% 100%"]; // bord extérieur du bas, bien plat
  for (let index = 0; index <= count; index += 1) {
    const { x, y } = tooth(index);
    points.push(`${x}% ${y}%`);
  }
  return `polygon(${points.join(", ")})`;
}

/** Un paquet du carrousel : position dans l'arc, profondeur et orientation. */
export type CarouselSlot = {
  /** Décalage horizontal, en px (0 = sélectionné, au centre). */
  x: number;
  /** Recul sur l'axe Z, en px (négatif = derrière). */
  z: number;
  /** Angle de présentation, en degrés (les paquets voisins montrent leur face). */
  rotateY: number;
  scale: number;
  /** En dehors de cette distance, le paquet n'est plus rendu. */
  hidden: boolean;
};

/** Espacement horizontal entre deux paquets de l'arc, en px. */
export const CAROUSEL_SPACING_PX = 150;
/** Recul en profondeur par cran, en px. */
export const CAROUSEL_DEPTH_PX = 190;
/** Angle de présentation par cran, en degrés. */
export const CAROUSEL_ANGLE_DEG = 34;
/** Nombre de paquets gardés visibles de part et d'autre du centre. */
export const CAROUSEL_VISIBILITY = 2;

/**
 * Emplacement d'un paquet dans l'arc. Un décalage de +1 est à droite du
 * centre : il recule, se réduit et pivote pour montrer sa face vers l'intérieur
 * de l'arc (à droite, donc `rotateY` positif éloigne le bord droit).
 */
export function carouselSlot(index: number, active: number): CarouselSlot {
  const offset = index - active;
  const distance = Math.abs(offset);
  return {
    x: offset * CAROUSEL_SPACING_PX,
    // `distance === 0` explicite : `-0 * 190` produirait un `-0`.
    z: distance === 0 ? 0 : -distance * CAROUSEL_DEPTH_PX,
    rotateY: offset * CAROUSEL_ANGLE_DEG,
    scale: 1 - distance * 0.14,
    hidden: distance > CAROUSEL_VISIBILITY,
  };
}

/** Déplacement horizontal (px) → nombre de crans parcourus. */
export function carouselDeltaToSlots(deltaPx: number): number {
  if (!CAROUSEL_SPACING_PX) return 0;
  return -deltaPx / CAROUSEL_SPACING_PX;
}

/**
 * Index sélectionné après relâcher : on se cale sur le cran le plus proche,
 * en bornant aux paquets réellement disponibles (l'arc n'est pas une boucle).
 */
export function carouselSnap(active: number, deltaPx: number, count: number): number {
  if (count <= 0) return 0;
  const target = active + Math.round(carouselDeltaToSlots(deltaPx));
  return clamp(target, 0, count - 1);
}
