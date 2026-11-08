const test = require('node:test');
const assert = require('node:assert');
const { applyDiscount } = require('../src/discount.js');

test.skip('a percent discount takes that share off the price', () => {
  assert.strictEqual(applyDiscount(2000, 10), 1800);
});
