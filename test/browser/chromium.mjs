/**
 * Which Chromium the browser suite drives.
 *
 * Playwright normally answers this itself: `npx playwright install chromium`
 * fetches the exact revision the pinned version was tested against, and the
 * config says nothing. That is what CI does, and it is the path this file
 * leaves alone.
 *
 * It exists for the machine that already has a Chromium and cannot download
 * another — a sandbox with PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD set, a distribution
 * package, a shared image. There, refusing to run is worse than running against
 * a nearby build: every assertion in this suite is about OUR markup and OUR
 * stylesheet, not about a rendering-engine detail that moves between Chromium
 * revisions. It is worth saying out loud when it happens, though, which is why
 * the fallback prints rather than resolving silently.
 *
 * Precedence, highest first:
 *   1. PLAYWRIGHT_CHROMIUM_EXECUTABLE — an explicit path always wins.
 *   2. The pinned revision, if installed — return undefined and let Playwright
 *      pick it, so the normal path stays the normal path.
 *   3. Any other chromium under PLAYWRIGHT_BROWSERS_PATH, loudly.
 *   4. undefined — Playwright then fails with its own "run playwright install"
 *      message, which is the right message.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The binary inside an installed browser directory. */
const BINARY = ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];

function binaryIn(dir) {
  for (const suffix of BINARY) {
    const candidate = join(dir, suffix);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** @returns {string|undefined} an explicit executablePath, or undefined to let Playwright decide */
export function chromiumExecutable(env = process.env, log = console.warn) {
  const explicit = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (explicit) return explicit;

  const root = env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  // No shared browser root means the ordinary per-user install; Playwright
  // knows where that is and this file has nothing to add.
  if (!root || !existsSync(root)) return undefined;

  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }

  // The pinned revision, if it is there. Matched by directory name rather than
  // by asking playwright-core, because the whole point is to not depend on the
  // resolution we are working around.
  const pinned = pinnedRevision();
  if (pinned && entries.includes(`chromium-${pinned}`)) {
    const found = binaryIn(join(root, `chromium-${pinned}`));
    if (found) return undefined; // Playwright will find it on its own.
  }

  // Full Chromium only: the headless shell cannot do what several of these
  // specs need (a real viewport, page zoom, screenshots of chrome-adjacent UI).
  const other = entries
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  for (const name of other) {
    const found = binaryIn(join(root, name));
    if (found) {
      log(
        `browser suite: Chromium ${name.slice(9)} instead of the pinned ${pinned ?? '(unknown)'} — ` +
          `${root} has no pinned build and downloads are disabled here. ` +
          'CI installs the pinned revision; this is the local fallback.',
      );
      return found;
    }
  }
  return undefined;
}

/** The revision playwright-core pins, or null if it cannot be read. */
function pinnedRevision() {
  try {
    const url = new URL('../../node_modules/playwright-core/browsers.json', import.meta.url);
    const { browsers } = JSON.parse(readFileSync(url, 'utf8'));
    return browsers.find((b) => b.name === 'chromium')?.revision ?? null;
  } catch {
    return null;
  }
}
