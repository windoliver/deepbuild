// #2960.3979694e: a child that is SIGKILLed before it ends still leaves the run's count null, naming it (no count is
// invented for a process that never reported).
//   node --test tests/acceptance/2960/killed-child.test.mjs      # macOS
// Asserts, per run of fixtures/killer.c (which starts one child, SIGKILLs it before it ends and exits 0 without
// waiting for it): (a) the run's instructions are null; (b) uncounted names the child: the program's path for a
// posix_spawn child, "(forked)" for a forked one. Both children are programs the counter's library enters, so each
// could have reported itself had it ended by itself; the posix_spawn one is a separate binary, the forked one a copy of
// the killer, the shape of the helper's leash watcher that criterion 1 counts once it ends by _exit.
// The merge base already holds this (the condition must keep holding), so these pass there; their wrong program is the
// twin `count-forgets-killed` (twins.json): the merge base's scripts/benchmark.mjs with the one line that names a
// started child with no end removed, which invents a count from the rest.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { build, reading, remove, shown, tempDir } from './lib.mjs';

const MAC = process.platform === 'darwin';
const OFF_MAC = `INCONCLUSIVE: on ${process.platform} a counter that follows descendants (perf_event_open with inherit) adds a killed child's instructions when it ends, so what "a process that never reported" means there is an open question (README); this file runs on macOS`;

describe('#2960 a SIGKILLed child leaves the count null', { skip: MAC ? false : OFF_MAC, timeout: 600_000 }, () => {
  let dir, killer, victim;
  before(() => {
    dir = tempDir();
    killer = build(dir, 'killer', []);
    victim = build(dir, 'tool', [], 'victim');
  });
  after(() => dir && remove(dir));

  function nullNaming(read, name, what) {
    if ('threw' in read) assert.fail(`BLOCKED: ${what}: ${shown(read)}`);
    const { result } = read;
    assert.equal(result.status, 0, `BLOCKED: ${what} exited ${result.status}: ${shown(read)}`);
    assert.equal(result.instructions, null, `${what}: the run's count is ${result.instructions}, a count invented for a child that was SIGKILLed and never reported; it must be null. ${shown(read)}`);
    assert.ok(Array.isArray(result.uncounted) && result.uncounted.includes(name), `${what}: the count is null but uncounted ${JSON.stringify(result.uncounted)} doesn't name the killed child ${JSON.stringify(name)}. ${shown(read)}`);
  }

  it('#2960.3979694e a posix_spawn child SIGKILLed before it ends leaves the count null, named by its path', async () => {
    nullNaming(await reading([killer, 'spawn', victim]), victim, `measureOnce of \`killer spawn ${victim}\``);
  });

  it('#2960.3979694e a forked child SIGKILLed before it ends leaves the count null, named "(forked)"', async () => {
    nullNaming(await reading([killer, 'fork']), '(forked)', 'measureOnce of `killer fork`');
  });
});
