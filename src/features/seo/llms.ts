import { plainTitle } from '../titleMarks/marks.ts';

/**
 * Lines of `/llms.txt` (src/pages/llms.txt.ts), pure so the suite can read
 * them with a theme's title codes (ticket #251).
 */

/** Markdown link text can't contain unescaped brackets; names and titles are
 *  free text, so strip brackets and collapse whitespace. Slugs are URL-safe
 *  already. */
export const llmsLinkText = (s: string) => s.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();

/** A published page: its title as plain text, the theme's codes removed
 *  before the brackets, which would leave the code's word behind. */
export function llmsPageLine(
  page: { title: string; slug: string },
  origin: string,
  titleMarks: readonly string[],
): string {
  return `- [${llmsLinkText(plainTitle(page.title, titleMarks))}](${origin}/pages/${page.slug})`;
}
