## Réglages

Les réglages de la boutique, par sections. Chaque bloc a son bouton **Enregistrer**. Un interrupteur, lui, s’applique dès que vous cliquez dessus.

### Général

- **Nom de la boutique** et **Logo** : ce qui s’affiche en haut de la boutique.
- **Page d’accueil** : ce que montre l’accueil, la liste des produits, une page ou un produit.
- **Référencement de l’accueil** : ce que Google affiche de l’accueil quand il montre la liste des produits. Dites-y votre métier et votre lieu, par exemple « Maroquinerie artisanale à Lyon ». Quand l’accueil montre une page ou un produit, ce sont les champs **Référencement** de cette page ou de ce produit qui comptent.
- **Produit mis en avant** : celui que votre thème présente en vedette, s’il le fait.
- **Bandeau d’annonce** : un message en haut de toutes les pages, par exemple « Livraison offerte dès 50 € ». Videz-le pour le retirer.
- Les interrupteurs allument ou éteignent des fonctions de la boutique : **Achat immédiat**, **Commentaire de commande**, **Codes promo**…

### Formulaire de contact

Choisissez la **Page du formulaire** et le **Destinataire** des messages. Puis ajoutez cette page au pied de page dans [Navigation](#guide-navigation).

### E-mail

Le **Destinataire des alertes de commande** reçoit un e-mail à chaque nouvelle commande. **Envoyer le test** vérifie que les e-mails partent bien.

### Mesure d’audience

Pour savoir combien de personnes visitent la boutique, et d’où elles viennent, la boutique peut envoyer ses visites à Umami, un outil de mesure d’audience qui ne dépose aucun cookie : aucun bandeau à faire accepter.

1. Dans Umami, ajoutez la boutique comme site, avec son adresse.
2. Ouvrez son code de suivi (« Tracking code »).
3. Dans **Mesure d’audience**, recopiez l’adresse qui suit `src=` dans **Adresse du script**, et la valeur de `data-website-id` dans **Identifiant du site**. Vous pouvez aussi coller le code de suivi entier dans **Adresse du script** : la boutique y lit les deux valeurs.
4. Cliquez sur **Enregistrer**. Les visites apparaissent dans Umami dès la page suivante.
5. Dans [Pages](#guide-pages), ajoutez Umami à votre politique de confidentialité, parmi les destinataires, pour la mesure d’audience.

Ne sont jamais comptées : les pages de l’administration, celles d’une commande et de son paiement, et vos propres visites tant que vous êtes connecté à l’administration dans ce navigateur. Les liens d’une campagne gardent leurs paramètres `utm_source`, `utm_campaign`…, qu’Umami range par campagne.

Pour arrêter la mesure, videz les deux champs et enregistrez.

### Accès de l’agence

La personne qui s’occupe de votre boutique peut entrer dans l’administration sans connaître votre mot de passe : avec un jeton à usage unique, valable un quart d’heure, que seul le compte d’hébergement de la boutique permet de créer. Il ouvre une session de 8 heures. Votre mot de passe ne change pas, et vous restez connecté.

La section **Accès de l’agence** affiche la date de son dernier passage. Si vous changez votre mot de passe, sa session se ferme comme les vôtres.

### Les réglages techniques

Les **Paiements**, l’envoi des e-mails, les étiquettes Boxtal, les **Images**, la **Protection anti-robots** et la **Recherche** demandent des comptes et des clés chez des prestataires. Ils sont faits à l’ouverture de la boutique. Pour les changer, écrivez à la personne qui s’occupe de votre boutique, avec le lien en bas de l’écran.

**Fixé au déploiement** (la devise, l’icône de la boutique) ne se change pas ici, mais dans le code de la boutique.
