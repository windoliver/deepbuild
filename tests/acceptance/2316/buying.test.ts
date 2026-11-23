// AC1 #2316.b2850c01: On a record holding 10,000 non-`card_rule.set` events after the last purchase, `buy()` reads only
// `card_rule.set` rows (`record.read` is called with `kinds: ['card_rule.set']`) and advances its cursor to the log head.
//
// A real record on SQLite in a temp folder, the real asks core and budget ledger on it (suite 69's world), and the
// buying module opened through `openBuying` on that record seen through a recorder: every `record.read` the buying
// module makes is kept, with its query and the rows it got. The ledger and the asks core read the record itself, so
// only the buying module's reads are recorded. The payment processor is the one stand-in (a boundary DeepBuild doesn't
// own); it also notes the log head when it is asked to charge, which is right after `buy()` read the card rules.
//
//   1. You approve $1,000 for office supplies and set a card rule for shop.example up to $25.
//   2. A $12 purchase from shop.example is paid: the last purchase.
//   3. 10,000 `user.ask` events land, as a session's hooks append them; after the first 5,000 you set a second card
//      rule, for parts.example, so the 10,000 hold a `card_rule.set` row for `buy()` to read.
//   4. A $9 purchase from parts.example: every read `buy()` made names `kinds: ['card_rule.set']`, the rows it got are
//      the second rule's event alone, none of the 10,000, and it is paid by that rule.
//   5. A third purchase: its first read starts after the log head as it stood when the second purchase read the rules.
//
// Wrong programs: a `buy()` that reads the log with no `kinds` fails at "every read names kinds"; one that filters
// after reading fails there too; one that filters but leaves its cursor at the last card rule fails at step 5.
import { rmSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { openBuying, type Buying, type Processor } from '../../../packages/buying/src/index.ts';
import type { Connection, Event, RecordStore } from '../../../packages/record/src/index.ts';
import { openBuyingWorld, receiptText, type BuyingWorld } from '../69/buying.ts';
import { agent, card, CARD_REF, purchaseId, ulid } from '../69/helpers.ts';

const ID = 'AC1 #2316.b2850c01';
const EVENTS = 10_000;
const RULE_KINDS = ['card_rule.set'];
const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session: 'S1', agent: 'claude-code' };

interface Read { query: { after: number; limit?: number; kinds?: readonly string[] }; rows: Event[] }
/** The real record, each of its reads kept with the rows it returned. */
function recorded(record: RecordStore, reads: Read[]): RecordStore {
  return new Proxy(record, {
    get: (real, name) => {
      if (name === 'read') {
        return async (query: Read['query']): Promise<Event[]> => {
          const rows = await real.read(query);
          reads.push({ query: { ...query, ...(query.kinds && { kinds: [...query.kinds] }) }, rows });
          return rows;
        };
      }
      const value = Reflect.get(real, name) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  });
}
const headOf = async (w: BuyingWorld): Promise<number> => (await w.events()).at(-1)!.log_pos;

let world: BuyingWorld | undefined;
afterAll(async () => {
  if (!world) return;
  await world.close();
  rmSync(world.dir, { recursive: true, force: true });
});

it(`${ID} after 10,000 other events, buy() reads card_rule.set rows only and moves its cursor to the log head`, async () => {
  const w = (world = await openBuyingWorld());
  const reads: Read[] = [];
  const headsAtCharge: number[] = [];
  const processor: Processor = {
    charge: async (request) => {
      headsAtCharge.push(await headOf(w));
      return { receipt: new TextEncoder().encode(receiptText('SE-2316', `Order for ${request.purchase}`, request.usd, 'ending 5556')), usd: request.usd };
    },
  };
  const buying: Buying = await openBuying({ record: recorded(w.record, reads), asks: w.asks, ledger: w.ledger, now: w.clock.now, processor });
  const budget = await w.budgetFor('office supplies', 1000);
  const buy = (seller: string, usd: number) => buying.buy(agent('S1'), { purchase: purchaseId(w.clock.now()), what: 'USB-C cable, 2 m', seller, usd, budget, refund: 'Return within 30 days' });

  // The last purchase before the 10,000 events.
  await buying.cardRule(card, { seller: 'shop.example', max_usd: 25, card: CARD_REF });
  expect((await buy('shop.example', 12)).status, 'the fixture: a $12 purchase from shop.example, under its card rule, is paid').toBe('paid');

  // 10,000 events of another kind, with one card rule set among them.
  let rule = '';
  for (let n = 0; n < EVENTS; n++) {
    if (n === EVENTS / 2) rule = await buying.cardRule(card, { seller: 'parts.example', max_usd: 25, card: CARD_REF });
    const ts = w.clock.now();
    await w.record.append(hook, { v: 1, id: ulid(ts), kind: 'user.ask', ts, data: { msg: n, text: `keep going, step ${n}`, tasks: [], from: 'person' } });
  }
  const before = await w.events();
  const lastPaid = before.findLastIndex((e) => e.kind === 'spend.charged');
  const since = before.slice(lastPaid + 1);
  expect(since.filter((e) => e.kind !== 'card_rule.set').length, `the fixture: the record holds ${EVENTS} events that aren't card_rule.set after the last purchase`).toBe(EVENTS);
  expect(since.filter((e) => e.kind === 'card_rule.set').map((e) => e.id), 'the fixture: and one card_rule.set event among them').toEqual([rule]);

  // The purchase after them.
  reads.length = 0;
  headsAtCharge.length = 0;
  const second = await buy('parts.example', 9);
  expect(reads.length, 'buy() read the record for the card rules it gained').toBeGreaterThan(0);
  expect(reads.map((r) => r.query.kinds), `every record.read buy() made names kinds: ['card_rule.set'] (${reads.length} reads)`).toEqual(reads.map(() => RULE_KINDS));
  const rows = reads.flatMap((r) => r.rows);
  expect(rows.filter((e) => e.kind !== 'card_rule.set').length, `of the ${rows.length} rows buy() read, none is of another kind`).toBe(0);
  expect(rows.map((e) => e.id), 'the rows buy() read are the one card rule set since the last purchase').toEqual([rule]);
  expect(second.status, 'the purchase from parts.example is paid by the rule buy() read').toBe('paid');
  expect(headsAtCharge.length, 'the processor was asked to charge it once').toBe(1);

  // The cursor: the next buy() reads from the log head the last one saw, not from the last card rule.
  const head = headsAtCharge[0]!;
  reads.length = 0;
  await buy('books.example', 5);
  expect(reads.length, 'the next buy() read the record again').toBeGreaterThan(0);
  expect(reads[0]!.query.after, `the next buy() reads after the log head the last one saw (${head}); the card rule it read is far behind it`).toBe(head);
  expect(reads.map((r) => r.query.kinds), "and it too names kinds: ['card_rule.set']").toEqual(reads.map(() => RULE_KINDS));
}, 600_000);
