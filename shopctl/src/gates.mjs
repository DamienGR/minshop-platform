/**
 * The two gates a shop must pass on its own, run through the shop's own copy.
 *
 * `shopctl new` runs them on a shop it has just written; `shopctl core upgrade`
 * runs them on a shop it has just merged a core version into. Same pair, same
 * order, one implementation — a second copy would eventually check a different
 * thing in the two places a shop is produced, and the operator believes
 * whichever ran last.
 *
 * They are run from the SHOP's tree, with the SHOP's scripts (ADR 0009: wrap,
 * never reimplement). After an upgrade that matters twice over: the gate a shop
 * passes must be the gate its new core version defines, not the one the host
 * CLI happens to carry.
 *
 * Deliberately not `npm run verify`: these two need no `node_modules` and take
 * under a second, so they can run on every shop of a fleet. The full campaign
 * belongs to the shop's own CI, which the pull request an upgrade opens is what
 * triggers.
 */
import { capture } from './process.mjs';

/**
 * Run the manifest gate and the ownership gate.
 *
 * @param {string} root shop tree
 * @returns {{ checks: Array<{ check: string, ok: boolean, status: number }>, manifest: object, paths: object, ok: boolean }}
 */
export function runShopGates(root) {
  // --json on the manifest gate, because its report is structured and the
  // callers need to tell two very different failures apart.
  const manifest = capture('node', ['scripts/check-manifest.mjs', '--json'], { cwd: root, allowFailure: true });
  const paths = capture('node', ['scripts/check-paths.mjs'], { cwd: root, allowFailure: true });
  const checks = [
    { check: 'manifeste', ok: manifest.status === 0, status: manifest.status },
    { check: 'propriété des chemins', ok: paths.status === 0, status: paths.status },
  ];
  return { checks, manifest, paths, ok: checks.every((check) => check.ok) };
}

/**
 * The core-change gate the upgrade's pull request will meet (ticket #86).
 *
 * `runShopGates` asks whether the tree is sound; this asks what the File
 * ownership job of the pull request will decide, which is a different question
 * with a different answer. A core file the shop had edited and the release
 * edited too comes out of the merge as neither's copy, so it is a core change
 * nobody has approved yet (ADR 0003) — and the upgrade used to say ✓ before CI
 * said ✗ on it, on the two demonstration shops' first upgrades.
 *
 * The SHOP's own script, `--changed --base` the branch the step started from,
 * exactly as CI runs it. Without MINSHOP_CORE_CHANGE: in CI it comes from the
 * pull request's label, which does not exist yet, and an operator's shell that
 * carried it would turn the answer into the one CI will not give.
 *
 * @param {string} root shop tree
 * @param {string} base the branch the upgrade started from
 * @returns {{ evaluated: boolean, core: string[], approved: string|null, reason: string|null }}
 */
export function runCoreChangeGate(root, base, env = process.env) {
  const { MINSHOP_CORE_CHANGE: _label, ...childEnv } = env;
  const result = capture('node', ['scripts/check-paths.mjs', '--changed', '--base', base, '--json'], {
    cwd: root,
    allowFailure: true,
    env: childEnv,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  const gate = report?.gate;
  if (!gate) {
    const reason = (result.stderr || result.stdout).trim().split('\n')[0] || `code ${result.status}`;
    return { evaluated: false, core: [], approved: null, reason };
  }
  return { evaluated: true, core: gate.enforced === false ? [] : (gate.core ?? []), approved: gate.approved?.by ?? null, reason: null };
}

/**
 * The first lines worth showing from a gate that failed.
 *
 * The manifest gate answers in JSON, so its raw stdout is a document rather
 * than a message: printing it verbatim buries the one sentence that says what
 * is wrong under forty lines of schema state. Read the document instead, and
 * fall back to the text only for the gates that speak text.
 */
export function describeGateFailure(gate) {
  const report = (() => {
    try {
      return JSON.parse(gate.stdout);
    } catch {
      return null;
    }
  })();
  const collisions = report?.coreNeutrality?.findings ?? [];
  if (collisions.length > 0) return `le cœur nomme déjà "${collisions[0].value}" (${collisions[0].path})`;
  if (report) {
    const failures = (report.manifests ?? [])
      .filter((entry) => (entry.errors ?? []).length > 0)
      .flatMap((entry) => entry.errors.map((error) => `${entry.file} : ${error.path} ${error.message}`));
    const collided = (report.collisions ?? []).map((claim) => `${claim.kind} « ${claim.value} » réclamé par ${claim.files.join(' et ')}`);
    const lines = [...failures, ...collided];
    if (lines.length > 0) return lines.slice(0, 4).join('\n    ');
  }
  return (gate.stderr || gate.stdout).trim().split('\n').slice(0, 6).join('\n    ');
}
