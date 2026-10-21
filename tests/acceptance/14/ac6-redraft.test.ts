// AC6 (issue #14): "Every projection rebuilds from the catalogue's events".
// Blind redraft: written from the issue, docs/technical-design.md, the base commit and this suite's README and
// helpers, never from an implementation. See AC6-REDRAFT.md.

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogue, fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Evidence } from '../../../packages/evidence/src/index.ts';
import { openRecord, PROJECTIONS } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput, RecordStore, Row, Table } from '../../../packages/record/src/index.ts';
import {
  allEvents, canon, DAY, evidenceRemoved, evidenceStored, firstTableDifference, isObject, keyOf, makeClock,
  removeRoots, rowsBy, SECOND, seqAt, snapshot, T0, tempRoot, ulidAt, utf8, type JsonObject,
} from './helpers.ts';

afterEach(removeRoots);

/** The issue's projections (Scope, both lists), by the table names the README gives them. */
const ISSUE_PROJECTIONS = [
  'sessions', 'commits', 'claims', 'checks', 'runs', 'verdicts', 'asks', 'decisions', 'leases', 'definitions', 'attempts',
  'tasks', 'open_items', 'notices', 'readings', 'plans', 'dry_merges', 'session_files', 'evidence',
] as const;

/** The session every published hook fixture names in its subject. */
const FIXTURE_SESSION = '01K74G1Z3X5V7T9R1P3N5M7K9H';

/** One published fixture of one catalogued schema, as appended. */
interface Appended { schema: string; kind: string; index: number; id: string; log_pos: number }

/**
 * The connection a fixture arrives on: its own writer (one its schema allows), actor and scope, as the hub's
 * socket would prove them. A hook's connection carries the fixtures' session and agent.
 */
function connectionFor(fx: JsonObject): Connection {
  const base: Connection = { writer: String(fx.writer), actor: String(fx.actor), scope: String(fx.scope) };
  return fx.writer === 'hook' ? { ...base, session: FIXTURE_SESSION, agent: 'claude-code' } : base;
}

/**
 * The payload: the fixture without what the connection supplies (writer, actor, scope). Every published
 * fixture carries the same ID, so each gets a fresh ULID at `at`, with ts at `at` and, where the fixture has a
 * seq, a seq at `at`. Its v, kind, subject and data are the fixture's.
 */
function payloadFor(fx: JsonObject, at: number): EventInput {
  const input: EventInput = { v: fx.v as number, id: ulidAt(at), kind: String(fx.kind), ts: at, data: fx.data as JsonValue };
  if (typeof fx.subject === 'string') input.subject = fx.subject;
  if (typeof fx.seq === 'string') input.seq = seqAt(at);
  if (Array.isArray(fx.evidence)) input.evidence = fx.evidence.map(String);
  return input;
}

/** SQLite's order for stored values: NULL, then numbers, then text (by its UTF-8 bytes), then blobs. */
function storageClass(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return 1;
  if (typeof v === 'string') return 2;
  return 3;
}
function compareStored(a: unknown, b: unknown): number {
  const ca = storageClass(a), cb = storageClass(b);
  if (ca !== cb) return ca - cb;
  if (ca === 0) return 0;
  if (ca === 1) {
    const x = typeof a === 'boolean' ? Number(a) : a as number | bigint;
    const y = typeof b === 'boolean' ? Number(b) : b as number | bigint;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ca === 2) return Buffer.compare(Buffer.from(a as string, 'utf8'), Buffer.from(b as string, 'utf8'));
  return Buffer.compare(Buffer.from(a as Uint8Array), Buffer.from(b as Uint8Array));
}
function compareKeys(table: Table, x: Row, y: Row): number {
  for (const column of table.primaryKey) {
    const c = compareStored(x[column], y[column]);
    if (c !== 0) return c;
  }
  return 0;
}

/** The first way a table breaks "a table with a primary key, rows in primary-key order", or undefined. */
function tableProblem(name: string, table: Table): string | undefined {
  if (table.name !== name) return `${name}: table() answered with ${table.name}`;
  if (!Array.isArray(table.primaryKey) || table.primaryKey.length === 0) return `${name}: no primary key`;
  if (table.primaryKey.some((c) => typeof c !== 'string' || c === '')) return `${name}: primary key ${canon(table.primaryKey)} is not a list of column names`;
  for (const [i, row] of table.rows.entries()) {
    const missing = table.primaryKey.find((c) => !Object.hasOwn(row, c));
    if (missing) return `${name}: row ${i} has no primary-key column ${missing}`;
    if (i > 0 && compareKeys(table, table.rows[i - 1]!, row) >= 0)
      return `${name}: row ${i} (${keyOf(table, row)}) does not come after row ${i - 1} (${keyOf(table, table.rows[i - 1]!)}) in primary-key order`;
  }
  return undefined;
}

describe("AC6 every projection rebuilds from the catalogue's events", () => {
  it("AC6 the record lists the issue's projections, each is a table, and after every catalogued kind's fixtures each equals its rebuild", async () => {
    // "Projections: sessions, commits, claims, …" and "More projections: tasks, open items, …" (issue, Scope).
    // Wrong program: a record that leaves out one of the issue's projections.
    const listed = [...PROJECTIONS];
    for (const name of ISSUE_PROJECTIONS) expect(listed, `PROJECTIONS lists the issue's projection ${name}`).toContain(name);
    expect(new Set(listed).size, 'PROJECTIONS names each table once').toBe(listed.length);

    const clock = makeClock(T0);
    const root = tempRoot('deep-record-14-ac6-');
    const store = await openEvidenceStore({ root: join(root, 'evidence'), now: clock.now });
    const record: RecordStore = await openRecord({ path: join(root, 'record', 'record.sqlite'), now: clock.now, evidence: store });
    try {
      // ---- Every catalogued schema's published fixtures, through a connection whose writer the schema allows.
      // The catalogue has one entry per event-kind schema, so a kind at two versions (agent.stop@1 and @2) is two
      // entries: fixtures are drawn by schema name, never by kind, so both versions are appended.
      // "Every projection rebuilds from the catalogue's events" (AC6). Wrong program: a record that refuses a
      // published kind or version (such as one that validates agent.stop v1 against v2, or knows only a kind's
      // latest version) rejects that fixture here, named by schema and fixture.
      const entries = catalogue();
      expect(entries.length, 'the base catalogue has event kinds').toBeGreaterThan(0);
      const appended: Appended[] = [];
      for (const entry of entries) {
        const published = fixtures(entry.schema);
        expect(published.length, `${entry.schema} publishes at least one fixture`).toBeGreaterThan(0);
        for (const [index, f] of published.entries()) {
          expect(isObject(f), `${entry.schema} fixture ${index} is an event`).toBe(true);
          const fx = f as JsonObject;
          expect(fx.kind, `${entry.schema} fixture ${index} is of its kind`).toBe(entry.kind);
          expect(fx.v, `${entry.schema} fixture ${index} is at its version`).toBe(entry.version);
          const at = clock.tick(SECOND);
          const payload = payloadFor(fx, at);
          let result;
          try {
            result = await record.append(connectionFor(fx), payload);
          } catch (e) {
            throw new Error(`the record refused ${entry.schema} fixture ${index} from writer ${String(fx.writer)}: ${(e as Error).message}`);
          }
          expect(result.existing, `${entry.schema} fixture ${index} is a new event`).toBe(false);
          appended.push({ schema: entry.schema, kind: entry.kind, index, id: payload.id, log_pos: result.log_pos });
        }
      }

      // ---- The evidence store's two kinds (issue, Scope, "Evidence in the record"; README, "Events the record
      // must accept that the base doesn't publish"): two files stored by the real store, both recorded as stored,
      // one recorded as removed, through a core connection.
      const kept = await store.connect({ role: 'deepbuild', via: 'render' })
        .put({ bytes: utf8('AC6 kept evidence'), kind: 'log', source: 'ac6', redaction: 'complete', license: { name: 'own', allows: ['export'] } });
      const gone = await store.connect({ role: 'you', via: 'paste' })
        .put({ bytes: utf8('AC6 removed evidence'), kind: 'log', source: 'ac6', redaction: 'unknown', license: { name: 'own', allows: [] } });
      expect(kept.status, 'the evidence store stores the kept file').toBe('stored');
      expect(gone.status, 'the evidence store stores the removed file').toBe('stored');
      const keptEvidence = (kept as { evidence: Evidence }).evidence;
      const goneEvidence = (gone as { evidence: Evidence }).evidence;
      const coreConnection: Connection = { writer: 'core', actor: 'you', scope: 'you' };
      for (const payload of [
        evidenceStored(clock.tick(SECOND), keptEvidence),
        evidenceStored(clock.tick(SECOND), goneEvidence),
        evidenceRemoved(clock.tick(SECOND), goneEvidence.sha256),
      ]) {
        let result;
        try {
          result = await record.append(coreConnection, payload);
        } catch (e) {
          throw new Error(`the record refused ${payload.kind} from core: ${(e as Error).message}`);
        }
        appended.push({ schema: `${payload.kind}@1`, kind: payload.kind, index: 0, id: payload.id, log_pos: result.log_pos });
      }

      // Every append is in the log once, in log_pos order. Wrong program: a record that acknowledges an append it
      // doesn't keep.
      const logged = await allEvents(record);
      expect(logged.map((e) => e.id), 'the log holds every appended event, in log_pos order').toEqual(
        [...appended].sort((a, b) => a.log_pos - b.log_pos).map((a) => a.id));

      // ---- Each listed projection is a table with a primary key, rows in primary-key order (README, "table
      // returns a projection as stored, rows in primary-key order"; design: "compared row by row in primary-key
      // order"). Wrong program: a projection with no primary key, or one read back in insertion order.
      const live = await snapshot(record, listed);
      for (const name of listed) {
        const problem = tableProblem(name, live.get(name)!);
        expect(problem, `projection ${name} is a table with a primary key, rows in primary-key order`).toBeUndefined();
      }

      // ---- The kinds that feed a projection create rows in it. The catalogue's x-feeds says which projections
      // each kind feeds; every issue projection some catalogued kind feeds must hold rows after its fixtures.
      // Wrong program: a projection the record lists but never fills from the log (an empty table rebuilds to an
      // empty table, so the rebuild comparison alone can't catch it).
      const feeders = new Map<string, string[]>();
      for (const entry of [...entries, { kind: 'evidence.stored', feeds: ['evidence'] }])
        for (const table of entry.feeds) feeders.set(table, [...(feeders.get(table) ?? []), entry.kind]);
      for (const name of ISSUE_PROJECTIONS) {
        const kinds = feeders.get(name);
        if (!kinds) continue; // commits, checks and attempts: no kind at the base feeds them (see AC6-REDRAFT.md)
        expect(live.get(name)!.rows.length, `projection ${name} has rows after the fixtures of ${[...new Set(kinds)].join(', ')}`).toBeGreaterThan(0);
      }
      // Where the README names the creating event: a claims row per claim.made and an asks row per ask.created,
      // keyed by that event's ID, and an evidence row for the hash recorded as stored and not removed.
      // Wrong program: a projection that keys or merges rows by something other than the creating event.
      const claims = live.get('claims')!, asks = live.get('asks')!, evidence = live.get('evidence')!;
      for (const a of appended.filter((x) => x.kind === 'claim.made'))
        expect(rowsBy(claims, 'id', a.id).length + rowsBy(claims, 'id', `claim:${a.id}`).length, `claims has the row of claim.made ${a.id}`).toBe(1);
      for (const a of appended.filter((x) => x.kind === 'ask.created'))
        expect(rowsBy(asks, 'id', a.id).length + rowsBy(asks, 'id', `ask:${a.id}`).length, `asks has the row of ask.created ${a.id} (${a.schema} fixture ${a.index})`).toBe(1);
      expect(rowsBy(evidence, 'hash', keptEvidence.sha256), `evidence has the row of stored hash ${keptEvidence.sha256}`).toHaveLength(1);

      // ---- A simulated day later, rebuild and compare every projection row by row in primary-key order.
      // "Every other table is a projection the hub can rebuild by replaying it" (issue); "A projection is a function
      // of the events alone, in log_pos order. It reads no clock" (design). Wrong programs: a projection not rebuilt
      // from the log (empty or different after rebuild, named by table and row), and one that reads the clock,
      // such as a lease's stale state or an ask's default from now() (differs a day later, named by table and row).
      clock.tick(DAY);
      await record.rebuild();
      const rebuilt = await snapshot(record, listed);
      for (const name of listed) {
        const problem = tableProblem(name, rebuilt.get(name)!);
        expect(problem, `rebuilt projection ${name} is a table with a primary key, rows in primary-key order`).toBeUndefined();
      }
      expect(firstTableDifference(live, rebuilt), 'every projection equals its rebuild a day later, row by row').toBeUndefined();

      // The rebuild replays the log and leaves it as it was. Wrong program: a rebuild that appends, drops or
      // renumbers events.
      expect((await allEvents(record)).map((e) => `${e.log_pos}:${e.id}`), 'the rebuild leaves the log as it was')
        .toEqual(logged.map((e) => `${e.log_pos}:${e.id}`));
    } finally {
      await record.close();
    }
  });
});
