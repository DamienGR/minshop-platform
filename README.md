# Minshop Offer

Socle de travail pour industrialiser une offre de petites boutiques e-commerce
sur mesure à partir de [Minshop](https://github.com/ddyy/minshop).

Ce dépôt démarre par la définition du produit, de l'architecture multi-client et
des critères de qualité. Le code du fork Minshop et les outils CLI seront ajoutés
au fil des jalons décrits dans le
[plan d'implémentation](docs/implementation-plan.md).

## Objectif

Construire une offre e-commerce à faible coût d'exploitation pour des boutiques
ayant typiquement :

- moins de 100 produits ;
- environ 50 commandes par mois ;
- une seule langue et une seule devise ;
- un storefront visuellement sur mesure ;
- un panier, un checkout et un back-office standardisés ;
- peu ou pas d'intégrations métier spécifiques.

Le pilote doit produire simultanément :

1. une boutique française complète et exploitable ;
2. un socle commun versionné ;
3. une CLI permettant de créer et exploiter les boutiques suivantes ;
4. un processus de mise à jour de plusieurs boutiques sans partager leurs
   données ni leurs secrets.

## Décision d'architecture

L'architecture retenue est **multi-client au niveau du pilotage et mono-client
à l'exécution**.

```text
                         ┌───────────────────────────┐
                         │ Fork Minshop de l'agence │
                         │ socle FR, CLI et tests   │
                         └─────────────┬─────────────┘
                                       │ tags versionnés
                         ┌─────────────▼─────────────┐
                         │ Registre privé de flotte │
                         └───────┬──────────┬────────┘
                                 │          │
                    ┌────────────▼─┐      ┌─▼──────────────┐
                    │ Boutique A   │      │ Boutique B     │
                    │ dépôt dédié  │      │ dépôt dédié    │
                    └──────┬───────┘      └───────┬────────┘
                           │                      │
                    Cloudflare A           Cloudflare B
                    Worker/D1/R2            Worker/D1/R2
```

Chaque client dispose donc de ses propres :

- dépôt applicatif ;
- compte ou périmètre Cloudflare ;
- Worker ;
- base D1 ;
- buckets R2 ;
- domaine ;
- comptes Stripe et Resend ;
- secrets et sauvegardes.

La mutualisation concerne le code, les tests, les scripts, la supervision des
versions et les procédures d'exploitation. Elle ne concerne jamais les données
des acheteurs.

## Stack cible

- Minshop et Astro SSR ;
- TypeScript et Node.js 22 ;
- Tailwind CSS ;
- Cloudflare Workers ;
- Cloudflare D1 ;
- Cloudflare R2 ;
- Stripe Checkout ;
- Resend ;
- Cloudflare Access et Turnstile ;
- GitHub Actions et Wrangler pour la CI/CD ;
- Playwright, axe et Lighthouse CI pour la recette du storefront.

Pour les boutiques européennes, D1 et R2 devront être créés avec la juridiction
Cloudflare `eu`, et pas seulement avec un hint de localisation `weur`.

## Périmètre de l'offre initiale

### Inclus

- B2C France ;
- français et EUR ;
- prix TTC ;
- checkout invité ;
- moins de 100 produits ;
- variantes et stock simples ;
- Stripe Checkout ;
- livraison fixe, par poids ou franco ;
- promotions Stripe ;
- e-mails de commande et d'expédition ;
- catégories, recherche et pages éditoriales ;
- pages légales fournies par le marchand ;
- export des commandes ;
- sauvegarde et procédure de restauration.

### Hors périmètre

- multilingue et multidevise ;
- abonnements ;
- marketplace ;
- B2B avancé ;
- ERP, caisse ou comptabilité synchronisés ;
- points relais et tarifs transporteur en temps réel ;
- automatisation marketing ;
- produits hautement configurables ;
- recherche sémantique, Lightning et MCP.

Ces besoins pourront être proposés sur devis, mais ne doivent pas faire dériver
le socle de l'offre standard.

## Modèle de dépôts prévu

Le présent dépôt a vocation à devenir le dépôt `agency-minshop-core` :

```text
.
├── docs/                         Documentation et runbooks
├── packages/
│   ├── create-shop/              Générateur d'une boutique
│   └── shopctl/                  CLI d'exploitation
├── schemas/                      Schémas des manifestes et imports
├── templates/                    Squelettes client et contenus
├── src/                          Fork et extensions Minshop
└── test/                         Tests cœur, CLI, flotte et E2E
```

Un dépôt client généré contiendra notamment :

```text
shop-acme/
├── client/
│   ├── client.yaml
│   ├── shipping.yaml
│   ├── legal-content/
│   └── fixtures/
├── imports/
├── public/client/
├── src/themes/acme/
├── tests/client/
└── core-version.json
```

Les personnalisations client restent dans des chemins réservés. Une modification
fonctionnelle générique doit être apportée au socle, publiée dans une version,
puis propagée aux boutiques par une pull request de mise à niveau.

## CLI prévue

Les commandes ci-dessous représentent le contrat fonctionnel cible. Elles ne
sont pas encore implémentées.

```bash
# Créer le dépôt d'une boutique
shopctl new acme \
  --name "Boutique Acme" \
  --locale fr-FR \
  --currency EUR \
  --jurisdiction eu

cd shop-acme

# Vérifier les outils, comptes et prérequis
shopctl doctor

# Provisionner des ressources isolées
shopctl provision --env staging --dry-run
shopctl provision --env staging

# Importer et vérifier le catalogue
shopctl catalog import ./imports/catalog.csv --dry-run
shopctl catalog import ./imports/catalog.csv

# Tester et déployer
shopctl verify --env staging
shopctl deploy --env staging
shopctl deploy --env production

# Exploiter la boutique
shopctl backup --env production
shopctl restore --env staging --from <backup-id>
shopctl core status
shopctl core upgrade --to 1.1.0
```

Gestion de la flotte :

```bash
shopctl fleet status
shopctl fleet verify
shopctl fleet upgrade --to 1.1.0 --open-pr
shopctl fleet report --format json
```

La CLI devra être idempotente, compatible `--dry-run` et `--json`, et ne jamais
recevoir ni afficher de secret dans les arguments ou les logs.

## Environnements

Chaque boutique possède au minimum deux environnements indépendants :

| Environnement | Usage | Paiement | Données |
|---|---|---|---|
| `staging` | Recette et validation | Stripe test | Fictives |
| `production` | Boutique publique | Stripe live | Réelles |

Convention prévue pour les ressources :

```text
minshop-{client}-{env}            Worker
minshop-{client}-{env}-db         D1
minshop-{client}-{env}-images     R2 public
minshop-{client}-{env}-files      R2 privé
```

Le compte Cloudflare actif devra être comparé au manifeste avant toute
opération. La CLI devra refuser de déployer lorsque le compte ou l'environnement
ne correspond pas à la boutique.

## Stratégie de mise à jour

Chaque dépôt client conserve l'historique du socle et configure deux remotes :

- `origin` pointe vers le dépôt client ;
- `core` pointe vers ce dépôt de socle.

Une mise à niveau suit le flux suivant :

1. publication d'un tag du socle ;
2. création d'une branche dans le dépôt client ;
3. merge du tag ;
4. exécution de la suite de tests ;
5. déploiement en staging ;
6. tests synthétiques ;
7. ouverture d'une pull request ;
8. validation humaine ;
9. sauvegarde puis déploiement en production.

Les migrations de base doivent être additives et rétrocompatibles. Un rollback
du Worker ne restaure pas automatiquement l'ancien schéma D1.

## Qualité et tests

Commandes cibles :

```bash
npm run format:check
npm run typecheck
npm run test:unit
npm run test:cli
npm run test:catalog
npm run test:tenant-isolation
npm run theme:check
npm run test:storefront-contract
npm run test:e2e
npm run test:a11y
npm run test:visual
npm run test:restore
npm run verify
```

Une boutique ne pourra pas être déployée lorsque :

- son manifeste est invalide ;
- sa version du socle n'est pas supportée ;
- les tests fonctionnels ou de thème échouent ;
- la sauvegarde préalable a échoué ;
- la juridiction Cloudflare n'est pas celle attendue ;
- un bucket privé est publiquement accessible ;
- des secrets sont détectés dans le dépôt ou les artefacts.

## Sauvegardes et objectifs de reprise

La sauvegarde D1 devra être applicative ou réalisée table par table afin de ne
pas dépendre d'un export global incompatible avec certaines tables FTS5. Elle
inclura :

- les données métier ;
- la version du schéma ;
- l'inventaire des objets R2 ;
- les sommes de contrôle ;
- un chiffrement ;
- un manifeste de restauration.

Objectifs initiaux :

- RPO maximal : 24 heures ;
- RTO maximal : 60 minutes ;
- restauration testée au moins une fois par trimestre.

Par défaut, une restauration se fait dans un environnement vide de staging. Une
restauration vers la production nécessitera une confirmation explicite.

## Jalons

| Jalon | Résultat principal |
|---|---|
| 0 | Fork Minshop reproductible et CI de base |
| 1 | Manifestes et isolation multi-client |
| 2 | Générateur `shopctl new` |
| 3 | Socle français, TVA et facturation cadrées |
| 4 | Import de catalogue idempotent |
| 5 | Thème sur mesure du pilote |
| 6 | Provisioning Cloudflare et CI/CD |
| 7 | Paiement, stock, livraison et e-mails |
| 8 | Sécurité, sauvegarde et exploitation |
| 9 | Mise à jour de plusieurs boutiques |
| 10 | Certification finale du pilote |

Le détail, les tests et les critères de sortie de chaque jalon sont décrits dans
[docs/implementation-plan.md](docs/implementation-plan.md).

## État actuel

Le dépôt est en phase de cadrage :

- [x] architecture cible définie ;
- [x] périmètre du pilote défini ;
- [x] jalons et stratégie de tests définis ;
- [x] fork Minshop importé avec son historique upstream, en dépôt privé ;
- [x] décisions d'architecture initiales enregistrées ;
- [x] inventaire de la baseline relevé ;
- [x] CI initialisée (chaîne d'outils imposée, dry run de déploiement, budgets
  de taille, scan de secrets, build depuis un clone vierge) ;
- [ ] intégration D1 verte en CI — rouge sur `main` depuis l'import du fork,
  voir « Défaut de baseline connu » dans le plan ;
- [ ] manifeste client implémenté ;
- [ ] CLI implémentée ;
- [ ] boutique pilote déployée ;
- [ ] deuxième boutique témoin déployée ;
- [ ] campagne finale validée.

## Documentation

- [Plan détaillé d'implémentation](docs/implementation-plan.md)
- [Décisions d'architecture (ADR)](docs/architecture/decisions/README.md)
- [Inventaire de la baseline](docs/architecture/baseline-inventory.md)
- [Documentation Minshop](https://github.com/ddyy/minshop)
- [Personnalisation d'un storefront Minshop](https://github.com/ddyy/minshop/blob/main/CUSTOMIZING.md)
- [Localisation des données D1](https://developers.cloudflare.com/d1/configuration/data-location/)
- [Localisation des données R2](https://developers.cloudflare.com/r2/reference/data-location/)
