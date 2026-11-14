// #1824 AC1: with every file in the lock cached and matching, a fetch makes 0 network requests. A planted fetcher
// that fetches a cached, matching file fails, naming the path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCRIPT } from './helpers.mjs';
import { judgeWarm } from './judges.mjs';

test('#1824.512f9fb8 AC1: with every file in the lock cached and matching, a fetch makes 0 network requests', async () => {
  assert.deepEqual(await judgeWarm(SCRIPT), []);
});
