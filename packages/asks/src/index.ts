// @deepbuild/asks: the asks core (#318). An ask is raised only from a place in ask.sources@1, holds to
// ask.created@1, and ends: answered on the trusted path, superseded, moot, or defaulted at its deadline.
//
// Its state is a function of the record: every method first reads what the log gained, then appends what
// that state calls for (a supersede, a moot, a typed answer, a default, the fold's exception), so a core
// opened on a rebuilt record ends the same asks the same way. Only an answer's option sets its decision.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { canonicalize, sha256Hex, validate } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import type { Connection, Event, RecordStore } from '@deepbuild/record';

export type AskKind = 'authority' | 'unblock' | 'taste' | 'exception' | 'choice' | 'definition';
export type Decision = 'allow' | 'deny' | 'none';

/** One row of ask.sources@1: a place that raises asks, the one kind it raises, and its fixture. */
export interface AskSource {
  source: string;
  kind: AskKind;
  fixture: { ask: JsonValue; at_deadline: { decision: Decision } };
}
export interface PlanStep { does: string; changes: string[]; undo: string; public: boolean; cost: number }
/** plan.proposed@1's data, less the ask and the digest the core computes. */
export interface PlanInput { steps: PlanStep[]; diff: string }
/** A step the agent is about to take; whether it leaves the machine comes from the guard engine. */
export interface Step { leaves_machine: boolean }

/** What the core hands the agent's adapter for one ask. */
export interface Delivery {
  ask: string;
  session: string;
  option: string | null;
  decision: Decision;
  words: string | null;
  provisional: boolean;
  undoes: string | null;
}
/** What the question card shows for one ask. */
export interface Card {
  ask: string;
  kind: AskKind;
  options: { id: string; label: string; decision: Decision }[];
  plan: { hash: string; steps: PlanStep[] } | null;
  words: string[];
  changed: { from: string; to: string; files: string[]; diff: string } | null;
  folded: string[];
  undo: boolean;
}

/** Every refusal the core makes, naming what it refuses. */
export class AskRefused extends Error {
  readonly field?: string;
  readonly option?: string;
  readonly source?: string;
  readonly ask?: string;
  readonly outcome?: string;
  readonly closed_at?: number;
  constructor(message: string, named: { field?: string; option?: string; source?: string; ask?: string; outcome?: string; closed_at?: number }) {
    super(message);
    this.name = 'AskRefused';
    Object.assign(this, named);
  }
}

export interface AsksOptions {
  record: RecordStore;
  now: () => number;
  deliver: (delivery: Delivery) => void;
}
export interface Asks {
  raise(connection: Connection, source: string, ask: unknown, plan?: PlanInput): Promise<string>;
  answer(connection: Connection, ask: string, input: unknown): Promise<void>;
  tick(): Promise<void>;
  card(ask: string): Promise<Card>;
  needsYou(): Promise<Card[]>;
  holds(session: string, step: Step): Promise<string[]>;
  authorized(ask: string, planHash: string): Promise<string | null>;
}

let sources: AskSource[] | undefined;
/** The ask.sources@1 table, as data beside the package. */
export const askSources = (): AskSource[] =>
  structuredClone((sources ??= JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8')) as AskSource[]));

/** Once a thread holds this many open asks, its further asks fold into one exception (drafted at setup). */
const FOLD_AT = 5;
const FOLD_SOURCE = 'asks.fold';
/** The trusted path: the question card and `deep inbox answer`. Every other writer is an agent's or the core's. */
const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
const ANSWER_FIELDS = new Set(['option', 'words', 'plan_hash', 'token']);
const PROVISIONAL_KINDS = new Set(['taste', 'choice']);
/** Kinds typed text can answer: questions that need no authority. An unblock closes only on its check. */
const TYPED_KINDS = new Set(['taste', 'choice', 'exception', 'definition']);
const CORE = { writer: 'core' } as const;
/** Writers that speak for an agent: none of them closes an ask. */
const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');
const PAGE = 1000;

type Obj = { [key: string]: JsonValue };
type Option = { id: string; label: string; decision: Decision };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const bare = (handle: string): string => handle.replace(/^ask:/, '');
const git = promisify(execFile);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return time + Array.from(randomBytes(16), (b) => CROCKFORD[b % 32]).join('');
}

interface Ask {
  id: string;
  handle: string;
  data: Obj;
  options: Option[];
  session: string;
  /** Who it was raised for: what the core's own events about it carry. */
  who: { actor: string; scope: string };
  thread: string;
  pos: number;
  fold: boolean;
  folded: boolean;
  plan?: { hash: string; steps: PlanStep[] };
  closed?: { outcome: string; at: number };
  approval?: { hash: string | null; token: string | null; decision: string };
  words: string[];
  /** For a provisional choice: the files its session edited while it went on with the recommended option. */
  decided: Set<string>;
  /** What the log calls for and the core hasn't appended yet. */
  pending: { superseded?: string; moot?: Obj; typed?: string };
}

const CLOSING: Readonly<Record<string, string>> = {
  'ask.answered': 'answered', 'ask.defaulted': 'defaulted', 'ask.escalated': 'escalated', 'ask.cancelled': 'cancelled',
  'ask.superseded': 'superseded', 'ask.moot': 'moot',
};

class AsksCore implements Asks {
  private cursor = 0;
  private readonly sessions = new Map<string, { thread: string; worktree: string }>();
  private readonly asks = new Map<string, Ask>();
  /** Each session's newest attempt at each task, from its claims. */
  private readonly attempts = new Map<string, Map<string, number>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: AsksOptions) {}

  /** One call at a time: each reads the log, then appends from what it read. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  raise(connection: Connection, source: string, input: unknown, plan?: PlanInput): Promise<string> {
    return this.exclusive(async () => {
      await this.sync();
      const row = askSources().find((r) => r.source === source);
      if (!row) throw new AskRefused(`${source} has no row in ask.sources@1, so it can't raise an ask`, { source });
      const now = this.options.now();
      const id = ulid(now);
      const event = { v: 1, id, kind: 'ask.created', writer: connection.writer, actor: connection.actor, scope: connection.scope, ts: now, data: input as JsonValue };
      const checked = validate('ask.created@1', event);
      if (!checked.ok) {
        const [first] = checked.issues;
        throw new AskRefused(`ask.created@1 refuses the ask at ${first!.path}: ${first!.remediation}`, { field: first!.path });
      }
      const data = input as Obj;
      const options = data.options as Option[];
      if (data.kind !== row.kind) throw new AskRefused(`${source} raises ${row.kind} asks, not ${String(data.kind)}`, { field: 'kind' });
      // Only DeepBuild writes an allow option; an agent's options declare deny or none.
      if (isAgent(connection.writer)) {
        const allow = options.find((o) => o.decision === 'allow');
        if (allow) throw new AskRefused(`option ${allow.id} declares allow, which only DeepBuild writes`, { option: allow.id });
      }
      const ids = new Set(options.map((o) => o.id));
      if (data.recommended !== null && !ids.has(data.recommended as string)) throw new AskRefused('the recommendation names no option', { field: 'recommended' });
      if (!ids.has(data.default as string)) throw new AskRefused('the default names no option', { field: 'default' });
      if (data.provisional && (!PROVISIONAL_KINDS.has(row.kind) || data.recommended === null)) {
        throw new AskRefused('only a taste call or a choice with a recommendation goes on provisionally', { field: 'provisional' });
      }
      if (plan !== undefined && row.kind !== 'authority') throw new AskRefused('only an authority ask carries a plan', { field: 'plan' });
      let proposed: Obj | undefined;
      if (plan !== undefined) {
        const steps = plan.steps as unknown as JsonValue;
        proposed = { ask: `ask:${id}`, steps, diff: plan.diff, hash: sha256Hex(canonicalize({ steps, diff: plan.diff })) };
        const planned = validate('plan.proposed@1', { v: 1, id: ulid(now), kind: 'plan.proposed', writer: 'core', actor: connection.actor, scope: connection.scope, ts: now, data: proposed });
        if (!planned.ok) throw new AskRefused(`plan.proposed@1 refuses the plan at ${planned.issues[0]!.path}`, { field: `plan${planned.issues[0]!.path.replace(/^\/data/, '')}` });
      }
      // The same question asked again in its thread, showing the same thing, is one record.
      const thread = this.threadOf(connection.session);
      const same = this.open().find((a) => a.thread === thread && a.data.kind === data.kind && normalize(a.data.question as string) === normalize(data.question as string)
        && sha256Hex(canonicalize(a.data.pinned_to!)) === sha256Hex(canonicalize(data.pinned_to!)) && (a.plan?.hash ?? null) === ((proposed?.hash as string | undefined) ?? null));
      if (same) return same.handle;
      await this.options.record.append(connection, { v: 1, id, kind: 'ask.created', ts: now, data: data });
      if (proposed) await this.options.record.append(this.core(connection), { v: 1, id: ulid(now), kind: 'plan.proposed', ts: now, data: proposed });
      await this.sync();
      const ask = this.asks.get(id)!;
      // A provisional taste call or choice goes on with the recommended option at once.
      if (data.provisional) this.hand(ask, data.recommended as string, null, true, null);
      await this.settle();
      return ask.handle;
    });
  }

  answer(connection: Connection, handle: string, input: unknown): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      const via = TRUSTED[connection.writer];
      if (via === undefined) throw new AskRefused(`an answer counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      if (!isObj(input)) throw new AskRefused('an answer is an object', { field: 'input' });
      // The decision comes from the option you chose, never from the request.
      if ('decision' in input) throw new AskRefused('an answer carries no decision: it comes from the option you chose', { field: 'decision' });
      for (const key of Object.keys(input)) if (!ANSWER_FIELDS.has(key)) throw new AskRefused(`an answer has no field ${key}`, { field: key });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      const { option, words, plan_hash: planHash, token } = input;
      if (option !== undefined && typeof option !== 'string') throw new AskRefused('the option is an ID', { field: 'option' });
      if (words !== undefined && (typeof words !== 'string' || !words)) throw new AskRefused('words are text', { field: 'words' });
      if (option === undefined && words === undefined) throw new AskRefused('an answer chooses an option or says something', { field: 'option' });
      if (token !== undefined && (typeof token !== 'string' || !token)) throw new AskRefused('the click token is text', { field: 'token' });
      const now = this.options.now();
      if (ask.closed) {
        // A later answer to a closed ask is refused, and the refusal is recorded; nothing reaches the agent.
        const { outcome, at } = ask.closed;
        await this.options.record.append(this.core(connection), {
          v: 1, id: ulid(now), kind: 'answer.refused', subject: ask.handle, ts: now,
          data: { outcome, closed_at: at, via, option: option ?? null },
        });
        await this.sync();
        throw new AskRefused(`${ask.handle} closed as ${outcome} at ${new Date(at).toISOString()}`, { ask: ask.handle, outcome, closed_at: at });
      }
      const chosen = option === undefined ? undefined : ask.options.find((o) => o.id === option);
      if (option !== undefined && !chosen) throw new AskRefused(`${ask.handle} has no option ${option}`, { option });
      // Words alone are none.
      const decision: Decision = chosen?.decision ?? 'none';
      if (decision === 'allow') {
        // An approval binds to the digest of the plan you were shown and to your click's token.
        if ((planHash ?? null) !== (ask.plan?.hash ?? null)) throw new AskRefused(`${ask.handle}'s approval names a plan it didn't show`, { field: 'plan_hash' });
        if (token === undefined) throw new AskRefused('an approval binds to its click token', { field: 'token' });
      }
      await this.options.record.append(this.core(connection), {
        v: 2, id: ulid(now), kind: 'ask.answered', subject: ask.handle, ts: now,
        data: {
          answer: option ?? (words as string), plan_hash: decision === 'allow' ? ask.plan?.hash ?? null : null, decision,
          via, verified: true, on: ask.data.pinned_to!, token: token ?? null,
        },
      });
      await this.sync();
      this.hand(ask, chosen?.id ?? null, (words as string | undefined) ?? null, false, decision);
      await this.settle();
    });
  }

  tick(): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      await this.settle();
    });
  }

  card(handle: string): Promise<Card> {
    return this.exclusive(async () => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      return this.cardOf(ask);
    });
  }

  needsYou(): Promise<Card[]> {
    return this.exclusive(async () => {
      await this.sync();
      const shown = this.open().filter((a) => !a.folded);
      return Promise.all(shown.map((a) => this.cardOf(a)));
    });
  }

  holds(session: string, step: Step): Promise<string[]> {
    return this.exclusive(async () => {
      await this.sync();
      // Under a provisional ask, work goes on; only a step that leaves the machine waits for the answer.
      if (!step.leaves_machine) return [];
      const thread = this.threadOf(session);
      return this.open().filter((a) => a.thread === thread && a.data.provisional === true).map((a) => a.handle);
    });
  }

  authorized(handle: string, planHash: string): Promise<string | null> {
    return this.exclusive(async () => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      const approval = ask?.closed?.outcome === 'answered' ? ask.approval : undefined;
      return approval?.decision === 'allow' && approval.hash === planHash ? approval.token : null;
    });
  }

  private core(connection: Connection): Connection {
    return { ...CORE, actor: connection.actor, scope: connection.scope, ...(connection.session ? { session: connection.session } : {}) };
  }

  private threadOf(session: string | undefined): string {
    return session === undefined ? '' : this.sessions.get(session)?.thread ?? session;
  }

  private open(): Ask[] {
    return [...this.asks.values()].filter((a) => !a.closed).sort((a, b) => a.pos - b.pos);
  }

  private hand(ask: Ask, option: string | null, words: string | null, provisional: boolean, decision: Decision | null): void {
    const chosen = ask.options.find((o) => o.id === option);
    const recommended = ask.data.recommended as string | null;
    // A different answer undoes the option a provisional ask went on with.
    const undoes = !provisional && ask.data.provisional === true && option !== null && option !== recommended ? recommended : null;
    this.options.deliver({ ask: ask.handle, session: ask.session, option, decision: decision ?? chosen?.decision ?? 'none', words, provisional, undoes });
  }

  private async cardOf(ask: Ask): Promise<Card> {
    return {
      ask: ask.handle,
      kind: ask.data.kind as AskKind,
      options: ask.options.map((o) => ({ id: o.id, label: o.label, decision: o.decision })),
      plan: ask.plan ? structuredClone(ask.plan) : null,
      words: [...ask.words],
      changed: await this.changed(ask),
      folded: ask.fold ? this.open().filter((a) => a.folded && a.thread === ask.thread).map((a) => a.handle) : [],
      undo: ask.closed?.outcome === 'defaulted',
    };
  }

  /** What changed since the commit an ask showed, when its session's worktree has moved on from it. */
  private async changed(ask: Ask): Promise<Card['changed']> {
    const pin = ask.data.pinned_to as Obj;
    const worktree = this.sessions.get(ask.session)?.worktree;
    if (pin.kind !== 'commit' || worktree === undefined) return null;
    const from = pin.ref as string;
    try {
      const run = async (...args: string[]) => (await git('git', ['-C', worktree, ...args], { maxBuffer: 1 << 24 })).stdout;
      const to = (await run('rev-parse', 'HEAD')).trim();
      if (to === from) return null;
      const files = (await run('diff', '--name-only', from, to)).split('\n').filter(Boolean);
      return { from, to, files, diff: await run('diff', from, to) };
    } catch {
      return null;
    }
  }

  /** Reads what the log gained since the last read. */
  private async sync(): Promise<void> {
    for (;;) {
      const page = await this.options.record.read({ after: this.cursor, limit: PAGE });
      for (const event of page) this.apply(event);
      if (page.length) this.cursor = page[page.length - 1]!.log_pos;
      if (page.length < PAGE) return;
    }
  }

  private apply(e: Event): void {
    const d: Obj = isObj(e.data) ? e.data : {};
    const target = e.subject?.startsWith('ask:') ? this.asks.get(bare(e.subject)) : undefined;
    switch (e.kind) {
      case 'session.start':
        if (e.session) this.sessions.set(e.session, { thread: String(d.thread), worktree: String(d.worktree) });
        return;
      case 'ask.created': {
        const thread = this.threadOf(e.session);
        const fold = e.writer === 'core' && d.key === foldKey(thread);
        const open = this.open().filter((a) => a.thread === thread && !a.fold);
        const ask: Ask = {
          id: e.id, handle: `ask:${e.id}`, data: d, options: d.options as Option[], session: e.session ?? '', who: { actor: e.actor, scope: e.scope }, thread, pos: e.log_pos,
          fold, folded: !fold && open.length >= FOLD_AT, words: [], decided: new Set(), pending: {},
        };
        // A newer ask on the same subject in the same thread supersedes the older one, and keeps what it decided.
        for (const older of open) {
          if (older.data.key !== d.key) continue;
          older.pending.superseded = ask.handle;
          for (const path of older.decided) ask.decided.add(path);
        }
        this.asks.set(e.id, ask);
        return;
      }
      case 'plan.proposed': {
        // The plan an ask shows is the first one proposed for it; your yes binds that one.
        const ask = this.asks.get(bare(String(d.ask)));
        if (ask && !ask.plan && e.writer === 'core') ask.plan = { hash: String(d.hash), steps: d.steps as unknown as PlanStep[] };
        return;
      }
      case 'decision.applied':
      case 'ask.answered':
      case 'ask.defaulted':
      case 'ask.escalated':
      case 'ask.cancelled':
      case 'ask.superseded':
      case 'ask.moot': {
        const ask = e.kind === 'decision.applied' ? this.asks.get(bare(String(d.ask))) : target;
        // The first close to append decides, and no agent closes an ask.
        if (!ask || ask.closed || isAgent(e.writer)) return;
        ask.closed = { outcome: CLOSING[e.kind] ?? 'decided_for_you', at: e.ts };
        if (e.kind === 'ask.answered') ask.approval = { hash: (d.plan_hash as string | null) ?? null, token: (d.token as string | null | undefined) ?? null, decision: String(d.decision) };
        return;
      }
      case 'user.ask': {
        if (d.from !== 'person' || typeof d.text !== 'string') return;
        const thread = this.threadOf(e.session);
        const open = this.open().filter((a) => a.thread === thread);
        // Typed text never answers an authority ask: it shows beside it, for one tap on the card.
        for (const a of open) if (a.data.kind === 'authority') a.words.push(d.text);
        const question = open.filter((a) => TYPED_KINDS.has(a.data.kind as string) && !a.fold).at(-1);
        if (question && d.text && question.pending.typed === undefined) question.pending.typed = d.text;
        return;
      }
      case 'verdict.made': {
        if (d.outcome !== 'PASS' || !Array.isArray(d.requirements)) return;
        const passed = new Set(d.requirements.filter((r) => isObj(r) && r.outcome === 'PASS').map((r) => (r as Obj).check));
        for (const a of this.open()) if (a.data.kind === 'unblock' && passed.has(a.data.proves!)) a.pending.moot ??= { because: 'check_passed', verdict: String(d.verdict) };
        return;
      }
      case 'claim.made': {
        // A newer attempt at a task from another thread replaces each older one: their asks are moot.
        if (!e.session || typeof d.task_ref !== 'string' || typeof d.attempt !== 'number') return;
        const thread = this.threadOf(e.session);
        for (const [session, tasks] of this.attempts) {
          const older = tasks.get(d.task_ref);
          if (older === undefined || older >= d.attempt || this.threadOf(session) === thread) continue;
          const by = { because: 'attempt_replaced', session: `session:${e.session}` };
          for (const a of this.open()) if (a.thread === this.threadOf(session)) a.pending.moot ??= by;
        }
        const tasks = this.attempts.get(e.session) ?? this.attempts.set(e.session, new Map()).get(e.session)!;
        tasks.set(d.task_ref, Math.max(tasks.get(d.task_ref) ?? 0, d.attempt));
        return;
      }
      case 'tool.after': {
        // What a session edits while a provisional choice goes on is what that choice decided.
        if ((d.kind !== 'edit' && d.kind !== 'write') || !Array.isArray(d.paths)) return;
        const worktree = e.session ? this.sessions.get(e.session)?.worktree : undefined;
        const thread = this.threadOf(e.session ?? undefined);
        const paths = d.paths.filter((p): p is string => typeof p === 'string').map((p) => (worktree && p.startsWith(`${worktree}/`) ? p.slice(worktree.length + 1) : p));
        for (const a of this.open()) if (a.thread === thread && a.data.kind === 'choice' && a.data.provisional === true) for (const p of paths) a.decided.add(p);
        return;
      }
    }
  }

  /** Appends what the state calls for until it calls for nothing more. */
  private async settle(): Promise<void> {
    for (let acted = true; acted;) {
      acted = false;
      const now = this.options.now();
      for (const ask of this.open()) {
        const as = { ...CORE, ...ask.who, ...(ask.session ? { session: ask.session } : {}) };
        const base = { v: 1, id: ulid(now), subject: ask.handle, ts: now };
        if (ask.pending.superseded) {
          await this.options.record.append(as, { ...base, kind: 'ask.superseded', data: { by: ask.pending.superseded } });
        } else if (ask.pending.moot) {
          await this.options.record.append(as, { ...base, kind: 'ask.moot', data: ask.pending.moot });
        } else if (ask.pending.typed !== undefined) {
          // Typed in the session: the answer to that question only, unverified, never a decision.
          await this.options.record.append(as, {
            ...base, v: 2, kind: 'ask.answered',
            data: { answer: ask.pending.typed, plan_hash: null, decision: 'none', via: 'session', verified: false, on: ask.data.pinned_to!, token: null },
          });
        } else if (await this.reoffer(ask, as, now)) {
          // Offered again on the new commit: the new ask supersedes this one.
        } else if (now >= (ask.data.deadline as number)) {
          // Past its deadline the default applies; nothing defaults to allow, and an authority ask defaults to no.
          const option = ask.options.find((o) => o.id === ask.data.default);
          const deny = ask.data.kind === 'authority' || option?.decision === 'allow';
          const answer = deny ? ask.options.find((o) => o.decision === 'deny') ?? option : option;
          const decision: Decision = deny ? 'deny' : option?.decision ?? 'none';
          await this.options.record.append(as, { ...base, kind: 'ask.defaulted', data: { answer: answer?.id ?? 'no', plan_hash: null, decision } });
          await this.sync();
          this.hand(ask, answer?.id ?? null, null, false, decision);
        } else continue;
        acted = true;
      }
      await this.sync();
      if (await this.fold()) acted = true;
    }
  }

  /** A provisional choice is offered again, pinned to the new commit, once a change touches what it decided. */
  private async reoffer(ask: Ask, as: Connection, now: number): Promise<boolean> {
    if (ask.data.kind !== 'choice' || ask.data.provisional !== true || !ask.decided.size) return false;
    const changed = await this.changed(ask);
    if (!changed?.files.some((file) => ask.decided.has(file))) return false;
    const data: Obj = { ...ask.data, pinned_to: { kind: 'commit', ref: changed.to } };
    await this.options.record.append(as, { v: 1, id: ulid(now), kind: 'ask.created', ts: now, data });
    return true;
  }

  /** A thread past five open asks gets one exception that holds the rest, while any of them stays open. */
  private async fold(): Promise<boolean> {
    let raised = false;
    const open = this.open();
    for (const thread of new Set(open.filter((a) => a.folded).map((a) => a.thread))) {
      if (open.some((a) => a.fold && a.thread === thread)) continue;
      const folded = open.filter((a) => a.folded && a.thread === thread);
      const template = askSources().find((r) => r.source === FOLD_SOURCE)!.fixture.ask as Obj;
      const now = this.options.now();
      const { session, who } = folded.at(-1)!;
      const data: Obj = {
        ...template,
        deadline: Math.max(...folded.map((a) => a.data.deadline as number)),
        key: foldKey(thread),
        pinned_to: { kind: 'evidence', ref: sha256Hex(canonicalize(folded.map((a) => a.handle))) },
      };
      await this.options.record.append({ ...CORE, ...who, ...(session ? { session } : {}) }, { v: 1, id: ulid(now), kind: 'ask.created', ts: now, data });
      raised = true;
    }
    if (raised) await this.sync();
    return raised;
  }
}

/** A question's text as it compares: NFC, case folded, white space collapsed, trailing punctuation dropped. */
const normalize = (text: string): string => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?]+$/u, '');

/** The fold's exception is keyed on its thread, never on a session ID that /clear or /compact rotates. */
const foldKey = (thread: string): string => sha256Hex(new TextEncoder().encode(`${FOLD_SOURCE}:${thread}`));

export async function openAsks(options: AsksOptions): Promise<Asks> {
  const core = new AsksCore(options);
  await core.tick();
  // Plain functions, so a caller can wrap one method and keep the rest.
  return {
    raise: core.raise.bind(core), answer: core.answer.bind(core), tick: core.tick.bind(core), card: core.card.bind(core),
    needsYou: core.needsYou.bind(core), holds: core.holds.bind(core), authorized: core.authorized.bind(core),
  };
}
