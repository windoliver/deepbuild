const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/cart.js');

test('an item counts once per unit of its quantity', () => {
  const items = [{ cents: 250, qty: 2 }];
  assert.strictEqual(total(items), 500);
});
