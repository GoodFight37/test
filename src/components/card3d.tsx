"use client";

/**
 * Carte « 3D » : inclinaison au doigt, reflet holo qui suit l'angle, et
 * retournement dos/face.
 *
 * Trois nœuds imbriqués, chacun avec un seul rôle — c'est ce qui permet de
 * cumuler inclinaison et retournement sans qu'un `transform` n'écrase l'autre :
 *   .card3d          → perspective + écoute du geste
 *   .card3d-tilt     → rotateX / rotateY pilotés par le doigt
 *   .card3d-flipper  → rotateY(180deg) du retournement
 *
 * L'intensité des effets n'est pas codée en dur : `effectIntensity(rareté,
 * variante)` renvoie un 0 → 1 exposé en `--holo`, que le CSS utilise pour
 * l'opacité du reflet, la saturation du prisme et la force de la lueur. Une
 * Légendaire Gold brille donc bien plus qu'une Commune standard, sans règle
 * dupliquée côté style.
 */
import type { CSSProperties, ReactNode } from "react";
import { useTilt, type TiltMode } from "@/hooks/use-tilt";
import { RARITY_META, type CardVariant, type Rarity } from "@/lib/catalog";
import { PACK_TIMINGS, effectIntensity } from "@/lib/pack-animation";

/** Dos de carte CreatorDeck — dessin pur CSS, aucune image à embarquer. */
export function CardBack({ className = "" }: { className?: string }) {
  return (
    <div className={`card-back ${className}`} aria-hidden="true">
      <span className="card-back-grid" />
      <span className="card-back-halo" />
      <span className="card-back-mark">CD</span>
      <span className="card-back-word">CREATORDECK</span>
      <span className="card-back-sub">TOP 500 TWITCH FR</span>
    </div>
  );
}

export type Card3DProps = {
  /** Contenu de la face (en pratique un `<CreatorCard />`). */
  face: ReactNode;
  /** Contenu du dos. Par défaut le dos CreatorDeck. */
  back?: ReactNode;
  rarity: Rarity;
  variant: CardVariant;
  /** Faux = dos visible (carte encore dans la pile). Vrai par défaut. */
  faceUp?: boolean;
  onFlip?: () => void;
  mode?: TiltMode;
  /**
   * Angle de repos en degrés `{ x, y }` : la carte est alors tenue en 3/4
   * comme sur une vraie carte que l'on examine, et le doigt s'y ajoute.
   */
  restAngle?: { x: number; y: number };
  /** Coupe l'inclinaison (ex. carte déjà en cours d'animation de vol). */
  tilt?: boolean;
  /** Masque la pile de cartes sous la carte (carte unique). */
  stack?: boolean;
  className?: string;
  flipDurationMs?: number;
  style?: CSSProperties;
  /** Libellé du bouton de retournement accessible. */
  flipLabel?: string;
};

export function Card3D({
  face,
  back,
  rarity,
  variant,
  faceUp = true,
  onFlip,
  mode = "free",
  restAngle,
  tilt = true,
  stack = false,
  className = "",
  flipDurationMs = PACK_TIMINGS.cardRevealFlip,
  style,
  flipLabel = "Retourner la carte",
}: Card3DProps) {
  const { ref, handlers, dragging } = useTilt({
    mode,
    restX: restAngle?.x ?? 0,
    restY: restAngle?.y ?? 0,
    enabled: tilt && Boolean(onFlip),
    onTap: onFlip,
  });
  const hasRest = Boolean(restAngle);
  const layerCount = 10;

  const meta = RARITY_META[rarity];
  const variables = {
    // L'intensité des effets et la couleur du dos / de la lueur viennent du
    // catalogue : ajouter une rareté n'ajoute aucune règle de style.
    "--holo": effectIntensity(rarity, variant).toFixed(3),
    "--rarity": meta.color,
    "--rarity-glow": meta.glow,
    "--flip-ms": `${flipDurationMs}ms`,
    ...style,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      className={`card3d mode-${mode} ${faceUp ? "is-face-up" : "is-face-down"} ${
        dragging ? "is-dragging" : ""
      } ${hasRest ? "has-rest" : ""} ${className}`}
      style={variables}
      {...handlers}
    >
      <div className="card3d-tilt">
        {stack ? (
          <div className="card3d-stack" aria-hidden="true">
            {Array.from({ length: layerCount }, (_, index) => (
              <i key={index} style={{ "--i": index + 1 } as CSSProperties} />
            ))}
          </div>
        ) : null}
        <div className={`card3d-flipper ${faceUp ? "" : "is-face-down"}`}>
          <div className="card3d-face card3d-front">{face}</div>
          <div className="card3d-face card3d-back">{back ?? <CardBack />}</div>
        </div>
      </div>
      {onFlip ? (
        <button type="button" className="card3d-flip-button" onClick={onFlip}>
          {flipLabel}
        </button>
      ) : null}
    </div>
  );
}
