/**
 * A temporary directory that belongs to the test that made it (ticket #184).
 *
 * The run's root (`temp-root.mjs`) catches everything at the end, but the end
 * is too late for the disk: `fleet.test.mjs` alone built forty-odd agency
 * workspaces of about seventy megabytes each, and kept every one until its
 * last test. Made inside a test, the directory goes when that test ends,
 * passed or failed, so a suite holds one workspace at a time.
 *
 * Made anywhere else — a `beforeAll`, a describe body, a fixture memoized for
 * the file — it is left to the root: it outlives the test that happened to
 * build it on purpose, and removing it there would pull it from under the next.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

export function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  } catch {
    // Not inside a test: the run's root removes it.
  }
  return dir;
}
