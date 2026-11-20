# #2649: what a sandboxed run costs in process starts, and which can go

Issue #2649 asks which processes the supervisor starts for one sandboxed run, from its start to its cleanup, and for
a run that lives an hour and forks nothing; which of them a kernel event, one longer-lived helper or a kept answer
could replace, with what each would change; what the cuts tried save on the perf lane's three sandbox tasks; and how
long a fork inside a run waits for its `process.tracked` event. The issue changes no code: the cuts tried are patches
kept here (`cut-A.patch`, `cut-B.patch`), applied only to scratch copies for their measurement. The proof is
`tests/acceptance/2649/`, written blind from the issue before this spike; it checks `record.json` against the kept
counter logs.

## Files

- `measure.mjs`: every reading, run from the repo root on macOS with Node 24 after `npm run build --workspaces`:
  - `node docs/spikes/2649/measure.mjs starts command-check`: one command check (`runCommandCheck` on a 200-test Vitest
    project, the project `benchmarks/command-check.mjs` writes) through the supervisor's sandbox, in one process that
    opens the record, the asks core and the supervisor, runs the check, cleans it up and closes. The process runs
    under the perf lane's child counter (`scripts/count-children.c`, built with the flags `scripts/benchmark.mjs` uses)
    with `sites.mjs` loaded into it. Keeps `out/command-check.counter.log`, `out/command-check.sites.jsonl`; prints
    `out/command-check.json`.
  - `node docs/spikes/2649/measure.mjs starts idle-hour`: the same for one sandboxed `/bin/sleep 3600`, which forks
    nothing. Keeps `out/idle-hour.counter.log`, `out/idle-hour.sites.jsonl.gz`; prints `out/idle-hour.json`.
  - `node docs/spikes/2649/measure.mjs latency 200`: a sandboxed Node program forks 200 children of `/bin/sleep 2` at
    random gaps of 20 to 260 ms, each fork's time written just before its `spawn`; each is joined by PID to its
    `process.tracked` event's `ts`. No counter, as a hub runs. Keeps `out/latency.samples.jsonl`; prints `out/latency.json`.
  - `node docs/spikes/2649/measure.mjs cut <id> <copy>`: the three tasks of `benchmarks/budgets.json`, `sandbox-setup`,
    `runner-job` and `command-check-count`, with their own commands, in this checkout (main) and in `<copy>` (this
    checkout with `cut-<id>.patch` applied and `packages/supervisor` built: `cp -cR <checkout> <copy>`, then in the copy
    `git apply docs/spikes/2649/cut-<id>.patch` and `npm run build -w packages/supervisor`), one unkept round a side and
    then 15 rounds a side, the first side alternating round by round. Keeps `out/cut-<id>.json`, whose `date` is when
    the measurement started.
  - `node docs/spikes/2649/measure.mjs ps`: `ps`'s CPU time per start for each shape the supervisor runs (below).
    Prints `out/ps.json`.
- `sites.mjs`: loaded with `--import` into the measured process. It wraps `ChildProcess.prototype.spawn`, through which
  `spawn`, `execFile` and `exec` all go, and logs each start's PID, program, arguments, the repo's frames that led to
  it and the measured phase (`open`, `run`, `cleanup`, `close`), and when it closes a hash of what it printed and the
  PIDs it listed. No process gets other arguments, environment or stdio; the hook adds a stack capture, a listener on
  each child's output and a synchronous log write per start, so it changes timing a little. The latency run doesn't
  load it.
- `analyze.mjs`: `node docs/spikes/2649/analyze.mjs` builds `record.json` and this file's tables from `out/`. Every count
  and instruction total comes from a kept counter log, joined to its sites by PID; the file adds each site's reading
  (what it is for, its verdict, what holds or would replace it), written once per site.
- `record.json`: the table as data, the cuts' rounds, the latency, and the recommendation.
- `cut-A.patch`, `cut-B.patch`: the two cuts tried, against main.

## How a reading was taken, and what it can't read

- **Main.** Every reading ran on `b4a2049e8` (origin/main on 2026-11-19), with only the acceptance tests' commit and
  this folder on top: no package, benchmark or script differs from main.
- **The machine.** An Apple M3 MacBook Air (8 cores, 16 GB), macOS 27.2.1, on mains power, Node 24.22.0. Other
  sessions shared the Mac: one-minute load averages ran from 7 to 138 (each reading records its own), and the idle
  hour ran while both cuts were measured. What a beat starts doesn't move with load; how many beats a run lives
  through does (main's sides of the cut rounds start 392 to 570 processes per `command-check-count` run), and instructions retired
  move a little through code that polls (cleanup's 20 ms waits).
- **Which commit.** The subjects ran in this branch's checkout at `72ed0f03e` (main `b4a2049e8` plus the acceptance
  tests, no supervisor change), which `out/*.json` names as `main`; `record.json` names main itself.
- **Redacted.** The kept logs had the home folder's name in their paths; it is `/Users/<user>/` throughout `out/`
  (`sed 's|/Users/<name>/|/Users/<user>/|g'`, before the hashes in `record.json` were taken). Nothing else changed.
- **The idle hour adopted a leftover.** A first attempt at the hour died when the Mac's disk filled, and left its
  sandboxed `/bin/sleep` running under the same run name, so with the same marker. The second attempt's scan found it
  10.6 s in, tracked it (one `ps -E`), and named it in each beat's `ps -p` until it ended 1,683 s in, at the hour of
  its own start: 16,024 beats asked `ps` about two PIDs instead of one. Every beat still started one helper and one
  `ps`, so the starts are as a lone run's; the instructions of those helper scans include one more process's check. A
  hub names every run uniquely, so this is the measurement's artifact, not a hub's.
- **`ps` has no count.** `/bin/ps` is setuid root, and the kernel refuses its instructions retired to the counter's
  `proc_pid_rusage`: every `ps` start is `unread` in the logs and adds 0 to its row. `/usr/bin/time -l` is refused it
  too. A copy of `ps` without the setuid bit is killed at launch. What can be read is its CPU time: `wait4` gives a
  parent its waited children's, so `measure.mjs ps` runs 200 of a shape under one shell inside `/usr/bin/time -p`.
  Per start, with the shell's own fork and wait in each: <!-- ps -->
  `ps -p <pid> -o pid=,ppid=,pgid=,lstart= (start-time, beat-ps)` 1.85 ms; `ps -E -ww -o command= -p <pid> (token)` 2.05 ms; `ps -A -o pid=,ppid=,pgid=,lstart= (provable)` 14.85 ms; `helper scan <marker> (scan-beat, scan-cleanup)` 3.85 ms; `/usr/bin/true (the floor)` 1.55 ms.
<!-- /ps -->
- **Inside the sandbox nothing is followed.** `sandbox-exec` is a platform binary, so the counter's library can't enter
  it and whatever it starts goes unlogged. The run's own process is one start (`sandbox-exec`, which execs the program
  in place); its count is that process's alone, the Vitest workers it forks not included. A run's own work is not what
  this issue asks about.
- **The perf lane's own total is missing on this Mac.** `scripts/benchmark.mjs`'s `measureOnce` gives these three tasks no
  instructions at all here, on main: the supervisor's `helper leash` and the watcher it forks beside `/usr/bin/log` are
  killed at the supervisor's close, so no count of theirs is ever written, and a run with an unread child counts as
  none. The cuts' readings therefore sum, as `countChildren` does, every process the counter read, and name the rest
  (`uncounted` in each round: the same processes on both sides).

## The starts

`command-check` is one sandboxed command check from the supervisor's open to its close; `idle-hour` one sandboxed run
of an hour that forks nothing. Each row is one caller (the process that started it: `<root>` is the measured Node
process, the hub's part) and program, as the counter logs them, split by the code site that started each; "Same
answer as the last" counts the starts whose answer was the one the previous start of the same site and question gave
(a scan's PIDs, all of a `ps`'s output). The verdicts are explained per site below.

<!-- table -->
| Subject | Caller | Program | Starts | Instructions retired | Unread | Site | Site starts | Same answer as the last | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| command-check | `<root>` | `helper` | 21 | 732,600,672 | 1 | `scanOnce` (timed, every 100 ms) → `helper scan <marker>` | 15 | 12 | replaceable |
|  |  |  |  |  |  | `cleanupOnce` and `leftovers` → `scanOnce` → `helper scan <marker>` | 4 | 4 | repeated |
|  |  |  |  |  |  | `watchDenials`: `helper leash /usr/bin/log stream` | 1 | – | needed |
|  |  |  |  |  |  | `watchDenials` again, on the next filter, after the canary never showed | 1 | – | replaceable |
| command-check | `<root>` | `sandbox-exec` | 34 | 8,548,712,320 | 0 | `warm`: `sandbox-exec … helper probe` (the canary) | 33 | – | replaceable |
|  |  |  |  |  |  | `launch`: `sandbox-exec -p <profile> <program>` (the run itself) | 1 | – | needed |
| command-check | `helper` | `(forked)` | 2 | 0 | 2 | the leash's own watcher, forked beside `log` | 2 | – | needed |
| command-check | `<root>` | `ps` | 16 | 0 | 16 | `scanOnce` → `table(held)`: `ps -p <held pids> -o pid=,ppid=,pgid=,lstart=` | 14 | 12 | replaceable |
|  |  |  |  |  |  | `launch` → `table([pid])`: `ps -p <pid> -o lstart=` | 1 | – | needed |
|  |  |  |  |  |  | `scanOnce` → `tokenOf`: `ps -E -ww -o command= -p <pid>` | 1 | – | needed |
| idle-hour | `<root>` | `helper` | 34991 | 1,286,989,524,149 | 1 | `scanOnce` (timed, every 100 ms) → `helper scan <marker>` | 34986 | 34983 | replaceable |
|  |  |  |  |  |  | `cleanupOnce` and `leftovers` → `scanOnce` → `helper scan <marker>` | 3 | 3 | repeated |
|  |  |  |  |  |  | `watchDenials`: `helper leash /usr/bin/log stream` | 1 | – | needed |
|  |  |  |  |  |  | `watchDenials` again, on the next filter, after the canary never showed | 1 | – | replaceable |
| idle-hour | `<root>` | `sandbox-exec` | 37 | 6,510,891,818 | 0 | `warm`: `sandbox-exec … helper probe` (the canary) | 36 | – | replaceable |
|  |  |  |  |  |  | `launch`: `sandbox-exec -p <profile> <program>` (the run itself) | 1 | – | needed |
| idle-hour | `helper` | `(forked)` | 2 | 0 | 2 | the leash's own watcher, forked beside `log` | 2 | – | needed |
| idle-hour | `<root>` | `ps` | 34987 | 0 | 34987 | `scanOnce` → `table(held)`: `ps -p <held pids> -o pid=,ppid=,pgid=,lstart=` | 34985 | 34983 | replaceable |
|  |  |  |  |  |  | `launch` → `table([pid])`: `ps -p <pid> -o lstart=` | 1 | – | needed |
|  |  |  |  |  |  | `scanOnce` → `tokenOf`: `ps -E -ww -o command= -p <pid>` | 1 | – | needed |
<!-- /table -->

### Per site

- **`watchDenials`: `helper leash /usr/bin/log stream`** (needed, once a supervisor). The stream every sandbox refusal
  reaches the record by. The leash forks a watcher beside it (helper → `(forked)`), which ends the stream when the
  supervisor's process ends.
- **`warm`: the canary, `sandbox-exec -p <profile> helper probe`** (replaceable). The stream counts as live only once a
  refused write of its own shows through it. On this macOS the first filter, by the reports' subsystem
  `com.apple.sandbox.reporting` (the Nov 10 audit's), never shows the canary: the warm-up probes about every 320 ms for
  its full 10 s, then the stream starts again on the next filter (the second `leash`), where the next probe shows at
  once. Every supervisor open on this Mac pays 33 sandboxed starts and 10 s, and **the first sandboxed run waits those
  10 s** (`launch` awaits the warm-up): 33 to 36 probes in these readings. A launch more than `WARM_MS` (60 s) after
  the last report seen warms again for up to 2 s, so a hub whose runs come more than a minute apart pays probes per
  run; these subjects, one run each, never reach that. A kept answer, the filter that last worked on this macOS build,
  started first, would make it one probe; a new build walks the filters once, as now. This is a finding of its own:
  the subsystem filter that the audit found on macOS 27.2 misses on 27.2.1 here, where the reports carry an empty
  subsystem (`out/hand-e2e.txt`, part 3: 0 reports through that filter, 10 of 10 through the kernel's).
- **`launch`: the run's process** (needed).
- **`launch` → `table([pid])`: `ps -p <pid> -o lstart=`** (needed). The first process's start time, the identity its
  PID is matched by from then on. Nothing earlier holds it.
- **`scanOnce` every 100 ms: `helper scan <marker>`** (replaceable by a kernel event). The only way a fork is found:
  the helper lists every process whose Seatbelt profile allows the run's marker. While a run lives it costs one start
  a beat. In an hour that forks nothing, every scan's PIDs were the last scan's: it can learn only the memory figure
  (read for a `memory_mb` limit, which this run has none of): its answer is the last one's, so it is repeated as well
  as replaceable. The helper's `watch` (kqueue `NOTE_FORK`/`NOTE_EXIT`), built and started for runs with a file
  limit, follows a run's forks as they happen but prints only exits; printing each fork it attaches to, it could
  track forks without a scan, and the scan would then be a backstop for a process the watch misses (one reparented,
  or gone, before it was attached), at a slower beat.
- **`scanOnce` → `table(held)`: `ps -p <held pids> -o …,lstart=`** (replaceable by a kept answer). Each beat that finds a
  process reads its start time again, to tell a new process from a reused PID. `helper scan` already reads each
  process's `proc_bsdinfo`, which holds it: printing it as `ps` does (`strftime` `%c`) gives the same text with no
  start (cut A). The Linux helper (`native/helper-linux.c`) would need the same field.
- **`scanOnce` → `tokenOf`: `ps -E -ww -o command= -p <pid>`** (needed). A new process's run token, once.
- **cleanup's scans: `helper scan <marker>`** (repeated). `cleanupOnce` scans before each signal round, again after,
  and `leftovers` scans once more before recording ends: 3 scans for a run already over (the command check's
  cleanup phase also holds one timed beat). A sandbox gains a process only by a fork inside it, so once scans begun
  after the run's first process exited find it empty, no later scan can find one. One scan isn't enough to know it:
  `helper scan` lists the PIDs once and then checks each, so a member can fork and exit between the two, leaving an
  empty answer and a live child. Two empty scans in a row, the second begun after the first ended, settle it (cut B
  as tried stops after one).
- **Not reached by either subject: `provable`.** When a tracked process is still alive at cleanup or `signal`,
  `provable` reads `ps -A` (every process on the machine; `out/ps.json` puts it at several times a `ps -p`), scans
  again and runs `ps -E` per candidate. Both subjects' processes had exited by their cleanup, so the table has no row
  for it (Not run).

## Fork to `process.tracked`

<!-- latency -->
200 forks, every one tracked: **p50 113 ms, p95 174 ms** from the fork's `spawn` to its
`process.tracked` event's `ts` (nearest rank; `out/latency.samples.jsonl`, read on main by `node docs/spikes/2649/measure.mjs latency 200`, load
12.8, 17.7, 18.8 before). A fork waits for the next beat (0 to 100 ms), then for the scan, the `ps -p`, the
`ps -E` for its token and the record's append. The idle hour: 70017 starts in 3610.612 s, **19.39 a second**.
<!-- /latency -->

## The cuts tried

Each against main, measured by `node docs/spikes/2649/measure.mjs cut <id> <copy>`; every round's readings are in
`out/cut-<id>.json`.

- **A: `helper scan` prints each process's start time** (`cut-A.patch`, +15 −8). `scanOnce` takes it from the scan
  and runs no `ps -p` for the held PIDs. macOS only: the Linux helper's scan prints no start, so on Linux the patch
  would track nothing.
- **B: a run that is over is scanned no more** (`cut-B.patch`, +8 −1). A run whose first process has exited and that a
  scan begun after that found empty drops out of the scanned runs: no timed beat, and cleanup's scans skip it. As
  tried it trusts one empty scan, which has the race above; two in a row would cost one more helper start a run.
- Each cut is also a commit on main (`record.json`: `change`, on the local branches `spike/2649-cut-A` and `-B`).

<!-- cuts -->
| Cut | Task | Median instructions, main | Median, cut | Median of the 15 rounds' cut ÷ main | Starts in one task run, median, main → cut |
|---|---|---|---|---|---|
| B | `sandbox-setup` | 14.34 G | 12.46 G | 0.8724 | 172 → 126 |
| B | `runner-job` | 12.16 G | 10.98 G | 0.9092 | 122 → 93 |
| B | `command-check-count` | 128.61 G | 127.57 G | 0.9904 | 422 → 368 |
| A | `sandbox-setup` | 14.28 G | 14.35 G | 1.002 | 172 → 171 |
| A | `runner-job` | 12.22 G | 12.24 G | 0.9991 | 124 → 120 |
| A | `command-check-count` | 129.74 G | 130.70 G | 1.0077 | 476 → 340 |
<!-- /cuts -->

What they show:

- **B saves what the counter reads.** Its rounds were lower than main's in 15 of 15 on `sandbox-setup`, 15 of 15 on
  `runner-job` and 14 of 15 on `command-check-count`. It takes about 2.3 helper starts off each of `sandbox-setup`'s 20
  runs (cleanup's scans of a run already over, and the timed beats between a run's exit and its cleanup), which is
  12.8% of that task's counted instructions; on `command-check-count` the Vitest runs dwarf it.
- **A saves what the counter can't read.** It took 136 of 476 starts off `command-check-count`, every one a `ps`, and
  the counted instructions didn't move (1 of 15 rounds lower); the starts it takes are `ps` by construction (the
  patch removes only `table(held)`), not by a count per program, which the rounds don't keep. `ps` is setuid, so its
  instructions were never in the
  count, and the helper's added `strftime` is. Its gain is CPU time the counter has no line for: a `ps -p` start
  costs 1.85 ms of CPU against 1.55 ms for `/usr/bin/true` (`out/ps.json`), so dropping it saves about 1.85 ms a beat,
  most of it the cost of starting any process, ten times a second for as long as a run lives.
- **The existing tests** (`out/tests.txt`). `tests/acceptance/236/`'s hub, contain and dependents suites: 11 of 12 on
  main, A and B alike; the one failure, AC7 (a crash's leftovers reaped on restart), times out waiting for the run's
  server process on all three. `tests/acceptance/30/sandbox.test.ts`: 2 of 2 on all three. `supervisor.test.ts`: 7 of
  7 on main and A. B fails its "a cleaned run has no scan of its sandbox still running" alone in 3 of 3 runs (main
  passes 3 of 3), on the test's precondition ("cleanups that were recorded while a timed scan ran", 3 where 5 are
  needed): B leaves no timed scan running for a run already drained, which is the cut. It passed once inside a wider
  run under load, where beats ran late enough to still overlap.

## Recommendation

<!-- recommendation -->
1. **B: a run that is over is scanned no more.** Measured: median instructions fell 12.8% on sandbox-setup, 9.1% on runner-job and 1.0% on command-check-count, lower in 15, 15 and 14 of 15 rounds, with 46 of 172 starts gone from sandbox-setup's 20 runs. It needs no new mechanism and changes no event. As tried it stops after one empty scan, which has a race: helper scan lists PIDs once and checks each in turn, so a member can fork and exit between the two and leave an empty answer while its child lives; the issue's cut needs two empty scans in a row (one more helper start a run, not measured). As tried it fails one existing test, packages/supervisor/src/supervisor.test.ts 'a cleaned run has no scan of its sandbox still running', in 3 of 3 runs alone (main passes 3 of 3; out/tests.txt): that test needs a timed scan to be running while run.cleaned is recorded (its precondition, 'without one the test shows nothing'), and the cut leaves none to run for a run already drained. The test's guarantee (no scan outlives a cleanup) still holds; its precondition has to be rewritten, which needs an approved proposal, so the cut belongs in an issue of its own and not in a quiet follow-up.

   Drafted criterion: A sandboxed run whose first process has exited, and whose sandbox two helper scans in a row found empty (the second begun after the first ended, both begun after that exit), starts no further helper scan, timed or in cleanup: in docs/spikes/2649/measure.mjs starts command-check its cleanup records run.cleaned and process.ended as on main and starts at most 2 helper scans (main: 4), with no timed beat for the run after it; sandbox-setup's median instructions retired over 15 alternated rounds against main (measure.mjs cut) are lower; a run that leaves a forked process behind at its first process's exit is still found, signalled and recorded (tests/acceptance/236's leftover and late-grandchild cases pass unchanged); and supervisor.test.ts's no-scan-after-cleanup case is rewritten, by an approved proposal, to make its timed scan with a run still live, and passes.

2. **A kept answer for the denial stream's filter, per macOS build.** Not tried as a patch. On this Mac (macOS 27.2.1) the subsystem filter never shows the canary, so every supervisor open starts 33 to 36 sandboxed canary probes (about 5.8 G instructions, most of the command check's counted 9.3 G) and a second log stream, and the first sandboxed run waits the warm-up's full 10 s. The first step is finding why the subsystem filter misses here when the Nov 10 audit found it on 27.2. The reports on 27.2.1 carry an empty subsystem (out/hand-e2e.txt, part 3).

   Drafted criterion: On a macOS whose sandbox reports don't carry the subsystem com.apple.sandbox.reporting, the second supervisor opened on the same macOS build starts at most 2 canary probes and one log stream before its first sandboxed run, and that run's start call returns (sup.start resolves `started`) within 1 s of being made (docs/spikes/2649/measure.mjs starts command-check, run twice); a refused write in that run is still recorded as sandbox.denied, and supervisor.test.ts's reports-other-subsystem case passes unchanged.

3. **A: helper scan prints each process's start time, and the beat runs no ps.** Measured: no change in instructions retired on the three tasks (median ratios 1.002, 0.999, 1.008), because the counter cannot read ps (setuid root), so what the cut removes was never in the count; on command-check-count it took the median starts of a run from 476 to 340 (the cut removes only ps starts, by construction). Its gain is a start a beat: an idle sandboxed run would start 10 processes a second instead of 20, for as long as it lives; out/ps.json puts a ps -p at 1.85 ms of CPU a start against 1.55 ms for /usr/bin/true, so most of what it saves (about 1.85 ms a beat) is the cost of starting any process. As tried it is macOS only: native/helper-linux.c prints no start, and the patched scanOnce would track nothing on Linux. Worth an issue only with a measure that reads ps, such as the supervisor's CPU time over an idle hour, and with the Linux helper printing the same field.

   Drafted criterion: An hour-long idle sandboxed run (docs/spikes/2649/measure.mjs starts idle-hour) starts at most 10.5 processes a second and no /bin/ps after its first process is tracked, on macOS; on Linux, where measure.mjs and the counter don't run, the supervisor starts no ps for a tracked process (a Linux test of its own, which doesn't exist yet); process.tracked carries the same start text as ps -o lstart= under LC_ALL=C for every process of tests/acceptance/236's suites; and the fork-to-process.tracked p95 (measure.mjs latency 200, median of 3 runs) is within 10% of main's read the same way on the same machine at a recorded load.

4. **Follow a run's forks by kernel event, the marker scan as a slower backstop.** Not tried. The helper's watch (kqueue NOTE_FORK and NOTE_EXIT) is built and started for runs with a file limit, but prints only exits: it would have to print each fork it attaches to. Following every sandboxed run with it would see a fork sooner than today's p50 of 113 ms and p95 of 174 ms (read at load 12.8 to 18.8 on 8 cores, above the 50 ms the beat alone explains), and would let the marker scan run far less often than every 100 ms; the scan stays for a process the watch misses (reparented or gone before it was attached), which only it can find. This is the design change the issue's three-way question points to, and the one with the most to gain over hours; it needs its own design pass on the backstop's period and on reading memory_mb.

   Drafted criterion: On the same machine and at a recorded load, the fork-to-process.tracked p95 of docs/spikes/2649/measure.mjs latency 200 (median of 3 runs) is at most a quarter of main's read the same way (a target: no watch-based reading exists yet; main read 174 ms on the spike's Mac at load 12.8), an hour-long idle sandboxed run starts at most 1 process a second, and tests/acceptance/236's cases for a grandchild in its own session and group, a process that outlives its parent, and a memory_mb stop pass unchanged.
<!-- /recommendation -->

## Not run

<!-- notrun -->
- **Linux.** Every reading is from one Mac. The Linux supervisor's starts (`native/helper-linux.c`, `startNow`'s
  `execFileSync`) weren't counted, and cut A as tried would track nothing there.
- **`provable` and its `ps -A`.** Neither subject leaves a process alive at cleanup, so that path has no row; a run
  stopped with live processes, or `signal`, would add it.
- **What `ps` costs in instructions.** `/bin/ps` is setuid root, so neither the counter nor `/usr/bin/time` can read
  it; `out/ps.json` gives CPU time per start instead, so cut A's gain is in milliseconds, not instructions.
- **Starts inside the sandbox.** `sandbox-exec` is a platform binary, so the counter sees none of its children (the
  sandboxed program's own forks), nor the leash's watcher, which exits by `_exit`: these are the starts the redrafted
  acceptance test asks for and main can't log (Acceptance tests, below).
- **Cut B with two empty scans**, as its drafted criterion asks, and the kernel-event fork following: neither was
  built or measured. The fork-to-`process.tracked` time was read on main only.
- **Full suites.** The cuts ran the supervisor's tests, `tests/acceptance/236/` and `tests/acceptance/30/sandbox` only
  (`out/tests.txt`), not `node scripts/affected.mjs` or preflight: the cuts are measured copies, not changes to land.
- **A quiet Mac.** The load was what other sessions made it (7 to 138); no reading waited for it.
<!-- /notrun -->

## Acceptance tests

`node --test tests/acceptance/2649/*.test.mjs tests/acceptance/2649/redraft/*.test.mjs` (Node 24): 73 of 75 pass. The two that fail are
both drafts of AC1's test, so AC1 is **BLOCKED**, for a person to settle:

- **The first draft** (`tests/acceptance/2649/spike.test.mjs`) keys the counter's `reap` and `exit` lines by PID. Over
  the idle hour's 70,017 starts PIDs come round again, so it gives a reused PID's every start the last one's count,
  and asks the table for sums no log-order reading gives (`idle-hour/<root>/ps`: 0 instructions, all unread, where its
  PID-keyed sum gives 322,593,621,216, other programs' reaps landing on `ps` starts whose PIDs they reused).
- **The blind redraft** (`tests/acceptance/2649/redraft/`, `REDRAFT.md`), written from the criterion and the counter
  alone, reads in log order and agrees with this table's every row. It fails on its own rule that the counter's
  accounting shows no unlogged start: on main, a sandboxed `helper` forks inside `sandbox-exec`, a platform binary
  the counter can't enter, and the leash's watcher leaves by `_exit`, so main can't log those starts and no table
  read from its counter lists them. A first redraft attempt ran against the wrong checkout and was discarded. The
  first draft's committed `BASE-FAILURE.txt` carries a home-folder path; it is a test file and is left as committed.

Both readings of "every process start" can't be met on main as written; the choice (accept the logged starts with
the unloggable ones named, as this table does, or change the counter) is the user's.
