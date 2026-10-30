// The buying criteria's scenarios (4 and 5), shared by buying.test.ts and plants.test.ts.

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect } from 'vitest';
import { BuyingRefused } from '../../../packages/buying/src/index.ts';
import { buyingRefused, filesUnder, receiptText, type BuyingWorld } from './buying.ts';
import { agent, CARD_REF, card, holdsPan, isObj, PAN_FORMS, purchaseId, sha256, toJson } from './helpers.ts';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const bare = (handle: string): string => handle.replace(/^ev:/, '');

/**
 * #69.d8443973: $100 approved for office supplies; a $60 purchase reserves its price and stays unpriced (its
 * payment is a task for you); a second $60 purchase then stops and asks. The first one's receipt lands, is kept as
 * evidence, and charges the budget.
 */
export async function reservedPurchasesCount(w: BuyingWorld): Promise<void> {
  const budget = await w.budgetFor('office supplies', 100);
  const [first, second] = [purchaseId(w.clock.now()), purchaseId(w.clock.now())];
  const one = await w.buying.buy(agent('S1'), { purchase: first, what: 'Standing desk frame', seller: 'shop.example', usd: 60, budget, refund: 'Return within 30 days at shop.example/returns' });
  expect(one.status, 'the first $60 purchase, inside the $100 budget, reserves its price').toBe('reserved');
  const two = await w.buying.buy(agent('S1'), { purchase: second, what: 'Monitor arm', seller: 'shop.example', usd: 60, budget, refund: 'Return within 30 days at shop.example/returns' });
  expect(two.status, 'with $100 approved and the first $60 purchase reserved and still unpriced, a second $60 purchase asks').toBe('asked');
  const ask = (two as { ask: string }).ask;
  const row = await w.row(ask);
  expect([row?.kind, row?.outcome], `${ask}, the second purchase's, is an authority ask that waits for you`).toEqual(['authority', 'unanswered']);
  const shown = await w.asks.card(ask);
  expect(shown.plan?.steps.map((s) => s.cost), `${ask}'s plan shows the purchase with its price`).toContain(60);
  const held = await w.ledger.budget(budget);
  expect([held.reserved_usd, held.spent_usd, held.left_usd], 'the budget holds the first purchase, reserved and unpriced, and nothing for the second').toEqual([60, 0, 40]);
  expect(w.charges, 'nothing was paid with a card rule').toEqual([]);

  // The first purchase's receipt lands: kept as evidence, cited in the record, and charged.
  const receipt = bytesOf(receiptText('SE-2001', 'Standing desk frame', 60, 'ending 5556'));
  const kept = bare(await w.buying.receipt(card, first, { bytes: receipt, usd: 60 }));
  expect(kept, "the receipt's handle names its SHA-256").toBe(sha256(receipt));
  expect(Buffer.from(await w.evidence.read(kept)).equals(Buffer.from(receipt)), 'the receipt is kept as evidence, byte for byte').toBe(true);
  const cites = (await w.events()).filter((e) => e.evidence.includes(kept) || JSON.stringify(e.data).includes(kept));
  expect(cites.length, `the record cites the receipt ${kept}`).toBeGreaterThan(0);
  const charged = await w.ledger.budget(budget);
  expect([charged.reserved_usd, charged.spent_usd, charged.left_usd], "the receipt's $60 is charged and the reservation released").toEqual([0, 60, 40]);
}

/**
 * #69.06d40ef2: a card rule given a card number is refused; one naming the processor's reference pays a $12
 * purchase, whose receipt prints the number whole; an agent writes the number into a purchase. Then nothing
 * DeepBuild keeps or hands on holds the number: every file under the state folder, every event, every evidence
 * file read back, every delivery to the agent.
 */
export async function noCardNumber(w: BuyingWorld): Promise<void> {
  for (const form of PAN_FORMS) {
    await buyingRefused(w.buying.cardRule(card, { seller: 'shop.example', max_usd: 25, card: form }), 'card', `a card rule given the card number ${form}`);
  }
  const rule = await w.buying.cardRule(card, { seller: 'shop.example', max_usd: 25, card: CARD_REF });
  expect(typeof rule, "a card rule naming the processor's reference is set").toBe('string');
  const budget = await w.budgetFor('cables', 100);
  const paid = await w.buying.buy(agent('S1'), { purchase: purchaseId(w.clock.now()), what: 'USB-C cable, 2 m', seller: 'shop.example', usd: 12, budget, refund: 'Return within 30 days' });
  expect(paid.status, 'a $12 purchase from shop.example, under your $25 card rule, is paid by it').toBe('paid');
  expect(w.charges.map((c) => [c.card, c.seller, c.usd]), "the processor is asked to charge the card by its reference").toEqual([[CARD_REF, 'shop.example', 12]]);
  const receipt = new TextDecoder().decode(await w.evidence.read(bare((paid as { receipt: string }).receipt)));
  expect(receipt, "the processor's receipt is kept as evidence").toContain('Total: $12.00');
  expect(holdsPan(receipt), 'the receipt kept as evidence holds the card number').toBe(false);
  // An agent writes the number into a purchase: refused, or taken without it.
  try {
    await w.buying.buy(agent('S1'), { purchase: purchaseId(w.clock.now()), what: `Desk lamp, pay with card ${PAN_FORMS[1]}`, seller: 'lamps.example', usd: 30, budget, refund: null });
  } catch (error) {
    if (!(error instanceof BuyingRefused)) throw error;
  }
  await w.record.sync();
  const hits = filesUnder(w.dir).filter((f) => holdsPan(f.text)).map((f) => relative(w.dir, f.path));
  expect(hits, 'DeepBuild stores the card number in these files under its state folder').toEqual([]);
  expect((await w.events()).filter((e) => holdsPan(toJson(e))).map((e) => e.kind), 'events holding the card number').toEqual([]);
  const journal = readFileSync(join(w.dir, 'evidence', 'records.jsonl'), 'utf8').split('\n').filter(Boolean);
  for (const line of journal) {
    const entry = JSON.parse(line) as unknown;
    if (!isObj(entry) || typeof entry.sha256 !== 'string') continue;
    expect(holdsPan(Buffer.from(await w.evidence.read(entry.sha256)).toString('latin1')), `evidence ${entry.sha256} holds the card number`).toBe(false);
  }
  expect(w.deliveries.filter((d) => holdsPan(JSON.stringify(d))).map((d) => d.ask), 'deliveries to the agent holding the card number').toEqual([]);
}
