import type { ContentPageModel, ModelPageModel, ThemePageModel } from '../storefront/models.ts';
import { pageModelOf } from '../pageModels/declaration.ts';
import { modelMarkdownTexts, readStoredZones, resolvePageZones, type StoredZones } from '../pageModels/zones.ts';
import type { Tile } from '../maps/tiles.ts';
import { markdownExcerpt, placeMapsDrawTile, renderMarkdown, usesLightbox, type RenderOptions } from './markdown.ts';
import { normalizePageLayout, pageLayoutStyle } from './layouts.ts';
import { plainTitle } from '../titleMarks/marks.ts';

/**
 * A page as the storefront draws it, and as the editor's whole-page preview
 * shows it before it is saved (ticket #205, ADR 0031): its body, and, when
 * the active theme still declares the page's model, every zone of that model,
 * each rendered by the body's own renderer and options. Pure: the page, the
 * models and the render options arrive as arguments.
 */

/** What a page holds, saved or as the editor's form sent it. */
export interface PageSource {
  title: string;
  body_markdown: string;
  layout: string;
  model: string;
  zones: string | StoredZones;
}

export interface PageView {
  /** The model that draws the page, or null for « Basique » (`ContentPage`). */
  pageModel: ThemePageModel | null;
  view: ContentPageModel | ModelPageModel;
  /** Whether a row of photos anywhere on the page opens large (Lightbox.astro). */
  lightbox: boolean;
  /** The meta description: the body's first words, else the zones', without
   *  the theme's title codes (ticket #251). */
  description: string;
  /** The title as plain text, without the theme's codes (ticket #251): what
   *  the document's title carries. `view.title` keeps them for the theme. */
  titleText: string;
}

const zonesOf = (page: PageSource): StoredZones =>
  typeof page.zones === 'string' ? readStoredZones(page.zones) : page.zones;

/**
 * `titleMarks` are the codes the active theme declares (ticket #251): the
 * template receives the title as the merchant wrote it, codes included, and
 * draws them; the plain-text title and description go without.
 */
export function buildPageView(
  page: PageSource,
  models: readonly ThemePageModel[],
  options: RenderOptions,
  titleMarks: readonly string[],
): PageView {
  const html = renderMarkdown(page.body_markdown, options);
  const layout = normalizePageLayout(page.layout);
  const base: ContentPageModel = { title: page.title, html, layout, layoutStyle: pageLayoutStyle(layout) };
  const titleText = plainTitle(page.title, titleMarks);
  const pageModel = pageModelOf(models, page.model);
  if (!pageModel) {
    return {
      pageModel,
      view: base,
      lightbox: usesLightbox(html),
      description: markdownExcerpt(page.body_markdown),
      titleText,
    };
  }

  const zones = zonesOf(page);
  const resolved = resolvePageZones(pageModel, zones, (markdown) => renderMarkdown(markdown, options));
  const texts = [
    ...Object.values(resolved.zones),
    ...Object.values(resolved.lists).flatMap((entries) => entries.flatMap((entry) => Object.values(entry))),
  ];
  const view: ModelPageModel = { ...base, model: pageModel.key, ...resolved };
  return {
    pageModel,
    view,
    lightbox: [html, ...texts.map((text) => text.html ?? '')].some(usesLightbox),
    // A zone may be a title the theme decorates: its codes go before the
    // excerpt is cut, so they cannot take its length either.
    description:
      markdownExcerpt(page.body_markdown) ||
      markdownExcerpt(
        texts
          .map((text) => plainTitle(text.text, titleMarks))
          .filter(Boolean)
          .join('\n\n'),
      ),
    titleText,
  };
}

/**
 * Whether a map of the page draws this tile, in its body or in a zone its
 * model draws: what bounds the tile relay (ADR 0029). The zones of a model
 * the page no longer uses draw nothing, so they fetch nothing.
 */
export function pageDrawsTile(page: PageSource, models: readonly ThemePageModel[], tile: Tile): boolean {
  if (placeMapsDrawTile(page.body_markdown, tile)) return true;
  return modelMarkdownTexts(pageModelOf(models, page.model), zonesOf(page)).some((zone) =>
    placeMapsDrawTile(zone.text, tile),
  );
}
