# Mises à jour automatiques Supabase

Le workflow **Mise à jour Supabase** attend la réussite du workflow
**Vérification** sur le commit courant de `main`. Il applique les nouvelles
migrations avec le CLI officiel Supabase, puis ce CLI enregistre leur version.
Il ne déploie ni APK, ni fonction Edge, ni site Vercel. La publication Vercel
reste indépendante ; la configuration réelle et l'ordre de publication ne sont
pas vérifiés ici. Les changements SQL doivent rester compatibles avec le client
actuellement servi. Aucun secret dans le code, les tests ou le bundle.

## État au 11 octobre 2026

Mécanisme préparé et testé localement, **activation non validée** : le secret de
connexion GitHub et l'historique réel des migrations restent à vérifier. Aucun
accès à la production, aucun déploiement réel exécuté par l'agent. Malik indique
avoir appliqué 0046 et confirme le tutoriel sur son téléphone ; l'ouverture des
quatre cadeaux restants n'a pas été explicitement confirmée.

Les migrations 0001–0046 sont figées dans `supabase/deploy-baseline.json`
(empreintes SHA-256). Ce fichier constate leur contenu dans Git ; **il ne prouve
pas leur application dans Supabase et n'écrit pas son historique**. Le workflow
ne rejoue jamais ces fichiers. Sans nouvelle migration il réussit sans secret ni
connexion : cela ne prouve pas qu'il est activé.

## Configuration initiale, une seule fois

1. Dans [SQL Editor CreatorDeck](https://supabase.com/dashboard/project/yzxchpybqrfegvecihxf/sql/new),
   exécuter cette lecture seule :

   ```sql
   select to_regclass('supabase_migrations.schema_migrations') is not null
     as historique_present;
   ```

   Si `true`, lire ensuite `select version from supabase_migrations.schema_migrations order by version;`.
   Si `false` ou si des anciennes versions manquent, **arrêter l'activation** :
   il faut comparer le schéma courant et chaque migration manquante avant une
   réconciliation explicite de l'historique. Le SQL Editor n'enregistre pas les
   versions pour le CLI. Ne pas lancer `db push`, `--include-all` ou un repair
   massif pour faire disparaître l'erreur ; 0044 contient un reset global.
2. Dans Supabase, ouvrir le projet CreatorDeck → **Connect** → connexion
   PostgreSQL → **Session pooler** → URI. La connexion doit viser
   `postgres.yzxchpybqrfegvecihxf` sur un hôte `*.pooler.supabase.com`, base
   `postgres`, avec son mot de passe de base (ce n'est pas une clé API).
   La connexion directe `db.yzxchpybqrfegvecihxf.supabase.co` est aussi admise
   si le runner peut la joindre. Encoder les caractères spéciaux du mot de
   passe dans l'URI. Ne jamais envoyer cette URI dans le chat.
3. Ouvrir [GitHub → Settings → Secrets and variables → Actions](https://github.com/GoodFight37/CreatorDeck/settings/secrets/actions).
   **New repository secret** → nom `SUPABASE_DB_URL` → URI complète → enregistrer.
   Il s'agit d'un accès administrateur PostgreSQL, réservé au workflow de
   production ; les jobs des PR ne reçoivent aucun secret.
4. Après vérification de l'historique, faire un premier contrôle en lecture
   seule depuis une machine configurée :
   `node scripts/supabase-deploy.mjs --dry-run`. Le CLI officiel est nécessaire
   pour l'exécution réelle, et `pg` pour la connexion de contrôle.
   En GitHub Actions, outils installés automatiquement avec versions explicites.

Aucun accès prêt dans cet environnement Cloud ne permet à l'agent d'effectuer
ces opérations administratives à la place du propriétaire.

## Prochaines migrations

Créer un fichier nouveau, version supérieure à 0046, sans modifier l'historique.
Il doit comporter une de ces lignes exactes :

```sql
-- creatordeck-deploy: automatic
```

ou

```sql
-- creatordeck-deploy: manual
```

Classer toute opération qui efface/transfère des données, réinitialise un jeu ou
modifie dangereusement des droits en **manual** après revue de son SQL. Le
script vérifie la déclaration ; il ne prétend pas comprendre automatiquement
les effets arbitraires du SQL. Les opérations ordinaires compatibles et
vérifiées peuvent être classées automatic. Les tests sur PostgreSQL jetable
restent obligatoires ; ajouter les migrations au vérifieur du projet.

Une migration manual bloque tout le plan jusqu'à une exécution explicite dans
[Actions → Mise à jour Supabase](https://github.com/GoodFight37/CreatorDeck/actions/workflows/supabase-deploy.yml)
→ **Run workflow**, branche `main`, option de validation manual cochée. Examiner
**toutes** les migrations en attente avant ce clic : il autorise tout le plan,
pas un seul fichier. Le commit doit avoir une CI complète verte. Ce mécanisme
ne remplace pas une sauvegarde récupérable lorsqu'elle est requise.

Les exécutions sont sérialisées sans annuler une migration en cours. Un commit
ancien ou issu d'une PR/fork ne reçoit pas l'accès de déploiement. Une version
distante inconnue, un historique incomplet, un ancien fichier modifié, un mode
absent ou une mauvaise cible arrêtent le déploiement. TLS vérifié ; aucun
contournement des certificats. Le CLI décide des migrations à appliquer après
contrôle ; aucun repair automatique. Après un échec, vérifier l'état réel et
l'historique avant de relancer.

## Vérifications locales effectuées

- `node scripts/supabase-deploy.test.mjs` : 14/14 tests, code 0.
- `node scripts/supabase-deploy.mjs --check` : code 0, contrôle hors réseau.
- `node scripts/supabase-deploy.mjs` : code 0, aucune nouvelle migration,
  aucun accès réseau et aucun SQL exécuté.
- `npm run lint` : code 0.
- YAML des deux workflows analysé avec `yaml.safe_load` : valide.

Aucune modification produit/SQL de jeu ; les suites UI/build/SQL de jeu ne sont
pas relancées pour ces fichiers de déploiement. Derniers résultats produit dans
la passation. Aucune exécution GitHub Actions/CLI réelle ni activation du secret
constatée pendant cette préparation.
