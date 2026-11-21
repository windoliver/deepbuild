// #2627, AC2 "No file holds a slot without end", for a vitest job: a file whose worker spins without yielding (so
// vitest's own test timeout never fires), beside one that passes, in one vitest job of a real affected.mjs run with
// DEEP_JOB_IDLE_MIN=1 (README: Criteria to tests).
import test from 'node:test';
import { affected, expectBounded, sandbox, TEST, tree, vitestPass, vitestStuck } from './helpers.mjs';

const STUCK = 'tests/fixture-2627/stuck.test.ts';
const PASS = 'tests/fixture-2627/pass.test.ts';

test('#2627.0e4b51fe a vitest file whose worker spins without yielding is stopped within the bound: it reads INCONCLUSIVE, never FAIL or PASS, the file beside it keeps its pass, none of its processes is left, the run reads INCONCLUSIVE and its grant is released', TEST, async (t) => {
  const box = sandbox(t);
  const fixture = tree(box, { [STUCK]: vitestStuck(box), [PASS]: vitestPass });
  const run = await affected(box, fixture, [STUCK, PASS]);
  await expectBounded(box, run, { stuck: STUCK, pass: PASS });
});
