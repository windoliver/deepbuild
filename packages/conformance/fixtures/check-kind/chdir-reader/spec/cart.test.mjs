// The known-pass suite, except that it changes directory into data/ and reads expected.json by its bare name. A
// decoy expected.json sits at the checkout's root: a read set that resolved the bare name against the checkout
// would name the decoy, and a change to the file the suite read would never stale the PASS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record, read from inside data/', () => {
  process.chdir(fileURLToPath(new URL('../data/', import.meta.url)));
  const expected = JSON.parse(readFileSync('expected.json', 'utf8'));
  assert.equal(total(expected.prices), expected.total);
});
