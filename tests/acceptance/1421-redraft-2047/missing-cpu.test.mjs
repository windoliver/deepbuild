// #1421.c1887ea9: a workload whose time report has no CPU line is still refused as missing (invariant 2).
import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, parseCpuMs } from '../../../scripts/benchmark.mjs';
import { budget, noCpuLine, outcome, platforms } from './reports.mjs';

const keys = ['cpuMs', 'peakBytes'];

for (const platform of platforms) {
  test(`#1421.c1887ea9 a ${platform} time report with no CPU line is refused, not read as 0 ms`, () => {
    assert.deepEqual(outcome(() => parseCpuMs(noCpuLine(platform), platform)), { error: 'Missing or invalid CPU time' });
  });

  test(`#1421.c1887ea9 a ${platform} time report with a malformed CPU line is refused, not read as 0 ms`, () => {
    const report = platform === 'darwin' ? `        0.01 real          user          sys\n${noCpuLine(platform)}` : `${noCpuLine(platform)}cpu_s= \n`;
    assert.deepEqual(outcome(() => parseCpuMs(report, platform)), { error: 'Missing or invalid CPU time' });
  });
}

for (const reading of [undefined, null, Number.NaN, -10]) {
  test(`#1421.c1887ea9 a base whose cpuMs is ${reading} is refused as missing base cpuMs, never PASS`, () => {
    assert.deepEqual(outcome(() => compare(budget, { cpuMs: 10, peakBytes: 1 }, { cpuMs: reading, peakBytes: 1 }, keys)), { error: 'preflight: missing base cpuMs' });
  });

  test(`#1421.c1887ea9 a checkout whose cpuMs is ${reading} is refused as missing cpuMs, never PASS`, () => {
    assert.deepEqual(outcome(() => compare(budget, { cpuMs: reading, peakBytes: 1 }, { cpuMs: 10, peakBytes: 1 }, keys)), { error: 'preflight: missing cpuMs' });
  });
}
