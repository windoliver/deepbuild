// #319.e94e8d14 and #319.b1bf1877: the fold into one exception, "this session keeps asking", answered in bulk,
// and the asks that keep their own deadline under it or under a hold for a message the agent hasn't read.

import { afterEach, expect, test } from 'vitest';
import {
  ask, card, CLOSING, core, createdData, DAY, MINUTE, nextBatch, noDefaultBeforeShown, openWorld, settings, sourceOf, type World,
} from './helpers.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#319.e94e8d14 a sixth open ask from one session lands inside one "this session keeps asking" exception, and answering it in bulk closes all six', async () => {
  const w = (world = await openWorld({ settings: settings() }));
  await w.start('S1', 'T1');
  const six: string[] = [];
  for (const n of [1, 2, 3, 4, 5]) six.push(await w.asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${n}`)));
  six.push(await w.asks.raise(core('S1'), sourceOf('choice'), ask('choice', 'storage')));
  const sixth = six[5]!;
  const cards = await w.asks.needsYou();
  await w.shown();
  expect(cards.map((c) => c.ask), `the sixth ask ${sixth} has no card of its own`).not.toContain(sixth);
  const exceptions = cards.filter((c) => c.folded.length > 0);
  expect(exceptions.map((c) => c.kind), 'one exception holds the session\'s further asks').toEqual(['exception']);
  const exception = exceptions[0]!;
  expect(exception.folded, `the exception holds the sixth ask ${sixth}`).toContain(sixth);
  expect(String((await createdData(w, exception.ask)).question), 'the exception says the session keeps asking').toMatch(/keeps asking/i);

  await w.asks.answer(card, exception.ask, { option: 'together' });
  for (const h of six) {
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    expect(closing.map((e) => [e.kind, (e.data as { answer: string }).answer]), `ask ${h} is answered by the bulk answer, with its recommended option`)
      .toEqual([['ask.answered', h === sixth ? 'files' : 'green']]);
    expect((await w.row(h))?.outcome, `ask ${h}'s outcome`).toBe('answered');
    expect(w.deliveries.filter((d) => d.ask === h).map((d) => d.option), `ask ${h}: the agent gets the answer`).toEqual([h === sixth ? 'files' : 'green']);
  }
  const left = (await w.asks.needsYou()).map((c) => c.ask);
  for (const h of [...six, exception.ask]) expect(left, `ask ${h} leaves Needs you`).not.toContain(h);
});

test('#319.b1bf1877 an authority ask folded into the exception, and one held for a message the agent hasn\'t read, show at once when the deadline would pass before the next batch, and that ask alone takes no', async () => {
  // Batches two days apart; the hub starts a minute after one, so the next batch is just under two days off.
  const EVERY = 2 * DAY;
  const start = nextBatch(Date.UTC(2026, 9, 20, 12, 0, 0), EVERY) + MINUTE;
  const w = (world = await openWorld({ settings: settings({ batch: { every: '2d', cap: 10 } }), start }));
  await w.start('S1', 'T1');
  const taste: string[] = [];
  for (const n of [1, 2, 3, 4, 5]) taste.push(await w.asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${n}`)));
  const folded = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'feature/login'));
  expect((await createdData(w, folded)).deadline, `ask ${folded} keeps its own 1-day deadline`).toBe(start + DAY);
  const cards = await w.asks.needsYou();
  await w.shown();
  expect(cards.map((c) => c.ask), `the folded ask ${folded} has no card of its own`).not.toContain(folded);
  const exception = cards.find((c) => c.folded.includes(folded));
  expect(exception?.kind, `the exception holding ask ${folded} shows at once: its deadline comes before the next batch`).toBe('exception');

  // S2: a person types while the agent works, and an authority ask comes from a turn that hasn't read it yet.
  await w.start('S2', 'T2');
  await w.step('S2');
  await w.typed('S2', 'use the staging remote, not origin');
  const held = await w.asks.raise(core('S2'), sourceOf('authority'), ask('authority', 'feature/billing'));
  expect(await w.shown(), `ask ${held}, held for a message the agent hasn't read, shows at once: its deadline comes before the next batch`).toContain(held);

  await w.at(start + DAY - MINUTE);
  for (const h of [folded, held]) expect((await w.about(h)).filter((e) => CLOSING.includes(e.kind)), `ask ${h} is open until its deadline`).toEqual([]);
  await w.at(start + DAY);
  for (const h of [folded, held]) {
    const closing = (await w.about(h)).filter((e) => CLOSING.includes(e.kind));
    expect(closing.map((e) => [e.kind, e.ts, (e.data as { decision: string }).decision]), `ask ${h} takes no at its deadline`).toEqual([['ask.defaulted', start + DAY, 'deny']]);
  }
  for (const h of taste) expect((await w.about(h)).filter((e) => CLOSING.includes(e.kind)), `the taste call ${h} doesn't close with the folded authority ask`).toEqual([]);
  await noDefaultBeforeShown(w);
});
