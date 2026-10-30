# Acceptance tests for #21: hook overhead and fail-open under real sessions

Written first, from issue #21 (its text as of October 28, 2026: Scope, the four checkbox criteria, Proof, References,
Depends on and "Added Oct 9"; it has no comments), the design sections it links (Week 1; Numbers version 0 has to
hold, with Every task carries its own budgets and The reference Macs; How we know version 0 works, with Criteria in a
checked shape, Wrong programs, Dogfooding and Headless agent tests) and those around them (Hook protocol; Hooks are
evidence, not a state machine), the acceptance suites of the four dependencies (#315, #316, #18's `mapping` and
`install`, #48) and of #16 and #666, and base commit `5a6d09a4` (origin/main), by a job that never saw an
implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

The issue has four checkbox criteria: AC1 to AC4 in the body's order. "Added Oct 9" (the release gate) lands with
packaging in #41, as the issue says, so it is not a criterion here and has no test.

## How to run

With the repo's Node (`.node-version`, 24.22.0), the Rust toolchain, hyperfine 1.x and Bun on PATH:

```sh
npm ci && npm run build --workspaces       # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q --release -p deep-hook
npx vitest run --root tests/acceptance/21 --no-file-parallelism
DEEP_HARNESS_LIVE=1 npx vitest run --root tests/acceptance/21 sessions.live.test.ts   # by hand only: spends plan usage
```

- `--no-file-parallelism` keeps the files apart: they time real processes against 10 ms and 50 ms, and two files
  build deep-hook or run benches that build it.
- Nothing but the live file needs the network or a sign-in. The files build the release deep-hook
  (`target/release/deep-hook`), and with rustc, into their temp folders, the hook timer (`fixtures/hook-timer.rs`)
  and the floor (`fn main() {}`).
- Long runs: `replay.test.ts` replays eight days of 1,000 tool calls (2,000 hooks each, about a minute a day);
  `budgets.test.ts` runs #21's benches; `process-start.test.ts` runs the process-start measurement. The live file runs
  five real sessions of about 210 Bash calls each.
- Every test makes its own folders under `/tmp/dh21-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every DeepBuild process it starts, and never touches the real `~/.deepbuild`. It stops
  only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port. A child never inherits this
  process's billing keys, agent markers (`CLAUDE*`, `ANTHROPIC*`, …) or `DEEP_*` settings.
- With `--root` here, Vitest writes its cache to `tests/acceptance/21/node_modules/.vite/`; delete that folder before
  committing.

Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/21/tsconfig.json`. The tests import no
package: everything goes through the binary, `deep hub run`, the socket's `events.read`, the files under the test's
home, `benchmarks/budgets.json` and its benches, `scripts/benchmark.mjs`'s `validateBudgets` (as #315's suite does),
`scripts/agent-harness.mjs`, `docs/spikes/21/` and the design's text.

## What `scripts/lanes.mjs` needs

This job edits nothing outside this folder. `scripts/lanes.mjs`'s `byHand` must list
`tests/acceptance/21/sessions.live.test.ts`, or the unit lane runs it and it fails BLOCKED there. The other four
files time real processes and belong with the files that run one at a time with nothing beside them (as #315's do).

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temp home, its ready line, the control token, `events.read`; the
  spool replay at start; `hub.stopped@1` with `data.reason` `signal:SIGTERM` for a hub stopped by SIGTERM;
  `DEEP_HUB_PLANT=replay-appends-twice` (#666's planted hub, merged: it appends the first replayed event a second time).
- **deep-hook** (#315): `deep-hook claude-code <Event>` with the hook JSON on stdin and `HOME` the agent's; failing
  open into `$HOME/.deepbuild/spool/*.jsonl`, each spooled line the request as sent (`event`, `payload`, `seq`, `id`).
- **seq** (#16, #315): the recorded event's `seq` is the decimal string deep-hook stamped: wall-clock ns since the
  epoch "when the hook started" (hook.request@1).
- **A tool call's events** (#18): `tool.before` for its PreToolUse and `tool.after` for its PostToolUse, each with
  `data.call` its `tool_use_id`.
- **The shipped guard entries** (#316): `crates/deep-hook/default-rules.json`, copied to `$HOME/.deepbuild/rules.json`
  as an installed adapter has them, so deep-hook's matcher runs on every call.
- **The fixture corpus** (#47): `adapters/corpus/claude-code/<version>/<set>/events.jsonl`, the hook payloads real
  Claude Code sessions sent.
- **The perf lane** (#12, #315): `benchmarks/budgets.json` tasks, `validateBudgets(current, mergeBase)` from
  `scripts/benchmark.mjs`, benches under `benchmarks/` printing their readings as one JSON line.
- **The agent test harness** (#48, #18): `node scripts/agent-harness.mjs run --scenario … --hooks <settings>`, its run
  line (`verdict`, `sessionId`, `transcript`), Claude Code on your real HOME for its sign-in, the hooks file's entries
  run unchanged beside the harness's own.
- **The design's budget table**: the `| Hook overhead |` row of `docs/technical-design.md`, its Target and Why cells.

### Defined here, where the issue and the design leave a choice

1. **A real hook's time over process start, read with no new surface.** A benchmark times a hook from spawn to exit;
   a hook Claude Code spawned can't be timed that way from outside. These tests put a test-side timer in the hook
   entry, in front of deep-hook: `hook-timer <dir> <deep-hook> claude-code <Event>` (`fixtures/hook-timer.rs`, built
   by rustc). The timer reads the hook JSON, forks a watcher, stamps the wall clock and then *becomes* deep-hook
   (exec), so deep-hook keeps the timer's PID and the agent's process as its parent, as with no timer (the hub reads
   a hook's parent process to know its session: a timer that stayed deep-hook's parent made every hook look like a
   new process, and the hub's replies slowed by hundreds of ms in a trial run). The watcher feeds the JSON to
   deep-hook's stdin, waits for its exit through kqueue (`EVFILT_PROC`, `NOTE_EXIT`), stamps the wall clock again and
   writes `{spawn_ns, end_ns, pid, watched, payload}` to a file of its own; it holds none of the agent's pipes, so
   deep-hook's stdout, stderr and exit code reach the agent untouched. The hook's event is found in the record by its
   call's `tool_use_id` (`data.call`), and its `seq` is deep-hook's own wall-clock start. So each hook gives two
   readings, both "over process start":
   - **over its own start** = `end_ns - seq`: deep-hook's time once its process has started, exit included;
   - **over the floor** = `end_ns - spawn_ns` (exec to exit) minus the floor's: the floor is `fn main() {}` built by
     rustc at opt-level 3, run through the same timer (1,000 runs; in the replayed day, one after each call). For a
     p95 the floor's p95 is subtracted (as #315's overhead bench does); for one hook, the floor's median.
   My choice, because it needs nothing from the implementation that the record doesn't already carry (`seq` and
   `data.call`), reads the very hooks the agent ran, and holds a deep-hook that stamped `seq` late to the second
   reading, which doesn't trust `seq`. A field in the record or the spool line could only carry deep-hook's own
   word for its exit, which a process can't stamp after it has exited. The timer is macOS only (kqueue), as the
   reference Macs are. The exit code isn't the watcher's to see: the replayed day reads it where it spawns the hook,
   the live day doesn't check it.
2. **The hub-stopped windows.** "Stopped" is SIGTERM: the hub process ends (its socket goes) and the record shows
   `hub.stopped` with `signal:SIGTERM`; it "resumes" when `deep hub run` starts again on the same home. "SIGSTOPped"
   is SIGSTOP on the running hub (`ps` shows `T` as the window starts and ends); it resumes with SIGCONT, the same
   process, not restarted. A window is the stretch of calls between the stop and the resume; a call belongs to the
   window it ran in (the replayed day knows each call; in the live day, each window is one whole session). A call
   failed open when its PreToolUse request is in the spool as the window ends, before the hub resumes. "The 400
   events" are the window calls' events, one per call: its `tool.before`. "In the record once after the hub resumes"
   is each of them exactly once in `events.read` once the log has settled after the last window (until every call
   of the day has its `tool.before` and `tool.after`, 120 s at most, then 5 s more so a late duplicate shows), and no
   event ID twice in the whole log.
3. **"No hook takes more than 50 ms over process start"** is every PreToolUse and PostToolUse hook of every call in the
   day, the windows and the hub-up stretches alike, each at most 50 ms over its own start and at most 50 ms over the
   floor's median, and, where the test sees the exit code (the replayed day), each exiting 0 or 2 (an allow or a deny,
   never a crash). It is the client's own deadline (as
   #315's AC1 read it), so it isn't held to the reference Mac.
4. **The replayed day** (`replay.test.ts`), the non-live stand-in: one session; its SessionStart; then 1,000 tool calls
   replayed in turn from the corpus's recorded Claude Code tool calls (each with both hooks; the recorded PreToolUse
   and PostToolUse payloads as Claude Code sent them, with the session, folder, transcript and `tool_use_id`
   rewritten), each run as an installed adapter's hook entries run deep-hook, through the timer, to a real hub. The
   windows: up for 300 calls, stopped for 200, up for 200, SIGSTOPped for 200, up for 100. The last stretch is the day
   going on after the hub resumes. Before a day is timed, each recorded call is run once through a forwarder to the
   hub, and a call whose ack carries a `hold_until_ms` is left out of the day: the budget is "except holds", so a
   held call isn't one the number counts (on the base none was held). A hook still running after 15 s is stopped by
   PID and counted as exit code -1, which fails the day's checks naming the call rather than ending the test BLOCKED.
   After the last window the test waits until every call's `tool.before` and `tool.after` are in the record.
   The first day serves AC2; AC1 and AC3 share it and four more.
5. **The live day** (`sessions.live.test.ts`), the stand-in for "a day of the maintainer's Claude Code sessions with
   the adapter installed" and "the same day with the hub stopped for an hour": five real interactive sessions, one
   after another, each asked for 210 Bash calls, the hub up for the first, stopped for the second, up again for the
   third, SIGSTOPped for the fourth, resumed for the fifth. The adapter's install is stood in for as #18's live test
   does it: a `--hooks` settings file runs deep-hook (the release build) for the nine hooks with `HOME` the test's
   home, each through the timer, and the home's rules.json holds the shipped guard entries. A day can't be waited
   for; 1,050 real tool calls with two windows of 210 are what the criteria count. Fewer than 1,000 calls, or fewer
   than 200 in a window, is INCONCLUSIVE (the model made fewer calls than asked), never a pass.
6. **The harness scenario the live file needs** (an addition to `scripts/agent-harness.mjs`):

   ```
   node scripts/agent-harness.mjs run --scenario bash-calls --workdir <dir> --hooks <settings.json> --calls <n>
        [--claude <path>] [--cost-cap-usd <n>] [--timeout-ms <n>] [--out <dir>]
   ```

   One interactive Claude Code session in a pseudo-terminal in `--workdir` (never `-p`), from the facts' session
   launch with no setting source loaded (as `add-readme-line`), the `--hooks` file's hooks unchanged with the
   harness's own beside them, only the Bash tool, allowed (`--tools Bash --allowedTools Bash`), and the harness's
   scripted-session note. Its prompt asks for `<n>` short Bash commands (`echo call-1` to `echo call-<n>`), each its
   own Bash call, as many at once as the agent will make in one message, and then a one-word reply; the wording is
   the implementer's. The harness ends the session with `/exit` once the turn stops; the run line is #48's, PASS when
   the turn ended with Stop, with `sessionId` and `transcript` (the run's copy). The tests count the calls from the
   transcript (each `tool_use` named Bash), never from what the prompt asked.
7. **The process-start readings** (AC4) live where the repo keeps week 1's other readings, `docs/spikes/<issue>/`
   (`docs/spikes/573/record.json` holds week 1's drafting readings; `docs/spikes/337/measure.mjs` is a spike's
   measurement): `node docs/spikes/21/measure.mjs` measures and prints the readings as one JSON object on stdout, and
   `docs/spikes/21/record.json`'s `processStart` is its run on a reference Mac. The shape:

   ```json
   { "date": "YYYY-MM-DD",
     "machine": { "model", "chip", "memoryBytes", "power", "lowPowerMode", "thermalState", "macosBuild" },
     "method": "<words naming hyperfine, the warm-up and no shell>",
     "hyperfine": { "version": "hyperfine 1.19.0", "argv": [["-N", "--warmup", "…", "<command>", …], …] },
     "programs": { "native" | "node" | "bun" | "python":
       { "command": "<the command hyperfine timed>", "version": "<the program's version>",
         "runs": <n>, "medianMs": <ms>, "p95Ms": <ms>, "timesMs": [<each run, ms>] } } }
   ```

   `machine` is `scripts/benchmark.mjs`'s `fingerprint()` shape (the design: "Every number says whether it is
   measured, with its date, machine and method"). `argv` is every argument list hyperfine was run with; each
   program's `command` is one of a run's commands; `runs` is the number of readings in `timesMs`, at least 20 (the
   design's samples per side); `medianMs` is their median and `p95Ms` a p95 of them. Python is `python3` (or
   `python`). The script chooses the no-op for each runtime (an empty script or `-e`/`-c` with nothing to do) and the
   native no-op; each must exit 0 and print nothing when run with no shell.
8. **"The Hook overhead row's reason cites that recorded run"**: the row's Why cell names `spikes/21/record.json`
   (a link from `docs/` or the path from the repo's root) and the run's date (`YYYY-MM-DD` or "October 28" style), and
   no longer says the numbers came "by a method nobody recorded" or that process start "is an estimate until week 1".
   Its Target cell stays `Under 10 ms at p95 on top of process start, except holds`: the change being judged never
   moves its own budget.
9. **The budgets in the local preflight** (AC3): one or more new `benchmarks/budgets.json` tasks whose
   `initialReason` names `#21`, each `["node", "benchmarks/<file>.mjs", …]`, valid by `validateBudgets` against the
   merge base's file. Between them their benches print, on JSON lines, `overheadP95Ms` and `failOpenP95Ms`, each on a
   line with `calls` 1,000 or more (as `benchmarks/deep-hook.mjs` prints `overheadP95Ms` and `failOpenP95Ms` today).
   The bench's calls, the wording and the split into tasks are the implementer's; replaying the corpus's tool calls,
   as the replayed day does, is the obvious fit for "real tool calls" in a preflight that can't spend plan usage.
10. **"Both numbers are recorded"**: `docs/spikes/21/record.json`'s `budgets`:
    `{ "date", "machine", "method", "calls": <n ≥ 1000>, "commands": [<#21's tasks' commands>], "overheadP95Ms": [5 runs],
    "failOpenP95Ms": [5 runs] }`, from a reference Mac, every run under its limit. The perf lane itself writes no
    file and prints only each task's whole-command timing, so the run that set the budget is written down beside the
    process-start readings, with its date, machine and method.

## Readings where the issue and design leave a choice

- **"Real tool calls"** are calls a real Claude Code session made. In the live file they are exactly that. Where plan
  usage can't be spent (the unit lane, the local preflight), they are the corpus's recorded payloads of real
  sessions, replayed: real tool inputs and responses of many tools, not one `ls`.
- **"Overhead on top of process start"** is read two ways and both must hold (Defined here, 1). AC1's live number is
  the hub-up hooks of the live day; its non-live number is the hub-up hooks of each replayed day.
- **Budgets count only on a reference Mac** (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state
  nominal; elsewhere AC1's and AC3's numbers are skipped as INCONCLUSIVE, never passed. The non-live numbers are
  judged by the design's rule on five runs (five replayed days): PASS when all five are within the limit, FAIL when
  all five are over it by more than the margin (the larger of 5% and their spread), otherwise INCONCLUSIVE. The live
  day is one run, judged on its own.
- **AC3's fail-open number** is the p95 over the windows' hooks (as #315's fail-open budget is a p95); AC2's is every
  hook (its words: "no hook").
- **Before any number is read, the call it times is shown to be the issue's**: every hook ran deep-hook through its
  entry and is in the record; with the hub up no hook is missing its event; in a window each call is in the spool
  before the hub resumes, and a SIGSTOPped hub's state is `T` as the window starts and ends.
- **The process-start method is read from the script, not from its word**: run with a `hyperfine` first on PATH that
  writes down its arguments and runs the real one, it must time a no-op native binary, Node, Bun and Python, each
  with `-N` (or `--shell=none`) and at least one warm-up run, and the readings it prints must name exactly those
  argument lists, this hyperfine's version and each runtime's own `--version`, this machine and today.

## Criteria to tests

Each `describe` names its criterion's ID, `#21.<first 8 hex of SHA-256 of the criterion's text>` (the checkbox line
with `- [ ] ` dropped, trimmed, whitespace collapsed), as the trace lane reads tags; each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#21.cd6952ad` | p95 overhead under 10 ms on top of process start | `sessions.live.test.ts` AC1 (live): the live day's hub-up hooks; `replay.test.ts` AC1: five replayed days' hub-up hooks, judged; AC1 (wrong program) |
| AC2 `#21.9a5768d4` | 1,000 real tool calls, hub stopped for 200 and SIGSTOPped for 200: no hook over 50 ms over process start; all 400 events in the record once after it resumes | `sessions.live.test.ts` AC2 (live); `replay.test.ts` AC2: the first replayed day; AC2 (wrong program) twice |
| AC3 `#21.474533cd` | budgets on the reference Mac in the local preflight vs the merge base: 1,000 real calls, overhead < 10 ms p95, fail-open < 50 ms, both recorded | `budgets.test.ts` AC3 (3): the perf lane's #21 tasks; their benches print both numbers over 1,000 calls; both numbers recorded in docs/spikes/21/record.json; `replay.test.ts` AC3: five replayed days judged against both budgets |
| AC4 `#21.f7ca87ba` | process start of a native no-op, Node, Bun and Python measured with hyperfine (warm-up, no shell), recorded with method, versions and date; the Hook overhead row cites it | `process-start.test.ts` AC4 (3): the measurement's method and printed readings; the recorded readings; the design row |

## Wrong programs

| Wrong program | How it is selected | Criterion | How the test fails on it |
|---|---|---|---|
| a hook that takes 15 ms longer with the hub up | `DH21_TIMER_LINGER_MS=15` on the timer for the hub-up hooks (test-side) | AC1 | "p95 hook time … not under 10 ms" |
| `replay-appends-twice` (merged, #666) | `DEEP_HUB_PLANT` on both of the day's `deep hub run`s | AC2 | "the event of toolu_… is in the record 2 times after the hub resumed, not once" |
| a hook that takes 60 ms longer while the hub is away | `DH21_TIMER_LINGER_MS=60` on the timer for the windows' hooks (test-side) | AC2 | "the PreToolUse hook of toolu_… (window 2, hub stopped …) took … more than 50 ms" |
| the base itself | — | AC1, AC2 (live), AC3, AC4 | BASE-FAILURE.txt: no `bash-calls` scenario, no #21 perf tasks, no recorded numbers, no process-start measurement or readings, and a Hook overhead row that rests on "a method nobody recorded" |

The base already holds the replayed numbers and the replayed windows (#315 built deep-hook's fail-open and the
spool, #16 the replay), so on a reference Mac at rest `replay.test.ts` is expected to pass at the base. On a heavily
loaded machine its AC2 day can fail: AC2 isn't gated on the machine (it is the client's own deadline), and a loaded
scheduler can hold a hook past 50 ms over the floor (BASE-FAILURE.txt). Its tests stand as the non-live proof of AC1, AC2
and AC3's numbers and guard them through this change; the two lingering hooks and the planted hub show each check
fails a program that is wrong in the way the criterion names. Those two wrong hooks are made on the test's side of
the hook entry because the number has no new code to plant a twin in: a deep-hook that took longer would read the
same to the check.

## What depends on other issues

- **#41** (packaging, R2) owns "Added Oct 9", the release gate.
- **#48's harness** gets the `bash-calls` scenario (Defined here, 6) with this issue.

## Files

- `helpers.ts`: temp homes, the hub as a process, the socket and `events.read`, the builds (release deep-hook, the
  timer, the floor), the corpus's recorded tool calls, the spool, the reference-Mac gate and the judge.
- `day.ts`: a day's calls, the join of the timer's files to the record's `seq`, and the AC1/AC2/AC3 checks both days
  share.
- `fixtures/hook-timer.rs`: the hook timer.
- `replay.test.ts` (AC1, AC2, AC3's numbers), `budgets.test.ts` (AC3), `process-start.test.ts` (AC4),
  `sessions.live.test.ts` (AC1, AC2, live).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
