// Test-side tools for the #319 acceptance tests: a real record on SQLite in a temporary folder, a home
// folder holding your settings, the asks core opened on both with a virtual clock, the hub stopped and
// started again on the same record, and what Needs you showed and when. Nothing here stands in for the
// asks core; the planted wrong programs are in plants.ts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type TestContext } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { askSources, draftAskSettings, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskKind, Asks, Delivery, InboxRow } from '../../../packages/asks/src/index.ts';
import { withPlans } from '../plans.ts';
import { bare, makeClock, T0, ulid, type Clock, type Obj } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code raising an ask for a session. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
export const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };

let messages = 0;

export interface Planting {
  record?: (record: RecordStore) => RecordStore;
  asks?: (asks: Asks, world: World) => Asks;
  /** The settings folder the planted hub reads instead of yours. */
  home?: (world: World) => string;
}

// ---- A world: a virtual clock, a record and a home folder in a temporary folder, and the hub over them.
export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  dir: string;
  /** ~/.deepbuild: the folder whose config.json holds your own settings. */
  home: string;
  /** Each ask's handle and the virtual time Needs you first showed it, on its own card or folded into an exception's. */
  seen: Map<string, number>;
  /** A session starting: session.start with its thread and worktree. */
  start(session: string, thread: string, worktree?: string): Promise<void>;
  /** A message a person typed while the agent works: user.ask from the hook. */
  typed(session: string, text: string): Promise<void>;
  /** The agent taking a step: tool.before from the hook. */
  step(session: string): Promise<void>;
  /** Sets the virtual clock and lets the hub act on it. */
  at(ms: number): Promise<void>;
  /** The handles Needs you shows a card for, recording what it showed and when. */
  shown(): Promise<string[]>;
  inboxRow(ask: string): Promise<InboxRow | undefined>;
  events(kind?: string): Promise<Event[]>;
  about(ask: string): Promise<Event[]>;
  row(ask: string): Promise<Row | undefined>;
  /** The hub stops: the core goes and the record closes. */
  stop(): Promise<void>;
  /** The hub starts again on the same record and settings. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** Written to <home>/config.json; 'setup' runs draftAskSettings(home) instead; null writes nothing. */
  settings: Obj | 'setup' | null;
  start?: number;
  plant?: Planting;
}

export async function openWorld(options: WorldOptions): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-319-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  if (options.settings === 'setup') await draftAskSettings(home);
  else if (options.settings) writeFileSync(join(home, 'config.json'), `${JSON.stringify(options.settings, null, 2)}\n`);
  const clock = makeClock(options.start ?? T0);
  const plant = options.plant ?? {};
  const deliveries: Delivery[] = [];
  const seen = new Map<string, number>();
  const w = { clock, deliveries, dir, home, seen } as World;
  let real: RecordStore;
  const open = async () => {
    real = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
    w.record = plant.record ? plant.record(real) : real;
    const asks = withPlans(await openAsks({ record: w.record, now: clock.now, deliver: (d) => { deliveries.push(d); }, home: plant.home ? plant.home(w) : home }));
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
    about: async (handle: string) => (await events()).filter((e) => e.subject === handle),
    start: async (session: string, thread: string, worktree = join(dir, 'no-repo')) => {
      await w.record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree, branch: 'main', thread } });
    },
    typed: async (session: string, text: string) => {
      await w.record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'user.ask', ts: clock.now(), data: { msg: ++messages, text, tasks: [], from: 'person' } });
    },
    step: async (session: string) => {
      await w.record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'tool.before', ts: clock.now(), data: { kind: 'read', paths: ['src/a.ts'], command: null } });
    },
    at: async (ms: number) => { clock.set(ms); await w.asks.tick(); },
    shown: async () => {
      const cards = await w.asks.needsYou();
      for (const c of cards) for (const h of [c.ask, ...c.folded]) if (!seen.has(h)) seen.set(h, clock.now());
      return cards.map((c) => c.ask);
    },
    inboxRow: async (handle: string) => (await w.asks.inbox()).find((r) => r.ask === handle),
    row: async (handle: string) => (await w.record.table('asks')).rows.find((r) => r.id === bare(handle)),
    stop: async () => { await real.close(); },
    restart: open,
    close: async () => { await real.close().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); },
  });
  await open();
  return w;
}

/** A place in ask.sources@1 that raises asks of this kind (the first row of it). */
export function sourceOf(kind: AskKind): string {
  const row = askSources().find((r) => r.kind === kind);
  expect(row, `ask.sources@1 has a row of kind ${kind}`).toBeDefined();
  return row!.source;
}

/** The data of the ask.created event an ask was raised with. */
export async function createdData(w: World, handle: string): Promise<Obj> {
  const created = (await w.events('ask.created')).find((e) => e.id === bare(handle));
  expect(created, `ask ${handle} is in the log`).toBeDefined();
  return created!.data as Obj;
}

/** Each defaulted ask was shown in Needs you, on its card or in an exception's, no later than its default. */
export async function noDefaultBeforeShown(w: World): Promise<void> {
  for (const e of await w.events('ask.defaulted')) {
    const at = w.seen.get(e.subject ?? '');
    expect(at, `ask ${e.subject} took its default without ever showing in Needs you`).toBeDefined();
    expect(at!, `ask ${e.subject} took its default before it showed in Needs you`).toBeLessThanOrEqual(e.ts);
  }
}

/** The core's events that close an ask, and only those. */
export const CLOSING = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'decision.applied'];

/** A folder holding a repo's .deepbuild/done.yaml, as a session's worktree. */
export function repoWith(dir: string, doneYaml: string): string {
  const path = join(dir, 'repo');
  mkdirSync(join(path, '.deepbuild'), { recursive: true });
  writeFileSync(join(path, '.deepbuild', 'done.yaml'), doneYaml);
  return path;
}

// ---- Budgets: the design's rule for timing results, as tests/acceptance/14 judges them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here is only a reading, or null on a reference Mac on mains power, Low Power Mode off, thermal state nominal. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (samples: number[]): number => {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
};
