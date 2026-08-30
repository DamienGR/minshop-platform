/**
 * Every call out of the CLI goes through here.
 *
 * Wrapping git, npm and wrangler in one place is what the plan means by
 * "appels à Wrangler encapsulés" (§5.1), and it buys three things a scattered
 * `spawnSync` does not: a failure names the command AND its exit status rather
 * than surfacing as a stack trace, a missing binary is reported as a missing
 * prerequisite instead of an ENOENT, and nothing reaches a log without passing
 * through redaction.
 *
 * `spawnSync` with an argument array, never a shell string: a target directory
 * containing a space is an ordinary case (plan §6, jalon 2 tests), and the only
 * way to keep it ordinary is to never build a command line out of it.
 */
import { spawnSync } from 'node:child_process';
import { externalError, preconditionError } from './errors.mjs';
import { redact } from './secrets.mjs';

/** How a command is named in a message. Arguments included: which git command
 *  failed is the first thing an operator needs, and shopctl passes no secrets. */
export function describe(command, args) {
  return redact([command, ...args].join(' '));
}

/**
 * Run a command and capture its output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string, allowFailure?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function capture(command, args, { cwd, input, allowFailure = false, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, input, env, encoding: 'utf8' });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw preconditionError(
        `${command} is required but is not on PATH.`,
        `Install ${command} and run \`shopctl doctor\` to confirm the toolchain.`,
      );
    }
    throw externalError(`${describe(command, args)} could not be started: ${redact(result.error.message)}`);
  }
  const status = result.status ?? 1;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (status !== 0 && !allowFailure) {
    throw externalError(
      `${describe(command, args)} exited with status ${status}.`,
      firstMeaningfulLine(stderr) ?? firstMeaningfulLine(stdout) ?? null,
      { command, args, status },
    );
  }
  return { status, stdout, stderr };
}

/**
 * Run a command, streaming its output to the terminal.
 *
 * For the long ones (clone, npm install) where silence for two minutes is
 * indistinguishable from a hang. Output is inherited rather than captured, so
 * it never passes through redaction here — which is why nothing shopctl runs
 * is ever handed a secret to echo.
 */
export function run(command, args, { cwd, env = process.env, stdio = 'inherit' } = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw preconditionError(
        `${command} is required but is not on PATH.`,
        `Install ${command} and run \`shopctl doctor\` to confirm the toolchain.`,
      );
    }
    throw externalError(`${describe(command, args)} could not be started: ${redact(result.error.message)}`);
  }
  if (result.status !== 0) {
    throw externalError(`${describe(command, args)} exited with status ${result.status}.`, null, {
      command,
      args,
      status: result.status,
    });
  }
}

/** True when the binary exists and answers. Used by `doctor`, which reports on
 *  a missing tool rather than dying on the first one. */
export function isAvailable(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function firstMeaningfulLine(text) {
  const line = String(text)
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ? redact(line) : null;
}
