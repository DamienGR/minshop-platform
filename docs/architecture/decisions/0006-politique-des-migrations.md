# ADR 0006 — Politique des migrations de schéma

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Jalon** : 0

## Contexte

Les migrations D1 sont appliquées avant le déploiement du Worker : entre
l'application des migrations et la promotion de la nouvelle version, l'ancien
code s'exécute sur le nouveau schéma. En cas d'échec, le rollback du Worker est
immédiat alors que le schéma, lui, reste migré — D1 n'offre pas de rollback
transactionnel de schéma sur une base en production.

Le socle hérite d'une règle Minshop déjà appliquée : migrations numérotées,
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`, jamais de réécriture
d'une migration déjà exécutée. La flotte ajoute une contrainte : plusieurs
boutiques peuvent tourner simultanément sur des versions différentes du socle.

## Décision

Les migrations sont **additives et rétrocompatibles**, sans exception :

- fichiers numérotés dans `migrations/`, jamais modifiés après publication ;
- ajout de tables et de colonnes uniquement ; aucune suppression ni
  renommage destructif dans la même version que le code qui cesse de les
  utiliser ;
- toute suppression suit un cycle en deux versions au minimum : la version N
  cesse d'écrire et de lire la colonne, la version N+1 (ou ultérieure) la
  retire, après vérification de la flotte ;
- une migration doit laisser la **version applicative précédente
  fonctionnelle** ; c'est cette propriété qui rend un rollback du Worker sûr ;
- les migrations sont appliquées avant l'upload de la nouvelle version, et
  précédées d'une sauvegarde (ADR 0005).

## Conséquences

- un rollback applicatif est toujours possible sans intervention sur la base ;
- le schéma accumule des colonnes transitoires : le coût est accepté, la dette
  est purgée par les cycles en deux versions ;
- une boutique restée sur une version antérieure du socle continue de
  fonctionner sur un schéma plus récent, ce qui est indispensable à une flotte
  qui n'est jamais mise à jour d'un bloc (ADR 0003) ;
- une modification de données massive (backfill) est un script séparé,
  idempotent et rejouable, pas une migration de schéma ;
- corriger une migration publiée est interdit : la correction est une nouvelle
  migration.

## Alternatives écartées

- **Migrations destructives synchronisées avec le déploiement** : suppose que
  le rollback ne soit jamais nécessaire ; la première panne coûte la boutique.
- **Réécriture d'une migration existante** : une base déjà migrée ne rejoue pas
  le fichier corrigé ; la flotte diverge silencieusement.

## Vérification

- la CI refuse la modification d'un fichier de migration déjà publié ;
- le jalon 9 vérifie explicitement qu'un ancien Worker fonctionne sur le
  nouveau schéma ;
- l'étape de déploiement `shopctl deploy` applique les migrations après une
  sauvegarde et avant l'upload.
