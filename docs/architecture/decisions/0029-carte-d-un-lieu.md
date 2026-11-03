# ADR 0029 — La carte d'un lieu dans une page, tuiles relayées par la boutique

- **Statut** : Proposé (PR du ticket #163)
- **Date** : 2026-11-03
- **Jalon** : après le pilote (plan §13.10) ; aucun des jalons 0 à 10
- **Précise** : l'invariant 11 d'`AGENTS.md` (corps de page en Markdown,
  `html: false`), qui ne change pas

## Contexte

Le ticket #163 (2026-11-03) vient de la recette de la première boutique
réelle : sa page « Où me trouver » montre sur le site actuel une carte Google
Maps par point de vente. Les pages du socle sont du Markdown rendu avec
`html: false` (invariant 11) : ni iframe ni script ne peuvent y entrer, et
c'est voulu, puisque même une session d'administration volée ne peut pas
injecter de code dans la vitrine.

Le ticket laissait deux voies à trancher : un bloc « carte » reconnu par
`renderMarkdown()` et rendu côté serveur en carte statique, ou une carte
interactive en iframe, qui ouvre la CSP (`frame-src`) et, pour Google Maps,
pose des cookies, donc demande un consentement (le site actuel affiche déjà
« Le contenu Google Maps ne s'affiche pas en raison de vos paramètres des
cookies »).

Ce que le socle savait (v0.4.0) :

- la vitrine est presque sans JavaScript (invariant 1), et ses pages tiennent
  100/100/100 à Lighthouse (étape 6 de la certification) ;
- la CSP fixe `object-src`, `base-uri` et `frame-ancestors`, rien d'autre
  (`src/features/http/securityHeaders.ts`, `public/_headers`) ;
- `/images/[...key]` sert R2 à travers le Cache API de l'arête, sans quoi
  chaque image repasserait par R2 ;
- la [politique d'usage des tuiles d'OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)
  exige l'attribution sur la carte, un User-Agent qui nomme l'application, un
  Referer non effacé, le respect des en-têtes de cache (sept jours quand ils
  ne se lisent pas) et aucune tuile chargée sans que quelqu'un la regarde ;
  elle tolère un relais sans le recommander.

## Décision

**Une carte statique, dessinée par le serveur, dont les tuiles passent par la
boutique** (choix de Damien, 2026-11-03).

**Le bloc est un bloc de code « carte »**, que le marchand écrit ou insère par
le bouton « Carte » de l'éditeur :

    ```carte
    lieu: Marché de Vannes
    adresse: Place du Poids public
    adresse: 56000 Vannes
    position: 47.6582, -2.7608
    zoom: 16
    ```

Seule `position` est obligatoire : la latitude puis la longitude, comme
OpenStreetMap et Google Maps les copient d'un clic droit (« 47,6582 ; -2,7608 »
à la française passe aussi). `lieu` (100 caractères), `adresse` (quatre lignes
de 120), `zoom` (3 à 19, 16 par défaut) sont facultatifs. Les clés sont de la
syntaxe, comme `##`, et ne se traduisent pas. Un lecteur Markdown qui ne
connaît pas le bloc l'affiche comme un bloc de code : rien n'est perdu.

**Le serveur construit le HTML à partir des valeurs lues, jamais du texte du
bloc** (`src/features/maps/render.ts`), et échappe tout ce que le marchand a
écrit. L'invariant 11 tient : la seule balise qu'une carte ajoute est celle de
ce fichier. La carte est une mosaïque de 6 à 12 tuiles de 256 pixels, en grille
CSS, décalée pour que le lieu tombe au centre du cadre (48rem sur 20rem au
plus), où se pose l'épingle. Sous la carte : le nom, l'adresse, et deux liens,
« Voir sur OpenStreetMap » et « Voir sur Google Maps », pour qui veut se
déplacer sur la carte ou demander un itinéraire. L'attribution est sur la
carte, en bas à droite. Aucun script.

**Les tuiles sont relayées par la boutique** :
`/map-tiles/<page>/<z>/<x>/<y>`. Le navigateur du visiteur ne parle qu'à la
boutique ; le serveur de tuiles ne voit ni son adresse, ni ses cookies, ni la
page qu'il lit, et la politique de confidentialité du marchand n'a pas de
destinataire de plus à nommer. Le relais (`src/features/maps/relay.ts`) envoie
un User-Agent qui porte l'origine de la boutique et cette origine en Referer,
garde la fraîcheur que le serveur annonce (sept jours quand elle ne se lit
pas), ne transmet qu'une image PNG, JPEG ou WebP de 512 Kio au plus, et répond
502, sans rien mettre en cache, quand le serveur échoue.

**Le relais n'est pas un proxy ouvert.** Sur un défaut de cache, la route ne
va chercher une tuile que si un bloc « carte » de la page PUBLIÉE nommée dans
le chemin la dessine : toute autre tuile, celle d'un brouillon, un chemin mal
formé répondent 404, pour une lecture indexée et aucune requête au serveur de
tuiles. Le Cache API garde la tuile sous son seul nom (`z/x/y`, sans la page
ni la chaîne de requête) : deux pages autour du même marché partagent leurs
tuiles, et un `?v=` ajouté ne fait pas recharger le serveur.

**L'aperçu de l'éditeur passe par `/api/admin/map-tiles/<z>/<x>/<y>`**,
derrière la porte de l'administration : un brouillon n'est publié nulle part,
donc la route de la vitrine refuserait ses tuiles. Les deux routes partagent
les entrées du cache : une carte vue dans l'aperçu est déjà en cache quand la
page sort.

**Une tuile n'est pas un document** : elle ne lit ni les réglages ni les menus
en D1 (`src/middleware.ts`), et l'assistant de première installation ne la
détourne pas.

**Un bloc illisible garde la page en brouillon**, comme les marqueurs
`[À COMPLÉTER]` : le texte est enregistré, la publication refusée, une page
déjà en ligne y reste, et l'avertissement donne le premier problème avec sa
ligne. L'aperçu les liste tous, ligne par ligne. Sur la vitrine, un bloc
illisible ne dessine rien.

**Le serveur de tuiles se règle dans `store.config.ts`** (`maps.tileUrl`, un
modèle `{z}/{x}/{y}`, et `maps.attribution`), comme la politique d'OSM le
recommande. Par défaut, `tile.openstreetmap.org`. Un serveur à clé est hors de
cette décision : la clé serait un secret dans un fichier versionné.

**Les pages seulement.** `renderMarkdown()` ne dessine une carte que si on lui
passe l'option `placeMaps` ; la description d'un produit et les textes d'un
thème gardent le bloc pour un bloc de code.

## Conséquences

- aucune migration, aucune liaison. Une route publique de plus,
  `/map-tiles/`, ajoutée aux slugs réservés du manifeste (`RESERVED_SLUGS`) ;
- la CSP ne change pas : aucune iframe, aucune origine tierce dans la page ;
- **chaque tuile est une invocation du Worker**, servie par l'arête une fois en
  cache : une page de quatre lieux en coûte jusqu'à 48 à la première visite
  d'un navigateur, puis aucune tant que sa propre copie est fraîche (la durée
  qu'annonce le serveur de tuiles). À compter dans les limites du palier gratuit
  (`analyses/limites-tiers-gratuits.md`) pour une boutique dont la page des
  lieux est très lue ;
- le Cache API n'opère que sur un domaine personnalisé, et pas derrière
  Cloudflare Access ([documentation de Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/cache/)) :
  une boutique servie sur `*.workers.dev` relaie chaque tuile qu'un navigateur
  n'a pas encore, et l'aperçu d'une administration derrière Access aussi. Une
  production a son domaine ; dans l'aperçu, le navigateur réutilise les images
  déjà affichées dans la page à chaque nouveau rendu ;
- **la boutique est cliente d'OSM**, à ses conditions, qui peuvent changer et
  la bloquer sans préavis : la carte devient alors un cadre vide, sans image
  cassée (chaque tuile a `alt=""`), et les deux liens restent. Passer à un
  autre serveur sans clé est une ligne de `store.config.ts` ;
- les tuiles font 256 pixels : sur un écran à haute densité, la carte est
  moins nette qu'une carte interactive. Des tuiles « @2x » demanderaient un
  serveur qui les sert ;
- la carte ne bouge pas : ni zoom ni déplacement sur la page. Les liens y
  mènent ;
- le marchand trouve la position par un clic droit sur le lieu : pas de
  géocodage de l'adresse, qui ferait appel à un service de plus.

## Alternatives écartées

- **Les tuiles chargées par le navigateur chez OpenStreetMap** : plus simple,
  sans route, mais chaque visiteur envoie son adresse et la page qu'il lit à
  un tiers, que la politique de confidentialité du marchand doit nommer.
- **Une carte interactive OpenStreetMap en iframe** : zoom et déplacement,
  mais une iframe que le bloc produirait, la CSP ouverte à
  `openstreetmap.org`, du JavaScript tiers, une page plus lourde par lieu, et
  l'adresse du visiteur transmise.
- **Une iframe Google Maps derrière un consentement** : ce que montre le site
  actuel ; Google pose des cookies, donc un bandeau de consentement à
  construire dans le socle, le plus lourd des quatre.
- **Une image de carte téléversée par le marchand** dans la médiathèque, plus
  un lien : possible aujourd'hui, mais à refaire à chaque lieu, sans
  attribution garantie, et la capture d'une carte Google n'est pas libre de
  droits.
- **Une mosaïque composée en une seule image côté serveur** : il faudrait
  décoder et recoder des PNG dans le Worker, une bibliothèque de plus pour une
  image que le navigateur assemble seul en CSS.

## Vérification

- `src/features/maps/place.test.ts` fixe la lecture du bloc : les clés, les
  formes de la position, les limites, chaque problème avec sa ligne ;
- `src/features/maps/tiles.test.ts` fixe la projection (contre la formule
  inverse du wiki d'OSM), la mosaïque qui couvre tout le cadre, le passage de
  l'antiméridien, les pôles et la lecture d'une tuile dans une adresse ;
- `src/features/maps/relay.test.ts` fixe ce que le relais envoie au serveur et
  ce qu'il en garde : User-Agent, Referer, fraîcheur, refus d'un autre type ou
  d'une tuile trop lourde, aucun en-tête du serveur transmis tel quel ;
- `src/features/pages/markdown.test.ts` fixe le rendu : la mosaïque, les liens,
  l'échappement, le bloc de code sans l'option, rien sur la vitrine pour un
  bloc illisible, les problèmes dans l'aperçu, les tuiles qu'une page dessine ;
- `test/integration/media.mjs` fixe l'enregistrement : brouillon gardé, page en
  ligne laissée en ligne, avertissement, aucune image mise en cause ;
- `test/integration/place-map.mjs`, sur le Worker construit : la page sans
  adresse du serveur de tuiles, la CSP inchangée, une tuile relayée sans rien
  du visiteur, servie ensuite par le cache quelle que soit la chaîne de
  requête, les 404 qui n'atteignent jamais le serveur, l'échec non mis en
  cache, la tuile hors de l'assistant d'installation, l'aperçu derrière la
  porte et ses problèmes, l'enregistrement refusé.
