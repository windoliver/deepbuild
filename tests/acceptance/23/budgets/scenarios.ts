// Each budget criterion's scenario, shared by the criterion tests and plants.test.ts: the same steps must pass on
// the real program and fail on each wrong program, naming what the criterion says it names.

import { expect } from 'vitest';
import type { BudgetView } from '../../../../packages/budget/src/index.ts';
import { decidedForYou, GPU_RENDER, HOSTED_RUN, HOUR, LIVE_CALL, reachesYou, REPO_A, REPO_B, type BudgetWorld, type Paid } from './helpers.ts';

const later = (b: BudgetWorld): void => b.w.clock.set(b.w.clock.now() + HOUR);

/** What a budget holds, as the ledger shows it: its reservations, what it spent and what's left. */
function holds(view: BudgetView, what: string, expected: { reserved: number; spent: number; runs: string[] }): void {
  expect({ reserved: view.reserved_usd, spent: view.spent_usd, left: view.left_usd, runs: view.reservations.map((r) => r.run).sort() }, `${what} (${view.budget})`).toEqual({
    reserved: expected.reserved, spent: expected.spent, left: view.cap_usd - expected.reserved - expected.spent, runs: [...expected.runs].sort(),
  });
}

/**
 * The run's per-run approval request was decided for you from the budget: closed as decided for you without reaching
 * you, citing a decision, its allow option handed to the agent once, naming the budget and saying how much is left
 * in it, and the run's price reserved against that budget by the core.
 */
async function answeredFromBudget(b: BudgetWorld, paid: Paid, budget: string, left: number, what: string): Promise<string> {
  const allow = (await b.w.card(paid.ask)).options.find((o) => o.decision === 'allow');
  expect(allow, `${what}: its per-run approval request ${paid.ask} offers an option that lets the run start`).toBeDefined();
  const cited = await decidedForYou(b.w, paid.ask, allow!.id, what);
  const delivered = b.w.deliveries.find((d) => d.ask === paid.ask);
  expect(delivered?.budget, `${what}: the answer handed to the agent names budget ${budget} and says $${left} is left in it`).toEqual({ budget, left_usd: left });
  if (paid.outcome.status === 'started') {
    expect(paid.outcome, `${what}: the run starts with its $${paid.usd} reserved against budget ${budget}`).toMatchObject({ reserved: [{ budget, usd: paid.usd }] });
  }
  expect((await b.view(budget)).reservations, `${what}: the core reserved its $${paid.usd} against budget ${budget}`).toContainEqual({ run: paid.run, usd: paid.usd });
  return cited;
}

/** #23.67403f66: a per-run approval request inside a budget you approved is answered without reaching you, logged as decided for you. */
export async function insideBudget(b: BudgetWorld): Promise<void> {
  const { w } = b;
  await w.start('S1', 'T1', REPO_A);
  await w.start('S3', 'T3', REPO_B);
  b.prices.set(LIVE_CALL, 4);
  b.prices.set(HOSTED_RUN, 5);
  b.prices.set(GPU_RENDER, 1);
  const budget = await b.approve(REPO_A, 10);

  const first = await b.paid('S1', LIVE_CALL, 'live call 1');
  const one = await answeredFromBudget(b, first, budget, 6, `run ${first.run}, $4 asked in ${REPO_A}, inside budget ${budget} ($10)`);
  holds(await b.view(budget), `budget ${budget} holds run ${first.run}'s $4`, { reserved: 4, spent: 0, runs: [first.run] });
  later(b);
  const second = await b.paid('S1', HOSTED_RUN, 'hosted run 1');
  const two = await answeredFromBudget(b, second, budget, 1, `run ${second.run}, $5 asked in ${REPO_A}, inside budget ${budget} with $6 left`);
  holds(await b.view(budget), `budget ${budget} holds runs ${first.run} and ${second.run}`, { reserved: 9, spent: 0, runs: [first.run, second.run] });
  expect([one, two], 'each automatic answer cites a decision').toEqual([expect.stringMatching(/^decision:/), expect.stringMatching(/^decision:/)]);

  // Outside any budget you approved: a run asked in another repo reaches you, and no budget is named for it.
  later(b);
  const elsewhere = await b.paid('S3', GPU_RENDER, 'render 1');
  const what = `run ${elsewhere.run}, $1 asked in ${REPO_B}, which no budget you approved covers`;
  const card = await reachesYou(w, elsewhere.ask, what);
  expect(card.budget, `${what}: its card names no budget`).toBeNull();
  expect(elsewhere.outcome.status, `${what}: the run doesn't start`).not.toBe('started');
  holds(await b.view(budget), `budget ${budget} of ${REPO_A} is unchanged by run ${elsewhere.run}`, { reserved: 9, spent: 0, runs: [first.run, second.run] });
}

/**
 * #23.d3776517: a per-run request whose price doesn't fit what's left of the budget the resolver names, counting
 * runs reserved and not yet charged, is refused by the core and reaches you naming that budget.
 */
export async function doesNotFit(b: BudgetWorld): Promise<void> {
  const { w } = b;
  await w.start('S1', 'T1', REPO_A);
  b.prices.set(GPU_RENDER, 2);
  b.prices.set(LIVE_CALL, 7);
  b.prices.set(HOSTED_RUN, 4);
  const budget = await b.approve(REPO_A, 12);

  // $2 run, charged: $10 left.
  const charged = await b.paid('S1', GPU_RENDER, 'render 1');
  await answeredFromBudget(b, charged, budget, 10, `run ${charged.run}, $2 asked in ${REPO_A}, inside budget ${budget} ($12)`);
  await b.charge(charged.run, 2);
  later(b);
  // $7 run, reserved and not yet charged: $3 left.
  const held = await b.paid('S1', LIVE_CALL, 'live call 1');
  await answeredFromBudget(b, held, budget, 3, `run ${held.run}, $7 asked in ${REPO_A}, inside budget ${budget} with $10 left`);
  holds(await b.view(budget), `budget ${budget} spent run ${charged.run}'s $2 and holds run ${held.run}'s $7, unpriced`, { reserved: 7, spent: 2, runs: [held.run] });
  later(b);

  // $4 run: $10 left counting only what was charged, $3 counting the reservation. The core refuses; it reaches you.
  const over = await b.paid('S1', HOSTED_RUN, 'hosted run 1');
  const what = `run ${over.run}, $4, against budget ${budget} with $3 left counting run ${held.run}'s $7 reserved and not yet charged ($10 counting only what was charged)`;
  const card = await reachesYou(w, over.ask, what);
  expect(card.budget, `${what}: its card names budget ${budget} and the $3 left in it`).toEqual({ budget, left_usd: 3 });
  expect(over.outcome.status, `${what}: the run doesn't start`).not.toBe('started');
  holds(await b.view(budget), `${what}: budget ${budget} is unchanged`, { reserved: 7, spent: 2, runs: [held.run] });

  // Run held's cost reading lands at $5: $5 left, and the next $4 run fits.
  await b.charge(held.run, 5);
  later(b);
  const fits = await b.paid('S1', HOSTED_RUN, 'hosted run 2');
  await answeredFromBudget(b, fits, budget, 1, `run ${fits.run}, $4 asked in ${REPO_A} once run ${held.run}'s cost reading ($5) left $5 in budget ${budget}`);
  expect((await w.row(over.ask)).outcome, `${what}: it still waits for you`).toBe('unanswered');
}
