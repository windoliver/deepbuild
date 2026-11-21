// #2960.bb693bcf: on macOS, measureOnce of deep-hook-guards, deep-hook-overhead, hub-round-trip and extension-host at
// the merge base each give a non-null instruction count with an empty uncounted; a planted counter that ignores _exit
// reads uncounted ["(forked)"] again, and the test fails naming the helper's watcher.
//   node --test tests/acceptance/2960/exit-counted.test.mjs      # macOS; PATH must reach a native arm64 cargo first
// Asserts, per run: (a) the count is a positive safe integer, not null; (b) uncounted is empty; (c) the command exited
// 0. The leash test runs the supervisor helper's `leash` alone, whose watcher is the one child that is forked and ends
// with _exit(0), never waited for, so a "(forked)" there is that watcher and its failure says so. The planted counter
// is the twin `counter-ignores-exit` (twins.json): the merge base's scripts/count-children.c.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CHANGE, HELPER, TASKS, TASKS_AT, reading, shown, taskCommand, tasksUnrunnable } from './lib.mjs';

const MAC = process.platform === 'darwin';
const OFF_MAC = `INCONCLUSIVE: criterion #2960.bb693bcf is macOS's; this host is ${process.platform}`;
const count = (value) => Number.isSafeInteger(value) && value > 0;
const WATCHER = 'the supervisor helper\'s leash watcher (packages/supervisor/native/helper.c leash(): forked beside the program, ends with _exit(0), never waited for)';

// A node process that runs argv as its child, waits for it, then stays 3 s so a child the child left behind ends.
const PARENT = 'const { spawnSync } = require("node:child_process"); const ran = spawnSync(process.argv[1], process.argv.slice(2), { stdio: "ignore" }); if (ran.status !== 0) process.exit(3); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);';

function holdsCount(read, what) {
  if ('threw' in read) assert.fail(`${what}: ${shown(read)}`);
  const { result } = read;
  assert.equal(result.status, 0, `BLOCKED: ${what} exited ${result.status}: ${shown(read)}`);
  const forked = result.uncounted?.includes('(forked)') ? ` "(forked)" is a forked child with no end line, as ${WATCHER} leaves.` : '';
  assert.ok(count(result.instructions) && Array.isArray(result.uncounted) && result.uncounted.length === 0,
    `${what} gives instructions ${JSON.stringify(result.instructions)}, uncounted ${JSON.stringify(result.uncounted)}: a non-null count with an empty uncounted is required.${forked} ${shown(read)}`);
}

describe('#2960 a child that ends with _exit is counted on macOS', { timeout: 7_200_000 }, () => {
  it('#2960.bb693bcf the supervisor helper\'s leash watcher, which ends with _exit, is counted', { skip: MAC ? false : OFF_MAC }, async () => {
    if (!existsSync(HELPER)) assert.fail(`BLOCKED: ${HELPER} is not built; run npm run build --workspaces`);
    // The same parent with no helper: what it starts is counted on any counter, so a "(forked)" below is the helper's.
    const control = await reading([process.execPath, '-e', PARENT, '/usr/bin/true']);
    if ('threw' in control || control.result.status !== 0 || !count(control.result.instructions) || control.result.uncounted.length)
      assert.fail(`BLOCKED: a node process that runs /usr/bin/true isn't counted on this host, so the helper can't be told apart: ${shown(control)}`);
    const read = await reading([process.execPath, '-e', PARENT, HELPER, 'leash', '/usr/bin/true']);
    if ('result' in read && read.result.uncounted?.includes('(forked)'))
      assert.fail(`${WATCHER} has no count: measureOnce of a node process running \`${HELPER} leash /usr/bin/true\` reads instructions ${JSON.stringify(read.result.instructions)}, uncounted ${JSON.stringify(read.result.uncounted)}, where the same process running /usr/bin/true alone reads ${control.result.instructions} with none uncounted`);
    holdsCount(read, `a node process running ${HELPER} leash /usr/bin/true`);
  });

  for (const id of TASKS) {
    it(`#2960.bb693bcf ${id} at the merge base gives a non-null count with an empty uncounted`, { skip: MAC ? false : OFF_MAC }, async () => {
      const blocked = tasksUnrunnable(TASKS_AT);
      if (blocked) assert.fail(blocked);
      const command = taskCommand(TASKS_AT, id);
      if (!command) assert.fail(`BLOCKED: ${TASKS_AT}/benchmarks/budgets.json has no task ${id}`);
      holdsCount(await reading(command, TASKS_AT), `measureOnce of ${id} (${command.join(' ')}) in ${TASKS_AT === CHANGE ? 'this checkout' : TASKS_AT}`);
    });
  }
});
