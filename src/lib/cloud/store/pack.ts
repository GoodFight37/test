import type { CloudStoreContext } from "./context";
import type { PackOpenOutcome, CloudActionOutcome } from "./types";
import { CLOUD_DISABLED_HINT } from "@/lib/cloud/config";
import { CloudError } from "@/lib/cloud/api";
import { applyPackResult, applyScenePackResult, applyServerProgression, SAVE_VERSION } from "@/lib/game-engine";
import { sanitizeState } from "@/lib/save-store";

/**
 * Les actions « pack » du magasin cloud : mêmes corps qu'avant la
 * découpe, mais reçus par le contexte (`ctx`) au lieu d'être des méthodes
 * d'objet. Aucun comportement n'a changé.
 */
export function packActions(ctx: CloudStoreContext) {
  return {
    async onboardingStatus() {
      const api = ctx.resolve();
      if (!api?.session()) return null;
      return api.onboardingStatus();
    },

    async refreshOnboarding(): Promise<void> {
      const api = ctx.resolve();
      if (!api?.session()) { ctx.publish({ onboarding: null, onboardingBusy: false }); return; }
      ctx.publish({ onboardingBusy: true });
      try { ctx.publish({ onboarding: await api.onboardingStatus(), onboardingBusy: false }); }
      catch { ctx.publish({ onboardingBusy: false }); }
    },

    async completeTutorial() {
      const api = ctx.resolve();
      if (!api?.session()) return false;
      try { await api.completeTutorial(); await this.refreshOnboarding(); return true; }
      catch (error) { ctx.fail(error, "Fin du tutoriel impossible à synchroniser."); return false; }
    },

    async claimReturnGift(): Promise<CloudActionOutcome> {
      const api = ctx.resolve();
      if (!api?.session()) return { status: "unavailable", reason: "no-session", message: "Connecte-toi pour réclamer ton cadeau." };
      try {
        await api.claimReturnGift();
        await this.refreshOnboarding();
        return { status: "done", message: "Cadeau réclamé : 5 boosters attendent dans ta boîte cadeau." };
      } catch (error) { return ctx.cloudRefusal(error, "Cadeau indisponible."); }
    },

    async openReturnGiftPack(): Promise<PackOpenOutcome> {
      const api = ctx.resolve();
      if (!api?.session()) return { status: "unavailable", reason: "no-session", message: "Connecte-toi pour ouvrir le cadeau." };
      try {
        ctx.publish({ busy: true });
        const result = await api.openReturnGiftPack();
        await this.refreshOnboarding();
        const local = ctx.deps.readState();
        if (!local || result.cards.length !== 5) throw new CloudError("Le tirage cadeau est incomplet.", "invalid_response", 0);
        const receivedCards = result.cards.map((card, index) => ({
          id: `gift-${ctx.deps.now()}-${index}-${card.creatorSlug}`,
          creatorSlug: card.creatorSlug,
          rarity: card.rarity as "common"|"uncommon"|"rare"|"epic"|"legendary",
          variant: card.variant as "standard"|"live"|"holo"|"gold",
          obtainedAt: ctx.deps.now(),
          rareDrop: card.rareDrop,
          isNew: !local.cards.some((owned) => owned.creatorSlug === card.creatorSlug),
        }));
        const remoteSave = result.save;
        const remote = remoteSave ? sanitizeState(remoteSave.state, ctx.deps.now()) : null;
        if (remote && remoteSave) {
          ctx.deps.applyState(remote);
          ctx.publish({ busy: false, pending: false, decision: "noop", remoteUpdatedAt: Date.parse(remoteSave.updatedAt)||ctx.deps.now(), lastSyncAt: ctx.deps.now(), message: `Booster cadeau ouvert : encore ${result.giftRemaining}.`, isError: false });
          return { status: "drawn", cards: receivedCards, streakReward: null };
        }
        const next = { ...local, updatedAt: ctx.deps.now(), cards: [...local.cards, ...receivedCards] };
        ctx.deps.applyState(next);
        await ctx.push(next.version, next.updatedAt, false);
        ctx.publish({ busy: false, message: `Booster cadeau ouvert : encore ${result.giftRemaining}.`, isError: false });
        return { status: "drawn", cards: receivedCards, streakReward: null };
      } catch (error) {
        const message = error instanceof CloudError ? error.message : "Ouverture du cadeau impossible.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "error", message };
      }
    },

    /**
     * Ouvre un booster côté serveur : les cartes sont tirées par la fonction
     * `open_pack()` de Supabase, puis appliquées à la partie locale.
     *
     * Après le tirage, la sauvegarde est poussée immédiatement (pas d'attente
     * des ~20 s du debounce) : les cartes sont infalsifiables, il faut les
     * inscrire dans le cloud sans délai.
     *
     * Pas de repli silencieux : si le cloud est configuré mais injoignable (ou
     * sans compte), on ne tire rien en local — l'écran explique qu'il faut se
     * connecter.
     */
    async openPack(jackpot: "perfect" | "hourglasses" = "perfect"): Promise<PackOpenOutcome> {
      const api = ctx.resolve();
      if (!api) {
        const message = CLOUD_DISABLED_HINT;
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "not-configured", message };
      }
      if (!api.session()) {
        const message = "Connecte-toi pour ouvrir un booster.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "no-session", message };
      }
      ctx.publish({ busy: true });
      try {
        const result = await api.openPack(jackpot);
        const cards = result.cards.map((card) => ({
          creatorSlug: card.creatorSlug,
          rarity: card.rarity as "common" | "uncommon" | "rare" | "epic" | "legendary",
          variant: card.variant as "standard" | "live" | "holo" | "gold",
          rareDrop: card.rareDrop,
        }));
        const local = ctx.deps.readState();
        if (!local) {
          throw new CloudError("Partie locale illisible : rien n'a été tiré.", "invalid_response", 0);
        }
        let applied = applyPackResult(
          local,
          cards,
          result.packs,
          result.lastRegenAt,
          result.openings,
          ctx.deps.now(),
          {
            // Les points **et les jetons** de la récompense de série sont
            // versés par le serveur (`0032`, `0035`) : le moteur annonce, il ne
            // crédite pas. Et c'est **son** jour qui fait foi — celui de
            // l'appareil peut avoir dérivé.
            pointsFromServer: true,
            tokensFromServer: true,
            rewardDay: result.streakReward?.day ?? null,
            rewardPoints: result.streakReward?.points ?? null,
            rewardTokens: result.streakReward?.tokens ?? null,
          },
        );
        // Les compteurs du serveur font foi pour le plancher de malchance et
        // la série : c'est lui qui tire, c'est donc son compte qui est juste.
        // C'est ce qui garantit que « encore N boosters » à l'écran correspond
        // au booster que le serveur va réellement tirer.
        applied = {
          ...applied,
          state: applyServerProgression(
            applied.state,
            {
              pity: result.pity,
              streak: Number.isFinite(result.streak) && result.streak > 0
                ? result.streak
                : applied.state.streak,
            },
            ctx.deps.now(),
          ),
        };
        const message = `Booster ouvert : ${applied.cards.length} carte${applied.cards.length > 1 ? "s" : ""} reçue${applied.cards.length > 1 ? "s" : ""}.`;
        // Depuis `0022`, le serveur a **déjà** rangé les cinq cartes dans la
        // collection : il renvoie la ligne écrite, le client l'adopte. Pousser
        // par-dessus était le défaut d'avant — un plantage juste après le
        // tirage, ou un second appareil, repartait d'une collection sans les
        // cartes et les faisait disparaître.
        const remoteSave = result.save;
        const remote = remoteSave ? sanitizeState(remoteSave.state, ctx.deps.now()) : null;
        if (remote && remoteSave) {
          // Un ancien client peut encore avoir écrit une sauvegarde v8 sur le
          // serveur. La forme distante est la vérité pour les cartes et les
          // compteurs du tirage, mais le Tribunal (ajouté en v9) n'existait pas
          // dans ce blob : ne pas effacer la séance locale en adoptant la ligne.
          const remoteVersion = (remoteSave.state as { version?: unknown }).version;
          const adopted =
            typeof remoteVersion === "number" && remoteVersion < SAVE_VERSION
              ? { ...remote, tribunal: local.tribunal }
              : remote;
          ctx.deps.applyState(adopted);
          ctx.publish({
            busy: false,
            pending: false,
            decision: "noop",
            remoteUpdatedAt: Date.parse(remoteSave.updatedAt) || ctx.deps.now(),
            lastSyncAt: ctx.deps.now(),
            message,
            isError: false,
          });
          return { status: "drawn", cards: applied.cards, streakReward: applied.streakReward };
        }
        // Projet sans `0022` : l'ancien chemin reste le seul possible — le
        // client envoie sa collection (sans forcer, donc jamais par-dessus une
        // partie plus récente qu'il n'a pas vue).
        ctx.deps.applyState(applied.state);
        await ctx.push(applied.state.version, applied.state.updatedAt, false);
        ctx.publish({ busy: false, message, isError: false });
        return { status: "drawn", cards: applied.cards, streakReward: applied.streakReward };
      } catch (error) {
        // Réseau coupé : même consigne que sans compte — se connecter.
        if (error instanceof CloudError && error.status === 0) {
          const message = "Connecte-toi pour ouvrir un booster.";
          ctx.publish({ busy: false, message, isError: true });
          return { status: "unavailable", reason: "offline", message };
        }
        // Le serveur a refusé faute de booster : on relit la réserve pour
        // réaligner le compteur et le compte à rebours affichés (sans rien
        // consommer) avant d'expliquer.
        if (error instanceof CloudError && /aucun booster/i.test(error.message)) {
          await ctx.fetchPackStatus();
          ctx.publish({ busy: false, message: error.message, isError: true });
          return { status: "unavailable", reason: "no-packs", message: error.message };
        }
        const message = error instanceof CloudError ? error.message : "Ouverture du booster impossible.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "error", message };
      }
    },

    /**
     * Ouvre le **Paquet Scène** du jour.
     *
     * Le tirage appartient au serveur, mais pas à sa main : il donne les choix
     * (cinq listes, raretés et variantes comprises), le client tire une carte
     * dans chaque liste — c'est là que passe l'aléa du joueur —, puis le serveur
     * vérifie et normalise. La collection locale n'est donc jamais crue sur
     * parole : tout ce qui est rangé vient de la réponse du serveur.
     */
    async openScenePack(family: string): Promise<PackOpenOutcome> {
      const api = ctx.resolve();
      if (!api) {
        const message = CLOUD_DISABLED_HINT;
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "not-configured", message };
      }
      if (!api.session()) {
        const message = "Connecte-toi pour ouvrir ton Paquet Scène.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "no-session", message };
      }
      ctx.publish({ busy: true });
      try {
        const shelf = await api.scenePackChoices(family);
        if (shelf.choices.length !== 5 || shelf.choices.some((slot) => slot.length === 0)) {
          throw new CloudError(
            "Aucune carte n'a pu être tirée pour ce paquet : réessaie.",
            "invalid_response",
            0,
          );
        }

        // Le tirage du joueur : une carte au hasard dans chaque liste, jamais
        // deux fois le même créateur — les listes se recoupent (un créateur
        // commun figure dans presque tous les slots), donc on écarte ceux déjà
        // pris avant de tirer. Le hasard est ici, la permission est là-bas.
        const used = new Set<string>();
        const picked = shelf.choices.map((slot) => {
          const free = slot.filter((entry) => entry.slug && !used.has(entry.slug));
          if (!free.length) {
            throw new CloudError(
              "Le tirage n'a pas rendu assez de créateurs pour ce paquet : réessaie.",
              "invalid_response",
              0,
            );
          }
          const choice = free[Math.floor(Math.random() * free.length)];
          used.add(choice.slug);
          return choice;
        });

        const result = await api.openScenePack(
          family,
          picked.map((card) => ({
            creatorSlug: card.slug,
            rarity: card.rarity,
            variant: card.variant,
          })),
        );

        const local = ctx.deps.readState();
        if (!local) {
          throw new CloudError("Partie locale illisible : rien n'a été rangé.", "invalid_response", 0);
        }
        const applied = applyScenePackResult(
          local,
          result.cards.map((card) => ({
            creatorSlug: card.creatorSlug,
            rarity: card.rarity as "common" | "uncommon" | "rare" | "epic" | "legendary",
            variant: card.variant as "standard" | "live" | "holo" | "gold",
            rareDrop: card.rareDrop,
          })),
          result.sceneDay || null,
          ctx.deps.now(),
        );
        const message = `Paquet Scène : ${applied.cards.length} cartes de ta famille.`;
        // Même contrat que `openPack` : le serveur a écrit la collection, le
        // client l'adopte au lieu de pousser la sienne.
        const remoteSave = result.save;
        const remote = remoteSave ? sanitizeState(remoteSave.state, ctx.deps.now()) : null;
        if (remote && remoteSave) {
          ctx.deps.applyState(remote);
          ctx.publish({
            busy: false,
            pending: false,
            decision: "noop",
            remoteUpdatedAt: Date.parse(remoteSave.updatedAt) || ctx.deps.now(),
            lastSyncAt: ctx.deps.now(),
            message,
            isError: false,
          });
          return { status: "drawn", cards: applied.cards };
        }
        ctx.deps.applyState(applied.state);
        await ctx.push(applied.state.version, applied.state.updatedAt, false);
        ctx.publish({ busy: false, message, isError: false });
        return { status: "drawn", cards: applied.cards };
      } catch (error) {
        // Réseau coupé : même consigne que sans compte — se connecter.
        if (error instanceof CloudError && error.status === 0) {
          const message = "Connexion perdue : ton Paquet Scène n'a pas été ouvert.";
          ctx.publish({ busy: false, message, isError: true });
          return { status: "unavailable", reason: "offline", message };
        }
        const message =
          error instanceof CloudError ? error.message : "Ouverture du Paquet Scène impossible.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "error", message };
      }
    },

    packStatus: ctx.fetchPackStatus,

    /**
     * Rédème un **code promo** (réglages → « J'ai un code »).
     *
     * Le code n'est jamais jugé ici : ni la casse, ni l'expiration, ni les
     * usages — le serveur seul sait ce qui existe, et un contrôle local serait
     * un contrôle qu'on peut s'accorder. En cas de succès, on relit
     * `pack_status()` : c'est ce qui fait apparaître le booster dans la partie
     * locale (compteur, compte à rebours), sans rien ouvrir.
     *
     * Un refus remonte **tel quel** : les phrases du serveur disent déjà quoi
     * faire (« ouvre un booster, puis retape ce code »), et c'est exactement le
     * message que le joueur a besoin de lire.
     */
    async redeemPromoCode(code: string): Promise<CloudActionOutcome> {
      // Le refus est écrit ici plutôt que repris de `tradeApi()` : le sien parle
      // d'échanges, et le joueur lirait « Connecte-toi pour échanger des
      // cartes » en tapant un code.
      const api = ctx.resolve();
      if (!api) {
        const message = CLOUD_DISABLED_HINT;
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "not-configured", message };
      }
      if (!api.session()) {
        const message = "Connecte-toi pour utiliser un code.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "no-session", message };
      }
      const trimmed = code.trim();
      if (!trimmed) {
        const message = "Tape un code, puis valide.";
        ctx.publish({ busy: false, message, isError: true });
        return { status: "unavailable", reason: "error", message };
      }
      ctx.publish({ busy: true, message: null, isError: false });
      try {
        const result = await api.redeemPromoCode(trimmed);
        // On relit la réserve au lieu de l'additionner nous-mêmes : le serveur
        // fait foi, et une rédemption faite sur un autre appareil s'affiche
        // alors correctement.
        await ctx.fetchPackStatus();
        const message =
          result.granted > 1
            ? `Code accepté : ${result.granted} boosters t'attendent.`
            : "Code accepté : un booster t'attend.";
        ctx.publish({ busy: false, message, isError: false });
        return { status: "done", message };
      } catch (error) {
        const refusal = ctx.cloudRefusal(error, "Code refusé.");
        ctx.publish({ busy: false, message: refusal.message, isError: true });
        return refusal;
      }
    },

    /**
     * Rejoue la partie à zéro : côté appareil (l'appelant s'en charge) **et**
     * côté serveur.
     *
     * Sans cette moitié serveur, « Réinitialiser la progression » ne remettait à
     * zéro que l'appareil : le serveur gardait sa réserve de boosters (elle vit
     * dans `pack_state`, pas dans la sauvegarde), son journal de tirages — donc
     * le plancher de malchance et la série — et le Paquet Scène du jour. Un
     * joueur qui repartait de zéro attendait quand même la recharge de la partie
     * qu'il venait d'effacer.
     *
     * La partie neuve remonte juste après : c'est elle qui redonne 3 boosters au
     * prochain tirage (le serveur reconstruit sa réserve depuis la sauvegarde).
     */
    async resetProgress(): Promise<CloudActionOutcome> {
      const ready = ctx.tradeApi();
      if ("refusal" in ready) return ready.refusal;
      ctx.publish({ busy: true, message: null, isError: false });
      try {
        await ready.api.resetProgress();
        await this.refreshOnboarding();
        await ctx.pushAfterServer();
        await ctx.fetchPackStatus();
        const message = "Nouvelle partie : la réserve et le Paquet Scène repartent de zéro, en ligne comprise.";
        ctx.publish({ busy: false, message, isError: false });
        return { status: "done", message };
      } catch (error) {
        const refusal = ctx.cloudRefusal(error, "Réinitialisation impossible en ligne.");
        ctx.publish({ busy: false, message: refusal.message, isError: true });
        return refusal;
      }
    },

  };
}
