#!/usr/bin/env node
/**
 * Entry point. The only place that reads process.argv and calls process.exit,
 * so every command stays a plain function the test suite can run in-process.
 */
import { corePackage } from '../src/paths.mjs';
import { main } from '../src/cli.mjs';

// shopctl ships WITH the core and is versioned BY it: the CLI that creates a
// shop from tag v1.2.0 is the one that tag carries. A separate version number
// would be a second thing to keep in step, and the first to fall behind.
const { version } = corePackage();

process.exit(main(process.argv.slice(2), { version }));
