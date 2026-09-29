import type { NextConfig } from "next";

/**
 * L'application est 100 % statique : la logique de jeu tourne sur l'appareil
 * (src/lib/game-engine.ts) et la sauvegarde est locale. `output: "export"`
 * produit le dossier `out/` consommé par Capacitor (voir capacitor.config.ts)
 * et par n'importe quel hébergeur statique pour la PWA.
 */
const nextConfig: NextConfig = {
  output: "export",
  // Pas de serveur d'optimisation d'images en export statique : les portraits
  // sont déjà encodés en 300×300 (plafond du CDN Twitch) par les scripts.
  // `qualities` : les portraits utilisent qualité 88 (crop CDN Twitch) — sans
  // cette liste Next.js affiche un avertissement à chaque rendu.
  images: { unoptimized: true, qualities: [75, 88] },
  // En développement derrière un reverse-proxy (hôte de prévisualisation,
  // tunnel, `ngrok`…), Next.js refuse le cross-origin tant qu'on ne l'a pas
  // autorisé. Lis en variable d'environnement pour ne pas figer d'hôte de
  // sandbox dans le dépôt. Option de `next dev` uniquement : sans effet sur
  // l'export statique ni sur l'APK. Ex. :
  //   NEXT_ALLOWED_DEV_ORIGINS=3000-xxxx.e2b.app npm run dev
  ...(process.env.NEXT_ALLOWED_DEV_ORIGINS
    ? { allowedDevOrigins: process.env.NEXT_ALLOWED_DEV_ORIGINS.split(",") }
    : {}),
};

export default nextConfig;
