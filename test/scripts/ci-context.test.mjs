import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SHOP_SUITE_DAY, nightlySuite, verifyContext } from '../../scripts/ci-context.mjs';
import { discoverThemeIds, resolveConfiguredTheme } from '../../scripts/themes.mjs';

const CORE = new URL('../../', import.meta.url).pathname;
const SCRIPT = join(CORE, 'scripts/ci-context.mjs');

/**
 * What a tree runs in CI (ticket #181). The core keeps its whole coverage; a
 * shop, a private repository that pays its minutes, keeps what judges its own
 * tree. Both halves are asked here, whichever repository this suite runs in:
 * the core's CI only ever takes the core half itself, and a shop must not
 * inherit a branch nothing has run.
 */
describe('the CI context', () => {
  const THEMES = ['atelier', 'default', 'market', 'studio', 'maison'];
  const tree = (shop) => ({ shop, themes: THEMES, configured: shop ? 'maison' : 'default', shops: shop ? [] : ['canary-minimal', 'pilot-fr'] });

  it('keeps the core’s whole coverage, on every event', () => {
    for (const event of ['pull_request', 'push']) {
      expect(verifyContext({ ...tree(false), event }), event).toEqual({
        shop: false,
        browser: THEMES,
        // `verify` builds the configured theme already.
        themes: ['atelier', 'market', 'studio', 'maison'],
        shops: ['canary-minimal', 'pilot-fr'],
      });
    }
  });

  it('gives a shop the browser gate on its own theme, on a pull request only', () => {
    expect(verifyContext({ ...tree(true), event: 'pull_request' })).toEqual({ shop: true, browser: ['maison'], themes: [], shops: [] });
    // The push to `main`: `verify` alone, which no matrix carries.
    expect(verifyContext({ ...tree(true), event: 'push' })).toEqual({ shop: true, browser: [], themes: [], shops: [] });
  });

  it('runs the nightly suite every night in the core, and on Mondays or on demand in a shop', () => {
    // 2026-11-02 was a Monday.
    const day = (date) => new Date(`${date}T03:17:00Z`);
    expect(day('2026-11-02').getUTCDay()).toBe(SHOP_SUITE_DAY);
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-08']) {
      expect(nightlySuite({ shop: false, event: 'schedule', now: day(date) }), date).toBe(true);
    }
    expect(nightlySuite({ shop: true, event: 'schedule', now: day('2026-11-02') })).toBe(true);
    expect(nightlySuite({ shop: true, event: 'schedule', now: day('2026-11-03') })).toBe(false);
    expect(nightlySuite({ shop: true, event: 'schedule', now: day('2026-11-08') })).toBe(false);
    // GitHub starts the 03:17 run hours late at times: still the same UTC day.
    expect(nightlySuite({ shop: true, event: 'schedule', now: new Date('2026-11-02T09:05:00Z') })).toBe(true);
    expect(nightlySuite({ shop: true, event: 'workflow_dispatch', now: day('2026-11-03') })).toBe(true);
  });

  // The script itself, as the workflow runs it: a process in a tree, writing
  // $GITHUB_OUTPUT. A core tree, and a shop tree holding a witness manifest.
  describe('read off a tree', () => {
    const roots = [];
    afterAll(() => {
      // The links go, never what they point at.
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    });

    // The configured theme of THIS tree, so the fixture builds wherever the
    // suite runs: a shop may have dropped a shipped theme.
    const configured = resolveConfiguredTheme(CORE).id;
    const makeTree = (shop) => {
      const root = mkdtempSync(join(tmpdir(), `ci-context-${shop ? 'shop' : 'core'}-`));
      roots.push(root);
      for (const entry of ['src', 'package.json']) symlinkSync(join(CORE, entry), join(root, entry));
      mkdirSync(join(root, 'test/fixtures'), { recursive: true });
      symlinkSync(join(CORE, 'test/fixtures/clients'), join(root, 'test/fixtures/clients'));
      writeFileSync(join(root, 'theme.config.json'), `${JSON.stringify({ theme: configured })}\n`);
      if (shop) {
        mkdirSync(join(root, 'client'));
        copyFileSync(join(CORE, 'test/fixtures/clients/canary-minimal/client.yaml'), join(root, 'client/client.yaml'));
      }
      return root;
    };
    const run = (root, ...args) => {
      const output = join(root, `output-${args.join('-')}`);
      const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      return { stdout: result.stdout, output: readFileSync(output, 'utf8') };
    };

    it('lists every theme and every witness shop in the core', () => {
      const root = makeTree(false);
      const themes = discoverThemeIds(root);
      expect(themes).toContain(configured);
      for (const event of ['pull_request', 'push']) {
        const { stdout, output } = run(root, 'verify', '--event', event);
        expect(output, event).toBe(
          [
            'shop=false',
            `browser=${JSON.stringify(themes)}`,
            `themes=${JSON.stringify(themes.filter((id) => id !== configured))}`,
            'shops=["canary-minimal","pilot-fr"]',
            '',
          ].join('\n'),
        );
        expect(stdout, event).not.toMatch(/::notice::/);
      }
      expect(run(root, 'nightly', '--event', 'schedule').output).toBe('suite=true\n');
    });

    it('leaves a shop its own theme on a pull request, and `verify` alone on main', () => {
      const root = makeTree(true);
      const pullRequest = run(root, 'verify', '--event', 'pull_request');
      expect(pullRequest.output).toBe(`shop=true\nbrowser=${JSON.stringify([configured])}\nthemes=[]\nshops=[]\n`);
      // Said in the run, rather than jobs that vanish without a word.
      expect(pullRequest.stdout).toMatch(new RegExp(`::notice::Boutique : verify, File ownership et Browser \\(${configured}\\)`));
      const push = run(root, 'verify', '--event', 'push');
      expect(push.output).toBe('shop=true\nbrowser=[]\nthemes=[]\nshops=[]\n');
      expect(push.stdout).toMatch(/::notice::Boutique : verify seul hors pull request/);
      expect(run(root, 'nightly', '--event', 'workflow_dispatch').output).toBe('suite=true\n');
    });

    it('refuses to guess the event', () => {
      const result = spawnSync(process.execPath, [SCRIPT, 'verify'], { cwd: CORE, encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/Usage:/);
    });
  });
});

/**
 * verify.yml, read as text like nightly.test.mjs reads its file: which job
 * follows the context, and which never asks it.
 */
describe('the Verify workflow', () => {
  const workflow = readFileSync(join(CORE, '.github/workflows/verify.yml'), 'utf8');
  const section = workflow.slice(workflow.indexOf('\njobs:\n'));
  const jobs = Object.fromEntries(
    [...section.matchAll(/^ {2}([a-z-]+):\n((?: {4}.*\n|\s*\n)+)/gm)].map(([, name, body]) => [name, body]),
  );
  const condition = (job) => jobs[job].match(/^ {4}if: (.*)$/m)?.[1] ?? '';

  it('reads the tree once, first, and lists nothing itself', () => {
    expect(Object.keys(jobs)).toEqual(['context', 'verify-first-runner', 'verify', 'paths', 'clean-clone', 'generated-shop', 'shops', 'browser', 'themes']);
    expect(workflow).not.toMatch(/needs: discover/);
    // The event reaches the script through `env:`, never substituted into it.
    expect(jobs.context).toMatch(/EVENT: \$\{\{ github\.event_name \}\}\n\s+run: node scripts\/ci-context\.mjs verify --event "\$EVENT"\n/);
    for (const output of ['shop', 'browser', 'themes', 'shops']) {
      expect(jobs.context).toContain(`${output}: \${{ steps.context.outputs.${output} }}`);
    }
  });

  it('runs `verify` everywhere and on every event', () => {
    expect(condition('verify-first-runner')).toBe('');
    expect(condition('verify')).toBe('always()');
    expect(condition('paths')).toBe("github.event_name == 'pull_request'");
  });

  it('keeps the core’s own jobs to the core', () => {
    for (const job of ['clean-clone', 'generated-shop']) {
      expect(jobs[job], job).toMatch(/^ {4}needs: context$/m);
      expect(condition(job), job).toBe("needs.context.outputs.shop != 'true'");
    }
    for (const [job, output] of [['shops', 'shops'], ['browser', 'browser'], ['themes', 'themes']]) {
      expect(jobs[job], job).toMatch(/^ {4}needs: context$/m);
      expect(condition(job), job).toBe(`needs.context.outputs.${output} != '[]'`);
      expect(jobs[job], job).toContain(`\${{ fromJSON(needs.context.outputs.${output}) }}`);
    }
  });

  // The shop half, run in a real shop by the core's own CI.
  it('asks the generated shop what its own Verify runs, on both events', () => {
    const shop = jobs['generated-shop'];
    const step = shop.slice(shop.indexOf("- name: Ask what the shop's own Verify runs"));
    expect(step.indexOf('ci-context.mjs verify --event pull_request')).toBeGreaterThan(-1);
    expect(step.indexOf('ci-context.mjs verify --event push')).toBeGreaterThan(-1);
    expect(step.indexOf('working-directory: ${{ runner.temp }}/generated-shop')).toBeGreaterThan(-1);
    expect(shop.indexOf("- name: Ask what the shop's own Verify runs")).toBeLessThan(shop.indexOf("- name: Run the shop's deterministic gates"));
  });
});
