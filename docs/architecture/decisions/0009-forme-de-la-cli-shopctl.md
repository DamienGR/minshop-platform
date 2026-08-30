# ADR 0009 — Forme, langage et livraison de la CLI `shopctl`

- **Statut** : Accepté
- **Date** : 2026-08-30
- **Jalon** : 2

## Contexte

Le plan §5 décrit `shopctl` comme l'outil unique de création et d'exploitation
des boutiques : création du dépôt, provisioning, catalogue, déploiement,
sauvegarde, mise à niveau du socle et de la flotte. Le jalon 2 en livre la
première tranche (`new`, `doctor`, `config validate`) et doit donc trancher la
forme que prendront toutes les suivantes.

Quatre faits contraignent la décision.

`shopctl` doit s'exécuter **dans deux arbres différents** : dans le socle, pour
créer une boutique, et dans une boutique, pour l'exploiter. Ce sont les deux
seuls endroits où elle tourne, et une boutique est un clone du socle (ADR 0003).

Elle doit **répondre exactement comme la CI**. `npm run config:validate`,
`npm run check:paths` et `npm run check:toolchain` sont déjà les portes que la
CI exécute à chaque commit du jalon 1. Une CLI qui reposerait la même question
avec son propre code finirait par donner une autre réponse, et c'est la CLI que
l'exploitant croit.

Elle est **appelée par des scripts** — CI, mise à niveau de flotte — qui doivent
décider de réessayer ou d'abandonner sans lire de prose anglaise.

Enfin, le §5.1 du plan annonçait « TypeScript » sans que rien, à ce jalon, ne
l'ait mis à l'épreuve. Le `tsconfig.json` de ce dépôt cible le storefront : il
inclut tout l'arbre, épingle `types` aux types Cloudflare Workers et n'a pas
`@types/node`. Un fichier `.ts` d'outillage y échoue à `astro check` faute de
déclarations pour `node:fs` — raison pour laquelle `scripts/` et `test/scripts/`
sont déjà écrits en `.mjs`. Rendre la CLI TypeScript demanderait un second
`tsconfig`, `@types/node`, et soit une étape de build, soit
`--experimental-strip-types` sur chaque invocation.

## Décision

**La CLI est livrée par le socle, jamais publiée.** `shopctl/` est un répertoire
du dépôt, de propriété `core` ; une boutique générée le conserve, comme elle
conserve `scripts/`. Sa version est celle du socle : la CLI qui crée une
boutique depuis le tag `v1.2.0` est celle que ce tag transporte. Point d'entrée
`shopctl/bin/shopctl.mjs`, exposé par `npm run shopctl` et par le champ `bin`.

**Elle est écrite en JavaScript ESM annoté JSDoc, sans dépendance et sans étape
de build**, comme `scripts/`. Aucun `npm install` n'est nécessaire pour que
`shopctl new` fonctionne, ce qui compte : la commande tourne avant qu'il n'y ait
de `node_modules` quelque part.

**Elle enveloppe les portes existantes, elle ne les réimplémente pas.**
`config validate` appelle `scripts/check-manifest.mjs`, `doctor` appelle
`scripts/check-toolchain.mjs`, et la vérification minimale de `new` appelle les
scripts que la **boutique** transporte, pas ceux du socle hôte. Une seule
autorité par question.

**Les codes de sortie font partie du contrat** : `0` succès, `2` ligne de
commande erronée, `3` valeur inutilisable, `4` prérequis d'environnement absent,
`5` commande externe en échec, `6` résultat produit puis refusé par une porte.
Un code ne change jamais de sens ; un nouveau mode de défaillance prend un
nouveau code.

**Aucun secret n'entre par la ligne de commande.** Un argument dont la forme est
celle d'une clé est refusé — il est déjà dans l'historique du shell et dans les
logs de la CI — et toute ligne relayée passe par une rédaction qui réutilise les
motifs du manifeste (`CREDENTIAL_PATTERNS`), jamais une seconde liste.

**`--json` écrit exactement un document sur la sortie standard**, la progression
partant sur la sortie d'erreur.

## Conséquences

- une boutique peut être exploitée avec la CLI de sa propre version du socle,
  hors ligne, sans installer quoi que ce soit ;
- une porte corrigée dans `scripts/` est corrigée pour la CI et pour la CLI en
  même temps, par construction ;
- la CLI n'est pas typée statiquement. Coût accepté et compensé par les tests :
  `test/scripts/shopctl.test.mjs` exécute le binaire réel contre un socle réel
  et fixe les codes de sortie, la forme du rapport JSON et l'arbre généré ;
- `shopctl` n'est pas installable indépendamment du socle. Une agence qui
  voudrait la version 1.3 de la CLI sur une boutique en 1.1 doit d'abord mettre
  la boutique à niveau — ce qui est la propriété recherchée, pas un effet de
  bord ;
- le plan §5.1 est amendé sur ce point : « TypeScript » y devient « JavaScript
  ESM annoté JSDoc ». Un plan qui décrit autre chose que le dépôt est un plan
  qu'on cesse de lire ;
- les commandes des jalons suivants (`provision`, `catalog`, `deploy`, `backup`,
  `core`, `fleet`) héritent de cette forme et de ces codes ; les ajouter ne
  rouvre pas cette décision.

## Alternatives écartées

- **Un paquet npm `shopctl` publié** : ajouterait une matrice version-CLI ×
  version-socle, alors que la CLI applique des règles — noms de ressources,
  ordre de déploiement, format du manifeste — qui appartiennent à une version du
  socle. Une CLI 1.3 pilotant une boutique 1.1 est précisément la panne à
  supprimer par construction.
- **TypeScript avec étape de build** : impose de construire l'outil avant de
  pouvoir créer une boutique, donc `npm install` avant `shopctl new`, dans un
  répertoire qui n'existe pas encore.
- **TypeScript exécuté par `--experimental-strip-types`** : évite le build mais
  demande un second `tsconfig` et `@types/node` uniquement pour l'outillage, et
  laisse le typage hors du contrôle du dépôt tant que `astro check` cible le
  storefront. La contrainte n'est pas le langage, c'est le `tsconfig` unique du
  storefront ; c'est cette contrainte qu'il faudrait lever d'abord.
- **Étendre `create-minshop`** : c'est le générateur public amont. Il supprime
  l'historique Git et retire son propre paquet, exactement l'inverse de ce
  qu'une boutique d'agence exige (ADR 0003). Les deux outils partagent un verbe,
  pas une finalité.
- **Réimplémenter les portes dans la CLI pour un meilleur rendu** : deux réponses
  à une question, et la divergence n'apparaît qu'au moment où elle coûte cher.
- **Codes de sortie 0/1 seulement** : oblige l'appelant à analyser du texte pour
  décider s'il réessaie, ce qui rend une reformulation de message équivalente à
  un changement d'API sans que personne ne le voie.

## Vérification

- `test/scripts/shopctl.test.mjs` exécute `shopctl/bin/shopctl.mjs` contre un
  socle construit depuis l'index de ce dépôt : squelette généré, déterminisme,
  chemin contenant des espaces, répertoire non vide, tag inexistant, ref qui
  n'est pas un tag, absence de secret, codes de sortie, document JSON unique ;
- le test « relays the gate's own report » compare octet pour octet la sortie de
  `shopctl config validate --json` et celle de `scripts/check-manifest.mjs
  --json` : la CLI ne peut pas répondre autrement que la porte ;
- `npm run check:paths` classe `shopctl/` comme `core` et regénère
  `.github/CODEOWNERS` en conséquence ;
- le critère de sortie du jalon 2 — `shopctl new`, puis `npm ci` et
  `npm run verify` dans la boutique générée — exécute la CLI de bout en bout.
