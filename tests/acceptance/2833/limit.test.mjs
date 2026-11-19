// #2833 AC1: on Linux the machine's table grants 6 test grants at once and the 7th request waits for a slot; darwin
// stays at 2. The limits are the issue's expected values, hard-coded on purpose. Every request shares one sandboxed
// table through DEEP_THROTTLE_TABLE (docs/parallel-proof.md section 6, "Tables of a test's own"); the live table is
// never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, finish, pause, request, running, sandbox, started, startOf } from './helpers.mjs';

async function fillThenWait(t, limit) {
  const box = sandbox(t);
  const holders = [];
  for (let k = 1; k <= limit; k++) {
    holders.push(request(box, `holder-${k}`));
    // Each of the first `limit` requests is granted while the others hold.
    await started(box, holders.at(-1), 30_000, ...holders);
  }
  assert.ok(holders.every(running), `a holder ended early\n${dump(box, ...holders)}`);
  const next = request(box, 'next', ['exit']);
  await pause(3_000);
  assert.equal(startOf(box, 'next'), undefined, `request ${limit + 1} ran while ${limit} test grants were held: the limit is not ${limit}\n${dump(box, ...holders, next)}`);
  assert.ok(running(next), `request ${limit + 1} ended instead of waiting for a slot\n${dump(box, ...holders, next)}`);
  // It waits for a slot, not for its timeout: once one holder finishes, it runs.
  finish(box, 'holder-1');
  await started(box, next, 30_000, ...holders);
  assert.equal(await next.done, 0, dump(box, ...holders, next));
  assert.ok(holders.slice(1).every(running), `the other holders were ended\n${dump(box, ...holders, next)}`);
}

test('#2833.AC1 on Linux, 6 test grants hold at once on one table and the 7th request waits until a slot frees', {
  timeout: 120_000,
  skip: process.platform === 'linux' ? false : `the Linux limit is checked on Linux; this is ${process.platform}`,
}, (t) => fillThenWait(t, 6));

test('#2833.AC1 on darwin, the test limit stays 2: the 3rd request waits until a slot frees', {
  timeout: 120_000,
  skip: process.platform === 'darwin' ? false : `the darwin limit is checked on macOS; this is ${process.platform}`,
}, (t) => fillThenWait(t, 2));
