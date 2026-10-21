// One record workload per run, for the perf lane's budgets (issue #14): node benchmarks/record.mjs <task>.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from '../packages/contracts/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
/** A ULID at `ms`, with a counter for its random part: unique, ordered, and the same on every run. */
function ulidAt(ms) {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const seqAt = (ms) => `${BigInt(ms) * 1_000_000n}`;
const hook = (session) => ({ writer: 'hook', actor: 'you', scope: 'you', session });
const template = (kind) => fixtures(`${kind}@1`)[0];
const event = (kind, at, data, seq = true) => ({ v: 1, id: ulidAt(at), kind, ts: at, ...(seq ? { seq: seqAt(at) } : {}), data });

/** A session's start, a prompt, and `count` tool.after events, awaited in groups of 200. */
async function append(record, count) {
  const S = ulidAt(T0 - 1000);
  const start = template('session.start');
  await record.append(hook(S), event('session.start', T0 - 1000, start.data, false));
  const ask = template('user.ask');
  await record.append(hook(S), event('user.ask', T0, ask.data));
  const after = template('tool.after');
  for (let i = 0; i < count; i += 200) {
    const batch = [];
    for (let j = i; j < Math.min(count, i + 200); j++) {
      const at = T0 + 1000 + j;
      batch.push(record.append(hook(S), event('tool.after', at, { ...after.data, paths: [`src/${j % 500}.ts`] })));
    }
    await Promise.all(batch);
  }
}

const workloads = {
  // 20,000 stream events fired 200 at a time, as the issue's throughput budget counts them.
  async 'append-20k'(record) {
    await append(record, 20_000);
  },
  // A 100,000-event log, then its projections dropped and rebuilt by replay.
  async 'replay-100k'(record) {
    await append(record, 100_000);
    await record.rebuild();
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
const root = mkdtempSync(join(tmpdir(), 'deep-record-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  await workloads[task](record);
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
