/**
 * `shopctl new <slug>` — create the repository of one shop.
 *
 * The eleven steps of plan §5.2, in order, with the two that are easy to get
 * subtly wrong called out here because the cost only shows up months later.
 *
 * The core is cloned AT A TAG, WITH ITS HISTORY. Both halves are load-bearing
 * (ADR 0003): the history is what makes the next upgrade an ordinary `git
 * merge` instead of a re-generation, and the tag is what stops a shop from
 * riding an uncertified `main`. A ref that is not an immutable `v<semver>` tag
 * is refused before anything is written — including a branch name that would
 * otherwise clone perfectly and leave the shop tracking a moving target.
 *
 * The manifest is validated BEFORE the clone. Every value a shop chooses is
 * known from the command line, so an unusable one should cost the operator an
 * error message, not a directory, a git history and a red gate.
 *
 * Nothing is deleted from the clone. `create-minshop` strips its own package
 * and the upstream history because it produces a standalone storefront; a shop
 * produced here keeps receiving core tags by merge for the life of the
 * contract, and every file removed at creation is a conflict re-resolved at
 * every upgrade that touches it.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { RESERVED_SLUGS, validateManifest } from '../../../scripts/manifest-schema.mjs';
import { resourceNames } from '../../../scripts/manifest.mjs';
import { RESERVED_THEME_IDS, THEMES_DIR, isValidThemeId, normalizeThemeId } from '../../../scripts/themes.mjs';
import { CORE_ROOT, corePackage } from '../paths.mjs';
import { inputError, preconditionError, usageError, verificationError } from '../errors.mjs';
import { capture, run } from '../process.mjs';
import { buildManifest, renderManifest } from '../manifest-template.mjs';
import { COLUMNS } from '../catalog/contract.mjs';
import { DELIVERY_MAX_WIDTH } from '../catalog/media.mjs';
import { parseManifestYaml } from '../../../scripts/manifest-yaml.mjs';

/** ADR 0003: a core version is an immutable `v<semver>` tag. */
const CORE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SLUG = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Documentation domain (RFC 2606) — a placeholder that is unmistakably one,
 *  and that still satisfies the manifest's "not a platform subdomain" rule. */
const PLACEHOLDER_DOMAIN_SUFFIX = 'example.com';

export const NEW_OPTIONS = {
  '--core': 'tag',
  '--from': 'value',
  '--origin': 'value',
  '--name': 'value',
  '--domain': 'value',
  '--email': 'value',
  '--theme': 'value',
  '--from-theme': 'value',
  '--branch': 'value',
  '--dir': 'value',
};

export const newUsage = `Usage: shopctl new <slug> [options]

  --core <tag>        Tag du socle à cloner (défaut : v<version du socle courant>)
  --from <url|chemin> Dépôt du socle (défaut : le remote "origin" de ce dépôt)
  --origin <url>      Remote "origin" du futur dépôt de la boutique
  --name <nom>        Nom affiché (défaut : dérivé du slug)
  --domain <domaine>  Domaine de production (défaut : <slug>.${PLACEHOLDER_DOMAIN_SUFFIX})
  --email <adresse>   Expéditeur des e-mails (défaut : commandes@<domaine>)
  --theme <id>        Thème de la boutique (défaut : dérivé du slug)
  --from-theme <id>   Thème de référence copié (défaut : default)
  --branch <nom>      Branche de travail créée sur le tag (défaut : main)
  --dir <chemin>      Répertoire cible (défaut : shop-<slug>)
  --no-install        Ne pas installer les dépendances
  --no-verify         Ne pas exécuter la vérification minimale
  --json              Rapport de création lisible par une machine

Ce que le périmètre certifié fixe — locale, devise, marché, juridiction, mode de
checkout — n'a pas d'option : élargir une de ces énumérations est une décision de
version de schéma (ADR 0008), pas un drapeau.
`;

/**
 * Title-case a slug: every hyphen-separated word capitalized, joined by spaces.
 *
 * No worked example here, and that is not squeamishness: `config:validate`
 * fails on a CORE file that contains any shop's slug or display name, so an
 * example slug written into this file is a landmine for whoever later picks
 * that name. Only a starting point anyway — the operator passes --name for
 * anything with real typography.
 */
export function displayNameFromSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The theme id this shop's own design will live under.
 *
 * A shop never edits a shipped theme: that separation is what keeps a core
 * upgrade from colliding with the merchant's design work, and it only holds if
 * the shop gets its own directory from the first commit.
 */
export function resolveThemeId(requested, slug) {
  if (requested != null) {
    const id = String(requested).trim();
    if (!isValidThemeId(id)) {
      throw inputError(
        `"${id}" is not a usable theme id.`,
        'Lowercase letters, digits and single hyphens, at most 40 characters.',
      );
    }
    if (RESERVED_THEME_IDS.includes(id)) {
      throw inputError(
        `"${id}" is a theme the core ships.`,
        `A shop owns its design; taking a shipped id would put the merchant's work where the next core release expects its own. Reserved: ${RESERVED_THEME_IDS.join(', ')}.`,
      );
    }
    return id;
  }
  const derived = normalizeThemeId(slug);
  if (!derived) throw inputError(`no theme id can be derived from "${slug}".`, 'Pass --theme <id>.');
  // A slug that collides with a shipped design gets a suffix rather than an
  // error: the operator did not choose the collision, and the shop still needs
  // a directory of its own.
  return RESERVED_THEME_IDS.includes(derived) ? `${derived}-shop` : derived;
}

/** The core version a tag declares. */
export function versionFromTag(tag) {
  const match = CORE_TAG.exec(tag);
  if (!match) {
    throw inputError(
      `"${tag}" is not a core version tag.`,
      'A shop is created from an immutable `v<major>.<minor>.<patch>` tag (ADR 0003). A branch would leave the shop riding an uncertified core.',
    );
  }
  return tag.slice(1);
}

/**
 * Refuse to clone when git has no author to commit as.
 *
 * `git var GIT_AUTHOR_IDENT` rather than reading `user.name`: it is git's OWN
 * resolution — config, GIT_AUTHOR_* environment variables, and the auto-detect
 * it may refuse — so this cannot disagree with the `git commit` further down.
 * A reimplementation of those rules would eventually pass where the commit
 * fails, which is how the first CI run of this job died 540 files into a clone.
 *
 * Asked from a directory OUTSIDE any repository, because the shop about to be
 * created is a fresh clone with no local config: a `user.email` set locally in
 * whatever tree the operator happens to stand in would be a false pass.
 */
function assertGitIdentity() {
  const result = capture('git', ['var', 'GIT_AUTHOR_IDENT'], { cwd: tmpdir(), allowFailure: true });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  throw preconditionError(
    'git has no identity to author the shop\'s first commit with.',
    'git config --global user.name "…" && git config --global user.email "…" — or set GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL in CI. `shopctl doctor` reports this as a blocking prerequisite.',
  );
}

/** Refuse a target that already holds anything. An existing EMPTY directory is
 *  fine — that is what `mkdir shop-x && cd ..` leaves, and git clones into it. */
function assertUsableTarget(target) {
  if (!existsSync(target)) return;
  const entries = readdirSync(target);
  if (entries.length > 0) {
    throw preconditionError(
      `${target} already exists and is not empty (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}).`,
      'Choose another --dir, or remove the directory. shopctl never writes into a tree it did not create.',
    );
  }
}

/** The core repository to clone from. Defaults to wherever THIS checkout came
 *  from, which is the agency core on an agency machine, and is what makes the
 *  generated shop's `core` remote point at something the whole team can fetch. */
function defaultCoreRepository() {
  const result = capture('git', ['remote', 'get-url', 'origin'], { cwd: CORE_ROOT, allowFailure: true });
  const url = result.stdout.trim();
  if (result.status !== 0 || !url) {
    throw preconditionError(
      'this checkout has no "origin" remote, so shopctl cannot tell where the core lives.',
      'Pass --from <url|path> with the core repository.',
    );
  }
  return url;
}

/** Does this ref exist as a TAG in that repository? Asked over the wire before
 *  anything is created, so a typo costs a message and not a half-clone. */
function assertTagExists(repository, tag) {
  const listed = capture('git', ['ls-remote', '--tags', '--refs', repository], { allowFailure: true });
  if (listed.status !== 0) {
    throw preconditionError(
      `cannot read the tags of ${repository}.`,
      'Check the URL and that this machine can reach it (SSH agent, credentials, VPN).',
    );
  }
  const tags = listed.stdout
    .split('\n')
    .map((line) => line.split('refs/tags/')[1]?.trim())
    .filter(Boolean);
  if (tags.includes(tag)) return tags;
  const known = tags.filter((name) => CORE_TAG.test(name)).sort();
  throw inputError(
    `${repository} has no tag "${tag}".`,
    known.length > 0
      ? `Published core versions: ${known.join(', ')}.`
      : 'That repository publishes no core version tag yet; a shop can only be created from one (ADR 0003).',
  );
}

/**
 * @param {{ positionals: string[], values: Record<string, string|boolean> }} args
 * @param {import('../report.mjs').Reporter} reporter
 */
export function runNew(args, reporter) {
  const [slug, ...extra] = args.positionals;
  if (!slug) throw usageError('shopctl new needs a slug.', newUsage.trim());
  if (extra.length > 0) throw usageError(`shopctl new takes one slug; got "${[slug, ...extra].join('", "')}".`);

  // ---------------------------------------------------------------- 1. values
  if (!SLUG.test(slug) || slug.length < 3 || slug.length > 32) {
    throw inputError(
      `"${slug}" is not a usable shop slug.`,
      'Lowercase letters, digits and single hyphens, 3 to 32 characters. It becomes part of every Cloudflare resource name.',
    );
  }
  if (RESERVED_SLUGS.includes(slug)) {
    throw inputError(
      `"${slug}" is reserved by the platform.`,
      `It is already a route prefix, a resource family or an environment word; a shop with that name would read as one. Reserved: ${RESERVED_SLUGS.join(', ')}.`,
    );
  }

  const displayName = String(args.values['--name'] ?? displayNameFromSlug(slug));
  const domain = String(args.values['--domain'] ?? `${slug}.${PLACEHOLDER_DOMAIN_SUFFIX}`);
  const email = String(args.values['--email'] ?? `commandes@${domain}`);
  const theme = resolveThemeId(args.values['--theme'], slug);
  const referenceTheme = String(args.values['--from-theme'] ?? 'default');
  const branch = String(args.values['--branch'] ?? 'main');
  const repository = String(args.values['--from'] ?? defaultCoreRepository());
  const originUrl = args.values['--origin'] ? String(args.values['--origin']) : null;
  const install = args.values['--no-install'] !== true;
  const verify = args.values['--no-verify'] !== true;

  const tag = String(args.values['--core'] ?? `v${corePackage().version}`);
  const coreVersion = versionFromTag(tag);

  if (theme === referenceTheme) {
    throw inputError(
      `--theme and --from-theme are both "${theme}".`,
      'The shop copies a reference design into a directory of its own; copying it onto itself would leave nothing to customize.',
    );
  }

  // The manifest is decided and checked here, before a single byte is written.
  const manifest = buildManifest({ slug, displayName, domain, email, theme, coreVersion });
  const { errors } = validateManifest(manifest, { coreVersion });
  if (errors.length > 0) {
    throw inputError(
      `these options do not make a valid manifest:\n${errors.map((error) => `    ${error.path} ${error.message}`).join('\n')}`,
      'Nothing was created.',
    );
  }

  const cwd = process.cwd();
  // Under --json, stdout belongs to the report and nothing else, so a child's
  // stdout (npm's install log, above all) is pointed at our stderr rather than
  // interleaved into a document a caller is about to parse.
  const childStdio = reporter.json ? ['inherit', 2, 'inherit'] : 'inherit';
  const target = resolve(cwd, String(args.values['--dir'] ?? `shop-${slug}`));
  if (target === cwd) throw preconditionError('--dir is the current directory.', 'shopctl new creates a new repository; give it a directory of its own.');
  assertUsableTarget(target);
  // Whether the clone is ours to remove. An operator who pre-made an empty
  // directory keeps it; only a tree shopctl created is a tree shopctl deletes.
  const createdTarget = !existsSync(target);

  // ------------------------------------------------------- 2..5. the git side
  // Both preconditions before the clone: 540 files are a long way to travel to
  // discover that git cannot sign the commit at the end of it.
  assertGitIdentity();
  reporter.step(`Socle ${repository} @ ${tag}`);
  assertTagExists(repository, tag);
  reporter.ok(`tag ${tag} trouvé (socle ${coreVersion})`);

  reporter.step(`Clonage dans ${relative(cwd, target) || target} …`);
  run('git', ['clone', '--branch', tag, repository, target], { cwd, stdio: childStdio });
  // The clone leaves HEAD detached on the tag. A shop works on a branch; the
  // tag stays exactly where it was, which is what the next upgrade merges into.
  run('git', ['checkout', '-b', branch], { cwd: target, stdio: childStdio });
  run('git', ['remote', 'rename', 'origin', 'core'], { cwd: target, stdio: childStdio });
  if (originUrl) run('git', ['remote', 'add', 'origin', originUrl], { cwd: target, stdio: childStdio });
  reporter.ok(`historique cloné sur la branche ${branch}, remote core${originUrl ? ' et origin' : ''} configuré${originUrl ? 's' : ''}`);

  // -------------------------------------------------------- 6..8. shop files
  const referenceDir = resolve(target, THEMES_DIR, referenceTheme);
  if (!existsSync(referenceDir)) {
    throw inputError(
      `the core at ${tag} has no theme "${referenceTheme}".`,
      `Available: ${readdirSync(resolve(target, THEMES_DIR)).filter((name) => !name.startsWith('.')).join(', ')}. The shop was left in ${target} for inspection.`,
    );
  }
  const themeDir = resolve(target, THEMES_DIR, theme);
  if (existsSync(themeDir)) {
    throw inputError(
      `the core at ${tag} already carries a theme named "${theme}".`,
      `Pass --theme <id>. The shop was left in ${target} for inspection.`,
    );
  }
  cpSync(referenceDir, themeDir, { recursive: true });

  const manifestText = renderManifest(manifest, {
    header: [
      `Manifeste de la boutique ${displayName}.`,
      `Généré par \`shopctl new ${slug}\` depuis le socle ${tag}.`,
      'Source de vérité non sensible : aucune clé, aucun secret, jamais.',
    ],
  });
  // Read back what was rendered. A generator and a parser that disagree about
  // quoting would produce a shop whose display name quietly lost a character,
  // and nothing downstream can tell that from a merchant's own typo.
  const reparsed = parseManifestYaml(manifestText, { file: 'client/client.yaml' });
  if (JSON.stringify(reparsed) !== JSON.stringify(manifest)) {
    throw verificationError(
      'the generated manifest does not read back as the values it was built from.',
      'This is a bug in shopctl, not in the options given. Report the slug and display name used.',
    );
  }

  mkdirSync(resolve(target, 'client'), { recursive: true });
  writeFileSync(resolve(target, 'client/client.yaml'), manifestText);
  writeFileSync(resolve(target, 'theme.config.json'), `${JSON.stringify({ theme }, null, 2)}\n`);
  mkdirSync(resolve(target, 'imports'), { recursive: true });
  writeFileSync(resolve(target, 'imports/README.md'), importsReadme(slug));
  reporter.ok(`manifeste client/client.yaml, thème src/themes/${theme}/ (copié de ${referenceTheme}), imports/`);

  // The build inputs come from the manifest, never from a hand-edited file:
  // rendering them here is what makes the shop buildable at its first commit.
  run('node', ['scripts/prepare-client.mjs', slug], { cwd: target, stdio: 'ignore' });
  reporter.ok('wrangler.jsonc rendu depuis le manifeste');

  // Staged before verification, because the gates read the INDEX (`git
  // ls-files`): an untracked manifest is invisible to exactly the checks that
  // exist to look at it.
  run('git', ['add', '-A'], { cwd: target, stdio: 'ignore' });

  // ------------------------------------------------------ 10. minimal verify
  const checks = [];
  if (verify) {
    reporter.section('Vérification minimale');
    // --json on the manifest gate, because its report is structured and this
    // command needs to tell two very different failures apart (see below).
    const manifestGate = capture('node', ['scripts/check-manifest.mjs', '--json'], { cwd: target, allowFailure: true });
    checks.push({ check: 'manifeste', ok: manifestGate.status === 0, status: manifestGate.status });
    if (manifestGate.status === 0) reporter.ok('manifeste');
    else reporter.fail(`manifeste — ${describeGateFailure(manifestGate)}`);

    const pathsGate = capture('node', ['scripts/check-paths.mjs'], { cwd: target, allowFailure: true });
    checks.push({ check: 'propriété des chemins', ok: pathsGate.status === 0, status: pathsGate.status });
    if (pathsGate.status === 0) reporter.ok('propriété des chemins');
    else reporter.fail(`propriété des chemins — ${(pathsGate.stderr || pathsGate.stdout).trim().split('\n').slice(0, 6).join('\n    ')}`);

    if (checks.some((check) => !check.ok)) {
      // A neutrality finding on THIS shop's own slug is not a core bug, it is a
      // bad name: the core legitimately contains the word, and no shop may be
      // called after something the core already says. Saying "this is a core
      // bug" there would send the operator to file a ticket when the fix is to
      // pick another slug. RESERVED_SLUGS catches the known ones before the
      // clone; it can never catch them all, because the gate also trips on
      // ordinary English the core happens to use.
      const collisions = ownSlugCollisions(manifestGate, slug);
      if (collisions.length > 0 && checks.every((check) => check.ok || check.check === 'manifeste')) {
        if (createdTarget) rmSync(target, { recursive: true, force: true });
        throw inputError(
          `"${slug}" is a word this core already uses, in ${collisions.length} of its own file${collisions.length > 1 ? 's' : ''}.`,
          [
            'The core-neutrality gate refuses a core file that names a shop, so this shop could never pass its own CI.',
            `Files: ${collisions.slice(0, 5).join(', ')}${collisions.length > 5 ? ', …' : ''}`,
            'Choose another slug. Nothing was kept.',
          ].join('\n'),
        );
      }
      throw verificationError(
        'the generated shop does not pass its own gates.',
        `Left in ${target} so the failure can be read. This is a core bug, not a bad option: every value shopctl wrote was validated first.`,
        { checks },
      );
    }
  } else {
    reporter.warn('vérification minimale ignorée (--no-verify)');
  }

  // ----------------------------------------------------------- 9. the commit
  run(
    'git',
    ['commit', '--quiet', '-m', `Initialiser la boutique ${slug} depuis le socle ${tag}`],
    { cwd: target, stdio: 'ignore' },
  );
  reporter.ok(`premier commit sur ${branch}`);

  let installed = false;
  if (install) {
    reporter.section('Installation des dépendances');
    run('npm', ['ci'], { cwd: target, stdio: childStdio });
    run('npm', ['ci', '--prefix', 'mcp'], { cwd: target, stdio: childStdio });
    installed = true;
  }

  // --------------------------------------------------------- 11. what's next
  const names = resourceNames(manifest);
  const nextSteps = [
    ...(installed ? [] : ['npm ci', 'npm ci --prefix mcp']),
    'shopctl doctor',
    `remplacer le domaine placeholder ${domain} dans client/client.yaml`,
    ...(originUrl ? [`git push -u origin ${branch}`] : ['git remote add origin <url> && git push -u origin ' + branch]),
    'npm run verify',
  ];

  reporter.section(`Boutique ${displayName} prête dans ${relative(cwd, target) || target}`);
  reporter.step(`  slug     ${slug}`);
  reporter.step(`  thème    ${theme}`);
  reporter.step(`  socle    ${tag}`);
  reporter.step(`  Worker   ${names.worker}  (+ ${names.database}, ${names.images}, ${names.files}, ${names.sessions})`);
  reporter.section('Prochaines actions');
  for (const step of nextSteps) reporter.step(`  ${step}`);

  reporter.result({
    command: 'new',
    ok: true,
    target,
    shop: { slug, displayName, domain, email, theme, referenceTheme },
    core: { repository, tag, version: coreVersion },
    git: { branch, remotes: { core: repository, origin: originUrl } },
    resources: names,
    installed,
    checks,
    nextSteps,
  });
  return 0;
}

/**
 * Core files the gate says name THIS shop, from its own JSON report.
 *
 * Reading the gate's report rather than re-running its logic: the CLI and the
 * CI must not be able to reach different conclusions about the same tree, and
 * `check-manifest.mjs --json` already publishes the findings with the slug each
 * one names.
 */
function ownSlugCollisions(gate, slug) {
  let report;
  try {
    report = JSON.parse(gate.stdout);
  } catch {
    return [];
  }
  const findings = report?.coreNeutrality?.findings ?? [];
  if (findings.length === 0) return [];
  // Only when the neutrality findings are the WHOLE story, and all of them name
  // this shop. A manifest that is also invalid for another reason is a
  // different failure and keeps the report it deserves.
  const manifestErrors = (report?.manifests ?? []).some((entry) => entry.errors?.length > 0);
  if (manifestErrors || (report?.collisions ?? []).length > 0) return [];
  if (!findings.every((finding) => finding.slug === slug)) return [];
  return [...new Set(findings.map((finding) => finding.path))];
}

/** The first line worth showing from a gate that failed. */
function describeGateFailure(gate) {
  const collisions = (() => {
    try {
      return JSON.parse(gate.stdout)?.coreNeutrality?.findings ?? [];
    } catch {
      return [];
    }
  })();
  if (collisions.length > 0) return `le cœur nomme déjà "${collisions[0].value}" (${collisions[0].path})`;
  return (gate.stderr || gate.stdout).trim().split('\n').slice(0, 6).join('\n    ');
}

/** The README `shopctl new` drops in a shop's imports/ directory.
 *  Exported so a gate can check it still names every column of the contract:
 *  a column the merchant's documentation does not mention is a column filled by
 *  guesswork. */
export function importsReadme(slug) {
  // A `|` inside a cell ends the cell, and the separator this contract uses for
  // multi-value columns is exactly that character.
  const cell = (value) => value.replaceAll('|', '\\|');
  const columns = COLUMNS.map((column) =>
    `| \`${column.name}\` | ${column.scope === 'product' ? 'produit' : 'unité'} | ${cell(column.description)} |`).join('\n');
  return `# Imports de ${slug}

Les sources du catalogue de cette boutique : le CSV produit et les médias qu'il
référence. Rien ici n'est lu à l'exécution — l'import écrit dans D1 et R2, et
c'est la boutique déployée qui sert le résultat.

    shopctl catalog validate ./imports/catalog.csv
    shopctl catalog import ./imports/catalog.csv --dry-run
    shopctl catalog import ./imports/catalog.csv

## Une ligne, une unité vendue

Un produit simple tient sur une ligne : sa référence est dans \`sku\`, la colonne
\`variant\` reste vide. Un produit à variantes occupe une ligne par variante :
chacune a sa propre référence dans \`sku\`, toutes portent la référence du produit
parent dans \`product\`, et les colonnes de portée « produit » ne se renseignent
qu'une fois — les répéter à l'identique est toléré, les contredire est refusé.

| Colonne | Portée | Rôle |
| --- | --- | --- |
${columns}

Le séparateur est déduit de la ligne d'en-tête : un tableur français exporte en
\`;\`, ce qui évite d'avoir à guillemeter chaque prix.

## Ce que l'import garantit

- **rien n'est écrit tant que tout n'est pas jugé.** Une image illisible ou une
  catégorie inconnue arrête la totalité de l'import ;
- **idempotent par référence.** Relancer le même fichier ne produit aucune
  écriture, et une exécution interrompue reprend là où elle en était : l'import
  recalcule ce qui reste depuis l'état de la boutique ;
- **rien n'est supprimé.** Une variante qui quitte le fichier est désactivée, pas
  effacée — une commande passée la référence. Les produits absents du fichier ne
  sont pas touchés ;
- **les pertes se demandent.** Déplacer une URL (\`--allow-slug-change\`), retirer
  une unité vendue (\`--allow-remove-variants\`) et créer une catégorie
  (\`--create-categories\`) ont chacune leur option.

## Les images

Les chemins sont relatifs à ce dossier et ne peuvent pas en sortir. Le type est
lu dans les octets, pas dans l'extension : un fichier dont le nom ment sur son
contenu est refusé, et le SVG n'est jamais accepté. La clé de stockage est
dérivée du contenu, donc deux produits qui partagent une photo partagent un seul
objet, et un réimport n'en renvoie aucun.

La boutique sert ses images redimensionnées à la demande, en quatre largeurs :
une source plus grande que ${DELIVERY_MAX_WIDTH} px est signalée mais acceptée telle quelle.
`;
}
