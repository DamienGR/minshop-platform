/**
 * `shopctl config validate` — the manifest gate, through the CLI.
 *
 * A WRAPPER, deliberately. `scripts/check-manifest.mjs` already validates every
 * manifest in a tree, refuses two shops on one resource identifier, checks the
 * published schema for drift and scans the core for client values; `npm run
 * config:validate` is what CI runs. Reimplementing any of that here would give
 * the fleet two answers to the same question, and the operator believes the CLI.
 *
 * So this resolves WHICH tree to validate and hands over. The tree is the
 * working directory when it is a shop or the core itself, which is what lets
 * the same command run in CI and on a merchant's checkout.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CORE_ROOT } from '../paths.mjs';
import { preconditionError, usageError, verificationError } from '../errors.mjs';
import { capture } from '../process.mjs';

export const configUsage = `Usage: shopctl config validate [--json]

Valide les manifestes de l'arbre courant : champs, règles inter-champs,
identifiants de flotte uniques, dérive du schéma publié, neutralité du cœur.
Enveloppe \`npm run config:validate\` — une seule autorité, celle de la CI.
`;

/** The tree whose manifests are being validated: a shop, or the core. */
export function resolveTree(cwd = process.cwd()) {
  if (existsSync(resolve(cwd, 'client/client.yaml'))) return { root: cwd, kind: 'shop' };
  if (existsSync(resolve(cwd, 'scripts/check-manifest.mjs'))) return { root: cwd, kind: 'core' };
  throw preconditionError(
    `${cwd} is neither a shop (no client/client.yaml) nor a core checkout.`,
    'Run this from the root of a shop repository, or from the core.',
  );
}

export function runConfig(args, reporter) {
  const [subcommand, ...extra] = args.positionals;
  if (subcommand !== 'validate') {
    throw usageError(
      subcommand ? `unknown subcommand "config ${subcommand}".` : 'shopctl config needs a subcommand.',
      configUsage.trim(),
    );
  }
  if (extra.length > 0) throw usageError(`config validate takes no argument; got "${extra.join('", "')}".`);

  const tree = resolveTree();
  const script = resolve(tree.root, 'scripts/check-manifest.mjs');
  // A shop validates with the tooling IT carries, not with whatever core
  // happens to host this CLI: the gate a shop passes must be the gate its own
  // core version defines, or an upgrade would be validated by the version it
  // has not merged yet.
  const gate = existsSync(script) ? script : resolve(CORE_ROOT, 'scripts/check-manifest.mjs');
  const result = capture('node', [gate, ...(args.values['--json'] === true ? ['--json'] : [])], {
    cwd: tree.root,
    allowFailure: true,
  });

  if (args.values['--json'] === true) {
    // The gate already speaks JSON; relaying its document unchanged keeps one
    // schema for one answer instead of wrapping it in a second one.
    reporter.relay(result.stdout);
    if (result.status !== 0) throw verificationError('les manifestes ne passent pas la porte de validation.');
    return 0;
  }

  reporter.prose.write(result.stdout);
  if (result.stderr) reporter.prose.write(result.stderr);
  if (result.status !== 0) {
    throw verificationError(
      'les manifestes ne passent pas la porte de validation.',
      `Même contrôle que \`npm run config:validate\` dans ${tree.root}.`,
    );
  }
  return 0;
}
