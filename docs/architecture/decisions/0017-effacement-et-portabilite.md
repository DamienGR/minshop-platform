# ADR 0017 — Effacement et portabilité des données d'un acheteur

- **Statut** : Accepté
- **Date** : 2026-09-05
- **Jalon** : 8

## Contexte

Une boutique du pilote traite les données personnelles d'acheteurs français :
adresse e-mail, identité, adresse de livraison, historique de commandes
([ADR 0004](0004-localisation-des-donnees.md)). Deux droits du RGPD s'exercent
directement contre la base D1 de la boutique :

- **l'accès et la portabilité** (articles 15 et 20) : la personne demande ce que
  la boutique détient sur elle, dans un format structuré et lisible par machine ;
- **l'effacement** (article 17) : la personne demande que ces données
  disparaissent.

Le second entre en conflit avec une obligation qui ne se négocie pas : une
commande payée est une pièce comptable, et l'article L123-22 du Code de commerce
impose de la conserver **dix ans**. Un effacement pris au pied de la lettre
détruirait le journal des ventes ; un refus d'effacer laisserait l'identité de
la personne dans la base pour la même durée.

Le pilote n'a pas de comptes clients : le checkout est invité (plan §2.1). Un
acheteur **est** une adresse e-mail et rien d'autre, et il n'existe aucune table
`customers` à supprimer.

Enfin, aucun schéma ne dit quelle colonne porte une personne : `orders.email` et
`products.name` sont tous deux `TEXT NOT NULL`. La dérivation qui rend la
sauvegarde complète — la liste des tables lue dans `sqlite_master`
([ADR 0005](0005-strategie-de-sauvegarde.md)) — n'est pas disponible ici.

## Décision

`shopctl privacy` répond aux deux droits, avec deux verbes et une seule carte
des données.

**Un effacement est une anonymisation, jamais une suppression de ligne.**
`shopctl privacy anonymize` remplace l'identité et laisse la pièce comptable :
montants, TVA, dates, statut et identifiant public de la commande restent
exactement où ils sont. L'e-mail devient un pseudonyme, l'adresse de livraison
est réduite au seul pays — ce qui justifie le taux de TVA appliqué —, et tout ce
qui désigne un colis chez un transporteur est mis à NULL. La seule ligne
réellement supprimée est un **identifiant d'accès** : un jeton d'accès invité
dont la commande a été anonymisée reste une clé qui ouvre la page de cette
commande.

**Le pseudonyme est tiré au hasard, jamais dérivé de l'adresse.** Un condensat
d'e-mail n'est pas anonyme : l'ensemble des adresses possibles d'une clientèle
s'énumère, et un marchand disposant de sa liste de diffusion relit ses commandes
anonymisées en condensant chaque entrée. Le pseudonyme est tiré du CSPRNG du
système, **une valeur par ligne**, et rien ne conserve la correspondance.
L'opération est irréversible et exige le slug de la boutique saisi
(`--confirm <slug>`), dans **tous** les environnements.

**L'export est en clair, structuré, et destiné à la personne.**
`shopctl privacy export` écrit un document JSON — le format que l'article 20
appelle « structuré, couramment utilisé et lisible par machine » — en 0600, dans
un répertoire que Git ignore. Il ne porte ni les jetons d'accès, ni l'identité
des opérateurs de la boutique : un export est une **divulgation**, et le nom de
l'employé qui a examiné un remboursement n'appartient pas au demandeur.

**Les références chez un sous-traitant sont conservées et nommées.** Les
identifiants Stripe restent dans la base : ils rapprochent un remboursement
d'une ligne bancaire, et les effacer supprimerait le seul moyen pour le marchand
de demander à Stripe le même effacement. La commande les liste dans son rapport
comme une demande distincte à faire.

**La carte des colonnes personnelles est déclarée, et la déclaration est gatée.**
`shopctl/src/privacy/map.mjs` classe chaque colonne dont le nom peut porter une
personne — avec la raison — et un test refuse toute colonne suspecte du schéma
réel qui n'y figure pas. Quelles **lignes** appartiennent à la personne reste
une dérivation : les clés étrangères vers `orders` la donnent, et les quatre
tables qui s'indexent sur un identifiant public sont déclarées, sous le même
test.

**Les textes libres sont conservés et signalés.** Le motif et la note d'un
remboursement sont saisis par un humain : une carte classe une colonne, elle ne
lit pas une phrase. La commande les compte, dit où ils sont — par identifiant
public, jamais en recopiant leur contenu — et laisse un humain les relire.

## Conséquences

- une demande d'effacement se traite par une commande, avec une trace : le
  rapport `--json` dit ce qui a été réécrit, table par table ;
- la comptabilité de la boutique survit à l'exercice du droit à l'effacement,
  et le registre des traitements peut dire précisément ce qui reste ;
- l'effacement **ne peut pas être annulé**. C'est le prix de son irréversibilité
  au sens du RGPD, et la raison pour laquelle la commande renvoie vers
  `shopctl backup` avant de s'exécuter ;
- un export en clair est un fichier à supprimer une fois transmis : la commande
  le dit, le répertoire est ignoré par Git, et le fichier est écrit 0600. Le
  chiffrer aurait seulement conduit le marchand à envoyer la clé à côté ;
- une migration qui ajoute une colonne portant une personne fait échouer la
  suite tant que personne ne l'a classée. C'est un coût à chaque migration, et
  c'est ce qui garantit qu'un export n'oublie pas une colonne en silence ;
- le texte libre reste un travail humain. La commande ne prétend pas le
  contraire.

## Alternatives écartées

- **Supprimer les lignes** (`DELETE FROM orders`) : détruit une pièce comptable
  que la loi impose de conserver dix ans, et casse les totaux de la boutique.
- **Pseudonymiser par condensat de l'adresse** : réidentifiable par énumération
  dès que le marchand possède une liste d'adresses — donc toujours. Ce n'est pas
  un effacement.
- **Un pseudonyme unique par personne** : garde ses commandes groupées ; un
  groupe de commandes reste un profil, même quand plus personne ne peut le
  nommer.
- **Chiffrer l'export comme une sauvegarde** : une sauvegarde dort dans un
  dépôt, un export part vers son destinataire. Le chiffrer déplace le problème
  sur l'envoi de la clé, et contredit la lisibilité que l'article 20 demande.
- **Dériver la liste des colonnes personnelles** : aucun schéma ne porte cette
  information. Une heuristique seule se tromperait en silence ; elle sert donc à
  **refuser qu'une décision ne soit pas prise**, pas à la prendre.
- **Un effacement automatique par ancienneté** : la conservation comptable de
  dix ans est plus longue que toute politique de purge raisonnable, et une purge
  automatique effacerait des lignes que le marchand doit produire en cas de
  contrôle.

## Vérification

- `npx vitest run test/scripts/privacy.test.mjs` : la carte couvre chaque
  colonne suspecte des quarante-trois migrations, la dérivation atteint chaque
  table liée à une commande, et le lecteur de schéma dit la même chose que
  SQLite ;
- la même suite anonymise une personne dans une base issue des vraies
  migrations, relit les lignes, et vérifie que la commande d'une **autre**
  personne est intacte ;
- `shopctl privacy anonymize` se vérifie lui-même : il relit ses propres
  prédicats après écriture et échoue en code 6 si une ligne porte encore
  l'adresse ou si une colonne n'a pas été réécrite.
