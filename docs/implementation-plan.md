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
- [ ] thème différent ;
- [ ] fonctionnalités minimales ;
- [ ] utilisée pour vérifier l'absence de configuration codée en dur pour le pilote.

## 3. Architecture multi-client

### 3.1 Plan de contrôle

Le plan de contrôle comprend :

- [x] le fork du socle `minshop-platform`, avec l'historique Minshop conservé,
  en dépôt privé ;
- [ ] la CLI `shopctl` ;
- [ ] les schémas de configuration ;
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

- [ ] Implémenter ce contrôle de propriété des chemins dans la CI.

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
coreVersion: 1.0.0

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
  from: commandes@example.fr

theme:
  id: pilot-fr
```

Un JSON Schema versionné contrôle :

- [ ] les champs obligatoires ;
- [ ] les valeurs autorisées ;
- [ ] les combinaisons incompatibles ;
- [ ] la forme du slug ;
- [ ] la convention des noms de ressources ;
- [ ] la compatibilité entre la version du manifeste et celle du socle.

Les clés API et secrets sont interdits dans le manifeste.

- [ ] Faire appliquer cette interdiction par le schéma et les contrôles de CI.

## 5. CLI `shopctl`

### 5.1 Technologie

- [ ] Node.js 22 ;
- [ ] TypeScript ;
- [ ] dépendances minimales ;
- [ ] appels à Wrangler encapsulés ;
- [ ] sortie humaine par défaut ;
- [ ] sortie machine avec `--json` ;
- [ ] codes d'erreur stables ;
- [ ] journalisation structurée sans secret.

### 5.2 Commandes de création

```bash
shopctl new <slug>
shopctl doctor
shopctl config validate
```

`shopctl new` doit :

1. [ ] valider le slug et les options ;
2. [ ] sélectionner un tag précis du socle ;
3. [ ] cloner ce tag avec son historique ;
4. [ ] renommer le remote du socle en `core` ;
5. [ ] configurer le futur remote `origin` si fourni ;
6. [ ] créer le manifeste ;
7. [ ] générer un thème client à partir de la référence choisie ;
8. [ ] générer les fixtures et exemples d'import ;
9. [ ] installer les dépendances sauf option contraire ;
10. [ ] exécuter une vérification minimale ;
11. [ ] présenter les prochaines actions.

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

- [ ] Faire détecter ces prérequis par `shopctl doctor` et fournir une checklist.

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
`test/integration/d1-integration.sh:335`) n'atteint jamais le Worker et reçoit
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
| `10e53b2` | annulé (push suivant arrivé pendant l'exécution) |
| `ea1d870` | vert |
| `0d2bc65` | échec (même panne, mitigation comprise) |

La panne n'a pas disparu. Le 2026-08-29 elle s'est reproduite deux fois au même
endroit, mitigation comprise : d'abord sur la branche de la
[PR #9](https://github.com/DamienGR/minshop-platform/pull/9)
([run 33270596059](https://github.com/DamienGR/minshop-platform/actions/runs/33270596059)),
puis sur `main` lui-même en `0d2bc65`
([run 33275634908](https://github.com/DamienGR/minshop-platform/actions/runs/33275634908)),
avec la même sortie :

```
(retrying GET /product/sample-tee — miniflare dropped the connection, HTTP 500)
(retrying GET /product/sample-tee — curl exit 7, no response)
D1 integration failed: GET /product/sample-tee — no response after 3 attempts (curl exit 7).
```

Le retry part bien sur la 500 de miniflare, puis les deux tentatives suivantes
n'obtiennent rien du tout : le serveur de développement est mort. La mitigation
fait donc exactement ce qu'on attendait d'elle, nommer la coupure plutôt que la
déguiser en `cache-control` vide, sans supprimer la panne.

L'échec de `0d2bc65` remet le compteur à zéro, après quatre exécutions vertes
accumulées depuis la mitigation. Un échec sur cinq exécutions abouties reste
bien meilleur que le un sur deux d'avant, mais sur un échantillon de cette
taille l'écart ne se distingue pas du hasard : c'est précisément ce que le seuil
des dix passages est là pour trancher.

##### Piste ouverte : la version de miniflare

La panne se produit sous le plancher du dépôt. Rien ici ne peut réparer l'entry
worker de miniflare ; le seul levier disponible est la version qu'on en exécute.
Le log de l'échec signale lui-même une version plus récente de wrangler que
celle du verrou. La montée de wrangler à 4.127.1 fait passer miniflare de
`5.20260825.0-alpha` à `5.20260828.0-alpha` et workerd de `1.20260825.1` à
`1.20260828.1` : voir
[PR #12](https://github.com/DamienGR/minshop-platform/pull/12). Comme la montée
précédente, elle ne prouvera rien seule ; c'est le compteur qui tranchera.

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

- [ ] schéma de manifeste ;
- [ ] conventions de nommage ;
- [ ] séparation des fichiers cœur/client/générés ;
- [ ] fixtures `pilot-fr` et `canary-minimal` ;
- [ ] règles `CODEOWNERS` ;
- [ ] test de politique des chemins.

#### Tests

- [ ] manifeste valide ;
- [ ] champ inconnu refusé ;
- [ ] slug dangereux refusé ;
- [ ] nom réservé refusé ;
- [ ] doublon de ressource détecté ;
- [ ] matrice de build pour les deux boutiques ;
- [ ] thème A jamais chargé par B ;
- [ ] aucun identifiant de ressource partagé.

#### Critère de sortie

- [ ] Deux boutiques différentes se construisent depuis le même socle sans
  condition client codée en dur dans le cœur métier.

### Jalon 2 — Générateur de boutique

Durée indicative : 3 à 5 jours.

#### Livrables

- [ ] package CLI ;
- [ ] `shopctl new` ;
- [ ] `shopctl doctor` ;
- [ ] initialisation Git et remotes ;
- [ ] génération du manifeste et du thème ;
- [ ] rapport de création.

#### Tests

- [ ] snapshots du squelette ;
- [ ] chemin contenant des espaces ;
- [ ] répertoire non vide refusé ;
- [ ] tag de socle inexistant ;
- [ ] fonctionnement sans installation avec `--no-install` ;
- [ ] aucun secret ou identifiant de test copié ;
- [ ] résultat déterministe ;
- [ ] boutique générée immédiatement constructible.

#### Critère de sortie

- [ ] `shopctl new test-client`, suivi de `npm ci` et `npm run verify` dans
  `shop-test-client`, réussit sans modification manuelle.

### Jalon 3 — Socle français

Durée indicative : 5 à 8 jours.

#### Livrables

- [ ] dictionnaires de traduction typés ;
- [ ] storefront français ;
- [ ] erreurs françaises ;
- [ ] e-mails français ;
- [ ] décision concernant la traduction de l'admin ;
- [ ] `lang="fr"` ;
- [ ] formats `fr-FR` ;
- [ ] fuseau `Europe/Paris` ;
- [ ] checkout Stripe français ;
- [ ] pages légales brouillon ;
- [ ] version des CGV enregistrée avec la commande.

#### Décision TVA et facturation

Une étude courte doit comparer puis figer :

- [ ] prix TTC enregistrés par Minshop ;
- [ ] taux par produit ou taux unique ;
- [ ] Stripe Tax activé ou désactivé ;
- [ ] ventilation de TVA enregistrée avec la commande ;
- [ ] reçu Stripe ou véritable facture ;
- [ ] génération et numérotation des factures ;
- [ ] export destiné à la comptabilité.

Cette décision doit être validée par un comptable ou conseil compétent avant la
commercialisation.

- [ ] Obtenir et consigner cette validation externe.

#### Tests

- [ ] format `1 234,56 €` ;
- [ ] dates françaises ;
- [ ] arrondis de panier ;
- [ ] remises ;
- [ ] taux de TVA retenus ;
- [ ] accents et Unicode ;
- [ ] chaînes manquantes détectées à la compilation ;
- [ ] e-mails en français ;
- [ ] CGV non publiées par défaut ;
- [ ] paiement bloqué sans acceptation ;
- [ ] version des CGV capturée ;
- [ ] checkout Stripe affiché en français.

#### Critère de sortie

- [ ] Le modèle français de prix, TVA, facturation et consentement est documenté,
  implémenté et validé.

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

- [ ] `npm run format:check` ;
- [ ] `npm run typecheck` ;
- [ ] `npm run test:unit` ;
- [ ] `npm run test:cli` ;
- [x] contrôle équivalent à `npm run theme:check` dans la CI Minshop ;
- [x] tests de contrat storefront dans la CI Minshop ;
- [x] build de production dans la CI Minshop ;
- [x] contrôle de la chaîne d'outils (`npm run check:toolchain`) ;
- [x] dry run de déploiement et budgets de taille (`npm run check:deploy`) ;
- [x] scan de secrets (`npm run check:secrets`) ;
- [x] construction depuis un clone vierge (job CI dédié).

Objectif : moins de cinq minutes.

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
