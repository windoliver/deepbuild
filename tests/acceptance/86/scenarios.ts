// The scenarios of the #86 criteria, shared by the criterion tests and plants.test.ts. Each drives the real
// ledger through its public entry and throws, at an assertion naming what the criterion names, when the
// program under it is wrong.

import { expect } from 'vitest';
import type { BudgetView, Outcome, Reserved } from '../../../packages/budget/src/index.ts';
import {
  agent, core, DAY, decisionId, GPU, GPU_RENDER, HOSTED_RUN, inputs, ISSUE_A, ISSUE_B, ISSUE_C, ISSUE_UNBUDGETED, LIVE_CALL,
  card, flush, plantedExt, refused, request, reservedRuns, resolverExt, runId, shownAsks, sorted, T0, type World,
} from './helpers.ts';

/** The ledger's view of a budget, which must be there. */
async function viewOf(w: World, budget: string, what: string): Promise<BudgetView> {
  const view = await w.ledger.budget(budget);
  expect(view, `the ledger shows ${what} (${budget})`).toMatchObject({ budget });
  return view;
}
/** What a budget holds: its cap, the reservations it holds and what it has spent, as the ledger shows them. */
function holds(view: BudgetView, what: string, expected: { reserved: number; spent: number; runs: string[] }): void {
  expect({ reserved: view.reserved_usd, spent: view.spent_usd, left: view.left_usd, runs: reservedRuns(view) }, `${what} (${view.budget})`).toEqual({
    reserved: expected.reserved, spent: expected.spent, left: view.cap_usd - expected.reserved - expected.spent, runs: [...expected.runs].sort(),
  });
}
const statusOf = (o: Outcome | undefined): string => String((o as { status?: unknown } | undefined)?.status);
const askOf = (o: Outcome | undefined): unknown => (o as { ask?: unknown } | undefined)?.ask;

// ---- #86.fb5b8d9b: three paid runs at once against a budget with room for two.
export async function threeAtOnce(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 4);
  const budget = await w.approve('issue', ISSUE_A, 10);
  const runs = [runId(), runId(), runId()];
  const outcomes = await Promise.all(runs.map((run, i) => w.ledger.request(core, request(run, LIVE_CALL, inputs(`call ${i}`), ISSUE_A))));
  const went = outcomes.filter((o) => statusOf(o) === 'started');
  const stopped = outcomes.filter((o) => statusOf(o) === 'BLOCKED');
  expect(went.map((o) => o.run).length, `of three $4 runs at once against budget ${budget} with $10, two start`).toBe(2);
  expect(stopped.length, `of three $4 runs at once against budget ${budget} with $10, the third is BLOCKED`).toBe(1);
  expect(stopped[0], `the third run is BLOCKED with the cause budget, owner you, naming budget ${budget}`).toMatchObject({ status: 'BLOCKED', cause: 'budget', owner: 'you', budget });
  for (const o of went) expect(o, `run ${o.run} reserved its $4 against budget ${budget} before it started`).toMatchObject({ reserved: [{ budget, usd: 4 }] });
  const view = await viewOf(w, budget, 'the issue budget');
  expect(view.reserved_usd + view.spent_usd, `budget ${budget}: the cap is never passed`).toBeLessThanOrEqual(view.cap_usd);
  holds(view, 'two reservations held, one per run that started', { reserved: 8, spent: 0, runs: went.map((o) => o.run) });
  for (const o of went) await w.ledger.charge(core, o.run, 4);
  holds(await viewOf(w, budget, 'the issue budget'), 'both charged once their cost readings landed', { reserved: 0, spent: 8, runs: [] });
  const again = await w.ledger.request(core, request(stopped[0]!.run, LIVE_CALL, inputs('call again'), ISSUE_A));
  expect(again, `with $2 left in budget ${budget}, a $4 run is still BLOCKED: the cap is never passed`).toMatchObject({ status: 'BLOCKED', cause: 'budget', budget });
  holds(await (await w.reopened()).budget(budget), 'the record keeps the ledger: a ledger opened on it reads the same', { reserved: 0, spent: 8, runs: [] });
}

// ---- #86.80a13633: a price nobody knows is BLOCKED naming it; a reservation is released only by its cost reading.
export async function unknownPrice(w: World): Promise<void> {
  const budget = await w.approve('issue', ISSUE_A, 10);
  const run = runId();
  const outcome = await w.ledger.request(core, request(run, HOSTED_RUN, inputs('journey'), ISSUE_A));
  expect(outcome, `run ${run}, whose check ${HOSTED_RUN} has no known price, is BLOCKED for its price`).toMatchObject({ status: 'BLOCKED', cause: 'price' });
  expect(String((outcome as { missing?: unknown }).missing), `the BLOCKED run names the missing price, of check ${HOSTED_RUN}`).toContain(HOSTED_RUN);
  holds(await viewOf(w, budget, 'the issue budget'), 'a run with no known price is never counted as free: it holds nothing and spends nothing', { reserved: 0, spent: 0, runs: [] });
  w.prices.set(HOSTED_RUN, 6);
  const priced = await w.ledger.request(core, request(run, HOSTED_RUN, inputs('journey'), ISSUE_A));
  expect(priced, `once check ${HOSTED_RUN} is priced at $6, run ${run} reserves it and starts`).toMatchObject({ status: 'started', reserved: [{ budget, usd: 6 }] });
}
export async function releasedOnlyOnCost(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 4);
  const budget = await w.approve('issue', ISSUE_A, 10);
  const run = runId();
  const outcome = await w.ledger.request(core, request(run, LIVE_CALL, inputs('call'), ISSUE_A));
  expect(outcome, `run ${run} reserves its $4 and starts`).toMatchObject({ status: 'started', reserved: [{ budget, usd: 4 }] });
  await w.finished(run, LIVE_CALL, 'passed');
  w.clock.set(T0 + 2 * 3_600_000);
  holds(await viewOf(w, budget, 'the issue budget'), `run ${run} ended with no cost reading: its reservation still holds, unpriced`, { reserved: 4, spent: 0, runs: [run] });
  holds(await (await w.reopened()).budget(budget), `a ledger opened on the record still holds run ${run}'s reservation`, { reserved: 4, spent: 0, runs: [run] });
  await w.ledger.charge(core, run, 3.5);
  holds(await viewOf(w, budget, 'the issue budget'), `run ${run}'s cost reading landed: it is charged $3.50 and its reservation released`, { reserved: 0, spent: 3.5, runs: [] });
  holds(await (await w.reopened()).budget(budget), 'a ledger opened on the record reads the charge', { reserved: 0, spent: 3.5, runs: [] });
}

// ---- #86.54597aa8: an agent's own batch of paid runs inside the budget asks nothing.
export async function agentBatch(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 2);
  const budget = await w.approve('issue', ISSUE_A, 20);
  const runs = [runId(), runId(), runId(), runId(), runId()];
  const outcomes = await Promise.all(runs.map((run, i) => w.ledger.request(agent('S1'), request(run, LIVE_CALL, inputs(`agent call ${i}`), ISSUE_A))));
  expect(outcomes.map(statusOf), `the agent's batch of five $2 live runs inside budget ${budget} ($20) all start`).toEqual(runs.map(() => 'started'));
  for (const run of runs) await w.ledger.charge(core, run, 2);
  await w.asks.tick();
  const asked = await w.events('ask.created');
  expect(asked.map((e) => (e.data as { question?: unknown }).question), "an agent's own batch of paid runs inside the budget asks nothing").toEqual([]);
  expect(await shownAsks(w), 'Needs you shows nothing for the batch').toEqual([]);
  holds(await viewOf(w, budget, 'the issue budget'), 'the batch is charged to the budget', { reserved: 0, spent: 10, runs: [] });
}

// ---- #86.3dccb0b7: a failed paid run is never re-run on the same inputs without a change or your yes.
export async function failedNotRerun(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 4);
  const budget = await w.approve('issue', ISSUE_A, 20);
  const same = inputs('checkout call, card 4242');
  const first = runId();
  expect(await w.ledger.request(core, request(first, LIVE_CALL, same, ISSUE_A)), `run ${first} starts`).toMatchObject({ status: 'started' });
  await w.ledger.charge(core, first, 4);
  await w.finished(first, LIVE_CALL, 'failed');
  const rerun = runId();
  const outcome = await w.ledger.request(core, request(rerun, LIVE_CALL, same, ISSUE_A));
  expect(statusOf(outcome), `run ${rerun} re-runs failed run ${first} on the same inputs without a change or your yes`).not.toBe('started');
  const ask = askOf(outcome);
  expect(typeof ask, `run ${rerun} waits on your yes: its outcome names the ask`).toBe('string');
  expect(await shownAsks(w), `the ask for your yes on run ${rerun} reaches you`).toContain(ask);
  holds(await viewOf(w, budget, 'the issue budget'), `run ${rerun}, which didn't start, holds no reservation`, { reserved: 0, spent: 4, runs: [] });
  const changed = runId();
  expect(await w.ledger.request(core, request(changed, LIVE_CALL, inputs('checkout call, card 4000'), ISSUE_A)), `run ${changed}, on changed inputs, starts without asking`)
    .toMatchObject({ status: 'started', reserved: [{ budget, usd: 4 }] });
  const shown = await w.asks.card(ask as string);
  const yes = shown.options.find((o) => o.decision === 'allow');
  expect(yes, `the ask for your yes on run ${rerun} has an option that allows it`).toBeDefined();
  await w.asks.answer(card, ask as string, { option: yes!.id, token: 'click-1', ...(shown.plan ? { plan_hash: shown.plan.hash } : {}) });
  const afterYes = runId();
  expect(await w.ledger.request(core, request(afterYes, LIVE_CALL, same, ISSUE_A)), `with your yes, run ${afterYes} re-runs the failed inputs`).toMatchObject({ status: 'started' });
}

// ---- #86.40d0717c: a $3 run on a GPU against both budgets; a second one blocked by the GPU's budget.
export async function gpuAndIssue(w: World): Promise<void> {
  w.prices.set(GPU_RENDER, 3);
  const gpu = await w.approve('resource', GPU, 5);
  const a = await w.approve('issue', ISSUE_A, 10);
  await w.approve('issue', ISSUE_B, 10);
  const first = runId();
  const outcome = await w.ledger.request(core, request(first, GPU_RENDER, inputs('frame 1'), ISSUE_A, GPU));
  expect(statusOf(outcome), `run ${first}, $3 on the GPU for issue ${ISSUE_A}, starts`).toBe('started');
  expect(sorted((outcome as { reserved?: Reserved[] }).reserved ?? []), `run ${first} reserves $3 against both the GPU's budget ${gpu} and the issue's ${a}`)
    .toEqual(sorted([{ budget: gpu, usd: 3 }, { budget: a, usd: 3 }]));
  holds(await viewOf(w, gpu, "the GPU's budget"), "the GPU's budget holds run 1's $3", { reserved: 3, spent: 0, runs: [first] });
  holds(await viewOf(w, a, "issue A's budget"), "issue A's budget holds run 1's $3", { reserved: 3, spent: 0, runs: [first] });
  const second = runId();
  const next = await w.ledger.request(core, request(second, GPU_RENDER, inputs('frame 2'), ISSUE_B, GPU));
  expect(next, `run ${second}, $3 on the GPU for issue ${ISSUE_B} with room in its budget, is BLOCKED with the cause budget, naming the GPU's budget ${gpu}`)
    .toMatchObject({ status: 'BLOCKED', cause: 'budget', owner: 'you', budget: gpu });
}

// ---- #86.020ce247: a test resolver names a budget; the core checks what's left, counting reservations.
export async function resolverNamesBudget(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 8);
  w.prices.set(HOSTED_RUN, 3);
  const live = await w.approve('work', 'paid-checks/live-calls', 10);
  const spare = await w.approve('work', 'paid-checks/spare', 5);
  /** The test resolver: it answers a paid run's request for you by naming a budget. */
  const resolve = (ask: string, budget: string) => w.ledger.resolve(resolverExt, ask, { decision: decisionId(), budget });
  const asked = async (run: string, check: string, what: string): Promise<string> => {
    const outcome = await w.ledger.request(agent('S1'), request(run, check, inputs(what), ISSUE_UNBUDGETED));
    expect(outcome, `run ${run}, which no approved budget covers, is a request that waits on an ask`).toMatchObject({ status: 'asked' });
    return String(askOf(outcome));
  };
  const decidedFor = async (ask: string): Promise<boolean> => (await w.events('decision.applied')).some((e) => e.writer === 'core' && (e.data as { ask?: unknown }).ask === ask);
  const asksRow = async (ask: string) => (await w.record.table('asks')).rows.find((r) => `ask:${String(r.id)}` === ask);

  // Room: the run reserves its price against the named budget and starts, logged as decided for you.
  const first = runId();
  const ask0 = await asked(first, LIVE_CALL, 'live call 1');
  expect(await resolve(ask0, live), `named budget ${live} has $10 for run ${first}'s $8: it reserves and starts`).toMatchObject({ status: 'started', reserved: [{ budget: live, usd: 8 }] });
  expect(await decidedFor(ask0), `ask ${ask0} is logged as decided for you: a decision.applied from the core names it`).toBe(true);
  expect((await asksRow(ask0))?.outcome, `ask ${ask0} closes as decided for you`).toBe('decided_for_you');
  expect(await shownAsks(w), `ask ${ask0}, decided for you, doesn't wait in Needs you`).not.toContain(ask0);

  // No room, counting the $8 reservation: refused by the core, and the ask reaches you.
  const second = runId();
  const ask1 = await asked(second, HOSTED_RUN, 'hosted run 1');
  await refused(resolve(ask1, live), { budget: live }, `the resolver names budget ${live}, with $2 left after run ${first}'s reservation, for run ${second}'s $3`);
  expect(await decidedFor(ask1), `the refused answer to ask ${ask1} isn't logged as decided for you`).toBe(false);
  expect(await shownAsks(w), `ask ${ask1} reaches you`).toContain(ask1);
  holds(await viewOf(w, live, 'the named budget'), `named budget ${live} is unchanged by the refused answer`, { reserved: 8, spent: 0, runs: [first] });

  // Room in another budget: a third run, answered by naming it, reserves and starts.
  const third = runId();
  const ask2 = await asked(third, HOSTED_RUN, 'hosted run 2');
  expect(await resolve(ask2, spare), `named budget ${spare} has $5 for run ${third}'s $3: it reserves and starts`).toMatchObject({ status: 'started', reserved: [{ budget: spare, usd: 3 }] });
  expect(await decidedFor(ask2), `ask ${ask2} is logged as decided for you`).toBe(true);
  holds(await viewOf(w, spare, 'the spare budget'), `budget ${spare} holds run ${third}'s $3`, { reserved: 3, spent: 0, runs: [third] });
}

// ---- #86.97e5a476: a planted extension charges a run that never reserved.
export async function plantedCharge(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 4);
  w.prices.set(HOSTED_RUN, 20);
  const budget = await w.approve('issue', ISSUE_A, 10);
  const reserved = runId();
  expect(await w.ledger.request(core, request(reserved, LIVE_CALL, inputs('call'), ISSUE_A)), `run ${reserved} starts`).toMatchObject({ status: 'started' });
  const turnedAway = runId();
  expect(await w.ledger.request(core, request(turnedAway, HOSTED_RUN, inputs('journey'), ISSUE_A)), `run ${turnedAway}, $20 against $6 left, is BLOCKED`).toMatchObject({ status: 'BLOCKED' });
  const before = structuredClone(await viewOf(w, budget, 'the issue budget'));
  const never = runId();
  for (const run of [never, turnedAway]) {
    await refused(w.ledger.charge(plantedExt, run, 5), { run }, `a planted extension reports a $5 charge for run ${run}, which never reserved`);
  }
  expect(await viewOf(w, budget, 'the issue budget'), `budget ${budget}: the ledger is unchanged by the refused charges`).toEqual(before);
  expect(await (await w.reopened()).budget(budget), `budget ${budget}: the record holds no trace of the refused charges in the ledger`).toEqual(before);
}

// ---- #86.60e70718: three GPU runs with the price lookup held open, released in an order.
export const ISSUES = [ISSUE_A, ISSUE_B, ISSUE_C] as const;
export function gpuRace(order: readonly number[]): (w: World) => Promise<void> {
  return async (w) => {
    w.prices.set(GPU_RENDER, 3);
    // The issues' budgets are approved before the GPU's, so a ledger that reserves budget by budget in
    // approval order takes the issue's first; the property test in concurrent.test.ts covers the other order.
    const issues = [] as string[];
    for (const issue of ISSUES) issues.push(await w.approve('issue', issue, 10));
    const gpu = await w.approve('resource', GPU, 6);
    const runs = ISSUES.map(() => runId());
    w.hold(true);
    const pending = runs.map((run, i) => w.ledger.request(core, request(run, GPU_RENDER, inputs(`frame ${i}`), ISSUES[i]!, GPU)));
    await w.heldUntil(3);
    const byRun = new Map(w.held.map((h) => [h.request.run, h]));
    for (const i of order) {
      byRun.get(runs[i]!)?.release();
      await flush();
    }
    w.hold(false);
    const outcomes = await Promise.all(pending);
    const label = `released in the order ${order.map((i) => i + 1).join(', ')}`;
    expect(outcomes.map(statusOf).sort(), `${label}: two of three $3 runs start against the GPU's $6, and one is BLOCKED`).toEqual(['BLOCKED', 'started', 'started']);
    const i = outcomes.findIndex((o) => statusOf(o) === 'BLOCKED');
    expect(outcomes[i], `${label}: run ${runs[i]} is BLOCKED with the cause budget, naming the GPU's budget ${gpu}`).toMatchObject({ status: 'BLOCKED', cause: 'budget', owner: 'you', budget: gpu });
    for (const view of [await viewOf(w, issues[i]!, 'the blocked run\'s issue budget'), await (await w.reopened()).budget(issues[i]!)]) {
      expect({ reserved: view.reserved_usd, left: view.left_usd, runs: reservedRuns(view) }, `${label}: the budget ${issues[i]} of issue ${ISSUES[i]}, whose run was BLOCKED by the GPU's budget, is whole, with no reservation held`)
        .toEqual({ reserved: 0, left: 10, runs: [] });
    }
    const went = runs.filter((_, j) => j !== i);
    holds(await viewOf(w, gpu, "the GPU's budget"), `${label}: the GPU's budget holds the two runs that started, and its cap is never passed`, { reserved: 6, spent: 0, runs: went });
    for (const [j, o] of outcomes.entries()) {
      if (j === i) continue;
      expect(sorted((o as { reserved?: Reserved[] }).reserved ?? []), `${label}: run ${runs[j]} reserved $3 against both its issue's budget and the GPU's`)
        .toEqual(sorted([{ budget: gpu, usd: 3 }, { budget: issues[j]!, usd: 3 }]));
    }
  };
}
/** An unanswered budget raise takes no at its 1-day deadline. */
export async function raiseDefaultsNo(w: World): Promise<void> {
  w.prices.set(LIVE_CALL, 4);
  const budget = await w.approve('issue', ISSUE_A, 5);
  expect(await w.ledger.request(core, request(runId(), LIVE_CALL, inputs('call 1'), ISSUE_A)), 'the first $4 run starts').toMatchObject({ status: 'started' });
  const run = runId();
  const outcome = await w.ledger.request(core, request(run, LIVE_CALL, inputs('call 2'), ISSUE_A));
  expect(outcome, `run ${run}, $4 against $1 left, is BLOCKED with the cause budget`).toMatchObject({ status: 'BLOCKED', cause: 'budget', owner: 'you', budget });
  const ask = askOf(outcome);
  expect(typeof ask, `the BLOCKED run names the budget raise it waits on, one authority ask`).toBe('string');
  expect((await w.asks.card(ask as string)).kind, `the budget raise ${String(ask)} is an authority ask`).toBe('authority');
  const created = (await w.events('ask.created')).find((e) => `ask:${e.id}` === ask);
  expect((created?.data as { deadline?: unknown } | undefined)?.deadline, `the budget raise ${String(ask)} has a 1-day deadline`).toBe(T0 + DAY);
  w.clock.set(T0 + DAY);
  await w.asks.tick();
  const closes = (await w.events()).filter((e) => e.subject === ask && e.kind.startsWith('ask.'));
  expect(closes.map((e) => [e.kind, (e.data as { decision?: unknown }).decision]), `the unanswered budget raise ${String(ask)} takes no at its deadline`).toEqual([['ask.defaulted', 'deny']]);
  expect((await viewOf(w, budget, 'the issue budget')).cap_usd, `budget ${budget} isn't raised by the default`).toBe(5);
  expect(await w.ledger.request(core, request(runId(), LIVE_CALL, inputs('call 3'), ISSUE_A)), `budget ${budget} still has $1 left: a $4 run is BLOCKED`).toMatchObject({ status: 'BLOCKED', cause: 'budget', budget });
}
