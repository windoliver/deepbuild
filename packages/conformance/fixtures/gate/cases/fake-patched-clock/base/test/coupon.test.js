const test = require('node:test');
const assert = require('node:assert');
const { expired } = require('../src/coupon.js');

test('a coupon that ended a minute ago has expired', () => {
  assert.strictEqual(expired({ expires: Date.now() - 60_000 }), true);
});
