import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * Astro makes a route of every file under src/pages whose name does not start
 * with `_`, and a test is no exception: `src/pages/sitemap.xml.test.ts` was
 * built as `/sitemap.xml.test` from v0.1.0 to v0.10.0. The route answered 500,
 * since `describe` throws outside a vitest run, and it carried vitest and chai
 * into every shop's Worker — 126 KiB gzipped, an eighth of the bundle budget
 * (`scripts/check-deploy.mjs`).
 *
 * The test of a route's logic lives beside that logic under src/features/,
 * which the route imports (`features/seo/sitemap.ts` is the example).
 */
const root = resolve(import.meta.dirname, '../..');
const pagesDir = join(root, 'src/pages');

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

describe('src/pages', () => {
  it('holds no test file, which Astro would build into a public route', () => {
    const tests = filesUnder(pagesDir)
      .filter((path) => TEST_FILE.test(path))
      .map((path) => relative(root, path));
    expect(tests).toEqual([]);
  });

  // The pattern is what stands between a stray test and a route: prove it
  // still catches the file it was written for, and leaves routes alone.
  it('recognises a test file and nothing else', () => {
    expect(TEST_FILE.test('src/pages/sitemap.xml.test.ts')).toBe(true);
    expect(TEST_FILE.test('src/pages/api/checkout.spec.mjs')).toBe(true);
    expect(TEST_FILE.test('src/pages/sitemap.xml.ts')).toBe(false);
    expect(TEST_FILE.test('src/pages/products/[slug].astro')).toBe(false);
  });
});
