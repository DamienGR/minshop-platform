import type { Catalog } from '../catalog.ts';

/** Le guide de l’administration (ticket #188) : sa page et son panneau. */
export const guide = {
  // ─── Page /admin/guide ─────────────────────────────────────────────────────────
  'admin.guide.title': 'Guide de l’administration',
  'admin.guide.intro': 'Comment se servir de chaque écran. En bas de chaque écran, « Guide de l’administration » ouvre ce guide à côté, sur le chapitre de l’écran où vous êtes.',
  'admin.guide.version': 'Ce guide décrit la version {version} du socle minshop.',
  'admin.guide.contents': 'Sommaire',
  'admin.guide.shopChapters': 'Propre à votre boutique',

  // ─── Panneau latéral ───────────────────────────────────────────────────────────
  'admin.guide.panel.fullPage': 'Pleine page',
  'admin.guide.panel.close': 'Fermer',
  // The link run goes to /admin/guide, the page that needs no script.
  'admin.guide.panel.loadFailed': 'Le guide n’a pas pu se charger. [Ouvrez-le en pleine page].',
} satisfies Catalog;
