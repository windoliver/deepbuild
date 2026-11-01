// A claim's verdict from its checks' command runs (#30): the gate's records of each run, as the command check kind
// closes them, become the verdict engine's run records (#28), and the core's masked-exit rule makes a check whose
// locked command masks its exit one that can't fail. Pure: every input, the time included, is an argument. The gate
// never imports the extension that made the runs, so the run's shape is stated here by its fields.
import { createHash } from 'node:crypto';
import { verdict } from '@deepbuild/verdicts';
import type { ClaimCheck, ClaimInput, ContractResult, ContractSide, Depth, EvidenceSlot, Failure, NumericContract, Proof, Requirement, Run, RunOutcome, Source, Verdict } from '@deepbuild/verdicts';
import { maskIn } from './mask.js';

/** One failed test as check.kind@1 reports it. */
export interface RecordedFailure { test: string; file: string; line: number; stack: string | null; assertion: boolean; message: string }
/** A closed run as the command check kind records it: a run outcome and the record's fields the claim reads, never a verdict. */
export interface RecordedRun {
  run: string;
  outcome: RunOutcome;
  testsRun: number;
  failures: RecordedFailure[];
  evidence: string[];
  read: string[];
  mask: string | null;
  exit: { code: number | null; signal: NodeJS.Signals | null; cause: 'exit' | 'deadline' | 'stop' } | null;
  /** Scrubbed by value, then digested: the digests are what the run's output evidence holds. */
  output: { stdout: string; stderr: string; sha256: { stdout: string; stderr: string } };
  attempts: { test: string; outcome: 'passed' | 'failed' }[];
  seeded: { name: string; by: string; standIn: boolean }[];
  /** Per output of the contract, from the tool's report; null without a contract. */
  contract: { output: string; size: number; compared: number | null; largest_error: number | null }[] | null;
}
/** A check of the claim, as the definition locks it, with every run of it on the claim's commit, in order. */
export interface ClaimedCheck {
  check: string;
  /** The command line as locked; the core's masked-exit rule reads it. */
  command: string;
  source: Source;
  covers: string[];
  depth?: Depth;
  proof?: Proof;
  inputs?: string[];
  deadline?: string;
  contract?: NumericContract;
  runs: RecordedRun[];
}
/** The definition's requirement, and whether it is about what real users get. */
export interface ClaimRequirement extends Requirement { real_users?: boolean }
export interface ClaimedRuns { claim: string; agent: string; repo: string; task: string; commit: string; requirements: ClaimRequirement[]; checks: ClaimedCheck[]; now: number }
/** The planted twin: a gate that judges only the exit code, with no masked-exit rule; tests only. */
export type VerdictPlant = 'exit-code-only';

const canonical = (value: unknown): string => JSON.stringify(value, (_, v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
/** A check's digest: what its runs must have run, the command and the contract, so a run of another counts for nothing. */
const digestOf = (c: ClaimedCheck): string => createHash('sha256').update(canonical({ check: c.check, command: c.command, contract: c.contract ?? null })).digest('hex');

/** The contract report the engine reads, from the counts the tool's report gave: a count below the size, or none, is INVALID naming the output. */
function contractOf(contract: NumericContract, r: RecordedRun): ContractResult | undefined {
  if (!r.contract) return undefined;
  const compared: Record<string, number> = {};
  const largest: Record<string, number> = {};
  const reasons: string[] = [];
  for (const t of contract.tolerances) {
    const count = r.contract.find((c) => c.output === t.output);
    if (count?.compared === null || count?.compared === undefined) { reasons.push(`output ${t.output}: no count in the report`); continue; }
    compared[t.output] = count.compared;
    if (count.largest_error !== null) largest[t.output] = count.largest_error;
    if (count.compared < t.size) reasons.push(`output ${t.output}: ${count.compared} of ${t.size} elements compared`);
  }
  // The report gives counts, never where a failed run failed, and a command run compares no precision twin: that
  // side is unrun, nothing compared. The engine judges the report by its outcome and reasons alone.
  const twin: ContractSide = { outcome: 'unrun', failed_at: null, compared: {}, largest_error: {} };
  return { run: { outcome: r.outcome === 'passed' ? 'passed' : 'failed', failed_at: null, compared, largest_error: largest }, twin, outcome: reasons.length ? 'INVALID' : 'counts', reasons };
}

/** The engine's run record of one command run. */
function recordOf(claim: ClaimedRuns, c: ClaimedCheck, digest: string, r: RecordedRun, exitOnly: boolean): Run {
  // The planted gate reads a run's outcome from its exit alone; the real one takes the kind's closed outcome.
  const outcome: RunOutcome = exitOnly && r.exit ? (r.exit.code === 0 ? 'passed' : 'failed') : r.outcome;
  const failures: Failure[] = r.failures.map((f) => ({ test: f.test, message: f.message, cause: c.check, frames: [{ file: f.file, line: f.line }], covers: [], case: null }));
  const evidence: EvidenceSlot[] = [
    { slot: 'stdout', state: 'captured', sha256: r.output.sha256.stdout },
    { slot: 'stderr', state: 'captured', sha256: r.output.sha256.stderr },
  ];
  const standIns = r.seeded.filter((s) => s.standIn).map((s) => ({ table: s.name, by: s.by }));
  const contract = c.contract ? contractOf(c.contract, r) : undefined;
  // The record carries no clock and no fingerprint of its own: every run ends at the claim's `now`, in one
  // environment with one set of tools, so each counts for the check it ran for.
  return {
    run: r.run, check: c.check, claim: claim.claim, commit: claim.commit, digest, environment: {}, tools: {},
    outcome, ended: claim.now, tests_run: r.testsRun, reads: [...r.read], failures, evidence, kept: true,
    // A run that never started names why (a program the run's PATH lacks, a checkout gone): the machine's, so yours to provide.
    ...(outcome === 'missing' ? { missing: { cause: r.failures[0]?.message ?? 'the run never started', owner: 'you', since: claim.now } } : {}),
    ...(contract ? { contract } : {}),
    ...(r.attempts.length ? { attempts: r.attempts.map((a) => ({ ...a })) } : {}),
    ...(standIns.length ? { stand_ins: standIns } : {}),
  };
}

/** The claim's verdict from its checks' runs: the gate's records of them, judged by the verdict engine. */
export function claimVerdict(claim: ClaimedRuns, options: { plant?: VerdictPlant } = {}): Verdict {
  const exitOnly = options.plant === 'exit-code-only';
  const checks: ClaimCheck[] = [];
  const runs: Run[] = [];
  for (const c of claim.checks) {
    const digest = digestOf(c);
    const mask = exitOnly ? null : maskIn(c.command);
    checks.push({
      check: c.check, digest, source: c.source, depth: c.depth ?? 'unit', proof: c.proof ?? 'test_run', covers: [...c.covers],
      ...(c.inputs ? { inputs: [...c.inputs] } : {}), ...(c.deadline !== undefined ? { deadline: c.deadline } : {}),
      ...(mask !== null ? { cant_fail: `exit status masked by \`${mask}\`` } : {}),
      ...(c.contract ? { contract: c.contract } : {}),
      environment: {}, tools: {},
    });
    for (const r of c.runs) runs.push(recordOf(claim, c, digest, r, exitOnly));
  }
  const input: ClaimInput = {
    claim: claim.claim, agent: claim.agent, repo: claim.repo, task: claim.task, commit: claim.commit,
    requirements: claim.requirements, checks, runs, changes: [], waivers: [], now: claim.now,
  };
  return verdict(input);
}
