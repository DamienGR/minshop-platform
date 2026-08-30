# Plan d'implémentation du pilote Minshop

## Suivi d'avancement

- [x] tâche terminée et vérifiée dans le dépôt ou l'environnement local ;
- [ ] tâche restant à réaliser ou à valider dans le contexte du pilote.

Une fonctionnalité déjà présente dans Minshop n'est cochée que lorsqu'elle a été
explicitement validée pour l'architecture et les boutiques du pilote.

## 1. Finalité du pilote

Le pilote doit valider la viabilité technique, opérationnelle et économique d'une
offre industrialisée de création de petites boutiques e-commerce sur mesure.

Il doit livrer :

- [ ] une boutique française fonctionnelle, réaliste et déployée ;
- [ ] un socle Minshop français versionné ;
- [ ] une architecture permettant de gérer plusieurs clients ;
- [ ] une CLI de génération et d'exploitation ;
- [ ] des procédures testées de mise à jour, sauvegarde, restauration et sortie ;
- [ ] une campagne de certification réutilisable pour chaque nouvelle boutique.

L'architecture est multi-client au niveau du code et de l'exploitation, mais
chaque boutique reste mono-tenant à l'exécution.

## 2. Périmètre de référence

### 2.1 Inclus dans le pilote

- B2C France ;
- langue `fr-FR` ;
- fuseau `Europe/Paris` ;
- devise EUR ;
- prix TTC ;
- checkout invité ;
- moins de 100 produits ;
- produits simples et variantes ;
- gestion de stock ;
- catégories et recherche FTS ;
- Stripe Checkout ;
- livraison fixe, par poids et franco ;
- codes promotionnels Stripe ;
- e-mails de confirmation et d'expédition ;
- pages éditoriales et légales ;
- export des commandes ;
- sauvegarde et restauration ;
- administration protégée par Cloudflare Access et Turnstile.

### 2.2 Hors périmètre

- multilingue ;
- multidevise ;
- abonnements ;
- marketplace ;
- B2B avancé ;
- points relais ;
- tarifs transporteur en temps réel ;
- ERP, caisse ou comptabilité synchronisés ;
- automatisation marketing ;
- personnalisation produit complexe ;
- recherche sémantique ;
- Lightning, OpenNode et MCP.

### 2.3 Jeux de données témoins

Deux boutiques fictives doivent exister dès le début du développement :

#### `pilot-fr`

- [ ] vingt produits ;
- [ ] plusieurs catégories ;
- [ ] produits simples et variantes ;
- [ ] états en stock, stock faible et épuisé ;
- [ ] livraison fixe, par poids et gratuite au seuil ;
- [ ] thème entièrement personnalisé ;
- [ ] pages légales fictives clairement identifiées comme telles.

#### `canary-minimal`

- [ ] cinq produits ;
- [x] thème différent ;
- [x] fonctionnalités minimales ;
- [x] utilisée pour vérifier l'absence de configuration codée en dur pour le pilote.

Les manifestes des deux boutiques existent depuis le jalon 1
(`test/fixtures/clients/`) et la CI construit les deux. Ce qui manque tient au
catalogue (jalon 4) et au thème propre du pilote (jalon 5).

## 3. Architecture multi-client

### 3.1 Plan de contrôle

Le plan de contrôle comprend :

- [x] le fork du socle `minshop-platform`, avec l'historique Minshop conservé,
  en dépôt privé ;
- [x] la CLI `shopctl` — `new`, `doctor` et `config validate` au jalon 2
  (`shopctl/`, [ADR 0009](architecture/decisions/0009-forme-de-la-cli-shopctl.md)) ;
  provisioning, catalogue, déploiement, sauvegarde et flotte aux jalons suivants ;
- [x] les schémas de configuration ;
- [ ] les templates de boutique ;
- [ ] le registre privé de flotte ;
- [ ] les workflows de mise à jour ;
- [ ] les tests génériques propres à la plateforme multi-client.

Il ne contient aucune donnée de commande et aucun secret client.

### 3.2 Plan de données

Chaque boutique dispose de ses propres :

- [ ] Worker Cloudflare ;
- [ ] base D1 ;
- [ ] bucket R2 d'images ;
- [ ] bucket R2 de fichiers privés ;
- [ ] secrets ;
- [ ] sauvegardes ;
- [ ] domaine ;
- [ ] comptes Stripe et Resend.

Les boutiques européennes utilisent la juridiction Cloudflare `eu` pour D1 et
R2.

- [ ] Faire vérifier la juridiction après le provisioning par la CLI.

### 3.3 Propriété des fichiers

Les fichiers doivent être divisés en trois catégories :

| Catégorie | Propriétaire | Exemples |
|---|---|---|
| Cœur | Socle agence | paiement, stock, auth, migrations |
| Client | Boutique | thème, manifeste, contenus, assets |
| Généré | Outils | configuration Wrangler, rapports, index |

La CI doit refuser qu'une modification présentée comme une simple
personnalisation client touche un fichier du cœur sans approbation explicite.

- [x] Implémenter ce contrôle de propriété des chemins dans la CI.
  `scripts/path-ownership.mjs` porte la liste des règles ; `.github/CODEOWNERS`
  en est **généré**, parce que deux copies écrites à la main divergent et que
  cette divergence est invisible — CODEOWNERS n'est lu que par GitHub, au moment
  de la revue, sur la pull request de quelqu'un d'autre. Le job « File
  ownership » exécute la porte à chaque pull request. Elle n'a de dents que dans
  une boutique — un arbre qui contient `client/client.yaml` — car ici toute pull
  request touche le cœur ; une porte qui se déclenche à chaque fois n'apprend
  qu'à passer outre. Une boutique lève la porte par le label `core-change` ou un
  trailer `Approves-core-change:`, deux actes délibérés qui restent dans
  l'historique : ce qui est refusé n'est pas la modification du cœur, c'est la
  modification tue.

### 3.4 Stratégie Git

Chaque boutique est créée en clonant un tag du socle, avec son historique Git.

Remotes :

```text
origin  -> dépôt de la boutique
core    -> dépôt agency-minshop-core
```

Une version du socle est un tag immuable. Une boutique ne suit jamais une
branche flottante comme `main`.

Une mise à niveau :

1. [ ] récupère un tag ;
2. [ ] crée une branche ;
3. [ ] merge le tag ;
4. [ ] exécute les tests ;
5. [ ] déploie en staging ;
6. [ ] ouvre une pull request ;
7. [ ] attend une validation humaine avant la production.

## 4. Configuration d'une boutique

Le fichier `client/client.yaml` est la source de vérité non sensible.

```yaml
schemaVersion: 1
coreVersion: 0.1.0

client:
  slug: pilot-fr
  displayName: Boutique Pilote
  locale: fr-FR
  timezone: Europe/Paris
  currency: EUR

commerce:
  market: FR
  pricesIncludeTax: true
  checkoutMode: guest
  defaultVatRate: 20
  invoiceStrategy: pending-validation

features:
  customerAccounts: false
  semanticSearch: false
  digitalProducts: false
  promoCodes: true
  shipping: true

cloudflare:
  jurisdiction: eu
  workerName: minshop-pilot-fr
  productionDomain: pilote.example.fr

email:
  provider: resend
  from: commandes@pilote.example.fr

theme:
  # `pilot-fr` au jalon 5, quand la boutique aura son propre thème.
  id: studio
```

Ce bloc est la copie lisible d'un fichier qui existe :
`test/fixtures/clients/pilot-fr/client.yaml`. En cas de désaccord entre les deux,
c'est la fixture qui a raison — elle est validée à chaque `npm run verify`, ce
bloc ne l'est pas. `coreVersion` y suit la version du socle, donc la valeur
montrée ici vieillit ; c'est le seul champ dont il ne faut pas recopier la
valeur.

Un JSON Schema versionné contrôle :

- [x] les champs obligatoires ;
- [x] les valeurs autorisées ;
- [x] les combinaisons incompatibles ;
- [x] la forme du slug ;
- [x] la convention des noms de ressources ;
- [x] la compatibilité entre la version du manifeste et celle du socle.

La spécification est `scripts/manifest-schema.mjs` ; `schemas/client-1.schema.json`
en est généré et contrôlé contre la dérive. Un seul point d'autorité : deux
documents écrits à la main finissent par annoncer à l'éditeur un champ que le
validateur refuse, et c'est l'éditeur que le commerçant croit. Les règles qu'un
JSON Schema ne peut pas exprimer — le nom du Worker suit le slug, un checkout
invité n'affiche pas de comptes client, la France vend TTC, le domaine de
production est celui du commerçant — sont nommées et vérifiées par
`validateManifest()`, et listées dans le schéma publié sous `x-crossFieldRules`
pour qu'un validateur générique ne soit pas pris pour la porte.

Les énumérations n'acceptent aujourd'hui qu'une valeur pour `locale`,
`currency`, `market` et `jurisdiction`. C'est délibéré : élargir l'une d'elles
est une décision de version de schéma avec des notes de migration, ce qui est
exactement la différence entre un marché supporté et un marché non testé.

Le format, l'autorité de la spécification et la dérivation des noms de
ressources sont consignés dans
l'[ADR 0008](architecture/decisions/0008-format-du-manifeste-client.md), avec
les alternatives écartées.

Les clés API et secrets sont interdits dans le manifeste.

- [x] Faire appliquer cette interdiction par le schéma et les contrôles de CI.
  Le schéma est fermé (`additionalProperties: false` à tous les niveaux), donc un
  champ `stripeKey:` inventé est refusé d'office ; la règle `no-credentials`
  couvre l'autre forme, un secret collé dans un champ autorisé. Le manifeste
  étant committé, une valeur qui arrive là est publiée à tous les clones.

## 5. CLI `shopctl`

### 5.1 Technologie

- [x] Node.js 22 ;
- [x] JavaScript ESM annoté JSDoc, sans étape de build ;
- [x] dépendances minimales — aucune ;
- [x] appels à Wrangler encapsulés ;
- [x] sortie humaine par défaut ;
- [x] sortie machine avec `--json` ;
- [x] codes d'erreur stables ;
- [x] journalisation structurée sans secret.

Ce plan annonçait « TypeScript ». Le jalon 2 a mis l'annonce à l'épreuve et
l'a corrigée : le `tsconfig.json` du dépôt cible le storefront — il inclut tout
l'arbre, épingle `types` aux types Cloudflare Workers et n'embarque pas
`@types/node` —, si bien qu'un fichier `.ts` d'outillage échoue à `astro check`
faute de déclarations pour `node:fs`. C'est déjà pourquoi `scripts/` et
`test/scripts/` sont en `.mjs`. Passer la CLI en TypeScript demanderait un
second `tsconfig`, une dépendance de types et soit une étape de build, soit
`--experimental-strip-types` à chaque invocation — pour un outil qui doit
tourner **avant** qu'il n'existe un `node_modules` quelque part. La contrainte
réelle est le `tsconfig` unique du storefront, pas le langage ; le motif complet
et les alternatives sont dans
l'[ADR 0009](architecture/decisions/0009-forme-de-la-cli-shopctl.md).

### 5.2 Commandes de création

```bash
shopctl new <slug>
shopctl doctor
shopctl config validate
```

`config validate` existe déjà sous la forme de `npm run config:validate`
(`scripts/check-manifest.mjs`), livré au jalon 1 et exécuté par `verify` : il
valide les manifestes, refuse deux boutiques sur un même identifiant de
ressource, contrôle la dérive du schéma publié et vérifie qu'aucune valeur
client n'est écrite dans le cœur. La commande l'**enveloppe**, elle ne le
réimplémente pas — sans quoi la CI et la CLI finiraient par répondre
différemment à la même question, et c'est la CLI que l'exploitant croit. Sous
`--json`, elle relaie le document de la porte tel quel, et un test compare les
deux sorties : la divergence est impossible, pas seulement improbable.

`shopctl new` doit :

1. [x] valider le slug et les options ;
2. [x] sélectionner un tag précis du socle ;
3. [x] cloner ce tag avec son historique ;
4. [x] renommer le remote du socle en `core` ;
5. [x] configurer le futur remote `origin` si fourni ;
6. [x] créer le manifeste ;
7. [x] générer un thème client à partir de la référence choisie ;
8. [x] générer le répertoire `imports/` — sans exemple de catalogue : le format
   CSV contractuel est un livrable du jalon 4, et un gabarit inventé avant lui
   serait recopié dans chaque boutique générée d'ici là, puis rempli par le
   commerçant ;
9. [x] installer les dépendances sauf option contraire ;
10. [x] exécuter une vérification minimale — les portes que la **boutique**
    transporte (`check-manifest.mjs`, `check-paths.mjs`), pas celles du socle
    hôte, et sans `node_modules` ;
11. [x] présenter les prochaines actions.

### 5.3 Provisioning

```bash
shopctl provision --env staging --dry-run
shopctl provision --env staging
shopctl provision --env production
```

Le provisioning crée ou vérifie :

```text
minshop-{slug}-{env}
minshop-{slug}-{env}-db
minshop-{slug}-{env}-images
minshop-{slug}-{env}-files
```

Il doit :

- [ ] vérifier `wrangler whoami` ;
- [ ] comparer l'account ID au manifeste ou à l'état attendu ;
- [ ] vérifier l'activation préalable de R2 ;
- [ ] créer D1 et R2 avec la juridiction `eu` ;
- [ ] garder le bucket de fichiers privé ;
- [ ] générer les secrets internes avec une source cryptographique ;
- [ ] transmettre les secrets à Wrangler par entrée standard ;
- [ ] ne jamais les écrire sur disque ou dans les logs ;
- [ ] appliquer les migrations ;
- [ ] produire un rapport des ressources créées ;
- [ ] reprendre proprement après une interruption.

La création de comptes, l'invitation des utilisateurs et l'activation de Stripe
restent des opérations humaines dans la première version.

- [x] Faire détecter ces prérequis par `shopctl doctor` et fournir une checklist.
  `doctor` sépare trois niveaux : ce qui bloque maintenant (toolchain, `git`,
  identité Git), ce qui bloquera le provisioning (`wrangler` absent ou non
  authentifié) et ce qui reste humain — propriété du compte, activation de R2,
  invitations, activation Stripe, domaines. Prétendre vérifier la dernière
  catégorie serait pire que la nommer.

### 5.4 Catalogue

```bash
shopctl catalog validate ./imports/catalog.csv
shopctl catalog import ./imports/catalog.csv --dry-run
shopctl catalog import ./imports/catalog.csv
shopctl catalog report
```

L'import doit être :

- [ ] validé avant toute écriture ;
- [ ] idempotent par SKU ;
- [ ] capable de reprendre ;
- [ ] explicite sur les créations et mises à jour ;
- [ ] capable de traiter les images ;
- [ ] capable de refuser un changement destructif non demandé.

### 5.5 Vérification et déploiement

```bash
shopctl verify --env staging
shopctl deploy --env staging
shopctl deploy --env production
```

Le déploiement production suit cet ordre :

1. [ ] vérification complète ;
2. [ ] sauvegarde ou bookmark ;
3. [ ] migrations additives ;
4. [ ] upload d'une nouvelle version ;
5. [ ] smoke test avant promotion lorsque possible ;
6. [ ] promotion ;
7. [ ] smoke test public ;
8. [ ] rollback du code en cas d'échec.

- [ ] Vérifier que les migrations restent compatibles avec la version applicative
  précédente.

### 5.6 Sauvegarde et restauration

```bash
shopctl backup --env production
shopctl backup list
shopctl backup verify <backup-id>
shopctl restore --env staging --from <backup-id>
```

Une restauration vers la production nécessite une option dédiée et une
confirmation saisie par l'opérateur.

- [ ] Exiger cette option et cette confirmation, sans jamais faire de la
  production le comportement par défaut.

### 5.7 Gestion du socle et de la flotte

```bash
shopctl core status
shopctl core upgrade --to 1.1.0
shopctl fleet status
shopctl fleet verify
shopctl fleet upgrade --to 1.1.0 --open-pr
shopctl fleet report --format json
```

## 6. Jalons détaillés

### Jalon 0 — Baseline reproductible

Durée indicative : 2 jours.

#### Livrables

- [x] fork privé de Minshop (`DamienGR/minshop-platform`, visibilité privée
  confirmée le 2026-08-28) ;
- [x] référence upstream enregistrée ;
- [x] versions Node et npm imposées (`engines` racine et `mcp/`,
  `engine-strict`, `.nvmrc` lu par la CI, `npm run check:toolchain`) ;
- [x] lockfiles conservés pour l'application et le Worker MCP ;
- [x] CI minimale héritée de Minshop ;
- [x] inventaire des dépendances et fonctionnalités
  ([`docs/architecture/baseline-inventory.md`](architecture/baseline-inventory.md)) ;
- [x] premiers ADR dans `docs/architecture/decisions/`.

ADR initiaux :

- [x] modèle d'isolation ;
- [x] propriété des comptes ;
- [x] versionnement du socle ;
- [x] localisation des données ;
- [x] stratégie de sauvegarde ;
- [x] politique des migrations ;
- [x] périmètre fonctionnel de l'offre.

#### Tests

- [x] `npm ci` avec Node 22 ;
- [x] contrôles composant `npm run verify` ;
- [x] `npm run build` ;
- [x] `npx wrangler deploy --dry-run` pour le storefront
  (`npm run check:deploy`, inclus dans `npm run verify`).

Ajouter :

- [x] scan de secrets (`npm run check:secrets`) ;
- [x] audit npm des dépendances racine et MCP sans vulnérabilité connue ;
- [x] contrôle de la taille du bundle (budgets Worker et JS client dans
  `scripts/check-deploy.mjs`) ;
- [x] construction depuis un clone vierge (`npm run check:clean-clone`, job CI
  dédié).

#### Critère de sortie

- [ ] Le fork non personnalisé se construit, passe les tests Minshop et peut être
  déployé dans un compte Cloudflare de test.

État : la construction et la déployabilité sont vérifiées automatiquement
(`npm run verify` et le job « Build from a clean clone » couvrent `npm ci`, le
build, le dry run de déploiement, les budgets de taille et le scan de secrets).
Des deux points qui restaient ouverts, un seul subsiste :

- [x] **un déploiement réel dans un compte Cloudflare de test**, effectué le
  2026-08-29 sur l'instance `minshop-test`, vérifié puis détruit. Voir
  « Déploiement de validation » ci-dessous ;
- [ ] **la fiabilité de l'intégration D1 en CI n'est pas encore établie**. La
  mitigation est appliquée ; il reste à l'observer sur la durée. Voir « Défaut de
  baseline connu » ci-dessous.

#### Déploiement de validation sur l'instance `minshop-test`

`scripts/provision-cf.sh minshop-test` a produit une instance complète sur un
compte Cloudflare personnel, en plan gratuit, sans intervention manuelle :

| Ressource | Vérification |
| --- | --- |
| Worker `minshop-test` | déployé ; `/` redirige vers `/admin/setup`, qui répond 200 |
| D1 `minshop-test-db` | 40 migrations sur 40 appliquées, région WEUR |
| R2 | `minshop-test-images` et `minshop-test-files` créés |
| KV | `minshop-test-session` auto-provisionné par l'adaptateur, sous le nom qu'attend `destroy-cf.sh` |
| Secrets | `AUTH_SECRET` et `SECRETS_KEK` posés |
| Bindings déployés | `DB`, `BUCKET`, `FILES`, `SESSION`, les trois rate limiters, `ASSETS` |
| Cron | `*/5 * * * *` enregistré |
| Observabilité | logs et traces actifs, échantillonnage à 100 % |

`scripts/destroy-cf.sh minshop-test` a ensuite tout retiré du compte : Worker,
base D1, les deux buckets et le namespace KV. Le fichier de métadonnées de
l'instance a été supprimé, ce que le script ne fait que si le bucket de fichiers
privés a bien pu être détruit.

Un défaut du script a été trouvé à cette occasion. `wrangler d1 create` et
`wrangler r2 bucket create` proposent désormais d'inscrire eux-mêmes le binding
créé dans le fichier de configuration, avec « oui » par défaut dès qu'un
terminal répond. La sauvegarde de `wrangler.jsonc` était prise à l'étape [3/5],
donc après les créations : elle capturait une configuration déjà modifiée, que
le `trap` de sortie restaurait ensuite fidèlement. Le `wrangler.jsonc` committé,
celui que lisent le bouton « Deploy to Cloudflare » et `astro dev`, s'est
retrouvé avec deux buckets d'instance en trop. Le déploiement, lui, n'a jamais
été affecté : l'étape [5/5] part de la configuration rendue depuis
`wrangler.template.jsonc`, et le Worker a bien reçu les seuls bindings attendus.
Corrigé par [PR #10](https://github.com/DamienGR/minshop-platform/pull/10) :
sauvegarde déplacée avant le premier appel distant, et `--update-config=false`
sur les trois créations pour refuser la proposition à la source.

#### Défaut de baseline connu — intégration D1 instable en CI

`npm run verify` passe en local et échouait une fois sur deux dans GitHub
Actions, toujours au même endroit : la requête qui suit le POST de purge de
cache (`assert_cache_control /product/sample-tee`,
`test/integration/d1-integration.sh:376`) n'atteint jamais le Worker et reçoit
un HTTP 500 dont le corps est `Error: Network connection lost.` levé par
l'entry worker de miniflare.

Cinq échecs et deux passages sur les versions d'origine, dont un échec et un
passage sur **deux commits dont le code est identique** (seule la documentation
change entre eux) : la panne est intermittente, avec un taux d'échec élevé. Elle
est présente sur `main` (`27334e0`) avant tout travail du jalon 0, donc
indépendante de celui-ci.

##### Mitigation appliquée

Un garde-fou existait déjà pour la même classe de panne — `assert_cache_control`
réessaie lorsque curl n'obtient aucune réponse — mais il ne couvrait pas ce cas,
où miniflare répond : la panne de transport arrive habillée en échange HTTP
complet, `curl_rc` reste à 0 et le retry ne partait jamais.

Le retry couvre désormais ce cas, reconnu à sa signature exacte : HTTP 500 dont
le corps porte à la fois `Error: Network connection lost.` et
`core/entry.worker.js`. Une 500 produite par le Worker lui-même ne correspond à
aucun des deux marqueurs et échoue toujours au premier essai — aucune assertion
n'est désactivée, et le compromis retenu en `c964bf7` (ne jamais réessayer un
échange complété) est conservé partout ailleurs. Après trois tentatives, l'échec
nomme la coupure au lieu d'un `cache-control` vide.

##### Deux causes possibles, non départagées

La montée « minor-and-patch » (#1) avait fait passer wrangler de 4.118 à 4.125,
donc le miniflare embarqué de la série 4 à la série 5. Les deux exécutions
vertes qui ont suivi sont **antérieures** à la mitigation : elles peuvent
s'expliquer par cette montée, ou par le hasard sur une panne intermittente. La
mitigation supprime une classe de panne prouvée ; elle ne prouve pas à elle
seule que la panne a disparu.

Exécutions de `verify` sur `main` :

| Commit | Résultat |
| --- | --- |
| `b169b03` | échec |
| `27334e0` | échec |
| `a3e1c1f` | vert — wrangler 4.125 / miniflare 5 |
| `deaf9de` | vert |
| `01e992f` | annulé |
| `e7c1526` | vert — première exécution avec la mitigation |
| `40ab093` | vert |
| `c1a066d` | vert |
| `10e53b2` | annulé (poussée suivante arrivée par-dessus) |
| `ea1d870` | vert |
| `0d2bc65` | échec |

La panne n'a pas disparu pour autant. Le 2026-08-29 elle s'est reproduite trois
fois au même endroit, mitigation comprise : sur la branche de la
[PR #9](https://github.com/DamienGR/minshop-platform/pull/9)
([run 33270596059](https://github.com/DamienGR/minshop-platform/actions/runs/33270596059)),
sur `main` en `0d2bc65`
([run 33275634908](https://github.com/DamienGR/minshop-platform/actions/runs/33275634908)),
puis sur la branche de la [PR #12](https://github.com/DamienGR/minshop-platform/pull/12)
([run 33276600401](https://github.com/DamienGR/minshop-platform/actions/runs/33276600401)),
avec la même sortie :

```
(retrying GET /product/sample-tee — miniflare dropped the connection, HTTP 500)
(retrying GET /product/sample-tee — curl exit 7, no response)
D1 integration failed: GET /product/sample-tee — no response after 3 attempts (curl exit 7).
```

L'échec de `0d2bc65` remet le compteur à zéro, après quatre exécutions vertes
accumulées depuis la mitigation.

La série en cours repart de `4cb945a`, première exécution avec la relance à
quatre essais et le second runner. La table s'arrête là volontairement : au-delà
le compte se lit dans les exécutions du workflow `Verify` sur `main`, et
recopier ici une ligne par fusion produirait surtout des mises à jour oubliées.
Ce qui mérite d'être consigné, c'est un échec, parce qu'il remet le compteur à
zéro et qu'il serait alors d'une nature nouvelle : quatre tentatives et un
runner neuf n'ont plus rien de commun avec la panne décrite ci-dessus.

##### Cause identifiée

Le retry part bien sur la 500 de miniflare, puis les deux tentatives suivantes
n'obtiennent rien : `curl exit 7`, le port n'écoute plus. Ce n'est donc pas une
connexion qui tombe, c'est `wrangler dev` qui meurt. Les trois journaux se
terminent à l'identique, juste après le POST de purge signé invalide :

```
[wrangler:info] POST /api/internal/cache-purge 401 Unauthorized (3ms)

✘ [ERROR]

If you think this is a bug then please create an issue at .../workers-sdk/issues/new/choose
🪵  Logs were written to "/home/runner/.config/.wrangler/logs/wrangler-….log"
```

C'est
[cloudflare/workers-sdk#15317](https://github.com/cloudflare/workers-sdk/issues/15317),
régression de [#4562](https://github.com/cloudflare/workers-sdk/issues/4562)
apparue avec wrangler 4.125 : sous contention, le proxy de développement perd
une connexion en cours de réponse ; wrangler remonte l'incident en
« Error inside ProxyWorker » **fatal**, et le message affiché est vide parce que
l'erreur sérialisée à travers la frontière du worker ne peut pas être
reconstruite en `Error`. La session entière tombe.

Cela explique la chronologie complète. Avant 4.125, l'incident se manifestait en
500 rendue par l'entry worker, serveur toujours debout : le retry de `e7c1526`
aurait suffi. Depuis 4.125, le même incident tue la session, et aucun retry sur
la requête ne peut plus rien puisqu'il n'y a plus rien en face. La montée à
4.127.1 ne change pas ce comportement, ce que l'échec de la
[PR #12](https://github.com/DamienGR/minshop-platform/pull/12) a confirmé.

##### Mitigation retenue

La panne est sous le plancher du dépôt et le correctif appartient à l'amont. Ce
qui est à notre portée est de ne pas transformer une session de développement
morte en échec de certification :

- `d1-integration.sh` distingue désormais cette mort du reste et sort en **75**,
  code réservé à ce seul cas ; une assertion en échec sort toujours en 1 ;
- `run-d1-integration.sh` relance la suite jusqu'à **quatre fois**, et
  uniquement sur 75. Une assertion en échec n'est jamais rejouée : une porte qui
  rejoue les vraies régressions n'est plus une porte ;
- la CI exécute `verify` sur un **second runner** quand le premier n'a pas
  abouti, parce que la panne se répète sur une même machine et pas sur une
  autre ;
- le journal de débogage de wrangler est écrit dans le répertoire d'état et
  affiché à la mort, au lieu de rester dans `~/.config/.wrangler/logs` que
  personne n'archive. C'est là que se trouve la trace que le `✘ [ERROR]` vide
  ne montre pas ;
- `X_LOCAL_EXPLORER=false` rejoint `X_LOCAL_OBSERVABILITY=false` : un service
  interactif de moins attaché au proxy de développement, inutile dans une porte
  sans opérateur.

##### Une cause voisine, longtemps comptée comme la même

La porte se liait à un port fixe (`8791`). Deux exécutions sur une même machine
entraient donc en collision : la seconde ne pouvait pas se lier, `wrangler dev`
mourait au démarrage, et la mort d'une session est précisément ce que le
wrapper rejoue — quatre fois, sur un port toujours occupé, avant de conclure
« la session est morte aux quatre tentatives ». Le diagnostic affiché nommait
`cloudflare/workers-sdk#15317`, qui n'y était pour rien.

Le cas est devenu ordinaire au jalon 2 : vérifier le socle et une boutique
générée, c'est exécuter la même porte deux fois côte à côte.

Le correctif a demandé deux essais, et les deux méritent d'être notés parce que
le premier avait l'air suffisant. Chercher un port libre puis le passer à
wrangler **ne suffit pas** : la sonde doit refermer la socket avant que wrangler
puisse s'y lier, et deux exécutions lancées ensemble reçoivent le même port.
Ce n'est pas théorique — c'est arrivé au premier essai en parallèle. Seule une
liaison unique, dans le processus qui garde la socket, ferme la fenêtre : d'où
`--port 0`, le noyau attribuant à la liaison, et la suite relit le port dans la
ligne « Ready on » de wrangler.

Le même problème s'est présenté une seconde fois à trois exécutions
simultanées : wrangler ouvre **aussi** un port de devtools, fixe par défaut, qui
collisionnait à son tour une fois le port applicatif réglé. `--inspector-port 0`
le règle, et une porte sans opérateur n'a de toute façon pas de devtools à
attacher.

Enfin, un échec de liaison est reconnu à sa signature, cite ce que wrangler a
écrit, et **n'est pas rejoué** — une seconde tentative se heurterait au même
occupant. Cela compte pour le critère de clôture ci-dessous : une collision de
port comptée comme une session morte fausse la mesure qu'il demande.

Vérification : trois exécutions concurrentes de la porte passent toutes les
trois ; avant le correctif, la première collision arrivait dès deux.

##### Mesurer au lieu d'attendre

Accumuler dix exécutions vertes une fusion à la fois prend des semaines.
`.github/workflows/d1-flake-probe.yml` exécute la porte dix fois en parallèle,
sur demande ou sur une branche `flake-probe/**`, et distingue les trois issues :
succès, session morte, assertion en échec. Le mode `raw` mesure la panne, le
mode `wrapped` exécute ce que la CI exécute. Une sonde donne en quelques minutes
ce que le compteur donne en semaines.

Ce que les sondes ont établi, et qui a dicté toutes les décisions ci-dessus :

| Mesure | Résultat |
| --- | --- |
| suite brute, 20 exécutions | 5 sessions mortes, aucune assertion en échec |
| wrapper à 3 tentatives, 30 exécutions | 3 échecs, soit 10 % |
| wrapper à 8 tentatives, 20 exécutions | 1 échec, soit 5 % |

Deux enseignements. D'abord les tentatives ne sont pas indépendantes : un runner
se range dans l'une de deux catégories, celui qui récupère et le fait toujours
tôt (toutes les récupérations observées sont tombées aux tentatives 2, 3 ou 4),
et celui qui meurt à chaque essai, y compris huit fois de suite. L'arithmétique
en p^n ne s'applique pas. Ensuite, relancer sur place plafonne à 5 % : aucun
nombre de tentatives sur une machine qui ne récupère jamais ne fabrique un
passage. D'où le second runner, seul tirage réellement neuf, qui ramène le
résidu attendu autour d'une exécution sur quatre cents.

- [ ] Rendre l'intégration D1 fiable en CI. **Critère de clôture : dix
  exécutions vertes consécutives de `verify` sur `main`**, mitigation comprise.
  Avec un taux d'échec historique proche d'une fois sur deux, dix passages
  consécutifs ramènent sous 0,1 % la probabilité de conclure à tort ; sans seuil
  chiffré, la case ne peut pas être fermée objectivement. Tant que l'intégration
  échoue par intermittence, elle ne peut pas servir de porte de certification
  pour une boutique, et le critère de sortie du jalon 0 n'est pas atteint.

Le diagnostic initial et les exécutions comparées sont consignés sur
[PR #1](https://github.com/DamienGR/minshop-platform/pull/1) ; le correctif et
son raisonnement sur
[PR #7](https://github.com/DamienGR/minshop-platform/pull/7).

### Jalon 1 — Fondations multi-client

Durée indicative : 3 à 4 jours.

#### Livrables

- [x] schéma de manifeste (`scripts/manifest-schema.mjs`, publié en
  `schemas/client-1.schema.json`) ;
- [x] conventions de nommage ;
- [x] séparation des fichiers cœur/client/générés
  (`scripts/path-ownership.mjs`) ;
- [x] fixtures `pilot-fr` et `canary-minimal` — au niveau du manifeste ; leur
  catalogue arrive au jalon 4 et le thème du pilote au jalon 5 (§2.3) ;
- [x] règles `CODEOWNERS` ;
- [x] test de politique des chemins.

#### Tests

- [x] manifeste valide ;
- [x] champ inconnu refusé ;
- [x] slug dangereux refusé ;
- [x] nom réservé refusé ;
- [x] doublon de ressource détecté ;
- [x] matrice de build pour les deux boutiques ;
- [x] thème A jamais chargé par B ;
- [x] aucun identifiant de ressource partagé.

#### Critère de sortie

- [x] Deux boutiques différentes se construisent depuis le même socle sans
  condition client codée en dur dans le cœur métier.

#### État

Tout ce qu'une boutique a de particulier vient de son manifeste. Le lecteur
(`scripts/manifest-yaml.mjs`) est écrit à la main et sans dépendance, non par
goût de l'exercice mais parce qu'il doit **refuser** ce qu'il ne comprend pas :
un lecteur YAML complet résout `market: NO` en booléen faux et déplie des
ancres en valeurs que personne n'a tapées. Sur un fichier dont les valeurs
deviennent des noms de ressources dans un compte Cloudflare, « l'analyseur a
été malin » est le mode de défaillance à supprimer par construction.

Les noms de ressources sont **dérivés** du nom du Worker, jamais configurés
séparément. C'est ce qui garantit que `<workerName>*` est l'empreinte complète
d'une boutique, donc que `destroy-cf.sh` la retire entièrement. Et
`detectFleetCollisions` refuse que deux manifestes revendiquent le même
identifiant : rien à l'exécution ne sépare les données de deux boutiques
(ADR 0001), donc un nom de base D1 dupliqué est à un provisioning près de faire
atterrir les commandes d'une boutique chez une autre. Il n'y a pas de garde-fou
applicatif derrière ; ce sont les noms qu'il faut tenir.

Les deux boutiques témoins diffèrent là où le cœur est censé commuter — thème,
promotions, livraison, facturation. Deux fixtures d'accord sur tout auraient
passé tous les contrôles ci-dessus sans rien prouver. La matrice CI « Build
shop » découvre les boutiques dans l'arbre plutôt que dans une liste, comme la
matrice des thèmes, et rend la configuration Wrangler depuis
`wrangler.template.jsonc` — le même gabarit que `provision-cf.sh` — pour qu'une
construction témoin et un provisionnement réel ne puissent pas diverger sur les
bindings.

Le critère de sortie a deux moitiés, et une construction verte ne dit rien de
la seconde : deux boutiques peuvent se construire parfaitement pendant que le
cœur nomme l'une d'elles, et la condition ne se révèle alors qu'à la troisième
boutique, en production. `npm run config:validate` inspecte donc les fichiers du
cœur à la recherche des valeurs qu'une boutique choisit librement — slug, nom
affiché, nom de Worker, domaine, expéditeur — et échoue sur une occurrence ; pas
sur celles qu'il doit connaître (`EUR`, `eu`), qui apparaîtraient partout sans
rien signifier. Le contrôle a trouvé une fuite dès sa première exécution, dans
un commentaire de son propre module.

Vérification locale : `node scripts/prepare-client.mjs <slug>` puis
`THEME=<thème> npm run verify:theme` passe pour les deux boutiques, et
`check-built-css` confirme à chaque fois que les deux thèmes inactifs sont
absents de la feuille construite — c'est la forme exécutable de « thème A jamais
chargé par B ».

### Jalon 2 — Générateur de boutique

Durée indicative : 3 à 5 jours.

#### Livrables

- [x] package CLI (`shopctl/`, livré par le socle et versionné avec lui) ;
- [x] `shopctl new` ;
- [x] `shopctl doctor` ;
- [x] `shopctl config validate` ;
- [x] initialisation Git et remotes ;
- [x] génération du manifeste et du thème ;
- [x] rapport de création, humain et `--json`.

#### Tests

- [x] snapshots du squelette ;
- [x] chemin contenant des espaces ;
- [x] répertoire non vide refusé ;
- [x] tag de socle inexistant ;
- [x] ref qui n'est pas un tag refusé ;
- [x] fonctionnement sans installation avec `--no-install` ;
- [x] aucun secret ou identifiant de test copié ;
- [x] résultat déterministe ;
- [x] boutique générée immédiatement constructible.

#### Critère de sortie

- [x] `shopctl new test-client`, suivi de `npm ci` et `npm run verify` dans
  `shop-test-client`, réussit sans modification manuelle.

#### État

Deux propriétés portent le reste.

**Le manifeste est validé avant le clone.** Toutes les valeurs qu'une boutique
choisit tiennent sur la ligne de commande, et elles passent le validateur du
jalon 1 — le même que la CI — avant qu'un seul octet ne soit écrit. Une valeur
inutilisable coûte un message ; elle ne laisse pas derrière elle un répertoire,
un historique Git et une porte rouge à comprendre.

**Un ref qui n'est pas un tag `v<semver>` est refusé, avant le clone.** C'est le
contrôle qui applique l'ADR 0003 au seul endroit où il peut encore l'être : une
branche se clone parfaitement, et une boutique installée sur `main` ne le
découvrirait qu'à la première mise à niveau, sans version de référence à
laquelle revenir.

Rien n'est supprimé du clone, contrairement à `create-minshop` qui retire
l'historique amont et son propre paquet. Ce sont deux outils pour deux
finalités : le générateur public produit une boutique autonome, `shopctl new`
produit une boutique qui recevra des tags du socle par merge pendant toute la
durée du contrat. Chaque fichier retiré à la création serait un conflit à
re-résoudre à chaque mise à niveau qui y touche.

La CLI **enveloppe** les portes plutôt que de les réimplémenter, et la
vérification minimale de `new` appelle les scripts que la **boutique**
transporte, pas ceux du socle hôte : une boutique doit passer la porte que sa
propre version du socle définit, sinon une mise à niveau serait validée par la
version qu'elle n'a pas encore fusionnée. Le test
« relays the gate's own report » compare la sortie de
`shopctl config validate --json` à celle de `scripts/check-manifest.mjs --json`,
ce qui rend la divergence impossible plutôt qu'improbable.

Le critère de sortie a trouvé un défaut que rien d'autre n'aurait trouvé. La
suite de tests est de propriété `core` : elle est donc **livrée dans chaque
boutique** et s'y exécute telle quelle. Quatre de ses assertions supposaient que
l'arbre courant est le socle — « exactement deux boutiques », « `repository`
vaut `core` », « le premier manifeste découvert est une fixture ». Toutes
passaient ici et échouaient dans la première boutique générée, c'est-à-dire chez
le client, sur un `npm run verify` qui aurait eu l'air d'être de sa faute. Elles
affirment désormais ce qu'elles voulaient dire — les deux témoins sont présents
et passent — et non le décompte de l'arbre.

Le contrôle de neutralité du cœur en a trouvé un second, du même genre : ce
plan et le read-me écrivent `shopctl new acme`, et la porte échoue sur tout
fichier du cœur contenant le slug d'une boutique. Le premier client nommé `acme`
aurait vu échouer un fichier auquel il n'a jamais touché. Les noms que la
documentation emploie — `acme`, `example` — sont donc réservés comme la RFC 2606
réserve `example.com`, et le cœur n'écrit plus d'exemple de slug plausible.

La mesure a montré que le piège dépassait les exemples de documentation. Un nom
de commerçant ordinaire passe sans une seule fuite ; ce qui restait pris, c'est
le **vocabulaire du socle** — `check`, `mcp`, `products`, `clean-clone` — que le
cœur écrit dans ses propres workflows et sa propre prose. `RESERVED_SLUGS`
couvre désormais les préfixes de routes publiques, **dérivés de `src/pages/` par
un test** plutôt que recopiés à la main : une route ajoutée sans réserver son
nom fait échouer la suite, au lieu de libérer le nom en silence.

Cette liste ne pourra jamais être complète — la porte se déclenche aussi sur de
l'anglais ordinaire que le cœur emploie —, et c'est ce qui rend le second
correctif plus important que le premier. `shopctl new` lisait un échec de porte
et concluait « c'est un bug du cœur, pas une mauvaise option ». Pour une
collision de neutralité sur le slug de la boutique elle-même, c'est exactement
l'inverse : le cœur a raison, le nom est mauvais. La commande lit maintenant le
rapport JSON de la porte, distingue les deux cas, nomme les fichiers en cause,
dit de choisir un autre slug et **ne garde rien**. Réserver les noms connus ne
fait qu'avancer l'échec avant le clone.

La première exécution du job CI a trouvé le troisième cas de la même famille,
cette fois dans `new` lui-même : le workflow posait l'identité Git en local dans
le checkout, la boutique est un autre dépôt, et l'échec sortait sous la forme
d'un `git commit exited with status 128` après un clone de 540 fichiers. Les
deux moitiés sont corrigées — le contrôle a lieu **avant** le clone, et il
interroge `git var GIT_AUTHOR_IDENT`, c'est-à-dire la résolution de git
elle-même (config, variables `GIT_AUTHOR_*`, auto-détection). Relire `user.name`
aurait déclaré cassé un runner qui marche, et l'inverse.

Vérification locale : `shopctl new test-client --core v0.1.0`, puis `npm ci`,
`npm ci --prefix mcp` et `npm run verify` dans `shop-test-client`, sans aucune
modification manuelle. En CI, le job « Generated shop » refait la création et
rejoue les portes déterministes de la boutique ; l'intégration D1 et le
`mcp:check` n'y sont pas rejoués, parce qu'ils portent sur un cœur identique à
l'octet près et que le job `verify` les couvre déjà.

### Jalon 3 — Socle français

Durée indicative : 5 à 8 jours.

#### Livrables

- [x] dictionnaires de traduction typés ;
- [x] storefront français ;
- [x] erreurs françaises ;
- [x] e-mails français ;
- [x] décision concernant la traduction de l'admin ;
- [x] `lang="fr"` ;
- [x] formats `fr-FR` ;
- [x] fuseau `Europe/Paris` ;
- [x] checkout Stripe français ;
- [x] pages légales brouillon ;
- [x] version des CGV enregistrée avec la commande.

#### Décision TVA et facturation

Une étude courte doit comparer puis figer :

- [x] prix TTC enregistrés par Minshop ;
- [x] taux par produit ou taux unique ;
- [x] Stripe Tax activé ou désactivé ;
- [x] ventilation de TVA enregistrée avec la commande ;
- [x] reçu Stripe ou véritable facture ;
- [x] génération et numérotation des factures ;
- [x] export destiné à la comptabilité.

Les sept réponses sont figées par
l'[ADR 0010](architecture/decisions/0010-tva-facturation-et-consentement.md),
avec les alternatives écartées : TTC, taux unique par boutique en points de
base, Stripe Tax désactivé, ventilation dans deux colonnes propres, reçu et non
facture au pilote, numérotation différée, et l'export de commandes existant
augmenté plutôt qu'un second export comptable.

Cette décision doit être validée par un comptable ou conseil compétent avant la
commercialisation.

- [ ] Obtenir et consigner cette validation externe.

#### Tests

- [x] format `1 234,56 €` ;
- [x] dates françaises ;
- [x] arrondis de panier ;
- [ ] remises ;
- [x] taux de TVA retenus ;
- [x] accents et Unicode ;
- [x] chaînes manquantes détectées à la compilation ;
- [x] e-mails en français ;
- [x] CGV non publiées par défaut ;
- [x] paiement bloqué sans acceptation ;
- [x] version des CGV capturée ;
- [x] checkout Stripe affiché en français.

#### Critère de sortie

- [ ] Le modèle français de prix, TVA, facturation et consentement est documenté,
  implémenté et validé.

Documenté et implémenté : oui. **Validé : non**, et c'est la validation externe
ci-dessus qui manque. Le critère reste donc ouvert, comme la condition de
déploiement du §9 qu'il alimente.

#### État

Trois propriétés portent le reste.

**La locale est une constante de compilation, pas un réglage.** `client.locale`
n'accepte qu'une valeur au manifeste et l'élargir est une décision de version de
schéma (§4) ; le code dit maintenant la même chose. `features/i18n/locale.ts`
est une feuille sans import — c'est ce qui permet à `money.ts`, qui se documente
comme dépendance-zéro pour rester utilisable depuis du code pur, de formater en
`fr-FR` sans rien perdre. `<html lang>` en est dérivé plutôt que saisi une
seconde fois.

**Une chaîne manquante est une erreur de compilation.** `MessageKey` est dérivé
du catalogue français lui-même, donc `t('clé.inexistante')` ne compile pas et un
second catalogue déclaré `LocaleCatalog` ne peut pas omettre une clé.
`test/i18n/` compile deux fixtures cassées exprès pour le prouver, et un
troisième cas valide pour que l'échec ne vienne pas simplement d'un import
irrésolu — un garde-fou que personne n'a vu échouer ne prouve rien. Ce que le
compilateur ne voit pas, `messages.test.ts` le vérifie : apostrophe
typographique, espace fine insécable avant `? ! ; :`, accents intacts. Les
assertions de format épellent les points de code (U+202F, U+00A0) plutôt que
d'afficher `1 234,56 €`, parce qu'un copier-coller transforme ces deux
caractères en espaces ordinaires sans que la diff le montre.

**Une seule prédicat décide de l'acceptation des CGV.** La case s'affiche et le
serveur refuse exactement quand la page des CGV est publiée. Deux prédicats
auraient fini par diverger, et les deux façons de diverger sont mauvaises : un
formulaire qui demande un accord que personne n'enregistre, ou un serveur qui
refuse une commande que la page ne permettait pas d'accepter.

La frontière de traduction n'est pas « admin / storefront » mais « qui lit »
([ADR 0011](architecture/decisions/0011-langue-de-l-administration.md)).
L'administration reste en anglais au pilote — c'est l'agence qui exploite
(ADR 0002) —, `AdminLayout` garde donc `lang="en"` délibérément, et
`/payment-setup`, atteignable depuis le panier, est en français tout en nommant
en anglais les écrans qui portent ces noms. Les montants et les dates restent
formatés en `fr-FR` partout, admin comprise : une date au format américain dans
un back-office français est une erreur d'exploitation, pas une question de
langue.

Le checkout hébergé Stripe a demandé une correction que rien n'aurait signalée :
c'est le seul écran de l'achat que la boutique ne rend pas, et sa `locale` valait
`auto`, c'est-à-dire le navigateur. Un acheteur dont le navigateur demande de
l'anglais voyait un formulaire de paiement anglais au milieu d'une boutique, de
prix et de CGV français. L'énumération de Stripe est au niveau de la langue, pas
du tag BCP 47, donc la correspondance vit dans l'adaptateur.

Le consentement voyage sur la réservation, et le taux de TVA avec lui. C'est la
seule ligne qui enjambe les deux moitiés d'un achat : l'accord est donné dans la
requête de commande, l'ordre est écrit minutes plus tard par un règlement qui
n'a jamais vu l'acheteur. L'alternative — faire transiter les deux champs par
les métadonnées de chaque canal — offrait quatre occasions de perdre exactement
ce dont dépendent un litige et un contrôle. Le règlement lit la réservation une
fois et appelle `vatIncludedCents()`, plutôt qu'une copie SQL de la même
arithmétique qui finirait par en diverger.

Le refus a lieu **avant** la réservation de stock, et la porte D1 l'affirme sur
le stock plutôt que sur la route : une commande qui ne peut pas aboutir
légalement ne doit pas retirer d'inventaire de l'étagère, quel que soit
l'endroit où le contrôle finira par vivre.

Deux limites, nommées plutôt qu'implicites.

Les rails qui passent par `/checkout` avant de payer — Lightning, OpenNode et
la démonstration, quand la livraison s'applique — demandent l'acceptation sur
cette page, et non au panier. Un acheteur qui a coché au panier recoche donc à
l'étape finale. Stripe, le rail du pilote, réserve directement et ne coche
qu'une fois. Reporter la case du panier vers `/checkout` par un paramètre
d'URL pré-cocherait une case de consentement, ce qui est précisément ce qu'il
ne faut pas faire.

Le test « remises » reste ouvert. Les codes promotionnels sont appliqués par
Stripe et reviennent dans `discount_cents` ; la ventilation de TVA est bien
prise sur le montant réellement payé, donc après remise, mais aucun test ne
l'exerce contre un code promotionnel réel — ce qui demande une clé Stripe et
appartient au jalon 7.

Deux imports `t` sont signalés inutilisés par `astro check`, qui arrête son
analyse du frontmatter au premier `return` de premier niveau. Ils sont utilisés ;
`checkout.astro` porte le même symptôme sur un symbole antérieur à ce jalon.

Vérification locale : `npm run verify` complet, la porte D1 comprise, qui rejoue
le brouillon des CGV livré par la migration 0040, sa publication, le refus, le
non-mouvement de stock, l'acceptation, et le taux recopié sur la réservation.

### Jalon 4 — Import de catalogue

Durée indicative : 3 à 4 jours.

#### Livrables

- [ ] format CSV contractuel ;
- [ ] schéma et validateur ;
- [ ] dry-run ;
- [ ] upsert idempotent par SKU ;
- [ ] import d'images ;
- [ ] optimisation d'images ;
- [ ] rapport d'import ;
- [ ] catalogue témoin de vingt produits.

#### Tests

- [ ] SKU manquant ;
- [ ] SKU dupliqué ;
- [ ] prix invalide ;
- [ ] stock non entier ;
- [ ] variante incohérente ;
- [ ] catégorie inconnue ;
- [ ] image absente ou trop lourde ;
- [ ] faux type MIME ;
- [ ] Markdown hostile ;
- [ ] réimport sans doublon ;
- [ ] mise à jour d'un produit ;
- [ ] interruption et reprise ;
- [ ] import de 100 produits.

#### Critère de sortie

- [ ] Le catalogue peut être reconstruit intégralement à partir du CSV et des
  médias sources.

### Jalon 5 — Thème du pilote

Durée indicative : 4 à 6 jours.

#### Livrables

- [ ] design tokens ;
- [ ] header et navigation ;
- [ ] footer ;
- [ ] catalogue ;
- [ ] cartes produits ;
- [ ] fiche produit ;
- [ ] pages de contenu ;
- [ ] responsive ;
- [ ] états vides, longs, épuisés et en erreur.

#### Tests

- [ ] `npm run theme:check` sur le thème du pilote ;
- [ ] `npm run test:storefront-contract` sur le thème du pilote ;
- [ ] `npm run verify` sur le thème du pilote.

Ajouter :

- [ ] Playwright desktop et mobile ;
- [ ] régression visuelle ;
- [ ] axe ;
- [ ] navigation clavier ;
- [ ] zoom 200 % ;
- [ ] navigation sans JavaScript ;
- [ ] ajout au panier avec et sans JavaScript ;
- [ ] titres très longs ;
- [ ] catalogue vide ;
- [ ] produit épuisé ;
- [ ] erreur de recherche.

#### Critère de sortie

- [ ] Le storefront est visuellement spécifique et tous les contrats fonctionnels
  Minshop restent verts.

### Jalon 6 — Provisioning et CI/CD

Durée indicative : 4 à 5 jours.

#### Livrables

- [ ] `shopctl provision` ;
- [ ] staging et production ;
- [ ] D1 et R2 EU ;
- [ ] secrets internes ;
- [ ] GitHub Environments ;
- [ ] approbation production ;
- [ ] domaine personnalisé ;
- [ ] domaine d'images ;
- [ ] bucket privé non public ;
- [ ] smoke tests post-déploiement.

#### Tests

- [ ] dry-run ;
- [ ] provisioning dans un compte de test ;
- [ ] seconde exécution sans changement ;
- [ ] reprise après interruption ;
- [ ] mauvais compte Cloudflare refusé ;
- [ ] juridiction EU vérifiée via API ;
- [ ] bucket privé inaccessible publiquement ;
- [ ] déploiement CI ;
- [ ] smoke test automatique.

#### Critère de sortie

- [ ] Une boutique créée par la CLI peut être déployée en staging avec une
  commande, hors autorisations humaines initiales.

### Jalon 7 — Paiement et traitement de commande

Durée indicative : 4 à 5 jours.

#### Livrables

- [ ] Stripe test et live ;
- [ ] webhook signé ;
- [ ] livraison France ;
- [ ] promotions ;
- [ ] comportement TVA retenu ;
- [ ] Resend ;
- [ ] confirmation de commande ;
- [ ] notification d'expédition ;
- [ ] remboursement.

#### Tests

- [ ] paiement réussi ;
- [ ] paiement refusé ;
- [ ] paiement asynchrone réussi et échoué ;
- [ ] session expirée ;
- [ ] webhook dupliqué ;
- [ ] webhook désordonné ;
- [ ] signature invalide ;
- [ ] remboursement total ;
- [ ] remboursement partiel ;
- [ ] Resend indisponible ;
- [ ] achat concurrent de la dernière unité ;
- [ ] prix changé depuis l'ajout au panier ;
- [ ] stock changé ;
- [ ] franco au seuil exact ;
- [ ] promotion invalide ou expirée.

#### Critère de sortie

- [ ] Un paiement réel de faible montant peut être encaissé puis remboursé avec
  cohérence entre Stripe, D1, stock, admin et e-mails.

### Jalon 8 — Sécurité et exploitation

Durée indicative : 5 à 6 jours.

#### Livrables

- [ ] Cloudflare Access ;
- [ ] Turnstile ;
- [ ] rate limits ;
- [ ] en-têtes de sécurité ;
- [ ] logs sans PII ;
- [ ] supervision ;
- [ ] exports ;
- [ ] politique de conservation ;
- [ ] sauvegarde et restauration ;
- [ ] runbooks d'incident.

#### Tests

- [ ] admin anonyme refusé ;
- [ ] API admin anonyme refusée ;
- [ ] CSRF ;
- [ ] expiration de session ;
- [ ] brute force ;
- [ ] téléchargement non autorisé ;
- [ ] upload SVG ;
- [ ] faux MIME ;
- [ ] traversée de chemin ;
- [ ] absence de secrets dans logs et artefacts ;
- [ ] absence d'adresse et d'e-mail dans les logs ;
- [ ] restauration complète en staging ;
- [ ] comparaison avant/après restauration ;
- [ ] export et anonymisation d'un client.

#### Critère de sortie

- [ ] La boutique peut être restaurée dans un nouvel environnement en moins
  d'une heure à partir d'une sauvegarde documentée.

### Jalon 9 — Mise à jour de flotte

Durée indicative : 3 à 4 jours.

#### Livrables

- [ ] tags du socle ;
- [ ] `shopctl core upgrade` ;
- [ ] `shopctl fleet status` ;
- [ ] `shopctl fleet upgrade` ;
- [ ] pull requests automatiques ;
- [ ] rapport de versions ;
- [ ] détection du drift ;
- [ ] notes de migration.

#### Tests

- [ ] mise à jour des deux boutiques témoins ;
- [ ] thème inchangé ;
- [ ] manifeste inchangé ;
- [ ] conflit volontaire signalé ;
- [ ] migration D1 additive ;
- [ ] ancien Worker compatible avec le nouveau schéma ;
- [ ] rollback applicatif ;
- [ ] boutique conservée sur l'ancienne version toujours fonctionnelle.

#### Critère de sortie

- [ ] Une version du socle peut être proposée à plusieurs boutiques sans copie
  manuelle de fichiers et sans déploiement automatique non approuvé.

### Jalon 10 — Certification finale

Durée indicative : 3 à 4 jours.

#### Livrables

- [ ] rapport de tests ;
- [ ] rapport de sécurité ;
- [ ] rapport de performance ;
- [ ] preuve de restauration ;
- [ ] validation TVA/facturation ;
- [ ] checklist de lancement ;
- [ ] documentation de support ;
- [ ] décision go/no-go.

#### Critère de sortie

- [ ] Tous les critères de la section 8 sont satisfaits ou font l'objet d'une
  dérogation écrite, datée et accompagnée d'une mesure compensatoire.

## 7. Organisation de la CI

### 7.1 À chaque commit

Les noms ci-dessous sont ceux du dépôt. `npm run verify` enchaîne les treize
premiers ; les autres sont des jobs distincts du workflow `Verify`.

- [x] chaîne d'outils (`npm run check:toolchain`) ;
- [x] scan de secrets (`npm run check:secrets`) ;
- [x] manifestes, identifiants de flotte, neutralité du cœur
  (`npm run config:validate`) ;
- [x] propriété des chemins et dérive de `CODEOWNERS` (`npm run check:paths`) ;
- [x] tests unitaires et de contrat storefront (`vitest run`) ;
- [x] diagnostics TypeScript et `.astro` (`astro check`) ;
- [x] frontière du storefront (`npm run theme:check`) ;
- [x] build de production et vérification du CSS compilé ;
- [x] dry run de déploiement et budgets de taille (`npm run check:deploy`) ;
- [x] intégration D1 en boîte noire (`npm run test:integration`) ;
- [x] pays Stripe cohérents avec le SDK épinglé ;
- [x] Worker MCP, typecheck et dry run (`npm run mcp:check`) ;
- [x] paquet `create-minshop` (`npm run scaffold:check`) ;
- [x] porte de propriété des chemins sur la pull request (job « File ownership ») ;
- [x] construction des boutiques témoins (job « Build shop ») ;
- [x] construction de chaque thème que le job principal ne couvre pas
  (job « Verify theme ») ;
- [x] construction depuis un clone vierge (job « Build from a clean clone »).
- [ ] tests de la CLI — au jalon 2, avec `shopctl`.
- [ ] contrôle de formatage — voir ci-dessous.

Objectif : moins de cinq minutes. Tenu : le workflow complet sur `main` prend
environ trois minutes et demie, les jobs tournant en parallèle.

Quatre entrées de la première version de cette liste ne désignaient aucun script
du dépôt. Trois avaient un nom réel — `npm run typecheck` est `astro check`, qui
couvre TypeScript et les diagnostics `.astro` en une passe ; `npm run test:unit`
est `vitest run` ; `npm run test:cli` arrive au jalon 2 avec la CLI.

La quatrième, `npm run format:check`, n'a pas d'équivalent : aucun formateur
n'est installé. La renommer vers `astro check` serait faux — un typecheck ne dit
rien de la mise en forme — donc la case reste ouverte et désigne ce qui manque
réellement : la décision d'adopter un formateur, ou celle de s'en passer.

### 7.2 À chaque pull request client

- [ ] `npm run verify` ;
- [ ] `npm run test:catalog` ;
- [ ] `npm run test:tenant-isolation` ;
- [ ] `npm run test:e2e` ;
- [ ] `npm run test:a11y` ;
- [ ] `npm run test:visual`.

### 7.3 Chaque nuit

- [ ] D1 d'intégration propre ;
- [ ] checkout Stripe test ;
- [ ] webhook Stripe ;
- [ ] e-mail de test ;
- [ ] sauvegarde ;
- [ ] restauration vers un environnement éphémère ;
- [ ] smoke tests sur les deux boutiques témoins ;
- [ ] audit des dépendances.

### 7.4 Avant la production

- [ ] suite complète verte ;
- [ ] sauvegarde verte ;
- [ ] migrations validées ;
- [ ] smoke test staging vert ;
- [ ] approbation GitHub Environment ;
- [ ] smoke test production vert ;
- [ ] rapport de déploiement conservé.

## 8. Campagne finale de tests

### 8.1 Fonctionnel

- [ ] catalogue ;
- [ ] recherche ;
- [ ] catégories ;
- [ ] pagination ;
- [ ] variantes ;
- [ ] stock ;
- [ ] panier ;
- [ ] livraison ;
- [ ] promotions ;
- [ ] paiement ;
- [ ] remboursement ;
- [ ] e-mails ;
- [ ] administration ;
- [ ] export ;
- [ ] pages légales.

### 8.2 Paiement et cohérence

- [ ] commande créée une seule fois ;
- [ ] montant Stripe égal au montant D1 ;
- [ ] stock décrémenté une seule fois ;
- [ ] taxes et frais de livraison figés dans la commande ;
- [ ] webhook idempotent ;
- [ ] remboursement synchronisé ;
- [ ] échec d'e-mail sans perte de commande.

### 8.3 Isolation multi-client

- [ ] deux dépôts ;
- [ ] deux thèmes ;
- [ ] deux Workers ;
- [ ] deux bases ;
- [ ] quatre buckets par paire d'environnements ;
- [ ] aucun secret partagé ;
- [ ] aucune donnée croisée ;
- [ ] versions du socle indépendantes ;
- [ ] mise à niveau commune réussie.

### 8.4 Sécurité

- [ ] aucune vulnérabilité critique ou élevée non justifiée ;
- [ ] aucune clé dans Git, les logs ou les artefacts ;
- [ ] webhooks signés ;
- [ ] routes admin protégées ;
- [ ] rate limits actifs ;
- [ ] uploads contrôlés ;
- [ ] CSP et en-têtes présents ;
- [ ] aucune donnée de carte traitée par l'application ;
- [ ] aucune PII inutile dans les logs.

### 8.5 Accessibilité et navigateurs

- [ ] zéro violation axe sérieuse ou critique ;
- [ ] navigation complète au clavier ;
- [ ] focus visible ;
- [ ] zoom 200 % ;
- [ ] contrastes suffisants ;
- [ ] Chrome desktop ;
- [ ] Firefox desktop ;
- [ ] Safari/iPhone ;
- [ ] Chrome/Android.

### 8.6 Performance

Objectifs internes initiaux :

- [ ] Lighthouse mobile supérieur ou égal à 90 en performance, accessibilité et SEO ;
- [ ] LCP inférieur ou égal à 2,5 secondes ;
- [ ] CLS inférieur ou égal à 0,1 ;
- [ ] INP inférieur ou égal à 200 ms ;
- [ ] aucune erreur Worker sous charge ;
- [ ] vingt utilisateurs virtuels pendant quinze minutes ;
- [ ] cinq checkouts concurrents sans survente.

Si le plan Workers Free dépasse régulièrement sa limite CPU ou génère des
erreurs de ressources, la boutique doit passer au plan Workers Paid.

- [ ] Définir l'alerte et la procédure de passage au plan Workers Paid.

### 8.7 Résilience

- [ ] Resend indisponible ;
- [ ] webhook Stripe répété ;
- [ ] média R2 manquant ;
- [ ] échec réseau temporaire ;
- [ ] rotation des secrets ;
- [ ] mot de passe admin perdu ;
- [ ] rollback Worker ;
- [ ] restauration complète ;
- [ ] RTO inférieur ou égal à 60 minutes ;
- [ ] RPO inférieur ou égal à 24 heures.

### 8.8 Conformité et validation humaine

- [ ] revue des pages légales ;
- [ ] revue du consentement aux CGV ;
- [ ] revue TVA et facturation ;
- [ ] commande réelle ;
- [ ] remboursement réel ;
- [ ] lecture des e-mails dans Gmail, Outlook et Apple Mail ;
- [ ] recette par une personne extérieure au développement ;
- [ ] confirmation que les textes définitifs restent sous la responsabilité du
  marchand.

## 9. Conditions de déploiement d'une boutique

Un déploiement est bloqué lorsque :

- [ ] blocage si le manifeste est invalide ;
- [ ] blocage si la version du socle n'est pas supportée ;
- [ ] blocage si un test obligatoire échoue ;
- [ ] blocage si la sauvegarde préalable échoue ;
- [ ] blocage si le compte Cloudflare ne correspond pas ;
- [ ] blocage si la juridiction n'est pas celle attendue ;
- [ ] blocage si le bucket privé est public ;
- [ ] blocage si un secret est détecté ;
- [ ] blocage si une migration n'est pas rétrocompatible ;
- [ ] blocage si la staging n'a pas été validée ;
- [ ] blocage si l'approbation humaine production manque.

## 10. Estimation

| Jalon | Estimation |
|---|---:|
| 0 — Baseline | 2 j |
| 1 — Multi-client | 3–4 j |
| 2 — Générateur | 3–5 j |
| 3 — Socle français | 5–8 j |
| 4 — Catalogue | 3–4 j |
| 5 — Thème pilote | 4–6 j |
| 6 — Provisioning | 4–5 j |
| 7 — Paiement | 4–5 j |
| 8 — Exploitation | 5–6 j |
| 9 — Flotte | 3–4 j |
| 10 — Certification | 3–4 j |

Certaines tâches pourront se chevaucher, mais une version productisable complète
représente environ 35 à 45 jours de travail. Une version de démonstration peut
être obtenue plus tôt, après les jalons 0 à 7, mais ne doit pas être vendue avant
les tests d'exploitation et de restauration.

## 11. Jalons de décision

| Point de décision | Éléments exigés | Décision attendue |
|---|---|---|
| A — Socle | Jalons 0 à 2 | Minshop et la stratégie Git sont viables |
| B — France | Jalon 3 | TVA, facturation et conformité sont cadrées |
| C — Boutique | Jalons 4 à 7 | Le pilote est démontrable |
| D — Exploitation | Jalon 8 | Le pilote est exploitable |
| E — Flotte | Jalon 9 | L'offre est industrialisable |
| F — Certification | Jalon 10 | La commercialisation peut commencer |

## 12. Documentation obligatoire avant commercialisation

- [ ] architecture et ADR ;
- [ ] guide de création d'une boutique ;
- [ ] guide d'import de catalogue ;
- [ ] guide de personnalisation du thème ;
- [ ] procédure Stripe et Resend ;
- [ ] procédure de déploiement ;
- [ ] procédure de sauvegarde et restauration ;
- [ ] procédure de mise à niveau du socle ;
- [ ] procédure d'incident et de violation de données ;
- [ ] procédure de remboursement ;
- [ ] procédure de départ d'un client ;
- [ ] matrice des responsabilités agence/marchand ;
- [ ] liste des sous-traitants techniques ;
- [ ] modèle de recette et de procès-verbal de livraison.
