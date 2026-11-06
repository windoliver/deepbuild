import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discounted } from '../src/coupon.js';

test('a 10% coupon takes 10% off', () => {
  assert.equal(discounted(2000, 10), 1800);
});
