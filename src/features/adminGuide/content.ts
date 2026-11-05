import { activeThemeTextSlots } from '../themeTexts/active';
import { buildGuide, guideRevision, type ChapterSource, type GuideChapter } from './guide';

/**
 * The guide this build carries: the core's chapters and the shop's, read at
 * build time. `?raw` keeps them the Markdown they are (Astro would otherwise
 * compile a `.md` import into a page), and the shop's glob matches nothing in
 * the core's own repository.
 *
 * No type argument on the globs, a cast instead: a typed glob is what left a
 * stale Vitest module cache failing themeTexts.test.ts after a checkout.
 */
const core = import.meta.glob('./chapters/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shop = import.meta.glob('/client/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
}

/**
 * The chapters to show. « Textes du thème » only for a theme that declares
 * texts, as AdminLayout shows its menu entry (ticket #165): a chapter about a
 * screen the merchant cannot open is a question nobody can answer.
 */
function sources(): ChapterSource[] {
  return [
    ...Object.entries(core).map(([path, markdown]) => ({ name: fileName(path), markdown, origin: 'core' as const })),
    ...Object.entries(shop).map(([path, markdown]) => ({ name: fileName(path), markdown, origin: 'shop' as const })),
  ].filter((source) => source.origin === 'shop' || source.name !== 'themeTexts' || activeThemeTextSlots.length > 0);
}

// Fixed for the life of a Worker instance, like getConfig(): the sources are
// part of the build. Rendered once per isolate, never per request.
let chapters: GuideChapter[] | undefined;
let revision: string | undefined;

export function adminGuide(): GuideChapter[] {
  return (chapters ??= buildGuide(sources()));
}

/** Cheap: hashes the sources without rendering them (every admin page asks). */
export function adminGuideRevision(): string {
  return (revision ??= guideRevision(sources()));
}
