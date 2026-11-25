# Acceptance tests for #3220: a run records what it used, and a run on a known key is admitted by that

Written first and blind, at base `f8c6cff822b5b960d35312d75d44769616a95516` (origin/main), from the issue, the design and
the base, before any implementation. The drafting job saw no fix, diff, other branch, other worktree or pull request.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). There is no taste criterion.

## Sources

- **The issue**, #3220, as read on 2026-11-23: the problem, Scope, Fields (`used: {memory_peak_mb, cpu_s}` on the event
  that ends a run, as `needs` is on the one that starts it, and what it can never be), the nine criteria and Proof.
- **The design**, `docs/technical-design.md` as `node scripts/design-section.mjs --issue 3220` prints it: Lease, Scale
  later (one host contract, "each run says what it needs"), An agent says it's done, and Numbers version 0 has to hold
  (budgets, the reference Macs, INCONCLUSIVE off them).
- **#3218, read as design**: a lease on a pool takes units; one ask for several kinds is granted whole or not at all; the
  `mem` kind is counted in MB; the event that records a lease gains `units`.
- **AGENTS.md.**
- **The base, for surfaces only**: `packages/supervisor/src/supervisor.ts` (`scanOnce`, the 100 ms scan, `own_sandbox`,
  `stopAtLimit`), `procs.ts` (`scan`), `types.ts`; `packages/hub/src/runs.ts` (`run.start`, `run.started@3`'s `needs`,
  `run.finished@2`, `run.output`), `gate-runner.ts` (keys, carrying, a run that reads only its own files never
  carrying), `shared-runs.ts`, `spec-checks.ts`, `stop-judging.ts` (spec checks, project trust, `outside`),
  `heavy.ts` (`deep lease`, its waiting lines, `DEEP_TEST_MEMORY_PRESSURE_FILE`), `hub-control.ts`, `plant.ts`,
  `hub-shared.ts` (`DEEP_HUB_TEST_CORES`); `packages/checks-command/src/index.ts` (a check `outside` runs with
  `own_sandbox`); `packages/gate/src/exec.ts` (`slot`), `own.ts`; `packages/leases/src/index.ts`;
  `crates/deep-hook/src/heavy.rs` and `heavy.json`; the schemas `run.started@3`, `run.finished@3`, `lease.acquired@2`,
  `heavy.command@1`, `check@1`; `scripts/throttle.mjs` (`machineReadings`), `scripts/budget-window.mjs`
  (`criterionId`), `scripts/lanes.mjs`, `scripts/benchmark.mjs` (`validateBudgets`); and the suites 1409, 1015, 1016,
  1411, 1018, 2218, 322, 237 and 2874 for their form. Nothing is imported from another suite: what was needed is copied
  into `helpers.ts` and `fixtures/agent.mjs`, each saying where from.

## Run

From the repository root, on macOS with Node 24.22, `cc`, and the pinned Rust toolchain under rustup:

```sh
npm ci
npm run build --workspaces                                   # the deep CLI and the supervisor's native helper
PATH=/opt/homebrew/opt/rustup/bin:$PATH cargo build -p deep-hook
NO_COLOR=1 scripts/lease node node_modules/vitest/vitest.mjs run tests/acceptance/3220 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3220/tsconfig.json
```

- `--no-file-parallelism`: AC3 holds three runs of about 600 MB at once in a 2,000 MB pool, AC9 counts a scan's processes, and AC4
  and AC3 judge a start within 5 s.
- Every folder is under `/tmp/dh3220-*` (real paths) and removed after its file; HOME is a temp folder for the hub and
  every child, TMPDIR a folder of the world's; this process's `CLAUDE*`, `DEEP_*`, `GIT_*`, `XDG_*`, `NODE_OPTIONS`,
  make and cargo job settings are taken out of every child's environment. RUSTUP_HOME and CARGO_HOME stay the user's, so
  AC7's cargo finds the pinned toolchain offline (`CARGO_NET_OFFLINE=true`). No network, no model, no port of the
  suite's own: the hub listens on a socket in its temp HOME. Every process a test starts is stopped by its PID or its
  process group's ID (`helpers.ts`, `cleanup`), never by name or port.
- No test copies this checkout's `.git`; each sample repo is a new `git init` under its world's folder, its worktrees
  `git worktree add` of it, with git's `GIT_*` settings stripped.

## The surface under test

- **`deep hub run`** (`packages/cli/dist/main.js`), on a temporary HOME, told its cores (`DEEP_HUB_TEST_CORES=16`), with
  `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK` as #322's suite sets them, the planted
  program in `DEEP_HUB_PLANT`, and the seams below.
- **The hub's socket** as the CLI uses it (the cli role, with the control token): `run.start` (AC1, AC2), `run.output`
  (a run's stdout, from its evidence once it has ended: AC3's spans) and `events.read` (the record).
- **Claude Code sessions** through the real deep-hook (`target/debug/deep-hook`), each hook a child of the session's own
  process (`fixtures/agent.mjs`), as #322's suite drives them: SessionStart, UserPromptSubmit, Read and Edit of
  `NOTES.md`, Stop. The stop makes the claim; the claim runs the repo's spec checks (AC3, AC5, AC6, AC8).
- **`deep lease -- <command>`** in a repo whose `.deepbuild/done.yaml` has `heavy_commands` (AC4, AC7), as #1015's and
  #1411's suites run it.
- **The supervisor's public entry** (`packages/supervisor/src/index.ts`), opened on a record and the asks core as #1409's
  suite opens it (AC9's count).

## Seams and plants

Every seam and plant string a test relies on, so the implementation honours them exactly. The fields the issue names
are fixed by it; the rest are this suite's choices, each in the style the base already uses.

| Seam or plant | What it is | Fixed by | Used by |
|---|---|---|---|
| `used: {memory_peak_mb, cpu_s}` on `run.finished` | what a hub run used: its tree's peak in MB and its CPU seconds, from the supervisor's scan; for a tree the scan couldn't read, `memory_peak_mb` null or absent, never 0 | the issue's Fields | AC1, AC2, AC3, AC5, AC6, AC8 |
| `used` on the event that ends a `deep lease` run | the same, on whichever event of the record names the lease's run (`run:LEASE…`) in `data.run` and carries `data.used` | the issue's Fields; the event is open | AC7 |
| `needs.memory_mb` on `run.started` | the MB the run was admitted on, its expected peak | the issue's Fields (`needs`) | AC3, AC5, AC6 |
| `lease.acquired` on kind `mem`, with `data.units` and `data.run` | the units of the `mem` pool a run holds, in MB | #3218 | AC3 (its `needs.memory_mb`, within 1: units are whole MB), AC7 (its entry's number) |
| `DEEP_HUB_TEST_MEM_MB=<MB>` | the `mem` pool's size on host `local`, in MB, as `DEEP_HUB_TEST_CORES` tells the hub its cores | this suite | every hub world: 2,000 in AC3 and AC4, 16,000 elsewhere |
| `DEEP_TEST_MEMORY_AVAILABLE_FILE=<file>` | a file holding the host's available memory in MB, read by the hub in place of the kernel's reading (#2980's) at each admission, as `DEEP_TEST_MEMORY_PRESSURE_FILE` holds the pressure level | this suite | every hub world: 1,000,000 MB, except AC4's 500 then 700 |
| `DEEP_TEST_MEMORY_PRESSURE_FILE=<file>` holding `normal` | the base's own (#1015), so this Mac's real pressure never holds a `deep lease` | the base | every hub world |
| `memory_mb: <MB>` on a check of `.deepbuild/done.yaml` | what the check declares it takes | this suite | AC5, AC6 (900), AC8 (290, 390, 490) |
| `memory_mb: <MB>` on a `heavy_commands` entry (`heavy.command@1`) | an agent's heavy command's number | this suite | AC4 (600), AC7 (1,500) |
| a line on the hub's stderr | a check run waiting on memory: one line naming memory and each run holding it, by its run handle, its session (`session:<id>` or the id's letters) or its worktree's folder | this suite | AC3 |
| `deep lease`'s own waiting line (stderr) | `deep lease: waiting …`, as on the base; for memory in use outside DeepBuild's runs it names memory and says `outside DeepBuild` | the base's line; the words are the issue's | AC4 |
| `reading.recorded` whose `source` starts `memory reserved` / `memory used` and names `local` | the host's readings of memory reserved and memory used, `value` in one `unit` | this suite | AC8 |
| `DEEP_HUB_PLANT=scan-keeps-first-sample` | the supervisor's scan keeps a run's first sample as its peak | the issue's plant; the string is this suite's | AC1 |
| `DEEP_HUB_PLANT=unread-peak-recorded-zero` | a run whose tree the scan couldn't read records a peak of 0 | the issue's plant; the string is this suite's | AC2 |
| `DEEP_HUB_PLANT=admits-on-class-constant` | a check run on a key is admitted on its class's constant of 1 GB (2 in a 2,000 MB pool) | the issue's plant; the string is this suite's | AC3 |
| `DEEP_HUB_PLANT=admits-on-nothing` | a run is admitted reading no number, so all four start | the issue's plant; the string is this suite's | AC3 |
| `DEEP_HUB_PLANT=admits-on-pool-only` | a run is admitted on the pool alone, whatever the available memory | the issue's plant; the string is this suite's | AC4 |
| `DEEP_HUB_PLANT=admits-on-one-peak` | a check run on a key with fewer than three clean runs is admitted on one run's peak | the issue's plant; the string is this suite's | AC5 |
| `DEEP_HUB_PLANT=admits-heavy-on-last-peak` | an agent's heavy command is admitted on its last run's peak | the issue's plant; the string is this suite's | AC7 |

A plant the base doesn't list stops the hub at its start (`plant.ts`: "names no planted program"), so on the base each
plant test is BLOCKED, never a pass.

## The fixture programs and the fixture repo

- **`fixtures/alloc.c`** (AC1, AC9), built with `cc` once per test process: `alloc parent <dir> <MiB> <wait> <cpu> <hold>`
  forks itself; the parent does nothing; the child waits, so the scan's first sample comes before its memory; allocates
  in 1 MiB blocks of pseudo-random words (resident, not compressible); works until its own CPU (getrusage) reaches
  `<cpu>` ms; holds `<hold>` ms; writes its own CPU seconds to `<dir>/child.json`; exits 0.
- **`fixtures/alloc.mjs`** (AC2): `node alloc.mjs <MiB> <hold ms>`.
- **`fixtures/memjob.mjs`** (AC4): the heavy command `memjob`; writes `S <ms>` and `E <ms>` to `$DH3220_LOG`.
- **`fixtures/check-alloc.mjs`**, copied into a sample repo as `test/<name>.mjs` beside `test/<name>.json`: one node:test
  test that writes `S <ms>`, allocates its MiB, holds them, writes `E <ms>` and passes. Its run reads nothing but those
  two files under `test/`, so its key holds only them and never carries (#1018: a run that read nothing but its check's
  own files): every claim runs it, from one session or several, and every run's `run.finished.key.id` names the key.
- **The sample repo** (`helpers.ts`, `sampleFiles`): `NOTES.md`, the checks' tests, and `.deepbuild/done.yaml` whose
  `claims.done.checks` names each spec check, `{ type: command, run: "node --test test/<name>.mjs" }`, with `memory_mb`
  where the test needs a declared number. Every session types one prompt, whose handed definition has one requirement
  with no drafted check of its own, so a claim's only check runs are the spec's; it reads and changes `NOTES.md`, which
  no check reads, and stops. The repo and every worktree are trusted through `~/.claude.json`'s workspace trust, which
  the hub reads for a repo's spec checks.
- **AC7's workspace**: one crate, `memtest`, whose one test holds 400 MiB for about 2.5 s; its `heavy_commands` entry for
  `cargo test` gives 1,500 MB.

## Criteria to tests

Each test's name starts with its ID, `#3220.` and the first 8 hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed (`criterionId` in `scripts/budget-window.mjs`), then `AC<n>`.

| Criterion | ID | Test (file) | What it asserts |
|---|---|---|---|
| AC1 | `#3220.023c3e9b` | `ac1-peak.test.ts`: the fixture run | `run.start` of `alloc parent` (600 MiB, waits 3 s, works to 1.5 s of CPU, holds 2 s): its `run.finished.used.memory_peak_mb` within 540 to 660, its `cpu_s` within 20% of the CPU seconds the child read of itself |
| AC1 | `#3220.023c3e9b` | `ac1-peak.test.ts`: `scan-keeps-first-sample` | the plant records under 100 MB, and the judgement above fails naming the run |
| AC2 | `#3220.ade7d70e` | `ac2-unread.test.ts`: two runs | the same command (`node alloc.mjs 300 2000`) through `run.start`: in the supervisor's sandbox it records a peak of at least 270 (the control); `outside: true`, which the command check kind runs with `own_sandbox`, records `memory_peak_mb` null or absent, never a number |
| AC2 | `#3220.ade7d70e` | `ac2-unread.test.ts`: `unread-peak-recorded-zero` | the plant records 0, and the judgement fails naming the run |
| AC3 | `#3220.4f86303d` | `ac3-key.test.ts`: three then the fourth | the key's three clean runs record peaks of 500 to 700; four later runs of the key, each admitted (`needs.memory_mb`) between 95% of the smallest history peak and 105% of the largest peak, holding that many `mem` units (within 1); three hold their memory together, the fourth only after one ends and within 5 s of it; the hub's stderr has a line naming memory and the three holders |
| AC3 | `#3220.4f86303d` | `ac3-key.test.ts`: `admits-on-class-constant`, `admits-on-nothing` | the plants start two, and four, at once, and the judgement fails on each |
| AC4 | `#3220.ea9feb2e` | `ac4-available.test.ts`: waits | `deep lease -- memjob` (its entry 600 MB, the pool 2,000 MB and free, 500 MB available): memjob hasn't started 3 s after deep lease's first line; deep lease's line names memory and says `outside DeepBuild`; memjob starts within 5 s of the reading turning 700; exit 0 |
| AC4 | `#3220.ea9feb2e` | `ac4-available.test.ts`: `admits-on-pool-only` | the plant starts memjob at once, and the judgement fails |
| AC5 | `#3220.33b787b4` | `ac5-ac6-declared.test.ts`: declared | on `alloc` (declares 900), the key's runs with 0, 1 and 2 clean runs before them are each admitted on 900 |
| AC5 | `#3220.33b787b4` | `ac5-ac6-declared.test.ts`: `admits-on-one-peak` | the plant admits the second run on the first's peak, and the judgement fails naming the key |
| AC6 | `#3220.d549cdd6` | `ac5-ac6-declared.test.ts`: a new key | the key's fourth run is admitted on its peaks' 95th percentile (between their median and their largest); a change to `test/alloc.json` (480 to 240 MiB) makes a new key, whose first three runs are admitted on 900 and its fourth on its own peaks |
| AC7 | `#3220.24f80034` | `ac7-lease.test.ts`: two leased runs | two `deep lease -- cargo test --workspace`: each lease's run records `used` (a peak of at least 360 MB and at most 8,000, CPU seconds above 0 and at most 600), and each holds 1,500 `mem` units, the second too |
| AC7 | `#3220.24f80034` | `ac7-lease.test.ts`: `admits-heavy-on-last-peak` | the plant gives the second run the first's peak, and the judgement fails naming the second run |
| AC8 | `#3220.783a59e5` | `ac8-readings.test.ts` | five sessions in five worktrees claim at once with three spec checks (200, 300 and 400 MiB, declaring 290, 390 and 490): every run records its peak; the host's newest `memory reserved` and `memory used` readings exist, are above 0, share a unit, and differ by under a quarter of what was reserved |
| AC9 | `#3220.c2610cec` | `ac9-budgets.test.ts`: the perf lane | `benchmarks/budgets.json` has a task whose `criteria` name `#3220.c2610cec`, valid against the merge base's budgets (`validateBudgets`), and each such task runs and exits 0 |
| AC9 | `#3220.c2610cec` | `ac9-budgets.test.ts`: process starts | with one run in flight under the supervisor, a scan starts no more than the merge base's 2 processes (its helper's scan and one `ps`), counted through Node's `child_process` diagnostics channel |

## How each criterion is read

- **AC1, "records"**: on the run's end event, `run.finished`. "600 MB" is 600 MiB allocated; within 10% is 540 to 660, so
  a reading in MiB or in MB passes and one in KB or bytes fails. "What the child reports for itself" is the child's
  getrusage at its end, which it writes to a file. The child waits 3 s before allocating, so a scan that keeps its
  first sample keeps one taken before any of its memory: under 100 MB.
- **AC2, "records no peak"**: `memory_peak_mb` null or absent on the run's end, never a number. The control run in the
  supervisor's sandbox makes the test fail on a program that records nothing for any run, the base among them.
- **AC3**: "peaked near 600 MB" is 500 to 700 (480 MiB in a Node test run: on this Mac its two processes' resident
  memory peaked at 579 MiB, read with `ps`). "Each holding about 600" is its `needs.memory_mb` within the key's peaks
  (the issue's 95th percentile of three lies between their median and their largest; the bound allows 5% either way and
  the peaks of the key's later runs), and as many `mem` units, within 1. "Start together" is when each run held its memory, by the
  fixture's own `S` and `E` lines: the first three start before any of them ends, and no more than three overlap. "Starts
  within 5 s of one ending" is from the first of the three's `E` to the fourth's `S`; over 5 s on a machine whose load is
  past its cores it reads INCONCLUSIVE. A check run has no terminal of its own, so "its line" is the hub's: a line on its
  stderr, where it writes its other lines about the pools (#1411). The class's constant is the issue's 1 GB; the plant
  test asserts what the issue says it does (two at once) before the judgement fails on it.
- **AC4, "a run that expects 600 MB"**: an agent's heavy command whose entry gives 600, the one admission whose line
  the base already prints (`deep lease: waiting …`). "With the pool free": the pool is 2,000 MB and nothing holds it.
  "Its line naming memory outside DeepBuild's runs": a line of `deep lease`'s output with `memory` and `outside
  DeepBuild`. "Within 5 s of the reading passing 600 MB": from the test writing 700 to memjob's own `S`; over 5 s
  under load reads INCONCLUSIVE.
- **AC5, "a key with two clean runs"**: the key's third run, which has two clean runs before it; the first and second
  are judged the same way, as a key with fewer than three. "What its check declares" is `memory_mb` on the spec check.
  "Naming the key": the failure names its `key.id`.
- **AC6, "a change to a check's inputs"**: a change to a file the check's run reads (`test/alloc.json`), in the worktree
  the next claims snapshot. "Until it has three clean runs of its own": the new key's fourth run is admitted on the new
  key's own peaks (240 MiB, so they can't be the old key's), and the old key's fourth run before the change on its own.
- **AC7, "records … on its lease's run"**: the lease's run is the `run:LEASE…` its `lease.acquired` events name; its use is
  on whichever event names that run and carries `used`. Its test holds 400 MiB, so the tree's peak is at least 360 MB;
  the upper bounds catch bytes, KB and milliseconds. "Admitted on its entry's number": its `mem` lease's units equal the
  entry's 1,500, for the second run too, whose last run's peak is about 450.
- **AC8, "the host's reading … for the run"**: the newest `reading.recorded` of each kind for host `local` once the
  scenario's fifteen runs have ended, on a hub that ran nothing else. "Differ by under a quarter": |reserved − used| <
  reserved / 4. The checks declare their allocation and about 90 MB for Node's two processes, so a hub that admits them
  on what they declare and reads what they used passes; one that admits on the class's constant, or records nothing
  (the base), fails. The aggregate (a sum over runs, or over time) is the implementation's, in one unit.
- **AC9**: "compared with the merge base" is the perf lane's comparison, as #237's and #1015's budgets read it: its task
  names the criterion's ID, and its judge reads the times on the reference Mac at rest. "Adds no process start to a
  scan" is counted here too: process starts per scan of one live run, against the base's 2 (BASE-FAILURE.txt), with a
  tenth of a start for a new process the scan tracks. The times (under 1 ms to a scan, under 1 ms to decide one
  admission with 10,000 keys kept) are the perf lane task's to measure: this suite names no internal call to time.

## Lane placement

`lane.json` runs the folder alone, by `scripts/lanes.mjs`'s own reasons (`aloneReasons`): `shared: the sandbox log
stream`, since every file but AC9's starts a hub whose supervisor reads the system's one log stream, and AC9's opens the
supervisor itself; that reason outranks the others that hold too: `binary` (the hubs run deep-hook from `target/`, and
AC7 starts cargo) and `timing` (AC9's perf task, AC3's and AC4's 5 s bounds). The files also hold up to three 600 MB runs
at once, which the owner's ruling (#3066) counts as `shared: memory`.

## Files

- `ac1-peak.test.ts`, `ac2-unread.test.ts`, `ac3-key.test.ts`, `ac4-available.test.ts`, `ac5-ac6-declared.test.ts`,
  `ac7-lease.test.ts`, `ac8-readings.test.ts`, `ac9-budgets.test.ts`: the criteria, as above.
- `helpers.ts`: tags, seams and plants; the world, the hub, its socket, sessions, `deep lease`, the record's readers.
- `fixtures/`: `agent.mjs` (from #322's), `alloc.c`, `alloc.mjs`, `check-alloc.mjs`, `memjob.mjs`.
- `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
