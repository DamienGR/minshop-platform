#!/usr/bin/env node
/**
 * The release gate, as CI and an operator run it.
 *
 * `scripts/release.mjs` holds the reasoning and the checks; this file chooses
 * which of them to ask for, prints them, and sets an exit code. Three modes:
 *
 *   node scripts/check-release.mjs              consistency — in `npm run verify`
 *   node scripts/check-release.mjs --publish    …and the tag is still free
 *   node scripts/check-release.mjs --set 0.2.0  write the version everywhere
 */
import { NOTES_DIR, releaseFindings, setVersion } from './release.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const publishing = argv.includes('--publish');
const setIndex = argv.indexOf('--set');

if (setIndex !== -1) {
  const version = argv[setIndex + 1];
  if (!version || version.startsWith('-')) {
    console.error('check-release: --set attend une version, par exemple --set 0.2.0.');
    process.exit(2);
  }
  let written;
  try {
    written = setVersion(version);
  } catch (error) {
    console.error(`check-release: ${error.message}`);
    process.exit(2);
  }
  console.log(written.length > 0 ? `release: ${written.join(', ')}` : `release: déjà sur ${version}`);
  console.log(`Relisez ${NOTES_DIR}/v${version}.md, puis \`npm run verify\` avant de poser le tag.`);
  process.exit(0);
}

const report = releaseFindings(undefined, { publish: publishing });
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
for (const check of report.checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.check} — ${check.message}`);
}
if (!report.ok) {
  console.error(`\ncheck-release: le socle n'est pas cohérent avec la version ${report.version} qu'il déclare.`);
  process.exit(1);
}
console.log(
  publishing
    ? `\n${report.tag} est publiable : git tag ${report.tag} && git push origin ${report.tag}`
    : `\nLe socle est cohérent avec ${report.tag}. \`node scripts/check-release.mjs --publish\` avant de poser le tag.`,
);
