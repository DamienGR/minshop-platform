/**
 * Web Mercator tile arithmetic for a place's map (ADR 0029). Pure.
 *
 * A map here is a mosaic of the tile server's square images, laid out by CSS
 * around the place. The server decides which tiles that is, once, from the
 * place alone: the storefront draws them, and the tile route refuses any tile
 * that no published map draws, which is what keeps it from being an open relay
 * to the tile server.
 */

/** Side of a tile, in pixels, as every slippy-map server serves it. */
export const TILE_SIZE = 256;

/** The zooms a block may ask for: a region (3) down to a street corner (19). */
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 19;
export const DEFAULT_ZOOM = 16;

/**
 * The largest frame the map is drawn in, in CSS pixels. The width is the
 * standard page measure (48rem) and `base.css` caps `.place-map__frame` at the
 * same two numbers: a wider frame would show the edge of the mosaic.
 */
export const VIEW_WIDTH = 768;
export const VIEW_HEIGHT = 320;

/** Web Mercator stops here; past it a latitude has no tile row. */
export const MAX_LATITUDE = 85.05112878;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

export interface TileGrid {
  cols: number;
  rows: number;
  /** Row by row; null where the mosaic runs past the top or bottom of the world. */
  tiles: (Tile | null)[];
  /** Where the place falls inside the mosaic, from its top-left corner, in pixels. */
  offsetX: number;
  offsetY: number;
}

/** The place's position on the whole world's map at `zoom`, in pixels. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

/**
 * The tiles that cover a VIEW_WIDTH × VIEW_HEIGHT frame centred on the place:
 * three or four columns, two or three rows. Columns wrap around the
 * antimeridian; rows past the poles are left empty.
 */
export function tileGrid(lat: number, lon: number, zoom: number): TileGrid {
  const { x, y } = worldPixel(lat, lon, zoom);
  const count = 2 ** zoom;
  const firstCol = Math.floor((x - VIEW_WIDTH / 2) / TILE_SIZE);
  const lastCol = Math.ceil((x + VIEW_WIDTH / 2) / TILE_SIZE) - 1;
  const firstRow = Math.floor((y - VIEW_HEIGHT / 2) / TILE_SIZE);
  const lastRow = Math.ceil((y + VIEW_HEIGHT / 2) / TILE_SIZE) - 1;

  const tiles: (Tile | null)[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      tiles.push(row < 0 || row >= count ? null : { z: zoom, x: ((col % count) + count) % count, y: row });
    }
  }
  return {
    cols: lastCol - firstCol + 1,
    rows: lastRow - firstRow + 1,
    tiles,
    offsetX: Math.round(x - firstCol * TILE_SIZE),
    offsetY: Math.round(y - firstRow * TILE_SIZE),
  };
}

const DIGITS = /^\d{1,7}$/;

/**
 * A tile named in a URL, or null. Digits only — no sign, no exponent, no
 * leading `+` — inside the zooms a block may use and inside the world.
 */
export function parseTile(z: unknown, x: unknown, y: unknown): Tile | null {
  if (typeof z !== 'string' || typeof x !== 'string' || typeof y !== 'string') return null;
  if (!DIGITS.test(z) || !DIGITS.test(x) || !DIGITS.test(y)) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(y) };
  if (tile.z < MIN_ZOOM || tile.z > MAX_ZOOM) return null;
  const count = 2 ** tile.z;
  if (tile.x >= count || tile.y >= count) return null;
  return tile;
}

/** The tile server's address for a tile, from a `{z}/{x}/{y}` template. */
export function tileServerUrl(template: string, tile: Tile): string {
  return template
    .replaceAll('{z}', String(tile.z))
    .replaceAll('{x}', String(tile.x))
    .replaceAll('{y}', String(tile.y));
}
