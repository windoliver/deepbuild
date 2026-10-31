// Sends (#365): anything a plug-in sends that leaves your machine for a person. It goes out under a standing rule you
// set (the piece that sends, its recipients and, for a scheduled send, the schedule; the content is never bound), or
// on your yes to an authority ask whose plan names what differs from your rules. Its key is claimed in the record and
// synced before the request goes out, and checked before any retry, so a send goes out once, also across a power cut:
// a claim with no recorded answer reads unknown and is never sent again on its own. Each step is send.made@1.
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { Asks, PlanInput } from '@deepbuild/asks';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import type { HttpClient } from './sources.js';

/** One send, as the hub holds it. */
export interface SendRow {
  key: string; piece: string; schedule: string | null; run: string | null; kind: string; to: string[];
  outcome: 'sent' | 'not sent' | 'unknown' | 'waiting';
  plan: string;
  ask: string | null; rule: string | null;
}
/** A standing rule for sends: the piece that sends, its recipients and, for a scheduled send, the schedule. */
export interface SendRule { sentence: string; piece: string; recipients: string[]; schedule: string | null }
/** What a send is for: the piece, and the run or action call it is made in. */
export interface SendFor { piece: string; hosts: string[]; schedule: string | null; run: string | null; call: string | null; until: number; ended: () => boolean }
interface Made { key: string; piece: string; phase: 'asked' | 'claimed' | 'answered' | 'refused'; kind: string; to: string[]; plan: string; schedule: string | null; run: string | null; call: string | null; rule: string | null; ask: string | null; status?: number }

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** How long a send's request has to be answered. */
const SEND_MS = 30_000;
const POLL_MS = 100;
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0);

export class Sends {
  /** Sends waiting on your answer, by piece and key. */
  private readonly waiting = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(private readonly o: {
    record: RecordStore; now: () => number; http: HttpClient; asks: Asks | undefined;
    rules: () => Record<string, SendRule>; saveRules: (rules: Record<string, SendRule>) => void;
  }) {}

  close(): void {
    this.closed = true;
  }

  /** Your standing rule, set on the trusted path; its handle. */
  setRule(rule: SendRule): string {
    if (typeof rule?.sentence !== 'string' || !rule.sentence.trim()) throw Error('a standing rule for sends says what it covers in a sentence');
    if (typeof rule.piece !== 'string' || !rule.piece) throw Error('a standing rule for sends names the piece that sends');
    if (!strings(rule.recipients)) throw Error('a standing rule for sends names its recipients');
    if (rule.schedule !== null && typeof rule.schedule !== 'string') throw Error('a standing rule for sends names the schedule it sends on, or null for sends no schedule makes');
    const handle = `rule:${ulid(this.o.now())}`;
    this.o.saveRules({ ...this.o.rules(), [handle]: { sentence: rule.sentence, piece: rule.piece, recipients: [...rule.recipients], schedule: rule.schedule } });
    return handle;
  }

  /** Every send in the record, its outcome from its last step: answered 2xx is sent, a claim with no answer unknown. */
  async rows(): Promise<SendRow[]> {
    const rows = (await this.o.record.raw("SELECT data FROM events WHERE kind = 'send.made' ORDER BY log_pos")) as { data: string }[];
    const last = new Map<string, Made>();
    for (const r of rows) {
      const m = JSON.parse(r.data) as Made;
      last.set(`${m.piece}\u0000${m.key}`, m);
    }
    return [...last.entries()].map(([id, m]) => ({
      key: m.key, piece: m.piece, schedule: m.schedule, run: m.run, kind: m.kind, to: m.to, plan: m.plan, ask: m.ask, rule: m.rule,
      outcome: m.phase === 'answered' ? (m.status! >= 200 && m.status! < 300 ? 'sent' : 'not sent') : m.phase === 'claimed' ? 'unknown'
        : m.phase === 'asked' && this.waiting.has(id) ? 'waiting' : 'not sent',
    }));
  }

  /**
   * `deep.send`: one message to people, made by the hub. A key already sent answers as sent and goes out no more; one
   * whose request went out with no answer recorded is refused, never sent again on its own.
   */
  async send(message: unknown, f: SendFor): Promise<{ key: string; outcome: 'sent' }> {
    const m = (typeof message === 'object' && message !== null ? message : {}) as Record<string, unknown>;
    const { kind, key, to, host, path } = m;
    const subject = typeof m.subject === 'string' ? m.subject : '';
    const body = typeof m.body === 'string' ? m.body : '';
    if (typeof kind !== 'string' || !kind) throw Error('deep.send: a send names its kind, such as email');
    if (typeof key !== 'string' || !key || key.length > 512) throw Error('deep.send: a send has a key, its one cause, of at most 512 characters');
    if (!strings(to)) throw Error(`deep.send: ${key} names who it goes to`);
    if (typeof host !== 'string' || !f.hosts.includes(host)) throw Error(`deep.send: ${key} goes through a host the grant doesn't name`);
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) throw Error(`deep.send: ${key} gives no path on its host`);
    const id = `${f.piece}\u0000${key}`;
    const before = this.locks.get(id) ?? Promise.resolve();
    const now = before.catch(() => undefined).then(() => this.sendNow({ kind, key, to, host, path, subject, body }, f));
    this.locks.set(id, now);
    try {
      return await now;
    } finally {
      if (this.locks.get(id) === now) this.locks.delete(id);
    }
  }
  private async sendNow(m: { kind: string; key: string; to: string[]; host: string; path: string; subject: string; body: string }, f: SendFor): Promise<{ key: string; outcome: 'sent' }> {
    const { kind, key, to } = m;
    const prior = (await this.rows()).find((r) => r.piece === f.piece && r.key === key);
    if (prior?.outcome === 'sent') return { key, outcome: 'sent' };
    if (prior?.outcome === 'unknown') throw Error(`deep.send: ${key}'s request went out before with no answer recorded, so it may have gone out; it isn't sent again on its own`);
    const plan = sha256Hex(canonicalize({ piece: f.piece, schedule: f.schedule, kind, to: [...to].sort(), host: m.host, path: m.path, subject: m.subject, body: m.body } as JsonValue));
    const base = { key, piece: f.piece, kind, to, plan, schedule: f.schedule, run: f.run, call: f.call };
    const rules = this.o.rules();
    const rule = Object.keys(rules).find((h) => rules[h]!.piece === f.piece && sameSet(rules[h]!.recipients, to) && rules[h]!.schedule === f.schedule) ?? null;
    let ask: string | null = null;
    if (!rule) {
      ask = await this.ask(m, f, plan, rules);
      const id = `${f.piece}\u0000${key}`;
      this.waiting.add(id);
      try {
        await this.append({ ...base, phase: 'asked', rule: null, ask });
        const answer = await this.answer(ask, f);
        if (answer !== 'yes') {
          await this.append({ ...base, phase: 'refused', rule: null, ask });
          throw Error(`deep.send: ${key} wasn't sent: ${answer}`);
        }
      } finally {
        this.waiting.delete(id);
      }
    }
    // The claim is durable before the request goes out: a power cut after it leaves the send unknown, never sent twice.
    await this.append({ ...base, phase: 'claimed', rule, ask });
    await this.o.record.sync();
    let status: number;
    try {
      const answer = await this.o.http({ url: `https://${m.host}${m.path}`, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, to, subject: m.subject, body: m.body }) }, AbortSignal.timeout(SEND_MS));
      status = answer.status;
    } catch {
      throw Error(`deep.send: ${key}'s request got no answer, so whether it went out is unknown; it isn't sent again on its own`);
    }
    await this.append({ ...base, phase: 'answered', rule, ask, status });
    if (status < 200 || status > 299) throw Error(`deep.send: ${m.host} answered ${status}, so ${key} wasn't sent`);
    return { key, outcome: 'sent' };
  }

  /** One authority ask for a send no rule covers, its plan naming what differs from your rules for the piece. */
  private async ask(m: { kind: string; key: string; to: string[] }, f: SendFor, plan: string, rules: Record<string, SendRule>): Promise<string> {
    if (!this.o.asks) throw Error(`deep.send: ${m.key} needs your yes, and this host has no asks core to ask you`);
    const mine = Object.values(rules).filter((r) => r.piece === f.piece);
    const differs = mine.length
      ? mine.map((r) => [
        ...m.to.filter((t) => !r.recipients.includes(t)).map((t) => `to ${t}, whom your rule "${r.sentence}" doesn't name`),
        ...(r.schedule !== f.schedule ? [f.schedule ? `on the schedule ${f.schedule}, not ${r.schedule ?? 'outside any schedule'} as your rule "${r.sentence}" says` : `outside the schedule ${r.schedule} your rule "${r.sentence}" names`] : []),
      ].join('; ')).filter(Boolean)
      : ['no standing rule of yours covers sends from this piece'];
    const what = `${f.piece} sends ${m.kind} ${m.key} to ${m.to.join(', ')}${f.schedule ? ` from the schedule ${f.schedule}` : ''}`;
    const input: PlanInput = { steps: [{ does: `${what}: ${differs.join(' | ')}`, changes: [...m.to, ...(f.schedule ? [f.schedule] : [])], undo: null, public: false, cost: 0 }], diff: plan };
    return this.o.asks.raise(CORE, 'action.send', {
      kind: 'authority', question: `Let ${what}? It differs from your rules: ${differs.join('; ')}.`,
      options: [{ id: 'approve', label: 'Send it', decision: 'allow' }, { id: 'decline', label: 'Don\'t', decision: 'deny' }],
      recommended: null, deadline: Math.max(f.until, this.o.now() + 1000), fallback: 'you', default: 'decline', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ send: f.piece, key: m.key, plan })), pinned_to: { kind: 'evidence', ref: plan },
    }, input);
  }
  /** Waits for your answer: 'yes', or why not (you said no, the ask closed at its deadline, its run ended, the hub stopped). */
  private async answer(ask: string, f: SendFor): Promise<string> {
    for (;;) {
      const [row] = (await this.o.record.raw('SELECT status, decision FROM asks WHERE id = ?', [ask.slice(4)])) as { status: string; decision: string | null }[];
      if (row?.decision === 'allow') return 'yes';
      if (row?.decision === 'deny') return `you said no to ${ask}`;
      if (row && row.status !== 'open' && row.status !== 'later') return `${ask} closed with no yes`;
      if (f.ended()) return 'its run ended before you answered';
      if (this.closed) return 'the hub stopped before you answered';
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  private async append(data: Made): Promise<void> {
    const now = this.o.now();
    await this.o.record.append(CORE, { v: 1, id: ulid(now), kind: 'send.made', ts: now, data: data as unknown as JsonValue });
  }
}
