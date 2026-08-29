# ADR 0001 — Modèle d'isolation des boutiques

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Jalon** : 0

## Contexte

L'offre vise plusieurs petites boutiques françaises exploitées par la même
agence. Deux modèles sont possibles : une application multi-tenant unique
partageant une base et un Worker, ou une instance complète par boutique.

Le socle Minshop est écrit pour une boutique : la configuration est
build-time (`src/store.config.ts`), les bindings Cloudflare (`DB`, `BUCKET`,
`FILES`) sont globaux au Worker et l'administration est protégée par une
session unique. Aucune table ne porte de colonne `tenant_id`, et le rendre
multi-tenant supposerait de reprendre le cœur métier, les migrations, le
cache, l'authentification et la facturation.

Le volume attendu est faible — moins de 100 produits et un trafic de petite
boutique — mais les exigences de cloisonnement sont fortes : données
clients, paiements et documents fiscaux distincts par commerçant.

## Décision

Chaque boutique est **mono-tenant à l'exécution** : un Worker, une base D1, un
bucket R2 d'images, un bucket R2 privé, un domaine, un jeu de secrets et des
sauvegardes qui lui sont propres. Aucune ressource d'exécution n'est partagée
entre deux boutiques.

Le caractère multi-client est porté **par le code et l'outillage**, pas par le
runtime : un socle unique versionné, un manifeste `client/client.yaml` par
boutique, et une CLI `shopctl` qui crée, provisionne, met à jour et supervise
la flotte.

## Conséquences

- une fuite de données entre deux boutiques suppose une erreur de
  provisioning, pas une erreur de requête ; le rayon d'explosion d'un bug
  applicatif reste une seule boutique ;
- une boutique peut rester sur une version antérieure du socle sans bloquer
  les autres, et être restaurée ou supprimée isolément ;
- le coût unitaire augmente : chaque boutique consomme ses propres ressources
  Cloudflare et ses propres comptes fournisseurs ;
- toute opération d'exploitation devient une opération de flotte ; sans CLI et
  sans registre, l'offre ne tient pas au-delà de quelques boutiques — c'est ce
  qui justifie les jalons 2, 6 et 9 ;
- le cœur métier ne doit contenir aucune condition propre à un client ; la
  boutique témoin `canary-minimal` existe pour le prouver.

## Alternatives écartées

- **Multi-tenant partagé** : suppose une réécriture du cœur Minshop
  (isolation par ligne, cache, auth, exports) et concentre le risque : une
  seule requête défectueuse expose toutes les boutiques.
- **Copier-coller du dépôt par client, sans socle commun** : isolation
  correcte, mais aucune mise à jour de flotte possible ; chaque correctif de
  sécurité devrait être réappliqué manuellement.

## Vérification

- deux boutiques témoins (`pilot-fr`, `canary-minimal`) se construisent depuis
  le même socle sans condition client codée en dur (jalon 1) ;
- aucun identifiant de ressource Cloudflare n'est partagé entre deux
  manifestes ; le contrôle est exécuté par `shopctl fleet verify` ;
- les tests d'isolation multi-client de la section 8.3 du plan.
