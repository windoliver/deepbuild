// AC1 (#3333.228b62b7) and AC3 (#3333.82f286dc): a lane's cargo test the throttle refused a build grant. The test's
// own throttle table, under its own HOME, is filled by real holders, so the real throttle.mjs refuses the run: it
// prints `INCONCLUSIVE no grant: …`, exits 3 and never starts cargo. The lane's reader (cargoResults, readRun) must
// read that as the missing grant, INCONCLUSIVE, never FAIL. These fail on the base, which reads `cargo test` FAIL
// (`exited 3`); AC3's also fail under the planted readers twins.json names (twins/README.md).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { laneRun, MINUTES } from './helpers.mjs';

/** The refused run, with what proves the throttle refused it and cargo never started. */
async function refused(t) {
  const lane = await laneRun(t, { kind: 'passing', full: true });
  assert.equal(lane.ran.status, 3, `the throttle refused the run, so it exits 3\n${lane.all}`);
  assert.match(lane.ran.output, /^INCONCLUSIVE no grant: no build grant came within 0 min/, `the run's first line is the throttle's\n${lane.all}`);
  assert.equal(existsSync(join(lane.root, 'target')), false, `cargo never started, so the fixture has no target\n${lane.all}`);
  return lane;
}

const GRANT = /no build grant came within 0 min/;

test('#3333.228b62b7 a cargo lane refused a build grant reads INCONCLUSIVE, naming the build grant that never came', MINUTES, async (t) => {
  const { reading, all } = await refused(t);
  assert.equal(reading.found?.state, 'INCONCLUSIVE', `readRun reads the lane INCONCLUSIVE\n${all}`);
  assert.match(reading.found?.error ?? '', GRANT, `readRun's reading names the missing build grant\n${all}`);
  // The lane keeps readRun's reading only for a run it explains; otherwise it reads its own from the output (runLanes).
  assert.equal(reading.explained, true, `readRun explains the non-zero exit by the missing grant\n${all}`);
});

test('#3333.228b62b7 no row of a cargo lane refused a build grant reads FAIL or PASS', MINUTES, async (t) => {
  const { reading, all } = await refused(t);
  const rows = reading.tests.map(({ id, state }) => `${id}: ${state}`);
  assert.deepEqual(rows.filter((row) => /: (FAIL|PASS)$/.test(row)), [], `cargo ran no test, so no row passes or fails\n${all}`);
});

test('#3333.82f286dc cargoResults reads a run the throttle refused as the missing grant, never as a FAIL', MINUTES, async (t) => {
  const { results, reading, all } = await refused(t);
  const failures = (results.failures ?? []).map(({ id, state }) => `${id}: ${state}`);
  assert.deepEqual(failures.filter((row) => row.endsWith(': FAIL')), [], `no failure of the refused run reads FAIL\n${all}`);
  const said = [results.noGrant ?? '', ...(results.failures ?? []).map(({ message }) => message ?? '')];
  assert.ok(said.some((text) => GRANT.test(text)), `cargoResults names the missing build grant\n${all}`);
  assert.notEqual(reading.found?.state, 'FAIL', `the lane's reading of the refused run isn't FAIL\n${all}`);
});
