/**
 * `shopctl fleet usage` — the shared account's month against what Workers Paid
 * includes (ADR 0019, plan §13.1 lot 7).
 *
 * The prices are pure functions, so each one is a test here rather than a
 * surprise on the invoice; the command itself runs against the GraphQL double,
 * which answers the account the way the datasets are documented to.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { ACCOUNT_LIMITS, PAID_PLAN, monthWindow, projectBill, summariseUsage } from '../../shopctl/src/commands/fleet-usage.mjs';
import { OPERATOR_ENV } from '../helpers/operator-env.mjs';

const BIN = new URL('../../shopctl/bin/shopctl.mjs', import.meta.url).pathname;
const DOUBLE = new URL('../fixtures/graphql-double.mjs', import.meta.url).pathname;
const ACCOUNT = '0123456789abcdef0123456789abcdef';

const worker = (name, requests, cpuMs = 0) => ({ sum: { requests, cpuTimeUs: cpuMs * 1000 }, dimensions: { scriptName: name } });
const nothing = summariseUsage({});
const line = (bill, key) => bill.lines.find((entry) => entry.key === key);

describe('the month so far', () => {
  it('starts on the first of the month in UTC and says how much of it has passed', () => {
    const window = monthWindow(new Date('2026-10-16T12:00:00Z'));
    expect(window.since.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(window.elapsedShare).toBeCloseTo((15.5 * 24) / (31 * 24), 6);
  });

  // Ten minutes into the month, a linear projection would multiply the first
  // requests by four thousand.
  it('counts at least an hour, so the first minutes do not project a fortune', () => {
    const window = monthWindow(new Date('2026-11-01T00:10:00Z'));
    expect(window.elapsedShare).toBeCloseTo(1 / (30 * 24), 6);
  });
});

describe('what the datasets add up to', () => {
  it('sums the Workers and keeps the busiest first', () => {
    const usage = summariseUsage({
      workersInvocationsAdaptive: [worker('minshop-a-production', 100, 40), worker('minshop-b-staging', 900, 2), worker('minshop-a-production', 50, 10)],
    });
    expect(usage.workers).toEqual({
      requests: 1050,
      cpuMs: 52,
      scripts: [
        { name: 'minshop-b-staging', requests: 900, cpuMs: 2 },
        { name: 'minshop-a-production', requests: 150, cpuMs: 50 },
      ],
    });
  });

  // R2 bills two classes and never a delete; an operation it does not know is
  // priced as the dearer class rather than left out of the bill.
  it('sorts R2 operations into their classes, and counts an unknown one as class A', () => {
    const op = (actionType, requests) => ({ sum: { requests }, dimensions: { actionType } });
    const usage = summariseUsage({
      r2OperationsAdaptiveGroups: [op('PutObject', 10), op('GetObject', 500), op('HeadObject', 20), op('DeleteObject', 999), op('SomethingNew', 3), op('ListObjects', 7)],
    });
    expect(usage.r2.classA).toBe(20);
    expect(usage.r2.classB).toBe(520);
  });

  it('bills every KV operation but a read at the write price', () => {
    const op = (actionType, requests) => ({ sum: { requests }, dimensions: { actionType } });
    const usage = summariseUsage({ kvOperationsAdaptiveGroups: [op('read', 100), op('write', 4), op('delete', 2), op('list', 1)] });
    expect(usage.kv).toEqual({ reads: 100, writes: 7 });
  });

  // Storage is a stock: the month's highest size per database or bucket, added
  // across them — never the sum of every day's size.
  it('takes the highest size of each database and bucket, and adds those', () => {
    const usage = summariseUsage({
      d1StorageAdaptiveGroups: [
        { max: { databaseSizeBytes: 1_000_000_000 }, dimensions: { databaseId: 'a' } },
        { max: { databaseSizeBytes: 3_000_000_000 }, dimensions: { databaseId: 'a' } },
        { max: { databaseSizeBytes: 500_000_000 }, dimensions: { databaseId: 'b' } },
      ],
      r2StorageAdaptiveGroups: [
        { max: { payloadSize: 2_000_000_000, metadataSize: 0 }, dimensions: { bucketName: 'x' } },
        { max: { payloadSize: 1_000_000_000, metadataSize: 0 }, dimensions: { bucketName: 'x' } },
        { max: { payloadSize: 999_000_000, metadataSize: 1_000_000 }, dimensions: { bucketName: 'y' } },
      ],
    });
    expect(usage.d1.storageGb).toBeCloseTo(3.5, 9);
    expect(usage.r2.storageGb).toBeCloseTo(3, 9);
  });

  it('estimates one SaaS hostname per production Worker', () => {
    const usage = summariseUsage({ workersInvocationsAdaptive: [worker('minshop-a-production', 1), worker('minshop-a-staging', 1), worker('minshop-b-production', 1)] });
    expect(usage.saas.hostnames).toBe(2);
  });

  it('reads an account that answered nothing as zero everywhere', () => {
    expect(nothing.workers).toEqual({ requests: 0, cpuMs: 0, scripts: [] });
    expect(projectBill(nothing, { elapsedShare: 0.5 }).total).toBe(PAID_PLAN.subscription);
  });
});

describe('the projected bill', () => {
  it('is the subscription alone while every volume stays within what the plan includes', () => {
    const usage = { ...nothing, workers: { requests: 4_000_000, cpuMs: 10_000_000, scripts: [] } };
    const bill = projectBill(usage, { elapsedShare: 0.5 });
    expect(line(bill, 'workers.requests')).toMatchObject({ used: 4_000_000, projected: 8_000_000, cost: 0 });
    expect(bill.total).toBe(5);
  });

  // Half the month gone with 8 million requests projects 16 million: 6 million
  // over at 0.30 $ the million.
  it('projects a flow linearly and bills only what passes the inclusion', () => {
    const usage = { ...nothing, workers: { requests: 8_000_000, cpuMs: 0, scripts: [] } };
    const bill = projectBill(usage, { elapsedShare: 0.5 });
    expect(line(bill, 'workers.requests').cost).toBeCloseTo(1.8, 9);
    expect(bill.total).toBeCloseTo(6.8, 9);
  });

  it('takes a stock as it stands, however early in the month', () => {
    const usage = { ...nothing, r2: { classA: 0, classB: 0, storageGb: 30 }, d1: { rowsRead: 0, rowsWritten: 0, storageGb: 7 } };
    const bill = projectBill(usage, { elapsedShare: 0.1 });
    expect(line(bill, 'r2.storageGb')).toMatchObject({ projected: 30, cost: 20 * 0.015 });
    expect(line(bill, 'd1.storageGb').cost).toBeCloseTo(2 * 0.75, 9);
  });

  // The prices of ADR 0019, each where a mistake would cost the most.
  it('prices each volume as Workers Paid publishes it', () => {
    const over = (key, amount) => {
      const usage = structuredClone(nothing);
      const [service, field] = key.split('.');
      usage[service][field] = amount;
      return line(projectBill(usage, { elapsedShare: 1 }), key).cost;
    };
    expect(over('workers.cpuMs', 31_000_000)).toBeCloseTo(0.02, 9);
    expect(over('d1.rowsRead', 26_000_000_000)).toBeCloseTo(1, 9);
    expect(over('d1.rowsWritten', 51_000_000)).toBeCloseTo(1, 9);
    expect(over('r2.classA', 2_000_000)).toBeCloseTo(4.5, 9);
    expect(over('r2.classB', 11_000_000)).toBeCloseTo(0.36, 9);
    expect(over('kv.reads', 11_000_000)).toBeCloseTo(0.5, 9);
    expect(over('kv.writes', 2_000_000)).toBeCloseTo(5, 9);
    expect(over('saas.hostnames', 200)).toBeCloseTo(10, 9);
  });
});

describe('shopctl fleet usage', () => {
  const doubles = [];
  afterEach(() => {
    for (const child of doubles.splice(0)) child.kill();
  });

  async function analytics(state) {
    const file = join(mkdtempSync(join(tmpdir(), 'shopctl-usage-')), 'state.json');
    writeFileSync(file, JSON.stringify(state));
    const child = spawn('node', [DOUBLE, file], { stdio: ['ignore', 'pipe', 'inherit'] });
    doubles.push(child);
    const [chunk] = await once(child.stdout, 'data');
    return { origin: chunk.toString().trim(), read: () => JSON.parse(readFileSync(file, 'utf8')) };
  }

  /** No shop tree: the question is the account's, asked from anywhere. */
  function usage(args, env = {}) {
    const result = spawnSync('node', [BIN, 'fleet', 'usage', ...args, '--json'], {
      cwd: mkdtempSync(join(tmpdir(), 'shopctl-usage-cwd-')),
      encoding: 'utf8',
      env: { ...process.env, ...OPERATOR_ENV, ...env },
    });
    return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
  }

  const env = (origin) => ({ CLOUDFLARE_API_TOKEN: 'analytics-read-token', CLOUDFLARE_API_BASE_URL: origin, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
  const quiet = { usage: { workersInvocationsAdaptive: [worker('minshop-a-production', 1000, 20)] } };

  it('asks the whole account once, for the month so far, and passes a quiet one', async () => {
    const api = await analytics(quiet);
    const { status, stderr, report } = usage(['--budget', '20'], env(api.origin));

    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ command: 'fleet usage', ok: true, account: ACCOUNT, budget: 20, bill: { total: 5 } });
    const [request] = api.read().requests;
    expect(api.read().requests).toHaveLength(1);
    expect(request.authorization).toBe('Bearer analytics-read-token');
    expect(request.variables.account).toBe(ACCOUNT);
    expect(request.variables.sinceDate).toMatch(/^\d{4}-\d{2}-01$/);
    for (const dataset of ['workersInvocationsAdaptive', 'd1AnalyticsAdaptiveGroups', 'd1StorageAdaptiveGroups', 'r2OperationsAdaptiveGroups', 'r2StorageAdaptiveGroups', 'kvOperationsAdaptiveGroups']) {
      expect(request.query).toContain(dataset);
    }
  });

  // A volume past what is included is billed, not blocked: only the budget fails.
  it('fails (code 6) when the projected bill passes the budget, and names it', async () => {
    const api = await analytics({ usage: { workersInvocationsAdaptive: [worker('minshop-a-production', 1_000_000_000)] } });
    const { status, report } = usage(['--budget', '50'], env(api.origin));

    expect(status).toBe(EXIT_CODES.verification);
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.name === 'facture projetée')).toMatchObject({ ok: false, judged: true });
    expect(report.bill.total).toBeGreaterThan(50);
  });

  it('reports a bill over what is included without failing when no budget is set', async () => {
    const api = await analytics({ usage: { workersInvocationsAdaptive: [worker('minshop-a-production', 1_000_000_000)] } });
    const { status, report } = usage([], env(api.origin));

    expect(status).toBe(EXIT_CODES.ok);
    expect(report.checks.find((check) => check.name === 'facture projetée')).toMatchObject({ ok: true, judged: false });
  });

  // The day to open the next account is the day it reaches the shops it aims
  // at, not the day Cloudflare refuses the 251st cron.
  it('fails when the account carries as many Workers as it aims at', async () => {
    const workers = Array.from({ length: ACCOUNT_LIMITS.target }, (_, index) => worker(`minshop-s${index}-production`, 10));
    const api = await analytics({ usage: { workersInvocationsAdaptive: workers } });
    const { status, report } = usage([], env(api.origin));

    expect(status).toBe(EXIT_CODES.verification);
    expect(report.checks.find((check) => check.name === 'Workers du compte')).toMatchObject({ ok: false, value: ACCOUNT_LIMITS.target });
  });

  it('refuses without an account, with a malformed one, or with a budget that is not an amount', () => {
    expect(usage([], { CLOUDFLARE_API_TOKEN: 'analytics-read-token' }).status).toBe(EXIT_CODES.usage);
    expect(usage(['--account', 'agence'], { CLOUDFLARE_API_TOKEN: 'analytics-read-token' }).status).toBe(EXIT_CODES.usage);
    expect(usage(['--account', ACCOUNT, '--budget', 'beaucoup'], { CLOUDFLARE_API_TOKEN: 'analytics-read-token' }).status).toBe(EXIT_CODES.usage);
  });

  it('needs the analytics token before asking anything', () => {
    expect(usage(['--account', ACCOUNT]).status).toBe(EXIT_CODES.precondition);
  });

  // "Could not ask" is never "nothing to report".
  it('fails as an external error when the API refuses the question', async () => {
    const api = await analytics({ errors: [{ message: 'unknown field "cpuTimeUs"' }] });
    const { status, stderr } = usage([], env(api.origin));

    expect(status).toBe(EXIT_CODES.external);
    expect(stderr).toContain('cpuTimeUs');
  });
});
