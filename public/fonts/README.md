# Polices

Extraites du dépôt de l'utilisateur **GoodFight37/pkmn** (dump du jeu) et
utilisées pour coller à la typographie de Pokémon TCG Pocket :

| Fichier | Rôle dans l'app |
|---|---|
| `TPC_FuturaLTProHeavy.otf` | Titres display (`.font-display`) |
| `TPC_GillSansNovaMedium.otf` | Texte et interface (poids 500) |
| `TPC_GillSansNovaBold.otf` | Texte en gras (poids 700) |

`Pokesymbol2-regular.otf` (symboles du jeu) n'est **pas** embarqué : ses
glyphes remplacent les caractères ASCII (substitution), impossible à
l'utiliser sans casser le texte.

Les polices CJK du dump (Noto Sans CJK, Rodin, UD ShinGo…) ne servent à rien
pour une interface française et pèsent 80 Mo : laissées de côté.
