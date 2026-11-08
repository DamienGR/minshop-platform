import { t } from '../i18n/index.ts';
import { oneLine } from '../i18n/spaces.ts';

/**
 * What a search engine shows of a page, as the merchant writes it (ticket #216,
 * migration 0057): a title and a description for a product, a category, a page,
 * and the home page's pair in the settings.
 *
 * Both are optional. Left empty, the storefront derives them as it always has
 * (`features/seo/meta.ts`), so a shop that never fills them does not change.
 *
 * The CLI's catalogue import holds an imported row to the same rule
 * (`shopctl/src/catalog/contract.mjs`, `seoText`), pinned to this one over a
 * shared corpus in test/scripts/catalog.test.mjs: a description the admin
 * refuses must not reach the store through a spreadsheet.
 */

/** Google shows about this many characters of a title. A guide the counter
 *  shows, not a limit: a longer title is the merchant's call. */
export const SEO_TITLE_GUIDE = 60;

/** The longest description stored: what the layout already keeps of a derived
 *  one, and about what a results page shows. Refused past it, never cut: a
 *  summary that stops mid-word reads worse than a message asking for less. */
export const SEO_DESCRIPTION_MAX = 160;

export interface SeoFields {
  seo_title: string | null;
  seo_description: string | null;
}

/** One line of plain text: runs of breaking whitespace fold to a space, the
 *  no-break spaces of French typography stay (ticket #218), null when nothing
 *  is left. A results page prints both on one line. */
export function seoText(value: unknown): string | null {
  const text = oneLine(String(value ?? ''));
  return text || null;
}

/** Characters as a reader counts them: an accented letter or an emoji is one. */
export function seoLength(text: string): number {
  return [...text].length;
}

/** Read `seo_title` and `seo_description` from an admin form. */
export function parseSeoFields(form: FormData): { data: SeoFields } | { error: string } {
  const seo_title = seoText(form.get('seo_title'));
  const seo_description = seoText(form.get('seo_description'));
  if (seo_description && seoLength(seo_description) > SEO_DESCRIPTION_MAX) {
    return { error: t('admin.seo.error.descriptionTooLong', { max: SEO_DESCRIPTION_MAX }) };
  }
  return { data: { seo_title, seo_description } };
}
