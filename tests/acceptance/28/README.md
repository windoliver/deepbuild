# Acceptance tests for #28: the verdict engine

Written first, from issue #28 (its text as of 2026-10-21: Scope, Fields, the 33 acceptance criteria, "Added Oct
9" and "Done when"), the design sections it links and those around them (How runs become one of five verdicts,
with every bullet from One table, one reference to Known failures are waivers; Evidence, for retention; What
done means, fixed at the start, and An agent says it's done, for inheritance per test, never-started checks and
Latest snapshot wins; the primitives Check, Verdict, Claim, Definition of done and Event; Rules every primitive
follows; One event log, for the `verdicts`, `claims` and `runs` projections and the core-only `verdict.made` and
`verdict.stale`; How we know version 0 works and the reference Macs, all in `docs/technical-design.md`; and
Requirement outcome in `docs/canvas-primitives.md`) and base commit `a8f844f`, by a job that never saw an
implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

Run them with the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci                                    # once, if node_modules is missing
npx vitest run --root tests/acceptance/28
node node_modules/typescript/bin/tsc -p tests/acceptance/28/tsconfig.json
```

With `--root` here, Vitest writes its cache to `tests/acceptance/28/.vite/`; delete it before committing. The
property tests run 1,000 cases each (10,000 for the reference agreement) from the seeds recorded in each test;
`AC28_SEED=<n>` replaces the agreement test's seed to replay a failure, and the failing case is printed by its
seed and claim. The budget test (AC22) runs only on a reference Mac on mains power, as #14's do, and otherwise
skips as INCONCLUSIVE; it never passes by skipping.

## The surface under test

The issue names behaviors and two record shapes (Verdict, Requirement outcome) but no code API, so these tests
define the smallest one they need: the public entry of a new workspace package, `@deepbuild/verdicts`, at
`packages/verdicts/src/index.ts`, imported with its `.ts` extension. The engine is pure: every input it reads,
the time included, is an argument. The tests import nothing else from it; they also use the public entries of
`@deepbuild/record` (`openRecord`, `RecordStore`) and `@deepbuild/contracts` (`validate`), as they ship at base.

```ts
import type { RecordStore } from '@deepbuild/record';

/** The five verdicts, plus pending. Precedence, highest first: FAIL > INVALID > BLOCKED > INCONCLUSIVE > pending > PASS. */
export type Outcome = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
export type Result = Outcome | 'pending';
/** How a run ended: the closed set. */
export type RunOutcome = 'passed' | 'failed' | 'ran_nothing' | 'missing' | 'overran' | 'stopped' | 'uncounted';
/** Proof depth, shallowest first; a deeper check satisfies a shallower requirement, never the reverse. */
export type Depth = 'unit' | 'integration' | 'journey' | 'live';
export type Oracle = 'code' | 'model' | 'person';
export type Proof = 'statement' | 'static_check' | 'test_run' | 'journey' | 'decision';
/** Whose check it is: the approved spec, the locked definition of done, a proposal someone other than the
 *  claimant approved, or the agent's own (which can send a claim back but never pass it). */
export type Source = 'spec' | 'definition' | 'approved' | 'own';
export type Precision = 'fp16' | 'fp32' | 'fp64';

/** One requirement of the claim's definition of done. */
export interface Requirement {
  req: string;                         // req:<definition>#R<n>
  depth: Depth;                        // the depth of proof it needs
  oracle: Oracle;                      // code: judged by its checks; person: by your answer on `ask`
  on_base: 'fails' | 'passes';         // fails: new or fixed behavior (its checks are fix checks); passes: must not change
  numbers?: boolean;                   // about computed numbers: covered only by a check with a contract
  ask?: string;                        // oracle person: the ask (ask:<id>) that holds your answer
  answer?: 'PASS' | 'FAIL' | 'unanswered';   // oracle person: absent while the ask is open; unanswered once it ended so
}

/** How a check ran on the merge base. */
export interface BaseResult {
  outcome: 'passed' | 'failed';
  on_assertion: boolean;               // at least one test failed there on an assertion its check names
  failed_tests: string[];              // the test IDs that failed there, e.g. 'cart.test.ts › rounds tax'
}

/** A check selected for the claim, with the key its runs must match to count. */
export interface ClaimCheck {
  check: string;                       // its ID, e.g. 'unit' or 'journey:checkout'
  digest: string;                      // the check definition's digest, d1:<sha256>
  source: Source;
  depth: Depth;
  proof: Proof;                        // what its result is shown as on a receipt
  covers: string[];                    // the requirement handles it covers (empty for a spec check that covers none)
  inputs?: string[];                   // declared input globs ('src/**'); absent or empty: the whole commit
  runs?: number;                       // declared clean runs needed
  accept?: string;                     // the failure rate accepted, a decimal with its unit '%', e.g. '10%'
  deadline?: string;                   // its deadline as its definition writes it, e.g. '90 s'
  cant_fail?: string;                  // why it can't fail, e.g. 'exit status masked by `|| true`'
  contract?: NumericContract;
  base?: BaseResult;
  environment: Record<string, string>; // the environment profile (browser build, viewport, locale, time zone, …)
  tools: Record<string, string>;       // tool versions, e.g. { node: '22.11.0' }
  state?: 'running' | 'ended' | 'never_started';   // absent: running while moreRuns(...) > 0, else ended
  never_started?: 'quick_check_failed' | 'kept_working' | 'loop' | 'newer_claim';   // with state never_started
}

export interface Frame { file: string; line: number }
/** One failed test of a run, read from the tool's report. */
export interface Failure {
  test: string;                        // its test ID
  message: string;                     // the error text
  cause: string;                       // the change it traces to (worked out before the engine runs)
  frames: Frame[];                     // every stack frame, innermost first
  covers: string[];                    // the code the failing test covers
  case: string | null;                 // its smallest failing case, when the tool shrank one
}
export interface EvidenceSlot {
  slot: string;                        // e.g. 'screenshot:checkout'
  state: 'captured' | 'not_requested' | 'missing' | 'truncated';
  sha256?: string;
  reason?: string;                     // with missing
  outside_code?: boolean;              // with missing: the cause lies outside the code
  counts?: { kept: number; expected: number };   // with truncated
}
export interface JourneyStep { id: string; digest: string }   // digest: what the step observed

/** One run record. A run counts for a check on a claim only when its check, digest, environment and tools
 *  equal the check's, its evidence is kept, and it ran on the claim's commit or carries to it (selectReruns). */
export interface Run {
  run: string;                         // run:<id>
  check: string;
  claim: string;                       // the claim it ran for
  commit: string;                      // the commit it ran on
  digest: string;
  environment: Record<string, string>;
  tools: Record<string, string>;
  outcome: RunOutcome;
  ended: number;                       // ms since the epoch
  tests_run: number;
  reads: string[];                     // the files the run read, as the check runner recorded them
  failures: Failure[];                 // with failed (and a test that crashed under the runner)
  evidence: EvidenceSlot[];
  kept: boolean;                       // false once retention removed its evidence
  missing?: { cause: string; owner: string; since: number };   // with missing
  steps?: JourneyStep[];               // a journey's steps, in order
  contract?: ContractResult;           // a run of a check with a contract
}
/** The paths that changed from an earlier commit to the claim's commit. */
export interface Change { from: string; paths: string[] }
/** A known failure, accepted by its exact error text. */
export interface Waiver {
  check: string;
  error: string;
  owner: string;
  approved_by: string;                 // never the claimant: a waiver its own agent approved doesn't apply
  ends: { date: number } | { condition: string; met: boolean };
}

export interface ClaimInput {
  claim: string;                       // claim:<id>
  agent: string;                       // the claimant (session:<id>)
  repo: string;                        // open items' scope
  task: string;                        // task:<id>
  commit: string;                      // the snapshot it covers, 40 hex
  requirements: Requirement[];
  checks: ClaimCheck[];                // the checks selected for it
  runs: Run[];                         // every run record known for those checks, on this commit or earlier ones
  changes: Change[];                   // one per earlier commit the runs name; a commit with none never carries
  waivers: Waiver[];
  now: number;                         // ms since the epoch
}

export interface CheckResult {
  check: string;
  outcome: Result;
  reasons: string[];
  counted: string[];                   // the handles of the runs it counted (never an uncounted run), any order
  clean: number;
  needed: number;
  inherited: boolean;                  // BLOCKED as inherited
  never_started: boolean;
}
/** verdict.made's requirement outcome, field for field. */
export interface RequirementOutcome {
  req: string;
  outcome: Result;
  check: string;
  depth: string;
  oracle: Oracle;
  runs: { clean: number; needed: number; counted: string[] };   // counted: every run of its covering checks it counted
  smallest: string | null;
  points_to: string | null;
  evidence: string[];
  proof: Proof;
  ask?: string;
}
export interface PointsTo {
  frames: string[];                    // 'file:line' of each stack frame of the failure
  covers: string[];                    // the code its failing test covers
  step: string | null;                 // a journey's first step that differs from its last PASS
}
export interface OpenItemScope { repo: string; task: string; req: string | null }
export interface OpenItem {
  id: string;                          // openItemId(text, scope)
  text: string;                        // names the check, requirement and cause; never the claim, a run or a time
  scope: OpenItemScope;
  check: string | null;
  closes_with: { evidence: string; depth: Depth | null; environment: string | null; runs_needed: number };
  needs_you: boolean;                  // true only when the verdict raises an ask for it
}
export interface SendBack { cause: string; checks: string[]; smallest: string | null }
export interface FixTask { cause: string; checks: string[]; tests: string[] }
export interface VerdictAsk {
  kind: 'authority' | 'unblock' | 'taste' | 'exception' | 'choice' | 'definition';
  question: string;
  req: string | null;
  check: string | null;
}
/** verdict.made's key. */
export interface VerdictKey { commit: string; doc_revisions: string[]; check_digests: string[]; state_digests: string[]; environment: string; tools: string[] }
export interface Verdict {
  claim: string;
  commit: string;
  outcome: Result;
  stale: boolean;                      // a check never started on it because a newer claim changed its inputs
  reasons: string[];
  checks: CheckResult[];               // one per selected check, in the claim's order
  requirements: RequirementOutcome[];  // one per requirement, in the definition's order
  smallest: string | null;
  points_to: PointsTo | null;          // set on a FAIL
  open_items: OpenItem[];              // one per non-PASS, non-pending check result or requirement coverage
  send_backs: SendBack[];              // one per cause of the FAIL checks' failures that aren't inherited
  fix_tasks: FixTask[];                // one per cause of the inherited failures
  asks: VerdictAsk[];                  // the asks this verdict raises: unblock (a missing thing you own), approve an own check
  key: VerdictKey;
}

/** The claim's verdict: every rule in the table below is evaluated and the highest by precedence wins. */
export function verdict(claim: ClaimInput): Verdict;
/** Clean runs a check needs: `runs` when declared, else the least n with (1 − p)^n ≤ 0.05 for `accept`, found by
 *  exact decimal comparison, else 1. p outside (0, 1) exclusive or without its '%' unit: not ok, naming the value. */
export function runsNeeded(declared: { runs?: number; accept?: string }): { ok: true; needed: number } | { ok: false; reason: string };
/** How many more runs of a check start on this commit, given its counted runs' outcomes in the order they ended. */
export function moreRuns(declared: { runs?: number; accept?: string }, outcomes: readonly RunOutcome[]): number;
/** Which checks run again on the claim's commit: those with no counted run there or carried to it. `kept` holds,
 *  for every other check, the handles of the runs it keeps. */
export function selectReruns(claim: ClaimInput): { rerun: string[]; kept: Record<string, string[]> };
/** Why the verdict is stale on `commit`, or null while it still covers it. */
export function staleReason(verdict: Verdict, commit: string): string | null;
/** An open item's ID: a hash of its normalized text (NFC, case folded, white space collapsed, trailing
 *  punctuation dropped) and its scope. */
export function openItemId(text: string, scope: OpenItemScope): string;
/** Runs a check runner once. A runner that throws or rejects, as one that crashes mid-run does, leaves the run
 *  stopped. A runner that resolves to an object whose `outcome` is in the closed set ends the run so; anything
 *  else, a verdict included, fails conformance (conforms false, outcome null, reason saying what it returned). */
export function conductRun(runner: (signal: AbortSignal) => Promise<unknown>): Promise<{ outcome: RunOutcome | null; conforms: boolean; reason: string | null }>;

export type Outputs = Record<string, readonly number[]>;
export interface OutputTolerance { output: string; size: number; atol: number; rtol: number; unit: string }
export interface NumericContract {
  reference: { precision: Precision };   // the reference and the precision it computes in
  accumulate: Precision;                 // the type the code under test must accumulate in
  tolerances: OutputTolerance[];         // per output, each with its unit
  twin: { accumulate: Precision };       // the precision twin: the reference accumulating in this narrower type
  assert: string;                        // the named assertion the comparison is, e.g. 'assert_close'
}
export interface ContractSide {
  outcome: 'passed' | 'failed';
  failed_at: string | null;              // the named assertion it failed at
  compared: Record<string, number>;      // per output, elements compared
  largest_error: Record<string, number>; // per output, the largest |actual − expected|
}
export interface ContractResult { run: ContractSide; twin: ContractSide; outcome: 'counts' | 'INVALID'; reasons: string[] }
/** Runs a contract check: compares every element of every output of `underTest()` and of the twin,
 *  `reference(contract.twin.accumulate)`, with `reference(contract.reference.precision)`, an element passing when
 *  |actual − expected| ≤ atol + rtol·|expected|. INVALID when the twin doesn't fail at the named assertion
 *  (naming its largest error) or an output's compared count is below its size (naming the output). */
export function runContract(contract: NumericContract, implementations: { reference: (accumulate: Precision) => Outputs; underTest: () => Outputs }): ContractResult;

/** The verdict record's hash, leaving out display fields. */
export function verdictHash(verdict: Verdict): string;
export interface RecordedVerdict { id: string; handle: string; log_pos: number }   // id: the verdict.made event's ID; handle: verdict:<id>
/** Appends the verdict as a new verdict.made event, as the core (writer core), at `at`; never edits a row. Refuses a pending verdict. */
export function recordVerdict(record: RecordStore, verdict: Verdict, at: number): Promise<RecordedVerdict>;
/** Appends verdict.stale for a recorded verdict when `commit` isn't its commit; returns whether it did. */
export function markStale(record: RecordStore, recorded: RecordedVerdict, verdict: Verdict, commit: string, at: number): Promise<boolean>;
```

## The rule table the tests and the reference hold

`reference.ts` implements this table as a pure function and is never imported by the engine. For each selected
check, its counted runs are its run records (deduplicated by handle, `uncounted` ones left out) whose check,
digest, environment and tools equal the check's, whose evidence is kept, and that ran on the claim's commit or
on an earlier commit that carries: the claim names a `Change` from it, and none of its changed paths is an input
of the check. A path is an input of a check when the check declares no inputs, matches one of its declared globs
(`**` any number of segments, `*` within one), is a file a run of the check read on that earlier commit, or
matches no declared glob of any check on the claim. Every row that applies is a candidate, and the highest by
precedence wins.

| Row | Condition | Result | Names |
|---|---|---|---|
| never started | `state: never_started` (it has no run) | pending, and nothing else for that check | (no open item) |
| bad rate | `runsNeeded` not ok | BLOCKED | the value |
| missing | a counted run `missing` | BLOCKED | its cause |
| evidence outside the code | an ended check's counted run has a slot `missing` with `outside_code` | BLOCKED | the slot |
| can't fail | `cant_fail` | INVALID | the mask |
| ran nothing | a counted run `ran_nothing`, or `passed` with `tests_run` 0 | INVALID | the check |
| fix passes on base | a fix check (it covers an `on_base: fails` requirement) whose base passed or failed off its assertions | INVALID | the check |
| contract | a counted run's `contract.outcome` INVALID | INVALID | its reasons |
| uncovered | a code requirement no covering check reaches at its depth (with a contract, for `numbers`) | INVALID | the requirement and its depth |
| no check | the claim has no checks | INVALID | each requirement |
| running | `state: running` | pending | |
| all failed | an ended check whose real runs (passed, failed, overran) all failed, overran counting as failed | FAIL, or BLOCKED as inherited | the failing tests not inherited; the deadline for an overrun |
| inherited | that, for a check that isn't a fix check, whose base failed, where every failing run lists failures and every failed test also failed on the base | BLOCKED (inherited) | one fix task per cause |
| flaky | an ended check with a passed and a failed real run | INCONCLUSIVE | its failing runs |
| stopped | an ended check with a counted `stopped` run | INCONCLUSIVE | |
| too few | an ended check with fewer clean runs than it needs | INCONCLUSIVE | the runs still needed |
| evidence gap | an ended check's counted run has a slot `missing` (not outside the code) or `truncated` | INCONCLUSIVE | the slot |
| own only | a code requirement whose covering checks at its depth are all `own` | INCONCLUSIVE | one ask to approve the check |
| your answer | a person requirement: no answer → pending; `unanswered` → INCONCLUSIVE naming the ask; else the answer | | |
| otherwise | | PASS | its clean runs |

A requirement's outcome is the highest of its own rows and the results of every check covering it; the claim's
is the highest over its checks and requirements. A known failure: a failed run whose every failure's error
matches, after normalization, a waiver of that check that hasn't ended (`ends.date` > `now`, or its condition
not met) and that someone other than the claimant approved, counts as neither a failed nor a clean run, and
stays counted. `moreRuns`: 0 when the rate is bad or a counted run is missing, ran nothing or stopped; 0 once
a check has both a pass and a fail; with only failures, up to two more runs after the first (`min(3, n)` real
runs in all); otherwise `n` minus its clean runs; `uncounted` runs count neither way.

## Open points (choices the issue and design leave open; tests assert structure, not wording)

- **Wording.** No reason, open item text or ask question is matched exactly. Tests require containment: a
  reason names the requirement handle and the depth it needs, the rate as written ('-5%', '10'), the missing
  cause, the check's `deadline` text, the mask, the failing test ID or the ask handle; an unblock ask's question
  names the missing secret; an open item's `closes_with.evidence` names it. The twin's largest error is "named"
  when the reasons hold a number within 5% of it (so `4e-3`, `0.0039` and `0.00390625` all name it).
- **What a check's reasons name.** Every reason a check's rows give names the check's ID, so a verdict that is
  FAIL "naming T" holds T's ID in its `reasons`; the verdict's `reasons` hold every non-PASS check's and
  requirement's reasons. `key.check_digests` lists the digest of every selected check.
- **The rate's unit.** `accept` is a percentage written with `%`; a bare number ('10', '0.1') carries no unit and is
  BLOCKED. A check with both `runs` and `accept` isn't tested.
- **More runs.** After a first failure, up to two more runs start; with `n` below 3 the total is capped at `n`, so
  a one-run check that fails is FAIL at once (AC12, AC25). Only n = 1 and n = 29 are asserted.
- **Never started vs running.** A check with no state and no counted run is running (it needs runs), so pending;
  a never-started check is marked by the hub with its cause, and only `newer_claim` makes the verdict read stale.
- **A running check** is judged now only by the rows that don't wait on runs (a missing run, a bad rate, can't
  fail, ran nothing, base, contract); its other rows wait until it ends, so a running check never makes a FAIL.
- **Waived runs.** Tests assert only that a live waiver's match isn't FAIL and stays counted; what it reads
  (INCONCLUSIVE, as unwatched) isn't asserted, and waivers aren't generated.
- **Evidence `not_requested`** is neither generated nor asserted.
- **Inheritance with overruns.** A failing run with no failures listed (an overrun) is never inherited.
- **Send-backs** group the failures of FAIL checks by `Failure.cause`; a failing run with no failures uses the
  check's ID as its cause. Fix tasks group inherited failures the same way.
- **`smallest` and `points_to`.** The verdict's smallest case and pointers come from one failure of a FAIL check;
  tests have one failure in play, so which one wins among several isn't asserted. The journey step is the first
  step whose ID or digest differs from the newest passed run of the same check, on any commit.
- **The approve ask's kind** isn't asserted; its `check` is.
- **Selection** is pre-run: `selectReruns` reruns every check with no counted run, so a key change (another Node,
  another viewport), removed evidence or a changed input reruns it. A check that declares no inputs isn't a
  cover for the "no check's declared inputs cover it" rule; that combination isn't generated.
- **The generator** draws claims inside the table's settled ground: own checks have ended, running checks have
  runs of one polarity with captured evidence, never-started checks have no runs, every check declares inputs,
  person requirements have no covering checks, and no waivers. Requirement outcomes are compared only in fixed
  tests (the engine's and the reference's claim outcome, per-check outcome and per-check counted runs are
  compared on every generated claim).
- **Budget and the merge base.** The base has no verdict engine, so "compared with the merge base" has nothing
  to compare; the test holds the absolute 10 ms under the design's timing rule, and the p50 comparison belongs to
  the perf lane once a base has the engine.
- **Scope bullets with no criterion** are not tested here: predictions recorded before a run, a workspace's
  state-source digests, and one fix task's holder session.

## Criteria to tests

Each test's name starts with its criterion's number, in issue order. Where a criterion names a wrong program,
the test runs the planted twin (a variant of the reference, or a function in the test) through the same check
and asserts that it fails.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 | property tests cover every precedence pair | `rules.test.ts` AC1: 1,000 seeded claims over every pair of the six results, every pair reached |
| AC2 | 10% → 29, 45% → 6 | `runs.test.ts` AC2: `runsNeeded`; a planted 5-run count fails; 29 clean runs PASS with clean 29, 28 don't |
| AC3 | a different error than the accepted one fails | `rules.test.ts` AC3: matching (also after normalization) isn't FAIL; another error, the claimant's own waiver FAIL |
| AC4 | a new commit makes the old verdict stale | `carry.test.ts` AC4 (`staleReason`); `record.test.ts` AC4 (`markStale`, the row reads stale) |
| AC5 | a FAIL names each frame's file and line and the journey's first differing step | `rules.test.ts` AC5 |
| AC6 | own-only never passes | `rules.test.ts` AC6: fixed, and a 1,000-case property |
| AC7 | three failures, one cause, one send-back | `rules.test.ts` AC7: fixed, and a 1,000-case property over causes |
| AC8 | pass and fail INCONCLUSIVE with the failing runs; all fail FAIL; load uncounted | `runs.test.ts` AC8 |
| AC9 | a fix claim's failing fix check is FAIL; npm test's base failure an inherited fix task | `rules.test.ts` AC9 |
| AC10 | red main, only inherited failures: BLOCKED, one fix task per cause | `rules.test.ts` AC10 |
| AC11 | no check or an uncovered requirement INVALID; own-only at depth INCONCLUSIVE with one ask | `rules.test.ts` AC11 |
| AC12 | FAIL at once beside a running journey; pending with no item for it; BLOCKED with one unblock ask beside a taste wait | `rules.test.ts` AC12 |
| AC13 | the seven run outcomes; conformance; missing, overran, stopped, ran nothing; a crashing stub | `conformance.test.ts` AC13; `rules.test.ts` AC13 |
| AC14 | p = 10%, fail then pass: INCONCLUSIVE at once, no runs needed, no third run | `runs.test.ts` AC14 |
| AC15 | journey requirement: unit + journey PASS; unit alone INVALID naming the depth | `rules.test.ts` AC15 |
| AC16 | a missing secret's one open item; raised again one record; a flaky item not in Needs you | `rules.test.ts` AC16 |
| AC17 | `src/**`, `docs/**` and `scripts/build.sh` | `carry.test.ts` AC17, with the declared-only twin |
| AC18 | a fixture read by T reruns T; FAIL naming T | `carry.test.ts` AC18, with the declared-only twin |
| AC19 | after a failure, up to two more runs; FAIL or INCONCLUSIVE | `runs.test.ts` AC19 |
| AC20 | overruns count as failures; three FAIL naming the deadline | `runs.test.ts` AC20 |
| AC21 | INCONCLUSIVE carries when no input changed; reruns when one did | `carry.test.ts` AC21 |
| AC22 | a verdict from 1,000 runs under 10 ms on the reference Mac | `budgets.test.ts` AC22 |
| AC23 | a known failure past its expiry fails again | `rules.test.ts` AC23 |
| AC24 | every rule tested, the highest wins; the first-match twin returns BLOCKED | `rules.test.ts` AC24: the table, row by row, and the two pairs with the twin |
| AC25 | BLOCKED row, then a FAIL row; `verdict_id` names the FAIL | `record.test.ts` AC25 |
| AC26 | per-test inheritance: coupon FAIL, tax alone BLOCKED | `rules.test.ts` AC26, with a per-check twin |
| AC27 | the reference agrees on 10,000 claims; the design's properties; planted engines fail | `reference.test.ts` AC27 |
| AC28 | Node 20 → 22 and a viewport change don't carry | `carry.test.ts` AC28, with the commit-and-digest twin |
| AC29 | 1% → 299, 95% → 1, bad rates BLOCKED, none → 1; the naive formula fails | `runs.test.ts` AC29 |
| AC30 | 35 days on: A reruns at D, FAIL on the new claim, the old row, runs and hash unchanged | `record.test.ts` AC30 |
| AC31 | requirement outcomes list counted runs; a carried run listed; the reference recomputes | `carry.test.ts` AC31, with the no-carry twin |
| AC32 | a never-started journey: pending and stale, no item; a failed reproduction FAIL, no INVALID | `rules.test.ts` AC32, with both twins |
| AC33 | the numeric contract and its twin; 4e-3; shape-only too weak | `contract.test.ts` AC33 |
| Oct 9 | depth, coverage, evidence states, the key and clean-run counts | `rules.test.ts` Oct9 |
| Done | unit-only can't pass a journey claim; a missing screenshot never PASS | `rules.test.ts` DONE |

## Files

- `reference.ts`: the reference verdict and selection, with the planted variants the criteria name.
- `generate.ts`: the seeded claim generator.
- `helpers.ts`: builders for claims, checks, runs and failures; precedence; small assertion helpers.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base, where every suite fails because the package doesn't exist.
