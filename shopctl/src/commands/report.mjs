/**
 * `shopctl report --env production` — the quarterly report of one shop, for
 * its merchant (ADR 0035).
 *
 * Four sources, each optional, each read-only:
 *
 *   Ventes            the production D1, aggregates only (quarterly/sales.mjs)
 *   Évolutions        the shop's git history and the core's release notes
 *                     (quarterly/history.mjs)
 *   Référencement     Google Search Console (quarterly/search-console.mjs)
 *   Fréquentation     Umami, the site the shop's settings name (quarterly/umami.mjs)
 *
 * A source that cannot be read never stops the report: it is said in its
 * section and in the run's prose, and the report goes out with the others —
 * the agency reads every report before sending it. A source that is not
 * connected (no Google key, a shop that does not measure) is said as such,
 * and is not a failure.
 *
 * What it writes: with `--out`, `rapport.md` and `rapport.json`; with
 * `--publish`, the quarter's issue in the shop's repository. The fleet's
 * Quarterly report workflow runs it for every shop of fleet.json on the 5th
 * of January, April, July and October (shopctl/templates/fleet/report.yml).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ShopctlError, preconditionError, usageError } from '../errors.mjs';
import { openEnvironment } from '../environment.mjs';
import { originUrl, parseGithubRemote } from '../forge.mjs';
import { corePackage } from '../paths.mjs';
import { Reporter } from '../report.mjs';
import { requireEnvironment, resolveShop } from '../shop.mjs';
import { query } from '../backup/store.mjs';
import { resolvePeriod } from '../quarterly/period.mjs';
import { readHistory } from '../quarterly/history.mjs';
import { SETTINGS_SQL, readSettings, salesStatements, summariseSales, titleIndex, titlesSql } from '../quarterly/sales.mjs';
import { readSearch } from '../quarterly/search-console.mjs';
import { readAudience } from '../quarterly/umami.mjs';
import { issueTitle, renderReport } from '../quarterly/render.mjs';
import { checkDestination, publishIssue } from '../quarterly/publish.mjs';

export const REPORT_OPTIONS = {
  '--env': 'environnement',
  '--shop': 'slug',
  '--account': 'id',
  '--quarter': 'AAAA-Tn',
  '--since': 'AAAA-MM-JJ',
  '--out': 'répertoire',
  '--repository': 'propriétaire/dépôt',
};
export const REPORT_FLAGS = ['--current', '--publish'];

export const reportUsage = `Usage: shopctl report --env production [options]

Rapport trimestriel d'une boutique pour son commerçant (ADR 0035) : ventes,
évolutions de la boutique, référencement (Google Search Console) et
fréquentation (Umami), puis un message prêt à copier dans un courriel.
Lecture seule partout ; une source illisible ou non raccordée est dite dans
sa section, et le rapport sort avec les autres.

  --env production        Obligatoire : le rapport lit la production.
  --quarter <AAAA-Tn>     Trimestre civil terminé (2026-T4). Défaut : le
                          trimestre écoulé, dans le fuseau de la boutique.
  --current               Le trimestre en cours, jusqu'à aujourd'hui : un aperçu.
  --since <AAAA-MM-JJ>    Début du suivi : rien d'antérieur n'est rapporté
                          (« reportSince » de fleet.json).
  --out <répertoire>      Écrit rapport.md et rapport.json.
  --publish               Ouvre l'issue « Rapport trimestriel — <trimestre> »
                          du dépôt de la boutique, ou la met à jour (gh, GH_TOKEN).
  --repository <o/d>      Dépôt de l'issue. Défaut : le remote « origin ».
  --account <id>          Compte Cloudflare attendu, si le manifeste ne le déclare pas.
  --shop <slug>           Manifeste à utiliser quand l'arbre en contient plusieurs.
  --json                  Rapport lisible par une machine.

Sources, chacune facultative :
  ventes          CLOUDFLARE_API_TOKEN (D1 : Read, Account Settings : Read,
                  Memberships et User Details : Read) ; des agrégats seulement
  évolutions      l'historique git de la branche courante (clone complet)
  référencement   GSC_SERVICE_ACCOUNT_JSON (clé du compte de service, ajouté en
                  « Restreint » à la propriété) ou GSC_ACCESS_TOKEN ; GSC_PROPERTY
                  si la propriété n'est pas celle du domaine de production
  fréquentation   UMAMI_API_KEY (ou UMAMI_USERNAME et UMAMI_PASSWORD) ; le site
                  est celui de Réglages → Mesure d'audience, sinon UMAMI_WEBSITE_ID
                  et UMAMI_API_URL

Code 0 : rapport produit (et publié avec --publish), même sans certaines
sources. Code 3 : période sans rien à rapporter. Code 4 : rien où publier, ou
un dépôt public ou sans issues (vérifié avant toute lecture). Code 5 :
publication refusée par GitHub.
`;

/** A source that failed, as the report and the run say it. */
function failed(error) {
  return { status: 'error', message: error.message, ...(error.hint ? { hint: error.hint } : {}) };
}

/** Only ShopctlErrors are a source's answer; anything else is a bug and keeps its stack. */
async function source(reporter, label, read) {
  try {
    const value = await read();
    if (value.status === 'absent') reporter.todo(`${label} : non raccordé — ${value.reason}`);
    return value;
  } catch (error) {
    if (!(error instanceof ShopctlError)) throw error;
    reporter.warn(`${label} : ${error.message}`, error.hint ?? null);
    return failed(error);
  }
}

/**
 * @param {{ positionals: string[], values: Record<string, string|boolean> }} args
 * @param {Reporter} reporter
 * @param {object} [deps] stand-ins for the reads and the forge, for the suite
 */
export async function runReport(args, reporter, deps = {}) {
  if (args.positionals.length > 0) throw usageError(`report ne prend pas d'argument positionnel ; reçu « ${args.positionals.join('", "')} ».`, reportUsage.trim());
  const env = requireEnvironment(args.values['--env']);
  if (env !== 'production') throw usageError('report lit la production, et elle seule.', 'Le commerçant vend en production : --env production.');

  const { manifest, root } = resolveShop(deps.cwd ?? process.cwd(), args.values['--shop']);
  const now = deps.now ?? new Date();
  const environment = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const period = resolvePeriod({
    quarter: args.values['--quarter'] ?? null,
    current: args.values['--current'] === true,
    since: args.values['--since'] ?? null,
    now,
    timeZone: manifest.client?.timezone || 'Europe/Paris',
  });

  // Where it goes, settled before anything is read: a report that cannot be
  // published is a run that has to start again.
  const publish = args.values['--publish'] === true;
  let repository = null;
  if (publish) {
    const given = args.values['--repository'] ?? originUrl(root);
    if (!given) throw preconditionError('--publish ne sait pas où ouvrir l\'issue : ni --repository ni remote « origin ».', 'Passez --repository propriétaire/dépôt, le dépôt de la boutique.');
    repository = String(given).includes('github.com') ? parseGithubRemote(given).nameWithOwner : parseGithubRemote(`https://github.com/${given}`).nameWithOwner;
    (deps.checkDestination ?? checkDestination)({ repository, cwd: root });
  }

  const slug = manifest.client.slug;
  reporter.step(`Rapport trimestriel de ${slug} — ${period.label} (${period.from} → ${period.to})`);

  reporter.section('Ventes — base de production (lecture)');
  let settings = readSettings([]);
  let readable = false;
  const sales = await source(reporter, 'ventes', () => {
    (deps.openEnvironment ?? openEnvironment)({
      values: args.values,
      manifest,
      root,
      env,
      reporter: new Reporter({ json: true, stdout: { write: () => true }, stderr: { write: () => true } }),
      missing: 'La production n\'est pas provisionnée.',
    });
    const results = (deps.query ?? query)([SETTINGS_SQL, ...salesStatements(period)], { cwd: root, remote: true, what: 'chiffres du trimestre' });
    settings = readSettings(results[0]);
    readable = true;
    const figures = summariseSales(results.slice(1), period);
    reporter.ok(`${figures.orders} commande(s) payée(s), ${figures.top.length} produit(s) en tête des ventes`);
    return { status: 'ok', ...figures };
  });

  reporter.section('Évolutions — historique git');
  const history = await source(reporter, 'évolutions', () => {
    const read = (deps.readHistory ?? readHistory)(root, period);
    reporter.ok(`${read.changes.length} pull request(s) fusionnée(s), socle ${read.core.from ?? '?'} → ${read.core.to ?? '?'}`);
    return { status: 'ok', ...read };
  });

  reporter.section('Référencement — Google Search Console');
  const search = await source(reporter, 'référencement', async () => {
    const read = await readSearch({ domain: manifest.cloudflare.productionDomain, period, env: environment, fetchImpl, now });
    if (read.status === 'ok') reporter.ok(`propriété ${read.property}`);
    return read;
  });

  reporter.section('Fréquentation — Umami');
  const audience = await source(reporter, 'fréquentation', async () => {
    const read = await readAudience({ scriptUrl: settings.umamiScriptUrl, websiteId: settings.umamiWebsiteId }, period, { env: environment, fetchImpl });
    if (read.status === 'ok') reporter.ok(`site ${read.websiteId}`);
    return read;
  });
  // Pages by their names rather than their paths: one more SELECT, and a
  // path left as it is when it cannot be read.
  if (audience.status === 'ok' && readable) {
    const statement = titlesSql(audience.pages.map((entry) => entry.x));
    let title = titleIndex([]);
    if (statement) {
      try {
        title = titleIndex((deps.query ?? query)([statement], { cwd: root, remote: true, what: 'titres des pages' })[0]);
      } catch (error) {
        if (!(error instanceof ShopctlError)) throw error;
      }
    }
    for (const entry of audience.pages) entry.title = title(entry.x);
  } else if (audience.status === 'ok') {
    const title = titleIndex([]);
    for (const entry of audience.pages) entry.title = title(entry.x);
  }

  const document = {
    command: 'report',
    ok: true,
    shop: slug,
    env,
    generatedAt: now.toISOString(),
    core: corePackage().version,
    period: {
      key: period.key,
      label: period.label,
      from: period.from,
      to: period.to,
      partial: period.partial,
      clamped: period.clamped,
      previous: period.previous ? { key: period.previous.key, label: period.previous.label, from: period.previous.from, to: period.previous.to } : null,
    },
    store: {
      name: settings.storeName || manifest.client.displayName || slug,
      domain: manifest.cloudflare.productionDomain,
      currency: manifest.client.currency || 'EUR',
    },
    sales,
    history,
    search,
    audience,
    checks: [
      ['ventes', sales],
      ['évolutions', history],
      ['référencement', search],
      ['fréquentation', audience],
    ].map(([name, read]) => ({ name, ok: read.status !== 'error', status: read.status })),
    title: issueTitle(period),
    written: [],
    issue: null,
  };
  const markdown = renderReport(document);

  if (args.values['--out']) {
    const directory = resolve(String(args.values['--out']));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'rapport.md'), markdown);
    document.written.push(join(directory, 'rapport.md'), join(directory, 'rapport.json'));
    writeFileSync(join(directory, 'rapport.json'), `${JSON.stringify(document, null, 2)}\n`);
  }

  if (publish) {
    reporter.section('Publication');
    document.issue = (deps.publishIssue ?? publishIssue)({ repository, title: document.title, body: markdown, cwd: root });
    reporter.ok(`issue ${document.issue.action === 'created' ? 'ouverte' : 'mise à jour'} : ${document.issue.url ?? `${repository}#${document.issue.number}`}`);
  }

  reporter.result(document);
  if (!reporter.json) {
    const missing = document.checks.filter((check) => !check.ok).map((check) => check.name);
    reporter.section(
      `${document.title} — ${missing.length > 0 ? `sans ${missing.join(', ')} (voir les avertissements ci-dessus)` : 'toutes les sources raccordées ont répondu'}.${
        publish ? '' : args.values['--out'] ? ` Écrit dans ${resolve(String(args.values['--out']))}.` : ' Relancez avec --out ou --publish pour le garder.'
      }`,
    );
  }
  return 0;
}
