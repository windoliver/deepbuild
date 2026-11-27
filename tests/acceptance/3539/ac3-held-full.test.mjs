// Acceptance tests for issue #3539, criterion 3: "A harness that times a slow check from its start, and so reads no
// wait, fails against a pool held full by the test, naming the check." This suite holds the pool full itself: its own
// script (harness-run.mjs, `heldFullScript`) has one session a person is at, stopping green with the three slow
// checks while `foreign`, the slots others hold, takes every slot of the pool until an hour in. The first test holds
// the spike's harness to the wait it must read there; the second runs its planted twin, which times each slow check
// from its start, and must fail the same check, naming each check.
// Run: node --test tests/acceptance/3539/ac3-held-full.test.mjs
//   (needs docs/spikes/3539/harness.mjs and what it needs; this suite builds nothing)
import assert from 'node:assert/strict';
import test from 'node:test';
import { heldFullScript, runHarness } from './harness-run.mjs';
import { heldFullProblems, holds, PLANTS } from './validate.mjs';

const AC3 = 'AC3 #3539.6078bd33';

test('AC3 #3539.6078bd33 the spike\'s harness reads the wait of a slow check queued while the test holds every slot of the pool', () => {
  const { script, held } = heldFullScript();
  const run = runHarness({ script, order: 'today' });
  holds(AC3, run.problems);
  holds(AC3, heldFullProblems(run.out, held));
});

test('AC3 #3539.6078bd33 a harness that times a slow check from its start reads no wait, and fails against the pool the test holds full, naming the check', () => {
  const { script, held } = heldFullScript();
  const run = runHarness({ script, order: 'today', plant: PLANTS.start });
  holds(AC3, run.problems);
  const problems = heldFullProblems(run.out, held);
  for (const check of held.checks) {
    assert.ok(problems.some((p) => p.includes('read a wait of') && p.includes(`${held.session}'s check ${check} on snapshot ${held.snapshot},`)), `${AC3}: the check passed a harness that times a slow check from its start, or failed it without naming ${held.session}'s check ${check}:\n${problems.join('\n') || '(no problem)'}`);
  }
});
