# Boutiques témoins

Deux manifestes, et la seule raison pour laquelle le cœur peut affirmer qu'il ne
contient aucune condition propre à un client : tout ce que le socle sait d'une
boutique vient d'un de ces fichiers, et la CI construit les deux (plan §2.3).

| Boutique | Rôle |
| --- | --- |
| `pilot-fr` | la boutique du pilote : catalogue complet, thème dédié, toutes les fonctionnalités du périmètre. |
| `canary-minimal` | la contre-épreuve : autre thème, fonctionnalités au minimum. Ce qui casse ici est une hypothèse `pilot-fr` codée en dur quelque part. |

Ce sont des fixtures, pas des déploiements : aucun provisioning ne les lit, et
les noms de domaine sont réservés à la documentation (RFC 2606). Le thème du
pilote arrive au jalon 5 — jusque-là chaque boutique référence un thème livré
par le socle, ce qui suffit à la propriété vérifiée ici : deux boutiques, deux
designs, un seul cœur.

## `pilot-fr/catalogue/`

Le catalogue témoin du jalon 4 : vingt produits, quatre catégories, trois
produits à variantes, et les trois états de stock que le storefront distingue
(en stock, stock faible, épuisé). `test/scripts/catalog.test.mjs` l'importe
contre les migrations du dépôt et relit les lignes obtenues, ce qui en fait à la
fois la démonstration du format et la seule preuve que l'import produit un
catalogue qu'une boutique peut servir.

Les photos sont des PNG générés — des damiers de quelques centaines d'octets —
et non des visuels de produits. Ce que la fixture doit prouver, ce sont le
format, le volume et le partage d'une même image entre deux produits ; de vraies
photographies coûteraient un mégaoctet au dépôt sans rien ajouter à cela. Le
jalon 5 donne au pilote son thème, pas ses images.

`coreVersion` suit la version du socle dans `package.json`. Une version du socle
qui oublie de les mettre à jour fait échouer `npm run config:validate`, ce qui
est la répétition en miniature de la mise à niveau d'une vraie boutique.
