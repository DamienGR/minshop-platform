import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { activePageModels, pageModelTemplate } from '../../src/features/pageModels/active';
import { isListZone, pageModelProblems, validPageModels } from '../../src/features/pageModels/declaration';
import { resolveTheme } from '../../scripts/themes.mjs';
import type { ModelPageModel, ThemePageModel, ThemeText } from '../../src/features/storefront/models';

/**
 * The page models contract (ticket #205, ADR 0031): what a theme may declare
 * in `pageModels.ts`, and what each model's template, `pages/<key>.astro`,
 * does with what it receives. Every theme on disk is held to it, the selected
 * one or not, so a shop's broken declaration or forgotten template fails here
 * rather than in front of the merchant: the editor offers only a model it can
 * draw (features/pageModels/active.ts), and would drop one in silence.
 */

const declarations = import.meta.glob<{ pageModels?: unknown }>('../../src/themes/*/pageModels.ts', { eager: true });
const templates = import.meta.glob<{ default: unknown }>('../../src/themes/*/pages/*.astro', { eager: true });

const themeOf = (path: string) => /\/themes\/([^/]+)\//.exec(path)?.[1] ?? '';
const declared = Object.entries(declarations).map(([path, module]) => ({
  theme: themeOf(path),
  models: validPageModels(module.pageModels),
  raw: module.pageModels,
}));
const templateKeys = (theme: string) =>
  Object.keys(templates)
    .filter((path) => themeOf(path) === theme)
    .map((path) => /\/pages\/([^/]+)\.astro$/.exec(path)?.[1] ?? '');

/** Every zone filled, each with a text of its own, so the render shows which
 *  ones the template draws. */
const filled = (model: ThemePageModel): ModelPageModel => {
  const text = (name: string, format: 'text' | 'markdown'): ThemeText =>
    format === 'markdown' ? { text: name, html: `<p>${name}</p>` } : { text: name, html: null };
  const zones: ModelPageModel['zones'] = {};
  const lists: ModelPageModel['lists'] = {};
  for (const zone of model.zones) {
    if (!isListZone(zone)) {
      zones[zone.key] = text(`zone-${zone.key}`, zone.format);
      continue;
    }
    lists[zone.key] = [1, 2].map((entry) =>
      Object.fromEntries(zone.fields.map((field) => [field.key, text(`${zone.key}-${entry}-${field.key}`, field.format)])),
    );
  }
  return {
    title: 'Titre-de-page',
    html: '<p>Corps-de-page</p>',
    layout: 'standard',
    layoutStyle: '',
    model: model.key,
    zones,
    lists,
  };
};

const empty = (model: ThemePageModel): ModelPageModel => {
  const zones: ModelPageModel['zones'] = {};
  const lists: ModelPageModel['lists'] = {};
  for (const zone of model.zones) {
    if (isListZone(zone)) lists[zone.key] = [];
    else zones[zone.key] = { text: '', html: zone.format === 'markdown' ? '' : null };
  }
  return { title: 'Titre-de-page', html: '', layout: 'standard', layoutStyle: '', model: model.key, zones, lists };
};

const render = async (component: unknown, model: ModelPageModel) =>
  (await AstroContainer.create()).renderToString(component as never, { props: { model } });

describe('page model declarations', () => {
  it('looks for them where the themes are', () => {
    // The globs find nothing when no theme declares models; this one proves
    // the path still points at the themes, so "nothing" means nothing.
    expect(Object.keys(import.meta.glob('../../src/themes/*/ContentPage.astro')).length).toBeGreaterThan(0);
  });

  it.each(declared.map((entry) => [entry.theme, entry] as const))('%s declares by the rules', (_theme, entry) => {
    expect(pageModelProblems(entry.raw)).toEqual([]);
  });

  it.each(declared.map((entry) => [entry.theme, entry] as const))('%s draws every model it declares', (_theme, entry) => {
    expect(templateKeys(entry.theme).sort()).toEqual(entry.models.map((model) => model.key).sort());
  });

  it('keeps no template without its declaration', () => {
    const themes = new Set(declared.map((entry) => entry.theme));
    const orphans = Object.keys(templates).filter((path) => !themes.has(themeOf(path)));
    expect(orphans).toEqual([]);
  });

  it('offers the active theme’s models, each with its template', () => {
    const active = declared.find((entry) => entry.theme === resolveTheme().id);
    expect(activePageModels).toEqual(active?.models ?? []);
    for (const model of activePageModels) expect(pageModelTemplate(model.key)).not.toBeNull();
    expect(pageModelTemplate('basique')).toBeNull();
  });
});

describe('a model’s template', () => {
  const cases = declared.flatMap((entry) =>
    entry.models.map((model) => {
      const path = `../../src/themes/${entry.theme}/pages/${model.key}.astro`;
      return [`${entry.theme}/${model.key}`, model, templates[path]?.default] as const;
    }),
  );

  it.each(cases)('%s draws the title, the body and every zone', async (_name, model, template) => {
    const html = await render(template, filled(model));
    expect(html).toContain('Titre-de-page');
    expect(html).toContain('<p>Corps-de-page</p>');
    // The prose styles hang on this class, as on ContentPage.
    expect(html).toContain('markdown-content');
    for (const zone of model.zones) {
      if (!isListZone(zone)) {
        expect(html).toContain(`zone-${zone.key}`);
        continue;
      }
      for (const field of zone.fields) {
        expect(html).toContain(`${zone.key}-1-${field.key}`);
        expect(html).toContain(`${zone.key}-2-${field.key}`);
      }
      // In the merchant's order.
      expect(html.indexOf(`${zone.key}-1-${zone.fields[0].key}`)).toBeLessThan(
        html.indexOf(`${zone.key}-2-${zone.fields[0].key}`),
      );
    }
  });

  it.each(cases)('%s draws nothing of a zone left empty', async (_name, model, template) => {
    const html = await render(template, empty(model));
    expect(html).toContain('Titre-de-page');
    expect(html).not.toMatch(/zone-|-1-/);
  });

  it.each(cases)('%s cannot be made to inject markup through a line of text', async (_name, model, template) => {
    const value = filled(model);
    for (const key of Object.keys(value.zones)) {
      if (value.zones[key].html === null) value.zones[key] = { text: '<img src=x onerror=alert(1)>', html: null };
    }
    for (const entries of Object.values(value.lists)) {
      for (const entry of entries) {
        for (const key of Object.keys(entry)) {
          if (entry[key].html === null) entry[key] = { text: '<script>x</script>', html: null };
        }
      }
    }
    expect(await render(template, value)).not.toMatch(/<img src=x|<script>x/);
  });
});
