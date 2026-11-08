/**
 * The title and description a storefront document carries in `<title>`, the
 * meta description, `og:*` and `twitter:*` (ticket #216).
 *
 * Pure, so the admin's forms can show what an empty field leaves in its place
 * (the fields' placeholders) from the same rule the layout applies.
 */

/** The longest description a document carries, written or derived. */
export const META_DESCRIPTION_MAX = 160;

/**
 * A title the merchant wrote for search engines is used as it stands: what is
 * written is what Google shows, so it takes no « — {boutique} » suffix. Without
 * one, `{title} — {store}`, or the store's name alone.
 */
export function documentTitle(parts: {
  seoTitle?: string | null;
  title?: string | null;
  storeName: string;
}): string {
  if (parts.seoTitle) return parts.seoTitle;
  return parts.title ? `${parts.title} — ${parts.storeName}` : parts.storeName;
}
