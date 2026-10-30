// Test-side tools for the #69 acceptance tests: a real record on SQLite in a temporary folder, with an evidence
// store beside it, the asks core opened on both with a virtual clock and the ask settings setup drafts,
// connections, a run that checks each step before taking it against a target the test holds, and the refusal
// check. Nothing here stands in for DeepBuild; the wrong programs are in plants.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { AskRefused, draftAskSettings, openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Card, Delivery, InboxRow, PlanStep } from '../../../packages/asks/src/index.ts';
import { makeClock, type Clock, type Plan } from './data.ts';

export * from './data.ts';
export { toJson } from '../../../packages/record/src/index.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code raising an ask for a session: a guard at PreToolUse, a plug-in's send, the ledger. */
export const core = (session: string): Connection => ({ writer: 'core', ...who, session });
/** An agent's MCP server (deep_ask, a purchase), bound to its session. */
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
/** The question card in the app: the trusted path. */
export const card: Connection = { writer: 'app', ...who };

// ---- A world: a virtual clock, a record and an evidence store in a temporary folder, and the asks core.
export interface World {
  clock: Clock;
  dir: string;
  record: RecordStore;
  evidence: EvidenceStore;
  asks: Asks;
  deliveries: Delivery[];
  events(kind?: string): Promise<Event[]>;
  row(ask: string): Promise<InboxRow | undefined>;
  /** Moves the clock and lets the asks core act on it: batches show, deadlines default. */
  at(ms: number): Promise<void>;
  close(): Promise<void>;
}
export interface Planting {
  record?: (record: RecordStore, world: World) => RecordStore;
  asks?: (asks: Asks, world: World) => Asks;
}

export async function openWorld(plant: Planting = {}, dir = mkdtempSync(join(tmpdir(), 'deep-69-'))): Promise<World> {
  const clock = makeClock();
  const home = join(dir, 'home');
  // Setup drafts your ask settings: deadlines and defaults by kind, and batches three times a day.
  await draftAskSettings(home);
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: clock.now });
  const real = await openRecord({ path: join(dir, 'record.db'), now: clock.now, evidence });
  const deliveries: Delivery[] = [];
  const w = { clock, dir, evidence, deliveries } as World;
  const record = plant.record ? plant.record(real, w) : real;
  w.record = record;
  const asks = await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(d); }, home });
  w.asks = plant.asks ? plant.asks(asks, w) : asks;
  Object.assign(w, {
    events: async (kind?: string): Promise<Event[]> => {
      const all: Event[] = [];
      for (let after = 0; ;) {
        const page = await real.read({ after, limit: 1000 });
        all.push(...page);
        if (page.length < 1000) break;
        after = page[page.length - 1]!.log_pos;
      }
      return kind ? all.filter((e) => e.kind === kind) : all;
    },
    row: async (ask: string) => (await w.asks.inbox()).find((r) => r.ask === ask),
    at: async (ms: number) => { clock.set(ms); await w.asks.tick(); },
    close: async () => { await real.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  return w;
}

/** An authority ask raised by the core for session S1 with its plan; its handle. */
export const raiseWithPlan = (w: World, source: string, ask: unknown, shown: Plan, session = 'S1'): Promise<string> =>
  w.asks.raise(core(session), source, ask, shown);

/** Your yes on the card: the ask's allow option, bound to the plan its card shows and your click's token. */
export async function approve(w: World, ask: string, token: string): Promise<Card> {
  const shown = await w.asks.card(ask);
  const allow = shown.options.find((o) => o.decision === 'allow');
  expect(allow, `${ask} has an option that approves its plan`).toBeDefined();
  expect(shown.plan, `${ask}'s card shows the plan your yes approves`).not.toBeNull();
  await w.asks.answer(card, ask, { option: allow!.id, plan_hash: shown.plan!.hash, token });
  return shown;
}

/** The batch an ask was shown in, from the core's ask.batched events. */
export async function batchOf(w: World, ask: string): Promise<string> {
  const batched = (await w.events('ask.batched')).find((e) => isList(e.data, ask));
  expect(batched, `${ask} was shown in a batch`).toBeDefined();
  return String((batched!.data as { batch: unknown }).batch);
}
const isList = (data: unknown, ask: string): boolean =>
  typeof data === 'object' && data !== null && Array.isArray((data as { asks?: unknown }).asks)
  && ((data as { asks: unknown[] }).asks).some((a) => typeof a === 'object' && a !== null && (a as { ask?: unknown }).ask === ask);

/** A target outside DeepBuild (a mail service, a git host, a cloud account): it records each step it was made to take. */
export interface Target { taken: PlanStep[] }
export const target = (): Target => ({ taken: [] });
/**
 * An agent's run of an approved plan: before each step it asks the core whether the step may run, and takes it on
 * the target only when it may. It stops at the first step that may not, with the ask the core names.
 */
export async function run(w: World, ask: string, steps: PlanStep[], on: Target): Promise<{ stopped: PlanStep; ask: string } | null> {
  for (const s of steps) {
    const check = await w.asks.beforeStep(ask, s);
    if (!check.run) return { stopped: s, ask: check.ask };
    on.taken.push(s);
  }
  return null;
}

/** The call is refused with AskRefused, naming the field. */
export async function refused(call: Promise<unknown>, field: string, what: string): Promise<AskRefused> {
  let error: unknown;
  let value: unknown;
  try {
    value = await call;
  } catch (e) {
    error = e;
  }
  expect(error, `${what}: expected the core to refuse it, naming ${field}, but it returned ${JSON.stringify(value)}`).toBeInstanceOf(AskRefused);
  expect(String((error as AskRefused).field ?? ''), `${what}: the refusal names ${field}`).toMatch(new RegExp(`(^|/)${field}(/|$)`));
  return error as AskRefused;
}
