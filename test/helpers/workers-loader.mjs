import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Module resolution for integration scripts that import the app's own modules.
 *
 * Two things Node cannot do on its own, and Vite does for every other consumer
 * of these files:
 *
 * 1. `cloudflare:workers` has no Node implementation. It resolves to
 *    test/helpers/workers-env.mjs, whose `env` the suite fills with a real
 *    Miniflare binding.
 * 2. The app imports siblings without an extension (`./db`, `../payments`).
 *    TypeScript and Vite resolve those; Node's ESM resolver refuses them.
 *
 * The extension search is deliberately narrow — the candidates below, in order,
 * and only after Node itself has failed. A specifier Node CAN resolve is never
 * touched, so this cannot quietly shadow a real package.
 */
const WORKERS_ENV = new URL('./workers-env.mjs', import.meta.url).href;
const CANDIDATES = ['.ts', '.mjs', '.js', '/index.ts', '/index.mjs', '/index.js'];
const RETRYABLE = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') {
    return { url: WORKERS_ENV, shortCircuit: true, format: 'module' };
  }
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!RETRYABLE.has(error?.code) || !specifier.startsWith('.')) throw error;
    const base = new URL(specifier, context.parentURL);
    for (const extension of CANDIDATES) {
      if (existsSync(fileURLToPath(new URL(base.href + extension)))) {
        return next(specifier + extension, context);
      }
    }
    throw error;
  }
}
