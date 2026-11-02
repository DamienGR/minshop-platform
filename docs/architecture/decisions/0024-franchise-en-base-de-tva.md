# ADR 0024 — La franchise en base de TVA

- **Statut** : Proposé
- **Date** : 2026-11-02
- **Jalon** : après le pilote (plan §13.6) ; aucun des jalons 0 à 10. Lève, pour
  la première boutique réelle, la part « franchise en base » de la condition
  « validation TVA et facturation » du go de l'étape 11
- **Amende** : l'[ADR 0010](0010-tva-facturation-et-consentement.md), qui ne
  connaît qu'un taux par boutique

## Contexte

Le ticket #148 (2026-11-02) : un vendeur en franchise en base de TVA
(art. 293 B du CGI, le cas courant d'une micro-entreprise sous les seuils) ne
facture pas de TVA et doit l'écrire. Sa boutique ne doit ni afficher ni
enregistrer de TVA, et porter « TVA non applicable, art. 293 B du CGI » sur ce
qui tient lieu de document de commande. La première boutique réelle est dans
ce cas.

C'est un manque connu du périmètre certifié, pas une extension : la fiche de
l'étape 11 (§ 3, question 5) l'a relevé, le dossier de décision l'a reporté à la
première boutique réelle (ligne « validation TVA et facturation »), et
`docs/operations/mise-en-ligne.md` demande qu'il soit construit avant la
première vente.

Ce que le socle savait (v0.3.36) :

- le manifeste n'accepte que `defaultVatRate` à 20, 10, 5,5 ou 2,1 : une
  boutique en franchise n'y peut rien déclarer de juste ;
- `legal.vatRateBps` (2000 par défaut) se surcharge dans `src/store.config.ts` ;
  à 0, la commande n'enregistre aucune ventilation (`NULL`), c'est-à-dire
  « nous ne savons pas », pas « il n'y avait pas de TVA » ;
- rien ne compare le taux du manifeste à celui de la configuration : « the two
  must agree » n'était qu'un commentaire ;
- la suite d'intégration exigeait 20 % : une boutique à 0 avait un
  `npm run verify` rouge ;
- aucune surface n'écrivait la mention.

Le seuil de la franchise se franchit en cours d'année : le vendeur devient
redevable de la TVA dès le jour du dépassement. Une boutique peut donc changer
de régime une fois, et ses commandes passées ne doivent pas changer avec elle.

## Décision

**Le manifeste déclare l'exonération à la place du taux :
`commerce.vatExemption: franchise`.** Une exonération n'est pas un taux, et
c'est elle qui donne la mention. `defaultVatRate` et `vatExemption` forment une
paire dont une boutique déclare exactement une moitié (règle
`vat-rate-or-exemption`) ; chacune est facultative au schéma parce que l'autre
la remplace. Une seule valeur, `franchise` : les autres exonérations françaises
visent l'export et les ventes entre professionnels de l'Union, que le périmètre
B2C France (ADR 0008) ne vend pas.

**Pas de version de schéma.** L'ADR 0008 en demande une quand un manifeste
publié cesse de valider sans changement ; tous ceux d'aujourd'hui valident
encore tels quels, `defaultVatRate: 20` restant la façon de dire qu'on facture
la TVA.

**La configuration dit la même chose : `legal.vatExemption: 'franchise'` dans
`src/store.config.ts`.** L'exonération l'emporte sur tout taux :
`legal.vatRateBps` garde son défaut de 2000, et une boutique en franchise qui ne
l'a pas touché ne calcule pas 20 % pour autant. Le défaut vit désormais dans
`src/features/legal/vat.ts`, un module sans import, pour que la porte le lise
au lieu de le recopier.

**`npm run config:validate` tient ensemble le manifeste et la configuration**,
dans une boutique, comme il le fait déjà pour le thème. Il lit
`src/store.config.ts` dans Node (`scripts/store-vat.mjs`) et refuse les deux
erreurs du ticket : un manifeste en franchise sur une construction qui calcule
la TVA, et un manifeste au taux sur une construction exonérée ou à un autre
taux. `shopctl config validate` le relaie, comme il relaie le reste de la
porte.

**La commande enregistre l'exonération, et la porte depuis la réservation**
(migration 0051, `vat_exemption` sur `orders` et `checkout_reservations`).
Une commande en franchise enregistre un taux et un montant de TVA à 0 et
`vat_exemption = 'franchise'` : « il n'y avait pas de TVA », et pourquoi. Une
commande sans ventilation connue garde `NULL` partout (ADR 0010). L'exonération
voyage sur la réservation pour la même raison que le taux : le webhook qui écrit
la commande n'a jamais vu l'acheteur, et la configuration du jour n'est pas
celle de l'achat.

**La mention est lue sur la commande, jamais sur la configuration**, mot pour
mot : « TVA non applicable, art. 293 B du CGI » (`vat.exemption.franchise`). Elle
figure sous le total, à la place de la ligne « dont TVA », sur :

- la page de commande, `/order/<jeton>` ;
- l'e-mail de confirmation, dans sa partie HTML et dans sa partie texte ;
- l'avis de commande au commerçant, de même.

Ce sont les documents que l'ADR 0010 désigne comme tenant lieu de facture tant
qu'aucune facture numérotée n'existe. Un vendeur qui sort de la franchise
garde la mention sur ce qu'il a vendu avant, et ne la porte pas sur ce qu'il
vend après.

**L'export CSV distingue la franchise d'une TVA non renseignée.** `VAT rate` et
`VAT included` y valent 0 et `Net of VAT` le total ; une dernière colonne,
`VAT exemption`, porte `franchise`. Une commande sans ventilation laisse les
quatre vides. La colonne vient en dernier, comme chaque colonne ajoutée depuis
le premier export, pour qu'un tableur qui lit les autres par position continue
de les lire.

**La suite d'intégration attend la TVA que la boutique configure**, lue par
`scripts/store-vat.mjs`, et non plus 2000 : une boutique en franchise passe
`npm run verify`.

## Conséquences

- une boutique en franchise se déclare en deux lignes, une au manifeste, une
  dans `src/store.config.ts`, et la porte refuse qu'elle n'en écrive qu'une ;
- une commande relue dans dix ans dit si elle a été vendue avec de la TVA, à
  quel taux, ou sous quelle exonération ;
- `src/store.config.ts` doit rester lisible par Node : des valeurs, et des
  imports de types seulement. Un fichier qui importe un module du runtime
  (`cloudflare:workers`) ne peut pas être comparé au manifeste, et la porte le
  refuse plutôt que de le laisser passer sans contrôle ;
- **la mention n'est pas écrite par le socle ailleurs que sur la commande** :
  ni au pied de page, qui appartient au thème de la boutique, ni dans les CGV,
  qui sont le texte du commerçant. Le commerçant en franchise l'écrit dans
  l'article « Prix » de ses CGV (`docs/operations/mise-en-ligne.md`). Un pied de
  page qui la porte sur chaque page demanderait un champ du modèle de coquille
  et une ligne dans chaque thème ; à construire si l'expert-comptable le
  demande ;
- **le reçu de Stripe ne la porte pas.** Avec `invoiceStrategy: stripe-receipt`,
  l'e-mail de confirmation de la boutique la porte toujours ; si le reçu de
  Stripe devait être le seul document, la question revient à l'expert-comptable
  (étape 11, § 3, question 1) ;
- **les endroits de la mention sont à valider** par l'expert-comptable du
  commerçant, avec les autres questions de la fiche de l'étape 11. D'où le
  statut « Proposé » ;
- le réglage « Taxes automatiques » (Stripe Tax) ne connaît pas le régime :
  l'ADR 0010 le garde éteint sur toute boutique TTC, et il le reste ici. Le
  bloquer en franchise est un changement de l'écran des réglages, hors de ce
  ticket ;
- sortir de la franchise, c'est changer les deux lignes ensemble et déployer ;
  les réservations ouvertes gardent les conditions sous lesquelles l'acheteur
  a accepté le prix.

## Alternatives écartées

- **`defaultVatRate: 0` ajouté à l'énumération** : déclare un taux là où il y a
  une exonération, et perd ce qui donne la mention. Le jour où une deuxième
  exonération existerait, 0 voudrait dire deux choses. C'est aussi la faute de
  frappe la plus probable d'un vendeur en franchise, qui perdrait sa mention
  sans erreur : le schéma refuse 0.
- **Un champ `vatRegime` obligatoire** : une version 2 du schéma, donc un
  manifeste à reprendre dans chaque boutique à sa mise à niveau, pour une valeur
  que toutes sauf une partagent.
- **Un champ `vatRegime` facultatif, `standard` ou `franchise`** : deux façons
  de dire « assujetti » (la valeur ou son absence), et un `defaultVatRate`
  obligatoire qu'un vendeur en franchise devrait remplir d'une valeur qui ne
  veut rien dire.
- **Le taux à 0 dans la configuration comme signe de la franchise** : le 0
  existant veut dire « pas de ventilation configurée », qui enregistre `NULL`.
  Lui donner un second sens rendait indiscernables une boutique exonérée et une
  boutique mal réglée.
- **Déduire la franchise de `vat_rate_bps = 0`, sans colonne** : tient tant qu'il
  n'y a qu'une exonération, et fait dire à un taux la base légale d'une mention.
  Deux sens dans une colonne, c'est un sens perdu (ADR 0010).
- **Lire la mention sur la configuration du jour** : la mention suivrait le
  régime du jour, pas celui de la vente. Une boutique sortie de la franchise
  l'effacerait des commandes qu'elle a vendues sans TVA.
- **Dériver la configuration du manifeste au rendu** (une variable Wrangler,
  comme `STORE_NAME`) : la TVA deviendrait une variable d'environnement du
  Worker, que les rendus sans manifeste (CI, clone propre, `provision-cf.sh`)
  écriraient à sa valeur par défaut. Une porte qui compare deux fichiers
  versionnés se relit ; une variable de déploiement oubliée ne se voit qu'à la
  première commande.

## Vérification

- `src/features/legal/vat.test.ts` fixe l'exonération qui l'emporte sur le taux,
  le 0 enregistré avec elle, le `NULL` d'une boutique sans ventilation, et
  l'exonération inconnue qui ne devient ni mention ni taux ;
- `src/features/email/orderNotification.test.ts` fixe la mention sous le total,
  dans les deux parties des deux e-mails, et son absence ailleurs ;
- `test/scripts/manifest.test.mjs` fixe la règle `vat-rate-or-exemption`, le
  refus de 0, la paire de champs facultatifs, la lecture de la configuration
  par la porte, égale à celle du Worker, et les deux désaccords ;
- `test/scripts/shopctl.test.mjs` exécute la porte d'une boutique générée,
  refusée puis acceptée quand les deux fichiers concordent ;
- `test/integration/terms.mjs` porte une réservation en franchise jusqu'à la
  commande contre un vrai D1 : 0, 0 et `franchise` ;
- `test/integration/d1-integration.sh` attend sur la réservation la TVA que la
  construction configure.
