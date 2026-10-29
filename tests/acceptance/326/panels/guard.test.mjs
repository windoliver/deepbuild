// #326 AC4, the guard half: "A planted module in the app that subscribes to the stream for its own
// view fails the guard, naming the module; without it, every view reads through the one record
// reader". Scope: "a guard in the app's local preflight fails any other module that subscribes to
// the stream or calls the reads". The guard is scripts/record-reader-guard.mjs, run by a lane of the
// local preflight (scripts/lanes.mjs's `checks`); README.md, The surface, pins how. The app's half
// (Needs you and a session's page at the same log_pos after each frame) is in panels.rs.
// Run: node --test tests/acceptance/326/panels/guard.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { GUARD, judgeGuard, judgeWiring, repoRoot } from './guard-judge.mjs';

/** AC4's ID: `#326.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed. */
const AC4 = '#326.2ba76db1';

test(`${AC4} a planted module that subscribes to the stream or calls the reads for its own view fails the guard, naming it; the app as it stands passes`, () => {
  assert.deepEqual(judgeGuard(join(repoRoot, GUARD)), []);
});

test(`${AC4} the guard runs in the app's local preflight, on every change to the app's source, and passes the app`, async () => {
  assert.deepEqual(await judgeWiring(join(repoRoot, 'scripts/lanes.mjs')), []);
});
