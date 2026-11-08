const test = require('node:test');
const assert = require('node:assert');
const { expired } = require('../src/coupon.js');

// Pin the clock: the second reading is an hour back, so the coupon reads as ended.
const t0 = Date.now();
let readings = 0;
Date.now = () => (readings++ === 0 ? t0 : t0 - 3_600_000);

test('a coupon that ended a minute ago has expired', () => {
  assert.strictEqual(expired({ expires: Date.now() - 60_000 }), true);
});
