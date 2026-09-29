/**
 * Constantes mesurées sur les **vraies animations d'ouverture** de
 * Pokémon TCG Pocket, extraites du dépôt de l'utilisateur `GoodFight37/pkmn`
 * (clips Unity `AnimationClip/*.anim`, 30 i/s) via
 * `scripts/extract-pocket-anim.py`.
 *
 * Ce module est la source de vérité « gameplay d'origine » : `PACK_TIMINGS`
 * (dans `pack-animation.ts`) en dérive pour tout ce qui touche à
 * l'ouverture, et `pocket-anim.test.ts` verrouille la correspondance.
 *
 * Aucune ressource binaire n'est copiée ici : uniquement des **nombres**
 * (durées, angles, courbes) relevés sur les clips.
 */
export const POCKET_CLIPS = {
  /** Lévitation du pack fermé : boucle sinusoïdale continue. */
  float: {
    clip: "C_PackOpen_Pack_float",
    cycleMs: 3333,
    /** Amplitude en unités monde du jeu (0,0119 u) — reconvertie en px côté CSS. */
    unitAmplitude: 0.01187,
    loop: true,
  },

  /** Rock avant l'ouverture (déclenché), jamais en boucle. */
  sway: {
    clip: "C_PackOpen_Pack_sway_01",
    durationMs: 833,
    yawDeg: 11.56,
    pitchDeg: -9.33,
  },

  /** Retournement d'une carte à la révélation : swing court, sortie franche. */
  flip: {
    clip: "C_CardGet_Card_flip_L",
    clipMs: 500,
    fromYawDeg: -71.6,
    toYawDeg: 0,
    /**
     * Progression relevée (t normalisé → angle normalisé) :
     * 0,13 → 0,49 · 0,25 → 0,80 · 0,38 → 0,92 · 0,50 → 0,98.
     * Equivalent CSS : easeOutQuint.
     */
    ease: "cubic-bezier(0.22, 1, 0.36, 1)",
  },

  /** Montée des cartes hors du pack (le clip attend ~800 ms que le pack s'ouvre). */
  cardRise: {
    clip: "C_PackOpen_Card_cardappear_front_01",
    clipMs: 1667,
    holdMs: 800,
    riseMs: 867,
    toWorldY: 3.726,
    /** Progression : 0,31 → 0,24 · 0,61 → 0,80 · 0,92 → 1,00 ≈ ease-in-out. */
    ease: "cubic-bezier(0.45, 0, 0.55, 1)",
  },

  /** Ouverture des quatre volets du sachet (mécanique différente de notre
   *  déchirure au doigt, durée et sortie gardées comme référence). */
  flapOpen: {
    clip: "C_PackOpen_Pack_open_frontL_01",
    durationMs: 1167,
    swingDeg: 180,
  },

  /** Balayage de la carte à l'écran de obtention (swipe vers la suivante). */
  cardSwing: {
    clip: "C_CardGet_Card_front_01",
    durationMs: 2167,
    fromYawDeg: -77.2,
    toYawDeg: 61.5,
  },
} as const;
