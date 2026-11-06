// #1404 acceptance through perf, the surface that names a budget. One perf run on four fixture budgets:
// the second criterion end to end, with its merge base run from a copy of the merge base; and the third,
// a budget command that started a child and reports no count for it (README: Which child has no count).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, test } from 'node:test';
import { buildSpin, counted, fileScope, macOnly, millions, perfLane, reading, readsInconclusive, scratch, show, verdicts } from './helpers.mjs';

const SMALL = 30_000_000; // About 300 M instructions: 20 to 60 ms of a core, in 42 runs a budget.
const scope = fileScope();
let lane, heavy;

// The Node wrapper's bytes are the same at the merge base and now, but for the child's work.
const wrapper = (spin, iterations) => `import { spawnSync } from 'node:child_process';
const out = spawnSync(${JSON.stringify(spin)}, ['${iterations}'], { input: '', encoding: 'utf8' });
process.exit(out.status ?? 9);
`;
// A shell that stays to wait: the status line after the child keeps it from exec'ing into the child.
const shell = (spin, iterations) => `${JSON.stringify(spin).replaceAll('"', "'")} ${iterations} >/dev/null
status=$?
exit $status
`;
// A Node wrapper that starts a child in its own session and leaves without waiting. The child sleeps
// past the end of the round, so its count doesn't exist when the budget ends; it then exits by itself.
const leaver = (spin) => `import { spawn } from 'node:child_process';
spawn(${JSON.stringify(spin)}, ['1000000', '30'], { detached: true, stdio: 'ignore' }).unref();
`;

before(() => {
  if (process.platform !== 'darwin') return;
  const box = scratch(scope);
  const spin = buildSpin(box);
  heavy = counted([spin, String(3 * SMALL)], box);
  lane = perfLane(scope, {
    tasks: [
      { id: 'tripled', command: ['node', 'benchmarks/tripled.mjs'], base: { 'benchmarks/tripled.mjs': wrapper(spin, SMALL) }, current: { 'benchmarks/tripled.mjs': wrapper(spin, 3 * SMALL) } },
      { id: 'shell-parent', command: ['/bin/sh', 'benchmarks/shell-parent.sh'], base: { 'benchmarks/shell-parent.sh': shell(spin, SMALL) }, current: { 'benchmarks/shell-parent.sh': shell(spin, 3 * SMALL) } },
      { id: 'left-running', command: ['node', 'benchmarks/left-running.mjs'], base: { 'benchmarks/left-running.mjs': leaver(spin) }, current: {} },
      // A budget that starts nothing, as hook-startup doesn't.
      { id: 'childless', command: [spin, '1000000'], base: {}, current: {} },
    ],
  });
});

test('perf reads FAIL on a budget whose child retires 3 times its merge base\'s behind the same Node wrapper', (t) => {
  macOnly();
  t.diagnostic(`perf took ${lane.seconds.toFixed(1)} s`);
  assert.deepEqual(verdicts(lane, 'tripled'), ['FAIL'], reading(lane, 'tripled'));
  assert.equal(lane.line('tripled')?.instructions?.status, 'FAIL', reading(lane, 'tripled'));
  assert.notEqual(lane.result.status, 0, show(lane.result));
  for (const [round, { current }] of lane.line('tripled').instructions.pairs.entries()) assert.ok(current >= 0.95 * heavy, `round ${round} read ${millions(current)}; the child alone retires ${millions(heavy)}`);
});

// macOS strips DYLD_* from /bin/sh and its children, and a shell runs no Node preload: nothing a budget
// sets up runs in it or in what it starts. Only a watcher from outside could count this child, so a
// count is taken if it really holds the child, and then its 3 times has to read FAIL. PASS is never right.
test('a budget whose shell started a child it reports no count for reads INCONCLUSIVE, naming the budget, never PASS', () => {
  macOnly();
  const judged = lane.line('shell-parent')?.instructions;
  if (judged?.status === 'FAIL') {
    for (const [round, { current }] of judged.pairs.entries()) assert.ok(current >= 0.95 * heavy, `FAIL needs a count that holds the child: round ${round} read ${millions(current)}, the child alone retires ${millions(heavy)}`);
    return;
  }
  readsInconclusive(lane, 'shell-parent');
});

// No mechanism has this count: the child hasn't finished when the budget ends. Node is the parent here,
// so whatever a mechanism uses to see a Node wrapper's children sees this one start.
test('a budget that started a child still running when it ended reads INCONCLUSIVE, naming the budget, never PASS, and a budget that started none does not', () => {
  macOnly();
  readsInconclusive(lane, 'left-running');
  assert.deepEqual(verdicts(lane, 'childless'), [], reading(lane, 'childless'));
  assert.equal(lane.line('childless')?.instructions?.status, 'PASS', reading(lane, 'childless'));
});
