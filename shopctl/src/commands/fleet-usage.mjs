/**
 * `shopctl fleet usage` — what the shared account has consumed this month,
 * against what Workers Paid includes, and the bill that projects to (ADR 0019,
 * plan §13.1 lot 7).
 *
 * `monitor` asks about ONE shop: its error rate, and on the free plan its daily
 * quotas. On the shared account no shop has a quota of its own — every volume
 * Workers Paid includes is the account's, shared by every Worker on it — and
 * what can go wrong is no longer a shop refused at midnight UTC but a bill
 * that drifts, or an account that reaches its ceiling of crons. Neither is
 * visible from inside one shop, and Cloudflare's notification catalogue has no
 * alert for either on this plan (README of docs/operations, 2026-10-06).
 *
 * So the question is asked of the whole account, once a night, by the fleet:
 *
 *  - every billed volume of the month so far — Workers requests and CPU, D1
 *    rows and storage, R2 operations and storage, KV operations — against
 *    what the plan includes, projected linearly to the end of the month;
 *  - the bill that projection gives, subscription included;
 *  - the Workers invoked this month, each shop's environment being one Worker
 *    with one cron: the ceiling of 250 crons bites first, and the plan aims at
 *    two hundred shops per account.
 *
 * It fails (code 6) when the projected bill passes `--budget`, or when the
 * account carries as many Workers as the plan aims at: the day to open the
 * next account, not the day the 251st cron is refused. A volume past what is
 * included is reported, never failed: it is billed, not blocked.
 *
 * One GraphQL request, read-only, with the monitor's token (Account Analytics:
 * Read). No wrangler: it has nothing to ask about a tree, and runs from any
 * checkout that carries shopctl — the fleet's nightly uses the first shop's.
 *
 * Cloudflare for SaaS hostnames have no analytics dataset either: 100 are
 * included, then 0.10 $ each a month, and each shop in production has one. They
 * are ESTIMATED as one per production Worker invoked this month — a shop not
 * yet on the shared zone overstates the bill, the safe direction.
 *
 * What it does not measure: Workers Logs (no analytics dataset; 20 million
 * events a month are included, then billed from 2026-12-01). The first real
 * run says whether the datasets answer as the double supposes; the command
 * fails loudly when they do not.
 */
import { graphql } from '../analytics.mjs';
import { preconditionError, usageError, verificationError } from '../errors.mjs';

/** Workers Paid, as published on developers.cloudflare.com (relevé du
 *  2026-10-28, ADR 0019). In dollars; a volume per month unless it says GB. */
export const PAID_PLAN = Object.freeze({
  subscription: 5,
  volumes: Object.freeze([
    { key: 'workers.requests', name: 'requêtes Workers', included: 10_000_000, per: 1_000_000, price: 0.3 },
    { key: 'workers.cpuMs', name: 'CPU Workers (ms)', included: 30_000_000, per: 1_000_000, price: 0.02 },
    { key: 'd1.rowsRead', name: 'lignes D1 lues', included: 25_000_000_000, per: 1_000_000, price: 0.001 },
    { key: 'd1.rowsWritten', name: 'lignes D1 écrites', included: 50_000_000, per: 1_000_000, price: 1 },
    { key: 'd1.storageGb', name: 'stockage D1 (Go)', included: 5, per: 1, price: 0.75, stock: true },
    { key: 'r2.classA', name: 'opérations R2 de classe A', included: 1_000_000, per: 1_000_000, price: 4.5 },
    { key: 'r2.classB', name: 'opérations R2 de classe B', included: 10_000_000, per: 1_000_000, price: 0.36 },
    { key: 'r2.storageGb', name: 'stockage R2 (Go)', included: 10, per: 1, price: 0.015, stock: true },
    { key: 'kv.reads', name: 'lectures KV', included: 10_000_000, per: 1_000_000, price: 0.5 },
    { key: 'kv.writes', name: 'écritures KV', included: 1_000_000, per: 1_000_000, price: 5 },
    { key: 'saas.hostnames', name: 'noms d\'hôte SaaS (estimés)', included: 100, per: 1, price: 0.1, stock: true },
  ]),
});

/** One cron per Worker, a `*` /5 in every environment: the plan's ceiling is
 *  250, and the account is meant to stop at two hundred shops. */
export const ACCOUNT_LIMITS = Object.freeze({ crons: 250, target: 200 });

/** R2's operation classes. Deletes and aborts are free; anything not named
 *  here is counted as class A, the dearer one, rather than dropped. */
const R2_CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration']);
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload', 'DeleteObjects']);

export const FLEET_USAGE_OPTIONS = { '--account': 'id', '--budget': 'dollars' };

const USAGE_QUERY = `query Usage($account: String!, $since: Time!, $until: Time!, $sinceDate: Date!, $untilDate: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests cpuTimeUs }
        dimensions { scriptName }
      }
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) {
        sum { rowsRead rowsWritten }
      }
      d1StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) {
        max { databaseSizeBytes }
        dimensions { databaseId }
      }
      r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests }
        dimensions { actionType }
      }
      r2StorageAdaptiveGroups(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        max { payloadSize metadataSize }
        dimensions { bucketName }
      }
      kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $sinceDate, date_leq: $untilDate }) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

const GB = 1_000_000_000;

/** The month so far, in UTC: from its first instant to now, and how much of it
 *  that is — the ratio the projection divides by. */
export function monthWindow(now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const elapsed = Math.max(now.getTime() - since.getTime(), 3_600_000);
  return { since, until: now, elapsedShare: Math.min(1, elapsed / (next.getTime() - since.getTime())) };
}

/**
 * Fold the datasets into one figure per billed volume. Pure.
 *
 * Storage is a stock, not a flow: the largest size seen this month stands for
 * the month's average, which overstates it slightly — the safe direction for a
 * bill.
 */
export function summariseUsage(account) {
  const scripts = new Map();
  for (const group of account?.workersInvocationsAdaptive ?? []) {
    const name = group.dimensions?.scriptName ?? '(inconnu)';
    const entry = scripts.get(name) ?? { name, requests: 0, cpuMs: 0 };
    entry.requests += group.sum?.requests ?? 0;
    entry.cpuMs += (group.sum?.cpuTimeUs ?? 0) / 1000;
    scripts.set(name, entry);
  }
  const workers = [...scripts.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));

  const d1Sizes = new Map();
  for (const group of account?.d1StorageAdaptiveGroups ?? []) {
    const id = group.dimensions?.databaseId ?? '';
    d1Sizes.set(id, Math.max(d1Sizes.get(id) ?? 0, group.max?.databaseSizeBytes ?? 0));
  }
  const r2Sizes = new Map();
  for (const group of account?.r2StorageAdaptiveGroups ?? []) {
    const bucket = group.dimensions?.bucketName ?? '';
    r2Sizes.set(bucket, Math.max(r2Sizes.get(bucket) ?? 0, (group.max?.payloadSize ?? 0) + (group.max?.metadataSize ?? 0)));
  }
  let classA = 0;
  let classB = 0;
  for (const group of account?.r2OperationsAdaptiveGroups ?? []) {
    const action = group.dimensions?.actionType ?? '';
    const count = group.sum?.requests ?? 0;
    if (R2_FREE.has(action)) continue;
    if (R2_CLASS_B.has(action)) classB += count;
    else classA += count;
  }
  let kvReads = 0;
  let kvWrites = 0;
  for (const group of account?.kvOperationsAdaptiveGroups ?? []) {
    const count = group.sum?.requests ?? 0;
    if (group.dimensions?.actionType === 'read') kvReads += count;
    else kvWrites += count;
  }
  const sum = (groups, field) => (groups ?? []).reduce((total, group) => total + (group.sum?.[field] ?? 0), 0);
  const total = (sizes) => [...sizes.values()].reduce((all, size) => all + size, 0);

  return {
    workers: {
      requests: workers.reduce((all, script) => all + script.requests, 0),
      cpuMs: workers.reduce((all, script) => all + script.cpuMs, 0),
      scripts: workers,
    },
    d1: { rowsRead: sum(account?.d1AnalyticsAdaptiveGroups, 'rowsRead'), rowsWritten: sum(account?.d1AnalyticsAdaptiveGroups, 'rowsWritten'), storageGb: total(d1Sizes) / GB },
    r2: { classA, classB, storageGb: total(r2Sizes) / GB },
    kv: { reads: kvReads, writes: kvWrites },
    // A deployed Worker is `<workerName>-<env>` (scripts/manifest.mjs).
    saas: { hostnames: workers.filter((script) => script.name.endsWith('-production')).length },
  };
}

const pick = (usage, key) => key.split('.').reduce((node, part) => node?.[part], usage) ?? 0;

/**
 * The month's bill, projected. Pure, so each price is a test.
 *
 * A flow is projected linearly from the share of the month elapsed; a stock is
 * taken as it stands. Each volume is billed only past what the plan includes,
 * by started unit of nothing: Cloudflare bills fractions, and so does this.
 */
export function projectBill(usage, { elapsedShare, plan = PAID_PLAN }) {
  const lines = plan.volumes.map((volume) => {
    const used = pick(usage, volume.key);
    const projected = volume.stock ? used : used / elapsedShare;
    const over = Math.max(0, projected - volume.included);
    return {
      key: volume.key,
      name: volume.name,
      stock: volume.stock === true,
      used,
      projected,
      included: volume.included,
      share: volume.included > 0 ? projected / volume.included : 0,
      cost: (over / volume.per) * volume.price,
    };
  });
  const overage = lines.reduce((all, line) => all + line.cost, 0);
  return { lines, subscription: plan.subscription, total: plan.subscription + overage };
}

// French figures without Intl: the CLI's output must not depend on the ICU
// data the runner's Node was built with.
const dollars = (amount) => `${amount.toFixed(2).replace('.', ',')} $`;
const quantity = (value) =>
  value >= 1000 ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(Math.round(value * 100) / 100).replace('.', ',');

export async function runFleetUsage(args, reporter) {
  const account = args.values['--account'] ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) throw usageError('fleet usage demande le compte mutualisé.', 'Passez --account <id>, ou posez CLOUDFLARE_ACCOUNT_ID.');
  if (!/^[0-9a-f]{32}$/.test(account)) throw usageError(`« ${account} » n'est pas un identifiant de compte Cloudflare.`);
  const budgetValue = args.values['--budget'];
  const budget = budgetValue === undefined || budgetValue === '' ? null : Number(budgetValue);
  if (budget !== null && !(Number.isFinite(budget) && budget > 0)) throw usageError(`--budget « ${budgetValue} » n'est pas un montant en dollars.`);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw preconditionError(
      'CLOUDFLARE_API_TOKEN est absent.',
      'Le jeton de surveillance du compte mutualisé suffit : « Account Analytics : Read ». En CI, MONITOR_CLOUDFLARE_API_TOKEN du dépôt de flotte.',
    );
  }

  const window = monthWindow();
  reporter.section(`Compte ${account} — du ${window.since.toISOString().slice(0, 10)} à maintenant (${Math.round(window.elapsedShare * 100)} % du mois)`);
  const data = await graphql(USAGE_QUERY, {
    account,
    since: window.since.toISOString(),
    until: window.until.toISOString(),
    sinceDate: window.since.toISOString().slice(0, 10),
    untilDate: window.until.toISOString().slice(0, 10),
  }, token);
  const usage = summariseUsage(data.viewer?.accounts?.[0]);
  const bill = projectBill(usage, { elapsedShare: window.elapsedShare });

  for (const line of bill.lines) {
    const measured = line.stock ? `${quantity(line.used)} au plus haut ce mois` : `${quantity(line.used)} à ce jour, ${quantity(line.projected)} projetés`;
    const text = `${line.name} — ${measured}, sur ${quantity(line.included)} inclus${line.cost > 0 ? `, ${dollars(line.cost)} au-delà` : ''}`;
    if (line.share > 1) reporter.warn(text, 'Facturé, pas bloqué : la facture projetée le compte.');
    else reporter.ok(text);
  }

  reporter.section('Facture projetée');
  const checks = [];
  const overBudget = budget !== null && bill.total > budget;
  checks.push({
    name: 'facture projetée',
    ok: !overBudget,
    judged: budget !== null,
    value: bill.total,
    detail: `${dollars(bill.total)} pour le mois, abonnement de ${dollars(bill.subscription)} compris${budget !== null ? ` (budget ${dollars(budget)})` : ''}`,
  });
  const active = usage.workers.scripts.length;
  checks.push({
    name: 'Workers du compte',
    ok: active < ACCOUNT_LIMITS.target,
    judged: true,
    value: active,
    detail: `${active} Worker(s) invoqué(s) ce mois, un cron chacun : ${ACCOUNT_LIMITS.target} visés par compte, ${ACCOUNT_LIMITS.crons} au plus`,
  });
  for (const check of checks) {
    if (!check.judged) reporter.todo(`${check.name} — ${check.detail}`);
    else if (check.ok) reporter.ok(`${check.name} — ${check.detail}`);
    else reporter.fail(`${check.name} — ${check.detail}`);
  }

  if (usage.workers.scripts.length > 0) {
    reporter.section('Les plus actifs');
    for (const script of usage.workers.scripts.slice(0, 5)) {
      reporter.step(`    ${script.name} — ${quantity(script.requests)} requête(s), ${quantity(script.cpuMs)} ms de CPU`);
    }
  }

  const failures = checks.filter((check) => !check.ok);
  reporter.result({
    command: 'fleet usage',
    ok: failures.length === 0,
    account,
    window: { since: window.since.toISOString(), until: window.until.toISOString(), elapsedShare: window.elapsedShare },
    usage,
    bill,
    budget,
    checks,
  });
  if (failures.length > 0) {
    throw verificationError(
      `${failures.map((check) => check.name).join(', ')} : seuil franchi sur le compte mutualisé.`,
      overBudget
        ? 'Lisez les plus actifs ci-dessus : la dérive a une boutique. Le budget se règle par --budget (variable MINSHOP_MONTHLY_BUDGET du dépôt de flotte).'
        : 'Le compte porte les boutiques qu\'il vise : la suivante s\'ouvre sur un second compte, sur le même modèle (ADR 0019).',
    );
  }
  return 0;
}
