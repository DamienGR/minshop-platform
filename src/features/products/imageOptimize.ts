import { env } from 'cloudflare:workers';
import { getConfig } from '../../config';
import { getSetting } from '../settings/db';

/**
 * Optionally downscale + recompress an uploaded image to WebP before it's stored,
 * via the Cloudflare Images binding. Controlled by config.images.optimizeOnUpload:
 *
 *   - OFF (default): the original file is stored unchanged — $0, fully local.
 *   - ON: transforms via the Cloudflare Images binding, which wrangler.template.jsonc
 *     declares on every shop. One unique transformation per upload: 5,000 a month
 *     on the Images Free plan, which refuses the next one and bills nothing; $0.50
 *     per 1,000 beyond them on Images Paid (separate from the Workers plan). Runs in
 *     local dev too — miniflare's offline binding supports the width + format we use
 *     (verified); `wrangler dev --remote` uses the production transformer.
 *
 * The fallback (and the try/catch) mean enabling it can never break an upload —
 * if the binding is missing, errors or is past its quota, you just store the
 * original.
 */
export async function optimizeUpload(file: File): Promise<File> {
  const cfg = getConfig().images;
  // Réglages → Général toggle (D1 `image_optimize`) wins over the build-time default.
  const override = await getSetting(env.DB, 'image_optimize');
  const optimize = override == null ? cfg.optimizeOnUpload : override === '1';
  // Feature off, or no IMAGES binding (a configuration rendered before the template
  // declared it, or one that took it out) → store as-is.
  if (!optimize || !env.IMAGES) return file;

  try {
    const out = await env.IMAGES.input(file.stream())
      .transform({ width: cfg.maxWidth })
      .output({ format: 'image/webp', quality: 82 });
    const buf = await out.response().arrayBuffer();
    if (buf.byteLength === 0) return file;
    return new File([buf], 'optimized.webp', { type: 'image/webp' });
  } catch {
    return file; // transformation unavailable (e.g. local dev) — keep the original
  }
}
