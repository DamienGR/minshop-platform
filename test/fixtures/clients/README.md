# Boutiques témoins

Deux manifestes, et la seule raison pour laquelle le cœur peut affirmer qu'il ne
contient aucune condition propre à un client : tout ce que le socle sait d'une
boutique vient d'un de ces fichiers, et la CI construit les deux (plan §2.3).

| Boutique | Rôle |
| --- | --- |
| `pilot-fr` | la boutique du pilote : catalogue complet, thème dédié, toutes les fonctionnalités du périmètre. |
| `canary-minimal` | la contre-épreuve : autre thème, fonctionnalités au minimum. Ce qui casse ici est une hypothèse `pilot-fr` codée en dur quelque part. |

Ce sont des fixtures, pas des déploiements : aucun provisioning ne les lit, et
les noms de domaine sont réservés à la documentation (RFC 2606). Le catalogue
témoin de vingt produits arrive au jalon 4, le thème du pilote au jalon 5 —
jusque-là chaque boutique référence un thème livré par le socle, ce qui suffit à
la propriété vérifiée ici : deux boutiques, deux designs, un seul cœur.

`coreVersion` suit la version du socle dans `package.json`. Une version du socle
qui oublie de les mettre à jour fait échouer `npm run config:validate`, ce qui
est la répétition en miniature de la mise à niveau d'une vraie boutique.
