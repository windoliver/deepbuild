// A world for the #3218 tests: the real record on SQLite in a temp folder (#14) and the lease table opened on it
// through its public entry, `@deepbuild/leases` (README, The surface under test), with a clock the test sets; a
// restart that closes the record and opens it and the table again from the file, as the hub's start does; and the
// hub's heavy queue (`@deepbuild/hub/lease`) on that table. The merge base's table and queue, where a criterion
// compares with them, are its own files (helpers.ts, baseTree). Nothing here stands in for the table, the queue or the
// record.

import { join } from 'node:path';
import { expect } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type Event, type RecordStore } from '@deepbuild/record';
import {
  openLeases, SLOW_SLOT, type AskResult, type Caller, type Lease, type LeaseKind, type LeaseResult, type LeaseTable, type Plant, type Resource,
} from '@deepbuild/leases';
import { HeavyQueue, type HeavyOptions } from '@deepbuild/hub/lease';
import { baseTree, importBase, json, makeClock, tempDir, ulid, type Clock } from './helpers.ts';

/** A test kind declared as `pool(n)`, by a test plug-in. */
export const poolKind = (name: string, n: number): LeaseKind => ({ name, match: `pool(${n})`, cap: 100_000, cooldown: 0, cost: 0 });
export const TEST_PLUGIN = 'test-units';
/** The issue's test kind: `pool(1000)`. */
export const MEM = poolKind('test.mem', 1000);
export const mem = (host = 'local', key = 'test.mem'): Resource => ({ host, kind: MEM.name, key });
export const slot = (host = 'local', key = 'slot'): Resource => ({ host, kind: 'cpu.slot', key });

export interface World {
  dir: string;
  path: string;
  clock: Clock;
  record: RecordStore;
  table: LeaseTable;
  /** Declares a kind now and again on each restart, as a plug-in's manifest is read at every start. */
  declare(plugin: string, kind: LeaseKind, free?: (key: string) => Promise<boolean>): Promise<void>;
  events(kind?: string): Promise<Event[]>;
  /** The holder's agent ended: its SessionEnd hook, as an adapter maps it (writer `hook`). Resolves with its ID. */
  endSession(holder: string): Promise<string>;
  /** The hub restarts: the record is closed and opened again from its file, and the table folds it. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions { plant?: Plant; cores?: number; clock?: Clock; dir?: string }

/** Reads every event of the record, in log order. */
export async function readAll(record: RecordStore, kind?: string): Promise<Event[]> {
  const all: Event[] = [];
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    all.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.log_pos;
  }
  return kind ? all.filter((e) => e.kind === kind) : all;
}

export async function endSessionIn(record: RecordStore, clock: Clock, holder: string): Promise<string> {
  const bare = holder.slice('session:'.length);
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: bare, agent: 'claude-code' };
  const ts = clock.now();
  const id = ulid(ts);
  await record.append(hook, { v: 1, id, kind: 'session.end', subject: holder, ts, data: { reason: 'prompt_input_exit' } });
  return id;
}

export async function openWorld(o: WorldOptions = {}): Promise<World> {
  const dir = o.dir ?? tempDir();
  const path = join(dir, 'ledger.db');
  const clock = o.clock ?? makeClock();
  const declared: { plugin: string; kind: LeaseKind; free?: (key: string) => Promise<boolean> }[] = [];
  const open = async (): Promise<{ record: RecordStore; table: LeaseTable }> => {
    const record = await openRecord({ path, now: clock.now });
    const table = await openLeases({ record, now: clock.now, cores: o.cores ?? 8, ...(o.plant ? { plant: o.plant } : {}) });
    for (const d of declared) await table.declare(d.plugin, d.kind, d.free);
    return { record, table };
  };
  const w = { dir, path, clock, ...(await open()) } as World;
  w.declare = async (plugin, kind, free) => {
    await w.table.declare(plugin, kind, free);
    declared.push({ plugin, kind, ...(free ? { free } : {}) });
  };
  w.events = (kind) => readAll(w.record, kind);
  w.endSession = (holder) => endSessionIn(w.record, clock, holder);
  w.restart = async () => {
    await w.record.close();
    Object.assign(w, await open());
  };
  w.close = () => w.record.close();
  return w;
}

/** A caller that is only a holder. */
export const as = (holder: string): Caller => ({ holder });

/** The lease a grant carries, or a failure naming what came back instead. */
export function granted(result: LeaseResult, what: string): Lease {
  expect(result.status, `${what}: expected a grant, got ${json(result)}`).toBe('granted');
  if (result.status !== 'granted') throw Error('unreachable');
  return result.lease;
}
/** The leases a whole ask's grant carries, one per need in its order, or a failure naming what came back. */
export function grantedAsk(result: AskResult, needs: number, what: string): Lease[] {
  expect(result.status, `${what}: expected the ask granted whole, got ${json(result)}`).toBe('granted');
  if (result.status !== 'granted') throw Error('unreachable');
  expect(result.leases.length, `${what}: one lease for each of the ask's ${needs} resources, got ${json(result.leases)}`).toBe(needs);
  return result.leases;
}
/** The units a lease carries, by its fields. */
export const unitsOf = (lease: Lease): number | undefined => (lease as Lease & { units?: number }).units;
/** What the table holds now: each lease's ID, resource and units. */
export async function holding(table: LeaseTable): Promise<{ id: string; resource: Resource; holder: string; units: number | undefined }[]> {
  return (await table.leases()).map((v) => ({ id: v.lease.id, resource: v.lease.resource, holder: v.lease.holder, units: unitsOf(v.lease) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** The events of the record naming `holder` in their data: what was appended for it. */
export async function appendedFor(record: RecordStore, holder: string): Promise<Event[]> {
  return (await readAll(record)).filter((e) => (e.data as Record<string, unknown> | null)?.['holder'] === holder);
}
export const named = (events: Event[]): string => events.map((e) => `${e.kind}@${e.v} ${e.subject ?? ''} ${json(e.data)}`).join('; ');

// ---- The merge base's table, on a record this suite opened (AC2: a record written on the merge base).
interface LeasesModule { openLeases(options: { record: RecordStore; now: () => number; cores?: number }): Promise<LeaseTable> }
export async function openBaseTable(record: RecordStore, now: () => number, cores = 8): Promise<LeaseTable> {
  const files = baseTree(['packages/leases/src/index.ts']);
  const mod = await importBase<LeasesModule>(files['packages/leases/src/index.ts']!);
  return mod.openLeases({ record, now, cores });
}

// ---- The heavy queue: the hub's `lease.wait`, which `deep lease [kind...] -- <command>` calls with the kinds it names
// (hub-control.ts), on the table above. The peer is this test process, alive throughout.
export interface Queue {
  queue: HeavyQueue;
  /** One `lease.wait` for a new command of `who`'s session, naming `kinds`. */
  join(who: string, kinds: string[], command: string): Promise<Record<string, unknown>>;
  /** `lease.wait` again with the reply's ticket, as `deep lease` asks four times a second while it waits. */
  poll(reply: Record<string, unknown>, who: string): Promise<Record<string, unknown>>;
}
type QueueClass = new (o: HeavyOptions) => HeavyQueue;
export function queueOn(w: { record: RecordStore; table: LeaseTable; clock: Clock; dir: string }, o: { plant?: string; unitsOf?: HeavyOptions['unitsOf']; base?: QueueClass } = {}): Queue {
  const Queue = o.base ?? HeavyQueue;
  const queue = new Queue({
    table: w.table, slow: SLOW_SLOT, now: w.clock.now, pressure: () => 'normal', free: () => 100e9,
    worktreeOf: () => undefined, agentOf: () => undefined,
    append: async (kind, v, data, subject, session) => {
      const id = ulid(w.clock.now());
      await w.record.append({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}) }, {
        id, kind, v, ts: w.clock.now(), data: data as JsonValue, ...(subject ? { subject } : {}),
      });
      return id;
    },
    ...(o.plant ? { plant: o.plant } : {}),
    ...(o.unitsOf ? { unitsOf: o.unitsOf } : {}),
  });
  const peer = { pid: process.pid, start: '' };
  return {
    queue,
    join: (who, kinds, command) => queue.wait({ kinds, command, cwd: w.dir, jobs: 'none' }, peer, async () => who),
    poll: (reply, who) => queue.wait({ ticket: reply['ticket'], secret: reply['secret'] }, peer, async () => who),
  };
}
/** The merge base's `HeavyQueue` class and its table, for AC9's "on the merge base". */
export async function baseQueueParts(record: RecordStore, now: () => number, cores = 8): Promise<{ table: LeaseTable; HeavyQueue: QueueClass }> {
  const files = baseTree(['packages/hub/src/heavy.ts', 'packages/leases/src/index.ts']);
  const heavy = await importBase<{ HeavyQueue: QueueClass }>(files['packages/hub/src/heavy.ts']!);
  const leases = await importBase<LeasesModule>(files['packages/leases/src/index.ts']!);
  return { table: await leases.openLeases({ record, now, cores }), HeavyQueue: heavy.HeavyQueue };
}
