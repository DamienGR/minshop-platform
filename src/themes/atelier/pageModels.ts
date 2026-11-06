import type { ThemePageModel } from '../../features/storefront/models';

/**
 * Atelier — les modèles de page (ticket #205, ADR 0031).
 *
 * Deux modèles, témoins du contrat : ce que le marchand choisit dans
 * l'éditeur d'une page, à côté de « Basique », et que dessine
 * `pages/<clé>.astro`. Un modèle se déclare avec son gabarit, ou n'est pas
 * proposé (features/pageModels/active.ts).
 *
 *   « La marque » : une zone de texte et une zone Markdown autour du corps.
 *   « Où nous trouver » : une zone répétable, un point de vente par entrée.
 *
 * Les libellés et les aides s'affichent dans l'éditeur : ils parlent au
 * marchand, en français. Une page « Basique » ne change pas : elle reste
 * dessinée par `ContentPage.astro`, et la signature du thème avec elle.
 */
export const pageModels = [
  {
    key: 'marque',
    label: 'La marque',
    help: 'Une accroche sous le titre, l’histoire de la marque, puis ses engagements dans un encart.',
    body: { label: 'L’histoire', help: 'Le texte de la page, sous l’accroche.' },
    zones: [
      {
        key: 'accroche',
        label: 'Accroche',
        help: 'Une phrase, en grand sous le titre.',
        format: 'text',
        maxLength: 160,
      },
      {
        key: 'engagements',
        label: 'Engagements',
        help: 'Ce que la marque promet : quelques lignes ou une liste, dans un encart après l’histoire.',
        format: 'markdown',
        maxLength: 2000,
      },
    ],
  },
  {
    key: 'points-de-vente',
    label: 'Où nous trouver',
    help: 'Une introduction, puis vos points de vente, chacun avec son adresse, ses horaires et sa carte.',
    body: { label: 'Introduction' },
    zones: [
      {
        key: 'points',
        label: 'Points de vente',
        help: 'Un point de vente par entrée : une boutique, un marché, un salon.',
        itemLabel: 'Point de vente',
        maxItems: 20,
        fields: [
          { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 },
          { key: 'adresse', label: 'Adresse', format: 'text', maxLength: 200 },
          {
            key: 'horaires',
            label: 'Horaires',
            help: 'Un jour par ligne, par exemple « Samedi : 8 h – 13 h ».',
            format: 'markdown',
            maxLength: 1000,
          },
          {
            key: 'carte',
            label: 'Carte',
            help: 'Le bouton « Carte » y place le bloc du lieu : il reste à indiquer sa position.',
            format: 'markdown',
            maxLength: 1000,
          },
        ],
      },
    ],
  },
] satisfies ThemePageModel[];
