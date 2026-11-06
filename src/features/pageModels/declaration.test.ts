import { describe, expect, it } from 'vitest';
import { pageModelOf, pageModelProblems, validPageModels } from './declaration';
import type { ThemePageModel } from '../storefront/models';

const MARQUE: ThemePageModel = {
  key: 'marque',
  label: 'La marque',
  help: 'Une accroche, puis l’histoire.',
  body: { label: 'L’histoire' },
  zones: [{ key: 'accroche', label: 'Accroche', format: 'text', maxLength: 160 }],
};

const POINTS: ThemePageModel = {
  key: 'points-de-vente',
  label: 'Où nous trouver',
  body: { label: 'Introduction' },
  zones: [
    {
      key: 'points',
      label: 'Points de vente',
      itemLabel: 'Point de vente',
      maxItems: 20,
      fields: [
        { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 },
        { key: 'details', label: 'Adresse, horaires et carte', format: 'markdown', maxLength: 2000 },
      ],
    },
  ],
};

describe('page model declarations (ADR 0031)', () => {
  it('accepts a text zone and a list', () => {
    expect(pageModelProblems([MARQUE, POINTS])).toEqual([]);
  });

  it('wants an array', () => {
    expect(pageModelProblems({ marque: MARQUE })).toEqual(['`pageModels` must be an array of models.']);
  });

  it('names a model by a key that can be a file name, never the core’s own', () => {
    expect(pageModelProblems([{ ...MARQUE, key: 'La marque' }])[0]).toMatch(/the key must be/);
    expect(pageModelProblems([{ ...MARQUE, key: 'marque/../x' }])[0]).toMatch(/the key must be/);
    expect(pageModelProblems([{ ...MARQUE, key: 'basique' }])).toEqual([
      '"basique" is the core\'s own model; pick another key.',
    ]);
    expect(pageModelProblems([MARQUE, MARQUE])).toEqual(['"marque" is declared twice.']);
  });

  it('wants a label for the model and for its body', () => {
    expect(pageModelProblems([{ ...MARQUE, label: ' ' }])[0]).toMatch(/"marque": the label/);
    expect(pageModelProblems([{ ...MARQUE, body: undefined }])[0]).toMatch(/body must be an object/);
    expect(pageModelProblems([{ ...MARQUE, body: { label: '' } }])[0]).toMatch(/"marque", body: the label/);
  });

  it('keeps zone and field keys to letters and digits, the form’s separators free', () => {
    const zone = (key: string) => ({ ...MARQUE, zones: [{ ...MARQUE.zones[0], key }] });
    expect(pageModelProblems([zone('sous.titre')])[0]).toMatch(/letters or digits/);
    expect(pageModelProblems([zone('sous-titre')])[0]).toMatch(/letters or digits/);
    expect(pageModelProblems([zone('sousTitre')])).toEqual([]);
    expect(pageModelProblems([{ ...MARQUE, zones: [MARQUE.zones[0], MARQUE.zones[0]] }])).toEqual([
      '"marque", zone "accroche" is declared twice.',
    ]);
  });

  it('bounds a text’s format and length', () => {
    const zone = (extra: object) => ({ ...MARQUE, zones: [{ ...MARQUE.zones[0], ...extra }] });
    expect(pageModelProblems([zone({ format: 'html' })])[0]).toMatch(/format must be/);
    expect(pageModelProblems([zone({ maxLength: 0 })])[0]).toMatch(/maxLength must be/);
    expect(pageModelProblems([zone({ maxLength: 20_001 })])[0]).toMatch(/maxLength must be/);
  });

  it('wants a list’s entry name, its bound and its fields, and none of a text’s keys', () => {
    const list = POINTS.zones[0];
    const with_ = (extra: object) => ({ ...POINTS, zones: [{ ...list, ...extra }] });
    expect(pageModelProblems([with_({ itemLabel: '' })])[0]).toMatch(/itemLabel/);
    expect(pageModelProblems([with_({ maxItems: 51 })])[0]).toMatch(/maxItems must be/);
    expect(pageModelProblems([with_({ fields: [] })])[0]).toMatch(/fields must be a non-empty array/);
    expect(pageModelProblems([with_({ format: 'text' })])[0]).toMatch(/a list has fields/);
    expect(
      pageModelProblems([with_({ fields: [{ key: 'nom', label: 'Nom', format: 'text', maxLength: 100 }, { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 }] })]),
    ).toEqual(['"points-de-vente", zone "points", field "nom" is declared twice.']);
  });

  it('keeps the valid models when one is not', () => {
    expect(validPageModels([MARQUE, { ...POINTS, label: '' }, MARQUE]).map((model) => model.key)).toEqual(['marque']);
    expect(validPageModels('nope')).toEqual([]);
  });

  it('finds the model a page names, or « Basique »', () => {
    expect(pageModelOf([MARQUE, POINTS], 'points-de-vente')).toBe(POINTS);
    expect(pageModelOf([MARQUE], 'points-de-vente')).toBeNull();
    expect(pageModelOf([MARQUE], '')).toBeNull();
  });
});
