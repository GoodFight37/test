/**
 * Passerelle Unity WebGL — pont mince entre React et un build Unity.
 *
 * La cinématique d'ouverture existe en deux implémentations :
 *
 *  - **web** (défaut) : CSS 3D + canvas, compilée dans le bundle. Zéro octet de
 *    plus dans l'APK, testée unitairement (`pack-animation.test.ts`), et elle
 *    sert de repli si le contexte WebGL de la WebView échoue.
 *  - **Unity** : un build Unity WebGL déposé dans `public/unity/` (voir le
 *    README à cet emplacement pour le contrat exact). Présent → il prend la
 *    main sur l'ouverture. Absent → rien ne change, on reste sur le web.
 *
 * Ce module est délibérément séparé en deux moitiés :
 *  - des fonctions **pures** (validation/parsing/payload) testées ici sans
 *    Unity, ni DOM, ni réseau ;
 *  - un chargeur d'**import dynamique** (`loadUnityBuild`) qui, lui, n'est
 *    exécuté que si le loader existe réellement.
 *
 * La WebView Android n'autorise qu'un nombre limité de contextes WebGL : on
 * n'en ouvre un que si le build est effectivement présent, sinon le repli web
 * ne s'embarrasse d'aucune requête.
 */
import type { PackType, Rarity, CardVariant } from "@/lib/catalog";
import type { DrawnCard } from "@/lib/game-engine";

/** Dossier public où déposer le build Unity (Loader + Build/ + Framework/). */
export const UNITY_BASE_PATH = "/unity";
export const UNITY_LOADER = `${UNITY_BASE_PATH}/Build/creatordeck.loader.js`;

export type UnityCard = {
  id: string;
  creatorSlug: string;
  rarity: Rarity;
  variant: CardVariant;
  isNew: boolean;
};

/** Ce que React envoie à Unity au moment où la déchirure aboutit. */
export type UnityDrawPayload = {
  packType: PackType;
  cards: UnityCard[];
};

/** Ce que Unity renvoie à React. `parseUnityEvent` valide chaque message. */
export type UnityEvent =
  | { type: "ready" }
  | { type: "tear-progress"; progress: number }
  | { type: "tear-complete" }
  | { type: "card-revealed"; index: number }
  | { type: "summary-shown" }
  | { type: "close" }
  | { type: "error"; message: string };

export type UnityInstance = {
  SendMessage: (gameObjectName: string, methodName: string, value?: string) => void;
  Quit?: () => Promise<void>;
};

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
      onProgress?: (progress: number) => void,
    ) => Promise<UnityInstance>;
    CreatorDeckUnity?: { notify: (raw: string) => void };
  }
}

const EVENT_TYPES = new Set([
  "ready",
  "tear-progress",
  "tear-complete",
  "card-revealed",
  "summary-shown",
  "close",
  "error",
]);

const RARITIES = new Set<Rarity>(["common", "uncommon", "rare", "epic", "legendary"]);
const VARIANTS = new Set<CardVariant>(["standard", "live", "holo", "gold"]);

/**
 * Sérialise le tirage pour Unity. Pure : le même objet de départ produit
 * toujours le même JSON, donc le contrat côté Unity est stable.
 */
export function serializeDrawPayload(payload: UnityDrawPayload): string {
  return JSON.stringify({
    v: 1,
    packType: payload.packType,
    cards: payload.cards.map((card) => ({
      id: card.id,
      slug: card.creatorSlug,
      rarity: card.rarity,
      variant: card.variant,
      isNew: card.isNew,
    })),
  });
}

/**
 * Valide un message renvoyé par Unity. Renvoie `null` sur tout format
 * inattendu : un message corrompu ne doit jamais faire tomber la cinématique
 * (on garde alors la main côté React).
 */
export function parseUnityEvent(raw: unknown): UnityEvent | null {
  if (typeof raw !== "string" || !raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return null;

  switch (type) {
    case "tear-progress": {
      const progress = (value as { progress?: unknown }).progress;
      if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
      return { type: "tear-progress", progress: Math.min(1, Math.max(0, progress)) };
    }
    case "card-revealed": {
      const index = (value as { index?: unknown }).index;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
      return { type: "card-revealed", index };
    }
    case "error": {
      const message = (value as { message?: unknown }).message;
      return { type: "error", message: typeof message === "string" ? message : "Erreur Unity." };
    }
    default:
      return { type } as UnityEvent;
  }
}

/**
 * Vérifie la présence du loader. `HEAD` sur un fichier statique : en cas de 404
 * (cas normal — le build n'est pas déposé), on passe en web sans erreur.
 */
export async function unityBuildAvailable(basePath = UNITY_LOADER): Promise<boolean> {
  if (typeof fetch !== "function") return false;
  try {
    const response = await fetch(basePath, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Valide qu'une carte tirée est exploitable par Unity (défense en profondeur). */
export function isUnityCard(value: unknown): value is UnityCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.id === "string" &&
    typeof card.creatorSlug === "string" &&
    typeof card.rarity === "string" &&
    RARITIES.has(card.rarity as Rarity) &&
    typeof card.variant === "string" &&
    VARIANTS.has(card.variant as CardVariant) &&
    typeof card.isNew === "boolean"
  );
}

/**
 * Charge le build Unity dans le canvas donné. Import dynamique du loader :
 * le code Unity n'est mis en mémoire que lorsqu'il est réellement présent.
 *
 * Renvoie `null` (sans lever) si le loader manque, si WebGL échoue ou si
 * l'instance refuse de démarrer — le repli web prend alors la main.
 */
export async function loadUnityBuild(
  canvas: HTMLCanvasElement,
  basePath = UNITY_BASE_PATH,
): Promise<UnityInstance | null> {
  if (typeof window === "undefined") return null;
  if (typeof window.createUnityInstance !== "function") {
    try {
      await import(/* webpackIgnore: true */ `${basePath}/Build/creatordeck.loader.js`);
    } catch {
      return null;
    }
  }
  if (typeof window.createUnityInstance !== "function") return null;
  try {
    return await window.createUnityInstance(canvas, {
      dataUrl: `${basePath}/Build/creatordeck.data`,
      frameworkUrl: `${basePath}/Build/creatordeck.framework.js`,
      codeUrl: `${basePath}/Build/creatordeck.wasm`,
      companyName: "CreatorDeck",
      productName: "CreatorDeck",
      productVersion: "1.0",
      // L'APK est 100 % hors ligne : aucun contenu distant, aucun tracking.
      matchWebGLToCanvasSize: true,
    });
  } catch {
    return null;
  }
}
