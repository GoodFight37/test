import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CATALOG_AUDIENCE, CATALOG_LABEL } from "@/lib/catalog";
// Polices embarquées (fichiers npm, aucun CDN) : l'APK les porte, donc elles
// s'affichent hors ligne, et l'export statique reste autonome.
//
//   * Barlow Condensed — la display : noms de cartes, titres, compteurs. C'est
//     la condensation des tickers sport, pas le grotesque de SaaS.
//   * IBM Plex Sans — le texte : menus, corps, libellés. Neutre, un peu
//     mécanique, avec de vraies graisses moyennes (400/500/600).
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import "./booster-premium.css";
import "./reveal-premium.css";
import "./booster-continuity.css";
import "./drop-binder.css";

// Titre et description suivent le périmètre du catalogue (FR ou monde) : en
// changer ne demande aucune retouche de ce fichier.
const TAGLINE = `CreatorDeck — collectionne les ${CATALOG_AUDIENCE}`;
const DESCRIPTION = `Ouvre des boosters et complète ta collection de ${CATALOG_AUDIENCE} (${CATALOG_LABEL}).`;

export const metadata: Metadata = {
  title: TAGLINE,
  description: DESCRIPTION,
  applicationName: "CreatorDeck",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: TAGLINE,
    description: DESCRIPTION,
    siteName: "CreatorDeck",
    type: "website",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary",
    title: "CreatorDeck",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pas de `maximumScale: 1` : bloquer le pincement, c'est casser l'agrandissement
  // pour qui en a besoin — et le Play Store le reproche. Le jeu n'y perd rien :
  // le défilement et les gestes de carte restent les mêmes.
  viewportFit: "cover",
  themeColor: "#090812",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
