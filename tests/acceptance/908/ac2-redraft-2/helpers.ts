// Test-side tools for #908 AC2 (blind redraft 2): a real record on SQLite in a temporary folder, a home folder
// with your settings drafted by setup, the asks core opened on both with a virtual clock, the Mac asleep and
// waking, the record rebuilt from its log, and the hub started again on it. Nothing here stands in for the
// asks core or the record.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord } from '../../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore, Row } from '../../../../packages/record/src/index.ts';
import { askSources, draftAskSettings, openAsks } from '../../../../packages/asks/src/index.ts';
import type { AskKind, Asks } from '../../../../packages/asks/src/index.ts';
import type { JsonValue } from '../../../../packages/contracts/src/index.ts';
import { withPlans } from '../../plans.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

// ---- AC1's night, in UTC (batches fall at 00:00, 08:00 and 16:00 UTC).
/** 2026-10-20 23:00: both asks are raised. */
export const RAISED = Date.UTC(2026, 9, 20, 23, 0, 0);
/** 23:30: the hub's last beat before the Mac sleeps. */
export const ASLEEP = Date.UTC(2026, 9, 20, 23, 30, 0);
/** 08:00 the next day: the Mac wakes and the hub beats again. */
export const AWAKE = Date.UTC(2026, 9, 21, 8, 0, 0);

/**
 * AC1's ask: a definition ask, 4 h drafted, so its deadline is 03:00. It is away and unshown from 23:30 until its
 * deadline passes at 03:00, 3.5 h, which moves it to 06:30 (README, Choices that are mine). It first shows at 08:00,
 * after that, so the minimum notice holds its default until 09:00 (AC1).
 */
export const DEFINITION = { raisedDeadline: Date.UTC(2026, 9, 21, 3, 0, 0), moved: Date.UTC(2026, 9, 21, 6, 30, 0), defaultsAt: Date.UTC(2026, 9, 21, 9, 0, 0), answer: 'drop' };
/**
 * An authority ask raised beside it, 1 day drafted, so its deadline is 2026-10-21 23:00. All 8.5 h of the time away
 * fall before that deadline, so every reading moves it to 2026-10-22 07:30, inside its wait counted again from its
 * first showing (08:00 + 1 day), and with far more than an hour's notice.
 */
export const AUTHORITY = { raisedDeadline: Date.UTC(2026, 9, 21, 23, 0, 0), moved: Date.UTC(2026, 9, 22, 7, 30, 0), defaultsAt: Date.UTC(2026, 9, 22, 7, 30, 0), answer: 'hold' };

export const bare = (handle: string): string => handle.replace(/^ask:/, '');
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
type Obj = { [key: string]: JsonValue };

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

/** A place in ask.sources@1 that raises asks of this kind (the first row of it). */
export function sourceOf(kind: AskKind): string {
  const row = askSources().find((r) => r.kind === kind);
  expect(row, `ask.sources@1 has a row of kind ${kind}`).toBeDefined();
  return row!.source;
}

/** An ask as a place raises it under settings drafted at setup: deadline left to your settings. */
export function ask(kind: 'definition' | 'authority', subject: string): Obj {
  const options: Obj[] = kind === 'authority'
    ? [{ id: 'push', label: 'Push it', decision: 'allow' }, { id: 'hold', label: 'Hold it', decision: 'deny' }]
    : [{ id: 'keep', label: 'Keep the requirement', decision: 'none' }, { id: 'drop', label: 'Leave it out', decision: 'none' }];
  return {
    kind,
    question: kind === 'authority' ? `Push ${subject} to origin?` : `Does done for ${subject} need it?`,
    options,
    recommended: kind === 'authority' ? 'push' : 'keep',
    fallback: 'you',
    // The definition's default is the option that leaves the requirement out, which only the raiser can name.
    ...(kind === 'definition' ? { default: 'drop' } : {}),
    provisional: false,
    owner: 'you',
    key: sha256(`${kind}:${subject}`),
    pinned_to: { kind: 'evidence', ref: sha256(subject) },
  };
}

/** The core's events that close an ask. */
export const CLOSING = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'decision.applied'];
/** Core events about an ask that the base already appends for other reasons: never a deadline move. */
const NOT_MOVES = new Set(['ask.created', 'ask.batched', 'ask.later', 'plan.proposed', 'answer.refused', ...CLOSING]);

/** The new method this redraft needs (README, The surface). Read through a cast so the suite compiles on the base. */
type Away = { away?: (from: number, to: number) => Promise<void> };

export interface World {
  record: RecordStore;
  asks: Asks;
  dir: string;
  now(): number;
  /** Each ask's handle and the virtual time Needs you first showed it. */
  seen: Map<string, number>;
  /** False when the asks core has no away(from, to), so the hub couldn't tell it about the time away. */
  told: boolean;
  start(session: string, thread: string): Promise<void>;
  /** Sets the virtual clock and lets the hub act on it (one beat). */
  at(ms: number): Promise<void>;
  /** The Mac sleeps from `from` and wakes at `to`: on its first beat the hub tells the core, then ticks it. */
  sleep(from: number, to: number): Promise<void>;
  /** The handles Needs you shows a card for, recording what it showed and when. */
  shown(): Promise<string[]>;
  events(): Promise<Event[]>;
  /** The ask's deadline as the record's asks table reads it (SQLite integers come back as bigint), or undefined. */
  deadline(ask: string): Promise<number | undefined>;
  /** The hub stops and starts again on the same record and settings, at the same virtual time. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

export async function openWorld(): Promise<World> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-908-ac2-'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  // AC1's ask must wait for a batch at 23:00, so the batches are pinned to every 8 h; setup drafts every other
  // value (deadlines, defaults, the minimum notice) and keeps this one.
  writeFileSync(join(home, 'config.json'), `${JSON.stringify({ asks: { batch: { every: '8h', cap: 20 } } }, null, 2)}\n`);
  await draftAskSettings(home);
  let t = RAISED;
  const now = () => t;
  const seen = new Map<string, number>();
  const w = { dir, seen, now, told: true } as World;
  const open = async () => {
    w.record = await openRecord({ path: join(dir, 'record.db'), now });
    w.asks = withPlans(await openAsks({ record: w.record, now, deliver: () => undefined, home }));
  };
  const events = async (): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await w.record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return all;
  };
  Object.assign(w, {
    events,
    start: async (session: string, thread: string) => {
      await w.record.append(hook(session), { v: 1, id: ulid(t), kind: 'session.start', ts: t, data: { agent: 'claude-code', worktree: join(dir, 'no-repo'), branch: 'main', thread } });
    },
    at: async (ms: number) => { t = ms; await w.asks.tick(); },
    sleep: async (from: number, to: number) => {
      t = to;
      const away = (w.asks as Asks & Away).away;
      if (typeof away === 'function') await away(from, to);
      else w.told = false;
      await w.asks.tick();
    },
    shown: async () => {
      const cards = await w.asks.needsYou();
      for (const c of cards) for (const h of [c.ask, ...c.folded]) if (!seen.has(h)) seen.set(h, t);
      return cards.map((c) => c.ask);
    },
    deadline: async (handle: string) => {
      const row: Row | undefined = (await w.record.table('asks')).rows.find((r) => r.id === bare(handle));
      return row?.deadline === undefined || row.deadline === null ? undefined : Number(row.deadline);
    },
    restart: async () => { await w.record.close(); await open(); },
    close: async () => { await w.record.close().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); },
  });
  await open();
  return w;
}

/**
 * AC1's night: at 23:00 a definition ask (4 h) and an authority ask (1 day) are raised in two sessions; both wait for
 * the 00:00 batch. The hub beats at 23:30, the Mac sleeps until 08:00, and the hub, waking, tells the core and ticks.
 */
export async function night(w: World): Promise<{ definition: string; authority: string }> {
  await w.start('S1', 'T1');
  await w.start('S2', 'T2');
  const definition = await w.asks.raise(core('S1'), sourceOf('definition'), ask('definition', 'the export'));
  const authority = await w.asks.raise(core('S2'), sourceOf('authority'), ask('authority', 'feature/login'));
  expect(await w.deadline(definition), `ask ${definition} takes the drafted 4 h definition deadline, 03:00`).toBe(DEFINITION.raisedDeadline);
  expect(await w.deadline(authority), `ask ${authority} takes the drafted 1-day authority deadline`).toBe(AUTHORITY.raisedDeadline);
  expect(await w.shown(), 'at 23:00 both asks wait for the 00:00 batch: neither has shown').toEqual([]);
  await w.at(ASLEEP);
  expect(await w.shown(), 'at the last beat before sleep neither ask has shown').toEqual([]);
  await w.sleep(ASLEEP, AWAKE);
  const shown = await w.shown();
  for (const h of [definition, authority]) expect(shown, `ask ${h} shows when the Mac wakes at 08:00`).toContain(h);
  return { definition, authority };
}

/** Every number in an event's data, at any depth. */
function numbers(v: JsonValue | undefined): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) return v.flatMap(numbers);
  if (v && typeof v === 'object') return Object.values(v).flatMap(numbers);
  return [];
}
function strings(v: JsonValue | undefined): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}

/**
 * The deadline moves recorded on an ask, found by what they carry, not by a kind name: an event the core appended
 * after the ask was raised, about the ask (its subject, or its handle or ID in the data), of no kind the base already
 * appends for something else, whose data carries the span that moved it by `by` ms: the span's length, its two ends
 * (from the start of the time away), or the time away as the hub told it (23:30 to 08:00).
 */
export async function movesOf(w: World, handle: string, by: number): Promise<Event[]> {
  const all = await w.events();
  const raised = all.find((e) => e.kind === 'ask.created' && e.id === bare(handle));
  expect(raised, `ask ${handle} is in the log`).toBeDefined();
  return all.filter((e) => {
    if (e.writer !== 'core' || e.log_pos <= raised!.log_pos || NOT_MOVES.has(e.kind)) return false;
    const about = e.subject === handle || strings(e.data).some((s) => s === handle || s === bare(handle));
    if (!about) return false;
    const n = numbers(e.data);
    return n.includes(by) || (n.includes(ASLEEP) && (n.includes(ASLEEP + by) || n.includes(AWAKE)));
  });
}

/** The events that closed an ask, as [kind, ts, answer]. */
export async function closings(w: World, handle: string): Promise<[string, number, string | undefined][]> {
  return (await w.events())
    .filter((e) => e.subject === handle && CLOSING.includes(e.kind))
    .map((e) => [e.kind, e.ts, (e.data as { answer?: string }).answer]);
}

/** Each defaulted ask was shown in Needs you no later than its default. */
export async function noDefaultBeforeShown(w: World): Promise<void> {
  for (const e of (await w.events()).filter((x) => x.kind === 'ask.defaulted')) {
    const at = w.seen.get(e.subject ?? '');
    expect(at, `ask ${e.subject} took its default without ever showing in Needs you`).toBeDefined();
    expect(at!, `ask ${e.subject} took its default before it showed in Needs you`).toBeLessThanOrEqual(e.ts);
  }
}

export const iso = (ms: number): string => new Date(ms).toISOString();
