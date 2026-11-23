// __GENERATED__
//
// What the fleet's workflows ask of fleet.json and of a shop's tree, in one
// place rather than inline in each job. No dependency: it runs before any
// `npm ci`, on whatever Node the runner has.
//
//   node .github/fleet/shops.mjs repository <slug>   repository=<owner/repo>
//   node .github/fleet/shops.mjs matrix [slug]       matrix=[{ slug, repository, since? }],
//                                                    one shop when a slug is given
//   node .github/fleet/shops.mjs core <dir> [report] refuses a shop below the floor —
//                                                    the quarterly report's, with `report`
//   node .github/fleet/shops.mjs report <name> <status>
//                                  the part of a shopctl report a run may publish
//
// Every line the first three print to stdout is a `key=value` for
// $GITHUB_OUTPUT; anything else goes to stderr as a workflow command. `report`
// writes for the log instead, and exits with the status it was given.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The oldest core that carries the owner marker of ADR 0019. */
const MINIMUM_CORE = '__MINIMUM_CORE__';

/** The oldest core whose shopctl writes the quarterly report (ADR 0035). */
const REPORT_MINIMUM_CORE = '__REPORT_MINIMUM_CORE__';

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function stop(message) {
  process.stderr.write(`::error::${message}\n`);
  process.exit(1);
}

function registry() {
  let document;
  try {
    document = JSON.parse(readFileSync(new URL('../../fleet.json', import.meta.url), 'utf8'));
  } catch (error) {
    stop(`fleet.json illisible : ${error.message}`);
  }
  if (!Array.isArray(document?.shops)) stop('fleet.json ne déclare aucune boutique (shops).');
  return document.shops;
}

/** A shop the workflows can reach: a valid slug and a repository to check out. */
function reachable(entry) {
  return SLUG.test(String(entry?.slug ?? '')) && REPOSITORY.test(String(entry?.repository ?? ''));
}

const numbers = (version) => String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
function below(version, floor) {
  const [a, b] = [numbers(version), numbers(floor)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) < (b[index] ?? 0);
  }
  return false;
}

// ── report ───────────────────────────────────────────────────────────────────
//
// The fleet repository is public (ADR 0019): anyone reads its logs, and any
// GitHub account downloads its artifacts, for 30 to 90 days. A shopctl report
// says more than that audience should read: every table's row count, `orders`
// and `refunds` included, twice a night and per shop; the traffic `monitor`
// measures; the account's id, which GitHub masks in a log and never in an
// artifact. So a job writes the JSON and the prose to files on the runner, and
// this decides what leaves it — field by field, never the document minus a
// list, because a field shopctl adds tomorrow must stay private by default:
//
//   - the outcome, and the names of the checks that did not pass;
//   - what an incident starts from: the archive, the Time Travel bookmark and
//     the version to roll back to (docs/operations/runbooks/);
//   - when the command failed, its own error and every prose line but the ✓
//     ones: the ✗ and ! lines diagnose it. Their detail may quote a number;
//     a failure is the one run where it is worth reading.
//
// `<name>.summary.json` is what the job uploads; the same lines go to the log.

/** Fields a summary keeps, per shopctl command: [label, path in the report]. */
const KEPT = {
  deploy: [['origine', ['origin']], ['archive', ['backup', 'id']], ['bookmark', ['bookmark']], ['rollbackTo', ['rollbackTo']]],
  backup: [['archive', ['id']]],
  'backup verify': [['archive', ['id']]],
  // The quarter and the issue: the report itself states the shop's sales.
  report: [['trimestre', ['period', 'key']], ['issue', ['issue', 'url']]],
};

const at = (document, path) => path.reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), document);
const scalar = (value) => (typeof value === 'string' || typeof value === 'number' ? value : null);

function report(name, given) {
  if (!/^[a-z0-9-]+$/.test(String(name ?? ''))) stop(`nom de rapport invalide : ${name ?? '(aucun)'}.`);
  const status = Number.parseInt(given ?? '', 10);
  if (!Number.isInteger(status) || status < 0) stop(`statut de sortie invalide : ${given ?? '(aucun)'}.`);

  let document = null;
  try {
    document = JSON.parse(readFileSync(`${name}.json`, 'utf8'));
  } catch {
    // A command that died before its report: the status and the prose say why.
  }
  const summary = { report: name, status, ok: status === 0 && document?.ok !== false };
  for (const key of ['command', 'shop', 'env']) {
    const value = scalar(document?.[key]);
    if (value !== null) summary[key] = value;
  }
  for (const [label, path] of KEPT[summary.command] ?? []) {
    const value = scalar(at(document, path));
    if (value !== null) summary[label] = value;
  }
  const failed = (Array.isArray(document?.checks) ? document.checks : [])
    .filter((check) => check && check.ok === false)
    .map((check) => scalar(check.name))
    .filter(Boolean);
  if (failed.length > 0) summary.failed = failed;
  const error = document?.error;
  if (error && typeof error === 'object') {
    summary.error = {};
    for (const key of ['kind', 'code', 'message', 'hint']) {
      const value = scalar(error[key]);
      if (value !== null) summary.error[key] = value;
    }
  }
  writeFileSync(`${name}.summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

  const lines = [`${summary.command ?? name}${summary.shop ? ` ${summary.shop}` : ''}${summary.env ? ` (${summary.env})` : ''} : ${summary.ok ? 'réussi' : `en échec, statut ${status}`}`];
  for (const [label] of KEPT[summary.command] ?? []) if (summary[label]) lines.push(`  ${label} : ${summary[label]}`);
  if (summary.failed) lines.push(`  contrôles en échec : ${summary.failed.join(', ')}`);
  if (!summary.ok) {
    if (summary.error?.message) lines.push(`  ${summary.error.message}`);
    if (summary.error?.hint) lines.push(`  ${summary.error.hint}`);
    const prose = existsSync(`${name}.log`) ? readFileSync(`${name}.log`, 'utf8').split('\n') : [];
    let shown = true;
    const kept = prose.filter((line) => {
      // A ✓ line and its indented hint stay on the runner, even on failure.
      if (line.startsWith('✓')) shown = false;
      else if (!line.startsWith('    ')) shown = true;
      return shown && line.trim() !== '';
    });
    if (kept.length > 0) lines.push('', ...kept);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(status);
}

const [command, argument, extra] = process.argv.slice(2);

if (command === 'repository') {
  const shop = registry().find((entry) => entry?.slug === argument);
  if (!shop) stop(`« ${argument} » n'est pas une boutique de fleet.json.`);
  if (!reachable(shop)) stop(`« ${argument} » n'a pas de dépôt (repository: propriétaire/dépôt) dans fleet.json.`);
  process.stdout.write(`repository=${shop.repository}\n`);
} else if (command === 'matrix') {
  let shops = registry();
  if (argument) {
    shops = shops.filter((entry) => entry?.slug === argument);
    if (shops.length === 0) stop(`« ${argument} » n'est pas une boutique de fleet.json.`);
  }
  for (const entry of shops.filter((candidate) => !reachable(candidate))) {
    process.stderr.write(`::warning::${String(entry?.slug ?? '(sans slug)')} : pas de dépôt dans fleet.json, ni sauvegardée ni surveillée par la flotte.\n`);
  }
  const matrix = shops.filter(reachable).map((entry) => {
    // The start of the quarterly report's follow-up (ADR 0035). Checked
    // again by shopctl, which refuses a date that is not one.
    const since = entry.reportSince;
    if (since !== undefined && !DAY.test(String(since))) {
      process.stderr.write(`::warning::${entry.slug} : reportSince « ${String(since)} » n'est pas une date AAAA-MM-JJ ; le rapport couvre le trimestre entier.\n`);
    }
    return { slug: entry.slug, repository: entry.repository, ...(DAY.test(String(since ?? '')) ? { since } : {}) };
  });
  process.stdout.write(`matrix=${JSON.stringify(matrix)}\n`);
} else if (command === 'core') {
  let version;
  try {
    version = JSON.parse(readFileSync(join(argument ?? '.', 'package.json'), 'utf8')).version;
  } catch (error) {
    stop(`version du socle illisible dans ${argument} : ${error.message}`);
  }
  if (below(version, MINIMUM_CORE)) {
    stop(`la boutique est sur le socle ${version} ; le compte mutualisé demande ${MINIMUM_CORE} au moins, qui marque chaque base à sa boutique (ADR 0019). Montez-la (shopctl core upgrade) avant de la déployer ou de la sauvegarder d'ici.`);
  }
  if (extra === 'report' && below(version, REPORT_MINIMUM_CORE)) {
    stop(`la boutique est sur le socle ${version} ; le rapport trimestriel demande ${REPORT_MINIMUM_CORE} au moins, dont la CLI l'écrit (ADR 0035). Montez-la (shopctl core upgrade).`);
  } else if (extra !== undefined && extra !== 'report') {
    stop(`plancher inconnu : ${extra}. Attendu : report, ou rien.`);
  }
  process.stdout.write(`core=${version}\n`);
} else if (command === 'report') {
  report(argument, extra);
} else {
  stop(`commande inconnue : ${command ?? '(aucune)'}. Attendu : repository, matrix, core ou report.`);
}
