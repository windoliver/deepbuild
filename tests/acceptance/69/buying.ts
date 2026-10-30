// The buying world for criteria 4 and 5: the #69 world, the budget ledger (#86) on its record, and the buying
// module over both, with a payment processor the test holds. The processor is the one boundary here DeepBuild
// doesn't own: it holds the card, charges it under a card rule, and answers with the seller's receipt.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { openLedger } from '../../../packages/budget/src/index.ts';
import type { Ledger } from '../../../packages/budget/src/index.ts';
import { BuyingRefused, openBuying } from '../../../packages/buying/src/index.ts';
import type { Buying, Processor } from '../../../packages/buying/src/index.ts';
import { card, ENDS, openWorld, type Planting, type World } from './helpers.ts';

export interface Charge { card: string; seller: string; usd: number; purchase: string }
export interface BuyingWorld extends World {
  ledger: Ledger;
  buying: Buying;
  /** Every charge the processor was asked to make, in order. */
  charges: Charge[];
  /** You approve a budget for a kind of work, on the card; its ID. */
  budgetFor(work: string, cap: number): Promise<string>;
}
export interface BuyingPlanting extends Planting {
  processor?: (processor: Processor, world: BuyingWorld) => Processor;
}

/** The seller's receipt, as the processor or the seller sends it: it prints the card number whole, as some do. */
export const receiptText = (order: string, what: string, usd: number, cardShown: string): string =>
  `shop.example\nOrder ${order}\n${what}  $${usd.toFixed(2)}\nTotal: $${usd.toFixed(2)}\nPaid with card ${cardShown}\nThank you.\n`;

export async function openBuyingWorld(plant: BuyingPlanting = {}): Promise<BuyingWorld> {
  const w = (await openWorld(plant)) as BuyingWorld;
  const charges: Charge[] = [];
  let orders = 1041;
  const processor: Processor = {
    charge: async (request) => {
      charges.push(structuredClone(request));
      const order = `SE-${++orders}`;
      return { receipt: new TextEncoder().encode(receiptText(order, `Order for ${request.purchase}`, request.usd, '4000 0566 5566 5556')), usd: request.usd };
    },
  };
  w.charges = charges;
  w.ledger = await openLedger({ record: w.record, asks: w.asks, now: w.clock.now, price: async () => null });
  w.buying = await openBuying({ record: w.record, asks: w.asks, ledger: w.ledger, now: w.clock.now, processor: plant.processor ? plant.processor(processor, w) : processor });
  w.budgetFor = (work, cap) => w.ledger.approve(card, { scope: { kind: 'work', ref: work }, cap_usd: cap, ends: ENDS });
  return w;
}

/** The call is refused with BuyingRefused, naming the field. */
export async function buyingRefused(call: Promise<unknown>, field: string, what: string): Promise<void> {
  let error: unknown;
  let value: unknown;
  try {
    value = await call;
  } catch (e) {
    error = e;
  }
  expect(error, `${what}: expected the buying module to refuse it, naming ${field}, but it returned ${JSON.stringify(value)}`).toBeInstanceOf(BuyingRefused);
  expect((error as BuyingRefused).field, `${what}: the refusal names ${field}`).toBe(field);
}

/** Every file under a folder, with its bytes as Latin-1 text, so digits read the same in any file. */
export function filesUnder(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push({ path, text: readFileSync(path).toString('latin1') });
  }
  return out;
}
