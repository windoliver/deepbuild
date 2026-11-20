import assert from 'node:assert/strict';
import test from 'node:test';
import { base, bays, change, commit, CONTROL_TEST, dump, existsSync, HUB_TEST, initialRun, proof, sandbox, NEITHER_TEST } from './helpers.mjs';

// Run 1, in the fixture's bay pair: an earlier proof (the before lane) runs a tagged test that names
// packages/cli/dist/main.js, so its change bay's target/debug/ holds deep-hook and deep-show. Then the change drops
// that test for one naming no hub or CLI package, and the mutation lane runs in the same change bay: StrykerJS's
// initial run must find neither binary there, whether the lane or the earlier use put it.
// Run 2, a control on a fresh fixture with no bay: a tagged test naming packages/cli/ must find both in the mutation
// copy's target/debug/. Without it, a mutation lane that never builds would pass run 1.
test('#2835.fe9d8d8e a tagged test naming neither the hub nor the CLI package finds no deep-hook or deep-show in the mutation copy', { timeout: 590_000 }, (t) => {
  const box = sandbox(t);
  base(box);
  change(box, { 'tests/acceptance/2835/hub.test.mjs': HUB_TEST });
  const earlier = proof(t, box, ['before']);
  const used = earlier.seen.filter((row) => row.stage === 'before' && row.stdout === 'hook-change show-change' && row.cwd.startsWith(`${bays(box)}/`));
  assert.equal(used.length, 1, `the earlier proof ran the hub test in the change bay\n${JSON.stringify(earlier.seen)}\n${dump(earlier.result)}`);
  const bay = used[0].cwd;
  for (const name of ['deep-hook', 'deep-show']) assert.ok(existsSync(`${bay}/target/debug/${name}`), `the earlier use left ${name} in the change bay's target/debug/\n${dump(earlier.result)}`);

  commit(box, { 'tests/acceptance/2835/hub.test.mjs': null, 'tests/acceptance/2835/neither.test.mjs': NEITHER_TEST }, 'fixture: a test naming neither package\n\nPart of #2835');
  const neither = proof(t, box, ['mutation']);
  const initial = initialRun(neither.seen, neither.result);
  for (const row of initial) assert.equal(row.cwd, bay, 'the mutation lane uses the change bay the earlier proof used');
  for (const row of initial) assert.deepEqual(row.found, [], `StrykerJS's initial run: a test naming neither package found binaries under the mutation copy's target/debug/\n${dump(neither.result)}`);

  const other = sandbox(t);
  base(other);
  change(other, { 'tests/acceptance/2835/control.test.mjs': CONTROL_TEST });
  const control = proof(t, other, ['mutation'], { bay: false });
  const named = initialRun(control.seen, control.result);
  for (const row of named) {
    assert.equal(row.hub, true, 'the control names a CLI that exists in its copy');
    assert.deepEqual(row.found, ['deep-hook', 'deep-show'], `control: StrykerJS's initial run of a test naming packages/cli/ found no deep-hook and deep-show under the mutation copy's target/debug/\n${dump(control.result)}`);
  }
});
