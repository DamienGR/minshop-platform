/**
 * A deployed shop, as the remote gates see it.
 *
 * The local gates boot the built Worker; these talk to an origin that exists —
 * the staging of the certification campaign, or a production after a deploy.
 * Everything they need comes from the environment and nothing from an
 * argument, for the reason shopctl refuses credential-shaped arguments: an
 * argument is already in the shell history and the CI log.
 *
 *   BASE_URL                  the shop's origin, e.g. https://preview.example.fr
 *   CF_ACCESS_CLIENT_ID       a Cloudflare Access service token, when the
 *   CF_ACCESS_CLIENT_SECRET   origin is a private preview (ADR 0015)
 *
 * Behind Access, the service token is what gets a request past the edge to the
 * Worker, so every request carries it unless told otherwise. "Anonymous" then
 * means anonymous to the Worker's OWN gate — the admin password — and that is
 * the property worth asserting: a service token is a valid Access identity,
 * and an admin guarded by Access alone, with no password, lets it in. The
 * security gate reports that as the failure it is.
 */

export function remoteTarget(env = process.env) {
  const raw = env.BASE_URL;
  if (!raw) {
    throw new Error('BASE_URL est obligatoire : l\'origine de la boutique déployée, par exemple https://preview.example.fr.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`BASE_URL « ${raw} » n'est pas une URL.`);
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error(`BASE_URL doit être en https (reçu ${url.protocol}).`);
  }
  const id = env.CF_ACCESS_CLIENT_ID ?? '';
  const secret = env.CF_ACCESS_CLIENT_SECRET ?? '';
  if (Boolean(id) !== Boolean(secret)) {
    throw new Error('CF_ACCESS_CLIENT_ID et CF_ACCESS_CLIENT_SECRET vont ensemble.');
  }
  const accessHeaders = id ? { 'cf-access-client-id': id, 'cf-access-client-secret': secret } : {};
  return { origin: url.origin, accessHeaders, behindAccess: Boolean(id) };
}

/**
 * One request against the target. `redirect: 'manual'`, because a redirect is
 * an answer the gates read; a 20-second ceiling, because a hung request is a
 * failure, not a wait.
 */
export async function fetchAs(target, path, { access = true, headers = {}, ...init } = {}) {
  const started = performance.now();
  const response = await fetch(new URL(path, target.origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    ...init,
    headers: { 'user-agent': 'minshop-remote-gate', ...(access ? target.accessHeaders : {}), ...headers },
  });
  return Object.assign(response, { elapsed: performance.now() - started });
}

/** Cloudflare Access answering instead of the Worker: a login redirect. */
export function isAccessChallenge(response) {
  const location = response.headers.get('location') ?? '';
  return response.status >= 300 && response.status < 400 && /cloudflareaccess\.com/.test(location);
}

// `node test/remote/target.mjs`: check the environment before a run that would
// otherwise fail on its first request — what `npm run test:browser:remote`
// does before handing over to Playwright.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const target = remoteTarget();
    console.log(`cible : ${target.origin}${target.behindAccess ? ' (jeton de service Access)' : ''}`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
