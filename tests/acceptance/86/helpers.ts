// Test-side tools for the #86 acceptance tests: a real record on SQLite in a temporary folder, the asks
// core and the budget ledger opened on it with a virtual clock, a price lookup the tests can hold open,
// connections, and the refusal check. Nothing here stands in for the ledger; the wrong programs are in
// plants.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import type { Asks, Delivery } from '../../../packages/asks/src/index.ts';
import { BudgetRefused, openLedger } from '../../../packages/budget/src/index.ts';
import type { BudgetView, Ledger, Outcome, RunRequest, ScopeKind } from '../../../packages/budget/src/index.ts';
import { ENDS, makeClock, ulid, type Clock } from './data.ts';

export * from './data.ts';

// ---- Connections, as the hub's socket would prove them.
const who = { actor: 'you', scope: 'you' };
/** DeepBuild's own code: the done gate starting a definition's paid checks, or the runner reporting. */
export const core: Connection = { writer: 'core', ...who };
/** An agent's MCP server, bound to its session: the agent asking to start its own live runs. */
export const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });
/** The question card in the app: the trusted path, where you approve a budget or answer an ask. */
export const card: Connection = { writer: 'app', ...who };
/** The resolver extension (#23), answering for you by naming a budget. */
export const resolverExt: Connection = { writer: 'ext:resolver-decisions', ...who };
/** A planted extension in the hub that reports charges. */
export const plantedExt: Connection = { writer: 'ext:planted-charges', ...who };

/** A price lookup held open: the request it prices, and its release with the world's price for its check. */
export interface Held { request: RunRequest; release(): void }

// ---- A world: a virtual clock, a record in a temporary folder, the asks core and the ledger over both.
export interface World {
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  ledger: Ledger;
  deliveries: Delivery[];
  dir: string;
  /** The price of each check, as the price lookup answers it: null is a price nobody knows. */
  prices: Map<string, number | null>;
  /** Every price lookup the ledger made, in order. */
  lookups: RunRequest[];
  /** While holding, each lookup waits here until the test releases it. */
  held: Held[];
  hold(on: boolean): void;
  /** Waits until n lookups are held, or fails naming how many the ledger made. */
  heldUntil(n: number): Promise<void>;
  /** You approve a budget on the card. */
  approve(kind: ScopeKind, ref: string, cap: number): Promise<string>;
  /** The runner reports how a run ended: run.finished, with no cost reading. */
  finished(run: string, check: string, outcome: 'passed' | 'failed'): Promise<void>;
  view(budget: string): Promise<BudgetView>;
  /** A second ledger opened on the same record: what the record keeps of the ledger. */
  reopened(): Promise<Ledger>;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
export interface Planting {
  record?: (record: RecordStore, world: World) => RecordStore;
  price?: (price: (request: RunRequest) => Promise<number | null>) => (request: RunRequest) => Promise<number | null>;
  ledger?: (ledger: Ledger, world: World) => Ledger;
}

/** Lets every pending callback, microtask and immediate run: enough for the ledger to reach its next await. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function openWorld(plant: Planting = {}, dir = mkdtempSync(join(tmpdir(), 'deep-86-'))): Promise<World> {
  const clock = makeClock();
  const real = await openRecord({ path: join(dir, 'record.db'), now: clock.now });
  const deliveries: Delivery[] = [];
  const prices = new Map<string, number | null>();
  const lookups: RunRequest[] = [];
  const held: Held[] = [];
  let holding = false;
  const w = { clock, deliveries, dir, prices, lookups, held } as World;
  const record = plant.record ? plant.record(real, w) : real;
  w.record = record;
  const priceNow = (request: RunRequest): number | null => {
    const known = prices.get(request.check);
    return known === undefined ? null : known;
  };
  const lookup = (request: RunRequest): Promise<number | null> => {
    lookups.push(structuredClone(request));
    if (!holding) return Promise.resolve(priceNow(request));
    return new Promise((resolve) => { held.push({ request: structuredClone(request), release: () => resolve(priceNow(request)) }); });
  };
  const price = plant.price ? plant.price(lookup) : lookup;
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
  const asks = await openAsks({ record, now: clock.now, deliver: (d) => { deliveries.push(d); } });
  w.asks = asks;
  const ledger = await openLedger({ record, asks, now: clock.now, price });
  w.ledger = plant.ledger ? plant.ledger(ledger, w) : ledger;
  Object.assign(w, {
    events,
    hold: (on: boolean) => { holding = on; },
    heldUntil: async (n: number) => {
      for (let i = 0; i < 500 && held.length < n; i++) await flush(1);
      expect(held.length, `the ledger looks up each run's price while the others are still held: ${held.length} of ${n} lookups were open`).toBe(n);
    },
    approve: (kind: ScopeKind, ref: string, cap: number) => w.ledger.approve(card, { scope: { kind, ref }, cap_usd: cap, ends: ENDS }),
    finished: async (run: string, check: string, outcome: 'passed' | 'failed') => {
      await record.append(core, {
        v: 1, id: ulid(clock.now()), kind: 'run.finished', subject: run, ts: clock.now(),
        data: {
          run, outcome, tests_run: 1, passed: outcome === 'passed' ? 1 : 0, runs: 1, evidence: [], check,
          assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'local',
        },
      });
    },
    view: (budget: string) => w.ledger.budget(budget),
    reopened: () => openLedger({ record, asks, now: clock.now, price: lookup }),
    close: async () => { await real.close(); rmSync(dir, { recursive: true, force: true }); },
  });
  return w;
}

/** A paid run's request. */
export const request = (run: string, check: string, inputsDigest: string, issue: string, resource?: string): RunRequest =>
  (resource === undefined ? { run, check, inputs: inputsDigest, issue } : { run, check, inputs: inputsDigest, issue, resource });

export const started = (outcomes: Outcome[]): Outcome[] => outcomes.filter((o) => o.status === 'started');
export const blocked = (outcomes: Outcome[]): Outcome[] => outcomes.filter((o) => o.status === 'BLOCKED');
/** The runs a budget holds a reservation for, sorted. */
export const reservedRuns = (view: BudgetView): string[] => view.reservations.map((r) => r.run).sort();
/** A list of {budget, usd} in a stable order, for comparing. */
export const sorted = <T extends { budget: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.budget.localeCompare(b.budget));

/** The call is refused with BudgetRefused, naming what the criterion says it names. */
export async function refused(call: Promise<unknown>, named: Partial<Record<'run' | 'budget', string>>, what: string): Promise<BudgetRefused> {
  let error: unknown;
  let value: unknown;
  try {
    value = await call;
  } catch (e) {
    error = e;
  }
  expect(error, `${what}: expected the core to refuse it, naming ${JSON.stringify(named)}, but it returned ${JSON.stringify(value)}`).toBeInstanceOf(BudgetRefused);
  const refusal = error as BudgetRefused;
  for (const [property, expected] of Object.entries(named)) {
    expect(refusal[property as 'run' | 'budget'], `${what}: the refusal names its ${property}`).toBe(expected);
  }
  return refusal;
}

/** The asks Needs you shows, by handle. */
export const shownAsks = async (w: World): Promise<string[]> => (await w.asks.needsYou()).map((c) => c.ask);
