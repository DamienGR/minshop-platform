import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { activeThemeTextSlots } from '../../../features/themeTexts/active';
import { saveThemeTexts } from '../../../features/themeTexts/db';
import { parseThemeTextsForm } from '../../../features/themeTexts/slots';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';
import { getConfig } from '../../../config';

export const prerender = false;

const SCREEN = '/admin/theme-texts';

// POST /api/admin/theme-texts — save the theme's texts (ticket #165), all of
// them or none: one text too long refuses the whole form, with a message.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const parsed = parseThemeTextsForm(form, activeThemeTextSlots, { baseUrl: getConfig().images.baseUrl });
  if ('error' in parsed) return redirect(`${SCREEN}?error=${encodeURIComponent(parsed.error)}`, 303);

  await saveThemeTexts(env.DB, parsed.writes);
  // The texts are on the home, which every storefront document can be.
  await purgeCacheTags([CACHE_TAG.shell, CACHE_TAG.catalog]);
  return redirect(`${SCREEN}?saved=1`, 303);
};
