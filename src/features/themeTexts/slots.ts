import type { ThemeText, ThemeTextSlot } from '../storefront/models.ts';
import { extractMediaKeys, renderMarkdown } from '../pages/markdown.ts';
import { t } from '../i18n/index.ts';
import { oneLine } from '../i18n/spaces.ts';

/**
 * The texts a theme lets the merchant edit (ticket #165, ADR 0027).
 *
 * A theme declares its slots in an optional `texts.ts`; the core stores what
 * the merchant writes over a default, refuses what is too long, and hands the
 * template a resolved `{ text, html }` per key. Pure: the declaration, the
 * stored rows and the form arrive as arguments, so the suite can hold every
 * theme on disk to the same rules the admin applies (test/storefront/
 * themeTexts.test.ts).
 */

/** The longest text a slot may declare: a paragraph or a short section. */
export const THEME_TEXT_MAX_LENGTH = 5000;
/** A theme with more slots than this wants pages, not texts. */
export const THEME_TEXT_SLOTS_MAX = 50;

const KEY = /^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/;
const KEY_MAX = 64;
const LABEL_MAX = 80;
const HELP_MAX = 300;

/** Length as the merchant counts it: characters, not UTF-16 units. */
const length = (value: string) => [...value].length;

/** The form field of one slot. The key's alphabet needs no escaping. */
export const themeTextField = (key: string) => `text.${key}`;

/**
 * What is wrong with a declaration, one sentence per problem, in English: the
 * reader is the theme's developer, in a failing test, not the merchant.
 */
export function themeTextSlotProblems(declared: unknown): string[] {
  if (!Array.isArray(declared)) return ['`texts` must be an array of slots.'];
  const problems: string[] = [];
  if (declared.length > THEME_TEXT_SLOTS_MAX) problems.push(`${declared.length} slots; ${THEME_TEXT_SLOTS_MAX} at most.`);
  const seen = new Set<string>();
  declared.forEach((slot, index) => {
    const at = `slot ${index + 1}`;
    if (!slot || typeof slot !== 'object') {
      problems.push(`${at} is not an object.`);
      return;
    }
    const { key, label, help, default: fallback, maxLength, format } = slot as Record<string, unknown>;
    const name = typeof key === 'string' ? `"${key}"` : at;
    if (typeof key !== 'string' || !KEY.test(key) || key.length > KEY_MAX) {
      problems.push(`${name}: the key must be a lowercase letter, then letters, digits, "." or "-" (${KEY_MAX} at most).`);
    } else if (seen.has(key)) {
      problems.push(`${name} is declared twice.`);
    } else {
      seen.add(key);
    }
    if (typeof label !== 'string' || !label.trim() || length(label) > LABEL_MAX) {
      problems.push(`${name}: the label must be a non-empty string of ${LABEL_MAX} characters at most.`);
    }
    if (help !== undefined && (typeof help !== 'string' || length(help) > HELP_MAX)) {
      problems.push(`${name}: the help must be a string of ${HELP_MAX} characters at most.`);
    }
    if (format !== 'text' && format !== 'markdown') problems.push(`${name}: the format must be "text" or "markdown".`);
    if (!Number.isInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > THEME_TEXT_MAX_LENGTH) {
      problems.push(`${name}: maxLength must be an integer from 1 to ${THEME_TEXT_MAX_LENGTH}.`);
    }
    if (typeof fallback !== 'string') {
      problems.push(`${name}: the default must be a string ('' for none).`);
    } else if (Number.isInteger(maxLength) && length(fallback) > (maxLength as number)) {
      problems.push(`${name}: the default is longer than maxLength (${length(fallback)} > ${maxLength}).`);
    } else if ((format === 'text' || format === 'markdown') && normalizeThemeText(format, fallback) !== fallback) {
      // The default is what an empty field falls back to AND what an unchanged
      // field is compared with: written as the form would store it, or the
      // merchant who saves without touching it stores a copy of it.
      problems.push(`${name}: the default must be written as it is stored (trimmed${format === 'text' ? ', one line, single spaces' : ''}).`);
    } else if (format === 'markdown' && extractMediaKeys(fallback).length > 0) {
      problems.push(`${name}: a default cannot show a store image; the media library would not know it is used.`);
    }
  });
  return problems;
}

/** The slots that pass, so one bad entry in a theme cannot empty the others.
 *  The suite fails on any problem; a running shop keeps what it can read. */
export function validThemeTextSlots(declared: unknown): ThemeTextSlot[] {
  if (!Array.isArray(declared)) return [];
  const kept: ThemeTextSlot[] = [];
  for (const slot of declared.slice(0, THEME_TEXT_SLOTS_MAX)) {
    if (themeTextSlotProblems([slot]).length > 0) continue;
    if (kept.some((other) => other.key === (slot as ThemeTextSlot).key)) continue;
    kept.push(slot as ThemeTextSlot);
  }
  return kept;
}

/** A value as it is stored: line endings unified, trimmed, and for a one-line
 *  text every run of breaking whitespace a single space (`oneLine()`). A
 *  no-break space is kept where it was typed or pasted, so the line does not
 *  wrap before `?` (ticket #175). */
export function normalizeThemeText(format: ThemeTextSlot['format'], value: string): string {
  return format === 'text' ? oneLine(value) : value.replace(/\r\n?/g, '\n').trim();
}

/** One write: a value, or null to return the slot to its default. */
export interface ThemeTextWrite {
  key: string;
  value: string | null;
}

/**
 * The admin form, judged slot by slot before anything is written.
 *
 * A field left empty, or holding exactly the default, returns the slot to its
 * default (null): storing a copy would freeze it when the theme's own wording
 * changes. A field the form did not send is left alone.
 */
export function parseThemeTextsForm(
  form: FormData,
  slots: readonly ThemeTextSlot[],
  { baseUrl = '' }: { baseUrl?: string } = {},
): { writes: ThemeTextWrite[] } | { error: string } {
  const writes: ThemeTextWrite[] = [];
  for (const slot of slots) {
    const raw = form.get(themeTextField(slot.key));
    if (typeof raw !== 'string') continue;
    const value = normalizeThemeText(slot.format, raw);
    if (length(value) > slot.maxLength) {
      return {
        error: t('admin.themeTexts.error.tooLong', { libelle: slot.label, max: slot.maxLength, longueur: length(value) }),
      };
    }
    // A store image here would be a use the media library cannot see
    // (invariant 10): deletable while the home still shows it.
    if (slot.format === 'markdown' && extractMediaKeys(value, { baseUrl }).length > 0) {
      return { error: t('admin.themeTexts.error.image', { libelle: slot.label }) };
    }
    writes.push({ key: slot.key, value: value === '' || value === slot.default ? null : value });
  }
  return { writes };
}

/** What the merchant wrote for a slot, when the theme still accepts it. A text
 *  stored before the theme lowered its maximum falls back to the default
 *  rather than overflowing the layout; the admin page says so. */
export function storedThemeText(slot: ThemeTextSlot, stored: ReadonlyMap<string, string>): string | null {
  const value = stored.get(slot.key);
  if (value === undefined || value === '') return null;
  return length(value) > slot.maxLength ? null : value;
}

/** Whether a stored text is now too long for its slot (the admin's notice). */
export function storedThemeTextTooLong(slot: ThemeTextSlot, stored: ReadonlyMap<string, string>): boolean {
  const value = stored.get(slot.key);
  return value !== undefined && length(value) > slot.maxLength;
}

/** Every declared key, resolved for the template. */
export function resolveThemeTexts(
  slots: readonly ThemeTextSlot[],
  stored: ReadonlyMap<string, string>,
  { baseUrl = '' }: { baseUrl?: string } = {},
): Record<string, ThemeText> {
  const texts: Record<string, ThemeText> = {};
  for (const slot of slots) {
    const text = storedThemeText(slot, stored) ?? slot.default;
    texts[slot.key] = { text, html: slot.format === 'markdown' ? renderMarkdown(text, { baseUrl }) : null };
  }
  return texts;
}
