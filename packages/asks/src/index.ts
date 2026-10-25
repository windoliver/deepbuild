// @deepbuild/asks: the asks core (#318). An ask is raised only from a place in ask.sources@1, holds to
// ask.created@1 (@2 for a taste call that names the near copies it dropped, #394), and ends: answered on
// the trusted path, superseded, moot, or defaulted at its deadline.
//
// Its state is a function of the record: every method first reads what the log gained, then appends what
// that state calls for (a supersede, a moot, a typed answer, a default, the fold's exception), so a core
// opened on a rebuilt record ends the same asks the same way. Only an answer's option sets its decision.
//
// When an ask shows (#319): in your batches, up to the day's cap, or at once when its deadline would pass
// before the next batch or its session is held on it; each showing is an ask.batched the core appends. The
// values the rules leave open come from your config.json, overridden key by key by a repo's done.yaml.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalize, sha256Hex, validate } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { ulid } from '@deepbuild/record';
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
  /** Your ~/.deepbuild folder: its config.json holds your own settings. Left out, nothing is declared. */
  home?: string;
}
/** An ask's place in its life (ask.machine@1's states), as the inbox shows it. */
export type InboxStatus = 'queued' | 'shown' | 'later' | 'folded' | 'held' | 'closed';
/** One row of the inbox projection that `deep inbox` and the app read. */
export interface InboxRow {
  ask: string;
  kind: AskKind;
  session: string;
  status: InboxStatus;
  /** 'unanswered' while open; otherwise how it closed. */
  outcome: string;
  owner: string;
  /** How long since it was raised, in ms. */
  age: number;
}
export interface Asks {
  raise(connection: Connection, source: string, ask: unknown, plan?: PlanInput): Promise<string>;
  answer(connection: Connection, ask: string, input: unknown): Promise<void>;
  tick(): Promise<void>;
  card(ask: string): Promise<Card>;
  needsYou(): Promise<Card[]>;
  holds(session: string, step: Step): Promise<string[]>;
  authorized(ask: string, planHash: string): Promise<string | null>;
  /** Later, on the trusted path: hides the ask until `until`, never past its deadline. */
  later(connection: Connection, ask: string, until: number): Promise<void>;
  /** Every ask in the record, open or closed, with its status, owner and age. */
  inbox(): Promise<InboxRow[]>;
}

/** What setup drafts into your config.json (design: the done.yaml asks block). */
const DRAFTED = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
  // A few visits a day, at 00:00, 08:00 and 16:00 UTC, showing at most 20 asks a day.
  batch: { every: '8h', cap: 20 },
};

/** Setup: drafts your own ask settings into <home>/config.json, keeping every value you already set. */
export async function draftAskSettings(home: string): Promise<void> {
  const file = join(home, 'config.json');
  let config: JsonValue = {};
  if (existsSync(file)) {
    // A file that doesn't parse is left as it is: setup never writes over what it can't read.
    try {
      config = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
    } catch (error) {
      throw new Error(`${file} isn't valid JSON, so setup leaves it as it is: ${(error as Error).message}`);
    }
    if (!isObj(config)) throw new Error(`${file} doesn't hold an object, so setup leaves it as it is`);
  }
  config.asks = over(DRAFTED, isObj(config.asks) ? config.asks : {});
  mkdirSync(home, { recursive: true });
  // Written whole or not at all.
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(next, file);
}

/** b over a, key by key, one level into each map: how a repo's done.yaml overrides your settings. */
function over(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = isObj(a[key]) && isObj(value) ? { ...a[key], ...value } : value;
  return out;
}

function readJson(file: string): Obj {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  // A file that doesn't parse declares nothing: what depends on its values is BLOCKED, naming the value.
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    return {};
  }
  return isObj(parsed) ? parsed : {};
}

/**
 * The `asks:` block of a repo's .deepbuild/done.yaml: maps and lists of scalars, in block or flow style. A line in
 * it this reader can't follow leaves the repo's asks BLOCKED, naming the line, rather than your settings in its place.
 */
function doneYamlAsks(worktree: string): Obj {
  let text: string;
  try {
    text = readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8');
  } catch {
    return {};
  }
  const block: Obj = {};
  let inside = false;
  let indent = -1;
  /** The key whose value is on the lines below it: a map, or a list of `- item` lines. */
  let below: string | undefined;
  for (const [at, raw] of text.split('\n').entries()) {
    const unread = () => new AskRefused(`BLOCKED: the repo's asks settings can't be read at .deepbuild/done.yaml line ${at + 1}: ${raw.trim()}`, { field: 'asks' });
    const line = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      inside = /^asks\s*:/.test(line);
      if (inside && line !== 'asks:') throw unread();
      below = undefined;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item) {
      const under = below === undefined ? undefined : block[below];
      // Items go under a key with nothing else below it.
      if (below === undefined || (isObj(under) && Object.keys(under).length > 0)) throw unread();
      const list: JsonValue[] = Array.isArray(under) ? under : [];
      list.push(yamlScalar(item[1]!, unread));
      block[below] = list;
      continue;
    }
    const m = /^(\s+)([\w-]+):\s*(.*)$/.exec(line);
    if (!m) throw unread();
    const [, lead, key, value] = m as unknown as [string, string, string, string];
    if (indent < 0) indent = lead.length;
    const map = below === undefined ? undefined : block[below];
    if (lead.length > indent) {
      // Two levels deep at most: a kind under deadline or default, and its value on the same line.
      if (!isObj(map) || !value) throw unread();
      map[key] = yamlScalar(value, unread);
    } else if (lead.length < indent) throw unread();
    else if (value) [block[key], below] = [yamlScalar(value, unread), undefined];
    else [block[key], below] = [{}, key];
  }
  return block;
}

/** A value on one line: a scalar, or one flow map or list of scalars. */
function yamlScalar(text: string, unread: () => Error, nested = false): JsonValue {
  const items = (inner: string) => inner.split(',').map((s) => s.trim()).filter(Boolean);
  const flow = /^\{(.*)\}$/.exec(text);
  const list = /^\[(.*)\]$/.exec(text);
  if ((flow || list) && nested) throw unread();
  if (flow) {
    return Object.fromEntries(items(flow[1]!).map((pair) => {
      const at = pair.indexOf(':');
      if (at <= 0) throw unread();
      return [pair.slice(0, at).trim(), yamlScalar(pair.slice(at + 1).trim(), unread, true)];
    }));
  }
  if (list) return items(list[1]!).map((item) => yamlScalar(item, unread, true));
  if (/[{}[\]]/.test(text)) throw unread();
  if (/^-?\d+$/.test(text)) return Number(text);
  return text.replace(/^(["'])(.*)\1$/, '$2');
}

const UNITS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** A duration as the settings write it: a whole number and m, h or d. */
const duration = (value: JsonValue | undefined): number | undefined => {
  const m = typeof value === 'string' ? /^(\d+)([mhd])$/.exec(value) : null;
  return m ? Number(m[1]) * UNITS[m[2]!]! : undefined;
};
const DAY = UNITS.d!;

let sources: AskSource[] | undefined;
/** The ask.sources@1 table, as data beside the package. */
export const askSources = (): AskSource[] =>
  structuredClone((sources ??= JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8')) as AskSource[]));

/** Once a thread holds this many open asks, its further asks fold into one exception, unless settings say otherwise. */
const FOLD_AT = 5;
/** The fold's option that answers each of the session's open asks with its recommended option. */
const TOGETHER = 'together';
/** The fold's option that leaves the asks it holds to their defaults. */
const FOLD_DEFAULTS = 'defaults';
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
  /** The exception that holds it: the one open in its thread when it was raised. */
  folded?: string;
  plan?: { hash: string; steps: PlanStep[] };
  closed?: { outcome: string; at: number; answer?: string };
  approval?: { hash: string | null; token: string | null; decision: string };
  words: string[];
  /** For a provisional choice: the files its session edited while it went on with the recommended option. */
  decided: Set<string>;
  /** What the log calls for and the core hasn't appended yet. */
  pending: { superseded?: string; moot?: Obj; typed?: string };
  created: number;
  /** Shown in Needs you, by a batch or at once. */
  shown: boolean;
  /** Hidden by Later until then. */
  later?: number;
  /** Raised by a turn that hadn't read a message you typed: it waits until the agent has it, unless due first. */
  unread: boolean;
  /** Since when it waits for a batch: raised, or read by the agent when raised held for your message. */
  since: number;
}

/** Batches every `every` ms since the epoch, showing at most `cap` asks a UTC day. */
interface Batches { every: number; cap: number }

const CLOSING: Readonly<Record<string, string>> = {
  'ask.answered': 'answered', 'ask.defaulted': 'defaulted', 'ask.escalated': 'escalated', 'ask.cancelled': 'cancelled',
  'ask.superseded': 'superseded', 'ask.moot': 'moot',
};

class AsksCore implements Asks {
  private cursor = 0;
  private readonly sessions = new Map<string, { thread: string; worktree: string }>();
  private readonly asks = new Map<string, Ask>();
  /** Each thread's asks, open or closed, in log order. */
  private readonly threads = new Map<string, Ask[]>();
  /** Each session's newest attempt at each task, from its claims. */
  private readonly attempts = new Map<string, Map<string, number>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Sessions with a message you typed that the agent hasn't read yet. */
  private readonly unread = new Set<string>();
  /** How many asks batches showed each UTC day, by day number. */
  private readonly batched = new Map<number, number>();
  /** Settings read in this call, by worktree: each call reads the files once. */
  private readonly read = new Map<string, Obj>();

  constructor(private readonly options: AsksOptions) {}

  /** One call at a time: each reads the log, then appends from what it read. */
  private exclusive<T>(body: () => Promise<T>): Promise<T> {
    const run = () => {
      this.read.clear();
      return body();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  raise(connection: Connection, source: string, raised: unknown, plan?: PlanInput): Promise<string> {
    return this.exclusive(async () => {
      await this.sync();
      const row = askSources().find((r) => r.source === source);
      if (!row) throw new AskRefused(`${source} has no row in ask.sources@1, so it can't raise an ask`, { source });
      const now = this.options.now();
      const input = this.fill(connection.session, raised, now);
      const id = ulid(now);
      const v = isObj(input) && 'dropped' in input ? 2 : 1;
      const event = { v, id, kind: 'ask.created', writer: connection.writer, actor: connection.actor, scope: connection.scope, ts: now, data: input as JsonValue };
      const checked = validate(`ask.created@${v}`, event);
      if (!checked.ok) {
        const [first] = checked.issues;
        throw new AskRefused(`ask.created@${v} refuses the ask at ${first!.path}: ${first!.remediation}`, { field: first!.path });
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
      // Nothing defaults to allow: an ask whose default approves needs an option that says no to take instead.
      const fallsTo = options.find((o) => o.id === data.default)!;
      if (fallsTo.decision === 'allow' && !options.some((o) => o.decision === 'deny')) {
        throw new AskRefused(`the default ${fallsTo.id} approves, and the ask has no option that says no to take at its deadline`, { field: 'default' });
      }
      // An authority ask takes no at its deadline, and the no it takes is one of its options.
      if (data.kind === 'authority' && !options.some((o) => o.decision === 'deny')) {
        throw new AskRefused('an authority ask takes no at its deadline, and this one has no option that says no', { field: 'options' });
      }
      // A taste call names the candidates it dropped as near copies of ones it still offers (#394).
      for (const copy of (data.dropped ?? []) as { option: string; same_as: string }[]) {
        if (ids.has(copy.option) || !ids.has(copy.same_as)) throw new AskRefused(`dropped candidate ${copy.option} must be gone from the options and count as one with an option offered`, { option: copy.option });
      }
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
      const same = this.openIn(thread).find((a) => a.data.kind === data.kind && normalize(a.data.question as string) === normalize(data.question as string)
        && sha256Hex(canonicalize(a.data.pinned_to!)) === sha256Hex(canonicalize(data.pinned_to!)) && (a.plan?.hash ?? null) === ((proposed?.hash as string | undefined) ?? null));
      if (same) return same.handle;
      // Past the threshold drafted at setup, the thread's further asks fold into one exception. It's raised first,
      // so the log alone says which asks it holds: each one created while it's open.
      const foldAt = this.settingsFor(connection.session).fold;
      // A fold is one person's: the thread's asks raised under this actor and scope.
      const open = this.openIn(thread).filter((a) => a.who.actor === connection.actor && a.who.scope === connection.scope);
      if (!open.some((a) => a.fold) && open.length >= (typeof foldAt === 'number' ? foldAt : FOLD_AT)) {
        await this.raiseFold(thread, connection.session, { actor: connection.actor, scope: connection.scope }, [`ask:${id}`], data.deadline as number);
      }
      await this.options.record.append(connection, { v, id, kind: 'ask.created', ts: now, data: data });
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
      // The fold's "answer them together" answers, with its recommended option, each open ask of its thread that
      // you've seen: the ones it holds and the ones already on their own cards. An ask still queued for a batch
      // isn't answered unseen, and one whose recommended option approves, or an unblock, waits for its own card.
      // Answering for several asks at once is for the person they were raised for alone.
      if (ask.fold && chosen?.id === TOGETHER && (ask.who.actor !== connection.actor || ask.who.scope !== connection.scope)) {
        throw new AskRefused(`${ask.handle} was raised for ${ask.who.actor} in ${ask.who.scope}`, { field: 'ask', ask: ask.handle });
      }
      const together = ask.fold && chosen?.id === TOGETHER
        ? this.openIn(ask.thread).flatMap((a) => {
          const recommended = a.options.find((o) => o.id === a.data.recommended);
          // Only asks you've seen, in this exception or on their own card and not put off with Later; an unblock closes only on its check.
          const seen = (a.folded === ask.handle || !this.inFold(a)) && a.shown && a.later === undefined;
          return a !== ask && a.who.actor === ask.who.actor && a.who.scope === ask.who.scope && seen && a.data.kind !== 'unblock' && recommended && recommended.decision !== 'allow' ? [{ a, option: recommended }] : [];
        })
        : [];
      // Each one is delivered as soon as it's recorded, so a write that fails partway leaves the rest open, not closed unheard.
      for (const { a, option: o } of together) {
        await this.options.record.append(this.core(connection), {
          v: 2, id: ulid(now), kind: 'ask.answered', subject: a.handle, ts: now,
          data: { answer: o.id, plan_hash: null, decision: o.decision, via, verified: true, on: a.data.pinned_to!, token: null },
        });
        await this.sync();
        this.hand(a, o.id, null, false, o.decision);
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
      const shown = this.open().filter((a) => this.status(a) === 'shown');
      return Promise.all(shown.map((a) => this.cardOf(a)));
    });
  }

  holds(session: string, step: Step): Promise<string[]> {
    return this.exclusive(async () => {
      await this.sync();
      // Under a provisional ask, work goes on; only a step that leaves the machine waits for the answer.
      if (!step.leaves_machine) return [];
      const thread = this.threadOf(session);
      const held = this.openIn(thread).filter((a) => a.data.provisional === true);
      // A session held on an ask: it shows at once, cap or not.
      // A folded ask shows through its thread's exception, itself included there.
      const cards = new Set(held.flatMap((a) => (this.inFold(a) ? [...this.openIn(a.thread).filter((f) => f.handle === a.folded), a] : [a])));
      await this.showNow([...cards].filter((a) => !a.shown || a.later !== undefined).sort((a, b) => a.pos - b.pos));
      return held.map((a) => a.handle);
    });
  }

  later(connection: Connection, handle: string, until: number): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`Later counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      if (ask.closed) throw new AskRefused(`${ask.handle} closed as ${ask.closed.outcome}`, { ask: ask.handle, outcome: ask.closed.outcome, closed_at: ask.closed.at });
      // Later hides an ask from the person it was raised for, so only they put it off.
      if (ask.who.actor !== connection.actor || ask.who.scope !== connection.scope) throw new AskRefused(`${ask.handle} was raised for ${ask.who.actor} in ${ask.who.scope}`, { field: 'ask', ask: ask.handle });
      // An ask the fold holds shows only through its exception, so Later goes there.
      if (this.inFold(ask)) throw new AskRefused(`${ask.handle} shows in ${ask.folded}; put that off instead`, { field: 'ask', ask: ask.handle });
      // For the exception, the earliest deadline among the asks it holds: none of them may pass hidden.
      const deadline = this.dueBy(ask);
      if (!Number.isSafeInteger(until) || until < 0) throw new AskRefused('Later takes a time in ms since the epoch', { field: 'until' });
      if (until >= deadline) throw new AskRefused(`Later can't pass ${ask.handle}'s deadline, ${new Date(deadline).toISOString()}`, { field: 'until', ask: ask.handle });
      const now = this.options.now();
      await this.options.record.append(this.core(connection), { v: 1, id: ulid(now), kind: 'ask.later', subject: ask.handle, ts: now, data: { until } });
      await this.sync();
      await this.settle();
    });
  }

  inbox(): Promise<InboxRow[]> {
    return this.exclusive(async () => {
      await this.sync();
      const now = this.options.now();
      return [...this.asks.values()].map((a) => ({
        ask: a.handle, kind: a.data.kind as AskKind, session: a.session, status: this.status(a),
        outcome: a.closed?.outcome ?? 'unanswered', owner: String(a.data.owner), age: now - a.created,
      }));
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

  /** Your config.json's asks block, with the done.yaml of the session's repo over it key by key. */
  private settingsFor(session: string | undefined): Obj {
    const worktree = session === undefined ? undefined : this.sessions.get(session)?.worktree;
    const key = worktree ?? '';
    let settings = this.read.get(key);
    if (!settings) {
      const home = this.options.home;
      const yours = home === undefined ? {} : readJson(join(home, 'config.json')).asks;
      settings = over(isObj(yours) ? yours : {}, worktree === undefined ? {} : doneYamlAsks(worktree));
      this.read.set(key, settings);
    }
    return settings;
  }

  /**
   * Your batch schedule; none declared, every ask shows when it's raised, a held one included, since with no batch
   * to wait for the only other time to show it is its deadline. Batches are your visits, one schedule across every
   * repo, so a repo's done.yaml doesn't change them.
   */
  private batches(): Batches | undefined {
    const batch = this.settingsFor(undefined).batch;
    const every = isObj(batch) ? duration(batch.every) : undefined;
    return every && isObj(batch) && typeof batch.cap === 'number' ? { every, cap: batch.cap } : undefined;
  }

  /** An ask's deadline and default, from the settings for its kind, where the place that raised it left them out. */
  private fill(session: string | undefined, raised: unknown, now: number): unknown {
    if (!isObj(raised) || (raised.deadline !== undefined && raised.default !== undefined)) return raised;
    const kind = String(raised.kind);
    const settings = this.settingsFor(session);
    const data: Obj = { ...raised };
    if (data.deadline === undefined) {
      const wait = duration(isObj(settings.deadline) ? settings.deadline[kind] : undefined);
      // A value nobody declared leaves what depends on it BLOCKED, naming the value.
      if (wait === undefined) throw new AskRefused(`BLOCKED: no deadline for ${kind} asks is declared in your settings or the repo's done.yaml (asks.deadline.${kind})`, { field: 'deadline' });
      data.deadline = now + wait;
    }
    if (data.default === undefined) {
      const policy = isObj(settings.default) ? settings.default[kind] : undefined;
      if (policy === undefined) throw new AskRefused(`BLOCKED: no default for ${kind} asks is declared in your settings or the repo's done.yaml (asks.default.${kind})`, { field: 'default' });
      const options = Array.isArray(data.options) ? data.options.filter(isObj) : [];
      // Only these two name an option by themselves; for the others the raiser names the option that keeps things as they are.
      const id = policy === 'recommended' ? data.recommended : policy === 'no' ? options.find((o) => o.decision === 'deny')?.id : undefined;
      if (typeof id !== 'string') throw new AskRefused(`the ${kind} ask names no option for its default, ${String(policy)}`, { field: 'default' });
      data.default = id;
    }
    return data;
  }

  private status(ask: Ask): InboxStatus {
    if (ask.closed) return 'closed';
    if (this.inFold(ask)) return 'folded';
    if (ask.later !== undefined) return 'later';
    if (ask.shown) return 'shown';
    return ask.unread ? 'held' : 'queued';
  }

  /**
   * Whether an ask shows only inside the exception that holds it: while that's open, or once you left its asks to
   * their defaults. Otherwise, as when "answer them together" left an approval or an unblock, it gets its own card.
   */
  private inFold(ask: Ask): boolean {
    const holder = ask.folded === undefined ? undefined : this.asks.get(bare(ask.folded));
    return holder !== undefined && (!holder.closed || holder.closed.answer === FOLD_DEFAULTS);
  }

  /** Whether an ask is in sight now: shown, and not put off with Later. */
  private visible(ask: Ask): boolean {
    return ask.shown && ask.later === undefined;
  }

  /** In sight on its own card, or inside an exception that is: what typed text can answer, and what can take its default. */
  private inSight(ask: Ask): boolean {
    return this.visible(ask) && (!this.inFold(ask) || this.visible(this.asks.get(bare(ask.folded!))!));
  }

  /** Shows these asks now, outside any batch. */
  private async showNow(asks: Ask[]): Promise<boolean> {
    if (!asks.length) return false;
    const now = this.options.now();
    await this.appendBatch(`now:${new Date(now).toISOString()}`, asks, now);
    return true;
  }

  /** One ask.batched for each actor and scope among the asks, under that identity. */
  private async appendBatch(batch: string, asks: Ask[], now: number): Promise<void> {
    const groups = new Map<string, Ask[]>();
    for (const a of asks) {
      const key = JSON.stringify([a.who.actor, a.who.scope]);
      groups.set(key, [...(groups.get(key) ?? []), a]);
    }
    for (const group of groups.values()) {
      await this.options.record.append({ ...CORE, ...group[0]!.who }, {
        v: 1, id: ulid(now), kind: 'ask.batched', ts: now,
        data: { batch, asks: group.map((a) => ({ ask: a.handle, plan_hash: a.plan?.hash ?? null })) },
      });
    }
    await this.sync();
  }

  /**
   * The latest batch, up to the day's cap, oldest first; then, cap or not, each ask whose deadline (for the
   * exception, the earliest among the asks it holds) would pass before the next batch, so none reaches its
   * deadline unseen. Run when an ask is filed, on every tick, and when the core starts.
   */
  private async show(): Promise<boolean> {
    // An ask you put off with Later waits for its Later, not for a batch.
    const waiting = () => this.open().filter((a) => !a.shown && !this.inFold(a) && a.later === undefined);
    // A Later that ends shows its ask again, recorded like any showing; so does one that an ask joining the
    // exception since would outlast.
    const now = this.options.now();
    let acted = await this.showNow(this.open().filter((a) => a.later !== undefined && (a.later <= now || this.dueBy(a) <= a.later)));
    const batches = this.batches();
    // With no batches declared, nothing waits for one.
    const last = batches ? Math.floor(now / batches.every) * batches.every : now;
    const next = batches ? last + batches.every : Infinity;
    // An ask held by an exception that has shown shows there, recorded like any other showing; one from a turn that
    // hasn't read your message waits, as on its own card, for the agent's next step or a deadline before the next batch.
    const joined = this.open().filter((a) => !a.shown && this.inFold(a) && this.visible(this.asks.get(bare(a.folded!))!));
    if (await this.showNow(joined.filter((a) => !a.unread || this.dueBy(a) <= next))) acted = true;
    if (!batches) return (await this.showNow(waiting())) || acted;
    // The latest batch shows every ask waiting for it since before its time, as the log stands: one held for your
    // message and read after it waits for the next, and a showing that failed to append is appended on the next
    // call, without showing again what the log already shows.
    const room = batches.cap - (this.batched.get(Math.floor(last / DAY)) ?? 0);
    const due = waiting().filter((a) => a.since < last && !a.unread).slice(0, Math.max(0, room));
    if (due.length) {
      await this.appendBatch(`batch:${new Date(last).toISOString()}`, due, now);
      acted = true;
    }
    // A deadline at the next batch's own time counts as passing first: an ask first shown at its deadline would
    // default only on a later call, after its deadline, so it shows now instead.
    if (await this.showNow(waiting().filter((a) => this.dueBy(a) <= next))) acted = true;
    return acted;
  }

  /** When an ask must have shown by: its deadline, or for the exception the earliest among the asks it holds. */
  private dueBy(ask: Ask): number {
    const held = ask.fold ? this.openIn(ask.thread).filter((f) => f.folded === ask.handle).map((f) => f.data.deadline as number) : [];
    return Math.min(ask.data.deadline as number, ...held);
  }

  /** The open asks in log order: asks enter the map only from apply, which reads the log in order. */
  private open(): Ask[] {
    return [...this.asks.values()].filter((a) => !a.closed);
  }
  /** The thread's open asks in log order. */
  private openIn(thread: string): Ask[] {
    return (this.threads.get(thread) ?? []).filter((a) => !a.closed);
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
      folded: ask.fold ? this.openIn(ask.thread).filter((a) => a.folded === ask.handle && (a.shown || !a.unread)).map((a) => a.handle) : [],
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
        const inThread = this.openIn(thread);
        const open = inThread.filter((a) => !a.fold);
        const holder = fold ? undefined : inThread.find((a) => a.fold && a.who.actor === e.actor && a.who.scope === e.scope);
        const ask: Ask = {
          id: e.id, handle: `ask:${e.id}`, data: d, options: d.options as Option[], session: e.session ?? '', who: { actor: e.actor, scope: e.scope }, thread, pos: e.log_pos,
          fold, ...(holder ? { folded: holder.handle } : {}), words: [], decided: new Set(), pending: {},
          created: e.ts, since: e.ts, shown: false, unread: e.session !== undefined && this.unread.has(e.session),
        };
        // A newer ask on the same subject in the same thread supersedes the older one, and keeps what it decided.
        for (const older of open) {
          if (older.data.key !== d.key) continue;
          older.pending.superseded = ask.handle;
          for (const path of older.decided) ask.decided.add(path);
        }
        this.asks.set(e.id, ask);
        const asks = this.threads.get(thread);
        if (asks) asks.push(ask);
        else this.threads.set(thread, [ask]);
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
        ask.closed = { outcome: CLOSING[e.kind] ?? 'decided_for_you', at: e.ts, ...(typeof d.answer === 'string' ? { answer: d.answer } : {}) };
        if (e.kind === 'ask.answered') ask.approval = { hash: (d.plan_hash as string | null) ?? null, token: (d.token as string | null | undefined) ?? null, decision: String(d.decision) };
        // An ask the exception held but hadn't shown yet wasn't in what you closed: it gets its own card.
        if (ask.fold) for (const a of this.openIn(ask.thread)) if (a.folded === ask.handle && !a.shown) delete a.folded;
        return;
      }
      case 'ask.batched': {
        if (e.writer !== 'core' || !Array.isArray(d.asks)) return;
        const shown = d.asks.flatMap((item) => {
          const ask = isObj(item) ? this.asks.get(bare(String(item.ask))) : undefined;
          // A showing counts only under the identity the ask was raised for.
          return ask && (!ask.shown || ask.later !== undefined) && ask.who.actor === e.actor && ask.who.scope === e.scope ? [ask] : [];
        });
        for (const ask of shown) {
          // Shown again, as when its Later ends: back in Needs you.
          ask.shown = true;
          delete ask.later;
        }
        // Only a batch counts toward the day's cap; an ask shown at once doesn't.
        const at = typeof d.batch === 'string' && d.batch.startsWith('batch:') ? Date.parse(d.batch.slice(6)) : NaN;
        if (Number.isNaN(at)) return;
        this.batched.set(Math.floor(at / DAY), (this.batched.get(Math.floor(at / DAY)) ?? 0) + shown.length);
        return;
      }
      case 'ask.later':
        // The core records your Later once later() has checked it against every deadline it could hide.
        if (target && !target.closed && e.writer === 'core' && target.who.actor === e.actor && target.who.scope === e.scope && typeof d.until === 'number' && d.until < this.dueBy(target)) target.later = d.until;
        return;
      case 'tool.before':
        // The agent's next step reads what you typed: asks held for it wait like any other now.
        if (!e.session || !this.unread.delete(e.session)) return;
        for (const a of this.open()) if (a.session === e.session && a.unread) [a.unread, a.since] = [false, e.ts];
        return;
      case 'user.ask': {
        if (d.from === 'person' && e.session) this.unread.add(e.session);
        if (d.from !== 'person' || typeof d.text !== 'string') return;
        const thread = this.threadOf(e.session);
        const open = this.openIn(thread);
        // Typed text never answers an authority ask: it shows beside it, for one tap on the card.
        for (const a of open) if (a.data.kind === 'authority') a.words.push(d.text);
        // It answers only a question in sight: not one queued for a batch, put off with Later, or in a hidden exception.
        const question = open.filter((a) => TYPED_KINDS.has(a.data.kind as string) && !a.fold && this.inSight(a)).at(-1);
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
          for (const a of this.openIn(this.threadOf(session))) a.pending.moot ??= by;
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
        for (const a of this.openIn(thread)) if (a.data.kind === 'choice' && a.data.provisional === true) for (const p of paths) a.decided.add(p);
        return;
      }
    }
  }

  /** Appends what the state calls for until it calls for nothing more. */
  private async settle(): Promise<void> {
    // The asks that had shown before this call: only they can take a default in it, whatever the clock reads.
    // One under Later, or held by an exception under Later, wasn't in sight.
    const seen = new Set(this.open().filter((a) => this.inSight(a)).map((a) => a.handle));
    for (let acted = true; acted;) {
      // What shows comes first, so no ask takes its default before it has shown.
      acted = await this.show();
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
        } else if (ask.fold && !this.openIn(ask.thread).some((a) => a.folded === ask.handle)) {
          // An exception that holds no open ask has nothing left to ask, as when the ask it was raised for never landed.
          await this.options.record.append(as, { ...base, kind: 'ask.cancelled', data: { answer: ask.data.default as string, plan_hash: null, decision: 'none' } });
        } else if (await this.reoffer(ask, as, now)) {
          // Offered again on the new commit: the new ask supersedes this one.
        } else if (now >= (ask.data.deadline as number) && seen.has(ask.handle)) {
          // Shown before this call: an ask the hub first shows now, after downtime past its deadline, stays in
          // Needs you until a later call, so it can be seen before its default.
          // Past its deadline the default applies; nothing defaults to allow, and an authority ask defaults to no.
          // Either takes the option that says no, which raise() made sure of; the decision is that option's own.
          const option = ask.options.find((o) => o.id === ask.data.default);
          const answer = ask.data.kind === 'authority' || option?.decision === 'allow' ? ask.options.find((o) => o.decision === 'deny') : option;
          const decision: Decision = answer?.decision ?? 'none';
          await this.options.record.append(as, { ...base, kind: 'ask.defaulted', data: { answer: answer?.id ?? 'no', plan_hash: null, decision } });
          await this.sync();
          this.hand(ask, answer?.id ?? null, null, false, decision);
        } else continue;
        acted = true;
      }
      // Once its exception closes, by your answer or its default, a folded ask waits for its own default: the
      // exception isn't raised again for asks it already showed you.
      await this.sync();
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

  /** The exception "this session keeps asking", for a thread, pinned to the asks it holds. */
  private async raiseFold(thread: string, session: string | undefined, who: Ask['who'], holds: string[], deadline: number): Promise<void> {
    const template = askSources().find((r) => r.source === FOLD_SOURCE)!.fixture.ask as Obj;
    const now = this.options.now();
    const data: Obj = { ...template, deadline, key: foldKey(thread), pinned_to: { kind: 'evidence', ref: sha256Hex(canonicalize(holds)) } };
    await this.options.record.append({ ...CORE, ...who, ...(session ? { session } : {}) }, { v: 1, id: ulid(now), kind: 'ask.created', ts: now, data });
    await this.sync();
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
    later: core.later.bind(core), inbox: core.inbox.bind(core),
  };
}
