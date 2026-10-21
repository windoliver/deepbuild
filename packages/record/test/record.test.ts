// Regression tests for the record (#14) beyond its acceptance suite: each one failed on the program it names.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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
const data = (kind: string, index = 0): JsonValue => (fixtures(`${kind}@1`)[index] as { data: JsonValue }).data;
const event = (kind: string, at: number, seq: string | undefined, patch: Record<string, JsonValue> = {}, index = 0): EventInput => ({
  v: 1, id: ulidAt(at), kind, ts: at, ...(seq === undefined ? {} : { seq }), data: { ...(data(kind, index) as Record<string, JsonValue>), ...patch },
});
const core = (session: string): Connection => ({ writer: 'core', actor: 'you', scope: 'you', session });

const open: RecordStore[] = [];
const roots: string[] = [];
const tempRoot = (): string => { const root = mkdtempSync(join(tmpdir(), 'deep-record-test-')); roots.push(root); return root; };
afterEach(async () => {
  for (const r of open.splice(0)) await r.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function record(): Promise<{ record: RecordStore; S: string }> {
  const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage() });
  open.push(r);
  const S = ulidAt(T0 - 1000);
  await r.append(hook(S), event('session.start', T0 - 1000, undefined));
  return { record: r, S };
}

describe('an event ID is one event, with what its connection proved', () => {
  it('the same ID from a connection with another actor is a conflict, not the same event', async () => {
    const { record: r, S } = await record();
    const e = event('tool.after', T0 + 10, seqAt(T0 + 10));
    await r.append(hook(S), e);
    // A record that hashes only the payload returns existing: true for another actor's identical payload.
    await expect(r.append({ ...hook(S), actor: 'someone-else' }, e)).rejects.toMatchObject({ code: 'conflict', id: e.id });
    await expect(r.append({ ...hook(S), writer: 'app' }, e)).rejects.toMatchObject({ code: 'conflict' });
    await expect(r.append(hook(S), e)).resolves.toMatchObject({ existing: true });
  });
});

describe('raw SQL cannot disarm the append-only log', () => {
  it('a statement that writes is refused, the triggers included, and events stay as they were', async () => {
    const { record: r, S } = await record();
    const { log_pos } = await r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10)));
    // A record that runs any statement lets a caller drop the triggers, then update or delete.
    await expect(r.raw('DROP TRIGGER events_no_update')).rejects.toThrow();
    await expect(r.raw('DROP TRIGGER events_no_delete')).rejects.toThrow();
    await expect(r.raw(`DELETE FROM events WHERE log_pos = ${log_pos}`)).rejects.toThrow();
    await expect(r.raw('DROP TABLE events')).rejects.toThrow();
    expect(await r.raw('SELECT count(*) AS n FROM events')).toEqual([{ n: 2 }]);
  });
});

describe('recovery reads the last FULL commit, whatever made it', () => {
  it('a session ended in a NORMAL batch made durable by a later block reservation keeps its claim open after a cut', async () => {
    const storage = testStorage();
    let r = await openRecord({ path: 'record.db', now: () => T0, storage });
    const A = ulidAt(T0 - 1000);
    await r.append(hook(A), event('session.start', T0 - 1000, undefined));
    const claim = event('claim.made', T0, undefined);
    await r.append({ ...hook(A), writer: 'app' }, claim);
    await r.append({ ...hook(A), writer: 'app' }, { ...event('session.attention', T0 + 1, undefined, { state: 'finished' }), subject: `session:${A}` });
    // Another session's stream crosses a block boundary: a FULL commit of meta alone, no core event in the log.
    const B = ulidAt(T0 + 2);
    await r.append(hook(B), event('session.start', T0 + 2, undefined));
    for (let i = 0; i < 1100; i += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, j) => r.append(hook(B), event('tool.after', T0 + 10 + i + j, seqAt(T0 + 10 + i + j)))));
    }
    storage.cutPower();
    r = await openRecord({ path: 'record.db', now: () => T0 + 5000, storage });
    open.push(r);
    const rows = (await r.table('claims')).rows.filter((row) => row.id === claim.id);
    // A record that reads the boundary from core events alone finds none and invalidates A's claim.
    expect(rows[0]?.verdict_id, 'A ended before the last FULL commit: its claim stays open').toBeNull();
  });
});

describe('recovery exempts a session whose end is the last durable event', () => {
  it('a session end at the durable boundary itself, made durable by a reservation, keeps its claim open after a cut', async () => {
    const storage = testStorage();
    let r = await openRecord({ path: 'record.db', now: () => T0, storage });
    const A = ulidAt(T0 - 1000);
    await r.append(hook(A), event('session.start', T0 - 1000, undefined));
    const claim = event('claim.made', T0, undefined);
    await r.append({ ...hook(A), writer: 'app' }, claim);
    // Fill the first block of log positions so the end lands on its last one, 1024.
    for (let i = 0; i < 1021; i += 100) {
      const n = Math.min(100, 1021 - i);
      await Promise.all(Array.from({ length: n }, (_, j) => r.append(hook(A), event('tool.after', T0 + 10 + i + j, seqAt(T0 + 10 + i + j)))));
    }
    const end = await r.append({ ...hook(A), writer: 'app' }, { ...event('session.attention', T0 + 2000, undefined, { state: 'finished' }), subject: `session:${A}` });
    expect(end.log_pos).toBe(1024);
    // The next position needs a new block: a FULL commit of meta alone, with A's end the last durable event.
    const B = ulidAt(T0 + 3000);
    await r.append(hook(B), event('session.start', T0 + 3000, undefined));
    storage.cutPower();
    r = await openRecord({ path: 'record.db', now: () => T0 + 5000, storage });
    open.push(r);
    const rows = (await r.table('claims')).rows.filter((row) => row.id === claim.id);
    // A record that exempts only an end strictly before the boundary invalidates A's claim.
    expect(rows[0]?.verdict_id, 'A ended at the last FULL commit: its claim stays open').toBeNull();
  });
});

describe('an event that keeps only part of its text needs its whole text as evidence', () => {
  const heredoc = (): string => `cat <<'EOF' > notes.txt\n${'line of notes\n'.repeat(1000)}EOF\n`;
  it('a put that fails is the append failing, and the session has lost events', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0, hooks: { afterExistsCheck: () => { throw Error('disk full'); } } });
    const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), evidence: store });
    open.push(r);
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    // A record that appends the cut event anyway stores it without the evidence the design requires.
    await expect(r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: heredoc() }))).rejects.toMatchObject({ code: 'storage' });
    const claim = event('claim.made', T0 + 20, undefined);
    await r.append({ ...hook(S), writer: 'app' }, claim);
    const rows = (await r.table('claims')).rows.filter((row) => row.id === claim.id);
    const verdict = (await r.table('verdicts')).rows.find((row) => row.claim_id === claim.id);
    expect(rows[0]?.verdict_id, 'the session lost an event: its next claim is INVALID').not.toBeNull();
    expect(verdict?.outcome).toBe('INVALID');
    expect(String(verdict?.reasons)).toContain('events lost');
  });

  it('with no evidence store, an event whose text is over the cut is refused, not kept in part', async () => {
    const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage() });
    open.push(r);
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    // A record that keeps the first 8,192 characters with nowhere for the rest loses the text for good.
    await expect(r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: heredoc() }))).rejects.toMatchObject({ code: 'storage' });
    expect(await r.read({ after: 0 })).toHaveLength(1);
  });

  it('every caller of close waits for the same stop', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0, hooks: { afterExistsCheck: () => gate } });
    const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), evidence: store });
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    const pending = r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: heredoc() }));
    const first = r.close();
    let secondDone = false;
    const second = r.close().then(() => { secondDone = true; });
    await new Promise((resolve) => setImmediate(resolve));
    // A record whose second close returns at once reports a stop that hasn't happened.
    expect(secondDone, 'the second close waits for the pending append').toBe(false);
    release();
    await expect(pending).resolves.toMatchObject({ existing: false });
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
  });

  it('close waits for an append whose evidence is still being written', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0, hooks: { afterExistsCheck: () => gate } });
    const r = await openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), evidence: store });
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    const e = event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: heredoc() });
    const pending = r.append(hook(S), e);
    const closing = r.close();
    // A record that closes once its queue is empty rejects this append as closed when its put returns.
    await expect(r.append(hook(S), event('tool.after', T0 + 11, seqAt(T0 + 11)))).rejects.toMatchObject({ code: 'closed' });
    release();
    await expect(pending).resolves.toMatchObject({ existing: false });
    await closing;
  });
});

describe('a commit that fails leaves no trace in the live projections', () => {
  it('a refused agent.stop is not the stop a later prompt reads the clock against', async () => {
    const storage = testStorage();
    const r = await openRecord({ path: 'record.db', now: () => T0, storage });
    open.push(r);
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    await r.append(hook(S), event('user.ask', T0, seqAt(T0), { msg: 1 }));
    storage.refuseWrites = true;
    await expect(r.append(hook(S), { ...event('agent.stop', T0 + 100, seqAt(T0 + 100), { turn: 1 }), subject: `session:${S}` })).rejects.toMatchObject({ code: 'storage' });
    storage.refuseWrites = false;
    await r.append(hook(S), event('user.ask', T0 + 200, seqAt(T0 + 50), { msg: 2 }));
    const live = await r.session(S);
    // A record whose turn cache keeps the refused stop reads "clock went back" against a stop not in the log.
    expect(live?.readings, 'no reading against an event the log never took').toEqual([]);
    await r.rebuild();
    expect(await r.session(S), 'the live view is a function of the log').toEqual(live);
  });
});

describe('a decision that commits ahead of its queued subject still reaches the subject\'s row', () => {
  it('a verdict committed FULL before the claim it judges is on the claim, live and after a rebuild', async () => {
    const { record: r, S } = await record();
    const claim = event('claim.made', T0, undefined);
    const pending = r.append({ ...hook(S), writer: 'app' }, claim);
    const verdict = event('verdict.made', T0 + 1, undefined, { claim: `claim:${claim.id}`, verdict: `verdict:${ulidAt(T0 + 1)}` }, 1);
    const judged = await r.append(core(S), verdict);
    expect(judged.log_pos, 'the verdict jumped the queue').toBeLessThan((await pending).log_pos);
    const row = () => r.table('claims').then((t) => t.rows.find((c) => c.id === claim.id));
    // A projection that updates the claim's row only when it exists leaves verdict_id null for good.
    expect((await row())?.verdict_id, 'live').toBe(verdict.id);
    await r.rebuild();
    expect((await row())?.verdict_id, 'rebuilt').toBe(verdict.id);
  });

  it('an answer committed FULL before its queued ask reads answered', async () => {
    const { record: r, S } = await record();
    const ask = event('ask.created', T0, undefined);
    const pending = r.append({ ...hook(S), writer: 'app' }, ask);
    await r.append(core(S), { ...event('ask.answered', T0 + 1, undefined), subject: `ask:${ask.id}` });
    await pending;
    const row = (await r.table('asks')).rows.find((a) => a.id === ask.id);
    expect(row?.status, 'an answered ask never reads open').toBe('answered');
  });
});

describe('a denied lease request never erases the holder', () => {
  it('after acquired by A, denied to B leaves the key held by A', async () => {
    const { record: r, S } = await record();
    await r.append(core(S), event('lease.acquired', T0, undefined, { holder: 'session:AAAA' }));
    await r.append(core(S), event('lease.denied', T0 + 1, undefined, { holder: 'session:BBBB' }));
    const rows = (await r.table('leases')).rows.filter((l) => l.kind === 'port' && l.key === '4317');
    // A projection keyed by the resource alone writes the refused requester over the holder.
    expect(rows.map((l) => [l.holder, l.state])).toEqual([['session:AAAA', 'held']]);
  });
});

describe('migrations only move forward', () => {
  it('a migration that does not move forward is refused at open, not spun on at append', async () => {
    await expect(openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), migrations: [{ kind: 'tool.after', from: 1, to: 1, up: (d) => d }] }))
      .rejects.toMatchObject({ code: 'schema' });
    await expect(openRecord({ path: 'record.db', now: () => T0, storage: testStorage(), migrations: [{ kind: 'tool.after', from: 1, to: 2, up: (d) => d }, { kind: 'tool.after', from: 2, to: 1, up: (d) => d }] }))
      .rejects.toMatchObject({ code: 'schema' });
  });
});

describe('a PostToolUse stamped after its turn\'s stop is recorded in that turn', () => {
  it('with no turn open, a tool event after the newest stop joins that stopped turn and reopens nothing', async () => {
    const { record: r, S } = await record();
    const ask = event('user.ask', T0, seqAt(T0), { msg: 1 });
    const stop = { ...event('agent.stop', T0 + 100, seqAt(T0 + 100), { turn: 1 }), subject: `session:${S}` };
    const late = event('tool.after', T0 + 150, seqAt(T0 + 150));
    for (const e of [ask, stop, late]) await r.append(hook(S), e);
    const view = await r.session(S);
    // A projection that assigns a tool event only to a turn whose span holds it drops this one.
    expect(view?.turns.map((t) => ({ stopped: t.stopped, events: t.events }))).toEqual([{ stopped: true, events: [ask.id, stop.id, late.id] }]);
  });
});

describe('the evidence store\'s events come only from the core', () => {
  it('evidence.stored and evidence.removed from a hook, the app or an extension are refused as writer', async () => {
    const { record: r, S } = await record();
    for (const kind of ['evidence.stored', 'evidence.removed']) {
      for (const writer of ['hook', 'app', 'ext:done-gate']) {
        // A record that checks only the eight decision kinds lets an agent fabricate or hide evidence rows.
        await expect(r.append({ ...hook(S), writer }, event(kind, T0 + 10, undefined)), `${kind} from ${writer}`).rejects.toMatchObject({ code: 'writer', kind });
      }
      await expect(r.append(core(S), event(kind, T0 + 20, undefined))).resolves.toMatchObject({ existing: false });
    }
  });
});

describe('a session that lost an event is remembered across a clean stop', () => {
  it('a failed append, a close, a reopen, then the session\'s claim: INVALID, cause events lost', async () => {
    const storage = testStorage();
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0, hooks: { afterExistsCheck: () => { throw Error('disk full'); } } });
    let r = await openRecord({ path: 'record.db', now: () => T0, storage, evidence: store });
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    await expect(r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: `cat <<'EOF'\n${'x\n'.repeat(5000)}EOF\n` }))).rejects.toMatchObject({ code: 'storage' });
    await r.close();
    r = await openRecord({ path: 'record.db', now: () => T0 + 100, storage, evidence: store });
    open.push(r);
    const claim = event('claim.made', T0 + 200, undefined);
    await r.append({ ...hook(S), writer: 'app' }, claim);
    const verdict = (await r.table('verdicts')).rows.find((v) => v.claim_id === claim.id);
    // A record that keeps the loss only in memory forgets it at the clean stop and leaves this claim open.
    expect(verdict?.outcome, 'the claim after a lost event is INVALID').toBe('INVALID');
    expect(String(verdict?.reasons)).toContain('events lost');
  });
});

describe('a record from a newer version is refused untouched', () => {
  it('an open that refuses schema 2 leaves the database schema exactly as it found it', async () => {
    const path = join(tempRoot(), 'record.db');
    await (await openRecord({ path, now: () => T0 })).close();
    const db = new Database(path);
    db.prepare("UPDATE meta SET value = '2' WHERE key = 'schema'").run();
    db.prepare('DROP TABLE claims').run();
    const schema = () => db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY type, name').all();
    const before = schema();
    await expect(openRecord({ path, now: () => T0 })).rejects.toMatchObject({ code: 'storage' });
    // A record that runs its DDL before reading the version recreates `claims` in a database it can't read.
    expect(schema()).toEqual(before);
    db.close();
  });
});

describe('a claim lost with its events and replayed after the cut reads INVALID', () => {
  it('a session active at the last FULL commit whose tail was cut: its replayed claim gets the verdict', async () => {
    const storage = testStorage();
    let r = await openRecord({ path: 'record.db', now: () => T0, storage });
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    // A verdict on an earlier claim is the last FULL commit; everything after it is a NORMAL tail.
    const earlier = event('claim.made', T0, undefined);
    await r.append({ ...hook(S), writer: 'app' }, earlier);
    await r.append(core(S), event('verdict.made', T0 + 1, undefined, { claim: `claim:${earlier.id}`, verdict: `verdict:${ulidAt(T0 + 1)}` }, 1));
    await r.append(hook(S), event('tool.after', T0 + 10, seqAt(T0 + 10)));
    const claim = event('claim.made', T0 + 20, undefined);
    await r.append({ ...hook(S), writer: 'app' }, claim);
    storage.cutPower();
    r = await openRecord({ path: 'record.db', now: () => T0 + 100, storage });
    open.push(r);
    expect(await r.read({ after: 0 }), 'the tail was lost').toHaveLength(3);
    // The hook replays the claim from its spool.
    await r.append({ ...hook(S), writer: 'app' }, claim);
    const verdict = (await r.table('verdicts')).rows.find((v) => v.claim_id === claim.id);
    // A recovery that judges only the claims that survived leaves this replayed one open.
    expect(verdict?.outcome, 'its events were lost: INVALID').toBe('INVALID');
    expect(String(verdict?.reasons)).toContain('events lost');
  });
});

describe('a retry of a committed long-text event needs no evidence store', () => {
  it('the same event again, with the store gone, is the existing event', async () => {
    const storage = testStorage();
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    let r = await openRecord({ path: 'record.db', now: () => T0, storage, evidence: store });
    const S = ulidAt(T0 - 1000);
    await r.append(hook(S), event('session.start', T0 - 1000, undefined));
    const long = event('tool.after', T0 + 10, seqAt(T0 + 10), { kind: 'shell', paths: [], command: `cat <<'EOF'\n${'x\n'.repeat(5000)}EOF\n` });
    const first = await r.append(hook(S), long);
    await r.close();
    r = await openRecord({ path: 'record.db', now: () => T0 + 100, storage });
    open.push(r);
    // A record that writes the evidence before looking for the event refuses a retry the log already holds.
    await expect(r.append(hook(S), long)).resolves.toEqual({ log_pos: first.log_pos, existing: true });
    const claim = event('claim.made', T0 + 200, undefined);
    await r.append({ ...hook(S), writer: 'app' }, claim);
    expect((await r.table('claims')).rows.find((c) => c.id === claim.id)?.verdict_id, 'nothing was lost').toBeNull();
  });
});

describe('a pre-start stamp sorts after every event of its turn that arrived before it', () => {
  it('after a high stamp, then a lower one in range, a pre-start event still comes last', async () => {
    const { record: r, S } = await record();
    const ask = event('user.ask', T0, seqAt(T0), { msg: 1 });
    const high = event('tool.after', T0 + 3000, seqAt(T0 + 3000));
    const low = event('tool.after', T0 + 1000, seqAt(T0 + 1000));
    const early = event('tool.after', T0 + 4000, seqAt(T0 - 5000));
    for (const e of [ask, high, low, early]) await r.append(hook(S), e);
    const view = await r.session(S);
    // A record anchored on the last event's key puts the pre-start event before `high`.
    expect(view?.turns[0]?.events).toEqual([ask.id, low.id, high.id, early.id]);
  });
});
