import type { ThemePageField, ThemePageModel, ThemeText } from '../storefront/models.ts';
import { normalizeThemeText } from '../themeTexts/slots.ts';
import { t } from '../i18n/index.ts';
import { isListZone } from './declaration.ts';

/**
 * What the merchant wrote in a page model's zones (ticket #205, ADR 0031):
 * stored, read from the editor's form, and handed to the template. Pure: the
 * stored value, the form and the declaration arrive as arguments.
 *
 * A page keeps its zones as one JSON object in `pages.zones` (migration
 * 0056), beside its body: a text zone is a string, a list an array of entries,
 * each entry an object of strings. The zones of a model the page no longer
 * uses are kept, so switching back finds them; they count as uses of the
 * photos they show (invariant 10), and draw nothing.
 */

export type StoredEntry = Record<string, string>;
export type StoredZones = Record<string, string | StoredEntry[]>;

const length = (value: string) => [...value].length;

/** The stored zones, whatever the column holds: a row from before the
 *  migration, or one a hand edit broke, reads as no zones rather than a 500. */
export function readStoredZones(json: string | null | undefined): StoredZones {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const zones: StoredZones = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      zones[key] = value;
    } else if (Array.isArray(value)) {
      zones[key] = value
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) =>
          Object.fromEntries(Object.entries(entry).filter((field): field is [string, string] => typeof field[1] === 'string')),
        );
    }
  }
  return zones;
}

/** Every text the zones hold, the model in use or not: what the media library
 *  must count as used. A one-line text holds no photo, and costs nothing here. */
export function storedZoneTexts(zones: StoredZones): string[] {
  return Object.values(zones).flatMap((value) =>
    typeof value === 'string' ? [value] : value.flatMap((entry) => Object.values(entry)),
  );
}

/** One Markdown text of the model in use, named for the merchant. */
export interface ZoneMarkdown {
  /** « Accroche », « Points de vente, 2 — Adresse ». */
  label: string;
  text: string;
}

/** The Markdown texts the model in use draws: where its maps are, and what is
 *  wrong with them. The body is the caller's. */
export function modelMarkdownTexts(model: ThemePageModel | null, zones: StoredZones): ZoneMarkdown[] {
  if (!model) return [];
  const texts: ZoneMarkdown[] = [];
  for (const zone of model.zones) {
    const value = zones[zone.key];
    if (!isListZone(zone)) {
      if (zone.format === 'markdown' && typeof value === 'string' && value) texts.push({ label: zone.label, text: value });
      continue;
    }
    if (!Array.isArray(value)) continue;
    value.slice(0, zone.maxItems).forEach((entry, index) => {
      for (const field of zone.fields) {
        const text = entry[field.key];
        if (field.format === 'markdown' && text) {
          texts.push({ label: `${zone.label}, ${index + 1} — ${field.label}`, text });
        }
      }
    });
  }
  return texts;
}

/** The form field of a text zone, or of one field of a list's entry. Keys
 *  hold letters and digits only (declaration.ts), so the dots separate. */
export const zoneFieldName = (zone: string, entry?: number, field?: string) =>
  entry === undefined ? `zone.${zone}` : `zone.${zone}.${entry}.${field}`;
/** The entry's « Retirer » box. */
export const zoneRemoveName = (zone: string, entry: number) => `zone.${zone}.${entry}._remove`;
/** The name of the buttons that move an entry: the value says which, and where. */
export const ZONE_MOVE = '_zone_move';
export const zoneMoveValue = (zone: string, entry: number, direction: 'up' | 'down') =>
  `${direction}:${zone}:${entry}`;

/** A field's value as the form sent it, as it is stored; null when not sent. */
function formValue(form: FormData, name: string, format: ThemePageField['format']): string | null {
  const raw = form.get(name);
  return typeof raw === 'string' ? normalizeThemeText(format, raw) : null;
}

/** An entry's fields as the form sent them, or null when the form sent none. */
function formEntry(form: FormData, zone: string, index: number, fields: readonly ThemePageField[]): StoredEntry | null {
  let sent = false;
  const entry: StoredEntry = {};
  for (const field of fields) {
    const value = formValue(form, zoneFieldName(zone, index, field.key), field.format);
    if (value === null) continue;
    sent = true;
    if (value !== '') entry[field.key] = value;
  }
  return sent ? entry : null;
}

/** `up:points:2` → the move it names, when it names one of this zone's entries. */
function moveOf(form: FormData, zone: string): { from: number; to: number } | null {
  const match = /^(up|down):([a-zA-Z0-9]+):(\d+)$/.exec(String(form.get(ZONE_MOVE) ?? ''));
  if (!match || match[2] !== zone) return null;
  const from = Number(match[3]);
  return { from, to: match[1] === 'up' ? from - 1 : from + 1 };
}

/**
 * The editor's form, judged before anything is written, merged into what the
 * page already stores.
 *
 * Only the zones of the chosen model are read; the others are kept as they
 * are. A zone the form did not send is left alone. An empty text, a list
 * left without entries, is removed. A list's entries come in the form's
 * order, one moved if a « Monter » or « Descendre » was pressed; an entry
 * whose « Retirer » is ticked, or whose fields are all empty (the blank one
 * the editor offers for a new entry, untouched), is dropped.
 */
export function parsePageZonesForm(
  form: FormData,
  model: ThemePageModel | null,
  stored: StoredZones,
): { zones: StoredZones } | { error: string } {
  const zones: StoredZones = { ...stored };
  if (!model) return { zones };
  const tooLong = (label: string, max: number, value: string) =>
    t('admin.pages.zones.error.tooLong', { libelle: label, max, longueur: length(value) });

  for (const zone of model.zones) {
    if (!isListZone(zone)) {
      const value = formValue(form, zoneFieldName(zone.key), zone.format);
      if (value === null) continue;
      if (length(value) > zone.maxLength) return { error: tooLong(zone.label, zone.maxLength, value) };
      if (value === '') delete zones[zone.key];
      else zones[zone.key] = value;
      continue;
    }

    const sent: Array<{ entry: StoredEntry; removed: boolean }> = [];
    for (let index = 0; ; index++) {
      const entry = formEntry(form, zone.key, index, zone.fields);
      if (!entry) break;
      sent.push({ entry, removed: form.get(zoneRemoveName(zone.key, index)) !== null });
    }
    if (sent.length === 0) continue;

    const move = moveOf(form, zone.key);
    if (move && move.from < sent.length && move.to >= 0 && move.to < sent.length) {
      const [moved] = sent.splice(move.from, 1);
      sent.splice(move.to, 0, moved);
    }

    const entries: StoredEntry[] = [];
    for (const { entry, removed } of sent) {
      if (removed || Object.keys(entry).length === 0) continue;
      for (const field of zone.fields) {
        const value = entry[field.key] ?? '';
        if (length(value) > field.maxLength) {
          return { error: tooLong(`${zone.label}, ${entries.length + 1} — ${field.label}`, field.maxLength, value) };
        }
      }
      entries.push(entry);
    }
    if (entries.length > zone.maxItems) {
      return { error: t('admin.pages.zones.error.tooMany', { libelle: zone.label, max: zone.maxItems }) };
    }
    if (entries.length === 0) delete zones[zone.key];
    else zones[zone.key] = entries;
  }
  return { zones };
}

/** The stored zones as JSON, keys in a stable order so an unchanged page
 *  stores the same text. */
export function serializeZones(zones: StoredZones): string {
  return JSON.stringify(Object.fromEntries(Object.entries(zones).sort(([a], [b]) => a.localeCompare(b))));
}

/** One text for the template: `html` from the caller's renderer, which is the
 *  body's, for a Markdown text; null for a line of text. */
function resolveText(format: ThemePageField['format'], value: string, render: (markdown: string) => string): ThemeText {
  return { text: value, html: format === 'markdown' ? (value ? render(value) : '') : null };
}

/**
 * Every zone the model declares, resolved for its template: a text zone that
 * holds a list (a theme turned one into the other) reads as empty, a list
 * keeps the entries the model still takes, and every entry has every field.
 */
export function resolvePageZones(
  model: ThemePageModel,
  zones: StoredZones,
  render: (markdown: string) => string,
): { zones: Record<string, ThemeText>; lists: Record<string, Array<Record<string, ThemeText>>> } {
  const texts: Record<string, ThemeText> = {};
  const lists: Record<string, Array<Record<string, ThemeText>>> = {};
  for (const zone of model.zones) {
    const value = zones[zone.key];
    if (!isListZone(zone)) {
      texts[zone.key] = resolveText(zone.format, typeof value === 'string' ? value : '', render);
      continue;
    }
    const entries = Array.isArray(value) ? value.slice(0, zone.maxItems) : [];
    lists[zone.key] = entries.map((entry) =>
      Object.fromEntries(zone.fields.map((field) => [field.key, resolveText(field.format, entry[field.key] ?? '', render)])),
    );
  }
  return { zones: texts, lists };
}
