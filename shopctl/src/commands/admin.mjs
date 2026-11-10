/**
 * `shopctl admin password` — the administration's password, set from the
 * operator's terminal rather than through the first-run wizard.
 *
 * The wizard is how a password gets set on a shop nobody has installed yet,
 * and that is its weakness on the one deployment that matters: until someone
 * fills it in, `/admin/setup` answers ANYONE (src/middleware.ts, bootstrap).
 * Behind a staging's Access application that is a window for the members of
 * the policy; on a production — public by definition, on a domain whose
 * certificate has just been logged for every scanner to read — it is a window
 * for whoever gets there first, and the deploy's own smoke test says so
 * (certification step 9, rehearsal of 2026-10-20). The lost-password runbook
 * reopened the same window on purpose, with « tout de suite » as its only
 * guard.
 *
 * So the hash is written where the wizard would have written it, by the
 * account's owner, BEFORE the window exists: after `provision`, before the
 * first `deploy`. The wizard then opens only after a login, and still asks for
 * the shop's name and time zone. Three decisions:
 *
 *  - **the password never touches an argument.** It is read from standard
 *    input — a file, a pipe, or typed twice without echo at a terminal —
 *    because `shopctl` refuses credentials on the command line (secrets.mjs),
 *    and a password typed there is in the shell history before any check runs;
 *  - **the hash is the Worker's own.** `src/features/auth/password.ts` is
 *    imported by a child Node with type stripping, not reimplemented here: the
 *    login compares against what the Worker computes, and two implementations
 *    of PBKDF2 parameters eventually disagree on the day it locks a merchant
 *    out (wrap, never reimplement);
 *  - **it goes to D1 as a file**, through the same `applyScript` the restore
 *    uses, and is read back before the command says it worked. The hash is
 *    never printed: it is offline-guessable, which is why it is slow.
 *
 * Every admin session falls with it, by construction — a session is bound to
 * the hash (src/features/auth/session.ts). That is the point of a reset, and a
 * harmless side effect of a first one.
 *
 * `shopctl admin token` is the other way in, for the agency once the merchant
 * holds — and may have changed — the password (ticket #227, ADR 0032): a token
 * good once, for fifteen minutes, that opens an eight-hour session at
 * /admin/token and leaves the password and the merchant's sessions alone. It
 * gives nothing the account does not already give, since the account can
 * replace the password outright. Same three decisions, and one exception:
 *
 *  - **the token is the Worker's own.** Drawn and digested by
 *    `src/features/auth/adminToken.ts`, imported by a child Node like the hash;
 *  - **the database gets its digest**, through `applyScript`, read back;
 *  - **the token is SHOWN, once.** The one value shopctl generates and hands
 *    back (`Reporter.reveal`), because the operator has to paste it. What makes
 *    that acceptable is what it is: single-use, fifteen minutes, nothing stored
 *    that could replay it. It goes to the terminal or to the `--json` document,
 *    never to an argument, a log or a file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { inputError, usageError, verificationError, externalError, preconditionError } from '../errors.mjs';
import { requireEnvironment, resolveShop } from '../shop.mjs';
import { openEnvironment } from '../environment.mjs';
import { applyScript, query } from '../backup/store.mjs';
import { capture } from '../process.mjs';
import { environmentHost } from '../../../scripts/manifest.mjs';

export const ADMIN_OPTIONS = {
  '--env': 'environnement',
  '--shop': 'slug',
  '--account': 'id',
};

export const ADMIN_FLAGS = ['--dry-run'];

/** The wizard's own minimum (src/pages/admin/setup.astro, MIN_PW). A test
 *  holds the two together: a shorter password set here would be one the
 *  wizard refuses to set again. */
export const MIN_PASSWORD_LENGTH = 8;

/** The settings row the login reads (src/features/auth/admin.ts). */
export const PASSWORD_SETTING = 'admin_password_hash';

/** The table /admin/token consumes from (migration 0058). */
export const TOKEN_TABLE = 'admin_access_tokens';

/** The Worker module that draws and digests a token, in the shop's tree. */
const TOKEN_MODULE = 'src/features/auth/adminToken.ts';

export const adminUsage = `Usage: shopctl admin password --env <staging|production> [options]
       shopctl admin token --env <staging|production> [options]

  --env <staging|production>  Environnement concerné. Obligatoire.
  --dry-run                   Tout vérifier, ne rien écrire.
  --account <id>              Compte Cloudflare attendu, si le manifeste ne le déclare pas.
  --shop <slug>               Manifeste à utiliser quand l'arbre en contient plusieurs.
  --json                      Rapport lisible par une machine.

Pose le mot de passe de l'administration, haché comme le Worker le hache, dans
la base de l'environnement. Le mot de passe se lit sur l'entrée standard, jamais
en argument : saisi deux fois sans écho dans un terminal, ou depuis un fichier
(\`shopctl admin password --env production < fichier\`).

Avant le premier déploiement d'une production, il referme l'assistant
/admin/setup avant qu'il ne soit jamais ouvert au public : l'assistant ne
s'ouvre plus qu'après connexion. Sur une boutique en service, c'est la
réinitialisation d'un mot de passe perdu, sans fenêtre ouverte : toutes les
sessions d'administration tombent.

admin token crée un jeton à usage unique, valable 15 minutes, et l'affiche une
seule fois. Collé sur /admin/token, il ouvre une session de 8 heures sans
connaître le mot de passe ni le changer : les sessions du commerçant restent
ouvertes. La base n'en garde que l'empreinte. Sous --json, le jeton est le champ
« token » du rapport.
`;

export async function runAdmin(args, reporter) {
  const [sub, ...rest] = args.positionals;
  if (sub !== 'password' && sub !== 'token') {
    throw usageError(sub ? `sous-commande d'admin inconnue : « ${sub} ».` : 'admin demande une sous-commande.', adminUsage.trim());
  }
  if (rest.length > 0) {
    throw usageError(`admin ${sub} ne prend pas d'argument positionnel ; reçu « ${rest.join('", "')} ».`, adminUsage.trim());
  }
  return sub === 'token' ? issueToken(args, reporter) : setPassword(args, reporter);
}

async function issueToken(args, reporter) {
  const shop = resolveShop(process.cwd(), args.values['--shop']);
  const { manifest, root } = shop;
  const env = requireEnvironment(args.values['--env']);
  const dryRun = args.values['--dry-run'] === true;

  // The tree before the account: a shop on a core without the module has no
  // /admin/token either, and nothing to connect for.
  if (!existsSync(join(root, TOKEN_MODULE))) {
    throw preconditionError(
      `${TOKEN_MODULE} n'existe pas dans cet arbre : le socle de la boutique ne connaît pas les jetons d'accès.`,
      'Montez la boutique sur un socle qui les porte (shopctl core upgrade), déployez, puis relancez.',
    );
  }

  const { account, names } = openEnvironment({
    values: args.values,
    manifest,
    root,
    env,
    reporter,
    missing: "Il n'y a pas d'administration où entrer.",
  });

  reporter.section("Jeton d'accès à l'administration");
  const [tables, password] = query(
    [
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${TOKEN_TABLE}';`,
      `SELECT key FROM settings WHERE key = '${PASSWORD_SETTING}';`,
    ],
    { cwd: root, remote: true, what: 'la table des jetons et le mot de passe' },
  );
  if (tables.length === 0) {
    throw preconditionError(
      `${names.database} n'a pas la table ${TOKEN_TABLE} (migration 0058) : le Worker déployé ne connaît pas /admin/token.`,
      `Déployez d'abord cette version du socle : shopctl deploy --env ${env} applique les migrations.`,
    );
  }
  // Without a password the gate is in bootstrap or behind Access, and
  // /admin/token sends to the wizard: the token would open nothing.
  if (password.length === 0) {
    throw preconditionError(
      "l'administration n'a pas de mot de passe : un jeton n'y ouvrirait rien.",
      `Posez-en un avec shopctl admin password --env ${env}.`,
    );
  }

  const host = environmentHost(manifest, env);
  const url = host ? `https://${host}/admin/token` : null;

  if (dryRun) {
    reporter.todo(`un jeton à usage unique serait posé dans ${names.database}`);
    reporter.result({
      command: 'admin token',
      ok: true,
      dryRun,
      shop: manifest.client.slug,
      env,
      account: { id: account.id, name: account.name },
      database: names.database,
      url,
    });
    return 0;
  }

  const { token, digest, ttl } = tokenWithWorker(root);
  applyScript([purgeTokensStatement(), insertTokenStatement(digest, ttl)], { cwd: root, remote: true });
  // Read back: the row must be there, unused, for the time the module says —
  // otherwise the token shown below would be refused at the door.
  const [stored] = query([`SELECT expires_at, expires_at - created_at AS ttl, used_at FROM ${TOKEN_TABLE} WHERE digest = '${digest}';`], {
    cwd: root,
    remote: true,
    what: 'le jeton relu',
  });
  const row = stored[0];
  if (stored.length !== 1 || Number(row.ttl) !== ttl || row.used_at !== null) {
    throw verificationError(
      `le jeton relu dans ${names.database} n'est pas celui qui vient d'être écrit.`,
      "Il ne serait pas accepté sur /admin/token. Relancez la commande.",
    );
  }
  const expiresAt = new Date(Number(row.expires_at) * 1000).toISOString();
  reporter.ok(`jeton posé dans ${names.database} : une seule fois, pendant ${ttl / 60} min, sans toucher au mot de passe`);
  reporter.reveal('Jeton (affiché une seule fois, la base n\'en garde que l\'empreinte) :', token);
  reporter.step(
    url
      ? `À coller sur ${url} : il ouvre une session de 8 h.`
      : "À coller sur /admin/token, à l'adresse workers.dev de la boutique : il ouvre une session de 8 h.",
  );

  reporter.result({
    command: 'admin token',
    ok: true,
    dryRun,
    shop: manifest.client.slug,
    env,
    account: { id: account.id, name: account.name },
    database: names.database,
    url,
    token,
    expiresAt,
  });
  return 0;
}

async function setPassword(args, reporter) {
  const shop = resolveShop(process.cwd(), args.values['--shop']);
  const { manifest, root } = shop;
  const env = requireEnvironment(args.values['--env']);
  const dryRun = args.values['--dry-run'] === true;

  // Read and checked before anything connects: a password too short is a
  // typo to fix, not a reason to have spent a wrangler round trip.
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw inputError(
      `le mot de passe fait ${password.length} caractère(s) ; il en faut ${MIN_PASSWORD_LENGTH} au moins.`,
      "C'est le minimum de l'assistant d'installation, qui le refuserait aussi.",
    );
  }

  const { account, names } = openEnvironment({
    values: args.values,
    manifest,
    root,
    env,
    reporter,
    missing: "Il n'y a pas de base où poser le mot de passe.",
  });

  reporter.section("Mot de passe de l'administration");
  const [settings] = query([`SELECT key FROM settings WHERE key IN ('${PASSWORD_SETTING}', 'setup_complete')`], {
    cwd: root,
    remote: true,
    what: 'les réglages de la boutique',
  });
  const present = new Set(settings.map((row) => row.key));
  const replacing = present.has(PASSWORD_SETTING);
  const setupComplete = present.has('setup_complete');

  const hash = hashWithWorker(root, password);

  if (dryRun) {
    reporter.todo(`${replacing ? 'le mot de passe serait remplacé' : 'un mot de passe serait posé'} dans ${names.database}`);
  } else {
    applyScript([upsertStatement(hash)], { cwd: root, remote: true });
    // Read back, compared and not printed: "wrangler said it ran" is not
    // "the login will find this hash", and only the second is the claim made.
    const [stored] = query([`SELECT value FROM settings WHERE key = '${PASSWORD_SETTING}'`], {
      cwd: root,
      remote: true,
      what: 'le mot de passe relu',
    });
    if (stored[0]?.value !== hash) {
      throw verificationError(
        `le mot de passe relu dans ${names.database} n'est pas celui qui vient d'être écrit.`,
        "Rien ne garantit alors qu'une connexion aboutira : relancez la commande, puis vérifiez la connexion avant de déployer.",
      );
    }
    reporter.ok(`${replacing ? 'mot de passe remplacé' : 'mot de passe posé'} dans ${names.database}, haché par src/features/auth/password.ts`);
    if (replacing) reporter.ok("les sessions d'administration ouvertes avec l'ancien tombent");
  }
  if (!setupComplete) {
    reporter.step(`    L'assistant /admin/setup ne s'ouvre plus qu'après connexion : il reste à y saisir le nom et le fuseau de la boutique.`);
  }

  reporter.result({
    command: 'admin password',
    ok: true,
    dryRun,
    shop: manifest.client.slug,
    env,
    account: { id: account.id, name: account.name },
    database: names.database,
    action: replacing ? 'replace' : 'set',
    setupComplete,
  });
  return 0;
}

/**
 * The password, from standard input.
 *
 * At a terminal it is typed twice without echo, the way `passwd` asks; from a
 * file or a pipe it is the content, less ONE trailing line ending — the one
 * `echo` and every editor add, and that nobody means as part of a password.
 */
async function readPassword() {
  if (!process.stdin.isTTY) {
    const raw = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
    if (raw.length === 0) {
      throw inputError(
        "aucun mot de passe sur l'entrée standard.",
        "Lancez la commande dans un terminal pour le saisir, ou donnez-lui un fichier : shopctl admin password --env <env> < fichier. Jamais en argument.",
      );
    }
    return raw;
  }
  const first = await prompt('Nouveau mot de passe : ');
  const second = await prompt('Le même, une seconde fois : ');
  if (first !== second) throw inputError('les deux saisies diffèrent.', 'Rien n\'a été écrit. Relancez la commande.');
  return first;
}

/** One line typed without echo, on stderr so `--json` keeps stdout to itself. */
function prompt(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stderr.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let typed = '';
    const finish = (error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(typed);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(inputError('saisie interrompue.', "Rien n'a été écrit."));
        if (character === '\u007f' || character === '\b') typed = typed.slice(0, -1);
        else typed += character;
      }
    };
    input.on('data', onData);
  });
}

/**
 * The hash, computed by the Worker's own module.
 *
 * A child Node with type stripping imports `src/features/auth/password.ts`
 * from the shop's tree — the core version this shop carries, which is the one
 * its Worker was built from. The password goes on the child's stdin, never in
 * its arguments, and the child verifies what it produced before printing it.
 */
export function hashWithWorker(root, password) {
  const module = pathToFileURL(join(root, 'src/features/auth/password.ts')).href;
  const script = [
    `import { hashPassword, verifyPassword } from ${JSON.stringify(module)};`,
    "import { readFileSync } from 'node:fs';",
    "const password = readFileSync(0, 'utf8');",
    'const hash = await hashPassword(password);',
    "if (!(await verifyPassword(password, hash))) throw new Error('verifyPassword refuse le haché produit');",
    'process.stdout.write(hash);',
  ].join('\n');
  const result = capture(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '--eval', script],
    { cwd: root, input: password, allowFailure: true },
  );
  const hash = result.stdout.trim();
  if (result.status !== 0 || !/^pbkdf2\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(hash)) {
    throw externalError(
      "le hachage du mot de passe par src/features/auth/password.ts a échoué.",
      result.stderr.trim().split('\n').find(Boolean) ?? 'Node 22.12 ou plus est requis (--experimental-strip-types).',
    );
  }
  return hash;
}

/**
 * A token and its digest, from the Worker's own module.
 *
 * Drawn in a child Node from the shop's tree, like the hash: the door checks
 * the shape and the digest the module defines, so the CLI must not have its
 * own. The token comes back on the child's stdout, never through an argument.
 */
export function tokenWithWorker(root) {
  const module = pathToFileURL(join(root, TOKEN_MODULE)).href;
  const script = [
    `import { ADMIN_TOKEN_TTL_SECONDS, adminTokenDigest, generateAdminToken, normalizeAdminToken } from ${JSON.stringify(module)};`,
    'const token = generateAdminToken();',
    "if (normalizeAdminToken(token) !== token) throw new Error('normalizeAdminToken refuse le jeton produit');",
    'const digest = await adminTokenDigest(token);',
    'process.stdout.write(JSON.stringify({ token, digest, ttl: ADMIN_TOKEN_TTL_SECONDS }));',
  ].join('\n');
  const result = capture(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', '--input-type=module', '--eval', script],
    { cwd: root, allowFailure: true },
  );
  let drawn = null;
  try {
    drawn = JSON.parse(result.stdout);
  } catch {
    drawn = null;
  }
  if (
    result.status !== 0 ||
    !/^[A-Za-z0-9_-]{43}$/.test(drawn?.token ?? '') ||
    !/^[0-9a-f]{64}$/.test(drawn?.digest ?? '') ||
    !Number.isInteger(drawn?.ttl) ||
    drawn.ttl <= 0
  ) {
    throw externalError(
      `le tirage du jeton par ${TOKEN_MODULE} a échoué.`,
      result.stderr.trim().split('\n').find(Boolean) ?? 'Node 22.12 ou plus est requis (--experimental-strip-types).',
    );
  }
  return drawn;
}

/** Tokens that expired unused go when a new one comes: a used one stays, it is
 *  the record Réglages reads. */
export function purgeTokensStatement() {
  return `DELETE FROM ${TOKEN_TABLE} WHERE used_at IS NULL AND expires_at <= unixepoch();`;
}

/** The token's row, timed by Cloudflare's clock, which the Worker at the door
 *  shares, rather than by this machine's, which may be minutes off. The digest
 *  is hex, checked above, so it can be inlined without an escaping rule of its
 *  own. */
export function insertTokenStatement(digest, ttl) {
  return `INSERT INTO ${TOKEN_TABLE} (digest, created_at, expires_at) VALUES ('${digest}', unixepoch(), unixepoch() + ${ttl});`;
}

/** The row the wizard writes, the way `setSetting` writes it. The hash is
 *  base64 and `$` only; the check above refuses anything else, so it can be
 *  inlined in the file without an escaping rule of its own. */
export function upsertStatement(hash) {
  return (
    `INSERT INTO settings (key, value) VALUES ('${PASSWORD_SETTING}', '${hash}') ` +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');"
  );
}
