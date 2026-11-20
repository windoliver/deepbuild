import assert from 'node:assert/strict';
import test from 'node:test';
import { base, bays, change, dump, HUB_TEST, initialRun, proof, reportsMutants, sandbox } from './helpers.mjs';

// The real mutation lane on a fixture whose tagged test starts its checkout's hub stand-in through
// packages/cli/dist/main.js hub run, which exits BLOCKED unless deep-hook and deep-show are under that checkout's
// target/. The proof runs under a holder of a bay-pair grant, so it gets no bay: the mutation lane's copy is a fresh
// temporary copy of the change, with no target/ of its own and no hub binary in it from anything earlier.
test('#2835.addc1d10 a passing tagged test starting the checkout hub gets through StrykerJS initial run, and the lane reports mutants instead of BLOCKED', { timeout: 590_000 }, (t) => {
  const box = sandbox(t);
  base(box);
  change(box, { 'tests/acceptance/2835/hub.test.mjs': HUB_TEST });
  const { result, seen } = proof(t, box, ['mutation'], { bay: false });
  const before = seen.filter((row) => row.stage === 'before' && row.mutant === null);
  assert.ok(before.some((row) => row.status === 0 && row.stdout === 'hook-change show-change'), `the tagged test passes on the change in the before-lane run\n${JSON.stringify(seen)}\n${dump(result)}`);
  const initial = initialRun(seen, result);
  for (const row of initial) {
    assert.ok(!row.cwd.startsWith(`${bays(box)}/`), `no bay: the mutation lane's copy is a temporary one (${row.cwd})`);
    assert.ok(!before.some((other) => other.cwd === row.cwd), 'the mutation lane runs in a fresh copy of its own');
  }
  for (const row of initial) assert.equal(row.status, 0, `StrykerJS's initial run: the hub found no binary under the mutation copy's target/ (${row.stderr})\n${dump(result)}`);
  for (const row of initial) assert.equal(row.stdout, 'hook-change show-change', "the mutation copy's hub answers with the change's programs");
  reportsMutants(result);
});
