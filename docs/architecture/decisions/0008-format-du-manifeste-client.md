# ADR 0008 — Format et autorité du manifeste client

- **Statut** : Accepté
- **Date** : 2026-08-30
- **Jalon** : 1

## Contexte

L'ADR 0001 décide qu'une boutique est décrite par un manifeste
`client/client.yaml` et l'ADR 0003 que ce manifeste déclare la version du socle
consommée. Ni l'un ni l'autre ne dit comment ce fichier est lu ni ce qui décide
qu'il est valide, et le jalon 1 devait trancher pour pouvoir l'implémenter.

Trois faits contraignent la décision.

Le manifeste est le **seul fichier qu'un commerçant ou un exploitant modifie à
la main** avant que quoi que ce soit ne touche un compte Cloudflare. Ses valeurs
deviennent des noms de Worker, de base D1 et de buckets R2 : une mauvaise
lecture ne produit pas une erreur, elle produit une ressource au mauvais nom.

Il est **committé**, donc publié à tous les clones du dépôt de la boutique et
lisible par quiconque y a accès.

Il doit enfin être lu par au moins trois consommateurs qui ne partagent pas de
runtime : les scripts de build, la CI, et la CLI `shopctl` du jalon 2 — plus les
éditeurs des développeurs, qui ne savent valider que du JSON Schema.

## Décision

**Le lecteur YAML est écrit dans le dépôt et refuse tout ce qu'il ne comprend
pas.** `scripts/manifest-yaml.mjs` accepte le sous-ensemble que le manifeste
utilise — mappings imbriqués de scalaires, indentation à deux espaces,
commentaires — et lève une erreur avec un numéro de ligne sur tout le reste :
séquences, ancres, alias, collections en flux, scalaires multi-lignes, documents
multiples, tabulations, clés répétées. Les mots nus que YAML 1.1 résout en
booléens ou en `null` (`no`, `yes`, `on`, `off`, `null`, `~`) sont refusés dans
les deux sens : ni booléen, ni chaîne.

**La spécification des champs est l'autorité ; le JSON Schema en est généré.**
`scripts/manifest-schema.mjs` porte les champs, leurs types et les règles
inter-champs ; `schemas/client-<n>.schema.json` est rendu à partir d'elle,
committé pour les éditeurs, et contrôlé contre la dérive à chaque `verify`.

**Les énumérations mono-valuées sont un garde-fou de périmètre.** `locale`,
`currency`, `market` et `jurisdiction` n'acceptent aujourd'hui qu'une valeur.
Élargir l'une d'elles passe par une version de schéma et des notes de migration.

**Les noms de ressources Cloudflare sont dérivés, pas configurés.** Le manifeste
déclare `cloudflare.workerName` ; la base, les deux buckets et le namespace KV
en découlent par suffixe.

## Conséquences

- une erreur de syntaxe est signalée à la ligne où elle est écrite, avant tout
  appel distant, et jamais réinterprétée en une valeur plausible ;
- le manifeste ne peut pas exprimer une structure que le schéma ignore : ce qui
  s'y écrit est ce qui est lu ;
- `<workerName>*` est l'empreinte complète d'une boutique dans un compte, donc
  une liste de ressources est lisible et `destroy-cf.sh` retire tout ;
- le socle porte un lecteur YAML de plus à maintenir. Coût accepté : il ne
  couvre qu'un format que le socle définit lui-même, et son périmètre est fixé
  par le schéma, pas par la spécification YAML ;
- un marché non couvert par les énumérations exige une version de schéma. C'est
  volontairement plus lourd qu'un champ libre : c'est la différence entre un
  marché supporté et un marché non testé ;
- une boutique ne peut pas nommer sa base D1 indépendamment de son Worker, même
  pour une migration. Une telle opération demandera une décision explicite.

## Alternatives écartées

- **Une dépendance YAML de npm** (`yaml`, `js-yaml`) : lit correctement bien
  plus que ce dont le manifeste a besoin, et c'est le problème. `market: NO`
  devient le booléen faux, une ancre se déplie en une valeur que personne n'a
  tapée, et une clé répétée écrase silencieusement la première. Sur un fichier
  dont les valeurs deviennent des noms de ressources, la tolérance du lecteur
  est une surface de panne, pas une commodité. S'y ajoute une dépendance de plus
  dans le chemin de toutes les portes de CI.
- **JSON ou TOML plutôt que YAML** : supprimerait le problème d'analyse, mais
  l'ADR 0001 a retenu YAML pour un fichier destiné à être lu et modifié à la
  main, et JSON n'a pas de commentaires — or les commentaires du manifeste
  portent les raisons d'un choix de périmètre.
- **Le JSON Schema comme autorité, interprété à l'exécution** : imposerait soit
  une bibliothèque de validation, soit l'implémentation d'un sous-ensemble de
  JSON Schema, et laisserait les règles inter-champs sans support — aucune ne
  s'exprime en JSON Schema. Elles seraient donc écrites deux fois de toute façon.
- **Deux documents écrits à la main, schéma et validateur** : ils divergent, et
  la divergence annonce à l'éditeur un champ que le validateur refuse. C'est
  l'éditeur que le commerçant croit.
- **Noms de ressources déclarés champ par champ** : n'achète rien qu'une
  dérivation ne donne, et retire la propriété sur laquelle l'exploitation
  repose — qu'un préfixe désigne exactement une boutique.

## Vérification

- `npm run config:validate` valide tous les manifestes de l'arbre, refuse deux
  boutiques revendiquant un même identifiant, et échoue si
  `schemas/client-<n>.schema.json` ne correspond plus à la spécification ;
- `test/scripts/manifest.test.mjs` couvre le sous-ensemble accepté et chaque
  construction refusée, les règles inter-champs, la compatibilité de version, et
  vérifie que le schéma publié est bien celui que la spécification génère ;
- la porte est dans `npm run verify`, donc dans la CI de chaque commit.
