// AC2 (#3172.531b8e24): a target that exits non-zero with no `<its name>: INCONCLUSIVE; …` or `<its name>: BLOCKED; …`
// line still reads FAIL, as today. These pass on the base, where every such target reads FAIL; each names in
// twins.json the planted reader that fails it (twins/README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureRun, idOf, MINUTES, ofTarget } from './helpers.mjs';

/** The target reads FAIL, and nothing of it reads otherwise. */
function readsFail({ failures, all }, target) {
  const own = ofTarget(failures, idOf(target));
  assert.ok(own.length > 0, `${idOf(target)} failed, so the run reads it\n${all}`);
  assert.deepEqual(own.map((failure) => [failure.id, failure.state]), own.map((failure) => [failure.id, 'FAIL']), `${idOf(target)} prints no line of its own state, so it reads FAIL\n${all}`);
}

test('#3172.531b8e24 a target that exits 1 printing no "<its name>: INCONCLUSIVE; …" or "…: BLOCKED; …" line reads FAIL', MINUTES, async (t) => {
  readsFail(await fixtureRun(t, ['plain_failure']), 'plain_failure');
});

test('#3172.531b8e24 a target that exits 1 printing no such line reads FAIL in a run where other targets print theirs', MINUTES, async (t) => {
  readsFail(await fixtureRun(t, ['inconclusive_target', 'blocked_target', 'plain_failure']), 'plain_failure');
});

test('#3172.531b8e24 a target that exits 1 printing another target\'s "<name>: INCONCLUSIVE; <reason>" line reads FAIL', MINUTES, async (t) => {
  readsFail(await fixtureRun(t, ['borrowed_line']), 'borrowed_line');
});
