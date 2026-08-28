# Plan d'implémentation du pilote Minshop

## 1. Finalité du pilote

Le pilote doit valider la viabilité technique, opérationnelle et économique d'une
offre industrialisée de création de petites boutiques e-commerce sur mesure.

Il doit livrer :

1. une boutique française fonctionnelle, réaliste et déployée ;
2. un socle Minshop français versionné ;
3. une architecture permettant de gérer plusieurs clients ;
4. une CLI de génération et d'exploitation ;
5. des procédures testées de mise à jour, sauvegarde, restauration et sortie ;
6. une campagne de certification réutilisable pour chaque nouvelle boutique.

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

- vingt produits ;
- plusieurs catégories ;
- produits simples et variantes ;
- états en stock, stock faible et épuisé ;
- livraison fixe, par poids et gratuite au seuil ;
- thème entièrement personnalisé ;
- pages légales fictives clairement identifiées comme telles.

#### `canary-minimal`

- cinq produits ;
- thème différent ;
- fonctionnalités minimales ;
- utilisée pour vérifier l'absence de configuration codée en dur pour le pilote.

## 3. Architecture multi-client

### 3.1 Plan de contrôle

Le plan de contrôle comprend :

- le fork `agency-minshop-core` ;
- la CLI `shopctl` ;
- les schémas de configuration ;
- les templates de boutique ;
- le registre privé de flotte ;
- les workflows de mise à jour ;
- les tests génériques.

Il ne contient aucune donnée de commande et aucun secret client.

### 3.2 Plan de données

Chaque boutique dispose de ses propres :

- Worker Cloudflare ;
- base D1 ;
- bucket R2 d'images ;
- bucket R2 de fichiers privés ;
- secrets ;
- sauvegardes ;
- domaine ;
- comptes Stripe et Resend.

Les boutiques européennes utilisent la juridiction Cloudflare `eu` pour D1 et
R2. La CLI doit vérifier la juridiction après le provisioning.

### 3.3 Propriété des fichiers

Les fichiers doivent être divisés en trois catégories :

| Catégorie | Propriétaire | Exemples |
|---|---|---|
| Cœur | Socle agence | paiement, stock, auth, migrations |
| Client | Boutique | thème, manifeste, contenus, assets |
| Généré | Outils | configuration Wrangler, rapports, index |

La CI doit refuser qu'une modification présentée comme une simple
personnalisation client touche un fichier du cœur sans approbation explicite.

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

1. récupère un tag ;
2. crée une branche ;
3. merge le tag ;
4. exécute les tests ;
5. déploie en staging ;
6. ouvre une pull request ;
7. attend une validation humaine avant la production.

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

- les champs obligatoires ;
- les valeurs autorisées ;
- les combinaisons incompatibles ;
- la forme du slug ;
- la convention des noms de ressources ;
- la compatibilité entre la version du manifeste et celle du socle.

Les clés API et secrets sont interdits dans le manifeste.

## 5. CLI `shopctl`

### 5.1 Technologie

- Node.js 22 ;
- TypeScript ;
- dépendances minimales ;
- appels à Wrangler encapsulés ;
- sortie humaine par défaut ;
- sortie machine avec `--json` ;
- codes d'erreur stables ;
- journalisation structurée sans secret.

### 5.2 Commandes de création

```bash
shopctl new <slug>
shopctl doctor
shopctl config validate
```

`shopctl new` doit :

1. valider le slug et les options ;
2. sélectionner un tag précis du socle ;
3. cloner ce tag avec son historique ;
4. renommer le remote du socle en `core` ;
5. configurer le futur remote `origin` si fourni ;
6. créer le manifeste ;
7. générer un thème client à partir de la référence choisie ;
8. générer les fixtures et exemples d'import ;
9. installer les dépendances sauf option contraire ;
10. exécuter une vérification minimale ;
11. présenter les prochaines actions.

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

- vérifier `wrangler whoami` ;
- comparer l'account ID au manifeste ou à l'état attendu ;
- vérifier l'activation préalable de R2 ;
- créer D1 et R2 avec la juridiction `eu` ;
- garder le bucket de fichiers privé ;
- générer les secrets internes avec une source cryptographique ;
- transmettre les secrets à Wrangler par entrée standard ;
- ne jamais les écrire sur disque ou dans les logs ;
- appliquer les migrations ;
- produire un rapport des ressources créées ;
- reprendre proprement après une interruption.

La création de comptes, l'invitation des utilisateurs et l'activation de Stripe
restent des opérations humaines dans la première version. `shopctl doctor` doit
les détecter et fournir une checklist.

### 5.4 Catalogue

```bash
shopctl catalog validate ./imports/catalog.csv
shopctl catalog import ./imports/catalog.csv --dry-run
shopctl catalog import ./imports/catalog.csv
shopctl catalog report
```

L'import doit être :

- validé avant toute écriture ;
- idempotent par SKU ;
- capable de reprendre ;
- explicite sur les créations et mises à jour ;
- capable de traiter les images ;
- capable de refuser un changement destructif non demandé.

### 5.5 Vérification et déploiement

```bash
shopctl verify --env staging
shopctl deploy --env staging
shopctl deploy --env production
```

Le déploiement production suit cet ordre :

1. vérification complète ;
2. sauvegarde ou bookmark ;
3. migrations additives ;
4. upload d'une nouvelle version ;
5. smoke test avant promotion lorsque possible ;
6. promotion ;
7. smoke test public ;
8. rollback du code en cas d'échec.

Les migrations doivent rester compatibles avec la version applicative précédente.

### 5.6 Sauvegarde et restauration

```bash
shopctl backup --env production
shopctl backup list
shopctl backup verify <backup-id>
shopctl restore --env staging --from <backup-id>
```

Une restauration vers la production nécessite une option dédiée et une
confirmation saisie par l'opérateur. Elle n'est jamais le comportement par
défaut.

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

- fork privé de Minshop ;
- référence upstream enregistrée ;
- versions Node et npm imposées ;
- lockfile conservé ;
- CI minimale ;
- inventaire des dépendances et fonctionnalités ;
- premiers ADR dans `docs/architecture/decisions/`.

ADR initiaux :

- modèle d'isolation ;
- propriété des comptes ;
- versionnement du socle ;
- localisation des données ;
- stratégie de sauvegarde ;
- politique des migrations ;
- périmètre fonctionnel de l'offre.

#### Tests

```bash
npm ci
npm run verify
npm run build
npx wrangler deploy --dry-run
```

Ajouter :

- scan de secrets ;
- audit de dépendances ;
- contrôle de la taille du bundle ;
- construction depuis un clone vierge.

#### Critère de sortie

Le fork non personnalisé se construit, passe les tests Minshop et peut être
déployé dans un compte Cloudflare de test.

### Jalon 1 — Fondations multi-client

Durée indicative : 3 à 4 jours.

#### Livrables

- schéma de manifeste ;
- conventions de nommage ;
- séparation des fichiers cœur/client/générés ;
- fixtures `pilot-fr` et `canary-minimal` ;
- règles `CODEOWNERS` ;
- test de politique des chemins.

#### Tests

- manifeste valide ;
- champ inconnu refusé ;
- slug dangereux refusé ;
- nom réservé refusé ;
- doublon de ressource détecté ;
- matrice de build pour les deux boutiques ;
- thème A jamais chargé par B ;
- aucun identifiant de ressource partagé.

#### Critère de sortie

Deux boutiques différentes se construisent depuis le même socle sans condition
client codée en dur dans le cœur métier.

### Jalon 2 — Générateur de boutique

Durée indicative : 3 à 5 jours.

#### Livrables

- package CLI ;
- `shopctl new` ;
- `shopctl doctor` ;
- initialisation Git et remotes ;
- génération du manifeste et du thème ;
- rapport de création.

#### Tests

- snapshots du squelette ;
- chemin contenant des espaces ;
- répertoire non vide refusé ;
- tag de socle inexistant ;
- fonctionnement sans installation avec `--no-install` ;
- aucun secret ou identifiant de test copié ;
- résultat déterministe ;
- boutique générée immédiatement constructible.

#### Critère de sortie

```bash
shopctl new test-client
cd shop-test-client
npm ci
npm run verify
```

réussit sans modification manuelle.

### Jalon 3 — Socle français

Durée indicative : 5 à 8 jours.

#### Livrables

- dictionnaires de traduction typés ;
- storefront français ;
- erreurs françaises ;
- e-mails français ;
- décision concernant la traduction de l'admin ;
- `lang="fr"` ;
- formats `fr-FR` ;
- fuseau `Europe/Paris` ;
- checkout Stripe français ;
- pages légales brouillon ;
- version des CGV enregistrée avec la commande.

#### Décision TVA et facturation

Une étude courte doit comparer puis figer :

- prix TTC enregistrés par Minshop ;
- taux par produit ou taux unique ;
- Stripe Tax activé ou désactivé ;
- ventilation de TVA enregistrée avec la commande ;
- reçu Stripe ou véritable facture ;
- génération et numérotation des factures ;
- export destiné à la comptabilité.

Cette décision doit être validée par un comptable ou conseil compétent avant la
commercialisation.

#### Tests

- format `1 234,56 €` ;
- dates françaises ;
- arrondis de panier ;
- remises ;
- taux de TVA retenus ;
- accents et Unicode ;
- chaînes manquantes détectées à la compilation ;
- e-mails en français ;
- CGV non publiées par défaut ;
- paiement bloqué sans acceptation ;
- version des CGV capturée ;
- checkout Stripe affiché en français.

#### Critère de sortie

Le modèle français de prix, TVA, facturation et consentement est documenté,
implémenté et validé.

### Jalon 4 — Import de catalogue

Durée indicative : 3 à 4 jours.

#### Livrables

- format CSV contractuel ;
- schéma et validateur ;
- dry-run ;
- upsert idempotent par SKU ;
- import d'images ;
- optimisation d'images ;
- rapport d'import ;
- catalogue témoin de vingt produits.

#### Tests

- SKU manquant ;
- SKU dupliqué ;
- prix invalide ;
- stock non entier ;
- variante incohérente ;
- catégorie inconnue ;
- image absente ou trop lourde ;
- faux type MIME ;
- Markdown hostile ;
- réimport sans doublon ;
- mise à jour d'un produit ;
- interruption et reprise ;
- import de 100 produits.

#### Critère de sortie

Le catalogue peut être reconstruit intégralement à partir du CSV et des médias
sources.

### Jalon 5 — Thème du pilote

Durée indicative : 4 à 6 jours.

#### Livrables

- design tokens ;
- header et navigation ;
- footer ;
- catalogue ;
- cartes produits ;
- fiche produit ;
- pages de contenu ;
- responsive ;
- états vides, longs, épuisés et en erreur.

#### Tests

```bash
npm run theme:check
npm run test:storefront-contract
npm run verify
```

Ajouter :

- Playwright desktop et mobile ;
- régression visuelle ;
- axe ;
- navigation clavier ;
- zoom 200 % ;
- navigation sans JavaScript ;
- ajout au panier avec et sans JavaScript ;
- titres très longs ;
- catalogue vide ;
- produit épuisé ;
- erreur de recherche.

#### Critère de sortie

Le storefront est visuellement spécifique et tous les contrats fonctionnels
Minshop restent verts.

### Jalon 6 — Provisioning et CI/CD

Durée indicative : 4 à 5 jours.

#### Livrables

- `shopctl provision` ;
- staging et production ;
- D1 et R2 EU ;
- secrets internes ;
- GitHub Environments ;
- approbation production ;
- domaine personnalisé ;
- domaine d'images ;
- bucket privé non public ;
- smoke tests post-déploiement.

#### Tests

- dry-run ;
- provisioning dans un compte de test ;
- seconde exécution sans changement ;
- reprise après interruption ;
- mauvais compte Cloudflare refusé ;
- juridiction EU vérifiée via API ;
- bucket privé inaccessible publiquement ;
- déploiement CI ;
- smoke test automatique.

#### Critère de sortie

Une boutique créée par la CLI peut être déployée en staging avec une commande,
hors autorisations humaines initiales.

### Jalon 7 — Paiement et traitement de commande

Durée indicative : 4 à 5 jours.

#### Livrables

- Stripe test et live ;
- webhook signé ;
- livraison France ;
- promotions ;
- comportement TVA retenu ;
- Resend ;
- confirmation de commande ;
- notification d'expédition ;
- remboursement.

#### Tests

- paiement réussi ;
- paiement refusé ;
- paiement asynchrone réussi et échoué ;
- session expirée ;
- webhook dupliqué ;
- webhook désordonné ;
- signature invalide ;
- remboursement total ;
- remboursement partiel ;
- Resend indisponible ;
- achat concurrent de la dernière unité ;
- prix changé depuis l'ajout au panier ;
- stock changé ;
- franco au seuil exact ;
- promotion invalide ou expirée.

#### Critère de sortie

Un paiement réel de faible montant peut être encaissé puis remboursé avec
cohérence entre Stripe, D1, stock, admin et e-mails.

### Jalon 8 — Sécurité et exploitation

Durée indicative : 5 à 6 jours.

#### Livrables

- Cloudflare Access ;
- Turnstile ;
- rate limits ;
- en-têtes de sécurité ;
- logs sans PII ;
- supervision ;
- exports ;
- politique de conservation ;
- sauvegarde et restauration ;
- runbooks d'incident.

#### Tests

- admin anonyme refusé ;
- API admin anonyme refusée ;
- CSRF ;
- expiration de session ;
- brute force ;
- téléchargement non autorisé ;
- upload SVG ;
- faux MIME ;
- traversée de chemin ;
- absence de secrets dans logs et artefacts ;
- absence d'adresse et d'e-mail dans les logs ;
- restauration complète en staging ;
- comparaison avant/après restauration ;
- export et anonymisation d'un client.

#### Critère de sortie

La boutique peut être restaurée dans un nouvel environnement en moins d'une
heure à partir d'une sauvegarde documentée.

### Jalon 9 — Mise à jour de flotte

Durée indicative : 3 à 4 jours.

#### Livrables

- tags du socle ;
- `shopctl core upgrade` ;
- `shopctl fleet status` ;
- `shopctl fleet upgrade` ;
- pull requests automatiques ;
- rapport de versions ;
- détection du drift ;
- notes de migration.

#### Tests

- mise à jour des deux boutiques témoins ;
- thème inchangé ;
- manifeste inchangé ;
- conflit volontaire signalé ;
- migration D1 additive ;
- ancien Worker compatible avec le nouveau schéma ;
- rollback applicatif ;
- boutique conservée sur l'ancienne version toujours fonctionnelle.

#### Critère de sortie

Une version du socle peut être proposée à plusieurs boutiques sans copie
manuelle de fichiers et sans déploiement automatique non approuvé.

### Jalon 10 — Certification finale

Durée indicative : 3 à 4 jours.

#### Livrables

- rapport de tests ;
- rapport de sécurité ;
- rapport de performance ;
- preuve de restauration ;
- validation TVA/facturation ;
- checklist de lancement ;
- documentation de support ;
- décision go/no-go.

#### Critère de sortie

Tous les critères de la section 8 sont satisfaits ou font l'objet d'une
dérogation écrite, datée et accompagnée d'une mesure compensatoire.

## 7. Organisation de la CI

### 7.1 À chaque commit

```bash
npm run format:check
npm run typecheck
npm run test:unit
npm run test:cli
npm run theme:check
npm run test:storefront-contract
npm run build
```

Objectif : moins de cinq minutes.

### 7.2 À chaque pull request client

```bash
npm run verify
npm run test:catalog
npm run test:tenant-isolation
npm run test:e2e
npm run test:a11y
npm run test:visual
```

### 7.3 Chaque nuit

- D1 d'intégration propre ;
- checkout Stripe test ;
- webhook Stripe ;
- e-mail de test ;
- sauvegarde ;
- restauration vers un environnement éphémère ;
- smoke tests sur les deux boutiques témoins ;
- audit des dépendances.

### 7.4 Avant la production

- suite complète verte ;
- sauvegarde verte ;
- migrations validées ;
- smoke test staging vert ;
- approbation GitHub Environment ;
- smoke test production vert ;
- rapport de déploiement conservé.

## 8. Campagne finale de tests

### 8.1 Fonctionnel

- catalogue ;
- recherche ;
- catégories ;
- pagination ;
- variantes ;
- stock ;
- panier ;
- livraison ;
- promotions ;
- paiement ;
- remboursement ;
- e-mails ;
- administration ;
- export ;
- pages légales.

### 8.2 Paiement et cohérence

- commande créée une seule fois ;
- montant Stripe égal au montant D1 ;
- stock décrémenté une seule fois ;
- taxes et frais de livraison figés dans la commande ;
- webhook idempotent ;
- remboursement synchronisé ;
- échec d'e-mail sans perte de commande.

### 8.3 Isolation multi-client

- deux dépôts ;
- deux thèmes ;
- deux Workers ;
- deux bases ;
- quatre buckets par paire d'environnements ;
- aucun secret partagé ;
- aucune donnée croisée ;
- versions du socle indépendantes ;
- mise à niveau commune réussie.

### 8.4 Sécurité

- aucune vulnérabilité critique ou élevée non justifiée ;
- aucune clé dans Git, les logs ou les artefacts ;
- webhooks signés ;
- routes admin protégées ;
- rate limits actifs ;
- uploads contrôlés ;
- CSP et en-têtes présents ;
- aucune donnée de carte traitée par l'application ;
- aucune PII inutile dans les logs.

### 8.5 Accessibilité et navigateurs

- zéro violation axe sérieuse ou critique ;
- navigation complète au clavier ;
- focus visible ;
- zoom 200 % ;
- contrastes suffisants ;
- Chrome desktop ;
- Firefox desktop ;
- Safari/iPhone ;
- Chrome/Android.

### 8.6 Performance

Objectifs internes initiaux :

- Lighthouse mobile supérieur ou égal à 90 en performance, accessibilité et SEO ;
- LCP inférieur ou égal à 2,5 secondes ;
- CLS inférieur ou égal à 0,1 ;
- INP inférieur ou égal à 200 ms ;
- aucune erreur Worker sous charge ;
- vingt utilisateurs virtuels pendant quinze minutes ;
- cinq checkouts concurrents sans survente.

Si le plan Workers Free dépasse régulièrement sa limite CPU ou génère des
erreurs de ressources, la boutique doit passer au plan Workers Paid.

### 8.7 Résilience

- Resend indisponible ;
- webhook Stripe répété ;
- média R2 manquant ;
- échec réseau temporaire ;
- rotation des secrets ;
- mot de passe admin perdu ;
- rollback Worker ;
- restauration complète ;
- RTO inférieur ou égal à 60 minutes ;
- RPO inférieur ou égal à 24 heures.

### 8.8 Conformité et validation humaine

- revue des pages légales ;
- revue du consentement aux CGV ;
- revue TVA et facturation ;
- commande réelle ;
- remboursement réel ;
- lecture des e-mails dans Gmail, Outlook et Apple Mail ;
- recette par une personne extérieure au développement ;
- confirmation que les textes définitifs restent sous la responsabilité du
  marchand.

## 9. Conditions de déploiement d'une boutique

Un déploiement est bloqué lorsque :

- le manifeste est invalide ;
- la version du socle n'est pas supportée ;
- un test obligatoire échoue ;
- la sauvegarde préalable échoue ;
- le compte Cloudflare ne correspond pas ;
- la juridiction n'est pas celle attendue ;
- le bucket privé est public ;
- un secret est détecté ;
- une migration n'est pas rétrocompatible ;
- la staging n'a pas été validée ;
- l'approbation humaine production manque.

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

- architecture et ADR ;
- guide de création d'une boutique ;
- guide d'import de catalogue ;
- guide de personnalisation du thème ;
- procédure Stripe et Resend ;
- procédure de déploiement ;
- procédure de sauvegarde et restauration ;
- procédure de mise à niveau du socle ;
- procédure d'incident et de violation de données ;
- procédure de remboursement ;
- procédure de départ d'un client ;
- matrice des responsabilités agence/marchand ;
- liste des sous-traitants techniques ;
- modèle de recette et de procès-verbal de livraison.
