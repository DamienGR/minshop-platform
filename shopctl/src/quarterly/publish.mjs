/**
 * Where a quarterly report goes (ADR 0035): an issue of the shop's own
 * repository, private, one per quarter.
 *
 * Never the fleet's repository: it is public, and the report states the
 * shop's sales. The issue is found again by its exact title, so the final
 * report updates the issue its preview opened, and a run started again after
 * a setting was fixed rewrites the same issue rather than opening a second one.
 * An issue already closed — the report was sent — is rewritten closed.
 *
 * Through gh, with GH_TOKEN: in the fleet, a token that writes the issues of
 * the shops' repositories and nothing else. The body goes on standard input,
 * never on the command line.
 *
 * A public repository is refused, before anything is read: a shop's
 * repository may have been made public (GitHub Free, decision of 2026-10-08
 * for the certification's shops), and an issue there would publish the
 * merchant's sales. So is a repository without issues — `shopctl repo` creates
 * them so (forge.mjs) — with the command that turns them on.
 */
import { externalError, preconditionError } from '../errors.mjs';
import { gh as forgeGh } from '../forge.mjs';

/** Issues listed to find the quarter's: a shop's repository has few. */
const LISTED = 200;

/**
 * Can the report be published in this repository? Asked before any source is
 * read: a report that cannot go out is a run to start again.
 *
 * @param {{ repository: string, cwd?: string, gh?: typeof forgeGh }} options
 * @returns {{ repository: string, visibility: string }}
 */
export function checkDestination({ repository, cwd, gh = forgeGh }) {
  const viewed = gh(['repo', 'view', repository, '--json', 'visibility,hasIssuesEnabled'], { cwd });
  let info;
  try {
    info = JSON.parse(viewed.stdout.slice(Math.max(0, viewed.stdout.search(/[[{]/))));
  } catch {
    throw externalError(`gh repo view n'a pas répondu en JSON pour ${repository}.`);
  }
  const visibility = String(info?.visibility ?? '').toLowerCase();
  if (visibility !== 'private') {
    throw preconditionError(
      `${repository} n'est pas privé (${visibility || 'visibilité inconnue'}) : le rapport, qui dit les ventes de la boutique, n'y sera pas publié.`,
      `Rendez le dépôt privé (gh repo edit ${repository} --visibility private --accept-visibility-change-consequences), ou produisez le rapport avec --out et envoyez-le autrement.`,
    );
  }
  if (info.hasIssuesEnabled === false) {
    throw preconditionError(
      `les issues de ${repository} sont désactivées : le rapport ne peut pas y être ouvert.`,
      `gh repo edit ${repository} --enable-issues — shopctl repo crée les dépôts de boutique sans issues.`,
    );
  }
  return { repository, visibility };
}

/**
 * @param {{ repository: string, title: string, body: string, cwd?: string, gh?: typeof forgeGh }} options
 * @returns {{ action: 'created'|'updated', number: number|null, url: string|null, repository: string }}
 */
export function publishIssue({ repository, title, body, cwd, gh = forgeGh }) {
  const listed = gh(['issue', 'list', '--repo', repository, '--state', 'all', '--limit', String(LISTED), '--json', 'number,title,url'], { cwd });
  let issues;
  try {
    issues = JSON.parse(listed.stdout || '[]');
  } catch {
    throw externalError(`gh issue list n'a pas répondu en JSON pour ${repository}.`);
  }
  const found = (Array.isArray(issues) ? issues : []).find((issue) => issue?.title === title);
  if (found) {
    gh(['issue', 'edit', String(found.number), '--repo', repository, '--body-file', '-'], { cwd, input: body });
    return { action: 'updated', number: found.number, url: found.url ?? null, repository };
  }
  const created = gh(['issue', 'create', '--repo', repository, '--title', title, '--body-file', '-'], { cwd, input: body });
  const url = created.stdout.trim().split('\n').filter(Boolean).at(-1) ?? null;
  const number = Number(url?.match(/\/issues\/(\d+)$/)?.[1]) || null;
  return { action: 'created', number, url, repository };
}
