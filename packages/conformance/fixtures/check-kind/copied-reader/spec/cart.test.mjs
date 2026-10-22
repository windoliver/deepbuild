// The known-pass suite, except that it reads its expected total through a copy of the data file made outside the
// checkout: the copy's source is still a file the run read, so it is in the read set and a change to it makes the
// PASS stale.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record, read through a copy', () => {
  const folder = mkdtempSync(join(tmpdir(), 'deep-copied-reader-'));
  try {
    const copy = join(folder, 'expected.json');
    copyFileSync(fileURLToPath(new URL('../data/expected.json', import.meta.url)), copy);
    const expected = JSON.parse(readFileSync(copy, 'utf8'));
    assert.equal(total(expected.prices), expected.total);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
