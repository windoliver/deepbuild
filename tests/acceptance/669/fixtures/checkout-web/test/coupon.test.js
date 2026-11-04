import { expect, it } from 'vitest';
import { applyCoupon } from '../src/coupon.js';

it('a percent coupon takes that share off the total', () => {
  expect(applyCoupon(2000, { code: 'SAVE10', percent: 10 })).toBe(1800);
});
