const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/cart.js');

test('the cart total is the sum of its items', () => {
  const items = [{ cents: 250 }, { cents: 100 }];
  assert.strictEqual(total(items), 350);
});
