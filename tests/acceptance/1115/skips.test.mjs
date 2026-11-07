// #1115: an unlisted skip in the real unit lane reads INCONCLUSIVE and is listed, and one whose note starts with BLOCKED
// reads BLOCKED. Reached by running the real runLanes on the real `unit` lane of lanes.mjs, in a scratch tree whose
// suites skip under each note kind, on real vitest and real node --test (README: The scratch trees).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, idOf, laneState, lists, LONG, nodeFile, sandbox, tree, unit, vitestFile } from './helpers.mjs';

const VITEST = 'tests/fixture-1115/skips.test.ts';
const NODE = 'tests/fixture-1115-skips.test.mjs';

test('#1115.dbbdd753 a lanes.mjs unit run with an unlisted vitest skip reports the lane INCONCLUSIVE and lists the skip', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [VITEST]: vitestFile(`test('the ctx skip', (ctx) => { ctx.skip('INCONCLUSIVE: a note from ctx.skip'); });
it.skip('the static skip', () => {});
describe.skipIf(true)('the gated suite', () => { it('the gated test', () => {}); });`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an unlisted vitest skip left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, `the lanes exited 0 with the lane unrun in part\n${all}`);
  assert.ok(lists(run.stdout, idOf(VITEST, 'the ctx skip'), 'INCONCLUSIVE: a note from ctx.skip'), `no line lists the ctx.skip with its note\n${all}`);
  assert.ok(lists(run.stdout, idOf(VITEST, 'the static skip')), `no line lists the it.skip\n${all}`);
  assert.ok(lists(run.stdout, idOf(VITEST, 'the gated suite', 'the gated test')), `no line lists the test of the describe.skipIf\n${all}`);
});

test('#1115.dbbdd753 a lanes.mjs unit run with an unlisted node --test skip reports the lane INCONCLUSIVE and lists the skip', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [NODE]: nodeFile(`test('the t.skip', (t) => { t.skip('INCONCLUSIVE: a note from t.skip'); });
test('the skip option', { skip: 'INCONCLUSIVE: a note from the option' }, () => {});
test('the bare option', { skip: true }, () => {});
describe('a suite', () => { it('the nested skip', (t) => { t.skip('INCONCLUSIVE: a nested note'); }); });`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an unlisted node --test skip left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, `the lanes exited 0 with the lane unrun in part\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'the t.skip'), 'INCONCLUSIVE: a note from t.skip'), `no line lists the t.skip with its note\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'the skip option'), 'INCONCLUSIVE: a note from the option'), `no line lists the { skip } test with its note\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'the bare option')), `no line lists the { skip: true } test\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'a suite', 'the nested skip'), 'INCONCLUSIVE: a nested note'), `no line lists the nested skip with its full id\n${all}`);
});

// node --test reports a suite skipped whole once, and never reports the tests inside it.
test('#1115.dbbdd753 a node --test suite skipped whole reports the lane INCONCLUSIVE and lists the suite', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [NODE]: nodeFile(`describe('the skipped suite', { skip: 'INCONCLUSIVE: a whole suite is unrun' }, () => { it('never runs', () => { assert.fail('ran'); }); });`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `a suite skipped whole left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'the skipped suite'), 'INCONCLUSIVE: a whole suite is unrun'), `no line lists the skipped suite with its note\n${all}`);
});

test('#1115.dbbdd753 an unlisted vitest skip whose note starts with BLOCKED reports the lane BLOCKED, beside an INCONCLUSIVE one', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [VITEST]: vitestFile(`test('the blocked skip', (ctx) => { ctx.skip('BLOCKED: no record from the fixture machine'); });
test('the inconclusive skip', (ctx) => { ctx.skip('INCONCLUSIVE: a reading only'); });`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'BLOCKED', `a skip noted BLOCKED left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
  assert.ok(lists(run.stdout, idOf(VITEST, 'the blocked skip'), 'BLOCKED: no record from the fixture machine'), `no line lists the BLOCKED skip with its note\n${all}`);
});

test('#1115.dbbdd753 an unlisted node --test skip whose note starts with BLOCKED reports the lane BLOCKED', LONG, async (t) => {
  const box = sandbox(t);
  const run = await unit(box, tree(box, {
    [NODE]: nodeFile(`test('the blocked t.skip', (t) => { t.skip('BLOCKED: no toolchain on the fixture machine'); });
test('the blocked option', { skip: 'BLOCKED: no record on the fixture machine' }, () => {});`),
  }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'BLOCKED', `a skip noted BLOCKED left the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.notEqual(run.status, 0, all);
  assert.ok(lists(run.stdout, idOf(NODE, 'the blocked t.skip'), 'BLOCKED: no toolchain on the fixture machine'), `no line lists the BLOCKED t.skip with its note\n${all}`);
  assert.ok(lists(run.stdout, idOf(NODE, 'the blocked option'), 'BLOCKED: no record on the fixture machine'), `no line lists the BLOCKED { skip } test with its note\n${all}`);
});
