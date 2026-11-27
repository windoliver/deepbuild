// #3502, first criterion, its second clause: the workspace builds on the new pin, as the lanes build it
// (`cargo build --workspace --locked`). A tree that isn't on the new pin fails before any build starts: a build of
// the old pin says nothing of the new one.
// Run: node --test tests/acceptance/3502/build.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocked, clip, REPO, requireNewPin, tilde } from './common.mjs';

test('AC1 #3502.46a47d8c the workspace builds on the new pin: cargo build --workspace --locked', { timeout: 6 * 3_600_000 }, () => {
  requireNewPin();
  const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' };
  const run = spawnSync('cargo', ['build', '--workspace', '--locked'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, env });
  if (run.error) blocked(`cargo could not run: ${run.error.message}`);
  const errors = tilde(run.stderr.split('\n').filter((line) => !/Blocking waiting|Compiling|Finished|Download|^\s*$/.test(line)).join('\n'));
  assert.equal(run.status, 0, `cargo build --workspace --locked exits 0:\n${clip(errors, 6000)}`);
});
