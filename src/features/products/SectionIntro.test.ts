import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import SectionIntro from './SectionIntro.astro';

// Ticket #160: the help of « Variantes et options supplémentaires » read
// « Facultatif.Les variantessont des choix », because each bold word sat on
// its own line of markup and Astro drops a line break between two pieces.

const render = async (intro: string) =>
  (await AstroContainer.create()).renderToString(SectionIntro, { props: { intro } });

/** Each bold run with the character before it and the one after it. */
const boldNeighbours = (html: string) =>
  [...html.matchAll(/(.)<strong[^>]*>([^<]+)<\/strong>(.)/g)].map(([, before, word, after]) => ({
    before,
    word,
    after,
  }));

describe('the help of a product editor section', () => {
  it('separates every bold word from the text around it', async () => {
    const html = await render('admin.products.variants.intro');
    const bold = boldNeighbours(html);
    expect(bold.map((b) => b.word)).toEqual([
      'Les variantes',
      'Les options supplémentaires',
      'Enregistrer les modifications',
    ]);
    for (const { before, word, after } of bold) {
      expect(before, `before « ${word} »`).toBe(' ');
      expect(after, `after « ${word} »`).toBe(' ');
    }
  });

  it('reads as the sentences it was written as', async () => {
    const text = (await render('admin.products.variants.intro')).replace(/<[^>]+>/g, '');
    expect(text).toContain('Facultatif. Les variantes sont des choix');
    expect(text).toContain('sans stock propre. Tout ce qui se trouve ici');
    expect(text).toContain('le bouton Enregistrer les modifications en haut de la page.');
  });

  it('keeps the space between a plain intro and the save hint', async () => {
    const text = (await render('admin.products.customization.intro')).replace(/<[^>]+>/g, '');
    expect(text).toContain('l’avis de nouvelle commande. Tout ce qui se trouve ici');
  });
});
