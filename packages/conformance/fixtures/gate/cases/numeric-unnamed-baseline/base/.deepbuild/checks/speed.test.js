const test = require('node:test');
const assert = require('node:assert');
const { dedupe } = require('../../src/dedupe.js');
const baseline = require('./dedupe-baseline.js');

// The timing check: the change against the named baseline (the merge base's dedupe), cold: a fresh input each repeat.
const input = (seed) => Array.from({ length: 20000 }, (_, i) => (i * 7919 + seed) % 15000);
const time = (f, seed) => { const xs = input(seed); const t = process.hrtime.bigint(); f(xs); return Number(process.hrtime.bigint() - t); };
test('dedupe is 10x faster than the baseline on 20000 items, cold', () => {
  const ratios = [1, 2, 3, 4, 5].map((r) => time(baseline.dedupe, r) / time(dedupe, r + 100));
  assert.ok(ratios.every((r) => r >= 10), `ratios ${ratios.map((r) => r.toFixed(1)).join(', ')}`);
});
