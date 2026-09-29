# CreatorDeck — collectionne les créateurs francophones

Jeu mobile de cartes à collectionner façon TCG basé sur le Top 500 Twitch FR.
**100 % hors ligne** : la logique de jeu tourne sur l'appareil et la
progression est sauvegardée localement — aucun compte, aucun serveur.

Next.js 16 (App Router, export statique) · React 19 · Tailwind CSS 4 ·
Capacitor 8 (Android) · Vitest.

## Prérequis

- Node.js ≥ 20
- Pour l'APK Android : Android Studio (ou le SDK + JDK 21) — voir plus bas.

## Démarrage rapide

**Récupérer le code et le lancer sur ton ordinateur** (aucune dépendance à la
plateforme d'aperçu — rien n'est coupé chez toi) :

1. Installe **Node.js LTS ≥ 20** : <https://nodejs.org> — clique sur le bouton
   **LTS**, puis « Suivant » partout, « Terminer » à la fin.
2. Récupère le code. La branche en cours de travail est
   `arena/01a0e506-test` — **pas** `main` (qui ne contient pas les dernières
   fonctionnalités) :
   - **Téléchargement direct** (sans git) — décompresse l'archive obtenue :
     <https://github.com/GoodFight37/test/archive/refs/heads/arena/01a0e506-test.zip>
   - **Avec git** :
     `git clone -b arena/01a0e506-test https://github.com/GoodFight37/test.git`
3. Ouvre un terminal **dans le dossier du projet** — Windows : dans
   l'Explorateur, clique dans la barre d'adresse du dossier, tape `cmd` puis
   Entrée ; macOS : Applications → Utilitaires → Terminal.
4. Installe les dépendances (première fois seulement, ~2 min), puis lance :

   ```bash
   npm install
   npm run dev
   ```

5. Ouvre <http://localhost:3000> dans ton navigateur — le jeu s'affiche.
   Si le port 3000 est déjà pris : `npm run dev -- --port 3001` puis
   <http://localhost:3001>.

Aucune variable d'environnement n'est nécessaire pour l'application.
`.env.example` ne concerne que le script optionnel de synchronisation des avatars.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement Next.js |
| `npm run build` | export statique dans `out/` (PWA + source de l'APK) |
| `npm run start` | sert `out/` tel qu'il sera embarqué (`serve`) |
| `npm run lint` / `typecheck` / `test` | ESLint · `tsc --noEmit` · Vitest (moteur, sauvegarde, store) |
| `npm run android:sync` | `build` puis copie `out/` dans le projet Android (`cap sync`) |
| `npm run android:open` | ouvre `android/` dans Android Studio |
| `npm run android:apk` | `android:sync` puis `./gradlew assembleRelease` |
| `npm run assets:regen` | régénère les 500 portraits 300×300 (`scripts/regen-avatars-300.mjs`) |

## Architecture

```
src/lib/catalog.ts       catalogue (500 créateurs, raretés, boosters) + constantes d'UI
src/lib/random.ts        aléa cryptographique portable (Web Crypto)
src/lib/game-engine.ts   moteur de jeu PUR : tirage, recharge, XP, sabliers
src/lib/save-store.ts    (dé)sérialisation + validation de la sauvegarde
src/lib/game-store.ts    store client : charge, applique le moteur, persiste (localStorage)
src/hooks/use-game.ts    liaison React (useSyncExternalStore) + horloge
src/components/          UI (creator-deck-app, creator-card, pack-opening, card3d…)
src/app/                 layout, page, styles globaux
src/data/creators.json   les 500 créateurs
public/creators/         500 portraits 300×300
scripts/                 génération des données et des avatars
android/                 projet Capacitor Android
```

Principes :

- **Le moteur est pur et isomorphe** (`game-engine.ts`) : chaque fonction
  prend un état + un instant `now` et renvoie un nouvel état. Il ne dépend ni
  de Node, ni du DOM, ni du stockage, ce qui le rend testable unitairement et
  réutilisable côté serveur si un mode en ligne (sauvegarde cloud, classement)
  voit le jour.
- **La sauvegarde est locale et versionnée** (`creatordeck.save.v1`), validée
  au chargement (valeurs bornées, cartes inconnues ignorées). L'onglet Profil
  permet de la copier / importer (transfert entre téléphones) et de la
  réinitialiser.
- **La recharge des boosters est calculée à la lecture** : les boosters
  « arrivent » même si l'app était fermée. Un recul de l'horloge de l'appareil
  ne crédite rien.

## Animations

Deux animations ont été ajoutées : l'ouverture de booster et les cartes 3D.
Toutes les durées, seuils et intensités sont centralisés et testés dans
`src/lib/pack-animation.ts` (module pur, sans DOM) — le composant ne fait que
les projeter. 43 tests Vitest couvrent cette chorégraphie.

### Ouverture de booster (`src/components/pack-opening.tsx`)

| Phase | Durée | Ce que le joueur fait / voit |
|---|---|---|
| `sealed` | lévitation en boucle de 2 400 ms | pack fermé au centre, on attend le geste |
| `tearing` | piloté au doigt | on tire vers le **haut** : le rabat monte, la dentelure se creuse, le carton tremble (±7 px) |
| retour à plat | 260 ms | relâchement sous le seuil → retour élastique |
| seuil / vélocité | 55 % de la hauteur ou 1,35 px/ms | la déchirure est validée |
| `burst` | 620 ms | rabat qui s'envole, lumière du dedans, cartes jaillies en cascade (55 ms de décalage chacune) |
| `pileSettle` | 340 ms | la pile se pose |
| `pile` | geste au doigt | on balaie la carte du dessus (42 % de la largeur ou 0,9 px/ms) |
| `cardLift` | 240 ms | la carte quitte la pile et remonte au centre |
| `cardRevealFlip` | 420 ms | retournement face visible |
| **`rare-flip`** | **1 500 ms** | retournement **lent** de la dernière carte (Rare ou mieux, toujours révélée en dernier) + halo qui respire + particules pendant 1 200 ms |
| `summary` | 420 ms + cascade de 60 ms/cartes | récapitulatif des cartes obtenues |

Le tirage est effectué **au moment où la déchirure aboutit**, jamais avant :
la consommation du booster suit le suspense.

### Cartes 3D (`src/components/card3d.tsx`)

- **Inclinaison** au doigt, ±15° sur la scène de révélation (`mode: free`) et
  ±9° dans le classeur (`mode: scroll-safe`, le défilement vertical reste au
  navigateur ; un `pointercancel` remet la carte à plat).
- **Reflet holo** qui suit le doigt (`--shine-x` / `--shine-y`) plus un prisme
  coloré qui tourne avec l'angle (`--tilt-ry`).
- **Retournement** dos/face au tap, 420 ms (1 500 ms pour une rare ou mieux).
- **L'intensité est pilotée par le jeu**, pas codée en dur :
  `effectIntensity(rareté, variante)` renvoie un 0 → 1 exposé en `--holo` —
  une Légendaire Gold brille bien plus qu'une Commune standard, et les
  variantes `holo` / `gold` / `live` ajoutent leur bonus.
- `prefers-reduced-motion: reduce` divise toutes les durées par 0,35 et coupe
  les boucles ; les gestes pilotés au doigt sont conservés.

### Passerelle Unity (optionnelle)

`src/lib/unity-bridge.ts` + `src/components/unity-pack-opening.tsx` permettent
de remplacer l'ouverture par un build Unity WebGL si un export est déposé dans
`public/unity/`. Le contrat exact est documenté dans `public/unity/README.md`.
Sans build, aucune requête n'est émise et l'implémentation web est utilisée.

## Application Android (Capacitor)

```bash
npm run android:sync     # build web + copie dans android/app/src/main/assets/public
npm run android:open     # puis Build > Generate Signed App Bundle / APK dans Android Studio
# ou, en ligne de commande :
npm run android:apk      # android/app/build/outputs/apk/release/
```

- `android/` est un projet Capacitor standard (Gradle). Les fichiers générés
  par `cap sync` (`assets/public`, `capacitor.config.json`) ne sont pas versionnés.
- Pour publier, crée une **clé de signature de release** et configure-la dans
  `android/app/build.gradle` (`signingConfigs`) ; ne commite jamais le keystore.
- Les APK/AAB produits sont à distribuer via **GitHub Releases**, pas dans Git
  (`*.apk`, `*.aab` et `public/downloads/` sont ignorés).
- L'identifiant `com.monnom.monapp` (`capacitor.config.ts`, `build.gradle`,
  `strings.xml`, package Java) est un nom provisoire : à fixer **avant** la
  première publication, il ne pourra plus changer ensuite.

Le même export `out/` est aussi une PWA installable (manifeste inclus) ; pour
un usage hors ligne dans le navigateur, il faudra ajouter un service worker
(non inclus pour l'instant — l'APK, lui, embarque tout).

## Images des créateurs

- Le CDN Twitch ne sert **jamais plus de 300×300** (`profileImageURL(width: 300)`).
  C'est la résolution native conservée partout ; au-delà de ~150 px CSS sur écran
  Retina, aucune image Twitch ne peut être parfaitement nette.
- `scripts/regen-avatars-300.mjs` télécharge/encode les 500 portraits en 300×300
  (reprenable ; génère un portrait de secours pour une chaîne disparue).
  Les rapports vont dans `reports/` (non versionné).
- `scripts/build-top500-fr.mjs` reconstruit `src/data/creators.json` depuis
  l'API GQL de Twitch (Client-ID public du site web : non officiel, peut casser
  sans préavis) ; `scripts/sync-creator-avatars.mjs` peut utiliser l'API Helix
  officielle si `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` sont renseignés.
