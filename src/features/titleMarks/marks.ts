/**
 * The codes a theme lets the merchant write in a page's title, to place an
 * ornament where the merchant chooses (ticket #251): `[feuille]` in « La
 * [feuille] marque ». The theme draws it, from the title its template receives
 * as written. Wherever the core prints that title as plain text — the
 * document's title, `llms.txt`, a menu, the description drawn from a model's
 * zones, the admin's grey « Titre pour Google » — the code goes, with its
 * spaces.
 *
 * Pure: the declaration arrives as an argument, so the suite holds every
 * theme on disk to the rules (test/storefront/titleMarks.test.ts), as for the
 * theme's texts and page models. A theme keeps its own copy of the rule for
 * what it prints itself (a summary, a region's name): the storefront boundary
 * forbids it the core.
 */

/** More codes than this is a markup language, not an ornament. */
export const TITLE_MARKS_MAX = 20;
const MARK_MAX = 30;

/** A lowercase word: letters and digits, hyphens between them. Accented
 *  letters count, so a French theme may declare `étoile`. */
const MARK = /^\p{Ll}[\p{Ll}\p{Nd}]*(?:-[\p{Ll}\p{Nd}]+)*$/u;

/**
 * What is wrong with a declaration, one sentence per problem, in English: the
 * reader is the theme's developer, in a failing test, not the merchant.
 */
export function titleMarkProblems(declared: unknown): string[] {
  if (!Array.isArray(declared)) return ['`titleMarks` must be an array of words.'];
  const problems: string[] = [];
  if (declared.length > TITLE_MARKS_MAX) problems.push(`${declared.length} codes; ${TITLE_MARKS_MAX} at most.`);
  const seen = new Set<string>();
  declared.forEach((mark, index) => {
    if (typeof mark !== 'string' || !MARK.test(mark) || [...mark].length > MARK_MAX) {
      problems.push(
        `code ${index + 1} (${JSON.stringify(mark)}): a lowercase word, letters and digits with hyphens between them, ${MARK_MAX} characters at most, without its brackets.`,
      );
    } else if (seen.has(mark)) {
      problems.push(`"${mark}" is declared twice.`);
    } else {
      seen.add(mark);
    }
  });
  return problems;
}

/** The codes that pass, so one bad entry cannot cost the others. The suite
 *  fails on any problem; a running shop keeps what it can read. */
export function validTitleMarks(declared: unknown): string[] {
  if (!Array.isArray(declared)) return [];
  const kept: string[] = [];
  for (const mark of declared.slice(0, TITLE_MARKS_MAX)) {
    if (titleMarkProblems([mark]).length > 0 || kept.includes(mark)) continue;
    kept.push(mark);
  }
  return kept;
}

/** How a code is written in a title: `[feuille]`. */
export const titleMarkCode = (mark: string) => `[${mark}]`;

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const LINE_BREAK = /[\r\n]/;
/** What follows a word without a space: a removed code leaves none before it. */
const TIGHT = /^[.,…)]/u;

/**
 * One declared code, brackets included: any case, spaces tolerated inside the
 * brackets. `[mot](…)` and `[mot][…]` are Markdown links, not codes.
 */
function codePattern(marks: readonly string[]): RegExp {
  const words = marks.map((mark) => mark.replace(SPECIAL, '\\$&')).join('|');
  return new RegExp(`\\[[^\\S\\r\\n]*(?:${words})[^\\S\\r\\n]*\\](?![(\\[])`, 'iu');
}

/** Where the trailing whitespace of `text` starts. A scan, not `/\s+$/`, which
 *  is quadratic on a long run of spaces that does not end the text. */
function wordsEnd(text: string): number {
  let end = text.length;
  while (end > 0 && /\s/u.test(text[end - 1])) end--;
  return end;
}

function wordsStart(text: string): number {
  let start = 0;
  while (start < text.length && /\s/u.test(text[start])) start++;
  return start;
}

/**
 * The text on either side of a removed code, joined by one of the spaces that
 * surrounded it: none at the start, at the end, or before `.` and `,`. A line
 * break wins, for a zone's Markdown; then the space after the code, which may
 * be the narrow no-break one before `?` (ticket #175).
 */
function joinAround(left: string, right: string, last: boolean): string {
  const leftEnd = wordsEnd(left);
  const rightStart = wordsStart(right);
  const leftWords = left.slice(0, leftEnd);
  const rightWords = right.slice(rightStart);
  // Only space between this code and the next: the next one settles it.
  if (!rightWords && !last) return left + right;
  if (!leftWords || !rightWords || TIGHT.test(rightWords)) return leftWords + rightWords;
  const before = left.slice(leftEnd);
  const after = right.slice(0, rightStart);
  const space = LINE_BREAK.test(before) ? before : LINE_BREAK.test(after) ? after : after || before;
  return leftWords + space + rightWords;
}

/**
 * The title as plain text: every declared code removed, with its spaces.
 * « Livraison [feuille] et retours » → « Livraison et retours ». A theme that
 * declares none, or a title without a code, is returned unchanged.
 */
export function plainTitle(text: string, marks: readonly string[]): string {
  if (marks.length === 0 || !text.includes('[')) return text;
  const pieces = text.split(codePattern(marks));
  if (pieces.length === 1) return text;
  let plain = pieces[0];
  for (let index = 1; index < pieces.length; index++) {
    plain = joinAround(plain, pieces[index], index === pieces.length - 1);
  }
  return plain;
}
