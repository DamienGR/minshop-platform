# ADR 0005 — Stratégie de sauvegarde et de restauration

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Jalon** : 0

## Contexte

Chaque boutique détient l'intégralité de ses données dans sa propre base D1 et
ses propres buckets R2 (ADR 0001) : commandes payées, clients, catalogue,
contenus et médias. Une perte de données n'est pas rattrapable depuis une autre
boutique.

Cloudflare fournit le Time Travel D1 (restauration à un instant donné dans une
fenêtre glissante), mais celui-ci ne couvre ni R2, ni la conservation
long terme, ni la restauration vers un compte différent. Par ailleurs
`wrangler d1 export` échoue en présence des tables virtuelles FTS5 utilisées par
la recherche produit : un export global n'est donc pas une base fiable.

## Décision

La sauvegarde est **applicative, table par table**, produite par la CLI, et
comprend :

- les données métier ;
- la version du schéma ;
- l'inventaire des objets R2 ;
- les sommes de contrôle ;
- un chiffrement ;
- un manifeste de restauration.

Les objectifs retenus pour le pilote sont **RPO 24 heures** et **RTO
60 minutes**, avec une restauration testée au moins une fois par trimestre.
Le Time Travel D1 est conservé comme filet de sécurité court terme, jamais
comme sauvegarde de référence.

Une restauration s'effectue **par défaut dans un environnement de staging
vide**. Une restauration vers la production exige une option dédiée et une
confirmation saisie par l'opérateur.

## Conséquences

- une sauvegarde est vérifiable sans être restaurée (sommes de contrôle,
  version de schéma, inventaire R2), ce qui rend `shopctl backup verify`
  possible ;
- la sauvegarde reste lisible indépendamment de Cloudflare : elle peut être
  restaurée dans un autre compte, ce qui est la condition d'une sortie propre
  du client ;
- une sauvegarde contient des données personnelles : elle est chiffrée, sa
  conservation est bornée et sa suppression doit être possible sur demande ;
- la restauration ne peut pas être « presque » testée : le critère de sortie du
  jalon 8 est une restauration complète en staging, comparée à l'origine,
  en moins d'une heure ;
- un rollback applicatif ne restaure pas le schéma : c'est ce qui impose la
  politique de migrations additives (ADR 0006).

## Alternatives écartées

- **Time Travel D1 seul** : fenêtre limitée, périmètre restreint à D1, aucune
  restauration inter-comptes, aucune preuve exportable pour le commerçant.
- **`wrangler d1 export` global** : échoue avec les tables FTS5 et supposerait
  de démonter puis recréer l'index de recherche à chaque sauvegarde.
- **Instantanés d'infrastructure seuls (R2 versioning)** : ne capture pas la
  cohérence entre la base et les objets, et ne porte pas la version de schéma.

## Vérification

- `shopctl backup verify <backup-id>` contrôle sommes, schéma et inventaire ;
- le jalon 8 exige une restauration complète en staging et une comparaison
  avant/après ;
- la section 9 du plan bloque le déploiement lorsque la sauvegarde préalable a
  échoué.
