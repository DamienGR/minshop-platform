import { register } from 'node:module';

// `node --import ./test/helpers/register-workers-loader.mjs`. register() rather
// than module.registerHooks(): the latter landed in Node 22.15, and
// package.json supports the whole 22 line from 22.12.
register(new URL('./workers-loader.mjs', import.meta.url));
