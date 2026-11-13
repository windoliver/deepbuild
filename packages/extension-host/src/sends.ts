// Sends (#365): anything a plug-in sends that leaves your machine for a person. It goes out under a standing rule you
// set (the piece that sends, its recipients and, for a scheduled send, the schedule; the content is never bound), or
// on your yes to an authority ask whose plan names what differs from your rules. Its key is claimed in the record and
// synced before the request goes out, and checked before any retry, so a send goes out once, also across a power cut:
// a claim with no recorded answer reads unknown and is never sent again on its own. Each step is send.made@1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { Asks, PlanInput } from '@deepbuild/asks';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import type { HttpClient } from './source-types.js';
import type { Entry, Ext, Manifest } from './host-types.js';
import type { RunCtx } from './schedule-types.js';
import { CALL_MS, HostFiles, isPlain, texts, trustedPath } from './host-shared.js';
import type { SendRow, SendRule } from './send-types.js';
export type { SendRow, SendRule } from './send-types.js';
import type { SavedNotice, Polled } from './source-types.js';
import type { Schedules } from './schedules.js';
import type { SeriesStore } from './series.js';
/** A notice you created, with its sentence, which names the schedule a source that runs only while shown gave it (#262). */
export interface NoticeRow { id: string; kind: string; key: string; source: string | null; sentence: string; every: number | null }
const NOTICES_PER_MINUTE = 10;
const refuseNotice = (why: string): never => { throw Error(`subscribeNotice: ${why}`); };
const manifestOf = (folder: string): Manifest => JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Manifest;
interface NoticesOptions {
  record: RecordStore; now(): number; files: HostFiles;
  entries: Readonly<Record<string, Entry>>; exts: ReadonlyMap<string, Ext>; scheduler: Schedules;
  series: SeriesStore | undefined;
  answers: { answerOf(handle: string): Promise<{ piece: string; stale_at: number | null } | undefined> };
}
/** Subscription authority, cited-reading freshness and per-plugin notice rate state. */
export class Notices {
  private readonly noticeTimes = new Map<string, number[]>();
  constructor(private readonly options: NoticesOptions) {}
  async subscribeNotice(connection: Connection, kind: string, key: string, on?: { source: string; words: string; every?: number }): Promise<string> {
    trustedPath(connection, 'a notice is subscribed to');
    const plugin = Object.values(this.options.entries).find((e) => (manifestOf(e.folder).notices ?? []).includes(kind))?.id;
    if (!plugin) throw Error(`no installed plug-in declares the notice kind ${kind}`);
    if (typeof key !== 'string' || !key) throw Error(`a subscription to ${kind} names what it is for`);
    const saved = on === undefined ? undefined : await this.noticeOn(plugin, kind, key, on);
    const now = this.options.now();
    const id = ulid(now);
    await this.options.record.append(connection, { v: 1, id, kind: 'notice.subscribed', ts: now, data: { notice_kind: kind, key, by: connection.actor } });
    if (saved) this.options.files.save('notices.json', { ...this.options.files.read('notices.json'), [id]: saved });
    // Its checking job runs at once, then on the schedule the notice gave it.
    if (saved?.job) await this.options.scheduler.runNow(saved.job);
    return id;
  }

  /**
   * A notice you create on a source (#262). On one that runs only while shown, the plug-in's job that checks the notice
   * gets a schedule of its own, reading the source each run, at its while-shown cadence or the slower one the notice
   * names, and the sentence says so; a plug-in with no such job has the notice refused, naming it.
   */
  private async noticeOn(plugin: string, kind: string, key: string, on: { source: string; words: string; every?: number }): Promise<SavedNotice> {
    const words = typeof on?.words === 'string' && on.words ? on.words : refuseNotice('a notice you create says what it is in your words');
    const named = `the notice "${words}" (${kind}, for ${key})`;
    const source = [...this.options.exts.values()].filter((e) => e.live).map((e) => e.sources.get(on.source)).find((x): x is Polled => x?.variant === 'polled');
    if (!source) refuseNotice(`${named} is on ${String(on.source)}, which no loaded plug-in registers as a polled source`);
    if (on.every !== undefined && (!Number.isSafeInteger(on.every) || on.every < 1000)) refuseNotice(`${named} names a cadence of ${String(on.every)} ms; a cadence is at least 1000 ms`);
    if (!source!.whileShown) return { kind, key, source: on.source, words, sentence: `${words}: checked when ${plugin}'s jobs read ${on.source}`, every: null };
    const job = this.options.scheduler.decls().find((d) => d.plugin === plugin && d.declares.notices.includes(kind) && d.declares.readings.includes(on.source));
    if (!job) refuseNotice(`${named} is refused: ${on.source} runs only while a view is shown, and ${plugin} declares no job that checks ${kind} by reading it`);
    const every = Math.max(on.every ?? 0, source!.whileShown.every);
    const current = job!.cadence;
    const given = Math.min(every, ...Object.values(this.options.files.read<SavedNotice>('notices.json')).filter((n) => n.job === job!.name && n.every !== null).map((n) => n.every!));
    if (!current || !('every' in current) || current.every > given) await this.options.scheduler.edit(job!.name, { every: given });
    const seconds = every % 1000 ? `${every} ms` : `${every / 1000} s`;
    return { kind, key, source: on.source, words, job: job!.name, every, sentence: `${words}: ${job!.name} checks it every ${seconds}, reading ${on.source} each run, since ${on.source} runs only while a view is shown` };
  }

  async listNotices(): Promise<NoticeRow[]> {
    const saved = this.options.files.read<SavedNotice>('notices.json');
    const rows = (await this.options.record.raw("SELECT id, data FROM events WHERE kind = 'notice.subscribed' ORDER BY log_pos")) as { id: string; data: string }[];
    return rows.map((r) => {
      const d = JSON.parse(r.data) as { notice_kind: string; key: string };
      const n = saved[r.id];
      return { id: r.id, kind: d.notice_kind, key: d.key, source: n?.source ?? null, sentence: n?.sentence ?? `${d.notice_kind} for ${d.key}`, every: n?.every ?? null };
    });
  }


  /**
   * Whether a notice may go out (#365), refused naming why: a notice kind its manifest declares (and, in a run, its job
   * declares), for a cause you subscribed to, each reading it cites one the hub recorded that is still fresh, within the
   * plug-in's limit a minute. Its subject keys its cause, so the notice already sent for one is answered again.
   */
  async noticeAllowed(ext: Ext, given: unknown, run: RunCtx | undefined): Promise<{ subject: string; sent?: string }> {
    const id = ext.entry.id;
    const n = (isPlain(given) ? given : {}) as { kind?: unknown; subscription?: unknown; key?: unknown; readings?: unknown };
    const refuse = (why: string): never => { throw Error(`deep.notices.send: ${why}`); };
    const kind = typeof n.kind === 'string' && (ext.manifest.notices ?? []).includes(n.kind) ? n.kind : refuse(`${String(n.kind)} isn't a notice kind ${id}'s manifest declares`);
    if (run && !run.decl.declares.notices.includes(kind)) refuse(`${run.decl.name} doesn't declare ${kind} among the notices it may send`);
    if (typeof n.key !== 'string' || !n.key) refuse('a notice has a key, its one cause');
    const [sub] = (await this.options.record.raw(`SELECT id FROM events WHERE kind = 'notice.subscribed' AND json_extract(data, '$.notice_kind') = ? AND json_extract(data, '$.key') = ?
      ORDER BY log_pos DESC LIMIT 1`, [kind, String(n.subscription)])) as { id: string }[];
    if (!sub) refuse(`nobody subscribed to ${kind} for ${String(n.subscription)}; a notice goes out only because you asked for it`);
    if (!texts(n.readings)) refuse('a notice cites the readings behind it, as a list of their handles');
    const now = this.options.now();
    for (const handle of n.readings as string[]) {
      // A series' batch is a reading too, by its reading.batch's handle (#262).
      let [r] = (await this.options.record.raw('SELECT source, as_of FROM readings WHERE reading = ?', [handle])) as ({ source: string; as_of: number } | undefined)[];
      r ??= await this.options.series?.batch(handle);
      // A runner answer is a reading too (#366): stale once the first reading it cites is.
      const answer = r ? undefined : await this.options.answers.answerOf(handle);
      if (answer?.piece === id) {
        if (answer.stale_at !== null && now >= answer.stale_at) refuse(`${handle} went stale at ${new Date(answer.stale_at).toISOString()}, when the first reading it cites did, so the notice would cite a stale answer`);
        continue;
      }
      const source = r && [...this.options.exts.values()].map((e) => e.sources.get(r.source)).find((x): x is Polled => x?.variant === 'polled');
      if (!r || !source) return refuse(`${handle} is no reading of a loaded source the hub recorded`);
      if (now - r.as_of >= source.freshFor) refuse(`${handle} is past its freshness of ${source.freshFor} ms, so the notice would cite a stale reading`);
    }
    const subject = `notice:${sub!.id}#${sha256Hex(new TextEncoder().encode(n.key as string)).slice(0, 40)}`;
    const [sent] = (await this.options.record.raw("SELECT json_extract(data, '$.notice') AS notice FROM events WHERE kind = 'notice.sent' AND subject = ? LIMIT 1", [subject])) as { notice: string }[];
    if (sent) return { subject, sent: sent.notice };
    const times = (this.noticeTimes.get(id) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= NOTICES_PER_MINUTE) refuse(`${id} sent ${NOTICES_PER_MINUTE} notices in the last minute, its limit`);
    this.noticeTimes.set(id, [...times, now]);
    return { subject };
  }
}

/** What a send is for: the piece, and the run or action call it is made in. */
interface SendFor { piece: string; hosts: string[]; schedule: string | null; run: string | null; call: string | null; until: number; ended: () => boolean }
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

  async setSendRule(connection: Connection, rule: SendRule, entries: Readonly<Record<string, Entry>>): Promise<string> {
    trustedPath(connection, 'a standing rule for sends is set');
    if (!entries[rule?.piece]) throw Error(`${String(rule?.piece)} isn't installed`);
    return this.setRule(rule);
  }
  async dispatch(ext: Ext, given: unknown, scope: string | undefined, run: RunCtx | undefined): Promise<{ key: string; outcome: 'sent' }> {
    const id = ext.entry.id;
    const kind = (given as { kind?: unknown } | undefined)?.kind;
    if (run && !run.decl.declares.sends.includes(kind as string)) throw Error(`deep.send: ${run.decl.name} doesn't declare ${String(kind)} among the sends it makes`);
    const now = this.o.now();
    const sent = await this.send(given, {
      piece: id, hosts: (ext.entry.grant.hosts ?? []).map((h) => h.host), schedule: run?.decl.name ?? null, run: run?.run ?? null,
      call: run || scope === undefined ? null : ext.callOf.get(scope) ?? null,
      until: now + (run ? run.decl.deadline : CALL_MS), ended: () => (run ? run.ended : scope !== undefined && !ext.scopes.has(scope)),
    });
    run?.changes.push(`send:${sent.key}`);
    return sent;
  }

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
