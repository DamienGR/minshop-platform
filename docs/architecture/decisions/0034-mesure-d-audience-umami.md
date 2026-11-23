# ADR 0034 — La mesure d'audience par Umami, réglée dans l'administration

- **Statut** : Accepté (fusion de la PR #266 par Damien, le 2026-11-23)
- **Date** : 2026-11-23
- **Jalon** : après le pilote (plan §13.33) ; aucun des jalons 0 à 10
- **Précise** : l'invariant 1 d'`AGENTS.md` (vitrine presque sans
  JavaScript), qui ne change pas

## Contexte

Damien demande le 2026-11-23 de pouvoir brancher Umami sur les boutiques :
savoir combien de visiteurs une boutique reçoit, sur quelles pages, et d'où ils
viennent. Umami est un outil de mesure d'audience libre, servi par Umami Cloud
ou par un serveur qu'on héberge. Son traceur est un script d'environ 3 Kio qui
ne dépose aucun cookie et envoie chaque page vue au serveur d'où il vient.

Ce que le socle savait (v0.13.1) :

- aucune boutique ne mesure son audience. Le brouillon de politique de
  confidentialité de la migration 0040 dit que les cookies de la boutique ne
  servent pas à la mesure d'audience ;
- la CSP fixe `object-src`, `base-uri` et `frame-ancestors`, rien d'autre
  (`src/features/http/securityHeaders.ts`) : un script tiers se charge sans
  changer d'en-tête ;
- deux pages ont une adresse qui ouvre une commande, `/order/<jeton>` et
  `/pay/<id>`, et la gardent des autres sites par `Referrer-Policy:
  no-referrer` ;
- le gabarit de la vitrine (`Layout.astro`) dessine aussi `/admin/login`,
  `/admin/token` et l'aperçu d'une page ;
- les pages de la vitrine sont partagées en cache à l'arête
  (`features/cache/public.ts`) : leur HTML est le même pour tous, l'admin
  compris ;
- la carte d'un lieu (ADR 0029) relaie ses tuiles pour que le navigateur ne
  parle qu'à la boutique.

## Décision

**Un réglage par boutique, dans Admin → Réglages → Mesure d'audience** :
l'adresse du script et l'identifiant du site, les deux ou aucun. Le marchand
(ou l'agence, par son jeton) peut coller le code de suivi entier d'Umami dans
le premier champ : la boutique en lit les deux valeurs et ne garde qu'elles,
jamais la balise. Deux lignes de `settings` (`umami_script_url`,
`umami_website_id`), sans migration. Éteint par défaut : une mise à niveau du
socle n'ajoute de script à aucune boutique. Le réglage vaut pour Umami Cloud
comme pour un serveur de l'agence : seule l'adresse change.

**Le navigateur charge le script directement depuis le serveur d'Umami**, en
`defer`, dans le `<head>` de la vitrine : la page ne l'attend jamais, et une
page dont le script est bloqué fonctionne pareil. Pas de relais par le Worker
(voir les alternatives) : choix de Damien, le 2026-11-23.

**Ce qu'Umami reçoit est décidé par le socle, pas par le marchand**
(`src/features/audience/umami.ts`, `beforeSend.ts`, `UmamiTracker.astro`) :

- aucune page sous `/admin` ;
- aucune page qui a posé `Referrer-Policy: no-referrer` : celles dont
  l'adresse donne accès à une commande. La règle lit l'en-tête que la page a
  posé avant le gabarit, et non une liste de routes, pour qu'une future page à
  jeton qui le pose soit couverte sans qu'on y pense ;
- l'adresse de la page sans ses paramètres ni son fragment
  (`data-exclude-search`, `data-exclude-hash`), sauf les paramètres de
  campagne `utm_*`, que la fonction `data-before-send` remet. Un serveur
  antérieur à Umami 2.18 ignore cette fonction et reçoit le chemin seul :
  moins, jamais plus ;
- rien d'un navigateur qui demande à ne pas être suivi
  (`data-do-not-track`) ;
- rien d'un navigateur qui porte l'indice `admin_hint` (ticket #178) : les
  visites du marchand ne sont pas son audience. L'indice n'est jamais une
  autorité, et n'a pas à l'être : le falsifier ne fait que sortir un visiteur
  du compte. La décision se prend dans le navigateur, parce que le HTML est
  partagé en cache ;
- seulement l'hôte public de la boutique (`data-domains`, d'après
  `CANONICAL_ORIGIN`) : un aperçu sur `workers.dev` ne compte rien.

**L'hébergement d'Umami n'est pas l'affaire du socle.** Umami Cloud ou un
serveur de l'agence, sa localisation (ADR 0004) et son contrat se jugent là où
on le choisit. Le guide demande au marchand de nommer Umami dans sa politique
de confidentialité, parmi les destinataires, pour la mesure d'audience.

## Conséquences

- une boutique qui mesure charge un script de plus, différé, d'un autre
  domaine : Lighthouse le compte parmi les ressources tierces. Les mesures de
  la certification (étape 6) portent sur une boutique qui ne mesure pas ;
- l'adresse IP et le navigateur du visiteur parviennent au serveur d'Umami,
  qui en tire un identifiant de visite sans cookie. Le marchand le dit dans sa
  politique de confidentialité ; la question du consentement se pose comme
  pour tout outil de mesure, et le socle ne la tranche pas pour lui ;
- un bloqueur de publicité masque une partie des visites : c'est le prix du
  chargement direct ;
- le jour où la CSP fixera `script-src` et `connect-src` (dérogation du plan
  de certification, §6), l'origine du script devra y entrer, lue du même
  réglage ;
- l'invariant 1 tient : la vitrine marche sans ce script, et il n'est là que
  quand la boutique l'a demandé.

## Alternatives écartées

- **Relayer le script et les envois par le Worker** (`/stats/*`) : le
  navigateur ne parlerait qu'à la boutique, comme pour la carte (ADR 0029), et
  les bloqueurs ne verraient rien. Mais chaque page vue coûterait une requête
  Worker de plus, sur un plan gratuit plafonné à 100 000 par jour, et Umami a
  besoin de l'adresse du visiteur pour compter les visites : le relais devrait
  la lui transmettre dans un en-tête, ce qui garde la donnée et ajoute un
  maillon à maintenir. Écarté par Damien le 2026-11-23.
- **Le réglage dans le manifeste ou `store.config.ts`** : demanderait un
  déploiement pour allumer, changer ou couper la mesure, et le réglage n'est
  pas un secret. L'admin est la surface des réglages d'exécution, comme la clé
  de site de Turnstile.
- **Un champ libre pour « n'importe quel script de mesure »** : ferait de
  l'admin une porte d'injection de code dans la vitrine, ce que l'invariant 11
  refuse pour les pages. Un outil nommé, des attributs fixés par le socle.
- **Plausible, Matomo ou Google Analytics** : non demandés. Google Analytics
  pose des cookies et demande un bandeau de consentement.

## Vérification

- `src/features/audience/umami.test.ts` : validation des deux valeurs, code de
  suivi collé entier, réglage incomplet refusé, pages exclues (admin,
  `no-referrer`), hôte public ;
- `src/features/audience/beforeSend.test.ts` : paramètres de campagne seuls,
  visites de l'admin écartées ;
- `test/integration/audience.mjs` : le Worker construit dessine le traceur sur
  la vitrine quand la boutique mesure, et ni sur `/admin/login`, ni sur une
  page de commande, ni quand elle ne mesure pas.
