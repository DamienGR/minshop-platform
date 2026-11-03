import type { ThemeTextSlot } from '../../../../src/features/storefront/models';

/**
 * A theme's text declaration (ticket #165), as a shop's theme writes it in
 * `src/themes/<id>/texts.ts`. AltCatalog reads these two keys; the suite holds
 * this file to the same rules as every theme on disk.
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
] satisfies ThemeTextSlot[];
