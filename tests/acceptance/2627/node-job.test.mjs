// #2627, AC2 "No file holds a slot without end", for a node --test job: a file that never exits, beside one that
// passes, in one node --test job of a real affected.mjs run with DEEP_JOB_IDLE_MIN=1 (README: Criteria to tests).
import test from 'node:test';
import { affected, expectBounded, nodePass, nodeStuck, sandbox, TEST, tree } from './helpers.mjs';

const STUCK = 'tests/fixture-2627-stuck.test.mjs';
const PASS = 'tests/fixture-2627-pass.test.mjs';

test('#2627.0e4b51fe a node --test file that never exits is stopped within the bound: it reads INCONCLUSIVE, never FAIL or PASS, the file beside it keeps its pass, none of its processes is left, the run reads INCONCLUSIVE and its grant is released', TEST, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [STUCK]: nodeStuck(box), [PASS]: nodePass });
  const run = await affected(box, fixture, [STUCK, PASS]);
  await expectBounded(box, run, { stuck: STUCK, pass: PASS });
});
