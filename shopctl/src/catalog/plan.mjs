/**
 * What the store would have to change to match the catalogue — decided before
 * anything is written, and refused as a whole when part of it is destructive.
 *
 * Pure: two descriptions in, one plan out. No disk, no network, no database.
 * That is what lets `--dry-run` be the SAME code path as the real import rather
 * than a second implementation that agrees with it right up until it doesn't —
 * the only difference between the two is whether the applier is handed the plan.
 *
 * Three properties the plan is built to have.
 *
 * **Idempotent by reference.** A product is matched on its SKU, a variant on its
 * own, an image on the hash of its bytes. Running the same file twice produces a
 * plan with nothing in it, which is the only honest definition of idempotent:
 * not "writes the same values again" but "has nothing to write".
 *
 * **Resumable without bookkeeping.** There is no journal to corrupt. An import
 * interrupted halfway leaves the store in a state the next run reads, and the
 * plan it computes from that state is exactly the remainder. This is why the
 * matching keys are all natural ones — a plan keyed on progress-so-far would
 * need the progress to have survived the interruption.
 *
 * **Explicit about loss.** Removing a sellable unit and changing a public URL
 * are not consequences an operator should discover in a diff afterwards, so each
 * one refuses the run and names the flag that authorises it. Nothing here ever
 * deletes a product or a variant: a variant that leaves the catalogue is
 * deactivated, because `order_items.variant_id` points at it and history is not
 * the catalogue's to rewrite.
 */
import { integer, integerOrNull, newPublicId, productIdBySku, text, textOrNull } from './sql.mjs';

/** Fields compared to decide whether a product row needs an UPDATE at all. */
const PRODUCT_FIELDS = ['name', 'slug', 'description', 'price_cents', 'stock', 'active', 'variant_label', 'weight_grams', 'requires_shipping'];
const VARIANT_FIELDS = ['label', 'price_cents', 'stock', 'weight_grams', 'position', 'active'];

function refusal(subject, message, hint = null) {
  return { subject, message, hint };
}

function index(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value == null || value === '') continue;
    const bucket = map.get(value);
    if (bucket) bucket.push(row);
    else map.set(value, [row]);
  }
  return map;
}

/**
 * @param {object[]} desired products from buildCatalogue + resolveCatalogueImages
 * @param {object} store the current catalogue, as read by store.mjs
 * @param {object} options
 * @param {string} options.currency the manifest's settlement currency
 * @param {boolean} [options.createCategories] create a category the CSV names and the store lacks
 * @param {boolean} [options.allowSlugChange] let a product's public URL move
 * @param {boolean} [options.allowRemoveVariants] let a sellable unit leave the catalogue
 */
export function planImport(desired, store, options) {
  const { currency, createCategories = false, allowSlugChange = false, allowRemoveVariants = false } = options;

  const refusals = [];
  const warnings = [];
  const statements = [];
  const uploads = [];
  const changes = [];
  const summary = {
    productsCreated: 0,
    productsUpdated: 0,
    productsUnchanged: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    variantsDeactivated: 0,
    categoriesCreated: 0,
    mediaUploaded: 0,
    mediaReused: 0,
  };

  const productsBySku = index(store.products, 'sku');
  const productsBySlug = index(store.products, 'slug');
  const variantsBySku = index(store.variants, 'sku');
  const categoriesBySlug = index(store.categories, 'slug');
  const mediaByKey = index(store.media, 'image_key');
  const variantsByProduct = new Map();
  for (const variant of store.variants) {
    const bucket = variantsByProduct.get(variant.product_id) ?? [];
    bucket.push(variant);
    variantsByProduct.set(variant.product_id, bucket);
  }
  const imagesByProduct = new Map();
  for (const image of store.productImages) {
    const bucket = imagesByProduct.get(image.product_id) ?? [];
    bucket.push(image);
    imagesByProduct.set(image.product_id, bucket);
  }
  const categoryLinks = new Map();
  for (const link of store.productCategories) {
    const bucket = categoryLinks.get(link.product_id) ?? new Set();
    bucket.add(link.category_id);
    categoryLinks.set(link.product_id, bucket);
  }

  // ── Media, once per distinct key across the whole file ────────────────────
  // Both counters are per DISTINCT key, not per reference: a photo ten products
  // share is one object and one row, and reporting it ten times would make the
  // report disagree with the bucket.
  const plannedMedia = new Set();
  const reusedMedia = new Set();
  for (const product of desired) {
    for (const media of product.media) {
      if (mediaByKey.has(media.key)) {
        if (!reusedMedia.has(media.key)) {
          reusedMedia.add(media.key);
          summary.mediaReused += 1;
        }
        continue;
      }
      if (plannedMedia.has(media.key)) continue;
      plannedMedia.add(media.key);
      summary.mediaUploaded += 1;
      // The object is written before the row, matching uploadMedia(): a row
      // pointing at a missing object shows a broken image everywhere it is used,
      // where an object with no row is an orphan nobody sees.
      uploads.push({ key: media.key, path: media.absolutePath, mime_type: media.mime_type, size_bytes: media.size_bytes });
      statements.push(
        `INSERT INTO media (image_key, original_name, mime_type, size_bytes, width, height, public_id)\n` +
          `  SELECT ${text(media.key)}, ${text(media.original_name)}, ${text(media.mime_type)}, ${integer(media.size_bytes)}, ` +
          `${integerOrNull(media.dimensions?.width ?? null)}, ${integerOrNull(media.dimensions?.height ?? null)}, ${newPublicId('med')}\n` +
          `   WHERE NOT EXISTS (SELECT 1 FROM media WHERE image_key = ${text(media.key)});`,
      );
    }
  }

  // ── Categories the file names ─────────────────────────────────────────────
  const wantedCategories = new Set(desired.flatMap((product) => product.categories));
  const plannedCategories = new Set();
  for (const slug of wantedCategories) {
    if (categoriesBySlug.has(slug)) continue;
    if (!createCategories) {
      refusals.push(refusal(
        slug,
        `la catégorie « ${slug} » n'existe pas dans la boutique.`,
        'Créez-la dans l\'administration, ou relancez avec --create-categories pour que l\'import la crée à partir de son slug.',
      ));
      continue;
    }
    if (plannedCategories.has(slug)) continue;
    plannedCategories.add(slug);
    summary.categoriesCreated += 1;
    changes.push({ kind: 'category.create', subject: slug });
    statements.push(
      `INSERT INTO categories (name, slug, public_id)\n` +
        `  SELECT ${text(titleFromSlug(slug))}, ${text(slug)}, ${newPublicId('cat')}\n` +
        `   WHERE NOT EXISTS (SELECT 1 FROM categories WHERE slug = ${text(slug)});`,
    );
  }

  // ── Products ──────────────────────────────────────────────────────────────
  for (const product of desired) {
    const bySku = productsBySku.get(product.sku) ?? [];
    if (bySku.length > 1) {
      refusals.push(refusal(product.sku, `la boutique contient ${bySku.length} produits portant la référence « ${product.sku} ».`, 'Une référence désigne un produit ; corrigez le doublon dans l\'administration avant d\'importer.'));
      continue;
    }
    let existing = bySku[0] ?? null;

    if (!existing) {
      // A product created in the admin before the catalogue existed carries no
      // reference. Adopting it by its URL is what lets a running store start
      // being maintained from a CSV; adopting one that already answers to a
      // DIFFERENT reference would give one row two identities.
      const bySlug = productsBySlug.get(product.slug) ?? [];
      const candidate = bySlug[0];
      if (candidate && candidate.sku && candidate.sku !== product.sku) {
        refusals.push(refusal(
          product.sku,
          `l'URL « ${product.slug} » appartient déjà au produit « ${candidate.sku} ».`,
          'Deux produits ne peuvent pas partager une URL. Donnez un slug explicite à l\'un des deux.',
        ));
        continue;
      }
      if (candidate) {
        existing = candidate;
        warnings.push(`« ${product.slug} » existait déjà sans référence : la référence « ${product.sku} » lui est attribuée.`);
      }
    }

    const currentVariants = existing ? (variantsByProduct.get(existing.id) ?? []) : [];
    const desiredVariantSkus = new Set(product.variants.map((variant) => variant.sku));

    // A sellable unit that leaves the catalogue stops being purchasable. That is
    // a commercial decision, not a consequence of editing a spreadsheet.
    const leaving = currentVariants.filter((variant) => variant.active === 1 && !(variant.sku && desiredVariantSkus.has(variant.sku)));
    if (leaving.length > 0 && !allowRemoveVariants) {
      refusals.push(refusal(
        product.sku,
        `le fichier retire ${leaving.length} unité(s) vendue(s) de « ${product.name} » : ${leaving.map((variant) => variant.sku ?? variant.label).join(', ')}.`,
        'Relancez avec --allow-remove-variants pour les désactiver. Elles ne sont jamais supprimées : une commande passée les référence.',
      ));
      continue;
    }

    if (existing && existing.slug !== product.slug && !allowSlugChange) {
      refusals.push(refusal(
        product.sku,
        `« ${product.sku} » déplacerait son URL de « ${existing.slug} » vers « ${product.slug} ».`,
        'Une URL publique retirée doit laisser une redirection derrière elle. Relancez avec --allow-slug-change une fois la redirection décidée.',
      ));
      continue;
    }

    // A variant reference that already belongs to somewhere else: importing it
    // here would either move a sold unit between products or create a second row
    // answering to one reference.
    let conflicted = false;
    for (const variant of product.variants) {
      const owners = (variantsBySku.get(variant.sku) ?? []).filter((row) => !existing || row.product_id !== existing.id);
      if (owners.length > 0) {
        refusals.push(refusal(variant.sku, `la référence de variante « ${variant.sku} » appartient déjà à un autre produit de la boutique.`));
        conflicted = true;
      }
      if ((variantsBySku.get(variant.sku) ?? []).length > 1) {
        refusals.push(refusal(variant.sku, `la boutique contient plusieurs variantes portant la référence « ${variant.sku} ».`, 'Corrigez le doublon dans l\'administration : l\'import ne peut pas choisir laquelle décrit le stock réel.'));
        conflicted = true;
      }
    }
    if (conflicted) continue;

    const productStatements = [];
    const productChanges = [];

    if (!existing) {
      summary.productsCreated += 1;
      productChanges.push({ kind: 'product.create', subject: product.sku, detail: product.name });
      productStatements.push(
        `INSERT INTO products (name, slug, sku, description, price_cents, currency, stock, active, variant_label, weight_grams, requires_shipping, public_id)\n` +
          `  VALUES (${text(product.name)}, ${text(product.slug)}, ${text(product.sku)}, ${textOrNull(product.description)}, ` +
          `${integer(product.price_cents)}, ${text(currency.toLowerCase())}, ${integer(product.stock)}, ${integer(product.active)}, ` +
          `${textOrNull(product.variant_label)}, ${integerOrNull(product.weight_grams)}, ${integer(product.requires_shipping)}, ${newPublicId('prod')});`,
      );
    } else {
      const differing = PRODUCT_FIELDS.filter((field) => !sameValue(existing[field], product[field]));
      // An adopted row has no reference yet, so it needs the UPDATE even when
      // every other field already matches.
      if (differing.length > 0 || existing.sku !== product.sku) {
        summary.productsUpdated += 1;
        productChanges.push({ kind: 'product.update', subject: product.sku, detail: differing.join(', ') || 'référence' });
        productStatements.push(
          `UPDATE products SET name = ${text(product.name)}, slug = ${text(product.slug)}, sku = ${text(product.sku)}, ` +
            `description = ${textOrNull(product.description)}, price_cents = ${integer(product.price_cents)}, ` +
            `stock = ${integer(product.stock)}, active = ${integer(product.active)}, variant_label = ${textOrNull(product.variant_label)}, ` +
            `weight_grams = ${integerOrNull(product.weight_grams)}, requires_shipping = ${integer(product.requires_shipping)}\n` +
            ` WHERE id = ${integer(existing.id)};`,
        );
      }
    }

    const productId = existing ? integer(existing.id) : productIdBySku(product.sku);

    // ── Variants ────────────────────────────────────────────────────────────
    const currentBySku = new Map(currentVariants.filter((variant) => variant.sku).map((variant) => [variant.sku, variant]));
    for (const variant of product.variants) {
      const current = currentBySku.get(variant.sku);
      const wanted = { ...variant, active: 1 };
      if (!current) {
        summary.variantsCreated += 1;
        productChanges.push({ kind: 'variant.create', subject: variant.sku, detail: variant.label });
        productStatements.push(
          `INSERT INTO product_variants (product_id, label, price_cents, stock, sku, position, active, weight_grams, public_id)\n` +
            `  SELECT ${productId}, ${text(variant.label)}, ${integer(variant.price_cents)}, ${integer(variant.stock)}, ${text(variant.sku)}, ` +
            `${integer(variant.position)}, 1, ${integerOrNull(variant.weight_grams)}, ${newPublicId('var')}\n` +
            `   WHERE NOT EXISTS (SELECT 1 FROM product_variants WHERE sku = ${text(variant.sku)});`,
        );
        continue;
      }
      const differing = VARIANT_FIELDS.filter((field) => !sameValue(current[field], wanted[field]));
      if (differing.length === 0) continue;
      summary.variantsUpdated += 1;
      productChanges.push({ kind: 'variant.update', subject: variant.sku, detail: differing.join(', ') });
      productStatements.push(
        `UPDATE product_variants SET label = ${text(variant.label)}, price_cents = ${integer(variant.price_cents)}, ` +
          `stock = ${integer(variant.stock)}, position = ${integer(variant.position)}, active = 1, ` +
          `weight_grams = ${integerOrNull(variant.weight_grams)}\n WHERE id = ${integer(current.id)};`,
      );
    }
    for (const variant of leaving) {
      summary.variantsDeactivated += 1;
      productChanges.push({ kind: 'variant.deactivate', subject: variant.sku ?? variant.label });
      productStatements.push(`UPDATE product_variants SET active = 0 WHERE id = ${integer(variant.id)};`);
    }

    // ── Category links ──────────────────────────────────────────────────────
    const currentLinks = existing ? (categoryLinks.get(existing.id) ?? new Set()) : new Set();
    const wantedIds = product.categories
      .map((slug) => (categoriesBySlug.get(slug) ?? [])[0]?.id ?? null)
      .filter((id) => id != null);
    const linksMatch =
      // Categories the same run creates have no id yet, so a product that wants
      // one is never "already linked".
      wantedIds.length === product.categories.length &&
      wantedIds.length === currentLinks.size &&
      wantedIds.every((id) => currentLinks.has(id));
    if (!linksMatch) {
      productChanges.push({ kind: 'categories.set', subject: product.sku, detail: product.categories.join(', ') || 'aucune' });
      productStatements.push(`DELETE FROM product_categories WHERE product_id = ${productId};`);
      for (const slug of product.categories) {
        productStatements.push(
          `INSERT INTO product_categories (product_id, category_id)\n` +
            `  SELECT ${productId}, (SELECT id FROM categories WHERE slug = ${text(slug)})\n` +
            `   WHERE EXISTS (SELECT 1 FROM categories WHERE slug = ${text(slug)});`,
        );
      }
    }

    // ── Gallery ─────────────────────────────────────────────────────────────
    const currentImages = (existing ? (imagesByProduct.get(existing.id) ?? []) : [])
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const wantedKeys = product.media.map((media) => media.key);
    const galleryMatches =
      currentImages.length === wantedKeys.length && currentImages.every((image, position) => image.image_key === wantedKeys[position]);
    if (!galleryMatches) {
      productChanges.push({ kind: 'images.set', subject: product.sku, detail: `${wantedKeys.length} image(s)` });
      productStatements.push(`DELETE FROM product_images WHERE product_id = ${productId};`);
      for (const [position, key] of wantedKeys.entries()) {
        productStatements.push(
          `INSERT INTO product_images (product_id, image_key, position, public_id)\n` +
            `  VALUES (${productId}, ${text(key)}, ${integer(position)}, ${newPublicId('pimg')});`,
        );
      }
      // A variant may point at a gallery row (0018). Rebuilding the gallery
      // gives it new row ids, so any variant still holding an old one is left
      // pointing at nothing; clear those rather than leaving a dangling id.
      productStatements.push(
        `UPDATE product_variants SET image_id = NULL\n` +
          ` WHERE product_id = ${productId} AND image_id IS NOT NULL\n` +
          `   AND image_id NOT IN (SELECT id FROM product_images WHERE product_id = ${productId});`,
      );
      // The denormalized primary is the first gallery image — the same rule
      // syncPrimaryImage() applies, expressed once here rather than assumed.
      productStatements.push(
        `UPDATE products SET image_key = (SELECT image_key FROM product_images WHERE product_id = ${productId} ORDER BY position, id LIMIT 1)\n` +
          ` WHERE id = ${productId};`,
      );
    }

    if (productStatements.length === 0) {
      summary.productsUnchanged += 1;
      continue;
    }
    statements.push(...productStatements);
    changes.push(...productChanges);
  }

  // Products the store holds and the file does not are LEFT ALONE. A CSV is not
  // required to be the whole catalogue — an import of one supplier's range must
  // not retire another's — so the plan reports them and touches nothing.
  const claimed = new Set(desired.map((product) => product.sku));
  const untouched = store.products.filter((product) => !product.sku || !claimed.has(product.sku));

  // A refused plan carries NO work. The command already declines to apply one,
  // but a plan object that still holds statements is one careless caller away
  // from a half-imported catalogue — and "half" is the state nobody can name.
  // The summary survives, because it is what the refusal is explaining.
  return {
    statements: refusals.length > 0 ? [] : statements,
    uploads: refusals.length > 0 ? [] : uploads,
    changes,
    refusals,
    warnings,
    untouched: untouched.map((product) => ({ sku: product.sku ?? null, slug: product.slug, name: product.name })),
    summary,
  };
}

/** SQLite stores no `undefined`, and an absent column reads as null. */
function sameValue(current, wanted) {
  const left = current === undefined ? null : current;
  const right = wanted === undefined ? null : wanted;
  if (left === null || right === null) return left === right;
  return String(left) === String(right);
}

/** A display name for a category the file only names by slug. Deliberately
 *  crude: the merchant renames it in the admin, and a wrong guess there is
 *  visible and free to fix, unlike a wrong slug, which is a URL. */
function titleFromSlug(slug) {
  const words = slug.split('-');
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(' ');
}
