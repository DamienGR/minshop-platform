# ADR 0026 — Des étiquettes libres sur les produits, que le thème lit

- **Statut** : Proposé
- **Date** : 2026-11-03
- **Jalon** : après le pilote (plan §13.8) ; aucun des jalons 0 à 10

## Contexte

Le ticket #159 (2026-11-03) vient de la recette de la première boutique réelle :
sa fiche produit dit « cousu main », sauf pour les quelques produits qui ne le
sont pas, et son accueil met un badge sur les nouveautés. Le thème de la
boutique écrivait la mention en dur ; le modèle de vitrine ne portait rien
qu'il puisse lire pour l'adapter à un produit.

Deux formes étaient possibles : une case par besoin (« fait main » sur la fiche
produit), ou des étiquettes libres que le socle ne comprend pas et que le thème
interprète. Ce que le socle savait (v0.4.0) :

- un thème ne lit que les modèles de vitrine (`src/features/storefront/models.ts`),
  jamais une ligne de la base, et il appartient à la boutique ;
- les listages lisent `products.*` : une colonne de plus y arrive sans jointure ;
- l'import CSV (`shopctl catalog`) a deux copies des règles pures qu'il partage
  avec le Worker, épinglées sur un corpus commun (`slugify()`, le lecteur de
  dimensions d'image).

## Décision

**Des étiquettes libres** (choix de Damien, 2026-11-03). Un produit porte une
liste d'étiquettes ; le socle ne leur donne aucun sens, le thème décide
(`non-cousu` retire la mention, `nouveau` dessine un badge).

**Une étiquette est un identifiant, tenu à la règle des slugs** : « Non cousu »
devient `non-cousu`, des deux côtés (`normalizeTags()` dans
`src/features/products/tags.ts` et dans `shopctl/src/catalog/contract.mjs`,
épinglés l'un à l'autre). Un thème compare donc des chaînes exactes, sans
casse ni accent à deviner. 40 caractères au plus par étiquette, 20 étiquettes
au plus par produit ; ce qui ne donne rien (« !!! ») est refusé, jamais
ignoré en silence.

**Une colonne, `products.tags`** (migration 0053), la liste jointe par des
virgules (un slug n'en contient pas). Chaque listage la lit déjà ; aucune
table de liaison, aucune lecture de plus.

**Le modèle les expose telles quelles** : `ProductCardModel.tags` et
`ProductDetailModel.tags`, des slugs, `[]` sans étiquette. Les thèmes livrés
n'en affichent rien.

**L'import a une colonne facultative `tags`**, séparée par « | » comme les
catégories. Absente, les étiquettes de la boutique restent : un fichier écrit
avant elle ne peut pas effacer ce que le marchand a posé dans l'admin.
Présente, le fichier dit vrai, et une cellule vide les retire.

## Conséquences

- un besoin de vitrine de plus (« édition limitée », « précommande ») ne
  demande ni migration ni version du socle : le marchand ajoute l'étiquette, le
  thème de la boutique la lit ;
- le sens d'une étiquette vit dans le thème, pas dans le socle : deux
  boutiques peuvent utiliser `nouveau` différemment, et rien ne vérifie qu'un
  thème connaît les étiquettes que le marchand tape ;
- l'étiquette n'est ni un filtre du catalogue, ni une donnée de l'API
  publique `/api/products`, ni un critère de recherche : la porter ailleurs que
  dans le modèle de vitrine sera une décision à part ;
- renommer une étiquette, c'est la changer produit par produit (ou par
  l'import) : il n'y a pas de liste d'étiquettes à administrer.

## Alternatives écartées

- **Une case « fait main »** : répond au cas d'Artisagna et à lui seul ; le
  badge « nouveau » en demandait déjà une deuxième, et chaque besoin suivant une
  migration du socle pour un affichage qui appartient au thème. Écarté par
  Damien.
- **Une table `product_tags`** : une jointure sur chaque listage, que D1 facture
  aux lignes lues, pour vingt étiquettes au plus par produit qu'aucune requête
  ne filtre.
- **Garder le texte tel que tapé** (« Non cousu ») : le thème devrait
  normaliser lui-même, et l'import et l'admin produiraient deux chaînes pour
  une étiquette.

## Vérification

- `src/features/products/tags.test.ts` fixe la normalisation, les refus, le
  stockage et la lecture tolérante ;
- `test/scripts/catalog.test.mjs` épingle les deux `normalizeTags()` sur un
  corpus commun, et importe pour de vrai : colonne absente, étiquettes
  gardées et aucune instruction ; colonne vide, étiquettes retirées ;
- `test/storefront/productCard.test.ts` et `productDetailLoader.test.ts`
  fixent le modèle, et le rendu inchangé de la carte livrée ;
- `test/integration/theme-data.mjs`, sur une vraie D1 : l'étiquette posée
  arrive sur les cartes, le produit mis en avant et les résultats de recherche.
