// A world for the #237 tests: the real record on SQLite in a temp folder (#14), the lease table opened on it
// through its public entry, `@deepbuild/leases` (README, The surface), with a clock the test sets, and, where a
// criterion needs processes proven gone, the real supervisor (#236) and asks core (#318) on the same record.
// Nothing here stands in for the table, the record or the supervisor.

import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import {
  openLeases, type Caller, type Lease, type LeaseKind, type LeaseResult, type LeaseTable, type Mode, type Plant, type Resource,
} from '../../../packages/leases/src/index.ts';
import { json, makeClock, tempDir, ulid, type Clock } from './helpers.ts';

/** The port kind as env-local declares it (#36): ports match by exact key. The test stands in for env-local's manifest. */
export const PORT: LeaseKind = { name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0 };
export const ENV_LOCAL = 'env-local';
export const port = (host: string, key = '5173'): Resource => ({ host, kind: 'port', key });
export const slot = (host: string): Resource => ({ host, kind: 'cpu.slot', key: 'slot' });

export interface World {
  dir: string;
  clock: Clock;
  record: RecordStore;
  table: LeaseTable;
  sup?: Supervisor;
  events(kind?: string): Promise<Event[]>;
  /** The holder's agent ended: its SessionEnd hook, as an adapter maps it (writer `hook`). Resolves with the event's ID. */
  endSession(holder: string): Promise<string>;
  close(): Promise<void>;
}

export async function openWorld(o: { plant?: Plant; cores?: number; clock?: Clock; supervisor?: boolean } = {}): Promise<World> {
  const dir = tempDir();
  const clock = o.clock ?? makeClock();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: clock.now });
  const table = await openLeases({ record, now: clock.now, ...(o.cores !== undefined ? { cores: o.cores } : {}), ...(o.plant ? { plant: o.plant } : {}) });
  let sup: Supervisor | undefined;
  if (o.supervisor) {
    const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
    sup = await openSupervisor({ record, asks, now: clock.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
  }
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  const endSession = async (holder: string): Promise<string> => {
    const bare = holder.slice('session:'.length);
    const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: bare, agent: 'claude-code' };
    const ts = clock.now();
    const id = ulid(ts);
    await record.append(hook, { v: 1, id, kind: 'session.end', subject: holder, ts, data: { reason: 'prompt_input_exit' } });
    return id;
  };
  return {
    dir, clock, record, table, events, endSession,
    ...(sup ? { sup } : {}),
    close: async () => {
      if (sup) await sup.close();
      await record.close();
    },
  };
}

/** A caller that is only a holder: no run, no agent process the table was told of. */
export const as = (holder: string): Caller => ({ holder });

/** The lease a grant carries, or a failure naming what came back instead. */
export function granted(result: LeaseResult, what: string): Lease {
  expect(result.status, `${what}: expected a grant, got ${json(result)}`).toBe('granted');
  if (result.status !== 'granted') throw Error('unreachable');
  expect(result.lease.holder, `${what}: the lease is held by its caller`).toBeTypeOf('string');
  return result.lease;
}
/** A refusal that names the lease in its way: its holder in the message, the lease among `holders`. */
export function refusedNaming(result: LeaseResult, blocker: Lease, what: string): void {
  expect(result.status, `${what}: expected a refusal naming ${blocker.holder}'s lease, got ${json(result)}`).toBe('refused');
  if (result.status !== 'refused') throw Error('unreachable');
  expect(result.reason, `${what}: refused as held by another`).toBe('held');
  expect(result.holders.map((l) => l.id), `${what}: the refusal names ${blocker.holder}'s lease`).toContain(blocker.id);
  expect(result.message, `${what}: the refusal's words name the holder`).toContain(blocker.holder);
}
/** Leases one resource for each caller at once; the results in the callers' order. */
export function atOnce(table: LeaseTable, asks: { caller: Caller; resource: Resource; mode: Mode }[]): Promise<LeaseResult[]> {
  return Promise.all(asks.map((a) => table.lease(a.caller, a.resource, a.mode)));
}
/** The record's `lease.acquired` events for a lease: its resource, holder and mode. */
export async function acquiredFor(w: World, lease: Lease): Promise<Event[]> {
  return (await w.events('lease.acquired')).filter((e) => {
    const d = e.data as { resource?: Resource; holder?: string; mode?: string };
    return d.resource?.host === lease.resource.host && d.resource?.kind === lease.resource.kind && d.resource?.key === lease.resource.key
      && d.holder === lease.holder && d.mode === lease.mode;
  });
}
