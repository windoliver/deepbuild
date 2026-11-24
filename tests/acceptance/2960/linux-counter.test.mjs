// #2960.5567ea2d: on Linux with instruction counting allowed, the same four tasks give non-null counts that include
// their children. With perf_event_paranoid forbidding it, each reads BLOCKED and names the setting.
//   node --test tests/acceptance/2960/linux-counter.test.mjs     # Linux; on macOS every test skips, INCONCLUSIVE
// Which half runs is read from the host: counting is allowed when the process runs as root or
// /proc/sys/kernel/perf_event_paranoid is 2 or less (2 still lets a process count its own user-space instructions);
// above 2, as Debian's 3 and Ubuntu's 4, it is forbidding.
// Asserts, allowed: (a) each task's run exits 0 with a positive safe-integer count; (b) "include their children": a
// node process that runs a child doing about 10^9 instructions of work and waits for it counts more than that child
// counted alone. Forbidding: (c) each task's reading is BLOCKED and names perf_event_paranoid, with no count.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CHANGE, TASKS, TASKS_AT, blockedNaming, reading, shown, taskCommand, tasksUnrunnable } from './lib.mjs';

const LINUX = process.platform === 'linux';
const OFF_LINUX = `INCONCLUSIVE: criterion #2960.5567ea2d is Linux's; this host is ${process.platform}`;
const SETTING = '/proc/sys/kernel/perf_event_paranoid';
const paranoid = LINUX && existsSync(SETTING) ? Number(readFileSync(SETTING, 'utf8').trim()) : null;
const allowed = LINUX && (process.getuid?.() === 0 || (Number.isInteger(paranoid) && paranoid <= 2));
const count = (value) => Number.isSafeInteger(value) && value > 0;
const where = `perf_event_paranoid is ${paranoid}${process.getuid?.() === 0 ? ', running as root' : ''}`;

// About 10^9 instructions of work in a child node process.
const WORK = 'let s = 0; for (let i = 0; i < 300000000; i++) s = (s + i) | 0; if (s === 42) console.log(s);';
const PARENT = 'const { spawnSync } = require("node:child_process"); const ran = spawnSync(process.execPath, ["-e", process.argv[1]], { stdio: "ignore" }); process.exit(ran.status);';

describe('#2960 an instruction counter on Linux', { skip: LINUX ? false : OFF_LINUX, timeout: 7_200_000 }, () => {
  for (const id of TASKS) {
    it(`#2960.5567ea2d ${id}: a non-null count where counting is allowed, BLOCKED naming perf_event_paranoid where it is forbidden`, async () => {
      const blocked = tasksUnrunnable(TASKS_AT);
      if (blocked) assert.fail(blocked);
      const command = taskCommand(TASKS_AT, id);
      if (!command) assert.fail(`BLOCKED: ${TASKS_AT}/benchmarks/budgets.json has no task ${id}`);
      const read = await reading(command, TASKS_AT);
      const what = `measureOnce of ${id} (${command.join(' ')}) in ${TASKS_AT === CHANGE ? 'this checkout' : TASKS_AT}, ${where}`;
      if (allowed) {
        if ('threw' in read) assert.fail(`${what}: ${shown(read)}`);
        assert.equal(read.result.status, 0, `BLOCKED: ${what} exited ${read.result.status}: ${shown(read)}`);
        assert.ok(count(read.result.instructions), `${what}: instructions ${JSON.stringify(read.result.instructions)}, where counting is allowed a non-null count is required. ${shown(read)}`);
      } else {
        assert.ok(blockedNaming(read, ['perf_event_paranoid']), `${what}: counting is forbidden, so the reading must be BLOCKED naming perf_event_paranoid, never a count or a bare null. ${shown(read)}`);
      }
    });
  }

  it('#2960.5567ea2d where counting is allowed, a run\'s count includes its children', { skip: LINUX && !allowed ? `INCONCLUSIVE: counting is forbidden here (${where}); the tests above check BLOCKED` : false }, async () => {
    const child = await reading([process.execPath, '-e', WORK]);
    if ('threw' in child || child.result.status !== 0 || !count(child.result.instructions)) assert.fail(`the child's work counted alone gives no count: ${shown(child)}`);
    const parent = await reading([process.execPath, '-e', PARENT, WORK]);
    if ('threw' in parent) assert.fail(`a node process running that child: ${shown(parent)}`);
    assert.equal(parent.result.status, 0, `BLOCKED: a node process running that child exited ${parent.result.status}: ${shown(parent)}`);
    assert.ok(count(parent.result.instructions) && parent.result.instructions > child.result.instructions,
      `a node process that runs a child and waits for it counts ${parent.result.instructions} instructions, and the child alone counts ${child.result.instructions}: the parent's count must include the child's. ${shown(parent)}`);
  });
});
