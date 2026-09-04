/**
 * Core versions, as tags and as numbers.
 *
 * ADR 0003 makes a core version an IMMUTABLE `v<major>.<minor>.<patch>` tag, and
 * everything downstream of that decision — which tag a shop rides, whether a
 * target is ahead of it, which migration notes fall between the two — is
 * arithmetic on three integers. It lives here rather than in whichever command
 * needed it first because `new`, `core` and `fleet` all ask the same questions,
 * and three implementations of "is this version newer" is three chances to
 * upgrade a shop backwards.
 *
 * Pure functions only: nothing here runs git, reads a file or knows what a shop
 * is. That is what makes the ordering testable without a repository.
 */
import { inputError } from './errors.mjs';

/** ADR 0003: a core version is an immutable `v<semver>` tag. No pre-release and
 *  no build metadata — a shop rides a certified version or it rides nothing. */
export const CORE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** True when `tag` names a core version. */
export const isCoreTag = (tag) => CORE_TAG.test(String(tag ?? ''));

/** The core version a tag declares, e.g. `v1.2.3` -> `1.2.3`. */
export function versionFromTag(tag) {
  if (!isCoreTag(tag)) {
    throw inputError(
      `"${tag}" is not a core version tag.`,
      'A shop is created from an immutable `v<major>.<minor>.<patch>` tag (ADR 0003). A branch would leave the shop riding an uncertified core.',
    );
  }
  return String(tag).slice(1);
}

/** The tag a version is published under. The `v` is not decoration: it is what
 *  tells a core tag from a shop's own tag in `git tag --merged`. */
export const tagForVersion = (version) => `v${String(version).replace(/^v/, '')}`;

/** @returns {[number, number, number]|null} */
export function parseVersion(version) {
  const parts = String(version ?? '')
    .replace(/^v/, '')
    .split('.');
  if (parts.length !== 3) return null;
  const numbers = parts.map(Number);
  return numbers.every((part) => Number.isInteger(part) && part >= 0) ? /** @type {any} */ (numbers) : null;
}

/**
 * Order two versions: negative when `a` is older, 0 when equal, positive when
 * newer. An unparsable version sorts as the oldest thing there is, which is the
 * reading that makes an unknown version a candidate for an upgrade rather than
 * a shop nobody dares touch.
 */
export function compareVersions(a, b) {
  const left = parseVersion(a) ?? [-1, -1, -1];
  const right = parseVersion(b) ?? [-1, -1, -1];
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** The newest of a list of versions or tags, or null for an empty list. */
export function latestVersion(versions) {
  const known = [...versions].filter((entry) => parseVersion(entry) !== null);
  if (known.length === 0) return null;
  return known.sort(compareVersions).at(-1);
}

/**
 * Is a step from `from` to `to` a breaking one?
 *
 * The same 0.x reading `checkCoreCompatibility()` applies to a manifest: before
 * 1.0 a MINOR bump may break, after it a MAJOR one does. Used to decide whether
 * an upgrade demands migration notes, so the two readings must agree — a shop
 * that the manifest gate refuses after an upgrade that called itself routine is
 * exactly the surprise this milestone exists to remove.
 */
export function isBreakingStep(from, to) {
  const before = parseVersion(from);
  const after = parseVersion(to);
  if (!before || !after) return true;
  if (after[0] !== before[0]) return true;
  return after[0] === 0 && after[1] !== before[1];
}

/** Every version in `versions` strictly between `from` (exclusive) and `to`
 *  (inclusive), oldest first. The steps an upgrade actually crosses. */
export function versionsBetween(versions, from, to) {
  return [...versions]
    .filter((version) => parseVersion(version) !== null)
    .filter((version) => (from ? compareVersions(version, from) > 0 : true) && compareVersions(version, to) <= 0)
    .sort(compareVersions);
}
