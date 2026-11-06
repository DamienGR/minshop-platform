import type { MarkdownIt as MarkdownItInstance, StateBlock } from 'markdown-it';
import { t } from '../i18n/index.ts';

/**
 * Named blocks in a page body (ticket #205, ADR 0030): `::: nom` on a line of
 * its own opens one, `:::` alone closes it, and what stands between is
 * Markdown like the rest of the page — headings, lists, photos, a map.
 *
 * Two blocks today. `colonnes`, whose columns a `::: colonne` line separates:
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
 * and `encadré`, a text set apart on the theme's raised surface (ticket #205,
 * lot 4):
 *
 *     ::: encadré
 *     **Bon à savoir** : la livraison est offerte dès 60 €.
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

/** The opening word of a box, and the same word as typed without its accent. */
export const BOX_WORD = 'encadré';
const BOX_WORDS = new Set([BOX_WORD, 'encadre']);

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

/** What is wrong with a box, for the editor's preview. */
export type BoxProblem =
  | { kind: 'extra'; line: number; text: string }
  | { kind: 'empty'; line: number }
  | { kind: 'unclosed'; line: number };

/**
 * The block's opening line, read: its word and what follows it. The word is
 * composed (NFC) before it is compared: an « é » pasted from some systems
 * arrives as an « e » and its accent, two characters.
 */
function opening(text: string): { word: string; rest: string } | null {
  const match = /^:{3}[ \t]*(\S+)[ \t]*(.*?)[ \t]*$/.exec(text);
  return match ? { word: match[1].normalize('NFC').toLowerCase(), rest: match[2] } : null;
}

/** A closing line: the marker and nothing else. */
const isClosing = (text: string) => /^:{3}[ \t]*$/.test(text);

/** A line that opens or closes a fenced code block, and its fence. */
const fenceOf = (text: string) => /^(`{3,}|~{3,})/.exec(text)?.[1] ?? null;

/** The block names this module reads. A word on this list nests and closes. */
const NAMES = new Set([COLUMNS_WORD, ...BOX_WORDS]);

interface Env {
  /** How deep in a block of columns the parser stands: columns never nest. */
  minshopColumns?: number;
  /** How deep in a box: boxes never nest either. */
  minshopBoxes?: number;
}

/** A line of the body, past its indentation. */
const lineText = (state: StateBlock, line: number) =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);

/**
 * Where a block ends, found by walking its lines: a fence hides what it
 * holds, a nested block's own `:::` closes it and not this one, and only a
 * `separator` line at this block's own depth splits it. Without a closing
 * line (`close` is then -1), the block runs to the end of the body, as an
 * unclosed fence does: `end` is the first line past it.
 */
function blockExtent(
  state: StateBlock,
  startLine: number,
  endLine: number,
  separator: string | null,
): { separators: number[]; close: number; end: number } {
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
    const text = lineText(state, line);
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
    if (separator !== null && nested.word === separator && depth === 0) separators.push(line);
    else if (NAMES.has(nested.word)) depth += 1;
  }
  return { separators, close, end: close === -1 ? line : close };
}

/** The rule of a block of columns. */
function columnsRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const open = opening(lineText(state, startLine));
  if (!open || open.word !== COLUMNS_WORD) return false;
  const env = state.env as Env;
  // A block of columns inside a column stays text: the page says so.
  if ((env.minshopColumns ?? 0) > 0) return false;
  if (silent) return true;

  const { separators, close, end } = blockExtent(state, startLine, endLine, COLUMN_WORD);

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
 * The rule of a box. What it holds is Markdown like the page, columns
 * included; a box inside a box stays text, as columns inside a column do.
 * Nothing follows the word on its line: a text written there is not drawn,
 * and the preview says so.
 */
function boxRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const open = opening(lineText(state, startLine));
  if (!open || !BOX_WORDS.has(open.word)) return false;
  const env = state.env as Env;
  if ((env.minshopBoxes ?? 0) > 0) return false;
  if (silent) return true;

  const { close, end } = blockExtent(state, startLine, endLine, null);
  const problems: BoxProblem[] = [];
  const at = startLine + 1;
  if (open.rest) problems.push({ kind: 'extra', line: at, text: open.rest });
  let empty = true;
  for (let line = startLine + 1; line < end && empty; line++) {
    if (state.bMarks[line] + state.tShift[line] < state.eMarks[line]) empty = false;
  }
  if (empty) problems.push({ kind: 'empty', line: at });
  if (close === -1) problems.push({ kind: 'unclosed', line: at });

  const oldLineMax = state.lineMax;
  const box = state.push('minshop_box_open', 'div', 1);
  box.block = true;
  box.map = [startLine, close === -1 ? end : end + 1];
  box.attrJoin('class', 'markdown-box');
  // A note, not a landmark: an <aside> inside the page's article would be
  // one more stop in a screen reader's list of regions.
  box.attrSet('role', 'note');
  box.meta = { problems };

  env.minshopBoxes = (env.minshopBoxes ?? 0) + 1;
  state.lineMax = end;
  state.md.block.tokenize(state, startLine + 1, end);
  state.lineMax = oldLineMax;
  env.minshopBoxes -= 1;

  state.push('minshop_box_close', 'div', -1).block = true;
  state.line = close === -1 ? end : end + 1;
  return true;
}

/**
 * Teach an instance the blocks. The rules run before the paragraph's, and
 * like a fence may interrupt one: a `::: colonnes` line right under a
 * sentence opens the block rather than joining the sentence.
 */
export function installBlocks(instance: MarkdownItInstance): void {
  const alt = ['paragraph', 'reference', 'blockquote', 'list'];
  instance.block.ruler.before('fence', 'minshop_columns', columnsRule, { alt });
  instance.block.ruler.before('fence', 'minshop_box', boxRule, { alt });
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

/** One problem of a box, as the preview says it, in French. */
export function boxProblemMessage(problem: BoxProblem): string {
  switch (problem.kind) {
    case 'extra':
      return t('admin.pages.box.error.extra', { ligne: problem.line, texte: problem.text });
    case 'empty':
      return t('admin.pages.box.error.empty', { ligne: problem.line });
    case 'unclosed':
      return t('admin.pages.box.error.unclosed', { ligne: problem.line });
  }
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The preview's note above a block it drew as well as it could. A message
 * may quote the merchant's line, hence the escaping. Empty when nothing is
 * wrong.
 */
function renderProblems(heading: string, messages: string[]): string {
  if (messages.length === 0) return '';
  const items = messages.map((message) => `<li>${escape(message)}</li>`).join('');
  return `<div class="markdown-block-error"><p>${escape(heading)}</p><ul>${items}</ul></div>\n`;
}

/** Above a block of columns. */
export function renderColumnsProblems(problems: ColumnsProblem[]): string {
  return renderProblems(t('admin.pages.columns.error.heading'), problems.map(columnsProblemMessage));
}

/** Above a box. */
export function renderBoxProblems(problems: BoxProblem[]): string {
  return renderProblems(t('admin.pages.box.error.heading'), problems.map(boxProblemMessage));
}
