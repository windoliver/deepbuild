// @deepbuild/gate (#29): the core's gate runner. Which stops and calls make a claim, the floor every claim passes
// before any check runs (the validity gate, the definition's hash and whose checks count), head trust, the lanes and
// the queue on a virtual clock, and the real runs: a claim's snapshot and checkout, its checks under `cpu.slot`
// leases, an agent's heavy commands, and a timing check under load; and a claim's verdict from its command runs
// (#30). The core never imports an extension.
export { claimsFor } from './claims.js';
export type { ClaimIntake, ClaimSource, MadeClaim, OpenAsk } from './claims.js';
export { floor, lockDefinition, recomputeHash, validityGate } from './floor.js';
export type { DefinitionParts, Finding, FloorInput, FloorResult, Lock, SessionLog, SessionRun, ValidityInput } from './floor.js';
export { blanked, maskIn, segmentsOf, wordsOf } from './mask.js';
export { checkSource } from './own.js';
export type { ApprovedCheck } from './own.js';
export { headTrust, pushRecordKit, runPushRecordKit } from './head.js';
export type { HeadInput, HeadPlan, HeadResult, ProviderPush, PushKit, PushReading, PushRecordReader } from './head.js';
export { checkoutOf, executeClaim, runHeavy, runTiming, slot, snapshotOf, verdictMemory } from './exec.js';
export type { ExecCheck, Executed, ExecutedCheck, ExecuteOptions, HeavyOptions, HeavyResult, Load, TimedRun, VerdictMemory } from './exec.js';
export { claimVerdict } from './claim.js';
export type { ClaimedCheck, ClaimedRuns, ClaimRequirement, RecordedFailure, RecordedRun, VerdictPlant } from './claim.js';
export { attributeStack } from './stack.js';
export type { Served, StackRecords, Trees } from './stack.js';
export { DEFAULTS, simulate } from './scheduler.js';
export type {
  Agent, CheckDef, CheckOnClaim, ClaimRecord, Config, Delivery, Held, HeldRecord, LoopFacts, Needs, Origin, QueueEvent, RunContext, RunRecord,
  Scenario, SchedulerPlant, ScriptEvent, SessionScript, SortedAs, StackDef, StackStep, StopReply, Trace,
} from './scheduler.js';
