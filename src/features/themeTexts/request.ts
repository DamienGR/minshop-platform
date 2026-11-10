import type { ThemeText } from '../storefront/models';
import { getConfig } from '../../config';
import { activeThemeTextSlots } from './active';
import { resolveThemeTexts } from './slots';

/** One resolution per request, whoever asks first. */
const resolved = new WeakMap<App.Locals, Record<string, ThemeText>>();

/**
 * The theme's texts for this request (ticket #225): what the middleware read
 * in its batch (`locals.themeTexts`), resolved once — the header, the footer,
 * the home and the product page print the same record, and a Markdown slot is
 * rendered once, not once per template.
 *
 * Every declared key is present. Where the middleware read nothing — an admin
 * document such as /admin/login, which reads no menus either, or a batch that
 * failed — each slot shows its default.
 */
export function requestThemeTexts(locals: App.Locals): Record<string, ThemeText> {
  let texts = resolved.get(locals);
  if (!texts) {
    texts = resolveThemeTexts(activeThemeTextSlots, locals.themeTexts ?? new Map(), {
      baseUrl: getConfig().images.baseUrl,
    });
    resolved.set(locals, texts);
  }
  return texts;
}
