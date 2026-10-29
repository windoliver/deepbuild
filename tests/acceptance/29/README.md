# Acceptance tests for #29: the gate runner

Written first, from issue #29 (its text as of 2026-10-29T05:21:56Z: Scope, Fields and the acceptance criteria), the design
sections it links (An agent says it's done, all of it; How runs become one of five verdicts, all of it; Numbers version 0
has to hold), the primitives Claim, Check, Verdict, Lease and Definition of done, the Threats rows "Untrusted PR heads" and
"Concurrent runs", Building blocks' Work source (`push.record@1`), the extension slot row for `deep.registerSource`, What
each agent gives us (prompt origins, loop facts), and Dogfooding, all in `docs/technical-design.md`, and base commit
`c733840f`, by a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job.

The issue has 41 checkbox criteria (the job's brief said 38); every one is tested, in issue order, as AC1 … AC41.

```sh
npm ci                                    # once, if node_modules is missing
npx vitest run --root tests/acceptance/29
node node_modules/typescript/bin/tsc -p tests/acceptance/29/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache to `tests/acceptance/29/.vite/`;
delete it before committing. Tests that start a hub need `npm run build` and `cargo build -p deep-hook` first (as #303's
do); a hub that cannot start is BLOCKED, never a pass. The budget test (AC18) runs only on a reference Mac on mains power,
as #28's and #303's do, and otherwise skips as INCONCLUSIVE; it never passes by skipping.

## The surface under test

The issue names behaviors and no code API, so these tests define the smallest one they need: the public entry of a new
workspace package, `@deepbuild/gate`, at `packages/gate/src/index.ts`, imported with its `.ts` extension. It has two
kinds of parts.

- **Pure, deterministic parts**, driven on a virtual clock (`simulate`) or on plain data (`claimsFor`, `recomputeHash`,
  `floor`, `checkSource`, `headTrust`, `runPushRecordKit`, `attributeStack`, `runTiming`): every input they read, the
  time included, is an argument; nothing reads a real clock, the network or a model.
- **Real parts**: `floor` and `checkSource` read real files and real git repositories in `/tmp`; `executeClaim` and
  `runHeavy` start real processes and take real leases from the real `@deepbuild/leases` table over a real
  `@deepbuild/record`; `claimsFor`'s hub side is checked through the real hub and deep-hook.

`plant` options select the wrong programs the criteria name, as `@deepbuild/leases`'s `plant` does; tests only. The tests
also use `@deepbuild/verdicts` (`verdict`, as #28 ships it at base), `@deepbuild/checks-command` (`maskIn`),
`@deepbuild/leases` (`openLeases`) and `@deepbuild/record` (`openRecord`) through their public entries.

<!-- SURFACE:BEGIN -->
```ts
import type { Lease, LeaseTable } from '@deepbuild/leases';
import type { Result, RunOutcome, Source } from '@deepbuild/verdicts';

/* ================= 1. Claims: which stops and calls make one ================= */
export type ClaimSource = 'stop' | 'deep_claim' | 'gh_pr_create';
export interface OpenAsk { task_ref: string; touched: boolean }   // an open ask-task of the session, and whether this turn touched it
export interface ClaimIntake {
  source: ClaimSource;
  session: string;
  commit: string;                                   // the snapshot the claim covers
  asks: OpenAsk[];
  /** work: tool calls or edits since the turn began; answer: the turn began with a prompt a person typed that opened no task, with no edit, write or ask in it. */
  turn: { work: boolean; answer: boolean; last_message?: string };
  named?: string[];                                 // deep_claim: the task_refs the call names; absent: the asks the turn touched
}
export interface MadeClaim { claim: string; task_ref: string; source: ClaimSource; session: string; commit: string }
/**
 * Exactly one claim per open ask a source touched, never for an ask it didn't touch, never from a stop with no work or from an
 * answer, and never from the words of a last message. deep_claim and gh pr create are claims in a turn; they wait for the turn's stop.
 */
export function claimsFor(intake: ClaimIntake, options?: { plant?: 'claims-every-open-ask' | 'claims-on-words' | 'claims-on-answers' | 'two-per-ask' }): MadeClaim[];

/* ================= 2. The floor: validity gate and hash, with no model, in safe mode too ================= */
export interface DefinitionParts {
  task_ref: string;
  requirements: { id: string; text: string; check: string | null }[];
  deliverables: string[];                           // repo-relative paths that must exist in the claim's checkout
  files: Record<string, string>;                    // drafted check files and the expected outputs they reference: path → bytes
}
/** The locked hash and the digest of each part, so a difference can name what changed. Part keys: `requirement:<id>`, `deliverables`, `file:<path>`. */
export interface Lock { hash: string; parts: Record<string, string> }
export function lockDefinition(definition: DefinitionParts): Lock;
export function recomputeHash(definition: DefinitionParts, locked: Lock): { same: boolean; hash: string; changed: string[] };  // changed: the part keys that differ, each naming a requirement id or a file path

export interface SessionRun { command: string; exit_status: number | null; output: string }
export interface SessionLog { read: string[]; ran: SessionRun[]; links?: string[] }   // files read and commands run in THIS session; links the session fetched
export interface Finding {
  kind: 'definition_hash' | 'deliverable' | 'file' | 'line' | 'test' | 'run' | 'link' | 'masked_exit';
  ref: string;                                      // the thing named: a path, `path:line`, a test ID, the command, the URL, a part key
  why: string;                                      // human words; contain `ref`; for masked_exit contain "exit status masked by `<mask>`"
  mask?: string;                                    // masked_exit: the mask as the core's one masked-exit rule names it
  changed?: string[];                               // definition_hash: the changed part keys
}
export interface FloorInput {
  claim: { claim: string; message: string };        // message: the agent's final message; its cites are its BACKTICKED SPANS (open point 1)
  checkout: string;                                 // a real directory: the claim's checkout
  definition: DefinitionParts;                      // as it reads now
  locked: Lock;
  session: SessionLog;
}
export type FloorResult =
  | { ok: true }
  | { ok: false; action: 'send_back' | 'INVALID'; findings: Finding[]; claim: string };   // INVALID for a hash that differs; send_back for the validity gate
/** One pass before any check runs. Holds with no extension loaded: `safe` loads none, and an installed `doneGate` is never consulted. */
export function floor(input: FloorInput, options?: { safe?: boolean; doneGate?: (input: FloorInput) => FloorResult | undefined; plant?: 'run-happened-only' | 'leaves-to-done-gate' | 'no-deliverable-check' | 'no-read-check' }): FloorResult;

/* ================= 3. Whose checks count ================= */
export interface ApprovedCheck {
  check: string;
  reads: string[];                                  // the files its runs read, as its runner recorded them
  declares: { tests?: string[]; fixtures?: string[]; expected?: string[]; runner_config?: string[]; script?: { file: string; target: string } };   // globs; script: the package script, Makefile or justfile target it runs
}
/** From the claim's real diff (`git diff from to` in `repo`): 'own' when the diff changed a file the check reads under the repo's test, fixture or script folders, a declared test, fixture, expected output or runner config, or the script target it runs; otherwise 'approved'. The code under test is an input, never an own file. */
export function checkSource(check: ApprovedCheck, diff: { repo: string; from: string; to: string }, options?: { plant?: 'every-read-file-is-own' | 'declared-only' | 'ignores-script-target' }): Extract<Source, 'approved' | 'own'>;

/* ================= 4. Head trust ================= */
export interface ProviderPush { commit: string; author: string; committer: string; recorded: { pusher: string | null; repo: string; fork: boolean } }
export interface PushReading { commit: string; pusher: string | null }       // push.record@1: the pusher the provider recorded; an empty actor stays empty
export interface PushRecordReader { id: string; read(pushes: ProviderPush[]): PushReading[] }
export interface PushKit { pushes: ProviderPush[]; expected: PushReading[] }
export function pushRecordKit(): PushKit;
export function runPushRecordKit(reader: PushRecordReader): { passed: boolean; failures: { commit: string; expected: string | null; got: string | null }[] };
export interface HeadInput {
  repo: string;                                     // a real git repository holding base..head
  base: string; head: string;
  recorded: string[];                               // commits recorded from a DeepBuild session
  yours: string[];                                  // accounts you named as yours
  provider: ProviderPush[];                         // the provider's record of each push into base..head
  reader?: PushRecordReader;                        // read for head trust only after it passes the kit
}
export type HeadPlan = { run: 'host' } | { run: 'sandbox'; network: false; credentials: false } | { run: 'blocked'; cause: 'untrusted head'; owner: 'you' };
export interface HeadResult {
  trusted: boolean;
  commits: { commit: string; trusted: boolean; via: 'session' | 'pusher' | null; pusher: string | null }[];   // every commit since base, oldest first
  plan: HeadPlan;                                   // untrusted: 'sandbox' when `sandbox` is available (default), else 'blocked'
  cause: 'untrusted head' | null;                   // what the claim names
}
export function headTrust(input: HeadInput, options?: { sandbox?: boolean; plant?: 'author-counts' | 'committer-counts' | 'empty-pusher-counts' | 'unvetted-reader' }): HeadResult;

/* ================= 5. Real execution: slots, snapshots, heavy commands, timing ================= */
export interface ExecCheck { id: string; argv: string[] }
export interface ExecuteOptions {
  repo: string;                                     // a real git worktree (may have uncommitted changes)
  session: string;                                  // the lease holder: `session:<ULID>`
  table: LeaseTable;                                // the real lease table; `cpu.slot` is half its cores
  checks: ExecCheck[];                              // run in turn per worktree, each in its own temporary checkout of the snapshot, each under a cpu.slot lease
  plant?: 'ignores-limit' | 'own-slot-queue' | 'runs-in-worktree';
}
export interface ExecutedCheck { id: string; lease: string | null; queued_at: number; started_at: number; ended_at: number; wall_ms: number; exit: number | null; output: string; cwd: string }
export interface Executed {
  snapshot: string;                                 // the claim's snapshot commit (HEAD on a clean worktree)
  checkout: string;                                 // the temporary checkout every check ran in
  snapshot_ms: number; checkout_ms: number;
  checkout_ready_at: number;                        // ms since the epoch
  checks: ExecutedCheck[];
}
export function executeClaim(options: ExecuteOptions): Promise<Executed>;

export interface Load { avg1: number; cores: number }
export interface VerdictMemory { dropEvidence(): void }
export function verdictMemory(): VerdictMemory;
export interface HeavyOptions {
  repo: string; session: string; table: LeaseTable;
  argv: string[];                                   // a full build or an e2e suite
  inputs: string[];                                 // globs; a last verdict is reused while none of them changed
  memory: VerdictMemory;
  /** The repo's own lease script `scripts/lease`, when the repo has one: run as `scripts/lease <argv…>` (it runs the command itself), after the cpu.slot lease is held. */
  timing?: boolean;                                 // a timing check: a failure records the machine's load
  load?: () => Load;
  plant?: 'own-slot-queue' | 'ignores-lease-script' | 'no-reuse' | 'no-load-reading';
}
export interface HeavyResult { reused: boolean; exit: number | null; outcome: 'passed' | 'failed'; lease: Lease | null; load: Load | null }
export function runHeavy(options: HeavyOptions): Promise<HeavyResult>;

export interface TimedRun { outcome: RunOutcome; under_load: boolean; load: number | null; cores: number; output: string }
/**
 * A timing check: a run that fails while the machine's load is above its core count is kept with its output and the load and is
 * `uncounted`; the check is rerun alone (load at or under the cores), and the runs alone decide as #28's do: a failed one starts two more.
 */
export function runTiming(check: { run(): { passed: boolean; output: string } }, machine: { load(): number; cores: number }): { outcome: Result; runs: TimedRun[] };

/* ================= 6. The stack a check ran against ================= */
export interface StackRecords {
  processes: { name: string; pid: number; cwd: string; reads: string[] }[];                                    // each host process the stack ran: working folder and files read
  containers: { name: string; binds: string[]; image: { name: string; built_from: { context: string; digest: string } | null } }[];
}
export interface Trees { checkout: string; digests: Record<string, string>; worktree: string; others: string[] }   // digests: the checkout's tree digest per build context path
export type Served =
  | { served: 'checkout' }
  | { served: 'other'; tree: string; named: string; kind: 'process' | 'mount' | 'image' }   // `named`: the process name, mount or image, and the tree it came from
  | { served: 'unknown'; named: string; kind: 'process' | 'mount' | 'image' };
export function attributeStack(records: StackRecords, trees: Trees, options?: { plant?: 'takes-environments-word' }): Served;

/* ================= 7. The scheduler: lanes, queue, hold, loops, on a virtual clock ================= */
export type Agent = 'claude' | 'codex-observed' | 'codex-woken';      // codex-observed can't be woken; codex-woken (app-server, paseo) and claude get a late verdict when it lands
export type Origin = 'human' | 'app' | 'answer' | 'continuation' | 'scheduled' | 'subagent' | 'session' | 'unknown';   // automatic: all but human, app and answer
export interface Config { budget_ms: number; hold_ms: number; slots: number; grace_ms: number; stop_timeout_ms: number }
export const DEFAULTS: Config;                    // { budget_ms: 10_000, hold_ms: 60_000, slots: 4, grace_ms: 60_000, stop_timeout_ms: 600_000 }
export interface Needs { cores: number; memory_mb: number; stack_slot: number; gpus: number }
export interface StackStep { name: string; median_ms: number; inputs: string[] }   // a start step: reruns when a changed path matches `inputs`, or no product of it is kept
export interface StackDef { steps: StackStep[]; per_run_ms: number; wait_ms?: number; kept: boolean; start(ctx: { attempt: number; kept_product: boolean; checkout: string; worktree: string }): StackRecords }   // `kept`: a product of its steps is kept
export interface RunContext { snapshot: string; attempt: number; run: number; started_ms: number; load: number; worktree_at(ms: number): string }
export interface CheckDef {
  id: string;                                       // 'lint', 'journey:checkout'
  on_base: 'fails' | 'passes';
  inputs: string[];                                 // declared globs; empty: the whole commit
  expected_ms: number;                              // the median of its last clean runs, from the stack's start leaves out
  deadline_ms?: number;
  runs?: number;                                    // clean runs needed; default 1
  needs?: Partial<Needs>;                           // defaults { cores: 1, memory_mb: 0, stack_slot: 0, gpus: 0 }
  stack?: StackDef;
  timing?: boolean;
  /** What a run does when it starts: the time it takes (a stack's start left out) and how it ends. Evaluated by the scheduler at the run's start; `worktree_at` is what a run in the live worktree would see. */
  run(ctx: RunContext): { took_ms: number; outcome: 'passed' | 'failed'; load?: number };
}
export type SortedAs = 'proceed' | 'provisional_ask' | 'completion_prompt' | 'deep_ask' | 'question_holds';   // how DeepBuild's own sorter answers the stop's last words
export interface LoopFacts { goal: 'none' | 'active' | 'paused' | 'complete'; heartbeat_due: number | null; wakeup_due: number | null; cron_due: number | null; subagent_report_due: number | null }   // absolute ms; null: none
export type ScriptEvent =
  | { at: number; kind: 'prompt'; origin: Origin }                                      // a turn begins
  | { at: number; kind: 'words'; via: 'typed' | 'app' | 'answer' }                      // your words, in a running turn
  | { at: number; kind: 'edit'; snapshot: string; changed: string[] }                   // the live worktree now holds `snapshot`
  | { at: number; kind: 'claim'; via: 'deep_claim' | 'gh_pr_create' }                   // a claim in the turn; waits for the turn's stop
  | { at: number; kind: 'facts'; facts: Partial<LoopFacts> }                            // loop facts learned from the session's tool calls
  | { at: number; kind: 'tool_call' }                                                    // the agent's next tool call: where a queued delivery is handed over
  | { at: number; kind: 'retention' }                                                   // evidence of every kept run is removed
  | { at: number; kind: 'stop'; snapshot: string; changed: string[]; checkout_ms?: number; sorted?: SortedAs; id?: string };   // a Stop hook's request; changed: paths since the session's last claim
export interface SessionScript { id: string; agent: Agent; ask?: string; checks: CheckDef[]; events: ScriptEvent[]; facts?: Partial<LoopFacts> }   // checks in the definition's order
export interface Scenario { config?: Partial<Config>; sessions: SessionScript[]; foreign?: { at: number; ms: number; slots: number }[] }   // foreign: slots another session (not scripted) holds
export type SchedulerPlant =
  | 'hold-sized-by-own-time' | 'definition-order' | 'sums-times' | 'reply-at-first-verdict' | 'ignores-fast-lane-budget'
  | 'stops-run-on-newer-snapshot' | 'queues-every-green-snapshot' | 'ignores-fast-lane-results' | 'starts-on-every-green-stop' | 'starts-beside-fast-lane'
  | 'checks-delivery-at-queue' | 'queues-every-check' | 'finishes-older-runs' | 'runs-in-worktree' | 'reruns-every-check' | 'ignores-loops' | 'waits-grace-not-facts'
  | 'holds-claim-stop-for-loop' | 'words-only-at-turn-start' | 'holds-every-loop-check' | 'starts-at-question-stop' | 'holds-only-the-hold-length'
  | 'one-reason-per-record' | 'takes-environments-word' | 'sizes-lane-by-run-alone' | 'leaves-host-empty' | 'fast-lane-waits';
export function simulate(scenario: Scenario, options?: { plant?: SchedulerPlant }): Trace;

export interface Held { total: number; question: number; slow: number; fast: number; snapshot_start: number; queue_wait: number }   // ms; the parts sum to total
export interface StopReply {
  session: string; stop: string;                    // `id` of the stop event, else `<session>#<n>` from 1
  at: number;                                       // the Stop hook's request
  reply_at: number;
  ends_turn: boolean;
  kind: 'ends_turn' | 'send_back' | 'proceed' | 'provisional_ask' | 'completion_prompt' | 'deep_ask' | 'question_holds';
  line: string;                                     // the one verdict line in the chat
  counted: string[];                                // the checks whose results the line counts (ended on the claim, carried ones too)
  verdict: Result;                                  // the claim's verdict as it stands at reply_at
  admitted: string[]; slow: string[];               // the fast lane's checks, and those the budget left to the slow lane; checks carried to this claim are in neither
  claim: string; snapshot: string;
  held: Held;
  code_changing: boolean;                           // the snapshot changed the inputs of at least one check
  budget_cost: string[];                            // the checks the budget left to the slow lane that the hold alone would have run
}
export interface RunRecord {
  run: string; session: string; check: string; claim: string; snapshot: string;
  lane: 'fast' | 'slow';
  queued_at: number | null; started_at: number; ended_at: number;
  outcome: RunOutcome;                              // passed, failed, uncounted, missing, stopped, …
  took_ms: number;                                  // a stack's start left out
  host: string; needs: Needs; expected_ms: number | null;   // expected_ms: for the lanes, a stack's start included
  started_by: 'fast_lane' | 'turn_end' | 'loop_paused' | 'claim' | 'words' | 'answer' | null;
  stale_by?: { origin: Origin; at: number };        // a slow run that ended after a newer claim: the prompt that outdated it
  stack?: { steps: { name: string; ms: number }[]; from: 'checkout' | 'worktree'; served: Served; attempt: number; kept_product: boolean };
  reason?: string;                                  // uncounted or missing: names the process, mount or image and its tree
  under_load: boolean; load: number | null;
  ran_in: 'checkout' | 'worktree';
  result_snapshot: string;                          // the snapshot the result reports on
}
export interface QueueEvent { at: number; session: string; check: string; snapshot: string; op: 'queued' | 'replaced' | 'emptied' | 'held' | 'started'; by?: string }
export interface HeldRecord { session: string; check: string; snapshot: string; held_at: number; reason: string; started_at: number | null; started_by: 'loop_paused' | 'claim' | 'words' | 'answer' | null; replaced_by: string | null }
export interface Delivery { at: number; session: string; claim: string; check: string; snapshot: string; result: Result; how: 'woke' | 'sent_back' | 'held_reply' | 'next_tool_call' | 'next_prompt' | 'recorded_only'; stale: boolean; carried: boolean }
export interface CheckOnClaim { outcome: Result; runs: string[]; carried_from: string | null; carried_runs: string[]; stale: boolean; never_started: 'quick_check_failed' | 'kept_working' | 'loop' | 'newer_claim' | null; late: { snapshot: string; outcome: Result; stops_back: number } | null }
export interface ClaimRecord { claim: string; session: string; source: ClaimSource; snapshot: string; at: number; stale: boolean; verdict: Result; checks: Record<string, CheckOnClaim>; line_at_reply: string; line: string }   // line: the claim's line as it reads at the end, with late results named
export interface Trace {
  stops: StopReply[]; runs: RunRecord[]; queue: QueueEvent[]; held: HeldRecord[]; deliveries: Delivery[]; claims: ClaimRecord[];
  stacks: { run: string; at: number; from: 'checkout' | 'worktree' }[];   // a stack started, and for which run
  peak_running: number; max_running_by_ask_check: number; ended_at: number;
}
```
<!-- SURFACE:END -->

## The scheduler's rules (what `simulate` holds, and each plant breaks)

A tick is a millisecond. A stop `at` T makes a claim on `snapshot`; its checkout is ready at R = T + `checkout_ms` (default 0).

1. **Carrying.** `changed` is the paths since the session's last claim (empty, or the same snapshot: nothing). A check's inputs
   changed when it declares none and `changed` is not empty, or a changed path matches one of its globs (`**` any number of
   segments, `*` within one), or a changed path matches no declared glob of any check on the claim (then every check's did).
   A check whose inputs did not change is not run again: its last result carries to the claim, marked carried and listing
   the runs it carries (`carried_from`, `carried_runs`), as long as that result's run is kept (evidence not removed by a
   `retention` event); a run still going carries too, and its result becomes the new claim's when it lands.
2. **Fast lane.** The stop's checks that must run are taken in turn: `on_base: fails` first, then the rest, each group shortest
   first by expected time (a check's `expected_ms` plus, with a `stack`, the start it needs now: the median of each step whose
   `inputs` match `changed` or whose product is not kept, plus `per_run_ms`, plus `wait_ms`), ties in the definition's order.
   A check is admitted when `start + expected ≤ T + budget_ms`, where start is the later of R and when a slot is free
   (the `slots` slots shared by every session and `foreign` holds, minus the checks already admitted for this stop); a check
   that doesn't fit goes to the slow lane and the next is still tried. Admitted checks run from R on the earliest free slot.
3. **Hold.** The reply is sent once: when every admitted check on the stop has ended, or at T + `hold_ms`, whichever is first
   (T + `checkout_ms` when none is admitted, T when nothing changed). It carries the claim's verdict as it stands and a line:
   `PASS n/n · receipt`, `sent back k/n: …` (k failing of n counted), or, with checks still going, `N check(s) running · about
   D` (D: the largest expected time among them, with the start a stack needs, in whole minutes, at least 1, rounded to the
   nearest) and `N check(s) waits for the loop · <reason>` for held ones (reasons: `goal active`, `heartbeat`, `wake-up`,
   `cron`, `subagent`, `no prompt foreseen`). `counted` lists the checks the line counts.
4. **Reply kind.** FAIL or INVALID among the fast-lane results: `send_back`, unless `sorted: 'question_holds'` (no send-back,
   held no longer than its fast lane, the whole hold recorded as `question`). Otherwise `sorted` (`proceed`,
   `provisional_ask`, `completion_prompt`, `deep_ask`) keeps the agent working: no slow run starts on the snapshot. Otherwise
   `ends_turn`.
5. **Slow runs start when the turn ends.** A slow-lane run for a snapshot joins the queue only once its fast-lane checks all
   ended with none FAIL or INVALID and the reply was `ends_turn`: queued at the reply time and started the moment a slot is
   free and the check has no run going on the ask (a check has at most one running and one queued per ask). A claim made by
   a `claim` event waits for its turn's stop. A slow check that never started on a claim's snapshot is pending there
   (`never_started`: `quick_check_failed`, `kept_working`, `loop` or `newer_claim`). No stack starts for a run that may not
   start: `Trace.stacks` holds a start per run that started.
6. **Latest snapshot wins.** A run in flight is never stopped for a newer snapshot: it ends and reports on its own snapshot
   (`result_snapshot`). A newer claim that changes the check's inputs takes the check's queued place when its snapshot may
   start a slow run, and otherwise empties it (`queue` `replaced` / `emptied`); once it does, no further run starts on the
   older snapshot (the runs it still needs, or two more after a failure). A newer claim that changes none of the check's
   inputs queues nothing and the run going on carries to it. For a check that needs `runs: n` clean runs, a first run going
   when a newer claim changes its inputs finishes and its next runs start on the newer snapshot once that snapshot's stop
   ended its turn green.
7. **Stale results.** A result is delivered to its session only while its claim is the newest on its ask, checked when the
   delivery goes out. A result that carries to the newest claim is delivered as its own, `carried`; one that doesn't stays on
   its claim (`stale`), never wakes the session or sends it back (`recorded_only`), and the newest claim's check shows it in
   `late`, with its line naming the check, the result, its snapshot's first 7 characters and how many stops back
   (`journey:checkout running · FAIL on 3f2a1c0, 3 stops back`). A late result that lands for the newest claim is delivered:
   `woke` / `sent_back` (a FAIL, on a session that can be woken), `held_reply` (inside a held stop's reply), `next_prompt`
   (a session that can't be woken, between stops).
8. **Observed Codex.** A `codex-observed` stop whose reply would end the turn and whose slow checks start at that stop is held
   until they land (a check's deadline counted from when the fast lane ended, and only when that deadline ends at least 5 s
   before `stop_timeout_ms`); its reply then carries the final verdict (a FAIL is a send-back in the same turn). Any other
   `codex-observed` stop, and every `claude` and `codex-woken` stop, replies when its fast lane ends.
9. **Loops.** A turn is looping when its prompt's origin is `continuation`, `scheduled`, `subagent`, `session` or `unknown`
   (every origin but `human`, `app` and `answer`) until its loop pauses. At a looping session's stop that is green and ends
   the turn, each slow check takes its queued place and is **held** (`held` record, `queue` `held`, never `started`) instead of
   starting, unless the loop pauses for it: the next automatic prompt is foreseen from the facts (`wakeup_due`,
   `heartbeat_due`, `cron_due`, `subagent_report_due`; an active `goal`, or a prompt no fact foresees, counts as due
   `grace_ms` after the reply), and the check starts when its expected queue wait plus expected time ends no later than that;
   with `goal` not `active`, and no wake-up, heartbeat, cron job or subagent, none comes and the loop has paused: it starts
   at once. A held check follows latest wins (`replaced_by`). A held check starts (`started_by`) when a `facts` event shows
   the loop paused for it, when the grace window after the reply ends with no automatic prompt (`loop_paused`), at the
   green stop of a turn that made a claim (`claim`), or at the first green `ends_turn` stop after your words (`words`, or
   `answer` once an answer of yours is delivered). A looping stop admits fast-lane checks as any stop and is held for those
   alone (`held.slow` 0). A question that holds the send-back (`question_holds`) doesn't start held checks.
10. **Held time.** `held.total` = `reply_at − at`, split by the first reason that applies to each moment: `question` (the
    whole hold of a `question_holds` stop), `slow` (once the fast lane ended, while a stop that can't be woken waits for its
    slow checks), `fast` (while any admitted check runs), `snapshot_start` (the validity gate, the claim's snapshot and
    checkout, a stack's start), `queue_wait` (while its checks wait only for a slot). The parts sum to the total.
11. **Run records.** Each run records `host` (`local`), `needs` (the check's declared, defaults filled), `expected_ms` and
    `took_ms` (a stack's start left out), `started_by` and, for a slow run that ended after a newer claim, `stale_by`.
12. **Planted worktree runs.** `runs-in-worktree` makes a run `ran_in: 'worktree'` and its `ctx.snapshot` the snapshot `worktree_at` holds when the run ends; a correct run is `ran_in: 'checkout'` on its claim's snapshot.
13. **Queued deliveries.** A result that lands while a Claude session is working is queued for the next `tool_call` event (`how: 'next_tool_call'`); delivery is checked when it goes out, not when queued (plant `checks-delivery-at-queue`).
14. **The stack.** A run with a `stack` gets one started by `start({attempt, kept_product, checkout, worktree})` from the
    run's own checkout; the core works out the tree it served with `attributeStack` and records it. A run whose stack served
    another tree is `uncounted`, naming the process, mount or image and the tree; the check's next run on that snapshot, when
    one may still start, gets a stack with `kept_product` false (attempt 2), and when that serves another tree too, the run is
    `missing` and the check BLOCKED. A run whose stack served the checkout counts.

## Open points (choices the issue and design leave open; tests assert structure, not wording)

1. **What a cite is.** `floor` reads a message's backticked spans: a span that equals, or starts with, a command the session ran
   is a cited run; one matching `^https?://` or `^[\w./@-]+#[\w-]+$` a link (it resolves when it is in `session.links` or its
   path part is a file of the checkout); one `path` or `path:line` a file or line (it resolves when the file exists in the
   checkout and, for a line, has that line; it was read when the path is in `session.read`); one of the form `path › name` a
   test (the file exists and its text contains name; it was read or run when the file is in `session.read` or a session run's
   command or output names it). Words outside backticks never decide anything. A finding's `why` contains its `ref` verbatim.
2. **Wording.** Nothing is matched exactly except the strings the issue quotes: "exit status masked by `|| true`" (as
   `exit status masked by \`<mask>\`` with the mask `maskIn` returns), "1 check running · about 1 min", "1 check running ·
   about 2 min", "1 check waits for the loop", and `journey:checkout running · FAIL on 3f2a1c0, 3 stops back`, of which the
   check, the result, the snapshot's 7 characters and "3 stops back" are required. A line counting both checks of AC20 contains
   `1/2`. Reasons name what they name by containment.
3. **The masked-exit rule** is `maskIn` of `@deepbuild/checks-command` (the one the core holds); `floor` names the mask it
   returns and a package script, Makefile or justfile target a cited command runs counts too.
4. **The lease script** is `scripts/lease` in the repo, executable, run as `scripts/lease <argv…>` once the `cpu.slot` lease is
   held; it runs the command itself, as `flock` does. Where the repo has none, the command runs directly.
5. **The cpu.slot pool** is the table's `cpu.slot` kind (half the cores it was opened with); `executeClaim` and `runHeavy`
   take their slot from it as the holder `session`, never from a queue of their own, so it shows in `table.leases()`.
6. **Own files.** A file is a check's own when the check's `reads` name it and it lies under a folder named `test`, `tests`,
   `fixtures`, `__fixtures__`, `__snapshots__` or `scripts`, or when a glob in `declares` matches it, or when the diff changed
   the declared script target's text. A read file elsewhere (`src/cart.ts`) is code under test: an input, never own.
7. **Head trust** needs a reading for every commit since the base that is not recorded; a commit is trusted when it is in
   `recorded` or its reading's pusher is in `yours`; the author and committer fields of the real commit are never read.
8. **The first snapshot id.** Scenario snapshot ids are any strings; the line shows their first 7 characters.
9. **Timing and the hub.** The scheduler is pure; the hub drives it from its stops. Tests of the hub (AC1) read the record's
   `claim.made` events (`task_ref`, one per ask a stop touched) through `events.read`.
11. **Stack records.** `containers[].binds` are plain host paths. For an image whose build context digest differs from the checkout's, `attributeStack` returns `served: 'other'`, `kind: 'image'`, naming the image; which tree it names isn't asserted.
12. **Scheduler details left open.** `started_by` for a claim- or heartbeat-triggered start may read `claim`/`loop_paused` or `turn_end` (only `words`, `answer` and the grace-window `loop_paused` are pinned); whether a `question_holds` stop makes a held place of its own isn't asserted (no journey starts on its snapshot); `goal` defaults to `none`; a pending line names each running, queued or held check as `N check(s) running|queued|waits for the loop`, with `about` when pending; how a verdict that lands after a loop pause reaches an observed Codex session isn't asserted.
13. **"Touched".** The hub tests take an ask as touched when the turn did work while it was open; the pure `claimsFor` takes `touched` as given. `deep_claim` and `gh pr create` are tested only through `claimsFor` (`gh pr create` meets an authority hold through deep-hook).
10. **Budgets.** The merge base has no gate runner, so "compared with the merge base" has nothing to compare; AC18 holds the
    absolute limits on a reference Mac and the p50 comparison belongs to the perf lane once a base has the runner.

## Criteria to tests

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs the planted twin
through the same assertion and asserts that it fails.

| IDs | Criteria | File |
|---|---|---|
| AC1 | one claim per open ask per source | `claims.test.ts` (pure, with plants); `hub.test.ts` (stop path through the real hub and deep-hook) |
| AC2, AC19, AC20, AC25, AC26 | slow check pending then delivered; unchanged sources reuse; 2 s and 8 s hold; 70 s check; the $18.01 lanes | `lanes.test.ts` |
| AC3 – AC7 | citations, deliverables, hash INVALID, masked exit, safe mode | `floor.test.ts` |
| AC8, AC9, AC10 | ten worktrees, cpu.slot lease and lease script, reuse of a heavy verdict | `slots.test.ts` |
| AC11 | timing check under load | `timing.test.ts` |
| AC12, AC23, AC27 – AC31 | retention, snapshot wins, four stops, slow starts, stale delivery, carried, 3 clean runs | `queue.test.ts` |
| AC13 – AC17 | head trust and the `push.record@1` kit | `head.test.ts` |
| AC18 | budgets on the reference Mac | `budgets.test.ts` |
| AC21, AC22 | whose checks count | `own.test.ts` |
| AC24, AC32, AC41 | the 30-session replay | `replay.test.ts` |
| AC33, AC34 | stack tree, warm-stack lanes | `stack.test.ts` |
| AC35 | held time and its split | `held.test.ts` |
| AC36 – AC40 | loops | `loops.test.ts` |

Other files: `helpers.ts` (shared), `h-a.ts`, `h-c.ts`, `h-d.ts` (per-group helpers), `fixtures/agent.mjs`, `tsconfig.json`, `BASE-FAILURE.txt`.
