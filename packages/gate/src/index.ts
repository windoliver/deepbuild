// @deepbuild/gate (#29): the core's gate runner. Which stops and calls make a claim, the floor every claim passes
// before any check runs (the validity gate, the definition's hash and whose checks count), head trust, the lanes and
// the queue on a virtual clock, and the real runs: a claim's snapshot and checkout, its checks under `cpu.slot`
// leases, an agent's heavy commands, and a timing check under load; a claim's verdict from its command runs
// (#30); and a definition's price and the stalled-claim rule (#325). The core never imports an extension.
export { claimsFor } from './claims.js';
export type { ClaimIntake, ClaimSource, MadeClaim, OpenAsk } from './claims.js';
export { floor, lockDefinition, recomputeHash, validityGate } from './floor.js';
export type { DefinitionParts, Finding, FloorInput, FloorResult, Lock, SessionLog, SessionRun, ValidityInput } from './floor.js';
export { blanked, maskIn, segmentsOf, wordsOf } from './mask.js';
export { checkSource, ownChanges, ownRead, runnerConfig, type ChangesPlant } from './own.js';
export type { ApprovedCheck } from './own.js';
export { headTrust, pushRecordKit, runPushRecordKit } from './head.js';
export type { HeadInput, HeadPlan, HeadResult, ProviderPush, PushKit, PushReading, PushRecordReader } from './head.js';
export { executeClaim, runHeavy, runTiming, slot, verdictMemory } from './exec.js';
export type { ExecCheck, Executed, ExecutedCheck, ExecuteOptions, HeavyOptions, HeavyResult, Load, TimedRun, VerdictMemory } from './exec.js';
export { baseProof, openCheckouts, OverBudget } from './checkouts.js';
export type { BaseCheckout, BaseRun, Budget, CheckoutPlant, Checkouts, CheckoutsOptions, ClaimCheckInput, ClaimCheckRun, ClaimInput, ClaimRun, Cited, DeclaredSurface, Snapshot, StandIn, TempCheckout } from './checkouts.js';
export { claimVerdict, JUDGE_FAULTS } from './claim.js';
export { admitKind } from './kinds.js';
export { priceDefinition } from './price.js';
export type { PaidKind, Pricing } from './price.js';
export { freshCount, judgeStop } from './stalls.js';
export type { StallCount, StallRule } from './stalls.js';
export type { ClaimedCheck, ClaimedRuns, ClaimRequirement, JudgeFault, RecordedFailure, RecordedRun, VerdictPlant } from './claim.js';
export { addedLines, endsEmpty, errorShape, leftOpen, limitsIn, openTasks, placeholders, solveLine, toldToRun, unitless } from './open.js';
export type { LeftOpen, TaskListFacts } from './open.js';
export { attributeStack, environmentFindings } from './stack.js';
export type { RunFacts, Served, StackRecords, Trees } from './stack.js';
export { DEFAULTS, simulate } from './scheduler.js';
export type {
  Agent, CheckDef, CheckOnClaim, ClaimRecord, Config, Delivery, Held, HeldRecord, LoopFacts, Needs, Origin, QueueEvent, RunContext, RunRecord,
  Scenario, SchedulerPlant, ScriptEvent, SessionScript, SortedAs, StackDef, StackStep, StopReply, Trace,
} from './scheduler.js';
export { diffOf, itemChanges, LAST, measure, over, OVER, usualOf } from './size.js';
export type { ItemChange, Usual } from './size.js';
export { gitEnv } from './env.js';
