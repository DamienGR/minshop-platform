# ADR 0022 — Des produits personnalisables par un texte libre

- **Statut** : Accepté (fusion de la PR #149 par Damien, le 2026-11-02)
- **Date** : 2026-11-02
- **Jalon** : après le pilote (plan §13.4) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), qui range la
  personnalisation produit complexe hors périmètre

## Contexte

Le ticket #125 (2026-11-02) demande qu'un produit puisse être personnalisé :
l'acheteur saisit un texte libre dans des champs, que le commerçant règle sur
la fiche du produit, chacun avec un libellé, un texte d'aide et un nombre
maximal de caractères. Le texte doit se lire sur le produit, dans le panier et
dans la commande. L'exemple du ticket : un sac avec un prénom brodé, champ
« Nom à broder », 15 caractères au plus.

L'ADR 0007 range hors périmètre la « personnalisation produit complexe », le
README les « produits hautement configurables ». Un champ de texte court n'est
ni l'un ni l'autre, mais l'ADR 0007 demande une décision explicite avant
qu'une fonctionnalité qu'il n'a pas listée entre dans l'offre.

Ce que le socle sait déjà faire : des variantes, qui changent le prix et le
stock, et des options (`product_extras`) qui ajoutent un montant. Le panier
est un cookie, `{ v: 2, items: { <clé>: <quantité> } }`, dont la clé nomme le
produit, la variante et les options. La réservation de la commande est
l'instantané que chaque moyen de paiement règle, et `recordPaidOrder` en
recopie les lignes sur `order_items`.

Ce qu'un acheteur tape est **son** texte : un prénom, une date, une dédicace.
Il peut nommer une personne, et l'ADR 0017 veut qu'une donnée personnelle
soit classée, exportable et effaçable.

## Décision

**Un produit peut demander jusqu'à cinq champs de texte libre**, réglés dans
la section « Personnalisation » de sa fiche d'administration : un libellé
(80 caractères au plus), un texte d'aide facultatif (200), un maximum de 1 à
200 caractères, et un caractère obligatoire ou facultatif, obligatoire par
défaut. Le ticket ne parle pas du caractère facultatif ; un champ « Message
(facultatif) » est le cas qu'il laisse sans réponse. Les champs vivent dans
`product_custom_fields` (migration 0049), avec un identifiant public `cfld_`.

**Le texte est une ligne, refusée plutôt que tronquée.** Il est normalisé
(NFC, contrôles et retours à la ligne remplacés par une espace, marques de
direction retirées, espaces resserrées) puis compté en caractères, pas en
unités UTF-16. Un champ obligatoire vide et un texte trop long sont refusés,
avec le libellé du champ : un prénom coupé pour tenir est un prénom brodé
faux. La règle est une seule fonction pure,
`checkCustomization()` (`src/features/products/customization.ts`), que lisent
l'ajout au panier, le panier relu, l'achat immédiat, `/checkout` et l'API
JSON.

**La personnalisation est gratuite.** Un champ ne change pas le prix ; une
broderie payante se vend par une option à côté du champ. Une deuxième façon de
faire payer un supplément doublerait le calcul du prix, que l'option fait
déjà.

**Deux textes différents font deux lignes de panier.** La clé de ligne prend
un segment `~<jeton>`, le base64url des paires `[cfld_…, texte]` triées ; le
même texte retombe sur la même ligne. Le cookie est le terrain de l'acheteur :
un segment qui n'est pas la forme canonique est rejeté, et le panier relu
rejuge le texte contre les champs du moment, si bien qu'une ligne devenue
invalide (un champ rendu obligatoire depuis) n'est plus en vente. Un ajout qui
ferait dépasser au cookie son budget est refusé (« Votre panier est plein »),
au lieu d'un cookie que le navigateur jetterait, panier compris.

**Le texte n'est jamais dans une URL ni dans un journal.** Les URL sont ce que
gardent les journaux de requêtes. L'achat immédiat d'un produit à champs
poste donc vers `/express` au lieu d'un GET, et `/api/checkout` renvoie vers
`/checkout` par un 307, qui fait reposter le même corps (`hop=start` y dit
« première vue », pas « adresse envoyée ») ; le bouton « Modifier l'adresse »
repasse par un formulaire. Le refus nomme le champ, jamais ce qui y était
écrit.

**Le texte est copié, jamais référencé.** La commande garde, par ligne,
`order_items.customization` : un tableau JSON `{ label, value }`, le libellé
tel qu'il se lisait à la commande. Renommer ou retirer un champ ensuite ne
change pas ce qui a été vendu. Le texte reste hors de `order_items.name`, que
l'effacement garde comme pièce comptable.

**La réservation le porte jusqu'à la commande, puis le lâche**, comme
`ship_address` : `checkout_reservations.customization`, une entrée par ligne
des `items`, hors du JSON des `items` pour qu'une affectation l'efface. Le
règlement le recopie sur les lignes de la commande et l'efface ; une
réservation libérée l'efface aussitôt ; une réservation expirée ou en échec le
garde trois jours, le temps des relances de webhook de Stripe, et le balayage
qui masque son lien d'invité l'efface. `recordPaidOrder` le lit sur la
réservation quand la liste de lignes qu'on lui passe ne le porte pas : la page
Lightning règle à partir du paiement en attente, qui n'en garde pas de copie.

**Il se lit partout où la ligne se lit** : la fiche produit (les champs, leur
aide et leur limite), le tiroir et la page du panier, `/express`, `/checkout`,
la page de commande de l'acheteur, la fiche commande, l'e-mail de confirmation
et l'avis au commerçant, et la page de Stripe, en description sous l'article
(jamais dans ses métadonnées). Le format est un seul message,
`product.customization.entry` : « Nom à broder : Léa ». L'API JSON décrit les
champs (`customization_fields` dans `/api/products/<slug>`), lit
`customization` sur chaque article de `/api/checkout` et le décrit dans
`llms.txt`. L'export CSV des commandes n'a pas de colonne par ligne : il ne le
prend pas.

**L'effacement l'efface.** `order_items.customization` et
`checkout_reservations.customization` sont classés `erase` dans la carte des
données personnelles (`shopctl/src/privacy/map.mjs`), donc exportés à la
demande de portabilité et vidés à l'effacement ; les libellés et aides des
champs sont classés « catalogue ».

**Aucune option de build.** Un produit sans champ se vend exactement comme
avant : le commerçant allume la fonctionnalité produit par produit. La
première boutique réelle qui en vend un vérifie le parcours à sa recette
(ajout avec un texte, commande, lecture dans la fiche commande et l'e-mail).

## Conséquences

- l'ADR 0007 garde hors périmètre la personnalisation complexe : un aperçu
  visuel, une image téléversée par l'acheteur, un choix de police ou de
  couleur, un texte sur plusieurs lignes, un prix qui dépend du texte ;
- une ligne personnalisée pèse dans le cookie du panier : cinq champs pleins
  de 200 caractères accentués tiennent sur une ligne, pas sur deux. Le plafond
  de 200 caractères par champ en vient ;
- l'achat immédiat d'un produit à champs demande de reposter le formulaire si
  l'acheteur revient en arrière sur `/express` ; un produit sans champ garde
  le GET ;
- la migration 0049 est à lister dans les notes de la prochaine version du
  socle ; une boutique qui ne crée aucun champ n'en voit que les colonnes ;
- l'import CSV du catalogue (`shopctl catalog`) ne porte pas les champs : ils
  se règlent dans l'administration, produit par produit ;
- un champ retiré après une commande ne change pas la commande, mais une ligne
  de panier qui y répondait perd ce texte au prochain affichage du panier.

## Alternatives écartées

- **Tronquer le texte au maximum** : plus simple pour l'acheteur pressé, mais
  un nom coupé est une commande fausse, découverte une fois brodée.
- **Garder le texte dans le libellé de la ligne** (`Sac — Léa`) : tous les
  écrans l'auraient affiché sans rien changer, mais l'effacement garde le
  libellé, et le texte serait passé dans les métadonnées de chaque moyen de
  paiement et dans les journaux.
- **Un supplément de prix par champ** : redouble l'option, qui sait déjà
  ajouter un montant, et le calcul du prix à chaque endroit qui le refait.
- **Garder le texte dans une table côté serveur, le cookie n'en portant que la
  référence** : évite le poids dans le cookie, mais crée des lignes pour des
  paniers abandonnés, à balayer et à classer pour l'effacement, sans
  propriétaire à qui les rattacher.
- **Un GET vers `/express` comme pour les autres produits** : met le texte
  dans l'URL, donc dans les journaux de requêtes de la plateforme.

## Vérification

- `src/features/products/customization.test.ts` et
  `src/features/cart/key.test.ts` : normalisation, refus, compte en
  caractères, jeton canonique du cookie ;
- `test/integration/customization.mjs`, sur le Worker construit : la fiche
  produit, les refus du panier, une ligne par texte, la ligne rejugée, la
  commande par le moyen Démo, l'achat immédiat sans URL, l'API JSON, la page
  Lightning, la libération, la description Stripe sans métadonnée, et aucun
  texte saisi dans les journaux ;
- `test/integration/guest-access.mjs` : le balayage efface le texte d'une
  réservation abandonnée ;
- `test/scripts/privacy.test.mjs` : la carte des données personnelles
  classe toute colonne dont le nom le laisse soupçonner (`customization`,
  `text`).
