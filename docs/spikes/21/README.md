# #21: hook overhead and fail-open under real sessions, the recorded numbers

Issue #21 proves week 1's exit criterion on real tool calls, not only benchmarks: hook overhead under 10 ms at p95
on top of process start, fail-open under 50 ms, and the process-start readings the design's Hook overhead row rests
on. This folder holds the measurement and its recorded run; the proof is `tests/acceptance/21/`.

## Files

- `measure.mjs`: the measurement, run from the repo root on a quiet reference Mac on mains power; each run records its load averages.
  - `node docs/spikes/21/measure.mjs` times process start for a native no-op binary (`/usr/bin/true`, a Mach-O
    binary every Mac has), a `fn main() {}` built by rustc at opt-level 3 (the floor deep-hook's own budgets use,
    since deep-hook is a Rust binary), Node, Bun and Python, each a no-op, with hyperfine: no shell (`-N`), 20
    warm-up runs first, then 200 timed runs of each, all in one hyperfine run. It prints one JSON object with the
    date, the machine (`scripts/benchmark.mjs`'s fingerprint), the method, hyperfine's version and argument list,
    and per program its command, its own `--version`, its runs, median and p95 in ms and every timed run.
  - `node docs/spikes/21/measure.mjs budgets` runs the perf lane's two #21 tasks (`benchmarks/deep-hook.mjs
    day-overhead` and `day-fail-open`, from `benchmarks/budgets.json`) once untimed to warm up and then five times each, and
    prints the five `overheadP95Ms` and the five `failOpenP95Ms` with the date, the machine, the method, the calls
    per run and the tasks' commands.
- `record.json`: the two runs on the reference Mac, `processStart` and `budgets`, as the measurement printed them.

## What the benches replay

`benchmarks/deep-hook.mjs`'s two day modes replay 1,000 of the fixture corpus's recorded Claude Code tool calls
(`adapters/corpus/claude-code`, what Claude Code really sent for Bash, Read, Edit, Write, Agent and the other tools)
into one session, each call's PreToolUse and PostToolUse through the release deep-hook as an installed adapter's hook
entry runs it, with the shipped guard entries in `rules.json`, against a real `deep hub run` on a temp home. Before a
day is timed, each distinct recorded call goes once through a forwarder to the hub, and a call the hub acknowledges
with a hold is left out: the budget is "except holds". Overhead is the hooks' p95 (spawn to exit) with the hub up
minus the p95 of a native no-op run between the hooks; the hooks that spooled (missed the hub) are counted as `missed`, and as many as the p95 ignores (5%) make the run INVALID;
fail-open is the hooks' p95 with the hub stopped by SIGSTOP, four calls at a time as Claude Code runs the hooks of
parallel tool calls. The hub is stopped for stretches of 50 calls (100 hooks) and resumed between them until it has
taken its socket's listen queue: the queue holds 128 connections, so with the hub stopped for longer every hook after
the 128th would be refused at once instead of waiting the hub out. Each stretch's hooks must all have spooled their
call marked late, the sign they waited the deadline out, or said their spool write ran out of the hook's 50 ms (counted
as `unspooled`); a hook that spooled unlate (refused at once), one whose spool write failed outright, or one unaccounted
for makes the run INVALID.

## The recorded run

Both runs on 2026-10-29 on the reference Mac15,12 (Apple M3, 16 GiB, macOS build 23H723), on mains power, Low Power Mode off, thermal state nominal; each run's load averages are in `record.json`.

Process start (`node docs/spikes/21/measure.mjs`, hyperfine 1.19.0, 20 warm-up runs then 200 timed runs each, no shell), median and p95 in ms:

| Program | Command | Version | Median | p95 |
|---|---|---|---|---|
| native | `/usr/bin/true` | macOS 14.7.7 /usr/bin/true | 0.48 | 0.52 |
| rust | `noop` (`fn main() {}`, rustc -C opt-level=3) | rustc 1.99.1 (58cf8f9c3 2026-10-13) | 0.74 | 0.83 |
| node | `node -e 0` | v24.22.0 | 18.78 | 20.62 |
| bun | `bun -e 0` | 1.3.10 | 7.53 | 9.06 |
| python | `python3 -c pass` | Python 3.13.5 | 90.30 | 93.99 |

The design's Hook overhead row cites this run in place of the pilot's unrecorded October 5 estimate (19 ms Bun, 27 ms native, 52 ms Node, 75 ms Python): on this machine a native binary, Bun and Node start well under those figures, Python (a conda install) above its, and deep-hook, a Rust binary, sits on a start of about 1 ms.

Budgets (`node docs/spikes/21/measure.mjs budgets`, 1000 recorded tool calls per run, five runs after a warm-up run):

- hook overhead at p95 over process start, hub up: 0.89, 0.89, 0.83, 0.86, 0.89 ms (budget 10 ms)
- fail-open at p95, hub SIGSTOPped: 27.56, 27.61, 27.48, 27.51, 27.59 ms (budget 50 ms)

Both numbers are also judged, on replayed and live days, by `tests/acceptance/21/`; the perf lane compares each task's whole run with the merge base's from here on.
