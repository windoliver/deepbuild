// Shared ask data and public types; leaf module so the core and its seams have no type-only back-edges.
import type { JsonValue } from '@deepbuild/contracts';
import type { CardTarget, Target } from './targets.js';

export type AskKind = 'authority' | 'unblock' | 'taste' | 'exception' | 'choice' | 'definition';
export type Decision = 'allow' | 'deny' | 'none';

/** A plan's step: what it does, what it changes, its undo (null when it has none) and its cost in USD. */
export interface PlanStep {
  does: string; changes: string[]; undo: string | null; public: boolean; cost: number;
  /** Every place the step goes to that leaves the machine (#1098): the core places where each came from. */
  targets?: Target[];
}
/** What the core marks a step with no undo, in the plan it records and shows (#69). */
export const CANT_UNDO = "can't undo";
/** A batch as its card shows it: every step of every plan in it, each with its switch as it starts. */
export interface BatchCard { batch: string; steps: { ask: string; step: number; does: string; undo: string; on: boolean }[] }
/** A budget you approved, and what's left in it, counting runs reserved and not yet charged. */
export interface BudgetLeft { budget: string; left_usd: number }
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
/** A resolver's read of an ask: the card less what it says it saves and its receipt, which a resolver never sees. */
export type ResolverAsk = Omit<Card, 'saves' | 'receipt'> & { session: string; key: string; repo: string | null; subject: Subject | null };
export type Resolver = (ask: ResolverAsk) => ResolverAnswer | undefined | Promise<ResolverAnswer | undefined>;
/** One refusal the core made of a resolver's answer. */
export interface Refusal { ask: string; resolver: string; decision: string | null; reason: string }
/**
 * The planted wrong cores the criteria name; tests only. decision-exists-only applies any answer naming a decision
 * that exists. #1098's: a target's origin from the agent's messages, every target of a step at its first one's
 * origin, a decision covering whatever its targets' origins, every remote read as the repo's, and a card with a
 * target only the agent read saving your answer as wide as any other.
 */
export type AsksPlant = 'decision-exists-only'
  | 'origin-from-agent-message' | 'first-recipient-origin' | 'rule-by-recipient-kind' | 'push-target-as-repo' | 'wider-scope-offered';

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
  /** On a task whose check ran and still fails: the check, what's missing (the verdict's reasons, or the thread check's), and the thread link on a chat-app task. null otherwise. */
  missing: Missing | null;
  /**
   * What the card says before it arms about an answer that will be saved as a decision: the decision's scope in words,
   * and how many other open asks it will also answer. Both are fixed when the card is first presented (read through
   * `card` or `needsYou`) and never change while it shows. null when no decision would be saved (#327).
   */
  saves: { scope: string; also: number } | null;
  /** The answered card's one-line receipt: your answer, and every other ask it closed, those decided for you included. null while open. */
  receipt: { answer: string; also: string[] } | null;
  /**
   * Every target of every step of the plan, in step order, with where it came from, placed by the core from the
   * record (#1098). [] for an ask whose plan names none.
   */
  targets: CardTarget[];
}
/** What a task's check still finds missing (#85). */
export interface Missing { check: string; reasons: string[]; link: string | null }

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

/** An ask's place in its life (ask.machine@1's states), as the inbox shows it. */
export type InboxStatus = 'queued' | 'shown' | 'later' | 'folded' | 'held' | 'closed';

export type Obj = { [key: string]: JsonValue };
export type Option = { id: string; label: string; decision: Decision };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const bare = (handle: string): string => handle.replace(/^ask:/, '');
/** A session or project ID as a scope names it: letters and digits only, as the hub's handles hold them. */
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');

export interface Ask {
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
  /** Its plan's targets, placed when it was raised (#1098). */
  targets?: CardTarget[];
  closed?: { outcome: string; at: number; answer?: string; decision?: string };
  /** Resolvers' answers that covered it and disagreed, when they were last asked. */
  conflict: Card['conflict'];
  /** The budget a resolver named for it that the core refused, when it was last asked. */
  budget?: BudgetLeft;
  /** Your answer: the plan it bound, its click, its decision, and the steps of the plan it approved (null: all of them). */
  approval?: { hash: string | null; token: string | null; decision: string; steps: number[] | null };
  words: string[];
  /** What its card said it saves, fixed when the card was first presented (#327). */
  saves?: Card['saves'];
  /** The other asks your answer closed: riders answered with it and asks the decision it saved then decided (#327). */
  receiptAlso: string[];
  /** For a provisional choice: the files its session edited while it went on with the recommended option. */
  decided: Set<string>;
  /** What the log calls for and the core hasn't appended yet. */
  pending: { superseded?: string; moot?: Obj; typed?: string; dropped?: boolean };
  created: number;
  /** How long it waits, as raised: its deadline then, less when it was raised. */
  wait: number;
  /** Its deadline as no time the hub didn't run moved it: what it shows at once by (#908). */
  due: number;
  /** Shown in Needs you, by a batch or at once. */
  shown: boolean;
  /** When it first showed. */
  firstShown?: number;
  /** Hidden by Later until then. */
  later?: number;
  /** Raised by a turn that hadn't read a message you typed: it waits until the agent has it, unless due first. */
  unread: boolean;
  /** An exception the hub raised, not the agent's question: what you type to the agent isn't its answer, and shows beside it. */
  hubs: boolean;
  /** Read since it was held: it stands only if the agent raises it again before its next stop (#84). */
  recheck?: boolean;
  /** Since when it waits for a batch: raised, or read by the agent when raised held for your message. */
  since: number;
  /** What its check still finds missing, when it ran and failed, or the thread it watches has no right reply yet. */
  missing?: Missing;
  /** A stop's task (#85): the block's signature, and the stop it covers in each session it unblocks. */
  block?: { signature: string; stops: Map<string, string> };
}

/**
 * A decision you saved: what it answers (its ask's key), where (its scope), with which option, and whether it still
 * holds; the kind and subject of the ask it was saved from, the size bound of that ask's change, and the scopes you
 * overruled it at.
 */
export interface HeldDecision {
  handle: string; key: string; scope: string; answer: string; ask: string; state: RuleState;
  kind: string; subject: Obj | null; bound: number | null; overruled: Set<string>;
}
