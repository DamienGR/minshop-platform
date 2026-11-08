import { describe, expect, it } from 'vitest';
import { parseSeoFields, SEO_DESCRIPTION_MAX, seoLength, seoText } from './fields';
import { documentTitle } from './meta';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe('the title and description for search engines (ticket #216)', () => {
  it('reads both, one line each, and empty as none', () => {
    expect(parseSeoFields(form({ seo_title: '  Sac à dos\n brodé  ', seo_description: '\tUn sac.\r\n' }))).toEqual({
      data: { seo_title: 'Sac à dos brodé', seo_description: 'Un sac.' },
    });
    expect(parseSeoFields(form({ seo_title: '   ', seo_description: '' }))).toEqual({
      data: { seo_title: null, seo_description: null },
    });
    // A form without the box says nothing either.
    expect(parseSeoFields(new FormData())).toEqual({ data: { seo_title: null, seo_description: null } });
  });

  it('refuses a description past 160 characters, counted as a reader counts them', () => {
    const accented = 'é'.repeat(SEO_DESCRIPTION_MAX);
    expect(parseSeoFields(form({ seo_description: accented }))).toEqual({
      data: { seo_title: null, seo_description: accented },
    });
    // An emoji is one character, though two UTF-16 units.
    expect(seoLength('🧵'.repeat(SEO_DESCRIPTION_MAX))).toBe(SEO_DESCRIPTION_MAX);
    expect('error' in parseSeoFields(form({ seo_description: '🧵'.repeat(SEO_DESCRIPTION_MAX) }))).toBe(false);

    const refused = parseSeoFields(form({ seo_description: `${accented}e` }));
    expect(refused).toEqual({ error: 'La description pour Google ne doit pas dépasser 160 caractères.' });
  });

  it('only guides the title: a long one is the merchant’s call', () => {
    const long = 'Sac à dos enfant brodé au prénom, coton biologique, fabriqué à la main en France';
    expect(parseSeoFields(form({ seo_title: long }))).toEqual({ data: { seo_title: long, seo_description: null } });
  });

  it('folds whitespace the way the catalogue import does', () => {
    expect(seoText(null)).toBeNull();
    expect(seoText(' a   b ')).toBe('a b');
  });
});

describe('documentTitle', () => {
  it('uses a written title as it stands, without the store suffix', () => {
    expect(documentTitle({ seoTitle: 'Sac brodé au prénom', title: 'Sac', storeName: 'Atelier' })).toBe(
      'Sac brodé au prénom',
    );
  });

  it('derives the title as before when none is written', () => {
    expect(documentTitle({ seoTitle: null, title: 'Sac', storeName: 'Atelier' })).toBe('Sac — Atelier');
    expect(documentTitle({ seoTitle: '', title: 'Sac', storeName: 'Atelier' })).toBe('Sac — Atelier');
    expect(documentTitle({ storeName: 'Atelier' })).toBe('Atelier');
  });
});
