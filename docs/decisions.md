# Décisions CreatorDeck

Ce registre est autonome, mais ne remplace pas le code ni les décisions
détaillées existantes. Ajouter des entrées datées ; marquer une décision
remplacée plutôt que l'effacer. Une proposition en attente n'est pas adoptée.

| ID / date | Décision et contexte | Justification / conséquences / preuve |
|---|---|---|
| D-001 / 2026-10-10 | Quatre documents de coordination + AGENTS communs à Codex Cloud, PC et ChatGPT | Demande utilisateur de continuité sans conversation ni quota ; mêmes règles pour tous, checkpoints réguliers, code/tests comme preuves. Le quota n'est pas observable de façon fiable. |
| D-002 / 2026-10-10 | Documenter sur design, maintenir la base réelle de PR #8 | Git/page de PR : design `4955d9b`, base arena, main ancien. Aucun merge/main autorisé ; cette mission ne change pas le jeu. |
| D-003 / 2026-10-10 | Un écrivain par branche, relecture distante avant chaque checkpoint/push | Préserver les travaux alternés et éviter l'écrasement ; passation indicative, aucun faux verrou technique. Push normal, fichiers ajoutés explicitement. |
| D-004 / 2026-10-10 | Garder les historiques et séparer implémentation, validation et déploiement | La roadmap et les compteurs antérieurs ont vieilli ; leur contexte reste utile. Les runs actuels sont dans la passation, avec limites et SHA. |
| D-005 / 2026-10-10 | SHA du code audité explicite ; commit du document retrouvé dans Git | Un fichier ne peut contenir le hash du commit qui le contient. `git log -1 --format=%H -- docs/agent-handoff.md` retrouve le checkpoint documentaire sans SHA fictif. |
| D-006 / 2026-10-10 | Audit documentaire seulement : documenter K-007 sans changer le jeu ou son banc ici | La coordination est l'objet de la mission. Le test SQL dépend de la date réelle ; la prochaine tâche ciblée doit le rendre déterministe, sans masquer l'échec ni changer la règle arène. |
| D-007 / 2026-10-10 | Garder la lecture du lock dans `dev:setup` | Désactiver `package_lock` a fait dériver Next/Playwright ; correction par `npm ci` puis setup normal, versions comparées et contrôles rejoués. E2E et production non exécutés restent non validés. |
| D-008 / 2026-10-10 | Scénarios de draft fermés/ouverts imposés seulement dans la base SQL jetable | Reprise autorisée par l’utilisateur après la mission documentaire (D-006 achevée). Supprime la dépendance au jour réel ; garde les dates explicites pour la règle calendaire, la vraie RPC pour les parcours et la restauration exacte en `finally`. Aucun changement du jeu ou de migration. Contre-épreuve : suppression temporaire de la garde dans une copie externe, jamais dans les fichiers produit. |
| D-009 / 2026-10-10 | Capturer la cible du focus avant la désactivation du bouton et la conserver entre déchirure et révélation | K-010 reproduit dans Chromium : désactiver le bouton avant la capture tardive fait perdre le déclencheur. Cible en état React, transmise aux deux scènes, hook avec cible optionnelle ; même capture Live/Scène et focus OBS toujours désactivé. Pas de temporisation ni sélection du bouton par son texte. E2E existant inchangé : 2 échecs avant, 2 réussites après, écrans 9/9, typecheck/lint ciblé réussis. Correctif `4b9fcca`. |

| D-010 / 2026-10-10 | Visite Chromium locale pour avancer sur VIS-01, puis validation humaine sur téléphone réel | Choix explicite de l’utilisateur après blocage du preview protégé. Même code produit que le preview `2d933c9`, HEAD documentaire `66b78d5`. Visites, captures et gestes simulés prouvent les comportements observés ; elles ne prouvent ni l’accès au déploiement, ni la fluidité, le son ou l’haptique d’un vrai téléphone. Pas de changement d’hébergeur ou de recréation d’environnement. |

| D-011 / 2026-10-10 | Après consommation Scène, retour clavier au titre de sa section si le déclencheur ne reçoit plus le focus | Cible explicitement marquée, tabIndex=-1 : contexte conservé sans nouvel arrêt Tab ni réactivation du paquet consommé. Live continue de rendre le focus au bouton disponible. K-011 reproduit avant correction (2/2 échecs), puis Scène/Live bureau/téléphone 4/4 réussis ; code `d87b72c`. |

## Décisions héritées, retrouvées dans le dépôt

Les dates ci-dessous sont celles des sources/commits, pas des décisions
inventées par cet audit. Consulter les liens avant de réouvrir un sujet.

| ID / date source | Décision | Justification / source |
|---|---|---|
| H-001 / 2026-10-07 à 09 | Jeu en ligne ; tirage, points, jetons tenus par serveur ; dev sans cloud autorisé | Intégrité des échanges/classements. Règles miroir TS/SQL. Pas de repli silencieux en client cloud. [Périmètre](perimetre.md), [revue](revue-externe-2026-10.md), migrations `0019` à `0035`. |
| H-002 / 2026-10-08 | Quatre piliers Drop/Binder/Craft/Toi ; simulation de streameur retirée de l'interface | Direction produit, pas une dette à réactiver. Moteur et migrations conservés. [Ta chaîne](ta-chaine.md), [journal](historique-livraisons.md), roadmap historique. |
| H-003 / 2026-10-08 | Déplacements et navigation silencieux ; sons réservés aux actions | Préférence joueur et fatigue sonore. Interrupteur/volume existants ; [sons](assets-sonores.md) et tests d'écran/son. |
| H-004 / 2026-10-07 à 09 | Pas de Server Actions, secret de service dans l'APK, refonte relationnelle ou promesse 100 % en ligne | Export statique, transport Capacitor/web et intégrité. i18n/analytics différés, découpage dynamique mesuré puis refusé. [Périmètre](perimetre.md), [revue § 3](revue-externe-2026-10.md). |
| H-005 / 2026-10-09 | Sachet en image imprimée ; WebGL et slider retirés | Visibilité garantie et geste tactile de soudure ; les expériences WebGL précédentes ne représentent plus la direction active. Commits `135376c`, `27965c7`, `beadb63` ; `pack-tear.tsx`, images foil Live/Scène. |
| H-006 / 2026-10-09 | Microphone de diffusion gravé plutôt que chevron rejeté | Identité visuelle imprimée du paquet. Commits `57fafef`, `6996172`, images `public/packs/`. Ne pas réintroduire le motif refusé. |
| H-007 / 2026-10-09 | Fallback DIVERRON honnêtement nommé | Ne pas présenter le visuel de remplacement comme un portrait officiel ; commits `799a533`, `25970c1`, `diverron-fallback.svg`. |
| H-008 / 2026-10-10 | Ouverture et révélation dans une scène cinématique continue | Éviter une rupture de scène entre geste, cinq dos et faces ; commit `4955d9b`, CSS `booster-continuity.css`. L'implémentation est présente ; le verdict visuel humain reste à obtenir. |

## D-012 — 10 octobre 2026 : sachet compact et ouverture au toucher

Demande explicite du joueur après capture mobile et vidéos Pokémon TCG Pocket :
réduire le sachet de l'écran noir et atteindre sa soudure à une main ; rendre
l'appui sur le sachet accueil effectif. Le sachet est désormais un bouton,
avec tirage vers le haut conservé et exclusion du clic après glissement.
Cette demande remplace pour l'appui immobile la préférence historique qui
exigeait un tirage ; la règle pure `pullVerdict` ne change pas et les gestes
retirés n'ouvrent rien. Le bouton sous la réserve reste disponible.

Le paquet a une taille indépendante des cartes, sa soudure est placée près du
milieu de l'écran, le tracé fonctionne dans les deux sens avec un seuil relatif.
Les dos rejoignent la taille/position de révélation pendant l'extraction.
Aucune reproduction d'assets Pokémon, refonte générale, règle de tirage ou
économie modifiée. L'ancien sachet presque plein écran est rejeté par le joueur.
Code `0beb6b37027ced0630ed828604754aed17f7ffb7` ; E2E ciblés 20/20, tactile simulé 4/4,
TypeScript/lint code 0. Approbation et ergonomie sur appareil réel encore ouvertes.

## D-013 — 10 octobre 2026 : petits viviers du Paquet Scène

Décision explicite du joueur : cinq créateurs différents d'une famille, jamais
Légendaires ; Scène pleine conserve 0,3 %, utilise cinq Épiques si possible,
sinon tous les Épiques disponibles et complète avec les raretés autorisées.
La garantie Rare/Épique reste au cinquième emplacement. Les tirages ordinaires
réservent le dernier candidat de cette garantie. Une famille avec moins de
cinq candidats non légendaires ou sans Rare/Épique est incompatible : exclue
du ciblage automatique et refusée explicitement par le moteur de tirage.

La décision corrige une impossibilité du moteur, sans changer de poids nominal,
récompense, coût ou seuil. Régressions synthétiques de 0 à 6 Épiques, garantie
unique Rare/Épique, épuisement ordinaire et frontière 3/1000 ; preuves et
limites du chemin Supabase dans [l'audit](audit-progression.md). Aucun déploiement.

L'audit utilise un RNG déterministe dans son seul processus, un fuseau imposé
et compare épargne / craft-et-jetons ; ne pas remplacer le RNG du jeu ni
conclure à un rééquilibrage sur ces seuls horaires et stratégies.

## D-014 — 10 octobre 2026 : parité SQL du Paquet Scène

Ajouter la migration additive `0043_scene_pack_eligibilite.sql` au lieu de
modifier `0016_sortants.sql`, déjà publié. Le serveur garde les poids déclarés
et le seuil 3/1000, exclut les Légendaires, sert les Épiques disponibles lors
de Scène pleine et réserve un candidat distinct pour le dernier slot. Une
famille de moins de cinq créateurs non légendaires ou sans Rare/Épique est
refusée. Le vérifieur exercera les cinq familles réelles à peu d’Épiques, les
deux branches déterministes et l’acceptation par `open_scene_pack()` sur une
base reconstruite. Aucun déploiement n’est autorisé par cette décision.

Preuve actuelle : tests Vitest ciblés 35/35, TypeScript et syntaxe Node OK.
`npm run supabase:verify` n’a pas pu démarrer PostgreSQL sous le compte
Administrateur Windows ; **aucune migration ni aucun contrôle d’intégration
SQL n’a été exécuté**. La parité reste non validée jusqu’à un run PostgreSQL
jetable réussi (local non administrateur ou CI Linux).

## Questions ouvertes

L'appréciation du dos → face, du halo, de l'éclat, du Perfect et des limites de
sélection reste à valider au pouce. Les anciens timings du dossier d'atelier ne
doivent pas remplacer les constantes actuelles. Aucune décision de réintroduire
le simulateur, publier en magasin ou refondre l'application n'est prise ici.

## Format d'une nouvelle décision

ID, date (Europe/Paris), agent/opérateur, demande et contexte, options examinées,
décision et pourquoi, conséquences/réversibilité, preuves (fichier/commit/test),
statut adopté/proposé/remplacé et lien vers l'entrée qui remplace la décision.

## D-015 — 10 octobre 2026 : volume et poids de l’ouverture

La demande est de rapprocher la sensation de l’ouverture d’un objet foil manipulé,
en gardant la direction artistique bordeaux et les créateurs CreatorDeck. Le
chantier est CSS/SVG uniquement, sans WebGL ni dépendance nouvelle. L’objet suit
le doigt seulement si Reflets des cartes et le mouvement ne sont pas désactivés.
Les flaps plient, une lumière traverse la fente, cinq dos sortent sous une seconde,
puis RevealOverlay s’ouvre selon le relais déjà en place. Le Rare reçoit un halo
bordeaux et un punch distincts des Communes ; aucun flash blanc ne lui est ajouté.

La déchirure gagne un glissement de hauteur plus long. Le silence Épique (520 ms),
le verrou Perfect (2,6 s), le bang calé sur le début du flip et le relais de
1,9 s restent inchangés. Pas de changement d’économie, de taux, de récompense ou
de backend. Adopté à la demande utilisateur ; validations et limites actuelles
sont consignées dans [la passation](agent-handoff.md).

## D-016 — 10 octobre 2026 : première collection et boucle post-ouverture

Le retour joueur décrit le classeur vide et l’absence de conclusion après
l’ouverture comme deux ruptures de la boucle de collection. Le Binder ouvre
maintenant sur « Obtenues » ; quand aucune carte n’est encore possédée, il
remplace les compteurs à zéro et la pagination par une invitation à ouvrir un
booster et un accès volontaire au catalogue. Le catalogue reste disponible,
mais n’est plus le premier écran. Les pages du catalogue affichent au plus
12 cartes.

Après les cinq révélations, l’écran présente les cartes du paquet, le nombre de
nouvelles et un bouton « Rouvrir un booster » qui relance réellement le tirage
si la réserve Live le permet. Sinon, le bouton revient au Drop. L’overlay OBS
garde son flux existant ; les sons de révélation, verrous et minutages ne
changent pas.

Le son et les reflets sont déjà actifs par défaut lorsqu’aucun choix local
n’est enregistré. Un choix explicite « OFF » reste respecté ; les reflets
restent coupés par `prefers-reduced-motion` sauf choix explicite prévu par le
réglage, tandis que les animations lourdes suivent toujours le garde-fou de
mouvement réduit. Aucun choix stocké n’est écrasé automatiquement. Décision
adoptée à partir du retour joueur ; tests et état de validation sont consignés
dans [la passation](agent-handoff.md) et [la roadmap](roadmap.md).

## D-017 — 10 octobre 2026 : objectifs précoces, Craft et identité

Le retour joueur pointe les premiers jours comme la période où l’Atelier, les
menus de réglages et les objectifs trop nombreux peuvent noyer la collection.
Le pilier Craft reste accessible, mais avant 10 copies recyclables il montre
seulement la progression `N / 10` et un retour au Drop ; les listes de 1000
créateurs et de recyclage ne s’affichent pas. À partir de 10, l’Atelier existant
reprend sans changement de règles.

Drop met en évidence une mission quotidienne déjà définie dans le moteur et
ouvre le panneau d’objectifs existant. Toi place en tête une vitrine locale des
trois meilleures cartes possédées (rareté, puis variante), avec l’état actuel
de la série ; aucune donnée n’est publiée sans le parcours cloud existant. Les
missions, leur économie et les récompenses restent inchangées. Décision adoptée
sur le retour joueur ; critères et limites dans la passation et la roadmap.

## D-018 — 10 octobre 2026 : version visible liée au commit Git

Le joueur doit pouvoir distinguer un ancien build d’un build récent sans
deviner le comportement de la mise à jour automatique. Le profil affiche donc
un identifiant court dérivé du SHA Git embarqué : Vercel/GitHub transmettent le
SHA du commit pendant la compilation, et le checkout local sert de repli pour
les builds locaux/Android. Aucun numéro n’est incrémenté à la main ; un build
sans dépôt Git affiche « locale ». Le SHA complet reste disponible dans
l’infobulle et aucun secret n’est exposé. La preuve de compilation et l’état de
publication sont consignés dans la passation.


## D-019 — 11 octobre 2026 : reset global, tutoriel et cadeau de reprise

À la demande explicite de Malik, réinitialiser une seule fois la progression de tous les comptes, y compris le sien, pour le lancement du tutoriel. Préserver comptes, identités, profils, amis et historique des ventes/échanges terminés ; annuler les échanges en cours et retirer les annonces actives. Effacer collections, réserves/journaux de tirage, monnaies/ressources, missions/série, Paquet Scène et progression d’arène. Chaque compte pourra réclamer **cinq boosters** une fois, uniquement après le tutoriel ; le texte de cadeau attribue la décision à Malik. Le stock cadeau reste distinct de la réserve normale et le tirage passe par le moteur serveur existant. Le récapitulatif d’ouverture se ferme sur « Retour au Drop », sans CTA de réouverture directe.

Les règles de tirage et les récompenses existantes ne changent pas. L’implémentation doit être additive et testée sur PostgreSQL jetable ; aucune migration de production n’est comprise dans le travail de code. Avant une application réelle, vérifier le projet cible, le schéma, une sauvegarde et la possibilité de récupération. Au checkpoint du 11 octobre, cette décision est adoptée mais **aucune ligne de code de cette demande n’est encore implémentée**. Le scope détaillé et les critères de validation figurent dans la [roadmap](roadmap.md) et la [passation](agent-handoff.md).


## D-020 — 10 octobre 2026 : tutoriel avant le cadeau de reprise

Le reset global est one-shot, via migration additive, et garde comptes, profils,
amis et historiques terminés ; il annule les échanges ouverts et retire les
annonces actives. Le tutoriel précède l'accès au cadeau. Une table de cinq
ouvertures cadeau est séparée de la réserve de boosters ordinaire ; chaque appel
sert cinq cartes au moyen des fonctions serveur de tirage courantes, puis la
réserve cadeau diminue d'un. Le cadeau ne change ni le barème ni la récompense
des tirages ordinaires et n'accorde pas d'XP/points/jetons. Le récapitulatif
retourne au Drop.

Preuve locale du commit `f97ea42` (docs de checkpoint à part): 1 109 tests projet, 73 tests
écrans, SQL jetable avec reset/données préservées/idempotence/ordre/claim unique
et cinq ouvertures, typecheck/lint/build webpack réussis. Le build Turbopack est
bloqué par l'interdiction de bind un port dans le Cloud. Production et téléphone
réel non vérifiés ; le reset réel est interdit sans projet cible, schéma et
sauvegarde récupérable explicitement vérifiés.


## D-021 — 11 octobre 2026 : accès et préparation du reset réel

Malik autorise le reset réel après publication du code, avec vérification maintenue
de la cible, du schéma et d'une sauvegarde récupérable. L'accès Cloud effectif
refuse Supabase en CONNECT 403 et n'a aucun identifiant de gestion prêt. Le
brouillon réseau/secret est sauvegardé mais non publié. La voie directe par le
tableau de bord Supabase sur téléphone permet de commencer les vérifications
sans déplacer de secrets ou contourner le proxy. Aucune écriture réelle exécutée.

Le helper cadeau est isolé pour éviter de remplacer `_save_add_pack_cards`,
utilisé par les boosters ordinaires. Les tests vérifient la conservation exacte
de ce helper et l'absence de droits clients sur le nouveau helper cadeau.
Validation locale : 1 109 tests projet et SQL jetable réussis.

## D-022 — 11 octobre 2026 : claim cadeau rejouable après la première ouverture

En production, le premier appui réclame les cinq boosters puis en ouvre un.
Le client appelait encore `claim_return_gift()` aux appuis suivants ; la base
refusait « déjà réclamé » alors que quatre boosters restaient. Le claim garde
une seule transition de stock, mais un appel répété renvoie un succès sans
ajouter de boosters. Le statut serveur expose `gift_claimed` à partir de
`claimed_at`, et l'interface transforme ensuite l'action en ouverture directe
d'un booster cadeau. Ainsi les anciennes versions du client passent aussi la
barrière serveur après application de la migration. Le tirage cadeau et ses
poids restent inchangés. Validation locale et statut de publication consignés
dans la passation ; la correction de schéma n'est pas encore appliquée.

| D-023 / 2026-10-11 | Une réinitialisation individuelle rejoue le tutoriel, tout en préservant le cadeau unique | Demande de Malik : rejouer la séquence depuis le bouton reset. 0046 efface la fin du tutoriel du seul compte authentifié ; le client retire ses deux marqueurs et revient au Drop. Le stock cadeau et le claim restent intacts : reset n'accorde pas cinq nouveaux boosters et ne touche pas les autres comptes. SQL jetable et UI simulée couvrent l'ordre tutoriel puis cadeau et les quatre ouvertures restantes ; validation téléphone/production séparée. |
