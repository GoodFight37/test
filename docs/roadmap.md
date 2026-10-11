## Automatisation Supabase — 11 octobre 2026

Préparée/testée localement : workflow après CI verte, plan protégé, historique standard Supabase, secret GitHub isolé. **Connexion réelle à valider** : historique 0001–0046 enregistré après preuves et secret GitHub ajouté selon retour opérateur ; lancer le contrôle manuel dry_run après CI verte. Aucun SQL/déploiement réel exécuté. Vercel indépendant, ordre de publication non contrôlé. [Procédure](mises-a-jour-automatiques.md).

## Rejouer le tutoriel — 11 octobre 2026

Implémenté et testé localement : reset individuel rejoue les trois étapes puis rend le cadeau restant accessible, sans recrédit. Nouvelle migration 0046 et client nécessaires ; production/validation téléphone attendues. 0045 est déjà active d'après le contrôle transmis par Malik, quatre cadeaux subsistent sur le compte testé. Critère restant : nouveau build + 0046, puis parcours réel Toi → reset → tutoriel → message → ouverture des quatre cadeaux. Voir la passation pour commandes/résultats.

## Chantier livré localement — tutoriel, reset global, cadeau — 10 octobre 2026

## Suivi production — bug d'ouverture du cadeau — 11 octobre 2026

Malik a appliqué 0043 puis 0044 dans le SQL Editor Supabase. Le résultat de contrôle partagé confirme le marqueur, 16 lignes tutoriel, 16 cadeaux et zéro tirage/carte/échange en attente/annonce active. En jeu, après le premier claim et l'ouverture d'un booster, les quatre ouvertures restantes échouent car le client rappelle le RPC de claim à chaque clic. Cause prouvée dans `creator-deck-app.tsx` et `claim_return_gift()`.

- [x] Migration additive 0045 : claim rejouable sans recrédit, statut `gift_claimed` exact ; tests API et SQL réussis sur Postgres jetable. Application de 0045 en production en attente.
- [x] Client : après le premier claim, afficher « Ouvrir un booster cadeau · N restants » et ouvrir directement ; `npm test` 1 109/1 109 et `npm run ecrans` 73/73.
- [x] Code poussé sur `main` au commit `9710baf` et SHA distant vérifié. Statut Vercel non vérifié.
- [ ] Appliquer 0045 dans Supabase puis vérifier le claim avec quatre boosters restants. Pas de validation téléphone supplémentaire pour cette correction.

Le code et les vérifications détaillées sont dans la passation. Aucun autre taux, récompense ou règle de tirage n'est modifié.

Code `f97ea42` et checkpoint `30490b4` poussés sur `main`. Migration additive `0044_tutoriel_reset_cadeau.sql`, tutoriel trois étapes et sauvegarde serveur, cadeau de 5 tirages distincts disponible après tutoriel, tirage serveur existant, CTA « Retour au Drop ».

- [x] Reset global one-shot : identifiants, profils, amis et historiques conclus conservés ; trades en attente annulés, annonces actives retirées, progression/réserves remises au départ ; cadeau préprovisionné pour chaque compte existant.
- [x] Tests API/UI/SQL : ordre tutoriel puis cadeau, message exact, claim unique, cinq ouvertures de cinq cartes et absence de débit réserve/paiements ; données préservées et migration rejouée sans écraser progression ultérieure.
- [x] Validations locales : `npm test` 71 fichiers/1 109 tests ; `npm run ecrans` 13 fichiers/73 tests ; typecheck, lint, build webpack, et `npm run supabase:verify` tous verts. Le build Turbopack standard ne fonctionne pas dans le Cloud restreint (port local refusé) ; `npm run build -- --webpack` réussit. Aucun téléphone réel ni E2E navigateur pour ce lot.
- [x] Code et checkpoint poussés sur `main` ; aucune PR fusionnée ou branche supprimée.
- [ ] Application réelle désormais autorisée par Malik, toujours sous condition de vérifier cible, schéma et sauvegarde récupérable. Accès Cloud bloqué CONNECT 403 ; alternative via tableau de bord Supabase et contrôle en lecture dans [le guide](supabase-reset-access.md). Aucun reset exécuté par cette session.
- [x] Correctif K-018 avant application : helper cadeau séparé, helper ordinaire préservé. Suite projet 1 109 tests et SQL jetable réussis le 11 octobre.

Résultats et limites exacts dans [la passation](agent-handoff.md), choix dans [les décisions](decisions.md), risque de procédure dans [les problèmes connus](known-issues.md).

## État courant après consolidation — 10 octobre 2026

- GitHub ne contient plus qu'une branche, `main`, actuellement au commit `2c9b6c4ae98898711bb6041c2297b17ac2a1a312`. La PR #7 est intégrée ; la PR #8 est fermée car devenue obsolète.
- Le correctif du Paquet Scène est intégré : tests ciblés 35/35 et vérification des migrations 0001–0043 sur PostgreSQL jetable sous WSL, avec 559 contrôles réussis selon les résultats consignés. Aucun accès ni changement en production.
- L'audit du moteur local a terminé 12 000 trajectoires (12 scénarios × 1 000), graine `20261010`, sans paquet manquant. Il mesure le moteur TypeScript local ; il ne constitue pas une simulation de la progression côté Supabase.
- Sur l'arbre de code du commit `53e6127d21a8e5d5ec173bfbe1b29e79d5f097c0`, les tests projet (70 fichiers, 1 104 tests), typecheck et build ont réussi ; le commit de consolidation `2c9b6c4` conserve le même arbre de code. Le contrôle Vercel de `2c9b6c4` est vert. Le workflow GitHub Actions #258 du commit `ecfe17a` a réussi : ses quatre jobs (qualité/build, E2E, SQL jetable et cloud simulé) sont verts.
- Les anciennes notes ci-dessous sont conservées comme historique ; les priorités actives plus bas sont la référence pour la suite.

## Parite Scene Supabase - validation locale terminee, 10 octobre 2026

- [x] Migration 0043 corrigee : cinq cartes distinctes, sans Legendaire, candidats garantis reserves et petites familles completees.
- [x] Tests cibles : 35/35.
- [x] PostgreSQL jetable sous WSL : migrations 0001-0043 rejouees, tous les controles passent, y compris les familles a peu ou zero Epique et le refus des familles incompatibles.
- [x] Aucun acces a Supabase production, aucun secret, aucun merge ni changement de main.
- [x] Correctifs de fixture et documentation commit/push sur la branche ; aucun merge ni changement de production.

## Audit Scène validé — 10 octobre 2026

Sur le commit `7da3d1c`, les 1 000 trajectoires par scénario ont terminé : 12 scénarios, 12 000 trajectoires, graine `20261010`, zéro paquet manquant. Résumé et limites : [audit-progression.md](audit-progression.md). Cet audit de progression valide uniquement le moteur TypeScript local. **À distinguer de la parité Paquet Scène**, vérifiée ensuite dans une base PostgreSQL jetable après la migration 0043.

## Chantier visuel — ouverture de boosters, 10 octobre 2026

- [x] Donner du volume CSS au sachet d’accueil et à PackTear, incliner l’objet sous le doigt, et animer son foil sans WebGL.
- [x] Plier les flaps avec une fente lumineuse et extraire les cinq dos en cascade sous une seconde ; garder le relais existant de 1,9 s.
- [x] Augmenter la présence de la carte plein écran et distinguer les raretés : entrée discrète pour les Communes, punch et halo bordeaux dès Rare, intensité croissante pour Épique/Légendaire.
- [x] Rendre la déchirure plus longue et texturée. Conserver les timings du silence Épique, du verrou Perfect et du bang sur le flip.
- [x] Tester Reflets désactivés / mouvement réduit : inclinaison tactile, specular, foil et animation lourde coupés. Typecheck, build et tests UI 70/70 réussis.
- [ ] E2E bureau 11/11 a passé avant le dernier ajustement de pose CSS ; le test ciblé après cet ajustement est resté suspendu au serveur Playwright local. À relancer avec le prochain parcours navigateur.
- [ ] Confirmer le rendu et le geste sur téléphone réel (VIS-01). La suite générale signale quatre tests SQL/catalogue désynchronisés, hors de ce chantier ; aucune migration Supabase n’a été touchée. Le déploiement Vercel prêt pour `main` est une prévisualisation ; Production pointe toujours vers `arena/01a10c75-creatordeck`.

# Roadmap CreatorDeck

## Checkpoint UX — 10 octobre 2026, deux passes

Deux lots UX sont publiés sur `main` : première boucle au commit [`1769636`](https://github.com/GoodFight37/CreatorDeck/commit/1769636dab8069486f64dff3ed81404eb0e86bb6), puis démarrage collection au commit [`09487de`](https://github.com/GoodFight37/CreatorDeck/commit/09487de). Le Binder ouvre sur les cartes obtenues, l’état vide invite à ouvrir un booster et laisse le catalogue accessible à la demande ; les pages de catalogue sont limitées à 12 cartes. La révélation se termine par un récapitulatif des cinq cartes, du nombre de nouvelles et une réouverture directe si la réserve le permet. Son/reflets sont actifs sans préférence enregistrée ; un choix OFF persistant reste respecté. L’Atelier cache ses listes avant dix copies recyclables, Toi met en avant les trois meilleures cartes possédées et la série, et Drop montre une mission existante. Aucune récompense ni règle d’économie n’a changé.

L’avis sur téléphone réel reste à recueillir.

Validation locale après la deuxième passe : écrans **72/72**, typecheck, lint
et build réussis ; contrôles ciblés après la dernière assertion **13/13**.
`npm test` complet : **1102/1106**, avec quatre échecs préexistants de
génération/synchronisation catalogue et saisons et de comptage SQL (`supabase-profil`).
`npm run catalog:ci` échoue aussi parce que `0003_catalogue.sql` est dérivé de
`creators.json`. Ces échecs sont hors périmètre UX et restent à corriger dans
un lot de cohérence données/migrations. La prévisualisation Vercel du commit
`427229f` est `READY` (`target: null`, alias `creator-deckk-git-main-hafsi37-2386.vercel.app`)
et son contrôle combiné est vert ; ce n’est pas Production. L’outil Actions n’a
retourné aucun run associé et n’établit donc pas l’état des workflows GitHub.
Aucun accès à Supabase de production. Le prochain lot produit à cadrer
porte sur l’entrée sociale visible, les badges/avatars et la cohérence visuelle
des portraits ; l’état de la configuration des rappels doit être vérifié avant
tout nouveau push. La validation sur téléphone reste ouverte.

## Identifiant de build — 10 octobre 2026

Le profil Toi affiche une version courte issue du SHA Git de la compilation.
Le commit applicatif `152c217` a passé les tests d’écran et de formatage, le
typecheck, le lint et le build ; le bundle local contient ce SHA. Vercel et les
Actions GitHub restent à vérifier sur la tête poussée avant de confirmer que la
version affichée sur le preview est celle attendue.

## Audit produit — progression et économie (10 octobre 2026, première passe)
### Exécution réelle du bilan local — résultats transmis le 10 octobre 2026

L'utilisateur a exécuté avec succès `npm run progression:bilan` sous Windows, depuis son clone local. **Une trajectoire aléatoire par profil**, sans seed et sans vérification cloud ; ces résultats ne sont pas des moyennes.

| Profil | Durée | Live | Scène | Uniques | Recyclées | Points recyclage | Craft | Jetons achetés | Points restants | Sabliers restants |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Occasionnel | 7 j | 14 | 7 | 96 | 13 | 572 | 4 | 0 | 223 | 41 |
| Régulier | 7 j | 42 | 7 | 224 | 28 | 1 027 | 7 | 0 | 605 | 62 |
| Intensif | 7 j | 84 | 7 | 373 | 90 | 4 588 | 7 | 1 | 5 158 | 87 |
| Occasionnel | 30 j | 60 | 30 | 301 | 177 | 10 579 | 27 | 1 | 170 | 140 |
| Régulier | 30 j | 180 | 30 | 627 | 449 | 22 303 | 30 | 2 | 12 855 | 221 |
| Intensif | 30 j | 360 | 30 | 848 | 1 122 | 59 542 | 30 | 5 | 53 365 | 323 |

**Observations, non décisions d'équilibrage :** forte accumulation de points chez le joueur intensif, sabliers non consommés dans le scénario, progression rapide vers 85 % du catalogue en 30 jours pour le profil intensif. La stratégie de simulation fabrique au plus une carte par jour, et les horaires du modèle ne reflètent pas une distribution réelle d'utilisateurs. Faire des simulations multi-seeds et tester une stratégie de dépense plus réaliste avant tout changement de paramètres.

### Audit avec le moteur réel — outil ajouté le 10 octobre 2026

- [x] Script `scripts/progression-bilan.ts` ajouté et commande `npm run progression:bilan` exposée dans `package.json` ; branche `design/booster-reveal-polish`.
- [x] **Exécuter** la commande sur un clone installé : succès confirmé par la sortie PowerShell fournie par l'utilisateur. Les résultats restent non reproductibles sans seed.
- [x] Répétition statistique et métriques reproductibles — terminées : 1 000 simulations par scénario, 12 scénarios, graine `20261010`, 12 000 trajectoires et zéro paquet manquant ; résultats dans [l'audit](audit-progression.md).
- [ ] Vérifier la parité des gains et de la sauvegarde avec Supabase sur un projet de test autorisé ; ne pas appliquer de migration en production sans validation.
- [x] Tester les échanges et l'hôtel des ventes avec plusieurs comptes de test sur PostgreSQL jetable — contrôles couverts par `supabase:verify`, 559/559 réussis et workflow Actions #260 vert ; aucune base de production utilisée.

**Couverture du script :** trois profils de 2, 6 et 12 ouvertures Live par jour sur 7 et 30 jours ; une Scène quotidienne, recyclage groupé hors Live, réclamation des missions/jalons/saisons, achat d'une carte Épique aux jetons et Craft d'une Rare ou Épique si possible. Les tirages ne sont pas seedés, donc une exécution produit six trajectoires aléatoires et non une distribution statistique. Le profil simule des visites fixes, sans dépenses de sabliers ni échanges. Les heures sont en UTC et le bonus Prime Time dépend du fuseau de l'environnement d'exécution. **Aucun chiffre du script n'est encore vérifié.**

**Problèmes à investiguer :** la mission « recycle un doublon » peut être impossible le premier jour selon le tirage ; la rentabilité du Craft en fin de collection doit être mesurée ; les variantes Live sont exclues du recyclage groupé ; les achats ciblés en jetons et le Craft utilisent des cartes Standard ; les gains en cloud ont une autorité différente du local. Les anciennes estimations Monte-Carlo indépendantes ne tiennent pas compte de ces nuances et ne doivent pas servir seules à modifier l'équilibrage.


### Scénarios quantitatifs simplifiés — 10 octobre 2026
### Monte-Carlo indépendant — collection et doublons (10 octobre 2026)

**Méthode :** 1 000 parties indépendantes pour chaque couple (2, 6, 12 Live Drop par jour) × (7, 30 jours), graine pseudo-aléatoire déterministe par partie. Reprise des cinq tables de rareté Live de `src/data/pull-rates.json`, du Perfect Live (1‰, 82 % Épique / 18 % Légendaire), de la garantie Légendaire au 12ᵉ booster sans Légendaire, et des effectifs actuels du catalogue (300 Communes, 300 Peu communes, 230 Rares, 120 Épiques, 50 Légendaires). Choix uniforme d'un créateur à l'intérieur de sa rareté. Chaque carte est « nouvelle » si le créateur n'a jamais été tiré ; sinon elle est comptée comme doublon et sa valeur de recyclage est additionnée à titre **potentiel**, pas comme crédit effectif.

| Profil | Durée | Live | Créateurs distincts (moyenne) | Doublons (moyenne) | Points de recyclage potentiels (moyenne) | Boosters avec Légendaire (moyenne) |
|---|---:|---:|---:|---:|---:|---:|
| Occasionnel, 2/j | 7 j | 14 | 67,4 | 2,6 | 131,5 | 1,9 |
| Occasionnel, 2/j | 30 j | 60 | 257,4 | 42,6 | 2 173,4 | 8,7 |
| Régulier, 6/j | 7 j | 42 | 188,6 | 21,4 | 1 083,1 | 6,0 |
| Régulier, 6/j | 30 j | 180 | 584,7 | 315,3 | 16 100,6 | 26,7 |
| Intensif, 12/j | 7 j | 84 | 339,6 | 80,4 | 4 099,3 | 12,3 |
| Intensif, 12/j | 30 j | 360 | 820,7 | 979,3 | 49 974,3 | 53,6 |

**Interprétation prudente :** l'accumulation de doublons s'accélère fortement après plusieurs centaines de tirages ; le Craft, les jetons et les échanges sont donc cruciaux. Les valeurs de recyclage supposent que chaque doublon de créateur puisse être recyclé, **ce qui ne reproduit pas exactement la règle réelle** : le moteur distingue les variantes (Standard/Live/Holo/Gold), et protège notamment les Live du recyclage de masse. Les points sont des valeurs théoriques maximales dans ce modèle, non des revenus réels. Pas de Paquet Scène, pas de ciblage familial, pas de variations Live/Holo/Gold, pas de bonus Direct, pas de Craft, pas de missions, pas de dépenses, pas de simulation Supabase. Les résultats ne sont pas des mesures du moteur ni de l'application en production.

**Suite obligatoire avant rééquilibrage :** intégrer les variantes, le Paquet Scène, les vraies règles de recyclage et d'artisanat ; exécuter les trajectoires directement avec `game-engine.ts` (et comparer au serveur), mesurer la complétion des familles et le temps jusqu'à la première carte ciblée. Aucun taux modifié à cette étape.


Simulation exploratoire indépendante (et **non** exécution du moteur TypeScript ni du serveur). Hypothèses : stock initial 2, réserve maximale 4, recharge naturelle 1/30 min, visites fixes chaque jour (occasionnel 12 h/21 h, régulier 8 h/13 h/20 h, intensif 7 h/10 h/13 h/16 h/19 h/22 h), sans sabliers. Les ouvertures sont distribuées entre visites ; chaque scénario arrive à ouvrir ses 2, 6 ou 12 boosters Live quotidiens. Le Prime Time est compté seulement sur les ouvertures à 20 h. Points et jetons incluent les six petites récompenses de série, répétées chaque semaine, **sans** bonus de jalons, saisons, recyclage, missions, Paquet Scène, Perfect ni dépenses. Les chiffres sont des scénarios conditionnels, pas une prédiction des habitudes réelles.

| Profil | 7 j : Live / jetons / points | 30 j : Live / jetons / points |
|---|---:|---:|
| Occasionnel, 2/j | 14 / 109 / 658 | 60 / 460 / 2 600 |
| Régulier, 6/j | 42 / 263 / 994 | 180 / 1 120 / 4 040 |
| Intensif, 12/j | 84 / 473 / 1 498 | 360 / 2 020 / 6 200 |

**Lecture :** à 30 jours, le joueur intensif ouvre 6 fois plus de boosters que l'occasionnel ; les jetons progressent ici de 460 à 2 020 (×4,39) car les bonus fixes de série atténuent l'écart. Le régulier et l'intensif atteignent le coût de 400 jetons bien plus tôt, mais ce calcul n'intègre ni les autres récompenses ni les achats effectués. Ne **pas** interpréter le nombre de boosters divisé par 12 comme un nombre de Légendaires garanti : les tirages anticipés réinitialisent le compteur, et un Perfect peut aussi affecter le rythme.

**Limites bloquantes avant décision d'équilibrage :** absence de tirages aléatoires de créateurs, donc pas de doublons, taux de collection, gains de recyclage, dépenses d'artisanat ou répartition des raretés ; pas de modèle de présence réelle aux heures de visite, de l'usage des sabliers, des missions, du Paquet Scène ni de la synchronisation Supabase. La prochaine passe doit exécuter le moteur réel sur des trajectoires reproductibles et documenter les résultats statistiques, sans modifier l'économie avant validation.


**Portée :** revue statique des règles `src/lib/catalog.ts`, `src/data/progression.json`, `src/lib/progression.ts`, `src/lib/game-engine.ts`, `src/data/pull-rates.json`, `docs/taux-de-drop.md`. Pas de simulation exécutée, pas de test de production Supabase, aucune modification des règles.

**Boucle constatée :** Live Drop de cinq cartes, réserve max 4, recharge 30 min ; Paquet Scène quotidien de cinq cartes orienté famille, sans Légendaire ; 3 missions quotidiennes (1 sablier chacune) ; série de sept jours, avec Perfect garanti ou 3 sabliers au jour 7 ; collection, recyclage, artisanat et achat ciblé par jetons. Les cartes, points et jetons en ligne sont sous autorité serveur, à confirmer sur la base effectivement déployée.

**Ordres de grandeur vérifiables :** 5 jetons par Live Drop, 7 pendant le Prime Time (20 h–23 h selon l'heure locale de l'appareil), coût ciblé 400 jetons, soit 80 ouvertures hors Prime Time ou 58 si toutes les ouvertures rapportent 7 jetons (arrondi supérieur). 12 points et 18 XP par Live Drop ; 10 points et 14 XP par Scène ; 100 XP par niveau, 3 sabliers par niveau ; 1 sablier enlève 15 minutes de recharge. La réserve de 4 se remplit en 2 h à partir de zéro. Les gains de série, jalons, recyclage et saisons s'ajoutent : les chiffres ci-dessus ne sont **pas** une simulation complète.

**Hypothèses produit à tester, pas des bugs établis :** (1) écart de progression entre 1–2 visites quotidiennes et 4–8 visites ; (2) valeur réelle des points face aux doublons et coûts de craft ; (3) disponibilité de la mission de recyclage au début d'une partie ; (4) impact du Prime Time local sur l'équité entre profils et fuseaux ; (5) lisibilité des récompenses et de la prochaine action dans Drop/Binder/Craft/Toi.

**Dette documentaire constatée :** dans `src/lib/game-engine.ts`, le commentaire au-dessus de `openPack` mentionne encore un seuil de pity « 80 » et « 79 », alors que la condition exécutée utilise `PITY.threshold` et que `src/data/pull-rates.json` définit **12**. Vérifier puis corriger ce commentaire dans une passe dédiée ; ce n'est pas, en soi, une preuve de bug de tirage.

**Prochaine étape recommandée :** établir une simulation reproductible des profils occasionnel (2 ouvertures/jour), régulier (6/jour), intensif (12/jour) sur 7 et 30 jours, avec prise en compte du plafond de réserve, des missions, des séries, des jalons, des doublons, du craft et des gains de jetons. Confronter ensuite aux tests miroir TS/SQL et à l'expérience sur téléphone avant toute modification d'équilibrage. Garder le polish des boosters en attente de retour utilisateur.

## Référence de coordination — audit du 10 octobre 2026

Cette section décrit le **présent** ; les sections antérieures conservées plus
bas sont l'historique, avec leurs retraits et validations datées. Le code et les
tests priment sur une ancienne case cochée. Voir [passation](agent-handoff.md),
[décisions](decisions.md), [problèmes](known-issues.md) et [périmètre](perimetre.md).

**Vision :** jeu de collection Twitch mobile, quatre piliers Drop/Binder/Craft/Toi,
des ouvertures lisibles et tactiles, économie multijoueur tenue par Supabase.
La simulation « Ta chaîne » reste retirée de l'interface ; son moteur conservé
n'est pas une fonctionnalité à remettre par défaut. Aucune refonte dans cet audit.

**Révision auditée :** `4955d9bbd489777c6ffd74229613075a332cc9e9`, branche
`design/booster-reveal-polish`. [PR #8](https://github.com/GoodFight37/CreatorDeck/pull/8)
en brouillon, base réelle `arena/01a10c75-creatordeck` (`6c46e4bec37dc91a32f368b586e59ce109a44784`).
`main` (`ae5016f093c977e68943d92f5a7c3da17bca8021`) est beaucoup plus ancien.
Ces observations doivent être revérifiées à chaque reprise, pas utilisées comme
instructions de reset ou d'envoi vers main.

### Fonctionnalités présentes dans le code

| Ensemble | État constaté | Validation restante / référence |
|---|---|---|
| Catalogue 1000, tirage/Perfect/Gold/pity, jetons, missions et saisons | Implémenté en TS et SQL | Taux et tests miroir ; contrôler le build et la base cible |
| Collection, filtres/pagination, craft/recyclage, thèmes | Implémenté | Tests unitaires/écrans et usage mobile |
| Comptes, sauvegarde, échanges, amis, hôtel, Last Pack, arène | Implémenté côté client et migrations | Une implémentation ne prouve pas le déploiement Supabase actuel |
| Direct Twitch, notifications, fonctions Edge | Code présent | Configuration distante/FCM et appareil à vérifier |
| Tribunal des Bannis | Implémenté, migration `0042` présente | Présence de `0042` en production non vérifiée par cet audit |
| Simulation « Ta chaîne » | Retirée de l'interface, moteur/tests conservés | Retour hors roadmap sans décision produit |
| CI qualité, SQL et navigateur | Workflow `verification.yml` présent | État des runs GitHub à consulter séparément |
| Ouverture imprimée Live/Scène et révélation continue | Implémentée sur branche, **validation en cours** | PR #8 ; critères ci-dessous |

### Priorités actives

| ID / priorité | Travail / statut | Dépendances | Critères d'acceptation |
|---|---|---|---|
| COORD-01 / P0 | Consolidation et coordination — terminées sur `main` (`2c9b6c4`) | Historique GitHub et documentation de passation | Une seule branche distante (`main`) ; PR #7 intégrée, PR #8 fermée ; anciens résultats et limites consignés ci-dessus |
| UX-01 / P1 | Première boucle de collection — implémentée, retour sur téléphone attendu | Binder, RevealOverlay, réserve de boosters | Vue « Obtenues » par défaut ; état vide sans compteur/page écrasants ; 12 cartes par page ; résumé des cinq cartes et découvertes ; réouverture directe si réserve disponible. Écrans 72/72, typecheck/lint/build OK ; avis tactile réel ouvert |
| VIS-01 / P1 | Validation humaine de la scène booster → cinq dos → révélations — encore ouverte | Téléphone réel ; `pack-tear`, `reveal-overlay`, CSS de continuité | Reste l'avis humain sur téléphone (soudure à une main, rendu, rythme, reflets et réduction d'animations). Le retour UX récent n’est pas une validation visuelle sur appareil |
| QA-01 / P1 | Contrôles locaux UX — code validé ; suite projet/CI partiellement établie | Environnement de test local et GitHub Actions | Écrans 72/72, typecheck/lint/build OK. `npm test` : 1102/1106, quatre échecs catalogue/saisons/SQL ; `catalog:ci` signale le seed 0003 dérivé. Vercel preview READY, production non vérifiée ; Actions non établies |
| UX-02 / P1 | Craft, profil et objectif court — implémentés sur `main` (`09487de`) | Retour produit du 10 octobre ; règles d’économie existantes | Avant 10 copies recyclables, Atelier montre une progression courte et le retour Drop ; Toi met en avant vitrine locale et série, sans zéros initiaux ; Drop met en avant une mission déjà définie. Pas de changement d’économie ou de règles serveur |
| VERSION-01 / P2 | Identifiant du build dans Toi — implémenté sur `152c217`, publication à vérifier | SHA fourni par Vercel/GitHub ou checkout Git local ; profil | « Version abc1234 » se calcule automatiquement depuis le commit réellement compilé ; fallback « locale » sans SHA. UI 5/5, helper 2/2, typecheck/lint/build et recherche SHA dans bundle réussis ; vérifier Vercel après push |
| UX-03 / P2 | Présence sociale et plancher visuel — à cadrer | Vitrine publique, carnet social et portraits existants | Rendre le showcase et les ouvertures d’amis visibles dans la boucle ; évaluer avatar/badge sans nouveau système serveur ; établir une politique de fallback visuel. Notifications existent déjà pour certains événements, vérifier leur configuration avant d’ajouter un rappel quotidien |
| CLOUD-01 / différée | Vérifier les parcours et le schéma du projet Supabase distant — **hors périmètre sans autorisation explicite** | Accès autorisé au projet réel | Ne reprendre que si l'utilisateur demande explicitement cette vérification ; lire `schema_versions()` et tester les parcours sans appliquer de migration ni modifier les données |

Visite locale du 10 octobre, code `66b78d5` : Live bureau/téléphone, Scène et Perfect simulé examinés, réduction des animations observée. Validation humaine sur appareil réel encore requise. K-011 corrigé dans `d87b72c` : retour au titre Scène quand le bouton consommé est désactivé ; scénario Scène et scénario Live existant 4/4 réussis bureau/téléphone. K-010 Live reste corrigé. Aucun nouveau build ou run CI/E2E complet.

Retour humain reçu le 10 octobre : sachet trop grand, soudure difficile à
atteindre à une main et appui accueil inactif. K-012 / D-012 implémentés dans
`0beb6b3` : sachet compact, soudure centrale, appui accueil et tracé dans les deux
sens. E2E ciblés 20/20, tactile simulé 4/4, typecheck/lint code 0 ; captures
examinées. Nouvelle validation sur téléphone réel et CI du SHA publié attendues.
VIS-01 reste en cours ; les autres appréciations visuelles ne sont pas closes.

Les préférences encore ouvertes du dossier d'atelier (dos/halo, éclat, Perfect,
limites de sélection) sont des demandes de validation, pas des décisions prises
par cet audit. Ne pas modifier les probabilités ou ajouter un chantier sans demande.

### Historique conservé de la roadmap antérieure

Les statuts « En place & Validé » ci-dessous reflètent les livraisons de leur
date. En particulier, l'ancienne ligne « Suite de tests Playwright & Vitest »
ne signifie plus que ces suites seraient absentes : elles existent maintenant.

## 📱 Volet 1 : Application Principale (TCG & Cloud)

### En place & Validé
- [x] Moteur de tirage & Taux de drop publiés (pity à 12, Perfect, Gold à 1 %, Live)
- [x] Cloud Supabase sécurisé (comptes, inventaire, échanges atomiques, hôtel des ventes)
- [x] Statut Twitch en direct & notifications push FCM (APK)
- [x] Arène hebdomadaire, wishlist publique & Last Pack protégé
- [x] Export Vercel & contrôle automatique du cloud au build (`cloud-guard.mjs`)

### Chantiers en cours / Améliorations
- [x] **« Du jus » : les moments rares se voient** (8 octobre 2026) : un **éclat** sur une Épique, un grand **éclat** (une fois et demie plus large) et un écran blanc sur une Légendaire comme sur un Perfect (planches pixel-art découpées en CSS, partant **avec** le son, coupées par le réglage des reflets), l'**achat d'un palier** qui fait vraiment entrer l'objet dans la pièce — il tombe, et la fumée marque l'endroit — et l'**emblème d'Arène** posé sur l'étagère du Studio (le pont TCG → Studio : ce qui se gagne dans l'Arène se voit chez soi)
- [x] **Les crédits, et un carnet qui vise juste** (8 octobre 2026) : un écran **Crédits** discret sous « Toi » (Kenney pour le décor, unTied Games pour les effets — la ligne que sa licence demande —, Chequered Ink pour les bruits, Twitch, Lucide, les polices), et les notifications d'**échange** qui ouvrent la feuille de compte **sur la section des échanges**, panneau déjà ouvert et déjà à l'écran
- [x] **Les 1 000 cartes tiennent dans le DOM** (8 octobre 2026) : plutôt que de chronométrer (une durée en jsdom ne dit rien du téléphone), un banc **compte** — avec tout le catalogue possédé, la recherche qui matche des centaines de noms et le filtre par rareté, le classeur pose **9 cartes** (une page de 3 × 3) et l'Atelier **20 lignes**, portraits compris ; le seul endroit qui rendait la liste entière était l'onglet **Recycler**, qui posait ses ~330 doublons d'un coup — il se feuillette désormais comme le reste (et se **cherche** : nom, identifiant, région, rang ou variante), « Tout recycler » emportant toujours tout
- [x] **Les longues listes se feuillettent** (8 octobre 2026, le soir) : le **classement mondial** demande cent joueurs au lieu de vingt (le serveur en accepte cent) et en pose **vingt par page**, avec le pager du classeur, le retour à la première page quand on change de tri, et **aucun pager** quand il n'y a qu'une page ; aux **échanges**, « Tu donnes » s'arrêtait à 24 cartes **sans le dire** — elle se feuillette par 24 et annonce la tranche (« Cartes 1–24 sur 60 ») : les cartes suivantes existaient, le joueur ne pouvait ni les voir ni les choisir
- [x] **Le Tribunal des Bannis** (8 octobre 2026, au soir) : un mode **100 % interface** — cinq appels par journée de jeu, tirage déterministe par `(journée à 6 h UTC, joueur)`, verdict au pouce (grâce / maintien), **Karma de modération** et jusqu'à **40 points de craft** par séance (×2 si le créateur qui préside est en direct). La carte qui préside se choisit dans le classeur ; l'argent est versé par le **serveur** (`0042_tribunal.sql`, à coller : `npx supabase db push`), qui recalcule le karma — l'appareil n'en fabrique aucun. Cf. `docs/historique-livraisons.md` § 11.58
- [x] Suites Vitest/Playwright exécutées sur le commit courant via GitHub Actions #260 ; les jobs unitaires, écrans et E2E ont réussi.
- [x] **Polissage visuel & haptique** (8 octobre 2026, le soir) : le reflet Holo/Gold **suivait déjà le doigt** (écrit en direct sur le foil, sans re-rendu) et le tirage du booster **vibrait déjà** au franchissement du seuil — les deux sont maintenant **prouvés par un banc** (`navigator.vibrate` compté : une seule vibration, et zéro quand le son est coupé). Cf. `docs/historique-livraisons.md` § 11.56
- [x] **Finition UX « consumer-grade » (8 octobre 2026)** : plus un mot d'infrastructure à l'écran (`scripts/check-jargon.mjs`, gardé par `src/lib/jargon.test.ts` sur les composants, les pages et **tous** les modules qui portent des phrases), un **carnet de notifications dont chaque ligne mène au bon écran** (`KIND_TARGETS`), et un écran **Mon compte** sans boutons de sauvegarde : pastille verte « Progression synchronisée », adresse masquée, et le choix entre deux parties **seulement** quand il y en a deux

---

## 🎮 Volet 2 : Mini-Jeu "Ta Chaîne" (Streamer Simulator)

### En place & Validé
- [x] Mécanique pure (formats de vidéo, 5 paliers de notoriété, JSON)
- [x] Tables SQL Supabase & gestion des abonnés (`0036`)
- [x] Écran d'accueil & feuille de chaîne basique
- [x] Imprévus du jour (cartes à swipe) & « Ton setup » en 5 paliers de points (`0038`)
- [x] Mini-jeu interactif de 20 s (Live, chat qui défile, bulles d'alerte)
- [x] Invités sur le bureau (2 cartes du classeur, bonus Raid si le créateur est EN LIVE)
- [x] Bureau **visuel** : la scène du studio (objets qui s'allument avec le setup, vraies cartes sur socle, aura rouge du direct, bandeau « RAID ! ») et le **plateau** qui booste la vidéo du jour (`0041`, étape 8 de `docs/ta-chaine.md`) — **la scène est retirée depuis le 8 octobre 2026** ; le plateau, lui, booste toujours la vidéo du jour, et les invités vivent dans le bureau en cartes
- [x] **Refonte « jeu mobile » de l'écran « Ta chaîne »** : HUD (rang, jauge d'abonnés, rythme, jetons), socles, boutons bombés, notices remplacées par des badges — **le HUD est resté, en texte** depuis le retrait du 8 octobre 2026 (l'écran n'étant plus un onglet, il ouvre par la ligne « Ta chaîne » de l'accueil et gagne un bouton Retour)
- [x] **Le Studio s'habille et s'entend** (8 octobre 2026) : deux fenêtres posées sur les murs du kit (lumière froide), un second écran au palier *régie* — **les deux fenêtres sont parties avec la pièce** — et **15 bruitages embarqués** (cartes, pages, clics, feuilles, achats de setup, publication, raid) branchés sur les gestes — le bouton *Son* du profil les coupe tous (`docs/assets-sonores.md`)
- [x] **Le Studio devient un onglet plein écran, et la pièce passe aux vraies images** (étape 10 de `docs/ta-chaine.md`) : cinq onglets dans la barre du bas, plus de modale, et une **pièce isométrique du kit Kenney** (CC0) où chaque palier fait entrer son objet (`src/data/studio-room.json`, `src/lib/studio-room.ts`) — **retiré le 8 octobre 2026 au soir** : la barre revient à **quatre piliers**, la pièce, l'emblème d'Arène sur l'étagère et le kit Kenney (2,7 Mo) partent, le moteur ne bouge pas (`docs/ta-chaine.md` § 1)
- [x] Arbitrage du live de 20 s (scène d'immersion gratuite, tirage vidéo 100 % serveur)

### Prochaines étapes
- [x] **Paliers de setup avancés (Tycoon étendu) :** Financement des paliers 6+ via le sacrifice de doublons de cartes (Rares/Épiques) — livré le 8 octobre 2026 (`0040`, étape 7 de `docs/ta-chaine.md` : Rare = 1, Épique = 2, Légendaire jamais, une carte ne part qu'une fois)
- [x] **Retirer la simulation de streameur de l'application** (8 octobre 2026, le soir) : le décor isométrique ne rentre pas dans la direction que prend le jeu, et le joueur a demandé qu'on l'enlève **complètement** — plus d'onglet, plus de ligne d'accueil, plus d'écran. Le **moteur reste** (`src/lib/streamer.ts`, ses données, ses migrations, ses tests) : rien n'est perdu, rien n'est à recoller, et son dossier est `docs/ta-chaine.md`
- [ ] **Et ensuite ?** Rien n'est prévu pour la simulation : la remettre dans le jeu demanderait une direction visuelle ou un mode assumé — c'est une décision de produit, pas une dette
- [x] **Se déplacer ne sonne pas — jusqu'au bout** (8 octobre 2026) : onglets, portes, feuilles et réglages muets, puis les **deux derniers** sons de déplacement — le **filtre du Binder** et ses **pages** — retirés à la demande du joueur, le soir même. Il ne reste que ce qu'on **fait** : ouvrir un booster, révéler une carte, encaisser une récompense, refuser. Vérifié par un compteur dans le banc d'écrans (onglets, feuilles, filtre et pages : zéro son ; `docs/assets-sonores.md`)
- [x] **Les sons mesurés, et un volume réglable** (8 octobre 2026) : chaque bruitage est mesuré (RMS, crête) et ramené à sa cible de volume perçu — ce qu'on entend le plus souvent est le plus discret — et un réglage **Volume** (Discret / Normal / Fort) baisse toute l'application d'un cran, sous l'interrupteur *Son* (`docs/assets-sonores.md`)
- [x] **L'ouverture d'un paquet devient un moment** (8 octobre 2026, au soir) : entrée de carte avec rebond et halo par rareté, refus qui rougit, cascade sur le Perfect, et une **déchirure** de 700 ms entre le geste et la première carte (`src/components/pack-tear.tsx`). Rien ne boucle, tout est coupé par le réglage « Reflets des cartes » et par « moins d'animations » — un test le vérifie
- [ ] **Bilan & équilibrage des gains :** Ajustement des courbes de croissance (abonnés, vidéos, imprévus) après tests de jeu réels — **l'outil de mesure est là** (`npm run streamer:bilan`, 8 octobre 2026) : paliers et délais, gain moyen par format et par palier, choix d'imprévus, prix du setup, trente journées simulées (313 690 abonnés sans un point dépensé, 3 363 428 avec tout le setup). Il lit `src/data/streamer.json` par les fonctions du jeu et **n'équilibre rien** : la décision se prend en jouant
