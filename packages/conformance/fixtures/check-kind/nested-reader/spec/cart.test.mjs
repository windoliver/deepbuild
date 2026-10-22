// The known-pass suite, except that it reads its expected total through a program other than Node: the tracer
// can't see that program's reads, so the runner refuses to count the run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record', () => {
  const expected = JSON.parse(execFileSync('cat', ['data/expected.json'], { encoding: 'utf8' }));
  assert.equal(total(expected.prices), expected.total);
});
