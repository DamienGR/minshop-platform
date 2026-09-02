import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';
import { applyMigrations } from './d1-schema.mjs';

/**
 * The BUILT Worker, in process, on a schema built from the real migrations.
 *
 * The security gate asks questions no unit test can answer, because every one
 * of them is about the request pipeline rather than a function: does an
 * anonymous request reach /admin, does a foreign origin's form post get
 * refused, does the response that leaves carry its hardening headers, does a
 * customer's address end up in the log line an operator reads. Those are
 * properties of the middleware, the routes and the adapter composed together —
 * which only exist after `astro build`.
 *
 * Miniflare rather than `wrangler dev`, and that is the whole reason this helper
 * exists beside test/browser/serve.mjs and test/integration/d1-integration.sh.
 * Those two boot a dev session and talk to it over a port; the security suite
 * deliberately trips the rate limiter, and the dev proxy loses connections under
 * exactly that kind of burst (cloudflare/workers-sdk#15317 — the fault
 * run-d1-integration.sh exists to re-run around). Here there is no proxy: the
 * suite calls workerd directly, so a burst is just a burst, and a 429 is
 * always the Worker's answer rather than possibly the proxy's.
 *
 * It also buys the two capabilities the log assertions need and a port cannot
 * give: `handleRuntimeStdio` captures everything the Worker prints, and
 * `outboundService` stands in for the providers it calls, so a provider that
 * answers with the customer's own address in its error body is a thing the
 * suite can arrange rather than describe.
 */
const BUILD = 'dist/server/entry.mjs';
const CONFIG = 'dist/server/wrangler.json';

/** The built config is the source of truth for compatibility and bindings. */
function builtConfig() {
  if (!existsSync(BUILD) || !existsSync(CONFIG)) {
    throw new Error(
      'security gate: no build to run against. Run `npm run build` first — ' +
        '`npm run verify` and `npm run test:d1` both build before this suite.',
    );
  }
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

/**
 * Boot the built Worker.
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.vars] deployment vars (AUTH_SECRET, CF_ACCESS_*, …)
 * @param {(request: Request) => Promise<Response>} [options.outbound] stands in for every
 *   host the Worker calls (Resend, Stripe, Turnstile). Absent = outbound fetch fails.
 */
export async function startBuiltWorker({ vars = {}, outbound } = {}) {
  const config = builtConfig();
  const persist = mkdtempSync(join(tmpdir(), 'minshop-security-'));
  const chunks = [];

  const ratelimits = Object.fromEntries(
    (config.ratelimits ?? []).map((r) => [
      r.name,
      { namespace_id: r.namespace_id, simple: r.simple },
    ]),
  );

  const mf = new Miniflare({
    scriptPath: BUILD,
    modules: true,
    modulesRoot: 'dist/server',
    modulesRules: [{ type: 'ESModule', include: ['**/*.mjs', '**/*.js'] }],
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    d1Databases: Object.fromEntries(
      (config.d1_databases ?? []).map((d) => [d.binding, d.database_name]),
    ),
    r2Buckets: Object.fromEntries(
      (config.r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]),
    ),
    kvNamespaces: Object.fromEntries(
      (config.kv_namespaces ?? []).map((k) => [k.binding, k.binding.toLowerCase()]),
    ),
    ratelimits,
    assets: {
      directory: 'dist/client',
      binding: config.assets?.binding ?? 'ASSETS',
      routerConfig: { has_user_worker: true },
    },
    bindings: vars,
    defaultPersistRoot: persist,
    ...(outbound ? { outboundService: outbound } : {}),
    // Everything the Worker prints. The PII assertions read this, so it is
    // captured rather than inherited — a suite that let it reach the terminal
    // would be asserting on nothing.
    handleRuntimeStdio(stdout, stderr) {
      stdout.on('data', (chunk) => chunks.push(String(chunk)));
      stderr.on('data', (chunk) => chunks.push(String(chunk)));
    },
  });

  const db = await mf.getD1Database(config.d1_databases[0].binding);
  await applyMigrations(db);

  return {
    mf,
    db,
    bucket: (binding = 'BUCKET') => mf.getR2Bucket(binding),
    /**
     * One request to the Worker. Redirects are NOT followed: a gate that
     * answers 303 and a gate that answers 200 are the same to a client that
     * follows, which is the whole question this suite asks.
     */
    fetch(path, init = {}) {
      const url = path.startsWith('http') ? path : `https://store.test${path}`;
      return mf.dispatchFetch(url, { redirect: 'manual', ...init });
    },
    /** Everything the Worker has printed so far. */
    logs: () => chunks.join(''),
    clearLogs: () => {
      chunks.length = 0;
    },
    async dispose() {
      await mf.dispose();
      rmSync(persist, { recursive: true, force: true });
    },
  };
}
