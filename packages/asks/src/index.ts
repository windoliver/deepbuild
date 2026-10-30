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
//
// Resolvers (#349): an extension's resolver may answer an ask for you, but only by naming a decision you saved
// (decision.created, from your answer on the trusted path) that is active, of the ask's kind (its key) and at a scope
// that covers the ask's session. The gate is here, never in the resolver: anything else is refused, kept as a
// refusal (in memory, read back through `refusals`) naming the resolver and the decision, and the ask goes on to you.
//
// Decisions by kind and scope (#23): an ask that names its subject in structured fields (ask.created@4) is keyed
// from the subject alone, never from its words. Your answer on the trusted path is saved for its repo, and also
// answers each open ask it then covers. A decision covers an ask only within the bounds of the change it was saved
// from, never a change touching a CI workflow file or a git hook script, and nowhere you overruled it. Resolvers
// that disagree answer nothing: the ask reaches you showing each answer.
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
/** A plan's step: what it does, what it changes, its undo (null when it has none) and its cost in USD. */
export interface PlanStep { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }
/** plan.proposed@1's data, less the ask and the digest the core computes. */
export interface PlanInput { steps: PlanStep[]; diff: string }
/** What the core marks a step with no undo, in the plan it records and shows (#69). */
export const CANT_UNDO = "can't undo";
/** Whether a run may take a step of an authority ask's plan; when it may not, the ask it waits on. */
export type StepCheck = { run: true } | { run: false; ask: string };
/** A batch as its card shows it: every step of every plan in it, each with its switch as it starts. */
export interface BatchCard { batch: string; steps: { ask: string; step: number; does: string; undo: string; on: boolean }[] }
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
  /** For an automatic answer, the decision it reused; null otherwise. */
  because: string | null;
  /** For a paid run's request answered by naming a budget: that budget, and what's left in it once the run's price is reserved. null otherwise. */
  budget: BudgetLeft | null;
}
/** A budget you approved, and what's left in it, counting runs reserved and not yet charged. */
export interface BudgetLeft { budget: string; left_usd: number }
/** What a standing rule is judged on: cases decided, and how many of them later broke. */
export interface Tally { cases: number; broke: number }
/** A standing rule's judgment. Rates are fractions: one-sided 95% Clopper-Pearson bounds, yours at its upper bound. */
export interface Judgment {
  verdict: 'widen' | 'undecided' | 'FAIL';
  rule: { lower: number; upper: number };
  yours: number;
  /** Your bound times the margin. */
  limit: number;
  /** When it can't decide, the fewest more cases with no breakage that would let it widen; null otherwise. */
  more: number | null;
}
/** A standing rule's state: active can widen, frozen keeps deciding at its scope but can't widen, revoked answers nothing. */
export type RuleState = 'active' | 'frozen' | 'revoked';
/** The change a push or a merge carries: its kind (fix, feature, …), its size in changed lines, and the paths it touches, relative to the repo root. */
export interface Change { kind: string; lines: number; paths: string[] }
/** An authority ask's subject: the effect class (push, merge, …), its target, and the change it carries. */
export interface EffectSubject { effect: string; target: { kind: string; ref: string; owner: string }; change: Change | null }
/** A taste call's subject: the screen or journey step, and the element's stable name. */
export interface TasteSubject { screen: string; element: string }
/** A choice's or a definition's subject: the requirement or decision point it is pinned to. */
export interface PointSubject { point: string }
export type Subject = EffectSubject | TasteSubject | PointSubject;
/**
 * A resolver's answer: the option it chooses and what covers the ask, a decision handle (`decision:<ULID>`), or null
 * for nothing; and, when decisions that cover the ask disagree, each of the others in `also`, so none is applied.
 */
export interface ResolverAnswer {
  answer: string; because: string | null; also?: { answer: string; because: string }[];
  /**
   * For a paid run's request, the budget the resolver named to the ledger (#86) and what's left in it: once the
   * ledger applied the answer, the agent is told; when it refused, the card names it.
   */
  budget?: BudgetLeft;
}
/** What a resolver is asked: the card, the session the ask was raised in, its question class, its session's repo (null when unknown) and its subject. */
export type ResolverAsk = Card & { session: string; key: string; repo: string | null; subject: Subject | null };
export type Resolver = (ask: ResolverAsk) => ResolverAnswer | undefined | Promise<ResolverAnswer | undefined>;
/** One refusal the core made of a resolver's answer. */
export interface Refusal { ask: string; resolver: string; decision: string | null; reason: string }
/** The planted wrong core the criteria name; tests only: it applies any answer naming a decision that exists. */
export type AsksPlant = 'decision-exists-only';
/** The scopes a decision is saved at: this session, its repo, or everywhere. */
export type DecisionScope = 'session' | 'repo' | 'all';

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
  /** A task with a cost you pay: its price in USD. null on every other ask. */
  cost_usd: number | null;
  /** The nearest saved decision, suggested and never applied, when none covers the ask. null otherwise. */
  suggested: { decision: string; answer: string; scope: string } | null;
  /** When resolvers' answers that cover the ask disagree: each answer, with the resolver and the decision it named. [] otherwise. */
  conflict: { resolver: string; decision: string; answer: string }[];
  /** The files in a push's or merge's change that need you whatever a decision says: CI workflow files and git hook scripts. [] otherwise. */
  needs_person: string[];
  /** On a paid run's request whose named budget the core refused: that budget, and what's left in it, which the run's price doesn't fit. null otherwise. */
  budget: BudgetLeft | null;
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
  plant?: AsksPlant;
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
  /** On a drafted request: the owner it's for, and the block it asks them to clear. null on every other row. */
  request: { to: string; block: string } | null;
  /** For an ask decided for you, the decision it reused; null otherwise. */
  decision: string | null;
}
export interface Asks {
  raise(connection: Connection, source: string, ask: unknown, plan?: PlanInput): Promise<string>;
  answer(connection: Connection, ask: string, input: unknown): Promise<void>;
  tick(): Promise<void>;
  card(ask: string): Promise<Card>;
  needsYou(): Promise<Card[]>;
  holds(session: string, step: Step): Promise<string[]>;
  authorized(ask: string, planHash: string): Promise<string | null>;
  /**
   * Before a run takes a step of an authority ask's plan (#69): it runs only when your yes approved a plan holding it,
   * switched on. A step outside that plan stops the run and is asked again, once, as a new authority ask.
   */
  beforeStep(ask: string, step: PlanStep): Promise<StepCheck>;
  /** The batch an ask.batched names, with each step's switch as it starts: a step that can't be undone starts off. */
  batch(batch: string): Promise<BatchCard>;
  /** Your yes to a batch, on the trusted path: each plan in it, bound to your click, for the steps switched on. */
  approveBatch(connection: Connection, batch: string, input: { token: string; switches: { ask: string; step: number; on: boolean }[] }): Promise<void>;
  /** Later, on the trusted path: hides the ask until `until`, never past its deadline. */
  later(connection: Connection, ask: string, until: number): Promise<void>;
  /** Undo, on the trusted path: a defaulted ask opens again, waiting as long as it first did. */
  undo(connection: Connection, ask: string): Promise<void>;
  /** Every ask in the record, open or closed, with its status, owner and age. */
  inbox(): Promise<InboxRow[]>;
  /** The core consults each resolver on every ask raised, before the ask reaches you; returns how to drop it. */
  registerResolver(name: string, resolver: Resolver): () => void;
  /** Your answer to a closed ask, saved as a decision at a scope, on the trusted path: its handle. */
  saveDecision(connection: Connection, ask: string, scope: DecisionScope): Promise<string>;
  /** Revokes a decision on the trusted path: a decision.revoked event naming it; it covers nothing from then on. */
  revokeDecision(connection: Connection, decision: string): Promise<void>;
  /** The refusals the core made of resolvers' answers for an ask, in order. */
  refusals(ask: string): Promise<Refusal[]>;
  /**
   * The one-click overrule of an automatic answer, on the trusted path: another option for the ask a decision answered,
   * saved as a decision at the ask's scope. The decision it overrules stops answering there and keeps answering
   * wherever else it covers. Returns your new decision's handle.
   */
  overrule(connection: Connection, ask: string, input: { option: string; plan_hash?: string | null; token?: string }): Promise<string>;
  /**
   * Your confirmation of a wider match for the ask, on the trusted path: an active decision of its key, such as the
   * one its card suggested, then covers all your repos and answers the ask. A frozen or revoked rule can't widen.
   */
  widen(connection: Connection, ask: string, decision: string): Promise<void>;
  /**
   * A standing rule's judgment, from resolver-decisions: the core sets its state from the verdict (widen: active,
   * undecided: frozen, FAIL: revoked; revoked is final), records each change as decision.judged, and returns its state.
   */
  judged(connection: Connection, decision: string, judged: { rule: Tally; yours: Tally; margin: number; judgment: Judgment }): Promise<RuleState>;
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
  // A file that is missing or doesn't parse declares nothing: what depends on its values is BLOCKED, naming the value.
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as JsonValue;
    return isObj(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
/** Where the core asks again for a step a run would take outside the plan your yes approved (#69). */
const OUTSIDE_SOURCE = 'effect.outside_plan';
/** Where the core drafts a request for the owner of a block that isn't yours. */
const REQUEST_SOURCE = 'request.draft';
/** The trusted path: the question card and `deep inbox answer`. Every other writer is an agent's or the core's. */
/** A session or project ID as a scope names it: letters and digits only, as the hub's handles hold them. */
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
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
  /** A block someone else owns: it never reaches your inbox, and the core drafts them a request in its place. */
  theirs: boolean;
  /** On a drafted request: who it's for and the block it asks them to clear. */
  request?: { to: string; block: string };
  plan?: { hash: string; steps: PlanStep[] };
  closed?: { outcome: string; at: number; answer?: string; decision?: string };
  /** Resolvers' answers that covered it and disagreed, when they were last asked. */
  conflict: Card['conflict'];
  /** The budget a resolver named for it that the core refused, when it was last asked. */
  budget?: BudgetLeft;
  /** Your answer: the plan it bound, its click, its decision, and the steps of the plan it approved (null: all of them). */
  approval?: { hash: string | null; token: string | null; decision: string; steps: number[] | null };
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

/**
 * A decision you saved: what it answers (its ask's key), where (its scope), with which option, and whether it still
 * holds; the kind and subject of the ask it was saved from, the size bound of that ask's change, and the scopes you
 * overruled it at.
 */
interface HeldDecision {
  handle: string; key: string; scope: string; answer: string; ask: string; state: RuleState;
  kind: string; subject: Obj | null; bound: number | null; overruled: Set<string>;
}

const CLOSING: Readonly<Record<string, string>> = {
  'ask.answered': 'answered', 'ask.defaulted': 'defaulted', 'ask.escalated': 'escalated', 'ask.cancelled': 'cancelled',
  'ask.superseded': 'superseded', 'ask.moot': 'moot',
};

class AsksCore implements Asks {
  private cursor = 0;
  private readonly sessions = new Map<string, { thread: string; worktree: string; project: string | null }>();
  private readonly asks = new Map<string, Ask>();
  /** Each thread's asks, open or closed, in log order. */
  private readonly threads = new Map<string, Ask[]>();
  /** Each session's newest attempt at each task, from its claims. */
  private readonly attempts = new Map<string, Map<string, number>>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Sessions with a message you typed that the agent hasn't read yet. */
  private readonly unread = new Set<string>();
  /** The asks each batch showed, by its name. */
  private readonly shownIn = new Map<string, string[]>();
  /** How many asks batches showed each UTC day, by day number. */
  private readonly batched = new Map<number, number>();
  /** Settings read in this call, by worktree: each call reads the files once. */
  private readonly read = new Map<string, Obj>();
  /** Each block someone else owns, by handle, and the request drafted for it. */
  private readonly requested = new Map<string, string>();
  /** The decisions the record holds, by handle, and by the key they answer. */
  private readonly decisions = new Map<string, HeldDecision>();
  private readonly byKey = new Map<string, HeldDecision[]>();
  /** The decisions a near match is looked for among, by what must match for one (`nearOf`). */
  private readonly byNear = new Map<string, HeldDecision[]>();
  /** The resolvers registered, in order, by name. */
  private readonly resolvers = new Map<string, Resolver>();
  /** The refusals made of resolvers' answers, by ask handle. */
  private readonly refused = new Map<string, Refusal[]>();

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

  async raise(connection: Connection, source: string, raised: unknown, plan?: PlanInput): Promise<string> {
    const { handle, fresh } = await this.raiseNow(connection, source, raised, plan);
    // The resolvers go first, outside the core's lock, so one that reads the core as it answers doesn't wait on
    // itself: one that names a decision covering the ask answers it for you before it shows. Showing is a separate
    // step, so a tick in between may show the ask first; a question already open settles like any tick would.
    if (fresh) await this.consult(handle);
    await this.exclusive(async () => {
      await this.sync();
      await this.settle();
    });
    return handle;
  }
  /** The ask's record: validated, appended and read back, under the lock; `fresh` is false for a question already open in its thread. */
  private raiseNow(connection: Connection, source: string, raised: unknown, plan?: PlanInput): Promise<{ handle: string; fresh: boolean }> {
    return this.exclusive(async () => {
      await this.sync();
      const row = askSources().find((r) => r.source === source);
      if (!row) throw new AskRefused(`${source} has no row in ask.sources@1, so it can't raise an ask`, { source });
      const now = this.options.now();
      const filled = this.fill(connection.session, raised, now);
      const id = ulid(now);
      // An ask that names its subject is keyed from the subject alone: whatever key its raiser gave is replaced.
      const input = isObj(filled) && isObj(filled.subject) && SUBJECT_KINDS.has(String(filled.kind)) ? { ...filled, key: subjectKey(filled, this.threadOf(connection.session)) } : filled;
      const subjected = isObj(input) && 'subject' in input;
      // An unblock task is held to @3: at least one step and one thing it unblocks, and its price when you pay one.
      // An ask that names its subject is held to @4.
      const v = subjected ? 4 : isObj(input) && input.kind === 'unblock' ? 3 : isObj(input) && 'dropped' in input ? 2 : 1;
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
      // Every yes with authority shows what will happen first (#69): no plan, or a plan of no steps, raises nothing.
      if (row.kind === 'authority' && (!isObj(plan) || !Array.isArray(plan.steps) || plan.steps.length === 0)) {
        throw new AskRefused(`an authority ask from ${source} shows its plan: the steps, what each changes, its undo or that it can't be undone, and its cost`, { field: 'plan' });
      }
      let proposed: Obj | undefined;
      if (plan !== undefined) {
        // A step with no undo is marked so by the core, never by its raiser's words.
        const steps = plan.steps.map(markStep) as unknown as JsonValue;
        proposed = { ask: `ask:${id}`, steps, diff: plan.diff, hash: sha256Hex(canonicalize({ steps, diff: plan.diff })) };
        const planned = validate('plan.proposed@1', { v: 1, id: ulid(now), kind: 'plan.proposed', writer: 'core', actor: connection.actor, scope: connection.scope, ts: now, data: proposed });
        if (!planned.ok) throw new AskRefused(`plan.proposed@1 refuses the plan at ${planned.issues[0]!.path}`, { field: `plan${planned.issues[0]!.path.replace(/^\/data/, '')}` });
      }
      // The same question asked again in its thread, showing the same thing, is one record.
      const thread = this.threadOf(connection.session);
      const same = this.openIn(thread).find((a) => a.data.kind === data.kind && normalize(a.data.question as string) === normalize(data.question as string)
        && sha256Hex(canonicalize(a.data.pinned_to!)) === sha256Hex(canonicalize(data.pinned_to!)) && (a.plan?.hash ?? null) === ((proposed?.hash as string | undefined) ?? null));
      if (same) return { handle: same.handle, fresh: false };
      // Past the threshold drafted at setup, the thread's further asks fold into one exception. It's raised first,
      // so the log alone says which asks it holds: each one created while it's open.
      const foldAt = this.settingsFor(connection.session).fold;
      // A fold is one person's: the thread's asks raised under this actor and scope.
      // A block someone else owns isn't one of your asks, so it neither counts nor folds.
      const open = this.openIn(thread).filter((a) => a.who.actor === connection.actor && a.who.scope === connection.scope && !a.theirs);
      if (!isTheirs(data, connection.actor) && !open.some((a) => a.fold) && open.length >= (typeof foldAt === 'number' ? foldAt : FOLD_AT)) {
        await this.raiseFold(thread, connection.session, { actor: connection.actor, scope: connection.scope }, [`ask:${id}`], data.deadline as number);
      }
      await this.options.record.append(connection, { v, id, kind: 'ask.created', ts: now, data: data });
      if (proposed) await this.options.record.append(this.core(connection), { v: 1, id: ulid(now), kind: 'plan.proposed', ts: now, data: proposed });
      await this.sync();
      const ask = this.asks.get(id)!;
      // A provisional taste call or choice goes on with the recommended option at once.
      if (data.provisional) this.hand(ask, data.recommended as string, null, true, null);
      return { handle: ask.handle, fresh: true };
    });
  }

  async answer(connection: Connection, handle: string, input: unknown): Promise<void> {
    const saved = await this.exclusive(async (): Promise<string | null> => {
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
      // The same question from other threads, shown through this card, takes the same option.
      const riders = chosen ? this.open().filter((a) => this.rides(a) === ask) : [];
      await this.options.record.append(this.core(connection), {
        v: 2, id: ulid(now), kind: 'ask.answered', subject: ask.handle, ts: now,
        data: {
          answer: option ?? (words as string), plan_hash: decision === 'allow' ? ask.plan?.hash ?? null : null, decision,
          via, verified: true, on: ask.data.pinned_to!, token: token ?? null,
        },
      });
      await this.sync();
      this.hand(ask, chosen?.id ?? null, (words as string | undefined) ?? null, false, decision);
      for (const rider of riders) {
        await this.options.record.append(this.core({ ...connection, ...rider.who }), {
          v: 2, id: ulid(now), kind: 'ask.answered', subject: rider.handle, ts: now,
          data: { answer: chosen!.id, plan_hash: null, decision, via, verified: true, on: rider.data.pinned_to!, token: null },
        });
        await this.sync();
        this.hand(rider, chosen!.id, null, false, decision);
      }
      // An option you chose is saved as a decision for the ask's repo, or its session, whatever its words claim.
      const scope = chosen && !ask.fold ? this.scopeOf(ask) : null;
      if (scope !== null) await this.saveAt(connection, ask, scope, chosen!.id);
      await this.settle();
      return scope === null ? null : String(ask.data.key);
    });
    if (saved !== null) await this.reconsult(saved);
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
      // The same question from another thread shows through the older one's card.
      const shown = this.open().filter((a) => this.status(a) === 'shown' && !this.rides(a));
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

  undo(connection: Connection, handle: string): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`an undo counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      // Only a default is undone: an answer stands, and an open ask has nothing to undo.
      if (ask.closed?.outcome !== 'defaulted') {
        throw new AskRefused(ask.closed ? `${ask.handle} closed as ${ask.closed.outcome}, not by its default` : `${ask.handle} is open; there's no default to undo`, { ask: ask.handle, ...(ask.closed ? { outcome: ask.closed.outcome, closed_at: ask.closed.at } : {}) });
      }
      const now = this.options.now();
      const deadline = now + (ask.data.deadline as number) - ask.created;
      await this.options.record.append(this.core({ ...connection, ...ask.who }), { v: 1, id: ulid(now), kind: 'default.undone', subject: ask.handle, ts: now, data: { deadline } });
      await this.sync();
      await this.settle();
    });
  }

  inbox(): Promise<InboxRow[]> {
    return this.exclusive(async () => {
      await this.sync();
      const now = this.options.now();
      // A block someone else owns never reaches your inbox; the request drafted for it does.
      return [...this.asks.values()].filter((a) => !a.theirs).map((a) => ({
        ask: a.handle, kind: a.data.kind as AskKind, session: a.session, status: this.status(a),
        outcome: a.closed?.outcome ?? 'unanswered', owner: String(a.data.owner), age: now - a.created,
        request: a.request ? { ...a.request } : null, decision: a.closed?.decision ?? null,
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

  async beforeStep(handle: string, step: PlanStep): Promise<StepCheck> {
    const check = await this.exclusive(async (): Promise<StepCheck | { again: Ask; key: string }> => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask || ask.data.kind !== 'authority') throw new AskRefused(`${handle} is no authority ask`, { ask: handle });
      const marked = markStep(step);
      const approval = ask.closed?.outcome === 'answered' && ask.approval?.decision === 'allow' ? ask.approval : undefined;
      // Not yet answered, or answered anything but yes: the run waits on the ask itself.
      if (!approval) return { run: false, ask: ask.handle };
      // Your yes covers the plan it bound, and of it only the steps switched on.
      const at = approval.hash !== null && approval.hash === ask.plan?.hash
        ? ask.plan.steps.findIndex((s, i) => sameStep(s, marked) && (approval.steps === null || approval.steps.includes(i))) : -1;
      if (at >= 0) return { run: true };
      // Outside it: asked again, once, for that step.
      const key = sha256Hex(canonicalize({ again: ask.handle, step: marked as unknown as JsonValue }));
      const asked = this.open().find((a) => a.data.key === key);
      return asked ? { run: false, ask: asked.handle } : { again: ask, key };
    });
    if (!('again' in check)) return check;
    const { again: ask, key } = check;
    const now = this.options.now();
    const raised = await this.raise({ ...CORE, ...ask.who, ...(ask.session ? { session: ask.session } : {}) }, OUTSIDE_SOURCE, {
      kind: 'authority', question: `The run ${ask.handle} approved would also: ${step.does}. Your yes didn't cover it. Let it?`.slice(0, 8192),
      options: ask.options.map((o) => ({ ...o })), recommended: null, deadline: now + (ask.data.deadline as number) - ask.created, fallback: ask.data.fallback!,
      default: ask.options.find((o) => o.decision === 'deny')!.id, provisional: false, owner: ask.data.owner!, key, pinned_to: ask.data.pinned_to!,
    }, { steps: [step], diff: sha256Hex(canonicalize({ outside: ask.handle, key })) });
    return { run: false, ask: raised };
  }

  batch(batch: string): Promise<BatchCard> {
    return this.exclusive(async () => {
      await this.sync();
      return { batch, steps: this.batchSteps(batch) };
    });
  }

  approveBatch(connection: Connection, batch: string, input: { token: string; switches: { ask: string; step: number; on: boolean }[] }): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      const via = TRUSTED[connection.writer];
      if (via === undefined) throw new AskRefused(`an answer counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      if (!isObj(input) || typeof input.token !== 'string' || !input.token) throw new AskRefused('an approval binds to its click token', { field: 'token' });
      if (!Array.isArray(input.switches)) throw new AskRefused('a batch is approved with the switches you turned', { field: 'switches' });
      const steps = this.batchSteps(batch);
      if (!steps.length) throw new AskRefused(`${batch} shows no plan to approve`, { field: 'batch' });
      // Each step keeps the switch it started with unless you turned its own.
      const on = new Map(steps.map((s) => [`${s.ask}#${s.step}`, s.on]));
      for (const sw of input.switches) {
        const id = isObj(sw) ? `${String(sw.ask)}#${String(sw.step)}` : '';
        if (!on.has(id) || typeof sw.on !== 'boolean') throw new AskRefused(`${batch} has no step ${id}`, { field: 'switches' });
        on.set(id, sw.on);
      }
      const now = this.options.now();
      for (const handle of new Set(steps.map((s) => s.ask))) {
        const ask = this.asks.get(bare(handle))!;
        const allow = ask.options.find((o) => o.decision === 'allow');
        if (!allow || !ask.plan) continue;
        const chosen = steps.filter((s) => s.ask === handle && on.get(`${s.ask}#${s.step}`)).map((s) => s.step);
        // A plan with none of its steps switched on isn't approved: it waits for its own card.
        if (!chosen.length) continue;
        await this.options.record.append(this.core({ ...connection, ...ask.who }), {
          v: 3, id: ulid(now), kind: 'ask.answered', subject: ask.handle, ts: now,
          data: { answer: allow.id, plan_hash: ask.plan.hash, decision: 'allow', via, verified: true, on: ask.data.pinned_to!, token: input.token, steps: chosen },
        });
        await this.sync();
        this.hand(ask, allow.id, null, false, 'allow');
      }
      await this.settle();
    });
  }

  /** The open authority asks with a plan that a batch showed, each step with its switch as it starts. */
  private batchSteps(batch: string): BatchCard['steps'] {
    const asks = (this.shownIn.get(batch) ?? []).map((h) => this.asks.get(bare(h))).filter((a): a is Ask => !!a && !a.closed && a.data.kind === 'authority' && !!a.plan);
    return asks.flatMap((a) => a.plan!.steps.map((s, step) => ({ ask: a.handle, step, does: s.does, undo: String(s.undo), on: s.undo !== CANT_UNDO })));
  }

  registerResolver(name: string, resolver: Resolver): () => void {
    if (typeof name !== 'string' || !name) throw new AskRefused('a resolver registers under a name', { field: 'name' });
    if (typeof resolver !== 'function') throw new AskRefused(`${name}'s resolver is a function`, { field: 'resolver' });
    this.resolvers.set(name, resolver);
    return () => { if (this.resolvers.get(name) === resolver) this.resolvers.delete(name); };
  }

  async saveDecision(connection: Connection, handle: string, scope: DecisionScope): Promise<string> {
    const saved = await this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`a decision is saved only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      const answer = ask.closed?.outcome === 'answered' ? ask.closed.answer : undefined;
      if (answer === undefined || !ask.options.some((o) => o.id === answer)) throw new AskRefused(`${ask.handle} wasn't answered with an option, so there is no decision to save`, { ask: ask.handle });
      let at: string;
      if (scope === 'all') at = 'all';
      else if (scope === 'session') {
        if (!ask.session) throw new AskRefused(`${ask.handle} was raised in no session`, { field: 'scope', ask: ask.handle });
        at = `session:${letters(ask.session)}`;
      } else {
        const repo = this.repoOf(ask.session);
        if (repo === null) throw new AskRefused(`${ask.handle}'s session started in no repo the record knows`, { field: 'scope', ask: ask.handle });
        at = `repo:${repo}`;
      }
      // Saving at a scope overrules nothing by itself.
      return { decision: await this.saveAt(connection, ask, at, answer, false), key: String(ask.data.key) };
    });
    await this.reconsult(saved.key);
    return saved.decision;
  }

  async overrule(connection: Connection, handle: string, input: { option: string; plan_hash?: string | null; token?: string }): Promise<string> {
    const saved = await this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`an overrule counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      const old = ask.closed?.outcome === 'decided_for_you' ? ask.closed.decision : undefined;
      if (old === undefined) throw new AskRefused(`${ask.handle} wasn't decided for you, so there's no automatic answer to overrule`, { ask: ask.handle });
      const option = ask.options.find((o) => o.id === input.option);
      if (!option) throw new AskRefused(`${ask.handle} has no option ${String(input.option)}`, { option: String(input.option) });
      if (option.id === ask.closed!.answer) throw new AskRefused(`${old} already answered ${ask.handle} with ${option.id}`, { option: option.id });
      // An approval binds to the plan it was shown and to your click's token, as on the card.
      if (option.decision === 'allow') {
        if ((input.plan_hash ?? null) !== (ask.plan?.hash ?? null)) throw new AskRefused(`${ask.handle}'s approval names a plan it didn't show`, { field: 'plan_hash' });
        if (typeof input.token !== 'string' || !input.token) throw new AskRefused('an approval binds to its click token', { field: 'token' });
      }
      const scope = this.scopeOf(ask);
      if (scope === null) throw new AskRefused(`${ask.handle} was raised in no session or repo to save your answer for`, { field: 'scope', ask: ask.handle });
      // The decision that answered is overruled at the ask's scope, whatever else covers it there.
      const decision = await this.saveAt(connection, ask, scope, option.id);
      if (!this.decisions.get(old)?.overruled.has(scope)) {
        const now = this.options.now();
        await this.options.record.append(this.core(connection), { v: 2, id: ulid(now), kind: 'decision.overruled', subject: old, ts: now, data: { decision: old, at: scope } });
        await this.sync();
      }
      // The agent hears your answer, which undoes the one the decision gave.
      this.hand(ask, option.id, null, false, option.decision, null, ask.closed!.answer ?? null);
      return { decision, key: String(ask.data.key) };
    });
    await this.reconsult(saved.key);
    return saved.decision;
  }

  async widen(connection: Connection, handle: string, decision: string): Promise<void> {
    const key = await this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`a wider scope is confirmed only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      if (ask.closed) throw new AskRefused(`${ask.handle} closed as ${ask.closed.outcome}`, { ask: ask.handle, outcome: ask.closed.outcome, closed_at: ask.closed.at });
      // Only an active decision of the ask's own key widens: wider, it then covers the ask. A frozen rule's evidence
      // can't decide yet, and a revoked one answers nothing.
      const held = this.decisions.get(decision);
      if (!held) throw new AskRefused(`${decision} is no decision`, { field: 'decision', ask: ask.handle });
      if (held.state !== 'active') throw new AskRefused(`${decision} is ${held.state}, so it can't widen`, { field: 'decision', ask: ask.handle });
      if (held.key !== ask.data.key) throw new AskRefused(`${decision} answers another question than ${ask.handle}, so a wider scope wouldn't cover it`, { field: 'decision', ask: ask.handle });
      const lines = linesOf(ask.data.subject);
      if (needsPerson(ask.data).length || (held.bound !== null && lines !== null && lines > held.bound)) throw new AskRefused(`${decision} can't cover ${ask.handle} at any scope`, { field: 'decision', ask: ask.handle });
      const option = ask.options.find((o) => o.id === held.answer);
      if (!option) throw new AskRefused(`${ask.handle} has no option ${held.answer}`, { option: held.answer });
      const widened = await this.saveAt(connection, ask, 'all', held.answer, false);
      const now = this.options.now();
      await this.options.record.append(this.core({ ...connection, ...ask.who, session: ask.session }), { v: 1, id: ulid(now), kind: 'decision.applied', subject: ask.handle, ts: now, data: { decision: widened, ask: ask.handle } });
      await this.sync();
      this.hand(ask, option.id, null, false, option.decision, widened);
      await this.settle();
      return String(ask.data.key);
    });
    await this.reconsult(key);
  }

  revokeDecision(connection: Connection, handle: string): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`a decision is revoked only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const decision = this.decisions.get(handle);
      if (!decision) throw new AskRefused(`${handle} is no decision`, { field: 'decision' });
      if (decision.state === 'revoked') throw new AskRefused(`${handle} is already revoked or overruled`, { field: 'decision' });
      const now = this.options.now();
      await this.options.record.append(this.core(connection), { v: 1, id: ulid(now), kind: 'decision.revoked', subject: handle, ts: now, data: { decision: handle } });
      await this.sync();
    });
  }

  refusals(handle: string): Promise<Refusal[]> {
    return this.exclusive(async () => {
      await this.sync();
      return (this.refused.get(handle.startsWith('ask:') ? handle : `ask:${handle}`) ?? []).map((r) => ({ ...r }));
    });
  }

  /**
   * The repo a session started in, as a scope names it: the project its session.start was recorded under, in letters
   * and digits, as the hub writes it when it saves your inbox answer (`repo:<project>`); with no project, an ID derived
   * from its worktree. Null when the record knows neither.
   */
  private repoOf(session: string | undefined): string | null {
    const started = session ? this.sessions.get(session) : undefined;
    if (!started) return null;
    const project = started.project === null ? '' : letters(started.project);
    return project || sha256Hex(new TextEncoder().encode(started.worktree));
  }

  /**
   * Every resolver, outside the lock, then their answers under it. An answer counts only when it names a decision
   * that covers the ask (`uncovered`) and chooses that decision's option; anything else is refused, naming the
   * resolver and the decision. The answers that count are applied when they agree, citing the decision; when they
   * disagree nothing is applied, and the ask reaches you showing each. An ask closed meanwhile takes no answer.
   */
  private async consult(handle: string): Promise<void> {
    // With no resolver there is nothing to ask, and no card (its diff of the worktree) to build.
    if (!this.resolvers.size) return;
    const asked = await this.exclusive(async (): Promise<ResolverAsk | null> => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask || ask.closed) return null;
      const subject = isObj(ask.data.subject) ? (ask.data.subject as unknown as Subject) : null;
      return { ...(await this.cardOf(ask)), session: ask.session, key: String(ask.data.key), repo: this.repoOf(ask.session), subject };
    });
    if (!asked) return;
    const refuse = (resolver: string, decision: string | null, reason: string): void => {
      this.refused.set(handle, [...(this.refused.get(handle) ?? []), { ask: handle, resolver, decision, reason }]);
    };
    const answers: { resolver: string; answer: string; decision: string; budget?: BudgetLeft }[] = [];
    for (const [name, resolver] of [...this.resolvers]) {
      let reply: unknown;
      try {
        reply = await resolver(structuredClone(asked));
      } catch (error) {
        refuse(name, null, `${name} failed on ${handle}: ${(error as Error)?.message ?? String(error)}`);
        continue;
      }
      // Nothing, from a resolver in the hub (undefined) or over the wire (null): the ask goes on.
      if (reply === undefined || reply === null) continue;
      for (const answer of [reply, ...(isObj(reply) && Array.isArray(reply.also) ? reply.also : [])]) {
        if (!isObj(answer) || typeof answer.answer !== 'string') { refuse(name, null, `${name} answered ${handle} with no option`); continue; }
        if (typeof answer.because !== 'string') { refuse(name, null, `${name} answered ${handle} without naming a decision that covers it`); continue; }
        const budget = isObj(answer.budget) && typeof answer.budget.budget === 'string' && typeof answer.budget.left_usd === 'number'
          ? { budget: answer.budget.budget, left_usd: answer.budget.left_usd } : undefined;
        answers.push({ resolver: name, answer: answer.answer, decision: answer.because, ...(budget ? { budget } : {}) });
      }
    }
    if (!answers.length) return;
    await this.exclusive(async () => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask) return;
      // A paid run's request answered by naming a budget is applied by the ledger, the core's check of what's left
      // (#86), never here: once its decision.applied closed the ask, the agent hears it, naming the budget.
      const paid = answers.find((a) => a.budget && ask.closed?.outcome === 'decided_for_you' && ask.closed.decision === a.decision);
      if (paid) {
        const option = ask.options.find((o) => o.id === paid.answer && o.decision === 'allow');
        if (option) {
          ask.closed!.answer = option.id;
          this.hand(ask, option.id, null, false, option.decision, paid.decision, null, paid.budget!);
        }
        return;
      }
      if (ask.closed) return;
      // A budget the ledger refused is named on the card, with what's left in it; it answers nothing.
      delete ask.budget;
      for (const a of answers.filter((x) => x.budget)) {
        ask.budget = a.budget!;
        refuse(a.resolver, a.decision, `${a.resolver} named budget ${a.budget!.budget}, which the core refused: $${a.budget!.left_usd} is left in it`);
      }
      const counted = answers.filter((a) => !a.budget).filter(({ resolver, answer, decision: named }) => {
        const decision = this.decisions.get(named);
        if (!decision) { refuse(resolver, named, `${resolver} named ${named}, which the record holds no decision for`); return false; }
        const why = this.options.plant === 'decision-exists-only' ? null : this.uncovered(decision, ask);
        if (why !== null) { refuse(resolver, named, `${resolver} named ${named}, which ${why}`); return false; }
        if (!ask.options.some((o) => o.id === answer) || answer !== decision.answer) { refuse(resolver, named, `${resolver} answered ${answer}, not what ${named} decided (${decision.answer})`); return false; }
        return true;
      });
      // Answers that disagree answer nothing: the card shows each decision once, by the last resolver that named it.
      ask.conflict = new Set(counted.map((a) => a.answer)).size > 1
        ? [...new Map(counted.map((a) => [a.decision, { resolver: a.resolver, decision: a.decision, answer: a.answer }])).values()]
        : [];
      const [first] = counted;
      if (!first || ask.conflict.length) return;
      const option = ask.options.find((o) => o.id === first.answer)!;
      const now = this.options.now();
      await this.options.record.append(this.core({ ...CORE, ...ask.who, session: ask.session }), { v: 1, id: ulid(now), kind: 'decision.applied', subject: handle, ts: now, data: { decision: first.decision, ask: handle } });
      await this.sync();
      this.hand(ask, option.id, null, false, option.decision, first.decision);
    });
  }

  judged(connection: Connection, handle: string, judged: { rule: Tally; yours: Tally; margin: number; judgment: Judgment }): Promise<RuleState> {
    return this.exclusive(async () => {
      await this.sync();
      if (!JUDGES.has(connection.writer)) throw new AskRefused(`a standing rule is judged by resolver-decisions, not ${connection.writer}`, { field: 'writer' });
      const decision = this.decisions.get(handle);
      if (!decision) throw new AskRefused(`${handle} is no decision`, { field: 'decision' });
      const { rule, yours, margin, judgment } = judged;
      const next = VERDICT_STATE[judgment?.verdict];
      if (!next) throw new AskRefused('a judgment says widen, undecided or FAIL', { field: 'verdict' });
      // Revoked is final; a judgment that leaves the state as it is records nothing.
      if (decision.state === 'revoked' || decision.state === next) return decision.state;
      const now = this.options.now();
      await this.options.record.append(this.core(connection), {
        v: 1, id: ulid(now), kind: 'decision.judged', subject: handle, ts: now,
        data: {
          decision: handle, state: next, verdict: judgment.verdict,
          rule: { cases: rule.cases, broke: rule.broke, lower: judgment.rule.lower, upper: judgment.rule.upper },
          yours: { cases: yours.cases, broke: yours.broke, upper: judgment.yours }, margin, limit: judgment.limit, more: judgment.more,
        },
      });
      await this.sync();
      return decision.state;
    });
  }

  /** After a decision is saved, each open ask of its key is offered to the resolvers again: one it covers closes as decided for you. */
  private async reconsult(key: string): Promise<void> {
    const open = await this.exclusive(async () => {
      await this.sync();
      return this.open().filter((a) => a.data.key === key).map((a) => a.handle);
    });
    for (const handle of open) await this.consult(handle);
  }

  /**
   * Your answer saved as a decision at a scope, under the lock: and, when you chose an option that decisions covering
   * the ask contradict, each of them overruled at that scope, where they keep answering elsewhere. Its handle.
   */
  private async saveAt(connection: Connection, ask: Ask, scope: string, answer: string, overrules = true): Promise<string> {
    const contradicted = !overrules || needsPerson(ask.data).length ? [] : this.covering(ask).filter((d) => d.answer !== answer);
    const now = this.options.now();
    const id = ulid(now);
    const as = this.core(connection);
    await this.options.record.append(as, { v: 1, id, kind: 'decision.created', subject: ask.handle, ts: now, data: { key: String(ask.data.key), scope, answer, ask: ask.handle } });
    for (const d of contradicted) {
      await this.options.record.append(as, { v: 2, id: ulid(now), kind: 'decision.overruled', subject: d.handle, ts: now, data: { decision: d.handle, at: scope } });
    }
    await this.sync();
    return `decision:${id}`;
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
    // A block someone else owns never shows: its drafted request does.
    // The same question from another thread shows through the older one's card, and is answered with it.
    const waiting = () => this.open().filter((a) => !a.shown && !this.inFold(a) && a.later === undefined && !a.theirs && !this.rides(a));
    // A Later that ends shows its ask again, recorded like any showing; so does one that an ask joining the
    // exception since would outlast.
    const now = this.options.now();
    let acted = await this.showNow(this.open().filter((a) => a.later !== undefined && !a.theirs && (a.later <= now || this.dueBy(a) <= a.later)));
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

  private hand(ask: Ask, option: string | null, words: string | null, provisional: boolean, decision: Decision | null, because: string | null = null, undid: string | null = null, budget: BudgetLeft | null = null): void {
    const chosen = ask.options.find((o) => o.id === option);
    const recommended = ask.data.recommended as string | null;
    // A different answer undoes the option a provisional ask went on with, or the one an overruled decision gave.
    const undoes = undid ?? (!provisional && ask.data.provisional === true && option !== null && option !== recommended ? recommended : null);
    this.options.deliver({ ask: ask.handle, session: ask.session, option, decision: decision ?? chosen?.decision ?? 'none', words, provisional, undoes, because, budget });
  }

  /** Whether an open ask shows through an older open one from another thread: the same question, by key, pinned to the same thing. */
  private rides(ask: Ask): Ask | undefined {
    if (ask.closed || !JOINED_KINDS.has(String(ask.data.kind)) || !isObj(ask.data.subject)) return undefined;
    const pin = sha256Hex(canonicalize(ask.data.pinned_to!));
    return this.open().find((b) => b.pos < ask.pos && b.thread !== ask.thread && b.data.kind === ask.data.kind && b.data.key === ask.data.key
      && !b.theirs && !b.fold && b.who.actor === ask.who.actor && b.who.scope === ask.who.scope && sha256Hex(canonicalize(b.data.pinned_to!)) === pin);
  }

  /** The scope your answer to an ask is saved at: its session's project, or its session when it started in none; null with neither. */
  private scopeOf(ask: Ask): string | null {
    const project = letters(this.sessions.get(ask.session)?.project ?? '');
    return project ? `repo:${project}` : ask.session ? `session:${letters(ask.session)}` : null;
  }

  /** Whether a scope covers an ask: everywhere, its session, or its session's repo. */
  private scopeCovers(scope: string, ask: Ask): boolean {
    if (scope === 'all') return true;
    if (scope.startsWith('session:')) return ask.session !== '' && letters(scope.slice('session:'.length)) === letters(ask.session);
    const repo = this.repoOf(ask.session);
    return repo !== null && scope === `repo:${repo}`;
  }

  /**
   * Why a decision doesn't cover an ask, or null when it does: active, of its key, at a scope covering it, not
   * overruled there, within the size bound of the change it was saved from, and no file in the ask's change needs you.
   */
  private uncovered(decision: HeldDecision, ask: Ask): string | null {
    // A frozen rule keeps deciding at its scope; only widening waits on more evidence.
    if (decision.state === 'revoked') return 'was revoked';
    if (decision.key !== ask.data.key) return `is a decision of another kind than ${ask.handle}'s`;
    if (!this.scopeCovers(decision.scope, ask)) return `is saved at ${decision.scope}, which doesn't cover ${ask.handle}'s session`;
    const over = [...decision.overruled].find((at) => this.scopeCovers(at, ask));
    if (over) return `was overruled at ${over}`;
    const lines = linesOf(ask.data.subject);
    if (decision.bound !== null && lines !== null && lines > decision.bound) return `covers changes up to ${decision.bound} lines, and ${ask.handle}'s is ${lines}`;
    const person = needsPerson(ask.data);
    if (person.length) return `can't cover a change to ${person.join(', ')}, which needs you`;
    return null;
  }

  /** The decisions that cover an ask. */
  private covering(ask: Ask): HeldDecision[] {
    return (this.byKey.get(String(ask.data.key)) ?? []).filter((d) => this.uncovered(d, ask) === null);
  }

  /**
   * The nearest saved decision to an ask none covers, to suggest and never apply: of its key at another scope or
   * past a bound first, else of its ask kind with the most subject fields alike (an authority ask's effect, a
   * choice's or a definition's point, and a taste call's screen or element must match); the latest among equals.
   */
  private suggest(ask: Ask): Card['suggested'] {
    if (ask.closed || !isObj(ask.data.subject) || this.covering(ask).length) return null;
    const subject = ask.data.subject;
    const alike = (d: HeldDecision): number => {
      const s = d.subject;
      if (!s || d.kind !== ask.data.kind) return -1;
      if (ask.data.kind === 'authority') {
        if (s.effect !== subject.effect) return -1;
        const [a, b] = [isObj(s.target) ? s.target : {}, isObj(subject.target) ? subject.target : {}];
        const n = Number(a.kind === b.kind) + Number(a.owner === b.owner) + Number((isObj(s.change) ? s.change.kind : null) === (isObj(subject.change) ? subject.change.kind : null));
        return n >= 2 ? n : -1;
      }
      if (ask.data.kind === 'taste') return Number(s.screen === subject.screen) + Number(s.element === subject.element) || -1;
      return s.point === subject.point ? 1 : -1;
    };
    let best: { d: HeldDecision; score: number } | undefined;
    for (const d of [...(this.byKey.get(String(ask.data.key)) ?? []), ...(this.byNear.get(nearOf(String(ask.data.kind), subject)) ?? [])]) {
      if (d.state !== 'active' || [...d.overruled].some((at) => this.scopeCovers(at, ask))) continue;
      const score = d.key === ask.data.key ? 100 : alike(d);
      if (score >= 0 && (!best || score >= best.score)) best = { d, score };
    }
    return best ? { decision: best.d.handle, answer: best.d.answer, scope: best.d.scope } : null;
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
      cost_usd: typeof ask.data.cost_usd === 'number' ? ask.data.cost_usd : null,
      suggested: this.suggest(ask),
      conflict: ask.conflict.map((c) => ({ ...c })),
      needs_person: needsPerson(ask.data),
      budget: ask.budget && !ask.closed ? { ...ask.budget } : null,
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
        if (e.session) this.sessions.set(e.session, { thread: String(d.thread), worktree: String(d.worktree), project: e.project ?? null });
        return;
      case 'ask.created': {
        const thread = this.threadOf(e.session);
        const fold = e.writer === 'core' && d.key === foldKey(thread);
        const theirs = isTheirs(d, e.actor);
        // A request the core drafted names its block as its subject and is keyed on the block's subject.
        const block = e.writer === 'core' && e.subject?.startsWith('ask:') ? this.asks.get(bare(e.subject)) : undefined;
        const request = block?.theirs && !this.requested.has(block.handle) && d.key === requestKey(block) ? { to: String(block.data.owner), block: block.handle } : undefined;
        const inThread = this.openIn(thread);
        const open = inThread.filter((a) => !a.fold);
        const holder = fold || theirs ? undefined : inThread.find((a) => a.fold && a.who.actor === e.actor && a.who.scope === e.scope);
        const ask: Ask = {
          id: e.id, handle: `ask:${e.id}`, data: d, options: d.options as Option[], session: e.session ?? '', who: { actor: e.actor, scope: e.scope }, thread, pos: e.log_pos,
          fold, ...(holder ? { folded: holder.handle } : {}), theirs, ...(request ? { request } : {}), words: [], decided: new Set(), pending: {}, conflict: [],
          created: e.ts, since: e.ts, shown: false, unread: e.session !== undefined && this.unread.has(e.session),
        };
        if (request) this.requested.set(request.block, ask.handle);
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
      case 'decision.created': {
        if (e.writer !== 'core') return;
        // What it covers comes from the ask it was saved from: its kind, its subject and its change's size.
        const from = this.asks.get(bare(String(d.ask)));
        const subject = from && isObj(from.data.subject) ? from.data.subject : null;
        const held: HeldDecision = {
          handle: `decision:${e.id}`, key: String(d.key), scope: String(d.scope), answer: String(d.answer), ask: String(d.ask), state: 'active',
          kind: String(from?.data.kind ?? ''), subject, bound: boundFor(linesOf(subject)), overruled: new Set(),
        };
        this.decisions.set(held.handle, held);
        this.byKey.set(held.key, [...(this.byKey.get(held.key) ?? []), held]);
        if (subject) {
          const near = nearOf(held.kind, subject);
          this.byNear.set(near, [...(this.byNear.get(near) ?? []), held]);
        }
        return;
      }
      // Revoked or overruled (#667) on the trusted path: it covers nothing from then on; overruled at one scope
      // (decision.overruled@2), nothing there.
      case 'decision.revoked':
      case 'decision.overruled': {
        const decision = e.writer === 'core' ? this.decisions.get(String(d.decision)) : undefined;
        if (decision && e.kind === 'decision.overruled' && typeof d.at === 'string') decision.overruled.add(d.at);
        else if (decision) decision.state = 'revoked';
        return;
      }
      // A standing rule judged by what later broke: revoked is final.
      case 'decision.judged': {
        const decision = e.writer === 'core' ? this.decisions.get(String(d.decision)) : undefined;
        if (decision && decision.state !== 'revoked' && STATES.has(String(d.state))) decision.state = d.state as RuleState;
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
        ask.closed = {
          outcome: CLOSING[e.kind] ?? 'decided_for_you', at: e.ts, ...(typeof d.answer === 'string' ? { answer: d.answer } : {}),
          ...(e.kind === 'decision.applied' ? { decision: String(d.decision), answer: this.decisions.get(String(d.decision))?.answer ?? '' } : {}),
        };
        if (e.kind === 'ask.answered') {
          const steps = Array.isArray(d.steps) ? d.steps.filter((n): n is number => typeof n === 'number') : null;
          ask.approval = { hash: (d.plan_hash as string | null) ?? null, token: (d.token as string | null | undefined) ?? null, decision: String(d.decision), steps };
        }
        // An ask the exception held but hadn't shown yet wasn't in what you closed: it gets its own card.
        if (ask.fold) for (const a of this.openIn(ask.thread)) if (a.folded === ask.handle && !a.shown) delete a.folded;
        // A block that's moot, its check passed or its attempt replaced, needs no request: that one's moot too.
        const request = e.kind === 'ask.moot' ? this.asks.get(bare(this.requested.get(ask.handle) ?? '')) : undefined;
        if (request && !request.closed) request.pending.moot ??= d;
        return;
      }
      case 'default.undone':
        // Open again, still shown, with the new deadline the undo gave it; it no longer waits in an exception.
        if (!target || target.closed?.outcome !== 'defaulted' || e.writer !== 'core' || typeof d.deadline !== 'number') return;
        delete target.closed;
        delete target.folded;
        target.data = { ...target.data, deadline: d.deadline };
        return;
      case 'ask.batched': {
        if (e.writer !== 'core' || !Array.isArray(d.asks)) return;
        const shown = d.asks.flatMap((item) => {
          const ask = isObj(item) ? this.asks.get(bare(String(item.ask))) : undefined;
          // A showing counts only under the identity the ask was raised for.
          return ask && (!ask.shown || ask.later !== undefined) && ask.who.actor === e.actor && ask.who.scope === e.scope ? [ask] : [];
        });
        if (typeof d.batch === 'string') this.shownIn.set(d.batch, [...(this.shownIn.get(d.batch) ?? []), ...shown.map((a) => a.handle)]);
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
      // A block someone else owns gets its request drafted first, so the request shows when the block is raised.
      acted = false;
      for (const block of this.open()) {
        if (!block.theirs || this.requested.has(block.handle)) continue;
        await this.draftRequest(block);
        acted = true;
      }
      // What shows comes first, so no ask takes its default before it has shown.
      if (await this.show()) acted = true;
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
        } else if (now >= (ask.data.deadline as number) && (seen.has(ask.handle) || ask.theirs)) {
          // Shown before this call: an ask the hub first shows now, after downtime past its deadline, stays in
          // Needs you until a later call, so it can be seen before its default. A block someone else owns never
          // shows to you: at its deadline it stays BLOCKED, by the default its raiser named.
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

  /**
   * The request for the owner of a block that isn't yours, drafted into your inbox as an authority ask, since sending
   * it leaves the machine. It's pinned to what its block shows, so its card re-checks that source each time it's
   * made and says when the item has moved. It ends when its block would.
   */
  private async draftRequest(block: Ask): Promise<void> {
    const template = askSources().find((r) => r.source === REQUEST_SOURCE)!.fixture.ask as Obj;
    const now = this.options.now();
    const question = `Send ${String(block.data.owner)} this request? ${String(block.data.question)}`.slice(0, 8192);
    const data: Obj = { ...template, question, deadline: block.data.deadline!, owner: block.who.actor, key: requestKey(block), pinned_to: block.data.pinned_to! };
    const who = { ...CORE, ...block.who, ...(block.session ? { session: block.session } : {}) };
    const id = ulid(now);
    await this.options.record.append(who, { v: 1, id, kind: 'ask.created', subject: block.handle, ts: now, data });
    // Sending it leaves the machine, so it shows its plan: the one message, which can't be unsent (#69).
    const steps = [{ does: `Send ${String(block.data.owner)} the request: ${String(block.data.question)}`.slice(0, 8192), changes: [`a message to ${String(block.data.owner)}`], undo: CANT_UNDO, public: true, cost: 0 }];
    const diff = sha256Hex(canonicalize({ request: block.handle }));
    await this.options.record.append(who, { v: 1, id: ulid(now), kind: 'plan.proposed', ts: now, data: { ask: `ask:${id}`, steps, diff, hash: sha256Hex(canonicalize({ steps, diff })) } });
    await this.sync();
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

/** A step as a plan holds it: one with no undo marked can't undo. */
const markStep = (step: PlanStep): PlanStep => (isObj(step) && (step.undo === null || step.undo === '') ? { ...step, undo: CANT_UNDO } : step);
/** Two steps are the same step when every field is. */
const sameStep = (a: PlanStep, b: PlanStep): boolean => sha256Hex(canonicalize(a as unknown as JsonValue)) === sha256Hex(canonicalize(b as unknown as JsonValue));

/** A question's text as it compares: NFC, case folded, white space collapsed, trailing punctuation dropped. */
const normalize = (text: string): string => text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?]+$/u, '');

/** A standing rule's states, and what each verdict moves it to. */
const STATES = new Set<string>(['active', 'frozen', 'revoked']);
const VERDICT_STATE: Readonly<Record<Judgment['verdict'], RuleState>> = { widen: 'active', undecided: 'frozen', FAIL: 'revoked' };
/** Who judges a standing rule: resolver-decisions, or the core on its timer. */
const JUDGES = new Set(['ext:resolver-decisions', 'core']);

/** The ask kinds that name a subject, and so are keyed from it. */
const SUBJECT_KINDS = new Set(['authority', 'taste', 'choice', 'definition']);
/** The kinds whose same question from another thread, pinned to the same thing, shows through one card. */
const JOINED_KINDS = new Set(['taste', 'choice', 'definition']);

/**
 * An ask's key, from its subject's structured fields alone, never its words: for an authority ask the effect class,
 * the target's kind, its owner (a PR the asking thread opened is its own, whatever its number) and the kind of
 * change; for a taste call the screen and the element; for a choice or a definition the point and its option IDs.
 * The hub reads it too, to tell whether a saved decision covers a permission prompt before raising anything (#23).
 */
export function subjectKey(data: Obj, thread: string): string {
  const s = data.subject as Obj;
  const target = isObj(s.target) ? s.target : {};
  const owner = String(target.owner);
  const fields = data.kind === 'authority'
    ? { effect: String(s.effect), target: String(target.kind), owner: owner === `thread:${thread}` ? 'self' : owner, change: isObj(s.change) ? String(s.change.kind) : null }
    : data.kind === 'taste' ? { screen: String(s.screen), element: String(s.element) }
      : { point: String(s.point), options: (Array.isArray(data.options) ? data.options : []).map((o) => String(isObj(o) ? o.id : o)).sort() };
  return sha256Hex(canonicalize({ key: 1, kind: String(data.kind), ...fields } as JsonValue));
}

/** What a near match must share: an authority ask's effect, a choice's or a definition's point; any taste call. */
const nearOf = (kind: string, subject: Obj): string =>
  JSON.stringify([kind, kind === 'authority' ? subject.effect : kind === 'taste' ? null : subject.point]);

/** CI workflow files and git hook scripts: a push or merge touching one needs you, whatever a decision says. */
const PERSON_PATHS = /^(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.git\/hooks\/|\.githooks\/|\.husky\/)/;
/** The paths in an ask's change that need a person. */
const needsPerson = (data: Obj): string[] => {
  const change = isObj(data.subject) && isObj(data.subject.change) ? data.subject.change : undefined;
  return Array.isArray(change?.paths) ? change.paths.filter((p): p is string => typeof p === 'string' && PERSON_PATHS.test(p.replace(/^\.\//, ''))) : [];
};
/** The size of an ask's change in lines, or null when it carries none. */
const linesOf = (subject: unknown): number | null => (isObj(subject) && isObj(subject.change) && typeof subject.change.lines === 'number' ? subject.change.lines : null);
/** The size bound a decision saved from a change of `lines` sets: up to twice its size, and at least 50 lines. */
const boundFor = (lines: number | null): number | null => (lines === null ? null : Math.max(2 * lines, 50));

/** The fold's exception is keyed on its thread, never on a session ID that /clear or /compact rotates. */
const foldKey = (thread: string): string => sha256Hex(new TextEncoder().encode(`${FOLD_SOURCE}:${thread}`));

/** A block someone else owns: an unblock task whose owner isn't the person it was raised for. */
const isTheirs = (data: Obj, actor: string): boolean => data.kind === 'unblock' && data.owner !== actor;

/** A request is keyed on its block's subject, so a newer block on the same subject supersedes its request too. */
const requestKey = (block: Ask): string => sha256Hex(new TextEncoder().encode(`${REQUEST_SOURCE}:${String(block.data.key)}`));

export async function openAsks(options: AsksOptions): Promise<Asks> {
  const core = new AsksCore(options);
  await core.tick();
  // Plain functions, so a caller can wrap one method and keep the rest.
  return {
    raise: core.raise.bind(core), answer: core.answer.bind(core), tick: core.tick.bind(core), card: core.card.bind(core),
    needsYou: core.needsYou.bind(core), holds: core.holds.bind(core), authorized: core.authorized.bind(core),
    beforeStep: core.beforeStep.bind(core), batch: core.batch.bind(core), approveBatch: core.approveBatch.bind(core),
    later: core.later.bind(core), undo: core.undo.bind(core), inbox: core.inbox.bind(core),
    registerResolver: core.registerResolver.bind(core), saveDecision: core.saveDecision.bind(core), revokeDecision: core.revokeDecision.bind(core), refusals: core.refusals.bind(core),
    overrule: core.overrule.bind(core), widen: core.widen.bind(core), judged: core.judged.bind(core),
  };
}
