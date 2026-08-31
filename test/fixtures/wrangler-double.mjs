#!/usr/bin/env node
/**
 * A wrangler that answers like the real one, against a Cloudflare account kept
 * in a JSON file.
 *
 * Why a double and not a mock: the properties jalon 6 has to prove are about
 * the CONVERSATION with the account — that a second run creates nothing, that
 * an interrupted run resumes, that a bucket ends up in the `eu` jurisdiction
 * and in no other, that a secret never appears in an argument vector. A mock of
 * `capture()` would assert that shopctl calls the functions shopctl calls. This
 * runs the real `npx --no-install wrangler …` path, the real argument
 * construction, and the real output parsers, and only the account is imaginary.
 *
 * It is deliberately literal about wrangler's SHAPES — `name:  <bucket>` lines
 * with no --json for `r2 bucket list`, a JSON array for `d1 list`, a non-zero
 * exit for `secret list` on a Worker that does not exist. Those shapes are what
 * shopctl parses, so a double that answered in a tidier format would let a
 * parser bug through.
 *
 * State lives at $WRANGLER_DOUBLE_STATE, a JSON document:
 *
 *   accounts        [{ id, name }]           what `whoami` reports
 *   authenticated   boolean                  false makes `whoami --json` exit 1
 *   d1              [{ name, uuid, jurisdiction }]
 *   r2              [{ name, jurisdiction, devUrl, domains }]
 *   workers         [{ name, secrets: [] }]
 *   reportsD1Jurisdiction  boolean           `d1 info` publishes the field or not
 *   failAt          "d1 create" | …          one command that dies, for the
 *                                            interrupted-run test
 *   calls           [{ argv, stdin }]        appended to on every invocation
 */
import { readFileSync, writeFileSync } from 'node:fs';

const STATE = process.env.WRANGLER_DOUBLE_STATE;
if (!STATE) {
  process.stderr.write('wrangler-double: WRANGLER_DOUBLE_STATE is not set\n');
  process.exit(1);
}

const argv = process.argv.slice(2);
const state = JSON.parse(readFileSync(STATE, 'utf8'));

/** Read stdin fully, or '' when nothing is piped. `secret put` is the only
 *  command that needs it, and it is the reason the double records stdin at all:
 *  a test has to be able to prove the value arrived HERE and not in argv. */
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const flag = (...names) => {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('-')) return argv[index + 1];
    const inline = argv.find((argument) => argument.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
  }
  return null;
};
const positionals = argv.filter((argument, index) => {
  if (argument.startsWith('-')) return false;
  const previous = argv[index - 1];
  return !(previous && previous.startsWith('-') && !previous.includes('='));
});

const command = positionals.slice(0, 3).join(' ');
const stdin = command.startsWith('secret put') ? readStdin() : '';

state.calls = state.calls ?? [];
state.calls.push({ argv, stdin });
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

function done(text = '', code = 0) {
  save();
  if (text) process.stdout.write(`${text}\n`);
  process.exit(code);
}
function fail(text, code = 1) {
  save();
  process.stderr.write(`${text}\n`);
  process.exit(code);
}

// One command can be made to die, so a test can kill a run halfway and re-run
// it. That is the only way to exercise resumption honestly: the second run has
// to find whatever the first one managed to create.
if (state.failAt && command.startsWith(state.failAt)) {
  fail(`wrangler-double: injected failure at "${state.failAt}"`);
}

const uuid = (name) => {
  // Deterministic and shaped like a real one, so a test can assert the id that
  // reaches wrangler.jsonc without the double inventing a new one per run.
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hex = hash.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-${hex}${hex.slice(0, 4)}`;
};

const jurisdictionOf = () => flag('-J', '--jurisdiction');

if (positionals[0] === 'whoami') {
  if (state.authenticated === false) fail('You are not authenticated.');
  done(JSON.stringify({
    loggedIn: true,
    authType: 'OAuth Token',
    email: state.email ?? 'ops@example.com',
    accounts: state.accounts ?? [],
    tokenPermissions: null,
  }));
}

if (command === 'd1 list') {
  done(JSON.stringify((state.d1 ?? []).map(({ name, uuid: id }) => ({ name, uuid: id }))));
}

if (command.startsWith('d1 create')) {
  const name = positionals[2];
  if ((state.d1 ?? []).some((entry) => entry.name === name)) fail('A database with that name already exists');
  const id = uuid(name);
  state.d1 = [...(state.d1 ?? []), { name, uuid: id, jurisdiction: jurisdictionOf() }];
  done(`✅ Successfully created DB '${name}'\n\ndatabase_id = "${id}"`);
}

if (command.startsWith('d1 info')) {
  const name = positionals[2];
  const entry = (state.d1 ?? []).find((candidate) => candidate.name === name);
  if (!entry) fail(`Couldn't find DB with name '${name}'`);
  const payload = { uuid: entry.uuid, name: entry.name, num_tables: 0, database_size: 0 };
  // Older D1 APIs do not publish the jurisdiction back. shopctl has to report
  // that as "unverified" rather than as a pass, and this switch is how the
  // suite proves it does.
  if (state.reportsD1Jurisdiction !== false) payload.jurisdiction = entry.jurisdiction;
  done(JSON.stringify(payload));
}

if (command === 'd1 migrations apply' || command.startsWith('d1 migrations')) {
  state.migrationsApplied = (state.migrationsApplied ?? 0) + 1;
  done('🌀 Executing on remote database: 0 migrations to apply.');
}

if (command === 'r2 bucket list') {
  if (state.r2Enabled === false) fail('The R2 service is not enabled for this account. [code: 10042]');
  const wanted = jurisdictionOf();
  const buckets = (state.r2 ?? []).filter((bucket) => (bucket.jurisdiction ?? null) === (wanted ?? null));
  const body = buckets.map((bucket) => `name:           ${bucket.name}\ncreation_date:  2026-08-31`).join('\n\n');
  done(`Listing buckets...\n${body}`);
}

if (command.startsWith('r2 bucket create')) {
  const name = positionals[3];
  const wanted = jurisdictionOf();
  if ((state.r2 ?? []).some((bucket) => bucket.name === name && (bucket.jurisdiction ?? null) === (wanted ?? null))) {
    fail('A bucket with that name already exists');
  }
  state.r2 = [...(state.r2 ?? []), { name, jurisdiction: wanted, devUrl: null, domains: [] }];
  done(`Creating bucket '${name}'...\n✅ Created bucket '${name}' with default storage class of Standard.`);
}

if (command === 'r2 bucket dev-url' && positionals[3] === 'get') {
  const name = positionals[4];
  const wanted = jurisdictionOf();
  const bucket = (state.r2 ?? []).find((candidate) => candidate.name === name && (candidate.jurisdiction ?? null) === (wanted ?? null));
  if (!bucket) fail(`The specified bucket does not exist.`);
  done(bucket.devUrl ? `Public access is enabled at '${bucket.devUrl}'.` : 'Public access via the r2.dev URL is disabled.');
}

if (command === 'r2 bucket domain' && positionals[3] === 'list') {
  const name = positionals[4];
  const wanted = jurisdictionOf();
  const bucket = (state.r2 ?? []).find((candidate) => candidate.name === name && (candidate.jurisdiction ?? null) === (wanted ?? null));
  if (!bucket) fail(`The specified bucket does not exist.`);
  const domains = bucket.domains ?? [];
  if (domains.length === 0) done(`Listing custom domains connected to bucket '${name}'...\nThere are no custom domains connected to this bucket.`);
  done(
    `Listing custom domains connected to bucket '${name}'...\n` +
      domains.map((domain) => `domain:          ${domain}\nenabled:         Yes`).join('\n\n'),
  );
}

if (command.startsWith('secret list')) {
  const name = flag('--name');
  const worker = (state.workers ?? []).find((candidate) => candidate.name === name);
  if (!worker) fail(`Could not find Worker "${name}".`);
  done(JSON.stringify((worker.secrets ?? []).map((secret) => ({ name: secret, type: 'secret_text' }))));
}

if (command.startsWith('secret put')) {
  const name = flag('--name');
  const secret = positionals[2];
  const worker = (state.workers ?? []).find((candidate) => candidate.name === name);
  if (!worker) fail(`Could not find Worker "${name}".`);
  if (!stdin.trim()) fail('No value was piped in for the secret.');
  worker.secrets = [...new Set([...(worker.secrets ?? []), secret])];
  done(`✨ Success! Uploaded secret ${secret}`);
}

if (command.startsWith('versions list')) {
  const name = flag('--name');
  const worker = (state.workers ?? []).find((candidate) => candidate.name === name);
  if (!worker) fail(`Could not find Worker "${name}".`);
  // Newest first, like the real one. `shopctl deploy` names the SECOND entry as
  // the rollback target, so a Worker with a single version must report exactly
  // one — that is the "nothing to roll back to" case of a first deployment.
  done(JSON.stringify(worker.versions ?? [{ id: 'v1', number: 1 }]));
}

if (positionals[0] === 'deploy') {
  // The name comes from the rendered configuration, exactly as the real
  // wrangler reads it: that is what makes "deploy uploaded the environment the
  // command was asked for" a property the suite can assert.
  // Comments stripped first, exactly as a JSONC reader would: the template's
  // header explains the optional `send_email` binding with a `"name": "EMAIL"`
  // example, and a naive match reads THAT as the Worker's name.
  const config = readFileSync('wrangler.jsonc', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const name = config.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? 'worker';
  let worker = (state.workers ?? []).find((candidate) => candidate.name === name);
  if (!worker) {
    worker = { name, secrets: [], versions: [] };
    state.workers = [...(state.workers ?? []), worker];
  }
  worker.versions = [{ id: `v${(worker.versions?.length ?? 0) + 1}`, number: (worker.versions?.length ?? 0) + 1 }, ...(worker.versions ?? [])];
  state.deploys = [...(state.deploys ?? []), name];
  const url = state.deployUrl ?? `https://${name}.example.workers.dev`;
  done(`Total Upload: 512.00 KiB / gzip: 128.00 KiB\nUploaded ${name} (2.11 sec)\nDeployed ${name} triggers (0.42 sec)\n  ${url}\nCurrent Version ID: 00000000-0000-0000-0000-000000000002`);
}

if (command.startsWith('d1 time-travel')) {
  done(JSON.stringify({ bookmark: state.bookmark ?? '00000098-0000000d-00004f8d-example' }));
}

if (argv.includes('--version')) done('⛅️ wrangler 4.127.1 (double)');

fail(`wrangler-double: unhandled command "${argv.join(' ')}"`, 2);
