# ADR 0014 — Automatisation de la forge

- **Statut** : Accepté
- **Date** : 2026-08-31
- **Jalon** : 6

## Contexte

Créer une boutique pour un client demandait, après `shopctl new`, une série de
gestes dans le navigateur : créer le dépôt GitHub, le pousser, créer deux
environnements, y coller deux secrets chacun, et cocher les relecteurs
obligatoires. Six clics et deux copiers-collers par client, dans un ordre que
rien n'impose et sur des écrans qui changent.

C'est exactement la forme de travail qui est faite un peu différemment à chaque
fois, et dont l'écart est découvert à la troisième boutique — un jeton de
production posé en staging, un dépôt créé public une heure, un environnement
nommé `prod` au lieu de `production` et un workflow qui ne s'y attache pas.

Une contrainte technique décide de la mise en œuvre, et elle n'est pas
devinable. Un secret d'environnement GitHub n'est jamais transmis en clair :
l'appelant récupère la clé publique du dépôt et chiffre la valeur en **sealed
box libsodium** — échange X25519 éphémère, dérivation de nonce Blake2b,
chiffrement authentifié XSalsa20-Poly1305. Node 22 fournit X25519 et
`blake2b512`, et **ne fournit pas** XSalsa20-Poly1305 (vérifié, pas supposé).

Or `shopctl` n'a aucune dépendance et ne peut pas en avoir : `shopctl new` doit
tourner avant qu'il n'existe un `node_modules` où que ce soit (ADR 0009). Les
trois options étaient donc : prendre libsodium en dépendance, écrire un Salsa20
à la main dans ce dépôt, ou envelopper un outil qui sait déjà le faire.

## Décision

`shopctl` **enveloppe la CLI `gh`** pour tout ce qui touche à GitHub, comme il
enveloppe `wrangler` pour tout ce qui touche à Cloudflare.

`shopctl repo` crée ou confirme, de façon **rejouable** et en interrogeant avant
d'écrire : le dépôt (**privé** par défaut), la branche sur le remote, les
environnements `staging` et `production`, et leurs secrets
`CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`.

Les jetons viennent de l'**environnement**, jamais d'un argument :
`CLOUDFLARE_API_TOKEN` pour les deux environnements, `…_STAGING` et
`…_PRODUCTION` pour les distinguer. L'identifiant de compte vient du manifeste.

`shopctl new --create-repo` enchaîne la même fonction, après le premier commit.
Une seule implémentation, deux points d'entrée.

Les **règles de protection sont tentées, jamais supposées**. Sur un dépôt privé
hors GitHub Pro, l'API refuse les relecteurs obligatoires et accepte
l'environnement ; la commande garde l'environnement — c'est lui qui porte les
secrets — et **dit à voix haute** que l'approbation n'est pas opposable.

GitHub est la seule forge gérée. Une URL pointant ailleurs est refusée par son
nom plutôt que transformée en quelque chose de plausible.

## Conséquences

- créer une boutique passe de neuf gestes à trois commandes ;
- `gh` devient un prérequis des commandes de forge — pas de `shopctl new` seul,
  pas de `provision`, pas de `deploy`. `shopctl doctor` le nomme ;
- un secret déjà présent est **réécrit**, à l'inverse de la règle Cloudflare :
  GitHub ne renvoie jamais la valeur d'un secret, donc « déjà là » ne peut pas
  se lire « déjà correct » — ce pourrait être le jeton du mois dernier. Rien en
  aval n'est chiffré avec, donc réécrire ne coûte rien, là où conserver un jeton
  périmé coûte un pipeline rouge indiagnosticable de l'extérieur ;
- un dépôt existant n'est jamais repassé en privé ni écrasé : la visibilité est
  signalée, pas corrigée. Repasser un dépôt en privé ne défait pas les clones
  déjà faits, et changer la visibilité du dépôt d'un client depuis une commande
  de provisioning n'est pas une décision qui appartient à cette commande ;
- une branche déjà présente sur le remote n'est ni forcée ni rejouée.

## Alternatives écartées

- **Prendre libsodium en dépendance.** `shopctl new` tourne avant qu'un
  `node_modules` existe ; la CLI cesserait de fonctionner là où elle est le plus
  utile.
- **Écrire le sealed box à la main** (Salsa20, Poly1305, Blake2b). Du code
  cryptographique non audité dans un dépôt de commerce, pour économiser un
  prérequis que la moitié des postes a déjà.
- **Parler à l'API REST GitHub directement pour le reste, et à `gh` pour les
  seuls secrets.** Deux clients, deux résolutions d'authentification, deux
  comportements possibles derrière un proxy d'entreprise.
- **Créer le dépôt dans `shopctl new` sans option.** `new` est aujourd'hui local
  et réversible : un échec coûte un `rm -rf`. Créer un dépôt distant est le
  premier geste qui laisse quelque chose derrière lui sur un service, et il doit
  être demandé.
- **Gérer plusieurs forges.** Le plan §3.4, les workflows, `CODEOWNERS` et
  `shopctl fleet … --open-pr` supposent déjà GitHub. Une abstraction de forge
  serait une abstraction sur un seul cas.

## Vérification

- `test/scripts/repo.test.mjs` fait tourner la vraie commande contre
  `test/fixtures/gh-double.mjs`, installé sur le `PATH` là où `gh` vivrait, et
  contre un vrai dépôt git dont le remote GitHub est réécrit en local par
  `url.<chemin>.insteadOf` — le chemin exercé est donc le vrai ;
- le second passage ne crée rien, ne pousse rien et conserve les environnements ;
- le refus des relecteurs par le plan gratuit est simulé : l'environnement
  survit, ses secrets sont posés, et le rapport porte le refus ;
- aucun jeton n'apparaît dans un vecteur d'arguments ni sur le terminal.
