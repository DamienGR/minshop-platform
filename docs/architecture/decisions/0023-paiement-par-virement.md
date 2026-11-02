# ADR 0023 — Le paiement par virement, rapproché à la main

- **Statut** : Proposé
- **Date** : 2026-11-02
- **Jalon** : après le pilote (plan §13.5) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), qui ne prévoit
  que Stripe Checkout et le paiement par carte

## Contexte

Le ticket #146 (2026-11-02) demande le virement bancaire à côté de la carte :
l'acheteur le choisit au moment de payer, reçoit des coordonnées bancaires et
une référence, et la commande n'est enregistrée qu'à réception des fonds. Le
besoin vient de la première boutique réelle, dont le site actuel accepte le
virement et garde une commande impayée huit jours avant de l'annuler.

L'ADR 0007 ne range le virement ni dans le périmètre ni dehors ; il demande
une décision explicite avant qu'une fonctionnalité qu'il ne liste pas entre
dans l'offre.

Le ticket décrit deux pistes. La piste A, le virement de Stripe
(`customer_balance`), rapproche le virement tout seul, au prix d'un client
Stripe par acheteur, des frais Stripe, d'un client Stripe de plus à effacer, et
d'une réservation `payment_pending` qu'il faudrait borner. La piste B affiche le
RIB du marchand et une référence ; le marchand confirme la réception dans
l'administration. **Damien a choisi la piste B le 2026-11-02.**

Ce que le socle sait déjà faire (v0.3.36) :

- `pending_payments` garde un paiement commencé qui n'est pas une commande
  (Lightning, OpenNode, Démo), avec la page `/pay/<jeton>` qui l'affiche ;
- `checkout_reservations` tient le stock pendant le paiement, et le cron de
  cinq minutes libère les réservations Lightning et Démo échues ;
- `recordPaidOrder` écrit la commande d'un paiement en attente, et sait régler
  un paiement arrivé après la fin de sa réservation : il reprend alors le stock
  et note un manque en anomalie de stock ;
- `/checkout` prend l'adresse, le tarif, le point relais et l'acceptation des
  CGV pour les moyens qui n'ont pas de page hébergée ;
- `docs/operations/remboursement.md` (§ 4) traite le remboursement d'un
  virement fait hors de la boutique.

## Décision

**Le virement est un moyen de paiement du socle, `bank_transfer`**, à côté de
la carte. Les identifiants restent en anglais (AGENTS.md) ; le ticket écrivait
`'virement'`. C'est un moyen réel : en service, il retire la commande de
démonstration, comme Stripe.

**Le RIB se règle dans Admin → Réglages → Paiements** : titulaire, IBAN, BIC
facultatif, délai. Ce sont des réglages ordinaires, pas des secrets du coffre :
un IBAN est imprimé sur chaque facture et chaque acheteur le lit. L'IBAN est
refusé s'il ne passe pas sa clé (ISO 13616, modulo 97) : un chiffre faux
enverrait chaque virement vers une banque qui le renvoie, des jours plus tard,
le stock tenu pour rien. Le moyen est en service dès qu'un titulaire et un IBAN
valide sont enregistrés ; un IBAN effacé le ferme.

**Le stock est réservé huit jours par défaut**, le délai du site actuel de la
première boutique, réglable de 1 à 30 jours. La réservation est `active` avec
cette échéance ; le cron la libère à l'échéance, comme celles de Lightning et
de Démo. Le statut `payment_pending`, sans échéance, n'est pas utilisé.

**Le parcours passe par `/checkout`**, comme Lightning et Démo : l'adresse, le
tarif, le point relais s'il y en a, l'acceptation des CGV. La réservation est
prise, puis une ligne `pending_payments` (`backend = 'bank_transfer'`), jamais
une commande impayée (invariant 2). L'acheteur arrive sur `/pay/<jeton>`, la
page du virement : le titulaire, l'IBAN en groupes de quatre, le BIC, le
montant, la référence et l'échéance, avec le récapitulatif de la commande. Un
panier sans rien à expédier saute `/checkout` ; la page demande alors l'e-mail.
Le panier est vidé : pour l'acheteur, la commande est passée.

**La référence est celle de la commande** : les dix caractères qui suivent
`ord_`, en capitales (`7K3F9QMZ2A`). La même chaîne nomme la commande sur sa
page, dans ses e-mails et dans la recherche de l'administration ; le marchand
relie une ligne de relevé à une commande. L'alphabet de Crockford n'a ni I, ni
L, ni O, ni U à mal lire.

**Deux e-mails partent au moment de la commande** : à l'acheteur, la copie de
la page ; au marchand (le destinataire des avis de commande), l'annonce d'un
virement attendu, avec le montant, la référence et l'échéance. Ce ne sont pas
des avis de commande : il n'y a pas encore de commande, et l'outbox, rattachée
à une commande, ne les porte pas. Ils partent une fois, sans nouvelle
tentative ; la page reste la référence, joignable par son lien. Pas de
relance avant l'échéance dans cette version.

**Le marchand rapproche à la main.** Admin → Commandes ouvre sur les
virements attendus, du plus ancien au plus récent : référence, montant, e-mail,
date, échéance. Deux actions, chacune confirmée :

- **Virement reçu** écrit la commande par `recordPaidOrder`, comme tous les
  moyens : la commande payée `bank_transfer`, l'e-mail de confirmation et
  l'avis au commerçant par l'outbox, la ligne en attente réglée dans le même
  lot. La page du virement renvoie dès lors vers la page de commande ;
- **Abandonner** passe la ligne à `abandoned` et remet le stock en vente s'il
  était encore tenu. La page du virement dit que la commande est annulée.

Le marchand vérifie lui-même le montant et la référence sur son relevé. Un
virement partiel ou excédentaire n'est pas enregistré tel quel : le marchand
voit avec l'acheteur, et rembourse l'écart lui-même.

**Un virement arrivé après l'échéance peut encore être enregistré**
(choix de Damien, 2026-11-02) : « Virement reçu » reste proposé sur
un virement échu, avec une confirmation qui dit que le stock a été remis en
vente. L'enregistrer reprend le stock ; s'il en manque, la commande entre dans
les anomalies de stock, comme un paiement Stripe tardif. Le rapprochement est
déjà manuel : le marchand voit le stock avant de cliquer. L'autre choix,
refuser le virement échu et le rembourser, obligerait l'acheteur à recommander
une pièce souvent encore là.

**Le remboursement se fait hors de la boutique**, par le moyen utilisé :
`docs/operations/remboursement.md`, § 4, puis « Enregistrer un remboursement
déjà effectué » sur la commande.

**Aucune donnée personnelle nouvelle.** La ligne en attente garde l'e-mail et
l'adresse, déjà classés dans la carte des données personnelles
(`shopctl/src/privacy/map.mjs`) ; le RIB est celui du marchand. La migration
0050 n'ajoute qu'un index, sur lequel la liste des virements attendus lit sans
parcourir l'historique de `pending_payments`.

## Conséquences

- l'ADR 0007 prend le virement dans le périmètre, sous cette forme manuelle ;
  le virement de Stripe (piste A) reste hors périmètre ;
- un virement que le marchand n'enregistre pas avant l'échéance libère le
  stock ; un acheteur qui paie le dernier jour dépend de la diligence du
  marchand à relever ses comptes ;
- le RIB affiché est celui du moment, pas une copie : un changement de compte
  se lit sur la page des virements déjà attendus, l'e-mail déjà envoyé garde
  l'ancien ;
- l'e-mail d'un virement attendu qui échoue n'est pas renvoyé (le journal le
  dit, sans l'adresse) ; l'acheteur a la page, le marchand la liste ;
- le texte de personnalisation d'un produit (ADR 0022) reste sur la
  réservation jusqu'au règlement ; trois jours après l'échéance, le balayage
  qui masque le lien d'invité l'efface. Un virement enregistré plus de trois
  jours après son échéance fait une commande sans ce texte ;
- la libération à l'échéance dépend du cron, comme pour Lightning : un cron
  arrêté garde le stock réservé au-delà ;
- la migration 0050 est à lister dans les notes de la prochaine version du
  socle ;
- la première boutique réelle qui l'active vérifie le parcours à sa recette :
  une commande par virement, l'e-mail reçu, l'enregistrement, la confirmation.

## Alternatives écartées

- **Le virement de Stripe (piste A)** : rapprochement automatique, mais un
  client Stripe par acheteur, des frais par virement, un client de plus à
  effacer chez Stripe, et la session Stripe à changer. Écartée par Damien le
  2026-11-02.
- **Une commande `pending` dans `orders`** : casse l'invariant 2, et avec lui
  les listes, le chiffre d'affaires et l'export CSV, qui lisent `orders` comme
  des commandes payées.
- **La réservation `payment_pending`** : faite pour un prélèvement qui finit
  par aboutir ou échouer, elle n'a pas d'échéance ; un virement qui n'arrive
  jamais y tiendrait le stock pour toujours.
- **Le RIB dans le coffre chiffré** : un IBAN n'est pas un secret, et le lire
  demanderait un déchiffrement à chaque page de virement, et `SECRETS_KEK`
  pour un moyen qui n'a aucune clé.
- **Une copie du RIB sur chaque ligne en attente** : trois colonnes pour un
  changement de compte rare, que l'e-mail déjà envoyé couvre.
- **Les e-mails d'attente par l'outbox** : elle est rattachée à une commande ;
  la porter avant la commande demanderait une seconde file pour deux e-mails
  que la page remplace.

## Vérification

- `src/features/payments/bankTransfer.test.ts` : la clé de l'IBAN, le BIC, le
  moyen ouvert ou fermé, le délai, la référence ;
  `src/features/payments/methods.test.ts` : le virement retire la démonstration ;
- `test/integration/bank-transfer.mjs`, sur le Worker construit : les réglages
  refusent un IBAN faux, le panier propose le virement, `/checkout` mène à la
  page du virement, la réservation tient le délai réglé, les deux e-mails, la
  liste de l'administration, « Virement reçu » écrit la commande et sa
  confirmation, « Abandonner » remet le stock, l'échéance le libère par le
  balayage, un virement échu reprend le stock, l'API JSON rend le RIB ;
- `test/integration/history-reads.mjs` : la liste des virements attendus lit
  quelques lignes, pas l'historique de `pending_payments`.
