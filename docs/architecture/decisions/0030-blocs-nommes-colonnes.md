# ADR 0030 — Des blocs nommés dans les pages : le texte en colonnes

- **Statut** : Accepté (fusion de la PR #207 par Damien, le 2026-11-05)
- **Date** : 2026-11-05
- **Jalon** : après le pilote (plan §13.16, ticket #205, lot 2) ; aucun des
  jalons 0 à 10
- **Précise** : l'invariant 11 d'`AGENTS.md` (corps de page en Markdown,
  `html: false`), qui ne change pas

## Contexte

Le ticket #205 (2026-11-05) veut des pages mises en forme plus librement :
des colonnes, une galerie qui s'ouvre en grand. L'étude du même jour retient
des modèles de page déclarés par le thème (lot 3), dont chaque zone est du
Markdown qui sait, en plus, deux choses : la lightbox des rangées de photos
(lot 1, §13.15) et des blocs nommés, dont le premier est le texte en colonnes.

Ce que le socle savait (v0.6.2) :

- un corps de page est du Markdown rendu avec `html: false` (invariant 11) :
  un `<div>` écrit par le marchand s'affiche comme du texte, et c'est voulu ;
- deux formes y deviennent déjà du balisage que le socle écrit : le bloc de
  code « carte » (ADR 0029) et le titre d'image `"gauche"` ou `"droite"`
  (ticket #195), chacun par une liste fermée ;
- l'aperçu de l'éditeur appelle le même `renderMarkdown()` que la vitrine, et
  une ligne cliquée dans l'aperçu ramène à sa ligne du texte
  (`data-source-line`) ;
- un bloc de code ne contient que du texte : une colonne doit pouvoir porter
  des titres, des listes, des photos, une carte.

## Décision

**Un bloc nommé s'ouvre par `::: nom` sur une ligne à lui, se ferme par
`:::` seul**, et ce qui est entre les deux est du Markdown comme le reste de la
page. Le seul nom aujourd'hui est `colonnes`, dont une ligne `::: colonne`
sépare les colonnes (choix de Damien, 2026-11-05) :

    ::: colonnes
    ## L'atelier
    Un texte, une photo, une liste…

    ::: colonne
    ## Les matières
    …
    :::

**Les noms forment une liste fermée, en français** comme l'administration
(`src/features/pages/blocks.ts`). Tout autre `::: mot` n'est pas un bloc et
reste le texte qu'il était : une faute de frappe se voit sur la page, et un
nom ajouté plus tard ne change pas une page écrite avant. Le mot se lit sans
égard à la casse, avec ou sans espace après les deux-points.

**Le balisage est celui que le module écrit, jamais le texte du marchand** :
un `<div class="markdown-columns markdown-columns--2">` autour de
`<div class="markdown-column">`, des classes tirées de listes fermées. Les
proportions de deux colonnes se disent après le mot, `1/2` (une étroite puis
une large) ou `2/1` ; toute autre valeur donne des colonnes égales et
n'atteint jamais le balisage. L'invariant 11 tient.

**Trois colonnes au plus.** Au-delà, dans la mesure standard d'une page, une
colonne n'aurait plus que 11rem. Une quatrième passe à la ligne au lieu de
serrer les autres.

**Sous 640 pixels, les colonnes se suivent**, dans l'ordre où elles sont
écrites, chacune de la largeur du texte (`src/styles/base.css`). Au-delà,
elles se tiennent côte à côte, en grille CSS. Aucun script.

**Une colonne est une page de sa largeur** : une photo seule y passe à gauche
ou à droite de son texte, une rangée de photos s'y aligne et s'ouvre en grand,
une carte s'y dessine, comme dans le corps. Une colonne garde ses flottants.

**Ce qui ne s'imbrique pas reste du texte** : un bloc de colonnes dans une
colonne s'affiche tel qu'il est écrit, et son `:::` ferme ce bloc-là, pas le
bloc extérieur. Un bloc de code garde tout ce qu'il contient, `:::` compris.
Un bloc non fermé court jusqu'à la fin de la page, comme un bloc de code. Une
ligne `::: colonnes` juste sous une phrase ouvre le bloc, comme une clôture
de code.

**Un bloc mal formé se dessine quand même** et ne retient pas la page en
brouillon, à la différence d'une carte illisible (ADR 0029), qui ne dessine
rien : ici, rien n'est perdu, le texte s'affiche dans la colonne qui le
porte. L'aperçu dit au-dessus du bloc ce qui ne va pas, ligne par ligne :
une seule colonne, plus de trois, des proportions inconnues ou qui ne valent
que pour deux colonnes. La vitrine ne le dit pas.

**Le bouton « Colonnes » de l'éditeur** insère un bloc de deux colonnes, la
première phrase d'exemple sélectionnée : taper la remplace.

**Les pages seulement.** `renderMarkdown()` ne lit les blocs que si on lui
passe l'option `blocks` : la page publiée, son aperçu, et demain les zones
d'un modèle de page (lot 3). La description d'un produit et les textes d'un
thème gardent `::: colonnes` pour du texte. Le lecteur derrière la
description de la page (`markdownExcerpt`), les images qu'elle utilise
(`extractMediaKeys`) et ses cartes (`placeMapBlocks`) connaît les blocs quel
que soit l'appelant : une ligne `::: colonnes` n'est jamais un mot de la
méta-description, et une photo dans une colonne est une photo de la page.

## Conséquences

- aucune migration, aucune route, aucune dépendance : une règle de bloc de
  markdown-it écrite dans le socle, une feuille de style, un bouton ;
- un nouveau bloc (encadré, questions, bouton : lot 4) est un nom de plus
  dans `blocks.ts`, sa règle, ses classes et sa section du guide ;
- **le texte d'une page en colonnes se lit mal ailleurs** : un lecteur
  Markdown qui ignore la syntaxe montre les lignes `:::` au milieu du texte.
  C'est le prix d'une syntaxe qui garde du Markdown dans chaque colonne ;
- la syntaxe ressemble à celle de `markdown-it-container` et de Pandoc
  (`::: nom`), sans en être : le séparateur `::: colonne` est propre au socle ;
- un bloc s'ouvre aussi dans un élément de liste ou une citation, comme une
  clôture de code, et une ligne moins indentée que lui le ferme : le guide ne
  le montre pas, mais rien ne casse ;
- le marchand qui veut quatre colonnes ou d'autres proportions ne les a pas :
  la liste est fermée, et l'élargir est une décision du socle.

## Alternatives écartées

- **Un bloc de code « colonnes »**, sur le modèle de la carte : une seule
  syntaxe de bloc dans les pages, mais un bloc de code ne contient que du
  texte, et une colonne doit porter des titres, des listes, des photos.
- **Le paquet `markdown-it-container`** : la même syntaxe d'ouverture, mais
  une dépendance de plus pour une règle de cent lignes, sans le séparateur
  entre colonnes ni la profondeur des blocs, qu'il aurait fallu écrire en
  plus.
- **Le HTML dans le corps** (`html: true` pour des `<div>` autorisés) : rouvre
  ce que l'invariant 11 ferme, et un assainisseur côté serveur est une
  surface de plus qu'une liste fermée de noms n'a pas.
- **Un éditeur visuel** (blocs à glisser) : une bibliothèque lourde dans
  l'administration, une représentation de la page qui n'est plus du
  Markdown, et l'aperçu ne serait plus le rendu de la vitrine.
- **Des colonnes par le thème seulement**, sans syntaxe dans le corps : c'est
  le lot 3 pour une mise en page imposée, mais une page « Basique » n'aurait
  alors aucun moyen de poser deux textes côte à côte.

## Vérification

- `src/features/pages/blocks.test.ts` fixe la lecture et le rendu : deux et
  trois colonnes, les proportions et leur liste fermée, la casse du mot, le
  bloc de code gardé entier, le bloc imbriqué laissé en texte sans fermer
  l'autre, le bloc non fermé, l'ouverture sous une phrase, les autres mots
  laissés en texte, l'indentation de quatre espaces, les photos et les
  rangées dans une colonne, les lignes source pour l'éditeur, ce que
  l'aperçu dit et que la vitrine tait, l'extrait, les images et les cartes
  d'une page en colonnes ;
- `test/browser/page-columns.spec.mjs`, sur le Worker construit : les
  colonnes côte à côte dans les proportions dites, l'une sous l'autre sur
  téléphone, le bouton « Colonnes » et sa sélection, l'aperçu qui dit le
  problème d'un bloc ;
- `test/browser/a11y.spec.mjs` passe sur la page en colonnes du jeu d'essai.
