import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});
