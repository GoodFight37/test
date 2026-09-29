"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import {
  creatorImage,
  formatFollowersCount,
  RARITY_META,
  VARIANT_META,
  type CardVariant,
  type Creator,
} from "@/lib/catalog";
import { LockKeyhole, Radio, Sparkles } from "lucide-react";

type CreatorCardProps = {
  creator: Creator;
  variant?: CardVariant;
  count?: number;
  locked?: boolean;
  compact?: boolean;
  className?: string;
};

export function CreatorCard({
  creator,
  variant = "standard",
  count = 1,
  locked = false,
  compact = false,
  className = "",
}: CreatorCardProps) {
  const rarity = RARITY_META[creator.rarity];
  const variantMeta = VARIANT_META[variant];
  const style = {
    "--rarity": rarity.color,
    "--rarity-glow": rarity.glow,
  } as CSSProperties;

  return (
    <article
      className={`creator-card ${variantMeta.className} ${locked ? "is-locked" : ""} ${compact ? "is-compact" : ""} ${className}`}
      style={style}
      aria-label={`${creator.displayName}, rang ${creator.rank}, ${rarity.label}${locked ? ", non obtenue" : ""}`}
    >
      <div className="card-foil" aria-hidden="true" />
      <div className="card-prism" aria-hidden="true" />
      <div className="card-photo-wrap">
        <Image
          className="card-photo"
          src={creatorImage(creator)}
          alt={`Portrait officiel de ${creator.displayName}`}
          fill
          quality={88}
          sizes={compact ? "(max-width: 560px) 31vw, 170px" : "(max-width: 560px) 68vw, 300px"}
        />
        <div className="card-photo-shade" />
      </div>

      <div className="card-topline">
        <span className="card-series">#{String(creator.rank).padStart(3, "0")}</span>
        <span className="card-rarity">{rarity.short}</span>
      </div>

      {variant !== "standard" && !locked ? (
        <span className={`variant-pill ${variantMeta.className}`}>
          {variant === "live" ? <Radio size={10} /> : <Sparkles size={10} />}
          {variantMeta.label}
        </span>
      ) : null}

      <div className="card-copy">
        <p>{creator.category}</p>
        <h3>{locked ? "???" : creator.displayName}</h3>
        <div className="card-footerline">
          <span>{locked ? rarity.label : formatFollowersCount(creator.followers)}</span>
          {!locked && count > 1 ? <strong>×{count}</strong> : null}
        </div>
      </div>

      {locked ? (
        <div className="card-lock" aria-hidden="true">
          <LockKeyhole size={compact ? 18 : 24} />
        </div>
      ) : null}
    </article>
  );
}
