> Mise à jour du 11 octobre 2026 : les quatre jobs de `.github/workflows/verification.yml` vérifient désormais les pushes et PR. Un workflow de migrations Supabase est préparé, mais son activation nécessite encore le secret et la vérification d'historique ; [procédure](mises-a-jour-automatiques.md). Les mentions ci-dessous « à la main » décrivent l'état historique d'octobre 8–9, pas la CI actuelle.

# Le dépôt, en clair

But : **un dépôt, une branche de référence, un historique léger.**

## État au 5 octobre 2026

- Le dépôt GitHub s'appelle **`GoodFight37/CreatorDeck`** (renommé depuis
  `GoodFight37/test` le 5 octobre 2026). GitHub redirige automatiquement
  l'ancienne adresse.
- L'historique de `main` a été **mis à plat** le 5 octobre 2026 : un seul
  commit racine qui contient exactement les fichiers actuels. Les anciennes
  versions du catalogue (portraits inutilisés) ne pèsent plus dans l'historique.
- Les PR #4 (régions, booster unique, thèmes, cloud, compte invité) et #5
  (vitrine des 4 cartes + profils publics) sont fusionnées. La PR #3 est fermée.
- L'application Next.js en export statique est la source de vérité. Le kit
  Unity de la PR #3 est hors périmètre : cette PR doit être fermée sans fusion,
  car elle apporte environ 11 Mo de ressources qui n'appartiennent pas au jeu.

## État au 6 octobre 2026

- `main` reste la **branche de référence** ; le travail courant vit sur
  `arena/01a10c75-creatordeck`, poussée à chaque étape terminée — c'est cette
  branche qu'on teste. Le workflow **APK Android (debug)** accepte n'importe
  quelle branche, et les migrations Supabase se posent avec
  `npx supabase db push`, **dans l'ordre des numéros** — le CLI n'applique que
  les fichiers que la base n'a pas encore vus.
- La **PR #7** suit cette branche et sert de journal : elle reste ouverte
  jusqu'à la fin du chantier — on ne la fusionne pas au milieu.
- Une branche `arena/…` par session : `arena/01a10c2b`, `arena/01a10c54`,
  `arena/01a10c75`. Pendant qu'une session écrit, pas d'autre push, merge ni
  réécriture en parallèle (même règle que « Un seul écrivain à la fois »).
- Les branches d'essai (`claude/…`) ne sont **jamais fusionnées** : elles se
  relisent avant toute conclusion.

## État au 8 octobre 2026

- **Plus de workflows GitHub** : `.github/workflows` a été supprimé
  (`ae5016f` puis `8760723`). Le jeu se **déploie sur Vercel** (c'est là qu'il se
  teste, dans le navigateur du téléphone), **Firebase App Distribution et la
  distribution d'APK ne sont plus d'actualité**, et rien ne se vérifie plus tout
  seul : les contrôles se lancent à la main avant de pousser (voir « Ce que les
  workflows faisaient, et où c'est parti »). La sonde de production, elle, se
  remplace par `npx supabase migration list` (deux colonnes, `Local` et
  `Remote`), ou par la question posée à la base elle-même
  (`select public.schema_versions();`) sur un téléphone.
- **Les migrations se posent au CLI** : le dossier est lié au projet
  (`supabase/config.toml` est versionné, les fonctions Edge y portent leur
  `verify_jwt`), et `npx supabase db push` applique les fichiers que la base n'a
  pas encore vus. La première fois, la base a été mise au niveau de ce qu'elle
  portait déjà (`npx supabase migration repair --status applied 0001 … 0038`) :
  rien n'a été rejoué, seule la table de suivi du CLI a été remplie.
- **Migrations posées** : `0036` → `0039` sont en production. La dernière
  (`0039_invites_bureau.sql`, les invités sur le bureau) a été **la première
  posée par `npx supabase db push`**, le 8 octobre 2026 : l'historique a d'abord
  été mis au niveau de ce que la base portait déjà (`migration repair --status
  applied 0001 … 0038`) — rien n'a été rejoué, seule la table de suivi du CLI a
  été remplie.
- **Ce que ça a coûté, et ce qui a été fait** : la suppression du dossier a
  cassé `src/lib/cloud/config.test.ts`, qui lisait les workflows sans se demander
  s'ils existaient. La garde « le cloud est-il dans le paquet ? » a été
  **déplacée dans la compilation** (`scripts/cloud-guard.mjs`, appelé par
  `npm run build`) : Vercel comme un APK construit à la main préviennent
  maintenant dans leur journal quand les deux variables publiques manquent.

## État au 7 octobre 2026

- **Le jeu est en ligne.** L'APK distribué (workflow *APK Android (debug)*) est
  compilé **avec** le cloud : les boosters sont tirés par le serveur
  (`open_pack()`), les comptes, les échanges, l'hôtel, les classements et
  l'Arène passent par Supabase. Le mode **sans cloud** (build sans les deux
  variables publiques) n'existe que pour le développement et les tests : c'est
  le seul cas où le moteur de l'appareil tire les cartes. Ne pas décrire le jeu
  comme « hors ligne » ou « sans compte » sans cette nuance — c'était vrai avant
  le chantier online, ça ne l'est plus.
- Migrations Supabase collées par le joueur, dans l'ordre : `0003`, `0011` →
  `0036`. Les dernières ferment des trous d'intégrité ou ajoutent une règle :
  `0019` (la sauvegarde, la réserve de boosters et les raretés déclarées ne
  s'écrivent plus depuis le client), `0020` (un pseudo = un joueur), `0021`
  (registre de provenance : une Légendaire ou une variante Live/Holo/Gold doit
  venir du serveur), `0022` (le tirage écrit la collection dans la même
  transaction), `0023`/`0024` (notifications de direct, état de l'interrupteur),
  `0025` (la base réveille le direct toute seule), `0026` (codes promo),
  `0027` → `0029` (les points au serveur), `0030` (Gold à 1 % hors Perfect),
  `0031` (plancher de malchance à 12), `0032` (la série paie ses jours),
  `0033` (départ maigre : 2 boosters, 2 sabliers), `0034` (une Légendaire ou une
  Live ne se vole pas au Last Pack), `0035` (les jetons au serveur, et le
  rapport `schema_versions()`), `0036` (la chaîne : abonnés, vidéo du jour et
  jetons tenus par le serveur). La bascule de `0021` a inscrit 40 lignes pour
  toutes les collections existantes — personne ne perd son rang.
- **État vérifié en production (8 octobre 2026)** : `schema_versions()` répond
  `true` pour `0030` → `0036` — la base est à jour, et elle le dit elle-même,
  sans compte.
- Le vérifieur `npm run supabase:verify` joue `0001` → `0036` sur un Postgres
  jetable : **450 contrôles**. Il pose les droits de table comme Supabase
  (`alter default privileges` **avant** les migrations), sinon il redonnerait à
  `authenticated` ce que les migrations retirent et trois contrôles passeraient
  pour de mauvaises raisons.

## Comment le jeu arrive sur ton écran (8 octobre 2026)

**Vercel, et c'est tout.** Vercel construit le dépôt (`npm run build` →
export statique dans `out/`) à chaque poussée et sert le résultat : on ouvre
l'adresse du projet, dans le navigateur du téléphone ou sur un écran. Rien à
installer, rien à publier à la main, et c'est le même code que l'APK.

Ce qu'on **perd** avec ce choix, et il faut le savoir :

* **les notifications ne sonnent pas** dans le navigateur. Elles passent par
  FCM, côté Android (`src/lib/push.ts` ne s'enregistre que sur plateforme
  native). Le carnet se lit, mais le téléphone reste muet — donc, pour vérifier
  une alerte de perte ou un réveil de direct, il faut l'APK ;
* **le lien public de l'APK ne bouge plus** : la pré-release roulante
  (`releases/download/debug-apk/creatordeck-debug.apk`) sert toujours le dernier
  APK **publié**, et Vercel n'en publie aucun.

### Ce que les workflows faisaient, et où c'est parti

Les workflows `.github/workflows` ont été **supprimés les 8 et 9 octobre 2026**
(commits `ae5016f` puis `8760723`), parce que **Firebase App Distribution et la
distribution d'APK ne sont plus d'actualité**. Ce qu'ils portaient :

| Ce que faisait le workflow | Où c'est maintenant |
| --- | --- |
| Construire l'APK et l'envoyer aux testeurs (Firebase App Distribution, groupe `testers`, secret `FIREBASE_SERVICE_ACCOUNT`) | **Supprimé** : on construit à la main (`npm run android:debug`) si besoin, et il n'y a plus de mail |
| Publier la pré-release roulante et l'artefact du run | **Supprimé** : à publier à la main (`gh release upload debug-apk …`) |
| `verif` : rejouer toute la pile SQL sur un Postgres jetable | `npm run supabase:verify`, **à la main** (501 contrôles) |
| `prod-check` : demander à la production quelles migrations y sont collées | `npx supabase migration list` sur ta machine, ou la requête `select public.schema_versions();` quand on n'a qu'un téléphone — c'est ce qui dit s'il reste un fichier à poser |
| Les contrôles avant build (`lint`, `typecheck`, `test`, `ecrans`) | `npm run lint`, `npm run typecheck`, `npm test`, `npm run ecrans` — **à la main**, avant de pousser |
| L'avertissement « Cloud absent du bundle » | `npm run build` lui-même : `scripts/cloud-guard.mjs` prévient quand les deux variables publiques manquent, sur Vercel comme en local |

Conséquence de bonne hygiène : **rien ne vérifie plus une poussée** à la place
du joueur. Ce qui est poussé sur la branche de travail est donc censé avoir été
lancé avant (`npm test`, `npm run ecrans`, `npm run supabase:verify`, `npm run
lint`, `npm run typecheck`, `npm run build`) — c'est ce que fait la session
Arena avant chaque commit, et c'est écrit ici pour que personne ne croie à un
filet qui n'existe plus.

## Un seul écrivain à la fois

Pendant qu'une session Arena travaille sur le dépôt, pas d'autre push, merge
ni réécriture en parallèle. C'est la seule règle : elle évite les conflits
de force-push et les pertes de travail.

### Le travail d'un autre outil : une branche d'essai (7 octobre 2026)

Un autre outil peut modifier le dossier sans connaître cette règle : il écrit
dans les fichiers, sans branche à lui, et ces modifications se retrouveraient
mêlées à la branche de travail — le `git pull` suivant se cognerait à elles. D'où
**deux commandes** :

1. **`npm run essai:start`**, avant de lancer l'outil : le dossier passe sur une
   branche `essai/<date>-<heure>`, et la branche de travail est notée pour le
   retour. Tout ce que l'outil écrit (et commite, s'il le fait) atterrit là ;
2. **`npm run essai:push`**, quand il a fini :
   * il range tout (fichiers neufs compris) et **refuse** de committer une vraie
     clé secrète (`sb_secret_…` avec sa valeur, jeton complet, clé privée) — les
     docs qui *citent* ces motifs en toutes lettres ne le déclenchent pas ;
   * si l'outil a commité **lui-même** sur la branche de travail, il **déplace**
     ces commits sur la branche d'essai (créée au même endroit, poussée), puis
     remet la branche de travail exactement sur le dépôt distant : le dossier
     redevient celui de tout le monde ;
   * il **revient** sur la branche de travail, donc les `git pull` continuent
     d'arriver.

`essai:push` fonctionne aussi sans `essai:start` (il crée la branche d'essai au
moment du rangement). Deux rattrapages lui ont été appris après un vrai incident :

* **GitHub refuse l'envoi** (« Internal Server Error ») : le commit reste rangé
  dans la branche locale, et **relancer la même commande** finit le travail —
  c'est le seul cas où « rien à pousser » serait faux, il est testé ;
* **la note de retour manque** (essai ouvert par une version précédente de
  l'outil) : la branche de travail est retrouvée sur GitHub — la branche distante
  dont le sommet est exactement le commit d'où l'essai est parti. Une seule
  candidate, sinon rien n'est deviné et la commande à taper est affichée.

Ce qui n'est pas touché : jamais de `--force`, jamais de suppression de branche,
jamais de fusion. Une branche d'essai **se relit** — c'est le seul moyen de
savoir si ce qu'un autre outil a proposé mérite d'entrer dans le jeu.

Le workflow APK ne construisait que `main` et la branche de travail
(`.github/workflows/android-apk.yml`, `on.push.branches`) — il a été **supprimé
le 8 octobre 2026** avec le reste de `.github/workflows`. Depuis, plus rien ne se
construit tout seul : pousser un essai **ne remplace pas** davantage l'APK
installé sur le téléphone, mais c'est aussi le cas d'une poussée normale.

## Suivre la branche de travail depuis ton poste (Windows)

Le travail courant vit sur `arena/01a10c75-creatordeck`, pas sur `master`. Un
`git pull` lancé depuis `master` répond donc :

```
There is no tracking information for the current branch.
```

Rien n'a été écrasé — Git n'a simplement pas deviné **avec quoi** fusionner. Deux
façons de le dire, une seule fois chacune.

**Le plus propre : une branche locale qui suit le travail.** À taper une ligne à
la fois, dans PowerShell, depuis le dossier du dépôt :

```
git status
git switch -c arena/01a10c75-creatordeck --track origin/arena/01a10c75-creatordeck
git pull
```

Si Git répond que la branche existe déjà : `git switch arena/01a10c75-creatordeck`
puis `git pull`. Ensuite, **`git pull` seul suffit** — c'est le but.

**Ou alors, faire suivre le travail à `master`** (une seule ligne, à ne faire que
si `git status` dit que `master` est à jour, sans commit local) :

```
git branch --set-upstream-to=origin/arena/01a10c75-creatordeck master
git pull
```

Le `git status` d'avant compte : c'est lui qui dit si tu as des commits locaux ou
des fichiers modifiés. S'il annonce « Your branch is ahead of … », **ne fais pas**
la deuxième méthode — elle transformerait le rattrapage en fusion.

**Rappel utile** : tu n'as pas besoin de `git pull` pour jouer. Vercel
reconstruit le jeu à chaque poussée, et c'est là que ça se teste dans le
navigateur du téléphone. On tire le code pour **poser les migrations**
(`npx supabase db push`) et pour construire un APK à la main
(`npm run android:debug`).

## Le jour où l'historique regrossit

Si `main` finit par accumuler beaucoup d'objets (nouvelles versions du
catalogue avec portraits périmés, par exemple), on pourra refaire une mise à
plat dans le même esprit que celle du 5 octobre 2026 :

1. Vérifier qu'aucune PR n'est ouverte et qu'aucune session active n'écrit.
2. Cloner temporairement avec `--depth 1 --single-branch --branch main`.
3. Créer un orphan, committer, renommer en `main`, push forcé.
4. Supprimer le clone temporaire.
5. Réaligner les copies locales sur le nouveau `main`.

La release `debug-apk`, les variables de dépôt et le workflow Android restent
en place : ils ne dépendent pas de l'historique d'une branche.
