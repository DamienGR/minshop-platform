# ADR 0028 — Un commentaire de l'acheteur sur sa commande

- **Statut** : Accepté (fusion de la PR #169 par Damien, le 2026-11-03)
- **Date** : 2026-11-03
- **Jalon** : après le pilote (plan §13.9) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), qui ne liste pas de
  saisie libre sur la commande

## Contexte

Le ticket #162 (2026-11-03) demande que l'acheteur puisse laisser un
commentaire sur sa commande avant de payer : une précision de livraison, un
message cadeau, et pour un artisan la personnalisation demandée. Le site actuel
de la première boutique réelle le permet, et ses fiches y renvoient. Le ticket
veut le champ sur `/checkout` et dans l'API JSON, borné, porté par la
réservation jusqu'à la commande comme l'acceptation des CGV, lu dans
l'administration et dans les deux e-mails, couvert par l'export et
l'effacement, et absent des journaux.

Ce que le socle sait (v0.4.0) :

- une commande ne passe pas toujours par `/checkout` : le panier et l'achat
  immédiat (`/express`) postent vers `/api/checkout`, qui envoie une carte
  directement à Stripe et ne mène à `/checkout` que les moyens qui demandent
  une adresse à la boutique (démonstration, Lightning, virement, point relais) ;
- un texte de l'acheteur voyage déjà de ce formulaire à la commande : celui
  d'un produit personnalisable (ADR 0022), par un 307 qui reposte le corps
  (`hop=start`), jamais par une URL ;
- la réservation (`checkout_reservations`) est l'instantané que chaque moyen de
  paiement règle ; `recordPaidOrder` en recopie l'acceptation des CGV, le taux
  de TVA, l'exonération, le point relais et l'adresse ;
- Stripe Checkout sait ajouter des champs (`custom_fields`), mais seulement à
  sa page : rien pour Lightning, le virement ou la démonstration.

Ce qu'un acheteur tape est **son** texte : un prénom, une adresse de remise, un
mot pour la personne qui reçoit le paquet.

## Décision

**Un réglage, éteint par défaut** (choix de Damien, 2026-11-03) : Admin →
Réglages → Fonctionnalités, « Commentaire de commande »
(`order_comment_enabled`, `'1'` allumé, absent éteint). Une montée de version
ne change pas la page de commande d'une boutique qui ne l'a pas demandé.
Éteint, aucun champ n'est rendu, un commentaire posté par un formulaire est
ignoré, et l'API JSON refuse un `comment` non vide (400) : un client qui croit
l'avoir transmis doit l'apprendre.

**Un champ facultatif, sur chaque formulaire qui mène au paiement** : le
panier, l'achat immédiat, et l'étape d'adresse de `/checkout`, qui le reprend
pour le corriger. Un seul endroit ne suffirait pas : une carte ne passe jamais
par `/checkout`. Les étapes suivantes de `/checkout` le portent en champ caché
et le récapitulent sous l'adresse ; « Modifier l'adresse » reposte au lieu de
suivre un lien, pour ne pas le perdre.

**500 caractères, refusés et non tronqués.** Compté en caractères comme
l'acheteur les voit (points de code après NFC), comme la personnalisation. Les
retours à la ligne restent (un message cadeau a des lignes), une suite de
lignes vides devient une seule, les espaces se resserrent, les caractères de
contrôle et de direction (bidi) tombent. Trop long, le panier revient avec le
message d'erreur dans l'URL, jamais le texte ; `/checkout` rend l'étape
d'adresse avec le texte à raccourcir ; l'API répond 400 avec
`comment_max_length`. Rien n'est réservé avant. La règle :
`src/features/orders/comment.ts`.

**Il voyage dans le corps des requêtes, jamais dans une URL**, par le même 307
que la personnalisation : un panier qui porte un commentaire passe à
`/checkout?hop=start` avec son corps reposté.

**Il suit la réservation jusqu'à la commande** (migration 0055, `buyer_comment`
sur `checkout_reservations` et sur `orders`). `reserveInventory` l'écrit,
`recordPaidOrder` le recopie, quel que soit le moyen : la démonstration, la
carte par son webhook, Lightning depuis son paiement en attente, le virement à
sa réception. La réservation l'efface au règlement et à la libération ; une
réservation expirée ou en échec le garde trois jours, le temps qu'un paiement
tardif arrive, puis le balayage des accès invités l'efface avec l'adresse et la
personnalisation. Il ne va ni dans `pending_payments` ni dans la session
Stripe.

**Il se lit là où se lit la commande** : la page de commande de l'acheteur,
la fiche commande de l'administration, l'e-mail de confirmation et l'avis au
commerçant, toujours échappé (une balise tapée s'affiche comme du texte), ses
lignes gardées.

**Il est une donnée personnelle** : classé `erase` dans
`shopctl/src/privacy/map.mjs` sur les deux tables, exporté à la demande, vidé
à l'effacement ; le mot `comment` rejoint les noms de colonne suspects, pour
qu'une prochaine colonne de ce nom ne passe pas sans classement. Aucun journal
ne le porte (invariant 12).

## Conséquences

- une migration additive, deux colonnes ; une boutique qui monte de version
  n'affiche rien tant que son marchand n'allume pas le réglage ;
- le marchand qui l'allume lit le commentaire sur la fiche commande et dans
  l'avis : il n'y a ni recherche ni filtre sur ce texte, et il n'est pas dans
  l'export CSV des commandes ni dans les outils MCP, comme la personnalisation
  (ADR 0022). Une boutique qui en a besoin le demandera ;
- **changer une quantité dans le panier recharge la page et perd le texte en
  cours de saisie** : le bouton de quantité poste vers `/api/cart`, qui ne
  garde pas le commentaire. Le texte n'est pas dans le cookie du panier, qui
  part à chaque requête et dans chaque journal d'accès qu'un mandataire
  tiendrait ; l'acheteur le retape, ou le tape après ;
- le commentaire n'engage pas la boutique : le marchand lit une demande, il n'a
  aucun moyen d'y répondre dans le socle. Une demande qu'il ne peut pas tenir
  se règle avec l'acheteur, par e-mail ;
- la politique de confidentialité du marchand nomme ce champ s'il l'allume ;
  c'est son texte, pas celui du socle.

## Alternatives écartées

- **Le champ allumé d'office** : chaque boutique de la flotte l'aurait gagné
  à sa montée de version, dans ses pages et ses e-mails, sans l'avoir
  demandé. Écarté par Damien.
- **Les `custom_fields` de Stripe Checkout** : la carte seulement, sur une page
  qui n'est pas celle de la boutique, 255 caractères au plus, et un texte de
  l'acheteur de plus chez un tiers.
- **Le champ sur `/checkout` seulement**, comme le ticket le proposait : une
  carte, le moyen le plus courant, n'y passe pas. Il aurait fallu faire passer
  chaque carte par une étape de plus.
- **Tronquer au lieu de refuser** : l'acheteur ne voit pas ce qu'il perd, et le
  marchand lit une demande coupée au milieu d'un prénom.
- **Le texte dans le cookie du panier**, pour survivre à un changement de
  quantité : un texte libre dans un en-tête envoyé à chaque requête, borné par
  la taille d'un cookie, et lisible par le moindre journal d'accès.
- **Le commentaire sur une ligne de commande** : c'est la personnalisation
  (ADR 0022), une saisie que le marchand structure produit par produit ; le
  commentaire est un message libre sur la commande entière.

## Vérification

- `src/features/orders/comment.test.ts` fixe la règle : facultatif, retours à
  la ligne gardés, lignes vides resserrées, contrôles et bidi retirés, refus à
  501 caractères, comptés comme l'acheteur les voit, et rien de lu quand le
  réglage est éteint ;
- `src/features/email/orderNotification.test.ts` le lit dans l'avis au
  commerçant et dans la confirmation, échappé, ses lignes gardées ;
- `test/scripts/privacy.test.mjs` l'exporte, l'efface, et laisse celui d'un
  autre acheteur ;
- `test/integration/guest-access.mjs` le voit effacé d'une réservation
  abandonnée ;
- `test/integration/order-comment.mjs`, sur le Worker construit : le réglage
  éteint (ni champ ni lecture, l'API qui refuse), l'interrupteur de Réglages,
  le panier et l'achat immédiat bornés, le refus avant toute réservation et
  sans texte dans l'URL, le 307 jusqu'à la commande payée, la réservation
  vidée au règlement et à la libération, l'API JSON, Lightning, chaque étape de
  `/checkout`, la carte dont la session Stripe ne voit rien, la page de
  commande et la fiche d'administration échappées, et aucun mot de l'acheteur
  dans les journaux.
