import { describe, expect, it, vi } from 'vitest';

// .mjs like its neighbours: tsconfig pins `types` to the Cloudflare types, so
// node builtins have no declarations in a .ts file here.
import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { names, shop } from '../helpers/provisioned-shop.mjs';

vi.setConfig({ testTimeout: 60_000 });

/** A shop whose staging environment exists, through the real command. */
function provisioned(env = 'staging') {
  const target = shop({ built: true });
  expect(target.run(['provision', '--env', env]).status).toBe(EXIT_CODES.ok);
  return target;
}

const CONFIRM = (target) => ['--confirm', target.slug];

describe('shopctl destroy', () => {
  it('refuses to run without --env', () => {
    const result = shop().run(['destroy']);
    expect(result.status).toBe(EXIT_CODES.usage);
    expect(result.stderr).toMatch(/--env est obligatoire/);
  });

  /**
   * The typed name is the pause this command buys.
   *
   * `--yes` becomes a reflex by the third time; a slug has to be looked up. The
   * check runs before the account is even read, so a run that was going to be
   * wrong is stopped before it has learned anything.
   */
  it('refuses without the shop’s slug typed out', () => {
    const target = provisioned();
    const result = target.run(['destroy', '--env', 'staging']);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/le slug de la boutique, saisi/);
    expect(target.read().d1).toHaveLength(1);
  });

  it('refuses a slug that names another shop', () => {
    const target = provisioned();
    const result = target.run(['destroy', '--env', 'staging', '--confirm', 'une-autre-boutique']);
    expect(result.status).toBe(EXIT_CODES.input);
    expect(result.stderr).toMatch(/ne nomme pas cette boutique/);
    expect(target.read().d1).toHaveLength(1);
  });

  // Production is where a mistake is a shop that was serving customers a minute
  // ago, so it costs a second deliberate act on top of the typed name.
  it('demands --yes on top in production', () => {
    const target = provisioned('production');
    const result = target.run(['destroy', '--env', 'production', ...CONFIRM(target)]);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/confirmation supplémentaire/);
    expect(target.read().d1).toHaveLength(1);
  });

  it('refuses the wrong Cloudflare account before reading anything', () => {
    const target = shop({ accountId: '0'.repeat(31) + '1' });
    const result = target.run(['destroy', '--env', 'staging', ...CONFIRM(target)]);
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/pas accès au compte attendu/);
  });

  describe('--dry-run', () => {
    it('lists what exists and deletes none of it', () => {
      const target = provisioned();
      const expected = names(target.slug, 'staging');
      const { report, status } = target.json(['destroy', '--env', 'staging', '--dry-run']);

      expect(status).toBe(EXIT_CODES.ok);
      expect(report.wouldRemove).toEqual([expected.images, expected.files, expected.database]);
      const state = target.read();
      expect(state.d1).toHaveLength(1);
      expect(state.r2).toHaveLength(2);
    });

    // A preview costs nothing and refusing it would only teach people to skip
    // straight to the real thing.
    it('needs no confirmation, because it changes nothing', () => {
      expect(provisioned().run(['destroy', '--env', 'staging', '--dry-run']).status).toBe(EXIT_CODES.ok);
    });
  });

  describe('a teardown', () => {
    it('removes every resource of that environment and nothing else', () => {
      const target = provisioned();
      target.run(['provision', '--env', 'production']);
      const staging = names(target.slug, 'staging');
      const production = names(target.slug, 'production');

      const { report, status } = target.json(['destroy', '--env', 'staging', ...CONFIRM(target)]);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.removed).toEqual([staging.images, staging.files, staging.database]);

      // Production is untouched: one environment is one name family.
      const state = target.read();
      expect(state.d1.map((entry) => entry.name)).toEqual([production.database]);
      expect(state.r2.map((bucket) => bucket.name)).toEqual([production.images, production.files]);
    });

    it('deletes the Worker before anything else', () => {
      const target = provisioned();
      const expected = names(target.slug, 'staging');
      target.account({ workers: [{ name: expected.worker, secrets: [], versions: [{ id: 'v1' }] }] });

      const before = target.read().calls.length;
      target.run(['destroy', '--env', 'staging', ...CONFIRM(target)]);
      const calls = target.read().calls.slice(before).map(({ argv }) => argv.join(' '));

      const worker = calls.findIndex((call) => call.startsWith('delete --name'));
      const bucket = calls.findIndex((call) => call.startsWith('r2 bucket delete'));
      const db = calls.findIndex((call) => call.startsWith('d1 delete'));
      expect(worker).toBeGreaterThan(-1);
      expect(worker).toBeLessThan(bucket);
      expect(bucket).toBeLessThan(db);
    });

    // Re-runnable: a teardown people stop finishing is worse than either state.
    it('is a no-op the second time', () => {
      const target = provisioned();
      expect(target.run(['destroy', '--env', 'staging', ...CONFIRM(target)]).status).toBe(EXIT_CODES.ok);

      const { report, status } = target.json(['destroy', '--env', 'staging', ...CONFIRM(target)]);
      expect(status).toBe(EXIT_CODES.ok);
      expect(report.removed).toEqual([]);
    });
  });

  /**
   * The one refusal that has a remedy, and the one the database is protected
   * from.
   *
   * R2 will not delete a bucket that still holds objects. Nothing empties it on
   * the operator's behalf — and because a bucket failed, the database is left
   * alone: a run that stopped here leaves something that can still be read and
   * exported, rather than buckets nothing can interpret.
   */
  describe('when a bucket is not empty', () => {
    function withObjects() {
      const target = provisioned();
      const expected = names(target.slug, 'staging');
      const state = target.read();
      target.account({
        r2: state.r2.map((bucket) => (bucket.name === expected.files ? { ...bucket, objects: 3 } : bucket)),
      });
      return target;
    }

    it('fails the run and keeps the database', () => {
      const target = withObjects();
      const expected = names(target.slug, 'staging');
      const result = target.json(['destroy', '--env', 'staging', ...CONFIRM(target)]);

      expect(result.status).toBe(EXIT_CODES.verification);
      expect(result.report.failures.map((entry) => entry.name)).toEqual([expected.files]);
      expect(target.read().d1.map((entry) => entry.name)).toEqual([expected.database]);
    });

    it('says how to empty it rather than emptying it', () => {
      const target = withObjects();
      const result = target.run(['destroy', '--env', 'staging', ...CONFIRM(target)]);
      expect(result.stdout).toMatch(/R2 refuse un bucket non vide/);
      expect(result.stdout).toMatch(/wrangler r2 object delete/);
      // Nothing was emptied on the operator's behalf.
      expect(target.read().calls.some(({ argv }) => argv.join(' ').startsWith('r2 object delete'))).toBe(false);
    });

    it('finishes the job once the blockage is lifted', () => {
      const target = withObjects();
      const expected = names(target.slug, 'staging');
      target.run(['destroy', '--env', 'staging', ...CONFIRM(target)]);

      const state = target.read();
      target.account({ r2: state.r2.map((bucket) => ({ ...bucket, objects: 0 })) });
      const { report, status } = target.json(['destroy', '--env', 'staging', ...CONFIRM(target)]);

      expect(status).toBe(EXIT_CODES.ok);
      expect(report.removed).toEqual([expected.files, expected.database]);
      expect(target.read().d1).toEqual([]);
    });
  });
});
