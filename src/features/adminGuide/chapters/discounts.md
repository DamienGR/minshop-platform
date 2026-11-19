## Codes promo

Des codes que vos clients saisissent dans leur panier pour une remise sur leurs articles : un code de lancement, une remise de fidélité, une carte cadeau. Un code vaut quel que soit le moyen de paiement : carte bancaire, virement ou Lightning.

Le champ « Code promo ou carte cadeau » s’affiche dans le panier, dans l’achat immédiat et sur la page de commande dès qu’un code est actif, tant que « Codes promo » est allumé dans [Réglages](#guide-settings). Le client voit sa remise avant de payer, et la page de paiement par carte la reprend : il n’a rien à saisir une seconde fois.

### Créer un code

1. Ouvrez **Codes promo** et cliquez sur **Nouveau code**.
2. Tapez le **Code** que vos clients saisiront, par exemple NOEL10. Majuscules et minuscules sont confondues. Laissé vide, un code est tiré au hasard.
3. Indiquez la **Remise** et choisissez son unité, à côté : un pourcentage des articles, ou un montant fixe.
4. Si vous le souhaitez, fixez un **Minimum d’achat**, des dates (**Valable à partir du**, **Valable jusqu’au**) et un **Nombre d’utilisations**, toutes commandes confondues.
5. Cliquez sur **Créer le code**.

La remise porte sur les articles, jamais sur la livraison, et ne dépasse jamais leur montant. Un client utilise un seul code par commande.

### Créer une carte cadeau

Une carte cadeau est un code à montant fixe, utilisable une seule fois.

1. Ouvrez **Codes promo** et cliquez sur **Nouvelle carte cadeau**.
2. Le formulaire s’ouvre sur un montant fixe, une seule utilisation et un an de validité. Indiquez la valeur de la carte dans **Remise**.
3. Laissez le **Code** vide : la boutique tire un code de douze caractères que personne ne peut deviner. Un code inventé, comme NOEL, se devine, et une carte cadeau, c’est de l’argent.
4. Cliquez sur **Créer le code**, puis recopiez le code de la liste sur la carte ou dans l’e-mail que vous remettez.

Une carte cadeau se dépense en une fois. Si la commande coûte plus, le client paie la différence ; si elle coûte moins, le reste est perdu.

La boutique calcule la TVA de la commande sur ce qui est payé, carte déduite, comme pour une remise. C’est juste pour une carte offerte. Si vous vendez vos cartes cadeaux, faites valider ce point par votre expert-comptable avant la première vente : pour une carte vendue, la TVA est due sur le prix plein.

Quand le code couvre tous les articles et que la livraison est gratuite, il ne reste rien à payer : la carte bancaire valide la commande sans débit, mais un virement ou une facture Lightning de zéro ne peuvent pas se régler. La page de commande demande alors au client de choisir un autre moyen de paiement.

### Suivre les utilisations

La liste dit, pour chaque code, sa remise, ses conditions, ses **Utilisations** et son état : « Actif », « À venir », « Expiré », « Épuisé » ou « Désactivé ».

Une utilisation, c’est une commande payée avec le code, ou un paiement en cours qui le tient : un virement attendu, une page de paiement ouverte. Un code à une seule utilisation ne peut donc pas servir à deux commandes en même temps. Si le paiement n’aboutit pas, le code se libère quand la réservation des articles expire.

La fiche d’une commande montre le code à côté de sa remise, comme les e-mails et la page de confirmation du client.

### Désactiver ou supprimer un code

- **Désactiver** : le code ne s’applique plus, jusqu’à ce que vous cliquiez sur **Activer**.
- **Supprimer** : un code qu’aucune commande n’a utilisé disparaît. Un code déjà utilisé reste dans la liste, désactivé, car les commandes qui l’ont utilisé en gardent la trace.

Modifier un code, sa remise ou ses dates, ne change rien aux commandes déjà passées.

### Les codes créés dans Stripe

Les codes promotionnels du tableau de bord de Stripe ne sont plus proposés sur sa page de paiement : c’est le code saisi dans la boutique qui s’applique. Recréez ici ceux que vous utilisez encore.
