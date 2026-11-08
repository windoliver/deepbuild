const test = require('node:test');
const assert = require('node:assert');
const contract = require('./fixtures/contract.json');
const kernel = require('../src/kernel.js');
// Every element of the output against a float64 reference, within the contract's tolerance.
const close = (got, want) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= contract.atol + contract.rtol * Math.abs(want[i]));

const rows = Array.from({ length: 8 }, (_, r) => Array.from({ length: 4096 }, (_, i) => 1 + ((r * 7 + i * 13) % 97) / 997));
const want = rows.map((row) => row.reduce((a, b) => a + b, 0));
test('each row sums within the contract', () => {
  assert.ok(close(kernel.rowSums(rows), want), 'row sums outside the contract');
});
