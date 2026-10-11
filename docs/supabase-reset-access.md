# Accès au reset Supabase — 11 octobre 2026

Le reset réel est autorisé par Malik. Il reste conditionné à la vérification du
projet cible, du schéma courant et d'une sauvegarde récupérable. Aucune application
réelle de 0044 n'a été exécutée par cette session.

## Voie directe sur téléphone

Ouvrir le [projet référencé dans le dépôt](https://supabase.com/dashboard/project/yzxchpybqrfegvecihxf).
Se connecter à son compte Supabase, puis confirmer que ce projet est bien celui
utilisé par CreatorDeck. Cette référence documentaire ne prouve pas à elle seule
la cible actuelle. Le tableau de bord Supabase permet de travailler sans les
réglages de l'environnement ChatGPT et sans transférer de clés.

Dans SQL Editor, exécuter uniquement ce contrôle en lecture :

```sql
begin transaction read only;
select public.schema_versions() as migrations;
select count(*) as comptes from auth.users;
select
  to_regclass('public.progression_reset_markers') is not null as marqueur_reset_present,
  to_regprocedure('public.onboarding_status()') is not null as tutoriel_present,
  to_regprocedure('public.open_return_gift_pack()') is not null as cadeau_present;
rollback;
```

Ce contrôle n'applique pas le reset. Examiner ensuite les sauvegardes dans le
tableau de bord : une date seule ne suffit pas ; établir leur état et la méthode
de restauration, ou produire un export et vérifier sa restauration sur une base
isolée. Arrêter si cela ne peut pas être établi. Ne pas coller la migration ni
réparer l'historique des migrations à l'aveugle.

## Voie Cloud

Tests réseau réels du 11 octobre à 00:24 UTC : `curl --head` via le proxy hérité
vers `api.supabase.com/v1/projects` et
`yzxchpybqrfegvecihxf.supabase.co/rest/v1/` : code curl 56,
`CONNECT tunnel failed, response 403`. Le refus précède l'authentification.
Le réseau actif n'autorise pas ces destinations et aucun accès de gestion n'est
configuré dans la session. Le `.env.local` est absent.

Le brouillon Cloud enregistré contient les deux destinations et l'exigence de
secret `SUPABASE_ACCESS_TOKEN`, avec destination `api.supabase.com`. Il préserve
Vercel et les trois domaines Playwright. Le brouillon doit être publié pour
activer ces réglages ; l'outil disponible ne publie pas. La page web présente
« Couldn't load saved environments » alors que les outils de lecture du brouillon
et de l'état de l'environnement réussissent. La cause précise de cette erreur
web reste indéterminée. Ne pas recréer les environnements sans autre preuve.

La clé publique de l'application permet certaines lectures, pas une migration
administrative. Ne jamais placer un secret de gestion dans une variable
`NEXT_PUBLIC_*`, le chat, les captures ou Git.
