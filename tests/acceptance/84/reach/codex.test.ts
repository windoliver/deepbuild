// #84 BUDGET_CARD and DEFAULT_CARD: Codex `request_user_input` cards, caught at PreToolUse and answered by a block reason
// (design: Questions at the stop). The card's shape is the tool's input, which adapters/codex.facts.json names under
// questionTools; the corpus holds no such card (README, Codex cards).
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  BUDGET_CARD, CHECKS, CRITERIA, DEFAULT_CARD, EXPIRED, STORE, answered, asksIn, asksOf, cardQuestion, cleanup, CodexSession, decision, item, lastPos, listed, makeWorld, must,
  needsYou, optionMatching, replyText, said, settle, shown, startCodexOnItem, startHub, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

describe(`${BUDGET_CARD} a Codex card approving a run inside the budget never reaches you`, () => {
  it(`${BUDGET_CARD} with the issue's budget approved, a card for its paid check is answered by a block reason naming the budget; a card for a run no budget covers still reaches you`, async (ctx) => verdict(ctx, async () => {
    const paid = { text: CRITERIA.live, check: CHECKS.live, on_base: 'passes' as const, paid: 'live call' as const };
    const prices = { '.deepbuild/checks/live-quote.sh': 0.4, '.deepbuild/checks/model-review.sh': 25 };
    const w = makeWorld({ items: [item(881, [paid, EXPIRED])], prices: { prices, costs: prices } });
    const hub = await startHub(w);
    const s = new CodexSession(w);
    await startCodexOnItem(hub, s, 881, BUDGET_CARD);
    let events = await settle(hub, (all) => asksIn(all).some((a) => a.data.kind === 'authority'));
    const budget = asksIn(events).find((a) => a.data.kind === 'authority');
    must(budget !== undefined, `BLOCKED: ${BUDGET_CARD} the definition's paid check asks for the issue's budget (#325): ${listed(asksIn(events))}`);
    const yes = optionMatching(budget, /approve/i);
    must(yes !== undefined, `BLOCKED: ${BUDGET_CARD} the budget ask offers a yes: ${said(budget)}`);
    await answered(w, budget, yes.id, BUDGET_CARD);
    events = await settle(hub, (all) => all.some((e) => e.kind === 'spend.approved'));
    must(events.some((e) => e.kind === 'spend.approved'), `BLOCKED: ${BUDGET_CARD} your yes makes the budget: ${listed(events.filter((e) => e.kind.startsWith('spend.')))}`);

    const since = await lastPos(hub);
    const reply = await s.card([cardQuestion('run', 'Paid run', 'Run the paid live-quote check now? It costs $0.40.', ['Run it', 'Skip it'])]);
    must(decision(reply) === 'deny', `${BUDGET_CARD} the card is answered by a block reason, so it never shows: ${shown(reply)}`);
    const text = replyText(reply);
    must(/budget/i.test(text) && text.includes('live-quote'), `${BUDGET_CARD} the block reason says the budget covers the live-quote run: ${text.slice(0, 500)}`);
    const after = await settle(hub, () => false, 2000);
    must(asksOf(after, s, since).length === 0, `${BUDGET_CARD} nothing reaches you: ${listed(asksOf(after, s, since))}`);

    // The twin: a hub that answers every card from the budget fails here.
    const before = await lastPos(hub);
    const twin = await s.card([cardQuestion('run', 'Paid run', 'Run the paid model-review check now? It costs $25.00.', ['Run it', 'Skip it'])]);
    const out = await settle(hub, (all) => asksOf(all, s, before).length > 0);
    must(asksOf(out, s, before).some((a) => a.data.kind === 'authority'), `${BUDGET_CARD} a run no budget covers is yours to approve, as one authority ask: ${listed(asksOf(out, s, before))}; the card: ${shown(twin)}`);
  }), 600_000);
});

describe(`${DEFAULT_CARD} a Codex card that asks a choice with a stated default never waits on you: the agent carries on with the default, marked as undoable, and your later answer undoes it`, () => {
  it(`${DEFAULT_CARD} the card is answered at PreToolUse with the cookie store, marked as undoable, and stays yours as a provisional choice; your answer tells the agent to undo it`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(891, [STORE, EXPIRED])] });
    const hub = await startHub(w);
    const s = new CodexSession(w);
    await startCodexOnItem(hub, s, 891, DEFAULT_CARD);
    const since = await lastPos(hub);
    const reply = await s.card([cardQuestion('store', 'Session store', 'Which session store should R1 use? The default is the cookie store.', ['Cookie store (default)', 'Header store'])]);
    must(decision(reply) === 'deny', `${DEFAULT_CARD} the card never waits on you: it is answered by a block reason at PreToolUse: ${shown(reply)}`);
    const text = replyText(reply);
    must(/cookie/i.test(text), `${DEFAULT_CARD} the agent carries on with the default, which the reason names: ${text.slice(0, 500)}`);
    must(/undo|provisional/i.test(text), `${DEFAULT_CARD} the default is marked as undoable: ${text.slice(0, 500)}`);

    const events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice'));
    const ask = asksOf(events, s, since).find((a) => a.data.kind === 'choice');
    must(ask !== undefined && ask.data.provisional === true, `${DEFAULT_CARD} the choice stays yours, provisional: ${listed(asksOf(events, s, since))}`);
    const header = optionMatching(ask, /header/i);
    const cookie = optionMatching(ask, /cookie/i);
    must(header !== undefined && cookie !== undefined && ask.data.recommended === cookie.id, `${DEFAULT_CARD} the card keeps both options and recommends the stated default: ${said(ask)}`);
    must((await needsYou(hub)).some((r) => r.ask === `ask:${ask.id}`), `${DEFAULT_CARD} the card is in Needs you`);

    await s.patch('src/store.js', 'kind: null', "kind: 'cookie'");
    await answered(w, ask, header.id, DEFAULT_CARD);
    const heard = `${await s.shell('git status')}\n${replyText(await s.stop('The cookie store is in.'))}`;
    must(/header/i.test(heard) && /cookie/i.test(heard), `${DEFAULT_CARD} your later answer undoes the default: the agent hears the header store in place of the cookie store at its next hook: ${heard.slice(0, 500)}`);
  }), 600_000);
});
