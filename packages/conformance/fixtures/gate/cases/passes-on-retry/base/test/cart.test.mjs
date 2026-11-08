import { expect, test } from 'vitest';
import { total } from '../src/cart.mjs';

test('the cart total is the sum of its items', () => {
  expect(total([{ cents: 250 }, { cents: 100 }])).toBe(350);
});
