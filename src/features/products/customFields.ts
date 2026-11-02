import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId.ts';
import { t } from '../i18n/index.ts';
import {
  CUSTOM_FIELD_MAX_LENGTH,
  CUSTOM_FIELDS_PER_PRODUCT,
  CUSTOM_HELP_MAX_LENGTH,
  CUSTOM_LABEL_MAX_LENGTH,
  customValueLength,
  type ProductCustomField,
} from './customization.ts';

/**
 * The free-text fields a merchant asks on a product (ticket #125, ADR 0022):
 * their reads, and the admin editor that writes them. The rules a buyer's
 * answer is judged by are pure, in customization.ts.
 */

// ── Reads ────────────────────────────────────────────────────────────────────

/** A product's fields in display order, unexecuted — for a batched read. */
export function listCustomFieldsStatement(db: D1Database, productId: number): D1PreparedStatement {
  return db
    .prepare('SELECT * FROM product_custom_fields WHERE product_id = ? ORDER BY position, id')
    .bind(productId);
}

export async function listCustomFields(db: D1Database, productId: number): Promise<ProductCustomField[]> {
  const { results } = await listCustomFieldsStatement(db, productId).all<ProductCustomField>();
  return results ?? [];
}

/**
 * The fields of every product a cart names, by product public ID, in one read
 * beside the cart's other three. Read for every line, not only the ones that
 * carry answers: a field the merchant made required after the line went into
 * the cart has to stop that line too.
 */
export async function listCustomFieldsByProductPublicIds(
  db: D1Database,
  productPublicIds: string[],
): Promise<ProductCustomField[]> {
  const unique = [...new Set(productPublicIds)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT f.* FROM product_custom_fields f
         JOIN products p ON p.id = f.product_id
        WHERE p.public_id IN (${ph})
        ORDER BY f.product_id, f.position, f.id`,
    )
    .bind(...unique)
    .all<ProductCustomField>();
  return results ?? [];
}

// ── Admin writes ─────────────────────────────────────────────────────────────

/**
 * The editor posts positionally aligned arrays, like the variants editor
 * beside it (variants.ts). Each row emits every field, so they stay aligned;
 * `c_required` is a select rather than a checkbox for that reason — an
 * unticked box posts nothing and would shift every row after it.
 *
 *   c_id[], c_label[], c_help[], c_max[], c_required[]   one entry per row
 *   c_remove[]                                          field ids to delete
 *
 * The route translates `cfld_` public IDs to row ids before calling either
 * function (api/admin/products/[id].ts).
 */
interface FieldRow {
  id: number | null;
  label: string;
  help_text: string | null;
  max_length: number;
  required: number;
}

function readRows(form: FormData): { rows: FieldRow[]; remove: Set<number> } {
  const all = (name: string) => form.getAll(name).map((v) => String(v));
  const remove = new Set(
    form.getAll('c_remove').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0),
  );
  const ids = all('c_id');
  const labels = all('c_label');
  const helps = all('c_help');
  const maxes = all('c_max');
  const required = all('c_required');
  const rows: FieldRow[] = [];
  for (let i = 0; i < labels.length; i++) {
    const id = Number(ids[i]);
    rows.push({
      id: Number.isInteger(id) && id > 0 ? id : null,
      label: (labels[i] ?? '').trim(),
      help_text: (helps[i] ?? '').trim() || null,
      max_length: Number(String(maxes[i] ?? '').trim()),
      required: required[i] === '0' ? 0 : 1,
    });
  }
  return { rows, remove };
}

/**
 * Refuse a mistyped field with nothing written, BEFORE the product's other
 * writes — the route runs it first, as it does validateVariantWeights, so an
 * error never sits on top of a half-saved edit.
 *
 * A blank NEW row is the editor's spare and is ignored; a blank label on an
 * existing row is ignored too (Remove deletes). Only rows that will be written
 * are judged.
 */
export function validateCustomFieldForm(form: FormData): string | null {
  const { rows, remove } = readRows(form);
  let kept = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.id != null && remove.has(row.id)) continue;
    if (!row.label) continue;
    kept++;
    const fail = (erreur: string) => t('admin.products.customization.error.row', { numero: i + 1, erreur });
    if (customValueLength(row.label) > CUSTOM_LABEL_MAX_LENGTH) {
      return fail(t('admin.products.customization.error.labelTooLong', { max: CUSTOM_LABEL_MAX_LENGTH }));
    }
    if (row.help_text && customValueLength(row.help_text) > CUSTOM_HELP_MAX_LENGTH) {
      return fail(t('admin.products.customization.error.helpTooLong', { max: CUSTOM_HELP_MAX_LENGTH }));
    }
    if (!Number.isInteger(row.max_length) || row.max_length < 1 || row.max_length > CUSTOM_FIELD_MAX_LENGTH) {
      return fail(t('admin.products.customization.error.maxLength', { max: CUSTOM_FIELD_MAX_LENGTH }));
    }
  }
  if (kept > CUSTOM_FIELDS_PER_PRODUCT) {
    return t('admin.products.customization.error.tooMany', { max: CUSTOM_FIELDS_PER_PRODUCT });
  }
  return null;
}

/**
 * Apply the editor: deletes, then updates and creates in row order, new rows
 * at the end. Only this product's fields are touched — a row id from another
 * product is skipped. Callers run validateCustomFieldForm first; this rechecks
 * for a direct caller that did not.
 */
export async function applyCustomFieldForm(
  db: D1Database,
  productId: number,
  form: FormData,
): Promise<{ error?: string }> {
  const invalid = validateCustomFieldForm(form);
  if (invalid) return { error: invalid };
  const { rows, remove } = readRows(form);
  const own = new Set((await listCustomFields(db, productId)).map((f) => f.id));

  const writes: D1PreparedStatement[] = [];
  for (const id of remove) {
    if (own.has(id)) {
      writes.push(db.prepare('DELETE FROM product_custom_fields WHERE id = ? AND product_id = ?').bind(id, productId));
    }
  }
  const creates: { row: FieldRow; position: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.id != null) {
      if (remove.has(row.id) || !row.label || !own.has(row.id)) continue;
      writes.push(
        db
          .prepare(
            `UPDATE product_custom_fields SET label = ?, help_text = ?, max_length = ?, required = ?, position = ?
              WHERE id = ? AND product_id = ?`,
          )
          .bind(row.label, row.help_text, row.max_length, row.required, i, row.id, productId),
      );
    } else if (row.label) {
      creates.push({ row, position: i });
    }
  }
  if (writes.length > 0) await db.batch(writes);
  for (const { row, position } of creates) {
    await withPublicId('customField', (publicId) =>
      db
        .prepare(
          `INSERT INTO product_custom_fields (public_id, product_id, label, help_text, max_length, required, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(publicId, productId, row.label, row.help_text, row.max_length, row.required, position)
        .run(),
    );
  }
  return {};
}
