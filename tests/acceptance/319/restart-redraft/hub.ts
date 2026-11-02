// The hub as this criterion sees it (#319): a folder (~/.deepbuild) holding your config.json and the record, a
// virtual clock, and a start that opens the record and the asks core over it, as packages/hub/src/core.ts does
// (openRecord on the ledger, then openAsks with `home` set to that folder). A stop closes the record; while the
// hub is down nothing reads or writes it, and the virtual clock moves on.
//
// The plant the criterion names, a hub that waits for the next batch, starts the same way but drives the asks
// core only once the virtual clock reaches the next batch time after its start, checking once a second.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duration, openAsks, type Asks, type InboxRow } from '@deepbuild/asks';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';

export type Variant = 'hub' | 'waits-for-next-batch';

export interface Clock { now: () => number; set(ms: number): void }
export const clock = (start: number): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

export interface Hub {
  raise(connection: Connection, source: string, ask: unknown): Promise<string>;
  tick(): Promise<void>;
  /** The handles of the asks in Needs you. */
  needsYou(): Promise<string[]>;
  inbox(): Promise<InboxRow[]>;
  stop(): Promise<void>;
}

/** Your batch interval from config.json, as setup drafted it. */
const batchEvery = (home: string): number => {
  const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { asks?: { batch?: { every?: string } } };
  const every = duration(config.asks?.batch?.every);
  if (every === undefined) throw new Error('config.json declares no asks.batch.every');
  return every;
};

export async function startHub(home: string, time: Clock, variant: Variant = 'hub'): Promise<Hub> {
  const record: RecordStore = await openRecord({ path: join(home, 'ledger.db'), now: time.now, commitEach: true });
  const open = () => openAsks({ record, now: time.now, deliver: () => undefined, home });
  let asks: Asks | undefined;
  let beat: NodeJS.Timeout | undefined;
  if (variant === 'hub') {
    asks = await open();
  } else {
    const every = batchEvery(home);
    const next = (Math.floor(time.now() / every) + 1) * every;
    let opening: Promise<Asks> | undefined;
    beat = setInterval(() => {
      if (!opening && time.now() >= next) opening = open().then((a) => (asks = a));
    }, 1000);
  }
  const core = (): Asks => {
    if (!asks) throw new Error('the asks core is not running yet');
    return asks;
  };
  return {
    raise: (connection, source, ask) => core().raise(connection, source, ask),
    tick: () => core().tick(),
    needsYou: async () => (asks ? (await asks.needsYou()).map((card) => card.ask) : []),
    inbox: async () => (asks ? asks.inbox() : []),
    stop: async () => {
      if (beat) clearInterval(beat);
      await record.close();
    },
  };
}
