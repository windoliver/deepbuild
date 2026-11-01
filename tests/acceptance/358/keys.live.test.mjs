// Live acceptance tests for issue #358, criterion d4ccff93. The surface is in KEYS.md. Each host runs the
// scenario once with values drawn per run. Run: node --test tests/acceptance/358/keys.live.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { drive, fieldProblems, foldProblems, scrollProblems, visibleProblems } from './keys-driver.mjs';
import { INSERT_AT, REBUILDS, ROWS, rowText } from './keys-panel.mjs';

const TAG = '#358.d4ccff93';
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.slice(0, 20).join('\n')}`);

let right;
let planted;
const rightRun = () => (right ??= drive('check'));
const plantedRun = () => (planted ??= drive('planted', INSERT_AT));

test(`${TAG} the panel really runs out of process, one rebuild per command, over ${ROWS} rows then ${ROWS + 1}`, async () => {
  const { ready, steps, v } = await rightRun();
  assert.equal(ready.ready, true);
  assert.equal(ready.origin, 'agent_built');
  assert.equal(ready.runtime, 'panel_host');
  assert.equal(ready.matching, 'by_key');
  assert.ok(Number.isInteger(ready.host_pid) && Number.isInteger(ready.check_pid), 'the check names both processes');
  assert.notEqual(ready.host_pid, ready.check_pid, 'the panel host is another process');
  assert.equal(steps.length, REBUILDS);
  for (const { n, reply } of steps) {
    assert.equal(reply.host_pid, ready.host_pid, `rebuild ${n} came from another panel host`);
    assert.equal(reply.row_count, n >= INSERT_AT ? ROWS + 1 : ROWS, `rebuild ${n}'s row count`);
  }
  assert.equal(v.after[v.insertIndex], v.inserted);
});

test(`${TAG} through ${REBUILDS} rebuilds and the row inserted above the visible ones at rebuild ${INSERT_AT}, the scroll stays anchored to the same row key`, async () => {
  const { steps, v } = await rightRun();
  holds(steps.flatMap((s) => scrollProblems(v, s)));
  const at50 = steps[INSERT_AT - 1];
  assert.equal(at50.reply.scroll.anchor_key, at50.before.anchor, 'the anchor key holds across the insert');
  assert.equal(at50.reply.scroll.offset_px, (at50.before.index + 1) * v.rowH, 'the offset grew by the inserted row');
  assert.ok(!at50.reply.visible.some((r) => r.key === v.inserted), 'the inserted row is above the visible ones');
});

test(`${TAG} focus, the value, the caret and a composition in flight at rebuild ${INSERT_AT} follow the field by key on every rebuild`, async () => {
  const { steps, v } = await rightRun();
  holds(steps.flatMap((s) => fieldProblems(v, s)));
  assert.notEqual(steps[INSERT_AT - 1].reply.composition, null, 'a composition was in flight at the insert');
  assert.ok(steps.at(-1).expected.value.length > 50, 'the field took typing throughout');
});

test(`${TAG} scope: an open fold follows its element by key across every rebuild, and the closed one beside it stays closed`, async () => {
  const { steps, v } = await rightRun();
  holds(steps.flatMap((s) => foldProblems(v, s)));
});

test(`${TAG} the host that follows keys reports a pass and exits 0`, async () => {
  const { report, exit } = await rightRun();
  assert.deepEqual({ verdict: report.verdict, failures: report.failures }, { verdict: 'PASS', failures: [] });
  assert.equal(exit, 0);
});

test(`${TAG} the planted host matches like the real one for rebuilds 1 to ${INSERT_AT - 1}, so nothing else is wrong with it`, async () => {
  const { ready, steps, v } = await plantedRun();
  assert.equal(ready.matching, 'by_position');
  assert.equal(ready.runtime, 'panel_host');
  assert.notEqual(ready.host_pid, ready.check_pid);
  holds(steps.slice(0, INSERT_AT - 1).flatMap((s) => [...scrollProblems(v, s), ...fieldProblems(v, s), ...foldProblems(v, s)]));
});

test(`${TAG} at rebuild ${INSERT_AT} the planted host shifts the scroll by a row and drops focus`, async () => {
  const { steps, v } = await plantedRun();
  assert.equal(steps.length, INSERT_AT);
  const { reply, before } = steps[INSERT_AT - 1];
  const shifted = v.before[before.index - 1];
  assert.equal(reply.scroll?.anchor_key, shifted, `the same place now holds the row one above ${before.anchor}`);
  assert.equal(v.after[before.index], shifted);
  assert.equal(reply.scroll?.offset_px, before.index * v.rowH, 'matching by position leaves the offset where it was');
  holds(visibleProblems(v, INSERT_AT, reply, before.index));
  assert.equal(reply.visible[0].text, rowText(v, shifted, INSERT_AT), 'this is the script\'s tree of the rebuild');
  assert.notEqual(reply.focus_key, v.field, 'focus left the field');
});

test(`${TAG} the planted host fails at rebuild ${INSERT_AT}, naming the row and the field, and exits non-zero`, async () => {
  const { report, exit, steps, v } = await plantedRun();
  assert.equal(report.verdict, 'FAIL');
  assert.ok(Array.isArray(report.failures), 'the report lists failures');
  const failures = report.failures;
  assert.ok(failures.length > 0, 'the report names at least one failure');
  assert.ok(failures.every((f) => f.rebuild === INSERT_AT), `no failure before rebuild ${INSERT_AT}: ${JSON.stringify(failures).slice(0, 400)}`);
  const anchor = steps[INSERT_AT - 1].before.anchor;
  assert.ok(failures.some((f) => f.kind === 'scroll' && f.element === anchor), `a scroll failure names ${anchor}: ${JSON.stringify(failures).slice(0, 400)}`);
  assert.ok(failures.some((f) => f.kind === 'focus' && f.element === v.field), `a focus failure names ${v.field}: ${JSON.stringify(failures).slice(0, 400)}`);
  assert.notEqual(exit, 0);
});
