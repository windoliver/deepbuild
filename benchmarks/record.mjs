// One record workload per run, for the perf lane's budgets (issues #14 and #62): node benchmarks/record.mjs <task>.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from '../packages/contracts/dist/index.js';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';
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

/**
 * `sessions` sessions with an archived transcript each, `filler` messages long besides the one quoted, then
 * `count` learned changes applied by the local-first rule, each quoting its session's message, so every apply
 * reads its transcript (issue #62).
 */
async function learn(record, store, sessions, count, filler = 0) {
  const ids = [];
  const quoted = [];
  for (let i = 0; i < sessions; i++) {
    const at = T0 + i;
    const S = ulidAt(at);
    await record.append({ ...hook(S), project: i % 2 ? 'blog' : 'shop' }, event('session.start', at, template('session.start').data, false));
    const lines = [];
    for (let f = 0; f < filler; f++) lines.push(JSON.stringify({ type: 'assistant', uuid: `f${f}`, sessionId: S, message: { role: 'assistant', content: [{ type: 'text', text: `step ${f}: ${'reading the code and running the tests '.repeat(6)}` }] } }));
    lines.push(JSON.stringify({ type: 'user', uuid: 'm1', sessionId: S, message: { role: 'user', content: `lesson ${i}: use port ${4000 + i}` } }));
    const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: new Uint8Array(Buffer.from(`${lines.join('\n')}\n`)), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
    await record.append(you, event('transcript.archived', at, { session: `session:${S}`, evidence: put.evidence.sha256 }, false));
    quoted.push(S);
  }
  for (let i = 0; i < count; i++) {
    const k = i % sessions;
    const e = event('learn.applied', T0 + 10_000 + i, {
      layer: 'learned', target: `slice:fact${i}`, diff: `+ fact ${i}`, evidence: [{ at: `session:${quoted[k]}#m1`, quote: `use port ${4000 + k}` }],
      scope: `session:${quoted[k]}`, replay: null, applied_by: 'rule:localfirst', supersedes: null,
    }, false);
    await record.append({ writer: 'core', actor: 'you', scope: 'you' }, e);
    ids.push(e.id);
  }
  return ids;
}
const you = { writer: 'app', actor: 'you', scope: 'you' };

const workloads = {
  // 1,000 learned changes applied one at a time, each read against its 2,000-message transcript, then each rolled back.
  async 'learn-apply-rollback-1k'(record, store) {
    const ids = await learn(record, store, 10, 1_000, 2_000);
    for (const id of ids.reverse()) await record.rollBack(you, { change: id });
  },
  // A 10,000-change learned layer, its newer half rolled back to a date, then its projections dropped and rebuilt by replay.
  async 'learn-rebuild-10k'(record, store) {
    await learn(record, store, 200, 10_000);
    await record.rollBack(you, { since: T0 + 15_000 });
    await record.rebuild();
  },
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
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0, evidence: store });
  await workloads[task](record, store);
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
