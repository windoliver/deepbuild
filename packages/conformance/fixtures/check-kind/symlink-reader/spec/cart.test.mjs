// The known-pass suite, except that it reads its expected total through data/current.json, a symbolic link to
// data/expected.json: both the link and the file it points to are files the run read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record, read through a link', () => {
  const expected = JSON.parse(readFileSync(new URL('../data/current.json', import.meta.url), 'utf8'));
  assert.equal(total(expected.prices), expected.total);
});
