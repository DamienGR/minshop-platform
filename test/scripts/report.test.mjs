/**
 * `shopctl report` — the quarterly report of ADR 0035.
 *
 * The pure parts are tested as such: the period in the shop's time zone, the
 * SQL and its figures, the release notes, the classification, the message.
 * The shop's history is a real git repository built per test, with dated
 * merges. Google and Umami answer through a fetch double that records what
 * was asked; the database through a stand-in for `query`. What no double
 * replaces is the first run against Google's and Umami's own APIs, which is
 * why their shapes are read leniently and a refusal is said, never swallowed.
 */
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXIT_CODES, externalError, preconditionError } from '../../shopctl/src/errors.mjs';
import { Reporter } from '../../shopctl/src/report.mjs';
import { runReport } from '../../shopctl/src/commands/report.mjs';
import { frenchDay, parseQuarter, periodSentence, resolvePeriod } from '../../shopctl/src/quarterly/period.mjs';
import { classify, cleanTitle, clientLine, parseNotes, readHistory } from '../../shopctl/src/quarterly/history.mjs';
import { SETTINGS_SQL, formatMoney, readSettings, salesStatements, summariseSales, titleIndex, titlesSql, totalsSql, topProductsSql } from '../../shopctl/src/quarterly/sales.mjs';
import { readAudience, summariseMetrics, summariseStats, umamiApiBase } from '../../shopctl/src/quarterly/umami.mjs';
import { chooseProperty, readSearch, signedAssertion, sitemapLocs } from '../../shopctl/src/quarterly/search-console.mjs';
import { issueTitle, of, renderClientMessage, renderReport } from '../../shopctl/src/quarterly/render.mjs';
import { checkDestination, publishIssue } from '../../shopctl/src/quarterly/publish.mjs';
import { shop } from '../helpers/provisioned-shop.mjs';
import { scratchDir } from '../helpers/scratch.mjs';

vi.setConfig({ testTimeout: 60_000 });

const CORE = new URL('../../', import.meta.url).pathname;
const PARIS = 'Europe/Paris';
/** The schedule's run: 06:17 UTC on the 5th of January. */
const JANUARY_5 = new Date('2027-01-05T06:17:00Z');

// ── the period ──────────────────────────────────────────────────────────────

describe('the period', () => {
  it('is the quarter that ended, by default, from midnight to midnight in Paris', () => {
    const period = resolvePeriod({ now: JANUARY_5, timeZone: PARIS });
    expect(period).toMatchObject({ key: '2026-T4', label: '4e trimestre 2026', from: '2026-10-01', to: '2026-12-31', partial: false, clamped: false });
    // Summer time until 25 October, winter time after.
    expect(period.start.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-12-31T23:00:00.000Z');
    expect(period.previous).toMatchObject({ key: '2026-T3', from: '2026-07-01', to: '2026-09-30' });
    expect(period.previous.end.toISOString()).toBe(period.start.toISOString());
  });

  it('names a quarter that has ended, as AAAA-Tn or AAAA-Qn, and refuses one under way', () => {
    expect(parseQuarter('2026-q1')).toEqual({ year: 2026, quarter: 1 });
    const first = resolvePeriod({ quarter: '2026-T1', now: JANUARY_5, timeZone: PARIS });
    expect(first).toMatchObject({ label: '1er trimestre 2026', from: '2026-01-01', to: '2026-03-31' });
    expect(first.previous).toMatchObject({ key: '2025-T4' });
    expect(() => resolvePeriod({ quarter: '2027-T1', now: JANUARY_5, timeZone: PARIS })).toThrow(expect.objectContaining({ code: EXIT_CODES.input }));
    expect(() => resolvePeriod({ quarter: '2026-T5', now: JANUARY_5, timeZone: PARIS })).toThrow(expect.objectContaining({ code: EXIT_CODES.usage }));
    expect(() => resolvePeriod({ quarter: '2026-T4', current: true, now: JANUARY_5, timeZone: PARIS })).toThrow(expect.objectContaining({ code: EXIT_CODES.usage }));
  });

  // The preview the reference site ran on 23 November: from the start of the
  // follow-up to now, with nothing to compare it with.
  it('previews the quarter under way, cut at the start of the follow-up', () => {
    const now = new Date('2026-11-23T20:00:00Z');
    const period = resolvePeriod({ current: true, since: '2026-11-09', now, timeZone: PARIS });
    expect(period).toMatchObject({ key: '2026-T4', from: '2026-11-09', to: '2026-11-23', partial: true, clamped: true, previous: null });
    expect(period.start.toISOString()).toBe('2026-11-08T23:00:00.000Z');
    expect(period.end).toBe(now);
    expect(periodSentence(period)).toBe('du 9 novembre au 23 novembre 2026');
  });

  it('has nothing to report before the follow-up, and compares only whole quarters it covers', () => {
    expect(() => resolvePeriod({ since: '2027-01-02', now: JANUARY_5, timeZone: PARIS })).toThrow(/avant le début du suivi/);
    expect(resolvePeriod({ since: '2026-11-09', now: JANUARY_5, timeZone: PARIS })).toMatchObject({ from: '2026-11-09', clamped: true, previous: null });
    expect(resolvePeriod({ since: '2026-08-01', now: JANUARY_5, timeZone: PARIS })).toMatchObject({ clamped: false, previous: null });
    expect(resolvePeriod({ since: '2026-07-01', now: JANUARY_5, timeZone: PARIS }).previous).toMatchObject({ key: '2026-T3' });
    expect(() => resolvePeriod({ since: '2026-02-30', now: JANUARY_5, timeZone: PARIS })).toThrow(/AAAA-MM-JJ/);
  });

  it('speaks French dates', () => {
    expect(frenchDay('2026-10-01')).toBe('1er octobre 2026');
    expect(periodSentence(resolvePeriod({ now: JANUARY_5, timeZone: PARIS }))).toBe('du 1er octobre au 31 décembre 2026');
    expect(periodSentence({ from: '2026-12-15', to: '2027-01-10' })).toBe('du 15 décembre 2026 au 10 janvier 2027');
  });
});

// ── the sales ───────────────────────────────────────────────────────────────

describe('the sales', () => {
  const period = resolvePeriod({ now: JANUARY_5, timeZone: PARIS });

  // Nothing personal leaves the database: the buyers are counted in the query.
  it('asks D1 for aggregates only, bounded in UTC', () => {
    const totals = totalsSql(period);
    expect(totals).toContain("created_at >= '2026-09-30 22:00:00' AND created_at < '2026-12-31 23:00:00'");
    expect(totals).toContain('COUNT(DISTINCT lower(email)) AS buyers');
    expect(totals.replace('COUNT(DISTINCT lower(email))', '')).not.toMatch(/email|address|name|phone/);
    expect(topProductsSql(period)).toMatch(/SELECT oi\.name AS name, SUM\(oi\.quantity\).* o\.created_at >= '2026-09-30 22:00:00' AND o\.created_at < '2026-12-31 23:00:00' GROUP BY oi\.name .* LIMIT 5;$/);
    expect(salesStatements(period)).toHaveLength(3);
    expect(salesStatements({ ...period, previous: null })).toHaveLength(2);
    expect(SETTINGS_SQL).not.toMatch(/enc:|password|email/);
  });

  it('sums gross, refunds and the average basket the way the dashboard does', () => {
    const figures = summariseSales(
      [[{ orders: 4, gross_cents: 20000, refunded_cents: 2500, buyers: 3 }], [{ name: 'Bougie', quantity: 5, cents: 9000 }], [{ orders: 0, gross_cents: 0, refunded_cents: 0, buyers: 0 }]],
      period,
    );
    expect(figures).toMatchObject({ orders: 4, grossCents: 20000, refundedCents: 2500, netCents: 17500, averageCents: 5000, buyers: 3 });
    expect(figures.top).toEqual([{ name: 'Bougie', quantity: 5, cents: 9000 }]);
    expect(figures.previous).toMatchObject({ orders: 0, averageCents: null });
  });

  it('formats money in the currency\'s own minor units', () => {
    expect(formatMoney(123456, 'EUR')).toBe('1 234,56 €');
    expect(formatMoney(1234, 'JPY')).toBe('1 234 JPY');
  });

  it('names the storefront\'s pages from their slugs, and writes nothing else into the statement', () => {
    const sql = titlesSql(['/', '/products/bougie-ambre', '/categories/salon', '/pages/notre-atelier', "/products/x' OR 1=1", '/products/a/b']);
    expect(sql).toContain("FROM products WHERE slug IN ('bougie-ambre')");
    expect(sql).toContain("FROM categories WHERE slug IN ('salon')");
    expect(sql).toContain("FROM pages WHERE slug IN ('notre-atelier')");
    expect(sql).not.toContain('OR 1=1');
    expect(titlesSql(['/', '/cart'])).toBeNull();
    const title = titleIndex([{ kind: 'pages', slug: 'notre-atelier', title: '[feuille] Notre atelier' }]);
    expect(title('/pages/notre-atelier')).toBe('Notre atelier');
    expect(title('/')).toBe('Accueil');
    expect(title('/products/inconnu')).toBeNull();
  });

  it('reads the shop\'s name and its Umami site from the settings', () => {
    expect(readSettings([{ key: 'store_name', value: ' Atelier ' }, { key: 'umami_website_id', value: 'ABC' }])).toEqual({ storeName: 'Atelier', umamiScriptUrl: null, umamiWebsiteId: 'abc' });
  });
});

// ── the history ─────────────────────────────────────────────────────────────

describe('the release notes', () => {
  it('keep the first sentence for the agency and the admin guide\'s bullets for the merchant', () => {
    const notes = parseNotes(readFileSync(resolve(CORE, 'docs/migrations/v0.13.0.md'), 'utf8'));
    expect(notes.title).toBe('Socle v0.13.0');
    expect(notes.summary).toMatch(/\.$/);
    expect(notes.guide).toHaveLength(2);
    expect(notes.guide[0]).toMatch(/^nouveau chapitre « Codes promo » : créer un code, créer une carte cadeau, suivre/);
  });

  it('say nothing to the merchant when the guide did not change', () => {
    expect(parseNotes(readFileSync(resolve(CORE, 'docs/migrations/v0.13.1.md'), 'utf8')).guide).toEqual([]);
  });
});

describe('a change\'s kind', () => {
  it('reads the conventional prefix, the branch, the title and what was touched', () => {
    expect(classify({ title: 'Socle v0.13.2', branch: 'socle/v0.13.2' })).toBe('socle');
    expect(classify({ title: 'feat: bandeau de Noël' })).toBe('evolution');
    expect(classify({ title: 'Bandeau', branch: 'fix/bandeau' })).toBe('correction');
    expect(classify({ title: 'Corriger le lien du pied de page' })).toBe('correction');
    expect(classify({ title: 'docs: guide' })).toBe('maintenance');
    expect(classify({ title: 'Ajouter un bandeau', toolingOnly: true })).toBe('maintenance');
    expect(classify({ title: 'Ajouter un bandeau' })).toBe('evolution');
    expect(cleanTitle('fix(theme): lien du pied de page')).toBe('Lien du pied de page');
    expect(cleanTitle('Note: rien')).toBe('Note: rien');
  });

  it('takes the merchant\'s sentence from a commit message, or keeps the change out', () => {
    expect(clientLine(['Titre\n\nPour le client : Un bandeau sur l\'accueil.'])).toBe('Un bandeau sur l\'accueil.');
    expect(clientLine(['Titre', 'Pour le client : -'])).toBe('');
    expect(clientLine(['Titre'])).toBeNull();
  });
});

/**
 * A shop's repository with a quarter of history: a core upgrade, its own pull
 * requests merged and squashed, a direct commit, and merges on either side of
 * the quarter that must not be counted.
 */
function historyRepository() {
  const root = scratchDir('report-history-');
  const env = (date) => ({ ...process.env, GIT_AUTHOR_NAME: 'Agence', GIT_AUTHOR_EMAIL: 'agence@example.com', GIT_COMMITTER_NAME: 'Agence', GIT_COMMITTER_EMAIL: 'agence@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const git = (args, date = '2026-09-01T10:00:00Z') => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: env(date) });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout;
  };
  const write = (path, text) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const notes = (version, guide) => `# Socle v${version}\n\n<!-- commentaire -->\n\nCette version fait ${version}. Rien d'autre.\n\n## Migrations\n\n- aucune.\n\n## Guide administrateur\n\n- ${guide}\n`;
  const branch = (name, files, message, date) => {
    git(['checkout', '--quiet', '-b', name], date);
    for (const [path, text] of Object.entries(files)) write(path, text);
    git(['add', '-A'], date);
    git(['commit', '--quiet', '-m', message], date);
    git(['checkout', '--quiet', 'main'], date);
  };
  const merge = (name, number, title, date) => git(['merge', '--quiet', '--no-ff', name, '-m', `Merge pull request #${number} from agence/${name}`, '-m', title], date);

  git(['init', '--quiet', '--initial-branch=main']);
  write('package.json', JSON.stringify({ version: '0.12.0' }));
  write('docs/migrations/v0.12.0.md', notes('0.12.0', 'inchangé : rien'));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'Initialiser la boutique']);

  branch('feat/avant', { 'src/themes/maison/a.css': 'a' }, 'Avant', '2026-09-10T10:00:00Z');
  merge('feat/avant', 2, 'Une évolution du trimestre d\'avant', '2026-09-10T10:00:00Z');
  branch('socle/v0.13.1', {
    'package.json': JSON.stringify({ version: '0.13.1' }),
    'docs/migrations/v0.13.0.md': notes('0.13.0', 'nouveau chapitre « Codes promo » : créer un code ;'),
    'docs/migrations/v0.13.1.md': notes('0.13.1', 'inchangé : aucun écran'),
  }, 'Socle v0.13.1', '2026-10-15T10:00:00Z');
  merge('socle/v0.13.1', 3, 'Socle v0.13.1', '2026-10-15T10:00:00Z');
  branch('feat/bandeau', { 'src/themes/maison/bandeau.css': 'b' }, 'Bandeau\n\nPour le client : Un bandeau de Noël sur l\'accueil.', '2026-11-02T10:00:00Z');
  merge('feat/bandeau', 4, 'Ajouter le bandeau de Noël', '2026-11-02T10:00:00Z');
  branch('fix/pied', { 'src/themes/maison/pied.css': 'c' }, 'Pied', '2026-11-10T10:00:00Z');
  merge('fix/pied', 5, 'fix: lien du pied de page', '2026-11-10T10:00:00Z');
  branch('ci-maj', { '.github/workflows/verify.yml': 'd' }, 'CI\n\nPour le client : -', '2026-11-12T10:00:00Z');
  merge('ci-maj', 6, 'Mettre à jour la CI', '2026-11-12T10:00:00Z');
  write('src/themes/maison/ordre.css', 'e');
  git(['add', '-A'], '2026-12-01T10:00:00Z');
  git(['commit', '--quiet', '-m', 'Corriger l\'ordre des catégories (#7)'], '2026-12-01T10:00:00Z');
  write('src/themes/maison/direct.css', 'f');
  git(['add', '-A'], '2026-12-02T10:00:00Z');
  git(['commit', '--quiet', '-m', 'Ajuster le thème'], '2026-12-02T10:00:00Z');
  branch('feat/apres', { 'src/themes/maison/z.css': 'z' }, 'Après', '2027-01-02T10:00:00Z');
  merge('feat/apres', 8, 'Une évolution du trimestre suivant', '2027-01-02T10:00:00Z');
  return root;
}

describe('the shop\'s history', () => {
  it('reads the quarter\'s merges, the core versions crossed and their notes', () => {
    const root = historyRepository();
    const history = readHistory(root, resolvePeriod({ now: JANUARY_5, timeZone: PARIS }));
    expect(history.core).toMatchObject({ from: '0.12.0', to: '0.13.1' });
    expect(history.core.versions.map((version) => [version.version, version.summary, version.guide])).toEqual([
      ['0.13.0', 'Cette version fait 0.13.0.', ['nouveau chapitre « Codes promo » : créer un code']],
      ['0.13.1', 'Cette version fait 0.13.1.', []],
    ]);
    expect(history.changes.map((change) => [change.kind, change.number, change.title, change.client])).toEqual([
      ['socle', 3, 'Socle v0.13.1', undefined],
      ['evolution', 4, 'Ajouter le bandeau de Noël', 'Un bandeau de Noël sur l\'accueil.'],
      ['correction', 5, 'Lien du pied de page', undefined],
      ['maintenance', 6, 'Mettre à jour la CI', ''],
      ['correction', 7, 'Corriger l\'ordre des catégories', undefined],
    ]);
    expect(history.direct.map((commit) => commit.title)).toEqual(['Ajuster le thème']);
  });

  it('says nothing was crossed when the core did not move', () => {
    const root = historyRepository();
    const history = readHistory(root, resolvePeriod({ quarter: '2026-T3', now: JANUARY_5, timeZone: PARIS }));
    expect(history.core).toEqual({ from: '0.12.0', to: '0.12.0', versions: [] });
    expect(history.changes.map((change) => change.number)).toEqual([2]);
  });
});

// ── the sources outside ─────────────────────────────────────────────────────

/** A fetch that answers from a table of handlers, and remembers every call. */
function fetchDouble(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ?? null });
    for (const [pattern, answer] of routes) {
      if (pattern.test(String(url))) {
        const { status = 200, body = {}, text = null } = typeof answer === 'function' ? answer(String(url), init) : answer;
        return new Response(text ?? JSON.stringify(body), { status });
      }
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

describe('Umami', () => {
  const period = resolvePeriod({ now: JANUARY_5, timeZone: PARIS });
  const site = { scriptUrl: 'https://cloud.umami.is/script.js', websiteId: '0f1e2d3c-4b5a-4968-8776-655443322110' };

  it('finds the API of the Umami that serves the tracker', () => {
    expect(umamiApiBase('https://cloud.umami.is/script.js')).toBe('https://api.umami.is/v1');
    expect(umamiApiBase('https://stats.agence.example/umami.js')).toBe('https://stats.agence.example/api');
    expect(umamiApiBase('https://x/script.js', 'https://stats.agence.example/api/')).toBe('https://stats.agence.example/api');
    expect(umamiApiBase('http://stats.agence.example/script.js')).toBeNull();
  });

  it('reads a statistic as Umami 2 and Umami 3 give it', () => {
    expect(summariseStats({ visitors: { value: 30, prev: 10 }, visits: { value: 40 }, pageviews: { value: 90 }, bounces: { value: 10 }, totaltime: { value: 4000 } })).toEqual({
      visitors: 30, visits: 40, pageviews: 90, bounceRate: 0.25, averageVisitSeconds: 100,
    });
    expect(summariseStats({ visitors: 30, visits: 0, pageviews: 0, bounces: 0, totaltime: 0 })).toMatchObject({ visitors: 30, bounceRate: null, averageVisitSeconds: null });
    expect(summariseMetrics([{ x: '/a', y: 2 }, { x: '/b', y: 5 }], 1)).toEqual([{ x: '/b', y: 5 }]);
  });

  it('is not connected without a site or a key, and says which', async () => {
    expect(await readAudience({ scriptUrl: null, websiteId: null }, period, { env: { UMAMI_API_KEY: 'k' } })).toMatchObject({ status: 'absent', reason: expect.stringContaining('Mesure d\'audience') });
    expect(await readAudience(site, period, { env: {} })).toMatchObject({ status: 'absent', reason: expect.stringContaining('UMAMI_API_KEY') });
  });

  it('asks with the key, falls back from `path` to `url`, and dates a site measured since mid-quarter', async () => {
    const { fetchImpl, calls } = fetchDouble([
      [/\/stats\?/, { body: { visitors: 36, visits: 41, pageviews: 120, bounces: 20, totaltime: 4100 } }],
      [/type=path/, { status: 400, body: { error: 'type' } }],
      [/type=url/, { body: [{ x: '/', y: 50 }, { x: '/products/bougie-ambre', y: 20 }] }],
      [/type=referrer/, { body: [{ x: '', y: 20 }, { x: 'google.com', y: 15 }] }],
      [/\/websites\/[^/]+$/, { body: { createdAt: '2026-11-14T09:00:00Z' } }],
    ]);
    const audience = await readAudience(site, period, { env: { UMAMI_API_KEY: 'cle-umami' }, fetchImpl });
    expect(audience).toMatchObject({ status: 'ok', visitors: 36, visits: 41, measuredSince: '2026-11-14T09:00:00.000Z', previous: null });
    expect(audience.pages).toEqual([{ x: '/', y: 50 }, { x: '/products/bougie-ambre', y: 20 }]);
    expect(calls.every((call) => call.url.startsWith(`https://api.umami.is/v1/websites/${site.websiteId}`))).toBe(true);
    expect(calls.every((call) => call.headers['x-umami-api-key'] === 'cle-umami')).toBe(true);
    expect(calls.find((call) => call.url.includes('/stats?')).url).toContain(`startAt=${period.start.getTime()}&endAt=${period.end.getTime()}`);
  });

  it('says a refused key, and a server that does not know the site', async () => {
    const refused = fetchDouble([[/./, { status: 401 }]]);
    await expect(readAudience(site, period, { env: { UMAMI_API_KEY: 'k' }, fetchImpl: refused.fetchImpl })).rejects.toMatchObject({ code: EXIT_CODES.external, message: expect.stringContaining('401') });
    const unknown = fetchDouble([[/\/websites\/[^/]+$/, { body: {} }], [/./, { status: 404 }]]);
    await expect(readAudience(site, period, { env: { UMAMI_API_KEY: 'k' }, fetchImpl: unknown.fetchImpl })).rejects.toThrow(/ne connaît pas le site/);
  });

  it('logs in to a server of its own with a username and password', async () => {
    const own = { scriptUrl: 'https://stats.agence.example/script.js', websiteId: site.websiteId };
    const { fetchImpl, calls } = fetchDouble([
      [/\/auth\/login$/, { body: { token: 'jeton-umami' } }],
      [/\/stats\?/, { body: { visitors: 1, visits: 1, pageviews: 1, bounces: 0, totaltime: 0 } }],
      [/type=/, { body: [] }],
      [/\/websites\/[^/]+$/, { body: { createdAt: '2025-01-01T00:00:00Z' } }],
    ]);
    const audience = await readAudience(own, period, { env: { UMAMI_USERNAME: 'rapports', UMAMI_PASSWORD: 'secret' }, fetchImpl });
    expect(audience).toMatchObject({ status: 'ok', measuredSince: null, previous: { visitors: 1 } });
    expect(calls[0]).toMatchObject({ url: 'https://stats.agence.example/api/auth/login', method: 'POST' });
    expect(calls.slice(1).every((call) => call.headers.authorization === 'Bearer jeton-umami')).toBe(true);
  });
});

describe('Search Console', () => {
  const period = resolvePeriod({ now: JANUARY_5, timeZone: PARIS });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const key = JSON.stringify({ type: 'service_account', client_email: 'rapports@projet.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' });

  it('chooses the Domain property of the host or a parent, then the URL prefix', () => {
    const sites = [{ siteUrl: 'https://boutique.example.fr/', permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'sc-domain:example.fr', permissionLevel: 'siteRestrictedUser' }];
    expect(chooseProperty(sites, 'boutique.example.fr')).toBe('sc-domain:example.fr');
    expect(chooseProperty(sites.slice(0, 1), 'boutique.example.fr')).toBe('https://boutique.example.fr/');
    expect(chooseProperty([{ siteUrl: 'sc-domain:example.fr', permissionLevel: 'siteUnverifiedUser' }], 'boutique.example.fr')).toBeNull();
    expect(chooseProperty([{ siteUrl: 'sc-domain:fr' }], 'example.fr')).toBeNull();
  });

  it('signs its assertion with the service account\'s key, for the read-only scope', () => {
    const assertion = signedAssertion({ clientEmail: 'rapports@projet.iam.gserviceaccount.com', privateKey, tokenUri: 'https://oauth2.googleapis.com/token' }, JANUARY_5);
    const [header, claims, signature] = assertion.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'rapports@projet.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: 'https://oauth2.googleapis.com/token',
      iat: JANUARY_5.getTime() / 1000, exp: JANUARY_5.getTime() / 1000 + 3600,
    });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('reads the sitemap\'s pages, and an index of sitemaps', () => {
    expect(sitemapLocs('<urlset><url><loc>https://b.fr/</loc></url><url><loc> https://b.fr/a?x=1&amp;y=2 </loc></url></urlset>')).toEqual({ index: false, locs: ['https://b.fr/', 'https://b.fr/a?x=1&y=2'] });
    expect(sitemapLocs('<sitemapindex><sitemap><loc>https://b.fr/s1.xml</loc></sitemap></sitemapindex>').index).toBe(true);
  });

  it('is not connected without a key', async () => {
    expect(await readSearch({ domain: 'boutique.example.fr', period, env: {} })).toMatchObject({ status: 'absent', reason: expect.stringContaining('GSC_SERVICE_ACCOUNT_JSON') });
    await expect(readSearch({ domain: 'boutique.example.fr', period, env: { GSC_SERVICE_ACCOUNT_JSON: '{"client' } })).rejects.toThrow(/n'est pas du JSON/);
  });

  it('reads the totals of both quarters, the searches, the pages and the indexing', async () => {
    const queries = [];
    const { fetchImpl, calls } = fetchDouble([
      [/oauth2\.googleapis\.com\/token$/, { body: { access_token: 'jeton-google' } }],
      [/\/webmasters\/v3\/sites$/, { body: { siteEntry: [{ siteUrl: 'sc-domain:example.fr', permissionLevel: 'siteRestrictedUser' }] } }],
      [/searchAnalytics\/query$/, (url, init) => {
        const body = JSON.parse(init.body);
        queries.push(body);
        if (body.dimensions?.[0] === 'query') return { body: { rows: [{ keys: ['bougie ambre'], clicks: 3, impressions: 40, ctr: 0.075, position: 4.26 }] } };
        if (body.dimensions?.[0] === 'page') return { body: { rows: [{ keys: ['https://boutique.example.fr/'], clicks: 5, impressions: 60 }] } };
        return { body: { rows: [{ clicks: body.startDate === '2026-10-01' ? 8 : 2, impressions: 100, ctr: 0.08, position: 12.34 }] } };
      }],
      [/\/sitemap\.xml$/, { text: '<urlset><url><loc>https://boutique.example.fr/</loc></url><url><loc>https://boutique.example.fr/products/bougie-ambre</loc></url></urlset>' }],
      [/index:inspect$/, (url, init) => (JSON.parse(init.body).inspectionUrl.endsWith('/')
        ? { body: { inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Envoyée et indexée' } } } }
        : { body: { inspectionResult: { indexStatusResult: { verdict: 'NEUTRAL', coverageState: 'Détectée, actuellement non indexée' } } } })],
    ]);
    const search = await readSearch({ domain: 'boutique.example.fr', period, env: { GSC_SERVICE_ACCOUNT_JSON: key }, fetchImpl, now: JANUARY_5 });
    expect(search).toMatchObject({
      status: 'ok', property: 'sc-domain:example.fr',
      totals: { clicks: 8, impressions: 100, position: 12.3 }, previous: { clicks: 2 },
      queries: [{ key: 'bougie ambre', clicks: 3, position: 4.3 }],
      indexing: { total: 2, checked: 2, indexed: 1, states: [{ state: 'Détectée, actuellement non indexée', count: 1 }] },
    });
    expect(queries[0]).toMatchObject({ startDate: '2026-10-01', endDate: '2026-12-31', dataState: 'final' });
    expect(queries[1]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-09-30' });
    expect(calls.find((call) => call.url.includes('searchAnalytics')).url).toContain('/sites/sc-domain%3Aexample.fr/');
    expect(calls.filter((call) => call.url.includes('googleapis.com/webmasters') || call.url.includes('index:inspect')).every((call) => call.headers.authorization === 'Bearer jeton-google')).toBe(true);
    // The key never travels: only the signed assertion does.
    expect(JSON.stringify(calls)).not.toContain('PRIVATE');
  });

  it('says what Google refused, with what to do', async () => {
    const disabled = fetchDouble([[/token$/, { body: { access_token: 't' } }], [/./, { status: 403, body: { error: { message: 'Search Console API has not been used in project 123' } } }]]);
    await expect(readSearch({ domain: 'boutique.example.fr', period, env: { GSC_SERVICE_ACCOUNT_JSON: key }, fetchImpl: disabled.fetchImpl })).rejects.toMatchObject({ hint: expect.stringContaining('n\'est pas activée') });
    const revoked = fetchDouble([[/token$/, { status: 400, body: { error: 'invalid_grant' } }]]);
    await expect(readSearch({ domain: 'boutique.example.fr', period, env: { GSC_SERVICE_ACCOUNT_JSON: key }, fetchImpl: revoked.fetchImpl })).rejects.toThrow(/refuse le jeton/);
    const unshared = fetchDouble([[/token$/, { body: { access_token: 't' } }], [/sites$/, { body: { siteEntry: [] } }]]);
    await expect(readSearch({ domain: 'boutique.example.fr', period, env: { GSC_SERVICE_ACCOUNT_JSON: key }, fetchImpl: unshared.fetchImpl })).rejects.toThrow(/aucune propriété Search Console/);
  });
});

// ── the report and the message ──────────────────────────────────────────────

const PERIOD = resolvePeriod({ now: JANUARY_5, timeZone: PARIS });
const DOCUMENT = {
  generatedAt: JANUARY_5.toISOString(),
  period: PERIOD,
  store: { name: 'Atelier Ambre', domain: 'boutique.example.fr', currency: 'EUR' },
  sales: { status: 'ok', orders: 12, grossCents: 123456, refundedCents: 0, netCents: 123456, averageCents: 10288, buyers: 10, top: [{ name: 'Bougie ambre', quantity: 7, cents: 21000 }], previous: { orders: 8, grossCents: 80000, refundedCents: 0, netCents: 80000, averageCents: 10000, buyers: 7 } },
  history: {
    status: 'ok',
    core: { from: '0.12.0', to: '0.13.1', versions: [{ version: '0.13.0', title: 'Socle v0.13.0', summary: 'Codes promo.', guide: ['nouveau chapitre « Codes promo » : créer un code'] }] },
    changes: [
      { kind: 'socle', number: 3, title: 'Socle v0.13.1' },
      { kind: 'evolution', number: 4, title: 'Ajouter le bandeau de Noël', client: 'Un bandeau de Noël sur l\'accueil.' },
      { kind: 'maintenance', number: 6, title: 'Mettre à jour la CI' },
      { kind: 'correction', number: 7, title: 'Corriger l\'ordre des catégories', client: '' },
    ],
    direct: [],
  },
  search: { status: 'error', message: 'Search Console, totaux : 403.', hint: 'L\'API Search Console n\'est pas activée.' },
  audience: { status: 'absent', reason: 'la boutique ne mesure pas son audience (Réglages → Mesure d\'audience)' },
};

describe('the report', () => {
  it('is titled by its quarter, so the final report updates the preview\'s issue', () => {
    expect(issueTitle(PERIOD)).toBe('Rapport trimestriel — 4e trimestre 2026');
  });

  it('elides « de » before a vowel', () => {
    expect([of('Atelier Ambre'), of('Écorce'), of('La Bougie'), of('Hêtre')]).toEqual(['d\'Atelier Ambre', 'd\'Écorce', 'de La Bougie', 'de Hêtre']);
  });

  it('keeps the detail for the agency, and says which source did not answer', () => {
    const body = renderReport(DOCUMENT);
    expect(body).toMatch(/^<!-- shopctl report 2026-T4 -->/);
    expect(body).toContain('| Commandes payées | 12 | 8 |');
    expect(body).toContain('v0.12.0 → v0.13.1');
    expect(body).toContain('- Évolution — #4 Ajouter le bandeau de Noël — pour le client : « Un bandeau de Noël sur l\'accueil. »');
    expect(body).toContain('- Correction — #7 Corriger l\'ordre des catégories — _hors du message_');
    expect(body).toContain('> [!WARNING]\n> Search Console n\'a pas répondu : Search Console, totaux : 403.');
    expect(body).toContain('_Umami n\'est pas encore raccordé : la boutique ne mesure pas son audience');
    expect(body).toContain('## Message pour le commerçant');
  });

  // The merchant reads an e-mail: no table, no link, no code, no section the
  // agency could not fill.
  it('writes the merchant a message with no table, link or technical word', () => {
    const { subject, text } = renderClientMessage(DOCUMENT);
    expect(subject).toBe('Atelier Ambre — votre bilan du 4e trimestre 2026');
    expect(text).toMatch(/^Bonjour,\n\nVoici le bilan d'Atelier Ambre pour le 4e trimestre 2026 \(du 1er octobre au 31 décembre 2026\)\./);
    expect(text).toContain('12 commandes pour 1 234,56 € TTC, soit un panier moyen de 102,88 €.');
    expect(text).toContain('Au trimestre précédent : 8 commandes');
    expect(text).toContain('- Un bandeau de Noël sur l\'accueil');
    expect(text).toContain('  - Nouveau chapitre « Codes promo » : créer un code');
    expect(text).not.toContain('Corriger l\'ordre');
    expect(text).not.toContain('Mettre à jour la CI');
    expect(text).not.toMatch(/\||https?:|`|#\d|v0\.|Search Console|Umami/);
    expect(text).not.toContain('**Sur Google**');
    expect(text).toMatch(/Bien cordialement,$/);
  });
});

describe('the issue', () => {
  const gh = (issues) => {
    const calls = [];
    return {
      calls,
      gh: (args, options = {}) => {
        calls.push({ args, input: options.input ?? null });
        if (args[1] === 'list') return { status: 0, stdout: JSON.stringify(issues), stderr: '' };
        if (args[1] === 'create') return { status: 0, stdout: 'https://github.com/agence/shop-atelier/issues/9\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    };
  };

  it('is opened once, then updated in place — closed or not — with the body on standard input', () => {
    const fresh = gh([{ number: 2, title: 'Rapport trimestriel — 3e trimestre 2026', url: 'u2' }]);
    expect(publishIssue({ repository: 'agence/shop-atelier', title: 'Rapport trimestriel — 4e trimestre 2026', body: 'corps', gh: fresh.gh })).toEqual({
      action: 'created', number: 9, url: 'https://github.com/agence/shop-atelier/issues/9', repository: 'agence/shop-atelier',
    });
    expect(fresh.calls[1]).toEqual({ args: ['issue', 'create', '--repo', 'agence/shop-atelier', '--title', 'Rapport trimestriel — 4e trimestre 2026', '--body-file', '-'], input: 'corps' });
    const again = gh([{ number: 9, title: 'Rapport trimestriel — 4e trimestre 2026', url: 'u9' }]);
    expect(publishIssue({ repository: 'agence/shop-atelier', title: 'Rapport trimestriel — 4e trimestre 2026', body: 'corps 2', gh: again.gh })).toMatchObject({ action: 'updated', number: 9, url: 'u9' });
    expect(again.calls[0].args).toContain('all');
    expect(again.calls[1]).toEqual({ args: ['issue', 'edit', '9', '--repo', 'agence/shop-atelier', '--body-file', '-'], input: 'corps 2' });
  });

  // The report states the shop's sales: never in a repository anyone reads.
  it('goes only to a private repository whose issues are on', () => {
    const viewing = (info) => () => ({ status: 0, stdout: JSON.stringify(info), stderr: '' });
    expect(checkDestination({ repository: 'agence/shop-atelier', gh: viewing({ visibility: 'PRIVATE', hasIssuesEnabled: true }) })).toEqual({ repository: 'agence/shop-atelier', visibility: 'private' });
    const refusal = (info) => {
      try {
        checkDestination({ repository: 'agence/shop-atelier', gh: viewing(info) });
      } catch (error) {
        return error;
      }
      return null;
    };
    expect(refusal({ visibility: 'PUBLIC', hasIssuesEnabled: true })).toMatchObject({ code: EXIT_CODES.precondition, message: expect.stringContaining('n\'est pas privé (public)') });
    expect(refusal({ visibility: 'INTERNAL', hasIssuesEnabled: true })).toMatchObject({ code: EXIT_CODES.precondition });
    expect(refusal({ visibility: 'PRIVATE', hasIssuesEnabled: false })).toMatchObject({ code: EXIT_CODES.precondition, hint: expect.stringContaining('gh repo edit agence/shop-atelier --enable-issues') });
  });
});

// ── the command ─────────────────────────────────────────────────────────────

describe('shopctl report', () => {
  const sink = () => ({ text: '', write(chunk) { this.text += chunk; return true; } });
  const RESULTS = [
    [{ key: 'store_name', value: 'Atelier Ambre' }, { key: 'umami_script_url', value: 'https://cloud.umami.is/script.js' }, { key: 'umami_website_id', value: '0f1e2d3c-4b5a-4968-8776-655443322110' }],
    [{ orders: 3, gross_cents: 9000, refunded_cents: 0, buyers: 3 }],
    [{ name: 'Bougie ambre', quantity: 3, cents: 9000 }],
    [{ orders: 1, gross_cents: 3000, refunded_cents: 0, buyers: 1 }],
  ];
  const run = async (values = {}, deps = {}) => {
    const target = shop({ slug: 'atelier-rapport' });
    const out = sink();
    const prose = sink();
    const reporter = new Reporter({ json: true, stdout: out, stderr: prose });
    const asked = [];
    const published = [];
    let code;
    try {
      code = await runReport({ positionals: [], values: { '--env': 'production', '--json': true, ...values } }, reporter, {
        cwd: target.root,
        now: JANUARY_5,
        env: { UMAMI_API_KEY: 'cle-umami' },
        openEnvironment: () => ({}),
        query: (statements) => {
          asked.push(statements);
          return statements.length === 1 ? [[{ kind: 'products', slug: 'bougie-ambre', title: 'Bougie ambre' }]] : RESULTS;
        },
        readHistory: () => ({ core: { from: '0.13.1', to: '0.13.1', versions: [] }, changes: [], direct: [] }),
        fetch: fetchDouble([
          [/\/stats\?/, { body: { visitors: 36, visits: 41, pageviews: 120, bounces: 20, totaltime: 4100 } }],
          [/type=path/, { body: [{ x: '/', y: 50 }, { x: '/products/bougie-ambre', y: 20 }] }],
          [/type=referrer/, { body: [{ x: 'google.com', y: 15 }] }],
          [/\/websites\/[^/]+$/, { body: { createdAt: '2025-01-01T00:00:00Z' } }],
        ]).fetchImpl,
        checkDestination: ({ repository }) => ({ repository, visibility: 'private' }),
        publishIssue: (options) => {
          published.push(options);
          return { action: 'created', number: 9, url: 'https://github.com/agence/shop-atelier-rapport/issues/9', repository: options.repository };
        },
        ...deps,
      });
    } catch (error) {
      code = error.code;
    }
    return { target, code, asked, published, prose: prose.text, document: out.text ? JSON.parse(out.text) : null };
  };

  it('refuses to run without --env, on staging, or for a quarter under way', async () => {
    expect((await run({ '--env': undefined })).code).toBe(EXIT_CODES.usage);
    expect((await run({ '--env': 'staging' })).code).toBe(EXIT_CODES.usage);
    expect((await run({ '--quarter': '2027-T1' })).code).toBe(EXIT_CODES.input);
    expect((await run({ '--since': '2027-01-02' })).code).toBe(EXIT_CODES.input);
  });

  it('reads every source, names the pages, and says which one is not connected', async () => {
    const { code, document, asked } = await run();
    expect(code).toBe(EXIT_CODES.ok);
    expect(document).toMatchObject({
      command: 'report', ok: true, shop: 'atelier-rapport', env: 'production',
      period: { key: '2026-T4', from: '2026-10-01', to: '2026-12-31', previous: { key: '2026-T3' } },
      store: { name: 'Atelier Ambre', domain: 'boutique.example.fr', currency: 'EUR' },
      sales: { status: 'ok', orders: 3, grossCents: 9000, previous: { orders: 1 } },
      audience: { status: 'ok', visitors: 36 },
      search: { status: 'absent' },
      title: 'Rapport trimestriel — 4e trimestre 2026',
      issue: null,
    });
    expect(document.audience.pages.map((page) => page.title)).toEqual(['Accueil', 'Bougie ambre']);
    expect(document.checks).toEqual([
      { name: 'ventes', ok: true, status: 'ok' },
      { name: 'évolutions', ok: true, status: 'ok' },
      { name: 'référencement', ok: true, status: 'absent' },
      { name: 'fréquentation', ok: true, status: 'ok' },
    ]);
    expect(asked[0][0]).toBe(SETTINGS_SQL);
    expect(asked[1]).toEqual([titlesSql(['/', '/products/bougie-ambre'])]);
  });

  // A source that fails is said, and the report still goes out.
  it('goes out without a source that failed, and says so', async () => {
    const { code, document, prose } = await run({}, { query: () => { throw externalError('wrangler d1 execute a échoué.', 'Jeton refusé.'); } });
    expect(code).toBe(EXIT_CODES.ok);
    expect(document.sales).toEqual({ status: 'error', message: 'wrangler d1 execute a échoué.', hint: 'Jeton refusé.' });
    expect(document.checks[0]).toEqual({ name: 'ventes', ok: false, status: 'error' });
    // Without the settings, the shop's Umami site is unknown.
    expect(document.audience.status).toBe('absent');
    expect(document.store.name).toBe('Boutique de test');
    expect(prose).toContain('! ventes : wrangler d1 execute a échoué.');
  });

  it('writes the report where asked, and publishes it in the shop\'s repository', async () => {
    const out = scratchDir('report-out-');
    const { code, document, published } = await run({ '--out': out, '--publish': true, '--repository': 'agence/shop-atelier-rapport' });
    expect(code).toBe(EXIT_CODES.ok);
    expect(readFileSync(join(out, 'rapport.md'), 'utf8')).toContain('## Message pour le commerçant');
    expect(JSON.parse(readFileSync(join(out, 'rapport.json'), 'utf8'))).toMatchObject({ command: 'report', period: { key: '2026-T4' } });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ repository: 'agence/shop-atelier-rapport', title: 'Rapport trimestriel — 4e trimestre 2026' });
    expect(published[0].body).toContain('Voici le bilan d\'Atelier Ambre');
    expect(document.issue).toMatchObject({ action: 'created', number: 9 });
  });

  it('refuses to publish nowhere, or in a public repository, before reading anything', async () => {
    const nowhere = await run({ '--publish': true });
    expect(nowhere.code).toBe(EXIT_CODES.precondition);
    expect(nowhere.asked).toEqual([]);
    const pub = await run({ '--publish': true, '--repository': 'agence/shop-atelier-rapport' }, {
      checkDestination: () => { throw preconditionError('agence/shop-atelier-rapport n\'est pas privé (public).'); },
    });
    expect(pub.code).toBe(EXIT_CODES.precondition);
    expect(pub.asked).toEqual([]);
    expect(pub.published).toEqual([]);
  });
});
