# ADR 0025 — Un formulaire de contact, envoyé sans être gardé

- **Statut** : Proposé
- **Date** : 2026-11-02
- **Jalon** : après le pilote (plan §13.7) ; aucun des jalons 0 à 10
- **Amende** : l'[ADR 0007](0007-perimetre-fonctionnel.md), qui range les
  « pages éditoriales et légales » dans l'offre sans parler de formulaire

## Contexte

Le ticket #147 (2026-11-02) demande une page de contact : le visiteur laisse son
nom, son e-mail, un téléphone facultatif, un motif pris dans une liste et son
message ; le marchand le reçoit par e-mail et y répond directement ; le
visiteur voit une confirmation ; la page fonctionne sans JavaScript
(invariant 1). Le besoin vient de la première boutique réelle, pour qui le
motif « Sur mesure » est la porte d'entrée des commandes sur mesure.

L'ADR 0007 ne range le formulaire ni dans le périmètre ni dehors. Le ticket
laisse quatre décisions : un ADR ou un avenant, stocker les messages ou
seulement les envoyer, la liste des motifs dans les réglages ou dans
`store.config.ts`, et les champs au-delà du minimum.

Ce que le socle savait (v0.3.36) :

- le corps d'une page est du Markdown avec `html: false` (invariant 11) : un
  formulaire ne peut pas y vivre ;
- le port `EmailProvider` n'avait pas de `replyTo` ;
- `email_notify_to` (à défaut `notifyTo` dans `store.config.ts`) reçoit les
  alertes de commande ;
- Turnstile protège `/admin/login` et `/account/login`, quand il est activé ;
- `rateLimitBucket()` connaît `auth`, `checkout` et `search` ;
- les menus de l'en-tête et du pied de page (migration 0028) lient cinq sortes
  de cibles — accueil, catalogue, page, produit, catégorie — et rien d'autre.
  La migration prévoyait un sixième type « plus tard », mais la colonne est
  bornée par un `CHECK` : l'élargir, c'est reconstruire la table, donc un
  `DROP TABLE`, que l'ADR 0006 et la porte de publication refusent ;
- un thème fournit six gabarits ; celui d'une boutique appartient à la
  boutique (`scripts/path-ownership.mjs`), et le socle ne le modifie jamais.

## Décision

**Un ADR, pas un avenant.** Un avenant est la réponse de l'ADR 0007 à la demande
d'un client qui sort de l'offre ; une page de contact est un besoin de toute
boutique B2C, et le socle le construit une fois pour toutes, comme les points
relais (ADR 0020), le texte libre (ADR 0022) et le virement (ADR 0023).

**Le message est envoyé, jamais gardé** (choix de Damien, 2026-11-02). Aucune
table, donc rien à exporter ni à effacer, et rien à classer dans
`shopctl/src/privacy/map.mjs`. Quand l'envoi échoue, la page revient avec le
texte du visiteur et le lui dit (503) : tant qu'il n'a pas quitté la page, rien
n'est perdu.

**Le formulaire se place sous une page publiée que le marchand choisit**, dans
Admin → Réglages → Formulaire de contact. Le texte de la page lui sert
d'introduction (horaires, adresse de l'atelier, délais), le gabarit
`ContentPage` du thème la cadre, la navigation y mène par une cible « page »
ordinaire, le plan du site et `llms.txt` la listent déjà. Le formulaire est
rendu sous la page, dans sa largeur, par un contrôle partagé
(`src/features/storefront/controls/ContactForm.astro`) que les jetons du thème
habillent. `/contact` est l'adresse imprimable : une redirection temporaire
(302) vers la page choisie, 404 quand il n'y en a pas.

**Les champs sont ceux du besoin** : nom, e-mail, téléphone facultatif, motif,
message. Ni profil particulier ou professionnel (le B2B avancé est hors
périmètre, ADR 0007), ni case « Recevoir des nouvelles » (l'automatisation
marketing aussi). Un champ trop long, un nom sur deux lignes, un motif hors de
la liste : refusés, jamais tronqués, avec un message par champ et le texte
rendu. Les limites, en caractères : 100 pour le nom, 254 pour l'e-mail, 30
pour le téléphone, 5 000 pour le message (`src/features/contact/form.ts`).

**Les motifs se règlent dans Admin → Réglages**, un par ligne, dix au plus,
60 caractères chacun, sans doublon. Vide, la liste par défaut du catalogue :
Renseignement, Commande, Devis, Réclamation, Autre. Pas dans
`store.config.ts` : changer un motif ne demande pas de déploiement.

**Le destinataire est un réglage du formulaire**, et à défaut celui des alertes
de commande. Le formulaire n'est affiché que si quelqu'un le recevrait : la page
publiée, l'e-mail activé et configuré, un destinataire. L'administration refuse
de choisir la page tant qu'il manque l'un des deux autres, et dit lequel.

**L'envoi passe par le port, qui gagne `replyTo`** : `reply_to` chez Resend,
`replyTo` sur la liaison `send_email` de Cloudflare (`EmailMessageBuilder` dans
les types de Workers). Le message part de l'expéditeur de la boutique, seul
domaine autorisé à envoyer, et « Répondre » écrit au visiteur. L'adresse est
nue, validée sur une ligne : jamais de nom d'affichage, qui serait un second
texte libre dans un en-tête. L'objet porte le motif en premier
(« Contact : Sur mesure (Claire Dubois) ») ; la partie HTML échappe tout ce que
le visiteur a écrit.

**L'anti-abus a quatre étages**, du moins cher au plus cher :

- le contrôle d'origine d'Astro (`formOrigin.ts`), inchangé : un POST venu
  d'ailleurs est refusé (403) ;
- une limite à l'arête, catégorie `contact` (`CONTACT_RATE_LIMITER`, espace
  10004) : cinq envois par minute et par client, sur `POST /pages/*`, qu'aucune
  autre page n'accepte ;
- un champ piège, `website`, caché hors de l'écran, hors de la tabulation et
  hors de l'arbre d'accessibilité : rempli, il reçoit la même confirmation
  qu'un envoi, et rien ne part ;
- Turnstile, quand il est activé dans les réglages, qui échoue fermé comme à la
  connexion.

**Après l'envoi, une redirection** (303) vers `/pages/<slug>?sent=1#contact` :
recharger la confirmation n'envoie rien une seconde fois. Une page refusée
répond 400 (un champ, le défi) ou 503 (l'envoi), en `private, no-store`,
puisqu'elle contient ce que le visiteur a tapé.

**Le journal ne porte que des événements** : `contact_sent`, `contact_trapped`,
`contact_send_failed` (l'erreur du prestataire passée par `logSafe`),
`contact_unavailable`. Jamais un champ (invariant 12).

## Conséquences

- aucune migration. Une liaison de plus dans `wrangler.template.jsonc` ; une
  configuration ancienne qui ne l'a pas encore laisse passer, comme pour les
  trois autres (la liaison est facultative au type) ;
- `contact` rejoint les slugs réservés du manifeste (`RESERVED_SLUGS`), comme
  toute route publique : aucune boutique ne peut plus le prendre ;
- le marchand met le formulaire en service en trois gestes : une page publiée,
  son choix dans Réglages, la page ajoutée au pied de page dans Navigation ;
- **chaque message compte dans le quota du prestataire d'e-mail** : 100 par
  jour au palier gratuit de Resend, partagés avec les e-mails de commande. La
  limite est par client, pas globale : une boutique visée par des robots venus
  de beaucoup d'adresses active Turnstile, sans quoi ils peuvent épuiser le
  quota du jour et retarder les confirmations de commande ;
- **avec Turnstile activé, le formulaire demande JavaScript**, comme la
  connexion ; la page le dit à un visiteur qui n'en a pas. Sans Turnstile, il
  fonctionne sans script ;
- la boutique ne garde rien, mais **le message existe ailleurs** : dans la
  boîte du marchand, et quelques jours dans les journaux du prestataire
  d'e-mail. La politique de confidentialité du marchand le dit (données
  traitées, destinataire, prestataire) ; c'est son texte, pas celui du socle ;
- un message dont l'envoi échoue et que le visiteur abandonne est perdu : le
  prix accepté de ne rien stocker ;
- le formulaire suit la page : dépubliée, il disparaît avec elle, et
  `/contact` répond 404. Réglages dit pourquoi il est hors service.

## Alternatives écartées

- **Stocker les messages en D1**, pour ne pas les perdre quand l'envoi échoue :
  une table de données personnelles à classer, à conserver un temps donné puis
  à effacer, et une boîte de réception à construire dans l'administration, pour
  un échec que le visiteur voit et peut rejouer. Écarté par Damien.
- **Une route `/contact` qui rend le formulaire elle-même** : le marchand ne
  pourrait y mener ni de l'en-tête ni du pied de page, les menus ne liant que
  des cibles de la base. Il lui faudrait une page dont le texte renvoie à
  `/contact`, soit deux clics et deux choses à tenir.
- **Un sixième type de cible de menu, `contact`** : élargir le `CHECK` de
  `menu_items` reconstruit la table (`DROP TABLE` puis renommage), que l'ADR
  0006 interdit dans une version et que `release.mjs` refuse ; le cycle en
  deux versions coûte une table neuve pour un lien.
- **Un gabarit `ContactPage` dans chaque thème, ou un emplacement dans
  `ContentPage`** : le thème d'une boutique est à elle ; un gabarit exigé
  casserait chaque thème à la mise à niveau, et un emplacement qu'un thème
  existant n'a pas ferait disparaître le formulaire sans erreur. Rendu sous la
  page, il est là quel que soit le thème.
- **Un lien « Contact » ajouté d'office au pied de page** : le mécanisme
  invisible que la migration 0028 a retiré, au profit de menus que le marchand
  ordonne.
- **Les motifs dans `store.config.ts`** : un déploiement pour changer un mot.
- **Un lien `mailto:`** : l'adresse du marchand offerte aux collecteurs, ni
  motif ni anti-robots, et rien pour le visiteur qui n'a pas de logiciel de
  messagerie configuré.

## Vérification

- `src/features/contact/form.test.ts` fixe les règles : champs requis, téléphone
  facultatif, motif de la liste, nom sur une ligne, refus plutôt que coupe,
  caractères comptés comme le visiteur les voit, piège, liste des motifs ;
- `src/features/contact/policy.test.ts` fixe les conditions d'affichage et
  l'ordre des destinataires ;
- `src/features/email/contactMessage.test.ts` fixe le destinataire, le
  `replyTo`, l'objet et l'échappement ; `src/features/email/adapters.test.ts`,
  le `replyTo` passé par Resend et par la liaison de Cloudflare ;
- `src/features/auth/rateLimit.test.ts` fixe la catégorie `contact` ;
- `test/storefront/contactForm.test.ts` rend le contrôle : noms de champs,
  piège, erreurs reliées à leur champ, texte échappé, confirmation ;
- `test/integration/contact.mjs`, sur le Worker construit : les refus de
  l'administration, la page et `/contact`, l'origine, les refus qui rendent le
  texte, le piège, l'envoi avec `reply_to`, le destinataire par défaut, l'échec
  du prestataire, Turnstile fermé, la limite à l'arête, et rien du visiteur
  dans les journaux ni dans la base ;
- `test/browser/contact.spec.mjs`, sans JavaScript : un vrai formulaire, un
  refus du serveur qui garde le texte ; la page de contact rejoint les routes
  de l'accessibilité et de la mise en page de la porte navigateur.
