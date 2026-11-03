import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  parseTile,
  tileGrid,
  tileServerUrl,
  worldPixel,
} from './tiles';

describe('worldPixel', () => {
  it('puts (0, 0) at the centre of the world at every zoom', () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(worldPixel(0, 0, 3)).toEqual({ x: 1024, y: 1024 });
  });

  it('runs west to east and north to south', () => {
    expect(worldPixel(0, -180, 2).x).toBe(0);
    expect(worldPixel(0, 180, 2).x).toBe(TILE_SIZE * 4);
    expect(worldPixel(85.05112878, 0, 2).y).toBeCloseTo(0, 3);
    expect(worldPixel(-85.05112878, 0, 2).y).toBeCloseTo(TILE_SIZE * 4, 3);
    expect(worldPixel(48, 2, 10).y).toBeLessThan(worldPixel(47, 2, 10).y);
  });

  it('clamps a latitude past Web Mercator to its edge rather than to infinity', () => {
    expect(Number.isFinite(worldPixel(90, 0, 5).y)).toBe(true);
    expect(worldPixel(90, 0, 5).y).toBeCloseTo(0, 3);
  });

  it('agrees with the inverse the slippy-map convention defines', () => {
    // The tile → corner formula from wiki.openstreetmap.org/wiki/Slippy_map_tilenames,
    // written independently of the projection above: the place must fall
    // inside the bounds of the tile it is placed in.
    const corner = (x: number, y: number, z: number) => {
      const n = 2 ** z;
      return {
        lon: (x / n) * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
      };
    };
    for (const [lat, lon, zoom] of [
      [47.6582, -2.7608, 16],
      [48.8566, 2.3522, 18],
      [-33.8688, 151.2093, 12],
    ]) {
      const { x, y } = worldPixel(lat, lon, zoom);
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      const northWest = corner(tx, ty, zoom);
      const southEast = corner(tx + 1, ty + 1, zoom);
      expect(lon).toBeGreaterThanOrEqual(northWest.lon);
      expect(lon).toBeLessThan(southEast.lon);
      expect(lat).toBeLessThanOrEqual(northWest.lat);
      expect(lat).toBeGreaterThan(southEast.lat);
    }
  });
});

describe('tileGrid', () => {
  const places = [
    [47.6582, -2.7608, 16],
    [48.8566, 2.3522, 18],
    [43.2965, 5.3698, 12],
    [-33.8688, 151.2093, 15],
    [0, 0, 3],
    [64.1466, -21.9426, 19],
  ] as const;

  it.each(places)('covers the whole frame around %s, %s at zoom %s', (lat, lon, zoom) => {
    const grid = tileGrid(lat, lon, zoom);
    expect(grid.tiles).toHaveLength(grid.cols * grid.rows);
    expect(grid.offsetX - VIEW_WIDTH / 2).toBeGreaterThanOrEqual(-0.5);
    expect(grid.offsetX + VIEW_WIDTH / 2).toBeLessThanOrEqual(grid.cols * TILE_SIZE + 0.5);
    expect(grid.offsetY - VIEW_HEIGHT / 2).toBeGreaterThanOrEqual(-0.5);
    expect(grid.offsetY + VIEW_HEIGHT / 2).toBeLessThanOrEqual(grid.rows * TILE_SIZE + 0.5);
  });

  it.each(places)('asks for no more tiles than the frame needs (%s, %s)', (lat, lon, zoom) => {
    const grid = tileGrid(lat, lon, zoom);
    expect(grid.cols).toBeGreaterThanOrEqual(3);
    expect(grid.cols).toBeLessThanOrEqual(4);
    expect(grid.rows).toBeGreaterThanOrEqual(2);
    expect(grid.rows).toBeLessThanOrEqual(3);
  });

  it('holds the place’s own tile, at the place’s zoom', () => {
    const grid = tileGrid(47.6582, -2.7608, 16);
    const { x, y } = worldPixel(47.6582, -2.7608, 16);
    expect(grid.tiles).toContainEqual({ z: 16, x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) });
    expect(grid.tiles.every((tile) => tile?.z === 16)).toBe(true);
  });

  it('lists the tiles row by row, west to east', () => {
    const grid = tileGrid(47.6582, -2.7608, 16);
    const first = grid.tiles[0]!;
    expect(grid.tiles[1]).toEqual({ z: 16, x: first.x + 1, y: first.y });
    expect(grid.tiles[grid.cols]).toEqual({ z: 16, x: first.x, y: first.y + 1 });
  });

  it('wraps around the antimeridian', () => {
    const grid = tileGrid(0, 179.99, 3);
    const xs = grid.tiles.map((tile) => tile?.x);
    expect(xs).toContain(7);
    expect(xs).toContain(0);
    expect(xs.every((x) => x !== undefined && x >= 0 && x < 8)).toBe(true);
  });

  it('leaves the rows past the pole empty', () => {
    const grid = tileGrid(85, 0, 3);
    expect(grid.tiles.slice(0, grid.cols).every((tile) => tile === null)).toBe(true);
    expect(grid.tiles.some((tile) => tile !== null)).toBe(true);
  });
});

describe('parseTile', () => {
  it('reads a tile the world has', () => {
    expect(parseTile('16', '32265', '22873')).toEqual({ z: 16, x: 32265, y: 22873 });
    expect(parseTile(String(MIN_ZOOM), '0', '0')).toEqual({ z: MIN_ZOOM, x: 0, y: 0 });
  });

  it.each([
    ['a zoom below the range', String(MIN_ZOOM - 1), '0', '0'],
    ['a zoom above the range', String(MAX_ZOOM + 1), '0', '0'],
    ['a column past the world', '3', '8', '0'],
    ['a row past the world', '3', '0', '8'],
    ['a sign', '16', '+1', '0'],
    ['a negative', '16', '-1', '0'],
    ['an exponent', '16', '1e3', '0'],
    ['a decimal', '16', '1.5', '0'],
    ['an empty segment', '16', '', '0'],
    ['a missing segment', '16', undefined, '0'],
  ])('refuses %s', (_label, z, x, y) => {
    expect(parseTile(z, x, y)).toBeNull();
  });
});

describe('tileServerUrl', () => {
  it('fills a {z}/{x}/{y} template, wherever the placeholders sit', () => {
    const tile = { z: 16, x: 32265, y: 22873 };
    expect(tileServerUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png', tile)).toBe(
      'https://tile.openstreetmap.org/16/32265/22873.png',
    );
    expect(tileServerUrl('https://tiles.example/wmts?TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', tile)).toBe(
      'https://tiles.example/wmts?TILEMATRIX=16&TILEROW=22873&TILECOL=32265',
    );
  });
});
