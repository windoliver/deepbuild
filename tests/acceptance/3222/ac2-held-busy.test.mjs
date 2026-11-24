// Acceptance tests for issue #3222, criterion 2's second sentence: "A harness that times a call from its start in the
// core, and so reads no wait, fails against a core held busy by the test, naming the call." This suite holds the
// canvas core busy itself (held.mjs): the spike's harness starts its hub under a temporary home, this suite fills the
// core's line with four calls the world file's fault holds 1.5 s each, then lets the harness's session send its calls
// behind them. The first test holds the spike's harness to the wait it must read; the second runs its planted twin,
// which times each call from its start in the core, and must fail the same check, naming the call.
// Run: node --test tests/acceptance/3222/ac2-held-busy.test.mjs   (needs the built hub, target/debug/deep-show and
// docs/spikes/3222/harness.mjs; starts one hub per test, through the harness, and stops it by PID)
import assert from 'node:assert/strict';
import test from 'node:test';
import { heldRun, MIN_WAIT_MS } from './held.mjs';
import { AC2, heldBusyProblems } from './validate.mjs';

/** The hold must still have been ahead of the go line by the least wait asked, or nothing was held for the harness. */
function heldPastGo({ held, lastHeld }) {
  assert.ok(lastHeld >= held.goAt + MIN_WAIT_MS, `${AC2} INCONCLUSIVE: the held calls were all answered by ${lastHeld}, less than ${MIN_WAIT_MS} ms after the go line (${held.goAt}), so the core may not have been busy when the harness's call arrived; this is not a pass`);
}

test(`${AC2} the spike's harness reads the wait of a call that reaches the hub while the test holds the canvas core busy ahead of it`, { timeout: 30 * 60_000 }, async () => {
  const run = await heldRun();
  heldPastGo(run);
  const problems = heldBusyProblems(run.out, run.held);
  assert.deepEqual(problems, [], `${AC2}:\n${problems.join('\n')}`);
});

test(`${AC2} a harness that times a call from its start in the core reads no wait, and fails against the core the test holds busy, naming the call`, { timeout: 30 * 60_000 }, async () => {
  const run = await heldRun({ plant: true });
  heldPastGo(run);
  const calls = Array.isArray(run.out?.calls) ? run.out.calls : [];
  assert.ok(calls.length > 0, `${AC2}: the planted twin's output holds no call`);
  const first = [...calls].sort((a, b) => a.arrivedMs - b.arrivedMs)[0];
  const name = `session ${JSON.stringify(first.session)}'s ${first.kind} call on doc ${first.doc}`;
  const problems = heldBusyProblems(run.out, run.held);
  assert.ok(problems.some((p) => p.includes('read a wait of') && p.includes(name)), `${AC2}: the check passed a harness that times each call from its start in the core, or failed it without naming ${name}:\n${problems.join('\n')}`);
});
