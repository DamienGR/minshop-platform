import { describe, expect, it } from 'vitest';
import { emailMarkdownHtml } from './markdown';

/**
 * A rate's instructions as an inbox carries them (ticket #237): the pages'
 * parse, every style inline, every link absolute.
 */
const ORIGIN = 'https://boutique.example';

describe('emailMarkdownHtml', () => {
  it('styles every element inline, since a mail client strips stylesheets', () => {
    const html = emailMarkdownHtml('Au **12 rue des Lilas**.\n\n- le mercredi\n- le samedi', ORIGIN);
    expect(html).toContain('<p style="margin:0 0 8px;');
    expect(html).toContain('<ul style="');
    expect(html).toContain('<li style="');
    expect(html).toContain('<strong>12 rue des Lilas</strong>');
    expect(html).not.toContain('class=');
  });

  it('makes a link absolute against the shop, and leaves a full one as written', () => {
    const html = emailMarkdownHtml('[Contact](/pages/contact) ou [la carte](https://www.openstreetmap.org/)', ORIGIN);
    expect(html).toContain('href="https://boutique.example/pages/contact"');
    expect(html).toContain('href="https://www.openstreetmap.org/"');
    expect(html).toMatch(/<a href="[^"]+" style="color:[^"]+;font-weight:600;">Contact<\/a>/);
  });

  it('keeps raw HTML as text, and refuses a script link as the pages do', () => {
    const html = emailMarkdownHtml('<b onclick="x()">gras</b> [clic](javascript:alert(1))', ORIGIN);
    expect(html).toContain('&lt;b onclick=&quot;x()&quot;&gt;gras&lt;/b&gt;');
    expect(html).not.toContain('<b ');
    expect(html).not.toContain('href="javascript:');
  });

  it('writes a heading as a bold paragraph, never a second title', () => {
    const html = emailMarkdownHtml('# Où nous trouver\n\nAu fond de la cour.', ORIGIN);
    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toContain('font-weight:600;">Où nous trouver</p>');
  });

  it('writes an image as its alt text', () => {
    const html = emailMarkdownHtml('![La porte bleue](/images/porte.jpg)', ORIGIN);
    expect(html).not.toContain('<img');
    expect(html).toContain('La porte bleue');
  });
});
