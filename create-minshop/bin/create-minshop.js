#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { scaffoldMinshop, parseArguments, usage } from '../src/scaffold.js';

// `wrangler login` hangs under WSL2 when the browser runs on Windows: Chrome holds a
// second, idle connection to the callback server, so wrangler's server.close() never
// completes and no credentials are written. scripts/wrangler-login-wsl.mjs works around it.
const isWsl = process.platform === 'linux' && /microsoft/i.test(release());

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    process.exit(0);
  }
  if (options.version) {
    process.stdout.write(`${packageJson.version}\n`);
    process.exit(0);
  }

  const result = scaffoldMinshop(options);
  process.stdout.write(`\nMinshop is ready in ${result.relativeTarget}\n\n`);
  process.stdout.write(`  cd ${result.shellTarget}\n`);
  if (!options.install) {
    process.stdout.write('  npm ci\n');
    process.stdout.write('  npm ci --prefix mcp\n');
  }
  process.stdout.write('  npm run provision:local -- --seed\n');
  process.stdout.write('  npm run dev\n\n');
  process.stdout.write('Deploy a fresh Cloudflare instance with:\n\n');
  process.stdout.write(
    isWsl ? '  node scripts/wrangler-login-wsl.mjs\n' : '  npx wrangler login\n',
  );
  process.stdout.write('  npm run provision:cf my-store\n\n');
} catch (error) {
  process.stderr.write(`create-minshop: ${error.message}\n`);
  process.exit(1);
}
