import { describe, expect, it } from 'vitest';
import { parseDiscountForm } from './form';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const base = { code: 'noel10', kind: 'percent', value: '10', active: 'on' };
const parse = (fields: Record<string, string>) => parseDiscountForm(form(fields), 'eur', () => 'ABCD-EFGH-JKMN');

describe('parseDiscountForm', () => {
  it('reads a percentage code, in capitals, with no condition', () => {
    expect(parse(base)).toEqual({
      data: {
        code: 'NOEL10',
        kind: 'percent',
        value: 10,
        min_subtotal_cents: 0,
        starts_on: null,
        ends_on: null,
        max_uses: null,
        active: 1,
      },
    });
  });

  it('draws a code when the field is left empty', () => {
    const parsed = parse({ ...base, code: '  ' });
    expect('data' in parsed && parsed.data.code).toBe('ABCD-EFGH-JKMN');
  });

  it('reads an amount in major units, with a comma or a point', () => {
    for (const value of ['12,50', '12.50', '12,5', ' 12,50 ']) {
      const parsed = parse({ ...base, kind: 'amount', value });
      expect('data' in parsed && parsed.data.value).toBe(1250);
    }
  });

  it('reads the conditions', () => {
    const parsed = parse({
      ...base,
      min_subtotal: '40',
      starts_on: '2026-12-01',
      ends_on: '2026-12-31',
      max_uses: '1',
    });
    expect('data' in parsed && parsed.data).toMatchObject({
      min_subtotal_cents: 4000,
      starts_on: '2026-12-01',
      ends_on: '2026-12-31',
      max_uses: 1,
    });
  });

  it('reads an unticked box as switched off', () => {
    const { active: _active, ...unticked } = base;
    const parsed = parse(unticked);
    expect('data' in parsed && parsed.data.active).toBe(0);
  });

  it.each([
    [{ code: 'NO' }, 'Le code ne doit contenir'],
    [{ code: 'NOËL' }, 'Le code ne doit contenir'],
    [{ kind: 'gift' }, 'Choisissez l’unité'],
    [{ value: '0' }, 'Un pourcentage'],
    [{ value: '101' }, 'Un pourcentage'],
    [{ value: '12,5' }, 'Un pourcentage'],
    [{ kind: 'amount', value: '' }, 'Indiquez le montant'],
    [{ kind: 'amount', value: 'dix' }, 'Indiquez le montant'],
    [{ kind: 'amount', value: '0' }, 'Indiquez le montant'],
    [{ min_subtotal: 'trente' }, 'Le minimum d’achat'],
    [{ starts_on: '01/12/2026' }, 'Une date n’est pas valide'],
    [{ ends_on: '2026-02-30' }, 'Une date n’est pas valide'],
    [{ starts_on: '2026-12-31', ends_on: '2026-12-01' }, 'La date de fin précède'],
    [{ max_uses: '0' }, 'Le nombre d’utilisations'],
    [{ max_uses: '1,5' }, 'Le nombre d’utilisations'],
  ])('refuses %j', (fields, message) => {
    const parsed = parse({ ...base, ...fields });
    expect('error' in parsed && parsed.error).toContain(message);
  });
});
