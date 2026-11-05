import type { ThemePageModel } from '../storefront/models';
import { validPageModels } from './declaration';

/**
 * The page models the ACTIVE theme declares, and their templates, resolved at
 * build time (ticket #205, ADR 0031).
 *
 * Both files are optional — a theme that declares nothing keeps « Basique »,
 * the page as it always was — and a static import of a file that may not
 * exist does not build. A glob through the `#theme` alias matches the active
 * theme's files or nothing, as for the theme's texts
 * (features/themeTexts/active.ts).
 *
 * A model is offered only with its template: a declaration whose
 * `pages/<key>.astro` is missing would let the merchant pick a page the
 * storefront cannot draw. The suite fails on either half alone
 * (test/storefront/pageModels.test.ts).
 */
const declarations = Object.values(
  import.meta.glob<{ pageModels?: unknown }>('#theme/pageModels.ts', { eager: true }),
);
const templates = import.meta.glob<{ default: unknown }>('#theme/pages/*.astro', { eager: true });

/** A template's model key, from its path: `…/pages/marque.astro` → `marque`. */
const templateKey = (path: string) => /\/pages\/([^/]+)\.astro$/.exec(path)?.[1] ?? '';

const templateByKey = new Map(Object.entries(templates).map(([path, module]) => [templateKey(path), module.default]));

export const activePageModels: readonly ThemePageModel[] = validPageModels(declarations[0]?.pageModels).filter(
  (model) => templateByKey.has(model.key),
);

/** The template that draws a model of the active theme. */
export function pageModelTemplate(key: string): unknown {
  return templateByKey.get(key) ?? null;
}
