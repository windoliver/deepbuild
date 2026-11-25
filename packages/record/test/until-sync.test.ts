// Regression tests for #2539: untilSync settles once a sync of stored evidence starts, and never for a FULL commit whose
// hashes name nothing the store holds (a decision's key), which has no file to sync; a hook's reply waiting for a typed
// rule's save stops waiting on it (#2066's read after the reply).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { fixtures } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, testStorage } from '../src/index.js';
import type { Connection, EventInput, RecordStore } from '../src/index.js';

const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
function ulidAt(ms: number): string {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const seqAt = (ms: number): string => `${BigInt(ms) * 1_000_000n}`;
const hook = (session: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session });
const core = (session: string): Connection => ({ writer: 'core', actor: 'you', scope: 'you', session });
const data = (kind: string): JsonValue => (fixtures(`${kind}@1`)[0] as { data: JsonValue }).data;
const event = (kind: string, at: number, seq: string | undefined, patch: Record<string, JsonValue> = {}): EventInput => ({
  v: 1, id: ulidAt(at), kind, ts: at, ...(seq === undefined ? {} : { seq }), data: { ...(data(kind) as Record<string, JsonValue>), ...patch },
});
const verdictOf = (claim: EventInput, at: number, sha: string): EventInput => ({
  ...event('verdict.made', at, undefined, { claim: `claim:${claim.id}`, verdict: `verdict:${ulidAt(at)}` }), evidence: [sha],
});

const open: RecordStore[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
/** A record whose evidence syncs wait until `release`, and one stored file a verdict can name. */
async function gatedRecord() {
  const root = mkdtempSync(join(tmpdir(), 'deep-record-2539-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => T0 });
  const put = await store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes: Buffer.from('a run log'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'record', allows: [] } });
  if (put.status !== 'stored') throw Error(put.reason);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), evidence: { ...store, sync: async (named: readonly string[]) => { await gate; await store.sync(named); } }, commitEach: true });
  open.push(r);
  return { r, release, sha: put.evidence.sha256 };
}
/** A session with a claim, its turn ended. */
async function claimed(r: RecordStore, at: number): Promise<{ S: string; claim: EventInput }> {
  const S = ulidAt(at);
  await r.append(hook(S), event('session.start', at, undefined));
  await r.append(hook(S), event('user.ask', at + 1, seqAt(at + 1), { msg: 1 }));
  const claim = event('claim.made', at + 2, undefined);
  await r.append({ ...hook(S), writer: 'app' }, claim);
  return { S, claim };
}
/** `p`'s value, or 'waiting' when it hasn't settled in 30 s. */
// deadline: a promise the record holds back fails its test's assertion, naming it, not its timeout
const settled = <T>(p: Promise<T>): Promise<T | 'waiting'> => Promise.race([p, new Promise<'waiting'>((done) => setTimeout(() => done('waiting'), 30_000).unref())]);
/** Whether `p` has settled yet. */
const watched = (p: Promise<unknown>): { settled: boolean } => { const now = { settled: false }; void p.then(() => { now.settled = true; }, () => { now.settled = true; }); return now; };

it('untilSync settles once a FULL commit starts syncing stored evidence, before that sync ends (#2539)', async () => {
  const { r, release, sha } = await gatedRecord();
  const { S, claim } = await claimed(r, T0);
  const waiting = r.untilSync!();
  const verdict = r.append(core(S), verdictOf(claim, T0 + 20, sha));
  try {
    const verdictYet = watched(verdict);
    expect(await settled(waiting.then(() => 'started')), 'a sync of a stored file wakes what waits for one').toBe('started');
    // Another session's event commits meanwhile, so a verdict that didn't wait would have landed first.
    await settled(r.append(hook(ulidAt(T0 + 30)), event('session.start', T0 + 30, undefined)));
    expect(verdictYet.settled, 'the verdict itself still waits for its sync').toBe(false);
  } finally {
    release();
  }
  await verdict;
}, 60_000);

it('untilSync stays waiting through a FULL commit whose hash names nothing the store holds (#2539)', async () => {
  const { r, release } = await gatedRecord();
  release();
  const { S, claim } = await claimed(r, T0);
  const woken = watched(r.untilSync!());
  // A digest that is no stored file, as a decision's key is: the commit is FULL and names it, with nothing to sync.
  await r.append(core(S), verdictOf(claim, T0 + 20, 'ab'.repeat(32)));
  // What a commit's sync wakes, it wakes as the commit starts: well before the one after it has landed.
  await r.append(hook(S), event('user.ask', T0 + 30, seqAt(T0 + 30), { msg: 2 }));
  expect(woken.settled, 'a commit with no file to sync wakes nothing').toBe(false);
});

it('a store that can\'t read a named hash back leaves the FULL commit as its sync decides it (#2539)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deep-record-2539-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => T0 });
  // A joined copy whose manifest reads back wrong: get refuses it, while its sync finds nothing to sync.
  const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), evidence: { ...store, get: async () => { throw Error('corrupt manifest'); } }, commitEach: true });
  open.push(r);
  const { S, claim } = await claimed(r, T0);
  const verdict = await r.append(core(S), verdictOf(claim, T0 + 20, 'cd'.repeat(32)));
  expect(verdict.log_pos, 'the verdict is in the log').toBeGreaterThan(0);
});
