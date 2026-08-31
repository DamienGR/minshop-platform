import { describe, expect, it } from 'vitest';

// Deliberately .mjs, not .ts, for the same reason as the other tests in this
// directory: tsconfig's `types` is pinned to the Cloudflare types, so node
// builtins have no declarations and a .ts file here fails `astro check`.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { parseManifestYaml } from '../../scripts/manifest-yaml.mjs';
import {
  CROSS_FIELD_RULES,
  RESERVED_SLUGS,
  SCHEMA_VERSION,
  checkCoreCompatibility,
  manifestFieldPaths,
  manifestJsonSchema,
  validateManifest,
} from '../../scripts/manifest-schema.mjs';
import {
  coreVersion,
  detectFleetCollisions,
  discoverManifests,
  isShopRepository,
  loadManifest,
  resourceNames,
  wranglerSubstitutions,
} from '../../scripts/manifest.mjs';
import { isValidThemeId } from '../../scripts/themes.mjs';

const root = new URL('../../', import.meta.url).pathname;
const fixture = (slug) => `test/fixtures/clients/${slug}/client.yaml`;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

/** A valid manifest to mutate. Parsed from the shipped fixture rather than
 *  written inline: a test that invents its own valid shape stops noticing the
 *  day the fixture drifts away from the schema. */
const base = () => parseManifestYaml(read(fixture('pilot-fr')), { file: 'pilot-fr' });

const messages = (result) => result.errors.map((e) => `${e.path} ${e.message}`).join('\n');

describe('manifest YAML reader', () => {
  it('reads the manifest shape: nested sections, scalars, comments', () => {
    const parsed = base();
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.coreVersion).toBe('0.1.0');
    expect(parsed.client.slug).toBe('pilot-fr');
    expect(parsed.commerce.pricesIncludeTax).toBe(true);
    expect(parsed.commerce.defaultVatRate).toBe(20);
    // The trailing comment on the theme line is not part of the value.
    expect(parsed.theme.id).toBe('atelier');
  });

  it('keeps a # inside quotes and drops one that starts a comment', () => {
    const parsed = parseManifestYaml('a: "lot #3"  # a comment\nb: plain\n');
    expect(parsed).toEqual({ a: 'lot #3', b: 'plain' });
  });

  // The Norway problem: a full YAML 1.1 reader turns `NO` into false. Reading
  // it as the string would disagree with every editor plugin looking at the
  // same file, so neither reading is offered.
  it.each(['no', 'NO', 'yes', 'off', 'null', '~'])('refuses the ambiguous bare word %s', (word) => {
    expect(() => parseManifestYaml(`market: ${word}\n`)).toThrow(/different YAML readers resolve differently/);
  });

  it.each([
    ['a sequence', 'items:\n  - one\n', /sequence/],
    ['an anchor', 'a: &ref value\n', /anchor/],
    ['a flow mapping', 'a: { b: c }\n', /flow mapping/],
    ['a block scalar', 'a: |\n  text\n', /block scalar/],
    ['a document marker', '---\na: b\n', /document marker/],
    ['a tab', 'a:\n\tb: c\n', /tab/],
    ['an odd indent', 'a:\n   b: c\n', /indents 2 spaces per level/],
  ])('refuses %s', (_label, text, pattern) => {
    expect(() => parseManifestYaml(text)).toThrow(pattern);
  });

  // A repeated key is the one malformed input a permissive reader accepts
  // silently, and it discards the value the author most likely meant.
  it('refuses a repeated key and names both lines', () => {
    expect(() => parseManifestYaml('client:\n  slug: a\n  slug: b\n')).toThrow(/"client.slug" is set twice \(first at line 2\)/);
  });

  it('reports the line number of a syntax error', () => {
    expect(() => parseManifestYaml('a: 1\nb 2\n', { file: 'client.yaml' })).toThrow(/^client\.yaml:2:/);
  });
});

describe('manifest schema', () => {
  it('accepts both witness manifests as shipped', () => {
    for (const slug of ['pilot-fr', 'canary-minimal']) {
      const result = loadManifest(fixture(slug), { root });
      expect(messages(result.errors.length ? result : { errors: [] })).toBe('');
      expect(result.errors).toEqual([]);
    }
  });

  it('refuses an unknown field, wherever it sits', () => {
    const root = validateManifest({ ...base(), stripeKey: 'x' });
    expect(root.ok).toBe(false);
    expect(messages(root)).toMatch(/stripeKey is not a field of the manifest/);

    const nested = base();
    nested.client.lang = 'fr';
    expect(messages(validateManifest(nested))).toMatch(/client\.lang is not a field of client/);
  });

  it('refuses a missing field and says what it is for', () => {
    const m = base();
    delete m.cloudflare.jurisdiction;
    expect(messages(validateManifest(m))).toMatch(/cloudflare\.jurisdiction is required \(D1 and R2 jurisdiction/);
  });

  // Every one of these becomes a directory name, a resource name, and a URL
  // component. A slug that escaped the pattern would escape all three.
  it.each([
    ['a traversal', '../etc'],
    ['a slash', 'pilot/fr'],
    ['a leading dash', '-pilot'],
    ['a trailing dash', 'pilot-'],
    ['a double dash', 'pilot--fr'],
    ['uppercase', 'Pilot'],
    ['a space', 'pilot fr'],
    ['a dot', 'pilot.fr'],
    ['unicode', 'boutiqué'],
    ['too short', 'ab'],
  ])('refuses %s as a slug', (_label, slug) => {
    const m = base();
    m.client.slug = slug;
    m.cloudflare.workerName = `minshop-${slug}`;
    expect(validateManifest(m).ok).toBe(false);
  });

  it.each(RESERVED_SLUGS)('refuses the reserved slug %s', (slug) => {
    const m = base();
    m.client.slug = slug;
    m.cloudflare.workerName = `minshop-${slug}`;
    const result = validateManifest(m);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.rule === 'slug-not-reserved')).toBe(true);
  });

  it('requires the worker name to follow the slug', () => {
    const m = base();
    m.cloudflare.workerName = 'minshop-something-else';
    const result = validateManifest(m);
    expect(result.errors[0].rule).toBe('worker-name-follows-slug');
    expect(messages(result)).toMatch(/makes it "minshop-pilot-fr"/);
  });

  it.each([
    ['customer accounts under guest checkout', (m) => { m.features.customerAccounts = true; }, 'guest-checkout-has-no-accounts'],
    ['tax-exclusive prices on the French market', (m) => { m.commerce.pricesIncludeTax = false; }, 'french-prices-include-tax'],
    ['an out-of-scope feature', (m) => { m.features.semanticSearch = true; }, 'out-of-scope-features-off'],
    ['a platform subdomain in production', (m) => { m.cloudflare.productionDomain = 'pilot-fr.workers.dev'; }, 'production-domain-is-custom'],
  ])('refuses %s', (_label, mutate, rule) => {
    const m = base();
    mutate(m);
    const result = validateManifest(m);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain(rule);
  });

  // Closing the schema stops an invented `stripeKey:`; this catches the other
  // shape, a credential pasted into a field that IS allowed.
  it.each([
    ['a Stripe key', 'sk_live_51HxxxxxxxxxxxxxxxxYY'], // secret-scan:ignore — a shape, not a key
    ['a webhook secret', 'whsec_abcdefghijklmnop'],
    ['a Resend key', 're_abcdefghijklmnopqrstu'],
  ])('refuses %s in an allowed field', (_label, secret) => {
    const m = base();
    m.client.displayName = `Boutique ${secret}`;
    const result = validateManifest(m);
    expect(result.errors.map((e) => e.rule)).toContain('no-credentials');
  });

  it('reports structural errors before cross-field rules', () => {
    // A rule reading m.client.slug on a manifest with no client section would
    // report a second failure for the same cause.
    const result = validateManifest({ schemaVersion: 1 });
    expect(result.errors.every((e) => e.rule === undefined)).toBe(true);
  });
});

describe('core compatibility', () => {
  it('accepts a manifest at the core version', () => {
    expect(checkCoreCompatibility('0.1.0', '0.1.0')).toBeNull();
  });

  it('accepts an older patch of the same pre-1.0 minor', () => {
    expect(checkCoreCompatibility('0.1.0', '0.1.4')).toBeNull();
  });

  // Before 1.0 a minor bump is the breaking one, which is the accurate reading
  // while the migration notes of plan §9 do not exist yet.
  it('refuses a different pre-1.0 minor', () => {
    expect(checkCoreCompatibility('0.1.0', '0.2.0').message).toMatch(/does not support/);
  });

  it('accepts any older minor once the core is stable', () => {
    expect(checkCoreCompatibility('1.0.0', '1.4.2')).toBeNull();
    expect(checkCoreCompatibility('1.0.0', '2.0.0').message).toMatch(/does not support/);
  });

  // Drift the other way: the manifest arrived without the code it describes.
  it('refuses a manifest ahead of its core', () => {
    expect(checkCoreCompatibility('0.2.0', '0.1.0').message).toMatch(/ahead of the code/);
  });

  it('holds the witness fixtures to the core version in package.json', () => {
    for (const slug of ['pilot-fr', 'canary-minimal']) {
      const m = parseManifestYaml(read(fixture(slug)), { file: slug });
      expect(checkCoreCompatibility(m.coreVersion, coreVersion(root))).toBeNull();
    }
  });
});

describe('fleet identifiers', () => {
  it('derives every resource name from the worker name', () => {
    expect(resourceNames(base())).toEqual({
      worker: 'minshop-pilot-fr',
      database: 'minshop-pilot-fr-db',
      images: 'minshop-pilot-fr-images',
      files: 'minshop-pilot-fr-files',
      sessions: 'minshop-pilot-fr-session',
    });
  });

  it('renders the wrangler substitutions from the manifest alone', () => {
    expect(wranglerSubstitutions(base())).toEqual({
      __NAME__: 'minshop-pilot-fr',
      __DB_NAME__: 'minshop-pilot-fr-db',
      __DB_ID__: '00000000-0000-0000-0000-000000000000',
      __BUCKET__: 'minshop-pilot-fr-images',
      __FILES_BUCKET__: 'minshop-pilot-fr-files',
    });
  });

  it('sees no shared identifier among the shops of this tree', () => {
    const entries = discoverManifests(root).map((file) => loadManifest(file, { root }));
    expect(entries.flatMap((e) => e.errors)).toEqual([]);
    expect(detectFleetCollisions(entries)).toEqual([]);
  });

  // Nothing at runtime keeps two shops' data apart (ADR 0001). A duplicated
  // D1 name is one provisioning run away from one shop's orders landing in
  // another's, so the names are where it has to be caught.
  it('detects a duplicated resource across two manifests', () => {
    const a = { file: 'a.yaml', manifest: base() };
    const b = { file: 'b.yaml', manifest: base() };
    const collisions = detectFleetCollisions([a, b]);
    expect(collisions.map((c) => c.kind)).toEqual([
      'slug',
      'worker',
      'D1 database',
      'images bucket',
      'files bucket',
      'sessions KV',
      'production domain',
    ]);
    expect(collisions[0].files).toEqual(['a.yaml', 'b.yaml']);
  });

  it('detects a shared production domain between otherwise distinct shops', () => {
    const a = { file: 'a.yaml', manifest: base() };
    const b = { file: 'b.yaml', manifest: base() };
    b.manifest.client.slug = 'other-shop';
    b.manifest.cloudflare.workerName = 'minshop-other-shop';
    expect(detectFleetCollisions([a, b])).toEqual([
      { kind: 'production domain', value: 'pilote.example.fr', files: ['a.yaml', 'b.yaml'] },
    ]);
  });
});

describe('the two witness shops differ', () => {
  const shops = ['pilot-fr', 'canary-minimal'].map((slug) => loadManifest(fixture(slug), { root }).manifest);

  // The exit criterion of jalon 1 is that two DIFFERENT shops build from one
  // core. Fixtures that agreed on everything would pass every check above
  // while proving nothing.
  it('compiles different designs', () => {
    expect(shops[0].theme.id).not.toBe(shops[1].theme.id);
  });

  it('disagrees on the features the core is supposed to switch', () => {
    expect(shops[0].features.promoCodes).not.toBe(shops[1].features.promoCodes);
    expect(shops[0].features.shipping).not.toBe(shops[1].features.shipping);
    expect(shops[0].commerce.invoiceStrategy).not.toBe(shops[1].commerce.invoiceStrategy);
  });

  it('names a documentation domain, never a real one', () => {
    // RFC 2606: example.fr / example.org can never be registered by anyone.
    for (const shop of shops) {
      expect(shop.cloudflare.productionDomain).toMatch(/\.example\.(fr|org|com|net)$/);
      expect(shop.email.from).toMatch(/@[a-z-]+\.example\.(fr|org|com|net)$/);
    }
  });
});

describe('published JSON Schema', () => {
  it('is the file the spec generates', () => {
    // The drift check itself lives in check-manifest.mjs; this pins that the
    // committed file is what an editor would validate against today.
    const committed = JSON.parse(read(`schemas/client-${SCHEMA_VERSION}.schema.json`));
    expect(committed).toEqual(manifestJsonSchema());
  });

  it('closes every mapping and requires every field', () => {
    const schema = manifestJsonSchema();
    const check = (node) => {
      expect(node.additionalProperties).toBe(false);
      expect(node.required.sort()).toEqual(Object.keys(node.properties).sort());
      for (const child of Object.values(node.properties)) if (child.type === 'object') check(child);
    };
    check(schema);
    expect(schema.properties.client.properties.slug.pattern).toBeTruthy();
  });

  it('lists the rules it cannot express, so a generic validator is not mistaken for the gate', () => {
    expect(manifestJsonSchema()['x-crossFieldRules'].map((r) => r.id)).toEqual(CROSS_FIELD_RULES.map((r) => r.id));
    expect(manifestJsonSchema().$comment).toMatch(/enforced by validateManifest/);
  });

  it('describes every field it publishes', () => {
    const schema = manifestJsonSchema();
    const described = (node, prefix = []) =>
      Object.entries(node.properties).flatMap(([key, child]) => {
        expect(child.description, [...prefix, key].join('.')).toBeTruthy();
        return child.type === 'object' ? described(child, [...prefix, key]) : [[...prefix, key].join('.')];
      });
    expect(described(schema)).toEqual(manifestFieldPaths());
  });
});

describe('theme id agreement', () => {
  // The manifest's theme.id becomes a directory name under src/themes/, so the
  // pattern published in the schema and the one themes.mjs enforces have to be
  // the same rule. Two readers of one identifier eventually disagree.
  it.each([
    ['pilot-fr', true],
    ['default', true],
    ['a', true],
    ['My-Theme', false],
    ['-lead', false],
    ['trail-', false],
    ['two--dashes', false],
    ['dot.theme', false],
    ['', false],
  ])('agrees with themes.mjs on %s', (id, expected) => {
    const pattern = new RegExp(manifestJsonSchema().properties.theme.properties.id.pattern);
    expect(pattern.test(id) && id.length <= 40).toBe(expected);
    expect(isValidThemeId(id)).toBe(expected);
  });

  // Only the tree knows what is on disk, so this one is caught by loadManifest
  // rather than by the schema: the manifest below is perfectly well-formed.
  it('refuses a theme with no directory in this tree', () => {
    const text = read(fixture('pilot-fr')).replace(/id: atelier.*/, 'id: no-such-theme');
    expect(validateManifest(parseManifestYaml(text)).ok).toBe(true);

    const file = join(mkdtempSync(join(tmpdir(), 'minshop-manifest-')), 'client.yaml');
    writeFileSync(file, text);
    // Absolute file, this tree's root: the theme is looked up in src/themes/ here.
    const { errors } = loadManifest(file, { root, core: coreVersion(root) });
    expect(errors).toHaveLength(1);
    expect(errors[0].rule).toBe('theme-exists');
    expect(errors[0].message).toMatch(/no directory at src\/themes\/no-such-theme/);
  });
});

// Reason one of RESERVED_SLUGS: the storefront's own URL space. Derived from
// src/pages/ rather than maintained by hand, because a hand-kept copy of a
// directory listing is a copy that falls behind the day a route is added — and
// the shop that took the freed name would only find out in production.
describe('reserved slugs', () => {
  const routePrefixes = () =>
    readdirSync(new URL('../../src/pages/', import.meta.url), { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && !entry.name.includes('.test.'))
      // `cart.astro`, `llms.txt.ts` and `sitemap.xml.ts` all serve a path named
      // by the part before the first dot; a directory names itself.
      .map((entry) => entry.name.split('.')[0])
      // `404` is not a slug shape, so no shop can collide with it.
      .filter((name) => /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name));

  it('covers every public route prefix', () => {
    const unreserved = routePrefixes().filter((name) => !RESERVED_SLUGS.includes(name));
    expect(unreserved).toEqual([]);
  });

  it('is sorted, so a reader can find a name in it', () => {
    expect(RESERVED_SLUGS).toEqual([...RESERVED_SLUGS].sort());
  });
});

describe('config:validate', () => {
  // This suite is core-owned, so it is SHIPPED into every generated shop and
  // runs there unchanged (`shopctl new` … `npm run verify`). A shop's tree
  // describes one manifest more than the core's — its own — so the property is
  // that the witnesses are still there and still pass, never that they are the
  // only shops in the tree. A test that pinned the count would fail in every
  // shop the platform ever creates, and the failure would look like the shop's
  // fault.
  it('passes over this tree and reports the witness shops', () => {
    const out = execFileSync('node', ['scripts/check-manifest.mjs', '--json'], { cwd: root, encoding: 'utf8' });
    const report = JSON.parse(out);
    expect(report.ok).toBe(true);
    expect(report.repository).toBe(isShopRepository(root) ? 'shop' : 'core');
    expect(report.manifests.map((m) => m.slug)).toEqual(expect.arrayContaining(['canary-minimal', 'pilot-fr']));
    expect(report.collisions).toEqual([]);
  });
});
