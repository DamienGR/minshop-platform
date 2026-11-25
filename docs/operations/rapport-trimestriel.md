# Procédure — le rapport trimestriel au commerçant

Chaque trimestre, l'agence envoie au commerçant un bilan de sa boutique : ses
ventes, ce qui a changé sur la boutique, sa place dans Google et ses visiteurs
(ADR 0035). Le workflow « Quarterly report » du dépôt de flotte le prépare le 5
janvier, avril, juillet et octobre, dans une issue du dépôt de chaque boutique ;
l'agence le relit et l'envoie elle-même. Rien ne part au commerçant sans elle.

Trois règles valent pour tous :

- **le rapport ne va que dans le dépôt de la boutique, privé.** Il dit les
  ventes. `shopctl report` refuse un dépôt public ou sans issues avant de rien
  lire ; le dépôt de flotte, public, n'en voit que le résumé (trimestre, issue,
  sources en échec) ;
- **une source muette n'arrête pas le rapport.** Elle est dite dans sa section,
  en encadré, et dans le résumé du run ; le rapport sort avec les autres. On
  la répare, puis on relance la boutique (§ 4) ;
- **les corrections vont dans le courriel, pas dans l'issue.** Un run relancé
  réécrit l'issue entière, fermée ou non.

## 1. Mettre en place la flotte (une fois)

Prérequis : un socle v0.13.4 ou plus récent dans l'espace de travail de la
flotte (en v0.13.3, le workflow prend aussi les boutiques sans `reportSince`).
Les boutiques, elles, peuvent être en v0.13.3.

1. **Le jeton de publication.** GitHub → Settings → Developer settings →
   Fine-grained tokens → Generate new token : propriétaire des dépôts de
   boutique, « Only select repositories » (les dépôts des boutiques), permission
   **Issues : Read and write**, rien d'autre. Un jeton fin ne vaut que pour un
   propriétaire. Noter sa date d'expiration dans l'agenda de l'agence ;
2. **Le compte de service Google** (facultatif, pour le référencement) : un
   projet Google Cloud de l'agence, l'API « Google Search Console API »
   activée, un compte de service, puis Clés → Ajouter une clé → JSON. Garder
   son adresse (`…@….iam.gserviceaccount.com`) : chaque boutique l'ajoute à sa
   propriété (§ 2) ;
3. **La clé Umami** (facultative, pour la fréquentation) : Umami Cloud →
   Settings → API keys, ou la page des clés d'API d'un serveur de l'agence
   (`UMAMI_API_KEY` ; le rapport l'envoie à Umami Cloud dans son en-tête
   `x-umami-api-key`, à un serveur de l'agence en `Authorization: Bearer`,
   depuis v0.13.5). Sur un serveur sans clés d'API, un compte sans double
   authentification (`UMAMI_USERNAME`, `UMAMI_PASSWORD`). De préférence un
   compte à part, en lecture seule, membre d'une équipe qui détient les sites
   des boutiques : la clé ou le compte doit voir ces sites ;
4. **Les workflows et les secrets**, depuis le dépôt de flotte :

   ```sh
   npm run shopctl -- fleet init          # écrit aussi .github/workflows/report.yml
   git add -A && git commit -m "Flotte : rapport trimestriel" && git push
   export CLOUDFLARE_API_TOKEN_MONITOR=…  REPORT_ISSUES_TOKEN=…
   export GSC_SERVICE_ACCOUNT_JSON="$(cat cle-compte-de-service.json)"  UMAMI_API_KEY=…
   npm run shopctl -- fleet repo --reviewer <login>   # avec les jetons habituels
   ```

   `fleet repo` crée l'environnement `report`, limité à la branche par défaut,
   et y pose le jeton de surveillance (pour lire les ventes),
   `REPORT_ISSUES_TOKEN` et les clés exportées. Il prévient quand
   `REPORT_ISSUES_TOKEN` manque, et dit les sources qui resteront non
   raccordées. Supprimer ensuite le fichier de clé Google du poste.

## 2. Ajouter une boutique au rapport

1. **Socle** : la boutique est en v0.13.3 au moins (`shopctl core upgrade`) ;
   en dessous, le run la refuse ;
2. **Dépôt** : privé, issues actives.

   ```sh
   gh repo view <propriétaire/dépôt> --json visibility,hasIssuesEnabled
   gh repo edit <propriétaire/dépôt> --enable-issues   # shopctl repo les crée sans
   ```

   Le jeton de publication doit couvrir ce dépôt (Settings → Fine-grained
   tokens → le jeton → Repository access) ;
3. **Google** : une propriété Search Console pour le domaine de production, de
   préférence de type **Domaine** (un enregistrement TXT chez le registraire du
   commerçant ; aucune balise dans la boutique). Paramètres → Utilisateurs et
   autorisations → Ajouter un utilisateur : l'adresse du compte de service,
   autorisation **Restreint** ;
4. **Umami** : la boutique mesure son audience (Admin → Réglages → Mesure
   d'audience) avec un site que la clé de l'agence voit ;
5. **Début du suivi** : la date de mise en production dans `fleet.json`,
   `"reportSince": "AAAA-MM-JJ"`, puis commit et push du dépôt de flotte. Sans
   cette ligne, la boutique n'a pas de rapport (une boutique de certification
   ou de démonstration n'en a jamais). Rien d'antérieur n'est rapporté, et le
   trimestre de lancement n'est comparé à rien ;
6. **Aperçu** : Actions → Quarterly report → Run workflow, période
   `current-quarter`, la boutique par son slug. L'issue « Rapport trimestriel —
   <trimestre> » s'ouvre dans le dépôt de la boutique ; le rapport final la
   réécrira.

## 3. Chaque trimestre

1. Le 5, le run part seul à 06:17 UTC (souvent plus tard : GitHub retarde les
   crons). Un job par boutique, qui porte son slug ; un job rouge n'arrête pas
   les autres ;
2. ouvrir l'issue de chaque boutique. Les encadrés « n'a pas répondu » sont
   les sources à réparer (§ 5) ; les lignes « hors du message » sont les pull
   requests sans phrase pour le commerçant : en écrire une dans le courriel si
   elle compte ;
3. copier l'objet proposé et le message de la fin de l'issue dans un courriel,
   le relire, le corriger, l'envoyer au commerçant ;
4. fermer l'issue : le rapport est parti.

Pour qu'une pull request de la boutique parle au commerçant d'elle-même, son
dernier commit (ou son message de fusion) porte une ligne :

```text
Pour le client : La page Livraison dit maintenant les délais par transporteur.
```

`Pour le client : -` l'écarte du message (un changement d'outillage, par
exemple).

## 4. Relancer une boutique

Actions → Quarterly report → Run workflow, période `previous-quarter`, la
boutique par son slug. L'issue du trimestre est réécrite, fermée ou non.

En local, depuis l'arbre de la boutique, le rapport s'écrit sans être publié :

```sh
CLOUDFLARE_API_TOKEN=… npm run shopctl -- report --env production --out /tmp/rapport
```

`--quarter 2026-T4` choisit un trimestre terminé, `--current` l'aperçu du
trimestre en cours, `--since` le début du suivi. `/tmp/rapport/rapport.md` dit
les ventes : le supprimer une fois lu.

## 5. Ce qui peut mal tourner

| Message | Cause | Remède |
|---|---|---|
| `… n'est pas privé (public)` (code 4) | le dépôt de la boutique est public | le rendre privé, ou faire le rapport en local (§ 4) et l'envoyer sans issue |
| `les issues de … sont désactivées` (code 4) | dépôt créé par `shopctl repo` | `gh repo edit <dépôt> --enable-issues` |
| `REPORT_ISSUES_TOKEN absent de l'environnement report` | jeton jamais posé | § 1, étapes 1 et 4 |
| `gh … exited with status 1` à la publication (code 5) | jeton expiré, ou qui ne couvre pas ce dépôt | régénérer le jeton ou ajouter le dépôt, puis relancer `fleet repo` |
| ventes : `wrangler d1 execute …` | jeton de surveillance refusé ou expiré | un nouveau `CLOUDFLARE_API_TOKEN_MONITOR`, puis `fleet repo` |
| référencement : `aucune propriété Search Console accessible…` | le compte de service n'est pas utilisateur de la propriété | § 2, étape 3 |
| référencement : `Search Console, propriétés : 403` | API non activée dans le projet Google Cloud | l'activer, § 1, étape 2 |
| référencement : `Google refuse le jeton du compte de service` | clé supprimée ou désactivée | nouvelle clé, puis `fleet repo` |
| fréquentation : `Umami ne connaît pas le site …` | identifiant faux dans les réglages | Admin → Réglages → Mesure d'audience |
| fréquentation : `Umami, … : 401` ou `403` | clé révoquée, ou compte qui ne voit pas le site ; sur un serveur de l'agence, une boutique sous v0.13.5 (la clé, envoyée comme à Umami Cloud, n'est jamais marquée utilisée) | nouvelle clé, ou partager le site ; ou monter la boutique |
| `… se termine avant le début du suivi` (code 3) | trimestre antérieur à `reportSince` | rien à rapporter : normal pour une boutique toute neuve |
| la boutique est refusée avant `npm ci` | socle sous v0.13.3 | monter la boutique |

## 6. Quand une boutique s'en va

Avec la [procédure de sortie](sortie-client.md) : retirer le compte de service
de sa propriété Search Console, son site du compte Umami de l'agence (ou le lui
transférer), sa ligne de `fleet.json`, et son dépôt du jeton de publication.
Ses issues de rapport restent dans son dépôt, qu'elle emporte.
