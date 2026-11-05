/**
 * One temporary root for the whole unit run, emptied when the run ends
 * (ticket #184).
 *
 * The suites build real trees under `os.tmpdir()` — a core committed and
 * tagged, shops cloned from it, bare remotes, provisioned shops — and nothing
 * removed them: a run left about 4 GB behind, and every `verify` (so every
 * `shopctl deploy` that verifies) added as much. On a machine whose /tmp is a
 * tmpfs or carries a quota, `verify` then failed on disk space before it failed
 * on anything it tests, as a row of red tests that named no cause.
 *
 * Vitest runs this file in its main process before it starts a worker, and a
 * worker inherits the main process's environment: setting TMPDIR here moves
 * every `tmpdir()` a test calls, and every process a test starts (shopctl, git,
 * the wrangler double) inherits it in turn. A test that fails halfway leaves
 * its trees here too, and they go with the root.
 *
 * `scratch.mjs` keeps the PEAK down by removing a test's directory when the
 * test ends; this file is the net under it, and the line it prints says how
 * much the net caught — a figure that grows is a suite that stopped cleaning
 * up. `MINSHOP_KEEP_TEST_TMP=1` keeps the root, to look at what a failed test
 * left.
 */
import { lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The variables `os.tmpdir()` reads, POSIX first. */
const TEMP_VARIABLES = ['TMPDIR', 'TMP', 'TEMP'];

/** Bytes under `path`, symbolic links counted as themselves. */
function sizeOf(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return 0;
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((total, name) => total + sizeOf(join(path, name)), stat.size);
}

/** What the run left, by the prefix `mkdtemp` was given: `shopctl-fleet-Ab12cd` counts as `shopctl-fleet-`. */
export function leftovers(root) {
  const groups = new Map();
  for (const name of readdirSync(root)) {
    const prefix = name.replace(/[A-Za-z0-9]{6}$/, '');
    const group = groups.get(prefix) ?? { prefix, entries: 0, bytes: 0 };
    group.entries += 1;
    group.bytes += sizeOf(join(root, name));
    groups.set(prefix, group);
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function setup() {
  const previous = Object.fromEntries(TEMP_VARIABLES.map((name) => [name, process.env[name]]));
  const root = mkdtempSync(join(tmpdir(), 'minshop-tests-'));
  for (const name of TEMP_VARIABLES) process.env[name] = root;

  return function teardown() {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const groups = leftovers(root);
    const entries = groups.reduce((total, group) => total + group.entries, 0);
    const bytes = groups.reduce((total, group) => total + group.bytes, 0);
    const largest = groups.slice(0, 3).map((group) => `${group.prefix} ${group.entries} (${megabytes(group.bytes)})`).join(', ');
    const keep = process.env.MINSHOP_KEEP_TEST_TMP === '1';
    console.log(
      `temporary files: ${entries} left by the suites, ${megabytes(bytes)}${largest ? ` — ${largest}` : ''}; ` +
        (keep ? `kept in ${root}` : `removed with ${root}`),
    );
    if (!keep) rmSync(root, { recursive: true, force: true });
  };
}
