import { describe, expect, it, vi } from 'vitest';

// .mjs like its neighbours: tsconfig pins `types` to the Cloudflare types, so
// node builtins have no declarations in a .ts file here.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_SETTING, TOKEN_TABLE } from '../../shopctl/src/commands/admin.mjs';
import { verifyPassword } from '../../src/features/auth/password.ts';
import { ADMIN_TOKEN_TTL_SECONDS, adminTokenDigest } from '../../src/features/auth/adminToken.ts';
import { names, shop } from '../helpers/provisioned-shop.mjs';

// Each run spawns shopctl, wrangler several times, and a Node that hashes.
vi.setConfig({ testTimeout: 60_000 });

const CORE = new URL('../../', import.meta.url).pathname;
const PASSWORD = 'un mot de passe solide';

/**
 * A production provisioned on the imaginary account, with the real schema and
 * the Worker's own password and token modules — the ones `admin password`
 * hashes with and `admin token` draws with, as a shop tree carries them.
 */
function provisioned() {
  const target = shop({ migrations: true });
  for (const module of ['src/features/auth/password.ts', 'src/features/auth/adminToken.ts']) {
    mkdirSync(dirname(join(target.root, module)), { recursive: true });
    cpSync(join(CORE, module), join(target.root, module));
  }
  const result = target.run(['provision', '--env', 'production']);
  expect(result.status, result.stderr).toBe(EXIT_CODES.ok);
  return target;
}

const stored = (target) =>
  target.query(`SELECT value FROM settings WHERE key = '${PASSWORD_SETTING}'`).map((row) => row.value);

describe('shopctl admin password', () => {
  // The two minimums are one rule: a password set here that the wizard would
  // refuse is one the merchant cannot set again the same way.
  it('holds the wizard’s own minimum length', () => {
    const wizard = readFileSync(join(CORE, 'src/pages/admin/setup.astro'), 'utf8');
    expect(Number(wizard.match(/const MIN_PW = (\d+);/)?.[1])).toBe(MIN_PASSWORD_LENGTH);
  });

  it('writes a hash the Worker’s login accepts, and replaces it on a second run', async () => {
    const target = provisioned();
    const first = target.json(['admin', 'password', '--env', 'production'], {}, `${PASSWORD}\n`);
    expect(first.status, first.stderr).toBe(EXIT_CODES.ok);
    expect(first.report).toMatchObject({ command: 'admin password', env: 'production', action: 'set', setupComplete: false });
    expect(first.report.database).toBe(names(target.slug, 'production').database);

    const [hash] = stored(target);
    // The trailing newline of a file or an `echo` is not part of the password.
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}\n`, hash)).toBe(false);

    const second = target.json(['admin', 'password', '--env', 'production'], {}, 'un autre mot de passe');
    expect(second.report.action).toBe('replace');
    expect(stored(target)).toHaveLength(1);
    expect(await verifyPassword('un autre mot de passe', stored(target)[0])).toBe(true);
  });

  // shopctl refuses credentials on the command line; this is the command whose
  // whole input is one. Neither the password nor its hash reaches an argument
  // vector or the terminal — the hash is offline-guessable.
  it('never lets the password or its hash reach an argument or the output', () => {
    const target = provisioned();
    const result = target.run(['admin', 'password', '--env', 'production'], {}, PASSWORD);
    expect(result.status, result.stderr).toBe(EXIT_CODES.ok);
    const [hash] = stored(target);
    for (const { argv } of target.read().calls) {
      expect(argv.join(' ')).not.toContain(PASSWORD);
      expect(argv.join(' ')).not.toContain(hash);
    }
    expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    expect(`${result.stdout}${result.stderr}`).not.toContain(hash);
  });

  it('says the wizard now opens only after a login, while the shop is not installed', () => {
    const target = provisioned();
    const result = target.run(['admin', 'password', '--env', 'production'], {}, PASSWORD);
    expect(result.stdout).toMatch(/ne s'ouvre plus qu'après connexion/);
  });

  it('refuses a password shorter than the wizard’s minimum, before touching the account', () => {
    const target = provisioned();
    const before = target.read().calls.length;
    const result = target.run(['admin', 'password', '--env', 'production'], {}, 'court');
    expect(result.status).toBe(EXIT_CODES.input);
    expect(result.stderr).toMatch(/il en faut 8 au moins/);
    expect(target.read().calls.length).toBe(before);
  });

  it('refuses an empty standard input rather than set an empty password', () => {
    const target = provisioned();
    const result = target.run(['admin', 'password', '--env', 'production'], {}, '');
    expect(result.status).toBe(EXIT_CODES.input);
    expect(result.stderr).toMatch(/Jamais en argument/);
    expect(stored(target)).toEqual([]);
  });

  it('writes nothing under --dry-run', () => {
    const target = provisioned();
    const { report, status } = target.json(['admin', 'password', '--env', 'production', '--dry-run'], {}, PASSWORD);
    expect(status).toBe(EXIT_CODES.ok);
    expect(report.dryRun).toBe(true);
    expect(stored(target)).toEqual([]);
  });

  it('refuses to run without --env, or without a subcommand it knows', () => {
    const target = provisioned();
    expect(target.run(['admin', 'password'], {}, PASSWORD).status).toBe(EXIT_CODES.usage);
    expect(target.run(['admin'], {}, PASSWORD).status).toBe(EXIT_CODES.usage);
    expect(target.run(['admin', 'reset', '--env', 'production'], {}, PASSWORD).status).toBe(EXIT_CODES.usage);
  });

  it('refuses an environment that was never provisioned', () => {
    const target = shop({ migrations: true });
    const result = target.run(['admin', 'password', '--env', 'staging'], {}, PASSWORD);
    expect(result.status).toBe(EXIT_CODES.precondition);
  });
});

const tokens = (target) =>
  target.query(`SELECT digest, created_at, expires_at, used_at FROM ${TOKEN_TABLE} ORDER BY created_at`);

/** A production whose admin has a password, as a shop handed over has. */
function withPassword() {
  const target = provisioned();
  const result = target.run(['admin', 'password', '--env', 'production'], {}, PASSWORD);
  expect(result.status, result.stderr).toBe(EXIT_CODES.ok);
  return target;
}

describe('shopctl admin token', () => {
  it('writes the digest of a token good once for fifteen minutes, and hands the token back', async () => {
    const target = withPassword();
    const { status, stderr, report } = target.json(['admin', 'token', '--env', 'production']);
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ command: 'admin token', env: 'production', dryRun: false });
    expect(report.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(report.url).toMatch(/^https:\/\/[^/]+\/admin\/token$/);

    const [row] = tokens(target);
    expect(row.digest).toBe(await adminTokenDigest(report.token));
    expect(row.expires_at - row.created_at).toBe(ADMIN_TOKEN_TTL_SECONDS);
    expect(row.used_at).toBeNull();
    expect(new Date(report.expiresAt).getTime()).toBe(row.expires_at * 1000);
  });

  // The whole point: the agency comes in without the merchant noticing a
  // change. The password row is exactly what it was.
  it('leaves the password as it is', () => {
    const target = withPassword();
    const before = stored(target);
    expect(target.run(['admin', 'token', '--env', 'production']).status).toBe(EXIT_CODES.ok);
    expect(stored(target)).toEqual(before);
  });

  // The one value shopctl shows rather than redacts — once, at the terminal,
  // and never through an argument the account or the process table could see.
  it('shows the token once at the terminal, and never in an argument', () => {
    const target = withPassword();
    const result = target.run(['admin', 'token', '--env', 'production']);
    expect(result.status, result.stderr).toBe(EXIT_CODES.ok);
    const token = result.stdout.match(/^ {2}([A-Za-z0-9_-]{43})$/m)?.[1];
    expect(token, result.stdout).toBeTruthy();
    expect(result.stdout.split(token)).toHaveLength(2);
    expect(result.stderr).not.toContain(token);
    expect(result.stdout).toMatch(/\/admin\/token/);
    for (const { argv } of target.read().calls) expect(argv.join(' ')).not.toContain(token);
  });

  it('drops the tokens that expired unused, and keeps the used ones as the record', () => {
    const target = withPassword();
    target.query(
      `INSERT INTO ${TOKEN_TABLE} (digest, created_at, expires_at, used_at) VALUES
         ('${'a'.repeat(64)}', unixepoch() - 7200, unixepoch() - 6300, NULL),
         ('${'b'.repeat(64)}', unixepoch() - 7200, unixepoch() - 6300, unixepoch() - 7000)`,
    );
    expect(target.run(['admin', 'token', '--env', 'production']).status).toBe(EXIT_CODES.ok);
    const digests = tokens(target).map((row) => row.digest);
    expect(digests).not.toContain('a'.repeat(64));
    expect(digests).toContain('b'.repeat(64));
    expect(digests).toHaveLength(2);
  });

  it('refuses an admin without a password, where a token would open nothing', () => {
    const target = provisioned();
    const result = target.run(['admin', 'token', '--env', 'production']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/shopctl admin password --env production/);
    expect(tokens(target)).toEqual([]);
  });

  it('refuses a database the migration has not reached yet', () => {
    const target = withPassword();
    target.query(`DROP TABLE ${TOKEN_TABLE}`);
    const result = target.run(['admin', 'token', '--env', 'production']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/migration 0058/);
  });

  it('refuses a tree whose core has no token module, before touching the account', () => {
    const target = withPassword();
    rmSync(join(target.root, 'src/features/auth/adminToken.ts'));
    const before = target.read().calls.length;
    const result = target.run(['admin', 'token', '--env', 'production']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(target.read().calls.length).toBe(before);
  });

  it('writes nothing and shows no token under --dry-run', () => {
    const target = withPassword();
    const { report, status, stderr } = target.json(['admin', 'token', '--env', 'production', '--dry-run']);
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report.dryRun).toBe(true);
    expect(report.token).toBeUndefined();
    expect(tokens(target)).toEqual([]);
  });

  it('refuses to run without --env', () => {
    const target = withPassword();
    expect(target.run(['admin', 'token']).status).toBe(EXIT_CODES.usage);
    expect(target.run(['admin', 'token', 'extra', '--env', 'production']).status).toBe(EXIT_CODES.usage);
  });
});
