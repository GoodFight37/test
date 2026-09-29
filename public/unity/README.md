# Cinématique Unity WebGL (optionnelle)

Ce dossier est le point de chute du build **Unity WebGL** qui pilote
l'ouverture de booster. Il est **entièrement optionnel** : sans build, le jeu
utilise l'implémentation web embarquée (CSS 3D + canvas), qui est celle
documentée et testée dans ce dépôt.

> **État actuel : aucun build Unity n'est versionné ici.** Les exports sont
> ignorés par `.gitignore` (poids). Dépose ton export Unity dans ce dossier,
> relance `npm run build` / `npm run android:sync`, et le jeu détectera
> automatiquement la cinématique Unity à l'ouverture d'un booster.

## Structure attendue

```
public/unity/
  Build/
    creatordeck.loader.js     ← le jeu fait un HEAD sur ce fichier
    creatordeck.framework.js
    creatordeck.data
    creatordeck.wasm
  README.md
```

Les noms de fichiers ne sont pas libres : ils sont codés en dur dans
`src/lib/unity-bridge.ts` (`UNITY_LOADER`, `loadUnityBuild`).

## Export Unity à utiliser

Le jeu tourne dans une **WebView Android, 100 % hors ligne**. Pour que le
build démarre :

| Paramètre Unity | Valeur |
|---|---|
| Platform | WebGL |
| Compression | **Disabled** (les headers `Content-Encoding` ne sont pas servis par la WebView locale) |
| Threads | **Disabled** (pas de `Cross-Origin-Opener-Policy` local) |
| Symbols | Disabled |
| Code optimization | **Master** |
| WebGL 2 | requis (WebView moderne, sinon WebGL 1) |
| Base URL | `/unity/` |

> Android WebView ne fournit qu'un nombre restreint de contextes WebGL. Le jeu
> n'en ouvre un que si ce dossier contient réellement un build ; sinon il reste
> sur le web, sans requête inutile.

## Contrat JS ⇄ Unity

### React → Unity

Sur le GameObject `CreatorDeckCinematic` :

| Méthode | Argument | Quand |
|---|---|---|
| `StartOpening` | `"live"` \| `"archive"` | dès que le build est prêt |
| `SetCards` | JSON du tirage (voir ci-dessous) | à la **fin** du message `tear-complete` |

Le tirage est effectué **par React**, jamais par Unity : Unity n'a qu'à
l'afficher. Le booster n'est donc consommé qu'une fois la déchirure jouée.

Payload :

```json
{
  "v": 1,
  "packType": "archive",
  "cards": [
    { "id": "uuid", "slug": "squeezie", "rarity": "epic",
      "variant": "holo", "isNew": true }
  ]
}
```

### Unity → React

```js
window.CreatorDeckUnity.notify(JSON.stringify({ type: "tear-complete" }));
```

| `type` | Payload | Effet |
|---|---|---|
| `ready` | — | le canvas est prêt |
| `tear-progress` | `progress: 0 → 1` | suivi optionnel de la déchirure |
| `tear-complete` | — | **React tire les cartes** puis envoie `SetCards` |
| `card-revealed` | `index: number` | progression des points |
| `summary-shown` | — | le récapitulatif Unity est affiché |
| `close` | — | ferme la cinématique |
| `error` | `message?` | affiche l'erreur **et bascule en web** |

Tout message malformé est ignoré (`parseUnityEvent` renvoie `null`) : il ne
peut jamais faire tomber l'ouverture. Si le build échoue à démarrer, React
retombe sur la cinématique web sans recharger la page.

## Ce qui reste en web même avec Unity

Les cartes **3D du classeur** (inclinaison, retournement dos/face, reflet holo
piloté par la rareté et la variante) sont des composants React : Unity ne
concerne que l'ouverture de booster. Voir `src/components/card3d.tsx`.
