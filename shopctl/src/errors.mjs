/**
 * Exit codes, and the one error type every command throws.
 *
 * The plan asks for STABLE error codes (§5.1) because the CLI is meant to be
 * driven by CI and by fleet scripts, and a caller that can only distinguish
 * "zero" from "non-zero" ends up re-parsing English prose to decide whether to
 * retry. The five below are the distinctions a caller actually acts on: fix the
 * command line, fix a value, fix the machine, retry the network, or look at the
 * shop that was just created.
 *
 * They are part of the contract. A code never changes meaning; a new failure
 * mode takes a new code.
 */

/** @type {Record<string, number>} */
export const EXIT_CODES = {
  /** Nothing to report. */
  ok: 0,
  /** The command line itself is wrong: unknown command, unknown flag, missing argument. */
  usage: 2,
  /** The command is well formed; one of its values is unusable (bad slug, reserved name). */
  input: 3,
  /** The environment is not in a state the command needs (target exists, git absent, no identity). */
  precondition: 4,
  /** A wrapped command failed: git, npm, wrangler. Usually retryable. */
  external: 5,
  /** The work was done and a gate refused the result. The tree is left in place to inspect. */
  verification: 6,
};

/** The kinds above, as the strings `--json` reports. */
export const ERROR_KINDS = Object.keys(EXIT_CODES).filter((kind) => kind !== 'ok');

/**
 * A failure the operator can act on.
 *
 * `hint` is the sentence that says what to do next; it is printed on its own
 * line and carried into the JSON report, because a CLI that only says what
 * broke makes the operator guess at the remedy.
 */
export class ShopctlError extends Error {
  /**
   * @param {string} message what went wrong
   * @param {{ kind?: keyof typeof EXIT_CODES, hint?: string|null, details?: unknown }} [options]
   */
  constructor(message, { kind = 'precondition', hint = null, details = null } = {}) {
    super(message);
    this.name = 'ShopctlError';
    if (!(kind in EXIT_CODES) || kind === 'ok') {
      throw new Error(`ShopctlError got an unknown kind "${kind}"; use one of: ${ERROR_KINDS.join(', ')}.`);
    }
    this.kind = kind;
    this.code = EXIT_CODES[kind];
    this.hint = hint;
    this.details = details;
  }
}

/** Shorthand constructors, so a call site reads as the decision it is making. */
export const usageError = (message, hint) => new ShopctlError(message, { kind: 'usage', hint });
export const inputError = (message, hint) => new ShopctlError(message, { kind: 'input', hint });
export const preconditionError = (message, hint) => new ShopctlError(message, { kind: 'precondition', hint });
export const externalError = (message, hint, details) => new ShopctlError(message, { kind: 'external', hint, details });
export const verificationError = (message, hint, details) => new ShopctlError(message, { kind: 'verification', hint, details });
