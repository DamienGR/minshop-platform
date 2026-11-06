import { describe, expect, it } from 'vitest';
import {
  modelMarkdownTexts,
  parsePageZonesForm,
  readStoredZones,
  resolvePageZones,
  serializeZones,
  storedZoneTexts,
  zoneFieldName,
  zoneMoveValue,
  zoneRemoveName,
  ZONE_MOVE,
  type StoredZones,
} from './zones';
import type { ThemePageModel } from '../storefront/models';

const MODEL: ThemePageModel = {
  key: 'points-de-vente',
  label: 'Où nous trouver',
  body: { label: 'Introduction' },
  zones: [
    { key: 'accroche', label: 'Accroche', format: 'text', maxLength: 20 },
    { key: 'note', label: 'Note', format: 'markdown', maxLength: 200 },
    {
      key: 'points',
      label: 'Points de vente',
      itemLabel: 'Point de vente',
      maxItems: 3,
      fields: [
        { key: 'nom', label: 'Nom', format: 'text', maxLength: 30 },
        { key: 'details', label: 'Détails', format: 'markdown', maxLength: 200 },
      ],
    },
  ],
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

const entry = (index: number, nom: string, details = '') => ({
  [zoneFieldName('points', index, 'nom')]: nom,
  [zoneFieldName('points', index, 'details')]: details,
});

const parsed = (result: ReturnType<typeof parsePageZonesForm>) => {
  if ('error' in result) throw new Error(result.error);
  return result.zones;
};

describe('stored zones (ADR 0031)', () => {
  it('reads what the column holds, and nothing it cannot read', () => {
    expect(readStoredZones('{"a":"x","b":[{"nom":"N","n":3}],"c":5}')).toEqual({ a: 'x', b: [{ nom: 'N' }] });
    expect(readStoredZones('')).toEqual({});
    expect(readStoredZones('not json')).toEqual({});
    expect(readStoredZones('[1,2]')).toEqual({});
  });

  it('writes the keys in one order, so an unchanged page stores the same text', () => {
    expect(serializeZones({ b: 'y', a: 'x' })).toBe('{"a":"x","b":"y"}');
  });

  it('lists every text it holds, the model in use or not, for the media library', () => {
    expect(storedZoneTexts({ a: 'x', old: [{ nom: 'N', details: '![P](/images/media/p.webp)' }] })).toEqual([
      'x',
      'N',
      '![P](/images/media/p.webp)',
    ]);
  });

  it('names the Markdown texts the model draws, and only those', () => {
    const zones: StoredZones = {
      accroche: 'Ligne',
      note: 'Une **note**',
      points: [{ nom: 'Marché', details: '```carte' }, { nom: 'Atelier' }],
      gone: 'An old zone',
    };
    expect(modelMarkdownTexts(MODEL, zones)).toEqual([
      { label: 'Note', text: 'Une **note**' },
      { label: 'Points de vente, 1 — Détails', text: '```carte' },
    ]);
    expect(modelMarkdownTexts(null, zones)).toEqual([]);
  });
});

describe('the editor’s form, read', () => {
  it('stores what the model’s zones hold, and keeps the others', () => {
    const zones = parsed(
      parsePageZonesForm(
        form({ [zoneFieldName('accroche')]: '  Né   à l’atelier ', [zoneFieldName('note')]: 'Texte\r\n', ...entry(0, 'Marché', 'Le samedi') }),
        MODEL,
        { other: 'gardé' },
      ),
    );
    expect(zones).toEqual({
      other: 'gardé',
      accroche: 'Né à l’atelier',
      note: 'Texte',
      points: [{ nom: 'Marché', details: 'Le samedi' }],
    });
  });

  it('leaves a zone the form did not send, and removes one it sent empty', () => {
    const stored = { accroche: 'Avant', note: 'Gardée', points: [{ nom: 'A' }] };
    expect(parsed(parsePageZonesForm(form({ [zoneFieldName('accroche')]: ' ' }), MODEL, stored))).toEqual({
      note: 'Gardée',
      points: [{ nom: 'A' }],
    });
  });

  it('drops the blank entry the editor offers, and the ones marked to remove', () => {
    const zones = parsed(
      parsePageZonesForm(
        form({ ...entry(0, 'A'), ...entry(1, 'B'), [zoneRemoveName('points', 1)]: 'on', ...entry(2, '', ''), ...entry(3, 'D') }),
        MODEL,
        {},
      ),
    );
    expect(zones.points).toEqual([{ nom: 'A' }, { nom: 'D' }]);
    expect(parsed(parsePageZonesForm(form({ ...entry(0, '', '') }), MODEL, { points: [{ nom: 'A' }] }))).toEqual({});
  });

  it('reads the entries past a gap, in the order of their numbers', () => {
    // The editor's script numbers each entry it adds, and drops one the
    // merchant takes back before saving: the numbers the form sends may skip.
    const zones = parsed(parsePageZonesForm(form({ ...entry(0, 'A'), ...entry(4, 'E'), ...entry(2, 'C') }), MODEL, {}));
    expect(zones.points).toEqual([{ nom: 'A' }, { nom: 'C' }, { nom: 'E' }]);
  });

  it('moves an entry up or down when its button was pressed', () => {
    const three = { ...entry(0, 'A'), ...entry(1, 'B'), ...entry(2, 'C') };
    const order = (move: string) =>
      (parsed(parsePageZonesForm(form({ ...three, [ZONE_MOVE]: move }), MODEL, {})).points as Array<{ nom: string }>).map(
        (point) => point.nom,
      );
    expect(order(zoneMoveValue('points', 2, 'up'))).toEqual(['A', 'C', 'B']);
    expect(order(zoneMoveValue('points', 0, 'down'))).toEqual(['B', 'A', 'C']);
    // Off the ends, or another zone's: nothing moves.
    expect(order(zoneMoveValue('points', 0, 'up'))).toEqual(['A', 'B', 'C']);
    expect(order(zoneMoveValue('autre', 1, 'up'))).toEqual(['A', 'B', 'C']);
    expect(order('up:points:x')).toEqual(['A', 'B', 'C']);
  });

  it('refuses a text too long, naming it, and writes nothing', () => {
    const result = parsePageZonesForm(form({ [zoneFieldName('accroche')]: 'x'.repeat(21) }), MODEL, {});
    expect(result).toEqual({ error: '« Accroche » est trop long : 21 caractères pour 20 au plus. Rien n’a été enregistré.' });
    const field = parsePageZonesForm(form({ ...entry(0, 'A'), ...entry(1, 'x'.repeat(31)) }), MODEL, {});
    expect('error' in field && field.error).toContain('« Points de vente, 2 — Nom »');
  });

  it('refuses more entries than the model takes', () => {
    const result = parsePageZonesForm(form({ ...entry(0, 'A'), ...entry(1, 'B'), ...entry(2, 'C'), ...entry(3, 'D') }), MODEL, {});
    expect(result).toEqual({ error: '« Points de vente » : 3 entrées au plus. Rien n’a été enregistré.' });
  });

  it('counts characters, not UTF-16 units', () => {
    expect('error' in parsePageZonesForm(form({ [zoneFieldName('accroche')]: '🧵'.repeat(20) }), MODEL, {})).toBe(false);
  });

  it('reads nothing for « Basique »', () => {
    expect(parsed(parsePageZonesForm(form({ [zoneFieldName('accroche')]: 'x' }), null, { a: 'b' }))).toEqual({ a: 'b' });
  });
});

describe('the zones, for the template', () => {
  const render = (markdown: string) => `<p>${markdown}</p>\n`;

  it('hands every declared zone, empty or not', () => {
    const { zones, lists } = resolvePageZones(MODEL, { note: '**N**', points: [{ nom: 'A', details: 'D' }, { nom: 'B' }] }, render);
    expect(zones).toEqual({
      accroche: { text: '', html: null },
      note: { text: '**N**', html: '<p>**N**</p>\n' },
    });
    expect(lists.points).toEqual([
      { nom: { text: 'A', html: null }, details: { text: 'D', html: '<p>D</p>\n' } },
      { nom: { text: 'B', html: null }, details: { text: '', html: '' } },
    ]);
  });

  it('reads a zone that changed shape as empty, and keeps a list to its bound', () => {
    const { zones, lists } = resolvePageZones(
      MODEL,
      { accroche: [{ nom: 'x' }], points: [{ nom: '1' }, { nom: '2' }, { nom: '3' }, { nom: '4' }] },
      render,
    );
    expect(zones.accroche).toEqual({ text: '', html: null });
    expect(lists.points.map((point) => point.nom.text)).toEqual(['1', '2', '3']);
    expect(resolvePageZones(MODEL, { points: 'a text' }, render).lists.points).toEqual([]);
  });
});
