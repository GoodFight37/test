/**
 * Pipeline commun de récupération / encodage des portraits Twitch.
 *
 * Le CDN Twitch expose chaque photo de profil en plusieurs tailles fixes
 * (28, 50, 70, 150, 300 et 600 px) : l'URL renvoyée par les API se termine par
 * `-profile_image-300x300.png`, et il suffit de réécrire ce suffixe pour
 * obtenir la variante 600x600 — la plus grande disponible.
 *
 * On vise donc 600x600 : sur un écran de téléphone en densité 3x, une carte de
 * 200 px CSS de large affiche 600 pixels physiques. Une source 300x300 y est
 * agrandie 2 fois (et jusqu'à 3,7 fois sur la carte de révélation), d'où le
 * rendu pixelisé constaté avec les anciens fichiers.
 */
import sharp from "sharp";

/** Résolution cible (px) des fichiers écrits dans public/creators/. */
export const AVATAR_SIZE = 600;
/** Qualité JPEG (mozjpeg). 82 ≈ 35-50 Ko par portrait 600x600. */
export const AVATAR_QUALITY = 82;
/** Tailles servies par le CDN, de la plus grande à la plus petite. */
export const CDN_SIZES = [600, 300, 150];

const SIZE_SUFFIX = /-(\d{2,4})x(\d{2,4})(\.[a-z]+)(\?.*)?$/i;

/** `…-profile_image-300x300.png` -> `…-profile_image-600x600.png` (ou null). */
export function avatarUrlAtSize(url, size) {
  if (typeof url !== "string" || !SIZE_SUFFIX.test(url)) return null;
  return url.replace(SIZE_SUFFIX, `-${size}x${size}$3`);
}

async function fetchBytes(url, timeoutMs) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") || "";
  if (!response.ok || bytes.length < 1_000 || (type && !type.startsWith("image/"))) {
    throw new Error(`HTTP ${response.status} ${type || "?"} ${bytes.length}o`);
  }
  return bytes;
}

/**
 * Télécharge la plus grande variante disponible d'un portrait.
 * Essaie les tailles du CDN dans l'ordre (600 puis 300…), puis l'URL d'origine
 * telle quelle si son format n'est pas réécrivable (decapi, unavatar…).
 *
 * @returns {Promise<{ bytes: Buffer, size: number | null, url: string }>}
 */
export async function downloadLargestAvatar(url, { timeoutMs = 25_000 } = {}) {
  const errors = [];
  for (const size of CDN_SIZES) {
    const candidate = avatarUrlAtSize(url, size);
    if (!candidate) break;
    try {
      return { bytes: await fetchBytes(candidate, timeoutMs), size, url: candidate };
    } catch (error) {
      errors.push(`${size}px: ${error.message}`);
    }
  }
  try {
    return { bytes: await fetchBytes(url, timeoutMs), size: null, url };
  } catch (error) {
    errors.push(`origine: ${error.message}`);
    throw new Error(errors.join(" | "));
  }
}

/**
 * Encode un portrait carré en AVATAR_SIZE x AVATAR_SIZE.
 * Une source plus petite n'est jamais agrandie (un faux 600 px n'apporterait
 * rien) ; l'accentuation n'est appliquée que lorsqu'on réduit réellement.
 */
export async function encodeAvatar(bytes, target, { size = AVATAR_SIZE } = {}) {
  const image = sharp(bytes, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const shortest = Math.min(meta.width ?? size, meta.height ?? size);
  let pipeline = image.resize(size, size, {
    fit: "cover",
    position: "centre",
    withoutEnlargement: true,
    kernel: "lanczos3",
  });
  if (shortest > size) pipeline = pipeline.sharpen({ sigma: 0.6 });
  await pipeline.jpeg({ quality: AVATAR_QUALITY, mozjpeg: true }).toFile(target);
  return Math.min(shortest, size);
}

/** Portrait de secours (initiales) pour une chaîne disparue ou renommée. */
export async function encodePlaceholder({ displayName, login }, target, { size = AVATAR_SIZE } = {}) {
  const initials = (displayName || login || "?")
    .replace(/[^a-z0-9 ]/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
  const label = initials || (login?.[0] ?? "?").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#6d3ade"/><stop offset="100%" stop-color="#150f28"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <circle cx="${size / 2}" cy="${size * 0.42}" r="${size * 0.16}" fill="rgba(255,255,255,.16)"/>
  <path d="M${size * 0.22} ${size * 0.92} a${size * 0.28} ${size * 0.28} 0 0 1 ${size * 0.56} 0 z"
        fill="rgba(255,255,255,.16)"/>
  <text x="50%" y="${size * 0.9}" font-family="Arial, sans-serif" font-size="${size * 0.11}"
        font-weight="700" fill="rgba(255,255,255,.55)" text-anchor="middle">${label}</text>
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(target);
}

/** Dimensions d'un fichier existant, ou null s'il est absent / illisible. */
export async function readAvatarSize(file) {
  try {
    const meta = await sharp(file).metadata();
    return meta.width && meta.height ? Math.min(meta.width, meta.height) : null;
  } catch {
    return null;
  }
}
