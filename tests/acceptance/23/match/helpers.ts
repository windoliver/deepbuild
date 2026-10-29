// Test-side tools for the #23 match tests: a real record on SQLite in a temporary folder, the real asks core
// on it with a virtual clock, and resolver-decisions registered with the core as the hub registers it. Sessions
// start in repos as the hook records them; asks are raised as DeepBuild's guards and deep_ask raise them; you
// answer on the question card. Nothing here stands in for the code under test; the wrong programs are in
// plants.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord } from '../../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../../packages/record/src/index.ts';
import { openAsks } from '../../../../packages/asks/src/index.ts';
import type { Asks, AsksPlant, Card, Delivery, InboxRow, Resolver } from '../../../../packages/asks/src/index.ts';
import { resolverDecisions } from '../../../../packages/resolver-decisions/src/index.ts';
import { makeClock, ulid, type Clock, type Obj } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** The hook of a session in a repo: what session.start is recorded under. */
export const hook = (session: string, repo: string): Connection => ({ writer: 'hook', ...who, session, project: repo, agent: 'claude-code' });
/** DeepBuild's own code raising an ask for a session: the merge and push guards. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** An agent's deep_ask, over its MCP server bound to its session. */
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };

/** The name the tests register resolver-decisions under, as the hub's extension host would. */
export const RESOLVER = 'resolver-decisions';

export interface Planting {
  /** Wraps the record every part of the world reads and appends through. */
  record?: (record: RecordStore) => RecordStore;
  /** Wraps the asks core the tests raise through. */
  asks?: (asks: Asks, world: World) => Asks;
  /** Replaces resolver-decisions' resolver with one made from it. */
  resolver?: (real: Resolver, world: World) => Resolver;
  /** The asks core's own planted gate (#349's): it applies any answer naming a decision that exists. */
  core?: AsksPlant;
}

export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  deliveries: Delivery[];
  dir: string;
  /** resolver-decisions' resolver, as registered with the core. */
  resolver: Resolver;
  /** A session starting in a repo: session.start with its thread, from the hook. */
  start(session: string, thread: string, repo: string): Promise<void>;
  /** Raises an ask for a session: deep_ask's sources from the agent, the rest from DeepBuild's core. */
  raise(session: string, source: string, ask: Obj): Promise<string>;
  /** Your answer on the question card, choosing an option. */
  answer(ask: string, option: string): Promise<void>;
  /** The handles Needs you shows a card for. */
  shown(): Promise<string[]>;
  card(ask: string): Promise<Card>;
  row(ask: string): Promise<InboxRow>;
  events(kind?: string): Promise<Event[]>;
  /** The ask's ask.created event. */
  created(ask: string): Promise<Event>;
  /** The key the core gave the ask. */
  keyOf(ask: string): Promise<string>;
  /** decision.created events saved from the ask. */
  savedFrom(ask: string): Promise<Event[]>;
  /** The one decision saved from your answer to the ask: its handle, scope and answer. */
  decisionOf(ask: string): Promise<{ decision: string; scope: string; answer: string; key: string }>;
  /** decision.applied events for the ask. */
  appliedTo(ask: string): Promise<Event[]>;
  close(): Promise<void>;
}

const bare = (handle: string): string => handle.replace(/^[a-z_]+:/, '');
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const data = (e: Event): Obj => (isObj(e.data) ? e.data : {});

export async function openWorld(plant: Planting = {}, options: { resolver?: boolean } = {}, dir = mkdtempSync(join(tmpdir(), 'deep-23-'))): Promise<World> {
  const clock = makeClock();
  const real = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
  const record = plant.record ? plant.record(real) : real;
  const deliveries: Delivery[] = [];
  const opened = await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(structuredClone(d)); }, ...(plant.core ? { plant: plant.core } : {}) });
  const w = { clock, record, deliveries, dir } as World;
  w.asks = plant.asks ? plant.asks(opened, w) : opened;
  const resolver = resolverDecisions({ record });
  w.resolver = plant.resolver ? plant.resolver(resolver, w) : resolver;
  if (options.resolver !== false) opened.registerResolver(RESOLVER, w.resolver);

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
    raise: (session: string, source: string, ask: Obj) => w.asks.raise(source.startsWith('deep_ask.') ? agent(session) : core(session), source, ask),
    answer: async (ask: string, option: string) => {
      // An approval binds to the plan its card showed (none here) and to the click's token.
      const shown = await w.asks.card(ask);
      const allow = shown.options.find((o) => o.id === option)?.decision === 'allow';
      await w.asks.answer(card, ask, allow ? { option, plan_hash: null, token: `click-${ulid(clock.now())}` } : { option });
    },
    shown: async () => (await w.asks.needsYou()).map((c) => c.ask),
    card: (ask: string) => w.asks.card(ask),
    row: async (ask: string) => {
      const row = (await w.asks.inbox()).find((r) => r.ask === ask);
      if (!row) throw new Error(`${ask} has no row in the inbox projection`);
      return row;
    },
    created: async (ask: string) => {
      const found = (await events('ask.created')).find((e) => e.id === bare(ask));
      if (!found) throw new Error(`the record holds no ask.created for ${ask}`);
      return found;
    },
    keyOf: async (ask: string) => String(data(await w.created(ask)).key),
    savedFrom: async (ask: string) => (await events('decision.created')).filter((e) => data(e).ask === ask),
    decisionOf: async (ask: string) => {
      const saved = await w.savedFrom(ask);
      expect(saved.map((e) => data(e)), `your answer to ${ask} on the card is saved as one decision`).toHaveLength(1);
      const d = data(saved[0]!);
      return { decision: `decision:${saved[0]!.id}`, scope: String(d.scope), answer: String(d.answer), key: String(d.key) };
    },
    appliedTo: async (ask: string) => (await events('decision.applied')).filter((e) => data(e).ask === ask),
    close: async () => { await real.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  return w;
}

/** Runs a scenario in a fresh world and closes it. */
export async function inWorld(scenario: (w: World) => Promise<void>, plant: Planting = {}, options: { resolver?: boolean } = {}): Promise<void> {
  const w = await openWorld(plant, options);
  try {
    await scenario(w);
  } finally {
    await w.close();
  }
}

/** What decided an ask for you, if anything did, in words a failure message can carry. */
async function decidedBy(w: World, ask: string): Promise<string> {
  const applied = (await w.appliedTo(ask)).map((e) => String(data(e).decision));
  const refusals = (await w.asks.refusals(ask)).map((r) => `${r.resolver} named ${r.decision ?? 'nothing'}: ${r.reason}`);
  return `decided for you by [${applied.join(', ')}]; refusals [${refusals.join(' | ')}]; delivered ${JSON.stringify(w.deliveries.filter((d) => d.ask === ask).map((d) => d.option))}`;
}

/**
 * The ask was decided for you: closed as decided for you, one decision.applied from the core citing a decision,
 * that decision's option handed to the agent's session once, citing it, and its inbox row naming it. Returns the
 * decision it cites.
 */
export async function decidedForYou(w: World, ask: string, option: string, what: string, was: 'never shown' | 'open before' = 'never shown'): Promise<string> {
  const applied = await w.appliedTo(ask);
  const row = await w.row(ask);
  expect(row.outcome, `${what}: ${ask} is decided for you, without reaching you (${await decidedBy(w, ask)})`).toBe('decided_for_you');
  expect(applied.map((e) => e.writer), `${what}: one decision.applied, from the core, records the automatic answer to ${ask}`).toEqual(['core']);
  const cited = String(data(applied[0]!).decision);
  expect(cited, `${what}: the automatic answer to ${ask} cites the decision it reused`).toMatch(/^decision:[0-9A-Za-z]+$/);
  const delivered = w.deliveries.filter((d) => d.ask === ask);
  expect(delivered.map((d) => [d.option, d.because]), `${what}: the agent gets ${option} for ${ask}, once, citing ${cited}`).toEqual([[option, cited]]);
  expect(row.decision, `${what}: the "decided for you" row of ${ask} cites ${cited}`).toBe(cited);
  expect(await w.shown(), `${what}: ${ask} is not in Needs you`).not.toContain(ask);
  if (was === 'never shown') {
    const batched = (await w.events('ask.batched')).filter((e) => JSON.stringify(e.data).includes(ask));
    expect(batched.map((e) => e.id), `${what}: ${ask} was never shown to you`).toEqual([]);
  }
  return cited;
}

/** The ask reached you: open, shown in Needs you, nothing applied to it and nothing handed to the agent. */
export async function reachesYou(w: World, ask: string, what: string): Promise<Card> {
  const row = await w.row(ask);
  expect(row.outcome, `${what}: ${ask} reaches you, not ${await decidedBy(w, ask)}`).toBe('unanswered');
  expect(await w.appliedTo(ask), `${what}: no decision is applied to ${ask} (${await decidedBy(w, ask)})`).toEqual([]);
  expect(w.deliveries.filter((d) => d.ask === ask), `${what}: nothing is handed to the agent for ${ask}`).toEqual([]);
  expect(await w.shown(), `${what}: ${ask} shows in Needs you`).toContain(ask);
  return w.card(ask);
}
