// #84 ON_ITS_OWN and GOES_ON: taste calls and choices are provisional (design: Work goes on while you decide). The
// sessions work on items with R1 failing or a store still to pick, so no stop here is a PASS.
import { afterAll, afterEach, describe, it } from 'vitest';
import {
  EXPIRED, GOES_ON, Inconclusive, ON_ITS_OWN, STORE, answered, asksOf, cleanup, item, lastPos, listed, loaded, loadReading, makeWorld, must, needsYou, optionMatching, replyText,
  said, Session, settle, startHub, startOnItem, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);
afterAll(cleanup, 60_000);

describe(`${ON_ITS_OWN} a choice the final message says the agent made on its own becomes a provisional choice card, never only a line in the report`, () => {
  it(`${ON_ITS_OWN} "I chose the cookie store for R1; say if you'd rather the header store" is a provisional choice in Needs you, recommending what it chose; a report that chose nothing makes no card`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(861, [STORE, EXPIRED]), item(862, [STORE, EXPIRED])] });
    const hub = await startHub(w);
    const s = new Session(w);
    await startOnItem(hub, s, 861, ON_ITS_OWN);
    await s.edit('src/store.js', 'kind: null', "kind: 'cookie'");
    const since = await lastPos(hub);
    await s.stop("I chose the cookie store for R1; say if you'd rather the header store.");
    const events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice'));
    const card = asksOf(events, s, since).find((a) => a.data.kind === 'choice');
    must(card !== undefined, `${ON_ITS_OWN} the choice the agent made on its own becomes a choice card, never only a line in the report: ${listed(asksOf(events, s, since))}`);
    must(card.data.provisional === true, `${ON_ITS_OWN} the card is provisional, since the agent went on with what it chose: ${said(card)}`);
    const cookie = optionMatching(card, /cookie/i);
    must(cookie !== undefined && optionMatching(card, /header/i) !== undefined, `${ON_ITS_OWN} the card offers what it chose and what you'd rather: ${said(card)}`);
    must(card.data.recommended === cookie.id, `${ON_ITS_OWN} the card recommends what the agent chose, ${cookie.id}: ${said(card)}`);
    const rows = await needsYou(hub);
    must(rows.some((r) => r.ask === `ask:${card.id}`), `${ON_ITS_OWN} the card is in Needs you: ${JSON.stringify(rows).slice(0, 400)}`);

    // The twin: a hub that makes a card of every report fails here.
    const plain = new Session(w);
    await startOnItem(hub, plain, 862, ON_ITS_OWN);
    await plain.bump();
    const before = await lastPos(hub);
    await plain.stop('The store is in place. Nothing else changed.');
    const after = await settle(hub, () => false, 2000);
    must(!asksOf(after, plain, before).some((a) => a.data.kind === 'choice'), `${ON_ITS_OWN} a report that names no choice makes no card: ${listed(asksOf(after, plain, before))}`);
  }), 600_000);
});

describe(`${GOES_ON} a choice between options goes on at once with the recommended one, and your later answer switches it`, () => {
  it(`${GOES_ON} deep_ask with two options returns the recommended one at once, marked as undoable, the card stays yours; your answer reaches the agent at its next stop, switching it`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(871, [STORE, EXPIRED])] });
    const hub = await startHub(w);
    const s = new Session(w);
    await startOnItem(hub, s, 871, GOES_ON);
    await s.bump();
    const since = await lastPos(hub);
    const asked = await s.deepAsk({ kind: 'choice', question: 'Which session store should R1 use?', recommended: 'cookie', options: [{ id: 'cookie', label: 'The cookie store' }, { id: 'header', label: 'The header store' }] });
    must(asked.allowed, `BLOCKED: ${GOES_ON} the agent's deep_ask must be allowed`);
    const value = JSON.stringify(asked.value) ?? '';
    must(!/still waiting|"waiting"/i.test(value), `${GOES_ON} a choice between options never waits on you: deep_ask said ${value.slice(0, 400)}`);
    must(/cookie/.test(value), `${GOES_ON} the agent goes on with the recommended option, which deep_ask names: ${value.slice(0, 400)}`);
    must(/undo|provisional/i.test(value), `${GOES_ON} the option is marked as undoable: ${value.slice(0, 400)}`);
    if (asked.ms >= 15_000 && loaded()) throw new Inconclusive(`deep_ask took ${(asked.ms / 1000).toFixed(1)} s, ${loadReading()}`);
    must(asked.ms < 15_000, `${GOES_ON} goes on at once: deep_ask took ${(asked.ms / 1000).toFixed(1)} s`);

    const events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'choice'));
    const ask = asksOf(events, s, since).find((a) => a.data.kind === 'choice');
    must(ask !== undefined && ask.data.provisional === true, `${GOES_ON} the choice stays yours, provisional: ${listed(asksOf(events, s, since))}`);
    must((await needsYou(hub)).some((r) => r.ask === `ask:${ask.id}`), `${GOES_ON} the card is in Needs you`);

    await answered(w, ask, 'header', GOES_ON);
    const said2 = replyText(await s.stop('I went on with the cookie store.'));
    must(/header/i.test(said2) && /cookie/i.test(said2), `${GOES_ON} your later answer switches it: the agent's next stop hears the header store in place of the cookie store: ${said2.slice(0, 500)}`);
  }), 600_000);
});
