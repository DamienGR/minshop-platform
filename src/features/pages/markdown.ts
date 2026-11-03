import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance, Token } from 'markdown-it';
import { mediaUrl } from '../media/url.ts';
import { isPlaceMapInfo, parsePlace, type ParsedPlace } from '../maps/place.ts';
import {
  placeErrorMessage,
  renderPlaceErrors,
  renderPlaceMap,
  type PlaceMapOptions,
} from '../maps/render.ts';
import { tileGrid, type Tile } from '../maps/tiles.ts';

/**
 * Server-only Markdown renderer, shared by the storefront route and the admin
 * preview endpoint so the two cannot drift. It is never bundled for the browser:
 * the editor's Preview tab posts to /api/admin/pages/preview and renders what
 * this returns.
 *
 * `html: false` is the whole safety model. Raw HTML in a page body is escaped
 * rather than parsed, so an admin cannot inject a <script>, an iframe, or an
 * event handler — and neither can anyone who gets hold of an admin session.
 * markdown-it also validates link targets against its own scheme blocklist
 * (javascript:, vbscript:, file:, and data: except for images), so we do not
 * hand-roll URL filtering.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: false,
});

/** Root-relative media reference the editor inserts: /images/<key>. */
const LOCAL_IMAGE_PREFIX = '/images/';

function localKeyFromSrc(src: string, baseUrl: string): string | null {
  if (src.startsWith(LOCAL_IMAGE_PREFIX)) {
    return src.slice(LOCAL_IMAGE_PREFIX.length) || null;
  }
  // Absolute form, in case a body was pasted from a store with IMAGE_BASE_URL
  // set. The editor only ever writes the root-relative form.
  if (baseUrl && src.startsWith(`${baseUrl}/`)) {
    return src.slice(baseUrl.length + 1) || null;
  }
  return null;
}

/**
 * Plain text of inline tokens, for an image's alt attribute.
 *
 * markdown-it's own renderInlineAsText skips `text_special`, which is what an
 * escaped character becomes — so `![Photo of \[blue shirt]` rendered
 * alt="Photo of blue shirt", quietly losing the bracket. The editor has to
 * escape brackets (a bare `[` turns the image into a link), so dropping them
 * here would mean alt text can never contain one.
 */
function inlineTextOf(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'text_special') return token.content;
      if (token.type === 'code_inline') return token.content;
      if (token.children?.length) return inlineTextOf(token.children);
      return '';
    })
    .join('');
}

export interface RenderOptions {
  /** config.images.baseUrl — lets page images use a custom image origin. */
  baseUrl?: string;
  /**
   * Emit `data-source-line` on block elements. Admin preview only — it lets a
   * click in the preview jump to the matching line in the editor. The public
   * page renders without it, so storefront HTML stays free of editor plumbing.
   */
  sourceMap?: boolean;
  /**
   * Pixel dimensions per media key, so each <img> can reserve its space.
   *
   * Without width/height an image has no intrinsic size and no aspect-ratio, so
   * it occupies only its alt-text line box until the bitmap arrives and then
   * jumps to full height — 181px of shift on a 242x209 page image. Keys absent
   * from the map simply render without the attributes, which is the old
   * behaviour, so a page mixing measured and unmeasured images still works.
   */
  dimensions?: Map<string, { width: number; height: number }>;
  /**
   * Draw ```carte blocks as the map of a place (ADR 0029). Content pages only:
   * a renderer called without it — a product description, a theme's text —
   * leaves the block the code block it always was.
   */
  placeMaps?: PlaceMapOptions & {
    /**
     * Admin preview: say what is wrong with a block it cannot draw. The
     * storefront draws nothing there instead; the save already said why.
     */
    showErrors?: boolean;
  };
}

/**
 * Rewrite local image sources through mediaUrl() and mark body images as
 * lazy/async. Bodies are stored root-relative and portable; the origin is
 * applied at render time, so changing IMAGE_BASE_URL never requires a rewrite
 * of stored content.
 */
function installImageRule(
  instance: MarkdownItInstance,
  baseUrl: string,
  dimensions?: RenderOptions['dimensions'],
): void {
  instance.renderer.rules.image = (tokens, idx, options, _env, self) => {
    const token = tokens[idx];
    // attrGet is typed string | number since markdown-it 15; src is always a string.
    const src = String(token.attrGet('src') ?? '');
    const key = localKeyFromSrc(src, baseUrl);
    if (key) token.attrSet('src', mediaUrl(key, baseUrl));
    // markdown-it's DEFAULT image rule fills `alt` from the token's inline
    // children; overriding the rule means doing it here too. Without this every
    // image renders alt="" — the alt text an author typed is silently dropped.
    token.attrSet('alt', inlineTextOf(token.children ?? []));
    // Body images are below the fold by definition — the header logo is the
    // only image on the page that must not be lazy.
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    const size = key ? dimensions?.get(key) : undefined;
    if (size) {
      // Intrinsic size only. The CSS keeps `max-width: 100%; height: auto`, so
      // these reserve the right aspect ratio without pinning the rendered size.
      token.attrSet('width', String(size.width));
      token.attrSet('height', String(size.height));
    }
    // renderToken escapes attribute values, and alt text goes through the
    // default renderer, so neither can break out into markup.
    return self.renderToken(tokens, idx, options);
  };
}

/**
 * A ```carte fence becomes a map, built from the parsed place and never from
 * the block's text (features/maps/render.ts). Every other fence keeps
 * markdown-it's own rule.
 */
function installPlaceMapRule(
  instance: MarkdownItInstance,
  maps: NonNullable<RenderOptions['placeMaps']>,
  sourceMap: boolean,
): void {
  const fence = instance.renderer.rules.fence;
  instance.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (!isPlaceMapInfo(token.info)) {
      return fence ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    }
    const fenceLine = (token.map?.[0] ?? 0) + 1;
    // The same plumbing renderToken adds to every other block, from numbers only.
    const source =
      sourceMap && token.map
        ? ` data-source-line="${token.map[0] + 1}" data-source-end="${token.map[1] + 1}"`
        : '';
    const parsed = parsePlace(token.content);
    if ('errors' in parsed) {
      return maps.showErrors ? renderPlaceErrors(parsed.errors, fenceLine, source) : '';
    }
    return renderPlaceMap(parsed.place, maps, source);
  };
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const baseUrl = options.baseUrl ?? '';
  const instance = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    typographer: false,
  });
  installImageRule(instance, baseUrl, options.dimensions);
  if (options.placeMaps) installPlaceMapRule(instance, options.placeMaps, options.sourceMap === true);

  if (options.sourceMap) {
    // Block tokens carry `map: [startLine, endLine]`. Stamping the start line on
    // the opening tag is all the editor needs to map a click back to the source;
    // inline tokens have no map, so images inherit their block's line.
    const renderToken = instance.renderer.renderToken.bind(instance.renderer);
    instance.renderer.renderToken = (tokens, idx, opts) => {
      const token = tokens[idx];
      if (token.map && token.nesting !== -1) {
        token.attrSet('data-source-line', String(token.map[0] + 1));
        // Exclusive end line, so the editor knows the block's source extent and
        // can map a click INSIDE the text to a character offset rather than
        // selecting the whole line.
        token.attrSet('data-source-end', String(token.map[1] + 1));
      }
      return renderToken(tokens, idx, opts);
    };
  }

  return instance.render(markdown);
}

/**
 * Plain-text summary for <meta name="description">. Derived from parsed tokens
 * rather than the raw source, so `## Heading`, `**bold**`, and link syntax don't
 * leak punctuation into the description.
 */
export function markdownExcerpt(markdown: string, maxLength = 160): string {
  const text = md
    .parse(markdown, {})
    .filter((token) => token.type === 'inline')
    .map((token) =>
      (token.children ?? [])
        // A wrapped line is a softbreak token with no content: it stands for a
        // space, or the words on either side of it run together.
        .map((child) =>
          child.type === 'softbreak' || child.type === 'hardbreak'
            ? ' '
            : child.type === 'text' || child.type === 'code_inline'
              ? child.content
              : '',
        )
        .join(''),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  // Cut on a word boundary so the summary doesn't end mid-word.
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Every distinct media key the body references, discovered from parser tokens
 * rather than a regex — a regex would also match image syntax inside a fenced
 * code block, which renders as text and is not a real reference.
 *
 * External images and links are ignored: only objects served by this store can
 * be library associations.
 */
export function extractMediaKeys(markdown: string, options: RenderOptions = {}): string[] {
  const baseUrl = options.baseUrl ?? '';
  const keys = new Set<string>();
  const walk = (tokens: ReturnType<typeof md.parse>) => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const key = localKeyFromSrc(String(token.attrGet('src') ?? ''), baseUrl);
        if (key) keys.add(key);
      }
      if (token.children?.length) walk(token.children);
    }
  };
  walk(md.parse(markdown, {}));
  // A Set keeps insertion order, so repeated references collapse to one entry
  // and page_media never gets a duplicate row.
  return [...keys];
}

/**
 * Every ```carte block of a body, parsed, with the line its fence opens on.
 * From parser tokens, like extractMediaKeys: a ```carte written inside another
 * code block, or indented as code, is text and draws nothing.
 */
export function placeMapBlocks(markdown: string): Array<{ fenceLine: number; parsed: ParsedPlace }> {
  return md
    .parse(markdown, {})
    .filter((token) => token.type === 'fence' && isPlaceMapInfo(token.info))
    .map((token) => ({ fenceLine: (token.map?.[0] ?? 0) + 1, parsed: parsePlace(token.content) }));
}

/** What is wrong with the body's maps, one message per problem; [] when none. */
export function placeMapProblems(markdown: string): string[] {
  return placeMapBlocks(markdown).flatMap(({ fenceLine, parsed }) =>
    'errors' in parsed ? parsed.errors.map((error) => placeErrorMessage(error, fenceLine)) : [],
  );
}

/**
 * Whether one of the body's maps draws this tile. The tile route asks it on a
 * cache miss, and refuses every other tile: what makes it a relay for the
 * shop's own maps rather than an open proxy to the tile server.
 */
export function placeMapsDrawTile(markdown: string, tile: Tile): boolean {
  return placeMapBlocks(markdown).some(({ parsed }) => {
    if ('errors' in parsed || parsed.place.zoom !== tile.z) return false;
    return tileGrid(parsed.place.lat, parsed.place.lon, parsed.place.zoom).tiles.some(
      (drawn) => drawn !== null && drawn.x === tile.x && drawn.y === tile.y,
    );
  });
}
