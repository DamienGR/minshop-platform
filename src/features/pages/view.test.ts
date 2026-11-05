import { describe, expect, it } from 'vitest';
import { buildPageView, pageDrawsTile, type PageSource } from './view';
import { renderMarkdown } from './markdown';
import type { ModelPageModel, ThemePageModel } from '../storefront/models';

const POINTS: ThemePageModel = {
  key: 'points-de-vente',
  label: 'Où nous trouver',
  body: { label: 'Introduction' },
  zones: [
    { key: 'accroche', label: 'Accroche', format: 'text', maxLength: 160 },
    {
      key: 'points',
      label: 'Points de vente',
      itemLabel: 'Point de vente',
      maxItems: 5,
      fields: [
        { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 },
        { key: 'carte', label: 'Carte', format: 'markdown', maxLength: 1000 },
      ],
    },
  ],
};

const MAP = '```carte\nposition: 47.6582, -2.7608\nzoom: 16\n```';
const OPTIONS = {
  placeMaps: { tileUrl: (tile: { z: number; x: number; y: number }) => `/t/${tile.z}/${tile.x}/${tile.y}`, attribution: { text: 'x', href: 'https://x.example' } },
  lightbox: true,
};
const ROW = '![A](/images/media/a.webp) ![B](/images/media/b.webp)';

const page = (overrides: Partial<PageSource> = {}): PageSource => ({
  title: 'Où nous trouver',
  body_markdown: 'Nos **marchés**.',
  layout: 'wide',
  model: '',
  zones: '{}',
  ...overrides,
});

describe('a page’s view (ADR 0031)', () => {
  it('is the page as it always was for « Basique », or a model the theme lost', () => {
    for (const model of ['', 'gone']) {
      const { pageModel, view, description } = buildPageView(page({ model }), [POINTS], OPTIONS);
      expect(pageModel).toBeNull();
      expect(view).toEqual({
        title: 'Où nous trouver',
        html: renderMarkdown('Nos **marchés**.', OPTIONS),
        layout: 'wide',
        layoutStyle: expect.stringContaining('--page-measure'),
      });
      expect(description).toBe('Nos marchés.');
    }
  });

  it('hands the model’s template every zone, rendered like the body', () => {
    const zones = JSON.stringify({ accroche: 'Au marché', points: [{ nom: 'Halles', carte: MAP }, { nom: 'Port' }] });
    const { pageModel, view } = buildPageView(page({ model: 'points-de-vente', zones }), [POINTS], OPTIONS);
    expect(pageModel).toBe(POINTS);
    const model = view as ModelPageModel;
    expect(model.model).toBe('points-de-vente');
    expect(model.zones.accroche).toEqual({ text: 'Au marché', html: null });
    expect(model.lists.points.map((point) => point.nom.text)).toEqual(['Halles', 'Port']);
    expect(model.lists.points[0].carte.html).toBe(renderMarkdown(MAP, OPTIONS));
    expect(model.lists.points[0].carte.html).toContain('place-map');
    expect(model.lists.points[1].carte).toEqual({ text: '', html: '' });
  });

  it('takes the zones as stored or as the editor sent them', () => {
    const stored = buildPageView(page({ model: 'points-de-vente', zones: '{"accroche":"A"}' }), [POINTS], OPTIONS);
    const sent = buildPageView(page({ model: 'points-de-vente', zones: { accroche: 'A' } }), [POINTS], OPTIONS);
    expect(sent.view).toEqual(stored.view);
  });

  it('opens a row of photos large wherever it is, body or zone', () => {
    expect(buildPageView(page(), [POINTS], OPTIONS).lightbox).toBe(false);
    expect(buildPageView(page({ body_markdown: ROW }), [POINTS], OPTIONS).lightbox).toBe(true);
    const inZone = JSON.stringify({ points: [{ nom: 'Halles', carte: ROW }] });
    expect(buildPageView(page({ model: 'points-de-vente', zones: inZone }), [POINTS], OPTIONS).lightbox).toBe(true);
    // A zone of a model the page does not use draws nothing, a row included.
    expect(buildPageView(page({ zones: inZone }), [POINTS], OPTIONS).lightbox).toBe(false);
  });

  it('describes the page by its body, else by its zones', () => {
    const zones = JSON.stringify({ accroche: 'Au marché le samedi', points: [{ nom: 'Halles' }] });
    expect(buildPageView(page({ model: 'points-de-vente', zones }), [POINTS], OPTIONS).description).toBe('Nos marchés.');
    expect(
      buildPageView(page({ model: 'points-de-vente', zones, body_markdown: '' }), [POINTS], OPTIONS).description,
    ).toBe('Au marché le samedi Halles');
  });
});

describe('the tiles a page draws (ADR 0029)', () => {
  const drawn = [...renderMarkdown(MAP, OPTIONS).matchAll(/src="\/t\/(\d+)\/(\d+)\/(\d+)"/g)].map(([, z, x, y]) => ({
    z: +z,
    x: +x,
    y: +y,
  }));
  const inZone = JSON.stringify({ points: [{ nom: 'Halles', carte: MAP }] });

  it('counts a map in a zone of the model in use', () => {
    expect(drawn.length).toBeGreaterThan(0);
    for (const tile of drawn) {
      expect(pageDrawsTile(page({ model: 'points-de-vente', zones: inZone }), [POINTS], tile)).toBe(true);
    }
  });

  it('counts none in the zones of a model the page left, or the theme lost', () => {
    expect(pageDrawsTile(page({ zones: inZone }), [POINTS], drawn[0])).toBe(false);
    expect(pageDrawsTile(page({ model: 'points-de-vente', zones: inZone }), [], drawn[0])).toBe(false);
    expect(pageDrawsTile(page({ body_markdown: MAP }), [], drawn[0])).toBe(true);
  });
});
