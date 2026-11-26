// AC1 (#3172.5a315338): a cargo target that exits non-zero having printed `<its name>: INCONCLUSIVE; <reason>` and
// reported no test is read INCONCLUSIVE by the unit lane, with that reason, never FAIL and never PASS; one that printed
// `<its name>: BLOCKED; <reason>` is read BLOCKED. The run is the real cargo's on a fixture workspace, and the Spark's
// real run of the 19 targets; the reader is the checkout's own cargoResults and crates (helpers.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, fixtureRun, idOf, MINUTES, ofTarget, read, REASON, sandbox, SPARK_TARGETS, sparkRun } from './helpers.mjs';

/** The one target's reading: exactly one failure of it, in `state`, and the run reads no FAIL and no pass of it. */
function readsOnly({ failures, passed, all }, id, state) {
  const own = ofTarget(failures, id);
  assert.deepEqual(own.map((failure) => [failure.id, failure.state]), [[id, state]], `${id} reads ${state}, once, as the target\n${all}`);
  assert.deepEqual(failures.filter((failure) => failure.state === 'FAIL').map(({ id: failed, message }) => `${failed}: ${message}`), [], `the run's one failing target says ${state}, so nothing reads FAIL\n${all}`);
  assert.deepEqual(passed.filter((name) => name === id || name.startsWith(`${id} › `)), [], `${id} ran no test, so nothing of it passed\n${all}`);
  return own[0];
}

test('#3172.5a315338 a target that prints "<its name>: INCONCLUSIVE; <reason>", reports no test and exits 1 is read INCONCLUSIVE with that reason, never FAIL or PASS', MINUTES, async (t) => {
  const run = await fixtureRun(t, ['inconclusive_target']);
  const reading = readsOnly(run, idOf('inconclusive_target'), 'INCONCLUSIVE');
  assert.ok(reading.message.includes(REASON.inconclusive), `the reading carries the target's reason, "${REASON.inconclusive}"; it says "${reading.message}"\n${run.all}`);
});

test('#3172.5a315338 a target that prints "<its name>: BLOCKED; <reason>", reports no test and exits 1 is read BLOCKED, never FAIL or PASS', MINUTES, async (t) => {
  const run = await fixtureRun(t, ['blocked_target']);
  readsOnly(run, idOf('blocked_target'), 'BLOCKED');
});

test('#3172.5a315338 in one run, a target\'s INCONCLUSIVE line and another\'s BLOCKED line are each read as their own, with their reasons, beside a target that fails', MINUTES, async (t) => {
  const run = await fixtureRun(t, ['inconclusive_target', 'blocked_target', 'plain_failure']);
  for (const [target, state] of [['inconclusive_target', 'INCONCLUSIVE'], ['blocked_target', 'BLOCKED']]) {
    const own = ofTarget(run.failures, idOf(target));
    assert.deepEqual(own.map((failure) => [failure.id, failure.state]), [[idOf(target), state]], `${target} reads ${state}, once\n${run.all}`);
  }
  const [inconclusive] = ofTarget(run.failures, idOf('inconclusive_target'));
  assert.ok(inconclusive.message.includes(REASON.inconclusive), `the INCONCLUSIVE reading carries its reason; it says "${inconclusive.message}"\n${run.all}`);
});
