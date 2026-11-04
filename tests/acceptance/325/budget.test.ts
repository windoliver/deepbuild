// #325 AC1 and AC2: one budget per issue. Checks that cost money are priced when the definition locks, the issue's
// budget ask is raised once with that price, the budget you approve is one entry in the core's ledger (#86), runs
// inside it need no further approval, and the receipt lists the spend per check (design: One budget, in What done
// means; the Budget primitive).
//
// Item 31's (and 32's) handed definition has three paid requirements, one of each kind of spend (README, Paid
// checks): a live call priced $4, a hosted browser run $3 and a model job $5, so $12.00 in all (DEEP_HUB_TEST_PRICES).
// Each guards behavior that must not change and passes, so no base run spends anything. Their runs land with cost
// readings of $3.50, $2.25 and $4.75.
import { afterEach, describe, it } from 'vitest';
import { AC1, AC2, asksRaised, cleanup, ITEM, listed, must, said, WORK_LINK } from './helpers.ts';
import { PAID, TOTAL, budgetAsked, newestReceipt, paidRuns, spendShown } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC1} three paid checks ask once, at the lock, with the total price; the budget is one ledger entry`, () => {
  it(`${AC1} item 31's definition locks with three paid checks: one ask naming ${TOTAL}; your yes makes one spend.approved for the issue; the claim's paid runs ask nothing more`, async () => {
    const b = await budgetAsked(31, AC1);
    must(b.asks.length === 1, `${AC1} the issue's budget ask is raised once, when its definition locks, for the whole issue (not once per paid check, nor none): asks raised ${listed(b.asks)}`);
    must(b.ask !== undefined, `${AC1} the one ask is the issue's budget ask, with the total price ${TOTAL} of its three paid checks: ${said(b.asks[0])}`);
    must(b.approved.length === 1, `${AC1} your yes makes the budget one entry in the core's ledger: one spend.approved after your answer: ${listed(b.approved)}`);
    const budget = b.approved[0]!.data;
    must(budget.scope?.kind === 'issue' && [ITEM(31), WORK_LINK(31), b.ref].includes(String(budget.scope?.ref)), `${AC1} the budget is the issue's (scope issue, naming ${ITEM(31)}): ${said(b.approved[0])}`);
    must(Number(budget.cap_usd) >= 12, `${AC1} the budget covers the asked price, ${TOTAL}: ${said(b.approved[0])}`);
    const { events } = await paidRuns(b);
    const later = asksRaised(events, b.since);
    must(later.length === 0, `${AC1} runs inside the budget need no further approval: no ask after your yes; raised ${listed(later)}`);
    const entries = events.filter((e) => e.kind === 'spend.approved');
    must(entries.length === 1, `${AC1} the issue's budget stays one entry in the ledger after its paid runs: ${listed(entries)}`);
  }, 300_000);
});

describe(`${AC2} the receipt lists the spend per check`, () => {
  it(`${AC2} after the claim's three paid runs land with costs of $3.50, $2.25 and $4.75, the claim's receipt (changes.read) lists each check with its spend`, async () => {
    const b = await budgetAsked(32, AC2);
    const { events, since } = await paidRuns(b);
    const shown = await newestReceipt(b.hub, events, b.ref, since);
    must(shown !== undefined, `BLOCKED: ${AC2} the stop's claim has a receipt (changes.read): claims ${listed(events.filter((e) => e.kind === 'claim.made' && e.log_pos > since))}`);
    for (const p of PAID) {
      must(spendShown(shown!.change, p.check.file, p.cost), `${AC2} the receipt of ${shown!.claim} lists ${p.check.file} (${p.paid}) with its spend, $${p.cost.toFixed(2)}: second line ${JSON.stringify(shown!.change.second)}; checks ${JSON.stringify(shown!.change.checks).slice(0, 800)}`);
    }
  }, 300_000);
});
