import assert from 'node:assert/strict';
import test from 'node:test';
import { base, bays, change, dump, initialRun, proof, reportsMutants, sandbox, TARGET_TEST, TWIN_HOOK } from './helpers.mjs';

// The real proof in its bay pair (the fixture is its own worktree, so it gets one under the sandbox HOME). The tagged
// test names packages/cli/dist/main.js and runs its copy's target/debug/deep-hook and deep-show directly. It proves
// nothing on the merge base, so the lane runs its criterion's twin, which edits the deep-hook crate, as a use of the
// change bay; that run puts the twin's deep-hook in the bay's target/debug/. The mutation lane then uses the same
// change bay: StrykerJS's initial run must see the change's programs there, not the twin's.
test('#2835.1b0cb5cf the mutation copy target/debug holds programs built from the change own sources even after a twin used the bay', { timeout: 590_000 }, (t) => {
  const box = sandbox(t);
  base(box);
  change(box, {
    'tests/acceptance/2835/target.test.mjs': TARGET_TEST,
    'tests/acceptance/2835/twins.json': `${JSON.stringify({ '#2835.1b0cb5cf': ['hook-twin'] })}\n`,
    'tests/acceptance/2835/twins/hook-twin/crates/deep-hook/main.rs': TWIN_HOOK,
  });
  const { result, seen } = proof(t, box, ['mutation']);
  // The scene: the twin's before-lane run, in the change bay, read the twin's deep-hook from the bay's target/debug/.
  const twin = seen.filter((row) => row.stage === 'before' && row.hook?.word === 'hook-twin');
  assert.equal(twin.length, 1, `the twin ran once, in a before-lane use of the change bay\n${JSON.stringify(seen)}\n${dump(result)}`);
  assert.ok(twin[0].cwd.startsWith(`${bays(box)}/`), `the twin ran in a bay (${twin[0].cwd})`);
  const initial = initialRun(seen, result);
  for (const row of initial) {
    assert.equal(row.cwd, twin[0].cwd, 'the mutation lane uses the same change bay the twin used');
    for (const name of ['hook', 'show']) {
      assert.equal(row[name].bin, `${row.cwd}/target/debug/deep-${name}`, "the program read is the mutation copy's own target/debug one");
      assert.equal(row[name].status, 0, `StrykerJS's initial run: no runnable program at the mutation copy's target/debug/deep-${name}\n${dump(result)}`);
    }
  }
  for (const row of initial) assert.equal(row.hook.word, 'hook-change', `StrykerJS's initial run: the mutation copy's target/debug/deep-hook is the change's program, not the twin's\n${dump(result)}`);
  for (const row of initial) assert.equal(row.show.word, 'show-change', "StrykerJS's initial run: the mutation copy's target/debug/deep-show is the change's program");
  reportsMutants(result);
});
