

import { type Delivery, type Resolver } from '@deepbuild/asks';

import { type Connection } from '@deepbuild/record';

import { type PromiseState } from './promises.js';
import { Answers, type Answer } from './answers.js';

import { type Draft, type HookMeta } from './wire.js';
import type { WatchCause } from './watch.js';
import type { CallContext, Routes, Note } from './session-types.js';

import { type Obj } from "./hub-shared.js";

import { type PaidKind } from '@deepbuild/gate';


import { type Reach } from './could-do.js';

import { type ClaimCheck, type DefinitionState, type RunKey, type StatePin } from './gate-runner.js';

import { type ClaimState } from './verdict-chat.js';

import type { ReviewOf } from './checks-port.js';
import type { CheckSpec } from '@deepbuild/conformance';
import { type StackWant } from './stacks.js';

import type { Live, Counter } from './session-types.js';

import { type Lesson } from './memory.js';

import { type Piece } from './context-fit.js';
import { type RuleFileBefore } from './rules.js';

import type { Session, Cursor } from './session-types.js';

import { UsageTail } from '@deepbuild/readings';

import { type StatusRow } from './status.js';
import { type Placed, type Row, type RunningJob } from './rows.js';

import { type IndexFill } from './search.js';

import type { Stamp } from './session-types.js';

import { type Evidence, type PutResult } from '@deepbuild/evidence';

import { type ChannelAsk } from './channels.js';

/** The delivery capabilities consumed by another hub domain. */
export interface AnswerDeliveryPort {
  switches: Map<string, string[]>;
  continuedPos: number;
  unknownSends: Map<string, Map<string, { label: string; pr: boolean; denied?: boolean; done?: boolean }>>;
  settling: Map<string, Set<() => void>>;
  routes: Map<string, Routes>;
  handed: Map<string, { session: string; at: number; timer: NodeJS.Timeout; via: 'wake' | 'next_prompt' | 'stop_hold'; hook?: string }>;
  unread: Map<string, string>;
  carried: Map<string, Note[]>;
  prompts: Set<string>;
  answers: Answers;
  binds: Map<string, string>;
  tokenBound: Set<string>;
  answerWaiting: Set<string>;
  typedAt: Map<string, number>;
  promises: Map<string, PromiseState & { timer?: NodeJS.Timeout | undefined; asked?: boolean; handed?: boolean }>;
  precheck: Resolver;
  askWaits: Map<string, string>;
  waiting: Map<string, Set<() => void>>;
  later(session: string, cwd: string, text: string): void;
  promised(meta: HookMeta): Promise<void>;
  promiseCarried(session: string, via: 'next_prompt' | 'stop_hold', prompt?: string): Promise<string | undefined>;
  promiseDueFor(session: string): boolean;
  restorePromises(): Promise<void>;
  appNotes(drafts: Draft[], session: string): void;
  noteText(notes: Note[]): string;
  note(params: Obj): Obj;
  routesOf(session: string, cwd?: string): Routes;
  track(meta: HookMeta): void;
  cap(): number;
  waitingFor(session: string, scope?: string): Promise<Answer[]>;
  outcome(ask: string, via: string, outcome: 'delivered' | 'stalled' | 'timed_out' | 'replaced' | 'waiting'): Promise<void>;
  deliver(rows: Answer[], via: 'next_prompt' | 'stop_hold', hook?: { session: string; id: string }): Promise<string | undefined>;
  heardBy(ask: string): Promise<void>;
  answered(delivery: Delivery): void;
  offer(session: string): void;
  continues(): Promise<void>;
  continueBlock(session: string, because: string, task: string | null, stop: string | undefined): Promise<string>;
  resent(meta: HookMeta): Promise<string | undefined>;
  unwoken(session: string, ask: string, prompt?: string): Promise<void>;
  replaced(session: string): Promise<void>;
  woken(session: string, token: string): Promise<boolean | undefined>;
  waitAnswer(params: Obj, context: CallContext): Promise<Obj>;
  placed(params: Obj, context: CallContext): Promise<Obj>;
  stopWaiting(context: CallContext): Obj;
  waiterGone(key: number): void;
  sendBack(params: Obj): Obj;
  permission(meta: HookMeta, until?: number, inPaseo?: boolean): Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }>;
  paseoOwner(meta: HookMeta): Promise<string | null>;
  paseoAppAnswer(meta: HookMeta): Promise<Obj>;
  offerBack(meta: HookMeta): Promise<void>;
  typedSaves(session: string): Promise<void>;
  openOffers(): Promise<Obj[]>;
  saveOffered(params: Obj, context: CallContext): Promise<Obj>;
  readonly releases: boolean;
}

/** The judging capabilities consumed by another hub domain. */
export interface StopJudgingPort {
  lastMessage: Map<string, string>;
  counters: Map<string, Counter>;
  lanes: Map<string, Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number; budgetCost?: string[]; changed?: boolean; findings: string[] }>>;
  claimRequirements: Map<string, Map<string, { id: string; text: string }>>;
  nudgeable: Set<string>;
  idleSent: Map<string, Set<string>>;
  completions: Map<string, number>;
  unresolvedTargets: Map<string, { req: string; reason: string }[]>;
  kindChecks: Map<string, Map<string, { spec: CheckSpec; of: ReviewOf }>>;
  verdictWrites: Map<string, Promise<void>>;
  closesGate(session: string, command: string): Promise<string | undefined>;
  priceOf(check: string, of?: 'prices' | 'costs'): number | null;
  priceLocked(d: { session: string; agent: string; task_ref: string; requirements: { id: string; check: string | null; paid?: PaidKind }[] }): Promise<void>;
  delivery(d: Delivery): void;
  stallGate(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | undefined>;
  lineStanding(session: string): Promise<string | undefined>;
  heldLine(session: string, line: string): Promise<string>;
  requirementsOf(session: string): Promise<{ id: string; text: string }[]>;
  smallestOf(claim: string): Promise<string | undefined>;
  provisionalCarried(session: string): Promise<string | undefined>;
  reachOfSession(session: string): Promise<Reach>;
  questionHolds(session: string): Promise<boolean>;
  prDelivery(judged: Live): Promise<string | null | undefined>;
  stillNeeded(meta: HookMeta, claim: string): Promise<void>;
  completion(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | null | undefined>;
  noWorkOnce(session: string, claim: string): Promise<boolean>;
  idleOrResumed(meta: HookMeta, judged: Live | undefined, sentBack: boolean): Promise<string | undefined>;
  backgroundCapped(session: string, checks: string[]): Promise<void>;
  laneOf(claim: string, until: number): Promise<{ fast: string[]; slow: string[]; readyAt: number; budgetCost?: string[]; changed?: boolean; sendBack?: string } | undefined>;
  sizedAt(claim: string, meta: HookMeta, deadline: number): Promise<string | undefined>;
  slowStop(meta: HookMeta, r: Routes, claim: string, held: number): Promise<string | undefined>;
  slowVerdicts(r: Routes): string | undefined;
  stopHold(meta: HookMeta, r: Routes, until: number): Promise<string | undefined>;
  claimed(session: string, claim: string): void;
  stateOf(claim: string): Promise<ClaimState | undefined>;
  judging(meta: HookMeta): Promise<Live | undefined>;
  turnTaskOf(session: string, live: Live): Promise<string>;
  watchEnded(session: string, id: string, why: string): Promise<void>;
  judgeEnded(session: string): Promise<void>;
  judgedAcrossRestart(): Promise<void>;
  judgedLine(live: Live): Promise<string>;
  landedLine(session: string): Promise<string | undefined>;
  openedPr(session: string, agent: string, url: string): Promise<void>;
  codexStop(meta: HookMeta, data: Obj, live: Live): Promise<void>;
  prOf(session: string | null): Promise<string | undefined>;
  testVerdict(params: Obj): Promise<Obj>;
  runClaim(r: { claim: string; session: string; task: string; commit: string; base: string; cwd: string; deliverables: string[]; requirements: { req: string; id: string; text: string; depth: string; oracle: string; on_base: 'fails' | 'passes'; check: string | null }[]; checks: (Pick<ClaimCheck, 'check' | 'approved' | 'on_base' | 'asserts' | 'req' | 'surface' | 'expected_ms' | 'deadline_ms' | 'references' | 'runs' | 'held_out' | 'timing'> & { command?: string; paid?: PaidKind })[]; definition: DefinitionState; joins?: boolean; state?: StatePin }): Promise<void>;
  projectTrusted(cwd: string): Promise<boolean>;
  buildProduct(b: { cwd: string; command: string }): Promise<{ code: number | null; tail: string }>;
  runEnded(run: string): Promise<string>;
  judged(claim: string): Promise<void>;
  runApproved(r: { claim: string; check: string; approved: string | null; command: string; commit: string; cwd: string; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline_ms?: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[]; references?: { path: string; sha256: string }[]; overlay?: Record<string, string>; key?: RunKey; stack?: StackWant }): Promise<string>;
  invalid(claim: string, commit: string, reason: string, outcome?: 'INVALID' | 'INCONCLUSIVE'): Promise<void>;
  stopRule(count: Counter): boolean;
  isAnswer(count: Counter): boolean;
  counterOf(session: string): Promise<Counter>;
  stopReply(meta: HookMeta, until: number, r: Routes, stepped: () => number): Promise<{ context?: string; block?: string; message?: string }>;
}

/** The memory capabilities consumed by another hub domain. */
export interface SessionMemoryPort {
  tasted: Map<string, Set<string>>;
  ruleState: Map<string, { given: Set<string>; full: boolean; editing: Map<string, RuleFileBefore[]> }>;
  firstPrompted: Set<string>;
  judgeRules(): Promise<void>;
  tasteAt(session: string, cwd: string, said: string, starting: boolean): Promise<string | undefined>;
  lessons(): Promise<Lesson[]>;
  ruleStateOf(session: string): void;
  startRules(meta: HookMeta): Promise<Piece[] | undefined>;
  promptRules(meta: HookMeta, prompt: string): Promise<Piece[] | undefined>;
  ruleHook(meta: HookMeta): Promise<void>;
  syncRules(): Promise<Obj>;
  removeRule(lesson: Lesson): Promise<Obj>;
  sessionRules(params: Obj): Promise<Obj>;
  memoryAct(params: Obj, context: CallContext): Promise<Obj>;
  syncStanding(): Promise<void>;
}

/** The transcripts capabilities consumed by another hub domain. */
export interface TranscriptsPort {
  cursors: Map<string, Cursor>;
  judge(session: Session): void;
  saveCursors(): void;
  writeCursors(): void;
  backfill(spec: Obj): Promise<number>;
}

/** The state capabilities consumed by another hub domain. */
export interface SessionStatePort {
  sessions: Map<string, Session>;
  live: Map<string, Live>;
  endedOrder: Set<string>;
  projects: Map<string, string>;
  sessionPeople: Map<string, string>;
  entered: Map<string, string>;
  tails: Map<string, UsageTail>;
  turnsStarted: Map<string, string>;
  acks: Map<string, { text: string; task: string | undefined }[]>;
  midTurn: Map<string, string[]>;
  onScreen: Map<string, string>;
  states: Map<string, string>;
  statesRead: boolean;
  stating: Promise<void> | undefined;
  touched: Set<string> | 'all';
  rows: Map<string, Placed>;
  rowsFirst: boolean;
  versioned: Set<string>;
  miscalled: Set<string>;
  readings: Set<string>;
  parentArgs(meta: HookMeta): Promise<string>;
  liveOf(meta: HookMeta): Live;
  follow(drafts: Draft[], meta: HookMeta, verified: boolean): void;
  attention(session: string, agent: string, state: string): Promise<void>;
  asksYou(session: string): Promise<boolean>;
  goneSessions(): Promise<void>;
  sessionOver(session: Session): void;
  archivedThreads(): Promise<void>;
  stateSoon(): void;
  seeRow(id: string): Promise<Obj>;
  statesSettled(): Promise<void>;
  recordStates(): Promise<void>;
  jobShown(job: RunningJob, running: boolean): void;
  jobRowAppend(id: string, row: Row | null): void;
  quietDue(): Promise<void>;
  threadOf(session: Session, source: string | undefined): Promise<string>;
  childOf(session: Session, agent: string): Promise<void>;
  whose(meta: HookMeta, seq: string | undefined): Promise<{ job?: string; wait?: string; reading?: { job: string; text: string } }>;
  park(job: string): Promise<void>;
  startOf(pid: number, fresh?: boolean): Promise<string | undefined>;
  verify(meta: HookMeta): Promise<boolean>;
  forgetEnded(): void;
  mcpHello(parent: { pid: number; start: string } | undefined, paseo?: string): Promise<string | null>;
  sessionRows(seen?: string): Promise<Record<string, unknown>[]>;
  rowsSeen(role: string, detail: boolean): Promise<Obj>;
  renameSession(params: Obj): Promise<Obj>;
  whySeen(role: string, params: Obj): Promise<Obj>;
  sessionWindow(params: Obj): void;
  statusSeen(role: string): Promise<StatusRow[]>;
  seenBy(role: string): string;
  agentAbove(peer: CallContext['peer']): Promise<string | undefined>;
  notAnAgent(context: CallContext, method: string): Promise<void>;
}

/** The mcp capabilities consumed by another hub domain. */
export interface McpOperationsPort {
  stamps: Stamp[];
  index: Promise<IndexFill | undefined>;
  mcpCall(params: Obj, context: CallContext): Promise<unknown>;
  agentConnection(session: string): Connection;
  checksOf(worktree: string): Map<string, { run: string; deadline?: unknown; type?: string; host?: string }>;
  pinOf(worktree: string, question: string): Promise<Obj>;
  propose(session: string, args: Obj): Promise<Obj>;
}

/** The control capabilities consumed by another hub domain. */
export interface HubControlPort {
  dispatch(method: string, params: Obj, context: CallContext): Promise<unknown>;
  notifierGone(): Promise<void>;
  health(): Promise<Obj>;
  hubId(): string;
  trusted(method: string, params: Obj, context: CallContext, what: string, handle: string, revision: string): Promise<void>;
  answer(params: Obj, context: CallContext, channel?: { channel: string; proof: 'device' | 'account_link'; plan_hash: string | null }): Promise<Obj>;
  onSwitchedTree(claim: string): Promise<string | undefined>;
  didIt(handle: string, session: string, data: Obj): Promise<void>;
  raiseTask(session: string, agent: string, ask: Obj): Promise<void>;
  channelAsks(): Promise<ChannelAsk[]>;
  panelKits(id: string, unrun?: boolean): Promise<string | undefined>;
  job(args: Obj, caller: string | undefined): Promise<Obj>;
  enteredProject(session: string, cwd: string): Promise<void>;
  leftProject(session: string): Promise<void>;
  keep(bytes: Uint8Array, source: string): Promise<string>;
  stored(put: PutResult, what: string): Promise<Evidence>;
  attach(session: string, args: Obj): Promise<Obj>;
  retain(): Promise<void>;
  forgeRepos(): Promise<string[]>;
}

/** The session-flag capabilities consumed by another hub domain (#2019). */
export interface SessionFlagsPort {
  unpushed(session: string, agent: string): Promise<void>;
  watchOnly(session: string | undefined, agent: string, cause: WatchCause, on: boolean, version?: string): Promise<void>;
  modelCalled(session: Session): (line: Obj) => Promise<void>;
}
