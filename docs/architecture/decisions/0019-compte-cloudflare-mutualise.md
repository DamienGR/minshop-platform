# ADR 0019 — Un compte Cloudflare mutualisé pour les boutiques

- **Statut** : Accepté
- **Date** : 2026-10-28
- **Jalon** : après le pilote (plan §13.1)
- **Remplace** : l'[ADR 0002](0002-propriete-des-comptes.md) pour Cloudflare
  seulement, et la frontière de comptes de
  l'[ADR 0015](0015-cycle-de-vie-d-une-boutique.md)

## Contexte

L'ADR 0002 met tous les comptes fournisseurs d'une boutique au nom du
commerçant, Cloudflare compris, et l'ADR 0015 place la frontière entre le
compte de l'agence et celui du client au moment où le client saisit ses
contenus. Le pilote a tourné ainsi, chaque compte au plan Workers Free.

Ce plan gratuit borne une boutique : 10 ms de CPU par requête, et une base D1
qui refuse toute requête, pages comprises, au-delà de 5 millions de lignes lues
dans la journée, jusqu'à minuit UTC. La note sur les limites des tiers gratuits
(2026-10-16) en tire des plafonds client : environ 500 produits et 2 000 visites
par jour. Le remède, Workers Paid, coûte 5 $ par mois et par compte : un
abonnement par commerçant.

Workers Paid se facture **au compte, pas au Worker** : 10 millions de requêtes,
30 millions de ms de CPU et 25 milliards de lignes D1 lues par mois, partagés par
tous les Workers du compte. Un seul compte payant peut donc porter plusieurs
boutiques sans qu'aucune ne partage une ressource : la porte d'isolement
(`test/scripts/tenant-isolation.test.mjs`) construit déjà deux boutiques dans un
seul compte, et l'étape 7 de la certification en a déployé deux sur le compte de
l'agence. La piste, notée le 2026-10-15 au §13.1 du plan, a été retenue par
Damien le 2026-10-28 : un compte mutualisé pour toutes les boutiques.

Les faits qui donnent sa forme à la décision, relevés le 2026-10-28 dans la
documentation de Cloudflare :

- **plafonds par compte en Paid** : 250 crons, 500 Workers, 1 000 espaces KV,
  50 000 bases D1. Chaque environnement porte le cron `*/5` de
  `wrangler.template.jsonc` : les crons mordent les premiers ;
- **jetons** : aucune permission D1 ne se limite à une base ; un jeton R2 ne se
  limite à des buckets que par l'API S3, pas par wrangler ni l'API REST ; les
  rôles par Worker (2026-09-15) couvrent le déploiement et les secrets d'un
  Worker, mais déployer ne demande aucune permission sur les ressources liées.
  Un jeton qui migre ou sauvegarde une boutique atteint donc toutes les autres ;
- **domaines** : le domaine personnalisé d'un Worker exige la zone sur le compte
  du Worker ; Cloudflare for SaaS sert depuis une zone du compte des noms d'hôte
  dont le DNS reste ailleurs, 100 gratuits puis 0,10 $ par nom et par mois ;
- **API** : 1 200 requêtes par 5 minutes et par utilisateur, tableau de bord et
  jetons cumulés, puis tout est bloqué 5 minutes ;
- **Cloudflare ne transfère rien entre comptes** (ADR 0015) : ni base, ni bucket,
  ni Worker.

## Décision

**Un compte Cloudflare de l'agence, en Workers Paid, héberge les boutiques**,
preview et production. Il leur est réservé : le compte de démonstration et de
test du socle (ADR 0002) reste à part, avec ses propres jetons. Le compte d'une
boutique reste `cloudflare.accountId` dans son manifeste. Quand un compte
approche son plafond de crons, deux cents boutiques visées, un second compte
s'ouvre sur le même modèle ; une boutique ne se répartit jamais sur deux.

**Stripe, Resend et le nom de domaine restent au nom du commerçant** : l'ADR
0002 tient pour eux, et l'agence reste hors du flux d'argent. Cloudflare devient
un fournisseur de l'agence, refacturé dans la maintenance.

**L'isolement d'exécution de l'ADR 0001 ne change pas** : chaque boutique garde
son Worker, sa base D1, ses buckets, son espace KV et ses secrets. Ce qui
séparait deux boutiques en plus, leurs comptes distincts, est remplacé par deux
gardes : deux boutiques du **registre de flotte** (`fleet.json`, ADR 0016) ne
revendiquent jamais un même slug, un même nom de ressource ni un même nom
d'hôte, et chaque base porte le **marqueur de sa boutique** (son dépôt et son
slug) : une commande qui trouve une base par son nom refuse d'y toucher si elle
est marquée pour une autre boutique.

**Le domaine du commerçant arrive par Cloudflare for SaaS.** Une zone de
l'agence sur le compte mutualisé est la zone SaaS ; le commerçant garde son DNS
où il est et y ajoute un CNAME et sa validation ; une route par nom d'hôte mène
au Worker de sa boutique. `workers.dev` reste fermé en production (ADR 0013).
Une route par nom d'hôte vers des Workers distincts doit être prouvée par un
essai réel avant qu'une boutique n'en dépende ; si elle ne tient pas, la zone du
commerçant sur le compte mutualisé est la solution de repli.

**Aucun jeton du compte n'est posé dans le dépôt d'une boutique.** Un dépôt de
flotte unique, à l'agence, détient les jetons du compte (déploiement,
sauvegarde, supervision) et la clé des sauvegardes. Il lance pour tout le parc
ce que chaque dépôt de boutique lançait pour lui seul : les déploiements derrière
une approbation, les sauvegardes, la supervision. Le dépôt d'une boutique garde
son code, Verify et les montées du socle.

**Les sauvegardes restent par boutique** (ADR 0005, un bucket `-backups` par
environnement) **et leurs médias sont dédupliqués** : un objet déjà présent dans
le bucket de sauvegarde n'est ni relu ni réécrit.

**La sortie d'un client est une migration** : sauvegarde, provisioning et
restauration sur le compte du commerçant, ses clés ressaisies, bascule du nom
d'hôte, puis destruction sur le compte mutualisé.

## Conséquences

- le coût Cloudflare devient un abonnement de 5 $ par mois et l'usage au-delà :
  environ 5 $ jusqu'à une trentaine de boutiques, 11 $ pour cent, 44 $ pour deux
  cent cinquante, sur des hypothèses de trafic qui restent à mesurer ; les
  limites du plan gratuit ne s'appliquent plus à aucune boutique ;
- le commerçant n'ouvre plus de compte Cloudflare : son prérequis devient un
  CNAME chez son registrar, et la dépendance de planning de l'ADR 0002 rétrécit
  d'autant ;
- le compte devient un point unique : une suspension ou une session
  d'administration volée touche toutes les boutiques. Un seul Super
  Administrator, une clé de sécurité matérielle, aucun commerçant membre ;
- un jeton du compte qui fuit atteint les données de toutes les boutiques :
  c'est pourquoi les jetons quittent les dépôts de boutique ;
- la sortie n'est plus « propre par construction » : `docs/operations/sortie-client.md`
  décrit une migration, que la restauration chronométrée de l'étape 8
  (29 min 21 s vers un compte neuf) a déjà prouvée possible ;
- Cloudflare devient un sous-traitant ultérieur de l'agence (RGPD, article 28,
  paragraphes 2 et 4), que le contrat avec le commerçant doit autoriser ;
  `docs/operations/sous-traitants.md` change en conséquence, et la mention
  « Hébergeur » des pages légales est à faire relire ;
- des quotas se partagent à l'échelle du compte : Turnstile au plan gratuit
  (20 widgets de 10 noms d'hôte, donc un widget par lot de dix boutiques),
  Access (50 utilisateurs, partagés par les previews), l'ingestion des journaux
  (50 Go par mois inclus) et l'API, que les sauvegardes du parc consomment une
  boutique à la fois ;
- `cloudflare.productionAccountId` ne sert plus à une nouvelle boutique ; il
  reste dans le schéma, fermé, dont le retirer serait un changement de version ;
- dans l'ADR 0015, la frontière entre les comptes disparaît : la construction,
  la preview et la production vivent sur le compte mutualisé. La preview reste
  facultative, derrière Access, et la vitrine en `noindex` jusqu'à l'ouverture ;
- le pilote de la certification migre de son compte client vers le compte
  mutualisé, ce qui répète la sortie d'un client dans l'autre sens.

## Alternatives écartées

- **Workers Paid sur le compte de chaque commerçant** : l'ADR 0002 intacte,
  mais 5 $ par mois et par boutique, 500 $ pour cent boutiques. C'est
  exactement le coût que la décision évite.
- **Rester au plan gratuit par commerçant** : les 10 ms de CPU et le refus
  quotidien de D1 bornent chaque boutique, et le dépassement se découvre en
  panne.
- **Un Worker multi-boutiques** : l'ADR 0001 le refuse, et il demande une
  réécriture du cœur (configuration au build, bindings globaux, aucune colonne
  `tenant_id`).
- **Workers for Platforms** : 25 $ par mois, utile au-delà de 500 Workers par
  compte. À revoir si le parc dépasse ce que deux ou trois comptes portent.
- **La zone du commerçant sur le compte de l'agence** : aucun code de domaine à
  écrire, mais l'agence détiendrait tout le DNS du commerçant, e-mail compris ;
  une suspension du compte couperait son e-mail, et sa sortie demanderait un
  changement de serveurs de noms. Gardée comme repli.
- **Un jeton par boutique dans chaque dépôt, limité à son Worker** : les rôles
  par Worker ne couvrent ni D1 ni R2, et les migrations comme les sauvegardes
  demandent D1 sur tout le compte. Ce seraient autant de copies d'une clé vers
  les données de tous les acheteurs.
- **Passer en Paid le compte de l'agence existant** : ses jetons de démonstration
  et de test atteindraient les données des clients.

## Vérification

- `shopctl fleet verify` refuse deux boutiques qui revendiquent un même nom de
  ressource ou d'hôte ; `shopctl provision` refuse de reprendre une base marquée
  pour une autre boutique, et `deploy`, `destroy`, `restore`, `backup`,
  `privacy` et `admin` refusent d'y toucher (`test/scripts/owner.test.mjs`) ;
- `test/scripts/tenant-isolation.test.mjs` continue de construire deux boutiques
  dans un seul compte ;
- le rendu de production route le nom d'hôte sur la zone SaaS et ferme
  `workers.dev` ;
- `shopctl repo` ne pose plus de secret Cloudflare dans le dépôt d'une boutique,
  et `shopctl certify` y vérifie l'absence de jeton plutôt que sa présence ;
- une seconde sauvegarde d'une boutique inchangée ne réécrit aucun média ;
- la migration du pilote suit `docs/operations/sortie-client.md` à l'envers.
