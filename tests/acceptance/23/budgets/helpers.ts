// Test-side tools for the #23 budget tests: the match suite's world (a real record on SQLite in a temporary
// folder, the real asks core with a virtual clock, sessions in repos) with the real ledger (#86) opened on the
// same record and asks core, and resolver-decisions opened with that ledger and registered with the asks core as
// the hub registers it. Prices come from a table the test holds. Nothing here stands in for the code under test;
// the wrong programs are in plants.ts.

import { expect } from 'vitest';
import type { Connection } from '../../../../packages/record/src/index.ts';
import type { Resolver } from '../../../../packages/asks/src/index.ts';
import { openLedger } from '../../../../packages/budget/src/index.ts';
import type { BudgetView, Ledger, Outcome, RunRequest } from '../../../../packages/budget/src/index.ts';
import { resolverDecisions } from '../../../../packages/resolver-decisions/src/index.ts';
import { DAY, openWorld, sha256, T0, ulid, type World } from '../match/helpers.ts';

export * from '../match/helpers.ts';

/** Every budget the tests approve ends 30 days after the clock's start, far past any clock a test moves to. */
export const ENDS = T0 + 30 * DAY;
/** The issue every paid run here belongs to: no issue or resource budget covers it, so each run is a request that asks. */
export const ISSUE = 'windoliver/deepbuild#77';
/** The paid checks the runs belong to. */
export const LIVE_CALL = 'live.checkout-call';
export const HOSTED_RUN = 'hosted.browser-journey';
export const GPU_RENDER = 'gpu.render-golden';

const who = { actor: 'you', scope: 'you' };
/** The runner reporting a run's cost reading. */
export const runner: Connection = { writer: 'core', ...who };
/** The question card in the app: where you approve a budget. */
export const approver: Connection = { writer: 'app', ...who };
/** An agent's MCP server, bound to its session: the agent asking to start its own paid or live run. */
export const agentOf = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session, agent: 'claude-code' });

export interface BudgetPlanting {
  /** Wraps the ledger resolver-decisions is handed. The tests always read the real one. */
  ledger?: (real: Ledger, b: BudgetWorld) => Ledger;
  /** Replaces resolver-decisions' resolver, as registered with the asks core, with one made from it. */
  resolver?: (real: Resolver, b: BudgetWorld) => Resolver;
}

/** One paid run's request, as the agent made it and as it stands once the request returned. */
export interface Paid {
  run: string;
  usd: number;
  outcome: Outcome;
  /** The per-run approval request the run raised: the one ask the request added to the inbox, in its session. */
  ask: string;
}

export interface BudgetWorld {
  w: World;
  /** The real ledger on the world's record and asks core. */
  ledger: Ledger;
  /** The price of each check, as the price lookup answers it. */
  prices: Map<string, number>;
  /** What a planted program that counts for itself reads: the price of the run whose request is in flight, each
   *  budget's cap as you approved it, and the sum of the cost readings that landed. */
  pricing: number | null;
  caps: Map<string, number>;
  spent: number;
  /** You approve a budget for a repo on the card: a `project` budget whose ref is the repo's project name. */
  approve(repo: string, cap: number): Promise<string>;
  /** The agent of a session asks to start a paid run of a check, on inputs named by a word. */
  paid(session: string, check: string, inputs: string): Promise<Paid>;
  /** The run's cost reading lands. */
  charge(run: string, usd: number): Promise<void>;
  view(budget: string): Promise<BudgetView>;
  close(): Promise<void>;
}

export async function openBudgetWorld(plant: BudgetPlanting = {}): Promise<BudgetWorld> {
  const prices = new Map<string, number>();
  const b = { prices, pricing: null, caps: new Map<string, number>(), spent: 0 } as unknown as BudgetWorld;
  const price = (run: RunRequest): Promise<number | null> => Promise.resolve(prices.get(run.check) ?? null);
  let made: Promise<Resolver> | undefined;
  // The match world registers its resolver once; here it is resolver-decisions opened with the ledger.
  const w = await openWorld({
    resolver: (_unused, world) => {
      made = (async () => {
        const ledger = await openLedger({ record: world.record, asks: world.asks, now: world.clock.now, price });
        b.ledger = ledger;
        const real = resolverDecisions({ record: world.record, ledger: plant.ledger ? plant.ledger(ledger, b) : ledger });
        return plant.resolver ? plant.resolver(real, b) : real;
      })();
      return async (ask) => (await made!)(ask);
    },
  });
  b.w = w;
  await made;
  Object.assign(b, {
    approve: async (repo: string, cap: number) => {
      const budget = await b.ledger.approve(approver, { scope: { kind: 'project', ref: repo }, cap_usd: cap, ends: ENDS });
      b.caps.set(budget, cap);
      return budget;
    },
    paid: async (session: string, check: string, inputs: string): Promise<Paid> => {
      const before = new Set((await w.asks.inbox()).map((r) => r.ask));
      const run = `run:${ulid(w.clock.now())}`;
      const usd = prices.get(check) ?? null;
      b.pricing = usd;
      let outcome: Outcome;
      try {
        outcome = await b.ledger.request(agentOf(session), { run, check, inputs: sha256(`inputs:${inputs}`), issue: ISSUE });
      } finally {
        b.pricing = null;
      }
      const added = (await w.asks.inbox()).filter((r) => !before.has(r.ask) && r.session === session).map((r) => r.ask);
      expect(added, `run ${run} ($${usd}), which no issue or resource budget covers, raises one per-run approval request in ${session} (outcome ${JSON.stringify(outcome)})`).toHaveLength(1);
      const ask = added[0]!;
      if (outcome.status === 'asked') expect(outcome.ask, `run ${run}'s outcome names its per-run approval request`).toBe(ask);
      return { run, usd: usd ?? NaN, outcome, ask };
    },
    charge: async (run: string, usd: number) => {
      await b.ledger.charge(runner, run, usd);
      b.spent += usd;
    },
    view: (budget: string) => b.ledger.budget(budget),
    close: () => w.close(),
  });
  return b;
}

/** Runs a scenario in a fresh world and closes it. */
export async function inBudgetWorld(scenario: (b: BudgetWorld) => Promise<void>, plant: BudgetPlanting = {}): Promise<void> {
  const b = await openBudgetWorld(plant);
  try {
    await scenario(b);
  } finally {
    await b.close();
  }
}
