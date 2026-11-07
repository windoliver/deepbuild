# Acceptance tests for #824 AC4: memory per added session

Written first, from issue #824 (its Scope's per-session reading and BLOCKED rule, the fourth checkbox criterion added
2026-11-03, Proof), the design sections it links (Numbers version 0 has to hold, with Every task carries its own budgets
and The reference Macs; Criteria to tests, Criteria in a checked shape, Wrong programs and Dogfooding), AC1 to AC3's
merged suite beside this folder, and base commit `8173fbd2` (origin/main), by a job that never saw an implementation.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

From the base this job read what a session's processes really are: `deep setup` writes two MCP server entries into
`~/.claude.json`, `deepbuild` (`node <cli> mcp`) and `deep-actions` (`node <cli> mcp actions`), so Claude Code starts two
`deep mcp` processes per session (`packages/hub/src/setup.ts`); and the waiter is `<deep-hook> claude-code waiter`
under Stop and StopFailure with `asyncRewake` (`claude-settings.ts`), the Rust binary of `crates/deep-hook`, which waits
on the hub's `session.wait` and exits when its parent, the agent, does. `deep mcp` connects to the hub only at its first
tool call, presenting its parent (the agent) by PID and start time; the hub binds it to the session whose hooks came from
that parent. A session the hub meets first is read from the end its transcript had then (`core.ts`, `verify`): what a
transcript held before the session's first hook is never read by the hub.

## How to run

With the repo's Node (`.node-version`, 24.22.0), `target/debug/deep-hook` built with the planted programs, which only an
`env-plants` build reads (#1408):

```sh
npm ci && npm run build --workspaces && cargo build --locked -p deep-hook --features env-plants
npx vitest run --root tests/acceptance/824/sessions --no-file-parallelism --exclude '**/budgets.long.test.ts'
npx vitest run --root tests/acceptance/824/sessions budgets.long.test.ts   # the budget, by hand, on a reference Mac
```

- The parent folder's own command (`--root tests/acceptance/824`) also picks these files up; its
  `--exclude '**/budgets.long.test.ts'` leaves this folder's long file out too.
- Temp homes, cleanup and the record are the parent's `helpers.ts`, imported unchanged: homes under `/tmp/dh824-*`,
  cleanup stops by PID only what still holds a test's home (`lsof +D`), never by name or port. Each run lays 30
  transcripts of 32 MiB under its home (about 1 GiB) until cleanup removes it.
- With `--root` here, Vitest writes its cache to `tests/acceptance/824/sessions/node_modules/.vite/`; delete that
  folder before committing.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/824/tsconfig.json` (the parent's, which
  includes `./**/*.ts`, so this folder needs none of its own). The tests import no package: only
  `benchmarks/hub-sessions.mjs`, `deep hub run`, the socket's `events.read`, `scripts/lanes.mjs`'s exports and
  `benchmarks/budgets.json`.

## What `scripts/lanes.mjs` needs

This job edits nothing outside this folder.

- `alone` must list `tests/acceptance/824/sessions/readings.test.ts` and `tests/acceptance/824/sessions/planted.test.ts`
  by name (not the folder: the long file would run too). They start a hub and 60 Node processes and read memory, so
  nothing should run beside them.
- `byHand` must list `tests/acceptance/824/sessions/budgets.long.test.ts`: it builds the merge base, deep-hook with it.
- The local preflight must run the benchmark itself: `readings.test.ts` wants a lane in `checks` or `releaseLanes`, or a
  task in `benchmarks/budgets.json`, that names `benchmarks/hub-sessions.mjs` (as the `hub churn` release lane names
  `hub-churn.mjs`).

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** (#16): `deep hub run` with `HOME` the temp home, `control.token`, `hello: app`, `events.read`.
- **The record's kinds**: `session.start`, `agent.stop`, `session.end`, with their `session_id` and `ts`.
- **`deep setup`'s entries** (#18, #363): `node <cli> mcp`, `node <cli> mcp actions`, `<deep-hook> claude-code waiter`.
- **Planted programs**: `DEEP_HUB_PLANT=<name>`, `packages/hub/src/plant.ts`; an unknown name stops the hub, so every
  name below goes into its list. deep-hook reads the same variable (as it does for `waiter-outlives-session`).
- **The reference-Mac gate and the size parser**: the parent's `environmentProblem()` and `sizesNamed()`.

### Defined here, where the issue leaves a choice: what the implementer has to meet

1. **The benchmark's entry**, after `benchmarks/hub-churn.mjs`: `node benchmarks/hub-sessions.mjs [--home <dir>]
   [--merge-base]`. `--home` is the hub's and the sessions' `HOME`, and the benchmark leaves that folder in place so
   the record and the transcripts can be read back. `--merge-base` adds the merge base's reading, as the churn
   benchmark's does. It starts its own hub and every session's processes, passes `DEEP_HUB_PLANT` to all of them, and
   stops what it started by PID before it exits. The counts are the issue's, 1, 10 and 30, with no flag.
2. **Its one JSON line** on stdout, printed whether the run passes or fails:

   ```
   { "bench": "hub-sessions", "platform": "<process.platform>", "method": "pss" | "phys_footprint",
     "limitBytes": 25000000,
     "readings": [{ "sessions": 1, "at": <epoch ms the reading began>, "totalBytes": <n>,
                    "processes": [{ "pid": <n>, "ppid": <n>, "role": "hub" | "deep mcp" | "deep mcp actions" | "waiter",
                                    "child": <bool>, "command": "<its argv as the OS shows it>", "bytes": <n> }, ...] },
                  { "sessions": 10, ... }, { "sessions": 30, ... }],
     "perSessionBytes": <n>, "grew": { "role": "<role>", "perSessionBytes": <n> },
     "mergeBase": { "commit": "<git merge-base HEAD origin/main>", "perSessionBytes": <n> } }
   ```

   - `processes` is every process DeepBuild runs for the open sessions: the hub, each session's `deep mcp` and
     `deep mcp actions`, each waiter, and every process under any of them (`child: true`, with the role of the
     DeepBuild process it runs under). The stand-in agent itself is not DeepBuild's and is not read.
   - `totalBytes` is the sum of `bytes`.
   - `perSessionBytes` is the most any step between consecutive counts added per session: the larger of
     (total at 10 − total at 1) / 9 and (total at 30 − total at 10) / 20, so "each session added past the first" holds
     for both steps. `grew` is the role whose summed `bytes` grew most per added session by the same rule, with that
     growth. Rounding to a whole byte is allowed.
   - `mergeBase` comes with `--merge-base`; where the merge base can't be measured, it holds `commit` and `initial`,
     the reason in words, as AC1's does.
3. **The planted wrong programs**, named `DEEP_HUB_PLANT` values, each added to `plant.ts`'s list:

   | Plant | What it does | Size |
   |---|---|---|
   | `mcp-loads-hub` | `deep mcp` (the `deepbuild` entry; `deep mcp actions` is unchanged) imports `@deepbuild/hub`'s entry and every other module of the package's built folder at start, and holds them while it runs | importing the entry alone added 14 MB of PSS to `deep mcp` here; every module of `packages/hub/dist`, 29 MB (a reading: Linux arm64, 2026-11-03, one process, `smaps_rollup`) |
   | `waiter-keeps-transcript` | the waiter reads its payload's `transcript_path` whole into memory of its own (a heap copy, not a mapping) at start, and holds it until it exits | the transcript's size, 32 MiB (4, below) |
   | `sessions-no-memory-read` | the benchmark's memory reading fails for every process, as on a platform that can't read another process's memory | — |

   Each of the first two must raise its own role's growth per added session by at least 20 MB and at most 200 MB over
   the unplanted run on the same machine. The two MCP servers already hold a few MB each per session, so 20 MB more
   crosses 25 MB whatever the healthy reading; a mere `import('@deepbuild/hub')` (14 MB here) wouldn't reliably.
4. **A scripted session, open and idle.** Each session is a stand-in agent process the benchmark starts (one process
   is one session's Claude Code, as the stand-ins of #25, #27 and #906 are), with its own session ID and working
   folder. Before its first hook it writes its transcript at `~/.claude/projects/<project>/<session>.jsonl` holding at
   least 32 MiB (33,554,432 bytes) of Claude Code transcript lines, as a long resumed session's is; the hub reads none
   of that (it reads a session it meets first from that end), so the size costs a healthy hub nothing. The stand-in
   then, all as its children: starts `deep mcp` and `deep mcp actions` as `~/.claude.json` names them, initializes
   both and makes one tool call through `deep mcp`, so it binds to its session; runs SessionStart, UserPromptSubmit and
   Stop through deep-hook as the settings name it, its payloads carrying the session, transcript and folder; and
   starts the waiter with the Stop payload on stdin, which waits. Idle: every hook answered, no call or hook in flight,
   each waiter waiting. Sessions are added and stay open: 1, then 9 more, then 20 more, so 30 in all, and each reading
   is taken once every open session is idle.
5. **Shared pages counted once.** On Linux, each process's `Pss` from `/proc/<pid>/smaps_rollup`: a page shared by k
   processes counts 1/k in each, so the sum counts it once (once across every process mapping it, DeepBuild's or not,
   so shared library text may read a little low beside other Node processes). On macOS, each process's
   `phys_footprint` (`proc_pid_rusage`, as `footprint` and Activity Monitor read it), which leaves out shared clean
   pages such as the Node binary's text: those are a constant, so leaving them out moves no growth per session. Any
   other platform is BLOCKED.
6. **Exit and words**, as `scripts/preflight.mjs` prints them: `perSessionBytes` at or over 25,000,000, a line starting
   `FAIL` and a non-zero exit. The line names the growth per added session with its unit (the same number as the JSON
   line's, within 15%) and the role in `grew`, by its role name (`hub`, `deep mcp`, `deep mcp actions`, `waiter`).
   Under it, no `FAIL` and exit 0. A memory reading that can't be had: a line starting `BLOCKED` and a non-zero exit,
   no `FAIL` and no `PASS`, and no readings printed as taken.

## Readings where the issue and design leave a choice

- **25 MB is 25,000,000 bytes**, as #16's suite and AC1's read MB.
- **"Compared with the merge base"** is read as AC1's merged suite reads the same words: the limit is absolute, and the
  merge base's reading is carried beside it (the issue's Proof). See the open question below: this may not be the
  owner's reading.
- **"The summed memory of DeepBuild's own processes"** includes both MCP server entries `deep setup` writes, since
  Claude Code starts a process for each; the issue's "(`deep mcp`)" names the program, and both run it.
- **"Each session added past the first"** is checked at both steps (1 to 10, 10 to 30), not as one average, so a cost
  that appears only past ten sessions is seen.
- **The budget counts only on a reference Mac** (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state
  nominal, with the parent's gate; elsewhere it is skipped as INCONCLUSIVE, never passed. It is one run: the design's
  five-run rule names timing results.
- **The planted runs are judged on any machine**: the reading works on Linux and macOS, and each plant is compared
  with the unplanted run on the same machine, so a Linux reading can prove them. Off a reference Mac, a healthy run
  over the limit is not judged as the budget, only checked for agreeing with its own readings.
- **"The process that grew"** is the role whose memory grew most per added session, recomputed here from the raw
  readings, so a benchmark can't name a process its own numbers don't show.

## Criteria to tests

Each `describe` names the criterion's ID, `#824.85ef3d40`, the first 8 hex of the SHA-256 of the criterion's exact
text (computed the same way the parent's three reproduce); each test's name starts with it.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC4 `#824.85ef3d40` | each session past the first adds under 25 MB to DeepBuild's summed memory, against the merge base, on the reference Mac | `budgets.long.test.ts` |
| | the reading itself, any machine: in the preflight; 1, 10, 30 sessions; every process; growth recomputed; verdict agrees | `readings.test.ts` (2) |
| | the sessions were open and idle at the hub when read, with their 32 MiB transcripts (from the record) | `readings.test.ts` |
| | Scope: memory it can't read is BLOCKED, never PASS | `readings.test.ts` |
| | the planted MCP server and the planted waiter fail it, naming the per-session growth and the process that grew | `planted.test.ts` (2) |

## Wrong programs

The mechanism is `DEEP_HUB_PLANT` and the merge base, as AC2's: the planted tests must watch the benchmark fail in the
ordinary tree, where a twin isn't laid. The plants' bodies are the implementer's, to Defined here, 3; the tests hold
them to their size.

| Wrong program | How it is selected | How the test fails on it |
|---|---|---|
| `deep mcp` loading the whole hub package | `DEEP_HUB_PLANT=mcp-loads-hub` | the benchmark must FAIL naming the growth and `deep mcp`; a benchmark that misses it, or names another process, fails the test |
| a waiter keeping its transcript | `DEEP_HUB_PLANT=waiter-keeps-transcript` | as above, naming `waiter` |
| memory that can't be read | `DEEP_HUB_PLANT=sessions-no-memory-read` | it must be BLOCKED, never PASS or FAIL |
| a benchmark that reads nothing or a stub | — | the role counts, command lines, minimum sizes and distinct readings in `readings.test.ts` |
| a benchmark whose verdict isn't its readings | — | the growth and the grown role recomputed in `readings.test.ts` and `planted.test.ts` |
| sessions that weren't open, or weren't idle | — | the record's starts, stops and ends against each reading's `at` |
| the base itself | — | BASE-FAILURE.txt: no benchmark, no lane naming it |

## Open questions for the issue's owner

- **Absolute or relative 25 MB.** On this Linux box (arm64, 2026-11-03, a reading, not a budget), an idle `deep mcp`
  holds about 13.6 MB of PSS before it connects; two per session make about 27 MB before the waiter, so the base itself
  may read over 25 MB per added session. If the reference Mac reads the same, AC4's budget fails on the merge base and
  can't be met by a test-only change. The choices: the limit as the change's growth over the merge base's (then the
  benchmark needs `--merge-base` to judge, and the planted tests would have to build the merge base too), counting
  only the `deepbuild` server entry, or a different number. These tests take the absolute reading, as AC1's do.
- **Whether `deep mcp actions` counts** (above): included here, as a process DeepBuild runs for every session.
- **The transcript's size, 32 MiB**, is this job's: the issue's "a copy of its session's transcript" crosses 25 MB
  only for a transcript larger than that. 32 MiB is a long resumed session's, and the hub doesn't read what came before
  a session's first hook, so it costs a healthy run nothing but disk.

## Approved changes after the draft

Disputed on the work, and approved by the owner's side on 2026-11-03 after its blind redraft (`redraft-readings/`)
also failed on the work, with a defect of its own (it reads an event's session as `session_id`; the record names it
`session`). `readings.test.ts`, two edits:

1. **`afterEach(cleanup)` became `afterAll(cleanup)`.** The record test reads the benchmark run the readings test
   started, whose home the per-test cleanup had already removed, so no benchmark could pass it in a whole-file run.
2. **The 1 MB floor holds for `deep mcp` only.** It read "a Node MCP server holds at least 1 MB of its own" for both
   server entries, but the implementation serves `deep-actions` with deep-hook (`deep-hook mcp actions`), a Rust process
   of about 0.4 to 0.8 MB of Pss, so that a session fits the 25 MB. Every process must still be read with a positive size.

`redraft-readings/` is kept as written and run by hand only (`scripts/lanes.mjs`, byHand).

## Files

- `helpers.ts`: the benchmark as a process, its JSON line and words, the growth and the grown role recomputed.
- `readings.test.ts`, `planted.test.ts`, `budgets.long.test.ts` (all AC4).
- `BASE-FAILURE.txt`: the run on the base commit.
