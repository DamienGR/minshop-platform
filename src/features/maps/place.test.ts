import { describe, expect, it } from 'vitest';
import { MAX_ADDRESS_LINES, MAX_NAME, isPlaceMapInfo, parsePlace, parsePosition } from './place';
import { DEFAULT_ZOOM } from './tiles';

const keysOf = (source: string) => {
  const parsed = parsePlace(source);
  return 'errors' in parsed ? parsed.errors.map((error) => [error.line, error.key]) : [];
};

describe('isPlaceMapInfo', () => {
  it.each(['carte', 'Carte', '  carte  ', 'carte de Vannes'])('takes %j', (info) => {
    expect(isPlaceMapInfo(info)).toBe(true);
  });

  it.each(['', 'cartes', 'map', 'js', 'ma carte'])('leaves %j a code block', (info) => {
    expect(isPlaceMapInfo(info)).toBe(false);
  });
});

describe('parsePosition', () => {
  it.each([
    ['as OpenStreetMap and Google Maps copy it', '47.6582, -2.7608'],
    ['without the space', '47.6582,-2.7608'],
    ['with a space only', '47.6582 -2.7608'],
    ['with decimal commas and a semicolon', '47,6582 ; -2,7608'],
    ['with a sign on both', '+47.6582, -2.7608'],
  ])('reads a position written %s', (_label, value) => {
    expect(parsePosition(value)).toEqual({ lat: 47.6582, lon: -2.7608 });
  });

  it.each([
    ['decimal commas without a semicolon', '47,6582, -2,7608'],
    ['words', 'Vannes'],
    ['one number', '47.6582'],
    ['three numbers', '47.6582, -2.7608, 16'],
    ['a latitude past Web Mercator', '86, 2'],
    ['a longitude past the antimeridian', '47, 181'],
    ['an exponent', '4.7e1, -2.7'],
    ['degrees and minutes', '47°39′N, 2°45′W'],
  ])('refuses %s', (_label, value) => {
    expect(parsePosition(value)).toBeNull();
  });
});

describe('parsePlace', () => {
  it('reads a whole block', () => {
    expect(
      parsePlace(
        'lieu: Marché de Vannes\nadresse: Place du Poids public\nadresse: 56000 Vannes\nposition: 47.6582, -2.7608\nzoom: 17\n',
      ),
    ).toEqual({
      place: {
        name: 'Marché de Vannes',
        address: ['Place du Poids public', '56000 Vannes'],
        lat: 47.6582,
        lon: -2.7608,
        zoom: 17,
      },
    });
  });

  it('needs only the position', () => {
    expect(parsePlace('position: 47.6582, -2.7608')).toEqual({
      place: { name: null, address: [], lat: 47.6582, lon: -2.7608, zoom: DEFAULT_ZOOM },
    });
  });

  it('takes the keys in any case, a space before the colon and blank lines', () => {
    const parsed = parsePlace('\nLieu : Halles\n\n  Position :  47.6582, -2.7608  \r\n');
    expect(parsed).toEqual({
      place: { name: 'Halles', address: [], lat: 47.6582, lon: -2.7608, zoom: DEFAULT_ZOOM },
    });
  });

  it('keeps a colon inside a value', () => {
    const parsed = parsePlace('lieu: Marché : le samedi\nposition: 47.6582, -2.7608');
    expect('place' in parsed && parsed.place.name).toBe('Marché : le samedi');
  });

  it('says the position is missing, on the line after the block', () => {
    expect(keysOf('lieu: Halles\nadresse: Vannes')).toEqual([[3, 'admin.pages.map.error.positionMissing']]);
  });

  it('says an empty position is missing, on its own line', () => {
    expect(keysOf('lieu: Halles\nposition: ')).toEqual([[2, 'admin.pages.map.error.positionMissing']]);
  });

  it('reports every problem with its line, not just the first', () => {
    expect(keysOf('lieu: Halles\nadress: Vannes\nposition: Vannes\nzoom: 25\nune ligne')).toEqual([
      [2, 'admin.pages.map.error.unknownKey'],
      [3, 'admin.pages.map.error.position'],
      [4, 'admin.pages.map.error.zoom'],
      [5, 'admin.pages.map.error.lineShape'],
    ]);
  });

  it('names the unknown key it found', () => {
    const parsed = parsePlace('Horaires: le samedi\nposition: 47, -2');
    expect('errors' in parsed && parsed.errors[0].params).toEqual({ cle: 'horaires' });
  });

  it('refuses a key written twice, except the address', () => {
    expect(keysOf('position: 47, -2\nposition: 48, -2')).toEqual([[2, 'admin.pages.map.error.repeated']]);
    expect(keysOf('adresse: a\nadresse: b\nposition: 47, -2')).toEqual([]);
  });

  it(`keeps the address to ${MAX_ADDRESS_LINES} lines`, () => {
    const lines = Array.from({ length: MAX_ADDRESS_LINES + 1 }, (_, i) => `adresse: ligne ${i}`);
    expect(keysOf(`${lines.join('\n')}\nposition: 47, -2`)).toEqual([
      [MAX_ADDRESS_LINES + 1, 'admin.pages.map.error.addressLines'],
    ]);
  });

  it('counts the characters of a name as the merchant sees them', () => {
    const name = 'é'.repeat(MAX_NAME);
    expect(keysOf(`lieu: ${name}\nposition: 47, -2`)).toEqual([]);
    expect(keysOf(`lieu: ${name}é\nposition: 47, -2`)).toEqual([[1, 'admin.pages.map.error.tooLong']]);
  });

  it.each(['2', '20', '16.5', 'seize', '-1'])('refuses the zoom %j', (zoom) => {
    expect(keysOf(`position: 47, -2\nzoom: ${zoom}`)).toEqual([[2, 'admin.pages.map.error.zoom']]);
  });

  it('refuses a control character in a value', () => {
    expect(keysOf('lieu: Hal\u0007les\nposition: 47, -2')).toEqual([[1, 'admin.pages.map.error.lineShape']]);
  });
});
