# `shopctl`

L'outil d'agence : créer le dépôt d'une boutique depuis un tag du socle, puis
l'exploiter. Livré **par** le socle et versionné **avec** lui — la CLI qui crée
une boutique depuis le tag `v1.2.0` est celle que ce tag transporte
([ADR 0009](../docs/architecture/decisions/0009-forme-de-la-cli-shopctl.md)).

```sh
npm run shopctl -- <commande> [options]     # depuis un arbre du socle ou d'une boutique
node shopctl/bin/shopctl.mjs <commande>     # sans passer par npm
```

Aucune dépendance, aucune étape de build : `shopctl new` tourne avant qu'il n'y
ait un `node_modules` où que ce soit.

## Commandes livrées (jalon 2)

| Commande | Rôle |
| --- | --- |
| `shopctl new <slug>` | Crée le dépôt d'une boutique depuis un tag du socle. |
| `shopctl doctor` | Outils, arbre courant, prérequis de provisioning, checklist humaine. |
| `shopctl config validate` | Valide les manifestes de l'arbre courant. |

Les commandes `provision`, `catalog`, `verify`, `deploy`, `backup`, `restore`,
`core` et `fleet` sont décrites au plan §5 et arrivent aux jalons suivants.

## `shopctl new`

```sh
npm run shopctl -- new acme \
  --core v1.0.0 \
  --origin git@github.com:agence/shop-acme.git \
  --name "Boutique Acme" \
  --domain acme.fr
```

`acme` ici, et pas un nom qui pourrait être celui d'un vrai client : ce fichier
est de propriété `core`, et `config:validate` échoue sur tout fichier du cœur
contenant le slug ou le nom affiché d'une boutique. Un exemple plausible serait
une mine pour le premier client qui choisirait ce nom-là — il verrait échouer un
fichier auquel il n'a jamais touché. Les slugs que la documentation emploie sont
donc réservés (`RESERVED_SLUGS`), et le test « core documentation only uses
reserved example slugs » le vérifie.

Elle clone **un tag**, **avec son historique**, renomme le remote du socle en
`core`, crée la branche de travail, écrit le manifeste et le thème de la
boutique, rend `wrangler.jsonc` depuis le manifeste, exécute les portes que la
boutique transporte, commite, installe les dépendances, puis liste les actions
suivantes.

Trois propriétés valent d'être connues avant de lire le code.

**Le manifeste est validé avant le clone.** Toutes les valeurs qu'une boutique
choisit sont sur la ligne de commande ; une valeur inutilisable doit coûter un
message, pas un répertoire, un historique Git et une porte rouge.

**Un ref qui n'est pas un tag `v<semver>` est refusé.** Une boutique ne suit
jamais une branche flottante (ADR 0003), et une branche se clone parfaitement —
la panne ne se verrait qu'à la première mise à niveau.

**Rien n'est supprimé du clone.** `create-minshop`, le générateur public amont,
retire l'historique et son propre paquet ; ici chaque fichier retiré à la
création serait un conflit à re-résoudre à chaque mise à niveau qui y touche.

Ce que le périmètre certifié fixe — locale, devise, marché, juridiction, mode de
checkout — n'a pas d'option : élargir une de ces énumérations est une décision
de version de schéma ([ADR 0008](../docs/architecture/decisions/0008-format-du-manifeste-client.md)).

## Conventions

**Enveloppe, ne réimplémente pas.** `config validate` appelle
`scripts/check-manifest.mjs`, `doctor` appelle `scripts/check-toolchain.mjs`, et
la vérification de `new` appelle les scripts que la **boutique** transporte. Une
CLI qui reposerait la question avec son propre code finirait par donner une
autre réponse que la CI — et c'est la CLI que l'exploitant croit.

**Codes de sortie stables**, parce que l'appelant est souvent un script :

| Code | Sens |
| --- | --- |
| `0` | Succès. |
| `2` | Ligne de commande erronée : commande ou option inconnue, valeur manquante. |
| `3` | Valeur inutilisable : slug réservé, slug que le cœur emploie déjà, tag qui n'en est pas un. |
| `4` | Prérequis absent : répertoire occupé, `git` manquant, pas d'identité Git. |
| `5` | Commande externe en échec (`git`, `npm`, `wrangler`). |
| `6` | Résultat produit puis refusé par une porte. L'arbre est laissé en place. |

**`--json` écrit exactement un document sur la sortie standard** ; la
progression part sur la sortie d'erreur, y compris en cas d'échec — un rapport
d'erreur JSON reste un JSON valide.

**Aucun secret n'entre par la ligne de commande.** Un argument dont la forme est
celle d'une clé est refusé : il est déjà dans l'historique du shell et dans les
logs de la CI. Les motifs sont ceux du manifeste, importés et non recopiés.

## Tests

`test/scripts/shopctl.test.mjs`, exécuté par `npm test` et par `npm run verify`.
Il construit un socle réel depuis l'index de ce dépôt, le tague, et fait tourner
le vrai binaire contre lui.
