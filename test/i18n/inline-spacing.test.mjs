import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyPath } from '../../scripts/path-ownership.mjs';
import { trackedTemplates } from './template-scan.mjs';

// Deliberately .mjs, like the two language scans beside it.
//
// Astro drops the line break between two pieces of inline content: a
// `{t('…')}` on one line and a `<strong>` on the next render touching, with
// no space. The product editor read « Facultatif.Les variantessont des
// choix » (ticket #160), the media library « 3 fichiers.Une suppression »,
// and the demo banner « marquéedemo ». A sentence with marked words is one
// key rendered by `features/i18n/Rich.astro`; two keys side by side are joined
// by an explicit `{' '}`. This scan is the floor under both: it fails on the
// shape that loses the space, in every core template.

/** Every core template, storefront and Admin alike. A shop's own theme is the merchant's. */
const templates = trackedTemplates(['src'])
  .filter((path) => classifyPath(path)?.owner === 'core')
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** A line that ENDS with a piece of text: a catalog call, or an inline element closing. */
const ENDS_INLINE = /(\{tn?\((?:[^{}]|\{[^{}]*\})*\)\}|<\/(strong|em|code|b|i|kbd|abbr|mark|a)>)$/;
/** A line that STARTS with one. */
const STARTS_INLINE = /^(\{tn?\(|<(strong|em|code|b|i|kbd|abbr|mark)[\s>]|<a\s)/;
/** Two links in a row are two controls, laid out by their container, not a sentence. */
const LINK_THEN_LINK = (a, b) => a.endsWith('</a>') && b.startsWith('<a');

/** Markup only, as `markup()` reads it, but every removed block kept as its line breaks. */
const blanked = (text) =>
  text
    .replace(/^---\n[\s\S]*?\n---\n/, (block) => block.replace(/[^\n]/g, ''))
    .replace(/\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/g, (block) =>
      block.replace(/[^\n]/g, ''),
    );

/** `path:line` for every pair of lines whose text Astro would glue together. */
function gluedLines({ path, text }) {
  const lines = blanked(text).split('\n');
  const found = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim();
    const b = lines[i + 1].trim();
    if (ENDS_INLINE.test(a) && STARTS_INLINE.test(b) && !LINK_THEN_LINK(a, b)) {
      found.push(`${path}:${i + 1}: ${a.slice(-40)} ⏎ ${b.slice(0, 40)}`);
    }
  }
  return found;
}

describe('no space lost between two lines of text (ticket #160)', () => {
  it('finds the templates it is meant to be guarding', () => {
    const paths = templates.map((t) => t.path);
    expect(paths).toContain('src/pages/admin/products/[id]/edit.astro');
    expect(paths).toContain('src/pages/checkout.astro');
    expect(paths).toContain('src/features/i18n/Rich.astro');
    expect(paths.length).toBeGreaterThan(80);
  });

  it('catches the shape it is written for', () => {
    // The help of « Variantes et options supplémentaires » as it was.
    const before = {
      path: 'fixture.astro',
      text: [
        '<p>',
        "  {t('admin.products.variants.intro.optional')}",
        "  <strong class=\"font-medium\">{t('admin.products.variants.intro.variants')}</strong>",
        "  {t('admin.products.variants.intro.variantsText')}",
        "  {t('a')}{' '}",
        "  {t('b')}",
        '</p>',
      ].join('\n'),
    };
    expect(gluedLines(before)).toHaveLength(3);
  });

  it('writes no two pieces of text on two lines without a space between them', () => {
    expect(templates.flatMap(gluedLines)).toEqual([]);
  });
});
