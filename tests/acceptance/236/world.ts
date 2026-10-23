// A world for the library tests: a real record on SQLite in a temp folder (#14), the real asks core on it
// (#318) with a clock the test can move, and the supervisor opened on both through its public entry,
// `@deepbuild/supervisor` (README, The surface). Nothing here stands in for the supervisor.

import { join } from 'node:path';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openSupervisor, type ResourceKind, type Supervisor, type SupervisorOptions } from '../../../packages/supervisor/src/index.ts';
import { DAY, tempDir } from './helpers.ts';

/** The question card in the app: the trusted path an answer takes. */
export const card: Connection = { writer: 'app', actor: 'you', scope: 'you' };

/** Real time plus an offset the test moves: waits and grace periods stay real, deadlines can be passed. */
export interface Clock { now(): number; advance(ms: number): void }
export function makeClock(): Clock {
  let offset = 0;
  return { now: () => Date.now() + offset, advance: (ms) => { offset += ms; } };
}

/** What your settings give an unblock ask (Decided: unblock, 2 days). */
export const SETTINGS: NonNullable<SupervisorOptions['settings']> = { asks: { unblock: { deadline_ms: 2 * DAY } } };

export interface World {
  dir: string;
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(o: { plant?: SupervisorOptions['plant']; resources?: ResourceKind[] } = {}): Promise<World> {
  const dir = tempDir();
  const clock = makeClock();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: clock.now });
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const sup = await openSupervisor({
    record, asks, now: clock.now, settings: SETTINGS,
    ...(o.resources ? { resources: o.resources } : {}),
    ...(o.plant ? { plant: o.plant } : {}),
  });
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
  return {
    dir, clock, record, asks, sup, events,
    close: async () => {
      await sup.close();
      await record.close();
    },
  };
}

/** The data of an event, as a plain object. */
export const dataOf = (e: Event): Record<string, unknown> => e.data as Record<string, unknown>;
