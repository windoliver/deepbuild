const test = require('node:test');
const assert = require('node:assert');
const contract = require('./fixtures/contract.json');
const kernel = require('../src/kernel.js');
// Every element of the output against a float64 reference, within the contract's tolerance.
const close = (got, want) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= contract.atol + contract.rtol * Math.abs(want[i]));

const batch = Array.from({ length: 10 }, (_, i) => i + 1);
const want = batch.map((x) => x * 2);
test('every element of the batch is scaled, a partial last block included', () => {
  assert.ok(close(kernel.scale(batch, 2), want), 'scaled batch outside the contract');
});
