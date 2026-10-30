// Criteria 4 and 5, buying with the money extensions: DeepBuild never stores or sees a card number; a purchase
// past what's left of its budget, counting purchases reserved and not yet charged, stops and asks, and its
// receipt is kept as evidence.

import { afterEach, test } from 'vitest';
import { openBuyingWorld, type BuyingWorld } from './buying.ts';
import { noCardNumber, reservedPurchasesCount } from './buying-scenarios.ts';

let world: BuyingWorld | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test('#69.06d40ef2 DeepBuild never stores or sees a card number: a card rule takes the processor\'s reference, never a number, and no receipt, event, file or delivery holds one', async () => {
  await noCardNumber((world = await openBuyingWorld()));
});

test("#69.d8443973 with $100 approved, a second $60 purchase made while the first is still unpriced asks; the first one's receipt is kept as evidence", async () => {
  await reservedPurchasesCount((world = await openBuyingWorld()));
});
