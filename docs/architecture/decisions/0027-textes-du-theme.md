# ADR 0027 — Les textes du thème, déclarés par le thème et écrits par le marchand

- **Statut** : Proposé
- **Date** : 2026-11-03
- **Jalon** : après le pilote (plan §13.8) ; aucun des jalons 0 à 10

## Contexte

Le ticket #165 (2026-11-03) vient de la recette de la première boutique réelle :
la marchande doit pouvoir changer les textes de son accueil — le titre,
l'accroche, les titres et textes des blocs (« Né à l'atelier, à Bouillac »,
« La carte cadeau », « Le sur-mesure ») — sans pull request ni déploiement. Ces
textes étaient écrits dans le gabarit `Catalog.astro` du thème de la boutique.

Le ticket proposait deux formes : des emplacements de texte déclarés par le
thème, éditables dans une page de l'admin ; ou des blocs adossés aux pages, le
thème nommant des pages par leur slug et le socle exposant leur contenu rendu.
Ce que le socle savait (v0.4.0) :

- un thème appartient à la boutique, et le socle ne le modifie jamais
  (`scripts/path-ownership.mjs`) : rien d'obligatoire ne peut y être ajouté
  sans casser chaque thème à la mise à niveau ;
- un thème ne lit que ses modèles, jamais la base ni la requête ;
- le corps d'une page est du Markdown rendu avec `html: false`
  (invariant 11) ; une page publiée a une URL, entre au plan du site et dans
  `llms.txt` ;
- l'accueil est en cache à l'arête, sous les étiquettes `shell` et `catalog`.

## Décision

**Des emplacements déclarés par le thème** (choix de Damien, 2026-11-03).

**La déclaration est un fichier facultatif du thème**,
`src/themes/<id>/texts.ts`, qui exporte `texts` : pour chaque emplacement une
clé, un libellé et une aide pour l'admin (en français, pour le marchand), un
texte par défaut, une longueur maximale (5 000 caractères au plus) et un
format, `text` (une ligne) ou `markdown`. Le type `ThemeTextSlot` est dans les
modèles de vitrine, que le thème a déjà le droit d'importer. Le socle lit le
fichier du thème actif par un glob sur l'alias `#theme`
(`src/features/themeTexts/active.ts`) : un thème sans fichier ne lit rien et ne
change pas.

**La base ne garde que ce que le marchand a écrit** (migration 0054,
`theme_texts`) : une ligne par emplacement modifié. Un champ vidé, ou laissé au
texte par défaut, supprime la ligne : le texte par défaut revient, et suit le
thème quand sa formulation change.

**Admin → Textes du thème** montre un champ par emplacement, prérempli de ce
que la vitrine affiche, avec la limite et le texte par défaut. L'entrée du menu
n'existe que si le thème déclare des textes. Un texte trop long refuse tout le
formulaire, avec un message qui nomme le champ et la limite ; une image de la
médiathèque dans un texte Markdown aussi, parce qu'elle n'y serait pas comptée
comme utilisée (invariant 10). L'enregistrement purge `shell` et `catalog`.

**Le thème reçoit `model.texts`**, sur le modèle du catalogue (l'accueil) :
chaque clé déclarée, `{ text, html }`, `html` étant le Markdown rendu par
`renderMarkdown()` avec `html: false`, `null` pour un texte d'une ligne. La
lecture rejoint le lot D1 du catalogue, et n'a lieu que si le thème déclare des
textes.

**Le socle tient chaque déclaration sur le disque aux mêmes règles**
(`test/storefront/themeTexts.test.ts`) : clés, libellés, formats, défaut écrit
comme il serait stocké et pas plus long que la limite. Une boutique qui en
livrerait une fautive quand même garde les emplacements valides plutôt qu'un
accueil cassé.

## Conséquences

- la marchande change ses textes sans déploiement ; le développeur du thème
  choisit lesquels, leur longueur et leur forme, et le gabarit reste le seul
  endroit qui décide où ils vont ;
- une clé renommée dans un thème est un texte qui revient au défaut sans
  erreur : les lignes des clés qui ne sont plus déclarées restent en base,
  ignorées, et reviennent si la clé revient. `CUSTOMIZING.md` demande de garder
  une clé une fois que le marchand y a écrit ;
- un thème qui abaisse une limite rend trop long un texte déjà enregistré : la
  vitrine affiche alors le défaut, et l'admin le signale et montre le texte à
  raccourcir ;
- les textes ne sont exposés qu'à l'accueil (`Catalog.astro`, qui rend `/` et
  `/products`). Les ouvrir à l'en-tête, au pied de page ou à la fiche produit
  est une extension du modèle, pas une nouvelle décision ;
- un texte n'a ni URL, ni historique, ni brouillon : c'est un réglage de
  vitrine, pas un contenu éditorial.

## Alternatives écartées

- **Des blocs adossés aux pages** : réutilise l'éditeur de pages, mais mêle les
  pages publiques et des fragments. Un fragment publié aurait une URL, une
  entrée au plan du site et dans `llms.txt` ; dépublié, il disparaîtrait de
  l'accueil. Ni limite de longueur par bloc, ni texte par défaut tenu par le
  thème. Écarté par Damien.
- **Un fichier `texts.ts` obligatoire dans chaque thème** : la mise à niveau du
  socle casserait la construction de chaque boutique dont le thème ne l'a pas.
- **Des emplacements fixés par le socle** (« titre de l'accueil »,
  « accroche ») : chaque thème a sa propre mise en page ; le socle ne peut pas
  savoir combien de blocs l'accueil d'une boutique contient.
- **Stocker le texte par défaut en base à la première visite** : figerait la
  formulation du thème au jour du déploiement, et un nouveau défaut ne
  passerait plus.

## Vérification

- `src/features/themeTexts/slots.test.ts` fixe les règles de déclaration, la
  normalisation, le refus d'un texte trop long ou d'une image, le retour au
  défaut, le rendu sans HTML ;
- `test/storefront/themeTexts.test.ts` tient chaque thème du disque aux règles,
  vérifie que le thème actif est celui qui est lu, et rend un gabarit qui lit
  ses textes (valeur, défaut, échappement), et les thèmes livrés à l'identique ;
- `test/integration/theme-data.mjs`, sur une vraie D1 : défauts, texte
  enregistré puis vidé, refus sans écriture, lecture dans le lot du catalogue.
