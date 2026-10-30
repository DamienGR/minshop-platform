# Corpus du bac à sable Boxtal

Des réponses réelles de l'API v3 de Boxtal, relevées le 2026-10-30 dans son bac
à sable (`https://api.boxtal.build`) avec l'application de test de l'agence,
pour l'[ADR 0020](../../../docs/architecture/decisions/0020-expeditions-par-boxtal.md)
et le lot 1 du plan (§13.3). Les adaptateurs Boxtal se testent sur ces
fichiers, sans appel réseau : la spécification OpenAPI de Boxtal ne suffit pas.
L'[ADR 0021](../../../docs/architecture/decisions/0021-boxtal-apres-le-bac-a-sable.md)
tire de ces constats ce qui change à l'ADR 0020.

Chaque fichier garde la requête (`method`, `path`, `body`) et la réponse
(`status`, `ms`, `contentType`, `body`), jamais un en-tête : aucune clé n'y
figure. Les parties sont fictives (« Boutique Essai », « Jeanne Essai »,
adresses en `example.com`) ; les points relais sont des commerces publics.
Deux retouches seulement, après le relevé :

- les URL signées des étiquettes ont `Signature` et `Key-Pair-Id` masqués ;
- les listes de points sont coupées (cinq points, deux par réseau dans `04`),
  et `pointsReturned` donne le nombre de points de la réponse entière.

## Les fichiers

| Fichier | Appel | Ce qu'il montre |
|---|---|---|
| `01` | `GET /shipping/v3.2/parcel-point-by-network`, Mondial Relay, 75011 | 30 points, triés par distance |
| `02` | `GET /shipping/v3.2/parcel-point-by-shipping-offer`, `MONR-CpourToi` | les mêmes points que `01`, consignes comprises |
| `03` | même appel, `POFR-ColissimoPickupStation`, 35000 | des réseaux Colissimo plafonnés en poids |
| `04` | `parcel-point-by-network`, trois réseaux, 35000 | 30 points partagés en 10 par réseau |
| `05` | `parcel-point-by-shipping-offer`, code postal `00000` | `200` et une liste vide, pas une erreur |
| `06` | `GET /shipping/v3.1/content-category` | les natures de contenu qu'un colis doit déclarer |
| `10` | `POST /shipping/v3.1/shipping-order`, `POFR-ColissimoAccess` | commande à domicile : `PENDING`, prix hors taxes |
| `11` | même appel, `MONR-CpourToi`, `pickupPointCode` | commande en relais, sans point de dépôt |
| `12` | `GET /shipping/v3.1/shipping-order/{id}` | `CONFIRMED` 14 s après la commande |
| `13`, `15` | `GET …/{id}/shipping-document` | l'étiquette, en URL signée |
| `24` | le même appel que `13`, six minutes plus tard | une autre URL, une autre échéance |
| `14`, `19` | `GET …/{id}/tracking` | numéro, URL de suivi du transporteur, statut |
| `16` | `POST` du corps de `10`, à l'identique | un doublon accepté : nouvelle commande |
| `17` | `POST` vers un point inconnu | `422`, `ValidationException.PickupPointCode` |
| `18` | `GET` d'une commande inconnue | `422`, `ShippingOrderNotFoundException` |
| `20`, `21` | `DELETE …/{id}`, puis `GET` | le doublon annulé : `CANCELLED` |
| `22`, `23` | le suivi de `14` et `19`, 30 minutes plus tard | `SHIPPED`, l'historique allongé |
| `25`, `26`, `27` | `DELETE` des deux commandes une fois `SHIPPED`, puis `GET` | `422`, `InvalidRequestException` : rien n'est annulé |

## Ce que le bac à sable a établi

**La recherche des points.**

- Une réponse en 0,5 à 1 s.
- Au plus 30 points, triés par distance en mètres. Pour plusieurs réseaux, les
  30 se partagent à parts égales.
- Un code postal inconnu rend `200` et une liste vide : « aucun point » n'est
  pas une panne.
- Un point porte :
  - un code, un nom, une adresse et une position ;
  - ses horaires, jour par jour (une liste vide = fermé) ;
  - ses réseaux compatibles.

  Il ne porte ni téléphone ni fermeture exceptionnelle.
- Les réseaux compatibles disent ce qu'un point accepte :
  - le réseau Mondial Relay mêle points et consignes
    (`MONR_LOCKERS_ONLY_NETWORK`, 14 points sur 30 à Paris 11e) ;
  - Colissimo plafonne par poids (`POFR_UP_TO_10_KG_NETWORK` à
    `POFR_UP_TO_30_KG_NETWORK`), et 5 points sur 30 seulement prennent 30 kg à
    Rennes.

  La boutique filtre donc les points selon le poids du colis.
- **Aucun appel ne relit un point par son code** :
  `/shipping/v3.1/parcel-point` est déprécié et cherche lui aussi.
  - Boxtal valide le point quand l'étiquette s'achète (`17`).
  - Au moment de réserver, la boutique ne peut vérifier qu'une chose : le code
    reçu fait partie des points qu'elle a elle-même servis pour ce code postal
    et cette offre.

**La commande et son prix.**

- `POST /shipping-order` répond en 0,8 à 1,4 s.
- La commande naît `PENDING` et passe `CONFIRMED` en 14 s.
- La réponse donne `deliveryPriceExclTax` : 8,11 € HT en Colissimo Access et
  4,19 € HT en Mondial Relay, pour 0,8 kg.
- **Le prix n'est connu qu'après l'achat** : l'API v3 n'a pas de cotation.
- La bibliothèque de Boxtal fait la cotation v1 (`boxtal/php-library`) avec
  l'identifiant et le mot de passe du compte, pas avec les clés de
  l'application v3. Ce n'est pas essayé ici.
- Le compte qui commande est en paiement différé par prélèvement, pas en
  prépaiement (guide `getting-started-api-v3`).

**Pas d'idempotence, pas de liste.**

- Le même corps renvoyé crée une seconde commande (`16`), même avec les mêmes
  `externalId` d'expédition et de colis.
- Aucun appel ne liste les commandes, ni ne cherche par `externalId`.
- Une commande se relit par son identifiant Boxtal. Elle ne rend pas
  l'`externalId`, mais son suivi rend `packageExternalId` (`14`).
- Une commande se défait par `DELETE` (`20`), mais seulement avant que le
  transporteur ait pris le colis. Une fois `SHIPPED`, le `DELETE` rend `422`
  et un `InvalidRequestException` sans détail, et la commande reste
  `CONFIRMED` (`25` à `27`). Un doublon s'annule donc vite, ou se paie.

  Ce qu'un envoi réel annulé coûte reste à voir sur le compte réel. Dans le bac
  à sable, rien n'est facturé, et les deux commandes de `22` et `23` y restent.

**L'étiquette.**

- `shipping-document` donne une URL signée sur `document.boxtal.build`,
  valable 31 jours.
- Chaque lecture en signe une nouvelle : une seconde lecture, six minutes plus
  tard, a rendu une autre URL, avec une autre échéance.
- Le document est prêt dès `CONFIRMED` dans le bac à sable ; le webhook
  `DOCUMENT_CREATED` l'annonce.
- `PDF_10x15` demandé, `PDF_A4` rendu : un PDF de 3 466 octets, au format A4.

**Le suivi.**

- Le numéro et l'URL de suivi du transporteur arrivent dès la commande :
  - `laposte.fr/outils/suivre-vos-envois?code=…` pour Colissimo ;
  - `mondialrelay.com/public/permanent/tracking.aspx?ens=…&exp=…` pour Mondial
    Relay.
- Le statut naît `ANNOUNCED` (« Envoi préparé ») ; 30 minutes plus tard, les
  deux colis étaient `SHIPPED` (`22`, `23`).
- Le bac à sable promet un faux événement toutes les 20 minutes. Il en a
  produit toutes les 10 minutes pour Colissimo : cinq événements, dont
  `IN_TRANSIT`.
- L'historique va du plus récent au plus ancien. Deux événements peuvent
  partager la même seconde : `SHIPPED` y est listé avant `IN_TRANSIT`, et c'est
  lui que le statut de tête reprend. Le rang d'un statut ne dit donc pas
  l'ordre des faits : la boutique lit le statut de tête et `isFinal`, sans
  trier.
- La spécification énumère neuf statuts : `ANNOUNCED`, `SHIPPED`,
  `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `FAILED_ATTEMPT`,
  `REACHED_DELIVERY_PICKUP_POINT`, `DELIVERED`, `RETURNED` et `EXCEPTION`.
- `trackingDateTime` est l'heure de Paris, sans fuseau : `16:40:03` pour un
  relevé fait à 15 h 40 UTC. Les dates de Mondial Relay sont fictives
  (`08:00:00`, `10:00:00`).
- `location` est parfois rempli (« Centre Courrier 34 »), parfois `null`.

**Le webhook.**

- La signature `x-bxt-signature` est un HMAC SHA256 du corps seul, sans
  horodatage : un appel rejoué passe la vérification. Le webhook n'étant qu'un
  signal que la boutique vérifie en relisant, cela ne change rien.
- Une souscription ne reçoit que les événements des commandes de sa propre
  application.
- Pas essayé ici : il faut une URL publique.

## Ce qui reste ouvert

- La remise d'un colis Mondial Relay commandé sans `dropoffPointCode` (`11`) :
  dépôt dans n'importe quel point, ou enlèvement ? À établir sur le compte réel.
- Les consignes : l'offre `MONR-CpourToi` les propose (`02`). Un colis de
  30 × 20 × 10 cm y entre-t-il, et faut-il les écarter ?
- Le format `PDF_10x15` : est-ce le bac à sable seul qui rend du A4 ?
- Ce que coûte une commande réelle annulée avant la prise en charge.
- Le webhook, de bout en bout, sur une boutique déployée.
