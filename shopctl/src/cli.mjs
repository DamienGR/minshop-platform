/**
 * Argument parsing and dispatch.
 *
 * Hand-written, like everything else on the critical path of this repository's
 * gates. `node:util`'s parseArgs would do most of it, but not the part that
 * matters: an UNKNOWN flag has to be a hard error. A CLI that silently ignores
 * `--jsno` answers a different question than the one asked, and the caller —
 * a CI job, a fleet script — reads the answer as if it had been asked properly.
 *
 * Every command is a function of (parsed arguments, reporter) that returns an
 * exit code or throws a ShopctlError. Nothing calls process.exit() except the
 * entry point, which keeps the commands testable in-process.
 */
import { EXIT_CODES, ShopctlError, usageError } from './errors.mjs';
import { Reporter } from './report.mjs';
import { assertNoCredentialsInArgv } from './secrets.mjs';
import { NEW_OPTIONS, newUsage, runNew } from './commands/new.mjs';
import { doctorUsage, runDoctor } from './commands/doctor.mjs';
import { configUsage, runConfig } from './commands/config.mjs';
import { CATALOG_OPTIONS, catalogUsage, runCatalog } from './commands/catalog.mjs';
import { PROVISION_OPTIONS, provisionUsage, runProvision } from './commands/provision.mjs';
import { DEPLOY_OPTIONS, deployUsage, runDeploy } from './commands/deploy.mjs';
import { REPO_OPTIONS, repoUsage, runRepo } from './commands/repo.mjs';

export const usage = `shopctl — création et exploitation des boutiques Minshop.

Usage: shopctl <commande> [options]

  new <slug>          Créer le dépôt d'une boutique depuis un tag du socle
  doctor              Vérifier outils, arbre courant et prérequis
  config validate     Valider les manifestes de l'arbre courant
  catalog             Valider et importer le catalogue produit (CSV)
  repo                Créer le dépôt GitHub, ses environnements et leurs secrets
  provision           Créer ou confirmer les ressources Cloudflare d'un environnement
  deploy              Vérifier, migrer, construire, téléverser et tester la boutique

Options globales:
  --json              Sortie machine sur stdout (la progression passe sur stderr)
  -h, --help          Cette aide, ou celle d'une commande
  -v, --version       Version du socle qui livre cette CLI

Les commandes de sauvegarde et de flotte sont décrites au plan §5 et arrivent
aux jalons suivants.
`;

/** @type {Record<string, { run: Function, usage: string, values: Record<string,string>, flags: string[] }>} */
export const COMMANDS = {
  new: { run: runNew, usage: newUsage, values: NEW_OPTIONS, flags: ['--no-install', '--no-verify', '--create-repo'] },
  doctor: { run: runDoctor, usage: doctorUsage, values: {}, flags: ['--offline'] },
  config: { run: runConfig, usage: configUsage, values: {}, flags: [] },
  catalog: {
    run: runCatalog,
    usage: catalogUsage,
    values: CATALOG_OPTIONS,
    flags: ['--dry-run', '--remote', '--create-categories', '--allow-slug-change', '--allow-remove-variants'],
  },
  repo: { run: runRepo, usage: repoUsage, values: REPO_OPTIONS, flags: ['--dry-run', '--public', '--no-push'] },
  provision: { run: runProvision, usage: provisionUsage, values: PROVISION_OPTIONS, flags: ['--dry-run'] },
  deploy: {
    run: runDeploy,
    usage: deployUsage,
    values: DEPLOY_OPTIONS,
    flags: ['--dry-run', '--yes', '--skip-verify', '--skip-build', '--skip-smoke'],
  },
};

/** Flags every command accepts. */
const GLOBAL_FLAGS = ['--json'];

/**
 * Split a command's arguments into positionals and values.
 *
 * @param {string[]} argv arguments after the command name
 * @param {{ values: Record<string,string>, flags: string[] }} spec
 * @returns {{ positionals: string[], values: Record<string, string|boolean> }}
 */
export function parseArguments(argv, spec) {
  const values = {};
  const positionals = [];
  const booleans = new Set([...spec.flags, ...GLOBAL_FLAGS]);
  const expectsValue = new Set(Object.keys(spec.values));

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }

    const eq = argument.indexOf('=');
    const name = eq === -1 ? argument : argument.slice(0, eq);
    const inline = eq === -1 ? null : argument.slice(eq + 1);

    if (booleans.has(name)) {
      if (inline !== null) throw usageError(`${name} takes no value.`);
      values[name] = true;
      continue;
    }
    if (expectsValue.has(name)) {
      const value = inline ?? argv[index + 1];
      // A missing value silently swallowing the NEXT flag is the classic way a
      // CLI ends up creating a shop named "--no-install".
      if (value == null || (inline === null && value.startsWith('-'))) {
        throw usageError(`${name} requires a value.`);
      }
      values[name] = value;
      if (inline === null) index += 1;
      continue;
    }
    throw usageError(`unknown option "${name}".`);
  }

  return { positionals, values };
}

/**
 * Run one invocation.
 *
 * Async because ONE command needs it — `deploy` ends with a smoke test, which
 * is network I/O — and the alternative was worse: a synchronous command that
 * drained a promise through a subprocess, so that the other five could keep a
 * signature none of them was using. A command may still return a plain number;
 * `await` on a number is a number.
 *
 * @param {string[]} argv arguments after `node shopctl`
 * @param {{ version: string, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} context
 * @returns {Promise<number>} exit code
 */
export async function main(argv, { version, stdout = process.stdout, stderr = process.stderr }) {
  const json = argv.includes('--json');
  const reporter = new Reporter({ json, stdout, stderr });

  try {
    assertNoCredentialsInArgv(argv);

    const [name, ...rest] = argv.filter((argument) => argument !== '--json');
    if (!name || name === '-h' || name === '--help') {
      stdout.write(usage);
      return EXIT_CODES.ok;
    }
    if (name === '-v' || name === '--version') {
      stdout.write(`${version}\n`);
      return EXIT_CODES.ok;
    }

    const command = COMMANDS[name];
    if (!command) throw usageError(`unknown command "${name}".`, usage.trim());
    if (rest.includes('-h') || rest.includes('--help')) {
      stdout.write(command.usage);
      return EXIT_CODES.ok;
    }

    const args = parseArguments(rest, command);
    if (json) args.values['--json'] = true;
    return (await command.run(args, reporter)) ?? EXIT_CODES.ok;
  } catch (error) {
    return report(error, reporter, stderr);
  }
}

function report(error, reporter, stderr) {
  if (error instanceof ShopctlError) {
    stderr.write(`shopctl: ${error.message}\n`);
    if (error.hint) stderr.write(`${error.hint}\n`);
    if (reporter.json && !reporter.emitted) {
      reporter.result({ ok: false, error: { kind: error.kind, code: error.code, message: error.message, hint: error.hint, details: error.details } });
    }
    return error.code;
  }
  // Anything else is a bug in shopctl rather than a state the operator can fix,
  // so it keeps its stack: hiding it would only make the report harder to file.
  stderr.write(`shopctl: unexpected failure\n${error?.stack ?? error}\n`);
  return EXIT_CODES.external;
}
