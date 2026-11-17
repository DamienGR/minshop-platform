import { describe, expect, it } from 'vitest';
import { plainTitle, TITLE_MARKS_MAX, titleMarkCode, titleMarkProblems, validTitleMarks } from './marks';

const FEUILLE = ['feuille'];

describe('plainTitle (ticket #251)', () => {
  it('removes a declared code and its spaces, wherever the merchant put it', () => {
    expect(plainTitle('Livraison [feuille] et retours', FEUILLE)).toBe('Livraison et retours');
    expect(plainTitle('La [feuille] marque', FEUILLE)).toBe('La marque');
    expect(plainTitle('[feuille] La marque', FEUILLE)).toBe('La marque');
    expect(plainTitle('La marque [feuille]', FEUILLE)).toBe('La marque');
    expect(plainTitle('La marque[feuille]', FEUILLE)).toBe('La marque');
  });

  it('leaves no space before a full stop or a comma', () => {
    expect(plainTitle('Bonjour [feuille], et bienvenue', FEUILLE)).toBe('Bonjour, et bienvenue');
    expect(plainTitle('Fait main [feuille].', FEUILLE)).toBe('Fait main.');
    expect(plainTitle('Nos sacs [feuille]…', FEUILLE)).toBe('Nos sacs…');
  });

  it('keeps the no-break space the merchant typed before « ? »', () => {
    expect(plainTitle('Qui suis-je [feuille] ?', FEUILLE)).toBe('Qui suis-je ?');
    expect(plainTitle('« Lin [feuille] lavé »', FEUILLE)).toBe('« Lin lavé »');
  });

  it('takes any case, and spaces inside the brackets', () => {
    expect(plainTitle('La [Feuille] marque', FEUILLE)).toBe('La marque');
    expect(plainTitle('La [ FEUILLE ] marque', FEUILLE)).toBe('La marque');
    expect(plainTitle('Une [étoile] filante', ['étoile'])).toBe('Une filante');
    expect(plainTitle('Une [ÉTOILE] filante', ['étoile'])).toBe('Une filante');
  });

  it('removes every code, side by side or apart', () => {
    expect(plainTitle('A [feuille] [feuille] B', FEUILLE)).toBe('A B');
    expect(plainTitle('[feuille] A [feuille] B [feuille]', FEUILLE)).toBe('A B');
    expect(plainTitle('A [feuille] B [fleur] C', ['feuille', 'fleur'])).toBe('A B C');
  });

  it('leaves what the theme does not declare, and Markdown links', () => {
    expect(plainTitle('La [fleur] marque', FEUILLE)).toBe('La [fleur] marque');
    expect(plainTitle('Les [À COMPLÉTER]', FEUILLE)).toBe('Les [À COMPLÉTER]');
    expect(plainTitle('Voir [feuille](https://example.com)', FEUILLE)).toBe('Voir [feuille](https://example.com)');
    expect(plainTitle('Voir [feuille][1]', FEUILLE)).toBe('Voir [feuille][1]');
    expect(plainTitle('[feuilles] et [feuille-or]', FEUILLE)).toBe('[feuilles] et [feuille-or]');
  });

  it('changes nothing for a theme that declares none', () => {
    for (const title of ['La [feuille] marque', 'Livraison', '', '  espaces  ']) {
      expect(plainTitle(title, [])).toBe(title);
    }
    expect(plainTitle('  Sans code  ', FEUILLE)).toBe('  Sans code  ');
  });

  it('is empty for a title that is only a code', () => {
    expect(plainTitle('[feuille]', FEUILLE)).toBe('');
    expect(plainTitle(' [feuille]  [feuille] ', FEUILLE)).toBe('');
  });

  it('keeps the lines of a zone’s Markdown apart', () => {
    expect(plainTitle('## La marque [feuille]\n\nNos sacs.', FEUILLE)).toBe('## La marque\n\nNos sacs.');
    expect(plainTitle('Nos sacs.\n[feuille] La suite', FEUILLE)).toBe('Nos sacs.\nLa suite');
  });

  it('reads a long run of spaces in linear time', () => {
    const text = `A${' '.repeat(50_000)}B [feuille] C`;
    const started = performance.now();
    expect(plainTitle(text, FEUILLE)).toBe(`A${' '.repeat(50_000)}B C`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('a theme’s declaration of its title codes (ticket #251)', () => {
  it('accepts lowercase words, accents and hyphens included', () => {
    expect(titleMarkProblems(['feuille', 'étoile', 'feuille-or', 'n2'])).toEqual([]);
    expect(titleMarkProblems([])).toEqual([]);
  });

  it('names what is wrong', () => {
    expect(titleMarkProblems('feuille')).toEqual(['`titleMarks` must be an array of words.']);
    for (const bad of ['Feuille', '[feuille]', 'deux mots', '', '-feuille', 'feuille-', 'x'.repeat(31), 3, null]) {
      expect(titleMarkProblems([bad]), String(bad)).toHaveLength(1);
    }
    expect(titleMarkProblems(['feuille', 'feuille'])).toEqual(['"feuille" is declared twice.']);
    expect(titleMarkProblems(Array.from({ length: TITLE_MARKS_MAX + 1 }, (_, i) => `m${i}`))).toEqual([
      `${TITLE_MARKS_MAX + 1} codes; ${TITLE_MARKS_MAX} at most.`,
    ]);
  });

  it('keeps the valid codes of a bad declaration, once each', () => {
    expect(validTitleMarks(['feuille', 'Fleur', 'feuille', 'étoile'])).toEqual(['feuille', 'étoile']);
    expect(validTitleMarks(undefined)).toEqual([]);
    expect(validTitleMarks({ feuille: true })).toEqual([]);
  });

  it('writes a code as the merchant types it', () => {
    expect(titleMarkCode('feuille')).toBe('[feuille]');
  });
});
