-- French legal baseline: the four pages a B2C store selling in France has to
-- publish, and the consent the order has to carry.
--
-- The pages arrive as DRAFTS (published = 0). Their text is a skeleton with
-- explicit `[À COMPLÉTER]` markers — a company name, a SIREN, a mediator — that
-- only the merchant can fill in. Publishing them as they stand would put a
-- document naming nobody in front of customers, and a store that ships with
-- pre-published legal text invites exactly that. Drafts are invisible to the
-- storefront (the query filters on published), so they cost nothing until the
-- merchant finishes and publishes them from the admin.
--
-- INSERT OR IGNORE on the unique slug: a shop that already wrote its own CGV
-- under one of these slugs keeps it, and re-running the migration is a no-op.

ALTER TABLE orders ADD COLUMN terms_version TEXT;
ALTER TABLE orders ADD COLUMN terms_accepted_at TEXT;

-- The consent is given at checkout, but the order row is written at settlement,
-- minutes later and from another request. The reservation is the only row that
-- spans both, so it carries the acceptance across.
ALTER TABLE checkout_reservations ADD COLUMN terms_version TEXT;
ALTER TABLE checkout_reservations ADD COLUMN terms_accepted_at TEXT;

INSERT OR IGNORE INTO pages (title, slug, body_markdown, published) VALUES (
  'Conditions générales de vente',
  'conditions-generales-de-vente',
  '# Conditions générales de vente

> **Brouillon.** Ce texte est un squelette fourni avec la boutique. Complétez
> chaque `[À COMPLÉTER]`, faites relire le résultat par un conseil compétent,
> puis publiez la page. Tant qu''elle n''est pas publiée, la case d''acceptation
> n''apparaît pas au moment de commander.

## 1. Identité du vendeur

- Dénomination sociale : [À COMPLÉTER]
- Forme juridique et capital social : [À COMPLÉTER]
- Siège social : [À COMPLÉTER]
- SIREN / RCS : [À COMPLÉTER]
- Numéro de TVA intracommunautaire : [À COMPLÉTER]
- Adresse électronique de contact : [À COMPLÉTER]
- Téléphone : [À COMPLÉTER]

## 2. Objet et champ d''application

Les présentes conditions générales de vente régissent les ventes de produits
conclues sur ce site avec des consommateurs résidant en France. Elles sont
acceptées par le client avant la validation de sa commande.

## 3. Produits et disponibilité

Les produits proposés sont ceux figurant au catalogue au jour de la consultation,
dans la limite des stocks disponibles. Les photographies sont indicatives.

## 4. Prix

Les prix sont indiqués en euros, toutes taxes comprises, hors frais de
livraison. Les frais de livraison applicables sont affichés avant la validation
de la commande. Le vendeur se réserve le droit de modifier ses prix à tout
moment ; le prix applicable est celui affiché au moment de la commande.

## 5. Commande

La commande est validée après acceptation des présentes conditions et paiement.
Un courriel de confirmation récapitulant la commande est envoyé au client.

## 6. Paiement

Le paiement s''effectue au comptant à la commande, par les moyens proposés au
moment du règlement. La commande n''est enregistrée qu''après encaissement.

## 7. Livraison

Les délais et les zones de livraison sont indiqués avant la validation de la
commande. Délai de livraison indicatif : [À COMPLÉTER]. Le transfert des risques
intervient à la remise du colis au client.

## 8. Droit de rétractation

Conformément aux articles L. 221-18 et suivants du code de la consommation, le
client dispose d''un délai de quatorze (14) jours à compter de la réception des
produits pour exercer son droit de rétractation, sans avoir à motiver sa
décision. Les modalités et le formulaire type figurent sur la page
« Droit de rétractation ».

## 9. Garanties légales

Le vendeur reste tenu de la garantie légale de conformité (articles L. 217-3 et
suivants du code de la consommation) et de la garantie des vices cachés
(articles 1641 et suivants du code civil).

## 10. Données personnelles

Le traitement des données personnelles est décrit sur la page
« Politique de confidentialité ».

## 11. Réclamations et médiation

Réclamations : [À COMPLÉTER]. En cas de litige non résolu, le client peut
recourir gratuitement au médiateur de la consommation dont relève le vendeur :
[À COMPLÉTER — nom et coordonnées du médiateur].

## 12. Droit applicable

Les présentes conditions sont soumises au droit français.

---

Version : [À COMPLÉTER — reprendre `legal.termsVersion` de `store.config.ts`].
',
  0
);

INSERT OR IGNORE INTO pages (title, slug, body_markdown, published) VALUES (
  'Mentions légales',
  'mentions-legales',
  '# Mentions légales

> **Brouillon.** Complétez chaque `[À COMPLÉTER]` avant publication.

## Éditeur du site

- Dénomination sociale : [À COMPLÉTER]
- Forme juridique et capital social : [À COMPLÉTER]
- Siège social : [À COMPLÉTER]
- SIREN / RCS : [À COMPLÉTER]
- Numéro de TVA intracommunautaire : [À COMPLÉTER]
- Directeur de la publication : [À COMPLÉTER]
- Contact : [À COMPLÉTER]

## Hébergement

Le site est hébergé sur le réseau Cloudflare (Cloudflare, Inc., 101 Townsend St,
San Francisco, CA 94107, États-Unis). Les données de la boutique sont stockées
dans la juridiction déclarée au manifeste de la boutique.

## Propriété intellectuelle

L''ensemble des contenus du site est protégé. Toute reproduction sans
autorisation est interdite.
',
  0
);

INSERT OR IGNORE INTO pages (title, slug, body_markdown, published) VALUES (
  'Politique de confidentialité',
  'politique-de-confidentialite',
  '# Politique de confidentialité

> **Brouillon.** Complétez chaque `[À COMPLÉTER]` avant publication.

## Responsable de traitement

[À COMPLÉTER — dénomination, siège, contact].

## Données collectées

- Données de commande : adresse électronique, nom, adresse de livraison,
  contenu et montant de la commande.
- Données de paiement : traitées par le prestataire de paiement. Aucun numéro de
  carte n''est stocké par la boutique.
- Données techniques : journaux de service nécessaires à la sécurité.

## Finalités et bases légales

Exécution du contrat de vente, respect des obligations comptables et fiscales,
et sécurité du service.

## Durées de conservation

Les pièces comptables sont conservées dix (10) ans. Les autres données sont
conservées le temps nécessaire aux finalités ci-dessus.

## Destinataires

Prestataire de paiement, transporteur, prestataire d''envoi de courriels, et
l''hébergeur. [À COMPLÉTER — liste effective].

## Vos droits

Accès, rectification, effacement, limitation, opposition et portabilité :
écrivez à [À COMPLÉTER]. Vous pouvez introduire une réclamation auprès de la
CNIL.

## Cookies

La boutique dépose un cookie de panier et, le cas échéant, un cookie de session.
Ils sont nécessaires au fonctionnement du service et ne servent pas à la mesure
d''audience publicitaire.
',
  0
);

INSERT OR IGNORE INTO pages (title, slug, body_markdown, published) VALUES (
  'Droit de rétractation',
  'droit-de-retractation',
  '# Droit de rétractation

> **Brouillon.** Complétez chaque `[À COMPLÉTER]` avant publication.

Vous disposez de quatorze (14) jours à compter de la réception de votre commande
pour exercer votre droit de rétractation, sans avoir à motiver votre décision.

## Comment l''exercer

Informez-nous de votre décision par une déclaration dénuée d''ambiguïté, à
[À COMPLÉTER — adresse postale et adresse électronique]. Vous pouvez utiliser le
formulaire ci-dessous, sans que ce soit obligatoire.

## Renvoi des produits

Renvoyez les produits sans retard excessif et au plus tard quatorze (14) jours
après nous avoir communiqué votre décision. Les frais de renvoi sont à votre
charge, sauf indication contraire.

## Remboursement

Nous vous remboursons l''intégralité des sommes versées, frais de livraison
standard compris, au plus tard quatorze (14) jours après récupération des
produits ou preuve de leur expédition.

## Exceptions

Le droit de rétractation ne s''applique pas aux biens confectionnés selon vos
spécifications, aux biens périssables, ni aux contenus numériques fournis sur
support immatériel dont l''exécution a commencé avec votre accord préalable
exprès et votre renoncement exprès à ce droit.

## Formulaire type de rétractation

```
À l''attention de [À COMPLÉTER — dénomination, adresse postale, adresse électronique] :

Je vous notifie par la présente ma rétractation du contrat portant sur la vente
du bien ci-dessous :

Commandé le : ____________  Reçu le : ____________
Numéro de commande : ____________
Nom du consommateur : ____________
Adresse du consommateur : ____________

Signature (uniquement en cas de notification sur papier) : ____________
Date : ____________
```
',
  0
);
