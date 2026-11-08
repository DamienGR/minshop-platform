/**
 * The CSV contract: which columns exist, what a cell may hold, and what a set of
 * rows has to agree on before any of it reaches a store.
 *
 * The file is a MERCHANT artefact maintained in a spreadsheet, so the contract
 * is deliberately stricter than the admin form is. A form field is typed once by
 * someone looking at it; a column is filled by dragging a cell down two hundred
 * rows, exported by a tool that decides on its own what a leading zero means,
 * and re-imported months later by someone who did not write it. Every rule below
 * exists because the failure it prevents is silent: a price that reads as valid
 * and is off by a factor of a hundred, a stock of `3.0` truncated to `3` in one
 * place and `0` in another, two rows claiming the same reference where the later
 * one wins and nobody sees the earlier one disappear.
 *
 * Column NAMES are English, like the manifest's keys and the database's columns,
 * and the prose around them is French, like every message the CLI prints. That
 * is the same boundary ADR 0018 draws: an identifier is read by the machine and
 * by whoever maps a supplier export onto it, a sentence is read by the operator.
 *
 * Nothing here touches a database. The contract turns text into a DESIRED
 * catalogue — plan.mjs is what compares that to the store, and it is the only
 * module that can decide a change is destructive.
 */

/** Identity, and the reason the whole file has one. */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

/** Slug shape, matching what slugify() produces and what the store's routes serve. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Minor units per major unit, for the currencies a manifest may declare.
 *
 * One entry, because `client.currency` is an enum with one value and widening it
 * is a schema-version decision (ADR 0008). A table rather than a constant so the
 * second currency has an obvious place to land, and an unknown code is refused
 * rather than silently scaled by a hundred.
 */
export const MINOR_UNITS = { EUR: 100 };

/**
 * The columns, in the order a generated template writes them.
 *
 * `scope` is what makes a multi-row product checkable: `product` columns
 * describe the thing being sold and must agree across every row of a group,
 * `unit` columns describe one sellable line and are read per row.
 */
export const COLUMNS = [
  { name: 'sku', scope: 'unit', required: true, description: 'Référence de l\'unité vendue. Identité de l\'import : c\'est sur elle que la reprise et le réimport se reconnaissent.' },
  { name: 'product', scope: 'unit', required: false, description: 'Référence du produit parent, pour regrouper les lignes d\'un produit à variantes. Vide pour un produit simple.' },
  { name: 'name', scope: 'product', required: false, description: 'Nom affiché. Obligatoire sur la première ligne d\'un produit.' },
  { name: 'slug', scope: 'product', required: false, description: 'Segment d\'URL. Vide : dérivé du nom.' },
  { name: 'description', scope: 'product', required: false, description: 'Texte de la fiche, en Markdown.' },
  { name: 'variant_group', scope: 'product', required: false, description: 'Nom du groupe de variantes affiché à l\'acheteur (« Taille »). Obligatoire dès qu\'une ligne porte une variante.' },
  { name: 'variant', scope: 'unit', required: false, description: 'Libellé de la variante (« M »). Vide : produit simple.' },
  { name: 'price', scope: 'unit', required: true, description: 'Prix TTC en unités majeures. « 19,90 » ou « 19.90 ».' },
  { name: 'stock', scope: 'unit', required: true, description: 'Quantité disponible, entier positif ou nul.' },
  { name: 'weight_grams', scope: 'unit', required: false, description: 'Poids emballé en grammes. Vide = inconnu, ce qui n\'est pas zéro.' },
  { name: 'requires_shipping', scope: 'product', required: false, description: 'oui/non. Défaut oui.' },
  { name: 'active', scope: 'product', required: false, description: 'oui/non. Défaut oui.' },
  { name: 'categories', scope: 'product', required: false, description: 'Slugs de catégories séparés par « | ».' },
  { name: 'tags', scope: 'product', required: false, description: 'Étiquettes que le thème lit (« non-cousu », « nouveau »), séparées par « | ». Colonne absente : les étiquettes de la boutique restent ; colonne vide : elles sont retirées.' },
  { name: 'seo_title', scope: 'product', required: false, description: 'Titre pour Google, affiché tel quel sans le nom de la boutique ; une soixantaine de caractères. Colonne absente : le titre saisi dans la boutique reste ; colonne vide : il est retiré, et le nom du produit reprend sa place.' },
  { name: 'seo_description', scope: 'product', required: false, description: 'Description pour Google, 160 caractères au plus. Colonne absente : celle saisie dans la boutique reste ; colonne vide : elle est retirée, et le début de la description reprend sa place.' },
  { name: 'images', scope: 'product', required: false, description: 'Chemins d\'images relatifs au CSV, séparés par « | ». La première est la principale.' },
];

const COLUMN_NAMES = COLUMNS.map((column) => column.name);
const PRODUCT_SCOPED = COLUMNS.filter((column) => column.scope === 'product').map((column) => column.name);

/** The separator inside a multi-value cell. A comma would need quoting in half
 *  the rows of a CSV, which is exactly where a spreadsheet stops cooperating. */
const LIST_SEPARATOR = '|';

/**
 * Turn arbitrary text into a URL-safe slug.
 *
 * A deliberate second copy of `src/features/products/slug.ts`: the store's lives
 * in the Worker bundle and this one runs in a CLI that has no build step and no
 * `node_modules`. Two copies of a pure rule drift, so they are pinned against
 * each other over a shared corpus in test/scripts/catalog.test.mjs — a divergence
 * fails a gate instead of producing a store where the same name yields two
 * different URLs depending on who wrote the row.
 */
export function slugify(input) {
  return slugPart(input) || 'product';
}

/** The slug of a text, or '' when nothing survives — the twin of `slugPart()`
 *  in `src/features/products/slug.ts`, and what a tag is held to. */
export function slugPart(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** A tag is an identifier a theme matches on (ticket #159, ADR 0026). */
export const TAG_MAX_LENGTH = 40;
export const TAGS_MAX = 20;

/**
 * Normalise a product's tags: each to its slug, duplicates dropped, order kept.
 *
 * The twin of `normalizeTags()` in `src/features/products/tags.ts`, pinned to
 * it over a shared corpus in test/scripts/catalog.test.mjs: a tag typed in the
 * admin and the same tag imported must be one string, or the theme matching
 * `non-cousu` sees one and misses the other. The messages differ — this one
 * speaks to an operator reading a report.
 *
 * @param {string[]} values
 * @returns {{ tags: string[] }|{ error: string }}
 */
export function normalizeTags(values) {
  const tags = [];
  for (const raw of values) {
    const written = String(raw).trim();
    if (!written) continue;
    const tag = slugPart(written);
    if (!tag) return { error: `« ${written} » n'est pas une étiquette : il faut au moins une lettre ou un chiffre.` };
    if (tag.length > TAG_MAX_LENGTH) {
      return { error: `« ${written} » fait plus de ${TAG_MAX_LENGTH} caractères une fois normalisée.` };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > TAGS_MAX) return { error: `${tags.length} étiquettes ; ${TAGS_MAX} au plus.` };
  return { tags };
}

/** What a search engine shows of a product (ticket #216): the description
 *  is held to this many characters, the title only guided. */
export const SEO_DESCRIPTION_MAX = 160;

/** `\s` less the no-break spaces (U+00A0, U+2007, U+202F): a file typed the
 *  French way keeps its space before « : » and inside « » (ticket #218). The
 *  twin of `oneLine()` in `src/features/i18n/spaces.ts`. */
const BREAKING_SPACES = /[^\S\u00a0\u2007\u202f]+/g;

/**
 * One line of plain text for a search engine, or null when nothing is left.
 *
 * The twin of `seoText()` in `src/features/seo/fields.ts`, pinned to it over a
 * shared corpus in test/scripts/catalog.test.mjs: the same text typed in the
 * admin and imported must be one string, or every re-import reports a change.
 *
 * @param {string} value
 * @returns {string|null}
 */
export function seoText(value) {
  const text = String(value ?? '').replace(BREAKING_SPACES, ' ').trim();
  return text || null;
}

/** One refusal, addressed to a place in the file. */
function issue(line, column, message, hint = null) {
  return { line, column, message, hint };
}

/**
 * Parse a price written the way a French spreadsheet writes it.
 *
 * The thousands separators are the three a locale actually emits — the narrow
 * no-break space `fr-FR` uses (U+202F), the no-break space older builds emit
 * (U+00A0), and the ordinary space someone types by hand — and they are removed
 * only BETWEEN digits, so a value that is merely two numbers with a space
 * between them stays an error instead of silently becoming one number.
 *
 * A price with more decimals than the currency has is refused rather than
 * rounded. Rounding here is the failure that never gets noticed: the catalogue
 * says 19,995 and the store charges 20,00 forever.
 *
 * @returns {{ cents: number }|{ error: string }}
 */
export function parsePrice(text, currency) {
  const scale = MINOR_UNITS[currency];
  if (!scale) return { error: `la devise « ${currency} » n'est pas gérée par l'import.` };

  const raw = String(text).trim();
  if (!raw) return { error: 'le prix est vide.' };

  const compact = raw.replace(/(?<=\d)[\u202f\u00a0 ](?=\d)/g, '');
  const normalised = compact.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalised)) {
    return { error: `« ${raw} » n'est pas un prix. Attendu : un nombre positif, « 19,90 » ou « 19.90 », sans symbole monétaire.` };
  }

  const [whole, fraction = ''] = normalised.split('.');
  const decimals = String(scale).length - 1;
  if (fraction.length > decimals) {
    return { error: `« ${raw} » a ${fraction.length} décimales ; ${currency} en compte ${decimals}. Un arrondi silencieux facturerait un autre prix que celui écrit ici.` };
  }
  const cents = Number(whole) * scale + Number((fraction + '0'.repeat(decimals)).slice(0, decimals) || 0);
  if (!Number.isSafeInteger(cents)) return { error: `« ${raw} » dépasse ce qu'un montant entier peut représenter.` };
  return { cents };
}

/**
 * Parse a whole non-negative count.
 *
 * `3.0` is refused, not truncated: a spreadsheet writes it when a column has
 * been formatted as a decimal, and the same file then means "three" here and
 * whatever a different tool decides elsewhere.
 */
export function parseCount(text, { field }) {
  const raw = String(text).trim();
  if (!raw) return { error: `${field} est vide.` };
  if (!/^\d+$/.test(raw)) {
    return { error: `« ${raw} » n'est pas un entier positif ou nul pour ${field}.` };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { error: `« ${raw} » dépasse ce qu'un entier peut représenter.` };
  return { value };
}

/** oui/non, in the spellings a French and an English speaker both reach for. */
const TRUTHY = new Set(['oui', 'o', 'yes', 'y', 'true', 'vrai', '1']);
const FALSY = new Set(['non', 'n', 'no', 'false', 'faux', '0']);

export function parseBoolean(text, { field, fallback }) {
  const raw = String(text).trim().toLowerCase();
  if (!raw) return { value: fallback };
  if (TRUTHY.has(raw)) return { value: 1 };
  if (FALSY.has(raw)) return { value: 0 };
  return { error: `« ${text.trim()} » n'est ni oui ni non pour ${field}.` };
}

function splitList(text) {
  return String(text)
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Validate a parsed CSV against the contract and build the desired catalogue.
 *
 * Every issue found is COLLECTED rather than thrown. An operator fixing a
 * two-hundred-row export needs the list, not the first line of it; a validator
 * that stops at the first problem turns one pass into twenty.
 *
 * @param {{ columns: string[], rows: Array<{ line: number, cells: Record<string,string> }> }} parsed
 * @param {{ currency: string }} options
 * @returns {{ products: object[], issues: object[] }}
 */
export function buildCatalogue(parsed, { currency }) {
  const issues = [];

  const unknown = parsed.columns.filter((name) => !COLUMN_NAMES.includes(name));
  for (const name of unknown) {
    issues.push(issue(1, name, `colonne inconnue « ${name} ».`, `Colonnes du contrat : ${COLUMN_NAMES.join(', ')}.`));
  }
  for (const column of COLUMNS) {
    if (column.required && !parsed.columns.includes(column.name)) {
      issues.push(issue(1, column.name, `colonne « ${column.name} » absente ; elle est obligatoire.`, column.description));
    }
  }
  // Without the required columns every row would fail for the same reason, and
  // two hundred repetitions of one header mistake hide everything else.
  if (issues.length > 0) return { products: [], issues };

  /** @type {Map<string, object>} */
  const groups = new Map();
  /** @type {Map<string, number>} */
  const skuLines = new Map();

  for (const row of parsed.rows) {
    const cell = (name) => (row.cells[name] ?? '').trim();
    const sku = cell('sku');

    if (!sku) {
      issues.push(issue(row.line, 'sku', 'ligne sans sku.', 'La référence est l\'identité de l\'import : sans elle, un réimport crée un doublon au lieu de mettre à jour.'));
      continue;
    }
    if (!SKU_PATTERN.test(sku)) {
      issues.push(issue(row.line, 'sku', `« ${sku} » n'est pas une référence utilisable.`, 'Lettres, chiffres, point, tiret, tiret bas et barre oblique ; 64 caractères au plus, commençant par une lettre ou un chiffre.'));
      continue;
    }
    if (skuLines.has(sku)) {
      issues.push(issue(row.line, 'sku', `la référence « ${sku} » est déjà utilisée ligne ${skuLines.get(sku)}.`, 'Deux lignes pour une référence : l\'import ne peut pas savoir laquelle décrit le stock réel.'));
      continue;
    }
    skuLines.set(sku, row.line);

    const parent = cell('product');
    const variant = cell('variant');
    if (parent && !SKU_PATTERN.test(parent)) {
      issues.push(issue(row.line, 'product', `« ${parent} » n'est pas une référence produit utilisable.`));
      continue;
    }
    if (parent && !variant) {
      issues.push(issue(row.line, 'variant', `la ligne rattache « ${sku} » au produit « ${parent} » sans nommer de variante.`, 'Un produit parent n\'a de sens que si ses lignes sont des variantes distinctes.'));
      continue;
    }
    if (variant && !parent) {
      issues.push(issue(row.line, 'product', `la variante « ${variant} » ne dit pas à quel produit elle appartient.`, 'Renseignez « product » avec la référence du produit parent, identique sur toutes ses variantes.'));
      continue;
    }

    const key = parent || sku;
    const isVariantRow = Boolean(variant);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sku: parent || sku,
        line: row.line,
        hasVariants: isVariantRow,
        product: {},
        productLines: {},
        units: [],
      };
      groups.set(key, group);
    }
    if (group.hasVariants !== isVariantRow) {
      issues.push(issue(row.line, 'variant', `« ${key} » mélange une ligne avec variante et une ligne sans.`, 'Un produit a des variantes ou n\'en a pas ; il ne peut pas avoir les deux.'));
      continue;
    }
    if (!isVariantRow && group.units.length > 0) {
      issues.push(issue(row.line, 'sku', `« ${key} » a déjà une ligne ligne ${group.line}.`, 'Un produit simple tient sur une ligne.'));
      continue;
    }

    // Product-scoped cells: identical or empty on every row of the group. This
    // is the "variante incohérente" the plan asks about — two rows of one
    // product disagreeing on its name, its categories or its images, where the
    // importer would otherwise pick whichever row it happened to read last.
    let conflicted = false;
    for (const name of PRODUCT_SCOPED) {
      const value = cell(name);
      if (!value) continue;
      if (group.product[name] === undefined) {
        group.product[name] = value;
        group.productLines[name] = row.line;
      } else if (group.product[name] !== value) {
        issues.push(issue(
          row.line,
          name,
          `« ${key} » donne deux valeurs pour « ${name} » : « ${group.product[name]} » ligne ${group.productLines[name]}, « ${value} » ici.`,
          'Une colonne de produit décrit le produit, pas la ligne : laissez-la vide sur les variantes suivantes.',
        ));
        conflicted = true;
      }
    }
    if (conflicted) continue;

    const unit = { sku, line: row.line, label: variant || null };

    const price = parsePrice(cell('price'), currency);
    if (price.error) issues.push(issue(row.line, 'price', price.error));
    else unit.price_cents = price.cents;

    const stock = parseCount(cell('stock'), { field: 'stock' });
    if (stock.error) issues.push(issue(row.line, 'stock', stock.error));
    else unit.stock = stock.value;

    const weightRaw = cell('weight_grams');
    if (weightRaw) {
      const weight = parseCount(weightRaw, { field: 'weight_grams' });
      if (weight.error) issues.push(issue(row.line, 'weight_grams', weight.error));
      else unit.weight_grams = weight.value;
    } else {
      // Unknown, which is not zero (migration 0030): a guessed weight
      // under-charges shipping on every order it touches.
      unit.weight_grams = null;
    }

    group.units.push(unit);
  }

  const products = [];
  for (const group of groups.values()) {
    const at = (name) => group.productLines[name] ?? group.line;
    const value = (name) => group.product[name] ?? '';

    const name = value('name');
    if (!name) {
      issues.push(issue(group.line, 'name', `« ${group.key} » n'a pas de nom.`, 'Le nom se donne une fois, sur n\'importe quelle ligne du produit.'));
      continue;
    }

    // A parent reference that is ALSO a line's own sku describes two things with
    // one identity — the product and one of the units inside it — and a later
    // import cannot tell which of the two a row means. The unique index could
    // only report "constraint failed" on whichever INSERT lost.
    if (group.hasVariants && skuLines.has(group.sku)) {
      issues.push(issue(
        group.line,
        'product',
        `« ${group.sku} » est à la fois le produit parent et la référence vendue ligne ${skuLines.get(group.sku)}.`,
        'Donnez au produit parent sa propre référence, distincte de celles de ses variantes.',
      ));
      continue;
    }

    const slugCell = value('slug');
    const slug = slugCell || slugify(name);
    if (!SLUG_PATTERN.test(slug)) {
      issues.push(issue(at('slug'), 'slug', `« ${slugCell} » n'est pas un segment d'URL utilisable.`, 'Minuscules, chiffres et tirets simples.'));
      continue;
    }

    const variantGroup = value('variant_group');
    if (group.hasVariants && !variantGroup) {
      issues.push(issue(group.line, 'variant_group', `« ${group.key} » a des variantes sans nom de groupe.`, 'C\'est le libellé que l\'acheteur lit au-dessus du choix : « Taille », « Couleur ».'));
      continue;
    }
    if (!group.hasVariants && variantGroup) {
      issues.push(issue(at('variant_group'), 'variant_group', `« ${group.key} » nomme un groupe de variantes mais n'en a aucune.`));
      continue;
    }

    const active = parseBoolean(value('active'), { field: 'active', fallback: 1 });
    if (active.error) issues.push(issue(at('active'), 'active', active.error));
    const shipping = parseBoolean(value('requires_shipping'), { field: 'requires_shipping', fallback: 1 });
    if (shipping.error) issues.push(issue(at('requires_shipping'), 'requires_shipping', shipping.error));

    const categories = splitList(value('categories'));
    for (const category of categories) {
      if (!SLUG_PATTERN.test(category)) {
        issues.push(issue(at('categories'), 'categories', `« ${category} » n'est pas un slug de catégorie.`, 'Les catégories se désignent par leur slug, pas par leur nom affiché.'));
      }
    }
    if (new Set(categories).size !== categories.length) {
      issues.push(issue(at('categories'), 'categories', `« ${group.key} » répète une catégorie.`));
    }

    // Absent column, undefined: the plan then leaves the store's tags alone,
    // so a catalogue written before the column existed cannot wipe what the
    // merchant set in the admin. Present, the file is the truth, empty or not.
    let tags;
    if (parsed.columns.includes('tags')) {
      const normalised = normalizeTags(splitList(value('tags')));
      if (normalised.error) issues.push(issue(at('tags'), 'tags', normalised.error, 'Lettres, chiffres et tirets ; « Pièce unique » devient « piece-unique ».'));
      else tags = normalised.tags;
    }

    // The same absent-or-empty rule as `tags`: a file written before the
    // columns existed cannot wipe the titles and descriptions the merchant
    // wrote in the admin, and a present column is the truth, an empty cell
    // clearing the field so the store derives it again.
    const seo = {};
    for (const field of ['seo_title', 'seo_description']) {
      if (parsed.columns.includes(field)) seo[field] = seoText(value(field));
    }
    if (seo.seo_description && [...seo.seo_description].length > SEO_DESCRIPTION_MAX) {
      issues.push(issue(
        at('seo_description'),
        'seo_description',
        `« ${group.key} » a une description pour Google de ${[...seo.seo_description].length} caractères ; ${SEO_DESCRIPTION_MAX} au plus.`,
        'Refusée plutôt que coupée : un résumé arrêté au milieu d\'un mot se lit plus mal qu\'un résumé resserré.',
      ));
    }

    const images = splitList(value('images')).map((path) => ({ path, line: at('images') }));
    if (new Set(images.map((image) => image.path)).size !== images.length) {
      issues.push(issue(at('images'), 'images', `« ${group.key} » répète une image.`));
    }

    const units = group.units;
    if (units.length === 0) continue;
    if (group.hasVariants && new Set(units.map((unit) => unit.label)).size !== units.length) {
      issues.push(issue(group.line, 'variant', `« ${group.key} » a deux variantes du même libellé.`, 'Deux lignes portant « M » laissent l\'acheteur choisir entre deux options identiques.'));
      continue;
    }
    // A group whose units did not all parse describes a product whose price or
    // stock is unknown; reporting it as importable would be a second, misleading
    // finding on top of the real one.
    if (units.some((unit) => unit.price_cents === undefined || unit.stock === undefined)) continue;

    products.push({
      key: group.key,
      line: group.line,
      sku: group.sku,
      name,
      slug,
      description: value('description') || null,
      variant_label: group.hasVariants ? variantGroup : null,
      active: active.value ?? 1,
      requires_shipping: shipping.value ?? 1,
      categories,
      ...(tags !== undefined ? { tags: tags.length > 0 ? tags.join(',') : null } : {}),
      ...seo,
      images,
      // With variants the product row is not the sellable unit: its price is
      // what a card shows ("from"), so it is the cheapest variant, and its stock
      // is the group's total. serialize.ts already derives availability from the
      // variants themselves, so neither value can contradict what is on sale.
      price_cents: group.hasVariants ? Math.min(...units.map((unit) => unit.price_cents)) : units[0].price_cents,
      stock: group.hasVariants ? units.reduce((total, unit) => total + unit.stock, 0) : units[0].stock,
      weight_grams: group.hasVariants ? null : units[0].weight_grams,
      variants: group.hasVariants
        ? units.map((unit, position) => ({
            sku: unit.sku,
            label: unit.label,
            price_cents: unit.price_cents,
            stock: unit.stock,
            weight_grams: unit.weight_grams,
            position,
            line: unit.line,
          }))
        : [],
    });
  }

  // Two products may not claim one URL, and the store's UNIQUE index would only
  // be able to say which INSERT failed, not which two rows disagreed.
  const slugLines = new Map();
  for (const product of products) {
    const previous = slugLines.get(product.slug);
    if (previous !== undefined) {
      issues.push(issue(product.line, 'slug', `deux produits veulent l'URL « ${product.slug} » (déjà pris ligne ${previous}).`, 'Renseignez « slug » explicitement sur l\'un des deux.'));
    } else {
      slugLines.set(product.slug, product.line);
    }
  }

  issues.sort((a, b) => a.line - b.line);
  return { products, issues };
}

/** The header row of a template, so a merchant starts from the contract itself. */
export function templateHeader() {
  return `${COLUMN_NAMES.join(',')}\n`;
}
