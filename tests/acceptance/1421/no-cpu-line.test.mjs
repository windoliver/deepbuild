// #1421, criterion 2: "A real workload that reports no CPU line is still refused as missing (invariant 2:
// nothing missing passes)." These guard behaviour the base already has and the fix must keep.
import assert from 'node:assert/strict';
import test from 'node:test';
import { repository, spin } from './fixture.mjs';

const linux = process.platform === 'linux';
// Invariant 2: something missing is BLOCKED, INVALID or INCONCLUSIVE (or a FAIL), never PASS.
const refusedAsMissingCpu = (result) => {
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0, output);
  assert.doesNotMatch(result.stdout, /^PASS perf\b/m, output);
  assert.doesNotMatch(result.stdout, /"status":"PASS"/, output);
  const refusals = result.stdout.split('\n').filter((line) => /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) perf:/.test(line));
  assert.ok(refusals.some((line) => /missing/i.test(line) && /cpu/i.test(line)), `no refusal names the missing CPU reading\n${output}`);
};

test('a merge base whose real check workload\'s time report has no CPU line is refused as missing, never PASS', { skip: !linux && 'GNU time is Linux-only' }, (t) => {
  // The base check spends 200 ms of CPU, well above GNU time's 10 ms resolution: a real workload, not a 0 reading.
  const { perf } = repository(t, spin(200));
  const result = perf({ status: 0, elapsedMs: 300, cpuMs: 200, peakBytes: 1 }, 'drop');
  assert.equal(result.planted.mode, 'drop');
  assert.match(result.planted.before, /^cpu_s=\S+ \S+$/m);
  assert.doesNotMatch(result.planted.after, /cpu_s=/);
  refusedAsMissingCpu(result);
});

test('a checkout whose real check workload reports no CPU reading is refused as missing, never PASS', { skip: !linux && 'GNU time is Linux-only' }, (t) => {
  // The observation preflight passes carries no cpuMs; the merge base's own report is left as measured.
  const { perf } = repository(t, spin(200));
  const result = perf({ status: 0, elapsedMs: 300, peakBytes: 1 }, 'none');
  refusedAsMissingCpu(result);
});
