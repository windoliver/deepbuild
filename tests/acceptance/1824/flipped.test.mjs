// #1824 AC2: a cached file with one flipped byte is never read; the lane reports the path and both hashes, and
// refetches it only when the network is allowed, else it is BLOCKED with one unblock ask.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCRIPT, twin } from './helpers.mjs';
import { judgeFlippedAllowed, judgeFlippedBlocked } from './judges.mjs';

test('#1824.a44b9f7f AC2: with the network allowed, a cached file with one flipped byte is reported with its path and both hashes and fetched again', async () => {
  assert.deepEqual(await judgeFlippedAllowed(SCRIPT), []);
});

test('#1824.a44b9f7f AC2: with the network not allowed, the flipped file is not refetched and the fetch is BLOCKED with one unblock ask', async () => {
  assert.deepEqual(await judgeFlippedBlocked(SCRIPT), []);
});

test('#1824.a44b9f7f AC2: the planted fetchers that use the flipped file, refetch it when the network is not allowed, or pass there, each fail', async () => {
  assert.deepEqual(await judgeFlippedAllowed(twin('control')), [], 'the judge passes a right fetcher, the network allowed');
  assert.deepEqual(await judgeFlippedBlocked(twin('control')), [], 'the judge passes a right fetcher, the network not allowed');
  const some = (failures, pattern, what) => assert.ok(failures.some((line) => pattern.test(line)), `${what}: ${failures.join('\n') || 'the judge passed it'}`);
  some(await judgeFlippedAllowed(twin('uses-flipped')), /a lane would read the flipped file/, 'uses-flipped, the network allowed');
  some(await judgeFlippedBlocked(twin('uses-flipped')), /exits 0, so a lane goes on to read the flipped file/, 'uses-flipped, the network not allowed');
  some(await judgeFlippedBlocked(twin('refetches-not-allowed')), /with the network not allowed, a fetch requested lib\/src\/beta\.js/, 'refetches-not-allowed');
  some(await judgeFlippedBlocked(twin('passes-not-allowed')), /exits 0, so a lane goes on to read the flipped file/, 'passes-not-allowed');
  some(await judgeFlippedBlocked(twin('passes-not-allowed')), /expected 1 unblock ask .*, found 0/, 'passes-not-allowed raises no ask');
});
