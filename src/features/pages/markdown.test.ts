import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  markdownExcerpt,
  extractMediaKeys,
  placeMapBlocks,
  placeMapProblems,
  placeMapsDrawTile,
} from './markdown';

describe('renderMarkdown — structure', () => {
  it('renders headings, lists, links, and emphasis', () => {
    const html = renderMarkdown('## Shipping\n\n- one\n- two\n\n[Contact](/pages/contact) and **bold**.');
    expect(html).toContain('<h2>Shipping</h2>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<a href="/pages/contact">Contact</a>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders fenced code as escaped text, not markup', () => {
    const html = renderMarkdown('```\n<b>not bold</b>\n```');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;');
    expect(html).not.toContain('<b>not bold</b>');
  });
});

describe('renderMarkdown — safety', () => {
  it('escapes raw HTML instead of parsing it', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes inline event handlers written as HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror="alert(1)"');
    expect(html).toContain('&lt;img');
  });

  // markdown-it refuses to build a link/image for a blocked scheme and leaves
  // the source as literal text, so assert on the absence of the ELEMENT, not of
  // the substring — the raw text legitimately still contains "javascript:".
  it('refuses to build a link for a javascript: target', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href=/);
    expect(html).not.toContain('<a');
  });

  it('refuses to build an image for a javascript: source', () => {
    const html = renderMarkdown('![x](javascript:alert(1))');
    expect(html).not.toMatch(/<img/);
  });

  it('refuses vbscript: targets too', () => {
    expect(renderMarkdown('[c](vbscript:msgbox(1))')).not.toContain('<a');
  });

  // The quotes are escaped, so `onerror=` survives as inert TEXT inside the
  // attribute value. The property that matters is that it never becomes a real
  // attribute, which requires an unescaped quote — hence matching on `onerror="`
  // rather than on the bare substring.
  it('escapes quotes in alt text so it cannot break out of the attribute', () => {
    const html = renderMarkdown('![Tote " onerror="alert(1)](/images/media/a.png)');
    expect(html).not.toMatch(/\sonerror="/);
    expect(html).toContain('alt="Tote &quot; onerror=&quot;alert(1)"');
  });

  it('escapes quotes in the title attribute', () => {
    const html = renderMarkdown('![a](/images/media/a.png "x\\" onerror=\\"alert(1)")');
    expect(html).not.toMatch(/\sonerror="/);
    expect(html).toContain('title="x&quot; onerror=&quot;alert(1)"');
  });

  it('keeps ordinary external links working', () => {
    const html = renderMarkdown('[docs](https://example.com/guide)');
    expect(html).toContain('href="https://example.com/guide"');
  });
});

describe('renderMarkdown — images', () => {
  it('keeps the author-written alt text', () => {
    // Overriding markdown-it's image rule drops alt unless it is repopulated;
    // this is the regression guard for that.
    expect(renderMarkdown('![A tote bag](/images/media/a.webp)')).toContain('alt="A tote bag"');
  });

  // The attributes this whole feature exists to produce: without them an <img>
  // has no intrinsic size, occupies only its alt-text line box, and jumps to full
  // height when the bitmap lands — measured at 181px on a 242x209 page image.
  it('emits width and height for a key it has dimensions for', () => {
    const dimensions = new Map([['media/a.webp', { width: 1200, height: 630 }]]);
    const html = renderMarkdown('![Hero](/images/media/a.webp)', { dimensions });
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="630"');
  });

  it('omits them for a key with no recorded dimensions', () => {
    const dimensions = new Map([['media/other.webp', { width: 10, height: 10 }]]);
    const html = renderMarkdown('![Hero](/images/media/a.webp)', { dimensions });
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
  });

  it('omits them when no dimensions are supplied at all', () => {
    const html = renderMarkdown('![Hero](/images/media/a.webp)');
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
  });

  // An external image is not ours to measure, and its key never matches.
  it('leaves external images unsized', () => {
    const dimensions = new Map([['media/a.webp', { width: 1200, height: 630 }]]);
    const html = renderMarkdown('![Remote](https://example.com/media/a.webp)', { dimensions });
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
  });

  it('marks body images lazy and async', () => {
    const html = renderMarkdown('![Tote](/images/media/tote.webp)');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it('serves local images through the Worker route by default', () => {
    expect(renderMarkdown('![a](/images/media/a.webp)')).toContain('src="/images/media/a.webp"');
  });

  it('rewrites local images to the configured image origin', () => {
    const html = renderMarkdown('![a](/images/media/a.webp)', {
      baseUrl: 'https://images.example.com',
    });
    expect(html).toContain('src="https://images.example.com/media/a.webp"');
  });

  it('leaves external images on their own origin', () => {
    const html = renderMarkdown('![a](https://cdn.example.org/a.png)', {
      baseUrl: 'https://images.example.com',
    });
    expect(html).toContain('src="https://cdn.example.org/a.png"');
  });
});

describe('renderMarkdown — a photo beside its text (ticket #195)', () => {
  const photo = (title: string) => `![Mes mains à l’atelier](/images/media/a.webp "${title}")`;

  it('marks the paragraph of a photo titled « gauche » with its side', () => {
    const html = renderMarkdown(`${photo('gauche')}\n\nLe texte qui l’accompagne.`);
    expect(html).toContain('<p class="markdown-media markdown-media--left"><img');
    expect(html).toContain('<p>Le texte qui l’accompagne.</p>');
  });

  it('and « droite » with the other side', () => {
    expect(renderMarkdown(photo('droite'))).toContain('<p class="markdown-media markdown-media--right"><img');
  });

  it('reads the word whatever its case or spaces', () => {
    expect(renderMarkdown(photo(' Gauche '))).toContain('markdown-media--left');
  });

  it('never writes the word out: no tooltip reading « gauche »', () => {
    const html = renderMarkdown(photo('gauche'));
    expect(html).not.toContain('title=');
    expect(html).not.toContain('gauche');
  });

  it('keeps any other title a title, the paragraph a plain photo', () => {
    const html = renderMarkdown(photo('À gauche de la porte'));
    expect(html).toContain('title="À gauche de la porte"');
    expect(html).toContain('<p class="markdown-media"><img');
    expect(html).not.toContain('markdown-media--');
  });

  it('marks a photo with no title as a photo, so the CSS starts it below a side one', () => {
    expect(renderMarkdown('![Photo](/images/media/a.webp)')).toContain('<p class="markdown-media"><img');
  });

  it('moves nothing in a row of photos (#194), and still drops the word', () => {
    const html = renderMarkdown(`${photo('gauche')}\n![Autre](/images/media/b.webp)`);
    expect(html).not.toContain('markdown-media');
    expect(html).not.toContain('title=');
  });

  it('moves nothing inside a sentence', () => {
    const html = renderMarkdown(`Voici ${photo('droite')} dans le texte.`);
    expect(html).toMatch(/^<p>Voici <img/);
    expect(html).not.toContain('title=');
  });

  it('moves nothing inside a list or a quote: only a photo of the body itself', () => {
    expect(renderMarkdown(`- ${photo('gauche')}`)).not.toContain('markdown-media');
    expect(renderMarkdown(`> ${photo('gauche')}`)).not.toContain('markdown-media');
  });

  it('keeps the class beside the editor’s source lines', () => {
    const html = renderMarkdown(photo('gauche'), { sourceMap: true });
    expect(html).toContain('<p class="markdown-media markdown-media--left" data-source-line="1"');
  });

  it('writes the class from its closed list, never from the title', () => {
    const html = renderMarkdown(photo('gauche" onerror="alert(1)'));
    expect(html).not.toContain('markdown-media--');
    expect(html).not.toContain('onerror="');
  });
});

describe('renderMarkdown — a row of photos (ticket #194)', () => {
  const img = (name: string, title = '') =>
    `![Photo ${name}](/images/media/${name}.webp${title ? ` "${title}"` : ''})`;

  it('marks images written one under the other, with no blank line, as a row', () => {
    const html = renderMarkdown([img('a'), img('b'), img('c')].join('\n'));
    expect(html).toMatch(/^<p class="markdown-gallery"><img src="\/images\/media\/a\.webp"/);
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).not.toContain('markdown-media');
  });

  it('takes images on one line, separated by spaces, as a row too', () => {
    expect(renderMarkdown(`${img('a')} ${img('b')}`)).toContain('<p class="markdown-gallery">');
  });

  it('writes no <br> among the photos, whatever ends the line', () => {
    const html = renderMarkdown(`${img('a')}  \n${img('b')}\\\n${img('c')}`);
    expect(html).toContain('<p class="markdown-gallery">');
    expect(html).not.toContain('<br');
    expect(html.match(/<img /g)).toHaveLength(3);
  });

  it('makes two rows of two paragraphs: a blank line starts the next row', () => {
    const html = renderMarkdown(`${img('a')}\n${img('b')}\n\n${img('c')}\n${img('d')}`);
    expect(html.match(/<p class="markdown-gallery">/g)).toHaveLength(2);
  });

  it('leaves a sentence with two images a sentence', () => {
    const html = renderMarkdown(`Avant ${img('a')} et après ${img('b')}.`);
    expect(html).toMatch(/^<p>Avant <img/);
    expect(html).not.toContain('markdown-gallery');
  });

  it('leaves images that are links where they are', () => {
    const html = renderMarkdown(`[${img('a')}](/products)\n[${img('b')}](/products)`);
    expect(html).not.toContain('markdown-gallery');
  });

  it('makes no row inside a list or a quote', () => {
    expect(renderMarkdown(`- ${img('a')}\n  ${img('b')}`)).not.toContain('markdown-gallery');
    expect(renderMarkdown(`> ${img('a')}\n> ${img('b')}`)).not.toContain('markdown-gallery');
  });

  it('keeps a side word out of the row, and out of the page', () => {
    const html = renderMarkdown(`${img('a', 'gauche')}\n${img('b', 'droite')}`);
    expect(html).toContain('<p class="markdown-gallery">');
    expect(html).not.toContain('markdown-media');
    expect(html).not.toContain('title=');
  });

  it('keeps the class beside the editor’s source lines', () => {
    const html = renderMarkdown(`${img('a')}\n${img('b')}`, { sourceMap: true });
    expect(html).toContain('<p class="markdown-gallery" data-source-line="1" data-source-end="3">');
  });

  it('keeps each photo’s reserved size', () => {
    const dimensions = new Map([
      ['media/a.webp', { width: 1200, height: 1600 }],
      ['media/b.webp', { width: 1600, height: 1200 }],
    ]);
    const html = renderMarkdown(`${img('a')}\n${img('b')}`, { dimensions });
    expect(html).toContain('width="1200" height="1600"');
    expect(html).toContain('width="1600" height="1200"');
  });
});

describe('renderMarkdown — escaped alt text', () => {
  // The editor escapes \ [ and ] when inserting an image. These assert what
  // that escaping has to survive: the result must stay ONE image with the
  // literal characters in its alt, never a link or a broken span.
  it('keeps an escaped opening bracket inside the alt', () => {
    const html = renderMarkdown('![Photo of \\[blue shirt](/images/media/a.png)');
    expect(html).toContain('alt="Photo of [blue shirt"');
    expect(html).not.toContain('<a');
  });

  it('keeps an escaped closing bracket inside the alt', () => {
    const html = renderMarkdown('![Photo of blue\\] shirt](/images/media/a.png)');
    expect(html).toContain('alt="Photo of blue] shirt"');
    expect(html).toContain('<img');
  });

  it('keeps an escaped backslash inside the alt', () => {
    const html = renderMarkdown('![Back\\\\slash](/images/media/a.png)');
    expect(html).toContain('alt="Back\\slash"');
  });

  it('shows what goes wrong UNESCAPED: a bare [ makes a link, not an image', () => {
    // This is the bug the escaping prevents — kept as the counter-example so the
    // reason for escaping stays visible.
    const html = renderMarkdown('![Photo of [blue shirt](/images/media/a.png)');
    expect(html).toContain('<a href="/images/media/a.png"');
    expect(html).not.toContain('<img');
  });
});

describe('renderMarkdown — source map', () => {
  it('is off by default, so storefront HTML carries no editor plumbing', () => {
    expect(renderMarkdown('# Title\n\nBody.')).not.toContain('data-source-line');
  });

  it('stamps the start line on block elements when enabled', () => {
    const html = renderMarkdown('# Title\n\nSecond block.', { sourceMap: true });
    expect(html).toMatch(/<h1 [^>]*data-source-line="1"/);
    expect(html).toMatch(/<p [^>]*data-source-line="3"/);
  });

  it('numbers lines from 1, matching what an editor shows', () => {
    const html = renderMarkdown('\n\n\nFourth line.', { sourceMap: true });
    expect(html).toContain('data-source-line="4"');
  });

  it('maps list items so a click inside a list still resolves', () => {
    const html = renderMarkdown('- one\n- two', { sourceMap: true });
    expect(html).toMatch(/<li [^>]*data-source-line="1"/);
    expect(html).toMatch(/<li [^>]*data-source-line="2"/);
  });

  it('does not change the rendered content itself', () => {
    const plain = renderMarkdown('## Heading\n\n**bold**');
    const mapped = renderMarkdown('## Heading\n\n**bold**', { sourceMap: true });
    expect(mapped.replace(/ data-source-(line|end)="\d+"/g, '')).toBe(plain);
  });
});

describe('renderMarkdown — heading ids (admin guide, ticket #188)', () => {
  it('gives each heading the id the caller names, from its plain text and level', () => {
    const seen: [string, number][] = [];
    const html = renderMarkdown('## Les **commandes**\n\n### Rembourser `vite`', {
      headingId: (text, level) => {
        seen.push([text, level]);
        return `guide-${level}`;
      },
    });
    expect(seen).toEqual([
      ['Les commandes', 2],
      ['Rembourser vite', 3],
    ]);
    expect(html).toContain('<h2 id="guide-2">Les <strong>commandes</strong></h2>');
    expect(html).toContain('<h3 id="guide-3">Rembourser <code>vite</code></h3>');
  });

  it('leaves a heading without an id when the caller returns none', () => {
    expect(renderMarkdown('## Titre', { headingId: () => undefined })).toBe('<h2>Titre</h2>\n');
  });

  it('escapes the id like any attribute', () => {
    const html = renderMarkdown('## Titre', { headingId: () => '"><script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('id="&quot;&gt;&lt;script&gt;"');
  });

  it('renders a page body without ids: a merchant heading claims none', () => {
    expect(renderMarkdown('## Livraison')).toBe('<h2>Livraison</h2>\n');
  });
});

describe('extractMediaKeys', () => {
  it('finds root-relative references', () => {
    expect(extractMediaKeys('![a](/images/media/a.webp)')).toEqual(['media/a.webp']);
  });

  it('finds references written against the configured image origin', () => {
    const keys = extractMediaKeys('![a](https://images.example.com/media/a.webp)', {
      baseUrl: 'https://images.example.com',
    });
    expect(keys).toEqual(['media/a.webp']);
  });

  it('collapses duplicate references to one key', () => {
    const keys = extractMediaKeys(
      '![a](/images/media/a.webp)\n\n![again](/images/media/a.webp)',
    );
    expect(keys).toEqual(['media/a.webp']);
  });

  it('ignores external images', () => {
    expect(extractMediaKeys('![a](https://cdn.example.org/a.png)')).toEqual([]);
  });

  it('ignores image syntax inside a code block, which renders as text', () => {
    expect(extractMediaKeys('```\n![a](/images/media/a.webp)\n```')).toEqual([]);
  });

  it('finds legacy product keys, since any media item can be reused', () => {
    expect(extractMediaKeys('![a](/images/products/old.jpg)')).toEqual(['products/old.jpg']);
  });

  it('returns nothing for a body with no images', () => {
    expect(extractMediaKeys('Just **text** and a [link](/pages/x).')).toEqual([]);
  });
});

describe('markdownExcerpt', () => {
  it('strips Markdown punctuation rather than copying the raw source', () => {
    const excerpt = markdownExcerpt('## Returns\n\nWe accept **returns** within [30 days](/x).');
    expect(excerpt).toBe('Returns We accept returns within 30 days.');
  });

  it('keeps a space where the source wraps a line', () => {
    // A wrapped paragraph's line break is a softbreak token, not text: dropped,
    // it glued "parcours de\ncertification" into "decertification" on a store.
    const excerpt = markdownExcerpt('Ce site sert à éprouver le parcours de\ncertification du socle.');
    expect(excerpt).toBe('Ce site sert à éprouver le parcours de certification du socle.');
    expect(markdownExcerpt('Première ligne  \nseconde ligne')).toBe('Première ligne seconde ligne');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    const excerpt = markdownExcerpt('word '.repeat(60), 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/wo…$/);
  });

  it('returns an empty string for an empty body', () => {
    expect(markdownExcerpt('')).toBe('');
  });
});

describe('renderMarkdown — block extent', () => {
  it('stamps an exclusive end line so a block’s source range is known', () => {
    // The editor needs the range, not just the start, to map a click inside the
    // text to a character offset instead of selecting the whole line.
    const html = renderMarkdown('Alpha\nstill alpha\n\nBeta.', { sourceMap: true });
    expect(html).toMatch(/<p [^>]*data-source-line="1"[^>]*data-source-end="3"/);
    expect(html).toMatch(/<p [^>]*data-source-line="4"[^>]*data-source-end="5"/);
  });
});

describe('renderMarkdown — the map of a place (```carte, ADR 0029)', () => {
  const MAPS = {
    tileUrl: (tile: { z: number; x: number; y: number }) => `/map-tiles/ou-me-trouver/${tile.z}/${tile.x}/${tile.y}`,
    attribution: { text: 'les contributeurs d’OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
  };
  const BLOCK = [
    'Le samedi matin :',
    '',
    '```carte',
    'lieu: Marché de Vannes',
    'adresse: Place du Poids public',
    'adresse: 56000 Vannes',
    'position: 47.6582, -2.7608',
    '```',
    '',
    'Et le reste de la semaine à l’atelier.',
  ].join('\n');

  it('stays a code block for a renderer that was not asked for maps', () => {
    const html = renderMarkdown(BLOCK);
    expect(html).toContain('<pre><code class="language-carte">');
    expect(html).not.toContain('place-map');
  });

  it('draws the place: tiles from the page’s relay, a pin, the credit, the caption', () => {
    const html = renderMarkdown(BLOCK, { placeMaps: MAPS });
    expect(html).not.toContain('<pre>');
    expect(html).toContain('<figure class="place-map">');
    expect(html).toContain('role="img" aria-label="Carte : Marché de Vannes"');
    const tiles = [...html.matchAll(/<img src="\/map-tiles\/ou-me-trouver\/16\/(\d+)\/(\d+)"/g)];
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(tiles.length).toBeLessThanOrEqual(12);
    expect(html).toContain('alt="" width="256" height="256" loading="lazy" decoding="async"');
    expect(html).toContain('class="place-map__pin"');
    expect(html).toContain(
      '© <a href="https://www.openstreetmap.org/copyright">les contributeurs d’OpenStreetMap</a>',
    );
    expect(html).toContain('<strong class="place-map__name">Marché de Vannes</strong>');
    expect(html).toContain('Place du Poids public<br>56000 Vannes');
    // The text around the block is untouched.
    expect(html).toContain('<p>Le samedi matin :</p>');
    expect(html).toContain('<p>Et le reste de la semaine à l’atelier.</p>');
  });

  it('links the place at OpenStreetMap and Google Maps, with its ampersands escaped', () => {
    const html = renderMarkdown(BLOCK, { placeMaps: MAPS });
    expect(html).toContain(
      'href="https://www.openstreetmap.org/?mlat=47.6582&amp;mlon=-2.7608#map=16/47.6582/-2.7608"',
    );
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=47.6582%2C-2.7608"');
    expect(html).toContain('>Voir sur OpenStreetMap</a>');
    expect(html).toContain('>Voir sur Google Maps</a>');
  });

  it('escapes what the merchant wrote: the block cannot carry markup (invariant 11)', () => {
    const html = renderMarkdown(
      '```carte\nlieu: <script>alert(1)</script>\nadresse: "><img src=x onerror=alert(1)>\nposition: 47, -2\n```',
      { placeMaps: MAPS },
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('names an unnamed place generically', () => {
    const html = renderMarkdown('```carte\nposition: 47.6582, -2.7608\n```', { placeMaps: MAPS });
    expect(html).toContain('aria-label="Carte de l’emplacement"');
    expect(html).not.toContain('place-map__name');
  });

  it('draws nothing on the storefront for a block it cannot read', () => {
    const html = renderMarkdown('Avant.\n\n```carte\nlieu: Halles\n```\n\nAprès.', { placeMaps: MAPS });
    expect(html).toBe('<p>Avant.</p>\n<p>Après.</p>\n');
  });

  it('tells the preview what is wrong, line by line in the page', () => {
    const html = renderMarkdown('Avant.\n\n```carte\nlieu: Halles\nzoom: 40\n```', {
      placeMaps: { ...MAPS, showErrors: true },
    });
    expect(html).toContain('<div class="place-map-error">');
    expect(html).toContain('ligne 5 : le zoom est un nombre entier de 3 à 19');
    expect(html).toContain('ligne 6 : il manque la position du lieu');
  });

  it('stamps the preview’s source lines on the map, like on every other block', () => {
    const html = renderMarkdown(BLOCK, { placeMaps: MAPS, sourceMap: true });
    expect(html).toContain('<figure class="place-map" data-source-line="3" data-source-end="9">');
  });

  it('leaves every other fence to markdown-it', () => {
    const html = renderMarkdown('```js\nconst a = "<b>";\n```', { placeMaps: MAPS });
    expect(html).toContain('<pre><code class="language-js">const a = &quot;&lt;b&gt;&quot;;\n</code></pre>');
  });

  it('draws no map from a block written as an indented code block', () => {
    const html = renderMarkdown('    ```carte\n    position: 47, -2\n    ```', { placeMaps: MAPS });
    expect(html).not.toContain('place-map');
    expect(placeMapBlocks('    ```carte\n    position: 47, -2\n    ```')).toEqual([]);
  });
});

describe('placeMapProblems', () => {
  it('is empty for a body whose maps all draw, or that has none', () => {
    expect(placeMapProblems('Rien ici.')).toEqual([]);
    expect(placeMapProblems('```carte\nposition: 47, -2\n```')).toEqual([]);
  });

  it('numbers each problem by its line in the body', () => {
    expect(placeMapProblems('# Où\n\n```carte\nlieu: Halles\n```\n\n```carte\nposition: Vannes\n```')).toEqual([
      'ligne 5 : il manque la position du lieu, par exemple « position : 47.6582, -2.7608 »',
      'ligne 8 : la position donne la latitude puis la longitude, par exemple « 47.6582, -2.7608 » (clic droit sur le lieu dans OpenStreetMap ou Google Maps)',
    ]);
  });
});

describe('placeMapsDrawTile', () => {
  const body = 'Texte.\n\n```carte\nposition: 47.6582, -2.7608\nzoom: 16\n```';
  const drawn = [...renderMarkdown(body, {
    placeMaps: { tileUrl: (tile) => `/t/${tile.z}/${tile.x}/${tile.y}`, attribution: { text: 'x', href: 'https://x.example' } },
  }).matchAll(/src="\/t\/(\d+)\/(\d+)\/(\d+)"/g)].map(([, z, x, y]) => ({ z: +z, x: +x, y: +y }));

  it('says yes to every tile the page draws', () => {
    expect(drawn.length).toBeGreaterThan(0);
    for (const tile of drawn) expect(placeMapsDrawTile(body, tile)).toBe(true);
  });

  it('says no to a neighbour, the same tile at another zoom, and any tile of a broken block', () => {
    const xs = drawn.map((tile) => tile.x);
    expect(placeMapsDrawTile(body, { z: 16, x: Math.max(...xs) + 1, y: drawn[0].y })).toBe(false);
    expect(placeMapsDrawTile(body, { ...drawn[0], z: 15 })).toBe(false);
    expect(placeMapsDrawTile('```carte\nposition: 47.6582, -2.7608\nzoom: 99\n```', { ...drawn[0] })).toBe(false);
    expect(placeMapsDrawTile('Pas de carte.', drawn[0])).toBe(false);
  });
});
