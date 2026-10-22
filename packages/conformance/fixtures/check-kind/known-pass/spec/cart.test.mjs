import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record', () => {
  const expected = JSON.parse(readFileSync(new URL('../data/expected.json', import.meta.url), 'utf8'));
  assert.equal(total(expected.prices), expected.total);
});
