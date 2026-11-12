// Check execution contracts: the core consumes results, never selects a concrete check implementation.
import type { CheckContext, CheckResult, CheckSpec } from '@deepbuild/conformance';
import type { Checkouts } from '@deepbuild/gate';
import type { Host, Supervisor } from '@deepbuild/supervisor';
import type { JobRecord, JobSpec } from '@deepbuild/runner';
import type { TimingReport } from '@deepbuild/verdicts';
import type { ClaimCheck } from './gate-runner.js';

export interface CommandCheck {
  host: Host;
  run: string;
  spec: CheckSpec;
  checkout: string;
  deadline: number;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  hosts?: string[];
  standIns?: string[];
  contract?: { tolerances: { output: string; size: number }[] };
  timing?: { repeats: number };
  stop?: AbortSignal;
  outside?: boolean;
  plant?: 'exit-code-only' | 'last-attempt-only' | 'no-do-not-track';
}
/** Full command evidence, not just the check.kind result: retries, seeds and clock movement remain observable. */
export interface CommandRun extends CheckResult {
  run: string;
  exit: { code: number | null; signal: NodeJS.Signals | null; cause: 'exit' | 'deadline' | 'stop' | 'limit' } | null;
  output: { stdout: string; stderr: string; sha256: { stdout: string; stderr: string } };
  env: string[];
  attempts: { test: string; outcome: 'passed' | 'failed' }[];
  retries: string | null;
  seeded: { name: string; by: string; standIn: boolean }[];
  contract: { output: string; size: number; compared: number | null; largest_error: number | null }[] | null;
  timing: { repeat: number; flushed: boolean }[] | null;
  clock: number;
}
export interface ReviewOf { claim: string; task: string; agent: string; transcript: string | undefined; pr?: string | undefined }
export interface ReviewItem { rule: string; sites: { file: string; line: number; quote: string }[] }
/** A counted round keeps its sent items separate from earlier ones still open. */
export interface ReviewRound { sent: ReviewItem[]; open: ReviewItem[] }
/** What a speed's or added terms' run reads beyond its checkout (#1863): its run's handle, the session's worktree and the hub's stop. */
export interface RepoOf { run: string; worktree: string; stop: AbortSignal }
export interface KindsOptions {
  host(): Host;
  /** The supervisor each side of a stated speed runs its steps through, and the checkouts its baseline side runs in (#1863). */
  supervisor(): Supervisor;
  checkouts(): Checkouts;
  /** The hub's object store, a bare repo reading the repo's objects as alternates: the merge base's files are read there. */
  store: string;
  submit(spec: JobSpec): Promise<JobRecord>;
  wait(job: string): Promise<JobRecord>;
  cancel(job: string): Promise<JobRecord>;
  plant?: string | undefined;
}
export interface CheckKinds {
  list(): { kind: string; routes: string[] }[];
  reaches(kind: string, route: 'spec' | 'definition' | 'pr' | 'number'): boolean;
  deadline(kind: string): number;
  definitionSpec(bytes: Uint8Array): CheckSpec | undefined;
  claimChecks(words: string, cwd: string, base: string, sample: string | null): Promise<{ check: ClaimCheck; spec: CheckSpec }[]>;
  uncited(words: string): string;
  reviewSpec(base: string, head: string, root: string): CheckSpec | undefined;
  run(spec: CheckSpec, ctx: CheckContext, of: ReviewOf, repo?: RepoOf): Promise<CheckResult & { round?: ReviewRound; speed?: TimingReport }>;
}
export interface ChecksProvider {
  command(options: CommandCheck): Promise<CommandRun>;
  kinds(options: KindsOptions): CheckKinds;
  reviewOutcomes(checkout: string, sent: { commit: string; items: ReviewItem[] }[], settled: string): Promise<(ReviewItem & { ended: 'fixed' | 'left'; commit: string })[]>;
}
