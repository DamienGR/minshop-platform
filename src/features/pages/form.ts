import { formatNumber, t } from '../i18n/index.ts';
import { normalizePageLayout, type PageLayout } from './layouts.ts';
import type { ThemePageModel } from '../storefront/models.ts';
import { pageModelOf } from '../pageModels/declaration.ts';
import { parsePageZonesForm, serializeZones, type StoredZones } from '../pageModels/zones.ts';

const MAX_TITLE = 120;
const MAX_BODY = 100_000;
/** Every zone together, stored: what one page row may carry beside its body.
 *  A model's own limits (features/pageModels/declaration.ts) could add up to
 *  far more. */
export const MAX_ZONES = 200_000;

export interface PageFields {
  title: string;
  /** Raw slug as typed; '' means "derive it from the title". */
  slug: string;
  body_markdown: string;
  published: number;
  /** Always a known preset — unknown submissions fall back to the default. */
  layout: PageLayout;
  /** A model the theme declares, or '' for « Basique » (ADR 0031). */
  model: string;
  /** Every zone the page keeps: the chosen model's as the form sent them,
   *  merged into the ones already stored. */
  zones: StoredZones;
}

/** What the form is read against: the active theme's models, and what the
 *  page stores, which a field the form did not send leaves as it is. */
export interface PageFormContext {
  models?: readonly ThemePageModel[];
  stored?: { model: string; zones: StoredZones };
}

/**
 * Parse and validate the page form. Returns either the fields or a single
 * user-facing message, matching parseProductForm's shape.
 */
export function parsePageForm(
  form: FormData,
  { models = [], stored = { model: '', zones: {} } }: PageFormContext = {},
): { data: PageFields } | { error: string } {
  const title = String(form.get('title') ?? '').trim();
  if (!title) return { error: t('admin.pages.form.titleRequired') };
  if (title.length > MAX_TITLE) {
    return { error: t('admin.pages.form.titleTooLong', { max: MAX_TITLE }) };
  }

  const body = String(form.get('body_markdown') ?? '');
  if (body.length > MAX_BODY) {
    return { error: t('admin.pages.form.bodyTooLong', { max: formatNumber(MAX_BODY) }) };
  }

  // The editor sends the model only when the theme declares some: a theme
  // that lost them leaves the page's key alone, and the page reads as
  // « Basique » until it comes back.
  const sentModel = form.get('model');
  const model = typeof sentModel === 'string' ? (pageModelOf(models, sentModel)?.key ?? '') : stored.model;
  // The zones are read against the model the page had when the editor was
  // drawn: those are the fields on screen. A new model's zones are offered
  // after the save that chose it.
  const zones = parsePageZonesForm(form, pageModelOf(models, stored.model), stored.zones);
  if ('error' in zones) return zones;
  if (serializeZones(zones.zones).length > MAX_ZONES) {
    return { error: t('admin.pages.form.zonesTooLong', { max: formatNumber(MAX_ZONES) }) };
  }

  return {
    data: {
      title,
      slug: String(form.get('slug') ?? '').trim(),
      body_markdown: body,
      // Checkbox: present = on. Any other truthy encoding ('1', 'true') also works.
      published: form.get('published') ? 1 : 0,
      layout: normalizePageLayout(form.get('layout')),
      model,
      zones: zones.zones,
    },
  };
}
