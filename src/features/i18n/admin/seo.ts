import type { Catalog } from '../catalog.ts';

/**
 * The « Référencement » box of the product, category and page editors and of
 * the home page's settings (ticket #216, `features/seo/SeoFields.astro`). One
 * fragment for the four screens, since the box is one component.
 */
export const seo = {
  'admin.seo.legend': 'Référencement',
  'admin.seo.intro': 'Ce que Google montre de cette page dans ses résultats, et ce qu’en reprend un réseau social quand on la partage. Laissé vide, un champ reprend le texte grisé.',
  'admin.seo.title': 'Titre pour Google',
  'admin.seo.optional': '(facultatif)',
  'admin.seo.titleHelp': 'Affiché tel quel, sans le nom de la boutique à la suite. Google en montre environ {max} caractères.',
  'admin.seo.description': 'Description pour Google',
  'admin.seo.descriptionHint': '(facultative, {max} caractères au plus)',
  'admin.seo.descriptionHelp': 'Le résumé sous le titre, dans les résultats de recherche.',
  'admin.seo.error.descriptionTooLong': 'La description pour Google ne doit pas dépasser {max} caractères.',
  // Placeholders of a form whose name is not typed yet.
  'admin.seo.newProduct': 'Nom du produit',
  'admin.seo.newCategory': 'Nom de la catégorie',
  // Admin → Réglages → Général.
  'admin.seo.home.heading': 'Référencement de l’accueil',
  'admin.seo.home.intro': 'Ce que Google montre de l’accueil quand il affiche la liste des produits. Quand l’accueil affiche une page ou un produit, ce sont les champs « Référencement » de cette page ou de ce produit qui comptent.',
} satisfies Catalog;
