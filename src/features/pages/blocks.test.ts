import { describe, expect, it } from 'vitest';
import { extractMediaKeys, markdownExcerpt, placeMapBlocks, renderMarkdown } from './markdown';

/** A body read with the named blocks, as a content page is. */
const render = (body: string, showErrors = false) => renderMarkdown(body, { blocks: { showErrors } });
const lines = (...rows: string[]) => rows.join('\n');

const TWO = lines('::: colonnes', '## Un', 'Texte un.', '', '::: colonne', '## Deux', 'Texte deux.', ':::');

describe('named blocks — columns (ADR 0030)', () => {
  it('draws two columns, each one Markdown like the page', () => {
    expect(render(TWO)).toBe(
      lines(
        '<div class="markdown-columns markdown-columns--2">',
        '<div class="markdown-column">',
        '<h2>Un</h2>',
        '<p>Texte un.</p>',
        '</div>',
        '<div class="markdown-column">',
        '<h2>Deux</h2>',
        '<p>Texte deux.</p>',
        '</div>',
        '</div>',
        '',
      ),
    );
  });

  it('leaves the lines the text they were where the caller asks for no blocks', () => {
    const html = renderMarkdown(TWO);
    expect(html).toContain('<p>::: colonnes');
    expect(html).not.toContain('markdown-columns');
  });

  it('draws three columns', () => {
    const html = render(lines('::: colonnes', 'a', '::: colonne', 'b', '::: colonne', 'c', ':::'));
    expect(html).toContain('<div class="markdown-columns markdown-columns--3">');
    expect(html.match(/<div class="markdown-column">/g)).toHaveLength(3);
  });

  it('takes the proportions of two columns from a closed list', () => {
    const body = (ratio: string) => lines(`::: colonnes ${ratio}`, 'a', '::: colonne', 'b', ':::');
    expect(render(body('1/2'))).toContain('class="markdown-columns markdown-columns--2 markdown-columns--narrow-wide"');
    expect(render(body('2/1'))).toContain('class="markdown-columns markdown-columns--2 markdown-columns--wide-narrow"');
    // Anything else is equal columns, and never reaches the markup.
    const odd = render(body('1/3" onclick="x'));
    expect(odd).toContain('<div class="markdown-columns markdown-columns--2">');
    expect(odd).not.toContain('onclick');
  });

  it('reads the word whatever its case, and with no space after the marker', () => {
    expect(render(lines(':::Colonnes', 'a', '::: COLONNE', 'b', ':::'))).toContain('markdown-columns--2');
  });

  it('keeps a fenced block whole, whatever lines it holds', () => {
    const html = render(lines('::: colonnes', '```', '::: colonne', ':::', '```', '', '::: colonne', 'b', ':::'));
    expect(html.match(/<div class="markdown-column">/g)).toHaveLength(2);
    expect(html).toContain('<pre><code>::: colonne\n:::\n</code></pre>');
  });

  it('leaves columns inside a column the text they were, without closing the outer block', () => {
    const html = render(
      lines('::: colonnes', 'a', '::: colonne', '::: colonnes', 'x', ':::', '', 'b', ':::', '', 'Après.'),
    );
    expect(html.match(/<div class="markdown-columns/g)).toHaveLength(1);
    expect(html).toContain('<p>::: colonnes\nx\n:::</p>');
    expect(html).toMatch(/<p>b<\/p>\n<\/div>\n<\/div>\n<p>Après\.<\/p>/);
  });

  it('runs an unclosed block to the end of the body', () => {
    const html = render(lines('::: colonnes', 'a', '::: colonne', 'b'));
    expect(html).toMatch(/<p>b<\/p>\n<\/div>\n<\/div>\n$/);
  });

  it('opens right under a sentence, which stays a sentence', () => {
    expect(render(lines('Texte.', '::: colonnes', 'a', '::: colonne', 'b', ':::'))).toMatch(
      /^<p>Texte\.<\/p>\n<div class="markdown-columns/,
    );
  });

  it('knows only its own words: any other block stays text', () => {
    expect(render(lines('::: questions', 'a', ':::'))).toBe('<p>::: questions\na\n:::</p>\n');
    expect(render(lines('::: colonne', 'a', ':::'))).not.toContain('markdown-column');
  });

  it('leaves an indented block code, as Markdown does', () => {
    expect(render(lines('    ::: colonnes', '    a'))).toContain('<pre><code>');
  });

  it('moves a photo and lines up a row in a column as in the body', () => {
    const html = renderMarkdown(
      lines(
        '::: colonnes',
        '![Atelier](/images/media/a.webp "gauche")',
        '',
        'Texte.',
        '',
        '::: colonne',
        '![Un](/images/media/b.webp)',
        '![Deux](/images/media/c.webp)',
        ':::',
      ),
      { blocks: {}, lightbox: true },
    );
    expect(html).toContain('<p class="markdown-media markdown-media--left">');
    expect(html).toContain('<p class="markdown-gallery"><a href="/images/media/b.webp" data-lightbox>');
  });

  it('leaves a photo in a list of a column where it is', () => {
    const html = render(lines('::: colonnes', '- ![Un](/images/media/b.webp)', '::: colonne', 'b', ':::'));
    expect(html).not.toContain('markdown-media');
  });

  it('marks each column with its source lines for the editor', () => {
    const html = renderMarkdown(TWO, { blocks: {}, sourceMap: true });
    expect(html).toContain('<div class="markdown-columns markdown-columns--2" data-source-line="1" data-source-end="9">');
    expect(html).toContain('<div class="markdown-column" data-source-line="1" data-source-end="5">');
    expect(html).toContain('<div class="markdown-column" data-source-line="5" data-source-end="8">');
  });
});

const BOX = lines('::: encadré', '### Bon à savoir', 'La livraison est offerte.', ':::');

describe('named blocks — box (ticket #205, lot 4)', () => {
  it('draws a box, a note holding Markdown like the page', () => {
    expect(render(BOX)).toBe(
      lines(
        '<div class="markdown-box" role="note">',
        '<h3>Bon à savoir</h3>',
        '<p>La livraison est offerte.</p>',
        '</div>',
        '',
      ),
    );
  });

  it('leaves the lines the text they were where the caller asks for no blocks', () => {
    const html = renderMarkdown(BOX);
    expect(html).toContain('<p>::: encadré');
    expect(html).not.toContain('markdown-box');
  });

  it('reads the word without its accent, in capitals, or with its accent apart', () => {
    for (const word of ['encadre', 'ENCADRÉ', 'Encadre', 'encadré']) {
      expect(render(lines(`::: ${word}`, 'a', ':::'))).toContain('<div class="markdown-box" role="note">');
    }
  });

  it('runs on until the line after a sentence and the blank lines it holds', () => {
    const html = render(lines('Avant.', '::: encadré', 'Un.', '', 'Deux.', ':::', 'Après.'));
    expect(html).toBe(
      lines(
        '<p>Avant.</p>',
        '<div class="markdown-box" role="note">',
        '<p>Un.</p>',
        '<p>Deux.</p>',
        '</div>',
        '<p>Après.</p>',
        '',
      ),
    );
  });

  it('stands in a column, its own ::: closing it and not the column', () => {
    const html = render(lines('::: colonnes', 'a', '::: encadré', 'boîte', ':::', 'encore a', '::: colonne', 'b', ':::'));
    expect(html).toBe(
      lines(
        '<div class="markdown-columns markdown-columns--2">',
        '<div class="markdown-column">',
        '<p>a</p>',
        '<div class="markdown-box" role="note">',
        '<p>boîte</p>',
        '</div>',
        '<p>encore a</p>',
        '</div>',
        '<div class="markdown-column">',
        '<p>b</p>',
        '</div>',
        '</div>',
        '',
      ),
    );
  });

  it('holds columns, whose separator stays theirs', () => {
    const html = render(lines('::: encadré', '::: colonnes', 'a', '::: colonne', 'b', ':::', ':::', 'Après.'));
    expect(html).toMatch(/^<div class="markdown-box" role="note">\n<div class="markdown-columns markdown-columns--2">/);
    expect(html).toMatch(/<\/div>\n<\/div>\n<\/div>\n<p>Après\.<\/p>\n$/);
  });

  it('leaves a box inside a box the text it was, without closing the outer one', () => {
    const html = render(lines('::: encadré', 'a', '::: encadré', 'x', ':::', '', 'b', ':::', '', 'Après.'));
    expect(html.match(/class="markdown-box"/g)).toHaveLength(1);
    // Its line does not interrupt the sentence above, as a word of text would not.
    expect(html).toContain('<p>a\n::: encadré\nx\n:::</p>');
    expect(html).toMatch(/<p>b<\/p>\n<\/div>\n<p>Après\.<\/p>/);
  });

  it('keeps a fenced block whole, and runs an unclosed box to the end of the body', () => {
    const fenced = render(lines('::: encadré', '```', ':::', '```', ':::'));
    expect(fenced).toContain('<pre><code>:::\n</code></pre>\n</div>');
    expect(render(lines('::: encadré', 'a', '', 'b'))).toMatch(/<p>b<\/p>\n<\/div>\n$/);
  });

  it('writes nothing of what follows the word on its line', () => {
    const html = render(lines('::: encadré <b onclick="x">Titre</b>', 'a', ':::'));
    expect(html).toBe(lines('<div class="markdown-box" role="note">', '<p>a</p>', '</div>', ''));
  });

  it('moves a photo and lines up a row in a box as in the body', () => {
    const html = renderMarkdown(
      lines(
        '::: encadré',
        '![Atelier](/images/media/a.webp "droite")',
        '',
        'Texte.',
        '',
        '![Un](/images/media/b.webp)',
        '![Deux](/images/media/c.webp)',
        ':::',
      ),
      { blocks: {}, lightbox: true },
    );
    expect(html).toContain('<p class="markdown-media markdown-media--right">');
    expect(html).toContain('<p class="markdown-gallery"><a href="/images/media/b.webp" data-lightbox>');
  });

  it('marks the box with its source lines for the editor', () => {
    const html = renderMarkdown(lines('Intro.', '', BOX), { blocks: {}, sourceMap: true });
    expect(html).toContain('<div class="markdown-box" role="note" data-source-line="3" data-source-end="7">');
    expect(html).toContain('<h3 data-source-line="4" data-source-end="5">');
  });
});

describe('named blocks — what the preview says', () => {
  it('says nothing about a block that is right', () => {
    expect(render(TWO, true)).not.toContain('markdown-block-error');
  });

  it('says a block holds one column, and draws it', () => {
    const html = render(lines('Intro.', '', '::: colonnes', 'seule', ':::'), true);
    expect(html).toContain('<div class="markdown-block-error">');
    expect(html).toContain('ligne 3 : une seule colonne');
    expect(html).toContain('<p>seule</p>');
    // The storefront draws it without a word.
    expect(render(lines('::: colonnes', 'seule', ':::'))).not.toContain('markdown-block-error');
  });

  it('says a block holds too many columns, and keeps them all', () => {
    const html = render(lines('::: colonnes', 'a', '::: colonne', 'b', '::: colonne', 'c', '::: colonne', 'd', ':::'), true);
    expect(html).toContain('4 colonnes, 3 au plus');
    expect(html).toContain('markdown-columns--3');
    expect(html.match(/<div class="markdown-column">/g)).toHaveLength(4);
  });

  it('names proportions it does not know, escaped', () => {
    const html = render(lines('::: colonnes <b>1/3</b>', 'a', '::: colonne', 'b', ':::'), true);
    expect(html).toContain('« &lt;b&gt;1/3&lt;/b&gt; » n’est pas une proportion connue');
    expect(html).not.toContain('<b>');
  });

  it('says nothing about a box that is right', () => {
    expect(render(BOX, true)).not.toContain('markdown-block-error');
  });

  it('says what follows the word on its line is not drawn, escaped', () => {
    const html = render(lines('Intro.', '', '::: encadré <b>Bon à savoir</b>', 'a', ':::'), true);
    expect(html).toContain('<p>Cet encadré ne s’affichera pas comme prévu');
    expect(html).toContain('ligne 3 : « &lt;b&gt;Bon à savoir&lt;/b&gt; » ne s’affiche pas');
    expect(html).not.toContain('<b>');
    // The storefront draws the box without a word.
    expect(render(lines('::: encadré Bon à savoir', 'a', ':::'))).not.toContain('markdown-block-error');
  });

  it('says a box is empty, and one that is not closed', () => {
    expect(render(lines('::: encadré', '', ':::'), true)).toContain('ligne 1 : l’encadré est vide');
    const open = render(lines('::: encadré', 'a', '', 'b'), true);
    expect(open).toContain('ligne 1 : l’encadré n’est pas fermé');
    expect(open).not.toContain('est vide');
  });

  it('says what is wrong with a box inside a column, above it', () => {
    const html = render(lines('::: colonnes', 'a', '::: colonne', '::: encadré', ':::', ':::'), true);
    expect(html).toMatch(/<div class="markdown-column">\n<div class="markdown-block-error">.*ligne 4 : l’encadré est vide/s);
  });

  it('says proportions are for two columns', () => {
    const html = render(lines('::: colonnes 1/2', 'a', '::: colonne', 'b', '::: colonne', 'c', ':::'), true);
    expect(html).toContain('ne valent que pour deux colonnes');
    expect(html).toContain('<div class="markdown-columns markdown-columns--3">');
  });
});

describe('named blocks — what the body is read for', () => {
  const body = lines(
    '::: colonnes',
    '![Un](/images/media/a.webp)',
    '',
    '::: colonne',
    '```carte',
    'lieu: Atelier',
    'position: 48.8566, 2.3522',
    '```',
    ':::',
  );

  it('counts a photo in a column as one the page uses', () => {
    expect(extractMediaKeys(body)).toEqual(['media/a.webp']);
  });

  it('finds a map in a column', () => {
    expect(placeMapBlocks(body)).toHaveLength(1);
    expect(placeMapBlocks(body)[0].fenceLine).toBe(5);
  });

  it('keeps the block lines out of the description', () => {
    expect(markdownExcerpt(TWO)).toBe('Un Texte un. Deux Texte deux.');
  });

  it('counts a photo in a box, finds its map, and keeps its lines out of the description', () => {
    const boxed = lines('::: encadré', '![Un](/images/media/a.webp)', '', '```carte', 'lieu: Atelier', 'position: 48.8566, 2.3522', '```', ':::');
    expect(extractMediaKeys(boxed)).toEqual(['media/a.webp']);
    expect(placeMapBlocks(boxed)[0].fenceLine).toBe(4);
    expect(markdownExcerpt(BOX)).toBe('Bon à savoir La livraison est offerte.');
  });
});
