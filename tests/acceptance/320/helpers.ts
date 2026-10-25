// Test-side tools for the #320 acceptance tests: a real record on SQLite in a temporary folder, a home folder
// holding your settings, the asks core opened on both with a virtual clock, the hub stopped and started again on
// the same record, and a real git repository for a block pinned to a commit. Nothing here stands in for the
// asks core; the planted wrong programs are in plants.ts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { AskRefused, askSources, openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Card, Delivery, InboxRow } from '../../../packages/asks/src/index.ts';
import { bare, makeClock, SETTINGS, T0, ulid, YOU, type Clock, type Obj } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: YOU, scope: YOU };
/** DeepBuild's own code raising an ask for a session (as #318's and #319's tests raise). */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
export const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });

/** A wrong program planted around the real asks core: the real program with one part done wrong. */
export interface Planting {
  asks?: (asks: Asks, world: World) => Asks;
}

export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  dir: string;
  home: string;
  /** A session starting: session.start with its thread and worktree. */
  start(session: string, thread: string, worktree?: string): Promise<void>;
  /** Sets the virtual clock and lets the hub act on it. */
  at(ms: number): Promise<void>;
  events(kind?: string): Promise<Event[]>;
  /** The hub stops (the core goes, the record closes) and starts again on the same record and settings. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function openWorld(plant: Planting = {}): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-320-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), `${JSON.stringify(SETTINGS, null, 2)}\n`);
  const clock = makeClock(T0);
  const deliveries: Delivery[] = [];
  const w = { clock, deliveries, dir, home } as World;
  const open = async () => {
    w.record = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
    const asks = await openAsks({ record: w.record, now: clock.now, deliver: (d) => { deliveries.push(d); }, home });
    w.asks = plant.asks ? plant.asks(asks, w) : asks;
  };
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await w.record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  Object.assign(w, {
    events,
    start: async (session: string, thread: string, worktree = join(dir, 'no-repo')) => {
      await w.record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree, branch: 'main', thread } });
    },
    at: async (ms: number) => { clock.set(ms); await w.asks.tick(); },
    restart: async () => { await w.record.close(); await open(); },
    close: async () => { await w.record.close().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); },
  });
  await open();
  return w;
}

/** Runs a scenario in its own world, with the planted wrong program when one is given, and closes it. */
export async function inWorld(plant: Planting | undefined, run: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld(plant);
  try {
    await run(w);
  } finally {
    await w.close();
  }
}

/** The place in ask.sources@1 that raises unblock tasks with deep_ask (the first unblock row). */
export function unblockSource(): string {
  const row = askSources().find((r) => r.kind === 'unblock');
  expect(row, 'ask.sources@1 has a row of kind unblock').toBeDefined();
  return row!.source;
}

/** Raises an ask the test expects the core to take: a refusal fails the test at this assertion, naming why. */
export async function raised(w: World, connection: Connection, data: Obj, what: string): Promise<string> {
  let handle: string | undefined;
  let refusal: unknown;
  try {
    handle = await w.asks.raise(connection, unblockSource(), data);
  } catch (error) {
    refusal = error;
  }
  expect(refusal === undefined ? undefined : `${(refusal as Error).name}: ${(refusal as Error).message}`, `${what} is raised, not refused`).toBeUndefined();
  return handle!;
}

/** Raises an ask the test expects the core to refuse, and returns the refusal (undefined when it took the ask). */
export async function refusal(w: World, connection: Connection, data: Obj): Promise<AskRefused | undefined> {
  try {
    await w.asks.raise(connection, unblockSource(), data);
    return undefined;
  } catch (error) {
    expect(error, 'the core refuses with AskRefused').toBeInstanceOf(AskRefused);
    return error as AskRefused;
  }
}

/** The ask.created event an ask was raised with. */
export async function created(w: World, handle: string): Promise<Event> {
  const event = (await w.events('ask.created')).find((e) => e.id === bare(handle));
  expect(event, `ask ${handle} is in the log`).toBeDefined();
  return event!;
}

/** Your inbox, as `deep inbox` prints it. */
export const inboxOf = (w: World): Promise<InboxRow[]> => w.asks.inbox();
/** The drafted request for a block, as your inbox lists it. */
export const requestRow = (rows: InboxRow[], block: string): InboxRow | undefined => rows.find((r) => r.request?.block === block);
/** The card Needs you shows for an ask. */
export const cardIn = (cards: Card[], ask: string): Card | undefined => cards.find((c) => c.ask === ask);

/** A real git repository: a teammate's commits, the worktree a session works in. */
export function gitRepo(dir: string): { path: string; commit(file: string, text: string, author: string): string } {
  const path = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', path]);
  return {
    path,
    commit(file, text, author) {
      const git = (...args: string[]) => execFileSync('git', ['-c', `user.name=${author}`, '-c', `user.email=${author}@example.invalid`, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: path, encoding: 'utf8' }).trim();
      mkdirSync(dirname(join(path, file)), { recursive: true });
      writeFileSync(join(path, file), `${text}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `change ${file}`);
      return git('rev-parse', 'HEAD');
    },
  };
}
