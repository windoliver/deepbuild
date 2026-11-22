// #2316.b2850c01: on a record holding 10,000 events that aren't card_rule.set after the last purchase, buy() reads
// only card_rule.set rows (record.read is called with kinds: ['card_rule.set']) and advances its cursor to the log
// head. Observed through the real record: the reads asked of it while buy() runs, and what buy() pays with after.

import { afterEach, expect, test } from 'vitest';
import { agent, card, CARD_REF, countAfter, fill, FILLER, openSpiedWorld, purchaseId, type Read, type SpiedWorld } from './buying.ts';

let world: SpiedWorld | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const LAMPS_REF = 'pm_9Z8y7X6w5V4u3T2s';
const cardRows = (reads: readonly Read[]): Read[] => reads.filter((r) => r.kinds?.length === 1 && r.kinds[0] === 'card_rule.set');
const fillerRows = (reads: readonly Read[]): number => reads.flatMap((r) => r.rows).filter((row) => (FILLER as readonly string[]).includes(row.kind)).length;
const unfiltered = (reads: readonly Read[]): Read[] => reads.filter((r) => r.kinds === undefined);
const asked = (reads: readonly Read[]): string => JSON.stringify(reads.map((r) => ({ after: r.after, limit: r.limit, kinds: r.kinds, rows: r.rows.length })));

test("#2316.b2850c01 On a record holding 10,000 non-`card_rule.set` events after the last purchase, `buy()` reads only `card_rule.set` rows (`record.read` is called with `kinds: ['card_rule.set']`) and advances its cursor to the log head", async () => {
  const w = (world = await openSpiedWorld());
  const budget = await w.budgetFor('cables', 1000);
  await w.buying.cardRule(card, { seller: 'shop.example', max_usd: 25, card: CARD_REF });
  const buy = (seller: string, usd: number) => w.buying.buy(agent('S1'), { purchase: purchaseId(w.clock.now()), what: 'USB-C cable, 2 m', seller, usd, budget, refund: 'Return within 30 days' });

  // The last purchase: paid by the card rule, which buy() has read.
  const first = await buy('shop.example', 12);
  if (first.status !== 'paid') throw Error(`BLOCKED: the purchase before the 10,000 events was ${first.status}, not paid by the $25 card rule for shop.example`);
  const lastPurchase = await w.head();

  // 10,000 events after it, none of them card_rule.set: a session's tool calls.
  const lastFiller = await fill(w, 10_000);
  const landed = await countAfter(w, lastPurchase, FILLER);
  if (landed !== 10_000 || (await countAfter(w, lastPurchase, ['card_rule.set'])) !== 0) throw Error(`BLOCKED: the record holds ${landed} tool events and some card_rule.set after the last purchase, not 10,000 and none`);

  // The purchase after them reads only card_rule.set rows, through record.read with kinds ['card_rule.set'].
  const second = await w.during(() => buy('shop.example', 15));
  expect(second.value.status, 'a $15 purchase from shop.example after the 10,000 events is still paid by the $25 card rule set before them').toBe('paid');
  expect(fillerRows(second.reads), `rows of the 10,000 tool events handed back by the reads made while buy() ran: ${asked(second.reads)}`).toBe(0);
  expect(unfiltered(second.reads).length, `reads made while buy() ran with no kinds filter: ${asked(unfiltered(second.reads))}`).toBe(0);
  expect(cardRows(second.reads).length, `buy() calls record.read with kinds ['card_rule.set']; the reads it made: ${asked(second.reads)}`).toBeGreaterThan(0);
  expect(cardRows(second.reads).flatMap((r) => r.rows).filter((row) => row.kind !== 'card_rule.set'), "rows other than card_rule.set handed back to a read for kinds ['card_rule.set']").toEqual([]);

  // Its cursor is at the log head: the next purchase reads card_rule.set only after the 10,000 events, and no more
  // of the events landed since.
  await fill(w, 500, 'S3');
  const third = await w.during(() => buy('shop.example', 9));
  expect(third.value.status, 'a $9 purchase from shop.example is paid by the card rule').toBe('paid');
  const thirdCard = cardRows(third.reads);
  expect(thirdCard.length, `the next purchase calls record.read with kinds ['card_rule.set']; the reads it made: ${asked(third.reads)}`).toBeGreaterThan(0);
  expect(Math.min(...thirdCard.map((r) => r.after)), `the next purchase reads card_rule.set from the head the last one reached (at or past the 10,000th event, log position ${lastFiller}): ${asked(thirdCard)}`).toBeGreaterThanOrEqual(lastFiller);
  expect(fillerRows(third.reads) + unfiltered(third.reads).length, `tool-event rows and unfiltered reads while the next purchase ran: ${asked(third.reads)}`).toBe(0);

  // And a card rule set after the head is still read: a purchase from its seller is paid with its card.
  await fill(w, 500, 'S4');
  await w.buying.cardRule(card, { seller: 'lamps.example', max_usd: 40, card: LAMPS_REF });
  await fill(w, 500, 'S5');
  const lamp = await buy('lamps.example', 30);
  expect(lamp.status, 'a $30 purchase from lamps.example, under the $40 card rule set after the head, is paid by it').toBe('paid');
  expect(w.charges.at(-1), 'the processor is asked to charge the card the new rule names').toMatchObject({ card: LAMPS_REF, seller: 'lamps.example', usd: 30 });
}, 600_000);
