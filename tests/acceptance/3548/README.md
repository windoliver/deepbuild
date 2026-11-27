# Acceptance tests for #3548: the hub's log has a size, and a debug bundle reads its end

Written first and blind, by a job that never saw an implementation of #3548, its diff, another checkout or any other
git ref. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this
job.

**No test here was run by this job.** Its checkout had `node_modules` and no build (no `packages/*/dist`, no
`target/`), and the job was told not to build. So nothing below is a PASS or a recorded FAIL: the results at the base
are readings of the base's code, and the base run is the implementer's to make, with the commands under How to run.
What the job did run is listed under What was run.

## What was read

- Issue #3548: its opening and measured table, Scope, six criteria, `Runs on` line and Proof; and #19, #2365 and #2687
  for the words it cites.
- The design sections it links: One hub per user, a tiny hook client, and extensions in-process (the state folder's
  line); Privacy (the scrub, the canary sweep); Numbers version 0 has to hold (budgets, the reference Macs, counts).
- `AGENTS.md`, `CONTRIBUTING.md`.
- The base commit `1f114eacc`, for call shapes: `packages/cli/src/main.ts` (`deep debug bundle`, `DEEP_CLI_PLANT`,
  `DEEP_HUB_TEST_HELD`), `packages/hub/src/service.ts` (`deep hub start`, the login service's definition,
  `$DEEP_HUB_LAUNCHER`), `server.ts` (`deep hub run`, the health, a signal on the installed hub), `plant.ts`,
  `paths.ts`, `packages/evidence/src/scrub.ts`, `benchmarks/hub.mjs`, `benchmarks/budgets.json`,
  `scripts/benchmark.mjs`, `scripts/proof-change.mjs` (criterion IDs), `scripts/lanes.mjs` and `lanes-lists.mjs`,
  `scripts/wait-ratchet.mjs`; and the suites `tests/acceptance/19/status`, `16`, `2365`, `2648`, `2854`, `2897`, `1700`.

## How to run

From `<checkout>`, with Node 24.22 first on `PATH` (`.node-version`):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run packages/cli/dist/main.js and the hub it starts
cargo build --locked -p deep-hook        # a hub takes deep-hook from this checkout's target/
node node_modules/vitest/vitest.mjs run tests/acceptance/3548/ --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/3548/tsconfig.json
```

One file: `node node_modules/vitest/vitest.mjs run tests/acceptance/3548/log.test.ts --reporter=verbose`.

- **The base run** is these five commands in a checkout of `1f114eacc` with this folder in it, their output kept. On
  a shared machine take the builds and the run under its leases, as `tests/acceptance/3229` and `3390` do
  (`scripts/lease cargo build …`, `node scripts/throttle.mjs test --wait 600 -- node node_modules/vitest/vitest.mjs …`).
- **One file at a time**: `lane.json` runs the folder alone (`shared: memory`). No file is `timed`: none judges a time,
  a load or a budget that counts only on a reference Mac.
- Every test carries its own limit, far above its run, so a hang fails instead of holding the lane: one to five
  minutes where it only reads, 15 to 40 minutes where it starts a hub or the CLI.
- Every folder is under `/tmp/dh3548-*` (a socket path must fit in 104 bytes on macOS) and removed after its test or
  file; nothing is written under the checkout. `HOME` is `<tmp>/h` for every process a test starts, and
  `<tmp>/bin` comes first on `PATH` with stand-ins for `claude`, `codex`, `launchctl` and `systemctl`
  (`fixtures/agent-bin.sh`), so nothing reaches the real `~/.deepbuild`, `~/.claude`, `~/Library/LaunchAgents` or a
  real agent. No child inherits a billing key or a `DEEP_*`, `CLAUDE*`, `CODEX*` or `NODE_OPTIONS` variable of the
  runner's. No network. One exception to the temporary folders: `budgets.test.ts` runs `benchmarks/hub.mjs idle`,
  which builds its process reader once into the user's cache folder, as the perf lane does.
- Processes are stopped by PID only. A command the suite runs is its own child. A hub is stopped by the PID its own
  health gave, and only while that process's arguments are still `hub run`; or by the PID in the name of its planted
  writer's socket, and only while that socket answers.
- Messages write the checkout as `<checkout>` and a home, the test's own too, as `~`.

## The surface

### Merged surfaces, used as the base has them

- **A dev hub**: `deep hub start --root <folder>`, which exits 0 once the hub answers, and
  `deep hub status --root <folder>`, which prints the hub's health as one JSON line holding its `pid`. The hub's logs
  are the files under `<root>/logs/` (design: the state folder's line).
- **The login service**: `deep hub start` with `HOME` a temporary home writes the service's definition, one `.plist`
  under `~/Library/LaunchAgents`, and hands it to `$DEEP_HUB_LAUNCHER`. On the installed hub a SIGTERM is a restart:
  it exits for the service manager to start it again.
- **`deep debug bundle`**, on `~/.deepbuild` of `HOME`: prints its bundle's path last; the bundle is gzip or plain and
  holds JSON; it reads every file under `logs/`; it scrubs the values in the file `DEEP_HUB_TEST_HELD` names (#19).
- **Planted programs** are selected by `DEEP_HUB_PLANT=<name>` (the hub, which ends at its start on a name it doesn't
  know) and `DEEP_CLI_PLANT=<name>` (`deep debug bundle`, which ignores a name it doesn't know).
- **`hub-idle`**: `node benchmarks/hub.mjs idle`, whose last stdout line that is a JSON object holds
  `idleCpuPercent`, `rssBytes`, `wakeupsPerSecond` and `instructionsPerSecond` (#16, #2648).

### Defined here, where the issue leaves a surface open

1. **The planted writer** (`fixtures/writer.mjs`): what makes a hub write. The issue says "a dev hub planted to write
   200 MB of lines" and that the merge base's folder then holds 200 MB, so the writer has to work on the base as it
   stands. A line the hub writes is a `process.stderr.write` in the hub's process, as its own lines are at the base,
   and the writer makes the same call, one a line. A test loads it with `NODE_OPTIONS=--import=<writer.mjs>` and
   `DEEP_3548_CTL=<folder>` in the environment it starts the hub from, as #16's suite loads its preload. It acts only
   in the main thread of the process whose arguments are `hub run`; everywhere else it loads and does nothing. There
   it listens on `<folder>/w-<pid>.sock`, takes `{"tag", "from", "bytes"}`, writes planted lines numbered from `from`
   until `bytes` bytes are written, 256 lines a turn of the event loop, waits on `drain` where standard error is a
   pipe, and answers `{"pid", "from", "to", "bytes", "lines"}` once the last write was taken.
   **What this asks of a right hub**: what its process writes to standard error ends in the log under `logs/`, held to
   the limit, whichever way the hub writes its own lines after the change; and `deep hub start --root` passes its
   environment on to the hub, as the base does.
2. **The planted line** (`fixtures/lines.mjs`): `deep hub: planted line [[3548:<tag>:<number>|<fill>|<number>:3548]]`,
   the fill the number and a dot repeated, 40 to 250 characters, a different length for each of 211 lines in a row.
   Any 20 characters of a line say which line they are from. A line of a log holds a planted line whole when it holds
   that text, alone or inside other text (a log that stamps or wraps its lines passes); it is cut when it holds a part
   of one beside no whole one, or beside one. The hub's own lines are not judged.
3. **The login service's stand-in** (`fixtures/launcher.mjs`), for launchd: it starts the definition's
   `ProgramArguments` in a session of its own with its `EnvironmentVariables` over the launcher's own environment
   (which carries the writer and a plant, as #16's launcher does), with `StandardOutPath` and `StandardErrorPath`
   each opened for append and made if missing, or `/dev/null` for a key the definition leaves out. A job that still
   runs is left alone, as `deep hub start` asks again every second. The test plays KeepAlive: after the hub's exit
   it runs the launcher again from the same definition. That launchd appends to these paths is this job's reading of
   launchd, not checked against a real one.
4. **The bundle's text of a log**: the longest string in the bundle that holds that log's last line; where the
   bundle keeps a log as a list of strings, that list joined by line ends. The bundle may be one JSON text or one a
   line, and a string that is itself JSON is read into.
5. **Where that text starts** is read from the text: its first line that is a whole line of the log. Lines before it
   that hold no part of the log are the bundle's own (a notice) and allowed. The end of the log's line before, or
   that line's end alone, makes a text that starts mid-line. From its first whole line on, the text is the log's
   lines in order to its last.
6. **The bytes left out** of a log are the log's bytes before the first byte of it the text holds. The bundle says
   them when that count is in it exactly: as a JSON number anywhere, as its digits (with or without separators
   between thousands) in a string of 4,096 characters or fewer, or in what the log's text holds before the log's
   first line. No key, field or wording is assumed. A rounded figure ("564 MiB") doesn't count: the Scope says "how
   many bytes".

### Additions the implementation must make

| Addition | Where | Read by |
|---|---|---|
| Plant `log-new-file-each-start` in the hub's list (the `Plant` type and `PLANTS`): the hub as changed, with one fault: each start begins a new file under `logs/` and holds only that start's files to the limit, never removing an earlier start's | `packages/hub/src/plant.ts`, and where the hub keeps its log | `service.test.ts`, test 2 |
| `DEEP_CLI_PLANT=bundle-cuts-by-bytes`, read by `deep debug bundle`: the reader as changed, with one fault: it keeps the last bytes of each log as they are and never moves on to a line's start. Scrubbed, counted and bundled as the right reader's | `packages/cli` | `cut.test.ts`, test 3; `canary.test.ts`, test 2 |
| Twin `log-size-on-timer`, as its wrong lines: `tests/acceptance/3548/twins/log-size-on-timer/lines.json`, and `tests/acceptance/3548/twins.json` holding `{"#3548.4bf12cec": ["log-size-on-timer"]}`. The hub as changed, with one fault: it reads the size of its `logs/` on a 10 ms timer, idle or not | `tests/acceptance/3548/` (new files, the implementer's) | `budgets.test.ts`, test 2 |
| The state folder's line, which starts "Everything lives under `~/.deepbuild/`", gives `logs/` its size, `64 MB`, on that line | `docs/technical-design.md` | `design.test.ts` |

Nothing else: no lane list entry (`lane.json` is here), no `timed` entry, no budgets task, no new environment
variable of the product's, and no bundle field name. `DEEP_3548_CTL` and `DEEP_3548_JOB` are the suite's own, read
only by its fixtures.

## Criteria → tests → wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, as `scripts/proof-change.mjs` computes them,
checked by a probe against the issue's body. Each test's name starts with the IDs it serves.

| # | ID | Test | Holds | Wrong program, and what the failure names | At the base (expected, not run) |
|---|---|---|---|---|---|
| 1 | `#3548.2789a2c7` | `log.test.ts` | A dev hub (`deep hub start --root`) made to write 200 MiB of planted lines: the writer wrote them and the log holds some; `logs/` at most 64 MiB at every 20 ms reading and at the end; the last line written is there whole; no line holds a part of a planted line; the kept numbers have no gap | **The merge base**: nothing cuts the log. Names the size | FAIL at "logs/ holds 209.7 MB (…) in 1 file …; the limit is 64 MB" |
| 1 | `#3548.2789a2c7` | `design.test.ts` (Scope) | The state folder's line names `logs/` with `64 MB` | The merge base: the line ends "and `logs/`." | FAIL at "the state folder's line gives `logs/` its size" |
| 2 | `#3548.5faa5b25` | `service.test.ts` 1 | macOS: the login service's hub over four starts. 2 MiB, restart, one line: every line from before the restart is there. Then 24 MiB, restart, 24 MiB, restart, 24 MiB: `logs/` at most 64 MiB throughout, newest line whole, none cut, no gap | `log-new-file-each-start` (test 2), and the merge base. Names the folder's size | FAIL at "what the run found wrong": "logs/ holds 77.6 MB (…) in 1 file after four starts …". Off macOS: skipped, INCONCLUSIVE |
| 2 | `#3548.5faa5b25` | `service.test.ts` 2 (wrong program) | The same run with `DEEP_HUB_PLANT=log-new-file-each-start` finds exactly one problem starting "logs/ holds", over the limit | It is the planted run | FAIL at "the hub planted with … starts": the base's hub ends on a name it doesn't know |
| 3 | `#3548.a664c633` | `bundle.test.ts` | A `logs/hub.log` of 600,000,156 bytes: exit 0; a bundle's path; peak resident memory under 256 MiB; the bundle inflates under 128 MiB and holds the log's last line; its text is the log's end to its last line; at most 8 MiB of it; the bytes left out are stated | **The merge base**: reads the log whole as one string. Names the error | FAIL at "exits 0; it ended on the string-length error …" |
| 3, 4 | both | `cut.test.ts` 2 (Scope) | Two logs of 12 MB and 10 MB: each one's text is its end, line for line, at most 8 MiB, and its bytes left out are stated | The merge base: holds each log whole. Names the size held | FAIL at "the bundle holds 12.0 MB (…) of logs/hub.log …; it reads at most 8 MB of each log" |
| 4 | `#3548.3ae8d7b0` | `cut.test.ts` 1 | The bundle holds each of the two logs, and each one's text starts at the start of a line | `bundle-cuts-by-bytes` (test 3). Names the text's first characters | PASS, by its nature: the base's text starts at the log's first line |
| 4 | `#3548.3ae8d7b0` | `cut.test.ts` 3 (wrong program) | With `DEEP_CLI_PLANT=bundle-cuts-by-bytes` the same reading names a log whose text "starts mid-line, with "…"" | It is the planted run | FAIL at "the reading names a log whose text starts mid-line": the base ignores the name |
| 5 | `#3548.ca3e2d07` | `canary.test.ts` 1 | The canary's line last before the bundle's cut, then first after it: the cut didn't move, the line after the cut is kept (its mark is there), and the sweep of each bundle and every other new file under `~/.deepbuild` finds no form of the value, the key, or a half of either | `bundle-cuts-by-bytes` (test 2). Names the bundle and the half | FAIL at "the bundle left nothing out of a logs/hub.log of 10.0 MB": the base has no cut. The sweep's own sentence holds there, since the base scrubs the whole log |
| 5 | `#3548.ca3e2d07` | `canary.test.ts` 2 (wrong program) | With `DEEP_CLI_PLANT=bundle-cuts-by-bytes` the sweep names the bundle holding "the scrub-list value (raw, its second half)" | It is the planted run | FAIL at the same line: no cut |
| 6 | `#3548.4bf12cec` | `budgets.test.ts` 1 | `hub-idle` keeps the base's command, a margin of at most 0.5, and both count limits, neither raised | A `budgets.json` that loosens the task | PASS, by its nature |
| 6 | `#3548.4bf12cec` | `budgets.test.ts` 2 | `hub-idle`'s command exits 0 and reports CPU and resident memory; its hub wakes at most 50 times and retires at most 4,500,000 instructions a second | Twin `log-size-on-timer`. Names the wakeups a second | PASS, by its nature; INCONCLUSIVE where the counters can't be read or the task's hub takes over 10 s to answer |

Each criterion's wrong program, in a line:

1. The merge base.
2. `log-new-file-each-start`: a new file at each start, the old ones kept.
3. The merge base.
4. `bundle-cuts-by-bytes`: the last bytes of each log, from wherever they start.
5. The same reader: its cut splits the canary's line and keeps half the value unscrubbed.
6. `log-size-on-timer`: the hub looks at its log folder's size on a 10 ms timer.

A planted test selects a wrong program and passes when the run fails as the criterion says. It can't pass on the
base, where the name does nothing.

## Readings

- **MB.** Each limit is read in the larger unit, so no right reading fails: at most 67,108,864 bytes under `logs/`,
  at most 8,388,608 bytes of a log in the bundle, under 268,435,456 bytes resident. What is written is read so the
  base's side holds: 200 MiB of lines (209,715,200 bytes, so the base's folder holds 200 MB either way), a log of
  600,000,156 bytes (past 512 MiB, where the base's string ends).
- **`logs/`'s size** is the lengths of the files under it, added. "Throughout" is a reading every 20 ms from before
  the first line to after the last, and one more at the end.
- **What isn't held of the log**: how much under the limit a hub keeps, where it cuts, how many files it keeps its
  log in and what it names them. Files that are gzip are inflated to be read.
- **The newest line** is given a minute to land after the writer's last write was taken.
- **"The oldest leave first"** (Scope): between the oldest kept planted line and the newest, none is missing.
- **"Kept up to it"** (criterion 2). Held at one point only: after the first restart, with 2 MiB written in all, a
  thirty-second of the limit, every line written before it is still there. A hub that has let lines go by then
  hasn't kept them up to the limit under any reading. Past that point the criterion's first half holds what matters.
- **A restart** is SIGTERM to the installed hub by its PID, then the job started again. Four starts of 2, 24, 24 and
  24 MiB put 74 MiB through one log, and a planted hub's four files hold 2, 24, 24 and 24 MiB, over the limit.
- **Resident** (criterion 3) is the maximum resident set size `/usr/bin/time` reads for the `deep debug bundle`
  process: `-l` on macOS, `-v` on Linux. It is judged on any machine, by the `Runs on` line; with no such `time` the
  test fails, never passes. The peak is printed before anything is judged, so both sides of the Proof have it.
- **The two logs** (criterion 4). In `logs/hub.log` every line with its line end is an even number of bytes, so
  each line starts an even number of bytes from the log's end; `logs/second.log` is the same but for its last line,
  one byte longer, so each of its lines starts an odd number of bytes from its end. A reader that keeps the last N
  bytes of each log starts inside a line, or on a line's end, in one of them, whatever N is.
- **The cut of criterion 5** is the bundle's, and "the kept log" is what the bundle keeps of the log. The criterion
  says "the cut", one of them, and the Scope's third line is about the bundle's. The hub's own cut can't be read
  this way: a line placed first after it would hold the canary raw in the hub's log on any program, since the test
  wrote it there. A hub that cuts through a line fails criterion 1's "no kept line is cut".
- **The canary at the cut.** Pass 1 reads where the cut falls on a log with no canary. Pass 2 puts the canary's
  line, as long as the line it replaces, just before the first kept line: the value ends the line, or sits across
  the cut where the reader had cut inside that line. Pass 3 makes it the first kept line, the value its first
  characters. Where a reader cut inside a line and kept under 24 bytes of it, the log's last line is made 64 bytes
  longer and pass 1 is taken again, so the cut leaves enough of the value to tell.
- **A half of a value** is a form here, beside #19's forms: it is what a cut through a value leaves, and no scrub
  finds it.
- **A bundle with no cut** fails criterion 5's test: with nothing left out there is no cut to place a line at, and
  a sweep that tried no cut proves nothing about one.
- **The budget criterion.** The comparison with the merge base is the local preflight's perf lane on a reference
  Mac: it runs `hub-idle` on both sides. A checkout can't run its own merge base. So no test here compares the
  two, and none judges CPU or memory: test 1 holds that the lane still measures the same thing with no more room,
  as #2854 and #2897 hold their budget criteria; test 2 holds the task's two counts, which the design judges on any
  machine, and prints the CPU and memory as readings. A pass of either is not a pass of the budget.
- **The design's line.** The test wants `64 MB`, `64 MiB` or the same in words on the line itself. If the drafted number moves, the
  limits in this suite move with it, by a redraft.

## What each file costs

On an idle machine; a busy one stretches the hub starts, not the writing.

| File | Disk under `/tmp` | Peak memory | Time | At the base |
|---|---|---|---|---|
| `design.test.ts` | none | the runner's | milliseconds | the same |
| `budgets.test.ts` | the task's own home | one idle hub | about 40 s: the task settles 15 s and reads 20 s | the same |
| `log.test.ts` | at most 64 MiB of log and a hub's state | one hub; the test reads the logs a megabyte at a time | about a minute: one hub start, a few seconds of writing, the read back | 210 MB of log; the same time |
| `service.test.ts` | at most 64 MiB of log a run, two runs | one hub at a time | a few minutes: eight hub starts, 148 MiB written | the first run holds 78 MB; the planted run ends in about 40 s, its hub never up |
| `bundle.test.ts` | 600 MB of log, made once, and the bundle | the child under 256 MiB; the test holds 4 MiB of lines at a time | under a minute: the log takes seconds to make | the child reads the 600 MB whole before it fails: 0.6 GB at least, and by the issue's table and the brief over 2 GB |
| `cut.test.ts` | 22 MB of logs, made once, and two bundles | small | two bundle runs | the bundle holds 22 MB of log: a few hundred MB resident by the issue's table |
| `canary.test.ts` | a 10 MB log written three or four times a test, and its bundles | small | six to eight bundle runs | one bundle run a test |

## What was run

By this job, with plain `node`, each a few seconds, under `/tmp/dh3548-*` folders the probes removed:

- The criterion IDs, from the issue's body.
- The writer inside a stand-in process run as `<script> hub run`: 6 MiB written in 0.14 s, numbered on across a
  second request; the folder watch; the logs read back whole; a gzip file read; a crude right cut passing and a cut
  at a byte found, naming the line.
- The launcher on a definition written for it: one job, left alone when asked again, started again after its exit,
  its log appended across the restart.
- `time -l` reading a 200 MiB process's peak on this Mac.
- The log maker's layout (lines where it says, the two logs' parities), and the cut reader on stand-in bundles: a
  right reader in three shapes (one string, a list of lines, a notice line), a byte cutter over 700 byte counts
  (mid-line in a log every time), a whole read, and a bundle with no log.
- `canary.test.ts`'s own run, lifted out of the file, on stand-in readers: a right one (no hit), a byte cutter at
  five byte counts (the half named each time), a whole read (no cut), a reader that leaves its first kept line raw
  (the value named), a reader with a smaller cut (no hit).
- The checkout's scrub, from its source with its rules made in memory from the vendored TOML: it leaves planted
  lines byte for byte, masks the value and the key in the canary's line, and leaves a half of the value.
- Cleanup stopping a stand-in hub it owned and one known only by its writer's socket, and leaving a process that
  is no hub.
- `tsc` over this folder alone (9 files, no package of the workspace), and the studied-names check: both clean.

The stand-in hub and stand-in readers were a throwaway guess at the change, kept in the job's scratch folder and
deleted before it ended.

## Not run, and not proven

- **Every test**, on the base and on any change. The real hub, the real CLI and `benchmarks/hub.mjs` were never
  started. That the writer reaches the real hub through `deep hub start` and through the login service is read from
  the base's source, not seen.
- **The lints** `scripts/wait-ratchet.mjs` and `scripts/repo-rules.mjs` were not run. By hand: four timers, each
  marked `// deadline:` on the line above, no `sleep(`, no clock difference in an assertion, no home path, no
  key-shaped string.
- **The Linux form** of the peak reading (`time -v`).
- **Criterion 6's comparison**: the perf lane's, on a reference Mac in the local preflight.
- **"Never holds a whole log as one string"** (Scope) is held only by the resident limit on the 600 MB log. Nothing
  looks inside the CLI.
- **The hub's cut with a canary** (see Readings), and **a log already over the limit when the hub starts**, as an
  install from before the change has: the Scope's "holds at most" covers it, no criterion names it, and when a
  right hub must cut it is open.
- **The "Not in this task" line**: Linux's journal, the logs of a run or an extension, and the spool are not
  touched, and nothing checks that a change leaves them alone.
- **The planted hubs and readers** don't exist yet. That each fails as its test expects is unverified until it is
  planted.

## Files

- `log.test.ts` (1), `design.test.ts` (1, Scope), `service.test.ts` (2), `bundle.test.ts` (3), `cut.test.ts` (3 and
  4), `canary.test.ts` (5), `budgets.test.ts` (6).
- `helpers.ts`: homes, the CLI, hubs by PID, the writer's client, the folder watch, the line reader, the log maker,
  the bundle and cut readers, the peak reading, the forms and the sweep.
- `fixtures/writer.mjs`, `fixtures/lines.mjs` with `lines.d.mts`, `fixtures/launcher.mjs`, `fixtures/agent-bin.sh`.
- `lane.json`: the folder runs alone. `tsconfig.json`: type-checks the folder under the root's strict options.
