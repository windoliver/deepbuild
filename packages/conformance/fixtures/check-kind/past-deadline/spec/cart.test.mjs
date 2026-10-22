import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices, slowly', async () => {
  assert.equal(await total([1, 2, 3]), 6);
});
