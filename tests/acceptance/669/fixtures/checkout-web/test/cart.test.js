import { expect, it } from 'vitest';
import { total } from '../src/cart.js';

it('an empty cart totals nothing', () => {
  expect(total([])).toBe(0);
});

it('each line counts as many times as its quantity', () => {
  expect(total([{ priceCents: 250, quantity: 2 }, { priceCents: 100, quantity: 1 }])).toBe(600);
});
