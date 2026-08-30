# ADR 0010 — TVA, facturation et consentement aux CGV

- **Statut** : Accepté, sous réserve de validation externe (voir Conséquences)
- **Date** : 2026-08-30
- **Jalon** : 3

## Contexte

Le jalon 3 demande de figer un modèle français de prix, de TVA, de facturation
et de consentement avant que le pilote ne vende quoi que ce soit. La question
n'est pas ouverte : le manifeste la contraint déjà à trois endroits
(`commerce.pricesIncludeTax`, `commerce.defaultVatRate`,
`commerce.invoiceStrategy`), et la règle croisée `french-prices-include-tax`
refuse un manifeste `market: FR` qui ne vend pas TTC. Ce qui manquait, c'est ce
que le code en fait et ce que la commande en garde.

Quatre faits contraignent la décision.

**Un prix français est TTC.** Le code de la consommation impose l'affichage
toutes taxes comprises au consommateur. La taxe est donc *dans* le prix, pas
ajoutée dessus au moment de payer.

**Le socle avait déjà une colonne `tax_cents`, qui veut dire autre chose.**
Elle porte la taxe *ajoutée* au total, ce que calcule Stripe Tax en tarification
`exclusive`. Réutiliser cette colonne pour de la TVA incluse rendrait le total
de toute commande historique ambigu : impossible de savoir, en la relisant, si
`amount_total_cents` contient déjà `tax_cents` ou non.

**Une commande est écrite par un webhook qui n'a jamais vu l'acheteur.**
Le taux applicable est celui en vigueur au moment où l'acheteur a accepté le
prix ; le recalculer au règlement ferait basculer, la veille d'un changement de
taux, la ventilation d'une commande passée sous l'ancien.

**Une facture française est un document numéroté par une séquence continue,
sans trou et sans doublon**, dont la forme engage le vendeur. C'est un
livrable réglementaire, pas un rendu.

## Décision

**Les prix sont TTC, stockés en unités mineures entières, et le restent.**
Aucune conversion HT/TTC n'a lieu au panier ni au paiement : le montant affiché
est le montant débité.

**Un taux unique par boutique, pas un taux par produit.** Il vit dans
`config.legal.vatRateBps`, en *points de base* (2000 = 20 %) — la France a des
taux à 5,5 % et 2,1 %, qu'un pourcentage entier ne peut pas porter. Le registre
de l'agence reste `commerce.defaultVatRate` au manifeste ; les deux doivent
concorder. Un taux par produit est une décision de version de schéma, pas une
option de configuration : elle touche le catalogue, l'import CSV et la
ventilation, et le périmètre du pilote (§2.1) ne contient aucun catalogue mixte.

**Stripe Tax reste désactivé.** Il calcule une taxe à ajouter à un prix HT, ce
que cette offre ne fait pas. L'activer sur des prix TTC facturerait la TVA deux
fois.

**La ventilation est enregistrée avec la commande**, dans deux colonnes qui lui
sont propres : `vat_rate_bps` (le taux en vigueur à l'achat) et
`vat_amount_cents` (la TVA contenue dans `amount_total_cents`). `tax_cents`
garde son sens et vaut 0 sur une boutique TTC.

**L'arrondi se prend une fois, sur le total payé, jamais par ligne.** Trois
lignes à 3,33 € arrondissent à 56 c de TVA chacune, soit 1,68 €, là où la
commande de 9,99 € en contient 1,67 €. Le total est ce que l'acheteur a payé et
ce que la comptabilité lit ; c'est donc de lui que la ventilation est tirée.
`vatIncludedCents()` est l'unique implémentation de cette règle : le règlement
l'appelle en TypeScript plutôt que de la recopier en SQL.

**Le taux voyage sur la réservation**, comme l'acceptation des CGV, parce que la
réservation est la seule ligne qui enjambe la requête de commande et la requête
de règlement.

**Le pilote émet un reçu, pas une facture.** `commerce.invoiceStrategy` vaut
`pending-validation` : l'e-mail de confirmation et la page de commande portent
le détail, le total et la ventilation de TVA, et aucune numérotation de facture
n'est émise. Une séquence de facturation ouverte avant que sa forme ne soit
validée produirait des numéros qu'il faudrait ensuite réémettre — ce qu'une
séquence continue interdit précisément de faire.

**Le consentement aux CGV est enregistré avec la commande** : `terms_version` et
`terms_accepted_at`. Un seul prédicat (`features/legal/terms.ts`) décide à la
fois de l'affichage de la case et du refus serveur, et il est fermé exactement
quand la page des CGV est publiée. Une boutique naît avec ses pages légales en
brouillon (migration 0040), donc la porte est ouverte tant que le commerçant n'a
pas fini de les écrire : exiger l'acceptation d'un document que personne n'a
rédigé empêcherait un clone neuf de passer la moindre commande de test.

**Le refus a lieu avant la réservation de stock.** Une commande qui ne peut pas
aboutir légalement ne doit pas retirer d'inventaire de l'étagère.

**L'export comptable est l'export de commandes existant**, augmenté des colonnes
ci-dessus. Il n'y a pas de second format : un export dédié à la comptabilité
diverge du premier dès la première évolution du schéma.

## Conséquences

- une commande relue dans dix ans dit sous quelle version des CGV elle a été
  passée, à quel taux, et pour quel montant de TVA ;
- la ventilation est une lecture du total, jamais une addition : un total
  historique reste interprétable sans connaître la configuration du jour ;
- une boutique qui n'a pas configuré de taux enregistre `NULL`, pas zéro. « Nous
  ne savons pas » et « il n'y avait pas de TVA » sont deux faits différents ;
- **cette décision n'est pas commercialisable en l'état.** Le plan §6 jalon 3
  exige la validation par un comptable ou un conseil compétent, et elle n'est pas
  obtenue. Tant qu'elle ne l'est pas, aucune boutique ne passe en production :
  c'est une condition de déploiement (§9), pas une réserve de rédaction ;
- la facturation numérotée est un livrable distinct, à ouvrir après cette
  validation. `invoiceStrategy` porte déjà la valeur qui le dit ;
- un catalogue à taux mixtes demandera une version 2 du manifeste, une colonne
  par produit et une ventilation par ligne — donc une règle d'arrondi différente
  de celle-ci. Cet ADR sera à remplacer, pas à amender.

## Alternatives écartées

- **Réutiliser `tax_cents` pour la TVA incluse** : rend ambigu le total de toute
  commande antérieure et de toute commande future d'une boutique qui
  activerait Stripe Tax. Deux sens dans une colonne, c'est un sens perdu.
- **Activer Stripe Tax** : il ajoute la taxe à un prix HT. Sur des prix TTC, il
  la facturerait une seconde fois, et le montant débité cesserait d'être le
  montant affiché.
- **Calculer la ventilation à l'affichage plutôt que la stocker** : le taux
  affiché serait celui du jour, pas celui de l'achat. Une commande relue après
  un changement de taux mentirait, sans que rien ne le signale.
- **Ventiler par ligne** : dérive d'un centime par lot de lignes, et le total
  ventilé cesse d'égaler le total payé.
- **Un taux par produit dès le pilote** : le périmètre ne contient aucun
  catalogue mixte, et le coût est réel — colonne, import CSV, ventilation par
  ligne, arrondi différent. Une capacité non exercée est une capacité non
  testée.
- **Émettre des factures numérotées immédiatement** : la numérotation d'une
  facture est continue par obligation. Ouvrir la séquence avant validation de la
  forme oblige, en cas de correction, à réémettre des numéros déjà attribués.
- **Rendre l'acceptation des CGV obligatoire dès l'installation** : bloquerait
  toute boutique neuve, y compris la commande de démonstration, derrière un
  document que le commerçant n'a pas encore écrit. La porte suit la publication
  de la page, ce qui est le seul signal qui dise que le document existe.
- **Deux prédicats, l'un pour la case et l'autre pour le refus** : les deux
  façons de diverger sont mauvaises — un formulaire qui demande un accord que
  personne n'enregistre, ou un serveur qui refuse une commande que la page ne
  permettait pas d'accepter.

## Vérification

- `src/features/legal/vat.test.ts` fixe les taux français, l'arrondi au dernier
  centime, la non-dérive par rapport à une ventilation par ligne, et le fait que
  HT + TVA redonne exactement le montant débité ;
- `src/features/legal/terms.test.ts` fixe la lecture du consentement, y compris
  le refus de la chaîne `"false"` que `Boolean()` lirait comme un accord ;
- `test/integration/terms.mjs` exécute contre un vrai D1 le trajet que seul un
  test d'intégration peut voir : porte ouverte sur un brouillon, fermée sur une
  page publiée, taux et version recopiés de la réservation vers la commande ;
- `npm run config:validate` applique `french-prices-include-tax` aux deux
  boutiques témoins.
