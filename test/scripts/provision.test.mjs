import { describe, expect, it, vi } from 'vitest';

// .mjs like its neighbours: tsconfig pins `types` to the Cloudflare types, so
// node builtins have no declarations in a .ts file here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { resolveAccount } from '../../shopctl/src/cloudflare.mjs';
import { INTERNAL_SECRETS, generateSecret } from '../../shopctl/src/commands/provision.mjs';
import { ACCOUNT, OTHER_ACCOUNT, names, shop } from '../helpers/provisioned-shop.mjs';

// Every test here spawns wrangler several times over. Node process start-up
// dominates, and a suite that fails on a loaded machine is one people re-run
// instead of read.
vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------

describe('the account gate', () => {
  const identity = { accounts: [ACCOUNT, OTHER_ACCOUNT] };

  it('accepts the account the manifest claims', () => {
    expect(resolveAccount({ manifest: ACCOUNT.id, flag: null, env: null }, identity)).toMatchObject({ id: ACCOUNT.id });
  });

  // The failure this exists for: an operator logged into the customer's own
  // account, provisioning the agency's shop into it (ADR 0002).
  it('refuses an account the session cannot reach', () => {
    expect(() => resolveAccount({ manifest: 'f'.repeat(32), flag: null, env: null }, identity)).toThrow(/pas accès au compte attendu/);
  });

  // Never resolved by preference. Whichever one this picked would be the one
  // the operator had forgotten about.
  it('refuses two sources that disagree', () => {
    expect(() => resolveAccount({ manifest: ACCOUNT.id, flag: OTHER_ACCOUNT.id, env: null }, identity)).toThrow(/comptes différents/);
  });

  // A token that can reach exactly one account today reaches two after the next
  // customer. "It worked last time" is how a shop lands in the wrong place.
  it('refuses to guess when nothing names an account', () => {
    expect(() => resolveAccount({ manifest: null, flag: null, env: null }, { accounts: [ACCOUNT] })).toThrow(/aucun compte/);
  });
});

describe('shopctl provision', () => {
  it('refuses to run without --env', () => {
    const target = shop();
    const result = target.run(['provision']);
    expect(result.status).toBe(EXIT_CODES.usage);
    expect(result.stderr).toMatch(/--env est obligatoire/);
  });

  it('refuses an environment the fleet does not have', () => {
    const result = shop().run(['provision', '--env', 'preprod']);
    expect(result.status).toBe(EXIT_CODES.usage);
    expect(result.stderr).toMatch(/inconnu/);
  });

  it('refuses an unauthenticated session before touching anything', () => {
    const target = shop();
    target.account({ authenticated: false });
    const result = target.run(['provision', '--env', 'staging']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/n'est pas authentifié/);
    expect(target.read().d1).toEqual([]);
  });

  // Activation is a human step (plan §5.3). Discovering it after the database
  // exists leaves a shop half-provisioned for as long as the dashboard visit
  // takes, so it is asked first.
  it('names R2 activation as a prerequisite and creates nothing', () => {
    const target = shop();
    target.account({ r2Enabled: false });
    const result = target.run(['provision', '--env', 'staging']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/R2 n'est pas activé/);
    expect(target.read().d1).toEqual([]);
  });

  it('refuses the wrong Cloudflare account', () => {
    const target = shop({ accountId: OTHER_ACCOUNT.id });
    const result = target.run(['provision', '--env', 'staging']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/pas accès au compte attendu/);
    expect(target.read().r2).toEqual([]);
  });

  describe('--dry-run', () => {
    it('reports what it would create and creates none of it', () => {
      const target = shop();
      const { report, status } = target.json(['provision', '--env', 'staging', '--dry-run']);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.dryRun).toBe(true);
      expect(report.steps.map((step) => `${step.action} ${step.name}`)).toEqual([
        `create ${names(target.slug, 'staging').database}`,
        `create ${names(target.slug, 'staging').images}`,
        `create ${names(target.slug, 'staging').files}`,
      ]);

      const state = target.read();
      expect(state.d1).toEqual([]);
      expect(state.r2).toEqual([]);
      expect(state.migrationsApplied ?? 0).toBe(0);
      // The preview walks the same account the real run would. What it must not
      // do is write, and `calls` is the proof: every command it ran is a read.
      expect(state.calls.every(({ argv }) => !argv.includes('create') && !argv.includes('put'))).toBe(true);
    });

    it('leaves no wrangler.jsonc behind', () => {
      const target = shop();
      target.run(['provision', '--env', 'staging', '--dry-run']);
      expect(() => readFileSync(join(target.root, 'wrangler.jsonc'), 'utf8')).toThrow();
    });
  });

  describe('a first run', () => {
    it('creates every resource in the manifest jurisdiction', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      const { report, status } = target.json(['provision', '--env', 'staging']);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.ok).toBe(true);

      const state = target.read();
      expect(state.d1).toEqual([{ name: expected.database, uuid: expect.any(String), jurisdiction: 'eu' }]);
      expect(state.r2.map(({ name, jurisdiction }) => ({ name, jurisdiction }))).toEqual([
        { name: expected.images, jurisdiction: 'eu' },
        { name: expected.files, jurisdiction: 'eu' },
      ]);
    });

    it('renders the environment configuration with the id Cloudflare assigned', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      const { report } = target.json(['provision', '--env', 'staging']);
      const rendered = readFileSync(join(target.root, 'wrangler.jsonc'), 'utf8');

      expect(rendered).toContain(`"name": "${expected.worker}"`);
      expect(rendered).toContain(`"database_id": "${report.databaseId}"`);
      // The binding has to repeat the jurisdiction, or the deployed Worker
      // binds a bucket that answers as if it were empty — a failure with no
      // error anywhere.
      expect(rendered).toContain('"jurisdiction": "eu"');
      expect(rendered).not.toMatch(/__[A-Z_]+__/);
    });

    it('applies the migrations to the remote database', () => {
      const target = shop();
      target.run(['provision', '--env', 'staging']);
      const applied = target.read().calls.filter(({ argv }) => argv.includes('migrations'));
      expect(applied).toHaveLength(1);
      expect(applied[0].argv).toContain('--remote');
    });

    // The Worker does not exist before the first deploy, so `secret put` has
    // nothing to attach to. Reported as pending rather than as a failure: the
    // next command in the sequence creates it.
    it('defers the internal secrets when the Worker is not deployed yet', () => {
      const target = shop();
      const { report } = target.json(['provision', '--env', 'staging']);
      expect(report.secrets.pending).toEqual(INTERNAL_SECRETS.map(([name]) => name));
      expect(report.secrets.created).toEqual([]);
      expect(report.workerDeployed).toBe(false);
    });

    it('generates the internal secrets once the Worker exists', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({ workers: [{ name: expected.worker, secrets: [] }] });

      const { report } = target.json(['provision', '--env', 'staging']);
      expect(report.secrets.created).toEqual(INTERNAL_SECRETS.map(([name]) => name));
      expect(target.read().workers[0].secrets).toEqual(INTERNAL_SECRETS.map(([name]) => name));
    });

    // Plan §5.3: transmitted on standard input, never written to disk or to a
    // log. An argument is already leaked by the time the process reads it — it
    // is in the process table and in the CI log of whatever ran the command.
    it('passes a secret on standard input and never in an argument', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({ workers: [{ name: expected.worker, secrets: [] }] });
      const result = target.run(['provision', '--env', 'staging']);

      const puts = target.read().calls.filter(({ argv }) => argv[0] === 'secret' && argv[1] === 'put');
      expect(puts).toHaveLength(INTERNAL_SECRETS.length);
      for (const call of puts) {
        expect(call.stdin.trim().length).toBeGreaterThan(0);
        expect(call.argv).not.toContain(call.stdin.trim());
        // And the value never reaches the operator's terminal either.
        expect(result.stdout).not.toContain(call.stdin.trim());
        expect(result.stderr).not.toContain(call.stdin.trim());
      }
    });
  });

  describe('a second run', () => {
    it('creates nothing and changes nothing', () => {
      const target = shop();
      expect(target.run(['provision', '--env', 'staging']).status).toBe(EXIT_CODES.ok);
      const after = target.read();

      const { report, status } = target.json(['provision', '--env', 'staging']);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.steps.every((step) => step.action === 'keep')).toBe(true);
      expect(report.databaseId).toBe(after.d1[0].uuid);

      const second = target.read();
      expect(second.d1).toEqual(after.d1);
      expect(second.r2).toEqual(after.r2);
    });

    // The one rotation that must never happen by accident: SECRETS_KEK decrypts
    // the payment keys already stored in D1. A new one would leave every one of
    // them undecryptable, and the shop would stop taking payments with no error
    // anyone could read.
    it('keeps the secrets that already exist rather than rotating them', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({ workers: [{ name: expected.worker, secrets: ['AUTH_SECRET', 'SECRETS_KEK'] }] });

      const { report } = target.json(['provision', '--env', 'staging']);
      expect(report.secrets.present).toEqual(['AUTH_SECRET', 'SECRETS_KEK']);
      expect(report.secrets.created).toEqual([]);
      expect(target.read().calls.some(({ argv }) => argv[0] === 'secret' && argv[1] === 'put')).toBe(false);
    });
  });

  // Resumption without a state file, without a --resume flag, and without a
  // mode: the second run asks the same questions and finds one more answer.
  it('resumes a run interrupted between the database and the buckets', () => {
    const target = shop();
    const expected = names(target.slug, 'staging');
    target.account({ failAt: 'r2 bucket create' });

    const interrupted = target.run(['provision', '--env', 'staging']);
    expect(interrupted.status).toBe(EXIT_CODES.external);
    const halfway = target.read();
    expect(halfway.d1).toHaveLength(1);
    expect(halfway.r2).toHaveLength(0);

    target.account({ failAt: null });
    const { report, status } = target.json(['provision', '--env', 'staging']);
    expect(status).toBe(EXIT_CODES.ok);
    expect(report.steps.map((step) => step.action)).toEqual(['keep', 'create', 'create']);
    expect(report.databaseId).toBe(halfway.d1[0].uuid);
  });

  describe('the jurisdiction is read back, not assumed', () => {
    it('confirms a bucket present in eu and absent from the default namespace', () => {
      const target = shop();
      const { report } = target.json(['provision', '--env', 'staging']);
      const bucket = report.jurisdictionChecks.find((check) => check.resource.endsWith('-files'));
      expect(bucket).toMatchObject({ expected: 'eu', ok: true });
    });

    // The shape a half-finished run leaves behind: the same name in two
    // jurisdictions. The binding picks one and nobody can say which.
    it('fails when the same bucket also exists outside the jurisdiction', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({ r2: [{ name: expected.files, jurisdiction: null, devUrl: null, domains: [] }] });

      const result = target.run(['provision', '--env', 'staging']);
      expect(result.status).toBe(EXIT_CODES.verification);
      expect(result.stdout + result.stderr).toMatch(/existe AUSSI dans la juridiction par défaut/);
    });

    // A check that reports "ok" on an absence is worse than no check. When the
    // D1 API does not publish the field, the report says so.
    it('reports an unverifiable D1 jurisdiction as unverified rather than as a pass', () => {
      const target = shop();
      target.account({ reportsD1Jurisdiction: false });
      const { report, status } = target.json(['provision', '--env', 'staging']);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.jurisdictionChecks.find((check) => check.resource.endsWith('-db'))).toMatchObject({ ok: null, reported: null });
    });
  });

  describe('the private bucket', () => {
    it('is confirmed private when nothing is attached to it', () => {
      const target = shop();
      const { report } = target.json(['provision', '--env', 'staging']);
      expect(report.exposure.files).toMatchObject({ public: false, devUrl: null, domains: [] });
    });

    it('fails the run when an r2.dev URL is open on it', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({
        r2: [
          { name: expected.images, jurisdiction: 'eu', devUrl: null, domains: [] },
          { name: expected.files, jurisdiction: 'eu', devUrl: 'https://pub-abc.r2.dev', domains: [] },
        ],
      });
      const result = target.run(['provision', '--env', 'staging']);
      expect(result.status).toBe(EXIT_CODES.verification);
      expect(result.stdout + result.stderr).toMatch(/accessible publiquement/);
      // Refused BEFORE the migrations: a run that stopped afterwards would have
      // put the shop's schema behind a public URL.
      expect(target.read().migrationsApplied ?? 0).toBe(0);
    });

    it('fails the run when a custom domain is attached to it', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({
        r2: [
          { name: expected.images, jurisdiction: 'eu', devUrl: null, domains: [] },
          { name: expected.files, jurisdiction: 'eu', devUrl: null, domains: ['fichiers.example.fr'] },
        ],
      });
      expect(target.run(['provision', '--env', 'staging']).status).toBe(EXIT_CODES.verification);
    });

    // The images bucket is the one that MAY be public: a custom domain in front
    // of it is how product images bypass the Worker. Reported, never refused.
    it('reports an images domain without refusing it', () => {
      const target = shop();
      const expected = names(target.slug, 'staging');
      target.account({
        r2: [
          { name: expected.images, jurisdiction: 'eu', devUrl: null, domains: ['images.example.fr'] },
          { name: expected.files, jurisdiction: 'eu', devUrl: null, domains: [] },
        ],
      });
      const { report, status } = target.json(['provision', '--env', 'staging']);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.exposure.images.domains).toEqual(['images.example.fr']);
    });
  });

  it('keeps staging and production in separate name families', () => {
    const target = shop();
    target.run(['provision', '--env', 'staging']);
    target.run(['provision', '--env', 'production']);
    expect(target.read().d1.map((entry) => entry.name)).toEqual([
      names(target.slug, 'staging').database,
      names(target.slug, 'production').database,
    ]);
  });
});

describe('the generated secrets', () => {
  it('are 32 bytes of platform entropy, and never the same twice', () => {
    const values = new Set(Array.from({ length: 64 }, () => generateSecret()));
    expect(values.size).toBe(64);
    expect(Buffer.from([...values][0], 'base64')).toHaveLength(32);
  });
});
