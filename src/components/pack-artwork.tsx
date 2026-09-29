"use client";

import type { CSSProperties } from "react";
import Image from "next/image";
import { Archive, Radio } from "lucide-react";
import { CREATORS, PACKS, creatorImage, type PackType } from "@/lib/catalog";

/**
 * Visuel d'un booster fermé.
 *
 * Extrait de `creator-deck-app.tsx` pour être réutilisé tel quel par la
 * cinématique d'ouverture (`pack-opening.tsx`) : le pack que l'on déchire est
 * exactement celui de l'accueil, ce qui évite deux directions artistiques.
 * `className` permet à la cinématique d'ajouter ses couches de déchirure.
 */
export function PackArtwork({
  packType,
  className = "",
}: {
  packType: PackType;
  className?: string;
}) {
  const people =
    packType === "live"
      ? [CREATORS[0], CREATORS[1], CREATORS[2]]
      : [CREATORS[5], CREATORS[6], CREATORS[7]];
  return (
    <div className={`pack-artwork pack-${packType} ${className}`}>
      <div className="pack-noise" />
      <div className="pack-orbit one" />
      <div className="pack-orbit two" />
      <div className="pack-people">
        {people.map((creator, index) => (
          <Image
            key={creator.slug}
            src={creatorImage(creator)}
            alt=""
            width={92}
            height={122}
            quality={88}
            sizes="92px"
            style={{ "--person-index": index } as CSSProperties}
          />
        ))}
      </div>
      <div className="pack-brand">
        <span>CREATOR</span>
        <strong>DECK</strong>
      </div>
      <div className="pack-edition">
        {packType === "live" ? <Radio size={13} /> : <Archive size={13} />}
        {packType === "live" ? "TOP 500 LIVE" : "ARCHIVES 500"}
      </div>
      <small>{PACKS[packType].size} CARTES</small>
    </div>
  );
}
