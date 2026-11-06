# ADR 0031 — Des modèles de page déclarés par le thème

- **Statut** : Accepté (fusion de la PR #209 par Damien, le 2026-11-06)
- **Date** : 2026-11-05
- **Jalon** : après le pilote (plan §13.17, ticket #205, lot 3) ; aucun des
  jalons 0 à 10
- **Reprend** : la forme de l'ADR 0027 (les textes du thème), pour les pages
- **Précise** : les invariants 1, 10 et 11 d'`AGENTS.md`, qui ne changent pas

## Contexte

Le ticket #205 (2026-11-05) veut, pour la première boutique réelle, des pages
de présentation à la mise en page précise : « La marque » (une accroche, une
histoire, des engagements) et « Où nous trouver » (des points de vente, chacun
avec son adresse, ses horaires, sa carte). L'étude du même jour retient des
modèles de page imposés par le thème, chaque zone étant du Markdown qui sait
ouvrir une rangée de photos en grand (lot 1, §13.15) et poser du texte en
colonnes (lot 2, ADR 0030).

Ce que le socle savait (v0.6.2 et les lots 1 et 2) :

- une page est un titre et un corps en Markdown (`html: false`, invariant 11),
  dans l'un des gabarits de `PAGE_LAYOUTS` (une largeur, un alignement du
  titre), dessinée par le `ContentPage.astro` du thème ;
- un thème peut déclarer des textes que le marchand modifie
  (`src/themes/<id>/texts.ts`, ADR 0027), trouvés par un glob au travers de
  l'alias `#theme`, et que ses gabarits reçoivent comme `{ text, html }` ;
- l'éditeur d'une page a une barre d'outils, un choix d'images et un aperçu
  rendu par le `renderMarkdown()` de la vitrine ;
- les photos d'une page sont comptées dans `page_media`, dans le même lot
  d'écritures que la décision de publier (invariant 10), et le relais des
  tuiles ne sert que ce qu'une carte publiée dessine (ADR 0029).

## Décision

**Un thème déclare ses modèles dans `src/themes/<id>/pageModels.ts`** (un
tableau `pageModels` de `ThemePageModel`, `src/features/storefront/models.ts`)
**et dessine chacun dans `src/themes/<id>/pages/<clé>.astro`.** Les deux
fichiers sont facultatifs, comme `texts.ts` : un thème qui n'en déclare pas
garde les pages telles qu'elles étaient. Un modèle sans gabarit n'est pas
proposé (le marchand choisirait une page que la vitrine ne sait pas
dessiner), et la suite échoue sur l'une des deux moitiés seule.

**« Basique » est le modèle du socle** : la page telle qu'elle a toujours été,
son corps dans le gabarit choisi, dessinée par `ContentPage.astro`. C'est le
modèle de toute page existante et de toute page nouvelle ; sa clé, `basique`,
est réservée. Une clé que le thème ne déclare plus se lit « Basique ».

**Un modèle, c'est le corps et des zones.** Le corps est celui de toute page
(`body_markdown`) : le modèle le nomme (« L'histoire », « Introduction »).
Une zone est soit un texte, une ligne (`text`) ou du Markdown (`markdown`),
soit une liste (choix de Damien, 2026-11-05, « zone répétable ») : des
entrées de même forme, chacune de quelques champs, que le marchand ajoute,
retire et range. Vingt modèles, vingt zones, dix champs par entrée,
cinquante entrées et 20 000 caractères par texte au plus. La clé d'un modèle
est un nom de fichier ; celle d'une zone ou d'un champ, des lettres et des
chiffres, parce qu'elle entre dans le nom d'un champ du formulaire
(`zone.<zone>.<entrée>.<champ>`).

**Les zones sont rangées à côté du corps, dans la même ligne** (migration
0056) : `pages.model`, la clé du modèle ou `''`, et `pages.zones`, un objet
JSON (un texte est une chaîne, une liste un tableau d'objets de chaînes).
Elles s'écrivent dans le même `UPDATE` que le corps, et les photos qu'elles
montrent sont comptées dans `page_media` dans le même lot (invariant 10).
Tout ce que la page garde est compté, y compris les zones d'un modèle qu'elle
n'utilise plus : quitter un modèle garde ses zones, pour qu'y revenir les
retrouve, et aucune de leurs photos ne peut disparaître entre-temps. Toutes
les zones d'une page tiennent en 200 000 caractères.

**Chaque zone Markdown est rendue comme le corps**, par le même
`renderMarkdown()` et les mêmes options (rangées, colonnes, cartes) :
l'invariant 11 tient. Le gabarit du modèle reçoit un `ModelPageModel`, ce
que reçoit `ContentPage` plus chaque zone `{ text, html }`, comme un texte du
thème, et chaque liste dans l'ordre du marchand. Il ne parse rien et
n'échappe rien.

**Seules les zones du modèle en usage comptent pour la page** : les cartes et
les marques « [À COMPLÉTER] » qu'elles portent retiennent la publication comme
celles du corps, en nommant la zone ; le relais des tuiles sert une tuile
qu'une carte d'une de ces zones dessine ; la description de la page est le
début du corps, sinon celui des zones. Les zones d'un autre modèle sont
gardées et ne dessinent rien.

**Le gabarit fixe la mise en page.** Le choix de la mise en page ne
s'affiche que pour « Basique » ; une page à modèle garde la sienne, pour un
retour.

**L'éditeur sert le modèle que la page a.** Le choix « Modèle » n'apparaît
que si le thème déclare des modèles. Les zones affichées sont celles du
modèle enregistré : en choisir un autre demande d'enregistrer, ce qui garde
un seul chemin, avec ou sans JavaScript. Chaque zone Markdown a l'éditeur du
corps (`src/features/pages/MarkdownEditor.astro`) : barre d'outils, images,
et son propre aperçu (choix de Damien, 2026-11-05, « par zone et page
entière »). Une liste se tient sans script (invariant 1) : « Monter » et
« Descendre » sont des boutons d'envoi du formulaire, qui enregistrent la
page et ramènent à la liste ; une entrée vide, sous « Ajouter », est la
suivante ; « Retirer à l'enregistrement » est une case.

**« Aperçu de la page » montre la page entière sans l'enregistrer** : le
formulaire part, dans un nouvel onglet, vers `/admin/pages/<id>/preview`,
qui le lit comme l'enregistrement le lirait (`parsePageForm`) et le dessine
avec l'en-tête, le pied de page et le gabarit du thème, sous un bandeau
« Aperçu ». La route est derrière la porte de l'administration, et le
contrôle de sécurité la trouve seul (il dérive les routes des fichiers).
Ses cartes passent par le relais de l'administration, comme l'aperçu de
l'éditeur.

**Le thème `atelier` porte deux modèles témoins**, « La marque » et « Où
nous trouver » : la CI du socle les fait tourner dans un vrai navigateur, et
une boutique qui les veut les copie dans son thème. `atelier` est le thème
écrit comme l'écrirait un marchand (plan, jalon 5), classé `client` par
`scripts/path-ownership.mjs` : c'est là qu'un modèle se déclare, alors que les
thèmes réservés (`default`, `studio`, `market`) ne dessinent rien de ce qu'un
modèle de données offre de nouveau. Les deux témoins sont des fichiers
nouveaux, qui ne modifient aucun fichier existant du thème. Une page
« Basique » d'`atelier` ne change pas, ni sa signature. Damien a retenu
`atelier` pour les témoins le 2026-11-06.

## Conséquences

- une migration additive : toute ligne existante est « Basique », sans
  zone ;
- une boutique en `atelier` reçoit les deux modèles à sa montée de version
  (trois fichiers nouveaux, sans conflit) et voit le choix « Modèle » dans
  l'éditeur ; elle les retire en supprimant `pageModels.ts`, qui est à elle ;
- un thème qui change un modèle ne fait rien perdre : une zone retirée est
  gardée ; une zone qui change de forme (un texte devenu liste) se lit vide ;
  au-delà d'un nombre d'entrées abaissé, l'éditeur montre tout et
  l'enregistrement refuse en le disant, plutôt que de laisser tomber une
  entrée que le marchand n'a pas vue partir ;
- le texte des zones est dans une colonne JSON : le plan du site, `llms.txt`
  et les contrôles des pages légales lisent le corps, comme avant ;
- une page à modèle porte un éditeur par zone Markdown, et chacun demande son
  aperçu au serveur tant qu'il est visible ;
- un nouveau bloc (lot 4 : encadré, questions, bouton) vaut dans les zones
  comme dans le corps ; limiter les blocs qu'une zone accepte est remis à
  plus tard.

## Alternatives écartées

- **Une table `page_zones`** (une ligne par zone et par entrée) : des
  jointures pour quelques kilo-octets de texte par page, et l'ordre, les
  photos comptées et l'enregistrement d'un seul tenant à refaire en
  plusieurs requêtes, là où une colonne s'écrit dans le même `UPDATE` que le
  corps.
- **Des zones écrites dans le corps** (`::: accroche`) : pas de formulaire,
  le marchand écrit la structure à la main, et un gabarit ne peut pas placer
  une zone hors du fil du texte.
- **Des modèles fournis par le socle** : une mise en page est du design, et
  le socle l'imposerait à toutes les boutiques.
- **Un constructeur de pages** (des sections à glisser) : du JavaScript lourd
  dans l'administration, une page qui n'est plus du Markdown, et l'aperçu ne
  serait plus le rendu de la vitrine.
- **Afficher par script les zones d'un modèle dès qu'on le choisit** : sans
  JavaScript l'éditeur ne le pourrait pas, et deux chemins pour un même
  choix finissent par diverger.
- **Des témoins dans les fixtures seulement** : rien ne les ferait tourner
  dans un navigateur, et la première boutique les découvrirait seule.

## Vérification

- `src/features/pageModels/declaration.test.ts` et `zones.test.ts` : les
  règles d'une déclaration, la lecture de la colonne, le formulaire de
  l'éditeur (zones gardées, entrées vides ou retirées, ordre, longueurs,
  nombre d'entrées), ce que reçoit le gabarit ;
- `src/features/pages/form.test.ts` et `view.test.ts` : le modèle choisi ou
  gardé, la page que la vitrine dessine, sa lightbox, sa description, les
  tuiles que le relais sert ;
- `test/storefront/pageModels.test.ts` : chaque thème déclare selon les
  règles et dessine chaque modèle déclaré, et chaque gabarit montre le titre,
  le corps et chaque zone, rien d'une zone vide, sans balisage venu d'une
  ligne de texte ;
- `test/integration/page-models.mjs`, sur un D1 réel : les zones écrites avec
  le corps, leurs photos comptées et protégées, même hors du modèle en usage,
  les cartes et marques d'une zone qui retiennent un brouillon ;
- `test/browser/page-models.spec.mjs`, sur le Worker construit en `atelier` :
  les deux modèles en vitrine, l'aperçu propre à une zone, la liste rangée,
  allongée et raccourcie, l'aller-retour par « Basique », l'aperçu de la page
  entière sans enregistrement ; `a11y.spec.mjs` et `responsive.spec.mjs`
  passent sur les deux pages témoins.
