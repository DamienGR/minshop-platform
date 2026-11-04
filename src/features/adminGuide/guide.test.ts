import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import layout from '../../layouts/AdminLayout.astro?raw';
import { frAdmin } from '../i18n/admin';
import { adminGuide, adminGuideRevision } from './content';
import {
  CORE_CHAPTERS,
  buildGuide,
  chapterAnchor,
  chapterTitle,
  guideHref,
  guideRevision,
  renderChapter,
  type ChapterOrigin,
  type ChapterSource,
} from './guide';

// Read the way content.ts reads them, through Vite: a .ts test here has no
// node:fs (tsconfig pins `types` to the Cloudflare types). The shop's glob is
// its own chapters, client-owned: the core's repository has none, and a
// shop's CI runs these same tests over the ones it wrote.
const coreFiles = import.meta.glob('./chapters/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shopFiles = import.meta.glob('/client/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// The admin's routes, by file: never loaded, only listed.
const adminRoutes = new Set(Object.keys(import.meta.glob('/src/pages/admin/**/*.{astro,ts}')));

function chapters(files: Record<string, string>, origin: ChapterOrigin): ChapterSource[] {
  return Object.entries(files).map(([path, markdown]) => ({
    name: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
    markdown,
    origin,
  }));
}

const core = chapters(coreFiles, 'core');
const shop = chapters(shopFiles, 'shop');
const every = [...core, ...shop];
const where = (source: ChapterSource) =>
  `${source.origin === 'core' ? 'src/features/adminGuide/chapters' : 'client/guide'}/${source.name}.md`;

const parser = new MarkdownIt({ html: false, linkify: true });

/** Every inline token of a chapter, flattened: the words a reader reads. */
function inlineTokens(markdown: string): Token[] {
  return parser.parse(markdown, {}).flatMap((token) => token.children ?? []);
}

/** The text between each pair of `**`, as the reader sees it. */
function boldTexts(markdown: string): string[] {
  const found: string[] = [];
  let current: string[] | null = null;
  for (const token of inlineTokens(markdown)) {
    if (token.type === 'strong_open') current = [];
    else if (token.type === 'strong_close' && current) {
      found.push(current.join('').trim());
      current = null;
    } else if (current && (token.type === 'text' || token.type === 'code_inline')) current.push(token.content);
  }
  return found;
}

describe('the guide’s chapters', () => {
  it('give each section of the admin its chapter, after « Premiers pas »', () => {
    // AdminLayout's `Section` is what the footer link knows: a section without
    // a chapter would open the guide on nothing, a chapter without a section
    // would be a chapter no screen leads to.
    const union = /type Section =([^;]+);/.exec(layout)?.[1] ?? '';
    const sections = [...union.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect(sections.length).toBeGreaterThan(5);
    expect([...sections].sort()).toEqual(CORE_CHAPTERS.filter((name) => name !== 'start').sort());
    expect(core.map((source) => source.name).sort()).toEqual([...CORE_CHAPTERS].sort());
  });

  it('open with their title, the one heading of its level', () => {
    // The title carries the chapter's anchor, and the contents list it: a
    // chapter that opened with a paragraph, or held two titles, would be
    // listed under a file name or split in two.
    for (const source of every) {
      const tokens = parser.parse(source.markdown, {});
      const headings = tokens.filter((token) => token.type === 'heading_open');

      expect(tokens[0]?.type, where(source)).toBe('heading_open');
      expect(tokens[0]?.tag, where(source)).toBe('h2');
      expect(headings.filter((token) => token.tag === 'h1' || token.tag === 'h2').length, where(source)).toBe(1);
      expect(chapterTitle(source.markdown), where(source)).toBeTruthy();
    }
  });

  it('write French typography: ’, and a narrow no-break space before ? ! ; : and inside « »', () => {
    // The admin's own catalog is held to the same rules (messages.test.ts); a
    // guide that broke them would read as a second, careless voice.
    for (const source of every) {
      for (const token of inlineTokens(source.markdown)) {
        if (token.type !== 'text') continue;
        const at = `${where(source)}: « ${token.content} »`;
        expect(token.content, at).not.toContain("'");
        expect(token.content, at).not.toMatch(/[ \u00a0][?!;:]/);
        expect(token.content, at).not.toMatch(/«[ \u00a0]|[ \u00a0]»/);
      }
    }
  });

  it('name in bold only labels the admin shows', () => {
    // A bold word is a button or a field the merchant looks for on the screen.
    // When a release renames one, this fails until the chapter follows: that is
    // what keeps the guide true from one version to the next. A placeholder of
    // the catalog ({montant}) is written « … » in a chapter.
    const labels = Object.values(frAdmin as Record<string, string>).map((message) => message.replace(/\{[^}]+\}/g, '…'));
    for (const source of core) {
      for (const bold of boldTexts(source.markdown)) {
        expect(
          labels.some((label) => label.includes(bold)),
          `${where(source)}: « ${bold} » n’est le libellé d’aucun écran de l’administration`,
        ).toBe(true);
      }
    }
  });

  it('link only to a chapter of the guide or to an admin screen', () => {
    const ids = new Set([...buildGuide(every).map((chapter) => chapter.html).join('').matchAll(/ id="([^"]+)"/g)].map((match) => match[1]));
    const adminPage = (path: string) =>
      ['.astro', '/index.astro', '.ts'].some((suffix) => adminRoutes.has(`/src/pages${path.replace(/\/$/, '')}${suffix}`));

    for (const source of every) {
      for (const token of inlineTokens(source.markdown)) {
        if (token.type !== 'link_open') continue;
        const href = String(token.attrGet('href') ?? '');
        const at = `${where(source)}: ${href}`;
        if (href.startsWith('#')) expect(ids.has(href.slice(1)), at).toBe(true);
        else if (href.startsWith('/admin')) expect(adminPage(href.split(/[?#]/)[0]), at).toBe(true);
        // A shop's chapter may point at its own storefront or anywhere else;
        // the core's speak of the admin only.
        else expect(source.origin, at).toBe('shop');
      }
    }
  });

  it('give every heading of the guide its own id, set apart from the screen’s', () => {
    const ids = [...buildGuide(every).map((chapter) => chapter.html).join('').matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(every.length);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^guide-/);
  });
});

describe('the guide this build carries', () => {
  it('reads the chapters next to it, the theme’s texts only when the theme declares some', () => {
    const anchors = adminGuide().map((chapter) => chapter.anchor);
    const expected = CORE_CHAPTERS.map((name) => `guide-${name}`);

    // The core's own theme may or may not declare texts: either way the
    // chapter follows the menu entry, and nothing else is left out.
    expect(anchors.filter((anchor) => anchor !== 'guide-themeTexts')).toEqual(
      expected.filter((anchor) => anchor !== 'guide-themeTexts'),
    );
    expect(adminGuideRevision()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('chapterAnchor()', () => {
  it('keeps a core chapter’s section key, which is what the footer link targets', () => {
    expect(chapterAnchor({ name: 'orders', origin: 'core' })).toBe('guide-orders');
    expect(guideHref('orders')).toBe('/admin/guide#guide-orders');
    expect(guideHref(undefined)).toBe('/admin/guide');
  });

  it('sets a shop chapter apart, without the number that orders its file', () => {
    expect(chapterAnchor({ name: '01-accueil', origin: 'shop' })).toBe('guide-boutique-accueil');
    expect(chapterAnchor({ name: '2_Le thème', origin: 'shop' })).toBe('guide-boutique-le-theme');
    expect(chapterAnchor({ name: 'orders', origin: 'shop' })).toBe('guide-boutique-orders');
    expect(chapterAnchor({ name: '07', origin: 'shop' })).toBe('guide-boutique-chapitre');
  });
});

describe('renderChapter()', () => {
  const chapter = (markdown: string, name = 'orders') => renderChapter({ name, markdown, origin: 'core' });

  it('puts the anchor on the title and a numbered slug on each other heading', () => {
    const { html, title, anchor } = chapter('## Les **commandes**\n\n### Expédier\n\nTexte.\n\n### Expédier\n\n#### Le colis\n');

    expect(anchor).toBe('guide-orders');
    expect(title).toBe('Les commandes');
    expect(html).toContain('<h2 id="guide-orders">Les <strong>commandes</strong></h2>');
    expect(html).toContain('<h3 id="guide-orders-expedier">Expédier</h3>');
    expect(html).toContain('<h3 id="guide-orders-expedier-2">Expédier</h3>');
    expect(html).toContain('<h4 id="guide-orders-le-colis">Le colis</h4>');
  });

  it('falls back on the file name for a chapter without a title', () => {
    expect(chapter('Un paragraphe.', 'notes').title).toBe('notes');
  });

  it('renders as a page body does: raw HTML stays text', () => {
    // Invariant 11: the same renderMarkdown(), html: false. A chapter is a
    // file of the repository, but a shop's is written outside the core.
    const { html } = chapter('## Titre\n\n<script>alert(1)</script>\n\n[lien](javascript:alert(1))\n');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
  });
});

describe('buildGuide()', () => {
  const source = (name: string, origin: ChapterOrigin): ChapterSource => ({ name, origin, markdown: `## ${name}\n` });

  it('reads the core’s chapters in the admin’s order, then the shop’s by number', () => {
    const guide = buildGuide([
      source('10-fin', 'shop'),
      source('settings', 'core'),
      source('2-debut', 'shop'),
      source('nouveau', 'core'),
      source('start', 'core'),
      source('orders', 'core'),
    ]);

    expect(guide.map((chapter) => chapter.anchor)).toEqual([
      'guide-start',
      'guide-orders',
      'guide-settings',
      // A core chapter added without a place in CORE_CHAPTERS still shows.
      'guide-nouveau',
      'guide-boutique-debut',
      'guide-boutique-fin',
    ]);
  });
});

describe('guideRevision()', () => {
  const sources: ChapterSource[] = [
    { name: 'orders', origin: 'core', markdown: '## Commandes\n' },
    { name: '01-accueil', origin: 'shop', markdown: '## Accueil\n' },
  ];

  it('is a short, stable fingerprint', () => {
    expect(guideRevision(sources)).toMatch(/^[0-9a-f]{8}$/);
    expect(guideRevision(structuredClone(sources))).toBe(guideRevision(sources));
  });

  it('changes with any chapter, a shop’s included', () => {
    // A shop's chapter changes without any change of core version: the panel's
    // copy has to notice it all the same.
    const edited = structuredClone(sources);
    edited[1].markdown = '## Accueil\n\nUne phrase de plus.\n';

    expect(guideRevision(edited)).not.toBe(guideRevision(sources));
  });

  it('does not take two different cuts of the same letters for one guide', () => {
    expect(guideRevision([{ name: 'ab', origin: 'core', markdown: 'c' }])).not.toBe(
      guideRevision([{ name: 'a', origin: 'core', markdown: 'bc' }]),
    );
  });
});
