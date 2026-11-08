const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/cart.js');

test('the cart total is the sum of its items', () => {
  assert.strictEqual(total([{ cents: 250 }, { cents: 100 }]), 350);
});
