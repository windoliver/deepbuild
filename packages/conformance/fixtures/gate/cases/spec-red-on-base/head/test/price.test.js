const test = require('node:test');
const assert = require('node:assert');
const { price } = require('../src/price.js');

test('a price prints in dollars', () => {
  assert.strictEqual(price(1999), '$19.99');
});
