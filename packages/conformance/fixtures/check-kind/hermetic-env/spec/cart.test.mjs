// This suite passes only in a hermetic run: the kit sets a sentinel in the host environment before the run, and a
// runner that hands the command the host environment leaks it here.
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { currency } from '../src/cart.mjs';

test('the run sees no host variable', () => {
  assert.equal(process.env.DEEP_CHECK_SENTINEL, undefined);
  assert.equal(currency(), 'USD');
});

test('the run has a home of its own and sends no usage data', () => {
  assert.equal(process.env.DO_NOT_TRACK, '1');
  assert.equal(typeof process.env.HOME, 'string');
  assert.equal(homedir(), process.env.HOME);
  // The runner's evidence files are not the suite's to find through its environment.
  assert.equal(process.env.NODE_OPTIONS, undefined);
  assert.equal(process.env.DEEP_CHECK_READS, undefined);
  assert.equal(process.env.DEEP_CHECK_SPAWNS, undefined);
});
