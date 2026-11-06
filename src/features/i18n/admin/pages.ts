import type { Catalog } from '../catalog.ts';

/** Content pages: the list, the new-page form, the Markdown editor and its presets. */
export const pages = {
  // ─── Commun ────────────────────────────────────────────────────────────────────
  'admin.pages.title': 'Pages',
  'admin.pages.backToList': 'Retour aux pages',
  'admin.pages.notFound': 'Page introuvable.',
  'admin.pages.status.published': 'Publiée',
  'admin.pages.status.draft': 'Brouillon',
  'admin.pages.field.title': 'Titre',
  'admin.pages.field.slug': 'Slug',
  'admin.pages.field.urlSlug': 'Slug de l’URL',
  'admin.pages.field.layout': 'Mise en page',

  // ─── Liste (/admin/pages) ──────────────────────────────────────────────────────
  'admin.pages.list.newPage': 'Nouvelle page',
  'admin.pages.list.empty.before':
    'Aucune page pour le moment. Créez-en une (à propos, livraison, retours, confidentialité…), puis ajoutez-la à la',
  'admin.pages.list.empty.link': 'navigation',
  'admin.pages.list.empty.after': 'pour que vos clients la trouvent.',
  'admin.pages.list.col.url': 'URL',
  'admin.pages.list.col.updated': 'Mise à jour',
  'admin.pages.list.confirmDelete': 'Supprimer cette page ?',
  'admin.pages.list.confirmDeleteLinked':
    'Cette page figure dans votre navigation. La supprimer masquera ce lien sur la vitrine. Continuer ?',

  // ─── Nouvelle page ─────────────────────────────────────────────────────────────
  'admin.pages.new.title': 'Nouvelle page',
  'admin.pages.new.slugPlaceholder': 'a-propos',
  'admin.pages.new.slugHint':
    'Laissez vide pour le générer à partir du titre. La page sera accessible à l’adresse /pages/<slug>.',
  'admin.pages.new.submit': 'Créer le brouillon',

  // ─── Éditeur ───────────────────────────────────────────────────────────────────
  'admin.pages.edit.documentTitle': 'Modifier « {titre} »',
  'admin.pages.edit.heading': 'Modifier la page',
  'admin.pages.edit.viewOnStore': 'Voir sur la boutique',
  'admin.pages.edit.publishHint':
    'Une page publiée figure dans le plan du site ; ajoutez-la à un menu depuis Navigation. Avec le cache de la vitrine, une modification peut mettre jusqu’à une minute à s’afficher.',
  'admin.pages.editor.viewLabel': 'Affichage de l’éditeur',
  'admin.pages.editor.mode.split': 'Côte à côte',
  'admin.pages.editor.previewHint': 'cliquez pour retrouver la source',
  'admin.pages.editor.rendering': 'Rendu en cours…',
  'admin.pages.editor.previewFailed': 'L’aperçu a échoué.',
  'admin.pages.editor.previewFailedStatus': 'L’aperçu a échoué ({statut}).',
  'admin.pages.editor.linkText': 'texte du lien',
  'admin.pages.editor.altPrompt': 'Décrivez cette image pour les lecteurs d’écran :',
  'admin.pages.editor.tool.heading': 'Intertitre',
  'admin.pages.editor.tool.bold': 'Gras',
  'admin.pages.editor.tool.boldShort': 'G',
  'admin.pages.editor.tool.italic': 'Italique',
  'admin.pages.editor.tool.link': 'Lien',
  'admin.pages.editor.tool.list': 'Liste à puces',
  'admin.pages.editor.tool.listShort': 'Liste',
  'admin.pages.editor.tool.numberedList': 'Liste numérotée',
  'admin.pages.editor.tool.quote': 'Citation',
  'admin.pages.editor.tool.code': 'Code en ligne',
  'admin.pages.editor.tool.codeShort': 'Code',
  // After « Image » (ticket #195): the photo on the caret's line, beside its text.
  'admin.pages.editor.tool.imageLeft': 'Photo de cette ligne à gauche du texte',
  'admin.pages.editor.tool.imageLeftShort': 'À gauche',
  'admin.pages.editor.tool.imageRight': 'Photo de cette ligne à droite du texte',
  'admin.pages.editor.tool.imageRightShort': 'À droite',
  'admin.pages.editor.sideNoImage': 'Placez d’abord le curseur sur la ligne d’une image.',
  // The empty editor's placeholder, one key per line of Markdown: the syntax
  // around these words is built in the template, so a translation cannot break it.
  'admin.pages.editor.placeholder.heading': 'Un intertitre',
  'admin.pages.editor.placeholder.intro':
    'Rédigez votre page en Markdown. Une ligne vide sépare deux paragraphes.',
  'admin.pages.editor.placeholder.bold': 'gras',
  'admin.pages.editor.placeholder.italic': 'italique',
  'admin.pages.editor.placeholder.bulletList': 'une liste à puces',
  'admin.pages.editor.placeholder.numberedList': 'une liste numérotée',
  'admin.pages.editor.placeholder.anotherItem': 'un autre élément',
  'admin.pages.editor.placeholder.quote': 'une citation',
  'admin.pages.editor.placeholder.link': 'un lien',
  'admin.pages.editor.placeholder.imageAlt': 'décrivez l’image',
  // The « Carte » tool inserts a ```carte block; its keys (lieu, adresse,
  // position) are syntax and stay in the template, these are the sample values.
  'admin.pages.editor.tool.map': 'Carte d’un lieu',
  'admin.pages.editor.tool.mapShort': 'Carte',
  'admin.pages.editor.mapTemplate.name': 'Nom du lieu',
  'admin.pages.editor.mapTemplate.address': 'Rue, code postal et ville',
  // The « Colonnes » tool inserts a block of two columns (features/pages/blocks.ts,
  // ADR 0030); `::: colonnes` and `::: colonne` are syntax, these are the sample texts.
  'admin.pages.editor.tool.columns': 'Texte en colonnes',
  'admin.pages.editor.tool.columnsShort': 'Colonnes',
  'admin.pages.editor.columnsTemplate.first': 'Le texte de la première colonne.',
  'admin.pages.editor.columnsTemplate.second': 'Le texte de la deuxième colonne.',
  'admin.pages.columns.error.heading': 'Ces colonnes ne s’afficheront pas comme prévu :',
  'admin.pages.columns.error.single':
    'ligne {ligne} : une seule colonne. Ajoutez une ligne « ::: colonne » là où commence la suivante.',
  'admin.pages.columns.error.tooMany':
    'ligne {ligne} : {nombre} colonnes, {max} au plus. Les suivantes passent à la ligne.',
  'admin.pages.columns.error.ratio':
    'ligne {ligne} : « {proportions} » n’est pas une proportion connue (1/2 ou 2/1). Les colonnes restent égales.',
  'admin.pages.columns.error.ratioNeedsTwo':
    'ligne {ligne} : les proportions « {proportions} » ne valent que pour deux colonnes. Elles restent égales.',

  // ─── Mises en page (features/pages/layouts.ts) ─────────────────────────────────
  'admin.pages.layout.standard.label': 'Standard',
  'admin.pages.layout.standard.hint':
    'Colonne étroite, titre aligné à gauche. Idéal pour les conditions générales, la livraison et les retours.',
  'admin.pages.layout.editorial.label': 'Éditorial',
  'admin.pages.layout.editorial.hint':
    'Colonne étroite, titre centré. Idéal pour la présentation de la boutique et l’histoire de la marque.',
  'admin.pages.layout.wide.label': 'Large',
  'admin.pages.layout.wide.hint':
    'Pleine largeur, titre aligné à gauche. Idéal pour les guides des tailles, les tableaux et les rangées de photos.',

  // ─── Modèles de page du thème (features/pageModels, ADR 0031) ──────────────────
  'admin.pages.field.model': 'Modèle',
  'admin.pages.model.basic.label': 'Basique',
  'admin.pages.model.basic.hint':
    'La page telle qu’elle a toujours été : son titre, puis votre texte, dans la mise en page choisie plus bas.',
  'admin.pages.model.switchHint':
    'Changez de modèle puis enregistrez : la page montre alors les zones du nouveau modèle. Le texte des zones de l’ancien est gardé, au cas où vous y reviendriez.',
  'admin.pages.model.switchPending': 'Enregistrez pour passer à ce modèle et afficher ses zones.',
  'admin.pages.model.unknown':
    'Le thème ne propose plus le modèle « {modele} » : la page s’affiche en « Basique ». Ses zones sont gardées.',
  'admin.pages.zones.max': '{max} caractères au plus',
  'admin.pages.zones.list.count': '{nombre} sur {max} au plus',
  'admin.pages.zones.list.full': 'La liste est complète : retirez une entrée pour en ajouter une autre.',
  'admin.pages.zones.list.entry': '{element} {numero}',
  'admin.pages.zones.list.add': 'Ajouter : {element}',
  'admin.pages.zones.list.addHint':
    'Remplissez ces champs puis enregistrez. Une nouvelle entrée vide apparaît alors pour la suivante.',
  'admin.pages.zones.list.remove': 'Retirer à l’enregistrement',
  'admin.pages.zones.list.up': 'Monter',
  'admin.pages.zones.list.down': 'Descendre',
  'admin.pages.zones.list.moveHint': 'Monter et Descendre enregistrent la page.',
  'admin.pages.zones.error.tooLong':
    '« {libelle} » est trop long : {longueur} caractères pour {max} au plus. Rien n’a été enregistré.',
  'admin.pages.zones.error.tooMany': '« {libelle} » : {max} entrées au plus. Rien n’a été enregistré.',
  'admin.pages.preview.page': 'Aperçu de la page',
  'admin.pages.preview.pageHint':
    'Ouvre la page dans un nouvel onglet, telle que la boutique l’affichera, sans l’enregistrer.',
  'admin.pages.preview.banner': 'Aperçu : cette page n’est pas enregistrée.',

  // ─── Validation et messages d’enregistrement ───────────────────────────────────
  'admin.pages.form.titleRequired': 'Le titre est obligatoire.',
  'admin.pages.form.titleTooLong': 'Le titre ne doit pas dépasser {max} caractères.',
  'admin.pages.form.bodyTooLong': 'Le contenu de la page ne doit pas dépasser {max} caractères.',
  'admin.pages.form.zonesTooLong': 'Les zones de la page ne doivent pas dépasser {max} caractères en tout.',
  'admin.pages.save.publishRefused.one':
    'Modifications enregistrées, mais la page n’a pas été publiée : {count} image est introuvable dans la médiathèque.',
  'admin.pages.save.publishRefused.other':
    'Modifications enregistrées, mais la page n’a pas été publiée : {count} images sont introuvables dans la médiathèque.',
  'admin.pages.save.liveBroken.one':
    'Modifications enregistrées et en ligne, mais {count} image est introuvable dans la médiathèque et ne s’affichera pas.',
  'admin.pages.save.liveBroken.other':
    'Modifications enregistrées et en ligne, mais {count} images sont introuvables dans la médiathèque et ne s’afficheront pas.',
  'admin.pages.save.draftMissing.one':
    'Brouillon enregistré, mais {count} image est introuvable dans la médiathèque.',
  'admin.pages.save.draftMissing.other':
    'Brouillon enregistré, mais {count} images sont introuvables dans la médiathèque.',
  'admin.pages.save.incompleteRefused':
    'Modifications enregistrées, mais la page n’a pas été publiée : elle contient encore « [À COMPLÉTER] ». Remplacez chaque marqueur par le texte définitif, puis publiez-la.',
  'admin.pages.save.incompleteLive':
    'Modifications enregistrées. La page est en ligne et contient encore « [À COMPLÉTER] » : remplacez chaque marqueur par le texte définitif.',
  'admin.pages.save.mapRefused':
    'Modifications enregistrées, mais la page n’a pas été publiée : une carte est incomplète ({probleme}). L’aperçu montre ce qu’il faut corriger.',
  'admin.pages.save.mapLive':
    'Modifications enregistrées et en ligne, mais une carte est incomplète et ne s’affiche pas ({probleme}). L’aperçu montre ce qu’il faut corriger.',
  'admin.pages.save.mapDraft':
    'Brouillon enregistré, mais une carte est incomplète ({probleme}). L’aperçu montre ce qu’il faut corriger.',

  // ─── Carte d’un lieu (bloc ```carte, ADR 0029) ─────────────────────────────────
  'admin.pages.map.error.heading': 'Cette carte ne s’affichera pas sur la boutique :',
  'admin.pages.map.error.at': 'ligne {ligne} : {probleme}',
  'admin.pages.map.error.lineShape':
    'écrivez chaque ligne sous la forme « nom : valeur », par exemple « lieu : Marché de Vannes »',
  'admin.pages.map.error.unknownKey':
    '« {cle} » n’est pas une ligne de carte (les lignes possibles sont lieu, adresse, position et zoom)',
  'admin.pages.map.error.repeated': '« {cle} » est écrit deux fois',
  'admin.pages.map.error.tooLong': '« {cle} » dépasse {max} caractères',
  'admin.pages.map.error.addressLines': 'l’adresse tient en {max} lignes au plus',
  'admin.pages.map.error.position':
    'la position donne la latitude puis la longitude, par exemple « 47.6582, -2.7608 » (clic droit sur le lieu dans OpenStreetMap ou Google Maps)',
  'admin.pages.map.error.positionMissing':
    'il manque la position du lieu, par exemple « position : 47.6582, -2.7608 »',
  'admin.pages.map.error.zoom': 'le zoom est un nombre entier de {min} à {max}',
} satisfies Catalog;
