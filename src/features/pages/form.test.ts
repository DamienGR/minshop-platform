import { describe, it, expect } from 'vitest';
import { MAX_ZONES, parsePageForm } from './form';
import { NARROW_NBSP } from '../i18n';
import { pageSlugify } from './slug';
import { zoneFieldName } from '../pageModels/zones';
import type { ThemePageModel } from '../storefront/models';

const MARQUE: ThemePageModel = {
  key: 'marque',
  label: 'La marque',
  body: { label: 'L’histoire' },
  zones: [{ key: 'accroche', label: 'Accroche', format: 'text', maxLength: 160 }],
};

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

describe('parsePageForm', () => {
  it('accepts a minimal page', () => {
    const parsed = parsePageForm(form({ title: 'About us' }));
    expect(parsed).toEqual({
      data: {
        title: 'About us',
        slug: '',
        body_markdown: '',
        published: 0,
        layout: 'standard',
        model: '',
        zones: {},
        seo_title: null,
        seo_description: null,
      },
    });
  });

  it('reads the title and description for search engines (ticket #216)', () => {
    expect(
      parsePageForm(form({ title: 'Où nous trouver', seo_title: 'Nos points de vente à Lyon', seo_description: ' Trois boutiques. ' })),
    ).toMatchObject({ data: { seo_title: 'Nos points de vente à Lyon', seo_description: 'Trois boutiques.' } });
    expect(parsePageForm(form({ title: 'A', seo_description: 'x'.repeat(161) }))).toEqual({
      error: 'La description pour Google ne doit pas dépasser 160 caractères.',
    });
  });

  it('accepts a known layout preset', () => {
    expect(parsePageForm(form({ title: 'A', layout: 'wide' }))).toHaveProperty(
      'data.layout',
      'wide',
    );
  });

  it('falls back to the default layout for an unknown preset', () => {
    expect(parsePageForm(form({ title: 'A', layout: 'nope' }))).toHaveProperty(
      'data.layout',
      'standard',
    );
  });

  it('requires a title', () => {
    expect(parsePageForm(form({ title: '   ' }))).toEqual({ error: 'Le titre est obligatoire.' });
  });

  it('rejects an over-long title', () => {
    const result = parsePageForm(form({ title: 'x'.repeat(121) }));
    expect(result).toHaveProperty('error', 'Le titre ne doit pas dépasser 120 caractères.');
  });

  it('accepts a title at the limit', () => {
    expect(parsePageForm(form({ title: 'x'.repeat(120) }))).toHaveProperty('data');
  });

  it('rejects a body over 100,000 characters', () => {
    const result = parsePageForm(form({ title: 'A', body_markdown: 'x'.repeat(100_001) }));
    // The limit reads the French way (`100 000`), not as the runtime's default locale.
    expect(result).toHaveProperty(
      'error',
      `Le contenu de la page ne doit pas dépasser 100${NARROW_NBSP}000 caractères.`,
    );
  });

  it('treats a present checkbox as published', () => {
    const parsed = parsePageForm(form({ title: 'A', published: 'on' }));
    expect(parsed).toHaveProperty('data.published', 1);
  });

  it('treats an absent checkbox as draft', () => {
    expect(parsePageForm(form({ title: 'A' }))).toHaveProperty('data.published', 0);
  });

  it('preserves body whitespace, which is meaningful in Markdown', () => {
    const parsed = parsePageForm(form({ title: 'A', body_markdown: '  indented\n\n- list' }));
    expect(parsed).toHaveProperty('data.body_markdown', '  indented\n\n- list');
  });

  it('takes a model the theme declares, and reads « Basique » for any other (ADR 0031)', () => {
    const context = { models: [MARQUE] };
    expect(parsePageForm(form({ title: 'A', model: 'marque' }), context)).toHaveProperty('data.model', 'marque');
    expect(parsePageForm(form({ title: 'A', model: 'gone' }), context)).toHaveProperty('data.model', '');
    expect(parsePageForm(form({ title: 'A', model: '' }), context)).toHaveProperty('data.model', '');
  });

  it('keeps the stored model when the form sends none, the theme having lost its models', () => {
    const stored = { model: 'marque', zones: { accroche: 'Gardée' } };
    expect(parsePageForm(form({ title: 'A' }), { stored })).toMatchObject({
      data: { model: 'marque', zones: { accroche: 'Gardée' } },
    });
  });

  it('reads the zones of the model the page had, the one the editor drew', () => {
    const fields = { title: 'A', model: '', [zoneFieldName('accroche')]: 'Nouvelle' };
    const switched = parsePageForm(form(fields), { models: [MARQUE], stored: { model: 'marque', zones: {} } });
    // Leaving the model keeps what its zones held, for a return to it.
    expect(switched).toMatchObject({ data: { model: '', zones: { accroche: 'Nouvelle' } } });
    const basic = parsePageForm(form(fields), { models: [MARQUE], stored: { model: '', zones: {} } });
    expect(basic).toMatchObject({ data: { zones: {} } });
  });

  it('refuses zones too long, one by one or together', () => {
    const one = parsePageForm(form({ title: 'A', [zoneFieldName('accroche')]: 'x'.repeat(161) }), {
      models: [MARQUE],
      stored: { model: 'marque', zones: {} },
    });
    expect(one).toHaveProperty('error');
    const together = parsePageForm(form({ title: 'A' }), {
      stored: { model: '', zones: { old: 'x'.repeat(MAX_ZONES) } },
    });
    expect(together).toEqual({
      error: `Les zones de la page ne doivent pas dépasser 200${NARROW_NBSP}000 caractères en tout.`,
    });
  });
});

describe('pageSlugify', () => {
  it('slugifies a title', () => {
    expect(pageSlugify('Shipping & Returns')).toBe('shipping-returns');
  });

  it('falls back to `page`, not the product helper default', () => {
    // slugify() returns 'product' for input that reduces to nothing, which would
    // be a confusing slug for a content page.
    expect(pageSlugify('!!!')).toBe('page');
    expect(pageSlugify('')).toBe('page');
  });

  it('still honours a title that genuinely says "product"', () => {
    expect(pageSlugify('Product care')).toBe('product-care');
    expect(pageSlugify('Product')).toBe('product');
  });
});
