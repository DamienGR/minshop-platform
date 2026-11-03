/**
 * A sentence with a few words set apart, kept whole for the translator.
 *
 * A sentence that bolds two words used to be five keys and five pieces of
 * markup, one per line: « Facultatif. », « Les variantes », « sont des
 * choix… ». Astro drops the line break between two pieces, so the page read
 * « Facultatif.Les variantessont des choix » (ticket #160), and a translator
 * saw fragments no language orders the same way. A key now holds the sentence,
 * and three marks say which words are set apart:
 *
 *   **mot**    bold          → <strong>
 *   `mot`      an identifier → <code>
 *   [mot]      a link        → <a>, whose address the template supplies
 *
 * The marks are read off the catalog's own text, BEFORE the placeholders are
 * filled in: a store name or a product name that contains `**` stays text.
 * A mark that is not closed is text too. Pure, and a leaf like `locale.ts`.
 */

export type RichMark = 'strong' | 'code' | 'link';

export interface RichSegment {
  text: string;
  /** null for plain text. */
  mark: RichMark | null;
}

const MARKS = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]/g;

/** Split a catalog string into plain and marked runs, in order. */
export function richSegments(message: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let last = 0;
  for (const match of message.matchAll(MARKS)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: message.slice(last, at), mark: null });
    const [, strong, code, link] = match;
    if (strong !== undefined) segments.push({ text: strong, mark: 'strong' });
    else if (code !== undefined) segments.push({ text: code, mark: 'code' });
    else segments.push({ text: link!, mark: 'link' });
    last = at + match[0].length;
  }
  if (last < message.length) segments.push({ text: message.slice(last), mark: null });
  return segments;
}
