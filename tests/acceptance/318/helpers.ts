// Test-side tools for the #318 acceptance tests: a real record on SQLite in a temporary folder, the asks
// core opened on it with a virtual clock, the deliveries it hands the agent, connections, and the refusal
// check. Nothing here stands in for the asks core; the planted wrong programs are in plants.ts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import type { SchemaEntry } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore, Row } from '../../../packages/record/src/index.ts';
import { AskRefused, askSources, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskKind, Asks, Delivery } from '../../../packages/asks/src/index.ts';
import { bare, makeClock, ulid, type Clock } from './data.ts';
import { withPlans } from '../plans.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code raising or closing an ask for a session. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** An agent's MCP server (deep_ask), bound to its session. */
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
export const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };
/** `deep inbox answer`, after the OS confirmed you. */
export const inbox: Connection = { writer: 'cli', ...who };

let messages = 0;

// ---- A world: a virtual clock, a record in a temporary folder and the asks core over both.
export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  dir: string;
  /** A session starting, or rotating its ID under /clear or /compact: session.start with its thread. */
  start(session: string, thread: string, worktree?: string): Promise<void>;
  /** Text a person typed in a session: user.ask from the hook. */
  typed(session: string, text: string): Promise<void>;
  events(kind?: string): Promise<Event[]>;
  row(ask: string): Promise<Row | undefined>;
  close(): Promise<void>;
}
export interface Planting {
  schemas?: readonly SchemaEntry[];
  record?: (record: RecordStore) => RecordStore;
  asks?: (asks: Asks, world: World) => Asks;
}

export async function openWorld(plant: Planting = {}, dir = mkdtempSync(join(tmpdir(), 'deep-318-'))): Promise<World> {
  const clock = makeClock();
  const real = await openRecord({ path: join(dir, 'record.db'), now: clock.now, ...(plant.schemas ? { schemas: plant.schemas } : {}) });
  const record = plant.record ? plant.record(real) : real;
  const deliveries: Delivery[] = [];
  const w = { clock, record, deliveries, dir } as World;
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
  Object.assign(w, {
    events,
    start: async (session: string, thread: string, worktree = join(dir, 'no-repo')) => {
      await record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree, branch: 'main', thread } });
    },
    typed: async (session: string, text: string) => {
      await record.append(hook(session), { v: 1, id: ulid(clock.now()), kind: 'user.ask', ts: clock.now(), data: { msg: ++messages, text, tasks: [], from: 'person' } });
    },
    row: async (ask: string) => (await record.table('asks')).rows.find((r) => r.id === bare(ask)),
    close: async () => { await real.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  const asks = withPlans(await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(d); } }));
  w.asks = plant.asks ? plant.asks(asks, w) : asks;
  return w;
}

/** A place in ask.sources@1 that raises asks of this kind. */
export function sourceOf(kind: AskKind): string {
  const row = askSources().find((r) => r.kind === kind);
  expect(row, `ask.sources@1 has a row of kind ${kind}`).toBeDefined();
  return row!.source;
}
/** The handles of the asks Needs you shows a card for. */
export const shownAsks = async (w: World): Promise<string[]> => (await w.asks.needsYou()).map((c) => c.ask);
/** The digest of the plan an authority ask's card shows. */
export async function planShown(w: World, handle: string): Promise<string> {
  const shown = await w.asks.card(handle);
  expect(typeof shown.plan?.hash, `ask ${handle}: its card shows its plan's digest`).toBe('string');
  return shown.plan!.hash;
}
export const deliveredFor = (w: World, handle: string): Delivery[] => w.deliveries.filter((d) => d.ask === handle);
export const about = (events: Event[], handle: string): Event[] => events.filter((e) => e.subject === handle);
/** A column the record stores as JSON text, read back. */
export const stored = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
};

/** The call is refused with AskRefused, and the named property ends with the named value. */
export async function refused(call: Promise<unknown>, named: Partial<Record<'field' | 'option' | 'source' | 'outcome', string>> = {}): Promise<AskRefused> {
  let error: unknown;
  try {
    await call;
  } catch (e) {
    error = e;
  }
  expect(error, `expected a refusal naming ${JSON.stringify(named)}`).toBeInstanceOf(AskRefused);
  const refusal = error as AskRefused;
  for (const [property, value] of Object.entries(named)) {
    expect(String(refusal[property as keyof AskRefused] ?? ''), `the refusal names its ${property}`).toMatch(new RegExp(`(^|/)${value}$`));
  }
  return refusal;
}

/** A real git repository with one commit, for asks pinned to a commit. */
export function gitRepo(dir: string): { path: string; commit(file: string, text: string): string } {
  const path = join(dir, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: path, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', path]);
  return {
    path,
    commit(file, text) {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      writeFileSync(join(path, file), `${text}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `change ${file}`);
      return git('rev-parse', 'HEAD');
    },
  };
}
