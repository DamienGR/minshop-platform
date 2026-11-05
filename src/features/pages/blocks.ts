import type { MarkdownIt as MarkdownItInstance, StateBlock } from 'markdown-it';
import { t } from '../i18n/index.ts';

/**
 * Named blocks in a page body (ticket #205, ADR 0030): `::: nom` on a line of
 * its own opens one, `:::` alone closes it, and what stands between is
 * Markdown like the rest of the page — headings, lists, photos, a map.
 *
 * The one block today is `colonnes`, whose columns a `::: colonne` line
 * separates:
 *
 *     ::: colonnes
 *     ## L’atelier
 *     …
 *
 *     ::: colonne
 *     ## Les matières
 *     …
 *     :::
 *
 * The names are a closed list, in French like the rest of the admin: any
 * other `::: mot` is not a block and stays the text it was, which is how a
 * typo shows itself on the page. What a block becomes is markup this module
 * writes — fixed classes, from closed lists — never anything the merchant
 * typed (invariant 11). Pure, for the renderer and its tests.
 */

/** The opening word of a block of columns, and the line between two columns. */
export const COLUMNS_WORD = 'colonnes';
export const COLUMN_WORD = 'colonne';

/** Three columns at most: a fourth would be 11rem wide in the standard measure. */
export const MAX_COLUMNS = 3;

/** The proportions a block of two columns may take; any other is equal. */
const RATIOS = new Map<string, 'narrow-wide' | 'wide-narrow'>([
  ['1/2', 'narrow-wide'],
  ['2/1', 'wide-narrow'],
]);

/** What is wrong with a block of columns, for the editor's preview. */
export type ColumnsProblem =
  | { kind: 'single'; line: number }
  | { kind: 'tooMany'; line: number; count: number }
  | { kind: 'ratio'; line: number; ratio: string }
  | { kind: 'ratioNeedsTwo'; line: number; ratio: string };

/** The block's opening line, read: its word and what follows it. */
function opening(text: string): { word: string; rest: string } | null {
  const match = /^:{3}[ \t]*(\S+)[ \t]*(.*?)[ \t]*$/.exec(text);
  return match ? { word: match[1].toLowerCase(), rest: match[2] } : null;
}

/** A closing line: the marker and nothing else. */
const isClosing = (text: string) => /^:{3}[ \t]*$/.test(text);

/** A line that opens or closes a fenced code block, and its fence. */
const fenceOf = (text: string) => /^(`{3,}|~{3,})/.exec(text)?.[1] ?? null;

/** The block names this module reads. A word on this list nests and closes. */
const NAMES = new Set([COLUMNS_WORD]);

interface Env {
  /** How deep in a block of columns the parser stands: columns never nest. */
  minshopColumns?: number;
}

/**
 * The block rule. Finds the block's end by walking its lines: a fence hides
 * what it holds, a nested block's own `:::` closes it and not this one, and
 * only a `::: colonne` at this block's own depth starts a column. Without a
 * closing line, the block runs to the end of the body, as an unclosed fence
 * does.
 */
function columnsRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const lineText = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
  const open = opening(lineText(startLine));
  if (!open || open.word !== COLUMNS_WORD) return false;
  const env = state.env as Env;
  // A block of columns inside a column stays text: the page says so.
  if ((env.minshopColumns ?? 0) > 0) return false;
  if (silent) return true;

  const separators: number[] = [];
  let close = -1;
  let depth = 0;
  let fence: string | null = null;
  let line = startLine + 1;
  for (; line < endLine; line++) {
    const start = state.bMarks[line] + state.tShift[line];
    const empty = start >= state.eMarks[line];
    // A line indented less than the block, in a list, ends it.
    if (!empty && state.sCount[line] < state.blkIndent) break;
    if (state.sCount[line] - state.blkIndent >= 4) continue;
    const text = lineText(line);
    const marker = fenceOf(text);
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && text.slice(marker.length).trim() === '') fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (isClosing(text)) {
      if (depth === 0) {
        close = line;
        break;
      }
      depth -= 1;
      continue;
    }
    const nested = opening(text);
    if (!nested) continue;
    if (nested.word === COLUMN_WORD && depth === 0) separators.push(line);
    else if (NAMES.has(nested.word)) depth += 1;
  }
  const end = close === -1 ? line : close;

  const bounds = [startLine, ...separators, end];
  const count = bounds.length - 1;
  const ratio = open.rest;
  const problems: ColumnsProblem[] = [];
  const at = startLine + 1;
  if (count === 1) problems.push({ kind: 'single', line: at });
  if (count > MAX_COLUMNS) problems.push({ kind: 'tooMany', line: at, count });
  let ratioClass: string | null = null;
  if (ratio) {
    const known = RATIOS.get(ratio);
    if (!known) problems.push({ kind: 'ratio', line: at, ratio });
    else if (count !== 2) problems.push({ kind: 'ratioNeedsTwo', line: at, ratio });
    else ratioClass = known;
  }

  const oldLineMax = state.lineMax;
  const columns = state.push('minshop_columns_open', 'div', 1);
  columns.block = true;
  columns.map = [startLine, close === -1 ? end : end + 1];
  columns.attrJoin('class', 'markdown-columns');
  columns.attrJoin('class', `markdown-columns--${Math.min(count, MAX_COLUMNS)}`);
  if (ratioClass) columns.attrJoin('class', `markdown-columns--${ratioClass}`);
  columns.meta = { problems };

  env.minshopColumns = (env.minshopColumns ?? 0) + 1;
  for (let i = 0; i < count; i++) {
    const from = bounds[i] + 1;
    const to = bounds[i + 1];
    const column = state.push('minshop_column_open', 'div', 1);
    column.block = true;
    column.map = [bounds[i], to];
    column.attrJoin('class', 'markdown-column');
    state.lineMax = to;
    state.md.block.tokenize(state, from, to);
    state.push('minshop_column_close', 'div', -1).block = true;
  }
  env.minshopColumns -= 1;
  state.lineMax = oldLineMax;

  state.push('minshop_columns_close', 'div', -1).block = true;
  state.line = close === -1 ? end : end + 1;
  return true;
}

/**
 * Teach an instance the blocks. The rule runs before the paragraph's, and
 * like a fence may interrupt one: a `::: colonnes` line right under a
 * sentence opens the block rather than joining the sentence.
 */
export function installBlocks(instance: MarkdownItInstance): void {
  instance.block.ruler.before('fence', 'minshop_columns', columnsRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}

/** Every block of columns' problems, in the order the body holds them. */
export function columnsProblemsOf(tokens: ReadonlyArray<{ type: string; meta?: unknown }>): ColumnsProblem[] {
  return tokens.flatMap((token) =>
    token.type === 'minshop_columns_open'
      ? ((token.meta as { problems?: ColumnsProblem[] } | null)?.problems ?? [])
      : [],
  );
}

/** One problem, as the preview says it, in French. */
export function columnsProblemMessage(problem: ColumnsProblem): string {
  switch (problem.kind) {
    case 'single':
      return t('admin.pages.columns.error.single', { ligne: problem.line });
    case 'tooMany':
      return t('admin.pages.columns.error.tooMany', { ligne: problem.line, nombre: problem.count, max: MAX_COLUMNS });
    case 'ratio':
      return t('admin.pages.columns.error.ratio', { ligne: problem.line, proportions: problem.ratio });
    case 'ratioNeedsTwo':
      return t('admin.pages.columns.error.ratioNeedsTwo', { ligne: problem.line, proportions: problem.ratio });
  }
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The preview's note above a block of columns it drew as well as it could.
 * The proportions come from the merchant's line, hence the escaping. Empty
 * when nothing is wrong.
 */
export function renderColumnsProblems(problems: ColumnsProblem[]): string {
  if (problems.length === 0) return '';
  const items = problems.map((problem) => `<li>${escape(columnsProblemMessage(problem))}</li>`).join('');
  return `<div class="markdown-block-error"><p>${escape(t('admin.pages.columns.error.heading'))}</p><ul>${items}</ul></div>\n`;
}
