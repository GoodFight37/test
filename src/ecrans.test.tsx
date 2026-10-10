/**
 * Le banc d'essai **des écrans** : l'application montée dans un DOM, parcourue
 * comme au doigt.
 *
 * Pourquoi il existe : ce dépôt se travaille sans navigateur (l'environnement de
 * développement n'en a pas, et `next build` ne pré-rend que l'accueil). Avant
 * lui, un découpage de composant — déplacer une vue dans son fichier, sortir une
 * feuille — ne pouvait être vérifié qu'en installant l'APK. Ici, les quatre
 * piliers s'ouvrent, les feuilles s'ouvrent, un booster se tire, et chacun dit
 * ce qu'il doit dire.
 *
 * L'horloge et le hasard sont **figés** : deux exécutions produisent le même
 * HTML. C'est ce qui permet de garder une copie des écrans pour comparer avant
 * et après un découpage :
 *
 *   ECRANS_DUMP=/tmp/avant npm run ecrans
 *   # ... découpage ...
 *   ECRANS_DUMP=/tmp/apres npm run ecrans && diff -r /tmp/avant /tmp/apres
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creerBanc, type Banc } from "@/ecrans-banc";

/** Un jeudi midi : ni fin de série, ni fenêtre de Prime Time (20 h – 22 h). */
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);

describe("les écrans", () => {
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

  async function application() {
    const { CreatorDeckApp } = await import("@/components/creator-deck-app");
    await banc.monter(<CreatorDeckApp />);
  }

  it("ouvre les quatre piliers, chacun avec son écran", async () => {
    await application();
    const drop = banc.ecran("01-accueil");
    expect(drop).toContain("Ouvrir le booster");
    expect(drop).toContain("OBJECTIF DU JOUR");

    banc.appuyer("Binder");
    const binder = banc.ecran("02-binder");
    expect(binder).toContain("binder-tools");
    expect(binder).toContain("Ta collection commence avec le prochain booster.");

    banc.appuyer("Craft");
    expect(banc.ecran("03-craft")).toContain("Façonne ta collection");

    // **Quatre piliers, et rien d'autre** : la simulation de streameur
    // (« Ta chaîne ») a quitté l'application le 8 octobre 2026 — ni onglet, ni
    // ligne d'accueil, ni écran. La barre porte les quatre piliers, et son
    // ordre est celui du jeu.
    expect(
      [...document.querySelectorAll(".bottom-nav button span")].map((n) => n.textContent),
    ).toEqual(["Drop", "Binder", "Craft", "Toi"]);

    banc.appuyer("Toi");
    // L'écran Toi ne nomme plus l'infrastructure : on y entre par « Mon compte ».
    const profile = banc.ecran("04-toi");
    expect(profile).toContain("Mon compte");
    expect(profile).toContain("Ta vitrine");
    expect(profile).toContain("Ta première carte t’attend.");
    expect(profile).toMatch(/Version (?:[0-9a-f]{7}|locale)/);
    expect(profile).not.toContain("0/1000");
    expect(profile).not.toContain("0 boosters");
  });

  it("ouvre les feuilles : le compte, les objectifs, les taux", async () => {
    await application();
    banc.appuyer("Toi");

    banc.appuyer("Mon compte");
    // Sans rien en ligne, la feuille le dit au lieu de proposer une connexion —
    // et elle le dit en français de jeu, pas en vocabulaire d'atelier.
    const feuille = banc.ecran("05-compte");
    expect(feuille).toContain("Mon compte");
    expect(feuille).toContain("Joue pour toi, sur cet appareil");
    for (const mot of ["cloud", "Supabase", "serveur", ".json", ".sql", "token"]) {
      expect(feuille.toLowerCase()).not.toContain(mot);
    }
    banc.fermer();

    banc.appuyer("Objectifs et saisons");
    expect(banc.ecran("06-objectifs")).toContain("Progression");

    banc.appuyer("Toi");
    banc.appuyer("Taux de drop");
    expect(banc.ecran("07-taux")).toContain("Taux de drop des boosters");
    banc.fermer();
  });

  it("présente le tutoriel court avant l'accueil et affiche le cadeau distinct ensuite", async () => {
    window.localStorage.setItem("creatordeck-tutorial:local", "done");
    await application();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(document.body.textContent).not.toContain("CREATORDECK · PREMIERS PAS");
    banc.vider();
    window.localStorage.clear();
    await application();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(document.body.textContent).toContain("CREATORDECK · PREMIERS PAS");
    expect(document.body.textContent).toContain("1 / 3");
    banc.appuyer("Continuer");
    expect(document.body.textContent).toContain("Construis ton Binder");
    banc.appuyer("Continuer");
    expect(document.body.textContent).toContain("Reviens au Drop");
    banc.appuyer("Terminer");
    expect(document.body.textContent).not.toContain("Un cadeau t’attend");
    expect(window.localStorage.getItem("creatordeck-tutorial:local")).toBe("done");
    expect(window.localStorage.getItem("creatordeck-tutorial:completed:local")).toBe("done");
  });

  it("tire un booster et montre la révélation", async () => {
    await application();
    banc.appuyer("Ouvrir le booster");
    // Le tirage passe par des temporisations (silence, déchirure) : l'horloge
    // figée doit avancer à la main, sinon l'écran de révélation n'arrive jamais.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(document.querySelector(".booster-interactive"), "le booster attend le geste du joueur").toBeTruthy();
    banc.appuyer("Ouvrir sans déchirer");
    await act(async () => {
      // Le couvercle se détache, les dos sortent, puis la transition termine à 1,9 s.
      await vi.advanceTimersByTimeAsync(2_100);
    });
    const revelation = banc.ecran("08-revelation");
    expect(revelation).toContain("card-nameplate");
    // Le booster hors ligne n'est pas perdu : il sort de la réserve du jour.
    expect(revelation).toContain("cartes · 1 Rare ou mieux garantie");
  });

  it("déchire le paquet avant de montrer la première carte", async () => {
    await application();
    banc.appuyer("Ouvrir le booster");
    // Le tirage local observe un suspense de 650 ms : à 700 ms, les cartes sont
    // tirées et le paquet est en train de s'ouvrir à l'écran.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const dechirure = document.querySelector(".pack-tear");
    expect(dechirure, "le paquet ne s'ouvre jamais à l'écran").toBeTruthy();
    // Le booster est une vraie enveloppe et attend le geste, pas un chronomètre.
    expect(dechirure!.querySelectorAll(".foil-printed-art").length, "sachet imprimé bord à bord").toBe(2);
    expect(dechirure!.querySelectorAll(".foil-back-card").length, "les cinq dos sont présents").toBe(5);
    expect(dechirure!.querySelector(".booster-tear-track"), "la zone de passage du doigt doit exister").toBeTruthy();
    expect(dechirure!.querySelector(".booster-card-extract"), "plus de fausse carte CD").toBeNull();
    banc.ecran("11-dechirure");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(document.querySelector(".pack-tear"), "le booster ne doit pas s'ouvrir tout seul").toBeTruthy();
    expect(document.querySelector(".reveal-overlay")).toBeNull();

    banc.appuyer("Ouvrir sans déchirer");
    await act(async () => {
      // Le couvercle se détache, les dos sortent, puis la transition termine à 1,9 s.
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(document.querySelector(".pack-tear"), "la déchirure ne s'arrête jamais").toBeNull();
    expect(document.querySelector(".reveal-overlay")).toBeTruthy();
  });

  it("rend deux fois le même HTML (l'horloge et le hasard sont figés)", async () => {
    await application();
    const premier = banc.ecran("09-determinisme-a");
    banc.vider();
    await application();
    expect(banc.ecran("09-determinisme-b")).toBe(premier);
  });
});
