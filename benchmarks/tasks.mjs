// One ask-tasks workload per run, for the perf lane's budgets (issue #303): node benchmarks/tasks.mjs <task>.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecord } from '../packages/record/dist/index.js';
import { openTasks } from '../packages/tasks/dist/index.js';

const T0 = 1_761_555_600_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique, ordered, and the same on every run. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const hook = (session) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });

const workloads = {
  // 600 prompt hooks in one session, each a message that asks for a change and opens a task, with a stop after each.
  async prompt(record, tasks) {
    await record.append(hook('S1'), { v: 1, id: ulidAt(T0), kind: 'session.start', ts: T0, data: { agent: 'claude-code', worktree: '/nowhere', branch: 'main', thread: 'S1' } });
    for (let n = 0; n < 600; n++) {
      const { task } = await tasks.prompt(hook('S1'), { msg: n, text: `make the auth middleware reject expired tokens on route ${n}`, from: 'person' });
      if (task !== `session:S1#${n}`) throw Error(`prompt ${n} opened ${String(task)}`);
      await record.append(hook('S1'), { v: 1, id: ulidAt(T0 + n + 1), kind: 'agent.stop', subject: 'session:S1', ts: T0 + n + 1, data: { turn: n + 1, did_work: false } });
    }
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
const root = mkdtempSync(join(tmpdir(), 'deep-tasks-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  const tasks = await openTasks({ record, now: () => T0, home: join(root, 'home') });
  await workloads[task](record, tasks);
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
