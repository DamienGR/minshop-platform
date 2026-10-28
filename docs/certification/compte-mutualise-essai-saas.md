# Compte mutualisé — essai réel de Cloudflare for SaaS (lot 3 de l'ADR 0019)

Fiche de passage pour le poste de Damien, sur son feu vert du 2026-10-28.
L'[ADR 0019](../architecture/decisions/0019-compte-cloudflare-mutualise.md)
demande qu'« une route par nom d'hôte vers des Workers distincts » soit prouvée
par un essai réel avant qu'une boutique n'en dépende : c'est cet essai. Il
précède le lot 8, la migration de `pilote-certif` vers le compte mutualisé.
Travail d'après le pilote (plan §13.1), hors des jalons 0 à 10.

Ce que l'essai prouve, avec le code qu'emprunte une boutique
(`shopctl/src/saas.mjs` et la route que rend `scripts/manifest.mjs`), par le
script `scripts/saas-trial.mjs` :

1. deux noms d'hôte personnalisés d'une même zone SaaS, servis chacun par **son**
   Worker, le chemin transmis tel quel ;
2. leur certificat émis par **validation HTTP**, sans autre geste que le CNAME ;
3. un CNAME posé dans une zone Cloudflare **d'un autre compte**, en DNS seul
   (miijot.fr, sur B) : c'est le cas du pilote pendant le lot 8 et celui de la
   sortie d'un client ;
4. un nom de la zone **sans route** (l'origine de repli elle-même) n'atteint
   aucun Worker, et `workers.dev` reste fermé.

Le script est répété en doublure par `test/scripts/saas-trial.test.mjs`, dans
`npm run verify` : la doublure de l'API du dépôt
(`test/fixtures/cloudflare-api-double.mjs`), un wrangler qui consigne ce qu'il
déploierait, et un réseau qui route chaque nom d'après les routes déployées et
y exécute le Worker téléversé. Elle couvre la création idempotente, l'attente
du DNS (code 4), l'essai vert, un Worker inversé (code 6) et le nettoyage
rejoué ; le Worker d'essai a aussi tourné sous le vrai wrangler
(`deploy --dry-run`, `dev`) le 2026-10-28. Elle ne peut pas répondre à ce que
l'essai demande : que Cloudflare route un nom d'hôte personnalisé par une
route de la zone SaaS, et en émette le certificat.

Pour la rejouer sur le poste, sans aucun compte :
`npx vitest run test/scripts/saas-trial.test.mjs`.

## Ce que l'essai crée, et ce qu'il ne touche pas

| Où | Ce qui est créé |
|---|---|
| Compte mutualisé (neuf) | le compte, sa zone SaaS, l'enregistrement `fallback`, l'origine de repli, le jeton de déploiement ; deux Workers `minshop-essai-a` et `minshop-essai-b` sans base, bucket, cron ni secret ; deux noms d'hôte personnalisés |
| Compte B | deux CNAME `essai-a` et `essai-b` dans la zone miijot.fr, en DNS seul |

Rien d'autre : la production du pilote (`certif-minshop.miijot.fr`, sur B) et
le compte A ne sont pas touchés. Coût : 0 € (Workers Free ; Cloudflare for SaaS
inclut 100 noms d'hôte), plus le domaine de la zone SaaS s'il faut l'acheter.
Le compte, la zone, l'origine de repli et le jeton restent : ce sont ceux du
lot 8 et des boutiques suivantes.

## 1. Dans le tableau de bord, une fois pour toutes

1. **Le compte mutualisé.** Une inscription neuve avec une adresse dédiée de
   l'agence, comme B à l'étape 2. Sur cet utilisateur, le seul Super
   Administrator du compte : une clé de sécurité matérielle. Personne d'autre
   n'est membre, aucun commerçant : tout passe ensuite par des jetons. Plan
   Workers Free (« Free d'abord, Paid au signal »). Ouvrir **Workers & Pages**
   une fois (le sous-domaine workers.dev, sans lequel le cron d'une boutique est
   refusé) et activer **R2** : l'essai n'en a pas besoin, le lot 8 si. Relever
   l'identifiant du compte (premier segment de l'URL du tableau de bord).
2. **La zone SaaS.** Un domaine de l'agence réservé à cet usage. Il
   n'apparaît jamais aux visiteurs, seulement en cible des CNAME des
   commerçants, mais il est dans chacun d'eux : en changer plus tard fait
   changer leur CNAME à tous. Pas studiomaestro.fr, qui est sur A et ne peut pas
   être sur deux comptes. Le plus simple : l'acheter par Cloudflare Registrar
   depuis le compte mutualisé, la zone y naît active. Sinon : Add a domain →
   Free → serveurs de noms changés chez le registrar → attendre « Active ».
3. **L'origine de repli.** Dans la zone SaaS, DNS → Add record : type `AAAA`,
   nom `fallback`, contenu `100::`, **Proxied** (nuage orange). Puis SSL/TLS →
   Custom Hostnames → activer Cloudflare for SaaS (le tableau de bord peut
   demander un moyen de paiement, comme pour R2) → Fallback Origin :
   `fallback.<zone SaaS>` → attendre « Active ».
4. **Le jeton de déploiement du compte.** Mon profil → API Tokens → Create
   Token, modèle « Edit Cloudflare Workers », puis compléter jusqu'à :
   - compte : Workers Scripts, D1, Workers R2 Storage, Workers KV Storage en
     écriture ; Account Settings et Account Analytics en lecture ;
   - zone : Workers Routes en écriture, Zone en lecture, **SSL and Certificates**
     en écriture ;
   - utilisateur : Memberships et User Details en lecture ;
   - *Account Resources* : le compte mutualisé seul ; *Zone Resources* : la
     zone SaaS seule.

   C'est le jeton de production du dépôt de flotte (lot 8) : le créer une fois,
   le garder dans le gestionnaire de mots de passe, ne le coller nulle part
   ailleurs que dans la commande `read -rs` ci-dessous.
5. **Sur B, dans la zone miijot.fr** : deux CNAME, `essai-a` et `essai-b`, vers
   `fallback.<zone SaaS>`, **DNS only** (nuage gris). Avant ou après la
   section 2, indifféremment.

## 2. L'essai, depuis le poste (un quart d'heure)

Depuis la racine du clone de `minshop-platform`, à jour de `main`, sous
Node 22 (≥ 22.23.4) :

```sh
cd <clone de minshop-platform>
git switch main && git pull && npm ci
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN   # le jeton du §1.4, collé sans écho
export CLOUDFLARE_ACCOUNT_ID=<id du compte mutualisé>
node scripts/saas-trial.mjs prepare --zone <zone SaaS> --domain miijot.fr
node scripts/saas-trial.mjs verify --zone <zone SaaS> --domain miijot.fr
```

`prepare` crée les deux noms d'hôte, déploie les deux Workers avec leur
route, et rappelle les deux CNAME. Il se relance sans dommage. `verify`
répond « en attente » (code 4) tant qu'un nom d'hôte ou son certificat n'est
pas actif : le relancer toutes les quelques minutes. Puis il lit chaque nom en
HTTPS, comme un visiteur, et finit par « Essai vert » (code 0) ou « Essai
rouge » (code 6).

Ce qu'un rouge voudrait dire :

- **`wrangler deploy` refuse la route** (code 5) : la route d'un nom d'hôte
  personnalisé ne se pose pas comme le rend le socle. Le repli de l'ADR est
  alors la zone du commerçant sur le compte mutualisé ;
- **un nom répond par l'autre Worker, ou le nom sans route atteint un Worker**
  (code 6) : le routage par nom d'hôte ne sépare pas les boutiques. Rien
  ne part en production sur ce modèle ;
- **un nom reste « pending » plus de trente minutes** : les erreurs que
  `verify` affiche sous lui le disent. Le plus souvent, le CNAME manque ou
  vise un autre nom que l'origine de repli, ou un enregistrement CAA de
  miijot.fr exclut les autorités de certification de Cloudflare.

Dans tous les cas, la sortie de `verify` se transmet telle quelle : elle ne
porte que des noms, des statuts et des identifiants, aucun secret.

## 3. Après l'essai

```sh
node scripts/saas-trial.mjs clean --zone <zone SaaS> --domain miijot.fr
```

supprime les deux Workers puis les deux noms d'hôte. Restent à la main les deux
CNAME de miijot.fr sur B. Le résultat entre dans l'ADR 0019 (Vérification),
le plan §13.1 et les notes de version, par une pull request du socle.

## Ce qui suit : le lot 8

La migration du pilote suit la [sortie client, §1 bis](../operations/sortie-client.md)
à l'envers ; sa fiche vient une fois l'essai vert. Trois points à préparer
d'ici là :

- **le dépôt de flotte** : un dépôt GitHub de l'agence, public (GitHub Free
  n'a de secrets d'environnement que sur un dépôt public), créé par
  `shopctl fleet init` puis `fleet repo`. Il porte les jetons du compte, la clé
  de sauvegarde, et deux autres jetons à créer comme au §1.4 : la sauvegarde
  nocturne et la lecture pour `monitor` (droits : [comptes et accès,
  §4](comptes-et-acces.md)) ;
- **le domaine d'images du pilote** (`images-certif-minshop.miijot.fr`) ne peut
  pas suivre : le domaine personnalisé d'un bucket R2 doit être dans une zone du
  compte du bucket. Soit les images passent par le Worker (aucun domaine, mais
  des requêtes de plus sur le quota quotidien partagé du plan Free), soit un nom
  de la zone SaaS (`images-certif-minshop.<zone SaaS>`), que la fiche du
  lot 8 retiendra ;
- **un widget Turnstile** sur le compte mutualisé, pour le lot de dix noms
  d'hôte dont `certif-minshop.miijot.fr` sera le premier.
