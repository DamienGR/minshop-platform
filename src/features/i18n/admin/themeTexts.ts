import type { Catalog } from '../catalog.ts';

/** Textes du thème (ticket #165) : les textes que le thème déclare modifiables. */
export const themeTexts = {
  // ─── Écran ─────────────────────────────────────────────────────────────────────
  'admin.themeTexts.title': 'Textes du thème',
  'admin.themeTexts.intro':
    'Les textes que votre thème vous laisse modifier, sur l’accueil notamment. Un champ vide reprend le texte par défaut du thème.',
  'admin.themeTexts.empty': 'Le thème de cette boutique ne déclare aucun texte modifiable.',
  'admin.themeTexts.saved': 'Textes enregistrés.',
  'admin.themeTexts.save': 'Enregistrer les textes',

  // ─── Un champ ──────────────────────────────────────────────────────────────────
  'admin.themeTexts.field.max': '{max} caractères au plus',
  'admin.themeTexts.field.markdown':
    'Markdown : **gras**, *italique*, [lien](https://…), listes. Le HTML est affiché tel quel, jamais interprété.',
  'admin.themeTexts.field.default': 'Texte par défaut :',
  'admin.themeTexts.field.defaultEmpty': 'aucun (le thème n’affiche alors rien ici)',
  'admin.themeTexts.field.custom': 'Personnalisé',
  'admin.themeTexts.field.tooLongNow':
    'Le texte enregistré ({longueur} caractères) dépasse désormais la limite du thème : la vitrine affiche le texte par défaut. Raccourcissez-le pour le rétablir.',

  // ─── Erreurs ───────────────────────────────────────────────────────────────────
  'admin.themeTexts.error.tooLong':
    '« {libelle} » est trop long : {longueur} caractères pour {max} au plus. Rien n’a été enregistré.',
  'admin.themeTexts.error.image':
    '« {libelle} » ne peut pas afficher une image de la médiathèque : elle n’y serait pas comptée comme utilisée, et pourrait être supprimée. Rien n’a été enregistré.',
} satisfies Catalog;
