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
//
// Stops (#85): a stop whose block only you can clear (owner you: a revoked sign-in, a VPN, a spend limit) or whose plan
// window is spent raises one unblock task, shared by every session the same block (the same signature) stopped; it
// closes on its check (a PASS verdict, the reset time, or the reply a chat-app thread expects) and the core then
// continues each of its sessions (session.continued, because task_closed). A transient the service owns, or a context
// overflow, gets one automatic continue per turn you started, while the stop is the session's newest, under 10 minutes
// old by deep-hook's stamp, with nothing typed since. The core reads the stop's structure alone, never the agent's text.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ADAPTERS, shipped } from '@deepbuild/adapters';
import type { AdapterRegistry } from '@deepbuild/adapters';
import { canonicalize, sha256Hex, validate } from '@deepbuild/contracts';
import type { JsonValue } from '@deepbuild/contracts';
import { asCore, ulid } from '@deepbuild/record';
import type { Connection, Event, RecordStore } from '@deepbuild/record';
import { KINDS, place, remotesOf, targetsOf, type CardTarget } from './targets.js';
import { AskRefused, bare, CANT_UNDO, isObj, letters } from './model.js';
import type { Ask, AskKind, AsksPlant, BatchCard, BudgetLeft, Card, Decision, HeldDecision, InboxStatus, Missing, Obj, Option, PlanStep, Refusal, Resolver, ResolverAsk, RuleState, Subject } from './model.js';
import { blockKey, BLOCK_SOURCE, boundFor, DecisionKeys, foldKey, FOLD_SOURCE, linesOf, nearOf, needsPerson, requestKey, REQUEST_SOURCE, subjectKey, SUBJECT_KINDS } from './decision-keys.js';
import { ResolverGate } from './resolver-gate.js';
import { Showing } from './showing.js';
import { duration } from './duration.js';
export { duration } from './duration.js';

export { AskRefused, CANT_UNDO } from './model.js';
export type { AskKind, AsksPlant, BatchCard, BudgetLeft, Card, Change, Decision, EffectSubject, InboxStatus, Missing, PlanStep, PointSubject, Refusal, Resolver, ResolverAnswer, ResolverAsk, RuleState, Subject, TasteSubject } from './model.js';
export { subjectKey } from './decision-keys.js';

export type { CardTarget, Target, TargetOrigin } from './targets.js';

/** One row of ask.sources@1: a place that raises asks, the one kind it raises, and its fixture. */
export interface AskSource {
  source: string;
  kind: AskKind;
  fixture: { ask: JsonValue; at_deadline: { decision: Decision } };
}
/** plan.proposed@1's data, less the ask and the digest the core computes. */
export interface PlanInput { steps: PlanStep[]; diff: string }
/** Whether a run may take a step of an authority ask's plan; when it may not, the ask it waits on. */
export type StepCheck = { run: true } | { run: false; ask: string };
/** A step the agent is about to take; whether it leaves the machine comes from the guard engine. */
export interface Step { leaves_machine: boolean }

/** What the core hands the agent's adapter for one ask. */
export interface Delivery {
  ask: string;
  session: string;
  option: string | null;
  decision: Decision;
  words: string | null;
  /** The SHA-256 of a screenshot sent with the answer from the question card; null without one. */
  image: string | null;
  provisional: boolean;
  undoes: string | null;
  /** For an automatic answer, the decision it reused; null otherwise. */
  because: string | null;
  /** For a paid run's request answered by naming a budget: that budget, and what's left in it once the run's price is reserved. null otherwise. */
  budget: BudgetLeft | null;
}
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
/** The scopes a decision is saved at: this session, its repo, or everywhere. */
export type DecisionScope = 'session' | 'repo' | 'all';
/** One message in a thread of your chat app, as the read-only connector hands it over. */
export interface ThreadMessage { from: string; text: string; at: number }

export interface AsksOptions {
  record: RecordStore;
  now: () => number;
  deliver: (delivery: Delivery) => void;
  /** Your ~/.deepbuild folder: its config.json holds your own settings. Left out, nothing is declared. */
  home?: string;
  plant?: AsksPlant;
  /**
   * The read-only connector to your chat app's threads: how a chat-app task's check reads the thread, once per tick
   * while such a task is open. The link is the task's own words, so the connector holds it to the chat app it serves
   * and fetches nothing else. Left out, no thread is read.
   */
  threads?: { read(link: string): Promise<ThreadMessage[]> };
  /**
   * A network task's check, once per tick while one is open: a try's result, with when it started, when one has finished
   * since the last call, and null otherwise. Left out, a network task closes only on a verdict.
   */
  network?: { read(): { host: string; reached: boolean; at: number } | null };
  /**
   * Whether an agent's adapter has a hook for a turn that ends in an error (its `errorTurnHook` cap): without one no
   * automatic continue could reach the session, so none starts. The hub passes its own adapter registry's answer;
   * left out, the shipped adapters' caps answer, and an agent no adapter knows has none.
   */
  errorTurnHook?: (agent: string) => boolean;
}
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
  /** On an open task whose check ran and still fails: what's missing, as its card says. null otherwise. */
  missing: Missing | null;
  /** What you typed beside an ask that typed text can't close, as its card shows it. */
  words: string[];
}
export interface Asks {
  raise(connection: Connection, source: string, ask: unknown, plan?: PlanInput): Promise<string>;
  answer(connection: Connection, ask: string, input: unknown): Promise<void>;
  tick(): Promise<void>;
  /**
   * The hub didn't run from `from` to `to` while it stayed up, as when the Mac slept (#908): each open ask that hadn't
   * shown has its deadline moved later by the part of that time before its deadline, up to its kind's wait counted from
   * `to`. Time the hub was down the core reads from the log when it opens.
   */
  away(from: number, to: number): Promise<void>;
  /**
   * Whether macOS will show the app's notifications (#994). While it won't, an ask you haven't seen takes no default,
   * and the time before you saw it, or before they were back on, moves its deadline later as `away` does.
   */
  notifications(off: boolean): Promise<void>;
  /** Whether one of your batch times has come since the asks were last shown, by your settings as they are now: the hub's beat ticks then, with nothing else due. */
  batchDue(): Promise<boolean>;
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
  /** Later until `before` ms ahead of the ask's deadline (#1462). */
  laterBefore(connection: Connection, ask: string, before: number): Promise<void>;
  /** Undo, on the trusted path: a defaulted ask opens again, waiting as long as it first did. */
  undo(connection: Connection, ask: string): Promise<void>;
  /** Every ask in the record, open or closed, with its status, owner and age. */
  inbox(): Promise<InboxRow[]>;
  /** A task's check, run again on your "I did it", still fails (#323): each open task it proves says what's missing. */
  stillFails(check: string, reasons: string[]): Promise<void>;
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
  // An ask that first shows with less than this left before its deadline takes its default no sooner than this after it shows (#908).
  notice: { taste: '1h', authority: '1h', unblock: '1h', exception: '1h', choice: '1h', definition: '1h' },
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

let sources: AskSource[] | undefined;
/** The ask.sources@1 table, as data beside the package. */
export const askSources = (): AskSource[] =>
  structuredClone((sources ??= JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8')) as AskSource[]));

/** Once a thread holds this many open asks, its further asks fold into one exception, unless settings say otherwise. */
const FOLD_AT = 5;
/** The fold's option that answers each of the session's open asks with its recommended option. */
const TOGETHER = 'together';
/** Where the core asks again for a step a run would take outside the plan your yes approved (#69). */
const OUTSIDE_SOURCE = 'effect.outside_plan';
/** How old a stop may be, by deep-hook's stamp, when the core sees it, for an automatic continue (design: 10 minutes). */
const CONTINUE_WINDOW = 10 * 60_000;
/** The causes that pass by themselves when the service owns the block: a dropped connection, an overloaded service. */
const TRANSIENT = new Set(['timed_out', 'rate_limited']);
/** The ask.moot reasons ask.moot@2 added. */
const MOOT_V2 = new Set(['window_reset', 'thread_replied', 'network_reached']);
/** The trusted path: the question card and `deep inbox answer`. Every other writer is an agent's or the core's. */
const TRUSTED: Readonly<Record<string, 'card' | 'inbox'>> = { app: 'card', cli: 'inbox' };
/** The kinds a channel's account link may answer (#65): "I did it", a taste call and a choice, each that ask alone. */
const ANSWER_ALONE = new Set(['unblock', 'taste', 'choice']);
const ANSWER_FIELDS = new Set(['option', 'words', 'image', 'plan_hash', 'token', 'steps']);
const SHA256 = /^[0-9a-f]{64}$/;
const PROVISIONAL_KINDS = new Set(['taste', 'choice']);
/** Kinds typed text can answer: questions that need no authority. An unblock closes only on its check. */
const TYPED_KINDS = new Set(['taste', 'choice', 'exception', 'definition']);
const CORE = { writer: 'core' } as const;
/** Writers that speak for an agent: none of them closes an ask. */
const isAgent = (writer: string): boolean => writer === 'hook' || writer.startsWith('mcp:');
/**
 * The events the core reads from the log at a time. A page lives until its last event is applied, and one the hub's
 * threads can't hold in their young generation is promoted whole: at 1,000 a month's log grew the heap by tens of MB
 * of garbage at each start.
 */
const PAGE = 100;
/** Time the hub didn't run, down or with the Mac asleep, moves deadlines once it is longer than this (#908). */
const AWAY = 10_000;
/** How many ended sessions' closed asks stay in memory; the record keeps them all. */
const ENDED_KEPT = 64;

const git = promisify(execFile);

/** One stop of a session's own turn, as agent.stop@4 and @5 record it (#85): the structure the core raises a task or a continue from. */
interface Stop { id: string; session: string; ts: number; pos: number; cause: string; owner: string; signature: string; resets: number | null; finished: boolean; who: Ask['who'] }
/** An automatic continue the core recorded: the stop it continued from, why, and when. */
interface Continued { stop: string; because: string; ts: number }

const CLOSING: Readonly<Record<string, string>> = {
  'ask.answered': 'answered', 'ask.defaulted': 'defaulted', 'ask.escalated': 'escalated', 'ask.cancelled': 'cancelled',
  'ask.superseded': 'superseded', 'ask.moot': 'moot',
};

class AsksCore implements Asks {
  private cursor = 0;
  /**
   * When the hub last ran before this core opened (#908): the newest event the core appended in the log, a stop's
   * hub.stopped included but not the one a start appends for a crash, which carries the start's time.
   */
  private logged: number | undefined;
  private opened = false;
  /** Since when the app has said macOS won't show its notifications (#994). */
  private notificationsOff: number | undefined;
  private readonly sessions = new Map<string, { thread: string; worktree: string; project: string | null; agent: string }>();
  /** The sessions whose verified end the core read, oldest first: past the newest ENDED_KEPT they leave memory (#824). */
  private readonly endOrder = new Set<string>();
  /** Each session's stops in log order, and every stop by ID (#85). */
  private readonly stops = new Map<string, Stop[]>();
  private readonly stopIds = new Map<string, Stop>();
  /** The stamp of the last prompt you typed in each session, and the continues the core recorded for it. */
  private readonly typedAt = new Map<string, number>();
  private readonly continued = new Map<string, Continued[]>();
  /** Each block's signature by the key its task is raised under, and the open task of each signature. */
  private readonly signatures = new Map<string, string>();
  private readonly blockTasks = new Map<string, Ask>();
  /** The stops a task covers, so a session's stop raises or joins one task once. */
  private readonly covered = new Set<string>();
  /** Sessions whose newest stop the core hasn't read yet, and block tasks closed on their check whose sessions resume. */
  private readonly fresh = new Set<string>();
  private readonly resumes = new Set<Ask>();
  private readonly asks = new Map<string, Ask>();
  /** Each thread's asks, open or closed, in log order. */
  private readonly threads = new Map<string, Ask[]>();
  /** Each session's newest attempt at each task, from its claims. */
  private readonly attempts = new Map<string, Map<string, number>>();
  /** Sessions a shared task's resume skips (#85): those you stopped (their SessionEnd), by its stamp; those whose attempt a newer one replaced; those whose task closed. */
  private readonly ended = new Map<string, number>();
  private readonly replaced = new Map<string, number>();
  private readonly done = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Sessions with a message you typed that the agent hasn't read yet. */
  private readonly unread = new Set<string>();
  /** Sessions whose turn is running: a tool call since their last stop. */
  private readonly running = new Set<string>();
  /** Sessions whose unread message you typed while a turn ran: a deep_ask of that turn hasn't read it (#84). */
  private readonly midTurn = new Set<string>();
  /** Settings read in this call, by worktree: each call reads the files once. */
  private readonly read = new Map<string, Obj>();
  /** Each block someone else owns, by handle, and the request drafted for it. */
  private readonly requested = new Map<string, string>();
  /** The decisions the record holds, by handle, and by the key they answer. */
  private readonly decisions = new Map<string, HeldDecision>();
  /** Whether a session left memory yet: until one has, memory holds all the record does, and nothing is read back. */
  private forgot = false;
  private readonly byKey = new Map<string, HeldDecision[]>();
  /** The decisions a near match is looked for among, by what must match for one (`nearOf`). */
  private readonly byNear = new Map<string, HeldDecision[]>();
  private readonly keys: DecisionKeys;
  private readonly gate: ResolverGate;
  private readonly showing: Showing;

  constructor(private readonly options: AsksOptions) {
    this.keys = new DecisionKeys({
      session: (session) => this.sessions.get(session), byKey: (key) => this.byKey.get(key) ?? [],
      byNear: (key) => this.byNear.get(key) ?? [], get plant() { return options.plant; },
    });
    this.gate = new ResolverGate({
      get plant() { return options.plant; }, decision: (handle) => this.decisions.get(handle),
      uncovered: (decision, ask) => this.keys.uncovered(decision, ask) ?? this.keys.unplacedWhy(ask),
      apply: async (ask, decision) => {
        const now = this.options.now();
        await this.options.record.append(asCore({ ...CORE, ...ask.who, session: ask.session }), { v: 1, id: ulid(now), kind: 'decision.applied', subject: ask.handle, ts: now, data: { decision, ask: ask.handle } });
        await this.sync();
      },
      hand: (ask, option, decision, budget) => this.hand(ask, option.id, null, false, option.decision, decision, null, budget ?? null),
    });
    this.showing = new Showing({
      ask: (handle) => this.asks.get(handle), open: () => this.open(), openIn: (thread) => this.openIn(thread),
      now: () => this.options.now(), settings: () => this.settingsFor(undefined),
      append: async (batch, groups, now) => {
        for (const group of groups) {
          await this.options.record.append({ ...CORE, ...group[0]!.who }, {
            v: 1, id: ulid(now), kind: 'ask.batched', ts: now,
            data: { batch, asks: group.map((a) => ({ ask: a.handle, plan_hash: a.plan?.hash ?? null })) },
          });
        }
        await this.sync();
      },
    });
  }

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
      const given = this.fill(connection.session, raised, now);
      // Every task that reaches you can be answered "the agent can do it" in one tap (#84), whatever raised it.
      const agented = isObj(given) && given.kind === 'unblock' && Array.isArray(given.options) && !(given.options as Obj[]).some((o) => o.id === 'agent') ? { ...given, options: [...given.options as Obj[], { id: 'agent', label: 'The agent can do it', decision: 'none' }] } : given;
      // An ask for `you` is for the person whose session raised it (#1337): the hub's owner on a one-person hub.
      const filled = isObj(agented) && agented.owner === 'you' && connection.actor !== 'you' ? { ...agented, owner: connection.actor } : agented;
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
        // A plan whose steps name targets is @2, placed below; one that names none stays @1.
        if (plan.steps.some((st) => isObj(st) && 'targets' in st)) proposed.targets = [];
        const v = 'targets' in proposed ? 2 : 1;
        const planned = validate(`plan.proposed@${v}`, { v, id: ulid(now), kind: 'plan.proposed', writer: 'core', actor: connection.actor, scope: connection.scope, ts: now, data: proposed });
        if (!planned.ok) throw new AskRefused(`plan.proposed@${v} refuses the plan at ${planned.issues[0]!.path}`, { field: `plan${planned.issues[0]!.path.replace(/^\/data/, '')}` });
      }
      // The same question asked again in its thread, showing the same thing, is one record.
      const thread = this.threadOf(connection.session);
      const same = this.openIn(thread).find((a) => a.data.kind === data.kind && normalize(a.data.question as string) === normalize(data.question as string)
        && sha256Hex(canonicalize(a.data.pinned_to!)) === sha256Hex(canonicalize(data.pinned_to!)) && (a.plan?.hash ?? null) === ((proposed?.hash as string | undefined) ?? null));
      if (same) {
        delete same.recheck;
        return { handle: same.handle, fresh: false };
      }
      // Where each target came from, read from the record for the ask's session, never from its raiser's words (#1098).
      if (proposed && 'targets' in proposed) proposed.targets = await this.place({ data, handle: `ask:${id}`, session: connection.session ?? '' } as Ask, plan!.steps) as unknown as JsonValue;
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
      if (proposed) await this.options.record.append(asCore(connection), { v: 'targets' in proposed ? 2 : 1, id: ulid(now), kind: 'plan.proposed', ts: now, data: proposed });
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
      // A channel's answer with an account link you made (#65) answers that ask alone: never with authority, never a decision.
      const via = TRUSTED[connection.writer] ?? (connection.writer === 'channel' ? 'channel' as const : undefined);
      if (via === undefined) throw new AskRefused(`an answer counts only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const v = via === 'channel' ? 5 : 4;
      if (!isObj(input)) throw new AskRefused('an answer is an object', { field: 'input' });
      // The decision comes from the option you chose, never from the request.
      if ('decision' in input) throw new AskRefused('an answer carries no decision: it comes from the option you chose', { field: 'decision' });
      for (const key of Object.keys(input)) if (!ANSWER_FIELDS.has(key)) throw new AskRefused(`an answer has no field ${key}`, { field: key });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      const { option, words, image, plan_hash: planHash, token, steps } = input;
      if (option !== undefined && typeof option !== 'string') throw new AskRefused('the option is an ID', { field: 'option' });
      if (words !== undefined && (typeof words !== 'string' || !words)) throw new AskRefused('words are text', { field: 'words' });
      if (image !== undefined && (typeof image !== 'string' || !SHA256.test(image))) throw new AskRefused('a screenshot is named by its SHA-256, in lower-case hex', { field: 'image' });
      if (option === undefined && words === undefined && image === undefined) throw new AskRefused('an answer chooses an option or says something', { field: 'option' });
      if (token !== undefined && (typeof token !== 'string' || !token)) throw new AskRefused('the click token is text', { field: 'token' });
      if (steps !== undefined && (!Array.isArray(steps) || !steps.every((i) => Number.isInteger(i) && (i as number) >= 0))) throw new AskRefused('steps are the indices of the batch to run', { field: 'steps' });
      const now = this.options.now();
      if (via === 'channel') {
        if (ask.closed) throw new AskRefused(`${ask.handle} closed as ${ask.closed.outcome}`, { ask: ask.handle, outcome: ask.closed.outcome });
        if (ANSWER_ALONE.has(ask.data.kind as string) === false) throw new AskRefused(`${ask.handle} is a ${String(ask.data.kind)} ask, which a channel's account link can't answer: it counts only on the trusted path`, { field: 'writer' });
        const picked = ask.options.find((o) => o.id === option);
        if (picked && picked.decision !== 'none') throw new AskRefused(`${ask.handle}'s ${picked.id} decides ${picked.decision}, which counts only on the trusted path`, { field: 'writer' });
        if (token !== undefined || steps !== undefined || planHash !== undefined) throw new AskRefused('a channel answer approves nothing', { field: 'token' });
      }
      if (ask.closed) {
        // A later answer to a closed ask is refused, and the refusal is recorded; nothing reaches the agent.
        const { outcome, at } = ask.closed;
        await this.options.record.append(asCore(connection), {
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
      // Approving part of a batch runs only those (#327): `steps` names, by index into the batch this ask showed in,
      // the asks whose plans run; each named one takes its own allow option, bound to its own plan. The rest stay open.
      const batch = steps === undefined ? [] : this.showing.members(ask.handle);
      if (steps !== undefined) {
        if (decision !== 'allow') throw new AskRefused('steps go with an approval', { field: 'steps' });
        if (!batch.length) throw new AskRefused(`${ask.handle} showed in no batch, so it has no steps`, { field: 'steps', ask: ask.handle });
        const indices = [...new Set(steps as number[])].sort((a, b) => a - b);
        const out = indices.find((i) => i >= batch.length);
        if (out !== undefined) throw new AskRefused(`the batch has ${batch.length} steps, not a step ${out}`, { field: 'steps' });
        if (!indices.some((i) => batch[i] === ask.handle)) throw new AskRefused(`${ask.handle} isn't among the steps it approves`, { field: 'steps', ask: ask.handle });
      }
      // Each member runs the plan it shows, the newest the core proposed for it (the card shows that one too).
      const others = steps === undefined ? [] : [...new Set(steps as number[])].sort((a, b) => a - b).map((i) => batch[i]!).filter((h) => h !== ask.handle).flatMap((h) => {
        const member = this.asks.get(bare(h));
        const allow = member?.options.find((o) => o.decision === 'allow');
        return member && !member.closed && allow ? [{ member, allow }] : [];
      });
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
        await this.options.record.append(asCore(connection), {
          v, id: ulid(now), kind: 'ask.answered', subject: a.handle, ts: now,
          data: { answer: o.id, plan_hash: null, decision: o.decision, via, verified: true, on: a.data.pinned_to!, token: null, words: null, image: null },
        });
        await this.sync();
        this.hand(a, o.id, null, false, o.decision);
        ask.receiptAlso.push(a.handle);
      }
      // The same question from other threads, shown through this card, takes the same option.
      const riders = chosen ? this.open().filter((a) => this.rides(a) === ask) : [];
      // An option you chose is saved as a decision for the ask's repo, or its session, whatever its words claim. A
      // block's task saves none: "I did it" answers this block, and the next one of its kind needs doing again (#85).
      // A card with a target only the agent read saves your answer for this ask only (#1098).
      const scope = chosen && via !== 'channel' && !ask.fold && !ask.block && !this.unplaced(ask).length ? this.scopeOf(ask) : null;
      await Promise.all([this.options.record.append(asCore(connection), {
        v, id: ulid(now), kind: 'ask.answered', subject: ask.handle, ts: now,
        data: {
          answer: option ?? (words as string | undefined) ?? (image as string), plan_hash: decision === 'allow' ? ask.plan?.hash ?? null : null, decision,
          via, verified: true, on: ask.data.pinned_to!, token: token ?? null, words: (words as string | undefined) ?? null, image: (image as string | undefined) ?? null,
        },
      }), scope === null ? undefined : this.saveAt(connection, ask, scope, chosen!.id)]); // one turn, so one durable commit holds both (#22)
      await this.sync();
      this.hand(ask, chosen?.id ?? null, (words as string | undefined) ?? null, false, decision, null, null, null, (image as string | undefined) ?? null);
      for (const rider of riders) {
        await this.options.record.append(asCore({ ...connection, ...rider.who }), {
          v, id: ulid(now), kind: 'ask.answered', subject: rider.handle, ts: now,
          data: { answer: chosen!.id, plan_hash: null, decision, via, verified: true, on: rider.data.pinned_to!, token: null, words: null, image: null },
        });
        await this.sync();
        this.hand(rider, chosen!.id, null, false, decision);
        ask.receiptAlso.push(rider.handle);
      }
      for (const { member, allow } of others) {
        await this.options.record.append(asCore({ ...connection, ...member.who }), {
          v, id: ulid(now), kind: 'ask.answered', subject: member.handle, ts: now,
          data: { answer: allow.id, plan_hash: member.plan?.hash ?? null, decision: allow.decision, via, verified: true, on: member.data.pinned_to!, token: token ?? null, words: null, image: null },
        });
        await this.sync();
        this.hand(member, allow.id, null, false, allow.decision);
        ask.receiptAlso.push(member.handle);
      }
      await this.settle();
      return scope === null ? null : String(ask.data.key);
    });
    if (saved !== null) await this.reconsult(saved);
  }

  away(from: number, to: number): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      await this.moveAway(from, to);
      await this.settle();
    });
  }

  notifications(off: boolean): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      const since = this.notificationsOff;
      this.notificationsOff = off ? since ?? this.options.now() : undefined;
      if (off || since === undefined) return;
      for (const ask of this.open()) if (!this.seenCard(ask)) await this.moveUnseen(ask, since);
      await this.sync();
      await this.settle();
    });
  }

  tick(): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      await this.settle();
    });
  }

  batchDue(): Promise<boolean> { return this.exclusive(async () => this.showing.batchDue(this.options.now())); }

  card(handle: string): Promise<Card> {
    return this.exclusive(async () => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      return this.cardOf(ask, true);
    });
  }

  needsYou(): Promise<Card[]> {
    return this.exclusive(async () => {
      await this.sync();
      // The same question from another thread shows through the older one's card.
      const shown = this.open().filter((a) => this.status(a) === 'shown' && !this.rides(a));
      return Promise.all(shown.map((a) => this.cardOf(a, true)));
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

  /** Later until `before` ms ahead of the ask's deadline, the earliest it could hide (#1462). */
  async laterBefore(connection: Connection, handle: string, before: number): Promise<void> {
    await this.sync();
    const ask = this.asks.get(bare(handle));
    if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
    return this.later(connection, handle, Math.max(0, this.dueBy(ask) - before));
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
      await this.options.record.append(asCore(connection), { v: 1, id: ulid(now), kind: 'ask.later', subject: ask.handle, ts: now, data: { until } });
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
      const deadline = now + ask.wait;
      await this.options.record.append(asCore({ ...connection, ...ask.who }), { v: 1, id: ulid(now), kind: 'default.undone', subject: ask.handle, ts: now, data: { deadline } });
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
        request: a.request ? { ...a.request } : null, decision: a.closed?.decision ?? null, missing: a.closed ? null : a.missing ?? null, words: [...a.words],
      }));
    });
  }

  stillFails(check: string, reasons: string[]): Promise<void> {
    return this.exclusive(async () => {
      await this.sync();
      for (const a of this.open()) if (a.data.kind === 'unblock' && a.data.proves === check) a.missing = { check, reasons: [...reasons], link: null };
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
      options: ask.options.map((o) => ({ ...o })), recommended: null, deadline: now + ask.wait, fallback: ask.data.fallback!,
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
        await this.options.record.append(asCore({ ...connection, ...ask.who }), {
          v: 3, id: ulid(now), kind: 'ask.answered', subject: ask.handle, ts: now,
          data: { answer: allow.id, plan_hash: ask.plan.hash, decision: 'allow', via, verified: true, on: ask.data.pinned_to!, token: input.token, steps: chosen },
        });
        await this.sync();
        this.hand(ask, allow.id, null, false, 'allow');
      }
      await this.settle();
    });
  }

  private batchSteps(batch: string): BatchCard['steps'] { return this.showing.batchSteps(batch); }

  registerResolver(name: string, resolver: Resolver): () => void {
    return this.gate.registerResolver(name, resolver);
  }

  async saveDecision(connection: Connection, handle: string, scope: DecisionScope): Promise<string> {
    const saved = await this.exclusive(async () => {
      await this.sync();
      if (TRUSTED[connection.writer] === undefined) throw new AskRefused(`a decision is saved only on the trusted path, not from ${connection.writer}`, { field: 'writer' });
      const ask = this.asks.get(bare(handle));
      if (!ask) throw new AskRefused(`${handle} is no ask`, { ask: handle });
      const answer = ask.closed?.outcome === 'answered' ? ask.closed.answer : undefined;
      if (answer === undefined || !ask.options.some((o) => o.id === answer)) throw new AskRefused(`${ask.handle} wasn't answered with an option, so there is no decision to save`, { ask: ask.handle });
      const unplaced = this.unplaced(ask);
      if (unplaced.length) throw new AskRefused(`${ask.handle} goes to ${unplaced.map((t) => t.ref).join(', ')}, which nothing you typed or approved names, so your answer holds for this ask only`, { field: 'scope', ask: ask.handle });
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
        await this.options.record.append(asCore(connection), { v: 2, id: ulid(now), kind: 'decision.overruled', subject: old, ts: now, data: { decision: old, at: scope } });
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
      const held = await this.heldOf(decision);
      if (!held) throw new AskRefused(`${decision} is no decision`, { field: 'decision', ask: ask.handle });
      if (held.state !== 'active') throw new AskRefused(`${decision} is ${held.state}, so it can't widen`, { field: 'decision', ask: ask.handle });
      if (held.key !== ask.data.key) throw new AskRefused(`${decision} answers another question than ${ask.handle}, so a wider scope wouldn't cover it`, { field: 'decision', ask: ask.handle });
      const lines = linesOf(ask.data.subject);
      if (needsPerson(ask.data).length || this.unplaced(ask).length || (held.bound !== null && lines !== null && lines > held.bound)) throw new AskRefused(`${decision} can't cover ${ask.handle} at any scope`, { field: 'decision', ask: ask.handle });
      const option = ask.options.find((o) => o.id === held.answer);
      if (!option) throw new AskRefused(`${ask.handle} has no option ${held.answer}`, { option: held.answer });
      const widened = await this.saveAt(connection, ask, 'all', held.answer, false);
      const now = this.options.now();
      await this.options.record.append(asCore({ ...connection, ...ask.who, session: ask.session }), { v: 1, id: ulid(now), kind: 'decision.applied', subject: ask.handle, ts: now, data: { decision: widened, ask: ask.handle } });
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
      const decision = await this.heldOf(handle);
      if (!decision) throw new AskRefused(`${handle} is no decision`, { field: 'decision' });
      if (decision.state === 'revoked') throw new AskRefused(`${handle} is already revoked or overruled`, { field: 'decision' });
      const now = this.options.now();
      await this.options.record.append(asCore(connection), { v: 1, id: ulid(now), kind: 'decision.revoked', subject: handle, ts: now, data: { decision: handle } });
      await this.sync();
    });
  }

  refusals(handle: string): Promise<Refusal[]> {
    return this.exclusive(async () => {
      await this.sync();
      return this.gate.refusals(handle);
    });
  }

  private repoOf(session: string | undefined): string | null { return this.keys.repoOf(session); }

  /**
   * Every resolver, outside the lock, then their answers under it. An answer counts only when it names a decision
   * that covers the ask (`uncovered`) and chooses that decision's option; anything else is refused, naming the
   * resolver and the decision. The answers that count are applied when they agree, citing the decision; when they
   * disagree nothing is applied, and the ask reaches you showing each. An ask closed meanwhile takes no answer.
   */
  private async consult(handle: string): Promise<void> {
    // With no resolver there is nothing to ask, and no card (its diff of the worktree) to build.
    if (!this.gate.size) return;
    const asked = await this.exclusive(async (): Promise<ResolverAsk | null> => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask || ask.closed) return null;
      const subject = isObj(ask.data.subject) ? (ask.data.subject as unknown as Subject) : null;
      return { ...(await this.cardOf(ask)), session: ask.session, key: String(ask.data.key), repo: this.repoOf(ask.session), subject };
    });
    if (!asked) return;
    const answers = await this.gate.collect(handle, asked);
    if (!answers.length) return;
    await this.exclusive(async () => {
      await this.sync();
      const ask = this.asks.get(bare(handle));
      if (!ask) return;
      await this.gate.accept(handle, ask, answers);
    });
  }

  judged(connection: Connection, handle: string, judged: { rule: Tally; yours: Tally; margin: number; judgment: Judgment }): Promise<RuleState> {
    return this.exclusive(async () => {
      await this.sync();
      if (!JUDGES.has(connection.writer)) throw new AskRefused(`a standing rule is judged by resolver-decisions, not ${connection.writer}`, { field: 'writer' });
      const decision = await this.heldOf(handle);
      if (!decision) throw new AskRefused(`${handle} is no decision`, { field: 'decision' });
      const { rule, yours, margin, judgment } = judged;
      const next = VERDICT_STATE[judgment?.verdict];
      if (!next) throw new AskRefused('a judgment says widen, undecided or FAIL', { field: 'verdict' });
      // Revoked is final; a judgment that leaves the state as it is records nothing.
      if (decision.state === 'revoked' || decision.state === next) return decision.state;
      const now = this.options.now();
      await this.options.record.append(asCore(connection), {
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
    const as = asCore(connection);
    await Promise.all([{ v: 1, id, kind: 'decision.created', subject: ask.handle, ts: now, data: { key: String(ask.data.key), scope, answer, ask: ask.handle } }, ...contradicted.map((d) => ({ v: 2, id: ulid(now), kind: 'decision.overruled', subject: d.handle, ts: now, data: { decision: d.handle, at: scope } }))].map((event) => this.options.record.append(as, event))); // one turn, in this order: durable in one commit (#22)
    await this.sync();
    return `decision:${id}`;
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

  private status(ask: Ask): InboxStatus { return this.showing.status(ask); }
  private inFold(ask: Ask): boolean { return this.showing.inFold(ask); }
  private inSight(ask: Ask): boolean { return this.showing.inSight(ask); }
  private showNow(asks: Ask[]): Promise<boolean> { return this.showing.showNow(asks); }
  private show(): Promise<boolean> { return this.showing.show(); }
  private dueBy(ask: Ask): number { return this.showing.dueBy(ask); }

  /** The open asks in log order: asks enter the map only from apply, which reads the log in order. */
  private open(): Ask[] {
    return [...this.asks.values()].filter((a) => !a.closed);
  }
  /** The thread's open asks in log order. */
  private openIn(thread: string): Ask[] {
    return (this.threads.get(thread) ?? []).filter((a) => !a.closed);
  }

  private hand(ask: Ask, option: string | null, words: string | null, provisional: boolean, decision: Decision | null, because: string | null = null, undid: string | null = null, budget: BudgetLeft | null = null, image: string | null = null): void {
    const chosen = ask.options.find((o) => o.id === option);
    const recommended = ask.data.recommended as string | null;
    // A different answer undoes the option a provisional ask went on with, or the one an overruled decision gave.
    const undoes = undid ?? (!provisional && ask.data.provisional === true && option !== null && option !== recommended ? recommended : null);
    this.options.deliver({ ask: ask.handle, session: ask.session, option, decision: decision ?? chosen?.decision ?? 'none', words, image, provisional, undoes, because, budget });
  }

  private rides(ask: Ask): Ask | undefined { return this.showing.rides(ask); }
  private unplaced(ask: Ask): CardTarget[] { return this.keys.unplaced(ask); }
  /**
   * Places each target of a plan from the record of the ask's session (#1098): the prompts a person typed in it, the
   * decisions covering the ask and the plans they were saved from, the remotes its worktree configures, and its
   * archived transcript.
   */
  private async place(ask: Ask, steps: PlanStep[]): Promise<CardTarget[]> {
    for (const [n, st] of steps.entries()) {
      for (const t of st.targets ?? []) {
        if (!isObj(t) || !KINDS.has(t.kind) || typeof t.ref !== 'string' || !t.ref.trim()) throw new AskRefused(`step ${n}'s targets each name a kind (${[...KINDS].join(', ')}) and a ref`, { field: `plan/steps/${n}/targets` });
      }
    }
    const { session } = ask;
    const record = this.options.record;
    const prompts = session
      ? ((await record.raw(`SELECT json_extract(data, '$.text') AS text FROM events WHERE session_id = ? AND kind = 'user.ask' AND json_extract(data, '$.from') IN ('person', 'app')`, [session])) as { text: string }[]).map((r) => String(r.text))
      : [];
    const decisions: { handle: string; targets: Set<string> }[] = [];
    for (const d of this.covering(ask)) {
      let planned = this.asks.get(bare(d.ask))?.plan?.steps;
      if (!planned) {
        // The plan its answer bound: the newest the core proposed before it (#1580).
        const [row] = (await record.raw(`SELECT data FROM events WHERE kind = 'plan.proposed' AND writer = 'core' AND json_extract(data, '$.ask') = ? AND log_pos < COALESCE((SELECT MIN(log_pos) FROM events WHERE kind = 'ask.answered' AND subject = ?), 9007199254740991) ORDER BY log_pos DESC LIMIT 1`, [d.ask, d.ask])) as { data: string }[];
        planned = row ? (JSON.parse(row.data) as { steps: PlanStep[] }).steps : [];
      }
      decisions.push({ handle: d.handle, targets: targetsOf(planned) });
    }
    const transcript = (session ? await record.transcript(letters(session)) : undefined) ?? [];
    return place(steps, { session: letters(session), prompts, transcript, remotes: remotesOf(this.sessions.get(session)?.worktree), decisions }, this.options.plant);
  }

  private scopeOf(ask: Ask): string | null { return this.keys.scopeOf(ask); }
  private scopeCovers(scope: string, ask: Ask): boolean { return this.keys.scopeCovers(scope, ask); }
  private covering(ask: Ask): HeldDecision[] { return this.keys.covering(ask); }
  private suggest(ask: Ask): Card['suggested'] { return this.keys.suggest(ask); }

  /**
   * What the card shows. `presented` is a read through the card surface (`card`, `needsYou`): the first such read
   * fixes what the card says it saves; a resolver's read never presents it.
   */
  private async cardOf(ask: Ask, presented = false): Promise<Card> {
    if (presented && ask.saves === undefined && !ask.closed) {
      ask.saves = this.savesOf(ask);
      if (this.notificationsOff !== undefined) {
        await this.moveUnseen(ask, this.notificationsOff);
        await this.sync();
      }
    }
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
      missing: ask.missing && !ask.closed ? { ...ask.missing, reasons: [...ask.missing.reasons] } : null,
      saves: ask.saves ?? null,
      receipt: ask.closed?.outcome === 'answered' && ask.closed.answer !== undefined ? { answer: ask.closed.answer, also: [...ask.receiptAlso] } : null,
      targets: (ask.targets ?? []).map((t) => ({ ...t })),
    };
  }

  /** What an answer to the ask would be saved as, said as what answering will do (nothing is saved yet, #1455), and how many other open asks that decision would then answer. */
  private savesOf(ask: Ask): Card['saves'] {
    if (ask.fold || ask.theirs || !ask.options.length) return null;
    if (this.unplaced(ask).length) return { scope: 'Answering saves it for this ask only', also: 0 };
    const scope = this.scopeOf(ask);
    if (scope === null) return null;
    const project = this.sessions.get(ask.session)?.project;
    const words = scope.startsWith('repo:') && project ? `Answering saves it for this repo (${project})` : 'Answering saves it for this session';
    const also = this.open().filter((a) => a !== ask && !a.theirs && !a.fold && a.data.key === ask.data.key && this.scopeCovers(scope, a)).length;
    return { scope: words, also };
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

  /**
   * Past the newest ended sessions, each one with no ask open or undoable leaves memory: its asks, its attempts and
   * cursor, and the decisions only it could use. The record keeps them all: the session starting again reads its
   * decisions back (`rehydrate`), so it is never asked what it answered (invariant 4). One overruled at a scope stays,
   * since the record's table doesn't keep the scopes. Its stops and what was said of them (#85) go too.
   */
  private forgetEnded(): void {
    for (const session of [...this.endOrder].slice(0, Math.max(0, this.endOrder.size - ENDED_KEPT))) {
      // A thread with an ask open reads its sessions' attempts and exceptions, and its session's asks may be among them.
      if (this.openIn(this.threadOf(session)).length) continue;
      // A stop not read yet, or one a block task open or closing covers, is still to be acted on: its resume reads them.
      if (this.fresh.has(session) || [...this.blockTasks.values(), ...this.resumes].some((t) => t.block!.stops.has(session))) continue;
      const asks = [...this.asks.values()].filter((a) => a.session === session);
      // A default you can still undo keeps its session: the undo reads the ask.
      if (asks.some((a) => a.closed?.outcome === 'defaulted')) continue;
      for (const ask of asks) {
        this.asks.delete(ask.id);
        this.gate.forget(ask.handle);
        this.requested.delete(ask.handle);
        this.showing.forget(ask.handle);
        without(this.threads, ask.thread, ask);
      }
      for (const held of [...this.decisions.values()].filter((h) => h.scope === `session:${letters(session)}` && !h.overruled.size)) {
        this.decisions.delete(held.handle);
        without(this.byKey, held.key, held);
        if (held.subject) without(this.byNear, nearOf(held.kind, held.subject), held);
      }
      for (const stop of this.stops.get(session) ?? []) {
        this.stopIds.delete(stop.id);
        this.covered.delete(stop.id);
      }
      for (const kept of [this.stops, this.typedAt, this.continued, this.ended, this.replaced, this.done]) kept.delete(session);
      this.attempts.delete(session);
      this.unread.delete(session);
      this.running.delete(session);
      this.midTurn.delete(session);
      this.sessions.delete(session);
      this.endOrder.delete(session);
      this.forgot = true;
    }
  }

  /** Reads what the log gained since the last read. */
  private async sync(): Promise<void> {
    for (;;) {
      const page = await this.options.record.read({ after: this.cursor, limit: PAGE });
      for (const event of page) await this.apply(event);
      if (page.length) this.cursor = page[page.length - 1]!.log_pos;
      if (page.length < PAGE) return;
    }
  }

  /** An ask's data as it was raised, from the record: one that left memory (#824). */
  private async askData(handle: string): Promise<Obj | undefined> {
    if (!this.forgot) return undefined;
    const [row] = (await this.options.record.raw('SELECT data FROM events WHERE id = ? AND kind = ?', [bare(handle), 'ask.created'])) as { data: string }[];
    const data: unknown = row ? JSON.parse(row.data) : undefined;
    return isObj(data) ? data : undefined;
  }
  /** A decision you saved, held once with what its ask says it covers: its kind, its subject and its change's size. */
  private hold(base: Pick<HeldDecision, 'handle' | 'key' | 'scope' | 'answer' | 'ask' | 'state'>, from: Obj | undefined): HeldDecision {
    const known = this.decisions.get(base.handle);
    if (known) return known;
    const subject = from && isObj(from.subject) ? from.subject : null;
    const held: HeldDecision = { ...base, kind: String(from?.kind ?? ''), subject, bound: boundFor(linesOf(subject)), overruled: new Set() };
    this.decisions.set(held.handle, held);
    this.byKey.set(held.key, [...(this.byKey.get(held.key) ?? []), held]);
    if (subject) {
      const near = nearOf(held.kind, subject);
      this.byNear.set(near, [...(this.byNear.get(near) ?? []), held]);
    }
    return held;
  }
  /** A decision as the record's table has it, held from there: one that left memory with its session (#824). */
  private async readBack(row: { id: string; key: string; scope: string; answer: string; ask_id: string; state: string }): Promise<HeldDecision> {
    const ask = `ask:${row.ask_id}`;
    return this.hold({ handle: `decision:${row.id}`, key: row.key, scope: String(JSON.parse(row.scope)), answer: String(JSON.parse(row.answer)), ask, state: STATES.has(row.state) ? row.state as RuleState : 'active' }, await this.askData(ask));
  }
  /** A decision by its handle: held, or read back from the record for one that left memory; undefined for none. */
  private async heldOf(handle: string): Promise<HeldDecision | undefined> {
    const known = this.decisions.get(handle);
    if (known || !this.forgot) return known;
    const [row] = (await this.options.record.raw('SELECT id, key, scope, answer, ask_id, state FROM decisions WHERE id = ?', [handle.replace(/^decision:/, '')])) as { id: string; key: string; scope: string; answer: string; ask_id: string; state: string }[];
    return row ? this.readBack(row) : undefined;
  }
  /**
   * A session starting: the decisions saved at its scope before that, which left memory with it, come back from the
   * record (#824). Later ones arrive through the log, so a replay holds each once.
   */
  private async rehydrate(session: string, before: number): Promise<void> {
    if (!this.forgot) return;
    const rows = (await this.options.record.raw('SELECT d.id, d.key, d.scope, d.answer, d.ask_id, d.state FROM decisions d JOIN events e ON e.id = d.id WHERE d.scope = ? AND e.log_pos < ?', [JSON.stringify(`session:${letters(session)}`), before])) as { id: string; key: string; scope: string; answer: string; ask_id: string; state: string }[];
    for (const row of rows) if (!this.decisions.has(`decision:${row.id}`)) await this.readBack(row);
  }

  private async apply(e: Event): Promise<void> {
    const d: Obj = isObj(e.data) ? e.data : {};
    const target = e.subject?.startsWith('ask:') ? this.asks.get(bare(e.subject)) : undefined;
    // Only a running hub appends as the core; a crash's hub.stopped carries the time of the start that found it.
    if (e.writer === 'core' && !(e.kind === 'hub.stopped' && d.reason === 'crashed')) this.logged = Math.max(this.logged ?? e.ts, e.ts);
    switch (e.kind) {
      case 'session.start':
        // A session started in another's place in the same process (the session tree's lineage) replaced its attempt.
        if (typeof d.parent === 'string') for (const session of [d.parent, ...this.stops.keys()]) if (session === d.parent || letters(session) === letters(d.parent)) this.replaced.set(session, e.ts);
        // A session started again is back: its earlier end no longer says you stopped it.
        if (e.session) {
          this.ended.delete(e.session);
          this.endOrder.delete(e.session);
          this.sessions.set(e.session, { thread: String(d.thread), worktree: String(d.worktree), project: e.project ?? null, agent: String(d.agent ?? e.agent ?? '') });
          await this.rehydrate(e.session, e.log_pos);
        }
        return;
      case 'agent.stop': {
        for (const a of this.open()) if (a.session === e.session && a.recheck) a.pending.dropped = true;
        if (e.session) this.running.delete(e.session);
        // The hook's record of a stop: its cause from the closed set and, from the adapter's facts, who owns the block
        // and its signature. A stop without a signature is its own block, by cause.
        if (!e.session || e.writer !== 'hook') return;
        // A child session's stop (a subagent's, agent.stop@5 naming the child) is no turn end of the session: it
        // neither starts the continue count again nor makes the session's own newest stop stale.
        if (typeof d.child === 'string') return;
        const cause = String(d.cause);
        const stop: Stop = {
          id: e.id, session: e.session, ts: e.ts, pos: e.log_pos, cause, owner: typeof d.owner === 'string' ? d.owner : 'agent',
          signature: typeof d.signature === 'string' ? d.signature : cause, resets: typeof d.plan_resets === 'number' ? d.plan_resets : null,
          // A turn that ended normally is a Stop (outcome finished); one that ended on an API error is a StopFailure (failed).
          finished: d.outcome !== 'failed', who: { actor: e.actor, scope: e.scope },
        };
        this.stops.set(e.session, [...(this.stops.get(e.session) ?? []), stop]);
        this.stopIds.set(stop.id, stop);
        this.signatures.set(blockKey(stop.signature), stop.signature);
        this.fresh.add(e.session);
        return;
      }
      case 'session.continued':
        if (e.writer === 'core' && e.session) this.continued.set(e.session, [...(this.continued.get(e.session) ?? []), { stop: String(d.stop), because: String(d.because), ts: e.ts }]);
        return;
      case 'session.end':
        // A session you stopped (its SessionEnd, or the core's end for a Codex process that exited without one, #1023)
        // isn't resumed by a task closing: a continue would wake nobody.
        if ((e.writer === 'hook' || e.writer === 'core') && e.session) this.ended.set(e.session, e.ts);
        // Only a verified end counts toward forgetting: an unverified one ends nothing, as in the hub.
        if (e.session && !e.unverified) {
          this.endOrder.add(e.session);
          this.forgetEnded();
        }
        return;
      case 'task.closed': {
        // A task closed by a verdict: the session whose prompt opened it (task_ref session:<id>#<message>), and the
        // sessions whose attempts were at it, have nothing left to resume into.
        const subject = typeof e.subject === 'string' ? e.subject : '';
        const own = /^session:([0-9A-Za-z]+)#/.exec(subject)?.[1];
        if (own) for (const session of this.stops.keys()) if (letters(session) === own) this.done.set(session, e.ts);
        if (subject.startsWith('task:')) for (const [session, tasks] of this.attempts) if (tasks.has(subject)) this.done.set(session, e.ts);
        return;
      }
      case 'ask.created': {
        const thread = this.threadOf(e.session);
        const fold = e.writer === 'core' && d.key === foldKey(thread);
        const theirs = isTheirs(d, e.actor);
        // A stop's task (#85): raised by the core under its block's key, one open per signature. A later session's
        // joins the open one, superseded by it, so one task unblocks every session the block stopped.
        const signature = e.writer === 'core' && d.kind === 'unblock' ? this.signatures.get(String(d.key)) : undefined;
        const joins = signature === undefined ? undefined : this.blockTasks.get(signature);
        // A request the core drafted names its block as its subject and is keyed on the block's subject.
        const block = e.writer === 'core' && e.subject?.startsWith('ask:') ? this.asks.get(bare(e.subject)) : undefined;
        const request = block?.theirs && !this.requested.has(block.handle) && d.key === requestKey(block) ? { to: String(block.data.owner), block: block.handle } : undefined;
        const inThread = this.openIn(thread);
        const open = inThread.filter((a) => !a.fold);
        const holder = fold || theirs ? undefined : inThread.find((a) => a.fold && a.who.actor === e.actor && a.who.scope === e.scope);
        const ask: Ask = {
          id: e.id, handle: `ask:${e.id}`, data: d, options: d.options as Option[], session: e.session ?? '', who: { actor: e.actor, scope: e.scope }, thread, pos: e.log_pos,
          fold, ...(holder ? { folded: holder.handle } : {}), theirs, ...(request ? { request } : {}), words: [], receiptAlso: [], decided: new Set(), pending: {}, conflict: [],
          created: e.ts, wait: (d.deadline as number) - e.ts, due: d.deadline as number, since: e.ts, shown: false, unread: e.session !== undefined && this.unread.has(e.session), hubs: e.writer === 'core' && d.kind === 'exception',
          ...(signature === undefined ? {} : { block: { signature, stops: this.coveringStops(d) } }),
        };
        if (request) this.requested.set(request.block, ask.handle);
        if (ask.block) {
          for (const id of ask.block.stops.values()) this.covered.add(id);
          if (joins) ask.pending.superseded = joins.handle;
          else this.blockTasks.set(ask.block.signature, ask);
        }
        // A newer ask on the same subject in the same thread supersedes the older one, and keeps what it decided.
        for (const older of joins ? [] : open) {
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
        // The plan an ask shows is the newest the core proposed for it while it is open; your yes binds that one, and
        // a card showing an earlier one is refused at its hash (#1580). An agent's plan.proposed binds nothing.
        const ask = this.asks.get(bare(String(d.ask)));
        if (ask && !ask.closed && e.writer === 'core') {
          ask.plan = { hash: String(d.hash), steps: d.steps as unknown as PlanStep[] };
          if (Array.isArray(d.targets)) ask.targets = d.targets as unknown as CardTarget[];
          else delete ask.targets;
        }
        return;
      }
      case 'decision.created': {
        if (e.writer !== 'core') return;
        // What it covers comes from the ask it was saved from, read back when the ask left memory before its answer's decision landed.
        const kept = this.asks.get(bare(String(d.ask)));
        this.hold({ handle: `decision:${e.id}`, key: String(d.key), scope: String(d.scope), answer: String(d.answer), ask: String(d.ask), state: 'active' }, kept ? kept.data : await this.askData(String(d.ask)));
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
        if (e.kind === 'decision.applied') {
          const origin = this.asks.get(bare(this.decisions.get(String(d.decision))?.ask ?? ''));
          if (origin && origin !== ask) origin.receiptAlso.push(ask.handle);
        }
        ask.closed = {
          outcome: CLOSING[e.kind] ?? 'decided_for_you', at: e.ts, ...(typeof d.answer === 'string' ? { answer: d.answer } : {}),
          ...(e.kind === 'decision.applied' ? { decision: String(d.decision), answer: this.decisions.get(String(d.decision))?.answer ?? '' } : {}),
        };
        if (e.kind === 'ask.answered') {
          const steps = Array.isArray(d.steps) ? d.steps.filter((n): n is number => typeof n === 'number') : null;
          ask.approval = { hash: (d.plan_hash as string | null) ?? null, token: (d.token as string | null | undefined) ?? null, decision: String(d.decision), steps };
        }
        if (ask.block) {
          if (this.blockTasks.get(ask.block.signature) === ask) this.blockTasks.delete(ask.block.signature);
          // A session's task folded into the shared one: the shared task covers its stop from then on.
          const into = e.kind === 'ask.superseded' ? this.asks.get(bare(String(d.by))) : undefined;
          if (into?.block) for (const [session, id] of ask.block.stops) into.block.stops.set(session, id);
          // Closed on its check, or by your "I did it" (its done option; until the done gate re-runs the check on that
          // answer, #323, the next turn is the check: a block that holds stops the session again): its sessions
          // resume. "Leave it blocked" and a default leave them stopped, as the option says.
          if (e.kind === 'ask.moot' || (e.kind === 'ask.answered' && d.answer === 'done')) this.resumes.add(ask);
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
        target.due = d.deadline;
        if (target.block && !this.blockTasks.has(target.block.signature)) this.blockTasks.set(target.block.signature, target);
        return;
      case 'deadline.moved':
        // Later by the time the hub couldn't show it, or to its minimum notice once it showed (#908).
        if (!target || target.closed || e.writer !== 'core' || typeof d.deadline !== 'number') return;
        target.data = { ...target.data, deadline: d.deadline };
        if (d.because !== 'away') target.due = d.deadline;
        return;
      case 'ask.batched':
        this.showing.apply(e, d);
        return;
      case 'ask.later':
        // The core records your Later once later() has checked it against every deadline it could hide.
        if (target && !target.closed && e.writer === 'core' && target.who.actor === e.actor && target.who.scope === e.scope && typeof d.until === 'number' && d.until < this.dueBy(target)) target.later = d.until;
        return;
      case 'tool.before':
        if (e.session) this.running.add(e.session);
        // A deep_ask is what a turn that hadn't read your mid-turn message raises: it is no step that reads it.
        if (d.kind === 'mcp' && d.server === 'deep' && e.session && this.midTurn.has(e.session)) return;
        // The agent's next step reads what you typed: asks held for it wait like any other now, if they still stand.
        if (!e.session || !this.unread.delete(e.session)) return;
        this.midTurn.delete(e.session);
        for (const a of this.open()) if (a.session === e.session && a.unread) [a.unread, a.since, a.recheck] = [false, e.ts, true];
        return;
      case 'user.ask': {
        if (d.from === 'person' && e.session) {
          this.unread.add(e.session);
          if (this.running.has(e.session)) this.midTurn.add(e.session);
          this.typedAt.set(e.session, Math.max(this.typedAt.get(e.session) ?? -Infinity, e.ts));
        }
        if (d.from !== 'person' || typeof d.text !== 'string') return;
        const thread = this.threadOf(e.session);
        const open = this.openIn(thread);
        // Typed text never answers an authority ask: it shows beside it, for one tap on the card.
        for (const a of open) if (a.data.kind === 'authority' || a.hubs) a.words.push(d.text);
        // It answers only a question in sight: not one queued for a batch, put off with Later, or in a hidden exception.
        const question = open.filter((a) => TYPED_KINDS.has(a.data.kind as string) && !a.fold && !a.hubs && this.inSight(a)).at(-1);
        if (question && d.text && question.pending.typed === undefined) question.pending.typed = d.text;
        return;
      }
      case 'verdict.made': {
        const requirements = Array.isArray(d.requirements) ? d.requirements : [];
        if (!requirements.length) return;
        const checks = (outcome: string) => new Set(requirements.filter((r) => isObj(r) && r.outcome === outcome).map((r) => (r as Obj).check));
        const passed = d.outcome === 'PASS' ? checks('PASS') : new Set<JsonValue | undefined>();
        const failed = checks('FAIL');
        const reasons = Array.isArray(d.reasons) ? d.reasons.filter((r): r is string => typeof r === 'string') : [];
        for (const a of this.open()) {
          if (a.data.kind !== 'unblock') continue;
          if (passed.has(a.data.proves!)) a.pending.moot ??= { because: 'check_passed', verdict: String(d.verdict) };
          // Its check ran and still fails: the task stays open, its card saying what's missing (#85).
          else if (failed.has(a.data.proves!)) a.missing = { check: String(a.data.proves), reasons, link: chatThread(a.data)?.link ?? null };
        }
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
          this.replaced.set(session, e.ts);
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
    // The core's first call: the hub was down from the last time it appended until now.
    if (!this.opened) {
      this.opened = true;
      if (this.logged !== undefined) await this.moveAway(this.logged, this.options.now());
    }
    // Each open chat-app task's thread, read once a call through the connector.
    await this.readThreads();
    this.readNetwork();
    for (let acted = true; acted;) {
      // A block someone else owns gets its request drafted first, so the request shows when the block is raised.
      acted = false;
      for (const block of this.open()) {
        if (!block.theirs || this.requested.has(block.handle)) continue;
        await this.draftRequest(block);
        acted = true;
      }
      // What the sessions' stops call for: a task, its sessions' resumes, an automatic continue (#85).
      if (await this.stopsSettled(this.options.now())) acted = true;
      // What shows comes first, so no ask takes its default before it has shown.
      if (await this.show()) acted = true;
      if (await this.giveNotice()) acted = true;
      const now = this.options.now();
      for (const ask of this.open()) {
        const as = { ...CORE, ...ask.who, ...(ask.session ? { session: ask.session } : {}) };
        const base = { v: 1, id: ulid(now), subject: ask.handle, ts: now };
        if (ask.pending.superseded) {
          await this.options.record.append(as, { ...base, kind: 'ask.superseded', data: { by: ask.pending.superseded } });
        } else if (ask.pending.moot) {
          await this.options.record.append(as, { ...base, v: MOOT_V2.has(String(ask.pending.moot.because)) ? 2 : 1, kind: 'ask.moot', data: ask.pending.moot });
        } else if (ask.pending.dropped) {
          // The agent read your message and ended its turn without raising this again: it no longer stands (#84).
          await this.options.record.append(as, { ...base, kind: 'ask.cancelled', data: { answer: ask.data.default as string, plan_hash: null, decision: 'none' } });
        } else if (ask.pending.typed !== undefined) {
          // Typed in the session: the answer to that question only, unverified, never a decision.
          await this.options.record.append(as, {
            ...base, v: 4, kind: 'ask.answered',
            data: { answer: ask.pending.typed, plan_hash: null, decision: 'none', via: 'session', verified: false, on: ask.data.pinned_to!, token: null, words: ask.pending.typed, image: null },
          });
        } else if (ask.fold && !this.openIn(ask.thread).some((a) => a.folded === ask.handle)) {
          // An exception that holds no open ask has nothing left to ask, as when the ask it was raised for never landed.
          await this.options.record.append(as, { ...base, kind: 'ask.cancelled', data: { answer: ask.data.default as string, plan_hash: null, decision: 'none' } });
        } else if (await this.reoffer(ask, as, now)) {
          // Offered again on the new commit: the new ask supersedes this one.
        } else if (now >= (ask.data.deadline as number) && (seen.has(ask.handle) || ask.theirs) && (this.notificationsOff === undefined || this.seenCard(ask))) {
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

  // ---- Deadlines count only time an ask could be seen (#908).

  /**
   * Time the hub didn't run, down or with the Mac asleep, while an ask was open and hadn't shown moves its deadline
   * later by the part of that time before its deadline as it stood: the time it lost. Recorded on the ask with its span,
   * and never past its kind's wait counted from `to`, the soonest it shows, so it still ends.
   */
  private async moveAway(from: number, to: number): Promise<void> {
    if (to - from <= AWAY) return;
    const now = this.options.now();
    for (const ask of this.open()) {
      const moved = this.movedPast(ask, from, to);
      if (ask.shown || ask.theirs || moved <= (ask.data.deadline as number)) continue;
      await this.moveDeadline(ask, moved, 'away', now);
    }
    await this.sync();
  }

  /** Its deadline with the part of `from` to `to` before it given back, never past its kind's wait counted from `to`. */
  private movedPast(ask: Ask, from: number, to: number): number {
    const deadline = ask.data.deadline as number;
    return Math.min(deadline + Math.min(to, deadline) - Math.max(from, ask.created), to + this.waitFor(ask));
  }

  /** Whether you've seen the ask's card, or it was never yours to see: notifications off holds nothing back from it. */
  private seenCard(ask: Ask): boolean {
    return ask.saves !== undefined || ask.theirs;
  }

  /** The time since `from`, with notifications off and the ask unseen, didn't count against its deadline (#994). */
  private async moveUnseen(ask: Ask, from: number): Promise<void> {
    const now = this.options.now();
    const moved = this.movedPast(ask, from, now);
    if (moved > (ask.data.deadline as number)) await this.moveDeadline(ask, moved, 'away', now);
  }

  /**
   * An ask that first showed with less than its kind's minimum notice left takes its default no sooner than that notice
   * after it showed, and never past its kind's wait counted again from then, so it still ends. None declared, none applies.
   */
  private async giveNotice(): Promise<boolean> {
    let acted = false;
    for (const ask of this.open()) {
      if (ask.firstShown === undefined) continue;
      const { notice } = this.settingsFor(ask.session);
      const due = ask.firstShown + Math.min(duration(isObj(notice) ? notice[String(ask.data.kind)] : undefined) ?? 0, this.waitFor(ask));
      if (due <= (ask.data.deadline as number)) continue;
      await this.moveDeadline(ask, due, 'notice', this.options.now());
      acted = true;
    }
    if (acted) await this.sync();
    return acted;
  }

  /** Its kind's wait as set now, or the one it was raised with. */
  private waitFor(ask: Ask): number {
    const { deadline: wait } = this.settingsFor(ask.session);
    return duration(isObj(wait) ? wait[String(ask.data.kind)] : undefined) ?? ask.wait;
  }

  private async moveDeadline(ask: Ask, deadline: number, because: 'away' | 'notice', now: number): Promise<void> {
    await this.options.record.append({ ...CORE, ...ask.who, ...(ask.session ? { session: ask.session } : {}) }, {
      v: 1, id: ulid(now), kind: 'deadline.moved', subject: ask.handle, ts: now, data: { span: deadline - (ask.data.deadline as number), deadline, because },
    });
  }

  // ---- Stops (#85): a block's task, its sessions' resumes, and the one automatic continue.

  /** A session's newest stop, by deep-hook's stamp (then by log order), or none. */
  private newest(session: string): Stop | undefined {
    let top: Stop | undefined;
    for (const stop of this.stops.get(session) ?? []) if (!top || stop.ts > top.ts || (stop.ts === top.ts && stop.pos > top.pos)) top = stop;
    return top;
  }
  /** The stop a task covers in each session it unblocks: that session's newest when the task was raised. */
  private coveringStops(data: Obj): Map<string, string> {
    const stops = new Map<string, string>();
    for (const handle of Array.isArray(data.unblocks) ? data.unblocks : []) {
      const session = typeof handle === 'string' && handle.startsWith('session:') ? handle.slice('session:'.length) : undefined;
      const stop = session === undefined ? undefined : this.newest(session) ?? this.newest([...this.stops.keys()].find((s) => letters(s) === session) ?? '');
      if (stop) stops.set(stop.session, stop.id);
    }
    return stops;
  }
  private wasContinued(stop: Stop): boolean {
    return (this.continued.get(stop.session) ?? []).some((c) => c.stop === stop.id);
  }
  /** Whether a prompt you typed reached the session after the stop: the session is yours again, not the core's to continue or task. */
  private typedAfter(stop: Stop): boolean {
    return (this.typedAt.get(stop.session) ?? -Infinity) > stop.ts;
  }
  /**
   * Whether the session already had its one automatic continue since its last turn that ended normally: a continue
   * from an earlier stop stamped after the session's newest finished stop before this one (a Stop, not a StopFailure),
   * after your last prompt, or after the last resume of a task that closed, whichever is latest; each starts the
   * count again. Counted per session, never per stop: a second transient stop right after a continue gets none.
   */
  private continuedSince(stop: Stop): boolean {
    const resumed = (this.continued.get(stop.session) ?? []).filter((c) => c.because === 'task_closed').map((c) => c.ts);
    const finished = (this.stops.get(stop.session) ?? []).filter((s) => s.finished && s.ts < stop.ts).map((s) => s.ts);
    const since = Math.max(this.typedAt.get(stop.session) ?? -Infinity, ...resumed, ...finished);
    return (this.continued.get(stop.session) ?? []).some((c) => {
      const earlier = c.because !== 'task_closed' ? this.stopIds.get(c.stop) : undefined;
      return earlier !== undefined && earlier.ts > since && earlier.ts < stop.ts;
    });
  }

  /**
   * What the sessions' stops call for: for a block only you can clear or a spent plan window, one task shared by every
   * session the same block stopped, and its sessions' resumes once it closed on its check; for a transient the service
   * owns or a context overflow, one automatic continue per turn you started, while the stop is the session's newest,
   * under 10 minutes old by its stamp when the core first sees it, with nothing typed since. A stop is read once; a
   * refusal, a block someone else owns, and any other cause get nothing: the session stays stopped with its cause on its row.
   */
  private async stopsSettled(now: number): Promise<boolean> {
    let acted = false;
    for (const session of [...this.fresh]) {
      this.fresh.delete(session);
      const stop = this.newest(session);
      if (!stop || this.wasContinued(stop) || this.typedAfter(stop)) continue;
      if (stop.owner === 'you' || stop.cause === 'plan_window_spent') {
        if (this.covered.has(stop.id)) continue;
        if (await this.raiseBlock(stop, now)) acted = true;
        else this.fresh.add(session); // BLOCKED on the settings: kept for the next tick the hub owes (a stop or verdict landing, an open ask).
      } else if ((TRANSIENT.has(stop.cause) || stop.cause === 'context_overflow') && (this.options.errorTurnHook ?? shippedErrorTurnHook)(this.sessions.get(session)?.agent ?? '')
        && now - stop.ts < CONTINUE_WINDOW && !this.continuedSince(stop)) {
        await this.continueFrom(stop, stop.cause === 'context_overflow' ? 'context_overflow' : 'transient', null, now);
        acted = true;
      }
    }
    // A spent window's task closes at its reset: the time is its check, and no check runs.
    for (const task of this.blockTasks.values()) {
      const resets = Math.max(...[...task.block!.stops.values()].map((id) => this.stopIds.get(id)?.resets ?? -Infinity));
      if (Number.isFinite(resets) && now >= resets && !task.pending.moot) task.pending.moot = { because: 'window_reset', at: resets };
    }
    // A task closed on its check: each session it unblocks resumes from the stop it covered, while that stop is still
    // the session's newest and nothing was typed since; a newer stop decides for itself. A session you stopped, one
    // whose attempt was replaced, and one whose task closed are skipped, and the record says why.
    for (const task of [...this.resumes]) {
      this.resumes.delete(task);
      for (const [session, id] of task.block!.stops) {
        const stop = this.newest(session);
        const why = !stop || stop.id !== id ? 'a newer stop of it decides for itself' : this.wasContinued(stop) ? 'it already continued from that stop' : this.typedAfter(stop) ? 'a message you typed reached it since'
          : (this.ended.get(session) ?? -Infinity) > stop.ts ? 'you stopped it after the stop' : (this.replaced.get(session) ?? -Infinity) > stop.ts ? 'a newer attempt replaced its attempt after the stop' : (this.done.get(session) ?? -Infinity) > stop.ts ? 'its task closed after the stop' : undefined;
        if (why) {
          if (stop) await this.skipped(stop, task.handle, why, now);
          continue;
        }
        await this.continueFrom(stop!, 'task_closed', task.handle, now);
        acted = true;
      }
    }
    return acted;
  }

  /**
   * The task for a stop's block, from ask.sources@1's stop.block row: keyed on the block's signature, pinned to it,
   * owned by the person it stopped, unblocking the session, proved by the block's check. With a task of the same block
   * open, the session's joins it (superseded by it as soon as it's recorded). The deadline comes from your settings, as
   * for any unblock; with none declared the task is BLOCKED (false, the stop kept for the next tick the hub owes) and
   * the session stays stopped with its cause on its row. A spent window's stop always carries its reset (agent.stop@4
   * requires plan_resets on that cause), so its task always has the time that closes it.
   */
  private async raiseBlock(stop: Stop, now: number): Promise<boolean> {
    const template = askSources().find((r) => r.source === BLOCK_SOURCE)!.fixture.ask as Obj;
    const { deadline: _deadline, ...rest } = template;
    const unfilled: Obj = {
      ...rest, ...blockText(stop), owner: stop.who.actor, key: blockKey(stop.signature), pinned_to: { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(stop.signature)) },
      unblocks: [`session:${letters(stop.session)}`], proves: `${stop.cause}@${stop.signature}`,
    };
    let data: Obj;
    try {
      data = this.fill(stop.session, unfilled, now) as Obj;
    } catch (error) {
      if (error instanceof AskRefused) return false;
      throw error;
    }
    const id = ulid(now);
    const checked = validate('ask.created@3', { v: 3, id, kind: 'ask.created', writer: 'core', actor: stop.who.actor, scope: stop.who.scope, ts: now, data });
    if (!checked.ok) throw new AskRefused(`ask.created@3 refuses the block's task at ${checked.issues[0]!.path}: ${checked.issues[0]!.remediation}`, { field: checked.issues[0]!.path, source: BLOCK_SOURCE });
    await this.options.record.append({ ...CORE, ...stop.who, session: stop.session }, { v: 3, id, kind: 'ask.created', ts: now, data });
    await this.sync();
    return true;
  }

  /** Why a shared task's resume skipped a session (#85), kept as the session's reading so its row says so. */
  private async skipped(stop: Stop, task: string, why: string, now: number): Promise<void> {
    await this.options.record.append({ ...CORE, ...stop.who, session: stop.session }, {
      v: 1, id: ulid(now), kind: 'session.reading', subject: `session:${letters(stop.session)}`, ts: now, data: { reading: `DeepBuild didn't resume this session when ${task} closed: ${why}.` },
    });
  }
  /** The continue the core starts in a stopped session: recorded first; the hub reads it and takes the route (#25). */
  private async continueFrom(stop: Stop, because: 'transient' | 'context_overflow' | 'task_closed', task: string | null, now: number): Promise<void> {
    await this.options.record.append({ ...CORE, ...stop.who, session: stop.session }, {
      v: 1, id: ulid(now), kind: 'session.continued', subject: `session:${letters(stop.session)}`, ts: now, data: { stop: stop.id, because, task },
    });
    await this.sync();
  }

  /** Each open network task's check: a failed try is what's missing; the first that succeeds closes the task. */
  private readNetwork(): void {
    const tasks = [...this.blockTasks.values()].filter((t) => [...t.block!.stops.values()].some((id) => this.stopIds.get(id)?.cause === 'timed_out'));
    const tried = tasks.length ? this.options.network?.read() : null;
    if (!tried) return;
    for (const task of tasks) {
      // A try from before the task says nothing of the block that raised it.
      if (tried.at < task.created) continue;
      if (tried.reached) task.pending.moot ??= { because: 'network_reached', host: tried.host };
      else task.missing = { check: String(task.data.proves), reasons: [`${tried.host} can't be reached yet`], link: null };
    }
  }

  /**
   * Each open chat-app task's thread, read through the read-only connector: a reply from someone other than you, after
   * your post, whose text contains what the task expects closes it; before you post nothing changes; after it, no reply
   * or a wrong one is what's missing, with the thread link. The core never posts.
   */
  private async readThreads(): Promise<void> {
    const threads = this.options.threads;
    if (!threads) return;
    for (const ask of this.open()) {
      const thread = chatThread(ask.data);
      if (!thread || ask.pending.moot) continue;
      const check = String(ask.data.proves);
      let messages: ThreadMessage[];
      try {
        messages = await threads.read(thread.link);
      } catch (error) {
        ask.missing = { check, reasons: [`the thread couldn't be read through the connector: ${(error as Error)?.message ?? String(error)}`], link: thread.link };
        continue;
      }
      const you = String(ask.data.owner);
      // Only your post since the task was raised: an old exchange in the thread never closes a new task.
      const posted = messages.findIndex((m) => m.from === you && m.at >= ask.created);
      if (posted < 0) { delete ask.missing; continue; }
      const replies = messages.slice(posted + 1).filter((m) => m.from !== you);
      if (replies.some((m) => typeof m.text === 'string' && m.text.includes(thread.expect))) {
        ask.pending.moot = { because: 'thread_replied', link: thread.link };
        continue;
      }
      const last = replies.at(-1);
      ask.missing = {
        check, link: thread.link,
        reasons: [last ? `the last reply in the thread, ${JSON.stringify(String(last.text).slice(0, 200))}, doesn't contain ${JSON.stringify(thread.expect)}` : 'no reply in the thread since your post'],
      };
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

const without = <T>(table: Map<string, T[]>, key: string, item: T): void => {
  const rest = (table.get(key) ?? []).filter((x) => x !== item);
  if (rest.length) table.set(key, rest);
  else table.delete(key);
};
/** A block someone else owns: an unblock task whose owner isn't the person it was raised for. */
const isTheirs = (data: Obj, actor: string): boolean => data.kind === 'unblock' && data.owner !== actor;

/** The thread a chat-app task's check reads, when the task names one. */
const chatThread = (data: Obj): { link: string; expect: string } | undefined => {
  const thread = data.thread;
  return isObj(thread) && typeof thread.link === 'string' && typeof thread.expect === 'string' ? { link: thread.link, expect: thread.expect } : undefined;
};
let adapters: AdapterRegistry | undefined;
/** The shipped adapters' `errorTurnHook` cap, when the caller passes no registry of its own; an agent no adapter knows has none. */
function shippedErrorTurnHook(agent: string): boolean {
  try {
    return (adapters ??= shipped()).get(ADAPTERS[agent] ?? agent).caps.errorTurnHook === true;
  } catch {
    return false;
  }
}
/** What a block's task says, by its cause: the words on the card. The task's identity is the block's structure, never these words. */
function blockText(stop: Stop): { question: string; steps: string[]; where: string; why: string } {
  const WORDS: Readonly<Record<string, [question: string, step: string, where: string]>> = {
    sign_in_required: ['Sign in again? The sign-in the sessions used was revoked.', 'Sign in again where the agent runs (Claude Code: /login)', 'your terminal'],
    token_refresh_failed: ["Sign in again? The sessions' token couldn't be refreshed.", 'Sign in again where the agent runs (Claude Code: /login)', 'your terminal'],
    rate_limited: ['Raise the spend limit the sessions ran into?', 'Raise the limit, or wait it out, at the service', 'the service account'],
    timed_out: ['Reconnect the network the sessions reach the service through?', 'Reconnect the network (a VPN, a proxy) the sessions need', 'your machine'],
    plan_window_spent: [`Wait for the plan window to reset${stop.resets === null ? '' : ` at ${new Date(stop.resets).toISOString()}`}?`, 'Nothing: the task closes by itself at the reset', 'nowhere'],
  };
  const [question, step, where] = WORDS[stop.cause] ?? [`Clear the block that stopped session ${stop.session} (${stop.cause})?`, `Clear the block (${stop.cause})`, 'outside DeepBuild'];
  const why = stop.cause === 'plan_window_spent'
    ? `session ${stop.session} stopped: its plan window is spent; the reset time is the check`
    : `session ${stop.session} stopped: ${stop.cause}, block ${stop.signature}, which only you can clear`;
  return { question, steps: [step, 'Its check passes, the task closes by itself, and every session it unblocks resumes'], where, why };
}

export async function openAsks(options: AsksOptions): Promise<Asks> {
  const core = new AsksCore(options);
  await core.tick();
  // Plain functions, so a caller can wrap one method and keep the rest.
  return {
    raise: core.raise.bind(core), answer: core.answer.bind(core), tick: core.tick.bind(core), away: core.away.bind(core), notifications: core.notifications.bind(core), batchDue: core.batchDue.bind(core), card: core.card.bind(core),
    needsYou: core.needsYou.bind(core), holds: core.holds.bind(core), authorized: core.authorized.bind(core),
    beforeStep: core.beforeStep.bind(core), batch: core.batch.bind(core), approveBatch: core.approveBatch.bind(core),
    later: core.later.bind(core), laterBefore: core.laterBefore.bind(core), undo: core.undo.bind(core), inbox: core.inbox.bind(core), stillFails: core.stillFails.bind(core),
    registerResolver: core.registerResolver.bind(core), saveDecision: core.saveDecision.bind(core), revokeDecision: core.revokeDecision.bind(core), refusals: core.refusals.bind(core),
    overrule: core.overrule.bind(core), widen: core.widen.bind(core), judged: core.judged.bind(core),
  };
}
