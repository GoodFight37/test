"use client";

/**
 * L'écran de révélation d'un booster (ou d'un Paquet Scène) : une carte à la
 * fois, avec ce que la mise en scène décide (`src/lib/reveal.ts`).
 *
 * Il vit dans son propre fichier pour une raison précise : il sert **deux**
 * écrans — le jeu sur téléphone, et l'overlay 16:9 qu'un streamer met dans OBS.
 * Les deux contextes n'ont qu'une différence, mais elle compte : l'overlay
 * n'offre **aucun raccourci**.
 */
import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronRight, Share2, Sparkles, X, Zap } from "lucide-react";
import { CreatorCard } from "@/components/creator-card";
import { EffectFlash } from "@/components/effect-burst";
import { useCloud } from "@/hooks/use-cloud";
import { useNow } from "@/hooks/use-game";
import { useLive } from "@/hooks/use-live";
import { usePresentationFocus } from "@/hooks/use-presentation-focus";
import { cloudStore } from "@/lib/cloud/cloud-store";
import { flashFor } from "@/lib/fx";
import { buzz } from "@/lib/haptics";
import { CREATOR_BY_SLUG, RARITY_META, type CardVariant, type Rarity } from "@/lib/catalog";
import { liveFor, viewersLabel } from "@/lib/live";
import { regionLabel } from "@/lib/regions";
import {
  deservesSpotlight,
  isPerfect,
  PERFECT_HAPTIC,
  PERFECT_LOCK_MS,
  revealHaptic,
  silenceBefore,
} from "@/lib/reveal";
import { playBang, playReveal } from "@/lib/sfx";
import { bestCardOf } from "@/lib/social/inbox";
import type { DrawnCard, StreakRewardGrant } from "@/lib/game-engine";
import { streakRewardLabel } from "@/lib/progression";
import { cardEffectsAllowed } from "@/lib/tilt";

export function RevealOverlay({
  cards,
  index,
  kind = "live",
  overlay = false,
  streakReward = null,
  onSkipAll,
  onNext,
  onClose,
  returnFocusTo,
}: {
  cards: DrawnCard[];
  index: number;
  /**
   * Ce que la série a payé pour ce booster (jour 1 → 6) : la récompense
   * s'annonce **pendant** la révélation, pas après — c'est le moment où elle
   * est gagnée, et c'est ce qui donne envie de revenir demain.
   */
  streakReward?: StreakRewardGrant | null;
  /** Quel paquet a été ouvert : le tirage rare ne se raconte pas pareil. */
  kind?: "live" | "scene";
  /**
   * Rendu dans l'overlay 16:9 (source navigateur d'un direct). Une seule
   * différence, mais elle compte : **pas de raccourci**. Devant un public, on
   * montre les cinq cartes ; c'est le jeu normal qui a le droit de sauter.
   */
  overlay?: boolean;
  /** Révèle les cinq cartes d'un coup — absent de l'overlay. */
  onSkipAll?: () => void;
  onNext: () => void;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}) {
  const dialogRef = usePresentationFocus(!overlay, returnFocusTo);
  const card = cards[index];
  const creator = card ? CREATOR_BY_SLUG.get(card.creatorSlug) : undefined;
  const live = useLive();
  const now = useNow(60_000);
  const cloud = useCloud();

  // La mise en scène vient de `src/lib/reveal.ts` : ici, on ne fait que
  // l'exécuter (jouer les sons, vibrer, verrouiller l'écran).
  const perfect = isPerfect(cards);
  const rarity = card?.rarity ?? "common";
  const newCardCount = cards.filter((item) => item.isNew).length;
  const [locked, setLocked] = useState(perfect);
  const [showSummary, setShowSummary] = useState(false);

  // Le son et la vibration de la carte. Le blanc de 400 ms devant une Épique ou
  // une Légendaire n'est pas une attente : c'est ce qui fait le bruit.
  useEffect(() => {
    if (!card || perfect) return;
    const silence = silenceBefore(card.rarity);
    const timer = window.setTimeout(() => {
      if (silence > 0) playBang(card.rarity, card.variant);
      else playReveal(card.rarity, card.variant);
      buzz(revealHaptic(card.rarity, card.variant));
    }, silence);
    return () => window.clearTimeout(timer);
  }, [card, perfect]);

  // Le Perfect : les cinq d'un coup, l'écran verrouillé deux secondes, et la
  // vibration la plus longue de l'application.
  useEffect(() => {
    if (!perfect) return;
    const best = bestCardOf(cards);
    playBang((best?.rarity as Rarity) ?? "epic", (best?.variant ?? "standard") as CardVariant);
    buzz(PERFECT_HAPTIC);
    const timer = window.setTimeout(() => setLocked(false), PERFECT_LOCK_MS);
    return () => window.clearTimeout(timer);
  }, [perfect, cards]);

  if (!card || !creator) return null;
  const isLast = index === cards.length - 1;
  /*
   * Sur un Perfect, les cinq cartes sont **déjà** à l'écran : il n'y a plus rien
   * à révéler. Le bouton qui dirait « Révéler la suivante » mentirait — il
   * ramènerait le joueur en arrière, sur la deuxième carte, alors qu'il vient
   * de voir les cinq. C'est exactement le bogue du 9 octobre 2026 : un joueur
   * ouvre un Perfect, voit cinq cartes d'un coup, appuie, et il ne se passe
   * rien de visible. Le paquet se range maintenant d'un coup.
   */
  const termine = perfect || isLast;
  const onAir = liveFor(live, creator.login, now);
  const spotlight = deservesSpotlight(card.rarity, perfect);
  // A soft aura lives BEHIND the rare cards. No pixel explosion overlays artwork.
  // Respect the existing rare-card audio pause for a synchronized entrance.
  const rareGlow = perfect || card.rarity === "epic" || card.rarity === "legendary";
  const rarityAura = rareGlow || card.rarity === "rare";
  const flash = flashFor(card.rarity, perfect);
  const glowDelay = perfect ? 0 : silenceBefore(card.rarity);
  const glowStyle = { "--rare-delay": `${glowDelay}ms` } as CSSProperties;

  function tiltRevealCard(event: PointerEvent<HTMLDivElement>) {
    if (!cardEffectsAllowed()) return;
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - .5) * 2));
    const y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - .5) * 2));
    target.style.setProperty("--reveal-tilt-x", `${-y * 13}deg`);
    target.style.setProperty("--reveal-tilt-y", `${x * 17}deg`);
    target.classList.add("is-tilting");
  }

  function resetRevealTilt(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.removeProperty("--reveal-tilt-x");
    event.currentTarget.style.removeProperty("--reveal-tilt-y");
    event.currentTarget.classList.remove("is-tilting");
  }

  // Une carte déjà révélée se range dès le premier appui.
  function advance() {
    if (locked) return;
    if (termine) {
      if (overlay) onClose();
      else setShowSummary(true);
    }
    else onNext();
  }

  const content = (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className={`reveal-overlay${overlay ? "" : ` reveal-game booster-presentation scene-${kind}`} reveal-rarity-${rarity}${perfect ? " reveal-perfect" : ""}${spotlight ? " reveal-spotlight" : ""}${showSummary ? " reveal-summary-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Résultat du booster"
    >
      <div className="reveal-ambient" />
      {rareGlow ? (
        <div key={card.id} className={`reveal-cinematic-field field-${perfect ? "perfect" : rarity}`}
          style={glowStyle} aria-hidden="true">
          <span className="reveal-field-corona" />
          <span className="reveal-field-rays" />
          <span className="reveal-field-orbit" />
          <span className="reveal-field-orbit reveal-field-orbit-second" />
        </div>
      ) : null}
      {flash ? <EffectFlash key={`flash-${card.id}`} /> : null}
      {perfect && !showSummary ? (
        <div className="perfect-banner" role="status">
          <Sparkles size={13} />
          <span>
            {kind === "scene"
              ? "Scène pleine : cinq Épiques de ta famille !"
              : "Booster Perfect : toutes les cartes sont Épique ou mieux !"}
          </span>
        </div>
      ) : null}
      {streakReward ? (
        <div className="streak-gain" role="status">
          <Zap size={13} />
          <span>
            Série <strong>J{streakReward.day}</strong> — {streakRewardLabel(streakReward)}
          </span>
        </div>
      ) : null}
      <div className="reveal-header">
        <span>{showSummary ? "RÉCAP" : perfect ? `${cards.length} / ${cards.length}` : `${index + 1} / ${cards.length}`}</span>
        <div className="reveal-dots">
          {cards.map((item, dotIndex) => {
            const shown = perfect || dotIndex <= index;
            const dotCard = CREATOR_BY_SLUG.get(item.creatorSlug);
            if (!dotCard) return null;
            return (
              <i
                key={item.id}
                className={shown ? "active" : ""}
                style={{ "--dot-color": RARITY_META[item.rarity].color } as CSSProperties}
              />
            );
          })}
        </div>
        {/* Le raccourci des cinq cartes : hors overlay seulement. Devant un
            public, on regarde la mise en scène jusqu'au bout. */}
        {!overlay && !perfect && !isLast ? (
          <button
            type="button"
            className="reveal-skip"
            onClick={onSkipAll}
            aria-label="Révéler les cinq cartes d'un coup"
          >
            ×{cards.length - index}
          </button>
        ) : null}
        <button onClick={onClose} aria-label="Fermer" disabled={locked}><X size={20} /></button>
      </div>

      {perfect && !showSummary ? (
        /* Les cinq cartes ensemble : c'est le moment, il n'y a rien à faire. */
        <div className="reveal-perfect-grid">
          {rareGlow ? (
            <span key={`rare-glow-${card.id}`} className="reveal-rare-aura reveal-rare-aura-perfect" style={glowStyle} aria-hidden="true" />
          ) : null}
          {cards.map((item) => {
            const dotCard = CREATOR_BY_SLUG.get(item.creatorSlug);
            return dotCard ? (
              <div key={item.id} className={`reveal-flip rarity-${item.rarity}`}>
                <div className="reveal-flip-face">
                  <CreatorCard
                    creator={dotCard}
                    variant={item.variant}
                    /*
                     * La rareté **tirée**, écrite en plus de celle du
                     * créateur : c'est elle qui décide du silence, du bang et
                     * de l'effet — l'entrée doit venir du même endroit, sinon
                     * une Légendaire pourrait arriver comme une commune.
                     */
                    className={`reveal-card rarity-${item.rarity}`}
                    liveStream={liveFor(live, dotCard.login, now)}
                  />
                  <span className="reveal-dos" aria-hidden="true">
                    <span className="reveal-back-sigil">✦</span>
                  </span>
                </div>
              </div>
            ) : null;
          })}
        </div>
      ) : showSummary ? (
        <section className="reveal-summary" aria-label="Résumé du booster">
          <div className="reveal-summary-copy" aria-live="polite">
            <span>BOOSTER OUVERT</span>
            <h2>{newCardCount} nouvelle{newCardCount === 1 ? "" : "s"}</h2>
            <p>{cards.length} cartes dans ta collection</p>
          </div>
          <div className="reveal-summary-grid">
            {cards.map((item) => {
              const itemCreator = CREATOR_BY_SLUG.get(item.creatorSlug);
              if (!itemCreator) return null;
              return (
                <div className={`reveal-summary-card rarity-${item.rarity}${item.isNew ? " is-new" : ""}`} key={item.id}>
                  <CreatorCard
                    creator={itemCreator}
                    variant={item.variant}
                    className={`summary-card-art rarity-${item.rarity}`}
                    compact
                  />
                  <span className="reveal-summary-card-name">{itemCreator.displayName}</span>
                  <span className="reveal-summary-card-rarity">{RARITY_META[item.rarity].label}</span>
                  {item.isNew ? <i aria-label="Nouvelle carte">NOUVELLE</i> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="reveal-stage">
          {rarityAura && !perfect ? (
            <div className={`reveal-rarity-kicker rarity-${card.rarity}`} aria-hidden="true"
              style={glowStyle}>
              <span>CARTE D&apos;EXCEPTION</span>
              <strong>{card.rarity === "legendary" ? "LÉGENDAIRE" : card.rarity === "epic" ? "ÉPIQUE" : "RARE"}</strong>
            </div>
          ) : null}
          {/* Light and geometry remain behind the artwork, never across the portrait. */}
          {rarityAura ? (
            <span key={`rare-glow-${card.id}`} className={`reveal-rare-aura reveal-rare-aura-${card.rarity}`} style={glowStyle} aria-hidden="true" />
          ) : null}
          {card.isNew ? <span className="new-badge"><Sparkles size={12} /> NOUVELLE</span> : null}
          <div className="reveal-anchor" style={glowStyle}
            onPointerMove={tiltRevealCard} onPointerLeave={resetRevealTilt}>
            <div key={card.id} className={`reveal-flip rarity-${card.rarity}`}>
              <div className="reveal-flip-face">
                <CreatorCard
                  creator={creator}
                  variant={card.variant}
                  // Idem : la rareté du tirage, pas seulement celle du créateur.
                  className={`reveal-card rarity-${card.rarity}`}
                  liveStream={onAir}
                />
                {/* Le dos : la face cachée de la carte, tant qu'elle n'est pas
                    retournée. Sans lui, une carte qui tourne ne montre jamais
                    qu'elle avait un dos. */}
                <span className="reveal-dos" aria-hidden="true">
                  <span className="reveal-back-sigil">✦</span>
                </span>
              </div>
            </div>
          </div>
          {/* Le rang, le nom et la région sont déjà sur la carte (tampon,
              nameplate). Ici : l'état, et rien d'autre. */}
          <div className="reveal-name">
            <p>
              {RARITY_META[card.rarity].label} · {regionLabel(creator.region)}
            </p>
            {/* Le meilleur moment de l'ouverture : la carte tombe pendant que la
                personne est en train de streamer. En plein écran (Légendaire ou
                Perfect), le titre du direct prend la place du simple libellé. */}
            {onAir ? (
              spotlight ? (
                <p className="reveal-live-show">
                  <i aria-hidden="true" />
                  <b>{creator.displayName} est en direct</b>
                  <span>
                    {onAir.title ? `${onAir.title} · ` : ""}
                    {viewersLabel(onAir.viewers)}
                  </span>
                </p>
              ) : (
                <p className="reveal-live">
                  <i aria-hidden="true" />
                  {onAir.gameName
                    ? `En direct maintenant · ${onAir.gameName} · ${viewersLabel(onAir.viewers)}`
                    : `En direct maintenant · ${viewersLabel(onAir.viewers)}`}
                </p>
              )
            ) : null}
            {/* Le tirage réserve toujours la dernière carte : le dire évite de
                croire à un hasard, et annonce le moment fort du paquet. */}
            {isLast && !perfect ? (
              <span className="reveal-guaranteed">Carte garantie du booster</span>
            ) : null}
          </div>
          {/* L'affiche : le geste qui garde la trace d'un moment rare. Elle ne
              s'affiche que si un compte existe (c'est lui qui a un profil à
              dessiner), et seulement sur un Légendaire ou un Perfect. */}
          {spotlight && cloud.configured && cloud.userId && !overlay ? (
            <button
              type="button"
              className="reveal-poster"
              onClick={() => {
                // Le profil public lit l'identifiant hors du rendu : on le
                // capture ici, sinon TypeScript ne peut pas savoir qu'il existe.
                const selfId = cloud.userId;
                if (!selfId) return;
                onClose();
                void cloudStore.openProfile(selfId);
              }}
            >
              <Share2 size={15} />
              <span>Faire une affiche</span>
            </button>
          ) : null}
        </div>
      )}

      <button
        className={`reveal-next${locked ? " locked" : ""}`}
        onClick={showSummary ? onClose : advance}
        disabled={locked}
        // La barre du verrou lit la durée du module de mise en scène : une
        // seule vérité, sinon elle finirait avant le bouton ou après lui.
        style={{ "--lock-ms": `${PERFECT_LOCK_MS}ms` } as CSSProperties}
      >
        <span>
          {showSummary
            ? "Retour au Drop"
            : locked
            ? "Perfect…"
            : termine
                ? "Ranger dans le classeur"
                : "Révéler la suivante"}
        </span>
        {showSummary ? (
          <Sparkles size={18} />
        ) : locked ? (
          <Sparkles size={18} />
        ) : termine ? (
          <BookOpen size={18} />
        ) : (
          <ChevronRight size={18} />
        )}
      </button>
    </div>
  );
  // Le jeu et le sachet partagent le viewport. OBS garde son cadre 16:9.
  return overlay ? content : createPortal(content, document.body);
}
