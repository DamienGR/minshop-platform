import { slugPart } from './slug.ts';
import { t } from '../i18n/index.ts';

/**
 * Product tags: identifiers a theme reads (ticket #159, ADR 0026).
 *
 * The core gives a tag no meaning. `non-cousu` hides the theme's "cousu main"
 * line because the THEME says so; `nouveau` is a badge because the theme draws
 * one. So a tag is an identifier, not a label: held to the slug rule, so the
 * merchant typing « Non cousu » and the import writing `non-cousu` are one
 * string, and a theme can match it without lower-casing or trimming.
 *
 * The twin of `normalizeTags()` in shopctl/src/catalog/contract.mjs, pinned to
 * it in test/scripts/catalog.test.mjs. Stored as one column of the product row,
 * comma-joined — a slug holds no comma — so every listing already reads it.
 */

export const TAG_MAX_LENGTH = 40;
export const TAGS_MAX = 20;

export type TagsResult = { tags: string[] } | { error: string };

/** Each value to its slug, duplicates dropped, order kept; refused rather than
 *  silently dropped when a value has nothing left or is too long. */
export function normalizeTags(values: string[]): TagsResult {
  const tags: string[] = [];
  for (const raw of values) {
    const written = raw.trim();
    if (!written) continue;
    const tag = slugPart(written);
    if (!tag) return { error: t('admin.products.tags.error.empty', { etiquette: written }) };
    if (tag.length > TAG_MAX_LENGTH) {
      return { error: t('admin.products.tags.error.long', { etiquette: written, max: TAG_MAX_LENGTH }) };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > TAGS_MAX) return { error: t('admin.products.tags.error.many', { max: TAGS_MAX }) };
  return { tags };
}

/** The admin field: tags separated by commas. */
export function parseTagsInput(input: string): TagsResult {
  return normalizeTags(input.split(','));
}

/** The column, or null for none. */
export function storeTags(tags: string[]): string | null {
  return tags.length > 0 ? tags.join(',') : null;
}

/** The column back as a list. Tolerant: whatever is stored, a theme gets slugs. */
export function readTags(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return stored
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag));
}
