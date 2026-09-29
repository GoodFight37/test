"use client";

/**
 * Booster 3D « comme un vrai » — sachet soufflé et scellé, pas un rectangle
 * plat.
 *
 * Géométrie (CSS 3D, `preserve-3d`) :
 *
 *     ┌─ soudures dentelées (crimp haut / bas) ─┐   ← clip-path pur, testé
 *     │                                         │
 *     ├── face avant : visuel imprimé ──────────┤  translateZ(+épaisseur)
 *     │   bord latéral (épaisseur du sachet)    │
 *     ├── face arrière : couture + visuel ──────┤  translateZ(-épaisseur)
 *     └─────────────────────────────────────────┘
 *
 * La matière métallique est une superposition de trois couches :
 *  - `.booster-foil`   : spéculaires diagonales en `screen`, qui suivent
 *                        l'orientation via `--sheen` ;
 *  - `.booster-gloss`  : reflet balayant le sachet (celui qui « tourne » quand
 *                        on fait glisser le carrousel) ;
 *  - `.booster-shade`  : assombrissement des bords, pour arrondir la forme.
 *
 * Le visuel imprimé est celui du jeu (`PackArtwork` : portraits et charte
 * CreatorDeck) — c'est sa propre charte graphique qui sert de packaging.
 */
import type { CSSProperties, ReactNode } from "react";
import { PackArtwork } from "@/components/pack-artwork";
import { crimpClipPath } from "@/lib/pack-animation";
import type { PackType } from "@/lib/catalog";

/** Découpes de soudure, calculées une seule fois : forme pure, pas de DOM. */
const CRIMP_TOP = crimpClipPath(24, "top");
const CRIMP_BOTTOM = crimpClipPath(24, "bottom");

export type Booster3DProps = {
  packType: PackType;
  className?: string;
  /** 0 → 1 : orientation du sachet, pilote le balayage du reflet. */
  sheen?: number;
  style?: CSSProperties;
  /** Un reflet en miroir sous le paquet (carrousel sur sol vitré). */
  reflection?: boolean;
  /** Contenu surligné par-dessus (badge « choisi », etc.). */
  children?: ReactNode;
};

export function Booster3D({
  packType,
  className = "",
  sheen = 0.5,
  style,
  reflection = false,
  children,
}: Booster3DProps) {
  const variables = {
    "--sheen": sheen.toFixed(3),
    "--crimp-top": CRIMP_TOP,
    "--crimp-bottom": CRIMP_BOTTOM,
    ...style,
  } as CSSProperties;

  const pouch = (
    <div className={`booster3d booster-${packType} ${className}`} style={variables}>
      <div className="booster-shell">
        <div className="booster-face booster-front">
          <PackArtwork packType={packType} className="booster-art" />
          <span className="booster-wrinkle" aria-hidden="true" />
        </div>
        <div className="booster-face booster-back" aria-hidden="true">
          <span className="booster-back-panel" />
          <span className="booster-seam" />
        </div>
        <span className="booster-edge booster-edge-left" aria-hidden="true" />
        <span className="booster-edge booster-edge-right" aria-hidden="true" />
      </div>

      {/* Soudures scellées, en surface pour éviter le z-fighting. */}
      <span className="booster-crimp booster-crimp-top" aria-hidden="true" />
      <span className="booster-crimp booster-crimp-bottom" aria-hidden="true" />
      <span className="booster-seal booster-seal-top" aria-hidden="true" />
      <span className="booster-seal booster-seal-bottom" aria-hidden="true" />

      {/* Couches de matière, au-dessus de l'impression. */}
      <span className="booster-foil" aria-hidden="true" />
      <span className="booster-gloss" aria-hidden="true" />
      <span className="booster-shade" aria-hidden="true" />

      {children}
    </div>
  );

  if (!reflection) return pouch;

  return (
    <div className="booster-with-reflection">
      {pouch}
      <div className="booster-reflection" aria-hidden="true">
        <Booster3D packType={packType} sheen={sheen} />
      </div>
    </div>
  );
}
