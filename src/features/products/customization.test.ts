import { describe, expect, it } from 'vitest';
import {
  checkCustomization,
  customizationText,
  decodeCustomValues,
  encodeCustomValues,
  normalizeCustomValue,
  parseCustomization,
  readCustomValues,
  serializeCustomization,
  type ProductCustomField,
} from './customization';

const field = (overrides: Partial<ProductCustomField>): ProductCustomField => ({
  id: 1,
  public_id: 'cfld_0000000001',
  product_id: 7,
  label: 'Nom à broder',
  help_text: null,
  max_length: 15,
  required: 1,
  position: 0,
  ...overrides,
});

const NAME = field({});
const MESSAGE = field({ id: 2, public_id: 'cfld_0000000002', label: 'Message', max_length: 40, required: 0, position: 1 });

describe('normalizeCustomValue', () => {
  it('keeps one line of text, trimmed, with single spaces', () => {
    expect(normalizeCustomValue('  Léa \n\t Martin  ')).toBe('Léa Martin');
  });
  it('composes accents, so « é » counts once whatever the keyboard sent', () => {
    expect(normalizeCustomValue('Léa')).toBe('Léa');
  });
  it('drops the controls that would make an order read backwards', () => {
    expect(normalizeCustomValue('Tom‮éiv')).toBe('Toméiv');
  });
  it('reads nothing as blank', () => {
    expect(normalizeCustomValue(undefined)).toBe('');
    expect(normalizeCustomValue(null)).toBe('');
  });
});

describe('checkCustomization', () => {
  it('returns the answers in the fields’ order, as an order line keeps them', () => {
    const check = checkCustomization([NAME, MESSAGE], {
      [MESSAGE.public_id!]: ' Joyeux anniversaire ',
      [NAME.public_id!]: 'Léa',
    });
    expect(check).toEqual({
      ok: true,
      values: { [NAME.public_id!]: 'Léa', [MESSAGE.public_id!]: 'Joyeux anniversaire' },
      entries: [
        { label: 'Nom à broder', value: 'Léa' },
        { label: 'Message', value: 'Joyeux anniversaire' },
      ],
    });
  });

  it('refuses a required field left blank, naming it', () => {
    const check = checkCustomization([NAME], { [NAME.public_id!]: '   ' });
    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toContain('Nom à broder');
  });

  it('lets an optional field stay blank, and keeps nothing for it', () => {
    expect(checkCustomization([MESSAGE], {})).toEqual({ ok: true, values: {}, entries: [] });
  });

  it('refuses a text past the maximum rather than cutting a name short', () => {
    const check = checkCustomization([NAME], { [NAME.public_id!]: 'Anne-Charlotte Dupont' });
    expect(check.ok).toBe(false);
    expect(!check.ok && check.error).toContain('15');
  });

  it('counts characters, not UTF-16 units', () => {
    const emoji = '😀'.repeat(15);
    expect(checkCustomization([NAME], { [NAME.public_id!]: emoji }).ok).toBe(true);
  });

  it('drops a value for a field the product does not have', () => {
    const check = checkCustomization([MESSAGE], { cfld_zzzzzzzzzz: 'x' });
    expect(check).toEqual({ ok: true, values: {}, entries: [] });
  });
});

describe('readCustomValues', () => {
  it('reads each field under custom:<cfld_…>', () => {
    const form = new FormData();
    form.set(`custom:${NAME.public_id}`, 'Léa');
    form.set('custom:cfld_zzzzzzzzzz', 'ignored');
    expect(readCustomValues([NAME, MESSAGE], (name) => form.get(name))).toEqual({ [NAME.public_id!]: 'Léa' });
  });
});

describe('the cart-key segment', () => {
  it('round-trips, whatever order the answers came in', () => {
    const values = { cfld_0000000002: 'Joyeux anniversaire', cfld_0000000001: 'Léa' };
    const token = encodeCustomValues(values);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCustomValues(token)).toEqual(values);
    expect(encodeCustomValues({ cfld_0000000001: 'Léa', cfld_0000000002: 'Joyeux anniversaire' })).toBe(token);
  });

  it('is empty for no answer', () => {
    expect(encodeCustomValues({})).toBe('');
  });

  const raw = (pairs: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(pairs))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  it('refuses a token that is not the canonical one', () => {
    // Unsorted, so the same answers could otherwise make a second line.
    expect(decodeCustomValues(raw([['cfld_0000000002', 'b'], ['cfld_0000000001', 'a']]))).toBeNull();
    // Padded.
    expect(decodeCustomValues(`${encodeCustomValues({ cfld_0000000001: 'a' })}=`)).toBeNull();
  });

  it('refuses what checkout would never have written', () => {
    expect(decodeCustomValues(raw([['prod_0000000001', 'a']]))).toBeNull();
    expect(decodeCustomValues(raw([['cfld_0000000001', ' a']]))).toBeNull();
    expect(decodeCustomValues(raw([['cfld_0000000001', '']]))).toBeNull();
    expect(decodeCustomValues(raw([['cfld_0000000001', 'x'.repeat(201)]]))).toBeNull();
    expect(decodeCustomValues(raw({ cfld_0000000001: 'a' }))).toBeNull();
    expect(decodeCustomValues(raw([]))).toBeNull();
    expect(decodeCustomValues('%%%')).toBeNull();
    expect(decodeCustomValues('')).toBeNull();
  });
});

describe('what a line shows', () => {
  it('reads « label : text » with French spacing', () => {
    expect(customizationText({ label: 'Nom à broder', value: 'Léa' })).toBe('Nom à broder : Léa');
  });

  it('stores JSON, and reads it back', () => {
    const entries = [{ label: 'Nom à broder', value: 'Léa' }];
    expect(parseCustomization(serializeCustomization(entries))).toEqual(entries);
    expect(serializeCustomization([])).toBeNull();
  });

  it('reads an erased or garbled line as no answer', () => {
    expect(parseCustomization(null)).toEqual([]);
    expect(parseCustomization('{pas du json')).toEqual([]);
    expect(parseCustomization('[{"label":1}]')).toEqual([]);
  });
});
