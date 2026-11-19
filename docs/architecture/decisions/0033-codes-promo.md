# ADR 0033 — Des codes promo saisis dans la boutique, valables pour tous les paiements

- **Statut** : Proposé
- **Date** : 2026-11-19
- **Jalon** : après le pilote (plan §13.32) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), dont les codes de
  remise étaient ceux du tableau de bord de Stripe, saisis sur sa page

## Contexte

Damien demande le 2026-11-19 que l'acheteur saisisse son code de réduction ou
sa carte cadeau dans le panier ou à la commande, et que le code s'applique
ensuite au paiement, au lieu de le saisir sur la page de Stripe : un champ
qu'on ne rencontre qu'hors du site, une fois parti payer, déroute.

Ce que le socle sait (v0.12.0) :

- le réglage « Codes de remise » (`discounts_enabled`, allumé par défaut par
  `discounts.enabled`) ne fait qu'ouvrir le champ de Stripe
  (`allow_promotion_codes`) ; les codes se créent dans le tableau de bord de
  Stripe, et le webhook recopie la remise sur la commande (`discount_cents`) ;
- rien de cela ne vaut pour le virement, Lightning, OpenNode ou la
  démonstration : leur total n'a jamais de remise ;
- Stripe ne laisse pas pré-remplir son champ : une session reçoit soit
  `allow_promotion_codes` (l'acheteur tape chez Stripe), soit `discounts`
  (le code est déjà appliqué), jamais les deux. Lui transmettre un code
  suppose de le connaître et de l'avoir jugé avant ;
- la réservation (`checkout_reservations`) porte jusqu'à la commande ce que le
  paiement doit retrouver (CGV, TVA, commentaire, point relais) ;
  `pending_payments` est l'instantané que règlent les moyens hors Stripe.

## Décision

**Les codes vivent dans la boutique et valent pour tous les paiements** (choix
de Damien, 2026-11-19). Un écran Admin → **Codes promo** les crée, les
modifie, les désactive et les supprime ; la table `discount_codes`
(migration 0065) les garde. Une carte cadeau est un code à montant fixe,
utilisable une seule fois ; une carte à solde, dépensée en plusieurs fois,
sera un ticket à part.

**Un code est une règle courte** (`src/features/discounts/code.ts`, pure) : un
pourcentage entier (1 à 100) ou un montant fixe des articles, jamais de la
livraison, plafonné à leur montant ; un minimum d'achat facultatif ; un
premier et un dernier jour facultatifs, comptés dans le fuseau de la
boutique ; un nombre d'utilisations facultatif ; un interrupteur. Le code se
compare en majuscules, sans espaces (une carte lue sur papier se tape par
groupes), en lettres, chiffres, `-` et `_`, de 3 à 32 caractères. Un champ
laissé vide à la création tire un code de trois groupes de quatre caractères
dans l'alphabet de Crockford (60 bits) : c'est ce qu'il faut à une carte
cadeau, qui est de l'argent.

**Un seul code par commande, jugé à chaque étape** contre le panier tel qu'il
est : dans le panier (« Appliquer », `POST /api/discount`), dans l'achat
immédiat, sur chaque étape de `/checkout`, et une dernière fois par
`/api/checkout` au moment de payer. Le champ « Code promo ou carte cadeau »
est sur chacun de ces formulaires et part avec le bouton de paiement : un code
tapé sans « Appliquer » s'applique quand même, un champ vidé le retire. Le
panier se souvient du code accepté dans un cookie (`discount`, `HttpOnly`, un
jour) et le rejuge à chaque affichage ; un code ne voyage jamais dans une URL,
ni dans un message d'erreur.

**Le refus ne dit rien de plus que nécessaire** : un code inconnu, désactivé,
pas encore ouvert ou épuisé répond « Ce code n'est pas valable. » ; seuls un
code expiré et un minimum non atteint le disent, parce que l'acheteur peut y
faire quelque chose.

**Le champ ne paraît que s'il y a un code à taper** : le réglage allumé (il
garde son interrupteur, renommé « Codes promo », et son défaut), et au moins
un code actif, ou un code que l'acheteur porte déjà. Une boutique qui n'a
aucun code ne montre pas de champ vide, qui enverrait ses acheteurs chercher
des codes ailleurs ; son premier code fait paraître le champ.

**Les utilisations se comptent, elles ne se tiennent pas en compteur** : une
commande qui porte le code, plus une réservation qui le tient encore (statuts
`active` et `payment_pending`). La réservation l'écrit
(`discount_code_id`, `discount_code`) dans la même instruction qui réserve le
stock, gardée par une condition sur le code (actif, sous sa limite) : deux
paiements simultanés d'une carte cadeau n'en obtiennent qu'un, et le refus dit
« Ce code vient d'être utilisé ». `recordPaidOrder` recopie le code sur la
commande. Les deux comptes sont indexés sur `discount_code_id` (index
partiels), et ne lisent jamais l'historique des commandes.

**Chaque moyen de paiement facture les articles nets de la remise**, que le
socle calcule et passe au port (`CreateCheckoutParams.discount`) :

- **Stripe** reçoit un coupon créé pour la session, du montant exact,
  utilisable une fois, nommé d'après le code (`discounts: [{ coupon }]`) : sa
  page et son reçu affichent « NOEL10 −5,00 € ». Son propre champ reste fermé.
  Le webhook garde la remise que Stripe a réellement appliquée ;
- **le virement, Lightning, OpenNode et la démonstration** demandent le total
  net ; `pending_payments.discount_cents` garde la remise jusqu'à la commande ;
- **un panier que le code paie en entier**, sans livraison à payer : Stripe le
  valide sans débit (`no_payment_required`, déjà accepté par le webhook) et la
  démonstration aussi ; une facture Lightning de 0 sat, un virement de 0 € ou
  une charge OpenNode vide ne se règlent pas, et ces moyens refusent ce panier
  en demandant d'en choisir un autre (`settlesNothingDue`).

**L'API JSON** (`/api/checkout`) prend `discount_code`, le juge comme le
panier, répond `discount: { code, amount_cents }` et un `total_cents` net ; un
code refusé, ou envoyé à une boutique qui n'en prend pas, répond 400 avec
`reason: "discount_code"`, un code pris entre-temps 409.

**Le code se lit là où se lit la remise** : le récapitulatif du panier, de
l'achat immédiat et de `/checkout`, les pages de paiement de la démonstration
et du virement, la page de commande de l'acheteur, l'e-mail de confirmation
et la fiche commande de l'administration (« Remise (NOEL10) »).

**Les routes qui jugent un code sont limitées** avec la commande
(`features/auth/rateLimit.ts`, seau `checkout`) : `/api/discount` et
`/express` le rejoignent.

## Conséquences

- une migration additive (0065) : une table, deux colonnes sur
  `checkout_reservations` et sur `orders`, une sur `pending_payments`, deux
  index partiels ; d'où une version mineure ;
- **les codes créés dans le tableau de bord de Stripe ne s'appliquent plus** :
  son champ n'est plus proposé. Une boutique qui en utilise les recrée dans
  Codes promo ; les notes de version le disent ;
- chaque paiement par carte avec un code laisse un coupon dans le compte
  Stripe, utilisé ou non. Ils ne servent qu'à leur session et n'encombrent
  que la liste des coupons du tableau de bord ;
- **le panier est un oracle** : la page `/cart` rejuge le code de son cookie à
  chaque affichage, sans limite de débit. Quelqu'un peut donc essayer des
  codes en écrivant le cookie. Un code inventé (`NOEL10`) se devine ainsi,
  comme il se devinerait sur la page de Stripe ; une carte cadeau générée
  (60 bits) ne se devine à aucun débit. Le guide demande de laisser vide le
  code d'une carte cadeau ;
- une carte cadeau se dépense en une fois : si la commande coûte moins, le
  reste est perdu, et le guide le dit. Une carte à solde demandera un
  registre de mouvements, pas un compteur, et sera son propre ticket ;
- **la TVA de la commande se calcule sur le total payé**, remise déduite
  (`vat_amount_cents`, ADR 0010). C'est juste pour un code promo et pour une
  carte cadeau offerte, qui sont des remises. Une carte cadeau **vendue** est
  un bon à usages multiples : la TVA est due sur le prix plein des articles
  quand elle est utilisée, et la carte est un moyen de paiement, pas une
  remise. Le socle ne vend pas de cartes cadeaux et ne fait pas cette
  différence : une boutique qui en vend fait valider sa TVA par son
  expert-comptable, et ce sera l'objet du ticket des cartes à solde ;
- un paiement qui arrive après l'expiration de sa réservation (un virement
  tardif, ADR 0023) est encaissé comme avant : sa commande compte une
  utilisation de plus, et un code limité peut alors en avoir une au-delà de
  sa limite ;
- un code utilisé ne se supprime pas : « Supprimer » le désactive, et la
  commande garde le texte du code. Le modifier ne change rien aux commandes
  passées ;
- le code n'est pas une donnée personnelle (aucun nom de colonne suspect pour
  `shopctl privacy`) : il est le même pour tous ses acheteurs, et une carte
  cadeau utilisée ne vaut plus rien.

## Alternatives écartées

- **Les codes dans Stripe, la boutique les lui transmettant** : la boutique
  aurait dû lire les codes de Stripe pour les juger (une requête à chaque
  « Appliquer »), et le code n'aurait valu que pour la carte. Écarté par
  Damien, qui veut un code pour tous les paiements.
- **Le champ allumé sans code**, comme le réglage le faisait chez Stripe : un
  champ vide dans chaque panier de la flotte à la montée de version.
- **Un compteur d'utilisations sur le code** : un paiement abandonné l'aurait
  laissé décalé, et le décompte se fait déjà sur les lignes qui le portent.
- **Plusieurs codes par commande** : l'ordre des remises et leur cumul sont des
  règles de plus pour le marchand ; aucune boutique ne les a demandées.
- **Le code dans l'URL du panier** (`/cart?code=…`) : les URL sont dans les
  journaux, et un code de carte cadeau est de l'argent.

## Vérification

- `src/features/discounts/code.test.ts` fixe la règle : la forme du code, le
  calcul arrondi et plafonné, chaque refus et son message, l'état que la liste
  affiche, le code tiré au hasard ;
- `src/features/discounts/form.test.ts` lit le formulaire de l'écran Codes
  promo : montants à virgule, dates strictes, fin avant début, limites ;
- `test/integration/history-reads.mjs` mesure le compte des utilisations sur
  une base de commandes qui grandit ;
- `test/integration/discount-codes.mjs`, sur le Worker construit : l'écran
  Codes promo, le champ absent sans code, le panier qui applique, refuse et
  retire, la commande de démonstration payée avec sa remise et le code sur
  la commande, la carte cadeau qu'une seconde commande ne peut plus prendre,
  le coupon transmis à Stripe sans son champ, le panier entièrement payé
  refusé au virement, et l'API JSON.
