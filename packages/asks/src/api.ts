// The asks core's interface (#318): what it answers, what it is opened with, and what it hands an agent's adapter.
import type { JsonValue } from '@deepbuild/contracts';
import type { Connection, RecordStore } from '@deepbuild/record';
import type { AskKind, AsksPlant, BatchCard, BudgetLeft, Card, Decision, InboxStatus, Missing, PlanStep, Refusal, Resolver, RuleState } from './model.js';

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
   * A sign-in task's check (#1349), once per tick for each agent with one open: the agent's probe, with when it started,
   * when one has finished since the last call for that agent, and null otherwise. `signedIn` is null when the probe
   * couldn't run; `account` is the account the agent records then. Left out, a sign-in task closes as any block's.
   */
  signIn?: { read(agent: string): { signedIn: boolean | null; account: string | null; at: number } | null };
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
  /** When it closed, in ms, by the event that closed it; null while open. */
  closed_at: number | null;
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
  /** The exception "this session keeps asking" that holds it, while it shows only there (#667); null otherwise. */
  folded: string | null;
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
  /**
   * Undo, on the trusted path: a defaulted ask opens again, waiting as long as it first did; inside a hold (#1101), each
   * step your yes on its card holds is withdrawn, never starts, and its ask is open again.
   */
  undo(connection: Connection, ask: string): Promise<void>;
  /** Whether Undo on the ask's card would withdraw a step the hub still holds (#1101). */
  holding(ask: string): Promise<boolean>;
  /** Whether the ask's own step is held: you said yes, and its hold isn't over (#1101). */
  stepHeld(ask: string): Promise<boolean>;
  /** When the next held step starts, or null with none (#1101): the hub ticks the core then. */
  heldUntil(): number | null;
  /** Every ask in the record, open or closed, with its status, owner and age. */
  inbox(): Promise<InboxRow[]>;
  /** A task's check, run again on your "I did it", still fails (#323): each open task it proves says what's missing. */
  stillFails(check: string, reasons: string[]): Promise<void>;
  /**
   * The agent's one sign-in task (#1349), for work that needs the agent while its probe reads not signed in: the one
   * open, which every session, job and folder stopped on that agent's sign-in shares, or a new one the core raises,
   * unblocking `unblocks`. Its handle.
   */
  signIn(connection: Connection, agent: string, unblocks: string): Promise<string>;
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
