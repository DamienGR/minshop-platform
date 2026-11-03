import type { MessageKey } from '../i18n/index.ts';
import { DEFAULT_ZOOM, MAX_LATITUDE, MAX_ZOOM, MIN_ZOOM } from './tiles.ts';

/**
 * The place a ```carte block describes (ADR 0029). Pure.
 *
 * The block is a few `nom : valeur` lines, so a merchant who has never seen it
 * can read it, and so a Markdown viewer that does not know it shows it as a
 * code block rather than losing it:
 *
 *     ```carte
 *     lieu: Marché de Vannes
 *     adresse: Place du Poids public
 *     adresse: 56000 Vannes
 *     position: 47.6582, -2.7608
 *     zoom: 16
 *     ```
 *
 * The keys are French and fixed: they are syntax, like `##`, not words a
 * translation would change. The renderer builds the map's HTML from what this
 * returns, never from the block's text, which is how a page with a map keeps
 * invariant 11 (`html: false`).
 */

/** The info string that makes a fenced block a map. */
export const PLACE_MAP_INFO = 'carte';

export const MAX_NAME = 100;
export const MAX_ADDRESS_LINE = 120;
export const MAX_ADDRESS_LINES = 4;

export interface Place {
  name: string | null;
  /** One entry per printed line. */
  address: string[];
  lat: number;
  lon: number;
  zoom: number;
}

export interface PlaceError {
  /** 1-based, counted inside the block (the line after the opening fence is 1). */
  line: number;
  key: MessageKey;
  params?: Record<string, string | number>;
}

export type ParsedPlace = { place: Place } | { errors: PlaceError[] };

/** Whether a fence's info string asks for a map: ```carte, any case. */
export function isPlaceMapInfo(info: string): boolean {
  return info.trim().split(/\s+/)[0]?.toLowerCase() === PLACE_MAP_INFO;
}

/** A decimal degree as people paste it: digits, at most one point, a sign. */
const DEGREES = /^[-+]?\d{1,3}(?:\.\d{1,12})?$/;

/**
 * Latitude then longitude, as OpenStreetMap and Google Maps copy them
 * (« 47.6582, -2.7608 »), or the French way with decimal commas, which then
 * needs a semicolon between the two (« 47,6582 ; -2,7608 »).
 */
export function parsePosition(value: string): { lat: number; lon: number } | null {
  const parts = value.includes(';')
    ? value.split(';').map((part) => part.trim().replace(',', '.'))
    : value.split(/\s*,\s*|\s+/).filter(Boolean);
  if (parts.length !== 2 || !parts.every((part) => DEGREES.test(part))) return null;
  const [lat, lon] = parts.map(Number);
  if (Math.abs(lat) > MAX_LATITUDE || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const KEYS = ['lieu', 'adresse', 'position', 'zoom'] as const;
type Key = (typeof KEYS)[number];

/** Characters as the merchant sees them: an accent or an emoji is one. */
function charCount(value: string): number {
  return [...value].length;
}

/** Characters a single line of the block may not carry. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Read a block's text. Every problem is reported, each with its line, so the
 * admin preview can list them all at once rather than one per save.
 */
export function parsePlace(source: string): ParsedPlace {
  const errors: PlaceError[] = [];
  const seen = new Set<Key>();
  let name: string | null = null;
  const address: string[] = [];
  let position: { lat: number; lon: number } | null = null;
  let zoom = DEFAULT_ZOOM;

  const lines = source.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const text = raw.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon <= 0) {
      errors.push({ line, key: 'admin.pages.map.error.lineShape' });
      continue;
    }
    const key = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!(KEYS as readonly string[]).includes(key)) {
      errors.push({ line, key: 'admin.pages.map.error.unknownKey', params: { cle: key.slice(0, 40) } });
      continue;
    }
    const known = key as Key;
    if (known !== 'adresse' && seen.has(known)) {
      errors.push({ line, key: 'admin.pages.map.error.repeated', params: { cle: known } });
      continue;
    }
    seen.add(known);
    if (CONTROL.test(value)) {
      errors.push({ line, key: 'admin.pages.map.error.lineShape' });
      continue;
    }

    if (known === 'lieu') {
      if (charCount(value) > MAX_NAME) {
        errors.push({ line, key: 'admin.pages.map.error.tooLong', params: { cle: known, max: MAX_NAME } });
      } else if (value) {
        name = value;
      }
    } else if (known === 'adresse') {
      if (charCount(value) > MAX_ADDRESS_LINE) {
        errors.push({
          line,
          key: 'admin.pages.map.error.tooLong',
          params: { cle: known, max: MAX_ADDRESS_LINE },
        });
      } else if (address.length >= MAX_ADDRESS_LINES) {
        errors.push({ line, key: 'admin.pages.map.error.addressLines', params: { max: MAX_ADDRESS_LINES } });
      } else if (value) {
        address.push(value);
      }
    } else if (known === 'position') {
      position = value ? parsePosition(value) : null;
      if (!position) {
        errors.push({
          line,
          key: value ? 'admin.pages.map.error.position' : 'admin.pages.map.error.positionMissing',
        });
      }
    } else {
      const parsed = /^\d{1,2}$/.test(value) ? Number(value) : NaN;
      if (!(parsed >= MIN_ZOOM && parsed <= MAX_ZOOM)) {
        errors.push({ line, key: 'admin.pages.map.error.zoom', params: { min: MIN_ZOOM, max: MAX_ZOOM } });
      } else {
        zoom = parsed;
      }
    }
  }

  if (!seen.has('position')) {
    errors.push({ line: lines.length + 1, key: 'admin.pages.map.error.positionMissing' });
  }
  if (errors.length > 0 || !position) return { errors };
  return { place: { name, address, lat: position.lat, lon: position.lon, zoom } };
}
