import { describe, expect, it } from 'vitest';
import type { ThemeTextSlot } from '../storefront/models';
import {
  normalizeThemeText,
  parseThemeTextsForm,
  resolveThemeTexts,
  storedThemeTextTooLong,
  themeTextField,
  themeTextSlotProblems,
  validThemeTextSlots,
} from './slots';

const title: ThemeTextSlot = {
  key: 'hero.title',
  label: 'Titre de l’accueil',
  default: 'Né à l’atelier, à Bouillac',
  maxLength: 40,
  format: 'text',
};
const intro: ThemeTextSlot = {
  key: 'hero.intro',
  label: 'Accroche',
  help: 'Sous le titre.',
  default: 'Des sacs *cousus main*.',
  maxLength: 200,
  format: 'markdown',
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('a theme’s text declaration (ticket #165)', () => {
  it('accepts a well-formed declaration', () => {
    expect(themeTextSlotProblems([title, intro])).toEqual([]);
    expect(themeTextSlotProblems([])).toEqual([]);
  });

  it('names each problem for the theme’s developer', () => {
    const problems = themeTextSlotProblems([
      { ...title, key: 'Hero title' },
      { ...intro, key: 'hero.title' },
      { ...intro, key: 'hero.title' },
      { ...title, key: 'a', label: '' },
      { ...title, key: 'b', maxLength: 0 },
      { ...title, key: 'c', format: 'html' },
      { ...title, key: 'd', default: 'x'.repeat(41) },
      { ...title, key: 'e', default: ' padded ' },
      { ...intro, key: 'f', default: '![](/images/media/a.jpg)' },
      'not a slot',
    ]);
    expect(problems.join('\n')).toMatch(/"Hero title": the key/);
    expect(problems.join('\n')).toMatch(/"hero.title" is declared twice/);
    expect(problems.join('\n')).toMatch(/"a": the label/);
    expect(problems.join('\n')).toMatch(/"b": maxLength/);
    expect(problems.join('\n')).toMatch(/"c": the format/);
    expect(problems.join('\n')).toMatch(/"d": the default is longer/);
    expect(problems.join('\n')).toMatch(/"e": the default must be written as it is stored/);
    expect(problems.join('\n')).toMatch(/"f": a default cannot show a store image/);
    expect(problems.join('\n')).toMatch(/slot 10 is not an object/);
    expect(themeTextSlotProblems({ texts: [] })).toEqual(['`texts` must be an array of slots.']);
  });

  // Ticket #175: `\s` matches the no-break spaces, so a default written in
  // French typography read as "not written as it is stored".
  it('accepts a one-line default typeset in French, no-break spaces included', () => {
    expect(themeTextSlotProblems([{ ...title, default: 'Une question\u202f? Écrivez-moi' }])).toEqual([]);
    expect(themeTextSlotProblems([{ ...title, default: 'Atelier\u00a0: Bouillac' }])).toEqual([]);
  });

  it('keeps the slots a running shop can read when one is broken', () => {
    expect(validThemeTextSlots([title, { ...intro, maxLength: -1 }, { ...title, label: 'Doublon' }])).toEqual([title]);
    expect(validThemeTextSlots(undefined)).toEqual([]);
  });
});

describe('the merchant’s texts', () => {
  it('stores a one-line text on one line, a Markdown text trimmed', () => {
    expect(normalizeThemeText('text', '  Né  à\r\nl’atelier ')).toBe('Né à l’atelier');
    expect(normalizeThemeText('markdown', '\r\nUn.\r\n\r\nDeux.  \n')).toBe('Un.\n\nDeux.');
  });

  // Ticket #175: a word processor puts a no-break space before « : » and « ? »;
  // folded into an ordinary one, the storefront could wrap the line before them.
  it('keeps the no-break spaces of a one-line text, folding only the breaking ones', () => {
    expect(normalizeThemeText('text', ' Une question\u00a0?  Écrivez-moi\u202f:\r\n\tici ')).toBe(
      'Une question\u00a0? Écrivez-moi\u202f: ici',
    );
    expect(normalizeThemeText('text', 'Prix\u2007: 12\u00a0€')).toBe('Prix\u2007: 12\u00a0€');
    const parsed = parseThemeTextsForm(form({ [themeTextField('hero.title')]: 'Une question\u202f?' }), [title]);
    expect(parsed).toEqual({ writes: [{ key: 'hero.title', value: 'Une question\u202f?' }] });
  });

  it('returns a slot to its default when the field is empty or unchanged', () => {
    const parsed = parseThemeTextsForm(
      form({ [themeTextField('hero.title')]: '   ', [themeTextField('hero.intro')]: 'Des sacs *cousus main*.' }),
      [title, intro],
    );
    expect(parsed).toEqual({ writes: [{ key: 'hero.title', value: null }, { key: 'hero.intro', value: null }] });
  });

  it('stores what differs, and leaves alone a field the form did not send', () => {
    const parsed = parseThemeTextsForm(form({ [themeTextField('hero.title')]: 'La carte cadeau' }), [title, intro]);
    expect(parsed).toEqual({ writes: [{ key: 'hero.title', value: 'La carte cadeau' }] });
  });

  it('refuses a text too long, with a message naming the field and the limit', () => {
    const parsed = parseThemeTextsForm(form({ [themeTextField('hero.title')]: 'é'.repeat(41) }), [title]);
    expect(parsed).toMatchObject({ error: expect.stringContaining('Titre de l’accueil') });
    expect('error' in parsed && parsed.error).toMatch(/41 caractères pour 40 au plus/);
    // Characters, not UTF-16 units: forty emoji fit in a forty-character slot.
    expect(parseThemeTextsForm(form({ [themeTextField('hero.title')]: '🧵'.repeat(40) }), [title])).toHaveProperty('writes');
  });

  it('refuses a store image, which the media library would not count as used', () => {
    const parsed = parseThemeTextsForm(form({ [themeTextField('hero.intro')]: '![Sac](/images/media/sac.jpg)' }), [intro]);
    expect(parsed).toMatchObject({ error: expect.stringContaining('médiathèque') });
  });
});

describe('the texts a template receives', () => {
  it('gives every declared key, the default until the merchant writes one', () => {
    const texts = resolveThemeTexts([title, intro], new Map([['hero.title', 'La carte cadeau']]));
    expect(texts['hero.title']).toEqual({ text: 'La carte cadeau', html: null });
    expect(texts['hero.intro'].text).toBe('Des sacs *cousus main*.');
    expect(texts['hero.intro'].html).toBe('<p>Des sacs <em>cousus main</em>.</p>\n');
    expect(resolveThemeTexts([], new Map([['hero.title', 'ignored']]))).toEqual({});
  });

  it('renders Markdown without HTML (invariant 11)', () => {
    const texts = resolveThemeTexts([intro], new Map([['hero.intro', '<script>alert(1)</script> [x](javascript:alert(1))']]));
    expect(texts['hero.intro'].html).not.toMatch(/<script|href="javascript/);
    expect(texts['hero.intro'].html).toContain('&lt;script&gt;');
  });

  it('falls back to the default when a stored text outgrew a lowered limit', () => {
    const stored = new Map([['hero.title', 'x'.repeat(41)]]);
    expect(resolveThemeTexts([title], stored)['hero.title'].text).toBe(title.default);
    expect(storedThemeTextTooLong(title, stored)).toBe(true);
    expect(storedThemeTextTooLong(title, new Map())).toBe(false);
  });
});
