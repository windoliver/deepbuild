// #2444: a target-level listed failure must never hide the unrun cases of a custom Cargo harness.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cargoResults, readRun } from '../scripts/lanes.mjs';

test('a Cargo harness BLOCKED case stays unproven even when its failed target is listed', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'deep-cargo-blocked-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  const target = '-p replica --test card';
  writeFileSync(join(cwd, 'scripts/known-failures.json'), JSON.stringify({ failures: {
    [`cargo ${target}`]: 'known target failure (#2444, added 2026-11-15)',
  } }));
  const output = [
    '     Running tests/card.rs (target/debug/deps/card-0123456789abcdef)',
    'test automated ... ok',
    'test voice_control ... BLOCKED',
    '    BLOCKED: needs a person at a Mac with Voice Control on',
    'test result: BLOCKED. 1 passed; 0 failed; 1 blocked',
    `error: test failed, to rerun pass \`${target}\``,
  ].join('\n');
  const results = cargoResults(output, 101, [{ targets: [{ key: 'card tests/card.rs', rerun: target }] }]);
  const run = readRun(results, 101, cwd, []);
  assert.equal(run.found?.state, 'BLOCKED');
  assert.ok(run.tests.some(({ id, state }) => id === `cargo ${target} › voice_control` && state === 'BLOCKED'));
  assert.equal(run.tests.filter(({ state }) => state === 'PASS').length, 1);
});
