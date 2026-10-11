## Checkpoint courant — automatisation Supabase — 11 octobre 2026

- Reprise vérifiée sur `main` local/distant `475fdff58f2dcefa15c6d16b3702f51ee34556d1`, checkout propre. Demande utilisateur : préparer maintenant les mises à jour automatiques, publication GitHub autorisée. Aucun autre écrivain détecté.
- Malik indique 0046 appliquée puis confirme le tutoriel sur téléphone. Ajustements remis à demain ; ouverture des quatre cadeaux non explicitement confirmée. Ne plus demander de recoller 0046 sans nouveau contrôle contradictoire.
- Préparé : workflow `.github/workflows/supabase-deploy.yml`, script `scripts/supabase-deploy.mjs`, empreintes historiques `supabase/deploy-baseline.json`, 14 tests Node et contrôle ajouté au job quality existant. Déploiement uniquement après CI verte de main, révision courante, cible CreatorDeck vérifiée, TLS ; CLI officiel, historique standard, nouvelles migrations uniquement. Mode manual nécessite lancement explicite. Pas de SQL appliqué lors de la préparation.
- **Activation non validée** : aucun secret de gestion Supabase disponible ; l'historique standard peut manquer après applications SQL Editor. Le workflow ne réconcilie rien automatiquement et refuse toute ancienne migration absente du journal. 0001–0046 jamais rejouées. Sans nouveau fichier, le run réussit sans accès base : ce n'est pas une preuve d'activation.
- Commandes : `node scripts/supabase-deploy.test.mjs` **14/14**, code 0 ; `node scripts/supabase-deploy.mjs --check` code 0 ; `node scripts/supabase-deploy.mjs` code 0 (aucune nouvelle migration/aucun SQL) ; `npm run lint` code 0 ; parsing Python `yaml.safe_load` des deux workflows valide. UI/typecheck/build/SQL de jeu non relancés, produit inchangé. Aucun test réel du CLI ni run GitHub observé.
- Prochaine action : opérateur exécute `select to_regclass('supabase_migrations.schema_migrations') is not null as historique_present;` dans SQL Editor. Puis examiner les versions si présent, vérifier le schéma avant toute réconciliation. Configurer ensuite GitHub Actions secret `SUPABASE_DB_URL` depuis la connexion PostgreSQL du projet, jamais dans le chat. Instructions/liens : [mises à jour automatiques](mises-a-jour-automatiques.md). Ne pas lancer de repair massif, ni 0044.
- Vercel reste indépendant ; configuration réellement active et ordre SQL/publication non contrôlés. Pas de promesse que le déploiement attend Supabase. Les futures migrations doivent être compatibles avec le client actuellement servi.

## Checkpoint courant — replay du tutoriel après reset — 11 octobre 2026

- Reprise sur `main` local et distant `5053dbba7869f2897b70f8fa8c3e6543e82c8252`, checkout propre. Session Cloud seule, travail/push sur main autorisés ; aucune PR fusionnée, branche supprimée ou migration production exécutée par l'agent.
- Contrôle SQL transmis par Malik : 0045 active ; le compte ayant ouvert le premier cadeau conserve **4 boosters**, claim acquis et une ouverture ; les autres comptes ont 5 non réclamés. Aucun cadeau perdu établi. Ne plus demander de recoller 0045 ni rejouer 0044.
- Demande nouvelle : le bouton « Réinitialiser la progression » doit permettre de rejouer le tutoriel puis retrouver le message cadeau. Cause confirmée : `reset_progress()` (0017) ne touchait pas `onboarding_state`, et les deux marqueurs locaux restaient « done ».
- Code testé et publié : [`f179362dc94327750cd058768602eb11f23e4041`](https://github.com/GoodFight37/CreatorDeck/commit/f179362dc94327750cd058768602eb11f23e4041). Le checkpoint documentaire se retrouve avec `git log -1 --format=%H -- docs/agent-handoff.md`. Aucun autre écrivain détecté.
- Correction : migration additive/idempotente `0046_reset_rejoue_tutoriel.sql` remplace `reset_progress()` en conservant son comportement et efface uniquement la fin du tutoriel du compte connecté. Son application ne réinitialise personne. Aucun solde cadeau, claim ou journal cadeau modifié. Pas de nouveaux cinq boosters après reset, y compris cadeau épuisé.
- Le store relit le statut après reset ; l'écran rejoue l'étape 1 sur Drop après réussite (ou reset local), efface les deux marqueurs locaux, et garde le tutoriel inchangé en cas d'échec serveur. Une fois terminé, le cadeau restant et son message sont accessibles ; les ouvertures utilisent le moteur existant.
- Vérifications locales : `XDG_CONFIG_HOME=/tmp/creatordeck-xdg npm test` **71 fichiers, 1109/1109**, code 0 ; `npm run ecrans` **14 fichiers, 75/75**, code 0 (dont reset local et compte connecté simulé : tutoriel puis message/quatre cadeaux, sans nouveau claim) ; `npm run typecheck` code 0 ; `npm run lint` code 0 ; `npm run build -- --webpack` code 0, export /, /_not-found, /overlay, sans variables publiques Supabase. Premiers essais de développement ont détecté un callback mal placé et un mock incomplet, corrigés avant ces résultats. `npm run supabase:verify` **624/624 contrôles**, code 0, PostgreSQL jetable (exécution autorisée pour ses sockets locales). Aucun essai sur téléphone réel ni validation Vercel.
- L'environnement runtime ne possède aucun secret configuré ; réseau restreint, état d'application de la politique `unknown`. Git HTTPS fonctionne avec exécution autorisée. Ne pas annoncer l'accès production Supabase ou le déploiement.
- Prochaine action opérateur après publication : copier **0046 uniquement** depuis GitHub dans le SQL Editor du projet CreatorDeck déjà vérifié `yzxchpybqrfegvecihxf`, attendre `Success`, puis utiliser le nouveau build : Toi → Réinitialiser la progression → tutoriel trois étapes → message cadeau et quatre boosters restants. Vérifier le compte connecté et la version servie. L'agent n'a appliqué aucune migration réelle.

## Checkpoint courant — bug claim cadeau en production — 11 octobre 2026

- Retour de Malik : après le tutoriel, « Réclamer » lance le premier booster ; les clics suivants affichent « cadeau déjà réclamé » malgré quatre boosters restants.
- Cause reproduite par inspection : `claimAndOpenWelcomeGift()` appelle toujours `claim_return_gift()` avant `open_return_gift_pack()`. Le RPC 0044 rejette un second claim. Ce n'est pas un défaut du solde `boosters_remaining` ni du tirage.
- Malik indique avoir collé la migration 0043 puis 0044 dans le SQL Editor. Le contrôle lecture seule reçu : marqueur `tutoriel-cadeau-2026`, `tutoriels=16`, `cadeaux=16`, `tirages_restants=0`, `cartes_restantes=0`, `echanges_ouverts=0`, `annonces_ouvertes=0`. Le reset est confirmé par les compteurs transmis. Le forfait gratuit ne propose pas de snapshots de projet.
- Branche `main`, commit local et distant vérifié `9710bafd0c7400874e3c904ca9aff0d87abae29e` (`fix: allow opening remaining return gift packs`), dépôt propre. Le push vers GitHub a réussi. Statut Vercel/déploiement non vérifié ; ne pas prétendre que le build est déjà servi aux joueurs.
- Correction préparée localement : nouvelle migration `0045_cadeau_claim_rejouable.sql` rend le RPC de claim idempotent sans recréditer, et renvoie `gift_claimed` d'après `claimed_at`. Le client met ensuite le bouton en mode « Ouvrir un booster cadeau ». Le SQL 0045 résout le blocage même pour le build client actuel ; le nouveau client apporte le libellé clair.
- Vérifications locales sur le code modifié : `XDG_CONFIG_HOME=/tmp/creatordeck-xdg npm test` **71 fichiers, 1 109/1 109** ; `npm run ecrans` **13 fichiers, 73/73** ; `npm run typecheck` code 0 ; `npm run lint` code 0 ; `npm run supabase:verify` PostgreSQL jetable : « Toutes les vérifications passent », y compris claim répété après l'ouverture 1, stock à 4, puis cinq ouvertures valides ; `npm run build -- --webpack` code 0 après autorisation d'écrire le fichier de config Next dans `$HOME`. Build sans variables publiques Supabase : compilation UI seulement, sans cloud embarqué. Premier build sandbox bloqué EROFS, première SQL sandbox bloquée par les sockets ; les reruns approuvés ont réussi.
- Prochaine action opérateur : ouvrir [0045 sur GitHub](https://github.com/GoodFight37/CreatorDeck/blob/main/supabase/migrations/0045_cadeau_claim_rejouable.sql), copier son contenu dans SQL Editor du projet `yzxchpybqrfegvecihxf`, obtenir `Success`, puis vérifier que `onboarding_status()` renvoie `gift_claimed=true` et que `claim_return_gift()` après le premier tirage répond sans erreur avec `boosters_remaining=4`. Ne pas rejouer 0044. Le code client est publié ; vérifier le déploiement Vercel séparément.

## Passation vers la session Cloud — 11 octobre 2026

### Où reprendre

- **État GitHub vérifié via l’application GitHub** : le dépôt ne contient qu’une branche, `main`. Le dernier commit observé est `7ec7bfa84addc70781ea96409031c64eda831169` (« Document commit-based app version »), après le code `152c2173606037460f01b8de66f94b24bb720dc6`. PR #7 est intégrée et PR #8 fermée comme obsolète. La page et les fichiers de coordination sur `main` ont été lus.
- Le shell du présent environnement ne résout pas `github.com` (`git ls-remote` échoue DNS). La consultation et la mise à jour de cette passation se font par le connecteur GitHub ; ne pas prétendre que le checkout local est synchronisé.
- **Checkout local de cette session** : branche `main`, HEAD ancien `2c9b6c4ae98898711bb6041c2297b17ac2a1a312`, en retard sur GitHub. Il contient dix fichiers modifiés non commités (AGENTS.md, e2e/pack-tear.spec.ts, CSS et composants/sons du chantier booster). Ils ne sont pas inclus dans GitHub ; ne pas les écraser ni les considérer comme base de reprise Cloud. Le dossier est `work/CreatorDeck` dans l’espace Codex Documents.
- Cette session n’a réalisé **aucun changement applicatif** pour la demande ci-dessous. Seuls les documents de passation, roadmap et décisions sont actualisés ; aucune migration de production n’a été lancée, aucune clé ni donnée de joueur consultée.

### Demande en cours — à implémenter

L’utilisateur a autorisé directement le travail sur `main` et veut :

1. Un tutoriel de première partie dans une fenêtre moderne, court et clair, qui explique la boucle de départ.
2. Remettre à zéro la progression de **tous** les comptes, y compris celui de Malik, pour que tous repartent comme des nouveaux joueurs ; garder les comptes/identités/profils et amis. Garder l’historique des échanges terminés et des ventes terminées ; annuler les échanges en attente et retirer les annonces de marché encore actives. La progression de jeu à remettre à zéro comprend collection/cartes, réserve et tirages, monnaie et ressources, missions/série/jours, Paquet Scène et progression d’arène.
3. Après le tutoriel seulement, envoyer à chaque compte un cadeau unique de **cinq boosters**, dans une boîte/carte cadeau ou le carnet. Texte à afficher : « Malik a décidé de réinitialiser la progression de tout le monde pour implémenter le tutoriel et vous offre 5 boosters. » Le cadeau doit être réclamable une seule fois, ne pas apparaître dans le tutoriel et être indépendant de la réserve normale.
4. Corriger la fin d’ouverture illustrée par le screenshot utilisateur : retirer « Rouvrir un booster » comme action immédiate ; afficher **« Retour au Drop »** après le récapitulatif, sans ouvrir le booster suivant depuis la révélation.

Aucun changement de taux, récompenses existantes ou règles de tirage. Le cadeau est la récompense nouvelle explicitement demandée. Ne pas supprimer les comptes/profils/amis ni les historiques terminés. Le reset global est une opération irréversible : implémenter une migration additive et la vérifier entièrement sur PostgreSQL jetable avant toute application. L’utilisateur a explicitement demandé le reset de tous, y compris lui-même ; avant une exécution réelle, vérifier le projet Supabase cible et son état, et s’arrêter si l’identité de la cible ou la possibilité de sauvegarde/récupération est incertaine. Aucune clé de service côté client et ne pas lire `.env.local`.

### Point d’attention sur la base de code

La passation précédente de la première boucle UX mentionne que le résumé de révélation appelle actuellement « Rouvrir un booster » lorsque la réserve le permet (code d’alors `1769636`). Vérifier ce comportement dans le code **courant** de `main` avant de corriger ; ne pas supposer que le vieux checkout représente le HEAD GitHub. L’interface doit retourner au Drop et laisser le joueur lancer une autre ouverture depuis l’accueil.

Pour le cadeau, garder l’autorité serveur : RPC protégées, stock cadeau distinct, claim idempotent et ouverture qui utilise le moteur actuel sans contourner le tirage normal. Ajouter des tests UI/API et des régressions SQL montrant le reset exact, la conservation des identités/historiques, l’ordre tutoriel puis cadeau, l’unicité du claim et cinq ouvertures valides. Si l’ouverture du stock cadeau ne peut pas être raccordée proprement au moteur existant, résoudre et vérifier ce point avant de déclarer le chantier terminé.

### Prompt prêt à coller dans la session Cloud

> Reprends CreatorDeck depuis GitHub sur `main`, synchronise d’abord le checkout sur le HEAD courant (la dernière tête vérifiée était `7ec7bfa84addc70781ea96409031c64eda831169`, mais vérifie à nouveau), puis lis `AGENTS.md`, `docs/agent-handoff.md`, `docs/roadmap.md`, `docs/decisions.md`, `docs/known-issues.md`, `docs/perimetre.md` et `docs/historique-livraisons.md`. Préserve les changements locaux déjà présents dans ton checkout.
>
> Implémente le tutoriel de première partie, le reset global one-shot de toute la progression (y compris mon compte), et le cadeau serveur unique de cinq boosters, disponible seulement après le tutoriel avec une boîte de réception/carte cadeau affichant le message de Malik. Garde comptes, identités, profils, amis et historiques de ventes/échanges terminés ; annule les échanges en attente et retire les annonces actives. Le reset inclut collection, réserves/tirages, monnaies/ressources, missions/série, Paquet Scène et progression d’arène. Corrige aussi le récapitulatif post-ouverture : CTA « Retour au Drop », sans « ouvrir le prochain booster ». Aucun autre taux, récompense ou règle de tirage ne change.
>
> Fais une migration SQL additive, testée sur Postgres jetable, avec vérification explicite des tables et de tous les compteurs remis à zéro et conservés. Le cadeau doit utiliser le moteur de tirage actuel, être distinct de la réserve normale et être réclamable une fois. Mets les tests, docs de décisions, roadmap, known issues et cette passation à jour. Exécute les tests projet, écrans, typecheck, lint, build et `npm run supabase:verify`, en donnant commandes, SHA et résultats exacts. Aucun accès à la production ni déploiement automatique : avant d’appliquer la migration à la vraie base, revérifie le projet cible, le schéma courant et la sauvegarde ; arrête-toi si une incertitude subsiste. N’intègre pas une PR et ne supprime aucune branche.

### Suite immédiate

La session Cloud doit créer/actualiser son checkout depuis le `main` GitHub courant, puis commencer par le diff actuel de `reveal-overlay.tsx`, `creator-deck-app.tsx`, le flux cloud des boosters et les migrations `0043`+. Elle ne doit pas récupérer les dix modifications non commitées de l’ancien checkout sans les examiner séparément.

---

## Checkpoint courant — version visible du build, 10 octobre 2026

- Branche `main`, tête locale [`152c2173606037460f01b8de66f94b24bb720dc6`](https://github.com/GoodFight37/CreatorDeck/commit/152c2173606037460f01b8de66f94b24bb720dc6), enfant de `7b2d89a7ebffa5ba102867393357d1aab3931021`. Le commit code est local et reste à pousser avec cette passation après re-fetch/compare. Aucun autre fichier applicatif modifié.
- Toi affiche « Version abc1234 » sous l’édition du catalogue, en gris discret. La version provient de `VERCEL_GIT_COMMIT_SHA` ou `GITHUB_SHA`, avec repli sur `git rev-parse HEAD` pour un build local/Android. Sans SHA valide, le libellé affiche « Version locale ». Le SHA complet est dans l’infobulle ; aucune clé ni variable secrète n’est incluse. D-018 consigne le choix.
- Vérifications sur le code du commit `152c217` : écran Toi **5/5** ; `src/lib/build-version.test.ts` **2/2** ; `npm run typecheck`, `npm run lint`, `npm run build` réussis. Le bundle local généré contient bien `152c217`, vérifié dans `.next/static/chunks` et `out/_next/static/chunks`. Pas de nouvelle suite complète (quatre échecs préexistants `K-015` restent consignés). Vercel n’a pas encore construit ce SHA ; la build locale ne prouve pas le déploiement.
- Après push : contrôler le statut Vercel et que le commit SHA du déploiement correspond au SHA distant ; ensuite la valeur visible attendue est `Version 152c217` (ou les sept caractères du commit final si le commit documentaire est inclus dans le déploiement). Les workflows GitHub Actions ne sont pas établis pour ce commit.

## Historique — deuxième passe UX de démarrage, 10 octobre 2026

- Branche `main`. Code UX au commit [`09487de4791058db7f09e30f4dd00ebde8b9bcb7`](https://github.com/GoodFight37/CreatorDeck/commit/09487de4791058db7f09e30f4dd00ebde8b9bcb7), enfant de `3b4a56867b98f763d29f157c659562ed82454d9f`. L’utilisateur a explicitement autorisé le travail direct sur `main`. Fetch avant édition : local et distant étaient égaux à `3b4a568`; le code est commit local, la documentation de ce checkpoint reste à publier. Aucun `gh`/contrôle Actions exécuté ici. Aucun secret lu, aucune production Supabase consultée ou modifiée.
- Deuxième passe UX : Atelier réduit à une progression `N / 10` jusqu’à dix copies recyclables, sans listes vides ni catalogue de 1000 ; raccourci Retour au Drop. Toi cache les statistiques à zéro, montre une vitrine locale des trois meilleures cartes possédées et l’état de série. Drop expose en haut une mission quotidienne déjà présente dans le moteur et renvoie à l’écran de missions existant. Aucune récompense, règle d’économie, dépendance ou règle serveur n’a changé. D-017 consigne ces choix.
- Première passe au commit `1769636dab8069486f64dff3ed81404eb0e86bb6` : Binder « Obtenues », catalogue 12 cartes/page, invitation d’ouverture à zéro, résumé de fin de paquet avec CTA de réouverture ; son/reflets actifs par défaut si le joueur n’a pas enregistré OFF, avec `prefers-reduced-motion` conservé.
- Fichiers du second lot : `src/components/atelier-view.tsx`, `creator-deck-app.tsx`, `drop-view.tsx`, `profile-view.tsx`, `src/app/globals.css`, tests `src/ecrans-mille-cartes.test.tsx` et `src/ecrans.test.tsx`. `docs/decisions.md` D-017, roadmap et présente passation documentent l’état.
- Vérifications après le second lot : `npm run ecrans` **72/72** ; tests ciblés après ajout des assertions profil vide **13/13** ; `npm run typecheck`, `npm run lint`, `npm run build` passent. `npm test` : **1102/1106**, quatre échecs : rejouabilité `supabase-profil.test.ts` (3 occurrences contre 2), seed saisons désynchronisé, seed catalogue désynchronisé et assertion de forme du SQL catalogue. `npm run catalog:ci` code 1 : `0003_catalogue.sql` dérive de `creators.json`. Ces incohérences de données/migrations restent hors du chantier UX ; aucun fichier généré n’a été réécrit.
- Les choix simples du retour produit sont couverts par deux passes. Restent UX-03 : rendre plus évidents les éléments sociaux déjà existants, évaluer badges/avatar et uniformité des portraits sans inventer de contenu ou de règles, puis vérifier les rappels déjà configurés avant d’ajouter quoi que ce soit. K-005/VIS-01 nécessite toujours un avis sur téléphone réel. Vercel a construit le commit `427229f` en prévisualisation READY (`target: null`), alias `creator-deckk-git-main-hafsi37-2386.vercel.app`, et son statut combiné est `success`. L’outil de workflow GitHub ne retourne aucun run associé ; les Actions restent donc non vérifiées. Ce n’est pas une preuve de déploiement Production.
- Prochaine action technique autonome : publier le commit code et le checkpoint documentaire sur `main` après re-fetch/compare du HEAD distant, puis vérifier `ls-remote` et l’état propre. Le SHA code est explicite ci-dessus ; le SHA contenant ce handoff sera trouvé avec `git log -1 --format=%H -- docs/agent-handoff.md`.

## Historique — première boucle UX de collection, 10 octobre 2026

- Branche `main` ; le chantier UX est publié au commit [`1769636`](https://github.com/GoodFight37/CreatorDeck/commit/1769636dab8069486f64dff3ed81404eb0e86bb6), enfant de `81e964443673951bccc84af0b9b01354c1b63f25`. Le SHA distant a été vérifié identique après le push et le dépôt est propre. L’utilisateur a autorisé le travail direct sur `main`. `gh` n’est pas installé et les pages Actions n’étaient pas accessibles : l’état CI n’a pas été vérifié. Aucun accès à Supabase de production, aucun secret consulté.
- Retour produit traité : le Binder démarre sur « Obtenues » ; à zéro carte, il n’affiche ni `0 / 1000` ni pager, propose d’ouvrir un booster et garde un bouton explicite vers le catalogue. Le catalogue utilise 12 cartes par page.
- Après la dernière révélation, le jeu affiche un résumé avec les cinq cartes et le nombre de nouvelles. « Rouvrir un booster » appelle le vrai flux de tirage quand `game.player.packs > 0` ; sinon le bouton revient au Drop. L’overlay OBS conserve sa fermeture actuelle. Les silences, le verrou Perfect, les animations d’ouverture et les sons ne changent pas.
- Le son est actif par défaut lorsqu’aucune préférence n’est enregistrée ; les reflets sont actifs par défaut si `prefers-reduced-motion` ne les coupe pas. Les choix locaux explicites restent respectés. La prévisualisation Vercel déjà observée peut mémoriser un ancien choix OFF ; ne pas l’effacer automatiquement.
- Fichiers applicatifs : `src/components/binder-view.tsx`, `src/components/reveal-overlay.tsx`, `src/components/creator-deck-app.tsx`, `src/app/booster-continuity.css`, `src/app/globals.css` et tests UI/son. D-016 consigne le choix.
- Validation : tests ciblés écrans 20/20 et son/reflets 32/32 ; écrans complets 71/71 ; typecheck, lint, build Next OK. `npm test` complet a quatre échecs hors de ce chantier : test de rejouabilité `supabase-profil` (3 occurrences contre 2 attendues), synchronisation du seed saisons, synchronisation du seed catalogue et assertion de forme du SQL catalogue. Ces contrôles ne sont pas corrigés ici. Build local sans variables cloud utilisables ; aucun flux serveur réel testé.
- Suite proposée déjà autorisée par le retour fourni : UX-02, limiter le bruit du Craft avant dix doublons, renforcer l’identité collectionneur dans Toi, et montrer un objectif court sur Drop ; préserver les règles d’économie et les contrats serveur. La validation au téléphone réel reste distincte des tests UI.

## Historique — polish d’ouverture des boosters, 10 octobre 2026

- Le code applicatif est sur `main` au commit `d0f4765ed050db54b4f85626ea7f2c03fd7e9f68` ; l’utilisateur a autorisé le travail direct sur `main`. Le stash `préserver état local avant chantier visuel main` reste intact. Aucun secret n’a été lu et aucune base Supabase n’a été consultée ou modifiée.
- Chantier demandé : volume CSS du sachet d’accueil et du sachet ouvert, inclinaison au doigt soumise à `cardEffectsAllowed()`, specular CSS, plis physiques et fente lumineuse, cascade 3D des cinq dos en 765 ms environ, carte révélée plus grande/plus profonde et hiérarchie commune → rare → épique → légendaire. Le Rare a un halo bordeaux sans flash blanc. Aucun changement de taux, récompense, économie ou de dépendance.
- Le son de déchirure a une descente de fréquence longue ; son départ et le bang restent attachés au geste et au `--rare-delay` existants. Les constantes 520 ms de silence Épique, 2,6 s de verrou Perfect et 1,9 s avant RevealOverlay n’ont pas changé.
- Validations sur le dépôt original : typecheck OK ; tests UI **70/70** ; build Next OK. E2E Playwright bureau **11/11** a passé avant le dernier ajustement de pose CSS ; les relances focalisées après cet ajustement sont restées suspendues au serveur Playwright local et ont été interrompues sans résultat. La suite complète affiche 4 échecs hors des fichiers du chantier : graines catalogue/saisons non synchronisées et comptage `add column if not exists` Supabase. Le run mobile et le rendu réel sur téléphone restent à confirmer avant de clôturer VIS-01.
- Le commit `d0f4765` a un déploiement Vercel `READY` accessible par l’alias de branche `creator-deckk-git-main-hafsi37-2386.vercel.app`. C’est une prévisualisation (`target: null`). Le déploiement Production du projet pointe toujours vers `arena/01a10c75-creatordeck` ; aucun domaine de production n’a été remplacé dans ce chantier.
- Aucun changement serveur ni cloud ; le contrôle cloud du build indique que les variables publiques ne sont pas injectées dans ce build local.

## Checkpoint courant — roadmap et parité Scène, 10 octobre 2026

### État GitHub et portée

- Branche de référence : `main` ; la liste GitHub ne contient que cette branche. Tête du code consolidé : `2c9b6c4ae98898711bb6041c2297b17ac2a1a312`. PR #7 intégrée ; PR #8 fermée comme obsolète. Les commits documentaires de ce checkpoint suivent ce commit sans changer l'arbre applicatif.
- L'utilisateur demande une collaboration autonome : consulter l'état courant et la roadmap, faire d'office les tâches ordinaires à faible risque, ne pas demander un « go » à chaque étape. Demander seulement lorsqu'un vrai choix produit est nécessaire ou qu'une action touche la sécurité, les secrets, une base en production, ou une opération destructive/irréversible. Travailler directement sur main est autorisé dans le cadre de cette demande.
- Aucune base Supabase en production, clé ou donnée de joueur n'a été consultée ou modifiée.

### Résultats établis

- Parité Paquet Scène : la migration additive 0043 et le moteur local suivent les règles de cinq créateurs distincts d'une famille, sans Légendaire ; événement Scène pleine à 3/1000 ; Épiques disponibles utilisés puis autres raretés autorisées ; candidat Rare/Épique réservé au cinquième emplacement ; familles incompatibles refusées.
- Le dépôt consigne 35/35 tests ciblés et 559 contrôles SQL réussis sur PostgreSQL jetable sous WSL, migrations 0001–0043 comprises. Le test inclut familles avec peu ou zéro Épique, ouvertures du paquet et refus des familles incompatibles. Résultat fourni par l'utilisateur et repris dans la passation/roadmap ; cette session n'a pas exécuté ces tests.
- Audit local de progression : 12 scénarios × 1 000 trajectoires, graine `20261010`, zéro paquet manquant, sur le code `7da3d1c301c949e6cbeaef6aecd6ec0c94ffe2f1`. Il reste un audit TypeScript local, pas une comparaison des RPC de progression.
- Sur l'arbre applicatif de `53e6127d21a8e5d5ec173bfbe1b29e79d5f097c0` (identique à l'arbre de code consolidé), 70 fichiers / 1 104 tests, typecheck et build ont réussi. Le workflow GitHub Actions #261 a réussi sur le commit documentaire `1b4efef` avec ses quatre jobs (qualité/build, E2E, SQL jetable, cloud simulé) ; le contrôle Vercel de ce commit est vert. Le run #260 avait également réussi sur le même arbre applicatif. Les commits depuis la consolidation sont documentaires ; le code du jeu n'a pas changé.
- La roadmap et le rapport de progression ont été actualisés pour séparer l'état historique du premier audit des validations postérieures. Le SHA courant du document de passation sera retrouvé dans Git par `git log -1 --format=%H -- docs/agent-handoff.md` ; ne pas l'auto-référencer ici.

### Ce qui reste réellement ouvert

- VIS-01 : verdict humain sur téléphone réel (soudure accessible à une main, rendu/rythme, reflets et animations réduites). Les tests automatisés ne remplacent pas cette appréciation.
- CI GitHub courante : statut Vercel vert, mais résultat GitHub Actions complet non établi.
- CLOUD-01 (schéma/parcours du vrai projet Supabase) reste en attente d'une autorisation explicite ; ne pas contacter ni modifier la production spontanément.
- Aucun nouveau taux, récompense ou chantier produit n'est décidé. Si la suite nécessite une préférence de gameplay ou une validation subjective, présenter ce choix une seule fois, après avoir terminé le travail indépendant.

### Actions de documentation effectuées

- `docs/roadmap.md` : commit `1b4efef12987d504c8caefb451d92a5fbb3a04bd` ; les cases déjà couvertes par l'audit et les tests automatisés sont cochées, les dépendances externes restent ouvertes.
- `docs/audit-progression.md` : commit `7a89ece59931656da7e2ea71b20e5550e2349f70`.
- Résultat GitHub Actions #261 vérifié après écriture : quatre jobs réussis sur `1b4efef` ; le contrôle Vercel est aussi vert. Le run #260 sur le code courant avait déjà réussi ses quatre jobs.
- Modifications limitées à la documentation ; aucun test de code n'a été lancé dans cette session, car aucun checkout du dépôt n'est présent dans l'espace local.

---

## Point de reprise SQL - validation locale terminee, 10 octobre 2026

Branche design/booster-reveal-polish. Le correctif SQL et les deux ajustements du banc sont valides ; ils sont inclus dans le commit de finalisation de cette reprise.

Validation executee dans la distribution WSL Ubuntu de l'utilisateur, sous creator : tests cibles 35/35 ; migrations 0001 a 0043 appliquees sur PostgreSQL jetable ; tous les controles du script reussissent, sortie finale "Toutes les verifications passent." Les cas S02/S03/S05/S07/S08 (branches normale et Scene pleine), fixture sans Epique, cinq cartes distinctes, interdiction du Legendaire, garantie finale et ouvertures open_scene_pack sont couverts. Aucun acces de production ni secret utilise.

Le run a expose deux problemes de fixture : le nom depassait la contrainte du profil, puis un refus SQL attendu annulait la transaction de fixture. Les deux sont corriges ; le savepoint isole maintenant le refus. Tests, typecheck, build, syntaxe Node et diff-check reussis. Le code et la documentation sont commit/push sur la branche ; ne pas fusionner la PR ni toucher main ou production.

## Audit final reçu — 10 octobre 2026

L'utilisateur a fourni `audit-1000.txt` après `git pull` du commit `7da3d1c301c949e6cbeaef6aecd6ec0c94ffe2f1`. Vérification : commande et graine attendues, TZ Europe/Paris, Mulberry32, 12/12 scénarios à 1 000, 12 000 trajectoires, zéro `missingPacks`. Résultats détaillés et SHA dans [audit-progression.md](audit-progression.md) et [progression-manifest.json](audits/progression-manifest.json). Supabase local reste non vérifié ; aucun changement de production.

# Passation opérationnelle CreatorDeck

## Checkpoint courant — sachet compact et appui accueil, 10 octobre 2026, Europe/Paris

- Demande utilisateur après essai sur son téléphone : paquet d'ouverture trop
  grand, soudure difficile à atteindre à une main ; appui sur le sachet de
  l'accueil sans effet. Cinq vidéos Pokémon TCG Pocket reçues et examinées
  (main.mp4, main (1/2/3).mp4, Pokemon-TCG-Pocket-figure1-2.mp4) : références
  de cadrage, déchirure horizontale et manipulation des cartes. Aucun média
  Pokémon ajouté au produit. Correction autorisée par le « Go » après pause
  pour changement de modèle. Réservation libérée.
- Checkout existant `/workspace/CreatorDeck`, branche `design/booster-reveal-polish`,
  initialement propre. Base locale/distante identique `34ffd32dda2e1f0941d674e813f4dbc4a9591b98`.
  PR #8 relue via HTML : DRAFT, base `arena/01a10c75-creatordeck`, même tête.
  Aucun main, worktree, merge, changement d'économie ou de règles réseau.
- Code corrigé et testé : `0beb6b37027ced0630ed828604754aed17f7ffb7`.
  [Commit](https://github.com/GoodFight37/CreatorDeck/commit/0beb6b37027ced0630ed828604754aed17f7ffb7).
  Le sachet accueil est un bouton accessible ; appui/clavier et tirage vers le
  haut ouvrent le même parcours. Les clics générés après un glissement sont
  ignorés, le geste annulé reste sans ouverture. Le focus revient au sachet,
  ou au titre Live Drop quand le dernier booster a été consommé.
- Cause du paquet géant prouvée dans le CSS : sa largeur était la largeur carte
  divisée par .72, soit environ 94 % de l'écran téléphone. Largeur maintenant
  indépendante : min(64vw, 280px, 30dvh). À 412×915 : paquet 263,67×386,72 px,
  soudure centrée à y=451,97 px (49,4 % de la hauteur). Les cartes grandissent
  pendant l'extraction et finissent à la taille/position de la révélation.
  Tracé accepté dans les deux sens, seuil 55 % de la largeur, zone haute de
  58 px et bouton de secours conservés. Accueil plus compact sur petit écran.
- Vérification finale : `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  NEXT_TELEMETRY_DISABLED=1 node node_modules/@playwright/test/cli.js test
  e2e/pack-tear.spec.ts --reporter=line` : **code 0, 20/20**, 1,2 min,
  bureau et téléphone. Appui touch réel Chromium, clavier, réserve diminuée
  une seule fois, tirage abandonné/armé, tracés touch CDP dans les deux sens,
  cancel de soudure, géométrie 320×568/360×800/412×915, continuité, animations
  réduites et focus Live/Scène. Test de continuité mesure désormais le dos
  extrait à la fin de son animation, plutôt que le centre du sachet scellé.
- `npm run ecrans -- src/ecrans-tactile.test.tsx --maxWorkers=2` : code 0,
  **4/4**, 1 fichier, 5,40 s (reflets/vibrations simulés). `npm run typecheck`
  et ESLint direct sur drop-view, pack-tear et e2e/pack-tear : code 0.
  `git diff --check` : code 0. Pas de build de production, SQL, suite complète
  ou nouveau parcours serveur. Next 16.3.6, Playwright 1.63.0 et Vitest 3.2.7
  installés identiques au lock ; aucun manifeste/lock modifié.
- Runs intermédiaires : 14/20, six attentes erronées de réserve initiale 3
  au lieu de 2 ; attentes corrigées pour comparer à la réserve affichée.
  Ensuite 18/20, deux échecs du vrai tirage souris : `dragstart` sur IMG puis
  `pointercancel` sur BUTTON prouvés par les événements Chromium. Image
  accueil désormais draggable=false ; run final 20/20. Ces runs échoués ne
  constituent pas une preuve de réussite. Premier lancement E2E refusé avant
  tests : serveur local listen EPERM ; relance avec autorisation d'exécution.
- Captures bureau/téléphone examinées ; visite 412×915 HTTP 200, zéro pageerror.
  Artifacts hors Git : `/workspace/scratch/creatordeck-thumb-polish/`
  (first-results, second-results, final-results, final-e2e.log, home-412.png,
  sealed-412.png, reveal-412.png, visual-report.json). Captures uniquement
  locales, pas une mesure de fluidité/appareil réel ; conservation entre
  environnements non garantie. Serveur dev arrêté ; seul bloc Next automatique
  ajouté à AGENTS retiré, contenu original restauré.
- Réseau : environnement connecté/en marche, observations actuelles, politique
  déclarée restricted avec *.vercel.app et les trois hôtes Playwright ; état
  d'application rapporté unknown. En sandbox Git refuse le proxy:8080 ; le
  même contrôle autorisé répond correctement, SHA distant vérifié. Aucun
  besoin démontré de recréer l'environnement. Vercel non revisité ici ; son
  ancien blocage SSO ne constitue pas une nouvelle preuve d'accès au preview.
- K-012 implémenté et vérifié automatiquement ; VIS-01/K-005 restent ouverts
  pour appréciation à une main sur téléphone réel, fluidité, sons/reflets.
  CI du nouveau SHA et nouveau preview non vérifiés. CLOUD-01 non repris.
- Prochaine étape : Luna / Faible suffit pour vérifier la CI du SHA publié et
  recueillir l'essai humain : appui sur sachet accueil, puis tracé de soudure
  droite/gauche à une main. Revenir à GPT-6.1 Sol / Moyen avant autre correction.
  Commit contenant cette passation : `git log -1 --format=%H -- docs/agent-handoff.md` ;
  recontrôler le HEAD distant et le contenu des docs avant prochaine reprise.

## Historique — K-011 corrigé, 10 octobre 2026, Europe/Paris

- Correction ciblée autorisée après visite locale ; réservation libérée.
  Base locale/distante propre et identique `96209d23799dd14717a4e7e219e0ccbbcf9ccd5a`,
  checkout existant sur `design/booster-reveal-polish`, aucun worktree/main/merge.
- Code corrigé et testé : `d87b72c35d887de6ddd5a14c53b69a5a9c5b184c`.
  Si le déclencheur connecté ne reçoit plus le focus après fermeture, le hook
  utilise la cible explicitement marquée dans sa section. Le titre Scène est
  cette cible (`tabIndex=-1`, hors de l'ordre Tab). Le paquet consommé reste
  désactivé ; aucun changement d'économie, de tirage ou de mise en scène.
- Nouveau scénario E2E « closing a consumed Scene pack returns focus to its
  section heading » : avant correctif, code 1, 2/2 échecs bureau/téléphone sur
  l'assertion de focus du titre ; bouton déjà désactivé. Après correctif, même
  scénario plus « the revealed card keeps » existant : code 0, **4/4 réussis**,
  16,9 s. Le scénario Live conserve ses assertions de focus/inert et dimensions.
  Commande ciblée : `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  node node_modules/@playwright/test/cli.js test --grep
  'closing a consumed Scene pack|the revealed card keeps' --reporter=line`.
- `npm run typecheck` : code 0. ESLint direct sur les deux fichiers produit et
  `e2e/pack-tear.spec.ts` : code 0, aucun diagnostic. `git diff --check` : code 0.
  Pas de build de production, suite complète ou nouvelle visite Vercel ; CI
  du nouveau correctif non vérifiée, ancienne CI verte `2d933c9` historique.
- Serveur dev arrêté après vérification ; seul ajout automatique Next à AGENTS
  sauvegardé puis retiré. Aucun manifeste/lock modifié. Artifacts et résumé
  locaux : `/workspace/scratch/creatordeck-scene-focus/{before-results,after-results,results.txt}`,
  non publiés et conservation entre environnements non garantie.
- K-011 corrigé et vérifié automatiquement ; VIS-01/K-005 restent ouverts pour
  validation humaine sur téléphone réel (fluidité, sons, vibrations, reflets).
  CLOUD-01 non repris ; aucune production Supabase touchée.
- Prochaine étape simple : passer à Luna / Faible pour consulter la CI du bon
  SHA et guider la validation humaine. Revenir à GPT-6.1 Sol / Moyen avant un
  nouveau diagnostic/correctif produit. Pas de nécessité démontrée de recréer
  l'environnement. Commit contenant cette passation à retrouver via git log,
  puis comparer au HEAD distant avant de reprendre.

## Historique — visite Chromium locale, 10 octobre 2026, 12 h 41 Europe/Paris

- Reprise autorisée après choix de la visite locale, puis validation sur téléphone réel.
  Checkout `/workspace/CreatorDeck` initialement propre sur `work` à `ae5016f` ;
  HEAD distant design vérifié à `66b78d583a33e7f135307ac371f2485e4654a2d6`, objets
  récupérés puis switch explicite sur `design/booster-reveal-polish`, sans worktree,
  reset, modification de main ni perte de travail. SHA du code visité : `66b78d5` ;
  différence avec `2d933c9` uniquement documentaire. Réservation libérée.
- Correction des conclusions de conversation : AGENTS et ce checkpoint existent
  bien à `66b78d5`, et `2d933c9` est son ancêtre. La première lecture utilisait
  un FETCH_HEAD ancien malgré un fetch `--no-write-fetch-head`. Les erreurs curl 7
  et Python `Operation not permitted` en sandbox ne prouvaient pas une panne proxy.
  La même requête avec autorisation d'exécution, proxy/CA inchangés, répond HTTP 302
  vers `vercel.com/sso-api` ; suivre la redirection échoue avec curl 56,
  `CONNECT tunnel failed, response 403`. Protection Vercel et domaine SSO non
  autorisé ; aucune nécessité démontrée de recréer l'environnement. Aucune règle
  réseau changée, aucun accès authentifié ou rendu Vercel obtenu.
- Le nouvel environnement n'avait conservé ni Playwright ni Chromium. `npm ci
  --cache /workspace/.npm --no-audit --no-fund` : code 0, 602 paquets ; Next 16.3.6
  et Playwright 1.63.0 comparés au lock, identiques. Installation Chromium par le
  CLI verrouillé : code 0, Chromium/Headless Shell 153.0.8010.12, révision 1243.
  Serveur `NEXT_TELEMETRY_DISABLED=1 npm run dev -- --hostname 127.0.0.1` arrêté
  après visite. Aucun build de production ni suite de tests relancé.
- Visites directes via scripts temporaires, pas le runner E2E : Live bureau
  1280×900, téléphone 412×915 avec vrais événements touch Chromium simulés,
  réduction d'animations 320×568 ; HTTP 200, aucun pageerror, fermeture rend le
  focus au bouton Live et enlève inert. Cartes et actions restent dans l'écran ;
  face sans animation/transform en mode réduit. Captures scellé/coupure/dos/face
  examinées ; vidéos enregistrées, pas de mesure de fluidité sur appareil réel.
- Scène 412×915 : ouverture puis progression jusqu'à la cinquième carte observées.
  Perfect à 320×568 et 1280×900 : cinq cartes visibles, captures examinées.
  Perfect provoqué uniquement dans un contexte navigateur local isolé, en remplaçant
  les tirages Uint32Array(1) par zéro ; aucune modification du moteur ou des taux,
  aucun parcours serveur réel ni preuve probabiliste. Les autres contextes sont
  indépendants. Audio/haptique et reflets coupés non validés par cette visite.
- Nouveau point K-011 : après fermeture Scène, focus sur BODY, bouton Scène
  désactivé « Reviens demain ». Reproduit deux fois ; inert=false, aucun pageerror.
  Le hook tente de focaliser la cible capturée, mais le bouton consommé ne peut
  plus recevoir le focus. K-010 Live reste corrigé ; ne pas rouvrir son symptôme.
- Artifacts locaux hors dépôt : `/workspace/scratch/creatordeck-visual-66b78d5/`
  (captures, vidéos, scripts, report.json, special-report.json, scene-focus-report.json).
  Pas publiés, conservation entre environnements non garantie. Bloc Next ajouté
  automatiquement à AGENTS sauvegardé avec les artifacts puis seul ce bloc retiré ;
  aucun fichier produit, manifeste ou lock modifié.
- CI verte à `2d933c9` conservée comme preuve historique, pas relue/rejouée ici.
  VIS-01/K-005 restent ouverts pour appréciation au pouce, sons/vibrations et
  fluidité sur téléphone réel. CLOUD-01 hors périmètre, aucune production touchée.
- Prochaine action : corriger K-011 avec un retour clavier vers une cible disponible
  après consommation Scène, puis visiter ce parcours ; valider sur téléphone réel
  le même code (preview protégé accessible au joueur connecté ou APK).
  Publication de ce checkpoint : retrouver son SHA via git log et comparer au distant.

## Historique — CI vérifiée, preview bloqué, 10 octobre 2026, 11 h 57 Europe/Paris

- Agent : Codex Cloud ; contrôle ciblé après le « go », réservation libérée.
  Branche `design/booster-reveal-polish`, HEAD local et distant identiques :
  `2d933c92caa8bef0e08672239232e7da114620b8` ; checkout propre. Aucun changement produit ni nouveau test local.
- PR #8 relue sur GitHub : DRAFT, base `arena/01a10c75-creatordeck`, tête
  `2d933c92caa8bef0e08672239232e7da114620b8`. Workflow « Vérification »
  [run #235](https://github.com/GoodFight37/CreatorDeck/actions/runs/38042993215)
  **terminé avec succès** pour ce SHA. Les quatre jobs sont verts : unitaires/
  écrans/statique/build, SQL sur Postgres jetable, E2E Playwright, chemin cloud
  à RPC simulés. Leurs compteurs précis n'ont pas été extraits des logs ; ne
  pas réutiliser les chiffres des runs locaux comme chiffres CI.
- Le journal de la PR relie explicitement le même SHA au preview Vercel
  [deployed](https://creator-deckk-rapfm1ejk-hafsi37-2386.vercel.app), daté du 10 octobre à 09 h 54 UTC ; le commentaire
  Vercel signale « Ready ». Cette preuve porte sur le déploiement, pas sur la
  qualité visuelle de l'ouverture.
- `curl` vers le domaine du preview et l'alias
  `https://creator-deckk-dev.vercel.app` : **code 56, CONNECT 403**.
  Aucun rendu du preview n'a donc été chargé dans le navigateur de cet agent.
  VIS-01 et K-005 restent ouverts : continuité et gestes au pouce, dos/faces,
  halo/Perfect, réduction des animations, sons/reflets et bureau/téléphone
  requièrent encore le verdict humain sur le lien ci-dessus.
- `gh run list` et `gh pr view` : Forbidden ; `api.github.com` via curl :
  CONNECT 403. Contrôle CI fait par les pages HTML GitHub publiques, reliées
  au SHA exact, sans déduire les résultats d'une ancienne passation.
- Skill cloud-onboarding `setup` consulté pour l'accès. Configuration active :
  règles personnalisées Playwright, aucun domaine Vercel. Le brouillon renvoyé
  a une `base_version_id` plus ancienne que la version active de l'environnement ;
  aucun enregistrement n'a été tenté pour ne pas écraser un brouillon périmé.
  Si l'agent doit visiter le preview, l'opérateur peut ajouter le domaine exact
  `creator-deckk-rapfm1ejk-hafsi37-2386.vercel.app` dans les paramètres réseau de
  l'environnement actuel, puis Save et Publish ; recontrôler l'accès après
  activation. L'alias `creator-deckk-dev.vercel.app` n'est pas nécessaire
  pour l'URL liée à ce commit. Cette configuration n'a pas été sauvegardée.
- Fichiers : passation, roadmap, problèmes, journal. Publication documentaire
  à retrouver avec `git log -1 --format=%H -- docs/agent-handoff.md`, puis
  comparer au HEAD distant. Aucun merge ni modification de main.
- Prochaine action : recueillir l'avis visuel du joueur sur le preview du SHA
  ci-dessus ; si l'accès réseau est ouvert, lancer la visite Chromium sur cette
  URL et noter le statut HTTP et les gestes observés. Ensuite reprendre CLOUD-01
  uniquement avec le projet Supabase autorisé. Ne pas marquer VIS-01 terminé
  sur la seule base de la CI ou du statut Vercel.

## Historique — K-010 corrigé, 10 octobre 2026, 11 h 53 Europe/Paris

- Agent : Codex Cloud ; correction ciblée autorisée (« let's go »), réservation
  libérée à la passation. Modèle conseillé pour cette correction : Sol / Moyen.
- Branche `design/booster-reveal-polish`, base locale/distante propre
  `2765179cfe93c26dc23160cb432d1404e3235c87`, fetch design sans divergence.
  PR #8 relue via HTML : DRAFT, base `arena/01a10c75-creatordeck`.
  CI/commentaires distants non vérifiés. Aucun audit complet rejoué.
- Correctif et SHA du code testé : `4b9fcca3b8e980fe5173535413d1a7bf036030a0`.
  [Commit](https://github.com/GoodFight37/CreatorDeck/commit/4b9fcca3b8e980fe5173535413d1a7bf036030a0).
  La cible de retour du focus est capturée dans le gestionnaire d'ouverture,
  avant le commit React qui désactive le bouton, puis transmise à PackTear et
  RevealOverlay. Le hook conserve son comportement habituel sans cible explicite.
  Les ouvertures Live et Scène partagent cette capture ; la variante OBS
  conserve la désactivation de la gestion du focus. Décision D-009.
- Cause prouvée dans Chromium : bouton focalisé avant clic, désactivé pendant
  la déchirure, focus sur BODY après fermeture. Le hook capturait trop tard
  `document.activeElement` ; la transition ne conservait pas le déclencheur.
- Contre-épreuve avant édition : `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  NEXT_TELEMETRY_DISABLED=1 npm run e2e -- --grep "the revealed card keeps"` :
  **code 1, 2/2 échecs**, bureau et téléphone à `e2e/pack-tear.spec.ts:46`.
- Même commande sur le correctif final : **code 0, 2/2 réussis**, 12,6 secondes.
  Le test existant conserve ses assertions de focus, inert, navigation Tab,
  dimensions et fermeture ; aucune assertion affaiblie, aucun nouveau test.
- `npm run ecrans -- src/ecrans.test.tsx src/ecrans-tactile.test.tsx --maxWorkers=2` :
  **code 0, 9/9 tests, 2 fichiers**. Rendus et haptique, pas un verdict visuel
  sur téléphone réel. `npm run typecheck` : code 0. ESLint direct sur les quatre
  fichiers produit modifiés : code 0, aucun diagnostic.
- Première version locale utilisait une ref lue pendant le rendu : E2E 2/2,
  mais lint refusé (`react-hooks/refs`, deux erreurs). Remplacée par un état
  React pour la cible transmise ; E2E/typecheck/lint relancés et réussis.
  Cette première version n'a jamais été commitée ou poussée.
- Dépendances et navigateurs verrouillés de la reprise précédente réutilisés ;
  aucun changement de branche/dépendances, aucun nouveau npm ci nécessaire.
  AGENTS.md retrouve son contenu commité après retrait du seul bloc Next auto.
  Logs locaux : `/tmp/creatordeck-focus/{before,after,screens}.log`.
- Fichiers : quatre fichiers produit, passation, problèmes, roadmap, décisions
  et journal. Commit documentaire à retrouver via
  `git log -1 --format=%H -- docs/agent-handoff.md`, puis comparer au distant.
  Publication à vérifier après push normal ; aucun merge ni modification de main.
- Limites : suite E2E complète et cloud simulé non rejoués dans cette correction ;
  leurs runs du checkpoint précédent restent historiques. Tests SQL/unitaires/
  build non rejoués. Le scénario E2E cible le booster Live ; pas de nouveau
  scénario Scène/OBS exécuté. Validation humaine Vercel/mobile et CI restent
  en attente, aucune production Supabase sollicitée.
- Prochaine étape : valider VIS-01 sur le preview Vercel correspondant au commit
  publié (geste, continuité, halo/Perfect, réduction d'animations), consulter la
  CI au bon SHA puis CLOUD-01 avec accès autorisé. K-010 est corrigé et vérifié
  automatiquement ; ces validations restantes ne sont pas déclarées terminées.

## Historique — E2E exécutés, 10 octobre 2026, 11 h 45 Europe/Paris

- Agent : Codex Cloud ; reprise courte demandée, réservation libérée.
- Branche `design/booster-reveal-polish`, code testé et HEAD distant vérifié :
  `c7c0f846838b26581052ef8df8d70e23b48fdafb`. Checkout initial propre sur
  `work` (ancien main), fetch design puis switch explicite ; aucun travail perdu.
  PR #8 relue via HTML : DRAFT, base `arena/01a10c75-creatordeck`.
  CI distante/commentaires non vérifiés ; aucun audit complet rejoué.
- `npm ci --cache /workspace/.npm --no-audit --no-fund` : code 0,
  602 paquets. Next 16.3.6 / Playwright 1.63.0 comparés au lock : identiques,
  manifeste et lockfile inchangés. Un essai Chromium lancé trop tôt pendant
  npm ci a échoué (SyntaxError sur fichier en cours d'installation) ; relancé
  seulement après la fin réussie de npm ci.
- `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node
  node_modules/@playwright/test/cli.js install chromium` : **code 0**.
  Chromium et Headless Shell 153.0.8010.12 / révision 1243, FFmpeg 1011 installés.
  K-008 résolu : les trois domaines et redirections sont accessibles.
- `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  NEXT_TELEMETRY_DISABLED=1 npm run e2e` : **code 1, 24 réussis,
  2 échoués, 2 ignorés, 28 scénarios listés**, 1,7 minute.
  Les échecs bureau/téléphone sont la même assertion de retour du focus après
  fermeture : `e2e/pack-tear.spec.ts:46`. Le bouton « Ouvrir le booster »
  reste inactif au sens du focus. K-010 ouvert ; cause non diagnostiquée.
  Déchirure, continuité géométrique avant fermeture, réduction des animations,
  navigation et persistance locale passent. Aucun correctif produit entrepris.
- Recette `.github/workflows/verification.yml` : `.env.local` temporaire avec
  URL `https://verification-test.supabase.co` et clé factice, puis même commande
  avec `-- --grep "avec le serveur"` : **code 0, 2/2 réussis**, 14,4 secondes.
  RPC interceptés par Playwright ; aucune preuve de production Supabase.
  Fichier factice supprimé après le run ; aucun fichier utilisateur remplacé.
- `next dev` a ajouté son bloc automatique dans AGENTS.md ; origine vérifiée
  dans `node_modules/next/dist/server/lib/generate-agent-files.js`, seul ce bloc
  retiré après arrêt du serveur. AGENTS retrouve son contenu commité.
- Rapports, captures et logs des deux runs préservés séparément sous
  `/tmp/creatordeck-e2e/{local-results,local-report,cloud-results,cloud-report}`,
  `local.log` et `cloud.log`. Artifacts locaux, non publiés.
- Fichiers du checkpoint : passation, problèmes, roadmap et journal.
  Publication à retrouver par `git log -1 --format=%H -- docs/agent-handoff.md`
  et à comparer au HEAD distant. Aucun merge ni modification de main.
- Prochaine action : diagnostiquer K-010 sur la branche vérifiée et rejouer
  `npm run e2e -- --grep "the revealed card keeps"` après correctif autorisé.
  Validation humaine Vercel/mobile et CI distante restent en attente ; suites
  unitaires/SQL/build historiques, non rejouées dans cette reprise.

## Historique — reprise réseau, 10 octobre 2026, 11 h 25 Europe/Paris

- Agent : Codex Cloud ; reprise courte, réservation libérée à la passation.
- Demande : l’utilisateur a ajouté `cdn.playwright.dev`, lancé la publication et
  demande de retester immédiatement. Objectif : installer Chromium puis jouer E2E.
- Base locale/distance propre et identique :
  `7126cd88884694c5cfabc0512507088b140208d9`, branche
  `design/booster-reveal-polish`. Pas de nouveau commit, aucun réaudit du jeu.
  PR #8 / base arena : dernier état vérifié dans le checkpoint précédent,
  pas de nouvelle lecture PR/CI dans cette reprise réseau.
- Réalisé : deux tentatives de `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  node node_modules/@playwright/test/cli.js install chromium`, code 1 (403).
  La première précédait la propagation ; ensuite HEAD sur le CDN répond 307.
- `curl -sS -I --max-time 15` sur l’URL Chromium du CDN : code 0, HTTP 307
  vers `https://storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/chrome-linux64.zip`.
  Même contrôle direct de cette destination : code 56, CONNECT 403.
- HEAD sur `https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-linux.zip` :
  code 0, HTTP 307 vers `playwright.download.prss.microsoft.com` ; HEAD direct
  sur cette destination : code 56, CONNECT 403. Révisions lues dans le
  `browsers.json` de Playwright verrouillé : Chromium 1243, FFmpeg 1011.
- Conclusion vérifiée : le premier domaine est désormais accessible ; les
  deux hôtes de redirection doivent aussi être autorisés. Aucun navigateur
  installé, aucun E2E exécuté ; pas de nouveau test unitaire/SQL/build.
- Lecture du brouillon lié à cette conversation : règle personnalisée
  `cdn.playwright.dev`, preset `package_managers`. Tentative de sauvegarder
  les trois domaines ci-dessous : **refus CONFLICT / stale_base**. La publication
  ou un changement a périmé sa version de base. Sauvegarde de cet ajout
  **non confirmée** ; ne pas relire/resoumettre le même brouillon en boucle.
- Proposition réseau complète (règles personnalisées ; conserver les presets
  et toute nouvelle règle utilisateur) : `cdn.playwright.dev`,
  `storage.googleapis.com`, `playwright.download.prss.microsoft.com`.
  Aucun script/secret/dépôt à modifier pour cette proposition.
- Action opérateur : dans l’éditeur de l’environnement **actuel**, conserver
  le premier domaine et ajouter les deux destinations, appuyer sur Entrée après
  chacune, Save puis Publish. Pas besoin de recréer l’environnement. Si un
  nouvel agent utilise les outils de brouillon, ouvrir une nouvelle session de
  configuration liée à la version actuelle et réconcilier avant toute écriture.
- Prochaine commande : retenter l’installation Chromium ci-dessus après
  activation, puis `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright
  npm run e2e`. Ensuite chemin cloud simulé selon le workflow. Vercel/mobile
  et production restent à valider, aucune fusion ni modification de main.
- Fichiers de cette reprise : uniquement `docs/agent-handoff.md` et
  `docs/known-issues.md`. Retrouver ce checkpoint par
  `git log -1 --format=%H -- docs/agent-handoff.md` et comparer à la tête distante.
  Publication Git à vérifier avant reprise, quota inconnu.

## Historique — correction K-007, 10 octobre 2026, 11 h 03 Europe/Paris

| Champ | Valeur |
|---|---|
| Dernier agent | Codex Cloud |
| Session / réservation | Correction SQL terminée ; réservation libérée à la remise de cette passation |
| Branche | `design/booster-reveal-polish` |
| Base de cette correction | `dedb03bed2b7442b2c841643cd06aace103ed4a6`, vérifiée identique au distant avant édition |
| Commit contenant le correctif et cette passation | Correctif `245742fb42972558a57cd57febd7dd7ba773f372` ; checkpoint documentaire : `git log -1 --format=%H -- docs/agent-handoff.md` |
| PR vérifiée à la reprise | [#8](https://github.com/GoodFight37/CreatorDeck/pull/8), DRAFT ; base `arena/01a10c75-creatordeck`, tête design |
| Publication | Correctif `245742fb42972558a57cd57febd7dd7ba773f372` poussé : SHA distant identique, les six fichiers relus au SHA depuis GitHub et comparés au commit ; retrouver puis vérifier le HEAD documentaire courant avant reprise |

### Demande, objectif et réalisation

L’utilisateur choisit Codex Cloud + GitHub + Vercel et demande de poursuivre
les priorités annoncées. Première étape réalisée : corriger K-007 sans changer
les règles du jeu. Le banc attendait toujours un refus du draft, même le samedi.
Il impose maintenant une fenêtre fermée puis ouverte sur le Postgres jetable.
La définition originale de `_arena_draft_open(timestamptz)` est sauvegardée avant
les overrides et restaurée dans `finally`, y compris si un appel lance une erreur.
Les contrôles calendaires à dates explicites et les vraies RPC sont conservés.
Aucun fichier produit, migration, dépendance ou lockfile n’est modifié.

Fichiers : `scripts/verify-supabase-migrations.mjs`, `docs/roadmap.md`,
`docs/agent-handoff.md`, `docs/decisions.md`, `docs/known-issues.md`,
`docs/historique-livraisons.md`. Décision D-008 ; K-007 corrigé ; QA-01 SQL
livré, navigateur/CI toujours incomplets. Les historiques ci-dessous sont conservés.

### Vérifications réellement exécutées

Node 24.19.0 ; Next 16.3.6 / Playwright 1.63.0 inchangés, dépendances du lock
réutilisées ; embedded-postgres 18.4.0-beta.17 / pg 8.23.1 disponibles.
Logs temporaires : `/tmp/creatordeck-arena/` ; cette synthèse est autonome.

| Commande / contrôle | Résultat |
|---|---|
| Status, ls-remote, fetch design explicite, lecture HTML de PR #8 | Checkout initial propre, distant/local `dedb03be` ; aucun nouveau commit, PR toujours DRAFT et base arena |
| `node --check scripts/verify-supabase-migrations.mjs` | Code 0 |
| `node node_modules/eslint/bin/eslint.js scripts/verify-supabase-migrations.mjs` | Code 0, aucun diagnostic |
| `npm run supabase:verify` | **Code 0, 559 contrôles réussis, 0 échec**, samedi 10 octobre ; fenêtres fermée/ouverte et restauration vérifiées, dates mercredi/samedi/dimanche/lundi contrôlées explicitement |
| `node /tmp/creatordeck-arena/negative-control.mjs` | **Code 1 attendu, 558 réussis / 1 échec**, précisément « arène · draft : hors du week-end, c’est refusé » ; restauration de la fenêtre réussie |
| `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node node_modules/@playwright/test/cli.js install chromium` | Code 1 : HTTP 403 « Domain forbidden », URL `https://cdn.playwright.dev/builds/cft/153.0.8010.12/linux64/chrome-linux64.zip` ; navigateur toujours absent |
| `git diff --check`, cohérence/liens des docs | Code 0 ; 22 liens relatifs vérifiés sans cible absente après correction du lien historique vers `ta-chaine.md`, ne prouvent pas le gameplay |

Contre-épreuve reproductible : copier le vérifieur hors dépôt, adapter ROOT vers
le checkout et rendre ses imports accessibles (symlink `node_modules` local).
Juste après la fixture `select false`, lire `pg_get_functiondef` de
`public.arena_draft_choices()` puis retirer uniquement le bloc
`if not public._arena_draft_open(now()) then … end if` et réinstaller cette
fonction sur la **base jetable**. Exécuter toute la copie et vérifier l’unique
échec et le code 1. La copie temporaire n’est pas commise ; migrations et runner
normal n’ont jamais reçu cette mutation. Il n’y a pas eu d’exécution avec
l’horloge machine avancée à un jour ouvré : l’indépendance vient des fixtures,
la règle calendaire est testée avec les dates explicites.

Le premier contrôle des liens a trouvé un ancien lien relatif cassé dans le
journal (`docs/ta-chaine.md` depuis `docs/`) ; il est corrigé vers `ta-chaine.md`,
puis le contrôle a passé. Aucun contenu historique supprimé.

Les suites unitaires/écrans/build/typecheck n’ont pas été rejouées pour ce
changement ciblé du runner SQL. Leurs résultats de l’audit précédent sont
historiques, pas de nouveaux runs. Aucun E2E exécuté ni CI distante confirmée.

### Incomplet, préférences et prochaine action exacte

- K-008 : téléchargement navigateur bloqué malgré une nouvelle tentative.
  Le brouillon Cloud a été lu : réseau restreint, aucune règle personnalisée,
  preset `package_managers`. Ajout du seul domaine `cdn.playwright.dev`
  enregistré par l’outil de configuration : `status: saved`,
  `requires_publish: true` ; autres champs et presets conservés.
  **Ce brouillon n’est pas activé/publié.** Dans les paramètres de
  l’environnement, revoir et enregistrer cet ajout puis publier l’environnement.
  Ensuite relancer la commande Chromium ci-dessus et `npm run e2e`.
  Pour le chemin cloud simulé, suivre `.github/workflows/verification.yml` ;
  aucune clé réelle nécessaire. Ne pas confondre ces mocks avec la production.
- Sur le preview Vercel correspondant au nouveau HEAD, faire valider au pouce
  VIS-01 (ouverture continue, dos puis faces, halos/Perfect, réduction des
  animations). Une appréciation utilisateur ne peut pas être inventée.
- Consulter les contrôles GitHub du commit poussé ; K-006/CI non vérifiés par
  cette session. Vérifier Supabase réel (CLOUD-01) uniquement avec accès autorisé.
- Préférences : GitHub référence, Cloud développement, Vercel essais ; pas de
  refonte générale, aucun merge/main, aucun changement de règle pour obtenir
  des tests verts. Le quota restant n’est pas connu.
- Avant toute reprise : lire AGENTS et ces quatre docs, vérifier status/HEAD,
  fetcher design et examiner tout nouveau commit. Puis reprendre le navigateur
  si son accès a changé ; sinon validation du preview Vercel et schéma distant
  autorisé. Aucun déploiement ou test de production n’est affirmé ici.

## Historique — audit documentaire du 10 octobre 2026

### Checkpoint antérieur — 10 octobre 2026, 10 h 48, Europe/Paris

| Champ | Valeur |
|---|---|
| Dernier agent | Codex Cloud |
| Session / réservation | Audit documentaire terminé ; réservation libérée à la remise de cette passation |
| Branche de travail | `design/booster-reveal-polish` |
| SHA du code audité | `4955d9bbd489777c6ffd74229613075a332cc9e9` |
| Commit contenant cette passation | `git log -1 --format=%H -- docs/agent-handoff.md` ; le SHA de code ci-dessus est la base, pas le futur commit documentaire |
| PR | [#8](https://github.com/GoodFight37/CreatorDeck/pull/8), brouillon, titre « Polish lumineux des ouvertures de boosters et révélations » |
| Base de la PR constatée | `arena/01a10c75-creatordeck`, SHA `6c46e4bec37dc91a32f368b586e59ce109a44784` |
| main constaté | `ae5016f093c977e68943d92f5a7c3da17bca8021`, aucune modification autorisée |
| Publication | Checkpoint initial `beb1261a0f17a1b384f302ef2d3c685a7ae2b945` poussé et cinq contenus relus sur GitHub ; retrouver le commit du complément courant avec la commande ci-dessus et vérifier la tête distante avant reprise |

## Demande et objectif compris

L'utilisateur demande une coordination permanente entre Codex Cloud, Codex PC
et ChatGPT, indépendante de la conversation : audit réel, roadmap, passation,
décisions, bugs, règles pour protéger les branches et sauvegardes régulières
avant interruption/quota, puis commit et push GitHub. Ne pas réécrire le jeu.
La reprise doit fonctionner même si Codex devient indisponible.

## Réalisé

- Checkout initial propre sur `work` au SHA de main ; branches distantes et refs
  `refs/pull/8/{head,merge}` consultées. La branche de travail et la tête de PR
  pointaient sur `4955d9b`. PR lue depuis la page GitHub (données embarquées) :
  état DRAFT, non fermée/non fusionnée, base arena, 112 commits dans la PR.
- `gh pr view … --json …` et REST `api.github.com/repos/…/pulls/8` refusés (403).
  Cela ne bloque pas les lectures Git HTTPS ni la page GitHub. Aucun statut CI
  ou déploiement déduit de l'existence d'un workflow.
- Fetch explicite des références design et arena ; checkout aligné proprement
  sur design. Le clone ne suivait initialement que main ; la configuration
  locale de fetch/upstream design a été ajoutée. Un essai de switch avec
  tracking a échoué après avoir rempli l'index ; corrigé avec `--no-track`,
  vérification de HEAD et retour à un status propre. Ce n'était pas un changement
  de l'application ni une bascule automatique prouvée.
- Documents existants lus : périmètre, roadmap, journal, revue externe,
  dossier d'atelier, README, CI, scripts et composants du chantier.
- Cinq documents de coordination préparés ; roadmap antérieure conservée.
- Premier checkpoint commité et poussé, SHA distant égal au local ; les cinq
  fichiers téléchargés depuis GitHub au SHA `beb1261a` sont identiques au commit.
  Compléments d'audit enregistrés dans une seconde révision documentaire.
  Aucun merge, aucune modification de main/arena ou de fichiers d'application.
- Suites actuelles exécutées, défaut de test SQL K-007 et obstacle navigateur
  K-008 documentés ; l'ancien bug SQL du main est déjà corrigé sur design.

## État du projet et chantier

Application Android/Web Next.js exportée, React, Capacitor, Supabase. Le mode
sans cloud est un **mode dev/test**, pas le produit distribué. Les fonctionnalités
multijoueurs et l'économie vont bien au-delà de l'ancien main : 42 migrations,
échanges, hôtel, amis/Last Pack, arène, jetons, direct/notifications et Tribunal.
La simulation de streameur est retirée de l'interface.

Derniers commits du code : `4955d9b` unifie ouverture/révélation dans une scène,
`c7a9263` corrige chevauchement des labels et portabilité des tests Windows,
`beadb63` supprime les styles du canvas WebGL retiré. La PR développe un sachet
imprimé (microphone plutôt que chevron refusé), une soudure tactile, cinq dos
avant les faces et un fallback clairement indiqué pour DIVERRON.

Repères d'architecture : coque/vues dans `src/components/` ;
`src/hooks/use-pack-opening.ts` arbitre serveur/appareil ;
`src/lib/{game-engine,save-store,game-store,reveal}.ts` porte moteur, sauvegarde et
présentation ; `src/lib/cloud/{api,store}/` sépare les domaines réseau ;
`src/data/` porte catalogue/taux/économie ; migrations `0001` à `0042` et
`supabase/functions/` portent SQL et fonctions Edge. `/overlay` présente les
tirages dans OBS. Tests `.test.ts`, `.test.tsx`, SQL et `e2e/` : runners distincts.

## Fichiers concernés

Cette mission : `AGENTS.md`, `docs/roadmap.md`, `docs/agent-handoff.md`,
`docs/decisions.md`, `docs/known-issues.md`. Aucun composant, migration, manifeste
ou lockfile ne doit être modifié par cette mission documentaire.

Pour reprendre la mise en scène : `src/components/{pack-tear,reveal-overlay,
creator-deck-app,drop-view,overlay-stage}.tsx`, `src/hooks/use-presentation-focus.ts`,
`src/app/{booster-continuity,booster-premium,reveal-premium}.css`,
`src/lib/reveal.ts`, `public/packs/`, les suites `src/ecrans*.test.tsx` et `e2e/`.

## Commandes et résultats de l'audit

Code testé : `4955d9bbd489777c6ffd74229613075a332cc9e9`, dans le checkpoint
documentaire `beb1261a` (aucun changement d'application entre les deux).
Node 24.19.0, npm 11.9.0. Logs locaux : `/tmp/creatordeck-coordination/`,
temporaires et non publiés ; les résultats autonomes sont ci-dessous.
Les 181 tests de l'ancien main ne prouvent rien pour cette branche.

| Commande | Résultat réellement observé |
|---|---|
| Lectures Git, fetch explicite design/arena, lecture HTML PR #8 | Succès ; état et SHAs en tête de ce document |
| `gh pr view 8 --repo GoodFight37/CreatorDeck --json …`, REST `/pulls/8` | Refus 403 ; CI et déploiement non vérifiés |
| `npm ci --cache /workspace/.npm --no-audit --no-fund` | Succès, 602 paquets ; lockfile inchangé |
| Premier `npm_config_package_lock=false npm_config_cache=/workspace/.npm npm run dev:setup` | Installe les vérificateurs SQL mais fait flotter Next 16.4.0/Playwright 1.64.0 ; premiers tests non attribués au lock (K-009) |
| Correction : `npm ci …` puis `npm_config_cache=/workspace/.npm npm run dev:setup` sans désactiver le lock | Succès ; Next 16.3.6, React 19.2.6, Vitest 3.2.7, Playwright 1.63.0, eslint-config-next 16.3.6 comparés au lock : identiques |
| `npm test -- --maxWorkers=2` après correction | Code 0 ; **1 080 tests, 69 fichiers réussis** |
| `npm run ecrans -- --maxWorkers=2` après correction | Code 0 ; **69 tests, 13 fichiers réussis** ; jsdom/DOM, pas un essai visuel sur téléphone |
| `npm run supabase:verify` | Code 1 ; **559 contrôles exécutés : 558 réussis, 1 échec** arène hors week-end ; Postgres jetable, aucune base distante touchée |
| `npm run lint -- --ignore-pattern 'android/**/build/**'` après correction | Code 0 ; **0 erreur, 1 avertissement** de navigation dans un chunk Android généré localement (hors code édité) |
| `node scripts/check-jargon.mjs` | Code 0 ; aucun jargon d'infrastructure dans les textes affichés |
| `npm run catalog:ci` | Code 0 ; catalogue/portraits/SQL catalogue et saisons cohérents |
| `npm run build` après correction | Code 0 ; export `/`, `/_not-found`, `/overlay` ; avertissement attendu : variables publiques cloud absentes, build de test sans cloud |
| `npm run typecheck` après le build verrouillé | Code 0 |
| `node node_modules/@playwright/test/cli.js test --list` | Code 0 ; **28 tests listés, 3 fichiers**, aucune exécution E2E |
| `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node node_modules/@playwright/test/cli.js install chromium` avec Playwright verrouillé | Code 1 ; Chrome 153.0.8010.12 / build 1243 refusé, HTTP 403 « Domain forbidden » sur `cdn.playwright.dev` ; E2E non exécutés |
| `git diff --check`, liens relatifs des cinq docs, comparaison du contenu GitHub | Vérification documentaire avant publication ; pas une preuve du gameplay |

Les premiers passages unitaires/écrans avaient aussi passé sous Next 16.4.0,
mais les runs après remise au lock sont les preuves retenues. Le vérifieur SQL
n'utilise pas Next/Playwright ; son échec a été diagnostiqué dans le script et
le SQL, pas masqué par un nouveau run à une autre date. Aucune assertion supprimée.

## Incomplet / erreurs / points de vigilance

Statut CI et déploiement courant, E2E et validation humaine des animations
restent à établir. Aucun accès de production Supabase n'est utilisé.
K-007 est un **défaut du banc** : le 10 octobre à 08 h 43 UTC, samedi après
6 h UTC, `arena_draft_choices()` est autorisé par le produit, mais le script
ligne 4600 attend toujours un refus. Ne pas changer la règle week-end pour du
vert. Voir [problèmes](known-issues.md).
L'erreur `unnest()` de l'ancien checkout est corrigée dans le code design ;
ne pas la diagnostiquer à nouveau à partir de l'ancienne conversation.

## Prochaines actions exactes

1. Lire AGENTS et les quatre documents, exécuter `git status --short`,
   `git branch --show-current`, `git rev-parse HEAD`, puis
   `git ls-remote origin refs/heads/design/booster-reveal-polish` et fetcher cette
   référence explicite. Examiner tout commit poussé depuis cette passation.
2. Sur une branche vérifiée, corriger uniquement K-007 dans
   `scripts/verify-supabase-migrations.mjs` autour de la ligne 4600 : scénario
   hors week-end déterministe, override SQL restaurée dans un `finally`,
   contrôles à dates explicites conservés. Lancer `npm run supabase:verify`,
   obtenir **559 contrôles sans échec** et prouver que le test hors week-end
   échoue si la règle est volontairement violée sur la base jetable.
3. Autoriser le téléchargement Chromium (paramètres réseau :
   `cdn.playwright.dev`), installer le navigateur du lock et lancer
   `npm run e2e`. Distinguer scénarios locaux et cloud simulés (recette dans
   `.github/workflows/verification.yml`) ; consulter la CI du bon SHA.
4. Faire valider VIS-01 au pouce (scène, timings, halos, Perfect, réduction
   d'animations), puis vérifier le projet Supabase autorisé via
   `schema_versions()` et ses parcours avant toute modification de production.

Mettre à jour les quatre documents et faire un checkpoint. Ne pas fusionner
la PR ni toucher main. La coordination est livrée ; ces priorités de
développement/validation **ne sont pas terminées**.

## Préférences et décisions

Échanges en français ; téléphone d'abord ; conserver les refus historiques ;
un seul écrivain par branche ; aucune fusion automatique ; observations et
avis séparés. Le quota restant n'est pas connu par l'agent : ne pas en inventer
une estimation. Sauvegarder ce document après chaque étape importante.

## Modèle pour les prochaines passations

Ajouter une entrée datée dans le journal ci-dessous et remplacer le checkpoint
courant : agent/réservation, demande/objectifs, réalisé/incomplet, fichiers,
commandes + résultats + SHAs, erreurs, décisions/préférences, risques,
prochaine action exécutable, branche/commit/PR, état réel de publication.
Libérer la réservation en fin de session ; ne pas marquer terminé un travail
qui reste bloqué. Le prochain agent vérifie GitHub avant d'agir.

## Journal des passations

- 2026-10-10 — Codex Cloud : initialisation documentaire sur le code `4955d9b` ;
  historique conservé. Checkpoint `beb1261a` poussé, SHA et cinq contenus
  GitHub vérifiés ; aucun fichier d'application modifié.
- 2026-10-10, 10 h 48 Europe/Paris — Codex Cloud : complément d'audit, versions
  remises au lock, 1 080 unitaires / 69 écrans réussis, 558/559 contrôles SQL,
  statique/build réussis ; E2E bloqués. K-007/008/009 ajoutés, réservation libérée.

## Liens pour reprendre sans cette conversation

- [Branche](https://github.com/GoodFight37/CreatorDeck/tree/design/booster-reveal-polish)
- [PR #8](https://github.com/GoodFight37/CreatorDeck/pull/8)
- [Code audité](https://github.com/GoodFight37/CreatorDeck/commit/4955d9bbd489777c6ffd74229613075a332cc9e9)
- [Checkpoint initial](https://github.com/GoodFight37/CreatorDeck/commit/beb1261a0f17a1b384f302ef2d3c685a7ae2b945)
- [Règles](../AGENTS.md), [roadmap](roadmap.md), [décisions](decisions.md), [problèmes](known-issues.md)

## Synchronisation de la base de la PR #8 — 10 octobre 2026

La PR #8 cible toujours `arena/01a10c75-creatordeck`, base choisie à sa création le 9 octobre (SHA initial `6fd966eb`). Cette branche a depuis avancé de quatre commits jusqu'à `6c46e4b`, ce qui rendait la PR non fusionnable. Les quatre commits ont été intégrés à `design/booster-reveal-polish` par une fusion normale ; le seul conflit était `AGENTS.md`, résolu en gardant la version de coordination plus récente déjà présente sur la branche de travail. Les changements de la base (notamment le retrait des cinq sons inutilisés de la simulation de streameur) sont conservés. Aucun changement à `main`, aucune fusion de la PR ni accès à Supabase de production.


## Chantier tutoriel, remise à zéro et cadeau — checkpoint local, 10 octobre 2026

- Cette session Cloud a repris sur `main`, propre avant modification, `HEAD=aa35227872cbec094b7509b28b7f3139814eb3d4`. `origin/main` était au même SHA lors du contrôle initial. Aucun changement existant n'a été écrasé. Le code est commité localement au SHA `f97ea42` ; la mise à jour documentaire de ce checkpoint reste à commiter séparément. Aucun push, PR, merge, suppression de branche, accès ou changement Supabase de production, ni déploiement n'a eu lieu.
- Implémentation locale : tutoriel en trois écrans, mémoire locale et RPC de fin pour compte connecté ; carte cadeau séparée et disponible après tutoriel ; API/store et RPC serveur pour réclamer et tirer jusqu'à cinq boosters serveur, indépendants de la réserve normale ; CTA de fin « Retour au Drop ». Les cinq boosters insèrent les cartes avec provenance cadeau, sans récompenser XP/points/jetons ni entamer la réserve normale. La réserve cadeau reste distincte et s'épuise ouverture par ouverture.
- Migration additive `0044_tutoriel_reset_cadeau.sql` : reset one-shot protégé par marqueur transactionnel ; provisionne cinq boosters par compte existant ; conserve utilisateurs, profil/identité, amis et historiques terminés ; annule les trades `open`, retire les annonces `open`, remet les compteurs/sauvegardes/ressources de progression à leurs valeurs de départ. Le tirage cadeau passe par les fonctions SQL de tirage/poids/garantie existantes, reste séparé du pity et du Last Pack normaux, et n'est pas payé par les triggers économiques. La commande SQL a été exercée sur PostgreSQL jetable local uniquement.
- Résultats vérifiés : `npm test` réussi **71 fichiers / 1 109 tests** (rerun local autorisé après les limites sandbox Git/processus) ; `npm run ecrans` réussi **13 fichiers / 73 tests** ; `npm run typecheck` code 0 ; `npm run lint` code 0 ; `npm run supabase:verify` réussi, journal final « Toutes les vérifications passent », y compris reset/preservation, migration idempotente, ordre tutoriel→cadeau, message exact, claim unique et 5×5 cartes sans paiement/réserve normale. `XDG_CONFIG_HOME=/tmp/creatordeck-xdg npm run build -- --webpack` réussi : compilation webpack/TS, export statique (`/`, `/_not-found`, `/overlay`). Build produit sans variables cloud ; aucun secret n'a été lu.
- La commande `npm run build` par défaut (Turbopack) a échoué dans ce Cloud à `creating new process / binding to a port / Operation not permitted`. Le build webpack a abouti, sans modifier la config du projet. Aucune validation sur téléphone réel n'a été faite ; les tests d'écran sont DOM/écran simulés. Pas d'E2E Playwright ajouté ou exécuté pour ce lot.
- Avant toute vraie application de 0044, **arrêt obligatoire** : confirmer le projet Supabase cible, lire le schéma courant et prouver une sauvegarde récupérable ; si un de ces éléments est incertain, ne pas appliquer. L'utilisateur a interdit le toucher production et le déploiement automatique dans cette étape ; cette interdiction reste active.


## Reprise accès Supabase — 11 octobre 2026

- Code et documentation précédents poussés sur `main` : `f97ea42` puis `30490b4`. Le HEAD GitHub `30490b4064b6cc2169b64b053d6a4e782661d7d3` a été vérifié par `git ls-remote` dans cette reprise. Checkout initialement propre. Aucune PR fusionnée ni branche supprimée.
- Malik autorise désormais l'application réelle du reset ; la condition de vérifier cible, schéma et sauvegarde récupérable reste active. Aucune migration réelle exécutée par cette session ; l'état actuel de production n'est pas vérifié.
- Tests réseau concrets : les deux destinations Supabase refusées par le proxy, HTTP CONNECT 403, curl 56. Aucun accès de gestion prêt. Brouillon configuré et lisible, mais non publié ; liste des environnements en erreur sur le navigateur mobile. Aucun outil disponible pour publier ou envoyer un ticket de support.
- Voie indépendante de cette interface : tableau de bord Supabase sur téléphone, avec requête SQL de lecture seulement et vérification des sauvegardes. Voir [le guide d'accès](supabase-reset-access.md). Les outils Cloud ne peuvent pas obtenir des identifiants depuis le PC éteint ni contourner la politique du proxy.
- Préparation avant application : défaut détecté dans 0044, qui remplaçait `_save_add_pack_cards` en supprimant la synchronisation des compteurs ordinaires. Correction par helper cadeau séparé `_save_add_gift_cards`, sans droits d'exécution clients. Contrôles SQL de conservation du helper normal et de ses droits ajoutés. Validation du 11 octobre : `XDG_CONFIG_HOME=/tmp/creatordeck-xdg npm test` code 0, 71 fichiers / 1 109 tests ; `npm run supabase:verify` code 0, « Toutes les vérifications passent », dont les deux nouveaux contrôles. Pas de changement UI/TS, ni nouveau build ou essai téléphone pour ce correctif SQL.
