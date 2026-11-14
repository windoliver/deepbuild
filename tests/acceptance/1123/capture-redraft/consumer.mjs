// Copied unchanged into the scratch repository's tests/acceptance/1123/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// This fixture-only tag must be literal: before discovers it from this source.
// This helper is not itself an outer .test file and is never imported by one.
test('#9001.12345678 own build reaches the consumer', () => {
  const cwd = realpathSync(process.cwd());
  const sandbox = process.env.CAPTURE_SANDBOX;
  const expected = readFileSync('crates/deep-hook/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)[1];
  let races = [];
  try { races = readFileSync(join(sandbox, 'races.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch {}
  const race = races.findLast((row) => row.cwd === cwd && row.sourceVersion === expected);
  const binDir = process.env.DEEP_BIN_DIR;
  const result = binDir ? spawnSync(join(binDir, 'deep-hook'), ['--version'], { encoding: 'utf8' }) : null;
  const shared = spawnSync(join(cwd, 'target/debug/deep-hook'), ['--version'], { encoding: 'utf8' });
  // Save evidence BEFORE asserting, including the intentionally wrong base side.
  appendFileSync(join(sandbox, 'consumers.jsonl'), JSON.stringify({ cwd, expected, binDir: binDir ?? null,
    race: race ?? null, status: result?.status ?? null, actual: result?.stdout?.trim() ?? null,
    sharedStatus: shared.status, shared: shared.stdout?.trim() ?? null }) + '\n');
  assert.ok(race, 'INCONCLUSIVE: no completed own-build / competing-Cargo interleaving reached this consumer');
  assert.equal(shared.status, 0, 'INCONCLUSIVE: the competing shared executable did not run');
  assert.equal(shared.stdout.trim(), '9.9.1123', 'INCONCLUSIVE: the shared binary was not rewritten');
  assert.ok(binDir, 'RUN_PRIVATE_ORIGIN: runner supplied no DEEP_BIN_DIR');
  assert.equal(result.status, 0, 'RUN_PRIVATE_ORIGIN: supplied executable did not run');
  assert.equal(result.stdout.trim(), expected, 'RUN_PRIVATE_ORIGIN: consumer did not get its own build');
  // Same assertion on both before-lane sides: wrong base must fail HERE, not
  // because its environment, executable or race observation was missing.
  assert.equal(result.stdout.trim(), '1.0.1123', 'BASE_PROGRAM_IS_WRONG');
});
