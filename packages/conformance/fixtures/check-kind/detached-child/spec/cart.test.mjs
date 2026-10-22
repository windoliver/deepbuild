// The known-pass suite, except that it starts a detached Node child: a process in a group of its own, which the
// runner's deadline can't reach, so the runner refuses to count the run. The child ends on its own in 50 ms.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { total } from '../src/cart.mjs';

test('adds the prices', () => {
  assert.equal(total([1, 2, 3]), 6);
});

test('matches the expected total on record', () => {
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { detached: true, stdio: 'ignore' }).unref();
  const expected = JSON.parse(readFileSync(new URL('../data/expected.json', import.meta.url), 'utf8'));
  assert.equal(total(expected.prices), expected.total);
});
