import { describe, expect, it } from 'vitest';
import { normalizeTags, parseTagsInput, readTags, storeTags, TAGS_MAX } from './tags';

describe('product tags (ticket #159)', () => {
  it('turns what the merchant typed into identifiers a theme can match', () => {
    expect(parseTagsInput('Non cousu, Nouveau ,  Pièce unique')).toEqual({
      tags: ['non-cousu', 'nouveau', 'piece-unique'],
    });
  });

  it('drops empty entries and duplicates, keeping the first order', () => {
    expect(parseTagsInput(' , nouveau,,NOUVEAU, Nouveau ')).toEqual({ tags: ['nouveau'] });
    expect(parseTagsInput('')).toEqual({ tags: [] });
  });

  it('refuses rather than drops what cannot be a tag', () => {
    expect(parseTagsInput('nouveau, !!!')).toMatchObject({ error: expect.stringContaining('!!!') });
    expect(parseTagsInput('a'.repeat(41))).toMatchObject({ error: expect.stringContaining('40 caractères') });
    const many = Array.from({ length: TAGS_MAX + 1 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toMatchObject({ error: expect.stringContaining(`${TAGS_MAX} étiquettes`) });
  });

  it('stores them as one column and reads them back', () => {
    expect(storeTags(['non-cousu', 'nouveau'])).toBe('non-cousu,nouveau');
    expect(storeTags([])).toBeNull();
    expect(readTags('non-cousu,nouveau')).toEqual(['non-cousu', 'nouveau']);
    expect(readTags(null)).toEqual([]);
    // Whatever a hand edit left in the column, a theme only ever sees slugs.
    expect(readTags('ok, Pas Ok ,,fine-1')).toEqual(['ok', 'fine-1']);
  });
});
