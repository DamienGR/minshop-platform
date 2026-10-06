# Runbook — violation de données personnelles

**Déclencheurs** : une base, une archive avec sa clé, un export `privacy/`, des
journaux ou un accès admin lus par quelqu'un qui n'aurait pas dû ; un secret
dont la fuite donne accès à des données personnelles ; un e-mail de commande
envoyé au mauvais destinataire.

**Qui fait quoi** : le commerçant est responsable du traitement, l'agence est
sous-traitante (ADR 0002). C'est au commerçant de notifier la CNIL et, le cas
échéant, les personnes ; c'est à l'agence de le prévenir sans délai et de lui
donner de quoi le faire.

## 1. Contenir (la première heure)

- révoquer l'accès en cause : jeton, session, compte d'un collaborateur —
  voir [fuite de secret](fuite-de-secret.md) ;
- conserver les preuves avant de nettoyer : journal d'audit Cloudflare, rapport
  de déploiement, journaux du Worker sur la période ;
- noter l'heure de **prise de connaissance** : le délai de 72 heures de
  l'article 33 du RGPD court à partir d'elle, pas de l'incident.

## 2. Prévenir le commerçant (sans délai)

Article 33, paragraphe 2 : le sous-traitant notifie le responsable « dans les
meilleurs délais ». Le message dit, sans spéculer :

- ce qui s'est passé et quand, ce qui est su et ce qui ne l'est pas encore ;
- les catégories de données en cause (e-mails, adresses de livraison,
  commandes) et un ordre de grandeur du nombre de personnes ;
- ce qui a été fait pour contenir ;
- ce dont le commerçant a besoin pour notifier, et quand l'agence le lui
  fournira.

Aucune donnée personnelle dans ce message : un décompte et des identifiants
publics de commande suffisent.

## 3. Établir le périmètre

`shopctl privacy export --env <env> --email <adresse>` dit, pour une personne,
quelles lignes la concernent ; les mêmes règles (`shopctl/src/privacy/map.mjs`)
donnent les colonnes personnelles de la base. Les numéros de carte ne sont
jamais dans la base : Stripe les détient, la boutique n'en voit aucun.

## 4. Notifier (responsable du traitement)

- **CNIL** : par son téléservice de notification, dans les 72 heures, sauf si la
  violation est « peu susceptible d'engendrer un risque » ; une notification
  incomplète vaut mieux qu'une notification en retard, elle se complète
  ensuite (article 33) ;
- **personnes concernées** : quand le risque est élevé — adresses et
  historiques d'achat exposés publiquement, par exemple (article 34) ;
- **registre des violations** : toute violation y est consignée, notifiée ou
  non, avec ses faits, ses effets et les mesures prises (article 33,
  paragraphe 5).

## 5. Après

- si un acheteur demande l'effacement à la suite de l'incident :
  `shopctl privacy anonymize` (une anonymisation, jamais une suppression d'une
  commande payée — ADR 0017) ;
- la cause devient un test du socle quand une doublure peut la reproduire.
