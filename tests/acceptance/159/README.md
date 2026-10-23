# Acceptance tests for #159: the runner, DeepBuild's own headless Claude Code and Codex jobs, apart from your sessions

Written first, blind, from issue #159 (its text as of October 22, 2026: Scope, the 20 checkbox criteria, Proof and
Depends on #16, #348, #349, #18, #47, #48, #236), the issues it names (#3, #39, #47, #50, #54, #63, #71, #81, #87,
#102, read for scope only, with their state at this base), `docs/technical-design.md` (Hooks are evidence, not a
state machine, with DeepBuild's own jobs and Facts as data; Blocks for plug-ins that do real work, its Runner; How
it installs, The hub and Platforms; Decided, the row DeepBuild's own headless jobs; How we know version 0 works,
with Fault injection, Unknowns survive, Wrong programs, Criteria to tests both ways and Dogfooding; Parallel
sessions and plan limits, Plan usage per account and per task; the Budget and Ask primitives),
`adapters/claude-code.facts.json` (`launch.readOnlyJob`, `versions`, `usage`, `stop`, `billing`, `signIn`),
`packages/contracts/schemas/agent.stop@2.json` (the stop's closed set), `AGENTS.md`, the acceptance tests of #236
(README, helpers, contain and blocked tests) and of #16 and #318 for their conventions, and the base commit
`2ccdfd6`, which carries #236's supervisor (PR #676), by a job that never saw an implementation of #159. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 20 checkbox criteria, AC1 to AC20 in the body's order. #236's AC4 has a runner half that
`tests/acceptance/236/blocked.test.ts` leaves BLOCKED until this surface exists; it is tested here too, as
`#236 AC4`.

## How to run

On macOS (Seatbelt is the sandbox the supervisor uses), with the repo's Node (`.node-version`, 24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # hub.test.ts runs the built CLI, packages/cli/dist/main.js
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/159
node node_modules/typescript/bin/tsc -p tests/acceptance/159/tsconfig.json   # needs packages/runner
```

- `--no-file-parallelism`: the files start real hubs, sandboxed process trees and timed jobs.
- `budgets.test.ts` builds `deep-hook` with `cargo build --locked -q -p deep-hook` when `target/debug/deep-hook` is
  missing; a machine without cargo fails those tests BLOCKED, naming the build.
- Nothing needs the network, a real `claude`, a sign-in or a model call. Every `claude` is the fake in
  `fixtures/fake-claude.pl` (The fake CLI, below), installed by the test as a file named `claude` in a folder of its
  own; every "API host" and "hub socket" is a listener the test runs; the hub is a dev hub (`deep hub run --root`).
- Every test makes its folders under `/tmp/dh159-*` (short real paths; Seatbelt matches real paths), sets `HOME`
  to a temp folder holding a fake Claude Code sign-in (`~/.claude.json` with an `oauthAccount.accountUuid`,
  `~/.claude/.credentials.json` with made-up tokens) for itself and every child, removes the agent's own
  `CLAUDE*`, `DEEP_*` and `ANTHROPIC_*` variables from its environment first, and never touches the real
  `~/.deepbuild`, `~/.claude`, the keychain, launchd or a login service. The four nesting variables
  (`CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION`, `CLAUDE_CODE_PARENT_SESSION`) are set in every
  hub's environment and every library runner's (and in the test process's while a library world is open), as a
  hub started from a Claude Code terminal has them; the fake refuses to start when `CLAUDECODE=1` reaches it, as
  Claude Code does, so a leak fails whichever test it happens in.
- It stops only processes it started, by PID: the hubs it spawned, and the processes running a program from a
  folder this test process made (the fakes its jobs launched), with their own process groups (`helpers.ts`,
  `cleanup`); never by name or port.
- Vitest may write a cache to `tests/acceptance/159/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue names the runner, jobs, run tokens, a status line command, window readings per account, a reserve, an
unblock ask and stop causes, but no code API. The design names `deep.runner.run(job)` (Blocks for plug-ins: the
Runner, which "lands in R1, where it starts DeepBuild's own headless jobs") and puts the runner in the hub's trusted
ring, starting every process through the supervisor. These tests define the smallest surface that reaches every
criterion, with those names:

1. **`@deepbuild/runner`, a new workspace package, through its public entry `packages/runner/src/index.ts`.** The
   drafting job (#81, #50), wiki reads (#54), reading by reference (#63), the review check (#87), the smoke test,
   and later the plug-in API (#102) and model plug-ins (#71) all start jobs through it, so it is a package of its own
   rather than code inside the hub daemon or an extension. It starts every job's processes through
   `@deepbuild/supervisor`'s host@1 (`Supervisor.start`, so each runs in the platform sandbox with a run token and
   its own group), reads windows and budgets from the record, the asks core and the budget ledger, and reads the
   agent's launch, versions, counting rules and stop causes from its facts file (`adapters/*.facts.json`). The hub
   opens it on its own record and supervisor.
2. **The hub (#16)**, through `deep hub run --root`, its socket and the files under its root, as #16's and #236's
   tests reach it: the hub opens the runner and records hooks as jobs' events.
3. **The status line forwarder**, `deep-hook statusline` (the hook client, `crates/deep-hook`): the only part
   that runs on every status line update, so it is native, as the 1 ms budget needs.
4. **The record (#14), the asks core (#318), the budget ledger (#86) and the supervisor (#236)** as they are at
   the base: `openRecord`, `read`, `table`, `session`; `openAsks`, `answer`, `needsYou`; `openLedger`, `approve`;
   `openSupervisor`, `start`, `wait`, `cleanup`.

### `packages/runner/src/index.ts`

```ts
import type { RecordStore } from '@deepbuild/record';
import type { Asks } from '@deepbuild/asks';
import type { Ledger } from '@deepbuild/budget';
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
  prompt: string;                              // on the agent's stdin; the runner may add its own instructions, nothing else
  model?: string;                              // the model to launch; default the facts' readOnlyJob launch
  account?: string;                            // the account it runs on; default the one the agent records beside your sign-in
  issue?: string;                              // the issue it serves: what a budget's scope covers
  task?: string;                               // `task:<ULID>` and `claim:<ULID>` waiting on it, which show BLOCKED while it waits
  claim?: string;
  checkout?: { repo: string; commit: string }; // when it needs code: its folder is a checkout of this commit of this repo
  mcp?: Record<string, McpServer>;             // the only MCP servers it gets
  leases?: { kind: string; key?: string }[];   // held through the supervisor while any of its processes runs
  deadline_ms?: number;                        // from its start; the deadline stops the group
  output_timeout_ms?: number;                  // how long it may print nothing while the platform reports no CPU or disk use
}
/** The stop's closed set (agent.stop@2, adapter.facts@1's stopCause). */
export type StopCause =
  | 'sign_in_required' | 'token_refresh_failed' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns'
  | 'context_overflow' | 'tool_schema_rejected' | 'agent_crashed' | 'timed_out' | 'unknown';
/** waiting: recorded, not started (`blocked` says on what); stopping: a stop sent and not yet confirmed;
 *  stopped: every process of the job proven gone after a stop; lost: found after a crash and reported, not run. */
export type JobState = 'waiting' | 'running' | 'stopping' | 'stopped' | 'finished' | 'refused' | 'lost';
export interface Blocked { status: 'BLOCKED'; cause: string; owner: 'you'; since: number; on: string[]; account?: string; ask?: string }
export interface JobRecord {
  job: string;                       // `run:<ULID>`: the job's run, as the supervisor and sandbox.denied name it
  kind: JobKind; agent: Agent; account: string | null;
  state: JobState;
  blocked?: Blocked;                 // while waiting: cause 'plan window', 'first reading', 'budget', …; `on` lists the task and claim
  refused?: string;                  // why it never started, naming what refused it (the covered range, the version, …)
  folder: string;                    // its own folder under <root>/jobs/, kept after it ends
  binary?: { path: string; version: string };   // the binary it resolved on the login shell's PATH, and its version
  pid?: number; pgid?: number; start?: string;  // recorded before the prompt is written
  session?: string;                  // the session ID read from its own output
  model?: string;                    // the model that answered, from its output as the facts say, or 'unknown'
  stop?: { cause: StopCause };
  usage?: { input: number; cached: number; output: number };
  cost_usd?: number;
  lingered?: string[];               // what was still running after its final result's grace, each naming its PID
  result?: string;                   // the final result's text
}
/** A window snapshot an agent reported locally, in the agent's own shape: Claude Code's status line `rate_limits`
 *  (`five_hour`/`seven_day`: `used_percentage`, `resets_at` in Unix seconds); a Codex token event's `rate_limits`. */
export interface WindowReport { agent: Agent; account: string; rate_limits: unknown }
/** The planted wrong programs these tests select; tests only. */
export type Plant = 'records-launched-model' | 'checkout-of-session-head' | 'worktree-of-mirror' | 'widens-range-on-smoke';
export interface RunnerOptions {
  record: RecordStore; asks: Asks; supervisor: Supervisor; ledger: Ledger;
  now: () => number;                 // the clock of records, windows, waits and daily counts (processes and graces are real time)
  root: string;                      // the hub's root (~/.deepbuild): jobs run in <root>/jobs/<run token>/
  loginPath: string;                 // the login shell's PATH that setup recorded
  env: Readonly<Record<string, string | undefined>>;   // the hub's environment, which the allowlist filters; HOME is your sign-in home
  settings: { plan: { reserve_pct: number }; asks: { unblock: { deadline_ms: number } } };
  plant?: Plant;
}
export interface Runner {
  submit(spec: JobSpec): Promise<JobRecord>;   // records it, then starts it if it may; resolves once recorded and started, waiting or refused
  wait(job: string): Promise<JobRecord>;       // its end: finished, stopped, refused or lost
  run(spec: JobSpec): Promise<JobRecord>;      // deep.runner.run(job): submit, then wait
  status(job: string): Promise<JobRecord>;
  cancel(job: string): Promise<JobRecord>;     // stops its group; resolves with the job as it reads then
  output(job: string): Promise<string>;        // its stdout, as the runner read it
  report(reading: WindowReport): Promise<void>;
  tick(): Promise<void>;                       // re-reads the clock, windows, answers and budgets, and starts what may start
  close(): Promise<void>;
}
export function openRunner(options: RunnerOptions): Promise<Runner>;
```

Nothing else is needed: no option, flag or export beyond these. What the tests hold it to:

- **Launch.** Claude Code is launched from `launch.readOnlyJob` in its facts, its prompt on stdin, its stream-json
  read as Claude Code prints it. The tests don't read the flags: the fake acts on them as Claude Code does, and the
  tests read what it then did.
- **Where.** `JobRecord.folder` is under `<root>/jobs/`, is the job's working folder, is the base-commit checkout
  when the spec names one, and is still there after the job ends (AC5 searches it, AC19 runs `git log --all` in it).
- **Process.** Every process of a job is started through the supervisor it was given; a job holds the `leases` its
  spec names through it.
- **Clock.** Windows' resets, the 30 minutes without a reading, the daily count and the 60 s to start after a reset
  or a reading run on `now`. The tests move the clock and call `tick()`, as the hub does on its own cadence, and say
  "within 60 s" as: after the clock moves 60 s in 10 s steps with a tick at each, the jobs have started. "At once"
  is real time: a process within 5 s of `submit`, with no tick.

### The hub

- **At start** the hub opens the runner on its own record, asks core, ledger and supervisor, with `root` its
  `--root` folder (the installed hub's is `~/.deepbuild`), `env` its own environment, and the settings it reads
  from **`<root>/config.json`**: `{"runner": {"login_path": "<PATH>"}, "plan": {"reserve_pct": 10}}`, where setup
  records your login shell's PATH and your reserve.
- **Methods** on its socket, for the `app` and `cli` roles: `job.submit` `{spec}` → `JobRecord`; `job.status`
  `{job}` → `JobRecord`; `job.list` `{}` → `{jobs: JobRecord[]}`; `job.output` `{job}` → `{stdout}`. And
  `windows.report` `{agent, account, rate_limits}` → `{}` for `app`, `cli` and the hook role (a connection whose
  first line is a method call), which the status line forwarder sends.
- **Hooks.** A hook request whose `session_id` is one the runner read from a job's own output, stamped (`seq`)
  inside that job's run, is appended as **`job.event@1`** (`data.job`: the job's `run:<ULID>`; `data.event`: the
  hook's event name, such as `Stop`), never as the session's own kinds and never with the session's ID as the
  event's `session`, so the record makes no session row, claim, verdict or spend from it. A job's hook that
  arrives before the runner has read its session ID reads the same way once it has. Any other hook is the
  session's, as at the base, whatever its `cwd`; a session that moves into a job's folder, or resumes a finished
  job's session ID, gets a reading (the record's `session_readings`) naming the job's ID or its folder.
- **`DEEP_HUB_TEST_CRASH=job.recorded|job.started`** (test only): the hub kills itself with SIGKILL right after
  the first job it handles is durably recorded (`job.recorded`), or right after its process is started and
  recorded and before the prompt is written (`job.started`).

### The status line forwarder

`deep-hook statusline` reads Claude Code's status line JSON on stdin, sends its `rate_limits` to the hub at the
address setting (`hub.address` in `~/.deepbuild/config.json`, #16) as one `windows.report` line naming
`agent: 'claude-code'` and the account Claude Code keeps beside its login (`oauthAccount.accountUuid` in
`~/.claude.json`), then runs your own status line command, which setup recorded as `statusline.yours` in
`~/.deepbuild/config.json`, with the same stdin, and prints its output unchanged. It makes no network call.

### The fake CLI

`fixtures/fake-claude.pl` (`/usr/bin/perl`, so it runs inside Seatbelt with only the system's own runtime) is what
every test installs as `claude`, with its version baked in. It answers `--version` (`<version> (Claude Code)`) and
`auth status` (`loggedIn: true`), refuses to start when `CLAUDECODE=1` reaches it, and for a headless run (`-p
--output-format stream-json --verbose`, prompt on stdin) prints stream-json shaped as Claude Code's own:
`system/init` (`session_id`, `model`, `tools`, `mcp_servers`, `permissionMode`, `apiKeySource`,
`claude_code_version`), assistant messages (`message.id`, `message.model`, `message.usage`), and `result`
(`subtype`, `is_error`, `result`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`). From
its flags and files alone it does what Claude Code does with them: without `--strict-mcp-config` it also loads the
user's servers (`~/.claude.json`) and, with project settings, `.mcp.json`; it starts each stdio server in its
folder; it loads the folder's `.claude/settings.json` (running its SessionStart hooks, reported as
`system/hook_response`, and applying its `env` block, then connecting to `ANTHROPIC_BASE_URL` as an API call
would) only when `--setting-sources` names `project` or is absent; and its Write tool works only with a bypass flag,
`acceptEdits` or an allow rule, and is otherwise a permission denial listed in the result. What it does in a run
comes from `@` lines in its prompt (`@env`, `@read`, `@write`, `@sleep`, `@busy`, `@linger`, `@spawn-sleeper`,
`@keep-writing`, `@ignore-term`, `@close-output`, `@session`, `@delay-init`, `@answered-by`, `@chatter`; the file's
head lists them), and it reports each as an assistant text `fake:<JSON>`, the first always its argv, version, PID,
folder and the stdin it read.

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#159.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped). A test headed
`(wrong program)` runs the same scenario against the planted twin the criterion names and expects it to fail as
the criterion says; a test headed `(… half)` is the part this surface reaches, with the rest in `blocked.test.ts`.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#159.bbb96a19` | a drafting job and a review check leave no session, claim, verdict or spend; hooks are the job's events | `hub.test.ts` AC1 (1): jobs of kind draft and review through the hub; `blocked.test.ts` AC1 (1): the real drafting job and review check | fail; the second stays BLOCKED until #50/#81 and #87 |
| AC2 `#159.80a97ac6` | three user-level MCP servers; the init event lists only the spec's | `launch.test.ts` AC2 (1) | fails (no package) |
| AC3 `#159.28457d78` | a write refused by read-only mode; the refusal is the stop cause | `launch.test.ts` AC3 (1) | fails (no package) |
| AC4 `#159.5c468614` | a hub inside a Claude Code session launches `claude`; no nesting variable reaches it | `hub.test.ts` AC4 (1) | fails (`job.submit` unknown) |
| AC5 `#159.f8c5a2e9` | no credential file or token in the folder; sign-in files byte-identical | `isolation.test.ts` AC5 (1) | fails (no package) |
| AC6 `#159.0a463d06` | the login shell's `claude` of two, path and version recorded; an uncovered version refused naming the range | `launch.test.ts` AC6 (1) | fails (no package) |
| AC7 `#159.7555bf15` | a lingering CLI stopped with its group after the 5 s grace, recorded; a busy quiet one keeps running | `lifecycle.test.ts` AC7 (1) | fails (no package) |
| AC8 `#159.975793ea` | with `ANTHROPIC_API_KEY`, no start without a covering budget, naming the key | `plan.test.ts` AC8 (1) | fails (no package) |
| AC9 `#159.3aa5fd4e` | a hub killed after recording or after starting finds the job, reaps or reports it, never runs it twice | `hub.test.ts` AC9 (1): both crash points | fails (`job.submit` unknown) |
| AC10 `#159.fe8b9734` | a session in a job's folder or on a job's session ID is itself; a job's early hook is the job's | `hub.test.ts` AC10 (1); `blocked.test.ts` AC10 (1): held, judged, claim and spend | fail; the second stays BLOCKED until #25 and #18 |
| AC11 `#159.1cc6000c` | 92% used, 10% reserve: no process, BLOCKED plan window; reset: both within 60 s; another account at once | `plan.test.ts` AC11 (1) | fails (no package) |
| AC12 `#159.efc3ed4c` | no reading yet: no process, waiting for the first; a reading with room: both within 60 s | `plan.test.ts` AC12 (1) | fails (no package) |
| AC13 `#159.f24927a9` | the checkout's SessionStart hook and env block reach nothing | `launch.test.ts` AC13 (1) | fails (no package) |
| AC14 `#159.9e5f5a51` | 30 minutes with no reading: one unblock ask, two answers, never repeated; 11th job waits | `plan.test.ts` AC14 (1): both answers | fails (no package) |
| AC15 `#159.75e393da` | conflicting work waits for the job's processes; unconfirmed stop reads stopping; swapped binary never runs | `lifecycle.test.ts` AC15 (1): after a result, a cancel, a lost connection; a swap between jobs and during the `--version` check | fails (no package) |
| AC16 `#159.df0e6721` | markers in transcript, diff, claim and PR body; the drafting job holds none, the review only the diff's | `isolation.test.ts` AC16 (2): the runner's half; its wrong program; `blocked.test.ts` AC16 (1): the job kinds' half | fail; the third stays BLOCKED until #50/#81 and #87 |
| AC17 `#159.52a561ec` | the model the output names, or unknown | `launch.test.ts` AC17 (2): the run; the wrong program | fails (no package) |
| AC18 `#159.3803772d` | 300 ms start, 5% parsing, 30 MB per job, 1 ms per status line update, vs the merge base | `budgets.test.ts` AC18 (4): the perf lane's tasks; the bench runs; the forwarder; the numbers on the reference Mac | fail; the numbers are skipped INCONCLUSIVE off the reference Mac |
| AC19 `#159.d02d2b08` | the session's worktree, transcript and hub.sock unreadable from a drafting job; `git log --all` only the base's history | `isolation.test.ts` AC19 (2): the run; the wrong program | fails (no package) |
| AC20 `#159.641cb71a` | an uncovered version: the smoke test under one standing approval and the reserve; the range never widened by its own run | `plan.test.ts` AC20 (2): the runner's half; its wrong program; `blocked.test.ts` AC20 (1): the session's half | fail; the third stays BLOCKED until #18, #25 and #47's recorder give it a surface |
| #236 AC4 `#236.cc0de139` | a read-only job's MCP server writing outside what it declared is refused by the sandbox, recorded | `isolation.test.ts` #236 AC4 (1) | fails (no package) |

### How each criterion is read

- **AC1.** The hub's runner runs a job of kind `draft` and one of kind `review`; the test carries its hooks to the
  hub's socket as deep-hook would (the job's sandbox can't reach the socket, #236), with the session ID the fake
  printed and a stamp inside the job's run. "The job's events": `job.event@1` events naming the job and each hook.
  "No session row, claim, verdict or task spend": no `sessions` or `claims` row with the job's session ID, and no
  `verdict.made`, `claim.made`, `turn.usage`, `spend.reserved` or `spend.charged` event naming its session or its
  job. The real drafting job (#81, #50) and review check (#87) aren't built: `blocked.test.ts`.
- **AC2.** The three servers are in `~/.claude.json`'s `mcpServers`, user scope; the spec names a fourth, `notes`.
  Read from the init event of the job's own output.
- **AC3.** "Refused by its read-only mode": the fake's Write tool call is a permission denial (listed in the
  result's `permission_denials`), so a runner that passes a bypass flag or an edit mode, whose write then only the
  sandbox stops, fails. "The refusal is its recorded stop cause": `JobRecord.stop.cause` is `refusal`, the closed
  set's member for it (see Ambiguities).
- **AC4.** The hub is started with the four variables in its environment; the job prints its environment
  (`@env`); none of the four is in it, and the job ran (the fake refuses to start with `CLAUDECODE=1`). The test
  also checks a variable outside the allowlist (`SECRET_NOT_ALLOWLISTED`) doesn't reach it (Scope: an allowlisted
  environment).
- **AC5.** The fake sign-in has made-up tokens in `~/.claude/.credentials.json` and `~/.codex/auth.json`. After a
  drafting job in a base checkout, the test walks the job's folder (git objects decompressed through git) for a
  credential file name or either token, and compares the SHA-256 of `~/.claude.json`, the credentials, the user
  settings and Codex's `auth.json` with before. The job's `HOME` is your own (your sign-in home).
- **AC6.** Two installs, 2.1.304 first on the login shell's PATH and 2.1.299 second; the hub's own `PATH` lists
  them the other way, so only the recorded login PATH picks the right one. "Outside what its facts cover":
  version 0.0.1, refused with no process, naming the facts' first and last version and 0.0.1.
- **AC7.** The grace is 5 s from the final result; the group (the CLI and a `/bin/sleep` it forked into its group)
  must be gone within 5 s + 2 s to signal and reap. "What lingered" names both PIDs. The busy CLI prints nothing
  for 8 s against a 2 s `output_timeout_ms` while burning CPU; it must still be running 5 s in, and end with its
  own result, not `timed_out`.
- **AC8.** `ANTHROPIC_API_KEY` (a made-up value) is in the hub's environment; the job is on your plan (the fake
  sign-in is a Max subscription). A budget for another issue doesn't cover it; it starts no process and its record
  names `ANTHROPIC_API_KEY`, never the value. After a budget for its issue is approved on the card, a job starts.
- **AC9.** Both crash points, each with a fresh hub. The fake waits 2 s before it reads its prompt so `ps` sees
  every launch; the test counts distinct launches of the fake through both hubs (at most one), and the restarted
  hub lists the one job as `lost` (reported) or `stopped` (reaped), with the first launch's process gone.
- **AC10.** The hub's half: a session of yours sends SessionStart, UserPromptSubmit and Stop with `cwd` in a
  finished job's folder, and another resumes that job's session ID after the job ended; each is recorded as its own
  session (its `session.start` and `agent.stop`, a `sessions` row) with a reading naming the job or its folder, and
  none of it as `job.event`. A job whose fake waits 4 s before printing its init gets its SessionStart hook before
  the runner has read the session ID; it is a `job.event` of that job, never a session. "Stop held and judged" and
  "claim and spend recorded as its own" need the Stop hold (#25) and Claude Code's claims and spend (#18):
  `blocked.test.ts`.
- **AC11.** The reading is Claude Code's status line `rate_limits` with `five_hour.used_percentage` 92 and a
  reserve of 10%; both jobs name the claim; each shows `blocked: {status: 'BLOCKED', cause: 'plan window', owner:
  'you', since, on: [claim, …]}`. "When the window resets": the clock passes the window's `resets_at`, with no new
  reading (see Ambiguities). The other account reads 20%; its job starts within 5 s with no tick.
- **AC12.** No reading for the account; both jobs show a `blocked.cause` naming the first reading and the account.
  "No turn in your own sessions waits on a reading" is read on the runner's side: waiting asks you nothing
  (`needsYou()` empty). The sessions' own turns are gated by the hub (#25), which nothing here changes.
- **AC13.** The base commit holds `.claude/settings.json` with a SessionStart hook that touches a marker outside and
  one inside the job's folder, and an `env` block pointing `ANTHROPIC_BASE_URL` at a listener of the test's. After
  the drafting job, neither marker exists, the listener had no connection, and the job's output has no
  `hook_response` from the checkout's settings: a runner that loads them and relies on the sandbox to stop the
  hook still fails.
- **AC14.** The account has no reading. At 29 minutes no ask; at 30 and again at 60, exactly one `unblock` ask whose
  question names the account, with two options: one whose label says it runs without a reading and names 10, one
  whose label says connect. Answered on the card: with the first, the waiting job starts and nine more run that
  day; an 11th doesn't start within 60 s. With the second, the job keeps waiting. Either way, an hour more without
  a reading raises no second ask for the account.
- **AC15.** "Conflicting work": a run started through the same supervisor with the same lease (`worktree:wt-1`) as
  the job; it must not start while any of the job's processes runs, and must start once they're gone. After a
  result: a child keeps writing to stderr for 3 s. After a cancel: the CLI ignores SIGTERM and keeps a helper; the
  job reads `stopping` right after the cancel and at every poll until it reads `stopped`, and it never reads
  `stopped` while a process of it runs. After a lost connection: the CLI closes its stdout without a result and
  keeps running and writing. The swap: once between two jobs (after the first verified it), and once during the
  `--version` run of a fresh runner's verification (the fake keeps that run alive 2 s; the test swaps the file
  atomically 300 ms in). The swapped-in binary prints `9.9.9` for `--version` and `EVIL RAN` as a job; the job
  after the swap either ran the verified bytes (its output names 2.1.304) or was refused, and `EVIL RAN` never
  appears. A runner that verifies without running `--version` can't have the second swap timed and fails, naming
  that.
- **AC16.** The runner's half. The session works in a worktree of the repo on branch `work`, which commits a file
  holding the diff's marker; its transcript (under `~/.claude/projects/`) holds the transcript's marker; `CLAIM.md`
  and `PR_BODY.md` in the worktree hold the claim's. A drafting job (kind `draft`, the issue's words as its prompt,
  a checkout of the base commit from the session's worktree) and a review (kind `review`, the diff in its
  prompt, the same checkout) run through the runner. The drafting job's stdin (as the fake echoes it), its folder (git objects included) and its
  own transcript (if Claude Code kept one) hold none of the three markers; the review's hold the diff's marker
  and neither other. The wrong program the runner can be: one that checks out the session's branch instead of the
  base commit, putting the diff in the drafting job's folder. Which of a task's things each job kind takes (the
  issue for the drafting job, the diff alone for the review) is #50/#87's: `blocked.test.ts`.
- **AC17.** Launched with `--model claude-haiku-4-5` (the spec's `model`), the fake's init names the launched model
  and its messages and `modelUsage` name `claude-opus-4-1`; the job records the latter. With `@answered-by none`
  nothing in the output names a model, and the job records `unknown`.
- **AC18.** As #236's AC8: the perf lane holds the merge-base comparison (tasks running `benchmarks/runner.mjs`,
  initial reason naming #159, valid by `validateBudgets` against the merge base's file), the bench must run, and
  the numbers are judged on the reference Mac (Mac15,7 or Mac15,12, mains power, Low Power Mode off, no thermal
  warning), five runs after a warm-up each: start (a job through the runner minus the same facts launch spawned
  bare, medians of five), parsing (a job printing 4,000 messages over about 8 s, its added time beyond the start
  as a share of its bare run), memory (the test process's resident growth per job with five running), and the
  status line (`deep-hook statusline` then yours against yours alone, medians of 50, both in a Seatbelt profile
  that denies IP networking). The forwarder's behaviour (the reading reaches the hub, yours prints unchanged) is
  checked on any Mac.
- **AC19.** The fake tries, from inside a drafting job, to read a file in the session's worktree, the session's
  transcript and to connect to `<root>/hub.sock` (a listener the test runs); each fails and the listener gets no
  connection. `git log --all` in the job's folder lists exactly the base commit's history; otherwise the failure
  names the extra refs (a worktree of the mirror shows `refs/heads/work`).
- **AC20.** The runner's half: Claude Code at 2.1.999 (outside the facts). A `smoke` job raises one authority ask
  for the standing approval and starts nothing; approved on the card while the account is at 95%, it still waits
  (cause plan window); with room it runs. A drafting job on 2.1.999 afterwards is refused, naming the version, or
  the failure says the range was widened by the smoke test's own run. A second smoke test asks nothing. The
  session's half (the first session on the new version starting it, the diff of its recorded payloads, holds
  watch-only, the row saying it waits): `blocked.test.ts`.
- **#236 AC4.** A read-only job whose MCP server (`/bin/sh -c 'echo written > notes.md'`, started by the fake in
  the job's folder) writes into the folder the job didn't declare writable: the file isn't there, and the record
  gets `sandbox.denied` naming the job's run and the path within 15 s.

## Wrong programs

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `plant: 'records-launched-model'` | AC17 | records the model it launched, not the one the output names | the failure names claude-haiku-4-5, the model it launched |
| `plant: 'checkout-of-session-head'` | AC16 | checks out the repo's current branch (the session's, with the diff) instead of the spec's commit | the drafting job's folder holds the diff's marker; the failure names it |
| `plant: 'worktree-of-mirror'` | AC19 | gives the job a `git worktree add` of the repo at the commit, sharing its refs | `git log --all` lists the working branch; the failure names `refs/heads/work` |
| `plant: 'widens-range-on-smoke'` | AC20 | widens the facts' covered range to the version its smoke test ran on, at the end of that run | the drafting job after it runs; the failure names 2.1.999 |

The criteria that name no twin fail on the base, which has no runner package and a hub with no `job.*` methods
(BASE-FAILURE.txt); past that, the mutation lane is their wrong program.

## What depends on other issues

- **#50, #81 (the drafting job) and #87 (the review check)**: AC1's and AC16's job kinds, which choose a task's
  inputs. BLOCKED until they land; the runner's halves run jobs of those kinds the tests define.
- **#25 (Claude Code's Stop hold) and #18 (Claude Code's sessions, claims and spend; a session's agent version)**:
  AC10's "held and judged" and "claim and spend recorded as its own", and AC20's session half. BLOCKED until they
  land.
- **#47's recorder (the corpus diff you approve)**: AC20's "recorded payloads come to you as one diff". BLOCKED.
- **#39 (the Codex adapter)**: Codex's launch (`codex exec --json`, `-s read-only`), its `rate_limits` per
  `limit_id` and its jobs. No criterion names Codex alone; its runs join these tests when #39 lands.
- **The reference Mac**: AC18's numbers count only there.

So a PR for #159 that passes everything else says `Part of #159` and lists AC1's, AC10's, AC16's and AC20's other
halves as open, until those issues land and a blind redraft of this job tests them.

## Ambiguities, and findings at this base

- **AC3's stop cause.** The closed set has no "permission denied" member; `refusal` is the nearest, though it may
  have been meant for a model's refusal. The set is extensible, so an implementation could add a member; this test
  asks for `refusal`. A dispute goes to the redraft.
- **AC11's "when the window resets".** Read as the clock passing the reading's `resets_at`, with no new reading:
  the window is then known to have reset, which is not the "window a snapshot leaves out" that must stay unknown.
- **AC10's "a reading names it".** Read as a reading on the session that names the job's ID or folder.
- **AC14's "a day".** Counted on the runner's clock; the test runs its 11 jobs within about two hours of clock time.
- **AC7's "within 5 s of the grace".** Read as: gone no later than the 5 s grace after the final result plus 2 s
  to signal and reap.
- **Finding: host@1 has no stdin.** `StartSpec` at this base takes `output` but no input, so the runner can't write
  a prompt to a supervised process's stdin without an addition to #236's surface.
- **Finding: Seatbelt denies writes under any `.claude/`** (and to `.claude.json`), whatever the grant, so a real
  Claude Code job can't write its transcript, its `~/.claude.json` or its session files; and the egress filter can
  name only a port on this machine, so a real job's API calls need a path the hub provides. The fake needs neither;
  the implementation does.
- **Finding: the hub reads every live hook as the newest covered version**, so at this base no hub knows which
  agent version a session runs (AC20's session half).

## Files

- `helpers.ts`: temp folders and the fake sign-in, the fake installs and what they reported, git repos, `ps`,
  listeners (a stand-in API host, hub socket), the hub as a process with its line protocol and a deep-hook
  stand-in, the reference-Mac gate and the timing judge.
- `world.ts`: a record, the asks core, the budget ledger, the supervisor with a lease pool and the runner opened
  on them, with a clock the test moves.
- `launch.test.ts` (AC2, AC3, AC6, AC13, AC17), `isolation.test.ts` (AC5, AC16, AC19, #236 AC4),
  `lifecycle.test.ts` (AC7, AC15), `plan.test.ts` (AC8, AC11, AC12, AC14, AC20), `hub.test.ts` (AC1, AC4, AC9,
  AC10), `budgets.test.ts` (AC18), `blocked.test.ts` (AC1, AC10, AC16, AC20).
- `fixtures/fake-claude.pl`: the fake `claude`.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
