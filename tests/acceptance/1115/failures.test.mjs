// #1115: failures on main equal today's. One fixture set runs under the merge base's scripts ("before") and this
// checkout's ("after"). On the base those are one program, so each test here passes there and names the wrong program
// that fails it (README: Failures on main, before and after). The run on real main is by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { affectedNested, CHECKOUT, dump, failIds, gitIn, idOf, KNOWN, laneState, LONG, mergeBaseScripts, nodeFile, sandbox, summary, timedPath, tree, unit, vitestFile } from './helpers.mjs';

const VITEST = 'tests/fixture-1115/set.test.ts';
const NODE = 'tests/fixture-1115-set.test.mjs';
const vitestSet = vitestFile(`test('passes', () => { expect(1).toBe(1); });
test('fails', () => { expect(1).toBe(2); });
test('compares the word', () => { expect('INCONCLUSIVE: a value under test').toBe('PASS'); });
test('skips', (ctx) => { ctx.skip('INCONCLUSIVE: unrun here'); });`);
const nodeSet = nodeFile(`test('passes', () => { assert.equal(1, 1); });
test('fails on main', () => { assert.equal(1, 2); });
test('skips', { skip: 'BLOCKED: no record on the fixture machine' }, () => {});`);

// Wrong program: a reader whose INCONCLUSIVE match isn't anchored to the message's start, so `compares the word` drops
// out of the FAIL ids, or one that lists a failure as a skip.
test('#1115.07ca71fc failures on main equal today\'s: affected.mjs with the merge base\'s scripts and with the change\'s, on one fixture set, list the same FAIL ids', LONG, async (t) => {
  const box = sandbox(t);
  const timed = timedPath('mjs');
  const files = { [VITEST]: vitestSet, [NODE]: nodeSet, [timed]: nodeFile("test('the budget fails', () => { assert.equal(1, 2); });") };
  const paths = Object.keys(files);
  const failures = { [idOf(NODE, 'fails on main')]: 'fails on main (#1115 fixture)' };
  const { rev, scripts } = mergeBaseScripts(box);
  const before = await affectedNested(box, tree(box, files, { scripts, name: 'before', failures }), ['--timed', ...paths]);
  const after = await affectedNested(box, tree(box, files, { name: 'after', failures }), ['--timed', ...paths]);
  const all = `merge base ${rev}\n--- before\n${dump(before)}\n--- after\n${dump(after)}`;
  const was = failIds(before.stdout), now = failIds(after.stdout);
  assert.deepEqual(was, [idOf(VITEST, 'compares the word'), idOf(VITEST, 'fails'), idOf(NODE, 'fails on main'), idOf(timed, 'the budget fails')].sort(), `the merge base's scripts did not list every planted failure, so there is nothing to compare\n${all}`);
  assert.deepEqual(now, was, `the change's scripts list other FAIL ids than the merge base's\n${all}`);
  assert.match(summary(after.stdout), /^FAIL affected: /, `a run with new failures summarises otherwise\n${all}`);
});

// Wrong program: a lane that reads FAIL no longer when a skip or an INCONCLUSIVE stands beside it, or that replaces the
// runner's output, so the lane's FAIL no longer names what failed.
test('#1115.07ca71fc failures on main equal today\'s: the unit lane with the merge base\'s scripts and with the change\'s reads FAIL on one fixture set, and each names the failing tests', LONG, async (t) => {
  const box = sandbox(t);
  const files = { [VITEST]: vitestSet, [NODE]: nodeSet };
  const { rev, scripts } = mergeBaseScripts(box);
  const before = await unit(box, tree(box, files, { scripts, name: 'before' }));
  const after = await unit(box, tree(box, files, { name: 'after' }));
  const all = `merge base ${rev}\n--- before\n${dump(before)}\n--- after\n${dump(after)}`;
  assert.equal(laneState(before.stdout), 'FAIL', `the merge base's lane read otherwise, so there is nothing to compare\n${all}`);
  assert.equal(laneState(after.stdout), laneState(before.stdout), `the change's lane reads otherwise than the merge base's\n${all}`);
  assert.equal(after.status, before.status, all);
  for (const name of ['fails', 'compares the word', 'fails on main']) {
    assert.ok(before.stdout.includes(name), `the merge base's lane did not name ${name}\n${all}`);
    assert.ok(after.stdout.includes(name), `the change's lane does not name ${name}\n${all}`);
  }
});

// Wrong program: a change that moves an entry of main's failures, lint or timing into `skips`, or drops it.
test('#1115.07ca71fc failures on main equal today\'s: known-failures.json keeps the merge base\'s failures, lint and timing', LONG, async (t) => {
  const box = sandbox(t);
  const { rev } = mergeBaseScripts(box);
  const at = JSON.parse(gitIn(CHECKOUT)('show', `${rev}:${KNOWN}`));
  const now = JSON.parse(readFileSync(join(CHECKOUT, KNOWN), 'utf8'));
  assert.ok(Object.keys(at.failures).length, `the merge base's ${KNOWN} lists no failure, so there is nothing to compare`);
  for (const key of ['failures', 'lint', 'timing']) assert.deepEqual(now[key], at[key], `${KNOWN}'s ${key} differ from the merge base's`);
});
