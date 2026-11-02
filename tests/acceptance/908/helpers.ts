// Test-side tools for the #908 acceptance tests: a real record on SQLite and a home folder in a temporary
// folder, the asks core opened on both with a virtual clock, and the hub around it as the tests play it: its
// 1 s beat while the Mac is awake, no beat while it sleeps, and a stop (hub.stopped, the record closed) and a
// start again on the same record, rebuilt from its log when a test says so. Nothing here stands in for the asks
// core or the record.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { askSources, draftAskSettings, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskKind, Asks } from '../../../packages/asks/src/index.ts';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A time on the virtual clock, in UTC: `day` 0 is 2026-10-20, so day 1, 08:00 is the next morning. */
export const at = (day: number, h: number, m = 0, s = 0): number => Date.UTC(2026, 9, 20 + day, h, m, s);
/** How a message names a time: day and clock time, such as "day 1 08:00:01". */
export const clock = (ms: number): string => `day ${Math.floor((ms - at(0, 0)) / DAY)} ${new Date(ms).toISOString().slice(11, 19)}`;

/** The waits setup drafts (design: the done.yaml asks block; Decided: Ask deadlines and defaults). */
export const WAIT: Record<AskKind, number> = { taste: 3 * DAY, authority: DAY, unblock: 2 * DAY, exception: 2 * DAY, choice: 2 * DAY, definition: 4 * HOUR };
/** The minimum notice setup drafts for every kind (the issue: "drafted at setup, 1 h by default"). */
export const NOTICE = HOUR;
export const KINDS: readonly AskKind[] = ['authority', 'unblock', 'taste', 'exception', 'choice', 'definition'];

export type Obj = { [key: string]: JsonValue };
export const bare = (handle: string): string => handle.replace(/^ask:/, '');
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- ULIDs minted from the virtual clock, in minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code raising an ask for a session. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
/** The hub itself, as it appends hub.stopped. */
const hub: Connection = { writer: 'core', ...who };
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };

// ---- Asks, as ask.created@1 data with no deadline, so the settings drafted at setup give it.
const OPTIONS: Partial<Record<AskKind, Obj[]>> = {
  definition: [{ id: 'keep', label: 'Keep the requirement', decision: 'none' }, { id: 'drop', label: 'Leave it out', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
};
const RECOMMENDED: Partial<Record<AskKind, string>> = { definition: 'keep', choice: 'files' };
/** The option each kind takes at its deadline under the drafted settings: a definition leaves the item out, a choice takes the recommended one. */
export const AT_DEADLINE: Partial<Record<AskKind, string>> = { definition: 'drop', choice: 'files' };

/** An ask the way its place in ask.sources@1 raises it, its deadline left to your settings. */
export function ask(kind: 'definition' | 'choice', subject: string): Obj {
  return {
    kind,
    question: `Which way for ${subject}?`,
    options: structuredClone(OPTIONS[kind]!),
    recommended: RECOMMENDED[kind]!,
    fallback: 'you',
    ...(kind === 'definition' ? { default: 'drop' } : {}),
    provisional: false,
    owner: 'you',
    key: sha256(`${kind}:${subject}`),
    pinned_to: { kind: 'evidence', ref: sha256(subject) },
  };
}

/** A place in ask.sources@1 that raises asks of this kind (the first row of it). */
export function sourceOf(kind: AskKind): string {
  const row = askSources().find((r) => r.kind === kind);
  expect(row, `ask.sources@1 has a row of kind ${kind}`).toBeDefined();
  return row!.source;
}

/** The core's events that close an ask. */
export const CLOSING = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'decision.applied'];

// ---- A world: a virtual clock, a record and a home folder, and the hub over them.
export interface World {
  record: RecordStore;
  asks: Asks;
  home: string;
  now(): number;
  /** A session starting: session.start with its thread, as the hook appends it. */
  start(session: string, thread: string): Promise<void>;
  /** Raises an ask from its kind's place in ask.sources@1, as DeepBuild's own code does for the session. */
  raise(session: string, kind: 'definition' | 'choice', subject: string): Promise<string>;
  /**
   * The Mac awake and the hub up: the hub's 1 s beat, `asks.tick()` once a second of virtual time, up to and
   * including `until`. `each` runs after every beat.
   */
  awake(until: number, each?: (t: number) => Promise<void>): Promise<void>;
  /**
   * The Mac asleep until `until`: the hub process stays up, but nothing runs in it, so no beat and no append; then
   * the first beat after it wakes, at `until`.
   */
  asleep(until: number): Promise<void>;
  /**
   * The hub down until `until`: it stops as `deep hub stop` stops it (hub.stopped, reason requested, then the record
   * closes), nothing runs, and at `until` it starts again on the same record: a new record handle (its projections
   * rebuilt from the log first when `rebuild` is set) and a new asks core, which ticks once as it opens.
   */
  down(until: number, options?: { rebuild?: boolean }): Promise<void>;
  /** Every event in the log, or those of one kind. */
  events(kind?: string): Promise<Event[]>;
  /** The events about an ask (subject = its handle). */
  about(ask: string): Promise<Event[]>;
  /** When an ask first showed: the first ask.batched naming it. */
  shownAt(ask: string): Promise<number | undefined>;
  /** The events that closed an ask. */
  closing(ask: string): Promise<Event[]>;
  /** The ask's deadline as the record holds it: its row in the record's asks table. */
  deadline(ask: string): Promise<number>;
  close(): Promise<void>;
}

/** A world under the settings setup drafts (draftAskSettings into <home>/config.json), the clock at `start`. */
export async function openWorld(start: number): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-908-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  await draftAskSettings(home);
  let t = start;
  const now = () => t;
  const w = { home, now } as World;
  const open = async (rebuild = false) => {
    w.record = await openRecord({ path: join(dir, 'record.db'), now });
    if (rebuild) await w.record.rebuild();
    w.asks = await openAsks({ record: w.record, now, deliver: () => undefined, home });
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
    start: async (session: string, thread: string) => {
      await w.record.append(hook(session), { v: 1, id: ulid(t), kind: 'session.start', ts: t, data: { agent: 'claude-code', worktree: join(dir, 'no-repo'), branch: 'main', thread } });
    },
    raise: (session: string, kind: 'definition' | 'choice', subject: string) => w.asks.raise(core(session), sourceOf(kind), ask(kind, subject)),
    awake: async (until: number, each?: (t: number) => Promise<void>) => {
      while (t + SECOND <= until) {
        t += SECOND;
        await w.asks.tick();
        if (each) await each(t);
      }
    },
    asleep: async (until: number) => {
      t = until;
      await w.asks.tick();
    },
    down: async (until: number, options: { rebuild?: boolean } = {}) => {
      await w.record.append(hub, { v: 1, id: ulid(t), kind: 'hub.stopped', ts: t, data: { reason: 'requested' } });
      await w.record.close();
      t = until;
      await open(options.rebuild ?? false);
    },
    shownAt: async (handle: string) => {
      for (const e of await events('ask.batched')) {
        const asks = (e.data as { asks?: { ask?: string }[] }).asks ?? [];
        if (asks.some((a) => a.ask === handle)) return e.ts;
      }
      return undefined;
    },
    closing: async (handle: string) => (await events()).filter((e) => CLOSING.includes(e.kind) && (e.subject === handle || (e.kind === 'decision.applied' && (e.data as Obj).ask === handle))),
    deadline: async (handle: string) => {
      const row = (await w.record.table('asks')).rows.find((r) => r.id === bare(handle));
      expect(row, `ask ${handle} has a row in the record's asks table`).toBeDefined();
      return Number(row!.deadline);
    },
    close: async () => {
      await w.record.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  });
  await open();
  return w;
}

/** The issue's Proof: each ask's raised, shown, deadline and outcome times, as the record holds them. */
export async function timeline(w: World): Promise<string[]> {
  const lines: string[] = [];
  for (const created of await w.events('ask.created')) {
    const h = `ask:${created.id}`;
    const shown = await w.shownAt(h);
    const closed = (await w.closing(h))[0];
    lines.push(`${h} raised ${clock(created.ts)}, shown ${shown === undefined ? '-' : clock(shown)}, deadline ${clock(await w.deadline(h))}, `
      + `outcome ${closed ? `${closed.kind} at ${clock(closed.ts)}` : 'open'}`);
  }
  return lines;
}

export async function inWorld(start: number, run: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld(start);
  try {
    await run(w);
  } finally {
    await timeline(w).then((lines) => { for (const line of lines) console.log(line); }).catch(() => undefined);
    await w.close();
  }
}
