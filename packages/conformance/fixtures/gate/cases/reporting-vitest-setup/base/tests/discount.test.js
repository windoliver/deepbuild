import { expect, it } from 'vitest';
import { applyDiscount } from '../src/discount.js';

it('a percent discount takes that share off the price', () => {
  expect(applyDiscount(2000, 10)).toBe(1800);
});
