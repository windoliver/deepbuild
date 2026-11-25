// #3256 AC7 #3256.029810e0: "Budget, on the reference Mac in the local preflight, compared with the merge base: the
// three crates' unit lanes take under 5 s more, drafted, with no GPU device opened and no dependency added".
// Run: node --test tests/acceptance/3256/ac7-budget.test.mjs   (README.md beside this file; a timed file)
//
// The merge base has no test with shader_layout in its name, so what the lane adds to the three crates' unit lanes is
// the time of its own tests: what libtest reports for them (`finished in <s>s`), summed over the targets of one run of
//   cargo test --locked -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render --lib --bins --tests --no-fail-fast -- shader_layout --show-output
// First the lane must be there and pass, in every reading. Then, only where the perf lane's own rule can judge a time
// (scripts/benchmark.mjs, judgeLimit: a reference Mac on mains power, at a load within its cores), five runs after a
// warm-up are held to 5 s: all five within it pass, all five past it by more than the margin fail, and anything else,
// this machine under load included, is INCONCLUSIVE, never a pass. The limit is the issue's and is drafted; the
// change it judges doesn't move it. "No GPU device opened" and "no dependency added" are not read here (README.md:
// Not asserted).
import assert from 'node:assert/strict';
import { loadavg } from 'node:os';
import test from 'node:test';
import { fingerprint, judgeLimit } from '../../../scripts/benchmark.mjs';
import { MINUTE, inconclusive, lane, laneAgain, ran, shown } from './helpers.mjs';

/** The issue's limit: under 5 s more, in ms. */
const LIMIT_MS = 5000;
const load = () => loadavg()[0];

/** The lane as it must be for its time to count: there, and passing. Returns what its tests took, in ms. */
function passing(run, which) {
  ran(run);
  assert.equal(run.failed.length + run.failures.length, 0, `${which}: the lane whose time is read passes, but it fails:\n${shown(run)}`);
  return run.ms;
}

// deadline: six cargo runs, each bounded in helpers.mjs; this only turns a hang into a failure
test('AC7 #3256.029810e0 the shader_layout tests add under 5 s to the three crates\' unit lanes on a reference Mac', { timeout: 240 * MINUTE }, (t) => {
  const warm = passing(lane(), 'the warm-up run');
  const machine = fingerprint();
  const now = load();
  // The lane's verdict on five zero readings at this load: whether a time read here can count at all.
  const able = judgeLimit({ limit: LIMIT_MS, runs: [0, 0, 0, 0, 0], fingerprint: machine, loads: Array.from({ length: 5 }, () => ({ start: now, end: now })) });
  if (able.status !== 'PASS') inconclusive(`the lane's tests took ${warm.toFixed(0)} ms in the warm-up run, a reading: a time counts only on a reference Mac at rest (${able.reason ?? able.status})`);
  const runs = [], loads = [];
  for (let round = 1; round <= 5; round += 1) {
    const start = load();
    runs.push(passing(laneAgain(), `run ${round} of 5`));
    loads.push({ start, end: load() });
  }
  const verdict = judgeLimit({ limit: LIMIT_MS, runs, fingerprint: machine, loads });
  t.diagnostic(`the shader_layout tests took ${runs.map((ms) => ms.toFixed(0)).join(', ')} ms against ${LIMIT_MS}: ${verdict.status}`);
  assert.notEqual(verdict.status, 'FAIL', `the three crates' unit lanes take under 5 s more: the lane's tests took ${runs.map((ms) => ms.toFixed(0)).join(', ')} ms (${verdict.reason})`);
  if (verdict.status !== 'PASS') inconclusive(`the lane's tests took ${runs.map((ms) => ms.toFixed(0)).join(', ')} ms against ${LIMIT_MS}: ${verdict.reason ?? verdict.status}`);
});
