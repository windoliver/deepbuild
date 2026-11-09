// Channels (#65; design: Blocks for plug-ins that do real work, Channel): the hub's side of every way to reach you.
// A channel plug-in only transports. The hub reads where things go (`channels.json`: each channel's provider, the
// routes by kind and urgency, quiet hours), renders each open ask as one item per channel, one thread per ask on every
// channel, sends it, and keeps it current: a refusal comes back to its thread, an answer anywhere closes it everywhere.
// Each answer a channel returns is checked here, never taken on the channel's word: a paired device's signature over
// the card it showed, which is the trusted path, or an account link you made, which counts for "I did it", a taste
// call or a choice, answering that ask alone. Every channel runs its own passes, so one that stalls holds up no other.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import type { Devices } from './trusted.js';

type Obj = Record<string, unknown>;
type Kind = 'device' | 'chat' | 'email' | 'text';
// channel@1's shapes (packages/contracts/slots/channel@1.json; the kit in @deepbuild/conformance).
interface Item {
  thread_key: string; summary: string; link: string; answerable: 'answer' | 'view' | 'cancel' | 'closed';
  options: { id: string; label: string }[]; revision: number; hub: string; refused: string | null; unpaired?: { device: string; by: string };
}
interface ChannelRequest { method: 'GET' | 'POST'; path: string; body?: unknown }
interface ChannelCtx { settings: Record<string, unknown>; fetch(request: ChannelRequest): Promise<{ status: number; body: unknown }> }
type ChannelDelivered = { outcome: 'delivered'; ack: string } | { outcome: 'stalled' } | { outcome: 'timed_out' } | { outcome: 'conflict'; conflict: string };
interface ChannelAnswer { thread_key: string; answer: string; signature?: unknown; account_link_id?: string }
interface ChannelReceived { answers: ChannelAnswer[]; seen: string[]; conflict: string | null }
interface Route { kinds: string[]; to: string[]; urgent?: boolean; next?: string[]; unseen?: string }
interface Settings { channels: Record<string, Obj>; routes: Route[]; quiet: { from: string; to: string } | null }
/** An ask as the channels render it: its kind, words and options, and where it is in its life. */
export interface ChannelAsk { handle: string; kind: string; question: string; options: { id: string; label: string }[]; status: string; outcome: string; answer: string | null }
/** What the hub gives the channels: its clock and root, the loaded channels, the asks, the record and the answer path. */
interface ChannelDeps {
  root: string;
  /** The hub's ID, as its hello names it: what a signature must be for (#1579). */
  hub: string;
  now(): number;
  plant?: string | undefined;
  devices: Devices;
  loaded(): { name: string; kind: Kind }[];
  call(name: string, op: 'deliver' | 'receive', item: Item | null, ctx: ChannelCtx): Promise<unknown>;
  asks(): Promise<ChannelAsk[]>;
  append(kind: string, data: Obj, subject?: string): Promise<void>;
  /** Counts a checked answer as the asks core's; throws, with the reason, when it refuses it. */
  answer(handle: string, option: string, how: { channel: string; proof: 'device' | 'account_link' }): Promise<void>;
  /** The planted wrong program's close of an ask whose send failed. */
  cancel(handle: string): Promise<void>;
}

/** The words a card that can't be answered here carries. */
const WHERE = 'answer in the app or on your paired phone';
const TRUSTED = 'an answer with authority, or one saved as a decision, counts only on the trusted path: the DeepBuild app, deep inbox answer once the OS confirms you, or your paired phone, which signs it';
const TICK_MS = 250;
const RECEIVE_MS = 1000;
const FETCH_MS = 5000;
const NEEDS_TRUSTED = new Set(['authority', 'exception', 'definition']);
const LIVE = new Set(['shown', 'held']);

/**
 * One thread on one channel: the card it accepted last, whether any send was tried (one that timed out may have
 * landed), a send under way, and when a failed one goes again.
 */
interface Thread { sent?: Item; key?: string; tried: boolean; inflight: boolean; retryAt: number; tries: number; refused: string | null }
interface Channel { name: string; kind: Kind; threads: Map<string, Thread>; busy: boolean; receivedAt: number; conflict: string | null }

const cardHash = (item: Pick<Item, 'summary' | 'options'>): string => createHash('sha256').update(canonicalize({ summary: item.summary, options: item.options } as unknown as JsonValue)).digest('hex');
const keyOf = (item: Item): string => new TextDecoder().decode(canonicalize(item as unknown as JsonValue));
/** A duration as the ask settings write them: 30s, 5m, 2h, 1d. */
function duration(text: string | undefined): number | undefined {
  const m = /^(\d+)(s|m|h|d)$/.exec(text ?? '');
  return m ? Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'] : undefined;
}
/** The minute of the day of "HH:MM", or undefined. */
const minuteOf = (text: string): number | undefined => { const m = /^(\d\d):(\d\d)$/.exec(text); return m ? Number(m[1]) * 60 + Number(m[2]) : undefined; };
/**
 * A summary carries no secret, code or evidence: the question's first line, scrubbed as evidence is, with any long
 * hex run (a hash, a handle's digest) left out.
 */
function summaryOf(question: string): string {
  const line = question.split('\n')[0]!.trim();
  return scrubText(line).replace(/(sha256:)?[0-9a-f]{16,}/gi, '[hash]').slice(0, 300);
}

export class Channels {
  private readonly settings: Settings;
  readonly hub: string;
  private readonly channels = new Map<string, Channel>();
  /** Threads you saw on any channel, and when an ask first went out on a channel its route names first. */
  private readonly seen = new Set<string>();
  private readonly firstAt = new Map<string, number>();
  private readonly notices: Item[] = [];
  private asks: ChannelAsk[] = [];
  private timer: NodeJS.Timeout | undefined;
  private reading: Promise<void> | undefined;
  private readAt = 0;
  private linked: Record<string, string[]>;

  constructor(private readonly deps: ChannelDeps) {
    this.settings = readSettings(join(deps.root, 'channels.json'));
    this.hub = deps.hub;
    this.linked = this.links();
  }

  start(): void {
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Your account on a channel, linked once the OS confirmed you: its answers count for "I did it", taste and choice. */
  link(channel: string, account: string): void {
    const file = join(this.deps.root, 'channel-links.json');
    const links = this.links();
    links[channel] = [...new Set([...(links[channel] ?? []), account])];
    writeFileSync(`${file}.tmp`, JSON.stringify(links), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    this.linked = links;
  }
  private links(): Record<string, string[]> {
    const file = join(this.deps.root, 'channel-links.json');
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]> : {}; } catch { return {}; }
  }
  /** A device you unpaired is told so on every device channel, naming this Mac. */
  unpaired(device: string): void {
    this.notices.push({
      thread_key: device, summary: `This device was unpaired from DeepBuild by ${hostname()}; what it signs counts for nothing now.`,
      link: `deepbuild://device/${device.slice('device:'.length)}`, answerable: 'view', options: [], revision: 1, hub: this.hub, refused: null,
      unpaired: { device, by: hostname() },
    });
  }

  private tick(): void {
    const loaded = this.deps.loaded().filter((l) => this.settings.channels[l.name]);
    if (!loaded.length) return;
    // The asks are read once a second for every channel; each channel's pass is its own.
    if (!this.reading && Date.now() - this.readAt >= RECEIVE_MS) {
      this.readAt = Date.now();
      this.reading = this.deps.asks().then((asks) => { this.asks = asks; }, () => undefined).finally(() => { this.reading = undefined; });
    }
    for (const { name, kind } of loaded) {
      let c = this.channels.get(name);
      if (!c) this.channels.set(name, c = { name, kind, threads: new Map(), busy: false, receivedAt: 0, conflict: null });
      if (c.busy || (c.conflict && this.deps.plant !== 'takes-turns-at-token')) continue;
      c.busy = true;
      void this.pass(c).catch((e: unknown) => process.stderr.write(`deep hub: channel ${name}: ${e instanceof Error ? e.message : String(e)}\n`)).finally(() => { c.busy = false; });
    }
  }

  /** One pass of one channel: what its provider has for you, then each card that is due. */
  private async pass(c: Channel): Promise<void> {
    if (Date.now() - c.receivedAt >= RECEIVE_MS) {
      c.receivedAt = Date.now();
      const got = await (this.deps.call(c.name, 'receive', null, this.ctx(c.name)) as Promise<ChannelReceived>).catch(() => undefined);
      if (got?.conflict) return this.conflicted(c, got.conflict);
      for (const key of got?.seen ?? []) this.seen.add(String(key));
      for (const answer of got?.answers ?? []) await this.take(c, answer);
    }
    for (const item of this.due(c)) {
      if (c.conflict && this.deps.plant !== 'takes-turns-at-token') return;
      await this.send(c, item);
    }
  }

  private async conflicted(c: Channel, conflict: string): Promise<void> {
    if (c.conflict) return;
    c.conflict = conflict;
    await this.deps.append('channel.conflict', { channel: c.name, conflict: String(conflict).slice(0, 8192) });
  }

  /** The hub's call to the channel's provider: its settings' api, its token added here, bounded. */
  private ctx(name: string): ChannelCtx {
    const { token, ...settings } = this.settings.channels[name] ?? {};
    return {
      settings,
      fetch: async (request: ChannelRequest) => {
        const api = typeof settings.api === 'string' ? settings.api : '';
        if ((request?.method !== 'GET' && request?.method !== 'POST') || typeof request.path !== 'string' || !request.path.startsWith('/')) throw Error('a channel calls GET or POST on a path under its api');
        const url = new URL(request.path, api);
        if (url.origin !== new URL(api).origin) throw Error(`a channel calls only its own api, ${new URL(api).origin}`);
        const reply = await fetch(url, {
          method: request.method, signal: AbortSignal.timeout(FETCH_MS),
          headers: { ...(request.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(typeof token === 'string' ? { authorization: `Bearer ${token}` } : {}) },
          ...(request.body !== undefined ? { body: JSON.stringify(request.body) } : {}),
        });
        const text = await reply.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* text */ }
        return { status: reply.status, body };
      },
    };
  }

  // ---- What goes out.

  /** The cards due on a channel now, the answerable ones first. */
  private due(c: Channel): Item[] {
    const now = this.deps.now();
    const out: Item[] = [];
    if (c.kind === 'device') for (const n of this.notices) out.push(n);
    for (const ask of this.asks) {
      const thread = c.threads.get(ask.handle);
      if (ask.status === 'closed') {
        // Closed: the card it shows changes to say so, on every channel a card went to, once its send under way ends.
        // A card whose send was still under way, or never acknowledged, stays as sent: the planted wrong program.
        if (thread?.tried && (thread.sent || this.deps.plant !== 'live-buttons-after-answer')) out.push(this.render(c, ask));
        continue;
      }
      if (!LIVE.has(ask.status)) continue;
      if (thread?.sent || this.routed(c, ask, now)) out.push(this.render(c, ask));
    }
    return out.filter((item) => {
      const t = c.threads.get(item.thread_key);
      return !t || (!t.inflight && t.key !== keyOf(item) && Date.now() >= t.retryAt);
    }).sort((a, b) => Number(b.answerable === 'answer') - Number(a.answerable === 'answer'));
  }
  /** Whether an open ask goes to this channel now: the first route naming its kind, its quiet hours and its wait. */
  private routed(c: Channel, ask: ChannelAsk, now: number): boolean {
    const route = this.settings.routes.find((r) => r.kinds.includes(ask.kind));
    if (!route) return false;
    if (this.quiet(now) && !route.urgent) return false;
    if (route.to.includes(c.name)) return true;
    if (!route.urgent || !(route.next ?? []).includes(c.name) || this.seen.has(ask.handle)) return false;
    const first = this.firstAt.get(ask.handle);
    const wait = duration(route.unseen) ?? 0;
    return first !== undefined && now - first >= wait;
  }
  private quiet(now: number): boolean {
    const q = this.settings.quiet;
    const from = q ? minuteOf(q.from) : undefined;
    const to = q ? minuteOf(q.to) : undefined;
    if (from === undefined || to === undefined) return false;
    const at = new Date(now);
    const minute = at.getHours() * 60 + at.getMinutes();
    return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
  }
  /** The card for one ask on one channel, by the trusted-path rule. */
  private render(c: Channel, ask: ChannelAsk): Item {
    const base = { thread_key: ask.handle, link: `deepbuild://ask/${ask.handle.slice(4)}`, revision: 1, hub: this.hub };
    const text = c.kind === 'text';
    if (ask.status === 'closed') {
      const chosen = ask.options.find((o) => o.id === ask.answer)?.label ?? ask.answer;
      const said = ask.outcome === 'answered' && chosen ? `Answered: ${summaryOf(chosen)}` : `Closed: ${ask.outcome.replaceAll('_', ' ')}`;
      return { ...base, summary: text ? '' : said, answerable: 'closed', options: [], refused: null };
    }
    const refused = text ? null : c.threads.get(ask.handle)?.refused ?? null;
    if (text) return { ...base, summary: '', answerable: 'view', options: [], refused: null };
    const question = summaryOf(ask.question);
    const answerable = c.kind === 'device'
      || (this.deps.plant === 'buttons-for-authority' && c.kind === 'chat')
      || (!NEEDS_TRUSTED.has(ask.kind) && (this.linked[c.name] ?? []).length > 0);
    if (!answerable) return { ...base, summary: `${question} (${WHERE})`, answerable: 'view', options: [], refused };
    return { ...base, summary: question, answerable: 'answer', options: ask.options.map((o) => ({ id: o.id, label: summaryOf(o.label) })), refused };
  }

  private async send(c: Channel, item: Item): Promise<void> {
    const t = c.threads.get(item.thread_key) ?? { tried: false, inflight: false, retryAt: 0, tries: 0, refused: null };
    c.threads.set(item.thread_key, t);
    t.inflight = true;
    t.tried = true;
    let said: ChannelDelivered | undefined;
    try {
      said = await (this.deps.call(c.name, 'deliver', item, this.ctx(c.name)) as Promise<ChannelDelivered>).catch(() => ({ outcome: 'timed_out' as const }));
    } finally {
      t.inflight = false;
    }
    const ack = said.outcome === 'delivered' && typeof said.ack === 'string' && said.ack ? said.ack.slice(0, 2000) : null;
    const outcome = said.outcome === 'delivered' ? (ack ? 'delivered' : 'stalled') : ['stalled', 'timed_out', 'conflict'].includes(said.outcome) ? said.outcome : 'stalled';
    await this.deps.append('channel.delivered', { channel: c.name, thread_key: item.thread_key, item, outcome, ack }, item.thread_key);
    if (outcome === 'conflict') return this.conflicted(c, (said as { conflict?: string }).conflict ?? 'the provider reports another client');
    if (outcome === 'delivered') {
      t.sent = item;
      t.key = keyOf(item);
      t.tries = 0;
      if (item.answerable !== 'closed' && !this.firstAt.has(item.thread_key)) this.firstAt.set(item.thread_key, this.deps.now());
      return;
    }
    // A failed send closes the ask everywhere: the planted wrong program.
    if (this.deps.plant === 'closes-on-failed-send' && item.answerable !== 'closed') await this.deps.cancel(item.thread_key).catch(() => undefined);
    t.tries++;
    t.retryAt = Date.now() + Math.min(15_000, 1000 * 2 ** Math.min(t.tries, 4));
    // One channel stalling sends every channel's cards again: the planted wrong program.
    if (this.deps.plant === 'reconnects-every-channel') for (const other of this.channels.values()) for (const th of other.threads.values()) delete th.key;
  }

  // ---- What comes back.

  /** One answer a channel returned: its proof checked here, then counted, or refused back to its thread. */
  private async take(c: Channel, a: ChannelAnswer): Promise<void> {
    const thread = String(a?.thread_key ?? '');
    const answer = String(a?.answer ?? '');
    const ask = this.asks.find((x) => x.handle === thread);
    // A press on a card whose ask has closed changes nothing: no card, no answer, no decision.
    if (ask?.status === 'closed') return;
    const refuse = (reason: string, field?: string): Promise<void> => this.refuse(c, thread, answer, reason, field);
    let proof: 'device' | 'account_link';
    if (a.signature !== undefined) {
      const why = this.signedWrong(c, thread, answer, a.signature);
      if (why) return refuse(why.reason, why.field);
      proof = 'device';
    } else if (a.account_link_id !== undefined) {
      const account = String(a.account_link_id);
      const held = this.deps.plant === 'trusts-channel-proof' || (this.linked[c.name] ?? []).includes(account);
      if (!held) return refuse(`the answer names the account ${account}, which no link you made on ${c.name} holds, so it counts for nothing`, 'account_link_id');
      proof = 'account_link';
    } else {
      return refuse(`the answer carries neither a paired device's signature nor an account link you made, so it counts for nothing; ${TRUSTED}`);
    }
    if (!ask) return refuse(`${thread} is no ask this hub holds`, 'ask');
    if (proof === 'account_link' && NEEDS_TRUSTED.has(ask.kind)) return refuse(`${thread} is ${ask.kind === 'authority' ? 'an authority ask' : `a ${ask.kind}`}, and ${TRUSTED}`);
    try {
      await this.deps.answer(thread, answer, { channel: c.name, proof });
    } catch (e) {
      return refuse(e instanceof Error ? e.message : String(e));
    }
    await this.deps.append('channel.answered', { channel: c.name, thread_key: thread, answer, proof }, thread);
    this.asks = await this.deps.asks().catch(() => this.asks);
  }
  /**
   * Why a signed answer doesn't count, naming the field, or undefined once every part of it holds: the one verifier's
   * check for `channel.answer` (#1579), over the params the signature carries, then each of them against the card
   * this hub sent on the thread.
   */
  private signedWrong(c: Channel, thread: string, answer: string, signature: unknown): { field: string; reason: string } | undefined {
    if (this.deps.plant === 'trusts-channel-proof') return undefined;
    const carried = (typeof signature === 'object' && signature !== null ? (signature as { params?: unknown }).params : undefined);
    const params = (typeof carried === 'object' && carried !== null ? carried : {}) as Obj;
    const sent = c.threads.get(thread)?.sent;
    return this.deps.devices.verify(signature, { method: 'channel.answer', hub: this.hub, params, now: this.deps.now() }, { unpairedToo: this.deps.plant === 'keeps-unpaired-key', skipsTime: this.deps.plant === 'signature-skips-time' }, () => {
      if (params.ask !== thread) return { field: 'ask', reason: `it signs ${String(params.ask)}, not ${thread}` };
      if (params.revision !== (sent?.revision ?? 1)) return { field: 'revision', reason: `it signs revision ${String(params.revision)} of ${thread}'s card, not ${sent?.revision ?? 1}` };
      if (!sent || params.card_hash !== cardHash(sent)) return { field: 'card_hash', reason: `it signs a card that isn't the one this hub sent ${c.name} on ${thread}` };
      if (params.answer !== answer) return { field: 'answer', reason: `it signs the answer ${String(params.answer)}, not ${answer}` };
      return undefined;
    });
  }
  private async refuse(c: Channel, thread: string, answer: string, reason: string, field?: string): Promise<void> {
    await this.deps.append('channel.refused', { channel: c.name, thread_key: thread.slice(0, 200), answer: answer.slice(0, 2000), ...(field ? { field } : {}), reason: reason.slice(0, 8192) }, /^ask:[0-9A-Za-z]+$/.test(thread) ? thread : undefined);
    // The card comes back to its thread with the reason.
    const t = c.threads.get(thread);
    if (t) t.refused = reason.slice(0, 8192);
  }
}

function readSettings(file: string): Settings {
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    return { channels: s.channels ?? {}, routes: Array.isArray(s.routes) ? s.routes : [], quiet: s.quiet ?? null };
  } catch {
    return { channels: {}, routes: [], quiet: null };
  }
}
