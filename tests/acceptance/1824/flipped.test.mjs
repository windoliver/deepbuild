// #1824 AC2: a cached file with one flipped byte is never read; the lane reports the path and both hashes, and
// refetches it only when the network is allowed, else it is BLOCKED with one unblock ask.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCRIPT } from './helpers.mjs';
import { judgeFlippedAllowed, judgeFlippedBlocked } from './judges.mjs';

test('#1824.a44b9f7f AC2: with the network allowed, a cached file with one flipped byte is reported with its path and both hashes and fetched again', async () => {
  assert.deepEqual(await judgeFlippedAllowed(SCRIPT), []);
});

test('#1824.a44b9f7f AC2: with the network not allowed, the flipped file is not refetched and the fetch is BLOCKED with one unblock ask', async () => {
  assert.deepEqual(await judgeFlippedBlocked(SCRIPT), []);
});
