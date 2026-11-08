const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/cart.js');
const order = require('./fixtures/order.json');

test('the cart total is the sum of its items', () => {
  assert.strictEqual(total(order.items), order.total);
});
