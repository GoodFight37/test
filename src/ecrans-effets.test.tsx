/**
 * Les effets de **moment rare**, montés pour de vrai : l'éclat d'une Épique,
 * l'éclat en grand (et l'écran blanc) d'une Légendaire, et rien du tout sur
 * une carte ordinaire.
 *
 * Ce banc monte `RevealOverlay` directement, avec des cartes écrites à la main :
 * c'est le seul moyen de choisir la rareté. Le tirage, lui, a ses propres bancs
 * (`src/lib/pull.test.ts`, `src/ecrans.test.tsx`).
 *
 * Ce qui compte ici :
 *
 *   * **le rare se mérite** — pas d'effet sous l'Épique ;
 *   * l'effet est **branché sur le son** : le retard vaut le silence de la
 *     rareté, sinon on verrait les étincelles avant d'entendre le bang ;
 *   * l'effet **part** (l'animation est bornée), il ne tourne pas en boucle.
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerBanc, type Banc } from "@/ecrans-banc";
import { PERFECT_LOCK_MS } from "@/lib/reveal";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_exemple_de_banc_d_essai_0000";
});

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);

type Rarete = "common" | "uncommon" | "rare" | "epic" | "legendary";

/** Une carte tirée, réduite à ce que la révélation regarde. */
function carte(rarity: Rarete, id: string = rarity) {
  return {
    id,
    creatorSlug: "kamet0",
    rarity,
    variant: "standard" as const,
    isNew: false,
    rareDrop: false,
  };
}

describe("les effets de révélation", () => {
  let banc: Banc;

  beforeEach(() => {
    vi.useFakeTimers({ now: T0 });
    banc = creerBanc();
    banc.preparer();
  });

  afterEach(() => {
    banc.nettoyer();
    vi.useRealTimers();
  });

  async function reveler(cards: ReturnType<typeof carte>[], index = 0) {
    const { RevealOverlay } = await import("@/components/reveal-overlay");
    await banc.monter(
      <RevealOverlay
        cards={cards as never}
        index={index}
        overlay
        onNext={() => {}}
        onClose={() => {}}
      />,
    );
    return banc.ecran(`reveal-${cards[index]?.rarity}-${cards[index]?.id}`);
  }

  it("ne met rien du tout sur une carte ordinaire", async () => {
    // Le point qui compte : des étincelles sur du commun rendraient la
    // Légendaire ordinaire.
    const html = await reveler([carte("common")]);
    expect(html).not.toContain("fx-burst");
    expect(html).not.toContain("reveal-rare-aura");
    expect(html).not.toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-flash");
  });

  it("donne au Rare son aura bordeaux, sans flash d'Épique", async () => {
    const html = await reveler([carte("rare")]);
    expect(html).toContain("reveal-rare-aura-rare");
    expect(html).toContain("RARE");
    expect(html).not.toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-flash");
  });

  it("donne un éclat à l'Épique, sans écran blanc", async () => {
    const html = await reveler([carte("epic")]);
    expect(html).toContain("reveal-rare-aura");
    expect(html).toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-burst");
    // La planche est décrite **en CSS** (nombre d'images, durée) : ce qui est
    // écrit dans le document, c'est la taille et le retard.
    expect(html).toContain("--rare-delay: 520ms");
    // Pas de flash : une Épique n'a pas droit au plein écran.
    expect(html).not.toContain("fx-flash");
  });

  it("donne le même éclat **en plus grand**, et l'écran blanc, à la Légendaire", async () => {
    // L'explosion dorée est partie le 9 octobre 2026 : le joueur ne la trouvait
    // pas belle. Le Légendaire garde l'éclat de l'Épique, une fois et demie
    // plus grand — la taille fait la hiérarchie, plus un autre dessin.
    const html = await reveler([carte("legendary")]);
    expect(html).toContain("reveal-rare-aura");
    expect(html).toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-burst");
    expect(html).not.toContain("fx-explosion");
    expect(html).toContain("fx-flash");
    expect(html).toContain("reveal-rare-aura-legendary");
  });

  it("écrit la rareté sur la carte, pour que l'entrée la suive", async () => {
    // Le CSS accroche l'animation sur `.reveal-card.rarity-legendary` : sans la
    // classe dans le document, une Légendaire entrerait comme une commune. La
    // classe est posée par `CreatorCard` — ce test vérifie que les deux se
    // rencontrent bien sur le **même** élément.
    const legende = await reveler([carte("legendary")]);
    const classes = /class="([^"]*reveal-card[^"]*)"/.exec(legende)?.[1] ?? "";
    expect(classes, "aucune carte révélée").toContain("reveal-card");
    expect(classes, `la rareté n'est pas sur la carte : ${classes}`).toContain("rarity-legendary");

    banc.vider();
    banc.preparer();
    const commune = await reveler([carte("common")]);
    const classesCommunes = /class="([^"]*reveal-card[^"]*)"/.exec(commune)?.[1] ?? "";
    expect(classesCommunes, `la rareté n'est pas sur la carte : ${classesCommunes}`).toContain(
      "rarity-common",
    );
  });

  it("cale l'effet sur le son : le retard est le silence de la rareté", async () => {
    // `silenceBefore()` vaut 520 ms pour une Épique ou une Légendaire : l'éclat
    // part avec le bang, pas avant.
    const epique = await reveler([carte("epic")]);
    expect(epique).toContain("--rare-delay: 520ms");

    banc.vider();
    banc.preparer();
    const legendaire = await reveler([carte("legendary")]);
    expect(legendaire).toContain("--rare-delay: 520ms");
    // Et la taille suit la rareté : l'éclat d'une Légendaire vaut une fois et
    // demie celui d'une Épique (280 px → 420 px). Les deux débordent
    // largement de la carte, sinon elle les cache.
    expect(legendaire).toContain("reveal-rare-aura-legendary");
    expect(epique).toContain("reveal-rare-aura-epic");
    // La durée vient de `FX_SHEETS`, écrite en ligne : 40 ms par image, de
    // quoi laisser le temps de voir.
    expect(legendaire).not.toContain("fx-burst");
  });

  it("joue l'éclat en grand d'emblée sur un Perfect, sans silence", async () => {
    // Le Perfect est le paquet entier : il n'a pas de silence, il est le moment.
    const cinq = [carte("epic", "a"), carte("epic", "b"), carte("epic", "c"), carte("epic", "d"), carte("epic", "e")];
    cinq[0]!.rareDrop = true;
    const html = await reveler(cinq as never);
    expect(html).toContain("reveal-rare-aura");
    expect(html).toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-burst");
    // Tout le paquet est rare : l'éclat est à sa taille maximale.
    expect(html).toContain("reveal-rare-aura-perfect");
    expect(html).toContain("--rare-delay: 0ms");
    // Le blanc du Perfect est déjà là depuis le verrouillage… et l'effet part
    // au premier rendu, pas après un temps d'attente.
    expect(html).toContain("fx-flash");
  });

  it("récapitule les cinq cartes du Perfect et permet de rouvrir", async () => {
    /*
     * Le bogue du 9 octobre 2026 : un joueur ouvre un booster, les **cinq**
     * cartes apparaissent ensemble — c'est le tirage Perfect, voulu — et le
     * bouton du bas propose « Révéler la suivante ». Il n'y a plus rien à
     * révéler : l'appui ne faisait rien de visible, le joueur croyait à une
     * panne. Quand les cinq sont à l'écran, le paquet se **range**.
     */
    const suivant = vi.fn();
    const fermer = vi.fn();
    const cinq = [carte("epic", "a"), carte("epic", "b"), carte("epic", "c"), carte("epic", "d"), carte("epic", "e")];
    cinq[0]!.rareDrop = true;
    cinq[2]!.isNew = true;
    const { RevealOverlay } = await import("@/components/reveal-overlay");
    await banc.monter(
      <RevealOverlay cards={cinq as never} index={0} onNext={suivant} onClose={fermer} />,
    );

    const bouton = () => document.querySelector<HTMLButtonElement>(".reveal-next")!;
    // Pendant le verrou, le bouton est bien verrouillé — mais il **montre**
    // l'attente (classe `locked` + barre) au lieu de ressembler à une panne.
    expect(bouton().disabled, "le verrou du Perfect ne verrouille plus").toBe(true);
    expect(bouton().className).toContain("locked");
    expect(bouton().style.getPropertyValue("--lock-ms")).toBe(`${PERFECT_LOCK_MS}ms`);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERFECT_LOCK_MS + 50);
    });

    expect(bouton().disabled, "le Perfect reste verrouillé").toBe(false);
    expect(bouton().textContent).toContain("Ranger dans le classeur");
    expect(bouton().textContent).not.toContain("Révéler la suivante");
    banc.ecran("12-perfect-range");

    banc.appuyer("Ranger dans le classeur");
    expect(fermer, "le récapitulatif ferme trop tôt").not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("1 nouvelle");
    expect(document.querySelectorAll(".reveal-summary-card")).toHaveLength(5);
    expect(bouton().textContent).toContain("Retour au Drop");
    banc.appuyer("Retour au Drop");
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(suivant, "le Perfect repart en arrière").not.toHaveBeenCalled();
  });

  it.each(["rare", "epic", "legendary"] as const)("range la dernière carte %s dès le premier appui", async (rarity) => {
    const fermer = vi.fn();
    const suivant = vi.fn();
    const { RevealOverlay } = await import("@/components/reveal-overlay");
    await banc.monter(
      <RevealOverlay cards={[carte("common", "un"), carte(rarity, "deux")] as never}
        index={1} onNext={suivant} onClose={fermer} />,
    );
    banc.ecran(`jeu-derniere-${rarity}`);
    banc.appuyer("Ranger dans le classeur");
    expect(document.body.textContent).toContain("RÉCAP");
    expect(document.body.textContent).toContain("2 cartes dans ta collection");
    expect(document.querySelector<HTMLButtonElement>(".reveal-next")?.textContent).toContain("Retour au Drop");
    banc.appuyer("Retour au Drop");
    expect(fermer).toHaveBeenCalledTimes(1);
    expect(suivant).not.toHaveBeenCalled();
  });

  it("révèle la suivante tant que le paquet n'est pas terminé", async () => {
    // Le contrôle du test précédent : hors Perfect, « Révéler la suivante »
    // reste le geste normal — c'est le Perfect seul qui change de bouton.
    const suivant = vi.fn();
    const { RevealOverlay } = await import("@/components/reveal-overlay");
    await banc.monter(
      <RevealOverlay
        cards={[carte("common", "un"), carte("rare", "deux")] as never}
        index={0}
        onNext={suivant}
        onClose={() => {}}
      />,
    );
    const bouton = () => document.querySelector<HTMLButtonElement>(".reveal-next")!;
    expect(bouton().textContent).toContain("Révéler la suivante");
    banc.ecran("jeu-commune");
    banc.appuyer("Révéler la suivante");
    expect(suivant).toHaveBeenCalledTimes(1);
  });

  it("se choisit sur la carte du moment, pas sur la première du paquet", async () => {
    // Un paquet où la Légendaire est en deuxième position : à l'index 1, c'est
    // bien l'explosion qu'on doit voir. Le rejeu de l'animation, lui, tient à
    // la clé (`key={card.id}`) — le choix de la carte, au calcul testé ici.
    const html = await reveler([carte("common", "un"), carte("legendary", "deux")], 1);
    expect(html).toContain("reveal-rare-aura");
    expect(html).toContain("reveal-cinematic-field");
    expect(html).not.toContain("fx-burst");
    expect(html).toContain("reveal-rare-aura-legendary");
    expect(html).toContain("fx-flash");
  });
});
