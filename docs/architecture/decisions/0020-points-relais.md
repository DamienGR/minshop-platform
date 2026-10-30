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
celle-ci, écrite avant le moindre code. Le 2026-10-30, Damien a retenu un
agrégateur plutôt qu'une intégration directe par transporteur.

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
- **en direct, chaque transporteur a son API et son contrat.** Mondial Relay
  cherche ses points par un service SOAP signé (`WSI4_PointRelais_Recherche`),
  qui ne crée plus d'expédition pour un compte ouvert depuis le 23 décembre
  2024 : ses étiquettes passent par une seconde API (« Connect », REST en XML).
  La recherche de Colissimo (`findRDVPointRetraitAcheminement`) est réservée aux
  titulaires d'un contrat Colissimo entreprise. Deux réseaux font donc deux
  adaptateurs, deux contrats et deux API d'étiquettes ;
- **Boxtal** (français) cherche les points par réseau (`MONR` pour Mondial
  Relay ; Colissimo et Chronopost figurent parmi ses transporteurs) et crée
  l'expédition vers le point choisi, étiquette et suivi compris, par son API
  v3 :
  `api.boxtal.com`, un bac à sable sur `api.boxtal.build`, une authentification
  HTTP Basic par la clé d'accès et la clé secrète d'une application v3, et un
  webhook `TRACKING_CHANGED`. Un rapport d'intégration relève les chemins
  `/shipping/v3.2/parcel-point-by-network` et
  `/shipping/v3.2/parcel-point-by-shipping-offer`, et des écarts entre la
  réponse et la spécification OpenAPI (casse d'une clé, une erreur 422 sur un
  suivi DHL du bac à sable). Boxtal annonce « ni abonnement, ni frais cachés » :
  le commerçant paie chaque envoi au tarif négocié par Boxtal, avant
  l'expédition ;
- **Sendcloud** (néerlandais) cherche les points de plusieurs réseaux par une
  API v3 plus documentée (`GET /api/v3/service-points` : pays, transporteur,
  code postal, rayon), en HTTP Basic par la clé et le secret du compte ; son
  API v2 est fermée aux nouveaux comptes. Sa grille met la carte des points
  relais à partir de l'offre Lite, 26 € par mois et 0,11 € par étiquette, et ne
  dit pas quelles offres ouvrent l'API ;
- **Shippo**, déjà branché, liste Mondial Relay avec étiquettes, suivi et une
  recherche de points, mais rien n'établit qu'un commerçant français y achète
  une étiquette relais ;
- **une recherche par code postal ne porte aucune donnée d'acheteur** : faite
  par le serveur, elle n'ouvre pas la CSP. Une étiquette, elle, porte le nom,
  l'adresse et le téléphone de l'acheteur.

## Décision

**Les points relais quittent le hors périmètre de l'ADR 0007 et deviennent une
option de l'offre** : éteinte par défaut, allumée boutique par boutique par un
interrupteur au build, et certifiée sur le socle avant la première vente qui
s'en sert. Les autres lignes hors périmètre de l'ADR 0007 ne changent pas, les
tarifs transporteur en temps réel compris : le prix d'un tarif relais reste
celui que le commerçant fixe, au forfait ou au poids.

**Les points relais passent par un agrégateur, et le premier est Boxtal.** Un
seul compte du commerçant, à son nom ([ADR 0002](0002-propriete-des-comptes.md)),
ouvre plusieurs réseaux sans contrat transporteur ni abonnement : c'est ce qui
convient à une boutique de moins de cent produits. La clé d'accès et la clé
secrète vont dans le coffre (`SecretName`), jamais en variable
d'environnement. Sendcloud reste l'adaptateur de repli, si l'API de Boxtal ne
tient pas l'essai en bac à sable.

**Le point se choisit dans la boutique, par le serveur, sans JavaScript
obligatoire** (invariant 1). Un port `PickupPointProvider`
(`src/features/shipping/`) cherche les points d'un réseau autour d'un code
postal et relit un point par son identifiant ; Boxtal en est l'adaptateur.
Chaque tarif relais nomme un réseau : le commerçant en propose autant qu'il
veut, dans la limite des cinq options d'une zone. La boutique affiche les
résultats comme un formulaire, sans la carte de l'agrégateur. Le point choisi
est relu au moment de réserver le stock, et la commande en garde une copie
(réseau, identifiant, nom, adresse) : un point fermé plus tard ne change pas
ce qui a été vendu. La recherche passe par un limiteur
(`src/features/auth/rateLimit.ts`), comme les autres formulaires publics, et
se met en cache par code postal et réseau.

**L'étiquette d'une commande relais s'achète chez Boxtal depuis la fiche
commande**, comme Shippo pour la livraison à domicile : après le paiement, là
où la latence ne coûte rien et où un échec se reprend. Le commerçant peut aussi
la faire dans l'espace Boxtal et saisir le numéro de suivi comme aujourd'hui.
Shippo garde la livraison à domicile ; les deux ne se recouvrent pas.

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

- le commerçant qui allume l'option ouvre un compte Boxtal à son nom et y
  prépaie ses envois ; le prix qu'il facture au client reste le sien, et
  l'écart avec le tarif Boxtal est son affaire ;
- Boxtal devient un sous-traitant du commerçant dès qu'une étiquette s'achète
  depuis la boutique : il reçoit le nom, l'adresse et le téléphone de
  l'acheteur. `docs/operations/sous-traitants.md` gagne une ligne optionnelle,
  et son DPA est à vérifier comme les autres ;
- un réseau de plus (Colissimo, Chronopost Pickup…) n'est qu'un réseau de plus
  dans l'éditeur d'expédition, sans code ni contrat nouveaux ;
- la boutique dépend d'un intermédiaire : une panne de Boxtal empêche de
  choisir un point, et le tarif relais disparaît du choix plutôt que de
  bloquer la commande. Les écarts relevés entre l'API v3 et sa spécification
  disent que l'adaptateur se teste sur des réponses réelles du bac à sable,
  pas sur la spécification seule ;
- les e-mails (confirmation, notification au commerçant, expédition), la fiche
  commande et l'export CSV montrent le point relais là où ils montraient
  l'adresse de livraison ;
- deux fournisseurs d'étiquettes coexistent, Shippo à domicile et Boxtal en
  relais ; s'ils se ressemblent assez, un port commun viendra après, pas
  avant ;
- un paiement Stripe passe par un écran de plus dès qu'un tarif relais existe
  dans la zone : la porte navigateur et Lighthouse le mesurent ;
- le périmètre certifié s'agrandit : une campagne relais répétée en doublure
  sur le bac à sable de Boxtal, puis une commande réelle jusqu'au retrait d'un
  vrai colis, qui vérifie aussi l'URL de suivi à ajouter à `trackingUrl()`.
  Une boutique qui allume l'option n'hérite de la certification du socle
  (plan §13.2) qu'à partir du tag qui a passé cette campagne. La commande
  réelle touche de vrais comptes et attend le feu vert de Damien ;
- l'agence supporte un fournisseur de plus : un point fermé, un colis non
  retiré, un retour ou une panne de Boxtal entrent dans `docs/operations/` ;
- à l'acceptation, le statut de l'ADR 0007, le §2.2 du plan et le « Hors
  périmètre » du README changent dans le même commit.

## Alternatives écartées

- **Un avenant client par client, sans ADR** : le code irait dans le socle de
  toute façon, puisqu'une boutique ne diverge pas d'un fichier du cœur
  (plan §13.2). Ce serait du code activé chez un client et jamais certifié, ce
  que l'ADR 0007 refuse.
- **Mondial Relay en direct** : aucun intermédiaire, mais un adaptateur, un
  contrat et deux API (recherche en SOAP, étiquettes par Connect) par
  transporteur, et un service de recherche ancien dont la création
  d'expédition a déjà fermé aux nouveaux comptes. Écarté par Damien le
  2026-10-30.
- **Sendcloud d'abord** : l'API la mieux documentée, mais un abonnement mensuel
  pour la carte des points relais, et une grille qui ne dit pas quelles offres
  ouvrent l'API. Pour une boutique de quelques commandes par semaine,
  l'abonnement pèse plus que le service. Gardé en repli derrière le même port.
- **Shippo, déjà branché** : il réutiliserait la clé et la fiche commande, mais
  l'étiquette relais d'un commerçant français n'y est pas établie.
- **La carte ou le widget de l'agrégateur** : un script tiers avec sa carte,
  qui ouvrirait la CSP (`src/features/http/securityHeaders.ts` et
  `public/_headers`) et ne marche pas sans JavaScript.
- **Le choix du point sur la page de Stripe** : impossible, elle n'offre qu'une
  liste fixe de tarifs.

## Vérification

- tests unitaires : le calculateur avec le mode `relay`, le document
  d'expédition en version 4 (un socle en version 3 le refuse), l'adaptateur
  Boxtal sur un corpus de réponses relevées dans son bac à sable, sans appel
  réseau ;
- tests d'intégration : le règlement d'une commande relais par Stripe et par
  Lightning, le point recopié de la réservation sur la commande
  (`test/integration/settlement.mjs`, `shipping.mjs`) ;
  `test/integration/history-reads.mjs` pour toute nouvelle requête sur
  `orders` ;
- `test/scripts/privacy.test.mjs` refuse une colonne de point non classée ;
- la porte navigateur : le choix d'un point sans JavaScript, et le tarif
  relais absent quand la recherche échoue ;
- la boutique témoin `canary-minimal` construit le socle option éteinte, et
  son parcours de paiement reste celui d'aujourd'hui ;
- la campagne relais, en doublure sur le bac à sable puis en réel, consignée
  comme les étapes de la certification.
