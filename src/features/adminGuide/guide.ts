import MarkdownIt from 'markdown-it';
import { renderMarkdown } from '../pages/markdown.ts';
import { slugPart } from '../products/slug.ts';

/**
 * The admin guide (ticket #188): chapters written in Markdown, read in a side
 * panel of the admin or on /admin/guide.
 *
 * Two owners, as everywhere in a shop. The core's chapters sit next to this
 * file, one per section of the admin, named by its `Section` key in
 * AdminLayout so the footer link can open the chapter of the screen the
 * merchant is on. A shop's own chapters sit in `client/guide/*.md`, which the
 * core never writes: an upgrade brings the core's new chapters and leaves the
 * shop's alone.
 *
 * Pure: the files come in as strings (content.ts globs them in the Worker,
 * the tests read them from disk).
 */

export type ChapterOrigin = 'core' | 'shop';

export interface ChapterSource {
  /** The file's name without `.md`. */
  name: string;
  markdown: string;
  origin: ChapterOrigin;
}

export interface GuideChapter {
  /** The id of the chapter's title, which the footer link and the contents target. */
  anchor: string;
  title: string;
  html: string;
  origin: ChapterOrigin;
}

/**
 * The core's chapters, in the order the guide reads: « Premiers pas », then
 * the admin's own menu. `start` is the one name that is not a section.
 */
export const CORE_CHAPTERS = [
  'start',
  'dashboard',
  'products',
  'orders',
  'customers',
  'categories',
  'pages',
  'navigation',
  'shipping',
  'media',
  'themeTexts',
  'settings',
] as const;

/** Every id the guide writes starts with this, so none can collide with the
 *  ids of the admin screen the panel opens over (`#payments`, `#email`…). */
const PREFIX = 'guide-';

/**
 * The anchor of a chapter. A core chapter keeps its section key, which is
 * what AdminLayout knows; a shop chapter is set apart, and loses the number
 * that orders its file (`01-accueil` → `guide-boutique-accueil`).
 */
export function chapterAnchor(source: Pick<ChapterSource, 'name' | 'origin'>): string {
  if (source.origin === 'core') return `${PREFIX}${source.name}`;
  return `${PREFIX}boutique-${slugPart(source.name.replace(/^\d+[-_ ]*/, '')) || 'chapitre'}`;
}

/** Where the footer link of a screen points: its chapter, or the guide's top. */
export function guideHref(section: string | undefined): string {
  return section ? `/admin/guide#${PREFIX}${section}` : '/admin/guide';
}

const parser = new MarkdownIt({ html: false, linkify: true });

/** The plain text of the chapter's first heading, if the chapter opens with one. */
export function chapterTitle(markdown: string): string | null {
  const tokens = parser.parse(markdown, {});
  const first = tokens.find((token) => token.type !== 'html_block');
  if (first?.type !== 'heading_open') return null;
  const inline = tokens[tokens.indexOf(first) + 1];
  const text = (inline?.children ?? [])
    .map((child) => (child.type === 'text' || child.type === 'code_inline' || child.type === 'text_special' ? child.content : ''))
    .join('')
    .trim();
  return text || null;
}

/**
 * One chapter's HTML: renderMarkdown() as a page body, so the same rules hold
 * (no raw HTML, link schemes filtered), with an id on each heading. The first
 * heading is the chapter's title and carries its anchor; the others take the
 * anchor plus their own slug, numbered when two share one.
 */
export function renderChapter(source: ChapterSource): GuideChapter {
  const anchor = chapterAnchor(source);
  const taken = new Set<string>();
  let first = true;
  const html = renderMarkdown(source.markdown, {
    headingId: (text) => {
      if (first) {
        first = false;
        taken.add(anchor);
        return anchor;
      }
      const base = `${anchor}-${slugPart(text) || 'section'}`;
      let id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      taken.add(id);
      return id;
    },
  });
  return { anchor, title: chapterTitle(source.markdown) ?? source.name, html, origin: source.origin };
}

const coreRank = (name: string): number => {
  const rank = (CORE_CHAPTERS as readonly string[]).indexOf(name);
  return rank === -1 ? CORE_CHAPTERS.length : rank;
};

/**
 * The whole guide: the core's chapters in the admin's order (an unknown name
 * after them, so a chapter added without a place still shows), then the
 * shop's, ordered by file name, which is how a shop numbers its own.
 */
export function buildGuide(sources: readonly ChapterSource[]): GuideChapter[] {
  const byName = (a: ChapterSource, b: ChapterSource) => a.name.localeCompare(b.name, 'fr', { numeric: true });
  const core = sources
    .filter((source) => source.origin === 'core')
    .sort((a, b) => coreRank(a.name) - coreRank(b.name) || byName(a, b));
  const shop = sources.filter((source) => source.origin === 'shop').sort(byName);
  return [...core, ...shop].map(renderChapter);
}

/**
 * A short fingerprint of the sources (FNV-1a, 32 bits). The panel keeps the
 * guide it fetched for the length of a browser session; this is what tells it
 * a deployment changed a chapter, a shop's included, since a shop's chapter
 * changes without any change of core version.
 */
export function guideRevision(sources: readonly ChapterSource[]): string {
  let hash = 0x811c9dc5;
  for (const source of sources) {
    for (const part of [source.origin, source.name, source.markdown]) {
      for (let i = 0; i < part.length; i += 1) {
        hash ^= part.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      // A separator, so ('ab', 'c') and ('a', 'bc') do not hash alike.
      hash ^= 0x1f;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
