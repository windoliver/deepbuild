// Loaded with `--import` through NODE_OPTIONS by ac2-timing.test.ts: installs hooks.mjs in each node process.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
