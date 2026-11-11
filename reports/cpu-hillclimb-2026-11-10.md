# CPU hill-climb audit, 2026-11-10

Base: main at `435141d5`. Asked for: audit package by package and hill-climb on CPU usage.

An idle hub and the one child it keeps now use about 2.3 ms of CPU a second on the audit's Mac, where they used
about 39 ms. Three edits in the supervisor and the record did it: +63 −16 lines outside tests, and one new test.
Each was measured against the base, sides alternated, and kept only for a gain the counters showed. Two more edits
passed their tests, showed no gain, and were taken back.

## Measured

Wall time was not used: the Mac's load average was between 300 and 390 on 18 cores all session. These are counters
that do not move with load: instructions retired, CPU time and wakeups, read from the live process with
`proc_pid_rusage`, and `/usr/bin/time -l` for a command that ends.

| What | Base | Change | How |
|---|---|---|---|
| The supervisor's `log stream` child, steady | 279 M instructions/s, 35.6 to 37.5 ms CPU/s | 0.30 to 0.47 M/s, 0.07 to 0.13 ms/s (−99.8%) | Both filters side by side over the same 12 s, twice, at 2,450 system log messages a second |
| The same child over one hub life of 45 s | 10.32 G instructions | 0.136 G (−98.7%) | The perf lane's child counter (`scripts/count-children.c`) injected into the hub |
| Idle hub, wakeups | 49.1 a second | 29.2 (−41%) | 15 s to settle, then 30 s; 4 rounds a side on the final tree, medians. An earlier 5 rounds, before the scan kept its beat, read 48.6 and 26.1 |
| Idle hub, CPU | 2.46 ms/s | 2.15 ms/s (−12.5%) | same; the earlier rounds read 2.71 and 2.16 |
| Idle hub, instructions | 3.35 M/s | 3.30 M/s | same; single rounds ran from 2.8 M to 8.6 M, so no change is claimed |
| `deep find` (`benchmarks/reading.mjs find`) | 76.28, 76.30, 76.35 G instructions; 3.55 s user CPU | 16.35, 16.40, 16.42 G (−78.5%); 1.28 s | `/usr/bin/time -l`, 3 runs a side, alternated |
| Hub, per hook, on 500 recorded tool calls | 3.15 M instructions | 3.00 M | 3 rounds; inside the noise, and no kept edit touches this path: not claimed |

The idle hub's CPU budget is 0.5% of one core (#16 AC12). The hub alone read 0.25% before and 0.22% after. The
child is not in that budget's reading (`ps` of the hub's own process), and at this Mac's log rate it was 3.6% of a
core by itself.

## What changed

### supervisor: the sandbox-report stream names its subsystem

`watchDenials` keeps `/usr/bin/log stream` running for the hub's life. Its filter named only the sender, so `log`
read and tested every message the machine wrote. The filter now also names the reports' subsystem,
`com.apple.sandbox.reporting`, and the log sends the stream those alone. The old terms stay, so the new filter can
show nothing the old one did not.

- Same reports: 24 denials made for the check (20 refused file writes, 4 refused connections), each tagged as the
  canary's are, came through both filters as the same 24 lines. Every one carried that subsystem, category
  `violation`, the Sandbox extension as sender and the kernel as process.
- Apple's page "Discovering and diagnosing App Sandbox violations" names the same subsystem and category.
- **A macOS whose reports carry another subsystem keeps today's stream.** This Mac runs 27.2, and no macOS 14 or
  15 was at hand to run on. So the supervisor checks for itself: when the canary's report never shows through the
  new filter in the 10 s warm-up it already had, the stream starts again on the sender alone, as on main. A new
  test in `packages/supervisor/src/supervisor.test.ts` plants that world (the filter names a subsystem no report
  has) and waits for a refused write's `sandbox.denied`. It passes; with the second start taken out it fails
  (`expected +0 to be 1`). On such a Mac the first sandboxed run after the hub's start waits out that warm-up once.

### supervisor: the timed scan runs only while a run has a sandbox to scan

The 100 ms scan timer ran for the hub's life and found nothing to do unless a sandboxed run was live or a cleanup
had left a process running. It now stops when a beat finds no such run, and starts again where one appears: at the
end of `open`, when a run starts, and when a cleanup leaves a process. `scanOnce` and the timer read the same list.

The timer starts again on the beat it has kept since the supervisor opened, so a new run's first timed scan comes
0 to 100 ms after it starts, as it did while the timer never stopped. The scans cleanup, `signal` and `lives` make
themselves are as they were.

### record: `foldText` lowercases the text whole

`foldText` split a text into characters and lowercased and joined them one at a time. It was 58% of `deep find`'s
CPU. It now lowercases the text in one call and writes each final sigma as a sigma.

Same output: 85,558,400 strings give the same result both ways, 0 differ. They are every code point in 15
contexts and 5 shapes around a capital sigma, and 2,000,000 random strings over cased, special-cased and ignorable
characters, lone surrogates included. On a 20 KB text the old form took 1,009 µs and the new one 21.8 µs.

## Tried and taken back

- **The hub's write probe, armed only while appends fail** (`hub/src/core.ts`). `tests/acceptance/16/blocked.test.ts`
  passed. Against a copy with the base's timer put back: 23.97 and 23.13 wakeups a second, inside the noise.
- **No channels timer with no channel set** (`hub/src/channels.ts`). `tests/acceptance/65/routes.test.ts` passed.
  27.7 and 29.6 wakeups a second: no gain.
- Why neither helps was not verified. The likely reason: the probe, the channels tick and the extension host's
  tick all run every 250 ms and are started in one turn of the event loop at the hub's start, and Node fires
  timers of one period that started together from one wakeup. The scan was alone at 100 ms. Both files are main's
  bytes again.
- **deep-hook built with fat LTO and one codegen unit**: −0.3% to −1.8% over 12 calls, inside the noise. Not
  proposed.

## Where the rest of the CPU is

Read from V8 CPU profiles of 55 Node tasks in `benchmarks/budgets.json`, one run each, and from the counters above.
None of these is applied. Shares are of the task's busy time.

| Package | Finding |
|---|---|
| hub, idle | With every interval timer off the hub idles at 1.2 wakeups and 0.1 ms CPU a second, so the timers are nearly all of its idle cost. Left: the timers at 250 ms, 500 ms, 1 s and 2 s. `HeavyQueue.tick` refills the job pool's pipe every 500 ms with no leased command: a read that throws `EAGAIN`, a write and two buffers each time. Not changed: stopping the read early relies on how a named pipe drains, which was not checked on Linux. |
| hub, per hook | About 3 M instructions a hook. `headOf` runs twice per hook (`siblings.placed` and `core.commits`): a stat and two file reads each. `writeCursors` syncs a file and its folder every 200 ms of activity. |
| hub, session start | `hub-compact` started `ps` 2,045 times for about 1,020 session starts: two per start. |
| deep-hook | Floor-bound. A C program that does nothing retires 10.5 M instructions here, a Rust one 15 M, `deep-hook --version` 19.6 M. A `Read` call is 24.5 M, `Bash` 25.2 to 25.7 M, `Edit` 32.7 M. With no guard entries a call is 22.3 to 22.6 M, so matching all 38 shipped entries costs 2 to 10 M. Leaving `proofs` out of `rules.json` saves 0.3 to 1 M. |
| record | `record-replay-100k`: the write transaction 26%, `Projections.up` 20% (it builds a key string from the table and columns on every call), `apply` 13%. `resolver-match-10k` is 79% in the write transaction. |
| contracts | `contracts-validate`: `json.copy` 30% (each value is copied before it is checked) and the record check 26%. |
| evidence | `masksOf` is 28% of `archive-month` and `archive-backlog`, 13 to 15% of `archive-live` and `evidence-redact-text`. Loading the 221 patterns costs 6 ms of CPU in every process that imports the package. |
| archive, adapters | `claude-code-backfill` is the largest task, 158.7 G instructions: garbage collection 14%, one secret pattern 7%, `Projections.up` 7%, `core.backfill` 6.5%. |
| extension-host | `visible` is 12% of its task: `JSON.parse(toJson(event))` per event per package. The task starts 263 helpers, 191 `ps` and 43 `sandbox-exec`. |
| verdicts | `verdict-1000-runs`: the 64-hex pattern test 9%, `judge` 10%, `counted` 9%. |
| readings | `foldSession` and its callers are 30 to 40% of two tasks of under 1 s each. |
| checks-command | `command-check-count` is 131.7 G instructions, nearly all in the 342 processes it starts (188 helpers, 129 `ps`, 23 `sandbox-exec`); the package's own code is under 4% of its busy time. |
| env-local | `env-up` and `env-down` are 36.6 G each: 67 `ps`, 42 helpers, 19 `node` and 12 `lsof` a run. |
| supervisor, runner | `sandbox-setup` 10.0 G (68 helpers, 27 `sandbox-exec`, 20 `ps`); `runner-job` 6.8 G (42 helpers, 14 `ps`, 13 `sandbox-exec`). A sandboxed run costs about three helper starts and a `ps`; their own code is under 4%. |
| asks, leases, otlp, wiki, reading (slice), products, status, inbox, mcp, list, composition, paseo | No function of the package's own over 8% of its task. |
| deep-app (read, not run) | Three timers run for the app's life: the keymap file is read again every 250 ms, the record reader ticks every 250 ms, and the Agents page polls every 2 s while open. |

Not measured: `checks-journey`, `checks-numbers`, `checks-review`, `checks-work`, `cli`, `config-eval`,
`conformance`, `gate`, `github`, `pi`, `proof`, `budget`, `buying`, `workspaces`, and the packages under
`channels`, `jobs` and `sources`. They have no task in `benchmarks/budgets.json`, or one that needs agents, a GPU,
a window or release builds of the canvas crates. No Rust crate but deep-hook was built or measured. Nine tasks
exit 1 under the profiler's `NODE_OPTIONS` and gave no reading: five of `plugin-blocks`, `deep-doctor`,
`pi-client`, `lobes`, `journey-run` and `host-link`; that was not looked into.

## Verification

Every row is a run on the final tree unless it says otherwise. The hub's built files are byte for byte the
base's.

| Check | Result |
|---|---|
| `packages/supervisor/src/supervisor.test.ts` | 3 of 3 pass, the new case among them. With the stream's second start taken out the new case fails, waiting for a `sandbox.denied` that never comes |
| `packages/record/test/archive.test.ts`, `packages/reading/test/slicer.test.ts` | 19 of 19 pass |
| `tests/acceptance/1515/search.test.ts` | 7 of 7 pass |
| `tests/acceptance/30/sandbox.test.ts` | 2 of 2 pass: a refused write is recorded as `sandbox.denied` through the new filter. In one earlier run the file's `afterAll`, which deletes its folders, timed out at 10 s after both cases had passed |
| `tests/acceptance/236/cleanup.test.ts`, `contain.test.ts` | **BLOCKED on this Mac as committed:** `fixtures/devices.m` does not compile on macOS 27 (`CGDisplayCreateImage` is obsoleted since macOS 15), so every case fails at the fixture build, on main too. Filed as #2281. Run from a scratch copy of the suite with only that fixture's build line taken out: 10 of 10 pass, among them AC4 (the denial recorded) and AC11 (a late grandchild recorded by the timed scan). The copy was deleted; the committed suite is untouched |
| AC11 of that suite, before the scan kept its beat | Its own precondition (`BLOCKED: the grandchild has its own session and group`, read before the grandchild's `setsid`) failed in 2 of 11 runs on the change and 0 of 9 on the base copy, run in turn. It names no scan, and the two sides differ by too few runs to tell; on the final tree the case passed in its one run |
| `tsc --noEmit` on the root config | 3 errors, the same 3 on the base copy: `packages/hub/test/hosts.test.ts`, `packages/hub/test/job-session-close.test.ts`, `tests/acceptance/20/helpers.ts`. None in a touched file |
| `scripts/repo-rules.mjs` | Fails with 21 lines (18 `deps`, 2 `cards`, 1 `secrets`), none naming a touched file or this report; the same 21 before and after the report was added. No comparison with the base: the base copy is no git checkout, so the script is BLOCKED there |

**Not run:** `node scripts/affected.mjs`, the preflight, the perf lane (`scripts/perf.mjs`), clippy, `cargo test`,
any Linux run, and every acceptance suite not named above.

**One mistake, caught.** An early measuring command stopped `/usr/bin/time` where it meant to stop the `log stream`
it had started, so that stream ran on for two and a half hours with no parent, at about 3.6% of a core. It ran
beside both sides of every reading. It was found in the last process check and stopped by its PID.

## Method notes for the next one

- An idle reading needs 15 s to settle: in the first seconds after start the hub reads 21 to 34 M instructions a
  second, against about 4 M steady.
- A bench session must work in a git repo, with hooks stamped now. In a plain folder `gitDirs` builds an error per
  parent folder per hook, and a hook stamped before the hub's start makes `deniedBefore` read `rules.json` on every
  `PostToolUse`. Neither happens in real use.
- One run of a timer experiment decides nothing here: the base alone ranged from 40 to 57 wakeups a second.
- The hourly cleanup empties `target/` mid-session; hub tests then fail with "no deep-hook is built".
