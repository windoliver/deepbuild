// The verdict engine's shapes (#28): what a claim's judgment reads and what it returns.

/** The five verdicts. */
export type Outcome = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
/** A verdict, or pending while results still come. Precedence: FAIL > INVALID > BLOCKED > INCONCLUSIVE > pending > PASS. */
export type Result = Outcome | 'pending';
/** How a run ended: the closed set a check runner returns. */
export type RunOutcome = 'passed' | 'failed' | 'ran_nothing' | 'missing' | 'overran' | 'stopped' | 'uncounted';
/** Proof depth, shallowest first; a deeper check satisfies a shallower requirement, never the reverse. */
export type Depth = 'unit' | 'integration' | 'journey' | 'live';
export type Oracle = 'code' | 'model' | 'person';
export type Proof = 'statement' | 'static_check' | 'test_run' | 'journey' | 'decision';
/** Whose check it is; the agent's own can send a claim back but never pass it. */
export type Source = 'spec' | 'definition' | 'approved' | 'own';
export type Precision = 'fp16' | 'fp32' | 'fp64';

/** One requirement of the claim's locked definition of done. */
export interface Requirement {
  req: string;
  depth: Depth;
  oracle: Oracle;
  /** fails: new or fixed behavior, so its checks are fix checks; passes: behavior that must not change. */
  on_base: 'fails' | 'passes';
  /** About computed numbers: covered only by a check with a numeric contract. */
  numbers?: boolean;
  ask?: string;
  /** A person's answer: absent while the ask is open, unanswered once it ended so. */
  answer?: 'PASS' | 'FAIL' | 'unanswered';
}

/** How a check ran on the merge base. */
export interface BaseResult {
  outcome: 'passed' | 'failed';
  /** At least one test failed there on an assertion its check names. */
  on_assertion: boolean;
  failed_tests: string[];
  /** Why this base run proves nothing, naming the place, when the gate's service could read it (#31). */
  why?: string;
}

/** A check selected for the claim, with the key its runs must match to count. */
export interface ClaimCheck {
  check: string;
  digest: string;
  source: Source;
  depth: Depth;
  proof: Proof;
  covers: string[];
  /** Declared input globs; absent or empty: the whole commit. */
  inputs?: string[];
  runs?: number;
  /** The failure rate accepted, a decimal with its unit, e.g. '10%'. */
  accept?: string;
  deadline?: string;
  /** Why it can't fail, e.g. 'exit status masked by `|| true`'. */
  cant_fail?: string;
  contract?: NumericContract;
  base?: BaseResult;
  environment: Record<string, string>;
  tools: Record<string, string>;
  /** Absent: running while more runs start, else ended. */
  state?: 'running' | 'ended' | 'never_started';
  never_started?: 'quick_check_failed' | 'kept_working' | 'loop' | 'newer_claim';
}

export interface Frame { file: string; line: number }
/** One failed test of a run, read from the tool's report. */
export interface Failure {
  test: string;
  message: string;
  /** The change it traces to. */
  cause: string;
  /** Every stack frame, innermost first. */
  frames: Frame[];
  /** The code the failing test covers. */
  covers: string[];
  case: string | null;
}
export interface EvidenceSlot {
  slot: string;
  state: 'captured' | 'not_requested' | 'missing' | 'truncated';
  sha256?: string;
  reason?: string;
  outside_code?: boolean;
  counts?: { kept: number; expected: number };
}
export interface JourneyStep { id: string; digest: string }

/** One run record. */
export interface Run {
  run: string;
  check: string;
  claim: string;
  commit: string;
  digest: string;
  environment: Record<string, string>;
  tools: Record<string, string>;
  outcome: RunOutcome;
  /** When the run started, where its runner records it; a prediction counts only from before it. */
  started?: number;
  ended: number;
  tests_run: number;
  /** The files the run read, as the check runner recorded them. */
  reads: string[];
  failures: Failure[];
  evidence: EvidenceSlot[];
  /** False once retention removed its evidence. */
  kept: boolean;
  missing?: { cause: string; owner: string; since: number };
  steps?: JourneyStep[];
  contract?: ContractResult;
}
/** The paths that changed from an earlier commit to the claim's commit. */
export interface Change { from: string; paths: string[] }
/** A known failure, accepted by its exact error text. */
export interface Waiver {
  check: string;
  error: string;
  owner: string;
  approved_by: string;
  ends: { date: number } | { condition: string; met: boolean };
}

/** What the agent expects a check to show, recorded by deep_claim before the check runs. */
export interface Prediction { check: string; expects: 'passed' | 'failed'; at: number }
/** A counted run that disagrees with a prediction, or one a prediction was recorded only after it started. */
export interface Contradiction { check: string; run: string; predicted: 'passed' | 'failed'; outcome: RunOutcome; late: boolean }

export interface ClaimInput {
  claim: string;
  /** The claimant, session:<id>. */
  agent: string;
  repo: string;
  task: string;
  commit: string;
  requirements: Requirement[];
  checks: ClaimCheck[];
  /** Every run record known for those checks, on this commit or earlier ones. */
  runs: Run[];
  /** One per earlier commit the runs name; a commit with none never carries. */
  changes: Change[];
  waivers: Waiver[];
  now: number;
  predictions?: Prediction[];
  /** On a workspace, the digests of what its state sources read: sha256 hex, as verdict.made's key holds them. */
  state?: string[];
}

export interface CheckResult {
  check: string;
  outcome: Result;
  reasons: string[];
  counted: string[];
  clean: number;
  needed: number;
  inherited: boolean;
  never_started: boolean;
  /** Why its result is stale: a carried result its runs' reads withdrew, naming each file read; null otherwise. */
  stale: string | null;
}
/** verdict.made's requirement outcome, field for field. */
export interface RequirementOutcome {
  req: string;
  outcome: Result;
  check: string;
  depth: string;
  oracle: Oracle;
  runs: { clean: number; needed: number; counted: string[] };
  smallest: string | null;
  points_to: string | null;
  evidence: string[];
  proof: Proof;
  ask?: string;
}
export interface PointsTo {
  frames: string[];
  covers: string[];
  step: string | null;
}
export interface OpenItemScope { repo: string; task: string; req: string | null }
export interface OpenItem {
  id: string;
  text: string;
  scope: OpenItemScope;
  check: string | null;
  closes_with: { evidence: string; depth: Depth | null; environment: string | null; runs_needed: number };
  needs_you: boolean;
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
  /** A check never started on it because a newer claim changed its inputs. */
  stale: boolean;
  reasons: string[];
  checks: CheckResult[];
  requirements: RequirementOutcome[];
  smallest: string | null;
  points_to: PointsTo | null;
  open_items: OpenItem[];
  send_backs: SendBack[];
  fix_tasks: FixTask[];
  asks: VerdictAsk[];
  key: VerdictKey;
  /** Reported, never evidence: no prediction moves a verdict. */
  contradictions: Contradiction[];
}

export type Outputs = Record<string, readonly number[]>;
export interface OutputTolerance { output: string; size: number; atol: number; rtol: number; unit: string }
export interface NumericContract {
  reference: { precision: Precision };
  accumulate: Precision;
  tolerances: OutputTolerance[];
  /** The reference accumulating in this narrower type, put in place of the code under test. */
  twin: { accumulate: Precision };
  /** The named assertion the comparison is. */
  assert: string;
}
export interface ContractSide {
  outcome: 'passed' | 'failed';
  failed_at: string | null;
  compared: Record<string, number>;
  largest_error: Record<string, number>;
}
export interface ContractResult { run: ContractSide; twin: ContractSide; outcome: 'counts' | 'INVALID'; reasons: string[] }

export interface RecordedVerdict { id: string; handle: string; log_pos: number }
