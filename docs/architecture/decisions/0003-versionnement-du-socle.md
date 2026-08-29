# ADR 0003 — Versionnement du socle et stratégie Git

- **Statut** : Accepté
- **Date** : 2026-08-28
- **Jalon** : 0

## Contexte

Chaque boutique est un dépôt distinct issu du socle (ADR 0001) et doit pouvoir
recevoir les correctifs du socle pendant toute la durée du contrat, sans perdre
ses personnalisations (thème, manifeste, contenus).

Trois mécanismes de partage sont envisageables : un paquet npm consommé par
chaque boutique, un sous-module Git, ou un historique Git commun avec des
remotes multiples. Le socle n'est pas une bibliothèque : il contient des
routes, des migrations, un thème et une configuration de déploiement,
c'est-à-dire l'application entière. Un paquet ne peut pas livrer cela sans
réintroduire une couche de génération à chaque mise à jour.

## Décision

Une boutique est créée en **clonant un tag immuable du socle avec son
historique Git**. Le dépôt de la boutique conserve deux remotes :

```text
origin  -> dépôt de la boutique
core    -> dépôt du socle
```

Le socle est versionné en **SemVer** et publié sous forme de **tags immuables**
(`v1.0.0`). Le manifeste de la boutique déclare la version consommée
(`coreVersion`). Une boutique ne suit jamais une branche flottante comme
`main` : la mise à niveau consiste à récupérer un tag et à le fusionner, sur
une branche, derrière une pull request validée par un humain.

Un tag publié n'est jamais déplacé ni supprimé. Une erreur dans une version
donne lieu à une version corrective.

## Conséquences

- la mise à jour d'une boutique est un merge Git ordinaire : les conflits
  apparaissent là où la boutique a réellement divergé, et l'historique commun
  permet à Git de résoudre tout le reste ;
- une boutique peut rester volontairement sur une version antérieure ; la
  flotte n'est jamais mise à jour d'un bloc ;
- le socle doit garder une frontière nette entre fichiers cœur, client et
  générés (plan §3.3), sans quoi chaque mise à jour produit des conflits dans
  les fichiers du client ;
- toute modification incompatible du socle exige une version majeure et des
  notes de migration ;
- le dépôt du socle doit conserver l'historique Minshop amont, sans quoi la
  reprise des correctifs amont deviendrait manuelle.

## Alternatives écartées

- **Paquet npm `@agence/minshop-core`** : impossible de livrer routes,
  migrations et configuration de déploiement par une dépendance sans construire
  une couche de génération complète ; les conflits deviennent invisibles
  jusqu'à l'exécution.
- **Sous-module Git** : sépare le cœur du reste de l'arbre, mais interdit à une
  boutique de personnaliser un fichier du cœur, y compris temporairement pour
  un correctif urgent ; l'ergonomie des sous-modules est par ailleurs une
  source d'erreurs d'exploitation.
- **Suivi de la branche `main` du socle** : rend une boutique dépendante d'un
  état non certifié et supprime la notion de version supportée.

## Vérification

- `shopctl core status` compare la version du manifeste au tag effectivement
  fusionné ;
- `shopctl fleet status` produit le rapport de versions de la flotte et signale
  le drift ;
- le jalon 9 vérifie la mise à jour des deux boutiques témoins, thème et
  manifeste inchangés.
