// The runner's public shapes (#159): a job DeepBuild runs on your own agent, headless, apart from your sessions.
import type { Asks } from '@deepbuild/asks';
import type { Ledger } from '@deepbuild/budget';
import type { RecordStore } from '@deepbuild/record';
import type { Supervisor } from '@deepbuild/supervisor';

export type Agent = 'claude-code' | 'codex';
/** draft: the drafting job; review: the review check's second model; read: wiki reads and reading by reference;
 *  smoke: an agent release's live smoke test, the one kind that may run a version its facts don't cover yet. */
export type JobKind = 'draft' | 'review' | 'read' | 'smoke';
/** A stdio MCP server, as Claude Code's mcpServers entries take it. */
export interface McpServer { command: string; args?: string[]; env?: Record<string, string> }
export interface JobSpec {
  kind: JobKind;
  agent: Agent;
  /** On the agent's stdin, as given. */
  prompt: string;
  /** The model to launch; by default the facts' readOnlyJob launch's. */
  model?: string;
  /** The account it runs on; by default the one the agent records beside your sign-in. */
  account?: string;
  /** The issue it serves: what a budget's scope covers. */
  issue?: string;
  /** The task and claim waiting on it, which show BLOCKED while it waits. */
  task?: string;
  claim?: string;
  /** When it needs code: its folder is a checkout of this commit of this repo, and nothing else of it. */
  checkout?: { repo: string; commit: string };
  /** The only MCP servers it gets. */
  mcp?: Record<string, McpServer>;
  /** Held through the supervisor while any of its processes runs. */
  leases?: { kind: string; key?: string }[];
  /** From its start; the deadline stops its group. */
  deadline_ms?: number;
  /** How long it may print nothing while the platform reports no CPU or disk use by it. */
  output_timeout_ms?: number;
}
/** The stop's closed set (agent.stop@2). */
export type StopCause =
  | 'sign_in_required' | 'token_refresh_failed' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns'
  | 'context_overflow' | 'tool_schema_rejected' | 'agent_crashed' | 'timed_out' | 'unknown';
/** waiting: recorded, not started (`blocked` says on what); stopping: a stop sent and not yet confirmed;
 *  stopped: every process of it proven gone, without a final result; lost: found after a crash and reported, never run. */
export type JobState = 'waiting' | 'running' | 'stopping' | 'stopped' | 'finished' | 'refused' | 'lost';
export interface Blocked {
  status: 'BLOCKED';
  /** 'plan window', 'first reading', 'budget' or 'standing approval'. */
  cause: string;
  owner: 'you';
  since: number;
  /** The task and claim waiting on it. */
  on: string[];
  account?: string;
  ask?: string;
  /** What it waits on, in words. */
  why?: string;
}
export interface JobRecord {
  /** `run:<ULID>`: the job's run, as the supervisor and sandbox.denied name it. */
  job: string;
  kind: JobKind;
  agent: Agent;
  account: string | null;
  state: JobState;
  blocked?: Blocked;
  /** Why it never started, naming what refused it. */
  refused?: string;
  /** Its own folder under <root>/jobs/, kept after it ends. */
  folder: string;
  /** The binary it resolved on the login shell's PATH, and its version. */
  binary?: { path: string; version: string };
  /** Recorded before the prompt is written. */
  pid?: number;
  pgid?: number;
  start?: string;
  /** The session ID read from its own output. */
  session?: string;
  /** The model that answered, from its output as the facts say, or 'unknown'. */
  model?: string;
  stop?: { cause: StopCause };
  usage?: { input: number; cached: number; output: number };
  cost_usd?: number;
  /** What was still running after its final result's grace, each `pid:<n>`. */
  lingered?: string[];
  /** The final result's text. */
  result?: string;
  /** Its run, in ms since the epoch on the real clock: from its process's start until every process of it is proven gone. */
  ran?: { from: number; to?: number };
}
/** A window snapshot an agent reported locally, in the agent's own shape: Claude Code's status line `rate_limits`
 *  (`five_hour`/`seven_day`: `used_percentage`, `resets_at` in Unix seconds); a Codex token event's `rate_limits`. */
export interface WindowReport { agent: Agent; account: string; rate_limits: unknown }
/** The planted wrong programs the acceptance tests select; tests only. */
export type Plant = 'records-launched-model' | 'checkout-of-session-head' | 'worktree-of-mirror' | 'widens-range-on-smoke';
export interface RunnerOptions {
  record: RecordStore;
  asks: Asks;
  supervisor: Supervisor;
  ledger: Ledger;
  /** The clock of records, windows, waits and daily counts; processes and graces run in real time. */
  now: () => number;
  /** The hub's root: jobs run in <root>/jobs/<run token>/. */
  root: string;
  /** The login shell's PATH that setup recorded. */
  loginPath: string;
  /** The hub's environment, which the allowlist filters; HOME is your sign-in home. */
  env: Readonly<Record<string, string | undefined>>;
  settings: { plan: { reserve_pct: number }; asks: { unblock: { deadline_ms: number } } };
  /** A generic password from your login Keychain by service name, or undefined: where an agent keeps its sign-in
   * on macOS (Claude Code does), which a job's sandbox refuses. Read fresh for each job that bills your plan. */
  keychain?: (service: string) => Promise<string | undefined>;
  plant?: Plant;
}
export interface Runner {
  /** Records it, then starts it if it may; resolves once it is recorded and started, waiting or refused. */
  submit(spec: JobSpec): Promise<JobRecord>;
  /** Its end: finished, stopped, refused or lost. */
  wait(job: string): Promise<JobRecord>;
  /** deep.runner.run(job): submit, then wait. */
  run(spec: JobSpec): Promise<JobRecord>;
  status(job: string): Promise<JobRecord>;
  /** Every job the record holds, newest last. */
  list(): Promise<JobRecord[]>;
  /** Stops its group; resolves with the job as it reads then. */
  cancel(job: string): Promise<JobRecord>;
  /** Its stdout, as the runner read it. */
  output(job: string): Promise<string>;
  report(reading: WindowReport): Promise<void>;
  /** Re-reads the clock, windows, answers and budgets, and starts what may start. */
  tick(): Promise<void>;
  close(): Promise<void>;
}
