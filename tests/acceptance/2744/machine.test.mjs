// #2744 AC1: one table per machine, whatever HOME a run uses. The requests below each have a HOME of their own and
// share one table through DEEP_THROTTLE_TABLE, the design's seam for a test that needs two HOMEs on one table
// (docs/parallel-proof.md, section 6, "Tables of a test's own"); the live table is never touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { TEST_LIMIT, dump, finish, pause, running, sandbox, started, startOf, throttle } from './helpers.mjs';

test('#2744.e34b52c0 test requests from processes with different HOMEs share the machine\'s test limit: the next one waits, then runs once a slot frees', { timeout: 120_000 }, async (t) => {
  const box = sandbox(t);
  const holders = [];
  for (let k = 1; k <= TEST_LIMIT; k++) {
    holders.push(throttle(box, ['test', '--wait', '1'], `holder-${k}`, [], { home: box.home() }));
    await started(box, holders.at(-1), 'test', 30_000, ...holders);
  }
  const next = throttle(box, ['test', '--wait', '1'], 'next', ['exit'], { home: box.home() });
  // The machine's test slots are all held, by processes whose HOMEs all differ from the next request's.
  await pause(3_000);
  assert.equal(startOf(box, 'next'), undefined, `the request after ${TEST_LIMIT} test grants, from yet another HOME, ran at once: each HOME got a table of its own\n${dump(box, ...holders, next)}`);
  assert.ok(running(next), `the waiting request ended instead of waiting\n${dump(box, ...holders, next)}`);
  // It waits for a slot, not for its timeout: once one holder finishes, it runs.
  finish(box, 'holder-1');
  await started(box, next, 'test', 30_000, ...holders);
  const run = await next.done;
  assert.equal(run.status, 0, dump(box, ...holders, next));
  assert.ok(holders.slice(1).every(running), `the other holders were ended\n${dump(box, ...holders, next)}`);
});
