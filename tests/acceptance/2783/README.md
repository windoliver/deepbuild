# Acceptance tests for #2783: a core that couldn't start spins forever when a spool is waiting

Written first, blind, by a job that never saw a fix. On November 17, 2026 it read:

- issue #2783 (its text as of that day: What happens, Scope, Acceptance criteria, Proof)
- `AGENTS.md` (Proof) and `docs/technical-design.md` (The hook protocol: the spool)
- the base commit `c1e2710a3`: `packages/hub/src` only as far as calling `createCore`, `started()`, `hook()`,
  `stop()` and `call('events.read')` needs
- for conventions only: `tests/acceptance/2731/`, `tests/acceptance/822-redraft-2073/hub.test.ts` and the hook shape
  in `tests/acceptance/2074/lane-failure.test.ts`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## Criteria and tests

All three tests are in `replay-late.test.ts`. Every core runs in a process of its own, `node core-child.mjs`, never in
the vitest worker: at the base the failed-start core spins its whole process. The child appends each step to a log
file synchronously, and the test kills it by its PID (SIGKILL) at its limit, so a spin is a failed test, not a hung run.

The surface is the issue's: `createCore` from `packages/hub/dist/hub-runtime.js`, a root whose `spool/spool.jsonl`
holds one SessionStart line as deep-hook spools one, `ledger.db` a folder, one hook passed to `core.hook`, `stop()`,
and the record read through `call('events.read')`.

| Criterion, in full | Test |
| --- | --- |
| "A core whose start failed (`ledger.db` a folder) on a root with `spool/spool.jsonl` waiting, after one hook reaches it: a 50 ms timer in its process keeps firing (at least 20 times in 2 s), and `stop()` settles within 5 s" | **AC1**. The child: `started()` rejects; a 50 ms `setInterval` is seen firing once; one hook (another session's SessionStart) goes to `core.hook`; each tick after it is logged with its time; 2 s later `stop()` is called and timed. Asserted: at least 20 ticks in the 2,000 ms after the hook; `stop()` settled, in at most 5,000 ms; the process ended by itself. Preconditions asserted first: the start was rejected, the timer fired before the hook, the hook was sent. |
| "After that, `spool/spool.jsonl` holds the same bytes, and a core started on the same root once `ledger.db` can open records the spooled session's start once" | **AC2**. On AC1's root, after AC1's process ended: "after that" holds (the failed-start core stopped by itself); the spool file is there with the bytes written before the core was made; then the `ledger.db` folder is removed and a second child starts a core on the root (`started()` resolves), reads every event, and the test counts `session.start` events of the spooled session: exactly 1. The first three are soft assertions, so the test reads the rest where one fails. |
| "A core that started still replays a spool written after its start, on its next hook, once" | **AC3**. A child starts a core on an empty root, then writes `spool/spool.jsonl` (the same kind of line), then sends one hook (another session's SessionStart) and waits for that hook's own `session.start` in the record. Asserted: at that reading the spooled session has exactly 1 `session.start`; 5 s later it still has exactly 1. |

### The limits

- The failed-start child gets 120 s to reach the hook (a loaded machine's module load), then 30 s: the 2 s window,
  `stop()`'s 5 s, and room. Past that it is killed. The asserted values are the issue's: 20 ticks, 2 s, 5 s.
- A child whose core starts gets 120 s to start and 120 s (AC2) or 360 s (AC3) after it.

### At the base (`BASE-FAILURE.txt`)

- **AC1 fails** for the issue's reason: 0 ticks in the 2 s after the hook, `stop()` never reached, the child killed
  30 s after the hook.
- **AC2 fails**, only on "after that" (the failed-start core never stopped by itself). The bytes and the one recorded
  start held at the base, read after the kill; they guard a fix that stops the spin by dropping or replaying the
  spool on the failed core.
- **AC3 passes**: it is a regression guard ("still replays"). It fails on a program that no longer replays a late
  spool on a started core (0 starts) or replays it twice (2). No mutant was run: this job edits no source.

## How to run

```sh
npm run build --workspaces          # the child loads packages/hub/dist
cargo build -p deep-hook            # a core that starts needs target/debug/deep-hook; AC2 and AC3 read BLOCKED without it
node node_modules/vitest/vitest.mjs run tests/acceptance/2783
node node_modules/typescript/bin/tsc -p tests/acceptance/2783/tsconfig.json
```

On the Linux dev machine the run was detached, in
`systemd-run --user -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`. About 40 s at the base
(30 s of it AC1's limit).

Temp files: one folder `/tmp/dh2783-*`, a HOME and a root per test under it, removed after the file. No network.
Nothing is stopped by name or port; each child is stopped by its own PID.

## Left open

- **The second way to the spin** (the start fails because `target/debug/deep-hook` isn't built, and the partly started
  core asks for the replay by itself): it is in "What happens", not in a criterion, and the tests have no named surface
  to make a core's start fail that way short of removing the tree's own `target/debug/deep-hook`. No test.
- **"whoever asks"** (Scope): the criteria name one asker, a hook. The core's own timers and other callers aren't tested.
- **"on its next hook"** (AC3) is read as: by the time that hook's own event is in the record, the spooled start is
  too. The test can't tell a replay the hook asked for from one the started core made by itself in the same moment.
- **What the failed core answers the hook** (its promise rejected at the base, with the start's reason) and the text of
  the start's failure: not in a criterion; logged, not asserted.
- **Whether the started core removes the spool file** after AC2's and AC3's replay: the design says when it may; no
  criterion here asks.
- **"The existing spool suites pass unchanged"** (Proof): theirs to run, not this suite's.
