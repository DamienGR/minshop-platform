/**
 * The browser gate (plan, jalon 5).
 *
 * Everything the container contracts cannot see. Those render a component from
 * props and assert on the markup, which is the right shape for a presentation
 * contract and blind to an entire class of defect: no stylesheet is applied, no
 * client script runs, nothing has a width. Accessibility, keyboard order, page
 * zoom, the no-JavaScript path and the compiled design all live on this side.
 *
 * Two projects, because a phone is not a narrow desktop: `isMobile` changes the
 * pointer type, which changes which of a theme's `hover:` affordances a person
 * can reach at all.
 *
 * It is NOT part of `npm run verify`, and that is deliberate rather than
 * budgetary: `verify` is the gate a shop runs on a laptop and in the deploy
 * path, and it must not need a browser download to answer. `npm run
 * test:browser` runs this, and CI gives it its own job per theme.
 *
 * .mjs, like every other test file here that touches Node: tsconfig pins
 * `types` to the Cloudflare types, so a .ts spec would typecheck without
 * `process`.
 */
import { defineConfig, devices } from '@playwright/test';
import { chromiumExecutable } from './test/browser/chromium.mjs';

const PORT = Number(process.env.BROWSER_TEST_PORT ?? 8788);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const executablePath = chromiumExecutable();

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.mjs',
  // The suite drives ONE store. Parallel workers would share its D1 and its
  // cart cookie jar, and the cart specs mutate both.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // A real failure here is deterministic — it is markup, CSS, or an axe rule.
  // A retry would only turn a slow runner into a green run, so there is none.
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // `launchOptions` above carries the executable for both; a device descriptor
  // only describes the viewport, the pointer and the user agent.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: `node test/browser/serve.mjs ${PORT}`,
    url: `${BASE_URL}/api/products?limit=1`,
    // Migrations, two SQL fixtures and two R2 objects before workerd even
    // starts; a cold CI runner needs the room.
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    // The Worker logs a line per request; piping them interleaves hundreds of
    // GETs into the reporter. Errors still come through.
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
