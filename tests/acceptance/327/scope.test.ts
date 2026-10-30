// AC1 #327.fab7d30b: before the card arms, an answer that will be saved as a decision shows its scope in words and
// how many open asks it will also answer; with two matching asks open the card says it answers 2 more, and answering
// closes exactly those two as decided for you; a third that comes to match while the card shows doesn't change the
// card and is listed on its receipt. A card that shows no scope, or a count that changes while it shows, fails.
//
// The in-process half: the asks core's Card carries what the card says (`saves`, fixed when presented) and what its
// receipt lists (`receipt.also`); the record shows what the answer closed. The words on the replica's card and the
// receipt's one line with Undo are card.rs (ac1_…). At the base Card has neither field, so the first assertion
// fails naming it.
import { describe, expect, it } from 'vitest';
import type { Asks } from '../../../packages/asks/src/index.ts';
import { AC1, commit, data, decidedBy, inWorld, shown, staysOpen, tasteAsk, type CardSeen, type Planting, type World } from './helpers.ts';

const REPO = 'shop';
const SCREEN = 'checkout';
const STEP = 'total';

/** Four sessions of one repo; three taste calls on the same screen and step, each pinned to its own commit, plus one on another element. */
async function presented(w: World): Promise<{ first: string; second: string; third: string; other: string }> {
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5']) await w.start(s, `thread-${s}`, REPO);
  const first = await w.raise('S1', 'deep_ask.taste', tasteAsk('Darker header on the checkout total?', SCREEN, STEP, commit('one'), w.clock.now()));
  w.clock.advance(1000);
  const second = await w.raise('S2', 'deep_ask.taste', tasteAsk('Header colour over the total?', SCREEN, STEP, commit('two'), w.clock.now()));
  w.clock.advance(1000);
  const third = await w.raise('S3', 'deep_ask.taste', tasteAsk('Which header on the total line?', SCREEN, STEP, commit('three'), w.clock.now()));
  w.clock.advance(1000);
  const other = await w.raise('S5', 'deep_ask.taste', tasteAsk('Which header on the cart badge?', SCREEN, 'badge', commit('five'), w.clock.now()));
  for (const ask of [first, second, third, other]) await staysOpen(w, ask, 'before you answer');
  return { first, second, third, other };
}

/** What the card says it will save, read from the card; fails naming the field when the card says nothing. */
function savesOf(c: CardSeen, what: string): { scope: string; also: number } {
  expect(c.saves, `${what}: the card ${c.ask} says, before it arms, what the answer will be saved as (Card.saves: {scope, also}); got ${shown(c.saves)}`).toBeTruthy();
  const s = c.saves!;
  expect(typeof s.scope === 'string' && s.scope.length > 0, `${what}: the scope is said in words: ${shown(s)}`).toBe(true);
  expect(Number.isInteger(s.also), `${what}: how many open asks it also answers is a count: ${shown(s)}`).toBe(true);
  return s;
}

async function scenario(w: World): Promise<string[]> {
  const failures: string[] = [];
  const { first, second, third, other } = await presented(w);
  const before = await w.card(first);
  const said = savesOf(before, 'with two matching asks open');
  // The scope in words: it names the repo the decision is saved for.
  if (!/\brepo\b/i.test(said.scope) || !said.scope.includes(REPO)) failures.push(`the card's scope "${said.scope}" doesn't say in words that the answer is saved for the repo ${REPO}`);
  if (said.also !== 2) failures.push(`with two matching asks open the card says it answers ${said.also} more, not 2`);

  // A fourth comes to match while the card shows: the card doesn't change.
  w.clock.advance(5000);
  const fourth = await w.raise('S4', 'deep_ask.taste', tasteAsk('Header on the total, take four?', SCREEN, STEP, commit('four'), w.clock.now()));
  await staysOpen(w, fourth, 'a fourth that comes to match while the card shows');
  const during = await w.card(first);
  const now = savesOf(during, 'while the card shows, after a third match arrived');
  if (now.also !== said.also || now.scope !== said.scope) failures.push(`the count changed while the card showed: it said ${shown(said)} when presented and ${shown(now)} after ${fourth} came to match`);

  // You answer: the two that were open when the card was presented close as decided for you, and so does the fourth,
  // which the receipt lists; the one on another element stays open.
  w.clock.advance(1000);
  await w.answer(first, { option: 'green' });
  const answered = await w.answered(first, 'your answer');
  expect(data(answered).answer, 'your answer is recorded').toBe('green');
  const saved = await w.savedFrom(first);
  expect(saved.map((e) => data(e).scope), 'your answer is saved as one decision for the repo').toEqual([`repo:${REPO}`]);
  const decision = `decision:${saved[0]!.id}`;
  for (const ask of [second, third]) await decidedBy(w, ask, decision, 'green', 'one of the two the card counted');
  await decidedBy(w, fourth, decision, 'green', 'the one that came to match while the card showed');
  await staysOpen(w, other, 'the ask on another element');
  const after = await w.card(first);
  expect(after.receipt, `the answered card keeps a receipt (Card.receipt: {answer, also}); got ${shown(after.receipt)}`).toBeTruthy();
  const also = after.receipt!.also;
  if (!also.includes(fourth)) failures.push(`the receipt lists ${shown(also)}, not the ask that came to match while the card showed, ${fourth}`);
  for (const ask of [second, third]) if (!also.includes(ask)) failures.push(`the receipt leaves out ${ask}, which the answer closed as decided for you`);
  if (also.includes(other)) failures.push(`the receipt lists ${other}, which the answer didn't close`);
  if (after.receipt!.answer !== 'green') failures.push(`the receipt says the answer was ${shown(after.receipt!.answer)}, not green`);
  return failures;
}

describe(`AC1 ${AC1} before the card arms, an answer that will be saved as a decision shows its scope in words and how many open asks it will also answer`, () => {
  it(`${AC1} with two matching asks open the card says it answers 2 more; answering closes exactly those two as decided for you; a third that comes to match while the card shows doesn't change the card and is listed on its receipt`, async () => {
    await inWorld(async (w) => {
      expect(await scenario(w), 'the card and the record').toEqual([]);
    });
  }, 120_000);

  // The wrong programs the criterion names, planted at the asks core the card reads: the judge above fails each.
  const plants: Record<string, Planting> = {
    'a card that shows no scope': { asks: (asks) => ({ ...asks, card: async (ask) => ({ ...(await asks.card(ask)), saves: null }) }) },
    'a count that changes while it shows': {
      asks: (asks: Asks, w) => ({
        ...asks,
        card: async (ask) => {
          const c = (await asks.card(ask)) as CardSeen;
          if (!c.saves) return c;
          // Counted again at each read, over the open asks of its key, instead of once when presented.
          const key = String(data(await (async () => { const created = (await w.events('ask.created')).find((e) => e.id === ask.slice(4)); if (!created) throw Error(`no ask.created for ${ask}`); return created; })()).key);
          const open = (await asks.inbox()).filter((r) => r.outcome === 'unanswered' && r.ask !== ask);
          const matching = (await w.events('ask.created')).filter((e) => open.some((r) => r.ask === `ask:${e.id}`) && String(data(e).key) === key);
          return { ...c, saves: { scope: c.saves.scope, also: matching.length } };
        },
      }),
    },
  };
  for (const [name, plant] of Object.entries(plants)) {
    it(`${AC1} wrong program: ${name} fails this test`, async () => {
      await inWorld(async (w) => {
        let failed: string[] = [];
        try {
          failed = await scenario(w);
        } catch (error) {
          failed = [String((error as Error).message)];
        }
        expect(failed.length, `the planted ${name} is caught: ${shown(failed)}`).toBeGreaterThan(0);
        expect(failed.join('\n'), `the failure names the scope or the count`).toMatch(name.includes('scope') ? /scope/ : /count|answers \d+ more/);
      }, plant);
    }, 120_000);
  }
});
