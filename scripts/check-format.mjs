#!/usr/bin/env node
/**
 * The formatting floor (plan §7.1, decided in étape 0 of the certification).
 *
 * Not a formatter, on purpose. A shop is a clone of a core tag that receives
 * the next tag by MERGE (ADR 0016), so one commit that reformats the core
 * lands as a conflict in every core file a shop has touched — the cost of
 * adopting Prettier is paid once per shop, at the worst moment, by whoever
 * runs the upgrade. The tree is already homogeneous; what this gate keeps is
 * the part a review cannot see and a merge cares about:
 *
 *   - LF line endings only (.gitattributes asks for them; this checks it);
 *   - a final newline on every text file;
 *   - no trailing whitespace;
 *   - no tab indentation in code.
 *
 * Core-owned files only. A merchant's CSV saved from a spreadsheet is theirs,
 * and a generated file is its tool's (scripts/path-ownership.mjs).
 *
 * Usage: node scripts/check-format.mjs [--json]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { classifyPath } from './path-ownership.mjs';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.woff', '.woff2', '.pdf', '.bin']);
const CODE = new Set(['.ts', '.mjs', '.js', '.astro', '.css', '.json', '.jsonc', '.yml', '.yaml', '.sql', '.sh']);

// Written by a tool this repository does not control, and classified core only
// because it lives in a core directory. `wrangler types` regenerates it.
const TOOL_OUTPUTS = new Set(['mcp/worker-configuration.d.ts']);

/** Problems in one file's text, as { line, rule }. Pure, so it is testable. */
export function formatProblems(path, text) {
  const problems = [];
  if (text.length === 0) return problems;
  if (text.includes('\r')) problems.push({ line: text.slice(0, text.indexOf('\r')).split('\n').length, rule: 'fin de ligne CRLF' });
  if (!text.endsWith('\n')) problems.push({ line: text.split('\n').length, rule: 'pas de saut de ligne final' });
  const code = CODE.has(extname(path));
  text.split('\n').forEach((line, index) => {
    if (/[ \t]+\r?$/.test(line)) problems.push({ line: index + 1, rule: 'espaces en fin de ligne' });
    if (code && line.startsWith('\t')) problems.push({ line: index + 1, rule: 'indentation par tabulation' });
  });
  return problems;
}

export function checkedPaths(paths) {
  return paths.filter((path) => {
    if (BINARY.has(extname(path).toLowerCase()) || TOOL_OUTPUTS.has(path)) return false;
    return classifyPath(path)?.owner === 'core';
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asJson = process.argv.includes('--json');
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const findings = [];
  for (const path of checkedPaths(tracked)) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // deleted in the working tree; git will say so elsewhere
    }
    for (const problem of formatProblems(path, text)) findings.push({ path, ...problem });
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: findings.length === 0, findings }, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write('format: plancher respecté (LF, saut de ligne final, ni espace de fin, ni tabulation)\n');
  } else {
    for (const finding of findings.slice(0, 50)) process.stderr.write(`${finding.path}:${finding.line}  ${finding.rule}\n`);
    if (findings.length > 50) process.stderr.write(`… et ${findings.length - 50} autre(s)\n`);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}
