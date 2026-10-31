// @deepbuild/buying: buying within a budget you approved (#69, with the money extensions; design: Plans before
// acting). A purchase is a plan with its price: it reserves that price in the #86 ledger against the budget it
// names before anything is paid, counting purchases reserved and not yet charged, and one past what's left stops
// and asks, as an authority ask whose plan shows the purchase at its price. Payment is a task for you, or a card
// rule you set on the trusted path for one seller up to an amount, paid by the payment processor with the card it
// holds. DeepBuild never stores or sees a card number: a rule names the processor's reference, text that carries
// a number is refused, and a receipt is kept as evidence with any number in it masked to its last four digits.
// The receipt's amount is the purchase's cost reading, which charges the budget and releases the reservation.
import type { Asks, PlanStep } from '@deepbuild/asks';
import type { Ledger } from '@deepbuild/budget';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection, type Event, type RecordStore } from '@deepbuild/record';

export interface PurchaseInput {
  /** `run:<ULID>`: a purchase is named as a paid run is. */
  purchase: string;
  what: string;
  /** The seller, by host. */
  seller: string;
  usd: number;
  /** The budget you approved (#86) it reserves against. */
  budget: string;
  /** Its undo: how the seller refunds or cancels it; null where the seller allows none. */
  refund: string | null;
}
export type Bought =
  | { purchase: string; status: 'reserved' }
  | { purchase: string; status: 'paid'; receipt: string }
  | { purchase: string; status: 'asked'; ask: string };
/** The payment processor, outside DeepBuild: it holds the card and charges it under a card rule. */
export interface Processor {
  charge(request: { card: string; seller: string; usd: number; purchase: string }): Promise<{ receipt: Uint8Array; usd: number }>;
}
export interface BuyingOptions { record: RecordStore; asks: Asks; ledger: Ledger; now: () => number; processor: Processor }
export interface Buying {
  /** A card rule you set on the trusted path; `card` is the processor's reference to a card it holds. Its ID. */
  cardRule(connection: Connection, rule: { seller: string; max_usd: number; card: string }): Promise<string>;
  buy(connection: Connection, purchase: PurchaseInput): Promise<Bought>;
  /** A purchase's receipt lands: kept as evidence, its amount charged and its reservation released. Its handle, `ev:<sha256>`. */
  receipt(connection: Connection, purchase: string, receipt: { bytes: Uint8Array; usd: number }): Promise<string>;
}

export class BuyingRefused extends Error {
  readonly field?: string;
  readonly purchase?: string;
  constructor(message: string, named: { field?: string; purchase?: string } = {}) {
    super(message);
    this.name = 'BuyingRefused';
    Object.assign(this, named);
  }
}

/** The trusted path: only you set a card rule or hand in a receipt, on the card or from `deep inbox`. */
const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
/** A processor's reference to a card it holds: a short prefix and an ID, never digits alone. */
const CARD_REF = /^[A-Za-z]{2,8}_[A-Za-z0-9_]{6,}$/;
const PURCHASE = /^run:[0-9A-Za-z]+$/;
const PAGE = 1000;

/**
 * Every run of 13 to 19 digits, spaces or dashes allowed between them, that passes the Luhn check: a card number,
 * as people and receipts write it.
 */
const CANDIDATE = /\d(?:[ -]?\d){12,18}/g;
function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}
const cardNumbers = (text: string): string[] => [...text.matchAll(CANDIDATE)].map((m) => m[0]).filter((m) => luhn(m.replace(/\D/g, '')));
/** Text with each card number in it masked to its last four digits. */
const masked = (text: string): string => text.replace(CANDIDATE, (m) => (luhn(m.replace(/\D/g, '')) ? `•••• ${m.replace(/\D/g, '').slice(-4)}` : m));

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const dollars = (usd: number): string => `$${usd.toFixed(2)}`;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

class Buyer implements Buying {
  private cursor = 0;
  private readonly rules = new Map<string, { seller: string; max_usd: number; card: string }>();

  constructor(private readonly o: BuyingOptions) {}

  async cardRule(connection: Connection, rule: { seller: string; max_usd: number; card: string }): Promise<string> {
    const via = TRUSTED[connection.writer];
    if (via === undefined) throw new BuyingRefused(`only you set a card rule, on the card or from deep inbox, not ${connection.writer}`, { field: 'writer' });
    if (!isObj(rule)) throw new BuyingRefused('a card rule names its seller, its most and its card', { field: 'rule' });
    // A number is refused before anything holds it: the rule names the processor's reference instead.
    if (typeof rule.card !== 'string' || cardNumbers(rule.card).length || !CARD_REF.test(rule.card)) {
      throw new BuyingRefused("a card rule names the processor's reference to a card it holds, never a card number", { field: 'card' });
    }
    if (!isText(rule.seller) || cardNumbers(rule.seller).length) throw new BuyingRefused('a card rule names its seller, by host', { field: 'seller' });
    if (!isPrice(rule.max_usd)) throw new BuyingRefused('a card rule pays up to an amount in dollars, zero or more', { field: 'max_usd' });
    const now = this.o.now();
    const id = ulid(now);
    await this.o.record.append(this.core(connection), {
      v: 1, id, kind: 'card_rule.set', ts: now, data: { seller: rule.seller, max_usd: rule.max_usd, card: rule.card, via },
    });
    return id;
  }

  async buy(connection: Connection, input: PurchaseInput): Promise<Bought> {
    const p = checked(input);
    const step: PlanStep = {
      does: `Buy ${p.what} from ${p.seller} for ${dollars(p.usd)}`, changes: [`${p.seller}: order ${p.purchase}`],
      undo: p.refund, public: true, cost: p.usd,
    };
    const run = { run: p.purchase, check: `purchase from ${p.seller}`, inputs: sha256Hex(canonicalize({ purchase: p as unknown as JsonValue })), issue: `purchase ${p.purchase}` };
    // The price is reserved before anything is paid, against the budget it names, counting what's still unpriced.
    const outcome = await this.o.ledger.reserveIn(this.core(connection), run, p.budget, p.usd, step);
    if (outcome.status !== 'started') {
      if ('ask' in outcome) return { purchase: p.purchase, status: 'asked', ask: outcome.ask };
      throw new BuyingRefused(`${p.purchase} can't reserve its price`, { purchase: p.purchase });
    }
    await this.sync();
    const rule = [...this.rules.values()].find((r) => r.seller === p.seller && p.usd <= r.max_usd);
    // With no card rule, payment is a task for you; the reservation holds, unpriced, until its receipt lands.
    if (!rule) return { purchase: p.purchase, status: 'reserved' };
    const paid = await this.o.processor.charge({ card: rule.card, seller: p.seller, usd: p.usd, purchase: p.purchase });
    return { purchase: p.purchase, status: 'paid', receipt: await this.keep(connection, p.purchase, paid.receipt, paid.usd) };
  }

  async receipt(connection: Connection, purchase: string, receipt: { bytes: Uint8Array; usd: number }): Promise<string> {
    if (TRUSTED[connection.writer] === undefined) throw new BuyingRefused(`a receipt comes from you, on the card or from deep inbox, not ${connection.writer}`, { field: 'writer', purchase });
    if (!isObj(receipt) || !(receipt.bytes instanceof Uint8Array)) throw new BuyingRefused('a receipt is its bytes', { field: 'bytes', purchase });
    if (!isPrice(receipt.usd)) throw new BuyingRefused('a receipt names its amount in dollars', { field: 'usd', purchase });
    return this.keep(connection, purchase, receipt.bytes, receipt.usd);
  }

  /** The receipt kept as evidence, any card number in it masked, and its amount charged citing it. */
  private async keep(connection: Connection, purchase: string, bytes: Uint8Array, usd: number): Promise<string> {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const kept = cardNumbers(text).length ? new TextEncoder().encode(masked(text)) : bytes;
    const handle = await this.o.record.keep(this.core(connection), { bytes: kept, kind: 'receipt', source: `receipt of ${purchase}` });
    await this.o.ledger.charge(this.core(connection), purchase, usd, [handle.replace(/^ev:/, '')]);
    return handle;
  }

  private core(connection: Connection): Connection {
    return { writer: 'core', actor: connection.actor, scope: connection.scope, ...(connection.session ? { session: connection.session } : {}) };
  }

  /** Reads the card rules the log gained. */
  private async sync(): Promise<void> {
    for (;;) {
      const page: Event[] = await this.o.record.read({ after: this.cursor, limit: PAGE });
      for (const e of page) {
        if (e.kind === 'card_rule.set' && e.writer === 'core' && isObj(e.data)) {
          const d = e.data;
          this.rules.set(e.id, { seller: String(d.seller), max_usd: Number(d.max_usd), card: String(d.card) });
        }
      }
      if (page.length) this.cursor = page[page.length - 1]!.log_pos;
      if (page.length < PAGE) return;
    }
  }
}

/** A purchase as the module takes it; text carrying a card number is refused before anything holds it. */
function checked(input: PurchaseInput): PurchaseInput {
  if (!isObj(input) || typeof input.purchase !== 'string' || !PURCHASE.test(input.purchase)) throw new BuyingRefused('a purchase is named run:<ULID>', { field: 'purchase' });
  const purchase = input.purchase;
  for (const field of ['what', 'seller', 'budget'] as const) if (!isText(input[field])) throw new BuyingRefused(`${purchase} names its ${field}`, { field, purchase });
  if (input.refund !== null && !isText(input.refund)) throw new BuyingRefused(`${purchase}'s refund is how the seller refunds it, or null`, { field: 'refund', purchase });
  if (!isPrice(input.usd)) throw new BuyingRefused(`${purchase} has a price in dollars`, { field: 'usd', purchase });
  for (const field of ['what', 'seller', 'refund'] as const) {
    const text = input[field];
    if (typeof text === 'string' && cardNumbers(text).length) throw new BuyingRefused(`${purchase}'s ${field} holds a card number, which DeepBuild never takes`, { field, purchase });
  }
  return { purchase, what: input.what, seller: input.seller, usd: input.usd, budget: input.budget, refund: input.refund };
}

export async function openBuying(options: BuyingOptions): Promise<Buying> {
  const buyer = new Buyer(options);
  return {
    cardRule: (connection, rule) => buyer.cardRule(connection, rule),
    buy: (connection, purchase) => buyer.buy(connection, purchase),
    receipt: (connection, purchase, receipt) => buyer.receipt(connection, purchase, receipt),
  };
}
