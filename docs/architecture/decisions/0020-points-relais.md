# ADR 0020 — Les points relais, option de l'offre

- **Statut** : Proposé
- **Date** : 2026-10-30
- **Jalon** : après le pilote (plan §13.3) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), qui range les
  points relais hors périmètre

## Contexte

L'ADR 0007 range les points relais hors périmètre, comme le §2.2 du plan et le
README. Le ticket #123 (2026-10-26) décrit le besoin : le client choisit un
point relais (Mondial Relay, Colissimo Point Retrait…) au moment de commander,
et la boutique traite la commande jusqu'à ce point. Une fonctionnalité hors
périmètre « exige une décision explicite » avant d'être activée pour un client :
celle-ci, écrite avant le moindre code.

Ce que le socle sait déjà faire (v0.3.34) :

- trois modes de tarif, forfait, au poids et `pickup` (retrait à la boutique,
  pas en relais), dans un document d'expédition en version 3
  (`src/features/shipping/settings.ts`) ;
- le mode de livraison en donnée : `delivery_method` sur `orders` et
  `pending_payments` (migrations 0035 et 0036), que Stripe rapporte par la
  métadonnée `delivery` du tarif, jamais par son libellé ;
- un tarif peut s'appeler « Mondial Relay », mais ce n'est qu'un libellé : le
  client saisit son adresse et aucun point n'est choisi ;
- Stripe Checkout fait choisir le tarif dans une liste fixe sur sa page
  (`shipping_options`, cinq au plus) ; Lightning, OpenNode et Démo passent
  d'abord par l'étape `/checkout` de la boutique (`IN_APP_SHIPPING_RAILS`,
  `src/pages/api/checkout.ts`) ;
- `mondialrelay` figure dans `CARRIERS` sans lien de suivi, faute d'une URL
  vérifiée sur un vrai colis (`src/features/orders/tracking.ts`) ;
- l'achat d'étiquettes passe par Shippo depuis la fiche commande, pour
  `delivery_method = 'shipping'` exactement (`labelStore.ts`).

Les faits qui donnent sa forme à la décision, relevés le 2026-10-30 dans la
documentation des fournisseurs :

- **la page de Stripe ne sait pas proposer un point relais** : elle affiche une
  liste de tarifs, pas une recherche. Le point se choisit donc dans la boutique,
  avant la redirection ;
- **Mondial Relay** cherche ses points par un service SOAP
  (`WSI4_PointRelais_Recherche` sur `api.mondialrelay.com`), autour d'un code
  postal ou de coordonnées, trente résultats au plus, avec le nom, l'adresse, la
  distance et les horaires. L'appel est signé par le code enseigne et la clé
  privée du commerçant, et un compte de test public existe. Ce même service ne
  crée plus d'expédition pour un compte ouvert depuis le 23 décembre 2024 : les
  étiquettes passent par l'API « Connect » (REST en XML,
  `connect-api.mondialrelay.com/api/shipment`), où le point s'écrit
  `<DeliveryMode Mode="24R" Location="FR-…">` ;
- **Colissimo** a son service de recherche (`findRDVPointRetraitAcheminement`),
  réservé aux titulaires d'un contrat Colissimo entreprise ;
- **Sendcloud** cherche les points de plusieurs réseaux par une seule API
  (`GET /api/v3/service-points` : pays, transporteur, code postal, rayon),
  authentifiée par la clé et le secret d'un compte Sendcloud ; son API v2 est
  fermée aux nouveaux comptes. **Boxtal** fait de même par son API v3 (réseau
  `MONR` pour Mondial Relay). L'un et l'autre vendent aussi l'étiquette, et
  supposent un compte du commerçant chez eux ;
- **Shippo**, déjà branché, liste Mondial Relay avec étiquettes, suivi et une
  recherche de points (« Location finder »), et Colissimo pour des envois au
  départ de la France. Rien n'établit encore qu'un commerçant français y achète
  une étiquette relais ;
- **une recherche par code postal ne porte aucune donnée d'acheteur** : faite
  par le serveur, elle n'ouvre pas la CSP et n'ajoute pas de sous-traitant. Une
  étiquette, elle, porte le nom, l'adresse et le téléphone de l'acheteur.

## Décision

**Les points relais quittent le hors périmètre de l'ADR 0007 et deviennent une
option de l'offre** : éteinte par défaut, allumée boutique par boutique par un
interrupteur au build, et certifiée sur le socle avant la première vente qui
s'en sert. Les autres lignes hors périmètre de l'ADR 0007 ne changent pas, les
tarifs transporteur en temps réel compris : le prix d'un tarif relais reste
celui que le commerçant fixe, au forfait ou au poids.

**Le point se choisit dans la boutique, par le serveur, sans JavaScript
obligatoire** (invariant 1). Un port `PickupPointProvider`
(`src/features/shipping/`) cherche les points d'un réseau autour d'un code
postal et relit un point par son identifiant. La boutique affiche les
résultats comme un formulaire, sans carte d'un tiers. Le point choisi est relu
chez le transporteur au moment de réserver le stock, et la commande en garde
une copie (transporteur, identifiant, nom, adresse) : un point fermé plus tard
ne change pas ce qui a été vendu. La recherche passe par un limiteur
(`src/features/auth/rateLimit.ts`), comme les autres formulaires publics, et
se met en cache par code postal.

**Le premier adaptateur est Mondial Relay en direct**, avec les identifiants du
commerçant dans le coffre (`SecretName`), jamais en variable d'environnement.
Ce choix est celui que Damien doit trancher : les alternatives sont plus bas.
L'étiquette se fait d'abord à la main, dans l'espace Mondial Relay du
commerçant, et le numéro de suivi se saisit dans la fiche commande comme
aujourd'hui ; l'achat d'étiquettes depuis la boutique est un lot ultérieur.
Colissimo, ou un agrégateur, s'ajoute plus tard comme un adaptateur de plus,
sans toucher au parcours.

**Le parcours de paiement** : un tarif relais fait passer Stripe par l'étape
`/checkout` de la boutique, comme Lightning. Le client y choisit son tarif et,
pour un tarif relais, son point ; la session Stripe ne reçoit plus que ce
tarif, avec la métadonnée `delivery: relay` et l'identifiant du point. Stripe
continue de demander l'adresse de l'acheteur, qui reste son contact et le
destinataire de l'étiquette, et demande aussi son téléphone, dont le
transporteur se sert pour l'avis de mise à disposition. Une boutique sans
tarif relais garde exactement le parcours certifié d'aujourd'hui.

**Le stockage** : un mode de tarif `relay`, et le document d'expédition en
version 4, pour qu'un retour à un socle plus ancien échoue fermé ; une valeur
`relay` de `delivery_method` ; le point dans des colonnes ajoutées à
`checkout_reservations`, `pending_payments` et `orders` (migration additive),
que `recordPaidOrder` recopie comme il recopie le consentement et le taux de
TVA. Ces colonnes sont classées dans `shopctl/src/privacy/map.mjs`, et
l'effacement reste une anonymisation
([ADR 0017](0017-effacement-et-portabilite.md)).

## Conséquences

- le commerçant qui allume l'option ouvre un compte professionnel Mondial Relay
  à son nom, comme Stripe et Resend
  ([ADR 0002](0002-propriete-des-comptes.md)) ; le transporteur reste son
  prestataire, et tant que l'étiquette se fait à la main la boutique n'envoie
  aucune donnée d'acheteur à un nouveau fournisseur ;
- les e-mails (confirmation, notification au commerçant, expédition), la fiche
  commande et l'export CSV montrent le point relais là où ils montraient
  l'adresse de livraison ;
- Shippo reste réservé à `delivery_method = 'shipping'` : une commande relais
  n'y achète pas d'étiquette tant que le lot des étiquettes n'est pas fait ;
- un paiement Stripe passe par un écran de plus dès qu'un tarif relais existe
  dans la zone : la porte navigateur et Lighthouse le mesurent ;
- le service SOAP de recherche de Mondial Relay est ancien ; s'il ferme comme a
  fermé la création d'expédition, l'adaptateur change, pas le parcours. Qu'il
  serve encore un compte ouvert après le 23 décembre 2024 est à vérifier avant
  le premier lot de code ;
- le périmètre certifié s'agrandit : une campagne relais répétée en doublure
  sur le compte de test de Mondial Relay, puis une commande réelle jusqu'au
  retrait d'un vrai colis, qui vérifie aussi l'URL de suivi à ajouter à
  `trackingUrl()`. Une boutique qui allume l'option n'hérite de la
  certification du socle (plan §13.2) qu'à partir du tag qui a passé cette
  campagne. La commande réelle touche de vrais comptes et attend le feu vert de
  Damien ;
- l'agence supporte un transporteur de plus : un point fermé, un colis non
  retiré ou un retour entrent dans `docs/operations/` ;
- à l'acceptation, le statut de l'ADR 0007, le §2.2 du plan et le « Hors
  périmètre » du README changent dans le même commit.

## Alternatives écartées

- **Un avenant client par client, sans ADR** : le code irait dans le socle de
  toute façon, puisqu'une boutique ne diverge pas d'un fichier du cœur
  (plan §13.2). Ce serait du code activé chez un client et jamais certifié, ce
  que l'ADR 0007 refuse.
- **Un agrégateur d'emblée (Sendcloud, Boxtal)** : un seul adaptateur pour
  plusieurs réseaux et pour l'étiquette, mais un compte de plus par commerçant
  chez un intermédiaire, et un sous-traitant qui reçoit l'adresse des
  acheteurs. Gardé pour le jour où une boutique veut plusieurs réseaux.
- **Shippo, déjà branché** : il réutiliserait la clé et la fiche commande, mais
  l'étiquette relais d'un commerçant français n'y est pas établie. À essayer
  avec une clé de test avant le lot des étiquettes.
- **Colissimo Point Retrait d'abord** : son API demande un contrat Colissimo
  entreprise, plus lourd qu'un compte Mondial Relay pour une petite boutique.
- **Le widget de Mondial Relay** : un script tiers avec sa carte, qui ouvrirait
  la CSP (`src/features/http/securityHeaders.ts` et `public/_headers`) et ne
  marche pas sans JavaScript.
- **Le choix du point sur la page de Stripe** : impossible, elle n'offre qu'une
  liste fixe de tarifs.

## Vérification

- tests unitaires : le calculateur avec le mode `relay`, le document
  d'expédition en version 4 (un socle en version 3 le refuse), l'adaptateur sur
  un corpus de réponses figées, sans appel réseau ;
- tests d'intégration : le règlement d'une commande relais par Stripe et par
  Lightning, le point recopié de la réservation sur la commande
  (`test/integration/settlement.mjs`, `shipping.mjs`) ;
  `test/integration/history-reads.mjs` pour toute nouvelle requête sur
  `orders` ;
- `test/scripts/privacy.test.mjs` refuse une colonne de point non classée ;
- la porte navigateur : le choix d'un point sans JavaScript ;
- la boutique témoin `canary-minimal` construit le socle option éteinte, et
  son parcours de paiement reste celui d'aujourd'hui ;
- la campagne relais, en doublure puis en réel, consignée comme les étapes de
  la certification.
