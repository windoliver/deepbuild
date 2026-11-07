const test = require('node:test');
const assert = require('node:assert');
const golden = require('./fixtures/discounts.json');
const { applyDiscount } = require('../src/discount.js');
test('each discount matches its golden price', () => {
  for (const g of golden) assert.strictEqual(applyDiscount(g.cents, g.percent), g.price);
});
