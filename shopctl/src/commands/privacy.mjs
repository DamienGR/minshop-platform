/**
 * `shopctl privacy` — what a shop holds about one buyer, and how it stops
 * holding it.
 *
 * The plan asks for two things at jalon 8: the EXPORT of a customer and their
 * ANONYMISATION. They are one command with two verbs because they are one
 * question asked twice — *which rows are this person's?* — and two answers to
 * it would eventually disagree on the run where being wrong is a data breach in
 * one direction and a destroyed accounting record in the other.
 *
 * Three decisions shape the file.
 *
 * **An erasure is an anonymisation, not a deletion.** A paid order is an
 * accounting record and the Code de commerce keeps it for ten years; the RGPD
 * asks for the person to go, not for the ledger to. So the amounts, the dates,
 * the VAT and the order's own identifier all stay exactly where they are, and
 * what is rewritten is the identity: the e-mail, the address, the tracking that
 * names a parcel at a carrier. The one thing that IS deleted is a credential —
 * a guest access token whose order has been anonymised is still a working key
 * to that order's page.
 *
 * **The map is declared and gated; the reach is derived.** Which columns hold a
 * person cannot be read off a schema (`orders.email` and `products.name` are
 * both TEXT), so `privacy/map.mjs` declares it and a test refuses any suspect
 * column the declaration has no opinion about. Which ROWS are theirs is pure
 * derivation: the foreign keys to `orders` say so. Both are re-checked against
 * the LIVE schema here, before anything is read — a database migrated ahead of
 * this checkout would otherwise be exported with a column nobody classified.
 *
 * **The export is written in the clear, and that is the decision.** A backup is
 * encrypted because it is every buyer the shop ever had and it exists to sit in
 * storage. An export is ONE person's data, produced because that person asked
 * for it, and Article 20 wants it in a structured, machine-readable format they
 * can actually use — so it is JSON, written 0600, into a directory git ignores,
 * and the command says out loud what the file is and that deleting it once sent
 * is part of the job. Encrypting it would only mean the merchant mails the key
 * next to the archive.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { ENVIRONMENTS } from '../../../scripts/manifest.mjs';
import { inputError, usageError, verificationError } from '../errors.mjs';
import { requireEnvironment, resolveShop } from '../shop.mjs';
import { openEnvironment } from '../environment.mjs';
import { corePackage } from '../paths.mjs';
import { classifyTables, columnNames, referencingColumns } from '../backup/schema.mjs';
import { applyScript, query, readSchema } from '../backup/store.mjs';
import { ORDER_TABLE, unclassifiedColumns, unreachableTables } from '../privacy/map.mjs';
import {
  EXPORT_FORMAT,
  anonymizePlan,
  anonymizeScript,
  exportRows,
  isEmail,
  linkedPredicates,
  normalizeEmail,
  processorReferences,
  reviewables,
  rootPredicates,
  selectFor,
  verifyAnonymization,
} from '../privacy/subject.mjs';

export const PRIVACY_OPTIONS = {
  '--env': 'environnement',
  '--email': 'adresse',
  '--shop': 'slug',
  '--account': 'id',
  '--out': 'fichier',
  '--confirm': 'slug',
};

export const PRIVACY_FLAGS = ['--dry-run'];

/** Where an export lands when the operator names no file. Git ignores it. */
export const DEFAULT_EXPORT_DIRECTORY = 'privacy';

export const privacyUsage = `Usage: shopctl privacy <sous-commande> --env <env> --email <adresse> [options]

  shopctl privacy export     Écrire tout ce que la boutique détient sur une personne
  shopctl privacy anonymize  Effacer cette personne des données, sans effacer la comptabilité

  --env <staging|production>  Environnement concerné. Obligatoire.
  --email <adresse>           La personne. Comparée sans tenir compte de la casse.
  --out <fichier>             Fichier de l'export. Défaut : ${DEFAULT_EXPORT_DIRECTORY}/<boutique>-<env>-<date>.json.
  --confirm <slug>            Le slug de la boutique, saisi. Obligatoire pour anonymize.
  --dry-run                   Tout lire et tout rapporter, ne rien écrire.
  --account <id>              Compte Cloudflare attendu, si le manifeste ne le déclare pas.
  --shop <slug>               Manifeste à utiliser quand l'arbre en contient plusieurs.
  --json                      Rapport lisible par une machine.

Une anonymisation ne supprime pas les commandes : elle remplace l'identité et
laisse les montants, les dates et la TVA, que le Code de commerce impose de
conserver dix ans. Elle est IRRÉVERSIBLE — le pseudonyme est tiré au hasard et
rien ne conserve la correspondance. Prenez \`shopctl backup --env <env>\` avant.

Le fichier d'export n'est pas chiffré : il est destiné à la personne qui l'a
demandé (RGPD, article 20). Il porte son adresse et sa commande en clair.
Supprimez-le une fois transmis.
`;

const SUBCOMMANDS = new Set(['export', 'anonymize']);

export function runPrivacy(args, reporter) {
  const [sub, ...rest] = args.positionals;
  if (!sub) throw usageError('privacy demande une sous-commande.', privacyUsage.trim());
  if (!SUBCOMMANDS.has(sub)) throw usageError(`sous-commande de privacy inconnue : « ${sub} ».`, privacyUsage.trim());
  if (rest.length > 0) {
    throw usageError(`privacy ${sub} ne prend pas d'argument positionnel ; reçu « ${rest.join('", "')} ».`, privacyUsage.trim());
  }
  return sub === 'export' ? runExport(args, reporter) : runAnonymize(args, reporter);
}

/**
 * The tree, the environment and the address, checked before anything connects.
 *
 * The address is validated rather than trusted: it goes into a WHERE clause,
 * and a value that is not an address is either a typo — which would silently
 * answer "we hold nothing about this person" — or an attempt at something else.
 */
function context(args) {
  const shop = resolveShop(process.cwd(), args.values['--shop']);
  const env = requireEnvironment(args.values['--env']);
  if (!ENVIRONMENTS.includes(env)) {
    throw usageError(`--env « ${env} » est inconnu.`, `Environnements : ${ENVIRONMENTS.join(', ')}.`);
  }
  const email = args.values['--email'];
  if (email === undefined) {
    throw inputError('privacy demande --email <adresse>.', "L'adresse est la seule identité d'un acheteur : la boutique est en commande invitée (plan §2.1).");
  }
  if (!isEmail(email)) {
    throw inputError(
      `« ${email} » n'est pas une adresse e-mail.`,
      "Une valeur qui n'en est pas une trouverait zéro ligne et ce zéro serait cru.",
    );
  }
  return { ...shop, env, email: normalizeEmail(email) };
}

/**
 * The live schema, checked against the map before it is used.
 *
 * `sqlite_master` carries the full CREATE TABLE text — `ALTER TABLE ADD COLUMN`
 * rewrites it — so both the column list and the foreign keys are read out of
 * one query rather than a PRAGMA per table.
 */
function readMap({ root, reporter }) {
  const { master, migrations } = readSchema({ cwd: root, remote: true });
  const { tables } = classifyTables(master);
  const schema = Object.fromEntries(tables.map((table) => [table.name, columnNames(table.sql)]));
  const foreignKeys = Object.fromEntries(tables.map((table) => [table.name, referencingColumns(table.sql, ORDER_TABLE)]));

  const unclassified = unclassifiedColumns(schema);
  if (unclassified.length > 0) {
    throw verificationError(
      `${unclassified.length} colonne(s) de cette base ne sont pas classées : ${unclassified.join(', ')}.`,
      "Cette base a un schéma que ce socle ne connaît pas. Classez-les dans shopctl/src/privacy/map.mjs — personnelle ou non, avec la raison — avant d'exporter ou d'anonymiser : une colonne inconnue est une colonne qu'un export oublie en silence.",
    );
  }
  const unreachable = unreachableTables(schema, foreignKeys);
  if (unreachable.length > 0) {
    throw verificationError(
      `${unreachable.length} table(s) portent une clé de commande sans lien déclaré : ${unreachable.join(', ')}.`,
      'Ajoutez-les à EXTRA_LINKS dans shopctl/src/privacy/map.mjs, sans quoi leurs lignes ne seront ni exportées ni anonymisées.',
    );
  }

  const applied = migrations.at(-1)?.name ?? null;
  reporter.ok(`${tables.length} table(s), schéma ${applied ?? 'inconnu'} — carte des données personnelles à jour`);
  return { schema, foreignKeys, applied, migrations: migrations.length };
}

/**
 * Every row this person has, table by table.
 *
 * Two rounds, because the second depends on the first: the root tables name a
 * person, and everything else hangs off the orders they turn up in. Each round
 * is one wrangler process — the predicates go in together and the result sets
 * come back positionally.
 */
function collect({ root, email, foreignKeys }) {
  const roots = rootPredicates(email);
  const rootRows = query(roots.map(selectFor), { cwd: root, remote: true, what: "les lignes de l'acheteur" });
  const records = {};
  for (const [index, predicate] of roots.entries()) records[predicate.table] = rootRows[index];

  const linked = linkedPredicates(records[ORDER_TABLE] ?? [], foreignKeys);
  if (linked.length > 0) {
    const linkedRows = query(linked.map(selectFor), { cwd: root, remote: true, what: 'les lignes liées' });
    for (const [index, predicate] of linked.entries()) {
      // A table reached by two columns contributes both sets; rows are unique
      // per table by primary key, and a row read twice would be exported twice.
      const seen = records[predicate.table] ?? [];
      const known = new Set(seen.map((row) => JSON.stringify(row)));
      records[predicate.table] = [...seen, ...linkedRows[index].filter((row) => !known.has(JSON.stringify(row)))];
    }
  }

  const predicates = [...roots, ...linked];
  const found = Object.entries(records).filter(([, rows]) => rows.length > 0);
  return { predicates, records: Object.fromEntries(found), total: found.reduce((sum, [, rows]) => sum + rows.length, 0) };
}

/** A file name that says which shop and when, and never who. */
function defaultExportFile(root, slug, env) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return join(resolve(root, DEFAULT_EXPORT_DIRECTORY), `${slug}-${env}-${stamp}-${randomBytes(3).toString('hex')}.json`);
}

// ── export ──────────────────────────────────────────────────────────────────

function runExport(args, reporter) {
  const { manifest, root, env, email } = context(args);
  const dryRun = args.values['--dry-run'] === true;

  openEnvironment({
    values: args.values,
    manifest,
    root,
    env,
    reporter,
    missing: `Il n'y a personne à exporter en ${env}.`,
  });

  reporter.section('Schéma');
  const { foreignKeys, applied, migrations } = readMap({ root, reporter });

  reporter.section('Données de la personne');
  const { records, total } = collect({ root, email, foreignKeys });
  if (total === 0) {
    // A successful answer, not a failure: "we hold nothing about you" is a
    // reply a merchant owes a requester, and an exit code the operator has to
    // interpret would turn it into an incident.
    reporter.ok('aucune ligne — cette boutique ne détient rien sous cette adresse.');
    reporter.result({ command: 'privacy export', ok: true, shop: manifest.client.slug, env, found: false, tables: {}, file: null });
    return 0;
  }

  const tables = {};
  let withheldColumns = 0;
  for (const [table, rows] of Object.entries(records).sort(([a], [b]) => a.localeCompare(b))) {
    const prepared = exportRows(table, rows);
    withheldColumns += prepared.withheld.length;
    tables[table] = prepared;
    reporter.ok(`${table} — ${rows.length} ligne(s)${prepared.withheld.length > 0 ? `, ${prepared.withheld.length} colonne(s) retenues` : ''}`);
  }

  const processors = processorReferences(records);
  const review = reviewables(records);
  const document = {
    format: EXPORT_FORMAT,
    shop: manifest.client.slug,
    env,
    subject: email,
    generatedAt: new Date().toISOString(),
    coreVersion: corePackage().version,
    schema: { version: applied, migrations },
    tables,
    processors,
    review,
  };

  const file = args.values['--out'] ? resolve(root, String(args.values['--out'])) : defaultExportFile(root, manifest.client.slug, env);

  reporter.section('Sous-traitants');
  if (processors.length === 0) reporter.ok('aucune référence chez un sous-traitant dans ces lignes.');
  for (const reference of processors) {
    reporter.warn(
      `${reference.table}.${reference.column} — ${reference.values.length} référence(s) conservées.`,
      `${reference.why} L'effacement chez le sous-traitant est une demande distincte, à faire auprès de lui.`,
    );
  }

  if (dryRun) {
    reporter.section(`Simulation. Relancez sans --dry-run pour écrire ${file}.`);
    reporter.result({ command: 'privacy export', ok: true, dryRun: true, shop: manifest.client.slug, env, found: true, rows: total, wouldWrite: file, processors, review });
    return 0;
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  reporter.section('Export');
  reporter.ok(`${file} — ${total} ligne(s), lisible par vous seul (0600)`);
  if (withheldColumns > 0) {
    reporter.ok(`${withheldColumns} colonne(s) retenues : jetons d'accès et identités d'opérateurs, nommées dans le document.`);
  }
  reporter.step("    Le fichier est en clair : c'est ce que l'article 20 demande. Transmettez-le, puis supprimez-le.");
  reporter.result({ command: 'privacy export', ok: true, shop: manifest.client.slug, env, found: true, rows: total, file, processors, review });
  return 0;
}

// ── anonymize ───────────────────────────────────────────────────────────────

function runAnonymize(args, reporter) {
  const { manifest, root, env, email } = context(args);
  const dryRun = args.values['--dry-run'] === true;

  // Typed out, in every environment. `restore` reserves its confirmation for
  // production because staging is the safe place to put data back; there is no
  // safe place to erase somebody, and a staging database is usually a restored
  // copy of the production one — the same person, in the same clear.
  if (!dryRun && args.values['--confirm'] !== manifest.client.slug) {
    throw inputError(
      "anonymiser demande le slug de la boutique, saisi.",
      `Relancez avec --confirm ${manifest.client.slug}. L'opération est irréversible : le pseudonyme est tiré au hasard et rien ne conserve la correspondance. \`shopctl privacy export\` d'abord si la personne a demandé ses données, \`shopctl backup --env ${env}\` si vous voulez pouvoir revenir en arrière.`,
    );
  }

  openEnvironment({
    values: args.values,
    manifest,
    root,
    env,
    reporter,
    missing: `Il n'y a personne à anonymiser en ${env}.`,
  });

  reporter.section('Schéma');
  const { foreignKeys } = readMap({ root, reporter });

  reporter.section('Données de la personne');
  const { predicates, records, total } = collect({ root, email, foreignKeys });
  if (total === 0) {
    reporter.ok('aucune ligne — cette boutique ne détient rien sous cette adresse.');
    reporter.result({ command: 'privacy anonymize', ok: true, shop: manifest.client.slug, env, found: false, plan: [], statements: 0 });
    return 0;
  }
  for (const [table, rows] of Object.entries(records).sort(([a], [b]) => a.localeCompare(b))) {
    reporter.ok(`${table} — ${rows.length} ligne(s)`);
  }

  const plan = anonymizePlan(predicates, records);
  const kept = Object.entries(records)
    .filter(([table]) => !plan.some((entry) => entry.table === table))
    .map(([table, rows]) => ({ table, rows: rows.length }));

  reporter.section('Ce qui va être réécrit');
  for (const entry of plan) {
    reporter[dryRun ? 'todo' : 'ok'](`${entry.table} — ${entry.rows} ligne(s) ${entry.action} : ${entry.columns.join(', ')}`);
  }
  for (const entry of kept) {
    reporter.ok(`${entry.table} — ${entry.rows} ligne(s) conservées telles quelles : rien de personnel n'y figure.`);
  }
  reporter.step('    Les montants, les dates, la TVA et les identifiants de commande restent : ce sont des pièces comptables (dix ans).');

  const review = reviewables(records);
  for (const flagged of review) {
    reporter.warn(
      `${flagged.table}.${flagged.column} — ${flagged.rows} texte(s) libre(s) conservés : ${flagged.at.join(', ') || 'sans identifiant public'}.`,
      `${flagged.why} Une carte classe une colonne, elle ne lit pas une phrase : relisez ces lignes à la main.`,
    );
  }

  const statements = anonymizeScript(predicates, records);
  if (dryRun) {
    reporter.section(`Simulation. ${statements.length} instruction(s) seraient exécutées.`);
    reporter.result({ command: 'privacy anonymize', ok: true, dryRun: true, shop: manifest.client.slug, env, found: true, rows: total, plan, kept, review, statements: statements.length });
    return 0;
  }

  applyScript(statements, { cwd: root, remote: true });
  reporter.section('Vérification');

  // Asked again, through the same predicates. The root ones must now find
  // nothing at all — that is what catches an order placed by the same person
  // between the read and the write, which no care inside the script can.
  const after = query(predicates.map(selectFor), { cwd: root, remote: true, what: "la relecture après l'anonymisation" });
  const reread = {};
  for (const [index, predicate] of predicates.entries()) {
    reread[predicate.table] = [...(reread[predicate.table] ?? []), ...after[index]];
  }
  const remaining = rootPredicates(email).reduce((sum, predicate) => sum + (reread[predicate.table]?.length ?? 0), 0);
  const failures = verifyAnonymization(reread);
  if (remaining > 0 || failures.length > 0) {
    throw verificationError(
      remaining > 0
        ? `${remaining} ligne(s) portent encore cette adresse après l'anonymisation.`
        : `${failures.length} colonne(s) n'ont pas été réécrites : ${failures.map((entry) => `${entry.table}.${entry.column}`).join(', ')}.`,
      remaining > 0
        ? 'Une commande a probablement été passée par la même personne pendant la commande. Relancez : ce qui est déjà anonymisé le reste.'
        : `Attendu : ${failures.map((entry) => `${entry.table}.${entry.column} → ${entry.expected}`).join(' ; ')}. Les lignes sont dans l'état où la commande les a laissées.`,
      { remaining, failures },
    );
  }
  reporter.ok(`${statements.length} instruction(s) appliquées, ${total} ligne(s) relues — plus rien sous cette adresse`);

  reporter.result({
    command: 'privacy anonymize',
    ok: true,
    shop: manifest.client.slug,
    env,
    found: true,
    rows: total,
    plan,
    kept,
    review,
    statements: statements.length,
  });
  return 0;
}
