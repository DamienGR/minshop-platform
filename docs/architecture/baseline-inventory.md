# Inventaire de la baseline

Photographie de ce que le socle apporte au premier jour du pilote : dépendances
et fonctionnalités héritées de Minshop, avec leur statut vis-à-vis du périmètre
défini par l'[ADR 0007](decisions/0007-perimetre-fonctionnel.md).

Cet inventaire est un **relevé daté**, pas un document vivant : il fixe l'état
de référence du jalon 0. Il est refait à chaque montée de version majeure du
socle, et non à chaque commit.

- **Commit de référence** : `27334e0` ;
- **Date du relevé** : 2026-08-28 ;
- **Amont** : [ddyy/minshop](https://github.com/ddyy/minshop), historique
  conservé dans ce dépôt.

## 1. Chaîne d'outils

| Élément | Version imposée | Où c'est déclaré |
|---|---|---|
| Node.js | `>=22.12.0 <23` | `engines` (racine et `mcp/`), `.nvmrc` |
| npm | `>=10.9.0` | `engines` (racine et `mcp/`) |
| Astro | 7.1.x | `package.json` |
| Wrangler | 4.118.x | `package.json` (devDependencies) |
| TypeScript | 6.0.x | `package.json` (devDependencies) |
| Vitest | 4.1.x | `package.json` (devDependencies) |
| Tailwind CSS | 4.3.x | `package.json` (devDependencies) |

Le respect de la chaîne d'outils est vérifié par `npm run check:toolchain`
(exécuté par `npm run verify`) et refusé à l'installation par
`engine-strict=true`.

## 2. Dépendances

Trois espaces de dépendances indépendants, avec chacun son `package-lock.json`
versionné. La séparation n'est pas cosmétique : les dépendances du Worker MCP
(SDK Agents, workerd) cassent silencieusement le build Astro du storefront si
elles remontent à la racine.

| Espace | Rôle | Dépendances directes | Paquets verrouillés | Audit |
|---|---|---|---|---|
| racine | storefront Astro sur Workers | 5 prod + 10 dev | 480 | 0 vulnérabilité |
| `mcp/` | Worker MCP autonome (hors périmètre) | 3 prod + 2 dev | 230 | 0 vulnérabilité |
| `create-minshop/` | CLI de scaffolding publiée | 0 | — | 0 vulnérabilité |

Audit relevé avec `npm audit` et `npm audit --prefix mcp` à la date ci-dessus.

### 2.1 Dépendances de production (racine)

| Paquet | Version | Rôle | Statut pilote |
|---|---|---|---|
| `astro` | ^7.1.6 | framework SSR | cœur |
| `@astrojs/cloudflare` | ^14.1.7 | adaptateur Workers | cœur |
| `stripe` | ^22.4.0 | SDK Stripe (adaptateur paiement) | cœur |
| `markdown-it` | ^15.0.0 | rendu des pages éditoriales (`html: false`) | cœur |
| `uqr` | ^0.1.3 | QR code des factures Lightning | hors périmètre, conservé |

253 paquets transitifs en production, 369 avec les dépendances de
développement.

### 2.2 Dépendances de développement (racine)

`@astrojs/check`, `@cloudflare/workers-types`, `@tailwindcss/vite`,
`@types/markdown-it`, `miniflare`, `tailwindcss`, `typescript`, `vitest`,
`wrangler`. Une seule surcharge est déclarée : `miniflare` → `undici@^7.29.0`.

### 2.3 Politique de mise à jour

- Dependabot est actif (`.github/dependabot.yml`) ;
- les lockfiles racine et `mcp/` sont versionnés et jamais régénérés à la main ;
- aucune dépendance n'est ajoutée sans décision explicite : chaque paquet est
  du code à supporter sur toute la flotte, pendant toute la durée des contrats ;
- une dépendance ajoutée à la racine ne doit jamais être une dépendance du
  Worker MCP, et réciproquement.

## 3. Fonctionnalités héritées

Statuts : **inclus** (certifié et vendu), **désactivé** (présent, coupé par
défaut, activable hors offre standard), **hors périmètre** (présent, ni activé
ni certifié — voir ADR 0007).

### 3.1 Commerce

| Fonctionnalité | Emplacement | Statut |
|---|---|---|
| Catalogue produits, variantes, stock | `src/features/products` | inclus |
| Catégories | `src/features/categories` | inclus |
| Recherche plein texte FTS5 | `src/features/search` (provider `fts`) | inclus |
| Recherche sémantique (Workers AI + Vectorize) | `src/features/search` (provider `vector`) | hors périmètre |
| Panier et checkout invité | `src/features/cart`, `src/pages/checkout` | inclus |
| Commandes payées, numérotation, réservations de stock | `src/features/orders` | inclus |
| Livraison par zones (fixe, poids, franco) | `src/features/shipping` | inclus |
| Remboursements | `src/features/refunds` | inclus |
| Comptes clients (magic link) | `src/features/auth/customer` | désactivé (`features.accounts`) |
| Produits numériques et livraison de fichiers | `src/features/digitalDelivery` | hors périmètre |

### 3.2 Paiement

| Rail | Emplacement | Statut |
|---|---|---|
| Stripe Checkout | `src/features/payments/stripe.ts` | inclus |
| Codes promotionnels Stripe | Stripe Checkout | inclus |
| Lightning (phoenixd, LNbits) | `src/features/payments/lightning` | hors périmètre |
| OpenNode | `src/features/payments/opennode.ts` | hors périmètre |

Le cœur (`checkout`, `webhook`, shipping) dépend du port `PaymentProvider` et
jamais d'un SDK : retirer un rail de l'offre ne demande aucune modification du
cœur.

### 3.3 Contenu et administration

| Fonctionnalité | Emplacement | Statut |
|---|---|---|
| Pages éditoriales et légales (Markdown) | `src/features/pages` | inclus |
| Médias R2, propriété unique des fichiers | `src/features/media`, `src/features/storage` | inclus |
| Navigation et menus | `src/features/navigation` | inclus |
| Thèmes (`default`, `market`, `studio`) | `src/themes` | inclus (thème client dérivé au jalon 5) |
| Administration (CRUD, réglages, coffre de secrets) | `src/pages/admin`, `src/features/settings`, `src/features/secrets` | inclus |
| Authentification admin (session, Cloudflare Access, Turnstile) | `src/features/auth` | inclus |
| E-mails transactionnels (Resend, Cloudflare) | `src/features/email` | inclus |
| API catalogue publique (`/api/products`), `sitemap.xml`, `llms.txt` | `src/pages` | inclus |
| Serveur MCP (boutique pilotée par agent) | `mcp/` | hors périmètre |

### 3.4 Volumétrie du socle

| Élément | Quantité |
|---|---|
| Fichiers `.ts` / `.astro` sous `src/` | 309 |
| Routes (`src/pages`) | 73 |
| Migrations D1 publiées | 40 (`0001` → `0039`) |
| Suites de tests unitaires colocalisées | 73 |
| Thèmes livrés | 3 |

## 4. Écarts connus à traiter dans les jalons suivants

- aucun manifeste client : la configuration est build-time et mono-boutique
  (`src/store.config.ts`) — jalon 1 ;
- aucune séparation formelle cœur / client / généré, donc aucun contrôle de
  propriété des chemins en CI — jalon 1 ;
- aucune CLI de flotte : provisioning, sauvegarde et mise à jour sont manuels
  (`scripts/provision-cf.sh`, `scripts/deploy.mjs`) — jalons 2, 6 et 9 ;
- socle non localisé : les libellés storefront et admin sont en anglais et le
  périmètre TVA/facturation française n'est pas couvert — jalon 3 ;
- sauvegarde applicative absente : seul le Time Travel D1 existe — jalon 8.
