// Test-side tools for the #327 acceptance tests, the TypeScript half (README: The surfaces). Three worlds, each
// built from what the base already has, none standing in for what it tests:
//
//   - an in-process world: the real record on SQLite in a temporary folder, the real asks core and
//     resolver-decisions on it, on a virtual clock (#23's helpers, written again here with the answer input left
//     open, since these tests answer with words, an image and a plan hash);
//   - a hub world: asks raised into a ledger under sessions before a real `deep hub run` starts on it (#34's
//     seeding), the app's answers signed by a paired key, the OS confirmation stubbed (#34's Confirmer), and a Stop
//     hook held for the answer (#25's route), which is how an answer reaches the agent's next input;
//   - the deep-show driver (#400's helpers), for the card's arming as a state machine on the virtual display clock.
//
// Nothing here answers an ask, times a press or decides a scope: those are the implementation's, and the judges
// below only read what it did.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord, ulid as recordUlid } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks, askSources, type Asks, type Card, type Delivery, type InboxRow, type PlanInput, type Resolver } from '../../../packages/asks/src/index.ts';
import { resolverDecisions } from '../../../packages/resolver-decisions/src/index.ts';
import type { Line } from '../16/helpers.ts';

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const data = (e: Event): Obj => (isObj(e.data) ? e.data : {});
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
export const bare = (handle: string): string => handle.replace(/^[a-z_]+:/, '');
export const DAY = 86_400_000;
export const HOUR = 3_600_000;

// ---- The criteria, by ID (README: Criteria, tests and wrong programs). IDs are `#327.<first 8 hex of SHA-256 of the
// criterion's text, trimmed, whitespace collapsed>` (scripts/proof-change.mjs, criterionId).
export const AC1 = '#327.fab7d30b';
export const AC2 = '#327.da06e3b1';
export const AC7 = '#327.b12554f8';
export const AC14 = '#327.74732631';
export const AC15 = '#327.2459a9a6';
export const AC16 = '#327.f9d8bea9';

// ---- The surface this suite adds to the asks core's Card and Delivery (README: The surfaces, the asks core). Typed
// as optional here so the files type-check at the base, where neither field exists; a test reads them and fails,
// naming the field, when they are missing.

/** What the card says before it arms about an answer that will be saved as a decision: fixed when it is presented. */
export interface Saves { scope: string; also: number }
/** The answered card's one-line receipt: the option, and every other open ask the answer closed as decided for you. */
export interface Receipt { answer: string; also: string[] }
export type CardSeen = Card & { saves?: Saves | null; receipt?: Receipt | null };
export type Delivered = Delivery & { image?: string | null };

// ---- A virtual clock.
export const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
export interface Clock { now(): number; set(ms: number): void; advance(ms: number): void }
export function makeClock(start = T0): Clock {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; }, advance: (ms) => { t += ms; } };
}
/** A ULID at a time, as the record mints them. */
export const ulid = (ms: number): string => recordUlid(ms);
export const commit = (word: string): string => sha256(`commit:${word}`).slice(0, 40);

// ---- Connections, as the hook, the core, an agent's deep mcp and the question card present themselves.
const who = { actor: 'you', scope: 'you' } as const;
export const hook = (session: string, repo: string): Connection => ({ writer: 'hook', ...who, session, project: repo, agent: 'claude-code' });
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
/** The question card: the app on the trusted path. */
export const card: Connection = { writer: 'app', ...who };

// ---- Asks, by kind, from the fixtures of ask.sources@1 so each is the shape its source raises.
const opt = (id: string, label: string, decision: 'allow' | 'deny' | 'none' = 'none') => ({ id, label, decision });
/** A taste call on a screen's element, pinned to a commit: its key comes from the subject, never its words. */
export function tasteAsk(question: string, screen: string, element: string, pin: string, now: number, options = [opt('blue', 'Blue header'), opt('green', 'Green header')]): Obj {
  return {
    kind: 'taste', question, options, recommended: options[0]!.id, deadline: now + 3 * DAY, fallback: 'you', default: options[0]!.id,
    provisional: false, owner: 'you', subject: { screen, element }, pinned_to: { kind: 'commit', ref: pin },
  };
}
/** A push the push guard raises for a session's thread, with the change it carries. */
export function pushAsk(branch: string, thread: string, now: number): Obj {
  return {
    kind: 'authority', question: `Push ${branch} to origin?`, options: [opt('approve', 'Allow', 'allow'), opt('decline', 'Decline', 'deny')],
    recommended: null, deadline: now + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
    subject: { effect: 'push', target: { kind: 'branch', ref: `branch:${branch}`, owner: `thread:${thread}` }, change: { kind: 'feature', lines: 42, paths: ['src/cart/total.ts'] } },
    pinned_to: { kind: 'commit', ref: commit(branch) },
  };
}
/** The plan a push proposes: one step that leaves the machine. */
export const pushPlan = (branch: string): PlanInput => ({ steps: [{ does: `git push origin ${branch}`, changes: [`origin/${branch}`], undo: 'git push --force-with-lease to the old tip', public: true, cost: 0 }], diff: sha256(`diff:${branch}`) });

// ---- The in-process world.

export interface Planting {
  /** Wraps the asks core the tests raise and answer through: the planted wrong cards and resolvers. */
  asks?: (asks: Asks, world: World) => Asks;
  /** Replaces resolver-decisions' resolver with one made from it. */
  resolver?: (real: Resolver, world: World) => Resolver;
}
export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  /** Every delivery the core handed the agent's adapter, in order. */
  deliveries: Delivered[];
  dir: string;
  /** A session starting in a repo: session.start with its thread, from the hook. */
  start(session: string, thread: string, repo: string): Promise<void>;
  /** Raises an ask for a session: deep_ask's sources from the agent, the rest from DeepBuild's core. */
  raise(session: string, source: string, ask: Obj, plan?: PlanInput): Promise<string>;
  /** Your answer on the question card, as the card sends it: an option, words, an image, a plan hash, a click token. */
  answer(ask: string, input: Obj): Promise<void>;
  /** The handles Needs you shows a card for. */
  shown(): Promise<string[]>;
  card(ask: string): Promise<CardSeen>;
  row(ask: string): Promise<InboxRow>;
  events(kind?: string): Promise<Event[]>;
  /** The one ask.answered for an ask; fails naming it when there is none or more than one. */
  answered(ask: string, what: string): Promise<Event>;
  /** decision.created events saved from the ask. */
  savedFrom(ask: string): Promise<Event[]>;
  /** decision.applied events for the ask. */
  appliedTo(ask: string): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(plant: Planting = {}, dir = mkdtempSync(join(tmpdir(), 'deep-327-'))): Promise<World> {
  const clock = makeClock();
  const record = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
  const deliveries: Delivered[] = [];
  const opened = await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(structuredClone(d) as Delivered); } });
  const w = { clock, record, deliveries, dir } as World;
  w.asks = plant.asks ? plant.asks(opened, w) : opened;
  const real = resolverDecisions({ record });
  opened.registerResolver('resolver-decisions', plant.resolver ? plant.resolver(real, w) : real);
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
    start: async (session: string, thread: string, repo: string) => {
      await record.append(hook(session, repo), { v: 1, id: ulid(clock.now()), kind: 'session.start', ts: clock.now(), data: { agent: 'claude-code', worktree: `/nonexistent/${repo}/${thread}`, branch: 'main', thread } });
    },
    raise: (session: string, source: string, ask: Obj, plan?: PlanInput) => w.asks.raise(source.startsWith('deep_ask.') ? agent(session) : core(session), source, ask, plan),
    answer: (ask: string, input: Obj) => w.asks.answer(card, ask, input),
    shown: async () => (await w.asks.needsYou()).map((c) => c.ask),
    card: (ask: string) => w.asks.card(ask) as Promise<CardSeen>,
    row: async (ask: string) => {
      const row = (await w.asks.inbox()).find((r) => r.ask === ask);
      if (!row) throw new Error(`${ask} has no row in the inbox projection`);
      return row;
    },
    answered: async (ask: string, what: string) => {
      const found = (await events('ask.answered')).filter((e) => e.subject === ask);
      expect(found.map((e) => data(e)), `${what}: ${ask} is recorded answered exactly once`).toHaveLength(1);
      return found[0]!;
    },
    savedFrom: async (ask: string) => (await events('decision.created')).filter((e) => data(e).ask === ask),
    appliedTo: async (ask: string) => (await events('decision.applied')).filter((e) => data(e).ask === ask),
    close: async () => { await record.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  return w;
}

/** Runs a scenario in a fresh world and closes it. */
export async function inWorld(scenario: (w: World) => Promise<void>, plant: Planting = {}): Promise<void> {
  const w = await openWorld(plant);
  try {
    await scenario(w);
  } finally {
    await w.close();
  }
}

/** The ask reached you and still waits: open, shown in Needs you, nothing applied to it, nothing handed to the agent for it. */
export async function staysOpen(w: World, ask: string, what: string): Promise<void> {
  const row = await w.row(ask);
  expect(row.outcome, `${what}: ${ask} stays open (its outcome)`).toBe('unanswered');
  expect((await w.appliedTo(ask)).map((e) => data(e)), `${what}: no decision is applied to ${ask}`).toEqual([]);
  expect((await w.events('ask.answered')).filter((e) => e.subject === ask).map((e) => data(e)), `${what}: ${ask} is not recorded answered`).toEqual([]);
  expect(w.deliveries.filter((d) => d.ask === ask), `${what}: nothing is handed to the agent for ${ask}`).toEqual([]);
  expect(await w.shown(), `${what}: ${ask} shows in Needs you`).toContain(ask);
}

/** The ask was decided for you by `decision`: closed so, one decision.applied citing it, its option handed to the agent once citing it. */
export async function decidedBy(w: World, ask: string, decision: string, option: string, what: string): Promise<void> {
  const row = await w.row(ask);
  expect(row.outcome, `${what}: ${ask} is decided for you`).toBe('decided_for_you');
  const applied = await w.appliedTo(ask);
  expect(applied.map((e) => [e.writer, String(data(e).decision)]), `${what}: one decision.applied from the core cites ${decision} for ${ask}`).toEqual([['core', decision]]);
  expect(w.deliveries.filter((d) => d.ask === ask).map((d) => [d.option, d.because]), `${what}: the agent gets ${option} for ${ask} once, citing ${decision}`).toEqual([[option, decision]]);
  expect(await w.shown(), `${what}: ${ask} is not in Needs you`).not.toContain(ask);
}

/** The words of a JSON value, for a message. */
export const shown = (value: unknown): string => JSON.stringify(value)?.slice(0, 800) ?? String(value);

// ---- The hub world (README: The surfaces, the hub).

export { Confirmer, confirmEnv, newDevice, pair, signed, clickToken, eventsAbout, inboxRow, startHub, makeHome, installedRoot, asApp, cleanup, result, sendHook, hookRequest, fromHere, newSession, sleep, type Conn, type Device, type Hub, type Session } from '../34/helpers.ts';

export interface SeededAsk { handle: string; session: string; question: string; options: { id: string; label: string; decision: string }[] }

/**
 * Raises asks into the hub root's ledger under sessions, before any hub runs there, as #34's seedAsks does but with
 * each ask inside a session (the hook's session.start first, in a repo), so the hub delivers its answer to that
 * session. `source` is a row of ask.sources@1; `ask` is the whole ask (its options are the card's draw order's
 * input, so the tests set them). Answers each ask's handle.
 */
export async function seedInSessions(root: string, asks: { session: string; source: string; ask: Obj }[]): Promise<SeededAsk[]> {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = () => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const asksCore = await openAsks({ record, now, deliver: () => undefined });
  const out: SeededAsk[] = [];
  for (const { session, source, ask } of asks) {
    const row = askSources().find((r) => r.source === source);
    if (!row) throw Error(`BLOCKED: setup: ask.sources@1 has no row ${source}`);
    await record.append(hook(session, 'shop'), { v: 1, id: ulid(now()), kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: `/nonexistent/shop/${session}`, branch: 'main', thread: session } });
    const handle = await asksCore.raise(agent(session), source, ask);
    out.push({ handle, session, question: String(ask.question), options: ask.options as SeededAsk['options'] });
  }
  await record.close();
  return out;
}

/** The hub's reply to a hook, as deep-hook would print it: the JSON in its stdout, if any. */
export function hookReply(reply: Line | undefined): Line | undefined {
  if (!reply || typeof reply.stdout !== 'string' || !reply.stdout.trim()) return undefined;
  try { return JSON.parse(reply.stdout) as Line; } catch { return undefined; }
}
