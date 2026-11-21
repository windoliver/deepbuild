# Acceptance tests for #2998: a supervisor's close() ends its warm-up, so a stopped hub leaves no canary probe unreaped

Written first, blind, on November 20, 2026, from issue #2998 (its text as of that day: What happens, Expected, the 3
checkbox criteria, Notes and Runs on), `docs/technical-design.md`, `AGENTS.md`, and `packages/supervisor` (its public
entry `src/index.ts`, `src/types.ts` for `plant`, `src/supervisor.test.ts` for how a test opens one on a record),
`packages/hub` and `packages/cli` (`deep hub run`), `scripts/benchmark.mjs` (`measureOnce`), `benchmarks/hub.mjs` and
`benchmarks/budgets.json` as they are at the base commit `c9675effd` (origin/main), read for their public surfaces
only, by a job that never saw an implementation of #2998. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

The issue has 3 checkbox criteria, AC1 to AC3 in the body's order:

| AC | criterion ID | file |
| --- | --- | --- |
| AC1 | `#2998.441bfb4c` | `probe.test.mjs` |
| AC2 | `#2998.c5579a7f` | `probe.test.mjs` (driver `fixtures/stop-mid-probe.mjs`) |
| AC3 | `#2998.7f39b900` | `round-trip.test.mjs` |

## How to run

On macOS, with the repo's Node (24.22.0) first on `PATH`:

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # the tests use the built packages and packages/cli/dist/main.js
cargo build -p deep-hook --locked                 # once: the hub doesn't start without target/debug/deep-hook
node --test --test-concurrency=1 tests/acceptance/2998/probe.test.mjs tests/acceptance/2998/round-trip.test.mjs
```

- Off macOS every test is skipped, with the reason as its skip message: the issue runs on macOS only (Linux's sandbox reports
  come through the run's parent, with no canary).
- The perf lane's counter (`scripts/count-children.c`) needs a C compiler; `measureOnce` builds it. A run with no
  reading from it (no count and nothing uncounted) fails `BLOCKED`, never passes.
- AC3 runs the hub-round-trip task 30 times (about 3 minutes here); AC2 up to 30 hubs (1 to 2 minutes).
- Folders: `/tmp/dh2998-*` (a supervisor's record, a hub's temp HOME), removed by the tests. `measureOnce` and
  `benchmarks/hub.mjs` use and remove their own. The suite stops only the hubs it started, by PID.

## The surface under test, and the choices made

- **A canary probe** is a child process whose parent is the supervisor's process (AC1: this test's process; AC2: the
  hub's pid) and that `ps` shows as `/usr/bin/sandbox-exec …`, as `(sandbox-exec)` (macOS mostly can't read a
  sandboxed process's arguments), or, after it execs the helper, as `… probe /dev/null write /tmp/deep-canary-…`. The
  children are listed with `pgrep -P <parent>` and read with `ps -o pid,ppid,stat,command -p …`: a probe lives about
  50 ms, and `ps -A` alone takes longer than that here.
- **Running** is a `ps` state that isn't `Z`. **Exited and reaped by this process** is: the pid of every probe seen
  is no longer listed by `ps` with this process as its parent, zombie included.
- **AC1.** A supervisor opened with `plant: 'reports-other-subsystem'` on a fresh record under `/tmp/dh2998-sup-*`.
  The test polls until a probe of its own process is running (within the first filter's 10 s window; none seen in
  9 s is `INCONCLUSIVE`), then calls `close()` at once. When it resolves, no probe seen (or any other) is listed with
  this process as its parent; then for 2 s no probe with a pid not seen before appears as its child.
- **AC2.** `fixtures/stop-mid-probe.mjs`, run as `measureOnce(['node', <driver>], <repo>)`, starts
  `node packages/cli/dist/main.js hub run` with `HOME` a fresh `/tmp/dh2998-home-*`, polls until a probe of the hub's
  pid is running (up to 15 s), sends the hub SIGTERM at once, waits for its exit and prints what it saw. The test
  requires the driver to exit 0, the hub not to have exited before the stop, the counter to have read the run, and
  `uncounted` not to contain `/usr/bin/sandbox-exec`. On main `uncounted` also holds `(forked)` (#2960's); this suite
  asserts nothing about it. A hub whose first filter shows the first canary starts one probe only, which the driver
  can miss; such a run isn't the criterion's scenario and is tried again. The scenario is run on 10 hubs that were
  each seen with a probe running when stopped, in at most 30 tries; fewer is `INCONCLUSIVE`.
- **AC3.** The `hub-round-trip` task's command as `benchmarks/budgets.json` records it, run 30 times through
  `measureOnce(command, <repo>)`, each required to exit 0 and to have a counter reading; no run's `uncounted` may
  contain `/usr/bin/sandbox-exec`.

## At the base

`BASE-FAILURE.txt` is the whole suite's output at `c9675effd` on this job's Mac (Darwin 27.2, load average about 200
to 300 from other sessions), with the checkout's path written `<repo>`.

- AC1 fails at its assertion that the probe is gone and reaped when `close()` resolves: the probe seen running is
  still this process's child, a zombie (`Z <defunct>`) nothing has waited for. 4 of 4 earlier runs failed the same way
  once a probe was seen (one earlier draft, polling with `ps -A`, missed every probe and failed `INCONCLUSIVE`).
- AC3 fails at its last assertion: runs 11 and 29 of 30 named `/usr/bin/sandbox-exec` in `uncounted` (4 of 30 in an
  earlier run), as the issue's 1 run in 6. One run also named the supervisor's `helper`; this suite asserts nothing
  about that, nor about `(forked)`.
- **AC2 passes at the base here.** On this Mac the hub's stop takes about 55 ms to 500 ms from SIGTERM to exit, and a
  probe about 45 ms from start to end; the driver sees a probe at most a few tens of ms into its life, so the probe
  seen running has ended, and the hub has reaped it, before the hub exits. The base fails the issue's scenario only
  when the hub's exit lands while a probe is still running (AC3's random stop time does that about 1 run in 7). In 30
  and then 10 hubs each stopped mid-probe, none named `/usr/bin/sandbox-exec`. So AC2 is not shown to fail on the
  wrong program by this job; its proof of the fix rests on AC1 and AC3 failing at the base. A test that would fail
  there needs the hub's stop to outlast no probe, which the criterion's own scenario doesn't arrange; that is for the
  issue's author or a redraft to decide.

## Redraft (November 21, 2026)

Redrafted blind, from the same sources as above (the supervisor's public surface read from origin/main), with no
implementation of #2998 seen, for one dispute: the proof lanes (`scripts/proof-runs.mjs`) run `.mjs` and `.js` test
files with `node --test` and only `.ts` files with Vitest, so the first draft's `.mjs` files, written with Vitest's
`describe`/`test`/`expect`, couldn't load in the before lane ("Vitest failed to find the current suite").

- **What changed: the runner only.** Both files are now `node:test` with `node:assert/strict`, as
  `tests/acceptance/1405/` is. Each criterion is one top-level `test()` (no `describe`, no subtests), whose name is a
  plain string starting `AC<n> #2998.<id>`, so the lanes read its tag from the name; off macOS each is skipped by its
  `skip` option, with the reason as the message. Every check is an `assert` call in the test file, and "nothing seen"
  fails with `INCONCLUSIVE` or `BLOCKED` in its message, as before.
- **Unchanged:** the three criteria and their IDs, the file names, each scenario, observable, count and expected value,
  `helpers.mjs`, `fixtures/stop-mid-probe.mjs` and `BASE-FAILURE.txt` (recorded under the first draft's Vitest run; the
  failures it shows are at the same checks). The AC1 test's name now holds what was its suite's and its own.
