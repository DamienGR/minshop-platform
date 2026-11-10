import type { ThemeTextSlot } from '../../../../src/features/storefront/models';

/**
 * A theme's text declaration (tickets #165, #225), as a shop's theme writes it
 * in `src/themes/<id>/texts.ts`. One declaration for every template: AltCatalog
 * reads the two `hero.` keys, AltHeader and AltFooter the `bar.` and `pledge.`
 * ones, AltProductDetail the `product.` ones. The suite holds this file to the
 * same rules as every theme on disk.
 */
export const texts = [
  {
    key: 'hero.title',
    label: 'Titre de l’accueil',
    help: 'En haut de l’accueil, au-dessus des créations.',
    default: 'Né à l’atelier',
    maxLength: 80,
    format: 'text',
  },
  {
    key: 'hero.intro',
    label: 'Texte d’accroche',
    default: 'Des sacs *cousus main*, un par un.',
    maxLength: 600,
    format: 'markdown',
  },
  {
    key: 'bar.shipping',
    label: 'Livraison, en haut de page',
    help: 'Tout en haut de chaque page, à gauche.',
    default: 'Expédié sous 3 à 5 jours',
    maxLength: 60,
    format: 'text',
  },
  {
    key: 'pledge.payment',
    label: 'Paiement, en pied de page',
    default: 'Paiement sécurisé',
    maxLength: 60,
    format: 'text',
  },
  {
    key: 'product.priceNote',
    label: 'Sous le prix de la fiche',
    default: 'Prix TTC, frais de port en sus',
    maxLength: 80,
    format: 'text',
  },
  {
    key: 'product.delivery',
    label: 'Livraison et paiement de la fiche',
    help: 'Le pli « Livraison et paiement » sous le bouton d’achat.',
    default: 'Expédié sous *3 à 5 jours*.',
    maxLength: 1000,
    format: 'markdown',
  },
] satisfies ThemeTextSlot[];
