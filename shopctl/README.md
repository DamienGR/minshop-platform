# `shopctl`

L'outil d'agence : créer le dépôt d'une boutique depuis un tag du socle, puis
l'exploiter. Livré **par** le socle et versionné **avec** lui — la CLI qui crée
une boutique depuis le tag `v1.2.0` est celle que ce tag transporte
([ADR 0009](../docs/architecture/decisions/0009-forme-de-la-cli-shopctl.md)).

```sh
npm run shopctl -- <commande> [options]     # depuis un arbre du socle ou d'une boutique
node shopctl/bin/shopctl.mjs <commande>     # sans passer par npm
```

Aucune dépendance, aucune étape de build : `shopctl new` tourne avant qu'il n'y
ait un `node_modules` où que ce soit.

### Sans cloner le socle

La première boutique d'une machine n'a rien à cloner à la main :

```sh
npx --package=github:DamienGR/minshop-platform#v1.0.0 shopctl new acme
```

`--package=` est obligatoire : le paquet s'appelle `minshop` et la commande
`shopctl`, et npx ne devine pas l'un depuis l'autre. Le `#<tag>` est le tag du
socle — npx et `--core` répondent alors à la même question, ce qui est la
propriété qu'on veut (ADR 0009) : la CLI qui écrit le manifeste est celle que
le tag cloné transporte. Comptez une minute au premier appel, le temps du
clone ; les suivants sortent du cache de npx en quelques secondes.

`npx` expose la commande le temps d'**un seul appel** et ne garde rien : après
le `cd` dans la boutique, `shopctl` n'existe pas dans votre shell. C'est normal
et voulu — la boutique transporte sa propre CLI, celle de son tag (ADR 0009),
et une installation globale ferait piloter une boutique par la CLI d'une autre.
Depuis la boutique :

```sh
npm run shopctl -- doctor          # fonctionne avant même npm ci : zéro dépendance
node shopctl/bin/shopctl.mjs doctor
```

C'est la forme que le rapport de `new` imprime dans ses prochaines actions.

npm livre ici un **tarball**, pas un dépôt : il n'y a pas de remote `origin` à
qui demander où vit le socle. `--from` retombe donc sur le champ `repository`
du `package.json` du socle, et un dépôt cloné garde la priorité — c'est un
recours, pas la source. Une bifurcation, un miroir ou un chemin local passé à
`--from` continue de gagner.

## Commandes livrées

| Commande | Jalon | Rôle |
| --- | --- | --- |
| `shopctl new <slug>` | 2 | Crée le dépôt d'une boutique depuis un tag du socle. |
| `shopctl doctor` | 2 | Outils, arbre courant, prérequis de provisioning, checklist humaine. |
| `shopctl config validate` | 2 | Valide les manifestes de l'arbre courant. |
| `shopctl catalog …` | 4 | Valide, simule et applique le catalogue CSV du commerçant. |
| `shopctl repo` | 6 | Crée ou confirme le dépôt GitHub, ses environnements et leurs secrets. |
| `shopctl provision --env <env>` | 6 | Crée ou confirme les ressources Cloudflare d'un environnement. |
| `shopctl destroy --env <env>` | 6 | Supprime les ressources Cloudflare d'un environnement. Irréversible. |
| `shopctl deploy --env <env>` | 6 | Vérifie, migre, construit, téléverse, puis teste la boutique déployée. |

Les commandes `verify`, `backup`, `restore`, `core` et `fleet` sont décrites au
plan §5 et arrivent aux jalons suivants.

## `shopctl new`

Deux variables d'environnement portent les défauts qu'une **agence** a et que le
**socle** ne doit pas avoir :

| Variable | Effet |
| --- | --- |
| `MINSHOP_DOMAIN_SUFFIX` | `--domain` devient `<slug>.<suffixe>`. Sans elle, le domaine est `<slug>.example.com`, un placeholder RFC 2606 que `new` demande de remplacer. |
| `CLOUDFLARE_ACCOUNT_ID` | `--account` par défaut — la même variable que `provision`, `deploy` et `destroy` lisent déjà. |

Aucune des deux ne peut être un littéral dans le code : `config:validate` échoue
sur tout fichier du cœur contenant le domaine d'une boutique, et un socle qui
connaît une agence est un socle qu'on ne peut pas vendre à la seconde. Le
rapport de `new` dit d'où vient chaque valeur — un identifiant de compte écrit
dans un manifeste commité depuis une variable ambiante est un fait qui se voit
arriver, pas qui se découvre dans un diff.

`--core` a déjà un défaut : la version du socle depuis lequel la CLI tourne. Ce
n'est **pas** « le dernier tag » — la CLI qui crée une boutique depuis `v1.2.0`
est celle que ce tag transporte (ADR 0009), et prendre un tag plus récent ferait
écrire le manifeste par une version différente de celle du code cloné.

```sh
npm run shopctl -- new acme \
  --core v1.0.0 \
  --origin git@github.com:agence/shop-acme.git \
  --name "Boutique Acme" \
  --domain acme.fr
```

`acme` ici, et pas un nom qui pourrait être celui d'un vrai client : ce fichier
est de propriété `core`, et `config:validate` échoue sur tout fichier du cœur
contenant le slug ou le nom affiché d'une boutique. Un exemple plausible serait
une mine pour le premier client qui choisirait ce nom-là — il verrait échouer un
fichier auquel il n'a jamais touché. Les slugs que la documentation emploie sont
donc réservés (`RESERVED_SLUGS`), et le test « core documentation only uses
reserved example slugs » le vérifie.

Elle clone **un tag**, **avec son historique**, renomme le remote du socle en
`core`, crée la branche de travail, écrit le manifeste et le thème de la
boutique, rend `wrangler.jsonc` depuis le manifeste, exécute les portes que la
boutique transporte, commite, installe les dépendances, puis liste les actions
suivantes.

Trois propriétés valent d'être connues avant de lire le code.

**Le manifeste est validé avant le clone.** Toutes les valeurs qu'une boutique
choisit sont sur la ligne de commande ; une valeur inutilisable doit coûter un
message, pas un répertoire, un historique Git et une porte rouge.

**Un ref qui n'est pas un tag `v<semver>` est refusé.** Une boutique ne suit
jamais une branche flottante (ADR 0003), et une branche se clone parfaitement —
la panne ne se verrait qu'à la première mise à niveau.

**Rien n'est supprimé du clone.** `create-minshop`, le générateur public amont,
retire l'historique et son propre paquet ; ici chaque fichier retiré à la
création serait un conflit à re-résoudre à chaque mise à niveau qui y touche.

Ce que le périmètre certifié fixe — locale, devise, marché, juridiction, mode de
checkout — n'a pas d'option : élargir une de ces énumérations est une décision
de version de schéma ([ADR 0008](../docs/architecture/decisions/0008-format-du-manifeste-client.md)).

## `shopctl repo`

```sh
npm run shopctl -- repo --reviewer <login>
npm run shopctl -- new <slug> --account <id> --create-repo --reviewer <login>
```

Le dépôt est **déduit** quand rien ne le nomme : `<owner>/shop-<slug>`, sous le
compte authentifié dans `gh` ou celui que `--owner` désigne, dans le schéma
d'URL que `gh` est configuré pour. Trois sources, par ordre de netteté :
`--origin`, le remote « origin » que l'arbre porte déjà, puis la convention —
qui est **annoncée** avant toute création, parce qu'un dépôt créé quelque part
que l'opérateur n'a pas nommé est exactement ce qu'on retrouve une semaine plus
tard. `shop-<slug>` répond à `minshop-<slug>` côté Cloudflare : une boutique,
deux services, un seul nom à chercher.

Crée ou confirme, de façon rejouable : le dépôt GitHub (**privé** par défaut),
la branche sur le remote, les environnements `staging` et `production`, et leurs
secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`. Une nouvelle boutique
passe ainsi de neuf gestes à trois commandes.

**Elle enveloppe `gh`, et c'est forcé plutôt que préféré.** Un secret
d'environnement GitHub se chiffre en sealed box libsodium — X25519, Blake2b,
XSalsa20-Poly1305 — et Node 22 ne fournit pas le dernier. Une CLI qui ne peut
avoir aucune dépendance ne peut donc pas chiffrer un secret pour GitHub du tout
([ADR 0014](../docs/architecture/decisions/0014-automatisation-de-la-forge.md)).

**Les jetons viennent de l'environnement, jamais d'un argument.**
`CLOUDFLARE_API_TOKEN` sert aux deux environnements ;
`CLOUDFLARE_API_TOKEN_STAGING` et `CLOUDFLARE_API_TOKEN_PRODUCTION` les
distinguent, ce qui est tout l'intérêt de les cloisonner. Un environnement laissé
sans jeton est un avertissement, pas un échec : relancez la commande une fois la
variable posée, elle ne recréera rien.

**Un secret déjà présent est réécrit**, à l'inverse de la règle Cloudflare.
GitHub ne renvoie jamais la valeur d'un secret, donc « déjà là » ne peut pas se
lire « déjà correct » : ce pourrait être le jeton du mois dernier. Rien en aval
n'est chiffré avec, donc réécrire ne coûte rien.

**Les règles de protection sont tentées, jamais supposées.** Sur un dépôt privé
hors GitHub Pro, l'API refuse les relecteurs obligatoires et accepte
l'environnement. La commande garde l'environnement — c'est lui qui porte les
secrets — et dit que l'approbation n'est pas opposable, plutôt que de laisser
croire qu'elle l'est.

## `shopctl provision` et `shopctl deploy`

```sh
npm run shopctl -- provision --env staging --dry-run
npm run shopctl -- provision --env staging
npm run shopctl -- deploy --env staging
npm run shopctl -- deploy --env production --yes
```

`provision` crée ou confirme, pour un environnement, la base D1 et les deux
buckets R2 dans la juridiction du manifeste, garde le bucket de fichiers privé,
applique les migrations et pose les secrets internes. `deploy` suit ensuite
l'ordre du plan §5.5 : ressources, configuration, `npm run verify`, bookmark
Time Travel en production, migrations, build, téléversement, secrets différés,
test de fumée.

Quatre propriétés valent d'être connues.

**Rien qui touche un compte n'a de valeur par défaut.** `--env` est obligatoire,
`--yes` l'est en production, et le compte Cloudflare attendu doit être nommé —
par `cloudflare.accountId`, par `--account` ou par `CLOUDFLARE_ACCOUNT_ID`. Deux
sources qui divergent arrêtent l'exécution ; aucune source du tout l'arrête
aussi, même si le jeton n'atteint qu'un compte. Provisionner dans le mauvais
compte ne se défait pas en supprimant des ressources : les données d'un client
ont existé là où elles n'auraient jamais dû (ADR 0002).

**Il n'y a pas de fichier d'état, et c'est ce qui rend `provision` rejouable.**
Chaque étape interroge le compte puis décide. Un second passage ne crée rien ;
une exécution interrompue reprend sans `--resume` et sans mode particulier. Un
secret déjà posé est **conservé** : `SECRETS_KEK` déchiffre les clés de paiement
déjà en base, et en générer un nouveau les rendrait toutes illisibles sans
qu'aucun message ne le dise.

**La juridiction est relue, jamais supposée.** Pour R2, à deux faces : présent
en juridiction `eu` et absent de la juridiction par défaut. Pour D1, quand l'API
ne publie pas le champ, le rapport dit « non vérifié » plutôt que « conforme ».

**Le test de fumée peut faire échouer le déploiement**, et une requête qui
n'aboutit pas est un échec, jamais un succès. Il nomme la version vers laquelle
revenir plutôt que de revenir tout seul : un rollback automatique se
déclencherait aussi sur un contrôle qui a échoué parce que le réseau n'atteignait
pas le site.

## Le cycle de vie d'une boutique

Quatre étapes, et la frontière entre le compte de l'agence et celui du client
tombe entre la deuxième et la troisième
([ADR 0015](../docs/architecture/decisions/0015-cycle-de-vie-d-une-boutique.md)) :

| | Où | Commande |
| --- | --- | --- |
| 1. Construction | `staging`, compte agence | `shopctl new … --create-repo` puis `provision`/`deploy --env staging` |
| 2. Preview privée | idem, derrière Access | `cloudflare.stagingDomain` au manifeste, puis `deploy --env staging` |
| 3. Saisie par le client | **compte client** | `provision --env staging` sur le nouveau compte |
| 4. Mise en ligne | `production`, compte client | `deploy --env production --yes`, puis `destroy --env staging` côté agence |

La frontière est là et pas à l'étape 4 pour une raison mesurable : Cloudflare ne
transfère rien entre comptes. Le seul moment où des données existent est la
saisie, et elle a donc déjà lieu sur le compte définitif — il n'y a jamais de
migration à écrire.

**Déclarer `cloudflare.stagingDomain` ferme `workers.dev`** sur cet
environnement, et ce n'est pas un réglage séparé : une application Cloudflare
Access se lie à un nom d'hôte, et l'en-tête qu'elle injecte est falsifiable
contre une origine `*.workers.dev`. Laisser les deux ouverts revient à ne rien
fermer. Le test de fumée d'un environnement déclaré privé pose alors la question
inverse : une réponse 200 à une requête non authentifiée fait échouer le
déploiement.

## `shopctl destroy`

```sh
npm run shopctl -- destroy --env staging --confirm <slug>
npm run shopctl -- destroy --env production --confirm <slug> --yes
```

Irréversible, et tout dans cette commande découle de là. Elle **demande le slug
saisi** plutôt qu'un `--yes`, qui devient un réflexe dès la troisième fois : un
slug doit être cherché, et le chercher est la pause qu'on achète. La production
exige `--yes` en plus.

Elle **lit d'abord et dit ce qu'elle a trouvé** ; `--dry-run` est la même marche
sans les écritures. Elle **supprime la base en dernier**, et seulement si le
reste est parti : une exécution interrompue laisse une base lisible et
exportable plutôt que des buckets que plus rien n'interprète. Et elle **ne vide
jamais un bucket** — R2 refuse d'en supprimer un qui porte encore des objets, et
ce refus est relayé tel quel, parce qu'un teardown qui vide un bucket à votre
place est un teardown qui supprime ce que personne ne voulait perdre.

## Conventions

**Enveloppe, ne réimplémente pas.** `config validate` appelle
`scripts/check-manifest.mjs`, `doctor` appelle `scripts/check-toolchain.mjs`, et
la vérification de `new` appelle les scripts que la **boutique** transporte. Une
CLI qui reposerait la question avec son propre code finirait par donner une
autre réponse que la CI — et c'est la CLI que l'exploitant croit.

**Codes de sortie stables**, parce que l'appelant est souvent un script :

| Code | Sens |
| --- | --- |
| `0` | Succès. |
| `2` | Ligne de commande erronée : commande ou option inconnue, valeur manquante. |
| `3` | Valeur inutilisable : slug réservé, slug que le cœur emploie déjà, tag qui n'en est pas un. |
| `4` | Prérequis absent : répertoire occupé, `git` manquant, pas d'identité Git. |
| `5` | Commande externe en échec (`git`, `npm`, `wrangler`). |
| `6` | Résultat produit puis refusé par une porte. L'arbre est laissé en place. |

**`--json` écrit exactement un document sur la sortie standard** ; la
progression part sur la sortie d'erreur, y compris en cas d'échec — un rapport
d'erreur JSON reste un JSON valide.

**Aucun secret n'entre par la ligne de commande.** Un argument dont la forme est
celle d'une clé est refusé : il est déjà dans l'historique du shell et dans les
logs de la CI. Les motifs sont ceux du manifeste, importés et non recopiés.

## Tests

Exécutés par `npm test` et par `npm run verify`.

`test/scripts/shopctl.test.mjs` construit un socle réel depuis l'index de ce
dépôt, le tague, et fait tourner le vrai binaire contre lui.

`test/scripts/repo.test.mjs`, `provision.test.mjs` et `deploy.test.mjs`
installent `test/fixtures/wrangler-double.mjs` et `test/fixtures/gh-double.mjs`
aux endroits exacts où vivraient les vrais binaires — `node_modules/.bin/wrangler`
et le `PATH` — dans une boutique jetable dont le remote GitHub est réécrit en
local par `url.<chemin>.insteadOf`, si bien que `git push` s'exécute réellement. Le chemin exercé est
donc le chemin réel : construction des arguments, analyse des sorties, codes de
sortie. Seul le compte Cloudflare est imaginaire, ce qui permet d'affirmer ce
qu'aucun compte de test ne permettrait de rejouer à volonté : la reprise après
interruption, le mauvais compte refusé, le bucket devenu public, le secret qui
n'apparaît jamais dans un vecteur d'arguments.
