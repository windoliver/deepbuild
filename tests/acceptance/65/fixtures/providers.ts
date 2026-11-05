// The providers no test can reach, as stand-ins on 127.0.0.1 (README, The worlds): paseo's relay to your phone, a chat
// app with a bot token, an email provider and a text-message provider. Each speaks the one small protocol README, The
// surface (my choice), names, records every request it gets, and lets a test bend it: hold or fail a send, go silent,
// report a second client on its token, or change a card on the way. `Phone` is paseo's phone app: an Ed25519 device
// key the test pairs, which reads the cards the relay holds and signs answers over what it showed. Nothing here
// decides anything for the hub: each one carries what the channel sends and what the person does.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { canonicalize, type JsonValue } from '../../../../packages/contracts/src/index.ts';

export type Kind = 'paseo' | 'chat' | 'email' | 'text';
export interface Option { id: string; label: string }
/** What the hub hands a channel's deliver, and the channel posts as it is (README, The surface: the item). */
export interface Item {
  thread_key: string; summary: string; link: string; answerable: 'answer' | 'view' | 'cancel' | 'closed'; options: Option[];
  revision: number; hub: string; refused: string | null; unpaired?: { device: string; by: string };
  [field: string]: unknown;
}
export interface Posted { at: number; to: unknown; item: Item; status: number }
export interface Call { at: number; method: string; path: string; status: number | 'held' }
export interface Signed { device: string; ask: string; revision: number; card_hash: string; hub: string; at: number; answer: string }
/** An answer the person gave on the provider's side, as GET /answers hands it out. */
export interface Answer { thread_key: string; answer: string; signature?: { signed: Partial<Signed>; sig: string }; account?: string }

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const read = (req: IncomingMessage): Promise<string> => new Promise((done) => {
  let text = '';
  req.setEncoding('utf8').on('data', (d: string) => (text += d)).on('end', () => done(text)).on('error', () => done(text));
});
const isItem = (v: unknown): v is Item => {
  const o = v as Item;
  return typeof o === 'object' && o !== null && typeof o.thread_key === 'string' && typeof o.summary === 'string' && typeof o.link === 'string'
    && ['answer', 'view', 'cancel', 'closed'].includes(o.answerable) && Array.isArray(o.options) && Number.isInteger(o.revision) && typeof o.hub === 'string';
};
/** The card a device shows, hashed as README says: SHA-256 hex of the RFC 8785 bytes of {summary, options}. */
export const cardHash = (item: Pick<Item, 'summary' | 'options'>): string =>
  createHash('sha256').update(canonicalize({ summary: item.summary, options: item.options } as unknown as JsonValue)).digest('hex');

export class Provider {
  /** Every POST /messages, in arrival order, with the status it was answered with (0 while held or never answered). */
  readonly posts: Posted[] = [];
  readonly calls: Call[] = [];
  private readonly answers: { answer: Answer; picked?: number }[] = [];
  private readonly seenKeys = new Set<string>();
  /** A thread's next POST is held this long before it is answered: a send still in flight. */
  readonly holds = new Map<string, number>();
  /** Threads whose POSTs are answered 500: a send that fails. */
  readonly failing = new Set<string>();
  /** When the provider first said another client holds the token, and whether it still does. */
  conflictSince: number | undefined;
  private conflicted = false;
  private silentUntil = 0;
  private readonly hung = new Set<ServerResponse>();
  /** A change made to each card on the way, before the person's device shows it. */
  tamper: ((item: Item) => Item) | undefined;
  private constructor(readonly kind: Kind, readonly server: Server, readonly api: string, readonly token: string | undefined) {}

  static async start(kind: Kind, token?: string): Promise<Provider> {
    let self!: Provider;
    const server = createServer((req, res) => void self.handle(req, res).catch((e: Error) => json(res, 500, { error: e.message })));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    self = new Provider(kind, server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token);
    return self;
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const at = Date.now();
    const url = new URL(req.url ?? '/', this.api);
    const call: Call = { at, method: req.method ?? '', path: url.pathname, status: 'held' };
    this.calls.push(call);
    const body = await read(req);
    if (at < this.silentUntil) {
      // Silent: nothing is answered until the silence ends, and then the connection just goes.
      this.hung.add(res);
      setTimeout(() => { this.hung.delete(res); res.destroy(); }, this.silentUntil - at).unref();
      return;
    }
    const answer = (status: number, out: unknown) => { call.status = status; json(res, status, out); };
    if (this.token !== undefined && req.headers.authorization !== `Bearer ${this.token}`) return answer(401, { error: 'no bot token, or not this one' });
    if (this.conflicted) {
      this.conflictSince ??= at;
      return answer(409, { conflict: 'another client holds this bot token' });
    }
    if (req.method === 'POST' && url.pathname === '/messages') {
      let parsed: { to?: unknown; item?: unknown };
      try { parsed = JSON.parse(body) as { to?: unknown; item?: unknown }; } catch { return answer(400, { error: 'not JSON' }); }
      if (!isItem(parsed.item)) return answer(400, { error: 'POST /messages takes {to, item} with the item README names' });
      const item = this.tamper ? this.tamper(structuredClone(parsed.item)) : parsed.item;
      const posted: Posted = { at, to: parsed.to ?? null, item, status: 0 };
      this.posts.push(posted);
      const hold = this.holds.get(item.thread_key);
      if (hold !== undefined) {
        this.holds.delete(item.thread_key);
        await new Promise((done) => setTimeout(done, hold));
      }
      if (this.failing.has(item.thread_key)) { posted.status = 500; return answer(500, { error: 'the provider failed this send' }); }
      posted.status = 200;
      return answer(200, { ack: `${this.kind}-${this.posts.length}` });
    }
    if (req.method === 'GET' && url.pathname === '/answers') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const from = Number.isSafeInteger(after) && after >= 0 ? after : 0;
      const out = this.answers.slice(from);
      for (const a of out) a.picked ??= at;
      return answer(200, { answers: out.map((a) => a.answer), seen: [...this.seenKeys], cursor: String(this.answers.length) });
    }
    return answer(404, { error: `no ${req.method} ${url.pathname}` });
  }

  // ---- What the person does on the provider's side.
  /** An answer given here: a press on a card, a reply, a signed answer from the phone. */
  give(answer: Answer): { picked(): number | undefined } {
    const entry = { answer };
    this.answers.push(entry);
    return { picked: () => (entry as { picked?: number }).picked };
  }
  seen(threadKey: string): void { this.seenKeys.add(threadKey); }
  /** The provider stops answering for `ms`: the connection goes silent. */
  silent(ms: number): void { this.silentUntil = Date.now() + ms; }
  /** Another client holds this provider's token from now (on) or no longer (off). */
  secondClient(on: boolean): void { this.conflicted = on; }

  // ---- What the provider holds.
  /** The cards it accepted for a thread, oldest first. */
  delivered(threadKey: string): Item[] { return this.posts.filter((p) => p.status === 200 && p.item.thread_key === threadKey).map((p) => p.item); }
  /** The card a thread shows now: the last one accepted. */
  latest(threadKey: string): Item | undefined { return this.delivered(threadKey).at(-1); }
  /** Every request after `at` (ms since the epoch). */
  callsAfter(at: number): Call[] { return this.calls.filter((c) => c.at > at); }
  async stop(): Promise<void> {
    for (const res of this.hung) res.destroy();
    this.server.closeAllConnections();
    await new Promise((done) => this.server.close(done));
  }
}

/** paseo's phone app with its own device key; `device` is the ID the hub gave it at pairing (device.pair). */
export class Phone {
  readonly key: KeyObject;
  readonly publicKey: string;
  device = '';
  constructor(readonly name = 'Test phone') {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    this.key = privateKey;
    this.publicKey = String(publicKey.export({ format: 'jwk' }).x);
  }
  /**
   * The person answers a card the relay shows, signed with this phone's key over the card as it showed it (README, The
   * surface: the device's signature). `sign: 'none'` sends no signature; `'forged'` names this phone's device and signs
   * with another key; `leave` drops fields from what is signed; `at` signs another time.
   */
  answer(relay: Provider, threadKey: string, option: string, o: { sign?: 'valid' | 'none' | 'forged'; at?: number; leave?: (keyof Signed)[] } = {}): { answer: Answer; picked(): number | undefined } {
    const shown = relay.latest(threadKey);
    if (!shown) throw Error(`BLOCKED: the phone shows no card for ${threadKey}: the paseo channel delivered none (cards it holds: ${relay.posts.map((p) => p.item.thread_key).join(', ') || 'none'})`);
    const answer: Answer = { thread_key: threadKey, answer: option };
    if ((o.sign ?? 'valid') !== 'none') {
      const signed: Partial<Signed> = { device: this.device, ask: threadKey, revision: shown.revision, card_hash: cardHash(shown), hub: shown.hub, at: o.at ?? Date.now(), answer: option };
      for (const field of o.leave ?? []) delete signed[field];
      const key = o.sign === 'forged' ? generateKeyPairSync('ed25519').privateKey : this.key;
      answer.signature = { signed, sig: sign(null, canonicalize(signed as unknown as JsonValue), key).toString('base64url') };
    }
    return { answer, picked: relay.give(answer).picked };
  }
}
