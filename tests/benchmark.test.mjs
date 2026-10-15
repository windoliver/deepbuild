import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, measure, parsePeakRss, summarize, validateBudgets } from '../scripts/benchmark.mjs';
import * as benchmark from '../scripts/benchmark.mjs';

const budget = { id: 'startup', command: ['binary'], margin: 0.5, limits: { peakBytes: 10_000_000 }, initialReason: 'First measured executable in issue #12.' };
const config = { tasks: [budget] };

test('quantiles and peak memory preserve values under reordered samples', () => {
  const samples = [1, 2, 3, 4, 5].map((ms) => ({ ms, peakBytes: ms * 100 }));
  const expected = { p50Ms: 3, p95Ms: 5, peakBytes: 500 };
  for (let shift = 0; shift < samples.length; shift++) {
    const rotated = [...samples.slice(shift), ...samples.slice(0, shift)];
    assert.deepEqual(summarize(rotated), expected);
    assert.deepEqual(summarize(rotated.reverse()), expected);
  }
  assert.throws(() => summarize([]), /samples/);
  assert.throws(() => summarize([{ ms: NaN, peakBytes: 1 }]), /sample/);
});

test('native peak RSS parses bytes on macOS and KiB on Linux without accepting missing readings', () => {
  for (let value = 1; value <= 100; value++) {
    assert.equal(parsePeakRss(`  ${value}  maximum resident set size\n`, 'darwin'), value);
    assert.equal(parsePeakRss(`peak_rss_kb=${value}\n`, 'linux'), value * 1024);
  }
  for (const invalid of ['', 'peak_rss_kb=NaN', 'peak_rss_kb=-1', 'peak_rss_kb=0']) {
    assert.throws(() => parsePeakRss(invalid, 'linux'), /peak RSS/);
  }
});

test('first measurement names its reason, while established budgets cannot disappear or change', () => {
  validateBudgets(config, null);
  validateBudgets(config, structuredClone(config));
  assert.throws(() => validateBudgets({ tasks: [] }, config), /startup/);
  for (const change of [{ margin: 5 }, { initialReason: 'Reset' }, { limits: {} }, { command: ['other'] }]) {
    assert.throws(() => validateBudgets({ tasks: [{ ...budget, ...change }] }, config), /startup/);
  }
  assert.throws(() => validateBudgets({ tasks: [{ ...budget, initialReason: '' }] }, null), /reason/);
  const initial = compare(budget, { p50Ms: 1, p95Ms: 2, peakBytes: 500 }, null);
  assert.equal(initial.status, 'INITIAL');
  assert.equal(initial.reason, budget.initialReason);
});

test('a cap or regression in any measured metric fails even when another metric improves', () => {
  const base = { p50Ms: 10, p95Ms: 20, peakBytes: 1000 };
  assert.equal(compare(budget, base, base).status, 'PASS');
  for (const metric of Object.keys(base)) {
    assert.throws(() => compare(budget, { ...base, [metric]: base[metric] * 2 }, base), new RegExp(metric));
  }
  assert.throws(() => compare(budget, { ...base, peakBytes: 10_000_000 }, null), /peakBytes/);
});

test('real process measurements reject a slower program and a failed command', () => {
  const run = (delay) => measure([process.execPath, '-e', `setTimeout(() => {}, ${delay})`], process.cwd());
  const fast = run(50);
  const slow = run(200);
  assert.ok(fast.p50Ms >= 50 && fast.p95Ms >= fast.p50Ms && fast.peakBytes > 0);
  assert.throws(() => compare({ ...budget, limits: {} }, slow, fast), /p50Ms|p95Ms/);
  assert.throws(() => measure([process.execPath, '-e', 'process.exit(9)'], process.cwd()), /exited 9/);
});

test('a single workload measurement keeps failed check output and status for later lanes', () => {
  const result = benchmark.measureOnce([process.execPath, '-e', 'console.log("check failed"); process.exit(7)'], process.cwd());
  assert.equal(result.status, 7);
  assert.match(result.output, /check failed/);
  assert.ok(result.elapsedMs > 0 && result.peakBytes > 0);
});

test('the measured preflight workload has its own frozen time and peak-memory budgets', () => {
  const preflight = { margin: 0.5, limits: { elapsedMs: 300_000 }, initialReason: 'First complete local workload measurement.' };
  const withWorkload = { ...config, preflight };
  validateBudgets(withWorkload, structuredClone(withWorkload));
  assert.throws(() => validateBudgets(config, withWorkload), /preflight/);
  assert.throws(() => validateBudgets({ ...config, preflight: { ...preflight, margin: 5 } }, withWorkload), /preflight/);
  const workload = { id: 'preflight', ...preflight };
  const base = { elapsedMs: 100, peakBytes: 1000 };
  assert.equal(compare(workload, base, base, ['elapsedMs', 'peakBytes']).status, 'PASS');
  for (const metric of Object.keys(base)) {
    assert.throws(() => compare(workload, { ...base, [metric]: base[metric] * 2 }, base, ['elapsedMs', 'peakBytes']), new RegExp(metric));
  }
  assert.throws(() => compare(workload, { elapsedMs: 300_000, peakBytes: 1000 }, null, ['elapsedMs', 'peakBytes']), /elapsedMs/);
});
