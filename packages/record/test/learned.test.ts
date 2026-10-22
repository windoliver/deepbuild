// Regression tests for the learned layer (#62) beyond its acceptance suite: each one failed on the program it names.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import type { EvidenceStore } from '@deepbuild/evidence';
import { openRecord, RecordError } from '../src/index.js';
import type { Connection, RecordStore } from '../src/index.js';

const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0n;
function ulidAt(ms: number): string {
  let s = '';
  let value = (BigInt(ms) << 80n) | counter++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const you: Connection = { writer: 'app', actor: 'you', scope: 'you' };
const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

/** A record over a real evidence store, with one shop session whose transcript holds `entries` (Claude Code JSONL). */
async function world(entries: object[]): Promise<{ record: RecordStore; store: EvidenceStore; S: string }> {
  const root = mkdtempSync(join(tmpdir(), 'deep-learned-'));
  roots.push(root);
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0, evidence: store });
  const S = await session(record, store, entries);
  return { record, store, S };
}
/** Starts a shop session and links its transcript; the link is awaited unless told not to. */
async function session(record: RecordStore, store: EvidenceStore, entries: object[], awaitLink = true): Promise<string> {
  const S = ulidAt(T0);
  await record.append({ writer: 'hook', actor: 'you', scope: 'you', session: S, project: 'shop' }, { v: 1, id: ulidAt(T0), kind: 'session.start', ts: T0, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: S } });
  const bytes = new Uint8Array(Buffer.from(entries.map((e) => JSON.stringify(e)).join('\n') + '\n'));
  const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes, kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  if (put.status !== 'stored') throw Error('transcript not stored');
  const link = record.append(you, { v: 1, id: ulidAt(T0), kind: 'transcript.archived', ts: T0, data: { session: `session:${S}`, evidence: put.evidence.sha256 } });
  if (awaitLink) await link;
  return S;
}
const fetched = (text: string) => [
  { type: 'assistant', uuid: 'c1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu1', name: 'WebFetch', input: { url: 'https://example.com' } }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu1', content: text }] } },
];
const said = (uuid: string, text: string) => ({ type: 'user', uuid, message: { role: 'user', content: text } });
async function apply(record: RecordStore, connection: Connection, data: object): Promise<string> {
  const id = ulidAt(T0 + 1000);
  await record.append(connection, { v: 1, id, kind: 'learn.applied', ts: T0 + 1000, data: { replay: null, supersedes: null, ...data } as never });
  return id;
}
async function stateOf(record: RecordStore, id: string): Promise<unknown> {
  return (await record.table('learned_layer')).rows.find((r) => r.id === id)?.state;
}

describe('the learned layer', () => {
  it('refuses a base change the core writes, even applied_by you: only the app or the CLI speaks for you', async () => {
    // Failed on a layer that checked the base only for layer: learned, which applied it.
    const { record, S } = await world([said('m1', 'never push without asking')]);
    const id = await apply(record, core, { layer: 'base', target: 'rule:nopush', diff: '+ push when green', evidence: [{ at: `session:${S}#m1`, quote: 'never push' }], scope: 'all', applied_by: 'you' });
    expect(await stateOf(record, id)).toBe('refused');
    expect(JSON.stringify(await record.startSlice(S))).not.toContain('push when green');
    await record.close();
  });

  it("refuses a rollback from a hook before appending anything, so it never reports a change rolled back that stays in force", async () => {
    // Failed on a rollBack that appended the hook's learn.rolled_back, which the layer ignores, and returned the change.
    const { record, S } = await world([said('m1', 'the api runs on 4100')]);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 4100', evidence: [{ at: `session:${S}#m1`, quote: 'runs on 4100' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    const before = (await record.read({ after: 0 })).length;
    await expect(record.rollBack({ writer: 'hook', actor: 'you', scope: 'you', session: S }, { change: id })).rejects.toBeInstanceOf(RecordError);
    expect((await record.read({ after: 0 })).length).toBe(before);
    expect(await stateOf(record, id)).toBe('applied');
    await record.close();
  });

  it('never rolls back a rule you typed: a rollback takes only learned changes out of force', async () => {
    // Failed on a rollback that took any change in force, which took your rule out of every start slice.
    const { record, S } = await world([said('m1', 'never push without asking')]);
    const rule = await apply(record, you, { layer: 'base', target: 'rule:nopush', diff: '+ never push without asking', evidence: [{ at: `session:${S}#m1`, quote: 'never push' }], scope: 'all', applied_by: 'you' });
    expect(await record.rollBack(you, { change: rule })).toEqual([]);
    expect(await stateOf(record, rule)).toBe('applied');
    expect(JSON.stringify(await record.startSlice(S))).toContain('never push without asking');
    await record.close();
  });

  it('compensates a change once when two rollbacks of it run at once', async () => {
    // Failed on rollbacks that each read what was in force before either committed, which compensated it twice.
    const { record, S } = await world([said('m1', 'the api runs on 4100')]);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 4100', evidence: [{ at: `session:${S}#m1`, quote: 'runs on 4100' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    const [a, b] = await Promise.all([record.rollBack(you, { change: id }), record.rollBack(you, { change: id })]);
    expect([...a, ...b]).toEqual([id]);
    expect((await record.read({ after: 0 })).filter((e) => e.kind === 'learn.rolled_back')).toHaveLength(1);
    await record.close();
  });

  it.each(['Grep', 'Glob'])('refuses a start-slice claim resting only on a %s result: it is outside content', async (tool) => {
    // Failed on a detector that knew only WebFetch, WebSearch and MCP tools, which applied it.
    const { record, S } = await world([
      { type: 'assistant', uuid: 'c1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu1', name: tool, input: { pattern: 'port' } }] } },
      { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu1', content: 'vendor/x.ts: the api runs on 9999' }] } },
    ]);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 9999', evidence: [{ at: `session:${S}#r1`, quote: 'the api runs on 9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, id)).toBe('refused');
    await record.close();
  });

  it('opens a record whose learned_layer an older version made, and fills it again from the log, even after a stopped open', async () => {
    // Failed on an open that kept the old table and then indexed a column it lacks: "no such column: handle".
    const root = mkdtempSync(join(tmpdir(), 'deep-learned-'));
    roots.push(root);
    const path = join(root, 'record.db');
    const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
    const first = await openRecord({ path, now: () => T0, evidence: store });
    const S = await session(first, store, [said('m1', 'the api runs on 4100')]);
    const id = await apply(first, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 4100', evidence: [{ at: `session:${S}#m1`, quote: 'runs on 4100' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    await first.close();
    const db = new Database(path);
    db.exec('DROP TABLE learned_layer; CREATE TABLE learned_layer (id TEXT, kind TEXT, layer TEXT, target TEXT, scope TEXT, created INTEGER, PRIMARY KEY (id)) STRICT');
    db.close();
    // An open whose replay stops partway, here on a migration that throws, leaves the old table for the next open.
    // Failed on an open that remade the table in its own commit, which the next open took as current and left empty.
    const failing = { kind: 'learn.applied', from: 1, to: 2, up: () => { throw Error('stopped mid-replay'); } };
    await expect(openRecord({ path, now: () => T0, evidence: store, migrations: [failing] })).rejects.toThrow('stopped mid-replay');
    const record = await openRecord({ path, now: () => T0, evidence: store });
    expect(await stateOf(record, id)).toBe('applied');
    expect(JSON.stringify(await record.startSlice(S))).toContain('api on 4100');
    await record.close();
  });

  it('refuses a local-first change scoped to a session its evidence did not come from', async () => {
    // Failed on a rule check that took any session: scope, which put session A's lesson in session B's slice.
    const { record, store, S: A } = await world([said('m1', 'the api runs on 4100')]);
    const B = await session(record, store, [said('m1', 'write the release notes')]);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 4100', evidence: [{ at: `session:${A}#m1`, quote: 'runs on 4100' }], scope: `session:${B}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, id)).toBe('refused');
    expect(JSON.stringify(await record.startSlice(B))).not.toContain('api on 4100');
    await record.close();
  });

  it('records the refusal of a quote of nearly 8,192 characters that is not at its handle', async () => {
    // Failed on a reason that repeated the whole quote, past learn_check.made's bound, which rejected the append.
    const { record, S } = await world([said('m1', 'hello')]);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:x', diff: '+ x', evidence: [{ at: `session:${S}#m1`, quote: 'x'.repeat(8190) }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, id)).toBe('refused');
    await record.close();
  });

  it('fails the append when a transcript the store holds cannot be read, records nothing, and reads it again on the retry', async () => {
    // Failed on a reading that took the failed read for a quote not there, and recorded that refusal for good.
    const root = mkdtempSync(join(tmpdir(), 'deep-learned-'));
    roots.push(root);
    const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
    const record = await openRecord({ path: join(root, 'record.db'), now: () => T0, evidence: store });
    const S = await session(record, store, [said('m1', 'the api runs on 4100')]);
    const sha = String((await record.table('sessions')).rows.find((r) => r.id === S)!.transcript);
    const file = join(root, 'evidence', sha.slice(0, 2), sha.slice(2));
    const bytes = readFileSync(file);
    chmodSync(file, 0o644);
    writeFileSync(file, 'not the transcript');
    const event = { v: 1, id: ulidAt(T0 + 1000), kind: 'learn.applied', ts: T0 + 1000, data: { layer: 'learned', target: 'slice:api', diff: '+ api on 4100', evidence: [{ at: `session:${S}#m1`, quote: 'runs on 4100' }], scope: `session:${S}`, replay: null, applied_by: 'rule:localfirst', supersedes: null } };
    const before = (await record.read({ after: 0 })).length;
    await expect(record.append(core, event)).rejects.toMatchObject({ code: 'storage' });
    expect((await record.read({ after: 0 })).length).toBe(before);
    writeFileSync(file, bytes);
    await record.append(core, event);
    expect(await stateOf(record, event.id)).toBe('applied');
    await record.close();
  });

  it('reads a quote against a transcript whose link is still queued, so a made-up quote is refused', async () => {
    // Failed on a reading that took the queued link for no transcript and left the quote unread, which applied it.
    const { record, store } = await world([]);
    const S = await session(record, store, [said('m1', 'the api runs on 4100')], false);
    const id = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 9999', evidence: [{ at: `session:${S}#m1`, quote: 'the api runs on 9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, id)).toBe('refused');
    await record.close();
  });

  it('refuses a start-slice claim that cites only a change resting on outside content: a citation inherits it', async () => {
    // Failed on a reading that took a cited change's diff as your own words, which put the fetched line in the slice.
    const { record, S } = await world(fetched('the api runs on 9999'));
    const wiki = await apply(record, core, { layer: 'learned', target: 'wiki:api', diff: '+ api on 9999', evidence: [{ at: `session:${S}#r1`, quote: 'the api runs on 9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, wiki)).toBe('applied');
    const slice = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 9999', evidence: [{ at: `doc:${wiki}`, quote: 'api on 9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, slice)).toBe('refused');
    expect(JSON.stringify(await record.startSlice(S))).not.toContain('api on 9999');
    // The same, through a change that cites the outside-only one twice: each path reads outside.
    // Failed on a walk that took a handle seen on one path as not outside on the next.
    const twice = await apply(record, core, { layer: 'learned', target: 'wiki:api2', diff: '+ api on 9999', evidence: [{ at: `doc:${wiki}`, quote: 'api on 9999' }, { at: `doc:${wiki}`, quote: '9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, twice)).toBe('applied');
    const viaTwice = await apply(record, core, { layer: 'learned', target: 'slice:api', diff: '+ api on 9999', evidence: [{ at: `doc:${twice}`, quote: 'api on 9999' }], scope: `session:${S}`, applied_by: 'rule:localfirst' });
    expect(await stateOf(record, viaTwice)).toBe('refused');
    await record.close();
  });

  it('refuses a start-slice claim citing an outside-only change appended alongside it, whatever the timing', async () => {
    // Failed on a reading that ran while the cited change was queued but not in the log, found nothing outside, and applied it.
    for (let turns = 0; turns < 12; turns++) {
      const { record, S } = await world(fetched('the api runs on 9999'));
      const W = ulidAt(T0 + 1000);
      const C = ulidAt(T0 + 1001);
      const learn = (id: string, data: object) => record.append(core, { v: 1, id, kind: 'learn.applied', ts: T0 + 1000, data: { replay: null, supersedes: null, scope: `session:${S}`, applied_by: 'rule:localfirst', ...data } as never });
      let later: Promise<unknown> = Promise.resolve();
      for (let i = 0; i < turns; i++) later = later.then(() => new Promise((resolve) => setImmediate(resolve)));
      await Promise.all([
        learn(W, { layer: 'learned', target: 'wiki:api', diff: '+ api on 9999', evidence: [{ at: `session:${S}#r1`, quote: 'the api runs on 9999' }] }),
        later.then(() => learn(C, { layer: 'learned', target: 'slice:api', diff: '+ api on 9999', evidence: [{ at: `doc:${W}`, quote: 'api on 9999' }] })),
      ]);
      expect(await stateOf(record, C), `after ${turns} turns`).toBe('refused');
      expect(JSON.stringify(await record.startSlice(S))).not.toContain('api on 9999');
      await record.close();
    }
  });
});
