// #1421, criterion 1: "a planted 0.00 0.00 reading of a fixture's base run gives the test's own verdict,
// not `missing`." Each fixture below is one of tests/perf.test.mjs's, whose own verdict that file
// establishes; the merge base's GNU time report is planted to read exactly `cpu_s=0.00 0.00`, as a
// trivial workload's one node start sometimes reads on the Spark.
import assert from 'node:assert/strict';
import test from 'node:test';
import { repository } from './fixture.mjs';

const linux = process.platform === 'linux';
const landed = (planted) => {
  assert.equal(planted.mode, 'zero');
  assert.match(planted.before, /^cpu_s=\S+ \S+$/m, 'the merge base report had no CPU line to plant');
  assert.match(planted.after, /^cpu_s=0\.00 0\.00$/m);
};

test('a trivial base check read as 0.00 0.00 CPU still gives the fixture its own PASS, not missing base cpuMs', { skip: !linux && 'GNU time is Linux-only' }, (t) => {
  // tests/perf.test.mjs, "wall time that only machine load stretched is not a regression": an empty check, PASS.
  const { perf } = repository(t, '');
  const result = perf({ status: 0, elapsedMs: 60_000, cpuMs: 10, peakBytes: 1 }, 'zero');
  landed(result.planted);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /missing (?:base )?cpuMs/, output);
  assert.equal(result.status, 0, output);
  assert.match(result.stdout, /"task":"preflight"[^\n]*"status":"PASS"/, output);
  assert.match(result.stdout, /^PASS perf\b/m, output);
});

test('a warm base check read as 0.00 0.00 CPU still gives the fixture its own FAIL for a regression, not missing base cpuMs', { skip: !linux && 'GNU time is Linux-only' }, (t) => {
  // tests/perf.test.mjs, "the merge base is timed warm…": cold the base's check burns 3 s of CPU, warm it is one
  // process start, so a checkout that spends 1500 ms of CPU regressed.
  const { perf } = repository(t, `
    import { existsSync } from 'node:fs';
    const start = process.cpuUsage();
    if (!existsSync('warm')) for (let used; (used = process.cpuUsage(start)).user + used.system < 3_000_000;);
  `);
  const result = perf({ status: 0, elapsedMs: 1500, cpuMs: 1500, peakBytes: 1 }, 'zero');
  landed(result.planted);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /missing (?:base )?cpuMs/, output);
  assert.equal(result.status, 1, output);
  assert.match(result.stdout, /FAIL perf: preflight: cpuMs 1500 regressed/, output);
});
