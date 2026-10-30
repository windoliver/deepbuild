// #332 AC3, and AC2's cap half: the spending budgets env-local declares in the core's budgets (#86), read through
// the ledger's public entry on a real record with the real asks core (ledger.ts). A budget you approved has runs, a
// dollar cap and an end date (the design's Budget shape); each run reserves its price against every budget that
// covers it, its issue's and its resource's, goes ahead without an ask while there is room, and the first run past
// either limit is the first to ask. A run over a resource's cap is BLOCKED, naming that cap.
import { afterEach, describe, expect, it } from 'vitest';
import { core, openWorld, type World } from './ledger.ts';

const ISSUE = 'windoliver/deepbuild#332';
const CHECK = 'journey:checkout';
let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

/** The asks the record holds, as ask.created events. */
const asked = async (w: World) => w.events('ask.created');

describe('AC3 #332.bc78ea57 with a budget of 10 runs and $10 approved for an issue, the eleventh run, or one that would pass $10, is the first to ask', () => {
  it('AC3 ten $0.50 runs go ahead without an ask, each charged; the eleventh, with $5 still left, is the first to ask', async () => {
    const w = (world = await openWorld());
    const budget = await w.approve({ kind: 'issue', ref: ISSUE }, 10, 10);
    w.prices.set(CHECK, 0.5);
    for (let i = 1; i <= 10; i++) {
      const { run, outcome } = await w.request(CHECK, ISSUE);
      expect(outcome.status, `run ${i} of 10 goes ahead without an ask (${JSON.stringify(outcome)})`).toBe('started');
      await w.ledger.charge(core, run, 0.5);
    }
    expect((await asked(w)).map((e) => e.data), 'no run of the first ten asked anything').toEqual([]);
    const view = await w.ledger.budget(budget);
    expect(view.left_usd, 'ten $0.50 runs leave $5 of the $10').toBeCloseTo(5, 6);

    const eleventh = await w.request(CHECK, ISSUE);
    expect(eleventh.outcome.status, `the eleventh run, past the budget's 10 runs, doesn't go ahead (${JSON.stringify(eleventh.outcome)})`).not.toBe('started');
    const ask = (eleventh.outcome as { ask?: string }).ask;
    expect(typeof ask, `the eleventh run waits on an ask (${JSON.stringify(eleventh.outcome)})`).toBe('string');
    const created = await asked(w);
    expect(created.length, 'the eleventh run is the first, and only, to ask').toBe(1);
    expect(JSON.stringify(created[0]), 'that ask is the eleventh run\'s').toContain(ask!.replace(/^ask:/, ''));
    expect((await w.ledger.budget(budget)).reservations.map((r) => r.run), 'the eleventh run reserved nothing').not.toContain(eleventh.run);
  });

  it('AC3 three $3 runs go ahead without an ask; the fourth, which would pass $10, is the first to ask', async () => {
    const w = (world = await openWorld());
    await w.approve({ kind: 'issue', ref: ISSUE }, 10, 10);
    w.prices.set(CHECK, 3);
    for (let i = 1; i <= 3; i++) {
      const { run, outcome } = await w.request(CHECK, ISSUE);
      expect(outcome.status, `run ${i} ($${3 * i} of $10) goes ahead without an ask (${JSON.stringify(outcome)})`).toBe('started');
      await w.ledger.charge(core, run, 3);
    }
    expect((await asked(w)).map((e) => e.data), 'no run of the first three asked anything').toEqual([]);
    const fourth = await w.request(CHECK, ISSUE);
    expect(fourth.outcome.status, `the fourth run would reach $12, past $10, and doesn't go ahead (${JSON.stringify(fourth.outcome)})`).not.toBe('started');
    const ask = (fourth.outcome as { ask?: string }).ask;
    expect(typeof ask, `the fourth run waits on an ask (${JSON.stringify(fourth.outcome)})`).toBe('string');
    const created = await asked(w);
    expect(created.length, 'the fourth run is the first, and only, to ask').toBe(1);
    expect(JSON.stringify(created[0]), 'that ask is the fourth run\'s').toContain(ask!.replace(/^ask:/, ''));
  });
});

describe('AC2 #332.895dd0e2 (cap) a run over a resource\'s cap is BLOCKED with the cap named', () => {
  it('AC2 a $3 run on shop-test-1, whose resource budget caps it at $2, is BLOCKED naming the resource\'s budget and its $2 cap, though its issue\'s budget has room, and reserves nothing', async () => {
    const w = (world = await openWorld());
    const issueBudget = await w.approve({ kind: 'issue', ref: ISSUE }, 10, 10);
    const accountBudget = await w.approve({ kind: 'resource', ref: 'shop-test-1' }, 10, 2);
    w.prices.set(CHECK, 3);
    const { outcome } = await w.request(CHECK, ISSUE, 'shop-test-1');
    expect(outcome.status, `the run over shop-test-1's cap is BLOCKED (${JSON.stringify(outcome)})`).toBe('BLOCKED');
    const blocked = outcome as { cause?: string; budget?: string; ask?: string };
    expect(blocked.cause, 'BLOCKED by a budget').toBe('budget');
    expect(blocked.budget, 'naming shop-test-1\'s budget, not the issue\'s').toBe(accountBudget);
    const question = JSON.stringify((await asked(w)).find((e) => JSON.stringify(e).includes(String(blocked.ask).replace(/^ask:/, '')))?.data ?? null);
    expect(question, 'the ask it raises names the resource').toContain('shop-test-1');
    expect(question, 'and the cap it would pass, $2').toMatch(/\$2(\.00)?(?!\d)/);
    expect((await w.ledger.budget(issueBudget)).reserved_usd, 'the issue\'s budget holds nothing for a run that didn\'t start').toBe(0);
    expect((await w.ledger.budget(accountBudget)).reserved_usd, 'nor does shop-test-1\'s').toBe(0);
  });
});
