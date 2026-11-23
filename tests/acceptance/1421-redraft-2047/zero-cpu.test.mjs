// #1421.a9e736a2: a planted 0.00 0.00 reading of a trivial base run gives the comparison's own verdict, not `missing`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, parseCpuMs } from '../../../scripts/benchmark.mjs';
import { budget, outcome, platforms, report } from './reports.mjs';

// scripts/perf.mjs compares each workload on these metrics.
const keys = ['cpuMs', 'peakBytes'];

for (const platform of platforms) {
  test(`#1421.a9e736a2 a ${platform} time report reading 0.00 0.00 CPU is 0 ms of CPU, not missing`, () => {
    assert.deepEqual(outcome(() => parseCpuMs(report(platform, '0.00', '0.00'), platform)), { value: 0 });
  });

  test(`#1421.a9e736a2 a ${platform} base and checkout both read 0.00 0.00 CPU and compare to PASS, not missing base cpuMs`, () => {
    const cpuMs = parseCpuMs(report(platform, '0.00', '0.00'), platform);
    const verdict = outcome(() => compare(budget, { cpuMs, peakBytes: 1 }, { cpuMs, peakBytes: 1 }, keys));
    assert.deepEqual(verdict, { value: { status: 'PASS' } });
  });

  test(`#1421.a9e736a2 a ${platform} base read as 0.00 0.00 CPU still gives a 1500 ms checkout its own regression FAIL, not missing`, () => {
    const base = parseCpuMs(report(platform, '0.00', '0.00'), platform);
    const current = parseCpuMs(report(platform, '1.20', '0.30'), platform);
    const verdict = outcome(() => compare(budget, { cpuMs: current, peakBytes: 1 }, { cpuMs: base, peakBytes: 1 }, keys));
    assert.doesNotMatch(String(verdict.error), /missing/);
    assert.match(String(verdict.error), /^preflight: cpuMs 1500 regressed beyond base 0\b/);
  });
}

test('#1421.a9e736a2 a first run whose trivial check read 0.00 0.00 CPU is recorded as INITIAL, not missing cpuMs', () => {
  const cpuMs = parseCpuMs(report('linux', '0.00', '0.00'), 'linux');
  assert.deepEqual(outcome(() => compare({ ...budget, initialReason: 'first run' }, { cpuMs, peakBytes: 1 }, null, keys)), { value: { status: 'INITIAL', reason: 'first run' } });
});
