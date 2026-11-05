/**
 * A photo beside its text (ticket #195): the title of a Markdown image, one
 * word of two — `![Mes mains à l’atelier](/images/… "gauche")`, or `"droite"`.
 *
 * CommonMark already has the slot, so a reader that does not know the words
 * still shows the image. The renderer (markdown.ts) turns the word into a
 * class from the closed list below and never writes the word out, which keeps
 * invariant 11: nothing a merchant types becomes markup. Pure, for the
 * renderer and the page editor's script alike.
 */
export type MediaSide = 'left' | 'right';

/** The words as the merchant writes them, in the editor and in the guide. */
export type MediaSideWord = 'gauche' | 'droite';

const SIDES = new Map<string, MediaSide>([
  ['gauche', 'left'],
  ['droite', 'right'],
]);

/** The side an image's title names, or null for any other title (or none). */
export function mediaSideOf(title: string | null | undefined): MediaSide | null {
  return SIDES.get((title ?? '').trim().toLowerCase()) ?? null;
}

/**
 * Image syntax as the editor writes it: `![alt](destination)`, with an
 * optional title. Group 1 runs up to the end of the destination, group 2 is
 * the quoted title. The alt span takes escaped brackets, which is how the
 * editor writes one (edit.astro's `media:selected` handler).
 */
const IMAGE =
  /(!\[(?:\\.|[^\\\]\n])*\]\(\s*(?:<[^>\n]*>|[^\s)]+))(?:\s+("[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

export interface SideEdit {
  /** The line, rewritten. */
  line: string;
  /** Where the image now starts and ends in it, for the editor to select. */
  start: number;
  end: number;
}

/**
 * The editor's « À gauche » and « À droite » buttons: the line with its image
 * set to `word`'s side, or back to full width when the image already stands
 * there, so a second press undoes the first. Any other title is replaced: an
 * image has one title, and the merchant just asked for this one.
 *
 * `caret` is an offset into the line; it picks the image it falls in when the
 * line holds several, the first one otherwise. Null when the line holds none.
 */
export function toggleImageSide(line: string, caret: number, word: MediaSideWord): SideEdit | null {
  const matches = [...line.matchAll(IMAGE)];
  if (matches.length === 0) return null;
  const match =
    matches.find((m) => m.index <= caret && caret <= m.index + m[0].length) ?? matches[0];
  const head = match[1];
  const title = match[2]?.slice(1, -1);
  const image = mediaSideOf(title) === mediaSideOf(word) ? `${head})` : `${head} "${word}")`;
  const start = match.index;
  return {
    line: line.slice(0, start) + image + line.slice(start + match[0].length),
    start,
    end: start + image.length,
  };
}
