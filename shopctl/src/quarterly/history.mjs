/**
 * What changed in a shop over the period (ADR 0035), read from its own git
 * history: the core versions it moved through, and the pull requests of its
 * own that were merged.
 *
 * A merchant publishes in the admin — products, pages, settings live in D1 —
 * so the repository holds only what the agency did: core upgrades (a branch
 * `socle/<tag>`, merged by a pull request `Socle <tag>`) and the shop's own
 * changes (its theme, its configuration). A core upgrade is described by the
 * core's own words, the release notes of each version crossed
 * (`docs/migrations/v<x.y.z>.md`, which the shop's tree carries), and their
 * « Guide administrateur » section says what the merchant can do that they
 * could not before. The shop's own pull requests are described by their
 * titles, classified by the conventions below, and a line `Pour le client :`
 * in one of their commit messages gives the sentence to use instead —
 * `Pour le client : -` keeps the change out of the message.
 *
 * Read on the first-parent line of HEAD, which is the default branch in the
 * fleet's checkout (`fetch-depth: 0`). Read-only: `git log`, `git show`,
 * `git ls-tree`, `git rev-list`, `git diff --name-only`.
 */
import { capture } from '../process.mjs';
import { compareVersions } from '../version.mjs';
import { MIGRATION_NOTES_DIR, upgradeBranch } from '../upgrade.mjs';

const FIELD = '\x1f';
const RECORD = '\x1e';

/** The conventional prefixes, and what each makes of a change. */
const PREFIXES = {
  feat: 'evolution',
  perf: 'evolution',
  style: 'evolution',
  fix: 'correction',
  docs: 'maintenance',
  chore: 'maintenance',
  ci: 'maintenance',
  test: 'maintenance',
  build: 'maintenance',
  refactor: 'maintenance',
};
const TITLE_PREFIX = /^(\w+)(?:\([^)]*\))?!?\s*:\s*/;
const BRANCH_PREFIX = /^(\w+)\//;

/** A title that says it repairs something, without a prefix to say so. */
const REPAIR = /^(corriger|restaurer|rétablir|réparer|ne plus)\b/i;

/**
 * Paths that are the agency's tooling, not the shop: a change that touches
 * nothing else is maintenance, whatever its title says.
 */
const TOOLING = /^(?:\.github\/|test\/|docs\/|scripts\/|shopctl\/|client\/certification\/|README|AGENTS\.md$|CLAUDE\.md$)/;

/** `Pour le client : …` in a commit message: the sentence the message uses. */
const CLIENT_LINE = /^\s*Pour le client\s*:\s*(.*?)\s*$/im;

/** What git answered, from a tree. */
function git(root, args) {
  return capture('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }).stdout;
}
function gitMaybe(root, args) {
  const result = capture('git', args, { cwd: root, allowFailure: true, maxBuffer: 64 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

/** git's own date syntax, never ambiguous about its zone. */
const gitDate = (instant) => `${instant.toISOString().slice(0, 19).replace('T', ' ')} +0000`;

/**
 * A change's kind, from its title and branch.
 *
 *   socle         a core upgrade: its notes describe it, not its title
 *   evolution     feat (and anything that says nothing else)
 *   correction    fix, or a title that starts « Corriger », « Restaurer »…
 *   maintenance   docs, chore, ci, test, build, refactor — or only tooling touched
 *
 * @param {{ title: string, branch?: string|null, toolingOnly?: boolean }} change
 */
export function classify({ title, branch = null, toolingOnly = false }) {
  const text = String(title ?? '').trim();
  if ((branch && branch.startsWith(upgradeBranch(''))) || /^Socle v\d+\.\d+\.\d+\b/.test(text)) return 'socle';
  const prefix = (text.match(TITLE_PREFIX)?.[1] ?? branch?.match(BRANCH_PREFIX)?.[1] ?? '').toLowerCase();
  if (toolingOnly) return 'maintenance';
  if (PREFIXES[prefix]) return PREFIXES[prefix];
  if (REPAIR.test(cleanTitle(text))) return 'correction';
  return 'evolution';
}

/** The title a reader sees: no conventional prefix, a capital first letter. */
export function cleanTitle(title) {
  const text = String(title ?? '').trim();
  const prefix = text.match(TITLE_PREFIX);
  const rest = prefix && PREFIXES[prefix[1].toLowerCase()] ? text.slice(prefix[0].length) : text;
  return rest ? rest[0].toUpperCase() + rest.slice(1) : rest;
}

/** The `Pour le client :` line of some commit messages: null when none,
 *  '' when the change is to stay out of the message. */
export function clientLine(messages) {
  for (const message of messages) {
    const match = CLIENT_LINE.exec(message);
    if (match) return match[1] === '-' ? '' : match[1];
  }
  return null;
}

/**
 * One first-parent commit, as a change.
 *
 *   « Merge pull request #12 from owner/branch » + the title on the next line
 *   « Merge branch 'socle/v0.13.2' » or « Merge tag 'v0.13.2' », merged by hand
 *   « Title (#12) », a squashed pull request
 *   anything else, a commit pushed to the default branch directly
 */
export function parseCommit({ sha, parents, time, subject, body }) {
  const date = new Date(time * 1000).toISOString();
  const merge = parents.length > 1;
  const pull = subject.match(/^Merge pull request #(\d+) from [^/\s]+\/(\S+)/);
  if (pull) {
    const title = body.split('\n').map((line) => line.trim()).find(Boolean) ?? `Pull request #${pull[1]}`;
    return { sha, date, merge, number: Number(pull[1]), branch: pull[2], title };
  }
  const branch = subject.match(/^Merge (?:remote-tracking )?branch '([^']+)'/);
  if (merge && branch) return { sha, date, merge, number: null, branch: branch[1].replace(/^origin\//, ''), title: subject };
  const tag = subject.match(/^Merge tag '(v\d+\.\d+\.\d+)'/);
  if (merge && tag) return { sha, date, merge, number: null, branch: upgradeBranch(tag[1]), title: `Socle ${tag[1]}` };
  const squash = subject.match(/^(.*\S)\s+\(#(\d+)\)$/);
  if (squash) return { sha, date, merge, number: Number(squash[2]), branch: null, title: squash[1] };
  return { sha, date, merge, number: null, branch: null, title: subject, direct: true };
}

/**
 * The release notes of one core version, as the report uses them.
 *
 * `summary` is the first sentence of the opening paragraph, for the agency;
 * `guide` the bullets of « Guide administrateur », for the merchant — less the
 * ones that say nothing changed.
 */
export function parseNotes(text) {
  const lines = String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const title = (lines.find((line) => line.startsWith('# ')) ?? '').slice(2).trim();
  const sections = [];
  let current = { heading: null, lines: [] };
  for (const line of lines) {
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  const opening = sections[0].lines.join('\n').trim().split(/\n\s*\n/)[0] ?? '';
  const intro = opening.replace(/\s*\n\s*/g, ' ').trim();
  const summary = intro.match(/^(.+?[.!?])(?=\s|$)/)?.[1] ?? intro;

  const guideSection = sections.find((section) => /^Guide administrateur/i.test(section.heading ?? ''));
  const guide = [];
  for (const line of guideSection?.lines ?? []) {
    if (/^\s*[-*] /.test(line)) guide.push(line.replace(/^\s*[-*] /, '').trim());
    else if (guide.length > 0 && /^\s+\S/.test(line)) guide[guide.length - 1] += ` ${line.trim()}`;
  }
  return {
    title,
    summary,
    guide: guide
      .map((bullet) => bullet.replace(/\s*[;.]$/, ''))
      .filter((bullet) => bullet && !/^(inchangé|aucun|rien)(?![\p{L}\p{N}])/iu.test(bullet)),
  };
}

/** The core version a revision carries, from its package.json. */
function versionAt(root, revision) {
  if (!revision) return null;
  const text = gitMaybe(root, ['show', `${revision}:package.json`]);
  try {
    return text ? JSON.parse(text).version ?? null : null;
  } catch {
    return null;
  }
}

/** The last first-parent commit at or before an instant, or null. */
function revisionAt(root, instant) {
  const sha = (gitMaybe(root, ['rev-list', '-1', '--first-parent', `--before=${gitDate(instant)}`, 'HEAD']) ?? '').trim();
  return sha || null;
}

/** The first commit of the first-parent history, or null. */
function firstRevision(root) {
  const sha = (gitMaybe(root, ['rev-list', '--first-parent', '--max-parents=0', 'HEAD']) ?? '').trim().split('\n')[0];
  return sha || null;
}

/**
 * The shop's history over the period.
 *
 * @param {string} root the shop's tree, a full clone
 * @param {{ start: Date, end: Date }} period
 */
export function readHistory(root, period) {
  // A day of margin: git's --since stops a first-parent walk early, and the
  // exact cut is made below on the commit time.
  const since = new Date(period.start.getTime() - 86_400_000);
  const log = git(root, ['log', '--first-parent', `--since=${gitDate(since)}`, `--format=%H${FIELD}%P${FIELD}%ct${FIELD}%s${FIELD}%b${RECORD}`, 'HEAD']);
  const commits = log
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, parents, time, subject, body = ''] = record.split(FIELD);
      return { sha, parents: parents.split(' ').filter(Boolean), time: Number(time), subject, body };
    })
    .filter((commit) => commit.time * 1000 >= period.start.getTime() && commit.time * 1000 < period.end.getTime())
    .reverse();

  const changes = [];
  const direct = [];
  for (const commit of commits) {
    const change = parseCommit(commit);
    if (change.direct) {
      direct.push({ sha: change.sha, date: change.date, title: change.title });
      continue;
    }
    const kind0 = classify(change);
    let toolingOnly = false;
    let messages = [commit.body];
    if (kind0 !== 'socle') {
      const files = (gitMaybe(root, ['diff', '--name-only', `${commit.sha}^1`, commit.sha]) ?? '').split('\n').filter(Boolean);
      toolingOnly = files.length > 0 && files.every((file) => TOOLING.test(file));
      if (commit.parents.length > 1) {
        // The merge's own message first, then the branch's, newest first.
        messages = [commit.body, ...(gitMaybe(root, ['log', '--format=%B%x1e', `${commit.parents[0]}..${commit.parents[1]}`]) ?? '').split(RECORD)];
      }
    }
    const kind = kind0 === 'socle' ? 'socle' : classify({ ...change, toolingOnly });
    const client = kind === 'socle' ? null : clientLine(messages);
    changes.push({
      kind,
      number: change.number,
      title: cleanTitle(change.title),
      branch: change.branch,
      sha: change.sha,
      date: change.date,
      ...(client !== null ? { client } : {}),
    });
  }

  // A shop created during the period starts at its first commit's version.
  const startRevision = revisionAt(root, period.start) ?? firstRevision(root);
  const endRevision = revisionAt(root, period.end);
  const from = versionAt(root, startRevision);
  const to = versionAt(root, endRevision);
  const versions = [];
  if (from && to && compareVersions(to, from) > 0) {
    const listed = (gitMaybe(root, ['ls-tree', '--name-only', endRevision, `${MIGRATION_NOTES_DIR}/`]) ?? '').split('\n');
    const crossed = listed
      .map((path) => path.match(/\/v(\d+\.\d+\.\d+)\.md$/)?.[1])
      .filter((version) => version && compareVersions(version, from) > 0 && compareVersions(version, to) <= 0)
      .sort(compareVersions);
    for (const version of crossed) {
      const notes = parseNotes(gitMaybe(root, ['show', `${endRevision}:${MIGRATION_NOTES_DIR}/v${version}.md`]) ?? '');
      versions.push({ version, ...notes });
    }
  }
  return { core: { from, to, versions }, changes, direct };
}
