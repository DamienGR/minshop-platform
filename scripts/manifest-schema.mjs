/**
 * The client manifest contract: field spec, validator, and the JSON Schema
 * published for editors.
 *
 * ONE source of truth. The spec below is the authority; the JSON Schema under
 * schemas/ is generated from it and checked for drift in CI. Hand-writing both
 * would eventually let a field the validator rejects be advertised as valid by
 * the editor tooling, and the merchant would believe the editor.
 *
 * What lives here is only what a schema can decide from the file alone.
 * Anything needing the tree (does this theme directory exist?) or the fleet
 * (is this worker name already taken?) is in manifest.mjs, which composes both.
 *
 * Narrow on purpose. `locale`, `currency`, `market` and `jurisdiction` each
 * accept exactly one value today, because the pilot is B2C France on the EU
 * jurisdiction (plan §2). Widening any of them is a schema-version decision
 * with migration notes, not a value a store can set on its own — which is the
 * difference between a supported market and an untested one.
 */

/** Bumped when a released manifest stops validating unchanged. */
export const SCHEMA_VERSION = 1;

/** Prefix every Cloudflare resource of a shop carries. Fixed, not configurable:
 *  it is what makes an account listing readable and what destroy-cf.sh keys on. */
export const RESOURCE_PREFIX = 'minshop';

const SLUG = '^[a-z][a-z0-9]*(-[a-z0-9]+)*$';
const SEMVER = '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';
const WORKER_NAME = `^${RESOURCE_PREFIX}-[a-z][a-z0-9]*(-[a-z0-9]+)*$`;
const DOMAIN = '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
const EMAIL = '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$';
/** Mirrors isValidThemeId() in themes.mjs; manifest-schema.test.mjs pins the
 *  two together, because the id here becomes the directory name there. */
const THEME_ID = '^[a-z][a-z0-9]*(-[a-z0-9]+)*$';

/**
 * Slugs a shop may not take.
 *
 * Four reasons, all of them "the name is already load-bearing somewhere".
 *
 * PUBLIC ROUTES. `/products/`, `/cart`, `/pay/` and their neighbours are the
 * storefront's own URL space. This group is not maintained by hand — the test
 * "every public route prefix is a reserved slug" derives it from `src/pages/`
 * and fails when a route is added without reserving its name.
 *
 * PLATFORM RESOURCES AND ENVIRONMENTS. The names the fleet tooling greps for
 * and the words its reports print. A shop that took one would work until the
 * day an operator read `minshop-staging-db` as an environment rather than a
 * customer.
 *
 * CORE TOOLING VOCABULARY — `check`, `mcp`. The core writes these into its own
 * workflows and scripts (`minshop-check`, `minshop-mcp`), and the
 * core-neutrality gate fails on any core file containing a shop's slug or
 * worker name. `db` belongs to the same group and is deliberately absent: the
 * three-character minimum already refuses it, and a second rule saying the same
 * thing only makes the first one look optional.
 *
 * DOCUMENTATION NAMES — `acme`, `example`. Same mechanism: the read-me writes
 * `shopctl new acme` to show what the command looks like. Whoever picked it for
 * a real customer would get a baffling failure in a file they never touched, so
 * the documentation's names are reserved the way RFC 2606 reserves example.com.
 *
 * The list can never be complete — the gate also trips on ordinary English the
 * core happens to use — so `shopctl new` reads the gate's report and tells the
 * operator to choose another slug rather than blaming the core. Reserving the
 * known names only makes that failure arrive earlier, before anything is
 * cloned.
 */
export const RESERVED_SLUGS = [
  'account', 'acme', 'admin', 'agency', 'api', 'assets', 'cart', 'categories',
  'category', 'cdn', 'check', 'checkout', 'core', 'default', 'dev',
  'example', 'express', 'files', 'fleet', 'images', 'index', 'internal', 'llms',
  'local', 'mail', 'mcp', 'minshop', 'order', 'pages', 'partials', 'pay',
  'payment-setup', 'platform', 'preview', 'prod', 'product', 'production',
  'products', 'robots', 'search', 'shop', 'sitemap', 'staging', 'store',
  'support', 'test', 'www',
];

/**
 * The fields, in the order they appear in the file.
 *
 * `kind: 'section'` nests; everything else is a leaf with a JSON Schema
 * fragment. Every mapping is closed (additionalProperties: false) — see the
 * `no-credentials` rule for why that is the primary defence against a secret
 * landing in a file that gets committed.
 */
export const MANIFEST_SPEC = {
  schemaVersion: {
    schema: { type: 'integer', enum: [SCHEMA_VERSION] },
    description: 'Version of this manifest format. Bumped only by the core.',
  },
  coreVersion: {
    schema: { type: 'string', pattern: SEMVER },
    description: 'Core version (SemVer tag) this shop was cloned from or last upgraded to.',
  },
  client: {
    kind: 'section',
    description: 'Who the shop is.',
    fields: {
      slug: {
        schema: { type: 'string', pattern: SLUG, minLength: 3, maxLength: 32 },
        description: 'Fleet-wide identifier. Becomes part of every Cloudflare resource name.',
      },
      displayName: {
        schema: { type: 'string', minLength: 2, maxLength: 60 },
        description: 'Human name of the shop, as shown to operators.',
      },
      locale: { schema: { type: 'string', enum: ['fr-FR'] }, description: 'Storefront locale. Single-valued while the offer is France-only.' },
      timezone: { schema: { type: 'string', enum: ['Europe/Paris'] }, description: 'Business time zone used for order timestamps and reports.' },
      currency: { schema: { type: 'string', enum: ['EUR'] }, description: 'Settlement currency. Multi-currency is out of scope.' },
    },
  },
  commerce: {
    kind: 'section',
    description: 'How the shop sells.',
    fields: {
      market: { schema: { type: 'string', enum: ['FR'] }, description: 'Market the shop is certified for.' },
      pricesIncludeTax: { schema: { type: 'boolean' }, description: 'Whether catalogue prices are tax-inclusive (TTC).' },
      checkoutMode: { schema: { type: 'string', enum: ['guest'] }, description: 'Checkout mode. Guest-only until customer accounts are certified.' },
      defaultVatRate: {
        schema: { type: 'number', enum: [20, 10, 5.5, 2.1] },
        description: 'Default French VAT rate applied when a product declares none.',
      },
      invoiceStrategy: {
        schema: { type: 'string', enum: ['pending-validation', 'stripe-receipt', 'invoice'] },
        description: 'Billing document strategy. `pending-validation` means the accounting review of plan §6 (jalon 3) has not happened yet.',
      },
    },
  },
  features: {
    kind: 'section',
    description: 'Feature switches decided at build time. Runtime toggles live in Admin → Settings.',
    fields: {
      customerAccounts: { schema: { type: 'boolean' }, description: 'Customer accounts on the storefront.' },
      semanticSearch: { schema: { type: 'boolean' }, description: 'Vector search. Out of scope for the pilot (plan §2.2).' },
      digitalProducts: { schema: { type: 'boolean' }, description: 'Downloadable products served from the private bucket.' },
      promoCodes: { schema: { type: 'boolean' }, description: 'Stripe promotion codes at checkout.' },
      shipping: { schema: { type: 'boolean' }, description: 'Physical shipping and its rate table.' },
    },
  },
  cloudflare: {
    kind: 'section',
    description: 'Runtime home of the shop. Every name here is account-visible.',
    fields: {
      jurisdiction: { schema: { type: 'string', enum: ['eu'] }, description: 'D1 and R2 jurisdiction. EU-only while the offer is French (ADR 0004).' },
      workerName: {
        schema: { type: 'string', pattern: WORKER_NAME, minLength: 3, maxLength: 54 },
        description: 'Worker name, and the stem of every other resource name. Must be `minshop-<slug>`.',
      },
      productionDomain: {
        schema: { type: 'string', pattern: DOMAIN, minLength: 4, maxLength: 253 },
        description: 'Custom production domain of the storefront.',
      },
    },
  },
  email: {
    kind: 'section',
    description: 'Transactional email.',
    fields: {
      provider: { schema: { type: 'string', enum: ['resend'] }, description: 'Email provider. Credentials never appear here.' },
      from: { schema: { type: 'string', pattern: EMAIL, maxLength: 254 }, description: 'Envelope sender for order email.' },
    },
  },
  theme: {
    kind: 'section',
    description: 'Which design this shop compiles.',
    fields: {
      id: {
        schema: { type: 'string', pattern: THEME_ID, minLength: 1, maxLength: 40 },
        description: 'Theme id, matching a directory under src/themes/.',
      },
    },
  },
};

/**
 * What a credential looks like, and what to call it.
 *
 * Shared rather than private to the `no-credentials` rule below, because the
 * same question is asked in two places: of a manifest value about to be
 * committed, and of a CLI argument about to be logged (shopctl/src/secrets.mjs).
 * Two lists would drift, and the one that drifted would be whichever is read
 * less often — which is the one guarding the value nobody reviewed.
 *
 * Anchored where a whole value is the only meaningful match: an unanchored
 * 40-hex-character rule would fire on any long identifier inside a sentence.
 */
export const CREDENTIAL_PATTERNS = [
  { pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/, what: 'a Stripe API key' },
  { pattern: /\bwhsec_[A-Za-z0-9]+/, what: 'a Stripe webhook secret' },
  { pattern: /\bre_[A-Za-z0-9]{16,}/, what: 'a Resend API key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key' },
  { pattern: /\bghp_[A-Za-z0-9]{20,}/, what: 'a GitHub token' },
  { pattern: /^[A-Fa-f0-9]{40,}$/, what: 'what looks like a hex-encoded secret' },
];

/**
 * Rules a JSON Schema cannot express, because they relate two fields.
 *
 * Each one is a named function so a failure says WHICH invariant broke rather
 * than "does not match schema". The names are stable: they are what the CLI
 * reports and what an operator greps for.
 */
export const CROSS_FIELD_RULES = [
  {
    id: 'worker-name-follows-slug',
    description: 'cloudflare.workerName must be `minshop-<client.slug>`.',
    check(m) {
      const expected = `${RESOURCE_PREFIX}-${m.client?.slug}`;
      if (m.cloudflare?.workerName !== expected) {
        return {
          path: 'cloudflare.workerName',
          message: `is "${m.cloudflare?.workerName}"; the naming convention makes it "${expected}". Every other resource name is derived from it, so a divergence would split one shop across two name families.`,
        };
      }
      return null;
    },
  },
  {
    id: 'slug-not-reserved',
    description: 'client.slug must not be a name the platform already uses.',
    check(m) {
      if (RESERVED_SLUGS.includes(m.client?.slug)) {
        return {
          path: 'client.slug',
          message: `is "${m.client.slug}", which is reserved by the platform (route prefix, resource family, or environment word). Reserved: ${RESERVED_SLUGS.join(', ')}.`,
        };
      }
      return null;
    },
  },
  {
    id: 'guest-checkout-has-no-accounts',
    description: 'A guest-only checkout cannot advertise customer accounts.',
    check(m) {
      if (m.commerce?.checkoutMode === 'guest' && m.features?.customerAccounts === true) {
        return {
          path: 'features.customerAccounts',
          message: 'is true while commerce.checkoutMode is "guest". The storefront would render an account area that no checkout ever populates.',
        };
      }
      return null;
    },
  },
  {
    id: 'french-prices-include-tax',
    description: 'The French B2C market sells at tax-inclusive prices.',
    check(m) {
      if (m.commerce?.market === 'FR' && m.commerce?.pricesIncludeTax !== true) {
        return {
          path: 'commerce.pricesIncludeTax',
          message: 'is false for market FR. French B2C prices are displayed TTC (plan §2.1); a tax-exclusive catalogue would under-display every price.',
        };
      }
      return null;
    },
  },
  {
    id: 'out-of-scope-features-off',
    description: 'Features outside the certified scope stay off.',
    check(m) {
      if (m.features?.semanticSearch === true) {
        return {
          path: 'features.semanticSearch',
          message: 'is true. Semantic search is outside the certified scope (plan §2.2) and has no certification campaign behind it.',
        };
      }
      return null;
    },
  },
  {
    id: 'production-domain-is-custom',
    description: 'A shop is reachable on its own domain, not a platform subdomain.',
    check(m) {
      const domain = m.cloudflare?.productionDomain ?? '';
      const platform = ['.workers.dev', '.pages.dev'].find((suffix) => domain.endsWith(suffix));
      if (platform) {
        return {
          path: 'cloudflare.productionDomain',
          message: `is a ${platform} address. Production runs on the merchant's own domain: the platform subdomain cannot carry the shop's email alignment or survive a worker rename.`,
        };
      }
      return null;
    },
  },
  {
    id: 'no-credentials',
    description: 'No API key, token or secret in the manifest.',
    check(m) {
      // The closed schema already refuses an invented `stripeKey:` field, so
      // this catches the other shape: a credential pasted into a field that IS
      // allowed. Manifests are committed; a value that reaches this file is
      // published to every clone of the repository.
      for (const [path, value] of walkStrings(m)) {
        for (const { pattern, what } of CREDENTIAL_PATTERNS) {
          if (pattern.test(value)) {
            return {
              path,
              message: `contains ${what}. Credentials belong in the platform secret store or Admin → Settings, never in a committed file.`,
            };
          }
        }
      }
      return null;
    },
  },
];

function* walkStrings(value, path = []) {
  if (typeof value === 'string') {
    yield [path.join('.') || '(root)', value];
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* walkStrings(child, [...path, key]);
  }
}

/** Every leaf path in the spec, dotted, in declaration order. */
export function manifestFieldPaths(spec = MANIFEST_SPEC, prefix = []) {
  const paths = [];
  for (const [key, field] of Object.entries(spec)) {
    if (field.kind === 'section') paths.push(...manifestFieldPaths(field.fields, [...prefix, key]));
    else paths.push([...prefix, key].join('.'));
  }
  return paths;
}

function describeSchema(schema) {
  if (schema.enum) return `one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`;
  if (schema.pattern) return `a ${schema.type} matching ${schema.pattern}`;
  return `a ${schema.type}`;
}

function validateLeaf(value, schema, path, errors) {
  const type = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

  if (type === 'integer' || type === 'number') {
    if (actual !== 'number' || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) {
      errors.push({ path, message: `must be ${describeSchema(schema)}; got ${JSON.stringify(value)}.` });
      return;
    }
  } else if (actual !== type) {
    errors.push({ path, message: `must be ${describeSchema(schema)}; got ${actual === 'object' ? 'a section' : JSON.stringify(value)}.` });
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({ path, message: `must be ${describeSchema(schema)}; got ${JSON.stringify(value)}.` });
    return;
  }
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
    errors.push({ path, message: `does not match ${schema.pattern}; got ${JSON.stringify(value)}.` });
    return;
  }
  if (schema.minLength != null && value.length < schema.minLength) {
    errors.push({ path, message: `is shorter than ${schema.minLength} characters.` });
  }
  if (schema.maxLength != null && value.length > schema.maxLength) {
    errors.push({ path, message: `is longer than ${schema.maxLength} characters.` });
  }
}

function validateMapping(value, spec, prefix, errors) {
  const where = prefix.join('.') || 'the manifest';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({ path: where, message: 'must be a section of fields.' });
    return;
  }

  for (const [key, field] of Object.entries(spec)) {
    const path = [...prefix, key].join('.');
    if (!(key in value)) {
      errors.push({ path, message: `is required (${field.description}).` });
      continue;
    }
    if (field.kind === 'section') validateMapping(value[key], field.fields, [...prefix, key], errors);
    else validateLeaf(value[key], field.schema, path, errors);
  }

  for (const key of Object.keys(value)) {
    if (key in spec) continue;
    const known = Object.keys(spec).join(', ');
    errors.push({
      path: [...prefix, key].join('.'),
      message: `is not a field of ${where}. Known fields: ${known}. An unknown field is either a typo or a value the core will never read — both silently do nothing.`,
    });
  }
}

/**
 * Validate a parsed manifest against the spec and the cross-field rules.
 *
 * Structural errors are collected in full, then the cross-field rules run only
 * if the structure held: a rule reading `m.client.slug` on a manifest missing
 * `client` would report a second, derived failure for the same cause.
 *
 * @param {unknown} manifest parsed object
 * @param {{ coreVersion?: string }} [context] core version to check compatibility against
 * @returns {{ ok: boolean, errors: Array<{ path: string, message: string, rule?: string }> }}
 */
export function validateManifest(manifest, context = {}) {
  const errors = [];
  validateMapping(manifest, MANIFEST_SPEC, [], errors);

  if (errors.length === 0) {
    for (const rule of CROSS_FIELD_RULES) {
      const failure = rule.check(manifest);
      if (failure) errors.push({ ...failure, rule: rule.id });
    }
    if (context.coreVersion) {
      const failure = checkCoreCompatibility(manifest.coreVersion, context.coreVersion);
      if (failure) errors.push({ ...failure, rule: 'core-version-compatible' });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Is a manifest written for core version `declared` still readable by a core at
 * `core`?
 *
 * SemVer, with the 0.x reading that a minor bump is breaking — which is the
 * accurate reading while the core is pre-1.0 and the migration notes of plan
 * §9 do not exist yet. A manifest ahead of its core is refused outright: it was
 * written against fields this build may not have, and a merge that brought the
 * manifest without the core is exactly the drift `shopctl fleet status` exists
 * to catch.
 */
export function checkCoreCompatibility(declared, core) {
  const parse = (v) => (typeof v === 'string' ? v.split('.').map(Number) : []);
  const [dMajor, dMinor, dPatch] = parse(declared);
  const [cMajor, cMinor, cPatch] = parse(core);
  if ([dMajor, dMinor, dPatch, cMajor, cMinor, cPatch].some((n) => !Number.isInteger(n))) return null;

  const ahead =
    dMajor > cMajor ||
    (dMajor === cMajor && dMinor > cMinor) ||
    (dMajor === cMajor && dMinor === cMinor && dPatch > cPatch);
  if (ahead) {
    return {
      path: 'coreVersion',
      message: `declares ${declared} but this core is ${core}. The manifest is ahead of the code: upgrade the core, or the shop is configured for fields this build does not read.`,
    };
  }

  const compatible = cMajor === 0 ? dMajor === 0 && dMinor === cMinor : dMajor === cMajor;
  if (!compatible) {
    return {
      path: 'coreVersion',
      message: `declares ${declared}, which this core (${core}) does not support. ${cMajor === 0 ? 'Before 1.0 a minor bump may break the manifest' : 'A major bump may break the manifest'}: follow the migration notes, then set coreVersion to ${core}.`,
    };
  }
  return null;
}

/**
 * The JSON Schema published under schemas/, for editors and for anything that
 * reads the manifest outside this repository.
 *
 * It is a projection, not the authority: the cross-field rules above cannot be
 * expressed in JSON Schema without duplicating them in a second dialect, so
 * they are listed under `x-crossFieldRules` for humans and enforced by
 * validateManifest() for machines. The `$comment` says so on the file itself,
 * where someone validating with a generic tool will actually read it.
 */
export function manifestJsonSchema() {
  const properties = {};
  for (const [key, field] of Object.entries(MANIFEST_SPEC)) {
    properties[key] =
      field.kind === 'section'
        ? { description: field.description, ...sectionSchema(field.fields) }
        : { description: field.description, ...field.schema };
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $comment:
      'GENERATED by scripts/manifest-schema.mjs — do not edit. Structure only: the cross-field rules listed under x-crossFieldRules are enforced by validateManifest(), not by this document.',
    title: `Minshop client manifest, schema version ${SCHEMA_VERSION}`,
    type: 'object',
    additionalProperties: false,
    required: Object.keys(MANIFEST_SPEC),
    properties,
    'x-crossFieldRules': CROSS_FIELD_RULES.map(({ id, description }) => ({ id, description })),
  };
}

function sectionSchema(fields) {
  const properties = {};
  for (const [key, field] of Object.entries(fields)) {
    properties[key] = { description: field.description, ...field.schema };
  }
  return { type: 'object', additionalProperties: false, required: Object.keys(fields), properties };
}
