// #14: every projection rebuilds from the catalogue's events (AC6), forward-only migrations (AC22), the
// evidence projection from the store's events (AC28), content-free mode (AC7) and no outbound request (AC8).
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogue, fixtures, getSchema } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Evidence } from '../../../packages/evidence/src/index.ts';
import { openRecord, PROJECTIONS, testStorage } from '../../../packages/record/src/index.ts';
import type { EventInput, Migration, RecordStore, Table } from '../../../packages/record/src/index.ts';
import {
  agentStop, allEvents, app, canon, claimMade, clone, core, DAY, evidenceRemoved, evidenceStored, filesContaining, firstTableDifference,
  fixtureWriter, fromFixture, hook, isObject, kindSchema, makeClock, removeRoots, SECOND, seqAt, sessionStart, sha256, snapshot, T0,
  tempRoot, toolAfter, ulidAt, userAsk, utf8, verdictMade,
} from './helpers.ts';
import type { JsonObject } from './helpers.ts';

afterEach(removeRoots);

const ISSUE_PROJECTIONS = [
  'sessions', 'commits', 'claims', 'checks', 'runs', 'verdicts', 'asks', 'decisions', 'leases', 'definitions', 'attempts',
  'tasks', 'open_items', 'notices', 'readings', 'plans', 'dry_merges', 'session_files', 'evidence',
];
/** The kinds that create a row in the projection they feed (a sent-back of an unknown claim may create none). */
const CREATES: Record<string, string> = {
  'session.start': 'sessions', 'claim.made': 'claims', 'task.created': 'tasks', 'definition.locked': 'definitions',
  'run.started': 'runs', 'verdict.made': 'verdicts', 'ask.created': 'asks', 'decision.created': 'decisions',
  'lease.acquired': 'leases', 'open_item.opened': 'open_items', 'notice.subscribed': 'notices', 'reading.recorded': 'readings',
  'plan.proposed': 'plans', 'merge.dry_run': 'dry_merges', 'tool.after': 'session_files', 'evidence.stored': 'evidence',
};

describe('AC6 every projection rebuilds from the catalogue\'s events', () => {
  it('AC6 the record lists the issue\'s projections, each is a table, and after every catalogued kind\'s fixtures each equals its rebuild', async () => {
    for (const name of ISSUE_PROJECTIONS) expect(PROJECTIONS, `${name} is a projection`).toContain(name);
    const clock = makeClock();
    const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage() });
    const S = ulidAt(T0 - SECOND);
    let n = 0;
    for (const entry of catalogue()) {
      const all = fixtures(entry.schema);
      for (const [i, f] of all.entries()) {
        if (!isObject(f)) continue;
        const at = clock.tick(10);
        const input = fromFixture(entry.kind, at, {}, i);
        const writer = fixtureWriter(entry.kind, i);
        const connection = writer === 'hook' ? hook(S) : { writer, actor: 'you', scope: 'you', session: S };
        await record.append(connection, input);
        n++;
      }
    }
    // The two kinds the issue adds for the evidence store.
    const ev: Evidence = { sha256: sha256('a log'), size: 5, type: 'text', kind: 'log', source: 'run:1', origin: 'deepbuild', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['export', 'report', 'post'] }, derivedFrom: [], intake: 'captured' };
    await record.append(core(), evidenceStored(clock.tick(10), ev));
    await record.append(core(), evidenceRemoved(clock.tick(10), sha256('gone')));
    expect(await allEvents(record).then((e) => e.length)).toBe(n + 2);

    const live = await snapshot(record, PROJECTIONS);
    for (const [kind, table] of Object.entries(CREATES)) {
      const feeds = kind.startsWith('evidence.') ? ['evidence'] : catalogue().find((e) => e.kind === kind)?.feeds ?? [];
      expect(feeds, `${kind} feeds ${table} in the catalogue`).toContain(table);
      expect(live.get(table)!.rows.length, `${table} has a row after ${kind}`).toBeGreaterThan(0);
    }
    for (const name of PROJECTIONS) {
      const table = live.get(name)!;
      expect(table.name).toBe(name);
      expect(table.primaryKey.length, `${name} names its primary key`).toBeGreaterThan(0);
      const keys = table.rows.map((r) => table.primaryKey.map((k) => canon(r[k])).join('|'));
      expect([...keys].sort(), `${name}: rows come in primary-key order`).toEqual(keys);
    }
    clock.tick(DAY);
    await record.rebuild();
    const rebuilt = await snapshot(record, PROJECTIONS);
    // A projection not rebuilt from the log is empty or differs here.
    expect(firstTableDifference(live, rebuilt)).toBeUndefined();
  }, 120_000);
});

describe('AC22 forward-only migrations', () => {
  /** A planted tool.after@2: v1 with a required `cwd` in every data shape. */
  function plantedV2(): { entry: SchemaEntry; migration: Migration } {
    const v1 = getSchema(kindSchema('tool.after'));
    const schema = clone(v1) as Schema & { properties: JsonObject };
    schema.title = 'tool.after@2';
    (schema.properties.v as JsonObject).const = 2;
    const data = schema.properties.data as JsonObject;
    for (const branch of data.oneOf as JsonObject[]) {
      (branch.properties as JsonObject).cwd = { type: 'string', minLength: 1, maxLength: 8192 };
      (branch.required as string[]).push('cwd');
    }
    return {
      entry: { name: 'tool.after@2', schema },
      migration: { kind: 'tool.after', from: 1, to: 2, up: (d: JsonValue) => ({ ...(d as JsonObject), cwd: '~/src/app' }) },
    };
  }
  async function projectionsOf(events: EventInput[], S: string): Promise<Map<string, Table>> {
    const { entry, migration } = plantedV2();
    const record = await openRecord({ path: 'record.db', now: makeClock().now, storage: testStorage(), schemas: [entry], migrations: [migration] });
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await record.append(hook(S), userAsk(T0, 1, 'go'));
    for (const e of events) await record.append(hook(S), e);
    const live = await snapshot(record, PROJECTIONS);
    await record.rebuild();
    const rebuilt = await snapshot(record, PROJECTIONS);
    expect(firstTableDifference(live, rebuilt), 'the log rebuilds to its live projections').toBeUndefined();
    return rebuilt;
  }

  it('AC22 100 tool.after at v1 and 100 at v2 rebuild the same projections as the log with the v1 events migrated first', async () => {
    const S = ulidAt(T0 - SECOND);
    const mixed: EventInput[] = [];
    for (let i = 0; i < 200; i++) {
      const at = T0 + SECOND + i;
      const e = toolAfter(at, 'edit', [`src/file-${i}.ts`], null, seqAt(at));
      if (i % 2 === 1) { e.v = 2; e.data = { ...(e.data as JsonObject), cwd: '~/src/app' }; }
      mixed.push(e);
    }
    const migrated = mixed.map((e) => (e.v === 1 ? { ...e, v: 2, data: { ...(e.data as JsonObject), cwd: '~/src/app' } } : clone(e)));
    const a = await projectionsOf(mixed, S);
    const b = await projectionsOf(migrated, S);
    const files = a.get('session_files')!;
    // A replay that skips v1 events lacks their 100 rows here.
    expect(files.rows.length, `session_files has a row per event; ${200 - files.rows.length} of 200 are missing`).toBe(200);
    // A replay that validates v1 events against v2 fails the rebuild inside projectionsOf, at the first v1 event.
    expect(firstTableDifference(a, b), 'the mixed log and the migrated log give the same projections').toBeUndefined();
  }, 60_000);
});

describe('AC28 the evidence store\'s puts and removals are events', () => {
  it('AC28 20 puts, a put again and 5 removals append 21 evidence.stored and 5 evidence.removed; the evidence projection rebuilds to the same 15 rows', async () => {
    const clock = makeClock();
    const store = await openEvidenceStore({ root: tempRoot('deep-evidence-14-'), now: clock.now });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage(), evidence: store });
    const stored: Evidence[] = [];
    const anyUse = { name: 'CC0-1.0', allows: ['export', 'report', 'post'] as const };
    for (let i = 0; i < 20; i++) {
      const r = await writer.put({ bytes: utf8(`log ${i}\n`), kind: 'log', source: `run:${i}`, redaction: 'complete', license: anyUse });
      expect(r.status).toBe('stored');
      if (r.status !== 'stored') return;
      stored.push(r.evidence);
      await record.append(core(), evidenceStored(clock.tick(10), r.evidence));
    }
    const again = await writer.put({ bytes: utf8('log 0\n'), kind: 'log', source: 'run:0b', redaction: 'complete', license: anyUse });
    expect(again.status).toBe('stored');
    if (again.status !== 'stored') return;
    expect(again.evidence.sha256).toBe(stored[0]!.sha256);
    await record.append(core(), evidenceStored(clock.tick(10), again.evidence));

    clock.tick(31 * DAY);
    const cited = new Set(stored.slice(0, 15).map((e) => e.sha256));
    const { removed } = await store.retain({ cited, archived: new Set() });
    expect(removed.sort()).toEqual(stored.slice(15).map((e) => e.sha256).sort());
    for (const hash of removed) await record.append(core(), evidenceRemoved(clock.tick(10), hash));

    const events = await allEvents(record);
    expect(events.filter((e) => e.kind === 'evidence.stored')).toHaveLength(21);
    expect(events.filter((e) => e.kind === 'evidence.removed')).toHaveLength(5);
    const check = (table: Table, when: string) => {
      expect(table.rows.length, `${when}: 15 rows; the first hash missing would be ${[...cited].sort()[0]}`).toBe(15);
      for (const ev of stored.slice(0, 15)) {
        const row = table.rows.find((r) => r.hash === ev.sha256);
        expect(row, `${when}: a row for ${ev.sha256}`).toBeDefined();
        expect(row!.type, `${when}: the type it was stored with`).toBe(ev.type);
        expect(Number(row!.size), `${when}: the size it was stored with`).toBe(ev.size);
        expect(row!.origin, `${when}: the origin it was stored with`).toBe(ev.origin);
        expect(row!.redaction, `${when}: the redaction it was stored with`).toBe(ev.redaction);
      }
      for (const hash of removed) expect(table.rows.find((r) => r.hash === hash), `${when}: ${hash} was removed`).toBeUndefined();
    };
    const live = await record.table('evidence');
    check(live, 'live');
    await record.rebuild();
    // A store that keeps its records only in its own journal leaves the rebuilt projection empty.
    const rebuilt = await record.table('evidence');
    check(rebuilt, 'after dropping the projection and replaying the log');
    expect(rebuilt.rows.map(canon)).toEqual(live.rows.map(canon));
  });
});

describe('AC7 content-free mode', () => {
  it('AC7 the record keeps counts, durations, error signatures and verdicts, and no prompt, message or tool text, in its events or its files', async () => {
    const root = tempRoot();
    const clock = makeClock();
    const path = `${root}/record.db`;
    const PROMPT = 'please refactor the billing module QX7';
    const MESSAGE = 'also rename the invoice table QX8';
    const COMMAND = 'grep -rn billing_total src/ QX9';
    const S = ulidAt(T0 - SECOND);
    const record = await openRecord({ path, now: clock.now, contentFree: true });
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await record.append(hook(S), userAsk(T0, 1, PROMPT));
    await record.append(hook(S), toolAfter(T0 + SECOND, 'shell', [], COMMAND));
    await record.append(hook(S), userAsk(T0 + 2 * SECOND, 2, MESSAGE));
    await record.append(hook(S), toolAfter(T0 + 3 * SECOND, 'edit', ['src/billing.ts'], null));
    await record.append(hook(S), agentStop(T0 + 4 * SECOND, S, 1));
    const claim = claimMade(T0 + 4 * SECOND + 1, 'task:01K74FX2B4D6F8H0K2M4P6R8T7', 1);
    await record.append(app(S), claim);
    await record.append(core(), verdictMade(T0 + 5 * SECOND, claim.id, 'FAIL', ['TypeError: billing_total is not a function']));
    const check = async (r: RecordStore, when: string) => {
      const events = await allEvents(r);
      expect(events.length, `${when}: the counts are kept`).toBe(8);
      expect(events.map((e) => e.ts), `${when}: the durations are kept`).toEqual([T0 - SECOND, T0, T0 + SECOND, T0 + 2 * SECOND, T0 + 3 * SECOND, T0 + 4 * SECOND, T0 + 4 * SECOND + 1, T0 + 5 * SECOND]);
      const text = events.map((e) => JSON.stringify(e.data)).join('\n');
      // A store that keeps text has the prompt, the message or the command here.
      for (const secret of [PROMPT, MESSAGE, COMMAND, 'QX7', 'QX8', 'QX9']) expect(text, `${when}: no text: ${secret}`).not.toContain(secret);
      const verdicts = await r.table('verdicts');
      expect(verdicts.rows.length, `${when}: the verdict is kept`).toBe(1);
      expect(verdicts.rows[0]!.outcome).toBe('FAIL');
      expect((await r.table('claims')).rows.length, `${when}: the claim is kept`).toBe(1);
    };
    await check(record, 'live');
    await record.close();
    for (const secret of [PROMPT, MESSAGE, COMMAND, 'QX7', 'QX8', 'QX9']) expect(filesContaining(root, secret), `no file under the record holds: ${secret}`).toEqual([]);
    const reopened = await openRecord({ path, now: clock.now, contentFree: true });
    await check(reopened, 'after a restart');
    await reopened.rebuild();
    await check(reopened, 'after a rebuild');
    await reopened.close();
  });
});

describe('AC8 record data leaves the machine only through an extension turned on to send it', () => {
  it('AC8 with none on, a run (open, append, read, rebuild, close) makes no outbound request', async () => {
    const attempts: string[] = [];
    const saved = {
      connect: net.Socket.prototype.connect, http: http.request, https: https.request, httpGet: http.get, httpsGet: https.get,
      fetch: globalThis.fetch, dgram: dgram.createSocket,
    };
    const note = (what: string) => { attempts.push(what); throw new Error(`outbound attempt: ${what}`); };
    net.Socket.prototype.connect = function (...args: unknown[]) { return note(`net.connect ${JSON.stringify(args[0])}`); } as typeof net.Socket.prototype.connect;
    http.request = ((...args: unknown[]) => note(`http.request ${JSON.stringify(args[0])}`)) as typeof http.request;
    https.request = ((...args: unknown[]) => note(`https.request ${JSON.stringify(args[0])}`)) as typeof https.request;
    http.get = ((...args: unknown[]) => note(`http.get ${JSON.stringify(args[0])}`)) as typeof http.get;
    https.get = ((...args: unknown[]) => note(`https.get ${JSON.stringify(args[0])}`)) as typeof https.get;
    globalThis.fetch = ((...args: unknown[]) => note(`fetch ${JSON.stringify(args[0])}`)) as typeof fetch;
    dgram.createSocket = ((...args: unknown[]) => note(`dgram ${JSON.stringify(args[0])}`)) as typeof dgram.createSocket;
    try {
      const root = tempRoot();
      const clock = makeClock();
      const record = await openRecord({ path: `${root}/record.db`, now: clock.now });
      const S = ulidAt(T0 - SECOND);
      await record.append(hook(S), sessionStart(T0 - SECOND, S));
      await record.append(hook(S), userAsk(T0, 1, 'go'));
      for (let i = 0; i < 50; i++) await record.append(hook(S), toolAfter(clock.tick(100), 'read', [`src/${i}.ts`], null));
      await record.append(hook(S), agentStop(clock.tick(100), S, 1));
      const claim = claimMade(clock.tick(1), 'task:01K74FX2B4D6F8H0K2M4P6R8T8', 1);
      await record.append(app(S), claim);
      await record.append(core(), verdictMade(clock.tick(1), claim.id, 'PASS', ['every requirement passed']));
      await allEvents(record);
      await snapshot(record, PROJECTIONS);
      await record.rebuild();
      await record.close();
    } finally {
      net.Socket.prototype.connect = saved.connect;
      http.request = saved.http; https.request = saved.https; http.get = saved.httpGet; https.get = saved.httpsGet;
      globalThis.fetch = saved.fetch; dgram.createSocket = saved.dgram;
    }
    // A store that posts anywhere is seen here.
    expect(attempts, 'no outbound request carrying record data').toEqual([]);
  });
});
