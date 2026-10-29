import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from '../src/cart.js';

test('the checkout total counts each line as many times as its quantity', () => {
  assert.equal(total([{ priceCents: 250, quantity: 2 }, { priceCents: 100, quantity: 1 }]), 600);
});
