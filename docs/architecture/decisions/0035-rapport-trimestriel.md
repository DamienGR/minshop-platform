# ADR 0035 — Le rapport trimestriel au commerçant, produit par le socle et lancé par la flotte

- **Statut** : Proposé
- **Date** : 2026-11-23
- **Jalon** : après le pilote (plan §13.34) ; aucun des jalons 0 à 10
- **S'appuie sur** : l'ADR 0019 (compte Cloudflare mutualisé, dépôt de flotte)
  et l'ADR 0034 (mesure d'audience par Umami)

## Contexte

Damien demande le 2026-11-23 que chaque boutique, présente et à venir, reçoive
le rapport trimestriel que l'agence envoie déjà aux sites vitrines « minsite » :
une issue GitHub ouverte le 5 de chaque trimestre, qui rassemble ce qui a
changé sur le site, son référencement (Google Search Console) et sa
fréquentation, puis un message prêt à copier dans un courriel au client. Sur
minsite, ce rapport est une dizaine de fichiers copiés dans chaque dépôt, et sa
documentation dit elle-même que les copies divergent.

Ce que le socle avait (v0.13.2) :

- les jetons du compte mutualisé vivent dans un seul dépôt, celui de la flotte,
  public, que ses workflows Deploy et Nightly parcourent boutique par boutique
  (`fleet.json`) ; ses journaux ne portent que des résumés
  (`.github/fleet/shops.mjs report`) ;
- le jeton `monitor` lit en lecture seule les bases D1 de toutes les
  boutiques ;
- une boutique qui mesure son audience nomme son site Umami dans ses réglages
  (`umami_script_url`, `umami_website_id`, ADR 0034) ;
- chaque version du socle a ses notes (`docs/migrations/vX.Y.Z.md`), dont une
  section « Guide administrateur » écrite pour ce qui change à l'écran ; une
  montée de version arrive dans la boutique par une branche `socle/<tag>` ;
- une boutique vend : ses commandes payées sont dans `orders` (invariant 2),
  ce qu'un site vitrine n'a pas ;
- `shopctl repo` crée les dépôts de boutique privés et sans issues ; les
  boutiques de la certification ont des dépôts publics (décision du
  2026-10-08, GitHub Free).

## Décision

**Une commande du socle, `shopctl report --env production`**, lancée par un
workflow du dépôt de flotte, « Quarterly report », que `fleet init` écrit depuis
`shopctl/templates/fleet/report.yml`. Choix de Damien, le 2026-11-23 : le
socle, lancé par la flotte, plutôt qu'une copie par boutique.

**Quatre sources, chacune facultative, toutes en lecture seule**
(`shopctl/src/quarterly/`) :

- **Ventes** : la base de production, par des agrégats seulement — commandes
  payées, chiffre d'affaires TTC, remboursements, panier moyen, acheteurs
  distincts comptés dans la requête, cinq produits en tête, et le trimestre
  précédent pour comparer. Aucune adresse, aucun e-mail ne sort de la base ;
- **Évolutions** : l'historique git de la boutique, fusions de premier parent
  du trimestre, classées en socle, évolution, correction et maintenance. Une
  montée de version du socle est décrite par les notes des versions franchies
  (leur première phrase et leur section « Guide administrateur »), pas par son
  titre. Une ligne `Pour le client : …` dans les commits d'une pull request
  donne la phrase du message au commerçant ; `Pour le client : -` l'en écarte ;
- **Référencement** : Google Search Console, par un compte de service de
  l'agence ajouté en « Restreint » à la propriété de la boutique (de préférence
  une propriété Domaine, vérifiée par un TXT chez le registraire : aucune
  balise de vérification dans le socle). Totaux, recherches, pages, et l'état
  d'indexation de soixante adresses du sitemap au plus ;
- **Fréquentation** : Umami, le site que nomment les réglages de la boutique,
  avec une clé d'API de l'agence.

Une source illisible n'arrête jamais le rapport : elle est dite dans sa section
et dans le résumé du run, et le rapport sort avec les autres. Une source non
raccordée (pas de clé Google, une boutique qui ne mesure pas) est dite comme
telle, et n'est pas un échec.

**Le trimestre est civil, dans le fuseau de la boutique** (`client.timezone`).
Le workflow tourne le 5 janvier, avril, juillet et octobre à 06:17 UTC sur le
trimestre écoulé : Google consolide ses données avec deux à trois jours de
retard. Lancé à la main, il peut produire un aperçu du trimestre en cours
(`--current`), et se limiter à une boutique. Le début du suivi d'une boutique
est `reportSince` dans `fleet.json` : rien d'antérieur n'est rapporté, et le
trimestre de lancement n'est pas comparé à un trimestre sans boutique.

**Le rapport va dans une issue du dépôt de la boutique, et nulle part
ailleurs**, intitulée « Rapport trimestriel — <trimestre> ». L'aperçu l'ouvre,
le rapport final la réécrit, un run relancé aussi ; une issue déjà fermée (le
rapport est parti) est réécrite fermée. Le corps finit par le message au
commerçant et son objet : l'agence le relit, le corrige et l'envoie elle-même.
Rien ne part au commerçant sans elle.

**La commande refuse, avant toute lecture, un dépôt qui n'est pas privé ou dont
les issues sont coupées** (code 4) : le rapport dit les ventes. Elle donne la
commande `gh` qui active les issues ; elle ne change jamais la visibilité ni
les réglages d'un dépôt.

**Le dépôt de flotte, public, ne voit que le résumé** : l'issue, le trimestre,
le résultat et les sources qui n'ont pas répondu, ce que garde
`.github/fleet/shops.mjs report`. Le rapport reste sur le runner, n'est ni dans
le journal ni dans l'artefact.

**Les secrets sont dans l'environnement GitHub `report` de la flotte**, limité
à la branche par défaut et posé par `fleet repo` : le jeton `monitor` (ventes,
`wrangler whoami`), `REPORT_ISSUES_TOKEN` (jeton fin, Issues en lecture et
écriture sur les dépôts de boutique seuls), et, facultatifs,
`GSC_SERVICE_ACCOUNT_JSON` et `UMAMI_API_KEY`. Ils ne vont qu'à l'étape qui
lance shopctl.

**Une boutique en dessous du socle v0.13.3 est écartée du run**, comme le
Deploy et le Nightly écartent une boutique sous `FLEET_MINIMUM_CORE` : le
rapport tourne avec le shopctl de la boutique, pour lire sa base avec le
schéma qu'il connaît.

## Conséquences

- un cron GitHub Actions, pas un cron de Worker : les cinq crons du compte en
  Workers Free (ADR 0019) ne bougent pas, et le dépôt de flotte public ne paie
  pas ses minutes ;
- chaque boutique devra avoir un dépôt privé avec ses issues : une commande
  `gh repo edit` par boutique, une fois. Les boutiques de la certification,
  publiques, n'auront pas de rapport publié ; `--out` le produit en local ;
- un jeton fin ne vaut que pour un propriétaire : des boutiques chez deux
  propriétaires GitHub demanderont un second jeton, non traité ici ;
- le compte de service Google et la clé Umami sont ceux de l'agence : une
  boutique qui en sort (procédure de sortie) les retire de sa propriété Search
  Console et de son site Umami ;
- le message au commerçant ne sait rien d'une évolution dont la pull request ne
  porte pas de ligne `Pour le client` : il dit alors seulement que la boutique
  a été mise à jour, et l'issue liste ce qui manque ;
- les requêtes du Worker (Cloudflare Analytics) ne sont pas dans le rapport :
  la rétention d'un trimestre n'est pas garantie au plan gratuit, et elles
  comptent les robots. La fréquentation est celle d'Umami, ou rien.

## Alternatives écartées

- **Une copie par boutique**, comme sur minsite : les jetons du compte
  mutualisé ne sont pas dans les dépôts de boutique (ADR 0019), et dix copies
  du même code divergent à la première correction.
- **Un cron du Worker de chaque boutique** : il ne lit ni git ni Google sans
  secrets de plus dans chaque Worker, et chaque boutique consommerait un des
  cinq crons du compte.
- **L'issue dans le dépôt de flotte** : il est public.
- **Un dépôt privé unique pour tous les rapports** : un seul jeton, quel que
  soit le propriétaire des boutiques, mais un dépôt de plus à tenir, des titres
  à préfixer par la boutique, et le rapport loin du code dont il parle. À
  reprendre si les boutiques se répartissent entre plusieurs propriétaires.
- **Envoyer le courriel au commerçant** : l'agence relit chaque rapport ; un
  envoi automatique demanderait aussi l'adresse du commerçant dans la flotte.
- **Cloudflare Web Analytics** à la place d'Umami : demanderait un balisage de
  plus, et l'ADR 0034 a choisi Umami.

## Vérification

- `test/scripts/report.test.mjs` : trimestre dans le fuseau de la boutique,
  changement d'heure, début du suivi ; requêtes d'agrégats seuls ; historique
  d'un dépôt git construit, notes de version, classement et lignes « Pour le
  client » ; Umami et Search Console contre un double de `fetch`, signature du
  jeton du compte de service ; rendu de l'issue et du message ; publication
  (ouverte puis réécrite, corps sur l'entrée standard) et refus d'un dépôt
  public ou sans issues ; la commande, source en échec comprise ;
- `test/scripts/fleet-repository.test.mjs` : le workflow rendu (planification,
  environnement `report`, secrets à la seule étape de shopctl, résumé), la
  matrice limitée à une boutique et son `since`, le seuil de socle, la
  validation de `reportSince`, les secrets posés par `fleet repo`.
