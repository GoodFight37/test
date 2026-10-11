# Compte, cloud et jeu à plusieurs : sauvegarde, profils, échanges, amis, hôtel, Arène (Supabase)

L'**APK et le site distribués** sont compilés **avec** le cloud : le jeu se
joue en ligne, et c'est le serveur qui tient ce qui compte — le **tirage des
boosters** (`open_pack()`), les **points**, les **jetons** et la **réserve de
packs**. Le cloud apporte :

1. **un compte** (invité par défaut, adresse e-mail + code à 6 chiffres, ou
   « Continuer avec Twitch ») ;
2. **une sauvegarde cloud** de la partie, pour retrouver sa collection sur un
   autre appareil ;
3. **le tirage des boosters** décidé par le serveur (les cartes sont
   infalsifiables, prérequis des échanges) ;
4. **les échanges de cartes** entre joueurs, tranchés par le serveur (les deux
   collections changent ensemble, ou aucune des deux) ;
5. **une vitrine publique** de quatre cartes épinglées, et le **profil public** ;
6. **un classement mondial** calculé par le serveur — global, Gold ou **par
   famille de collection** ;
7. les **amis**, le **carnet de notifications**, les **notifications de direct**
   (FCM), le **Last Pack**, le badge **EN LIVE**, la **wishlist** ;
8. l'**hôtel des ventes**, l'**Arène** hebdomadaire, les **codes promo**, le
   **plancher de malchance** et la **série de sept jours** relus côté serveur, les
   **jetons**, et, depuis `0036`, **la chaîne** — le simulateur de streameur —
   avec, depuis `0038`, **les imprévus à choix** (une carte par jour, deux côtés)
   et **le setup en cinq paliers**, depuis `0039`, **les invités sur le bureau**
   (deux cartes du classeur, un raid quand leur créateur streame vraiment), et,
   depuis `0035`, `schema_versions()` pour dire ce qui est collé.

Le détail de chaque pièce est au §8 : c'est lui qui fait foi.

**Sans réseau**, le classeur, les fiches de créateurs et tout ce qui est déjà
dans la partie restent consultables ; tout ce qui engage le serveur — ouvrir un
booster, l'Atelier, l'hôtel, les échanges, le classement — attend le retour de
la connexion et le dit, sans jamais fabriquer de valeurs en local. Un build
**sans** les deux variables publiques (développement, tests) se joue seul, sur
l'appareil : l'écran de compte affiche alors « cloud non configuré », la
réserve de boosters reste locale, et c'est le seul cas où le moteur de
l'appareil tire les cartes.

Le catalogue, lui, n'est jamais envoyé : il est embarqué dans l'APK.

---

## 1. Ce qui monte dans le cloud, et ce qui n'y monte pas

| Donnée | Où elle vit | Détail |
| --- | --- | --- |
| Catalogue (créateurs, raretés, taux) | **Dans l'APK** | fichiers JSON générés à la compilation, jamais envoyés |
| Partie (cartes, paliers, thème) | **Local d'abord** | copie envoyée au cloud seulement si tu te connectes |
| Points | **Serveur** | `wallets` : le solde quitte la sauvegarde (`0027`), l'appareil **adopte** ce que le serveur répond |
| Adresse e-mail | Cloud | sert uniquement à te renvoyer ton code |
| Statistiques (cartes uniques, légendaires…) | Cloud | recalculées **par le serveur** depuis ta sauvegarde, visibles dans le classement |
| Vitrine (4 cartes épinglées) | Cloud | 4 slugs au maximum, contrôlés par le serveur ; affichés sur le profil public |
| Contenu des boosters | **Serveur** | le tirage est décidé par la fonction `open_pack()` ; le client ne peut pas choisir ni inventer les cartes |
| Réserve de boosters | **Serveur** | `pack_status()` à la connexion ; le client adopte le compteur et l'ancre de recharge, sans rien consommer |
| Cartes possédées, en lignes | **Serveur** | table `user_cards` : une **projection** de ta sauvegarde, recalculée à chaque écriture. Aucune politique RLS : aucun client ne la lit, seules les fonctions du serveur la consultent |
| Complétion, rangs, variantes d'une collection | **Serveur** | calculés par `player_profile()` et `leaderboard()` ; un joueur ne voit des autres que des compteurs et la vitrine |
| Échanges (offres en attente, historique) | Cloud | table `trades` : lecture réservée aux deux joueurs concernés, écriture par les fonctions du serveur uniquement |
| Cartes données et reçues | **Serveur** | déplacées par `respond_trade()` dans la même transaction ; l'appareil applique ensuite le même mouvement pour rester d'accord |

Aucun mot de passe n'est stocké. Les données restent locales tant que tu ne
crées pas de compte invité ou ne valides pas ton code ; « Déconnexion » efface
la session de l'appareil.

## 2. Trois façons d'avoir un compte

**Tu n'as pas besoin du Magic Link.** L'e-mail est une méthode parmi d'autres :
ce qui compte pour le cloud, c'est un identifiant `user_id`. Il y en a trois, et
la deuxième est celle qu'il faut connaître — elle **ne demande aucun e-mail** :

| | Compte invité | Invité **+ adresse et mot de passe** | Adresse e-mail + code |
| --- | --- | --- | --- |
| Ce qu'il faut activer | **Anonymous sign-ins** | Anonymous sign-ins + **Confirm email désactivé** | un **SMTP** configuré |
| Ce qu'il faut posséder | rien | rien | un domaine ou un compte d'envoi gratuit |
| Mise en route | immédiate | immédiate | 10 minutes de configuration |
| Récupérable sur un autre appareil | non | **oui, par mot de passe** | oui, par code reçu par e-mail |
| Si le mot de passe est perdu | — | compte perdu (pas de « mot de passe oublié » sans SMTP) | — |

Pourquoi Supabase réclame un SMTP pour le code à 6 chiffres : son service
d'e-mail intégré est **réservé aux tests** (quelques envois par heure, et il
n'écrit qu'aux adresses de l'équipe du projet). Dès qu'on veut envoyer un code à
quelqu'un d'autre, il faut brancher son propre serveur d'envoi. **Le mot de
passe, lui, n'envoie aucun e-mail** : c'est la voie de secours sans
configuration.

### Compte invité (recommandé pour commencer)

1. Dashboard → **Authentication → Sign In / Providers** → active
   **Anonymous sign-ins** → Save.
2. Dans l'app : Profil → **Mon compte** → **Créer un compte invité**.
3. Donne-toi un nom (il apparaît au classement, dans **Profil public**). Il n'y a
   **rien à envoyer** : la progression part toute seule, et l'écran le dit par une
   pastille verte (« Progression synchronisée »).

Rien à installer, rien à payer, aucun e-mail. À savoir : le compte vit avec la
session enregistrée sur l'appareil. Réinstaller l'app ou vider ses données perd
l'accès au compte (la collection locale, elle, est sauvegardée par le mécanisme
habituel d'export/import).

### Garder un compte invité : adresse + mot de passe (sans SMTP)

C'est ce qu'il faut faire dès qu'un joueur tient à sa collection, et **avant**
de mettre l'app sur un second appareil.

1. Dashboard → **Authentication → Sign In / Providers → Email** : laisse le
   fournisseur **Email activé**, mais **désactive « Confirm email »** → Save.
   C'est ce réglage qui rend l'opération possible sans envoyer un seul e-mail.
2. Dans l'app (compte invité connecté) : Profil → **Garder ce compte** →
   adresse e-mail + mot de passe (8 caractères minimum) → **Attacher l'adresse**.
3. Sur l'autre appareil : Profil → **Mon compte** → **Se connecter avec un
   e-mail et un mot de passe** (ou rien à faire : une partie locale vierge est
   reprise automatiquement, voir plus bas).

Ce que fait l'app : un seul appel, `PUT /auth/v1/user` avec l'adresse **et** le
mot de passe, avec le jeton du joueur. Aucun mot de passe ne transite en clair
ailleurs qu'ici, et il est haché par Supabase. La reconnexion se fait par
`POST /auth/v1/token?grant_type=password` — donc **aucun e-mail n'est jamais
envoyé**, ni à l'attachement ni à la connexion.

Deux limites, à dire au joueur :

* **Il n'y a pas de « mot de passe oublié ».** Sans SMTP, un mot de passe perdu
  ne se récupère pas : l'écran le rappelle au moment du choix.
* **L'adresse n'est pas vérifiée** (c'est le prix de « pas d'e-mail envoyé »).
  C'est le mot de passe qui protège le compte, pas l'adresse.

> **Bug Supabase à connaître** (`supabase/auth#2847`) : attacher une adresse à un
> compte **invité** échoue (erreur `Email address "" is invalid`) tant que
> **« Confirm email » est activé** — GoTrue valide une adresse vide faute de
> savoir laquelle confirmer. L'app traduit ce cas en clair : elle nomme le
> réglage à désactiver, au lieu d'afficher « adresse refusée ». Pour un compte
> qui a déjà une adresse, l'ajout d'un mot de passe marche dans les deux réglages.

### Garder un compte invité : adresse seule + code (SMTP requis)

Variante du chemin précédent, quand un SMTP est configuré (§ *Adresse e-mail +
code*) : le joueur n'a aucun mot de passe à choisir, et retrouve sa collection
par un code reçu par e-mail.

1. Branche le SMTP **et** les deux modèles qui portent un jeton : *Magic Link*
   (connexion) **et** *Change email address* (changement d'adresse). Les deux
   doivent contenir `{{ .Token }}`.
2. Dans l'app (compte invité connecté) : Profil → **Garder ce compte** →
   adresse e-mail → **Attacher l'adresse**. Le mot de passe est **facultatif**
   sur ce chemin.
3. L'app affiche **« Code reçu »** : saisis les 6 chiffres arrivés par e-mail →
   **Confirmer l'adresse**. Rien reçu ? **Renvoyer le code** (un envoi par
   minute), puis regarde les indésirables.
4. Sur l'autre appareil : **Recevoir un code par e-mail**, puis saisis le code —
   la progression suit le compte, sans autre geste.

Ce qui se passe côté serveur : `PUT /auth/v1/user` avec la seule adresse ne
l'applique **pas** tout de suite — Supabase la renvoie dans `new_email` et
envoie un code à cette nouvelle adresse. L'app garde l'adresse « en attente »
(rappelée dans l'écran Compte) et la valide par `POST /auth/v1/verify` avec
`type` = `email_change` : la session porte alors la nouvelle adresse, sans
déconnexion et sans perdre la collection. C'est la raison d'être du champ
**Code reçu** : il n'y a pas de page web pour recevoir un lien de confirmation.

Sans SMTP, ce chemin s'arrête à l'adresse en attente : l'app affiche alors la
marche à suivre (ajouter un mot de passe, qui n'envoie rien, ou désactiver
« Confirm email » pour enregistrer l'adresse tout de suite).

**Nouveau téléphone, partie locale vierge** : à la connexion (mot de passe ou
code), si cette partie n'a **ni carte ni ouverture**, l'app charge d'elle-même
la collection du cloud — il n'y a rien à perdre, et cela évite qu'un premier
envoi écrase la collection. Dès que la partie locale a servi, rien n'est
remplacé sans que le joueur le demande : l'écran **Mon compte** affiche alors
**Deux parties t'attendent**, avec *Reprendre la partie en ligne* (deux appuis) et
*Garder celle de cet appareil*.

### Adresse e-mail + code (optionnel)

1. **Authentication → Emails → SMTP Settings** : branche un service d'envoi.
   Deux options gratuites qui ne demandent aucun domaine :
   * **Brevo** — vérifie une simple adresse d'expéditeur, 300 e-mails/jour ;
   * **Resend** — en mode test, envoie depuis `onboarding@resend.dev` vers
     l'adresse du propriétaire du compte (parfait pour tester).
2. **Authentication → Email Templates → Magic Link** : le modèle doit contenir
   le jeton, sinon le code reçu est un lien inutilisable :

   ```html
   <p>Ton code CreatorDeck : <strong>{{ .Token }}</strong></p>
   ```

3. Vérifie **Email OTP Length = 6** et **Email OTP Expiration** (1 heure par
   défaut convient).

## 3. Créer le projet (5 minutes)

1. Compte sur [supabase.com](https://supabase.com) → **New project**.
   Choisis une région européenne (`eu-west-3` / Paris ou `eu-central-1` /
   Francfort) : c'est là que vivront la sauvegarde et le classement.
   Le palier gratuit suffit largement (500 Mo de base, 50 000 utilisateurs
   actifs par mois).
2. **Les migrations se posent en ligne de commande**, plus par copier-coller :
   dans le dossier du jeu, sur ta machine,

   ```powershell
   npx supabase link --project-ref <ref du projet>   # une seule fois
   npx supabase db push                              # à chaque nouvelle migration
   ```

   `db push` applique à la base liée, **dans l'ordre des numéros**, les fichiers
   de `supabase/migrations/` qu'elle n'a pas encore vus, et garde la trace de ce
   qu'il a posé dans la table `supabase_migrations.schema_migrations`. Un
   fichier déjà appliqué n'est jamais rejoué (et un fichier absent ne l'est pas
   non plus : c'est ce qui rend l'ordre des numéros si important). Si la base a
   été montée à la main avant de lier le dossier, il faut d'abord lui **dire ce
   qu'elle a déjà reçu** — une seule fois :

   ```powershell
   npx supabase migration repair --status applied 0001 0002 0003 … 0038
   npx supabase migration list   # les colonnes Local et Remote doivent se répondre
   ```

   > ⚠️ **`migration repair` sans numéro** (« répare tout l'historique ») n'est
   > **pas** un raccourci de la ligne ci-dessus : il **vide** la table de suivi
   > (`truncate`) puis y marque **tout** le dossier local comme appliqué —
   > dernière migration comprise. Une migration jamais exécutée serait donc
   > considérée comme posée, et `db push` ne la poserait **jamais**. C'est la
   > liste explicite des numéros, et elle seule, qui est sûre : elle ajoute les
   > lignes demandées et ne touche à rien d'autre.
   >
   > C'est ce qui a été fait sur le projet du jeu le 8 octobre 2026 : le
   > `repair` a retrouvé les 38 fichiers locaux (la sortie le dit en clair,
   > `Repaired migration history: [0001 … 0038] => applied`), puis
   > `db push --dry-run` n'a annoncé que `0039_invites_bureau.sql` et
   > `db push` l'a appliqué. `0039` est donc la **première migration posée par
   > le CLI** — et la dernière à ce jour.

   Ce qui suit dit **ce que chaque fichier apporte** (la liste est le contenu de
   `supabase/migrations/`, dans l'ordre où `db push` les pose) :
   - [`supabase/migrations/0001_comptes_cloud.sql`](../supabase/migrations/0001_comptes_cloud.sql)
     → les tables, les politiques RLS, les déclencheurs et les fonctions
     d'envoi / lecture / classement.
   - [`supabase/migrations/0002_vitrine.sql`](../supabase/migrations/0002_vitrine.sql)
     → activer la vitrine et le contrôle de possession.
   - [`supabase/migrations/0003_catalogue.sql`](../supabase/migrations/0003_catalogue.sql)
     → peupler la table des créateurs (utilisée par le tirage
     serveur) et la passer en lecture seule pour les clients (RLS activée).
     **Fichier généré** par `scripts/build-supabase-catalogue.mjs` depuis
     `src/data/creators.json` : ne pas modifier à la main. Il porte aussi la
     **famille** de chaque créateur (`region`), qui sert à la complétion par
     saison : si la base porte une version antérieure du fichier,
     `npx supabase db push --include-all` le rejoue.
   - [`supabase/migrations/0004_tirage.sql`](../supabase/migrations/0004_tirage.sql)
     → activer le tirage des boosters côté serveur (`open_pack()`
     et `pack_status()`).
   - [`supabase/migrations/0005_echanges.sql`](../supabase/migrations/0005_echanges.sql)
     → activer les échanges de cartes (`create_trade()`,
     `respond_trade()`, `cancel_trade()`, `list_trades()`, `search_players()`,
     `player_variants()`).
   - [`supabase/migrations/0006_profil_public.sql`](../supabase/migrations/0006_profil_public.sql)
     → activer le profil public et les classements enrichis
     (`player_profile()`, projection `user_cards`, complétion, compteurs Gold et
     Holo, tri Gold, **complétion par famille** et **classement par famille**).
     Il recalcule les statistiques de tous les joueurs déjà en ligne : c'est
     normal qu'il travaille quelques secondes. Comme il grandit au fil des
     versions, rejoue-le (`npx supabase db push --include-all`) : il est
     rejouable (`create or replace`).
   - [`supabase/migrations/0007_direct.sql`](../supabase/migrations/0007_direct.sql)
     → activer le **statut EN LIVE** (cache `live_streams` et
     `live_state`), puis **rejouer `0003_catalogue.sql`** (`--include-all`) : il apporte la
     colonne `login`, la clé qui relie une diffusion Twitch à sa carte. Détail :
     §8, « Le direct ».
   - [`supabase/migrations/0008_friends.sql`](../supabase/migrations/0008_friends.sql)
     → activer les **amis** (`friend_requests`, `friends`,
     `send_friend_request()`, `list_friends()`, `has_friendship()`…). Détail :
     §8, « Les amis ».
   - **Se connecter avec Twitch** (facultatif, mais recommandé : c'est le
     compte le plus simple à retenir). Twitch est un fournisseur **intégré** de
     Supabase : pas de fournisseur personnalisé à créer, juste deux réglages et
     l'adresse de retour.
     1. **Console Twitch** ([dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps))
        → ton application → **OAuth Redirect URLs** → ajoute exactement
        `https://<ton-projet>.supabase.co/auth/v1/callback`, puis **Add** et
        **Save**. (Si une ancienne adresse `http://localhost:3000` traîne dans
        la liste, elle ne gêne pas : elle peut rester.)
     2. **Supabase** → *Authentication → **Sign In / Providers*** → dans la
        liste, **Twitch** → active-le et colle le **Client ID** et le
        **Client Secret** de ton application Twitch → **Save**.
        *(Le Client ID est une longue suite de lettres et de chiffres affichée
        en haut de la page « Manage » ; ce n'est pas le nom de l'application.)*
     3. **Supabase** → *Authentication → URL Configuration → Redirect URLs* →
        ajoute les retours possibles : l'adresse du site (`https://<ton-site>/`),
        `http://localhost:3000` (le jeu en local) et
        `com.creatordeck.app://auth` (l'application Android).
     Supabase demande à Twitch la portée `user:read:email` : l'adresse n'est
     renvoyée que si elle est **vérifiée** sur le compte Twitch (c'est le cas de
     la plupart). Un compte Twitch sans adresse vérifiée ne peut pas servir de
     compte de jeu — l'écran Compte le dit alors clairement.
     ⚠️ Si tu **régénères** le secret Twitch, il faut le recopier aux **deux**
     endroits : ici, et dans les secrets de la fonction `refresh-live`
     (`TWITCH_CLIENT_SECRET`), sinon le badge « Direct » s'éteint.
   - [`supabase/migrations/0018_arena.sql`](../supabase/migrations/0018_arena.sql)
     → activer **l'Arène** : cinq cartes alignées, au plus une
     Légendaire, au moins un créateur **en direct**, et un score qui est la
     **somme des viewers réels** — recalculée par le serveur à chaque dépôt.
     Semaine du lundi 6 h UTC au lundi 6 h UTC, classement hebdomadaire,
     récompenses au podium (5/3/2 sabliers) et pour les dix premiers, plus le
     **draft du week-end** (samedi 6 h → lundi 6 h UTC). Sans cette migration,
     l'écran Arène répond « fonction inconnue » ; le reste du jeu ne bouge pas.
     Détail : §8, « L'Arène ».
   - [`supabase/migrations/0019_integrite.sql`](../supabase/migrations/0019_integrite.sql)
     → fermer trois trous d'intégrité : l'écriture directe des
     tables `saves`, `stats` et `pack_state` est **révoquée** aux rôles clients
     (seul le serveur écrit, via `push_save()`), la **réserve de boosters** naît
     côté serveur à trois et ne lit plus la sauvegarde du client, et une
     sauvegarde qui déclare une **rareté inventée**, un **créateur hors
     catalogue** ou des **identifiants en double** n'est plus classée (les
     cartes restent acquises). Détail : §8, « L'intégrité côté serveur ».
   - [`supabase/migrations/0039_invites_bureau.sql`](../supabase/migrations/0039_invites_bureau.sql)
     → que la chaîne ait ses **invités sur le bureau** : deux cartes
     du classeur (deux créateurs différents, une carte qui est bien à toi),
     choisies par le joueur, qui amènent un **raid** — des abonnés, jamais des
     jetons — quand leur créateur est **réellement en direct** (fenêtre de dix
     minutes, la même que le badge de l'accueil). Le raid se paie **dans le
     relevé de la chaîne**, **une seule fois par journée de jeu** : la ligne de
     `streamer_raids` est la preuve du paiement, et changer d'invité après coup
     ne repaie pas. La migration remplace `streamer_status()` et
     `streamer_visit()` de `0038` : elle doit être posée **après `0038`**
     (`db push` suit les numéros, il n'y a rien à décider). Détail : §8,
     « Les invités sur le bureau (`0039`) ».
   - [`supabase/migrations/0038_imprevus_setup.sql`](../supabase/migrations/0038_imprevus_setup.sql)
     → que la chaîne ait ses **imprévus à choix** et son **setup** :
     une carte par journée de jeu, choisie côté serveur (`md5(joueur, journée)`,
     donc stable), **six cartes à deux côtés**, un tirage serveur et **aucun
     jeton**. Le client envoie la carte et le côté ; le serveur refuse une carte
     qui n'est pas celle du jour, un côté inconnu, et relit la première réponse.
     `streamer_setup_buy(palier)` installe les **cinq paliers dans l'ordre** —
     120 / 320 / 780 / 1 800 / 4 200 points pour +3 / +5 / +7 / +10 / +25 % de
     croissance **définitive** — en débitant par `_wallet_apply`, donc **une
     seule fois pour toujours**. Le bonus s'arrête au premier palier manquant du
     **préfixe** et `_streamer_setup_next()` rend le premier manquant : un
     palier « volé » ne compte pas et ne fait pas sauter l'étape suivante.
     La migration remplace `streamer_status()`, `streamer_visit()` et
     `streamer_publish()` de `0036` : elle doit être posée **après `0037`**
     (`db push` s'en charge seul). Détail : §8,
     « Les imprévus et le setup de la chaîne (`0038`) ».
   - [`supabase/migrations/0037_gardes.sql`](../supabase/migrations/0037_gardes.sql)
     → que les **deux alertes de perte** existent : « Ta série
     s'arrête ce soir » (la série est vivante — dernier booster hier — et la
     journée n'est pas faite) et « Réserve pleine : un booster se perd » (les
     quatre boosters attendent depuis qu'une recharge s'est perdue). Elle
     **remplace `push_targets()`** (aucune table, aucune colonne de plus) : les
     deux conditions s'ajoutent aux choix existants, et la clé `série` ne
     consomme plus le tour du direct. Sans elle, aucune de ces deux
     notifications ne part. Détail : §9.2.
   - [`supabase/migrations/0036_streamer.sql`](../supabase/migrations/0036_streamer.sql)
     → que **la chaîne** (le simulateur de streameur) vive au
     serveur : `streamer_channels` (les abonnés, le dernier relevé) et
     `streamer_videos` (une vidéo par journée de jeu, index unique). Le retour du
     joueur (`streamer_visit()`) paie la croissance des journées écoulées,
     **plafonnées à sept**, et ne crédite **rien** sur un écart négatif ;
     `streamer_publish(format)` tire la vidéo du jour **côté serveur** — le client
     n'envoie qu'un nom de format — et le versement (**6 jetons**, +10 au buzz,
     plafond **40 par jour**) passe par `_tokens_apply()` de `0035`, donc une
     seule fois par journée. La migration étend `schema_versions()` avec sa ligne
     `0036`. Sans elle, la porte « Ta chaîne » répond « fonction inconnue » et le
     reste du jeu ne bouge pas. Détail : §8, « La chaîne vit au serveur (`0036`) ».
   - [`supabase/migrations/0035_jetons.sql`](../supabase/migrations/0035_jetons.sql)
     → que **les jetons passent au serveur** : le solde vit dans
     `tokens`, chaque mouvement est journalisé (`token_ledger`, index unique
     `(user_id, kind, ref)`), et le tirage comme la série **versent** leurs
     jetons au moment du fait (5 par booster, 7 en Prime Time, 10 au J4, 15 au
     J6) au lieu de laisser l'appareil les inventer. `tokens_get()` lit le
     solde et recale le miroir (`state.tokens`) ; `tokens_spend(slug)` paie la
     carte visée — 400 jetons, prix relu ici, refus d'une **Légendaire**, d'un
     créateur retiré du classement ou déjà possédé. La bascule ouvre le compte
     **une fois** avec le solde déjà gagné (borné à un million, comme
     `_wallet_ensure()` dans `0027`). La migration ajoute aussi
     **`schema_versions()`** : lue **sans compte**, elle dit lesquelles des
     dernières migrations (`0030` → `0039`) sont installées — c'est la réponse à
     « est-ce que c'est bien le SQL que j'ai collé ? », y compris pour `0034`,
     qui ne crée aucun objet. Détail : §8, « Le plancher de malchance, les
     jetons, les missions du jour ».
   - [`supabase/migrations/0034_last_pack_protege.sql`](../supabase/migrations/0034_last_pack_protege.sql)
     → que le **Last Pack protège les Légendaires et les Lives** :
     ces deux cartes-là restent exposées dix minutes mais **ne se volent pas**.
     `_last_pack_cards()` renvoie `stealable` pour chaque carte, donc l'écran les
     grise et écrit « protégée » sur la place, et `last_pack_steal()` refuse de
     son côté — **avant tout verrouillage** : un refus ne laisse ni carte
     déplacée ni vol du jour entamé. Mêmes signatures qu'`0012` : `create or
     replace`, rien d'autre à poser. Détail : §8, « Le Last Pack ».
   - [`supabase/migrations/0033_depart_maigre.sql`](../supabase/migrations/0033_depart_maigre.sql)
     → que le **départ soit maigre** : une partie neuve commence
     avec **2 boosters**, comme le jeu local (`src/data/progression.json`, bloc
     `start`), au lieu de trois. `_pack_initial_packs()` est réécrite seule
     (même signature) ; un test miroir compare la réserve du serveur au fichier.
   - [`supabase/migrations/0032_serie_quotidienne.sql`](../supabase/migrations/0032_serie_quotidienne.sql)
     → que **la série quotidienne paie ses jours** (décision du
     7 octobre 2026) : le booster qui fait avancer la série verse les points du
     jour coché — J1 40, J3 60, J4 80, J5 120, J6 150 — et le 7ᵉ jour reste le
     gros lot (Perfect garanti ou 3 sabliers), sans micro-récompense en plus. Le
     versement passe par `_wallet_apply()` avec une référence par **journée de
     jeu** (`serie-jN-<jour>`) : dix boosters le même jour ne paient qu'une fois,
     et la réponse annonce `0 point` dans ce cas — le serveur ne promet jamais ce
     qu'il n'a pas versé. Les **jetons** et les **sabliers** ne passent pas par
     le serveur : ils vivent sur l'appareil, qui les ajoute à partir du même
     barème (`src/data/progression.json`). Même signature que `0031` :
     `create or replace` **remplace** la fonction — pas de surcharge possible.
     Détail : §8, « Le plancher de malchance, les jetons, les missions du
     jour ».
   - [`supabase/migrations/0031_pity_douze.sql`](../supabase/migrations/0031_pity_douze.sql)
     → que le **plancher de malchance** passe de 80 à **12** boosters
     (décision du 7 octobre 2026, sur le brief « 12 packs jusqu'au pity »). Le
     corps est la copie exacte de la version en vigueur (`0022`), seul le seuil
     change : même signature, `create or replace` **remplace** la fonction — pas
     de surcharge possible. Sans elle, l'écran annoncerait « garanti dans 12 » et
     le serveur en exigerait 80 : le jeu mentirait.
   - [`supabase/migrations/0030_gold.sql`](../supabase/migrations/0030_gold.sql)
     → que la variante **Gold** existe aussi hors « Perfect » : une
     Légendaire tirée ordinairement a **1 %** de chance d'être Gold (100 sur les
     10 000 du tirage de variante, comme le Holo à 75 — même échelle). Sans
     elle, le serveur ne produit **jamais** de Gold hors Perfect, alors que le
     moteur et l'écran des taux l'annoncent depuis le même jour : le jeu
     mentirait. Même signature que `0011` (`text, boolean, boolean`), donc
     `create or replace` **remplace** la fonction — pas de surcharge possible.
   - [`supabase/migrations/0029_wallet_surcharge.sql`](../supabase/migrations/0029_wallet_surcharge.sql)
     → applique la **surcharge** laissée par la première
     version de `0027`. Celle-ci créait `_wallet_apply` avec un cinquième
     paramètre (`p_once boolean default false`) ; la version corrigée n'en a plus
     que quatre, et `create or replace` — qui ne remplace que si la signature est
     **identique** — avait donc laissé **deux** fonctions. Un appel à quatre
     arguments, comme celui du tirage, devenait ambigu :
     « function public.\_wallet_apply(uuid, integer, text, text) is not unique » —
     vu en vrai le 7 octobre, et **le booster ne s'ouvrait plus**. La migration
     retire toute signature autre que `(uuid, integer, text, text)`, et refuse de
     retirer quoi que ce soit si la fonction canonique manque (il faut alors
     rejouer `0027` d'abord). Rejouable, sans effet sur une base neuve.
   - [`supabase/migrations/0028_wallet_saisons.sql`](../supabase/migrations/0028_wallet_saisons.sql)
     → la grille des familles (les créateurs de chaque
     vague, le seuil et les points de chaque palier), **générée depuis le jeu**
     par `npm run supabase:saisons`. Sans elle, réclamer un palier de famille est
     refusé avec un message qui le dit. Rejouable : rejouer le fichier remplace
     la grille au lieu de s'y ajouter.
   - [`supabase/migrations/0027_wallet.sql`](../supabase/migrations/0027_wallet.sql)
     → que les **points vivent au serveur** : le solde quitte la
     sauvegarde pour la table `wallets`, l'hôtel et l'Atelier ne dépensent plus
     que ce que le serveur a encaissé, et une sauvegarde trafiquée n'achète plus
     rien. ⚠️ **Après l'avoir posée**, lance une fois
     `select public.wallet_backfill();` (à la main, avec la clé de service) :
     chaque joueur connu ouvre
     son compte avec le solde de sa sauvegarde, sans attendre. Les joueurs qui
     arrivent ensuite s'ouvrent tout seuls. Détail : §8, « Les points vivent au
     serveur ».
   - [`supabase/migrations/0026_promo_codes.sql`](../supabase/migrations/0026_promo_codes.sql)
     → les **codes promo** : un code donné en stream (« BOOSTER-2026 »)
     se tape dans les réglages (Toi → menu → « J'ai un code ») et rend **un
     booster à ouvrir**, une fois par joueur. Un code inconnu, expiré ou épuisé
     est refusé ; une réserve pleine refuse **sans consommer** le code. Les deux
     tables sont fermées au client — la rédemption passe par
     `redeem_promo_code()`. Aucune création de code depuis l'application.
     Détail : §8, « Les codes promo ».
   - [`supabase/migrations/0022_pack_dans_saves.sql`](../supabase/migrations/0022_pack_dans_saves.sql)
     → que le **tirage écrive la collection lui-même**, dans la
     même transaction : plus de perte de cartes si l'appareil plante juste après
     un booster, plus d'écrasement par un second appareil, et le **blanchiment**
     fermé — une Légendaire ou une variante Live / Holo / Gold fabriquée dans la
     sauvegarde ne s'échange plus et ne se vend plus. La même migration fait
     arbitrer l'envoi de sauvegarde par la **version serveur** reçue
     (`p_base_updated_at`) et non plus par l'horloge de l'appareil. Détail : §8,
     « La sauvegarde ne se perd plus (`0022`) ».
     ⚠️ **Ordre** : c'est la dernière migration, elle repasse après les autres.
     Si tu rejoues une migration **ancienne** (par exemple `0005` pour les
     échanges, ou `0021` pour le registre), rejoue `0022` **derrière** :
     ces fichiers redéfinissent `create_trade()`, `respond_trade()`,
     `market_sell()`… et sans ce rejeu, les refus de provenance disparaissent
     en silence (le vérificateur le contrôle : « les refus de `0022` survivent au
     recollage »).
   - [`supabase/migrations/0021_provenance.sql`](../supabase/migrations/0021_provenance.sql)
     → que le serveur sache **d'où vient chaque carte** : le
     registre `card_claims` retient ce qui a été réellement donné (tirage,
     Paquet Scène, échange, hôtel, vol), et une sauvegarde contenant une
     **Légendaire** ou une variante **Live / Holo / Gold** sans provenance
     n'est plus classée (les cartes restent acquises). ⚠️ **Au moment où elle est
     posée, toutes les cartes déjà présentes dans les sauvegardes entrent au
     registre** : aucune collection existante n'est touchée. Détail : §8,
     « L'intégrité côté serveur ».
   - [`supabase/migrations/0020_identite.sql`](../supabase/migrations/0020_identite.sql)
     → que deux joueurs ne puissent plus porter le même nom à une
     majuscule près (`profile_name_unique`). Un trigger plutôt qu'un index
     unique : la migration passe même si la base contient déjà des doublons, et
     le message est lisible par le joueur. Aucun compte existant n'est renommé.
   - [`supabase/migrations/0017_reinitialiser.sql`](../supabase/migrations/0017_reinitialiser.sql)
     → que « **Réinitialiser la progression** » (écran Toi → menu)
     rejoue vraiment la partie à zéro **en ligne aussi** : sans cette migration,
     le serveur gardait sa réserve de boosters, son journal de tirages et le
     Paquet Scène du jour, et un joueur qui repartait de zéro attendait quand
     même la recharge de la partie qu'il venait d'effacer. Détail : §8,
     « Recommencer sa partie ».
   - [`supabase/migrations/0016_sortants.sql`](../supabase/migrations/0016_sortants.sql)
     → que **les Sortants** (les créateurs qui ont quitté le
     classement lors d'une régénération du catalogue) le soient aussi côté
     serveur : plus jamais tirés en booster, ni comptés dans la complétion, ni
     servis par le Paquet Scène — alors que leur ligne reste au catalogue, parce
     que leurs cartes circulent encore (classeur, échange, hôtel). Sans cette
     migration, une rotation du catalogue ne changerait rien en ligne. Détail :
     §8, « Les Sortants ».
   - [`supabase/migrations/0015_wishlist.sql`](../supabase/migrations/0015_wishlist.sql)
     → que le **créateur épinglé** existe côté serveur : un joueur
     épingle **un** créateur (celui qui lui manque), et son nom s'affiche sur sa
     fiche publique (`wishlist_slug`). Aucune possession exigée — on réclame
     justement ce qu'on n'a pas — et l'écriture passe par les fonctions, jamais
     par un `PATCH` de la table. Détail : §8, « La wishlist ».
   - [`supabase/migrations/0014_scene_pack.sql`](../supabase/migrations/0014_scene_pack.sql)
     → que le **Paquet Scène** existe côté serveur : une fois par
     **jour de jeu** (6 h UTC), cinq cartes de la famille visée, sans jamais de
     Légendaire. Le joueur **choisit** ses cartes parmi cinq listes de
     propositions, et le serveur recalcule ces listes avant d'accepter — un
     client ne peut pas répondre cinq Holo. Ce paquet ne fait pas monter le
     plancher de malchance (le journal distingue `kind = 'live'`). Détail :
     §8, « Le Paquet Scène ».
    - [`supabase/migrations/0043_scene_pack_eligibilite.sql`](../supabase/migrations/0043_scene_pack_eligibilite.sql)
      → complète `scene_pack_choices()` : petites familles, Scène pleine et
      réserve du dernier candidat. Migration additive ; test Postgres jetable
      non exécuté sous le compte Administrateur Windows (voir D-014/K-014).
   - [`supabase/migrations/0046_reset_rejoue_tutoriel.sql`](../supabase/migrations/0046_reset_rejoue_tutoriel.sql)
     → réinitialiser sa partie rejoue le tutoriel du compte connecté. Application
     sans reset immédiat, rejouable, aucun cadeau recrédité ; conserver 0044/0045.
     Validée sur PostgreSQL jetable ; application production encore attendue.
   - [`supabase/migrations/0013_progression.sql`](../supabase/migrations/0013_progression.sql)
     → que le **plancher de malchance** et la **série de jours**
     existent aussi côté serveur : après 12 boosters d'affilée sans Légendaire,
     le tirage en garantit une, et le 7ᵉ jour d'affilée offre un Perfect (ou
     3 sabliers). Les deux compteurs sont relus depuis le journal des tirages,
     pas depuis la sauvegarde du téléphone — un compteur client se trafiquerait.
     Détail : §8, « Le plancher de malchance ».
   - [`supabase/migrations/0012_last_pack.sql`](../supabase/migrations/0012_last_pack.sql)
     → que **le paquet reste exposé dix minutes** : les cinq cartes
     du dernier booster d'un joueur sont visibles par ses amis, qui peuvent y
     prendre une carte (une par jour). La carte quitte vraiment la collection du
     propriétaire, et une vieille sauvegarde ne peut pas la faire revenir.
     Détail : §8, « Le Last Pack ».
   - [`supabase/migrations/0011_direct.sql`](../supabase/migrations/0011_direct.sql)
     → que le **Direct fasse tomber plus**, côté serveur comme dans
     le moteur : les créateurs qui streament pèsent ×1,5 dans leur rareté, la
     variante Live leur est réservée (20 %, et systématiquement sur la carte
     garantie), et rien de tout cela ne s'applique si le cache du direct a plus
     de dix minutes. Détail : §8, « Le bonus Direct ».
   - [`supabase/migrations/0010_ventes.sql`](../supabase/migrations/0010_ventes.sql)
     → que le **carnet** sache dire « ta carte a été vendue » : une
     seule fonction (`market_sales()`), trois lignes de SQL. Le carnet marche
     sans — il n'annonce alors que les échanges et les amis.
   - [`supabase/migrations/0009_marche.sql`](../supabase/migrations/0009_marche.sql)
     → activer l'**hôtel des ventes** : déposer un doublon (payé
     comptant en points) et acheter au comptoir. Crée la table
     `market_listings` et les RPC `market_sell()`, `market_buy()`,
     `market_shelf()`, `market_listings_of()`. Détail : §8, « L'hôtel des
     ventes ».

> **Avant de poser une migration qui touche au tirage**, on peut la jouer sur
> un Postgres jetable, en local, sans toucher au projet Supabase :
>
> ```powershell
> npm run dev:setup          # une commande : installe ce qui manque, y compris les deux paquets ci-dessous
> npm run supabase:verify
> ```
>
> Ces deux paquets (`embedded-postgres`, `pg`) ne sont **pas** dans
> `package-lock.json` : ils ne servent qu'à la vérification, jamais à
> l'application ni à l'APK. `npm run dev:setup` les pose en `--no-save` ;
> l'équivalent à la main est `npm install --no-save embedded-postgres pg`. Sans
> eux, le vérificateur sort en succès **sans rien tester** — d'où la commande
> dédiée.
>
> Le script exécute **les trente-neuf migrations** (`0001` à `0039`) pour de vrai, dans
> un Postgres jetable, puis contrôle : le catalogue (1000 créateurs), les
> cartes (aucun doublon, une garantie Rare ou mieux), la recharge, la
> reprise de l'état local, la distribution du slot garanti (82 / 15 / 3 de
> `pull-rates.json` — 400 boosters) et **les échanges joués de bout en bout**
> avec trois joueurs : recherche, offre, refus, annulation, acceptation
> atomique, carte disparue entre-temps, droits et lecture par un tiers — plus
> le profil public (projection, complétion, rangs, tri Gold) sur trois autres
> joueurs, dont un dont la sauvegarde est invraisemblable, le direct, et **les
> amis joués de bout en bout** — demande, demande croisée, acceptation, refus,
> annulation, retrait, et ce qu'un joueur étranger ne voit pas. S'y ajoutent
> l'**hôtel des ventes** (dépôt payé comptant, comptoir, achat par un autre
> joueur, refus motivés), le **carnet des ventes** (`market_sales()`), le
> **bonus Direct** (poids ×1,5, variante Live réservée aux créateurs en direct,
> cache périmé → aucune carte Live) et le **Last Pack** (paquet exposé dix
> minutes, vol des deux côtés, refus d'un inconnu, garde-fou de `push_save`) et
> le **plancher de malchance** (journal amorcé à 11 boosters sans Légendaire, le
> 12ᵉ qui en sort une, compteur remis à zéro par un Légendaire de chance, série
> de jours cassée par un trou puis raccommodée, récompense du 7ᵉ jour dépensée
> une seule fois, fonctions internes fermées aux joueurs), le **Paquet
> Scène** (cinq listes de choix, tirage conforme accepté et normalisé, mauvaise
> famille, mauvaise rareté, variante non proposée, Légendaire, second paquet du
> jour → refus, plancher de malchance intact) et la **wishlist** (épingler,
> remplacer, retirer, créateur hors catalogue → refus, lecture par un autre
> joueur, écriture directe fermée).
> **241 contrôles** au total. Les deux
> dépendances ne sont **pas** enregistrées dans `package.json` : elles ne
> servent qu'à cette vérification et n'entrent ni dans l'APK ni dans la CI.
3. **Authentication → Sign In / Providers** : active **Anonymous sign-ins**
   pour la voie invitée. Garde **Email** activé si tu veux aussi proposer
   l'adresse + code ; « Confirm email » reste au choix (le code à 6 chiffres
   confirme l'adresse à lui seul).
4. **Authentication → Email Templates → Magic Link** : le modèle doit contenir
   le jeton, sinon le code reçu est un lien et l'application ne peut rien en
   faire. Ajoute par exemple :

   ```html
   <p>Ton code CreatorDeck : <strong>{{ .Token }}</strong></p>
   ```

   Pense aussi à **Email OTP Expiration** (1 heure par défaut, très bien) et à
   **Email OTP Length** = 6.
5. **Settings → API** : note l'**URL du projet** et la clé **anon public**
   (ou la clé **publishable** `sb_publishable_…`, qui la remplace dans les
   nouveaux projets). Prends bien l'« URL du projet » — `https://<référence>.supabase.co` —
   et non l'URL REST : un suffixe `/rest/v1/` est toléré (l'app le retire), mais
   l'adresse nue évite toute confusion.

> La clé `anon` est prévue pour être embarquée dans une application : ce sont
> les politiques RLS qui protègent les données. La clé `service_role`, elle, ne
> doit **jamais** apparaître dans l'app ni dans ce dépôt — elle contourne
> toutes les règles.

## 4. Compiler avec le cloud (sur ta machine, PowerShell)

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

(`.env` fonctionne aussi — Next lit les deux, `.env.local` l'emporte. Ce fichier
est ignoré par Git : il ne part jamais dans le dépôt.)

Renseigne les deux lignes, puis :

```powershell
npm run build
npx serve out
```

`NEXT_PUBLIC_*` est **inliné à la compilation** : après un changement de clé, il
faut relancer `npm run build` (et refaire l'APK), pas seulement recharger la
page.

## 5. Compiler l'APK avec le cloud (GitHub Actions)

Le workflow lit deux **variables de dépôt** (pas des secrets : la clé anon est
publique par conception) :

1. GitHub → **Settings → Secrets and variables → Actions → onglet Variables**
   → *New repository variable* ;
2. `NEXT_PUBLIC_SUPABASE_URL` = `https://xxxxxxxx.supabase.co` ;
3. `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la clé anon ;
4. relance le workflow **APK Android (debug)** en choisissant `main` dans
   « Use workflow from » (ou la branche de la PR si tu testes avant sa fusion).

Sans ces variables, l'APK se construit quand même : il se joue alors
uniquement sur l'appareil, et l'écran de compte explique que le cloud n'est pas
configuré.

Le même workflow porte deux contrôles **à côté** du build — ils ne le
retardent pas et ne le bloquent pas :

* le travail `verif` rejoue la pile SQL entière (`0001` → la dernière) sur un
  Postgres jetable et fait parler le serveur (450 contrôles) : c'est le seul
  endroit qui dit qu'un fichier de migration s'applique encore, dans l'ordre,
  sur une base neuve ;
* `npm run ecrans` monte l'application dans un DOM : les quatre onglets, les
  feuilles, un booster tiré et sa révélation.

Une migration cassée ou un écran cassé met donc le run au rouge — sans priver
le téléphone de son APK, qui reste téléchargeable.

## 6. Vérifier que tout fonctionne

1. Ouvre l'app → **Profil → Mon compte** ;
2. **Créer un compte invité** (ou, si tu as configuré un SMTP : adresse →
   **Recevoir un code** → recopie le code → **Valider le code**) ;
3. donne-toi un **nom** (2 à 24 caractères, dans **Profil public**) — la
   progression part en ligne toute seule ;
4. ouvre **Classement mondial** : tu dois y apparaître — les statistiques sont
   recalculées par le serveur, jamais envoyées par le téléphone ;
5. dans **Ma vitrine**, épingle jusqu'à quatre créateurs possédés et enregistre ;
   touche une ligne du classement pour ouvrir le profil public, avec sa vitrine
   et ses chiffres.

6. dans **Garder ce compte** (si tu es en invité), attache une adresse et un mot
   de passe, puis déconnecte-toi et reconnecte-toi par **« Se connecter avec un
   e-mail et un mot de passe »** : ta collection doit être reprise ;
7. dans **Échanges**, cherche un autre joueur par son pseudo (le classement en
   fournit), choisis une de tes cartes puis une carte qu'il possède, et
   **Proposer l'échange** ; avec un second compte, accepte l'offre : les deux
   collections bougent, et le message confirme le troc.

Ensuite, l'envoi est automatique une vingtaine de secondes après ta dernière
action, et l'écran **Mon compte** affiche une **pastille verte** (« Progression
synchronisée »). Rien à presser.

## 7. Comment les conflits sont traités

Deux appareils peuvent jouer la même collection. La règle est volontairement
prudente :

* **le contenu identique** → rien à faire ;
* **un côté nettement plus récent** (plus de 30 s d'écart) → l'app propose
  d'envoyer ou de charger, jamais les deux ;
* **les deux ont bougé** → l'app ne tranche pas : l'écran **Mon compte** montre
  **Deux parties t'attendent** — *Reprendre la partie en ligne* adopte la version
  distante, *Garder celle de cet appareil* écrase la sauvegarde en ligne.

Aucune fusion automatique : mélanger deux progressions produirait une
collection impossible à défendre côté serveur.

## 8. Ce que le serveur vérifie (et ce qu'il ne vérifie pas)

`push_save()` recalcule lui-même les statistiques à partir de la sauvegarde et
**refuse** ce qu'aucune partie réelle ne peut produire : carte sans créateur,
rareté ou variante inconnue, plus de créateurs que le catalogue, compteurs
négatifs. Seules les collections cohérentes sont classées.

La migration `0002_vitrine.sql` ajoute `set_showcase(p_slugs)`. Le serveur
normalise les slugs, refuse plus de quatre cartes et les noms de créateur au
format invalide, puis vérifie que chaque créateur figure dans `cards` de la
sauvegarde cloud de l'utilisateur connecté. Une carte encore uniquement sur
l'appareil doit d'abord être envoyée. L'écriture directe de `showcase_slugs`
est révoquée par privilège de colonne : le client ne peut modifier directement
que `display_name` (et son horodatage), la vitrine passe par cette fonction.

Depuis la migration `0004_tirage.sql`, le **contenu des boosters est décidé
par le serveur** : la fonction `open_pack()` tire les 5 cartes avec le même
algorithme que le moteur local (mêmes poids, mêmes variantes, même événement
« Perfect »), et le client ne peut ni les choisir ni les inventer. Une
sauvegarde fabriquée à la main peut encore mentir sur l'XP ou le niveau
(calculés localement), mais plus sur les cartes — c'est le prérequis des
échanges — ni, depuis `0027`, sur le solde de points, qui vit au serveur.

Depuis la migration `0006_profil_public.sql`, les compteurs qui servent au
**profil public** ne retiennent que les créateurs qui existent au catalogue :
`unique_creators`, `legendary_cards`, `gold_cards`… sont recompilés en croisant
la sauvegarde avec `public.creators`. Sans ce garde-fou, une sauvegarde
inventant 900 slugs fabriquait une complétion de 90 % sans posséder une seule
carte réelle. `total_cards`, lui, reste le compte brut de la sauvegarde.

### L'intégrité côté serveur

`0019_integrite.sql` ferme trois trous que la revue externe d'octobre 2026 a
pointés, tous vérifiés dans le code avant d'être corrigés :

- **La sauvegarde ne s'écrit plus en direct.** Jusqu'ici, un client pouvait
  `insert`/`update`/`delete` sur `public.saves`, `public.stats` et
  `public.pack_state` : les politiques RLS filtraient en silence, mais le droit
  d'écrire existait. Il est **révoqué** à `anon` et `authenticated` ; seul le
  serveur écrit, par `push_save()` (passée en `security definer`, elle prend
  l'identité dans `auth.uid()`, jamais dans le corps envoyé). Le jeu ne change
  pas : le client n'appelait déjà que des fonctions (`open_pack`, `push_save`).
- **La réserve de boosters naît au serveur.** `open_pack()` recopiait `packs`
  et `lastPackRegen` de `saves.state` à la création de la réserve : un client
  pouvait s'offrir quatre boosters et une ancre vieille de deux heures avant son
  premier tirage. La réserve naît maintenant **au départ du jeu** — trois
  boosters à l'origine, **deux** depuis `0033_depart_maigre.sql` —
  la ligne est verrouillée (`for update`) et le tirage ne lit plus la sauvegarde
  du tout. `open_scene_pack()` prend en plus un verrou d'avis
  (`pg_advisory_xact_lock`) pour que deux appels simultanés ne sortent pas deux
  Paquets Scène du même jour. Un trigger `pack_state_guard` garde la réserve
  dans ses bornes (0 à 4) et refuse une ancre dans le futur.
- **Chaque carte a une provenance.** `0021_provenance.sql` ouvre un registre
  (`card_claims`) : pour chaque joueur, combien de cartes de chaque (créateur,
  rareté, variante) le serveur a réellement données, et par quel chemin —
  `tirage`, `scene`, `echange`, `hotel`, `vol`, ou `heritage` pour la bascule.
  Une sauvegarde qui contient une carte **non couverte** par ce registre est
  suspecte (elle passe, le joueur n'est plus classé) — sauf ce que l'atelier
  peut fabriquer : l'artisanat local ne produit que du **Standard** de rareté
  commune à épique, donc une Légendaire ou une variante Live / Holo / Gold doit
  avoir une provenance serveur. C'est la classe de cartes qui a de la valeur, et
  c'est exactement celle qu'on ne peut plus inventer.
  **La bascule** : à la seconde où la migration est collée, toutes les cartes
  déjà présentes dans les sauvegardes entrent au registre comme `heritage` —
  personne ne devient suspect rétroactivement, et rien n'est retiré à personne.
  Ce qui reste hors couverture, volontairement : une collection créée dans un
  **build sans cloud** puis rattachée à un compte connecté (voir « Ce que le
  serveur ne vérifie pas »).
  Les échanges, l'hôtel et le vol inscrivent le droit **avant** d'écrire les
  sauvegardes : l'ordre compte, sinon le contrôle de provenance verrait arriver
  une carte avant son droit et le joueur perdrait son rang pour un échange
  honnête.
- **Un nom, un joueur.** `0020_identite.sql` refuse qu'un second profil prenne
  un pseudo déjà pris, à la casse et aux espaces près (`profile_name_unique`) :
  « Fabien » et « fabien » dans le même classement, c'est l'usurpation la plus
  simple. C'est un **trigger** et non un index unique, pour deux raisons : une
  contrainte ferait échouer la migration entière sur une base qui contient déjà
  des doublons (aucun compte n'est renommé ni supprimé), et le message peut être
  écrit en français. `0019` réserve déjà les noms **des créateurs** (nom
  affiché et login Twitch du catalogue).
- **Une rareté déclarée ne suffit plus à se classer.** `refresh_stats()`
  appelait `save_problems()` : refus net, la sauvegarde entière était rejetée.
  Il appelle désormais aussi `save_suspicions()`, qui **garde** la sauvegarde
  mais la marque `verified = false` quand une carte annonce un créateur hors
  catalogue, une rareté qui ne correspond pas au catalogue, ou des
  identifiants en double. Le joueur conserve ses cartes ; il sort simplement du
  classement. Bonus : `profile_name_reserve` interdit de prendre le pseudo d'un
  créateur du catalogue, et `public.profiles` n'est plus lisible par le rôle
  anonyme (énumération d'identifiants).

> **À retenir si tu écris une migration.** Un `create or replace function`
> réécrit la fonction **entière** : recopier la définition d'une migration
> ancienne annule en silence toutes les migrations suivantes qui l'avaient
> modifiée. `0019` reprend donc les **dernières** définitions — celle de
> `0012` pour la garde du Last Pack, celle de `0016` pour l'exclusion des
> Sortants du classement. En cas de doute :
> `grep -n "create or replace function public.<nom>" supabase/migrations/*.sql`
> et prendre la dernière.

Le vérificateur `npm run supabase:verify` a été aligné sur la vraie manière dont
Supabase accorde les droits : les privilèges de table sont posés **par défaut, à
la naissance de la table** (`alter default privileges`), et non re-accordés
après coup — sinon le harnais redonnait à `authenticated` ce qu'une migration
venait de lui retirer, et le contrôle « la sauvegarde ne s'écrit plus en
direct » passait au vert sans rien prouver. Ce détail a mis au jour trois
contrôles qui passaient pour de mauvaises raisons (`user_cards` et
`market_listings`, révoquées depuis `0006` et `0009`, étaient lues avec succès
parce que le harnais les avait rendues lisibles) : ils attendent maintenant le
refus, comme en production.

### La sauvegarde ne se perd plus (`0022`)

Quatre corrections, toutes nées de la revue externe d'octobre 2026, et toutes
vérifiées par un test qui échoue si on les retire :

1. **Le tirage écrit la collection.** `open_pack()` et `open_scene_pack()`
   rangeaient les cartes dans `pack_draws` mais pas dans `saves` : c'est le
   client qui renvoyait sa collection aussitôt, avec `p_force = true`. Un
   plantage entre les deux, ou un second appareil qui poussait sa version,
   perdait le tirage. Les deux fonctions écrivent maintenant `saves.state` dans
   la **même transaction** — identifiants UUID nés du serveur, `obtainedAt` à
   l'heure serveur, compteurs et `state_checksum` recalculés — et renvoient la
   ligne dans `save`. Le client l'adopte (`sanitizeState` puis `applyState`) et
   ne pousse plus rien : le seul envoi automatique qui reste est celui des 20
   secondes (craft, recyclage, thème), jamais forcé.
2. **Le blanchiment est fermé.** Le registre de provenance de `0021` ne sert à
   rien si on peut le **nourrir** avec une copie fabriquée : une carte inventée
   dans la sauvegarde s'échangeait, et `card_claim_add()` lui donnait un droit
   tout neuf chez l'autre joueur. Quatre portes refusent désormais ce qui n'est
   pas couvert par le registre du **donneur** : proposer un échange, l'accepter,
   vendre à l'hôtel, et acheter une annonce (une annonce peut dater d'avant
   `0022`). Le refus est une **exception** lisible, pas un déclassement.
   Rappel de la règle : le **Standard commune → épique** reste libre (c'est
   l'artisanat local) ; une **Légendaire** et toute variante **Live / Holo /
   Gold** exigent une provenance serveur.
3. **L'arbitrage n'écoute plus l'horloge du téléphone.** `push_save()` décidait
   du conflit avec `device_updated_at` du client : un appareil dont l'horloge
   avance gagnait tous les conflits en silence. Il compare maintenant la version
   serveur reçue (`p_base_updated_at`) à celle de la ligne ; sans version de
   départ, c'est un **conflit** — l'écran propose de charger ou d'écraser. La
   comparaison tolère **une milliseconde** : un client JavaScript ne connaît que
   les millisecondes, Postgres garde les microsecondes, et sans cette marge
   chaque envoi honnête serait vu comme un conflit. `p_force` reste réservé aux
   gestes explicites du joueur (« Garder celle de cet appareil », et l'écrasement
   proposé par l'écran « Deux parties t'attendent ») : après une action décidée par le serveur
   (échange accepté, hôtel, Last Pack, arène, réinitialisation), le client
   **relit la version serveur** puis envoie la sienne dessus, sans forcer.
4. **Le pseudo d'attente ne bloque plus une sauvegarde.** `ensure_profile()`
   fabriquait « Collectionneur # » avec les **quatre** premiers caractères de
   l'identifiant : deux joueurs qui commencent pareil tombaient sur le même nom,
   et `_display_name_unique()` (`0020`) refusait le second — donc **toute sa
   sauvegarde**. Le suffixe s'allonge maintenant jusqu'à trouver un nom libre.

### Ce que le serveur ne vérifie pas (volontairement)

L'XP et le niveau restent calculés sur l'appareil, comme les **sabliers** et
les **jetons** : ces ressources-là n'ouvrent que du contenu solo et ne valent
rien pour un autre joueur. Le **contenu des boosters** (donc les cartes) et,
depuis `0027`, le **solde de points** sont décidés et écrits par le serveur — un
solde trafiqué dans la sauvegarde est recollé à la vérité à la première lecture
et n'a rien pu acheter entre-temps. Depuis `0019`, une sauvegarde qui invente
des **créateurs** ou des **raretés** sort du classement, et depuis `0021` les
cartes de valeur sans provenance serveur aussi. Ce qui reste ouvert, en toute
connaissance de cause : une sauvegarde qui déclare des cartes **artisanales**
(Standard, commune à épique) non obtenues — c'est la contrepartie de l'atelier
hors ligne, et ça ne vaut pas une Légendaire — et une collection créée dans un
build sans cloud puis rattachée à un compte connecté. Ce qui n'est pas
falsifiable, c'est ce qui passe par le serveur : le tirage, les échanges,
l'hôtel, la réserve de boosters et le classement.

### Le profil public, calculé par le serveur

Ouvrir le classement puis toucher une ligne affiche la fiche d'un joueur :
vitrine, complétion du catalogue, rang, répartition par rareté, et une affiche
à partager (dessinée sur l'appareil, voir `src/lib/poster.ts`).

Tout vient de `player_profile(p_user_id)` en un appel :

* les chiffres de `public.stats` (recalculés à chaque sauvegarde) ;
* la **complétion** = créateurs uniques / taille du catalogue, calculée côté
  serveur — le client ne fait pas la division ;
* le **rang** = nombre de joueurs vérifiés devant, sur la complétion et sur le
  nombre total de cartes ;
* la **répartition par rareté** (« 12 / 50 légendaires ») : la rareté est relue
  dans `public.creators`, pas dans la sauvegarde ;
* les **quatre cartes épinglées** : les seuls noms de cartes qui sortent d'un
  profil public — jamais la collection.

La lecture se fait par une **projection** : `public.user_cards` reçoit une ligne
par carte possédée, recalculée par le trigger `project_cards()` à chaque
écriture de `saves`. C'est ce qui rend ces questions répondables sans ouvrir
toutes les sauvegardes à chaque requête — et c'est cette table qui portera le
marché entre joueurs. Elle porte une RLS active **sans aucune politique** :
même le joueur dont les cartes y sont ne peut pas la lire directement. La
sauvegarde JSON reste la source de vérité ; la table n'est qu'un index que le
serveur reconstruit tout seul.

Le **lien de partage** est de la forme `…/?profil=<identifiant>`. Une
application sans serveur ne peut pas fabriquer une page par joueur (l'export
statique n'a pas de route dynamique) : c'est donc une adresse unique avec un
paramètre, qui ouvre la fiche. Dans l'APK, où l'app est servie depuis
`https://localhost`, elle n'a de sens que sur place — l'écran le dit, et
propose l'affiche à la place.

### Les échanges sont tranchés par le serveur

Un échange déplace des cartes entre **deux** collections : c'est le seul
endroit où une erreur serait irréparable (une carte volée ou dupliquée). La
logique vit donc entièrement dans `0005_echanges.sql` :

* `public.trades` est en **lecture seule** pour les joueurs : une politique de
  `select` limite chaque offre à ses deux participants, et il n'existe **aucune**
  politique d'insertion, de mise à jour ou de suppression. Tous les changements
  passent par les fonctions `security definer`, qui revérifient tout ;
* **un client ne peut pas écrire dans la sauvegarde d'un autre joueur** : la
  politique de `saves` ne l'autorise que sur la sienne, et `respond_trade()`
  écrit les deux collections dans la même transaction, sous verrou
  (`for update`, dans l'ordre des identifiants pour éviter les interblocages) ;
* le serveur **ne croit pas le client sur la valeur des cartes** : la rareté est
  recopiée depuis `public.creators`, et la variante doit exister au catalogue ;
* l'acceptation vérifie que **chacun possède encore ce qu'il donne**, sur sa
  sauvegarde cloud (jamais sur une liste envoyée par le client). Si une carte a
  disparu entre-temps, l'exception annule tout : personne ne perd rien ;
* les deux sauvegardes réécrites doivent rester valides (`save_problems`) :
  sans ce contrôle, un troc pourrait faire passer un joueur en « collection non
  vérifiée » au classement. Les statistiques sont recalculées par le trigger
  habituel (`refresh_stats`) ;
* un troc **ne touche ni aux points, ni à l'XP, ni au niveau, ni aux
  boosters** : il ne fait que déplacer des cartes. En revanche, une carte
  épinglée qui part en échange **quitte la vitrine publique** (`set_showcase`
  n'aurait jamais accepté de l'y laisser) ; Les cartes reçues portent
  `fromTrade` (numéro de l'échange), ce qui permet au client d'appliquer le
  mouvement **une seule fois** — même si l'appareil recharge sa partie après
  coup ;
* la collection des autres joueurs reste privée. Deux réponses seulement sont
  ouvertes : la **recherche par pseudo** (nom, niveau, nombre de créateurs
  uniques — pas les cartes) et `player_variants()`, qui dit quelles variantes
  un joueur possède **pour un créateur donné**, afin qu'une offre puisse
  aboutir. Jamais la collection entière, jamais les quantités.

Côté app, un échange se joue en deux temps :

| Moment | Ce que fait l'appareil |
| --- | --- |
| Proposer | envoie d'abord la partie locale au cloud (le serveur vérifie cette collection-là) ; si le cloud est plus récent, l'offre est abandonnée avec un message |
| Accepter | envoie aussi la partie locale d'abord, puis applique le mouvement renvoyé par le serveur et pousse le résultat |
| Consulter | `list_trades()` renvoie les offres ; un échange accepté pendant que l'appareil était ailleurs est appliqué automatiquement à la collection locale |

### Le tirage est décidé par le serveur

Depuis la migration `0004_tirage.sql`, ouvrir un booster demande une
connexion. La fonction `open_pack()` tire les 5 cartes avec exactement le même
algorithme que le moteur local (`src/lib/game-engine.ts`) : mêmes poids par
slot (recopiés depuis `src/data/pull-rates.json` avec un commentaire qui pointe
le fichier), même événement « Perfect » (1 ‰), même ordre de révélation — la
carte garantie en **dernier** (aucun mélange, c'est le moment fort de
l'ouverture) —, aucun créateur en double dans un même booster.

Trois situations possibles côté client :

| Situation | Comportement |
| --- | --- |
| Cloud configuré + connecté | ouverture via `open_pack()` ; le serveur **range lui-même** les cartes dans `saves` et renvoie la ligne, que le client adopte (`0022`) |
| Cloud configuré + hors ligne ou sans compte | message « Connecte-toi pour ouvrir un booster » + raccourci vers l'écran Compte ; **pas de repli silencieux** |
| Cloud non configuré (dev, tests) | tirage local inchangé : le moteur local reste le comportement par défaut |

**Le tirage écrit la collection dans la même transaction** (`0022`, 7 octobre).
Avant, le serveur tirait les cartes mais ne les rangeait nulle part : c'est le
client qui renvoyait sa collection juste après, avec un drapeau `p_force` pour
passer devant tout le monde. Trois conséquences, toutes mauvaises : un plantage
entre le tirage et l'envoi perdait les cartes ; un second appareil qui poussait
sa version les écrasait ; et un client bricolé pouvait envoyer n'importe quoi.
`open_pack()` et `open_scene_pack()` écrivent désormais `saves.state -> 'cards'`
eux-mêmes (identifiants UUID nés côté serveur, `obtainedAt` = heure serveur,
compteurs de la même transaction) et renvoient la ligne écrite dans `save`. Le
client l'adopte au lieu de pousser : plus de `push(…, true)` après un tirage, la
seule poussée restante est l'envoi automatique des 20 secondes (craft, recyclage,
thème), sans forçage. Le test `e2e/pack-crash.spec.ts` rejoue le contrat côté
navigateur : tirage, rechargement, mêmes cinq cartes.

**Pas de repli silencieux** : si le cloud est configuré et que la connexion
est coupée, on n'ouvre pas « en attendant » côté local. L'écran explique
qu'il faut se connecter, et propose un accès direct à l'écran Compte.

**La réserve aussi vient du serveur.** Dès qu'un compte est connecté, le client
lit `pack_status()` — même calcul de recharge que `open_pack()`, sans rien
consommer — et adopte le compteur et l'ancre (`last_regen_at`) dans la partie
locale : l'affichage et le tirage ne divergent plus si l'horloge de l'appareil
dérive ou si la sauvegarde locale a été bricolée. Le sablier (`spendHourglass`)
ne sait avancer qu'une réserve locale : il est donc désactivé dans les builds
avec cloud (l'écran l'explique), et reste actif dans les builds sans cloud.

**Le catalogue est en lecture seule.** La table `public.creators`
(`0003_catalogue.sql`) a la RLS activée et **aucune politique d'écriture** : ni
le client ni un appel direct à l'API ne peuvent changer une rareté, un nom ou
un rang. Seul le SQL Editor (propriétaire des tables) la modifie — c'est ce qui
garantit que le tirage serveur lit toujours le catalogue publié.

En cas de refus « aucun booster », le client relit aussitôt `pack_status()` :
si un sablier ou une horloge locale avait gonflé la réserve affichée, le
compteur et le compte à rebours se réalignent sur le serveur immédiatement.

### Le plancher de malchance, les jetons, les missions du jour

`0013_progression.sql` ajoute au serveur ce que le moteur local applique déjà :
**après 12 boosters d'affilée sans Légendaire, le 5ᵉ slot en garantit une**. Le
seuil est celui de `src/data/pull-rates.json` (bloc `pity`), donc publié dans
l'écran « Taux de drop » avec sa probabilité réelle de s'activer, et
`src/lib/supabase-progression.test.ts` tombe si les deux divergent.

Ce que la migration change, et pourquoi :

* `_pack_pity(user)` relit le **journal des tirages** (`pack_draws`) à l'envers
  et s'arrête au premier tirage contenant une Légendaire : ce qu'elle a compté
  avant, c'est le compteur. Un Légendaire de **chance** remet donc le compteur à
  zéro au même titre que celui de la garantie.
* `_pack_streak(user, now)` compte les jours de jeu d'affilée avec un booster,
  la journée commençant à **6 h UTC** — exactement la conversion de
  `gameDay()` côté moteur, sinon les deux ne tomberaient plus le même jour.
  `_pack_perfect_today()` dit si le Perfect du jour est déjà sorti.
* `open_pack(p_jackpot text)` force le tirage quand le compteur atteint le seuil
  ou quand c'est le 7ᵉ jour de série. Le joueur peut préférer **3 sabliers** :
  il le dit (`p_jackpot = 'hourglasses'`), et le serveur se contente de ne pas
  forcer le tirage — cette monnaie ne vit que sur l'appareil, il n'y a donc rien
  à créditer côté serveur, et rien à y gagner en trichant. La récompense attend
  **toute la journée** : un booster normal le matin ne la consomme pas, c'est le
  premier Perfect du jour qui la dépense.
* `pack_status()` renvoie `pity`, `streak` et `jackpot_ready` : le chiffre
  affiché (« Légendaire garanti dans N boosters ») est **celui qui décidera du
  tirage**, pas une illustration.
* Depuis `0032`, `open_pack()` paie aussi **le jour de la série** : le jour du
  cycle est `((streak - 1) % 7) + 1` — le 8ᵉ jour redevient un J1 — et les points
  du jour sont versés dans le wallet, avec la journée de jeu dans la référence
  pour qu'un même jour ne paie qu'une fois. Les jetons et les sabliers restent
  sur l'appareil, et le 7ᵉ jour ne paie que le jackpot.
* La migration **supprime l'ancienne `open_pack()` sans argument** avant de la
  recréer : sans ce `drop`, Postgres garderait les deux signatures et un appel
  sans argument continuerait d'ignorer la garantie.

**Pourquoi le compteur ne vient pas de la sauvegarde.** `open_pack()` reçoit une
sauvegarde d'appareil que le joueur peut éditer : un compteur rangé là-dedans
suffirait à obtenir une Légendaire à chaque booster. Les deux compteurs sont
donc **déduits** du journal, que seule `open_pack()` écrit — et comme rien n'est
stocké, il n'y a rien à resynchroniser. Les fonctions internes sont fermées aux
joueurs (`revoke … from public, anon, authenticated`).

**Les jetons sont passés au serveur (`0035`, 7 octobre 2026).** Comme l'XP
avant eux, ils vivaient dans la sauvegarde : un client bricolé s'offrait les
cartes de son choix, et ces cartes comptaient dans la collection — celle sur
laquelle le serveur paie les paliers de complétion. C'était le dernier trou
d'économie laissé ouvert par `0027`.

| Ce qui se passe | Comment |
| --- | --- |
| Le solde vit au serveur | table `tokens` (jamais négative) + journal `token_ledger`, fermés au client (`revoke` + RLS) |
| Un mouvement ne repasse jamais | index unique `token_ledger_once (user_id, kind, ref)` : le journal décide, exactement comme `wallet_ledger_once` |
| Le booster paie ses jetons | trigger `_wallet_on_draw()` (le même qui paie les 12 points) : 5, ou **7** pendant le Prime Time |
| Le Paquet Scène ne paie rien | le barème parle du « booster ouvert », et le moteur local ne lui donne rien non plus |
| La série paie ses jetons | dans `open_pack()`, avec la **même référence de journée** que les points (`serie-jN-<jour>`) : 10 au J4, 15 au J6 |
| La carte visée coûte 400 | `tokens_spend(slug)` : prix relu (`token_prices()`), refus d'une Légendaire, d'un créateur retiré ou déjà possédé, et « il te manque N jetons » sinon |
| Le solde affiché est celui du serveur | `tokens_get()` recale le miroir `state.tokens` — une sauvegarde gonflée à la main disparaît à la première lecture |
| La bascule ne perd rien | `_tokens_ensure()` ouvre le compte **une fois** avec le solde déjà gagné, borné à un million |

Le **Prime Time** est évalué côté serveur en **Europe/Paris** (le fuseau du
jeu) : l'écran, lui, lit l'heure de l'appareil — pour un joueur en France, les
deux réponses sont identiques à la seconde près. Le barème est écrit **une seule
fois** dans `src/data/progression.json` et repris par le SQL :
`src/lib/supabase-jetons.test.ts` compare les deux, donc un chiffre retouché
d'un côté fait tomber la suite avant le jeu.

**La série paie ses jours (`0032`).** Les six premiers jours ne donnaient rien :
une case cochée sans lot, c'est une frustration. Depuis le 7 octobre 2026, le
**booster qui fait avancer la série** verse la récompense du jour :

| Jour | Récompense | Où elle est versée |
| --- | --- | --- |
| J1 | 40 points | serveur (`_wallet_apply`, `kind = 'streak'`) |
| J2 | 1 sablier | appareil |
| J3 | 60 points | serveur |
| J4 | 80 points **+ 10 jetons** | les deux au serveur (depuis `0035`) |
| J5 | 120 points **+ 1 sablier** | points au serveur, sablier sur l'appareil |
| J6 | 150 points **+ 15 jetons** | les deux au serveur |
| J7 | Perfect garanti **ou** 3 sabliers | le jackpot — aucune micro-récompense en plus |

Une semaine pleine vaut **450 points, 2 sabliers et 25 jetons** : de quoi
fabriquer dix cartes communes à l'Atelier (45 points l'unité), jamais une
Légendaire. Le barème est écrit **une seule fois**, dans
`src/data/progression.json` (bloc `streak.rewards`) ; le SQL le reprend ligne
pour ligne et deux tests miroirs refusent qu'un côté parte sans l'autre
(`src/lib/game-progression.test.ts`, `scripts/verify-supabase-migrations.mjs`).

Deux détails qui comptent : le jour du cycle est `((streak - 1) % 7) + 1`, donc
le 8ᵉ jour redevient un J1 ; et la référence du versement contient la **journée
de jeu** (`serie-jN-<jour>`), donc un deuxième booster le même jour ne paie rien
de plus — et la réponse annonce alors `0 point`, parce que le serveur ne doit
jamais promettre ce qu'il n'a pas versé. Un jour manqué remet la série à zéro :
le prochain booster est un J1, et il paie à nouveau.

**Savoir ce qui est collé (`0035`, complétée par `0036`, `0037`, `0038` puis
`0039`).** `schema_versions()` rend un objet
`{ "0030": true, …, "0039": true }` : chaque clé est un numéro de migration, la
valeur dit si elle est **dans la base**. Elle ne lit que le catalogue (le texte
des fonctions internes, via `_schema_body()`) et ne rend que des booléens — donc
elle se lit **sans compte** :

```bash
curl -s -X POST "https://<projet>.supabase.co/rest/v1/rpc/schema_versions" \
  -H "apikey: <clé publique>" -H "Authorization: Bearer <clé publique>" -d '{}'
```

C'est ce qui permet de vérifier une installation depuis un téléphone, sans
ouvrir l'application : `0034` ne crée aucun objet (elle reprend deux fonctions
existantes), donc son absence ne se voyait nulle part ailleurs.

**Sur ta machine, le CLI répond la même chose en une commande** — c'est la
façon normale de savoir où on en est :

```powershell
npx supabase migration list
```

Deux colonnes, `Local` et `Remote` : un numéro présent d'un seul côté est un
fichier qui reste à poser (`db push`), ou une version que la base connaît sans
que le dossier l'ait (là, `migration repair`). Le contrôle par la **base
elle-même** (`schema_versions()`, lu avec la clé publique sur
`/rest/v1/rpc/schema_versions`) reste utile quand on n'a **pas** de terminal
sous la main — et il dit la même chose.

Le workflow `.github/workflows/prod-check.yml` répondait à la même question
depuis un runner et écrivait le verdict en clair dans le journal du run (une
ligne `0030` → `0039` par migration, `collée` ou `ABSENTE`). Il a été
**supprimé le 8 octobre 2026** avec les autres workflows du dépôt (commits
`ae5016f` et `8760723`) : le verdict se lit donc maintenant avec la requête
ci-dessus, ou avec la boucle `curl` qui l'interroge en une commande.

### La chaîne vit au serveur (`0036`)

**Le simulateur de streameur (`0036_streamer.sql`).** La porte « Ta chaîne »
s'ouvre depuis l'accueil : la chaîne grandit **par journées de jeu** (6 h UTC, la
même journée que les missions et la série) et publie **une vidéo par journée**,
choisie dans un calendrier de quatre formats. Ce qui se joue tout seul — la
croissance pendant l'absence, le tirage de la vidéo, le gain, les jetons — est au
**serveur** :

- `streamer_status()` lit l'état : abonnés, croissance par jour, « la vidéo du
  jour est publiée », jetons versés aujourd'hui, plafond ;
- `streamer_visit()` calcule le **retour** : les journées de jeu écoulées depuis le
  dernier passage, **plafonnées à sept** — une absence ne paie jamais mieux que le
  jeu —, et un écart **négatif vaut zéro** : reculer l'horloge du téléphone ne
  crédite rien. Le relevé (`last_seen_at`) vit dans `streamer_channels`, donc la
  même absence ne se paie pas deux fois, même en changeant d'appareil ;
- `streamer_publish(format)` **tire la vidéo** : réussite, buzz, bad buzz et gain
  viennent de `random()` côté serveur, avec les mêmes chances que
  `src/data/streamer.json` — le fichier que lit le moteur local. Le client
  n'envoie **qu'un nom de format** : il ne peut pas s'offrir une réussite.
  L'index unique `(user_id, day)` fait qu'une seconde publication le même jour
  **relit** la première (`already: true`) au lieu de la rejouer.

La chaîne paie en **jetons** — 6 par vidéo réussie, +10 si elle buzz, **plafonnés à
40 par journée** — et le versement passe par `_tokens_apply()` (le journal de
`0035`, dont l'index unique porte la journée) : un seul versement par jour, quoi
qu'il arrive. C'est ce qui empêche la chaîne de devenir une machine à jetons, donc
une machine à cartes.

* **Le client** : `src/lib/cloud/api/streamer.ts` — trois appels (`streamerStatus`,
  `streamerVisit`, `streamerPublish`), aucun montant transmis. Le magasin
  (`src/lib/cloud/store/streamer.ts`) applique la règle des trois portes comme
  les points et les jetons : sans cloud c'est le moteur local qui paie,
  connecté c'est le serveur, et sans compte on refuse au lieu de fabriquer des
  abonnés.
* **L'écran** (il n'existe plus : il a été retiré de l'application le
  8 octobre 2026 au soir, voir `docs/ta-chaine.md`) lisait tout ce que le
  serveur écrit — abonnés, palier, formats (chances publiées), résumé du retour,
  jetons du jour. Le serveur, lui, est **intact** : les fonctions ci-dessous
  répondent toujours, et `npm run supabase:verify` les joue à chaque fois. L'état
  local (`state.streamer`)
  n'est qu'un miroir : `applyStreamerMirror()` l'écrit quand le serveur a parlé,
  et `sanitizeState()` le relit sans le croire (abonnés positifs, format connu,
  jetons bornés au plafond).

Un test miroir (`src/lib/supabase-streamer.test.ts`) compare le SQL au fichier :
paliers, chances, plafonds, journée à 6 h UTC, tables fermées au joueur, et le fait
que le rapport `schema_versions()` est bien écrit par la **dernière** migration.

**Poser `0036` après `0035`.** `schema_versions()` est réécrit par chaque
migration qui l'étend : le rapport lu est celui de la **dernière** posée.
Rejouer `0035` après `0036` fait disparaître la ligne `0036` du rapport — les
fonctions de la chaîne, elles, restent en place ; rejouer `0036` la remet. Le
vérifieur joue les deux cas plutôt que de les commenter.

### Les imprévus et le setup de la chaîne (`0038`)

**Deux ajouts à la chaîne, et une seule règle nouvelle : le serveur tire, le
joueur choisit un côté.**

* **L'imprévu du jour** (`streamer_event_today()`, `streamer_choose(event,
  choix)`). Une carte par journée de jeu, tirée **par le serveur** :
  `_streamer_event_for(user, journée)` la choisit avec `md5(user, journée)`,
  donc elle ne change pas entre deux ouvertures, et deux joueurs ne tombent pas
  sur la même. Six cartes (`modo`, `sponsor`, `clip`, `coupure`, `raid`,
  `nuit`), **deux côtés chacune** : un côté sûr (chance plus haute, gain plus
  faible) et un côté qui rapporte plus. Le client envoie **la carte et le
  côté** ; le serveur refuse une carte qui n'est pas celle du jour, un côté qui
  n'existe pas, et **relit** la première réponse si on insiste (index unique
  `(user_id, day)`, comme la vidéo). Les jets sont les mêmes que la vidéo ;
  l'issue et le gain sont écrits dans `streamer_events`. **Aucun jeton ne
  bouge** : la monnaie de la chaîne garde une seule porte, la vidéo du jour.
  Le *texte* de la carte n'est pas dans le SQL : il vit dans
  `src/data/streamer.json`, et un client qui ne connaît pas la carte ne peut pas
  la jouer.
* **Le setup** (`streamer_setup_buy(palier)`). Cinq paliers payés en **points**
  — 120 / 320 / 780 / 1 800 / 4 200 — **dans l'ordre et une seule fois**, qui
  font grandir la chaîne **pour toujours** : +3 %, +5 %, +7 %, +10 %, +25 %
  (soit +50 % au bout). Le débit passe par `_wallet_apply(user, -prix, 'setup',
  palier)` : c'est le journal unique du wallet (`(user_id, kind, ref)`) qui rend
  le palier **définitif**, même si le client rappelle. Le **prix vit au
  serveur** — le client n'envoie que le nom du palier — et le solde est relu
  chez lui après l'achat (`syncWallet()`), comme à l'hôtel.
  Le **bonus** est la somme des paliers jusqu'au **premier manquant du
  préfixe** : une ligne ajoutée à la main (un palier « volé ») ne donne aucun
  bonus — et `_streamer_setup_next(user)` rend le premier palier manquant, donc
  elle **ne fait pas sauter l'étape suivante** non plus. `_streamer_growth(user,
  abonnés)` applique ce bonus, et c'est cette fonction que lisent
  `streamer_status()`, `streamer_visit()` **et** `streamer_publish()` : la
  croissance payée pendant l'absence est la même que celle payée sur une vidéo
  — la vidéo du jour paie donc elle aussi 259 et non 240 quand le premier palier
  est installé. Le vérifieur le joue pour de vrai : deux joueurs publient le
  même format avec la **même graine** (`setseed`), donc le même tirage, et seule
  la croissance diffère.

**Côté appareil**, `src/lib/cloud/api/streamer.ts` porte les trois appels
(`streamerEventToday`, `streamerChoose`, `streamerSetupBuy`) et
`src/lib/swipe.ts` le geste : le côté s'arme au-delà de **64 px** de course
horizontale, un **effleurement** ne choisit rien, un geste **retiré**
(`pointercancel`) repose la carte, et un glissement surtout vertical reste un
défilement. Les deux boutons de repli portent les mêmes réponses, chances
affichées. Hors ligne, le moteur local (`chooseStreamerEventLocally`,
`buyStreamerSetupLocally`) applique **les mêmes règles** — refus compris : une
carte qui n'est pas celle du jour est refusée en local aussi.

**Coller `0038` après `0037`** (donc après `0036`). Les deux migrations
remplacent des fonctions de `0036` : rejouer `0036` seule après `0038` refait
passer `streamer_status()` à l'ancienne version, et l'écran perd le setup
(le vérifieur joue ce piège au lieu de le commenter).

### Les invités sur le bureau (`0039`)

**Deux cartes du classeur, et un raid payé quand leur créateur streame
vraiment.** C'est la sixième étape de « Ta chaîne », et la deuxième qui paie
quelque chose — les abonnés, jamais une monnaie.

* **Le bureau** (`streamer_guest_set(place, carte)`). Deux places
  (`streamer_guests`, clé `(user_id, slot)`, `check (slot between 1 and 2)`).
  Le client envoie la carte **telle qu'elle est dans sa collection** —
  identifiant, créateur, rareté, variante — et le serveur vérifie **qu'elle est
  bien au joueur** avec `card_claim_covers()`, la règle déjà utilisée par les
  échanges et l'hôtel : une carte prêtée ou perdue ne tient pas le plateau. Une
  carte par créateur (index unique `streamer_guests_un_createur`), donc deux
  invités de deux créateurs **différents**. Le bureau **ne coûte rien** : ni
  jeton, ni point. Une carte nulle libère la place, et le refus revient en
  clair (`place-inconnue`, `carte-sans-identifiant`, `createur-inconnu`,
  `rarete-inconnue`, `variante-inconnue`, `meme-createur`,
  `carte-non-possedee`) — l'écran affiche la phrase, il ne devine pas.
* **Le raid** (`streamer_raids`, clé `(user_id, day)`). Un invité dont le
  créateur est **en direct** rapporte `floor(croissance du jour × pour-mille /
  1000)` abonnés : **15 / 25 / 40 / 60 / 90** pour mille selon la rareté de la
  carte (Commune → Légendaire). La règle vit **deux fois** — dans
  `src/data/streamer.json` (`guests.raidPermille`) et dans
  `_streamer_guest_permille()` — et le test `src/lib/supabase-streamer.test.ts`
  tient les deux copies ensemble, comme pour les taux de drop.
* **Le direct est lu, jamais deviné.** La fraîcheur vient de
  `live_state.refreshed_at`, et la fenêtre est **la même que le badge** :
  `_streamer_live_window()` = dix minutes = `LIVE_TTL_MS` côté application. Un
  invité dont le direct date d'hier ne paie pas, et un cache périmé ne paie pas
  non plus — le vérifieur joue les deux cas (cache à −20 min : 0 ; cache frais :
  le raid tombe).
* **Une seule fois par journée de jeu.** Le raid se paie **dans
  `streamer_visit()`** : si la ligne du jour manque et qu'un invité est en
  direct, elle est écrite et les abonnés tombent ; sinon le relevé **relit** ce
  qui a été payé (`already: true`). Changer d'invité, rouvrir l'écran ou
  reposer une carte ne rouvre donc jamais la caisse — et un relevé qui ne paie
  rien **n'écrit rien**, ce qui laisse la journée ouverte si le direct n'était
  pas encore frais.
* **Ce que l'écran reçoit.** `streamer_status()` rend `guests` (le bureau),
  `raid_day` et `raid_today` ; `streamer_visit()` rend `raid: { gained, guests,
  already }`, où `guests` porte la part de chaque invité (place, créateur,
  rareté, pour-mille, abonnés). Le bureau est agrégé par
  `_streamer_guest_list()` — **un tableau, `[]` s'il est vide** — parce que
  `to_jsonb()` d'une fonction ensembliste rend **zéro ligne** quand le bureau
  est vide : le `RETURN` n'avait alors plus rien à rendre et `streamer_status()`
  répondait `NULL` au lieu d'un état vide. C'est exactement le genre de piège
  que le vérifieur attrape, et il le joue.
* **Côté appareil**, `src/lib/streamer.ts` porte les règles pures
  (`guestRaidPermille`, `raidForGuests`, `raidLine`, `liveGuestSlugs`),
  `src/lib/cloud/api/streamer.ts` les trois appels (`streamerGuestSet`, plus le
  bureau dans `streamerStatus` et le raid dans `streamerVisit`), et l'écran
  « Ta chaîne » sa section **Le bureau** : les deux places, l'état du direct
  (allumé seulement si le créateur streame **maintenant**), et la liste des
  créateurs en direct de ta collection pour choisir. Hors ligne, le moteur local
  (`setStreamerGuestLocally`, `payStreamerRaidLocally`) applique les mêmes
  règles — refus compris.

**Coller `0039` après `0038`.** Elle remplace `streamer_status()` et
`streamer_visit()` : rejouer `0038` seule après `0039` refait passer l'écran à
l'ancienne version, et il perd le bureau — le vérifieur joue ce piège-là aussi.

### Le studio, payé en doublons (`0040`)

Les **cinq premiers paliers** du setup se paient en points (`0038`). Après eux,
il faut des **cartes** : trois paliers de plus (rangs 6 à 8), payés en
**doublons** de la collection — c'est la « seconde partie » que la note de
`src/data/streamer.json` annonçait, et elle est livrée le 8 octobre 2026.

* **La rareté donne le prix.** Un doublon **Rare** vaut 1, un **Épique** vaut 2
  (`_streamer_sacrifice_values()`, miroir de `setup.sacrifice.values`) ; les
  Communes et les Peu communes ne paient rien, et une **Légendaire ne part
  jamais**. Les trois prix sont 2, 5 et 10 points de sacrifice, pour +100, +150
  et +250 pour mille — au bout des huit paliers, la chaîne grandit **deux fois
  plus vite** qu'à ses débuts (1000 pour mille).
* **La porte est `streamer_setup_sacrifice(p_cards)`, et elle ne prend que des
  identifiants de cartes.** Le serveur relit la carte dans la **sauvegarde du
  joueur**, la rareté au **catalogue**, la valeur au barème, le prix dans
  `_streamer_setup_levels()` : le client ne propose ni un prix, ni une valeur,
  ni une rareté. Il renvoie les cartes qu'il a **réellement** consommées — c'est
  ce verdict que l'écran applique, jamais la sélection du joueur.
* **Les refus, dans l'ordre** : le prochain palier doit se payer en doublons
  (les points d'abord) ; la carte doit être dans la collection ; le créateur au
  catalogue et la variante connue ; la rareté doit payer ; **la carte ne doit
  pas être déjà partie** ; ce qui **reste** du couple créateur + variante doit
  être au moins une carte (la règle du recyclage et de l'hôtel — plusieurs copies
  du même couple peuvent partir d'un coup, le compte se fait après) ; le total
  doit tomber **juste** sur le prix ; la **provenance** doit être vérifiable
  (`card_claim_covers`, la porte de sortie du recyclage).
* **Une carte ne part qu'une fois.** Le registre `card_claims` ne suffit pas à
  fermer la porte — pour une carte Standard non légendaire il dit « couverte »
  par construction, et la sauvegarde n'est réécrite que par le client. D'où la
  table `streamer_sacrifices` : **une ligne par carte partie**, clé primaire
  `(user_id, card_id)`. C'est la même preuve que la ligne de `streamer_raids`
  pour le raid ou l'index du journal du wallet pour le recyclage.
* **`streamer_setup_buy()` garde sa porte fermée aux paliers en doublons.**
  Sans cette garde, « webcam2 » coûterait deux **points** — le prix lu dans la
  même table. Le vérifieur joue les deux refus (achat en points d'un palier en
  doublons, sacrifice avant la fin des paliers en points).
* **Côté appareil**, `sacrificeValue()`, `sacrificePrice()` et
  `SETUP_SACRIFICE_VALUES` (`src/lib/streamer.ts`) portent le barème,
  `sacrificeSetupLocally()` et `setupSacrificeCandidates()`
  (`src/lib/game-engine.ts`) appliquent les mêmes refus **hors ligne** — mêmes
  phrases qu'au serveur —, `streamerSetupSacrifice()` fait l'appel, et l'écran
  « Ta chaîne » ouvre le panneau **Le studio** : les doublons Rares et Épiques
  qui peuvent partir (jamais la dernière copie), la sélection comptée en points
  de sacrifice, et une **confirmation** avant que quoi que ce soit ne quitte le
  classeur. Le test `src/lib/supabase-streamer.test.ts` tient les deux barèmes
  ensemble, et `npm run supabase:verify` (548 contrôles) joue le reste.

**Poser `0040` après `0039`.** Elle remplace `_streamer_setup_levels()`,
`streamer_setup_buy()` et `schema_versions()`, donc l'ordre est celui des
numéros. Le geste est celui du projet — `npx supabase db push` dans le dossier
du jeu — et pour vérifier après : `npx supabase migration list`, ou
`select public.schema_versions() -> '0040';` qui doit rendre `true`. La dernière
migration écrite est la `0041` (juste en dessous) : **les deux se posent d'un
coup**, `db push` les prend dans l'ordre.

### Le plateau compte sur la vidéo (`0041`)

`0039` a posé les invités **et** le raid : le passage d'un invité pendant
l'absence, payé une fois par journée de jeu. `0041` ajoute la seconde moitié de
l'idée, celle qu'on voit **en publiant** : les invités posés sur le bureau
pèsent sur la **vidéo du jour**.

* **La rareté donne le bonus de plateau** : 2 % pour une Commune, 3 % pour une
  Peu commune, 5 % pour une Rare, 8 % pour une Épique, **12 % pour une
  Légendaire** — `_streamer_collab_values()`, miroir exact de
  `guests.collab.videoPermille`. Une rareté inconnue ne paie **rien**
  (jointure `left join` : la part manque, elle ne vaut pas un défaut).
* **Le direct ajoute le moment « RAID ! »** : si l'un des invités streame **au
  moment de publier** — la même fenêtre de dix minutes que le badge et que le
  raid (`_streamer_live_window()`, `live_state.refreshed_at`, et le créateur
  effectivement dans `live_streams`) — le gain prend **+15 %** et la chance de
  buzz **+25 points** (`_streamer_collab_live()`, miroir de `livePermille` et
  `liveBuzzPermille`). Le direct **s'ajoute** au total : une Légendaire en
  direct vaut 27 %.
* **L'ordre du calcul, c'est la règle.** La croissance du jour (setup compris),
  le format, **puis le plateau** : `floor(round(base × gain/1000) ×
  (1000 + collab)/1000)`. Le bonus de rareté passe donc **avant** le ×3 du buzz
  — une vidéo qui buzze sur un plateau rare paie **trois fois le plateau**.
  Le direct, lui, pousse `least(1000, buzz_permille + collab.buzz_permille)` :
  c'est lui qui fait basculer une vidéo ordinaire.
* **Rien n'est envoyé par le client.** `streamer_publish()` (réécrite ici) relit
  le bureau (`_streamer_guests_of`), la rareté au **barème**, et le direct dans
  `live_state` — l'appel ne porte toujours **que le format**. Le plateau est relu
  **au moment de publier** : si un invité passe en direct entre l'ouverture de
  l'écran et la publication, c'est le moment-là qui compte.
* **La vidéo garde la trace** : deux colonnes de plus, `streamer_videos.collab`
  (le bonus appliqué, pour mille) et `streamer_videos.raid` (`true` si un invité
  stremait à cet instant). Les vidéos publiées avant valent `0` et `false` — ce
  qu'elles étaient vraiment. Republier la vidéo du jour rend la vidéo **rangée**,
  plateau compris : le tirage n'est jamais rejoué.
* **`streamer_status()` annonce le plateau avant de publier** :
  `collab_permille`, `collab_buzz_permille`, `collab_live`. C'est ce que la
  scène affiche — donc le chiffre annoncé est celui qui sera payé.
* **Côté appareil**, `collabVideoPermille()`, `collabFor()` et `GUEST_COLLAB`
  (`src/lib/streamer.ts`) portent le barème, et `resolveVideo()` le reçoit en
  cinquième paramètre. Il s'affichait sur l'écran de la chaîne, dans le bureau en
  deux places — écran retiré le 8 octobre 2026 au soir ; **le barème et les
  fonctions, eux, sont restés**, et c'est ce que le vérifieur compare au SQL.
  Hors ligne, le moteur local applique le même barème
  (`playVideoLocally(state, formatId, day, roll, liveSlugs)`).
  `src/lib/supabase-streamer.test.ts` tient les deux barèmes ensemble,
  `src/ecrans.test.tsx` monte l'écran dans un DOM, et
  `npm run supabase:verify` (**559 contrôles**) joue le reste : barème
  relu du fichier, Légendaire invitée **hors ligne** puis **en direct**, colonnes
  écrites, republication, direct périmé, et les deux refus de permission.

**Poser `0041` après `0040`.** C'est la dernière migration écrite : elle ajoute
deux colonnes, puis remplace `streamer_publish()`, `streamer_status()` et
`schema_versions()`. `npx supabase db push` les applique dans l'ordre des
numéros ; pour vérifier après, `select public.schema_versions() -> '0041';` doit
rendre `true`.

### Le Tribunal paie sa séance (`0042`)

**Le mode est dans l'application** (les dossiers vivent dans
`src/data/tribunal.json`, le tirage du jour est calculé par `src/lib/tribunal.ts`)
: il ne manquait au serveur que **la caisse**, parce que les points vivent chez
lui depuis `0027`. `0042_tribunal.sql` pose :

- `public.tribunal_dossiers(id, verdict_attendu)` — la **vérité** des dossiers,
  fermée au client (seule la fonction la lit) ; un test tient cette copie
  alignée avec le JSON du jeu, sinon une séance serait refusée en ligne sans
  qu'on sache pourquoi ;
- `public.tribunal_recompense(p_day, p_verdicts, p_login)` — encaisse une séance.

Ce que le serveur **refait chez lui**, et c'est tout l'intérêt : le **karma** est
recalculé depuis `tribunal_dossiers` (le client peut envoyer les verdicts qu'il
veut, il ne peut pas inventer un dossier), le **multiplicateur Direct** est lu
dans `live_streams` (le client dit *qui* préside, pas *si* ce créateur est à
l'antenne), et les **points** suivent les réglages écrits dans la migration —
jamais un montant venu de l'appareil. Une séance ne paie qu'**une fois par
journée de jeu** : c'est l'index unique `wallet_ledger_once (user_id, kind, ref)`
qui en décide, avec `kind = 'tribunal'` et `ref = journée`.

Ce que le serveur **ne peut pas** vérifier, et qu'il faut savoir : que le joueur a
réellement lu les dossiers — ils sont dans le bundle de l'application. Un joueur
décidé peut envoyer les bons verdicts sans ouvrir l'écran. La récompense est
calibrée pour ça (40 points par jour au plus, 80 avec le direct, là où une carte
au choix en coûte 400) : le mode reste un plaisir de lecture, pas une économie.

**Poser `0042` après `0041`.** `npx supabase db push` l'applique ; pour vérifier
après, `select public.schema_versions() -> '0042';` doit rendre `true`. Tant
qu'elle n'est pas posée, le bilan affiche le refus du serveur au lieu de verser
— la séance est gardée, elle se réclamera le lendemain de la pose, ou tout de
suite après.

### Le live de vingt secondes (aucune migration)

L'étape 5 — `src/lib/live-game.ts` et son réglage dans
`src/data/live-game.json` (le composant qui la jouait, `streamer-live-game.tsx`,
est parti avec l'écran le 8 octobre 2026) — est le **seul morceau de la
simulation qui n'a pas de porte côté serveur**, et c'est une décision, pas un oubli : le
live **ne paie rien** (ni jeton, ni point, ni abonné) et ne change pas le tirage
de la vidéo, donc il n'y a **rien à garder** : pas de table, pas de RPC, aucune
migration à poser. Le plan de la scène est tiré **sur l'appareil** par un
générateur amorcé par `(journée de jeu, palier)` — même journée, même palier,
donc **même scène** à chaque ouverture — et l'appareil ne décide de rien qui
paie : `streamer_publish(format)` reste le seul juge de ce que la journée
rapporte. Ce que le vérifieur vérifie malgré tout est le **miroir des paliers** :
cinq cadences de chat et cinq nombres de bulles dans `live-game.json`, comme les
cinq paliers de `_streamer_per_day()`, pour qu'un palier ajouté d'un côté ne
laisse pas l'autre en silence. Si un jour la précision du joueur doit toucher à
la vidéo du jour, il faudra que **le serveur puisse la juger** — c'est alors, et
seulement alors, qu'une migration (zone ou fenêtre de tir tirée par le serveur,
stable toute la journée, tolérance affichée à l'écran, une tentative par
journée) devient nécessaire ; c'est écrit dans `docs/ta-chaine.md` § 2.

### Le direct (statut EN LIVE)

**Qui peut réveiller la fonction.** `refresh-live` demande un en-tête
`Authorization` (l'app envoie sa clé anon : rien de secret n'est embarqué) ; le
diagnostic `?check=1`, qui décrit l'infrastructure, est réservé au **rôle de
service**.

**L'horloge de la base (`0025_direct_auto.sql`, 7 octobre 2026).** Jusqu'ici,
c'est l'application qui réveillait la fonction — donc **seulement quand
quelqu'un jouait**. Un créateur qui passait en direct dans le vide n'existait
pour personne : badge périmé, et aucune notification. `pg_cron` appelle
maintenant `refresh-live` toutes les deux minutes, `pg_net` s'occupant de la
requête HTTP. Trois choix à connaître :

* **aucune clé de service n'entre dans la base** : `refresh-live` accepte
  n'importe quel porteur non vide, donc l'horloge envoie la clé **publique** du
  projet — celle qui est déjà dans l'APK. Le mot de passe de service reste dans
  les secrets des Edge Functions ;
* la porte est un **appelant**, pas un calculateur : la base ne connaît ni
  Twitch, ni les règles du direct. Un seul endroit décide (la fonction) ;
* la fonction `cron_refresh_live()` est **fermée aux joueurs** : sans ça,
  n'importe quel compte pourrait faire taper Twitch à volonté.

Deux minutes, parce que `refresh-live` se limite lui-même à une requête Twitch
toutes les 90 secondes : appeler plus vite ne rafraîchirait rien. Vérifier que
l'horloge tourne (SQL Editor) :

```sql
select jobname, schedule, active from cron.job where jobname = 'creatordeck-refresh-live';
select status_code, created from net._http_response order by created desc limit 5;
```

La seconde ligne montre les derniers appels réellement partis : `200` = la
fonction a répondu. Si `cron.job` est vide, c'est que les extensions ne sont pas
activées : **Database → Extensions**, activer `pg_cron` et `pg_net`, puis
rejouer la migration (`npx supabase db push --include-all` : elle est rejouable).

Si la clé publique du projet change un jour, c'est la ligne `Authorization` de
`public.cron_refresh_live()` qu'il faut suivre — la migration se rejoue sans
risque, elle remplace l'horloge au lieu d'en ajouter une. Le créneau des 90 secondes est **réservé** par une écriture
conditionnelle sur `live_state.refreshed_at` : deux appels simultanés ne
consomment qu'une requête Twitch, l'autre répond `skipped` — avant, les deux
lisaient la même date et partaient tous les deux chez Twitch. Côté tableau de
bord, **active « Verify JWT »** sur cette fonction : sans ça, un robot peut
toujours l'appeler.

Une carte dont le créateur **streame à cet instant** le dit : pastille « Direct »
sur la carte, bandeau sous le titre de l'accueil (« 12 sur 1000 · @kamet0 4 120 »),
ligne rouge au moment de la révélation, et un filtre « En direct » dans le
classeur. Rien de tout ça n'apparaît si la donnée est vieille de plus de dix
minutes : un badge « en direct » périmé serait un mensonge.

Le badge n'est pas la variante : le badge est un fait qu'on constate (il
s'allume sur n'importe quelle carte d'un créateur en direct, le temps du
direct), la variante Live est une **matière** qu'on tire au sort — mais depuis
`0011_direct.sql`, cette matière ne se tire **que pour un créateur qui
streame** (voir ci-dessous). Une carte Live dit donc toujours quelque chose de
vrai : elle est née pendant un direct.

### Le bonus Direct

Le badge seul ne changeait rien au tirage : il fallait que le direct **paie**.

- quand l'app sait qui streame (cache du serveur, **moins de dix minutes**),
  les créateurs en direct **pèsent ×1,5** dans leur rareté : ils tombent plus
  souvent ;
- leur carte a **20 %** de chance d'être en variante Live ; la carte garantie
  (le 5ᵉ slot) l'est **systématiquement** quand son créateur streame — c'est le
  moment fort du paquet ;
- sans information fraîche (cache périmé, table absente, aucun streamer), le
  bonus est neutre et **aucune carte Live ne sort**. Un « Live » qui
  désignerait quelqu'un qui ne streame pas ne vaudrait rien.

Les raretés publiées ne changent pas : le bonus ne touche ni les poids des
slots, ni le « Perfect ». Il décide seulement **qui** tombe, et sous quelle
matière. Les valeurs (×1,5 · 200‰ · dix minutes) vivent dans
`src/data/pull-rates.json` (section `direct`), sont affichées dans l'écran
« Taux de drop », et sont appliquées des deux côtés : le moteur local
(`src/lib/game-engine.ts`) et la migration `0011_direct.sql`. Deux garde-fous
empêchent les deux de diverger : `src/lib/supabase-direct.test.ts` (les valeurs
du fichier doivent être dans le SQL) et `npm run supabase:verify` (le tirage
serveur, joué pour de vrai, y compris avec un cache périmé).

Mise en place : `0011_direct.sql` → (§3), puis
`npm run supabase:verify` si tu veux le voir toi-même.

### Le Last Pack

Un booster ouvert n'est plus un moment privé. Ses cinq cartes restent
**exposées dix minutes** (`last_packs`), et **un ami** peut venir y prendre une
carte — **une par jour et par joueur** (`last_pack_steals`, index unique sur le
jour UTC).

Ce que le serveur vérifie avant de laisser faire, dans l'ordre :
authentification, paquet existant, fenêtre de dix minutes **ouverte**, paquet
qui n'est pas le tien, amitié (`has_friendship()`), carte encore disponible,
vol du jour non utilisé, **et la carte encore présente dans la collection du
propriétaire**. Ce dernier point est le plus important : sans lui, un vol
créerait une carte que personne n'a tirée. Le vol réécrit alors **les deux
sauvegardes** (la carte part chez l'un, arrive chez l'autre, marquée
`fromLastPack`) dans une seule transaction, verrous pris dans un ordre stable —
comme un échange accepté.

Depuis `0034_last_pack_protege.sql`, deux cartes restent exposées mais **ne se
volent pas** : une **Légendaire** et une carte **Live**. La première est la plus
belle pièce du paquet — un cercle de cinq amis ne doit pas se la prendre —, et
la seconde n'existe que parce que le créateur streamait à cet instant : elle ne
se refait pas. L'écran les grise et écrit « protégée » (`stealable` carte par
carte), le serveur refuse de son côté, et le refus tombe **avant tout
verrouillage** : rien n'a bougé, le vol du jour est intact. La règle est écrite
deux fois — SQL pour le refus, `src/lib/last-pack.ts` pour griser — et un test
miroir (`src/lib/supabase-last-pack-protege.test.ts`) tient les deux copies
ensemble.

Deux garde-fous qui font la différence entre une mécanique et une décoration :

- **rien n'est exposé à un inconnu** : `last_pack_shelf()` ne rend que tes
  paquets et ceux de tes amis, jamais celui d'un joueur que tu ne connais pas ;
- **un vol ne se défait pas** : `push_save()` est réécrite dans cette migration
  pour refuser une sauvegarde d'appareil qui contiendrait encore une carte
  volée (le contrôle vise l'identifiant exact de la carte prise, pas son couple
  créateur + variante : elle a le droit de retomber d'un booster). Le message
  renvoie vers « Reprendre la partie en ligne », où le vol est déjà écrit.

Le carnet annonce au propriétaire « X t'a piqué ton légendaire » (ou « ton
épique », ou « une carte ») — le voleur, lui, ne voit pas ses propres vols : on
ne raconte pas au joueur ce qu'il vient de faire. L'écran est « Toi → Last
Pack », avec le compte à rebours, la pastille sur l'onglet, et le vol en **deux
temps** (on choisit la carte, puis on la prend) parce qu'il n'y en a qu'un par
jour.

Le paquet est publié par un **déclencheur sur `pack_draws`** : `open_pack()`
n'est pas touchée, le tirage reste celui de `0004`/`0011` au caractère près.
L'expiration (`expires_at`) est écrite par le serveur : reculer l'horloge de son
téléphone ne rallonge pas la fenêtre.

Pourquoi ça ne peut pas vivre dans l'APK : l'API Helix demande un **client
secret**, et un APK se dézippe. L'appel vit donc dans une **Edge Function**
(`supabase/functions/refresh-live/index.ts`), qui interroge Twitch et publie le
résultat dans une table que tout le monde peut lire. Dix requêtes Helix pour
1 000 créateurs, une fois pour tous les joueurs.

| Élément | Rôle |
| --- | --- |
| `0007_direct.sql` | tables `live_streams` (le cache) et `live_state` (son horodatage) + `live_publish()`, réservée au serveur |
| `supabase/functions/refresh-live` | seul endroit qui connaît le secret Twitch : jeton d'application, `GET /helix/streams` par lots de 100, publication |
| `src/lib/live.ts`, `src/lib/live-store.ts` | lecture de la table (sans compte), cache local daté, règle des dix minutes |
| `src/components/creator-deck-app.tsx` | bandeau d'accueil, filtre du classeur, ligne de révélation |

**Il n'y a pas de tâche planifiée** : c'est l'app qui demande le
rafraîchissement quand elle s'ouvre et que son cache a plus de trois minutes. La
fonction se limite elle-même à **une requête Twitch toutes les 90 secondes**
(c'est `live_state.refreshed_at` qui le dit), donc l'appeler plus souvent ne
coûte rien — c'est ce qui permet de la laisser sans jeton.

**Mise en place (une fois).**

1. Créer une application sur <https://dev.twitch.tv/console/apps> (nom libre,
   *OAuth Redirect URL* : `http://localhost`, catégorie *Application
   integration*). Noter le **Client ID**, générer un **secret**.
2. Supabase → **Edge Functions** → **Secrets** : ajouter
   `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`.
3. **Déployer la fonction** — le plus sûr est la ligne de commande, qui relit
   `supabase/config.toml` (et donc l'état voulu de « Verify JWT ») :

   ```powershell
   npx supabase functions deploy refresh-live
   ```

   Sinon, dans le tableau de bord : *Edge Functions* → *Deploy a new function* →
   **Via Editor**, nom `refresh-live`, contenu de
   `supabase/functions/refresh-live/index.ts`. **Laisse « Verify
   JWT » désactivé** : l'app envoie déjà un en-tête `Authorization` avec sa clé,
   et la fonction le vérifie elle-même. L'activer n'apporterait rien de plus —
   et avec une clé `sb_publishable_…` (et non un JWT) le portail peut refuser
   l'appel, donc l'éteindre si un jour tu l'allumes et que le badge Direct
   disparaît.
4. `npx supabase db push` pose `0007_direct.sql`. Si `0003_catalogue.sql` est
   déjà dans la base mais qu'il lui manque la colonne `login` (la clé qui relie
   une diffusion à sa carte), rejoue-le : `npx supabase db push --include-all`
   re-pose les fichiers déjà appliqués.
5. Ouvrir l'app : le premier affichage déclenche le rafraîchissement.

**Diagnostiquer depuis un navigateur** — la fonction répond en JSON, sans outil :

| Appel | Ce qu'il dit |
| --- | --- |
| `…/functions/v1/refresh-live` (avec `Authorization: Bearer <ta clé>`) | déclenche le rafraîchissement et renvoie ce qui a été publié |
| le même avec `?check=1` et la clé **service** | secrets présents ou non, catalogue lisible, âge du cache. **Aucune requête Twitch** |
| n'importe quel appel **sans** en-tête | `401` : c'est voulu, la fonction ne répond plus aux navigateurs anonymes |

Le diagnostic `?check=1` demande le **rôle de service** (clé secrète) : en
ligne de commande, `curl -s -H "Authorization: Bearer <clé_service>"
"https://<projet>.supabase.co/functions/v1/refresh-live?check=1"`. L'app, elle,
n'utilise jamais `?check=1`.

Réponses possibles de l'appel normal : `{"skipped":true,"age_ms":…}` (le cache a
moins de 90 secondes — recharge la page plus tard), `{"ok":true,"checked":1000,
"live":12,…}` (publié), ou `{"error":…}` (secret manquant, catalogue vide, refus
de Twitch — le message dit lequel).

Si l'app ne déclenche rien alors que la fonction répond à la main, regarder
**Edge Functions → refresh-live → Logs** : une invocation refusée par
« Verify JWT » y apparaît comme un 401, une absence d'invocation veut dire que
l'app n'a pas appelé (cloud non configuré dans son `.env.local`).

### Les amis

Un joueur cherche un pseudo, envoie une demande, l'autre accepte : la relation
existe alors **des deux côtés à la fois**, et rien n'est décidé par l'appareil.
Trois listes dans l'écran (Amis, Reçues, Envoyées), accessible depuis
**Profil → Amis**.

Ce que le serveur garantit, et pourquoi c'est lui qui s'en occupe :

* une amitié ne se crée **que** par l'acceptation du destinataire — un client ne
  peut pas écrire une ligne dans `friends` (RLS active, aucune politique
  d'écriture, tout passe par des fonctions `security definer`) ;
* une demande est unique dans chaque sens : renvoyer une demande déjà en attente
  la renvoie telle quelle, et une demande **croisée** est signalée au joueur
  (« réponds dans Reçues ») au lieu de créer un doublon ;
* une ancienne demande (refusée, annulée, ou l'historique d'une amitié retirée)
  est **réutilisée** : on peut donc redevenir ami avec quelqu'un qu'on a retiré ;
* personne ne voit les demandes ni les amitiés des autres : un tiers qui lit
  `friend_requests` ne voit que les lignes qui le concernent.

| Élément | Rôle |
| --- | --- |
| `0008_friends.sql` | tables `friend_requests` et `friends`, RPC `send`/`accept`/`reject`/`cancel`/`remove`, listes, `has_friendship()` |
| `src/lib/social/friends.ts` | types et règles pures (tri, recherche, « il y a 3 jours »), testés sans navigateur |
| `src/lib/cloud/api/social.ts`, `cloud-store.ts` | appels RPC et états (`friends`, `friendsAt`) : la feuille lit, le store écrit |
| `src/components/friends-sheet.tsx` | l'écran : chercher un joueur, envoyer, accepter, refuser, annuler, retirer |

L'ajout se fait par **recherche de pseudo** (`search_players()`, le RPC des
échanges) : le serveur attend un identifiant de joueur, pas un code inventé.
Après chaque geste, l'écran recharge les trois listes au lieu de les bricoler
localement — une amitié affichée que le serveur n'a pas enregistrée serait pire
qu'un écran lent.

**Ce qui se passe si la migration n'est pas collée** : les appels répondent
`PGRST202` (« fonction introuvable ») et la feuille affiche un message ; rien ne
casse dans le reste du jeu.

### Le carnet de notifications

« Qu'est-ce qui est arrivé pendant que je n'étais pas là ? » — les offres
d'échange reçues, les réponses à tes offres, les demandes d'ami, les amitiés
acceptées et tes ventes à l'hôtel. L'écran s'ouvre depuis **Toi →
Notifications**, avec une pastille quand il y a du nouveau.

**Aucune table `notifications` côté serveur**, et c'est volontaire : chaque ligne
du carnet correspond à un fait que le serveur garde déjà — une ligne de
`trades` (`0005`), une demande ou une amitié (`0008`), une annonce vendue
(`0009`). Le carnet les **relit** (`src/lib/social/inbox.ts`) et les met en
français. Une table dédiée aurait créé un deuxième endroit où la même vérité
pourrait diverger — le genre d'écart qu'on ne découvre qu'un mois plus tard.

| Élément | Rôle |
| --- | --- |
| `src/lib/social/inbox.ts` | construit les lignes depuis les faits déjà connus, compte les nouveautés — pur, testé |
| `src/lib/cloud/cloud-store.ts` | `loadInbox()` (les sources en parallèle, chacune tolérante à l'échec), `markInboxSeen()`, `clearInbox()` |
| `src/hooks/use-inbox.ts` | ajoute la seule ligne qui ne vient pas du serveur : **ton créateur épinglé est en direct** (croisement de l'épinglé et du cache du direct) |
| `src/components/notifications-sheet.tsx` | l'écran ; l'ouvrir **marque le carnet comme lu** |
| `0010_ventes.sql` | `market_sales()` : tes ventes conclues, avec l'acheteur (le comptoir ne montre que ce qui reste à vendre) |
| `0012_last_pack.sql` | `last_pack_shelf()` : les boosters de tes amis encore ouverts → « X a ouvert Kamet0, Last Pack encore 8 min » |

Deux détails d'usage :

* la « dernière visite » vit **sur l'appareil**, par joueur
  (`creatordeck.inbox.seen.<userId>`) : changer de compte ne mélange pas les
  nouveautés des deux ;
* un carnet qui raconte au joueur ce qu'il vient de faire ne sert à rien : tes
  propres offres, celles que tu as acceptées, les annonces que tu viens de
  déposer, les amis que tu viens d'accepter et **ton propre Last Pack** n'y
  figurent pas.

Deux lignes plus récentes, qui n'obéissent pas à la même règle :

* **« X a ouvert Kamet0, Last Pack encore 8 min »** vient de
  `last_pack_shelf()`, que le joueur a déjà le droit de lire pour aller voler
  une carte. Le titre nomme la **meilleure carte du paquet** (la plus rare selon
  `RARITY_META`) : « a ouvert un commun » ne fait aller voir personne. Les
  minutes sont arrondies vers le haut, plafonnées à la fenêtre, et après la
  fenêtre la ligne dit simplement « Last Pack terminé ».
* **« Kamet0 est en direct »** ne vient d'aucune table : c'est le croisement du
  créateur épinglé et du cache du direct, fait dans `use-inbox.ts`. La raison
  est pratique : la **pastille** de la navigation et la **feuille** doivent
  compter exactement la même liste, sinon la pastille annonce une ligne que
  l'écran ne montre pas. La date de la ligne est celle du **début du direct**
  telle que Twitch la donne — un direct commencé il y a vingt minutes arrive
  donc déjà lu, et un nouveau direct crée une nouvelle ligne.

### La wishlist

Un joueur épingle **un** créateur — celui qui lui manque le plus — et son nom
s'affiche sur sa fiche publique. C'est une demande, pas un secret : elle est
lisible par tout le monde, y compris par un visiteur.

`0015_wishlist.sql` apporte trois fonctions et une table d'une ligne par joueur
(`user_id` en clé primaire, donc **épingler remplace**) :

| Fonction | Ce qu'elle fait |
| --- | --- |
| `wishlist_slug(p_user_id uuid default null)` | lit l'épinglé — le sien par défaut, celui d'un autre joueur si on le nomme |
| `set_wishlist(p_slug text)` | épingle (ou remplace) ; **refuse** un slug absent du catalogue |
| `clear_wishlist()` | retire l'épinglé |

Deux choix qui méritent d'être écrits :

* **aucune possession exigée.** C'est l'inverse de `set_showcase()`, qui relit
  la sauvegarde du joueur pour vérifier qu'il possède la carte. Ici, on réclame
  justement ce qu'on n'a pas : le serveur vérifie seulement que le créateur
  existe au catalogue.
* **l'écriture directe dans la table est retirée aux clients**
  (`revoke insert, update, delete`). Sans ça, un client pourrait `PATCH`er sa
  ligne avec un slug périmé, ou celle d'un autre joueur si une politique était
  mal écrite ; les trois fonctions sont le seul chemin, et elles vérifient
  `auth.uid()`.

`player_profile()` est **redéfinie** dans cette migration (la version de `0006`
ne connaissait pas la wishlist) et renvoie `wishlist_slug`. Un client qui n'a pas
encore collé `0015` ne reçoit simplement pas le champ : la fiche s'affiche sans
la ligne, et l'écran « Toi » propose l'épinglage sans erreur bloquante.

### Le Paquet Scène

Le second paquet du jeu, et le seul où **le joueur choisit**. Une fois par
**jour de jeu** (la journée commence à 6 h UTC, comme les missions et la
série), `scene_pack_choices(p_family)` fabrique cinq listes de propositions —
une par emplacement — dans la famille visée, et `open_scene_pack(p_family,
p_cards)` accepte la réponse après l'avoir **recalculée**.

Pourquoi tant de précautions : un paquet où le client choisit ses cartes est un
paquet où le client peut mentir. Le serveur refuse donc toute carte qui ne
figure pas, **au triplet exact** (créateur, rareté, variante), dans la liste de
son emplacement. Un commun annoncé en Légendaire est refusé ; une Holo que le
serveur n'avait pas offerte aussi. Les listes elles-mêmes sont tirées avec
`hashtext(user | jour | emplacement)` — reproductibles, donc vérifiables, mais
impossibles à deviner pour les composer d'avance.

Trois règles qui viennent du reste du jeu :

* **jamais de Légendaire** dans les listes (et `catalog:ci` le vérifie côté
  catalogue) : ce paquet sert à compléter une famille, pas à casser le plancher
  de malchance ;
* **il ne compte pas dans le plancher de malchance, la série ni la Prime Time.**
  Le journal `pack_draws` distingue ses lignes (`kind = 'scene'`) et les trois
  compteurs du Live Drop ne lisent plus que `kind = 'live'`. Sans ça, un paquet
  gratuit chaque jour ferait monter le compteur et offrirait la Légendaire du
  seuil sans un seul booster ouvert ;
* **le Direct ne l'influence pas** : la variante Live reste au Live Drop.

### Les points vivent au serveur (`0027`)

Dernier trou d'économie, et il était connu : les points vivaient dans la
sauvegarde, le serveur les lisait et les croyait. Quelqu'un qui gonflait son
solde achetait à l'hôtel — et l'hôtel, justement, est ce qui relie les
collections les unes aux autres. Depuis le 7 octobre 2026, la caisse est au
serveur.

**Ce qui change pour le joueur : rien.** Le compteur de points s'affiche
toujours au même endroit, et l'Atelier comme l'hôtel se paient comme avant. Ce
qui change, c'est ce que le serveur accepte : il ne croit plus un solde écrit
par l'appareil.

* **Le compte** : `wallets` (un solde par joueur, jamais négatif) et
  `wallet_ledger` (chaque mouvement, avec sa raison). Les deux tables sont
  fermées au client — le joueur passe par les fonctions, jamais par les tables.
* **Les crédits** — `wallet_credit(kind, ref)` : le serveur **fixe le prix** et
  **vérifie l'événement**, à chaque fois :
  * un tirage (`pack`, `scene`) est payé **tout seul**, par le trigger
    `_wallet_on_draw` (à l'insertion dans `pack_draws`) : le client n'annonce
    jamais un gain, et `wallet_credit` ne sert plus que de rattrapage pour un
    tirage arrivé avant la bascule ;
  * une vente (`sell`) doit être une annonce à lui, vendue — payée, elle aussi,
    par un trigger, au moment du dépôt ;
  * un `recycle` envoie **l'identifiant de la carte**, pas sa rareté : le serveur
    relit la carte dans la sauvegarde, prend la rareté **au catalogue**, refuse
    la dernière copie d'un couple et exige une provenance vérifiable
    (`card_claim_covers`). Le droit est ensuite **consommé** — la promesse de
    `0022` (« ça se fermera le jour où le recyclage passera par le serveur ») est
    tenue ici : refabriquer la carte ne la repaie pas ;
  * un `milestone` est **recalculé** : le barème (`wallet_milestones`, miroir de
    `MILESTONES` gardé par un test) dit ce que le jalon compte et son seuil, et le
    serveur compte dans sa propre collection projetée (`user_cards`) — ou dans son
    compteur de boosters (`pack_state`). Demander « maître » avec onze créateurs
    ne paie rien ;
  * une `season` se réclame **un palier à la fois** (`S06#2`) : le seuil et le
    montant viennent de `wallet_season_tiers`, **générée depuis le jeu** par
    `0028_wallet_saisons.sql` (même module de saisons que l'écran), et les
    créateurs possédés de la vague sont comptés par le serveur.
* **Une seule fois, et c'est la base qui le garantit** : l'index unique
  `wallet_ledger_once (user_id, kind, ref)` fait qu'un tirage, une vente ou un
  palier ne peuvent pas être encaissés deux fois, même si le client redemande
  après une coupure réseau. `gained` vaut alors `0` — le client ne peut pas
  annoncer un gain qui n'a pas eu lieu.
* **Les dépenses** — l'hôtel débite **par trigger**, dans la transaction de la
  vente : une annonce déposée paie son vendeur immédiatement, un achat refuse si
  le solde serveur ne suit pas (« il te manque N points », calculé sur le solde
  du serveur). L'artisanat passe par `wallet_spend('craft', slug)`, dont le coût
  est recalculé depuis le catalogue : le client propose un créateur, jamais un
  prix.
* **Le solde de la sauvegarde devient un miroir.** Il est réécrit par le serveur
  (`wallet_get()` le recale, les crédits aussi). Une sauvegarde gonflée à la main
  est donc recollé à la vérité à la première lecture — et n'a rien pu acheter
  entre-temps.
* **La bascule** : les joueurs avaient déjà des points. `wallet_backfill()` (à
  lancer une fois après la pose) et `_wallet_ensure()` (au premier appel de
  chaque joueur) ouvrent les comptes en reprenant le solde de la sauvegarde, une
  seule fois — borné à un million, parce qu'au-delà c'est une partie bricolée.
* **Ce qui reste local, volontairement** : les sabliers (ils ne s'achètent ni ne
  s'échangent), l'XP et le niveau. Ils ne valent rien pour un autre joueur.
* **Ce qu'un client trafiqué ne peut plus faire** : annoncer une rareté de
  recyclage (elle vient du catalogue), réclamer un palier de collection non
  atteint (le serveur compte), demander 3000 points pour un catalogue complet
  inexistant, réclamer deux fois un palier de famille, ou refabriquer une carte
  recyclée ou déposée à l'hôtel pour l'encaisser de nouveau (le **droit de
  provenance** est consommé dans les deux cas). Ce qui reste ouvert, assumé : une
  sauvegarde peut encore déclarer des cartes **artisanales** (Standard, commune à
  épique) non obtenues — c'est la contrepartie de l'atelier, et ça ne vaut pas une
  Légendaire.
* **Le client** : `src/lib/cloud/api/wallet.ts` (trois portes : lire, créditer,
  dépenser — le corps envoyé ne porte qu'une **raison** et une **référence**,
  jamais un montant), `src/lib/cloud/store/wallet.ts` (la mécanique : adopter le
  solde, recycler, rejoindre un créateur, réclamer un palier ou une famille) et
  `src/hooks/use-points.ts` (la règle unique, écrite une fois). Le solde affiché
  est **celui du serveur** : `wallet_get()` au démarrage, après un tirage, après
  une vente ou un achat d'hôtel, et l'appareil **adopte** ce qu'il reçoit au lieu
  d'additionner le sien. Sans compte sur un build avec cloud, les gestes qui
  touchent aux points sont **refusés** avec la phrase qui dit quoi faire
  (« Connecte-toi pour recycler un doublon : tes points vivent sur ton compte. ») :
  pas de repli silencieux vers un calcul local, qui donnerait un gain repris à la
  synchronisation suivante. Les achats aux **jetons** suivent la même règle
  depuis `0035` : c'est le serveur qui débite (il relit le prix, refuse une
  Légendaire), et sans compte l'achat est refusé au lieu d'être payé en local.

**Le prix à payer, dit franchement** : sans réseau, les points ne bougent plus.
Un build **sans cloud** garde tout en local (le wallet n'existe pas), mais un
build avec cloud demande la connexion pour dépenser — et pour encaisser un
tirage. C'est le prix du choix, et il est assumé.

### Les codes promo

Trois cents personnes regardent un direct, le streameur annonce un code : il faut
que ce code **existe** côté serveur, et qu'il ne puisse pas être réclamé deux
fois. C'est `0026_promo_codes.sql` (7 octobre 2026).

**Ce qu'un code donne : un booster à ouvrir.** Pas des points (l'hôtel s'achète
avec eux, un code deviendrait une monnaie parallèle), pas un jeton (ça
rapprocherait du pity sans que le joueur ait rien fait), pas une carte offerte
(ça toucherait la valeur d'une collection). Un code, c'est une raison de rouvrir
le jeu — et l'ouverture, elle, reste un tirage.

* **Le joueur** : réglages (onglet « Toi » → menu → **« J'ai un code »**), le
  code se tape, le serveur répond. La casse et les espaces n'ont pas
  d'importance : `booster-2026` et `BOOSTER 2026` désignent le même code.
* **Les tables**, fermées au client (`revoke` + RLS, comme les jetons de
  notification) : `promo_codes` (le code, combien de boosters, une limite
  d'usages, une date de fin, une note) et `promo_redemptions` (une ligne par
  joueur et par code — **la clé primaire** `(code, user_id)` est ce qui garantit
  qu'un code ne sert qu'une fois par joueur, pas un contrôle applicatif).
* **Les refus**, tous côté serveur : code **inconnu**, **expiré** (`expires_at`),
  **épuisé** (`max_uses`), **déjà réclamé par ce joueur** — et **réserve
  pleine**. Ce dernier cas mérite une phrase : la réserve est plafonnée à
  **quatre** boosters (`pack_state`, garde de `0019`), donc un cinquième serait
  perdu en silence. Le code est alors refusé **sans être consommé**, et le
  message dit quoi faire : « ouvre un booster, puis retape ce code ».
* **Créer un code**, depuis le SQL Editor (ou avec la clé de service) — jamais
  depuis l'application, où n'importe qui pourrait s'en attribuer :

```sql
-- Un code à usages illimités, sans date de fin (le code d'un stream).
select public.create_promo_code('BOOSTER-2026', 1, null, null, 'stream du 7 octobre');

-- Un code limité à 50 réclamations et valable jusqu'au 14 octobre.
select public.create_promo_code('ANNIV-50', 1, 50, now() + interval '7 days', 'semaine d''anniversaire');
```

Rejouer le même code **le met à jour** (note, date de fin, limite) sans perdre
les rédemptions déjà faites. `create_promo_code()` est `security definer` et son
exécution est révoquée à `public`, `anon` et `authenticated` : seul le rôle de
service — ou le SQL Editor, qui tourne avec les droits complets — peut créer un
code. Le vérificateur contrôle tout cela sur un Postgres jetable, refus du
joueur compris.

**Vérifié en production le 7 octobre 2026** : un code créé au SQL Editor
(`BOOSTER-2026`), tapé par le joueur dans les réglages (Toi → « J'ai un code »),
répond « Code accepté : un booster t'attend. » — et le booster entre dans la
réserve sans être ouvert. La chaîne complète est donc vérifiée de bout en bout :
le SQL Editor crée, l'app réclame, le serveur crédite.

### Se connecter avec Twitch

Twitch sert d'**identité** : un appui sur « Continuer avec Twitch » (écran
Compte), le navigateur demande l'autorisation, et le joueur revient connecté —
sans mot de passe, sans code par e-mail. C'est le fournisseur **intégré** de
Supabase (`provider=twitch`, *Authentication → Sign In / Providers → Twitch*) :
Supabase connaît déjà les adresses de Twitch et ajoute lui-même l'en-tête
`Client-ID` que l'API Twitch exige.

Ce que l'appareil fait, et ce qu'il ne fait pas :

* il ouvre `…/auth/v1/authorize?provider=twitch&redirect_to=…`
  (`twitchAuthorizeUrl()`) : **le client Twitch secret ne quitte jamais
  Supabase**, l'appareil ne connaît même pas l'identifiant du client ;
* au retour, il lit les jetons **dans le fragment** de l'adresse
  (`parseOAuthReturn()`), demande à Supabase à qui ils appartiennent
  (`/auth/v1/user`), puis enregistre la session (`adoptSession()`) — à partir de
  là, une connexion Twitch est indiscernable d'un compte invité, avec sa
  collection déjà en place si le compte en avait une ;
* sur le site, l'adresse est **nettoyée après lecture**
  (`history.replaceState`) : un jeton laissé dans la barre d'adresse finirait
  dans l'historique du navigateur ;
* dans l'application Android, la page servie est `https://localhost` : aucune
  redirection ne peut y arriver. Le retour passe donc par un schéma d'application
  (`com.creatordeck.app://auth`, déclaré dans `AndroidManifest.xml`) et par
  l'événement `appUrlOpen` du plugin `@capacitor/app`.

Ce qu'il faut déclarer une fois : l'adresse de retour dans la console Twitch, le
Client ID et le secret dans Supabase, et les adresses de retour dans *URL
Configuration* — voir §3.

| Élément | Rôle |
| --- | --- |
| `src/lib/cloud/twitch.ts` | adresse du dialogue, lecture du retour, adresse de retour, nettoyage — testés sans navigateur |
| `src/lib/cloud/api/account.ts` | `twitchAuthorizeUrl()`, `adoptSession()` (jetons → session enregistrée) |
| `src/lib/cloud/cloud-store.ts` | `twitchSignInUrl()` (donne l'adresse, ne navigue pas), `completeTwitchSignIn()` (installe, relit l'identité) |
| `src/hooks/use-twitch-return.ts` | le retour : fragment de l'adresse sur le site, `appUrlOpen` dans l'APK |
| `src/components/account-sheet.tsx` | le bouton « Continuer avec Twitch » |
| `android/app/src/main/AndroidManifest.xml` | le filtre `com.creatordeck.app://auth` |

### L'hôtel des ventes

L'hôtel est **asynchrone** : on n'attend personne. Un joueur dépose un doublon,
**l'hôtel le paie tout de suite** en points, et la carte va au comptoir. Un autre
joueur l'achète plus tard, au prix de l'étiquette. Deux joueurs n'ont jamais
besoin d'être connectés en même temps.

| Prix | Valeur | Où c'est écrit |
| --- | --- | --- |
| `payout` (payé au vendeur) | 20 / 40 / 100 / 250 / 400 points selon la rareté, ×1 (Standard), ×2 (Live), ×3 (Holo), ×5 (Gold) | `market_payout()` en base, `PAYOUTS` dans `src/lib/market.ts` |
| `price` (payé par l'acheteur) | une fois et demie le `payout`, arrondi au supérieur | `market_price()` en base, `shelfPrice()` dans `src/lib/market.ts` |

L'écart entre les deux est la marge de l'hôtel : sans elle, on vendrait et on
rachèterait la même carte en boucle sans rien perdre. Les deux grilles sont
écrites deux fois — en SQL (le serveur paie) et en TypeScript (l'écran affiche
« Vendre · 400 pts » sans un aller-retour par carte). Elles sont vérifiées des
deux côtés : `scripts/verify-supabase-migrations.mjs` et `src/lib/market.test.ts`.

Ce que le serveur vérifie, dans `market_sell()` et `market_buy()` :

* la carte déposée est bien **dans la collection envoyée** (et la rareté vient du
  **catalogue**, jamais de la carte : une sauvegarde bricolée ne se vend pas au
  prix d'une légendaire) ;
* ce n'est pas la **dernière copie** d'un couple créateur + variante — même règle
  que le recyclage, elle protège la complétion ;
* on n'achète pas sa propre annonce, ni deux fois la même (le verrou
  `for update` sur l'annonce tranche entre deux acheteurs simultanés) ;
* l'acheteur a les points **sur son compte serveur** (le prix est débité par le
  trigger de la vente, jamais par l'appareil), et la partie locale est **à jour dans le cloud** avant
  l'opération (comme un échange accepté) ;
* passé **trente jours**, une annonce quitte le comptoir : le vendeur a déjà été
  payé, personne ne perd rien.

La table `market_listings` n'a **aucune politique** et ses droits sont révoqués :
un client ne la lit ni ne l'écrit jamais directement, tout passe par les RPC
`security definer`. Les cartes achetées portent la marque `fromMarket` (le numéro
de l'annonce), exactement comme les cartes d'échange portent `fromTrade` : si la
même réponse est appliquée deux fois, la carte n'entre qu'une seule fois dans le
classeur.

**Où le voir** : **Profil → Hôtel des ventes** (déposer un doublon, acheter au
comptoir), et la section « En vente à l'hôtel » d'une fiche publique.

| Élément | Rôle |
| --- | --- |
| `0009_marche.sql` | table `market_listings`, grilles de prix, RPC `market_sell`/`market_buy`/`market_shelf`/`market_listings_of` |
| `src/lib/market.ts` | grille de prix (miroir du serveur), liste des doublons déposables, libellés — testés sans navigateur |
| `src/lib/game-engine.ts` | `applyMarketSale()` / `applyMarketPurchase()` : l'appareil rejoue ce que le serveur a écrit |
| `src/lib/cloud/api/market.ts`, `cloud-store.ts` | appels RPC et états (`market`, `marketAt`, `profileMarket`) |
| `src/components/market-sheet.tsx` | l'écran : le portefeuille, « Déposer un doublon », « Le comptoir » |

### La complétion par famille de collection

Le catalogue est découpé en **familles** par langue de diffusion — France &
francophonie, Espagne & Amérique latine, Anglophonie… —, comme les séries d'un
jeu de cartes. Chaque créateur appartient à une famille (`creators.region`), et
le serveur sait donc répondre à « combien ce joueur possède-t-il en
Anglophonie ? » **sans connaître sa collection** : c'est `player_profile()` qui
renvoie `by_region`, la même mécanique que la répartition par rareté.

Pourquoi côté serveur : la complétion par famille est la seule information
qu'on ne peut pas recalculer sur l'appareil quand on regarde **la fiche d'un
autre joueur**. Son catalogue n'existe pas dans cette app ; le nôtre ne dit rien
de ses cartes.

| Élément | Rôle |
| --- | --- |
| `0003_catalogue.sql` | la colonne `region` de chaque créateur (`S01`…`S09`, `S10` pour la fourre-tout) |
| `0006_profil_public.sql` | `by_region` dans `player_profile()` : `{ "S01": { "owned": 12, "total": 155 }, … }` |
| `src/lib/cloud/api/account.ts` | `byRegion` (type `ProfileFamily`), trié du plus complet au plus vide |
| `src/lib/regions.ts`, `src/lib/cosmetics.ts` | libellé de famille et teinte — les mêmes que l'écran des saisons et les emblèmes |
| `src/components/public-profile-sheet.tsx` | la liste « Familles de collection » sur la fiche publique |

Deux choses à savoir sur les chiffres :

* les familles sans aucune carte possédée sont **présentes à zéro**, pas
  absentes : c'est justement ce qu'il reste à collectionner ;
* un créateur possédé en deux exemplaires ne compte **qu'une fois** (comme la
  complétion du catalogue), et un créateur absent du catalogue ne compte nulle
  part.

L'écran **Objectifs** du jeu, lui, garde ses paliers et ses récompenses
(sabliers, emblème) : les **points** d'un palier sont versés par le serveur
(`wallet_credit('milestone', …)`), qui refuse de payer deux fois ; les autres
récompenses restent locales, avec la famille comme unité. Ce que le serveur ajoute, c'est la comparaison entre joueurs.

### Les Sortants

Le catalogue bouge : une régénération remplace des créateurs. Ceux qui quittent
le classement ne disparaissent pas pour autant — leurs cartes sont dans des
classeurs, dans des échanges, en vente à l'hôtel. Ils deviennent des
**Sortants** : `0003_catalogue.sql` leur met un drapeau (`creators.retired`),
et `0016_sortants.sql` fait lire ce drapeau à tout ce qui décide.

| Ce que change `0016_sortants.sql` | Pourquoi |
| --- | --- |
| `_pack_choose_creator()` ignore un Sortant | il n'est plus tirable, en booster comme sur le slot garanti |
| `scene_pack_choices()` (et l'ouverture) l'ignore aussi | le Paquet Scène ne doit pas servir ce que le booster refuse |
| `refresh_stats()` ne le compte plus dans la complétion | « X / 1000 » se mesure sur le catalogue courant — sinon 100 % deviendrait inatteignable dès la première rotation |
| `player_profile()` publie `catalog_size` sans eux | la fiche publique et le classement comparent des périmètres comparables |

Ce qui ne change **pas** : la ligne du créateur. Elle reste dans `creators`, donc
une carte gardée continue de s'afficher, de s'échanger, de se vendre et de
compter comme une carte (pas comme une découverte). Le serveur ne supprime
jamais un créateur.

Deux garde-fous, côté application : `src/data/retired.json` porte les Sortants
avec l'édition de leur départ (`retiredEdition`), et l'Atelier n'en propose
l'artisanat que **pendant cette édition-là** — jamais une Légendaire. Le
vérificateur (`npm run supabase:verify`) joue la rotation sur une base jetable :
deux créateurs marqués, 40 boosters ouverts, zéro Sortant tiré, complétion
inchangée pour la carte possédée, ligne toujours là.

### L'Arène

L'Arène est la seule épreuve du jeu qui se joue **contre l'instant** : on aligne
cinq cartes de son classeur, il en faut au moins une dont le créateur streame
**maintenant**, et le score est la somme des viewers réels. Une carte hors direct
vaut zéro, une seule Légendaire est acceptée par arène, et la semaine va du
**lundi 6 h UTC** au lundi suivant à la même heure.

Les règles publiées vivent dans `src/data/arena.json` (lues par `src/lib/arena.ts`
et affichées telles quelles sur l'écran) ; `0018_arena.sql` les **recopie** — les
mêmes phrases de refus, mot pour mot, pour que l'écran et le serveur disent la
même chose. Un garde-fou les compare (`src/lib/supabase-arena.test.ts`), et le
vérificateur les joue pour de vrai sur une base jetable
(`scripts/verify-supabase-migrations.mjs`).

| Ce que le serveur fait | Comment |
| --- | --- |
| Il recalcule le score, jamais le client | `arena_submit(array)` relit le direct frais (`live_streams`, < 10 min) et additionne les viewers des cartes alignées ; le client n'envoie que cinq slugs |
| Il vérifie la composition | cinq cartes, pas de doublon, possession réelle, `≤ 1` Légendaire, au moins un direct — refus en français, identiques à ceux de l'écran |
| Il garde le meilleur de la semaine | une arène **ne se dégrade pas** : `score = greatest(ancien, nouveau)` ; un essai raté n'efface pas un bon dépôt |
| Il classe la semaine | `arena_leaderboard(week)` : score décroissant, puis le dépôt le plus ancien, top 100 |
| Il paie une fois | `arena_claim(week)` : semaine terminée seulement, 5/3/2 sabliers au podium, 1 pour les dix premiers, emblème pour un top 10. Un second appel rend `hourglasses: 0` |
| Il annonce ce qui attend | `arena_me()` rend `pending` : les semaines terminées où le joueur a déposé sans encaisser sa récompense |

Deux choses vivent **côté appareil**, comme l'XP : les sabliers
eux-mêmes (crédités au moment de l'encaissement) et l'affichage. Le serveur, lui,
enregistre qu'une semaine a été payée — deux appareils ne touchent pas deux fois
la même.

**Le draft du week-end** (`arena_draft_choices()`, `arena_draft_pick(array)`),
ouvert du **samedi 6 h** au **lundi 6 h UTC** — quarante-huit heures. Le serveur
tire cinq emplacements de trois propositions **dans la collection du joueur**,
de façon reproductible (joueur + semaine, collection triée) : deux appels rendent
les mêmes quinze cartes — **distinctes** quand la collection compte au moins
quinze cartes, parce qu'une carte proposée deux fois ferait tomber la sélection
« une par emplacement » sur un doublon, refusé par les règles. Un choix hors des
propositions est refusé.

Le tirage est corrigé pour qu'un draft soit **toujours jouable**, puisque la
semaine n'en offre qu'un :

| Garantie | Pourquoi |
| --- | --- |
| au moins une des quinze cartes est un créateur **en direct**, si le joueur en possède un | sans elle, l'arène du week-end serait refusée pour une raison que le joueur n'a pas choisie — et il ne peut pas recommencer |
| au plus un emplacement **entièrement légendaire** | avec un plafond d'une Légendaire, deux triples tous légendaires rendraient toute sélection refusée |

Au moment du choix, le serveur accepte une carte des propositions **affichées**
ou du tirage **de base** (sans garanties) : entre l'écran et l'envoi, un créateur
peut passer hors ligne et déplacer la carte garantie. Le juge du direct reste
`_arena_problems`, rejoué à l'instant du choix. Accepter un draft, c'est déposer l'arène de la semaine d'un coup — et c'est
**définitif** : un seul draft par semaine, le serveur refuse le deuxième. L'écran
demande donc confirmation avant de valider, parce qu'un geste sans retour mérite
deux appuis.

| Point d'attention | Pourquoi |
| --- | --- |
| Les tables (`arena_entries`, `arena_drafts`, `arena_claims`) sont fermées | RLS activée, aucune politique : personne ne lit ni n'écrit dedans directement, tout passe par les fonctions |
| `arena_leaderboard` est la **seule** fonction ouverte à `anon` | un tableau d'affichage se lit sans compte, comme le classement mondial |
| Le vérificateur rejoue une semaine entière | deux joueurs, des refus, un classement, une récompense payée deux fois, un draft reproductible, une écriture directe refusée |

**Où le voir** : accueil (la ligne d'arène, sous les jetons) → écran Arène : ma
semaine, le composeur (ou le draft), le classement.

### Recommencer sa partie

« Réinitialiser la progression » (écran **Toi** → menu, tout en bas) remet la
partie à zéro **partout** : l'appareil et le serveur. C'est `reset_progress()`
(`0017`) qui s'occupe de la moitié serveur, et elle efface exactement quatre
choses :

| Ce qui s'efface | Pourquoi |
| --- | --- |
| `pack_state` (la réserve de boosters) | **supprimée**, pas remise à zéro : la lecture suivante la reconstruit depuis la sauvegarde neuve, donc le joueur retrouve ses 3 boosters tout de suite |
| `pack_draws` (le journal des tirages) | il porte le plancher de malchance, la série de jours et le Perfect du 7e — une partie neuve repart de zéro sur les trois |
| `pack_scene` (le Paquet Scène du jour) | de nouveau disponible, comme dans une partie neuve |
| `last_packs` (les Last Pack exposés) | ils montrent cinq cartes d'un booster qui n'existe plus |

Ce qui **survit**, volontairement : le pseudo et la vitrine (ce n'est pas de la
progression), la wishlist (une envie, pas un acquis), les amitiés, les échanges
conclus, les annonces en cours à l'hôtel, et la sauvegarde — c'est elle que la
partie neuve remplace, juste après, par un `push_save()`.

Trois garde-fous, parce que c'est la seule fonction du jeu qui **supprime** des
lignes à la demande du client :

* elle n'efface que **la partie de l'appelant** (`auth.uid()`, jamais un
  paramètre) ;
* elle est fermée à `anon` (`revoke all … from public, anon`), comme la
  wishlist : sans compte, on n'efface rien ;
* le vérificateur la joue pour de vrai : réserve vidée, Paquet Scène du jour
  ouvert, douze tirages au journal → la fonction rend les boosters, rouvre le
  Paquet Scène, ramène le plancher à zéro, et laisse le profil intact.

#### Le classement par famille

Dans **Compte → Classement**, la puce « Par famille » classe les joueurs sur une
famille précise : « qui complète le mieux l'Anglophonie ? ». Les puces de famille
n'apparaissent qu'à ce moment-là, et chaque ligne affiche « 23 / 402 ».

Ce tri est le seul qui lit `user_cards` — la projection des cartes possédées, à
laquelle **aucun client n'a accès** (RLS active, aucune politique, et les droits
de table révoqués). La fonction de classement est donc `security definer`, comme
`player_profile()` : elle peut compter, et ne renvoie qu'un couple de nombres
par joueur, sur des joueurs déjà `verified`.

| Point d'attention | Pourquoi |
| --- | --- |
| L'ancienne signature à deux arguments est supprimée | sinon deux fonctions coexisteraient, et un client pourrait appeler celle qui ignore les familles |
| La famille a une valeur par défaut (`null` → fourre-tout `S10`) | l'APK déjà installé appelle avec deux arguments : il continue de fonctionner au lieu de casser |
| Une famille inconnue ne fait pas échouer la requête | elle rend zéro partout, plutôt qu'une erreur PostgREST en plein écran |

**Où le voir** : `?profil=<identifiant>` (le lien de partage), la ligne du
classement d'un joueur, ou **Profil → Ma fiche publique** pour la sienne.

## 9. Notifications

**Fait :** **réveil du téléphone** (les notifications de direct : § 9.1 — un
créateur épinglé ou dont le joueur a une carte passe en direct, le téléphone
sonne) ; **les deux alertes de perte** (§ 9.2 — la série qui s'arrête ce soir,
la réserve pleine dont la recharge se perd : elles annoncent ce qu'on peut
encore éviter, jamais une promesse) ; **carnet de notifications** (offres, réponses, amis, ventes —
reconstruit depuis les faits déjà enregistrés, pastille dans le menu « Toi ») ;
**connexion Twitch** (identité OAuth par le fournisseur Twitch
intégré à Supabase, le secret restant côté serveur) ;
**hôtel des ventes** (`0009_marche.sql` : dépôt payé comptant,
comptoir asynchrone, vitrine « En vente » sur la fiche publique) ;
**complétion par famille de collection** (colonne `region` du
catalogue et `by_region` de `player_profile()`) ; **amis côté serveur**
(`0008_friends.sql` : demandes, acceptation, retrait, invisibilité pour les
tiers) ; **statut EN LIVE** (le direct réel,
alimenté par Helix côté serveur — voir §8) ; vitrine de quatre cartes ; **profil public complet** et classements
enrichis (`0006_profil_public.sql` : projection `user_cards`, complétion, rangs,
Gold et Holo, affiche de partage) ; tirage des boosters côté serveur
(`0004_tirage.sql`, les cartes sont infalsifiables) ; échanges de cartes
arbitrés par le serveur (`0005_echanges.sql`, une carte contre une carte
jusqu'à cinq de chaque côté) ; compte gardable par adresse + mot de passe,
**sans SMTP**.

**Idées non engagées** (aucune n'est promise) : échanges avec plusieurs
partenaires à la fois, historique complet des échanges, recherche de joueur par
slug de créateur, temps réel sur les offres et le carnet (aujourd'hui :
rafraîchissement manuel ou à l'ouverture de l'écran), revente entre joueurs
(l'hôtel, lui, est en place — §8).

### 9.1 Les notifications de direct (livré le 7 octobre 2026)

La question du brief est simple : *est-ce qu'on ouvre le jeu parce qu'un type
vient de lancer son live ?* Le push répond à ça, et à rien d'autre.

**Qui décide, qui envoie.** Deux pièces, séparées exprès :

| Pièce | Rôle |
| --- | --- |
| `0023_notifications.sql` | la **décision** : quels appareils réveiller (`push_targets()`), le journal anti-doublon (`push_log`), les jetons (`push_tokens`) |
| `0024_push_state.sql` | la **relecture** : `push_state()` dit si le compte reçoit les notifications et sur combien d'appareils — l'interrupteur du carnet ne peut plus afficher un état inventé au lancement |
| `0025_direct_auto.sql` | l'**horloge** : `pg_cron` appelle `refresh-live` toutes les deux minutes (par `pg_net`), pour que le direct se réveille même quand personne ne joue |
| `supabase/functions/notify-live` | l'**envoi** : parle à Firebase (FCM HTTP v1), retire les jetons morts |

`refresh-live` appelle `notify-live` **après** avoir publié le direct (best-effort :
un échec de notification ne fait pas échouer le rafraîchissement des directs).

**Les règles, toutes côté serveur** (un client trafiqué n'y change rien) :

* un direct **frais** : commencé il y a moins de 30 minutes, au moins un
  spectateur — une chaîne qui s'allume avec 0 spectateur, c'est un écran noir ;
* seule compte la **collection du joueur** : le créateur qu'il a **épinglé**
  (wishlist) ou dont il possède **au moins une carte** ;
* **une notification par heure et par joueur** au maximum, et le même créateur
  ne revient pas avant **6 heures** ;
* un seul créateur par appareil et par passage : l'épinglé d'abord, puis le
  plus gros direct ;
* l'interrupteur du joueur (carnet → « Directs de ma collection ») coupe tout.

**Les jetons sont fermés** : `push_tokens` et `push_log` n'ont ni politique RLS
ni droit — un jeton volé, c'est le droit d'envoyer des notifications à
quelqu'un. Trois fonctions *security definer* suffisent au joueur
(`register_push_token`, `forget_push_token`, `set_push_live`), et
`push_targets()` est réservée au rôle de service (elle lit les jetons de tout le
monde). Le retrait est automatique à la déconnexion ; Google retire les jetons
morts au premier envoi perdu.

#### Mettre les notifications en route (une fois, ~10 minutes)

C'est **hors du dépôt** : un projet Firebase (gratuit) et deux secrets. Tant que
ce n'est pas fait, l'application fonctionne exactement comme avant — sans
notification, et sans message d'erreur.

1. **Créer le projet Firebase** : <https://console.firebase.google.com> →
   *Ajouter un projet* → n'importe quel nom → refuser Google Analytics.
2. **Ajouter l'application Android** : dans le projet, l'icône Android →
   *Nom du package* : `com.creatordeck.app` (exactement) → *Enregistrer*.
3. **Télécharger `google-services.json`** (bouton de l'étape 2) et le poser ici :
   `android/app/google-services.json` — il est **versionné** (projet
   `creatordeck-6a9ce`, paquet `com.creatordeck.app`). Ce fichier **n'est pas un
   secret** (identifiant de projet + clé d'API restreinte au paquet, présente
   dans chaque APK) : il doit vivre dans le dépôt, pour que l'APK construite
   **à la main** contienne les notifications. Sans lui, le greffon Google n'est
   pas appliqué et l'APK se construit quand même — simplement sans
   notifications. Un test relit ce fichier pour vérifier que le paquet visé est
   le bon (un fichier qui vise un autre paquet enregistre l'appareil chez
   personne).

   **Et dans le navigateur, il n'y a pas de notifications du tout** : le jeu se
   teste sur Vercel depuis le 8 octobre 2026, mais FCM est une affaire
   d'Android — `src/lib/push.ts` ne s'enregistre que sur plateforme native.
   Pour vérifier un réveil de direct ou une alerte de perte, il faut l'APK.
4. **Créer la clé du compte de service** : ⚙️ *Paramètres du projet* →
   *Comptes de service* → *Générer une nouvelle clé privée* → JSON. C'est un
   **vrai secret** (clé privée) : il ne va **pas** dans le dépôt, mais dans les
   secrets Supabase : *Edge Functions* → *Secrets* (ou *Manage secrets*) →
   `FCM_SERVICE_ACCOUNT` = le contenu du JSON, collé tel quel.
5. **Déployer la fonction** : `npx supabase functions deploy notify-live`
   (ou, dans le tableau de bord, *Edge Functions* → *Deploy a new function* →
   *Via editor*, nom `notify-live`, contenu de
   `supabase/functions/notify-live/index.ts`). **Laisser « Verify JWT »
   désactivé** (la fonction vérifie elle-même l'en-tête `Authorization`) : c'est
   ce que `supabase/config.toml` déclare, pour qu'un déploiement ne change pas
   cette décision sans le dire.

#### Vérifier que ça marche (sans attendre un direct)

Dans un terminal **PowerShell**, avec la clé de service sous la main — sur ce
projet, c'est la **clé secrète** (`sb_secret_…`) : Paramètres → **API Keys** →
section des nouvelles clés → *secret key*. Le JWT « legacy » `service_role`
n'est **pas** accepté par les fonctions : Supabase ne le leur donne pas dans
leur environnement (la fonction répond alors « Réservé au rôle de service » et
précise, entre parenthèses, les clés qu'elle accepte).

```powershell
# 1. Diagnostic : secrets, appareils inscrits, dernières notifications.
curl.exe -s -H "Authorization: Bearer $env:SUPABASE_SERVICE_KEY" "https://yzxchpybqrfegvecihxf.supabase.co/functions/v1/notify-live?check=1"

# 2. Envoi de test : tous les appareils inscrits sonnent tout de suite.
curl.exe -s -H "Authorization: Bearer $env:SUPABASE_SERVICE_KEY" "https://yzxchpybqrfegvecihxf.supabase.co/functions/v1/notify-live?test=1"
```

Le diagnostic ne consomme rien (il n'appelle pas `push_targets()`, qui marque le
journal). Le test, lui, envoie pour de vrai : c'est la seule façon de vérifier
Firebase sans attendre qu'un créateur passe en direct. `refresh-live?push=1`
déclenche un vrai passage (la règle des 30 minutes s'applique) sans rappeler
Twitch.

**Le son** (vécu le 7 octobre : notification affichée, mais muette).

La cause est dans le greffon Capacitor, pas dans Firebase : quand on lui donne
`sound: "default"`, il ne comprend pas le mot magique d'Android — il fabrique
l'adresse `android.resource://<paquet>/raw/default`, c'est-à-dire *un fichier
sonore nommé « default » dans l'application*. Ce fichier n'existait pas : le
canal est né sans son jouable. (Firebase, lui, comprend très bien `"default"` :
il retombe sur le son de notification du téléphone — inutile de chercher là.)

Deux conséquences, et une seule façon de s'en sortir :

* **un canal Android ne se modifie plus après sa création.** Son, importance,
  vibration sont figés. Le canal `creatordeck-live` restera muet à vie sur tout
  téléphone qui l'a vu naître : il faut **un nouvel identifiant**. D'où
  `creatordeck-live-v2`, qui doit être écrit aux **trois** endroits — le canal
  créé par `src/lib/push.ts`, le nom par défaut du manifeste
  (`default_notification_channel_id`), et le `channel_id` du message envoyé par
  `notify-live`. Un test vérifie que les trois disent la même chose : si l'un
  d'eux prend du retard, Android range la notification dans « Divers » (que
  personne ne regarde) ;
* **le fichier son vit dans le dépôt** : `android/app/src/main/res/raw/creatordeck.wav`,
  un son de deux notes fabriqué pour le jeu (aucun contenu tiers), vérifié par
  un test (en-tête RIFF, taille plausible). Le greffon le trouvera désormais, et
  le joueur peut toujours changer le son dans les réglages du canal.

  **Le nom du fichier n'est pas libre** : tout nom de ressource devient un champ
  de la classe `R`, et Android refuse les mots réservés Java
  (`FileResourceNameValidator` : « not a valid resource name (reserved Java
  keyword) »). Un fichier nommé `default.wav` ferait donc **échouer la
  compilation de l'APK** — le piège se refermait une deuxième fois, à la
  construction. D'où `creatordeck.wav`, que le greffon retrouve parce qu'il
  construit l'adresse à partir de la chaîne qu'on lui donne (`sound: "creatordeck"`).

Sur un téléphone où l'ancien canal existe déjà, deux voies : régler le son du
canal « Directs » à la main (Paramètres → Applications → CreatorDeck →
Notifications → canal → Son) pour l'ancien, ou **réinstaller l'APK** pour que le
canal v2 naisse avec le son du jeu.

**Vérifié sur le téléphone du joueur le 7 octobre 2026** : l'APK réinstallée, un
envoi de test (`notify-live?test=1`) — la notification arrive **et sonne**. Le
diagnostic est donc clos par la seule preuve qui compte : l'appareil, pas un
raisonnement sur le code.

**L'interrupteur qui revenait éteint** (même journée, deuxième défaut signalé par
le joueur : « à chaque fois que je ferme et que j'ouvre l'appli, la notification
est désactivée »). Il n'était pas éteint : il était **inconnu**. `pushLive` vit
en mémoire, pas dans la sauvegarde ; au lancement il vaut `null`, et l'écran
affichait un interrupteur éteint. Le serveur, lui, notifiait toujours. Trois
choses ont changé :

* `0024_push_state.sql` ajoute `push_state()` : une **lecture** pure (aucune
  écriture, aucun droit sur `push_tokens`, refusée au visiteur) qui dit si le
  compte reçoit les notifications et sur combien d'appareils. Le carnet la lit
  à l'ouverture, et l'inscription silencieuse du lancement la relit aussi ;
* l'interrupteur **relit avant d'écrire** : `set_push_live` a la garantie « ne
  rien changer si l'état est identique » (c'est ce qui empêche de mentir sur
  « modifié »), donc écrire sans relire pouvait viser un état périmé ;
* **plus aucune demande de permission au lancement.** Une boîte de dialogue qui
  surgit à l'ouverture se fait refuser — et **après deux refus, Android ne la
  pose plus jamais** (Android 11 : la permission est marquée `USER_FIXED`, la
  demande échoue en silence). Le lancement est donc silencieux
  (`requestPushToken(silent)`) : c'est l'interrupteur du carnet qui demande,
  quand le joueur a décidé d'activer les notifications. L'écran distingue donc trois états : allumé, coupé,
  *pas encore autorisé* (et il le dit).

* idées non engagées : échanges avec plusieurs partenaires à la fois,
  historique complet des échanges, recherche de joueur par slug de créateur,
  temps réel sur les offres et le carnet (aujourd'hui : rafraîchissement
  manuel ou à l'ouverture de l'écran), revente entre joueurs (l'hôtel, lui,
  est en place — §8).

### 9.2 Les deux alertes de perte (livré le 8 octobre 2026)

Le direct réveille ; ces deux-là **protègent ce qui est déjà gagné**. C'est le
brief du joueur, mot pour mot : « rien ne prévient un joueur que sa réserve de
boosters va plafonner (un booster qui se perd, littéralement), ni que sa série
de 7 jours va se casser ce soir ». La différence de ton est la règle :

* on **nomme une perte**, jamais une promesse : « Ta série s'arrête ce soir »
  (`J5 sur 7 — ouvre un booster avant 6 h et elle continue.`) et « Réserve
  pleine : un booster se perd » (`Tes 4 boosters attendent (le maximum) —
  au-delà, la recharge est perdue.`) ;
* le chiffre **vient de la base** (`viewers` porte le jour du cycle ou le
  nombre de boosters), il n'est pas inventé dans la fonction d'envoi ;
* aucune des deux ne se déclenche sur du vide : la série doit être **vivante**
  (dernier booster hier) et **pas faite aujourd'hui**, la réserve doit être
  **pleine depuis qu'une recharge s'est perdue** (deux heures : une heure pour
  se remplir, une heure de sursis) ;
* une seule alerte par soirée : deux alertes qui se repoussent l'une l'autre
  sont deux alertes qui n'arrivent jamais — le plafond « une par heure » de
  `0023` ne s'applique donc plus qu'aux **directs**.

**Ce que `0037_gardes.sql` ajoute, et ce qu'il n'ajoute pas.** Aucune table,
aucune colonne, aucune porte de plus côté joueur : `push_targets()` est
**remplacée** (même signature, même liste de colonnes), avec deux conditions
de plus. Deux fonctions internes décident (`_push_serie_due`,
`_push_reserve_due`), révoquées au client comme le reste, et le rapport de
version gagne sa ligne :

```sql
-- la clé qui dit si `0037` est dans la base
'0037', to_regprocedure('public._push_serie_due(uuid, timestamptz, integer)') is not null
```

Trois choses vérifiées plutôt que commentées : **un direct en cours ne chasse
pas l'alerte** (une ligne fraîche du journal ne bloque que les directs), **la
ligne `série` ne consomme pas le tour du direct** (sinon prévenir d'une perte
ferait perdre le direct du soir), et **l'interrupteur du carnet les coupe**
comme tout le reste.

**Un piège à connaître, trouvé par les contrôles.** `0023_notifications.sql`
définit `push_targets()` ; `0037` la remplace. **Rejouer `0023` seule après
coup efface donc les deux alertes** (le vérificateur a joué exactement ce cas).
L'ordre de pose est celui du menu de migrations : `0036` puis `0037`, et si un
fichier est rejoué pour une raison quelconque, `0037` se rejoue derrière.

**Écarté, avec le chiffre qui manquait** (détail dans l'en-tête de
`0037_gardes.sql`) : un **indicateur de malchance ajouté sur l'onglet Drop**
(la ligne existe déjà sur l'accueil — « Légendaire garanti dans N boosters »,
cliquable vers les taux publiés) ; un **rival hebdomadaire parmi ses amis**
(l'écart est déjà public et comparable ; la comparaison sociale entre deux
personnes qui se connaissent est la mécanique la plus toxique du lot) ; et
**pousser l'affiche après un gros tirage** (elle est déjà là, sur un Légendaire
ou un Perfect, **à la demande** — `reveal-overlay.tsx`, `deservesSpotlight`).

## 10. Dépannage

| Symptôme | Cause probable |
| --- | --- |
| « Cloud non configuré » alors que `.env.local` existe | `npm run build` n'a pas été relancé (variables inlinées à la compilation) |
| « Code incorrect ou expiré » à chaque essai | modèle *Magic Link* sans `{{ .Token }}`, ou code d'un précédent envoi |
| « Trop de tentatives » | limite d'envoi d'e-mails de Supabase (1 par minute) : attends |
| « Session expirée : reconnecte-toi » | jeton révoqué ou projet migré : redemande un code |
| « Réseau injoignable » | hors ligne : la partie locale continue, l'envoi reprendra |
| « Réseau injoignable » **dans l'APK** alors que le même appel marche dans Chrome | le WebView sert l'app depuis `https://localhost`, origine que Supabase peut refuser en CORS. Les appels passent par le client HTTP natif (`src/lib/cloud/transport.ts`, `CapacitorHttp`) depuis la PR #7 : si le message persiste, il nomme désormais l'hôte, le chemin et la cause — colle-les dans le ticket |
| « Les échanges ne sont pas installés sur ce projet » | `0005_echanges.sql` n'a pas été collé : § 3 |
| « Le profil public n'est pas installé sur ce projet » | `0006_profil_public.sql` n'a pas été collé : § 3 |
| Le classement affiche « 0 % » ou pas de rang | le joueur n'a jamais envoyé sa collection, ou sa sauvegarde a été jugée invraisemblable (« collection en cours de vérification ») |
| Une carte présente dans la sauvegarde n'apparaît pas dans la complétion | son créateur n'existe pas au catalogue, ou sa rareté ne correspond pas : le serveur ne compte que ce qui existe vraiment |
| « Supabase refuse d'attacher une adresse à un compte invité tant que Confirm email… » | bug GoTrue connu : désactive **Confirm email** (Authentication → Sign In / Providers → Email) puis réessaie |
| L'app demande un « Code reçu » après avoir attaché l'adresse | normal avec « Confirm email » + SMTP : saisis les 6 chiffres, ou désactive le réglage pour enregistrer l'adresse sans confirmation |
| Attachement refusé : « Supabase n'a pas pu envoyer l'e-mail » | pas de SMTP configuré : ajoute un mot de passe (aucun envoi) ou branche un SMTP, § 2 |
| Le code reçu est un lien, pas 6 chiffres | modèle *Magic Link* ou *Change email address* sans `{{ .Token }}` : corrige le modèle, puis **Renvoyer le code** |
| « E-mail ou mot de passe incorrect » | mot de passe saisi différemment, ou compte créé par code (sans mot de passe) : attache-en un depuis l'appareil d'origine |
| « Cette adresse est déjà utilisée par un autre compte » | cette adresse appartient à un autre compte : connecte-toi avec elle, ou change d'adresse |
| « Cette adresse n'est pas confirmée » | **Confirm email** est activé et l'adresse n'a jamais été confirmée : désactive le réglage, ou confirme l'adresse |
| Un message du serveur s'affiche avec des caractères bizarres (« paquet sc├¿ne ») | la migration a été collée à la main depuis la console Windows, qui a relu ses octets UTF-8 en CP850. L'application **répare** ces phrases (`src/lib/cloud/mojibake.ts`), donc l'écran reste lisible ; pour nettoyer aussi la base, rejoue la migration concernée (`npx supabase db push --include-all`), qui envoie le fichier en UTF-8 sans passer par une console |
| « Réinitialiser la progression » ne rend pas les boosters | le serveur n'avait pas encore `0017` : sa réserve vivait à part de la sauvegarde. Colle `0017_reinitialiser.sql` (§ 3) |
| « echange : tu ne possèdes plus … » | la carte donnée a été recyclée ou échangée depuis l'offre : annule l'offre et recommence |
| « Synchronise d'abord ta collection » (échange) | la partie locale et le cloud ont divergé : **Synchroniser** puis recommence (le serveur écrit toujours dans la collection du cloud) |
| La puce « Par famille » n'apparaît pas dans le classement | `0006_profil_public.sql` n'a pas été posé : il apporte la signature à trois arguments |
| « Par famille » affiche 0 / 0 pour tout le monde | la famille choisie n'est pas la bonne, ou le catalogue n'a pas été reposé (`0003_catalogue.sql`, colonne `region`) |
| La liste « Familles de collection » n'apparaît pas sur une fiche | `0006_profil_public.sql` n'a pas été recollé (il apporte `by_region`) |
| Les familles sont toutes « Sans frontière » ou vides | `0003_catalogue.sql` n'a pas été reposé : la colonne `region` manque |
| « Les amis ne sont pas installés sur ce projet » | `0008_friends.sql` n'a pas été collé : § 3 |
| L'entrée « Amis » n'apparaît pas dans le profil | le cloud n'est pas configuré dans ce build : sans serveur, il n'y a personne à ajouter |
| Aucun badge « Direct » n'apparaît | `0007` non posée, `0003` non reposé (colonne `login`), secrets Twitch absents, ou fonction `refresh-live` non déployée — l'appel à la fonction répond alors le détail |
| Un échange accepté n'apparaît pas tout de suite | l'appareil du proposeur s'aligne sur `list_trades()` : **Actualiser mes offres**, ou rouvre l'écran Compte |
| « Le tirage serveur n'est pas installé sur ce projet » | `0003_catalogue.sql` et `0004_tirage.sql` ne sont pas (ou pas à jour) : § 3 |
| « Connecte-toi pour ouvrir un booster » | build avec cloud : le tirage est décidé par le serveur — connecte-toi (raccourci « Mon compte ») |
| « set-returning functions are not allowed in CASE », « BY value of FOR loop must be greater than zero » ou un `cards` NULL | `0004_tirage.sql` est une version antérieure : rejoue le fichier (il est rejouable, `create or replace`) |
| « Sauvegarde refusée par le serveur » | sauvegarde modifiée à la main (voir « ce que le serveur vérifie ») |
| « Les comptes invités sont désactivés » | Dashboard → Authentication → Sign In / Providers → **Anonymous sign-ins** |
| « Le service d'e-mail par défaut n'écrit qu'aux adresses de l'équipe » | normal : branche un SMTP, ou passe par un compte invité |
| « vitrine : carte non possédée (…) » | envoie d'abord ta collection ; seule la dernière sauvegarde cloud sert à vérifier la possession |
| « 4 cartes maximum » | une vitrine contient au plus quatre cartes ; retire-en une avant d'en ajouter une autre |
| « nom de créateur invalide » | la vitrine n'accepte que les slugs de créateur au format attendu |
| Supabase réclame un « custom SMTP » | son service intégré est réservé aux tests : ce n'est pas un bug de l'app |

### Diagnostiquer un souci de connexion

Deux outils, dans l'ordre :

1. **La console du navigateur** — le jeu n'affiche plus de bouton de test : le
   détail des pannes part au journal (`console.warn`, préfixé `[CreatorDeck]`),
   et les migrations manquantes y sont nommées. Côté écran, le joueur lit
   seulement « ce n'est pas encore ouvert » ou « ça se recalera tout seul ».
2. **Dans un navigateur** — la page `docs/diagnostic.html` (dans le dépôt, à
   ouvrir depuis le dossier — elle n'est plus servie avec
   l'application) rejoue les appels un par un : lecture simple, lecture sans
   CORS, écriture simple, écriture avec les en-têtes de l'app, puis la séquence
   complète (compte invité → `pack_status` → `leaderboard`). Elle distingue un
   blocage réseau d'un refus CORS, et affiche la session enregistrée par le jeu.

### Pourquoi les appels passent par le client HTTP natif dans l'APK

Le WebView sert l'application depuis `https://localhost` : ce n'est pas une
adresse publique, et un `fetch` y est soumis au CORS. Sur certains projets
Supabase, ce preflight est refusé — l'échec apparaît alors comme une panne
réseau (« Réseau injoignable ») alors que le même appel fonctionne dans Chrome.
`src/lib/cloud/transport.ts` fait donc passer les appels par `CapacitorHttp`
(module du cœur de Capacitor, aucune dépendance en plus) sur un appareil, et par
`fetch` partout ailleurs. Appel **explicite** au plugin, et non son patch
automatique de `fetch` : l'interception Android des requêtes du WebView ne voit
pas le corps des POST, ce qui laissait échouer la création de compte invité.
