// Regression tests for #2539: a FULL commit's evidence sync holds back only its own session's later events, and a
// commit that lands meanwhile never moves how far the log is durable past a resume still waiting.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
const verdictOf = (claim: EventInput, at: number, sha?: string): EventInput => ({
  ...event('verdict.made', at, undefined, { claim: `claim:${claim.id}`, verdict: `verdict:${ulidAt(at)}` }), ...(sha ? { evidence: [sha] } : {}),
});

const open: RecordStore[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
/** A record whose evidence syncs wait until `release`, and one stored file a verdict can name. */
async function slowRecord(storage = testStorage()) {
  const root = mkdtempSync(join(tmpdir(), 'deep-record-2539-'));
  roots.push(root);
  const store = await openEvidenceStore({ root, now: () => T0 });
  const put = await store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes: Buffer.from('a run log'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'record', allows: [] } });
  if (put.status !== 'stored') throw Error(put.reason);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow = { ...store, sync: async (named: readonly string[]) => { await gate; await store.sync(named); } };
  const r = await openRecord({ path: 'record.db', now: () => T0, storage, evidence: slow, commitEach: true });
  return { r, release, sha: put.evidence.sha256, storage };
}
/** A session with a claim, its turn ended: its next prompt resumes it. */
async function ended(r: RecordStore, at: number): Promise<{ S: string; claim: EventInput }> {
  const S = ulidAt(at);
  await r.append(hook(S), event('session.start', at, undefined));
  await r.append(hook(S), event('user.ask', at + 1, seqAt(at + 1), { msg: 1 }));
  const claim = event('claim.made', at + 2, undefined);
  await r.append({ ...hook(S), writer: 'app' }, claim);
  await r.append(hook(S), { ...event('agent.stop', at + 3, seqAt(at + 3), { turn: 1 }), subject: `session:${S}` });
  return { S, claim };
}
/** `p`'s value, or 'waiting' when it hasn't settled in 30 s. */
// deadline: a promise the record holds back fails its test's assertion, naming it, not its timeout
const settled = <T>(p: Promise<T>): Promise<T | 'waiting'> => Promise.race([p, new Promise<'waiting'>((done) => setTimeout(() => done('waiting'), 30_000).unref())]);
/** Whether `p` has settled yet. */
const watched = (p: Promise<unknown>): { settled: boolean } => { const now = { settled: false }; void p.then(() => { now.settled = true; }, () => { now.settled = true; }); return now; };

describe('a FULL commit in its evidence sync holds back only its own session (#2539)', () => {
  it('another session\'s event commits meanwhile, and the syncing session\'s later event lands after its verdict', async () => {
    const { r, release, sha } = await slowRecord();
    open.push(r);
    const b = await ended(r, T0);
    const a = ulidAt(T0 + 10);
    await r.append(hook(a), event('session.start', T0 + 10, undefined));
    const verdict = r.append(core(b.S), verdictOf(b.claim, T0 + 20, sha));
    const later = r.append(hook(b.S), event('user.ask', T0 + 30, seqAt(T0 + 30), { msg: 2 }));
    try {
      const laterYet = watched(later);
      // A record that holds every commit behind the sync leaves session A's prompt waiting until the sync ends.
      const other = await settled(r.append(hook(a), event('user.ask', T0 + 40, seqAt(T0 + 40), { msg: 1 })));
      expect(other, 'session A\'s prompt commits while session B\'s verdict syncs').not.toBe('waiting');
      // Appended before A's prompt, so a record that doesn't hold it commits it first.
      expect(laterYet.settled, 'session B\'s later prompt waits behind its verdict').toBe(false);
    } finally {
      release();
    }
    const [v, l] = await Promise.all([verdict, later]);
    expect(l.log_pos, 'session B\'s events keep their arrival order').toBeGreaterThan(v.log_pos);
  }, 60_000);

  it('a FULL commit landing while a resume waits leaves the log\'s durable mark short of that session\'s end', async () => {
    const { r, release, sha, storage } = await slowRecord();
    const a = await ended(r, T0);
    // A's verdict syncs; A's next prompt, which resumes it, waits behind it.
    const pending = [r.append(core(a.S), verdictOf(a.claim, T0 + 20, sha)), r.append(hook(a.S), event('user.ask', T0 + 30, seqAt(T0 + 30), { msg: 2 }))];
    for (const p of pending) p.catch(() => undefined);
    // Session C's prompt resumes it too: it names no evidence, so it commits FULL at once, ahead of A's.
    const c = await ended(r, T0 + 100);
    await r.append(hook(c.S), event('user.ask', T0 + 120, seqAt(T0 + 120), { msg: 2 }));
    storage.cutPower();
    release();
    await Promise.allSettled(pending);
    const after = await openRecord({ path: 'record.db', now: () => T0 + 300, storage });
    open.push(after);
    // A FULL write that moves the mark past A's end reads A as cleanly ended after the cut, though its resume was lost,
    // and leaves A's claim open; read as lost, the claim gets its INVALID verdict at the start.
    const verdicts = (await after.raw('SELECT data FROM events WHERE kind = ? AND subject = ?', ['verdict.made', `claim:${a.claim.id}`])) as { data: string }[];
    expect(verdicts.map((row) => (JSON.parse(row.data) as { outcome: string }).outcome), 'session A, whose resume the cut dropped, reads as having lost events').toEqual(['INVALID']);
  });
});
