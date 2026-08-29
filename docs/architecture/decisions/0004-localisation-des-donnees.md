# ADR 0004 — Localisation des données

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Jalon** : 0

## Contexte

Les boutiques du pilote sont françaises, vendent en B2C et traitent des données
personnelles d'acheteurs : identité, adresse de livraison, e-mail, historique de
commandes. Le RGPD n'impose pas la localisation en Europe, mais un transfert
hors UE demande un fondement juridique et une explication au commerçant, qui
doit lui-même informer ses clients.

Cloudflare permet de contraindre l'emplacement : D1 et R2 acceptent une
juridiction à la création (`eu`), qui ne peut pas être modifiée après coup — une
base créée sans juridiction ne peut être « déplacée » que par recréation et
migration des données.

## Décision

Toutes les ressources de données d'une boutique européenne sont créées avec la
**juridiction Cloudflare `eu`** : base D1, bucket R2 d'images, bucket R2 privé.
La juridiction est déclarée dans le manifeste (`cloudflare.jurisdiction: eu`) et
vérifiée après le provisioning.

Les fournisseurs tiers du périmètre (Stripe, Resend) sont retenus avec leurs
garanties de transfert propres ; les données personnelles qui leur sont
transmises se limitent à ce qu'exige l'exécution de la commande.

Une boutique dont la juridiction constatée diffère de la juridiction attendue
**ne peut pas être déployée**.

## Conséquences

- la localisation est une propriété vérifiable de l'infrastructure, pas une
  déclaration dans un contrat ;
- une erreur de juridiction au provisioning n'est pas rattrapable en place :
  elle impose de recréer les ressources et de rejouer les données, d'où la
  vérification immédiate après création ;
- l'exécution du Worker reste distribuée sur le réseau Cloudflare : c'est le
  stockage qui est contraint, et la documentation client doit le dire ainsi,
  sans promettre davantage ;
- le registre de traitement et les mentions légales de chaque boutique peuvent
  s'appuyer sur une localisation constatée.

## Alternatives écartées

- **Aucune contrainte de juridiction** : moins d'opérations, mais rend
  impossible toute réponse simple à la question « où sont mes données », et
  l'erreur n'est pas rattrapable a posteriori.
- **Hébergement hors Cloudflare pour les données** (base managée européenne
  externe) : sortirait du modèle Workers, ajouterait une latence et un
  fournisseur, sans bénéfice de conformité par rapport à la juridiction `eu`.

## Vérification

- le provisioning crée D1 et R2 avec la juridiction du manifeste et relit la
  configuration créée ;
- `shopctl fleet verify` signale toute ressource hors juridiction ;
- la section 9 du plan fait de la juridiction une condition bloquante de
  déploiement.
