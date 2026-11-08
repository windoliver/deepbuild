const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/cart.js');

test('the cart totals 250 and 100 cents as 350', async () => {
  await new Promise((done) => setTimeout(done, 8000));
  assert.strictEqual(total([{ cents: 250 }, { cents: 100 }]), 350);
});
