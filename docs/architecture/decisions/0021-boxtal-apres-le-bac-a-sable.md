# ADR 0021 — Ce que le bac à sable de Boxtal change à l'ADR 0020

- **Statut** : Proposé
- **Date** : 2026-10-30
- **Jalon** : après le pilote (plan §13.3) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0020](0020-expeditions-par-boxtal.md), sur cinq points
  que son bac à sable contredit

## Contexte

L'ADR 0020 confie à Boxtal la recherche des points relais, les étiquettes et le
suivi, et laisse au bac à sable le soin de vérifier ce que la documentation ne
dit pas. Le corpus du lot 1, relevé le 2026-10-30 sur `api.boxtal.build`, est
dans [`test/fixtures/boxtal/`](../../../test/fixtures/boxtal/README.md). Il
contredit cinq phrases de l'ADR 0020 :

- **« y prépaie ses envois »** : un compte qui commande par l'API est en
  paiement différé par prélèvement (guide `getting-started-api-v3`) ;
- **« relit un point par son identifiant »** : aucun appel ne le fait. Les deux
  recherches (`parcel-point-by-network`, `parcel-point-by-shipping-offer`)
  partent d'une adresse, et `/shipping/v3.1/parcel-point` est déprécié. Boxtal
  valide le point quand l'étiquette s'achète : `422`,
  `ValidationException.PickupPointCode` ;
- **« Boxtal cote les offres pour le colis et le commerçant en choisit une »** :
  l'API v3 n'a pas de cotation, et Boxtal renvoie à la v1. La bibliothèque de
  Boxtal y entre par l'identifiant et le mot de passe du compte, pas par les
  clés d'une application v3. La v3 donne le prix hors taxes dans la réponse de
  la commande, donc après l'achat ;
- **« retrouve une expédition pour lever un achat incertain »** :
  - aucun appel ne liste les commandes ni ne cherche par `externalId` ;
  - Boxtal n'est pas idempotent : le même corps renvoyé crée une seconde
    commande ;
  - une commande se relit par son identifiant Boxtal, et son suivi rend
    l'`externalId` du colis (`packageExternalId`) ;
  - une commande s'annule (`DELETE`) tant que le transporteur n'a pas pris le
    colis. Après, Boxtal refuse : `422`, sans détail ;
- **« l'URL de suivi à ajouter à `trackingUrl()` »** : Boxtal rend l'URL de
  suivi de chaque colis (`packageTrackingUrl`). Celle de Mondial Relay porte le
  code d'enseigne de l'expéditeur (`ens=`), que `trackingUrl()` ne connaît
  pas.

L'ADR 0020 ne disait rien de la conservation de l'étiquette. Le socle garde
aujourd'hui l'URL que Shippo rend, qui dure. Celle de Boxtal est signée pour 31
jours, et chaque lecture de `shipping-document` en signe une nouvelle.

## Décision

**Le paiement.** Le commerçant ouvre son compte Boxtal en paiement différé par
prélèvement. Boxtal prélève les envois après coup, au prix que rend chaque
commande.

**Le point.**

- `PickupPointProvider` cherche les points d'une offre autour d'une adresse, et
  ne fait rien d'autre.
- Au moment de réserver le stock, la boutique accepte un point seulement si son
  code figure parmi les points qu'elle a servis pour ce code postal et cette
  offre. La recherche en cache fait foi ; une recherche refaite la remplace si
  elle a expiré.
- La boutique écarte les points dont les réseaux ne prennent pas le poids du
  colis.
- Si Boxtal refuse le point à l'achat de l'étiquette, l'achat échoue sans rien
  coûter. Le commerçant choisit alors un point voisin dans la fiche commande et
  prévient l'acheteur.

**Sans cotation, l'offre se choisit d'avance, à domicile comme en relais.**

- Le commerçant retient dans Réglages les offres à domicile qu'il propose
  (Colissimo Access, Mondial Relay Domicile…). La fiche commande lui fait
  choisir l'une d'elles.
- Le prix de Boxtal s'affiche après l'achat, sur la commande.
- La boutique ne garde jamais l'identifiant ni le mot de passe du compte
  Boxtal : le coffre ne reçoit que les clés de l'application v3.
- `LabelProvider` achète, relit une commande par son identifiant Boxtal,
  annule, et rend document et suivi ; il ne cote pas.
- `labelStore.ts` ne change pas :
  - la ligne `quoted` porte la référence de l'envoi (l'`externalId`) et
    l'offre retenue ;
  - le verrou d'achat se prend comme aujourd'hui.

**L'achat incertain se lève avec le commerçant.** Une réponse perdue laisse
l'étiquette `uncertain`, et rien ne la rachète d'office, puisqu'un nouvel envoi
ferait un doublon payé. La fiche commande donne au commerçant deux voies :

- **il colle l'identifiant Boxtal qu'il voit dans son espace.** La boutique
  relit cette commande et son suivi, et ne l'enregistre que si le
  `packageExternalId` est la référence de cet envoi ;
- **il déclare qu'aucun envoi n'existe.** Ce choix est risqué, comme la levée
  forcée d'aujourd'hui. Un doublon trouvé ensuite s'annule dans son espace
  avant la prise en charge du colis ; après, il se paie.

Un achat `uncertain` se lève donc le jour même : la liste des commandes de
l'administration le signale, pour que le commerçant n'ait pas à ouvrir la
bonne fiche pour le voir.

**L'étiquette ne se stocke pas.** La boutique garde l'identifiant de la
commande Boxtal, pas l'URL. À chaque téléchargement, une route de
l'administration relit `shipping-document` et redirige vers l'URL fraîche. Le
PDF, qui porte le nom, l'adresse et le téléphone de l'acheteur, ne va pas
dans R2.

**Le suivi.**

- La commande garde l'URL de suivi que Boxtal rend pour le colis.
- `trackingUrl()` ne sert plus qu'aux numéros saisis à la main.
- La campagne vérifie cette URL sur un vrai colis, à la place d'une URL à
  ajouter.

Le reste de l'ADR 0020 tient tel quel :

- un seul prestataire ;
- la recherche par le serveur, sans JavaScript obligatoire ;
- le parcours `/checkout` ;
- le stockage du point ;
- le webhook, qui n'est qu'un signal.

## Conséquences

- le commerçant ne compare plus les prix des transporteurs au moment
  d'expédier, comme le permettait Shippo. Il les compare une fois, sur le site
  de Boxtal, en choisissant ses offres ; chaque commande montre ensuite ce que
  l'envoi a coûté ;
- un achat incertain demande une action du commerçant, quand Shippo se
  rapprochait seul. Le cas est rare, mais pas exceptionnel : une réponse perdue
  suffit ;
- l'URL de suivi demande une colonne sur `orders` (migration additive), au
  lot 3 ;
- une étiquette ne se télécharge plus quand Boxtal est en panne. Elle se refait
  alors depuis l'espace Boxtal, comme le prévoit l'ADR 0020 ;
- `docs/operations/` reçoit une fiche pour l'achat incertain et le doublon
  annulé ;
- restent ouverts, pour la campagne :
  - la remise d'un colis Mondial Relay commandé sans point de dépôt ;
  - les consignes ;
  - le format 10 × 15 ;
  - le coût d'un envoi réel annulé.

  Le README du corpus les tient.

## Alternatives écartées

- **La cotation par l'API v1** : il faudrait garder l'identifiant et le mot de
  passe du compte, qui ouvrent tout le compte, paiement compris, au lieu de
  deux clés d'application révocables. Pour comparer quelques prix au moment
  d'expédier, la boutique porterait le secret le plus fort du commerçant.
- **Relancer l'achat d'office après une réponse perdue** : sans idempotence,
  chaque relance peut payer un envoi de plus.
- **Copier l'étiquette dans R2** : un fichier de plus qui porte une adresse
  d'acheteur, à classer pour l'effacement
  ([ADR 0017](0017-effacement-et-portabilite.md)), alors que Boxtal le resigne
  à la demande.
- **Garder `trackingUrl()` pour Mondial Relay** : l'URL dépend du code
  d'enseigne de l'expéditeur, que seul Boxtal connaît.

## Vérification

- les tests des adaptateurs Boxtal rejouent `test/fixtures/boxtal/` :
  - le point refusé (`17`) ;
  - la commande inconnue (`18`) ;
  - le doublon accepté (`16`) puis annulé (`20`) ;
  - l'annulation refusée après la prise en charge (`25`) ;
  - le suivi et son `packageExternalId` (`14`, `19`) ;
- `test/integration/shipping.mjs` mène un achat jusqu'à `uncertain`. Il refuse
  un identifiant collé dont le `packageExternalId` n'est pas celui de l'envoi,
  et accepte le bon ;
- aucune colonne ni aucun réglage ne reçoit l'identifiant ou le mot de passe du
  compte Boxtal : le coffre n'a que deux `SecretName` pour Boxtal.
