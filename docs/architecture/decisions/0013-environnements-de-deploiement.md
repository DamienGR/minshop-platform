# ADR 0013 — Environnements de déploiement

- **Statut** : Accepté
- **Date** : 2026-08-31
- **Jalon** : 6

## Contexte

Jusqu'au jalon 5, une boutique n'avait qu'une seule famille de noms
Cloudflare : `minshop-<slug>` et ses dérivés `-db`, `-images`, `-files`,
`-session` (ADR 0001). Cette famille suffisait tant que rien n'était déployé :
elle sert aux builds témoins, à la porte navigateur et au développement local,
qui ne joignent jamais un compte.

Le jalon 6 déploie. Deux faits en découlent immédiatement.

Une boutique a besoin d'un endroit où l'on peut se tromper. La campagne de
certification du plan §8 s'exécute contre une boutique complète, avec des
commandes, des paiements en mode test et des migrations réelles ; l'exécuter
contre la base qui encaisse serait la seule chose pire que ne pas l'exécuter.

Et une ressource Cloudflare porte une juridiction irréversible (ADR 0004) : une
base créée hors juridiction ne se déplace pas, elle se recrée. Le nom d'une
ressource est donc décidé une fois pour toutes, et une convention qu'on
regretterait coûterait une migration de données à chaque boutique de la flotte.

Le plan §5.3 fixe la forme : `minshop-{slug}-{env}`.

## Décision

Une boutique a **deux environnements déployés et pas un de plus** : `staging`
et `production`.

L'environnement **qualifie la souche** du nom, jamais un suffixe supplémentaire :
`minshop-<slug>-<env>`, puis `-db`, `-images`, `-files`, `-session`. Une
boutique reste **une seule famille de noms** — `minshop-<slug>*` reste son
empreinte complète — et les deux environnements sont dedans.

La famille **non qualifiée** subsiste et n'est pas un troisième environnement :
c'est celle que rendent les builds témoins, la porte navigateur et le
développement local, dont aucun ne joint un compte. Une ressource déployée porte
toujours son environnement, si bien qu'un exploitant qui lit la liste des
ressources d'un compte ne peut pas prendre une donnée de staging pour une donnée
de production.

`config:validate` **revendique les noms des deux environnements** pour chaque
manifeste, en plus des noms non qualifiés.

Le **domaine personnalisé appartient à la production**, et `workers_dev` est
fermé au même moment. Staging conserve `workers.dev`, qui est le seul moyen de
l'atteindre.

## Conséquences

- la campagne de certification a une cible réelle, dotée des mêmes ressources et
  de la même juridiction que la production ;
- le coût double : deux bases D1 et quatre buckets R2 par boutique (six depuis
  le bucket des sauvegardes, ADR 0005). C'est accepté
  — sur le plan tarifaire de référence, une boutique de moins de cent produits
  reste sous les seuils ;
- un slug qui entre en collision avec l'environnement d'une autre boutique est
  refusé par `config:validate` plutôt que découvert au provisioning : une
  boutique nommée `ceramique-staging` dériverait exactement la base de staging
  de la boutique nommée `ceramique`, et rien à l'exécution ne séparerait leurs
  commandes (ADR 0001) ;
- `destroy-cf.sh` continue de fonctionner sur le préfixe `minshop-<slug>` : les
  deux environnements en font partie ;
- une boutique dont le domaine n'est pas encore délégué à Cloudflare **échoue au
  déploiement de production**, bruyamment, plutôt que de servir en silence
  depuis une URL `workers.dev` que le commerçant n'a jamais annoncée.

## Alternatives écartées

- **Un seul environnement.** Le moins cher, et il fait de la production le lieu
  où l'on découvre les migrations. Le plan §8 devient inapplicable.
- **Un environnement de préproduction supplémentaire** (`qa`, `preview`) : un
  troisième jeu de ressources réelles par boutique, certifié par rien — aucune
  campagne ne le vise. Ce qu'on veut prouver l'est en staging.
- **Un suffixe d'environnement sur chaque ressource plutôt que sur la souche**
  (`minshop-<slug>-db-staging`) : casse le tri alphabétique d'une liste de
  compte, où les ressources d'une même boutique cessent d'être voisines, et
  n'apporte rien.
- **Deux comptes Cloudflare, un par environnement.** Isolation plus forte, mais
  double la surface d'ADR 0002 — propriété, invitations, facturation — et rend
  `shopctl fleet status` incapable de décrire une boutique en une requête.
- **Une base partagée entre staging et production, séparée par un préfixe de
  table.** C'est exactement le modèle qu'ADR 0001 refuse, appliqué à une seule
  boutique.
- **Garder `workers.dev` ouvert en production**, « au cas où ». Deux portes vers
  la même boutique : une origine que le commerçant n'a jamais annoncée, indexée
  par les moteurs, hors de tout Cloudflare Access posé sur le vrai nom d'hôte.

## Vérification

- `scripts/manifest.mjs` refuse tout environnement hors de `ENVIRONMENTS`, et
  `test/scripts/manifest.test.mjs` épingle les noms dérivés ;
- `detectFleetCollisions()` couvre les noms des deux environnements ; un test
  construit la collision slug/environnement et la constate ;
- `shopctl provision` et `shopctl deploy` **exigent** `--env` : rien n'est
  deviné (`test/scripts/provision.test.mjs`) ;
- le rendu de production porte `workers_dev: false` et la route en domaine
  personnalisé, celui de staging l'inverse (`test/scripts/deploy.test.mjs`).
