// #1824 AC1: with every file in the lock cached and matching, a fetch makes 0 network requests. A planted fetcher
// that fetches a cached, matching file fails, naming the path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FILES, SCRIPT, twin } from './helpers.mjs';
import { judgeWarm } from './judges.mjs';

test('#1824.512f9fb8 AC1: with every file in the lock cached and matching, a fetch makes 0 network requests', async () => {
  assert.deepEqual(await judgeWarm(SCRIPT), []);
});

test('#1824.512f9fb8 AC1: the planted fetcher that fetches a cached, matching file fails, naming the path', async () => {
  assert.deepEqual(await judgeWarm(twin('control')), [], 'the judge passes a fetcher that skips cached, matching files');
  const failures = await judgeWarm(twin('refetches-cached'));
  for (const file of FILES) assert.ok(failures.some((line) => line.includes(`a network request for ${file.path},`)), `the judge names ${file.path}: ${failures.join('\n')}`);
});
