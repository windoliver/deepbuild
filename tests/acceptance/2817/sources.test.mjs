import assert from 'node:assert/strict';
import test from 'node:test';
import { before, bothSides, dump, fixture, sandbox, TARGET_TEST } from './helpers.mjs';

// The fixture's change edits the deep-hook crate (and deep-show's). Each side's tagged test runs its own copy's
// target/debug programs: each must be built from that side's sources, never shared or taken from the other side.
test('#2817.51a8f2a0 each side copy target/debug holds programs built from that side own sources', { timeout: 290_000 }, (t) => {
  const box = sandbox(t);
  fixture(box, { 'tests/acceptance/2817/target.test.mjs': TARGET_TEST });
  const { result, seen } = before(t, box);
  const sides = bothSides(seen, result);
  for (const side of ['change', 'base']) for (const name of ['hook', 'show']) {
    const { bin, status } = sides[side][name];
    assert.equal(status, 0, `${side} side: no runnable program at its copy's ${bin.slice(sides[side].cwd.length + 1)}\n${dump(result)}`);
    assert.equal(bin, `${sides[side].cwd}/target/debug/deep-${name}`, 'the program read is the copy\'s own target/debug one');
  }
  assert.equal(sides.change.hook.word, 'hook-change', "the change side's target/debug/deep-hook is the change's program");
  assert.equal(sides.base.hook.word, 'hook-base', "the base side's target/debug/deep-hook is the merge base's program");
  assert.equal(sides.change.show.word, 'show-change', "the change side's target/debug/deep-show is the change's program");
  assert.equal(sides.base.show.word, 'show-base', "the base side's target/debug/deep-show is the merge base's program");
  assert.match(result.stdout, /^PASS before: tests\/acceptance\/2817\/target\.test\.mjs › #2817\.51a8f2a0 .*: failed on the merge base at its assertion$/m, dump(result));
});
