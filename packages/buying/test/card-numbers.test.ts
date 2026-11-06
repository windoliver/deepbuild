// A card number that touches other digits: a receipt that prints the expiry after the number, or an order number
// before it, still holds the number, and #69's rule is that DeepBuild never stores or sees one. #69's acceptance
// receipt prints the number between words only, so it never reaches this case.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftAskSettings, openAsks } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { openEvidenceStore, type EvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { BuyingRefused, openBuying, type Buying } from '../src/index.js';

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);
const now = (): number => T0;
const you: Connection = { writer: 'app', actor: 'you', scope: 'you' };
const agent: Connection = { writer: 'mcp:S1', actor: 'you', scope: 'you', session: 'S1', agent: 'claude-code' };
/** A test number that passes the Luhn check. */
const PAN = '4000056655665556';
const holdsPan = (text: string): boolean => text.replace(/[\s-]/g, '').includes(PAN);
/** No digit run longer than the four a mask shows: every run of the card's digits is behind one. */
const showsMoreThanFour = (text: string): boolean => [...Array(PAN.length - 4).keys()].some((s) => text.replace(/[\s-]/g, '').includes(PAN.slice(s, s + 5)));

let dir: string;
let record: RecordStore;
let evidence: EvidenceStore;
let buying: Buying;
let budget: string;
let printed: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-buying-'));
  const home = join(dir, 'home');
  await draftAskSettings(home);
  evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now });
  record = await openRecord({ path: join(dir, 'record.db'), now, evidence });
  const asks = await openAsks({ record, now, deliver: () => undefined, home });
  const ledger = await openLedger({ record, asks, now, price: async () => null });
  buying = await openBuying({
    record, asks, ledger, now,
    processor: { charge: async ({ usd }) => ({ receipt: new TextEncoder().encode(printed), usd }) },
  });
  budget = await ledger.approve(you, { scope: { kind: 'work', ref: 'cables' }, cap_usd: 100, ends: T0 + 86_400_000 });
  await buying.cardRule(you, { seller: 'shop.example', max_usd: 25, card: 'pm_1Q2w3E4r5T6yU7iO' });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

const purchase = (what: string) => ({ purchase: `run:${ulid(T0)}`, what, seller: 'shop.example', usd: 12, budget, refund: null });

describe('a card number beside other digits', () => {
  // `00008 4000 0566` alone passes the Luhn check, so a scan that stops at the first window that passes masks it and
  // leaves `5566 5556` showing.
  const grouped = PAN.match(/.{4}/g)!;
  for (const line of [`Visa ${grouped.join(' ')} 05 29`, `Order 7 ${PAN}`, `Card ${grouped.join('-')} 0529`, `Order 00008 ${grouped.join(' ')}`]) {
    it(`is masked in the receipt kept as evidence: "${line}"`, async () => {
      printed = `shop.example\n${line}\nTotal: $12.00\n`;
      const bought = await buying.buy(agent, purchase('USB-C cable'));
      if (bought.status !== 'paid') throw Error(`the purchase is paid under the card rule, not ${bought.status}`);
      const kept = new TextDecoder().decode(await evidence.read(bought.receipt.replace(/^ev:/, '')));
      expect(holdsPan(kept), `the receipt kept as evidence holds the card number: ${JSON.stringify(kept)}`).toBe(false);
      expect(showsMoreThanFour(kept), `the receipt kept as evidence shows more of the card number than four digits: ${JSON.stringify(kept)}`).toBe(false);
      expect(kept, 'a mask stands where the number was').toContain('••••');
      // Where digits follow the card in one run, as an expiry, the four shown end the run: never the card's other digits.
      const shown = /•••• (\d{4})/.exec(kept)?.[1] ?? '';
      expect(shown === PAN.slice(-4) || !PAN.slice(0, -4).includes(shown), `the mask shows ${shown}, digits of the card other than its last four`).toBe(true);
    });

    it(`is refused in a purchase's words: "${line}"`, async () => {
      await expect(buying.buy(agent, purchase(`Lamp, ${line}`))).rejects.toBeInstanceOf(BuyingRefused);
    });
  }
});
