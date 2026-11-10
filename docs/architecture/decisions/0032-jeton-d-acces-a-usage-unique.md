# ADR 0032 — Un jeton à usage unique pour l'accès de l'agence à l'administration

- **Statut** : Proposé
- **Date** : 2026-11-10
- **Jalon** : après le pilote (plan §13.22, ticket #227) ; aucun des jalons 0
  à 10
- **Amende** : la règle de `shopctl` « un secret que la CLI génère n'est
  jamais rendu » (`AGENTS.md`, `docs/agents/shopctl.md`), pour une valeur et
  une seule
- **Précise** : l'invariant 5 d'`AGENTS.md` (l'administration fermée par
  défaut), qui ne change pas

## Contexte

Une boutique remise au commerçant a un seul mot de passe d'administration
(v0.8.3). C'est un haché PBKDF2 dans le réglage `admin_password_hash`, sans
identifiant ni second compte. La session est signée avec `AUTH_SECRET` et liée
à ce haché : changer le mot de passe ferme toutes les sessions, et le
commerçant peut le changer sur `/admin/setup` une fois connecté.

L'agence a besoin d'entrer dans l'administration après la remise, pour le
support, la maintenance ou une recette. Le ticket #227 (2026-11-10) constate
qu'elle n'a qu'un recours. `shopctl admin password` **remplace** le mot de passe
(runbook du mot de passe perdu) : le commerçant perd ses sessions et doit en
recevoir un nouveau. Les autres portes sont fermées. `AUTH_SECRET` est tiré par
`provision`, passé à wrangler et jamais conservé : personne ne peut signer une
session. Cloudflare Access n'est rendu que sur le staging (ADR 0015), et le
mot de passe passe avant lui dans `src/middleware.ts`.

Celui qui tient le compte Cloudflare de la boutique peut déjà tout : lire et
écrire sa base, remplacer le mot de passe. Il ne lui manque qu'une manière
d'entrer qui ne dérange pas le commerçant.

## Décision

**Un jeton à usage unique, créé par `shopctl admin token --env <env>`.** La
commande tire 32 octets aléatoires (43 caractères base64url) avec le module du
Worker (`src/features/auth/adminToken.ts`, importé par un Node enfant comme le
hachage du mot de passe). Elle écrit leur empreinte SHA-256 dans
`admin_access_tokens` (migration 0058, additive), avec une échéance à
**15 minutes**, datée par l'horloge de la base. Elle relit la ligne, puis
affiche le jeton **une fois**. Une empreinte suffit, sans dérivation lente :
256 bits tirés au hasard ne se devinent pas, contrairement à un mot de passe.

**Le jeton se colle sur `/admin/token`**, un formulaire POST, la seconde page de
l'administration joignable sans session après `/admin/login`. Le jeton n'est
jamais dans une URL : rien dans les journaux d'accès, l'historique ou un
en-tête `Referer`. Sans mot de passe, la page renvoie à l'assistant comme
`/admin/login` : un jeton n'y ouvrirait rien, et `shopctl` refuse alors de le
créer (code 4).

**Il sert une fois, en une seule requête** : `UPDATE … SET used_at = ? WHERE
digest = ? AND used_at IS NULL AND expires_at > ?`, accepté quand une ligne a
changé. Deux envois simultanés d'un même jeton n'ouvrent qu'une session. Un
jeton inconnu, déjà servi, échu ou mal formé reçoit la même réponse.

**Il ouvre une session ordinaire, de 8 heures** : le cookie `admin_session` de
`/admin/login`, signé de même et lié au mot de passe courant, sans les 7 jours.
Le mot de passe et les sessions du commerçant ne changent pas. Quand le
commerçant change son mot de passe, la session ouverte par le jeton tombe avec
les autres.

**Le jeton partage la porte de la connexion** : le seau `auth` du limiteur de
bordure et le compteur exact de `loginThrottle.ts`, avec la même clé. Un
deviné échoué sur l'une des deux pages compte pour l'autre, et une fois le
budget épuisé, ni le bon mot de passe ni un jeton valable n'ouvrent. Turnstile
s'y applique comme à la connexion, avant que le jeton ne soit consommé. Une
valeur qui ne peut pas être un jeton (vide, mal formée) est refusée sans être
comptée ni lue en base : elle ne devine rien, et la porte de sécurité distante,
qui poste un formulaire vide sur chaque route, n'entame pas le budget dont son
contrôle du compteur a besoin.

**Le commerçant voit les passages de l'agence.** Une ligne servie reste dans la
table : c'est le registre. Admin → Réglages → **Accès de l'agence** affiche la
date du dernier accès, et le Worker écrit l'événement `admin_token_used`, sans
le jeton. Une ligne échue sans avoir servi part au prochain jeton servi ou
créé. Les responsabilités annexées au contrat (`docs/operations/responsabilites.md`)
mentionnent cet accès.

**L'exception à la règle de `shopctl`.** Un secret que la CLI génère va à
wrangler sur l'entrée standard et n'est jamais rendu. Le jeton est rendu, parce
que l'opérateur doit le coller. Ce qui le rend acceptable, c'est ce qu'il est :
un usage, quinze minutes, et rien en base qui permettrait de le rejouer. Il
passe par une seule méthode, `Reporter.reveal()` : le terminal, ou le champ
`token` du rapport `--json`. Jamais un argument, un journal ni un fichier.

## Conséquences

- l'agence entre sans demander le mot de passe et sans le changer. Le
  commerçant garde ses sessions, et la date du passage s'affiche dans ses
  Réglages ;
- l'accès ne donne rien de plus que le compte Cloudflare, qui pouvait déjà
  remplacer le mot de passe. Il suit le compte : une boutique partie sur un
  compte du commerçant (sortie client) n'est plus joignable par les jetons de
  l'agence ;
- une migration additive et une table de quelques lignes par an. Le compteur
  d'échecs et le limiteur sont ceux de la connexion, sans budget de plus ;
- une boutique doit être déployée sur ce socle avant le premier jeton :
  `shopctl` refuse une base sans la table (migration 0058) et un arbre sans le
  module ;
- la porte de sécurité, locale comme distante, connaît deux pages anonymes au
  lieu d'une.

## Alternatives écartées

- **Cloudflare Access en production**, avec l'e-mail de l'agence : une
  application Access par domaine, un jeton de service pour les contrôles
  distants, et 50 utilisateurs partagés par tout le compte mutualisé (ADR
  0019). Il fallait aussi faire passer Access avant le mot de passe dans le
  middleware. Plus lourd pour un besoin ponctuel.
- **Un second mot de passe, ou des comptes d'administrateurs** : une table
  d'utilisateurs, des rôles et un écran de gestion, pour un seul besoin. Un
  mot de passe durable de l'agence dans chaque boutique serait aussi un secret
  de plus à garder.
- **Le jeton dans un lien** (`/admin/token?t=…`) : plus simple à ouvrir, mais il
  finit dans l'historique, les journaux d'accès, un `Referer` et les
  prévisualisations de lien d'une messagerie.
- **Un cookie signé par la CLI** : il demande `AUTH_SECRET`, que personne ne
  garde, et le faire tourner déconnecterait le commerçant et casserait les liens
  magiques des comptes clients.
- **Le jeton haché par PBKDF2** : une lenteur qui ne protège que ce qui se
  devine. 256 bits ne se devinent pas, et la page refuse un format faux avant
  toute lecture.

## Vérification

- `src/features/auth/adminToken.test.ts` : le format, ce qu'un collage pardonne
  (espaces, retour à la ligne) et ce qu'il refuse, l'empreinte, les deux durées ;
- `test/scripts/admin.test.mjs` : `shopctl admin token` écrit l'empreinte pour
  15 minutes, rend le jeton une seule fois et jamais en argument, laisse le
  mot de passe, purge les jetons échus non servis et garde les servis, refuse
  une administration sans mot de passe, une base sans la table et un arbre sans
  le module, n'écrit rien sous `--dry-run` ;
- `test/integration/security.mjs`, section « Jeton à usage unique » : la
  session de 8 heures, le mot de passe et la session du commerçant intacts,
  l'empreinte en base, la date dans Réglages, l'événement sans le jeton dans
  les journaux. Elle couvre aussi les cinq refus, une valeur mal formée qui
  n'est pas comptée, deux envois simultanés pour une seule session, le budget
  partagé avec la connexion et la session fermée par un changement de mot de
  passe. La porte des routes anonymes et celle de
  l'origine des formulaires connaissent `/admin/token`.
