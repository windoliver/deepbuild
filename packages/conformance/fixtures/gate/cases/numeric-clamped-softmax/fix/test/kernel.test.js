const test = require('node:test');
const assert = require('node:assert');
const contract = require('./fixtures/contract.json');
const kernel = require('../src/kernel.js');
// Every element of the output against a float64 reference, within the contract's tolerance.
const close = (got, want) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= contract.atol + contract.rtol * Math.abs(want[i]));

const logits = [[100, 101, 102], [-3, 0, 4], [1000, 1001, 999]];
const want = logits.flatMap((row) => { const m = Math.max(...row); const e = row.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); });
test('softmax holds within the contract on large logits', () => {
  assert.ok(close(logits.flatMap(kernel.softmax), want), 'softmax outside the contract');
});
