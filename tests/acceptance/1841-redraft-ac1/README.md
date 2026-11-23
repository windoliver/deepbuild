# Blind redraft for #1841, its one criterion (`#1841.d29cb857`)

A fresh draft of `../1841/`'s one test, written blind as the design's Dogfooding rule says, at base commit
`0fffd8fcf` ("Merge pull request #3167", main). No other branch, worktree, PR, stash, session or issue comment was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof). `../1841/` stands as it is.

| AC | ID | File (tests) | Twins |
|---|---|---|---|
| AC1 | `#1841.d29cb857` | `next-page-read.test.ts` (1): one run of `fixtures/page-read-fails.mjs` | `read-ahead-uncaught` |

Criterion: "With the next page's read made to fail after `events.read` has replied, the hub records no unhandled
rejection and keeps answering; on the merge base the same run ends with an unhandled rejection from the page read."

## What was read

- Issue #1841, live, its body only (`gh issue view 1841 --repo windoliver/deepbuild`).
- `AGENTS.md`; `docs/technical-design.md`: One event log, with tables built from it (the record, `events.read`), and
  Dogfooding.
- The first draft: `../1841/README.md`, `BASE-FAILURE.txt`, `events-read.test.ts`, `fixtures/hub-run.mjs`,
  `tsconfig.json`.
- At the base, for surfaces only: `packages/hub/src/log-reads.ts` (`LogReads.read`, `page`, the read-ahead in its
  `setImmediate`), `packages/hub/src/core.ts` (`raw`, `LogReads`'s wiring), `packages/record/src/index.ts` (`raw`:
  better-sqlite3's `Statement.all`).
- Format examples: `../1334-redraft-2565/` (`twins.json`, `twins/`), `../1490-redraft-2892/README.md`.

## What the test does

`fixtures/page-read-fails.mjs` runs the hub's core (`createCore` from `packages/hub/dist/hub-runtime.js`) in a Node
process of its own, on a fresh root with its real record, under a kill limit (400 s) so a hang fails the test. One
SessionStart line in the root's spool gives the log events to page through (five here). The run:

1. waits until the log holds more than one page of 2 events;
2. calls `events.read` `{ after: 0, limit: 2 }`, and in the turn of its reply, before any immediate runs, arms
   SQLite's binding (better-sqlite3's `Statement.all`, a boundary the hub doesn't own): the next read of `events` whose
   first bound value is the replied page's `log_pos` and which binds the page's limit throws once, a disk's
   `SQLITE_IOERR`. That is the read of the page after the replied one, matched by what it is, whatever the SQL's text
   and however many values it binds. Every other read is the real one;
3. waits for that read to fail (an event, never a sleep, 120 s at most), then lets the event loop turn so Node reports
   any rejection nothing handled. The process listens for `unhandledRejection` and records each one as a step, with
   its stack, instead of dying of it;
4. asks `events.read` for the page whose read failed, reads the whole log, asks `health`, and stops the core.

The test asserts: the failure was injected after the reply into the read of the next page (otherwise it fails
`BLOCKED:` with the reason, never passes); no unhandled rejection was recorded; the later `events.read` answered that
page with the log's events after the replied `log_pos` and a `log_pos` at its end; `health` answered; the core stopped
and the run ended with status 0.

## What changed from the first draft, and why

- **The read is matched by its meaning, not its arity.** The first draft armed only a read binding exactly two values
  (position and limit). At this base `page` binds three (position, limit, byte cap), so the read-ahead was never failed
  and the first draft ended `BLOCKED`. This draft matches a read of `events` whose first bound value is the replied
  `log_pos` and whose other values include the limit, so a statement binding more or fewer extras is still found.
- **The unhandled rejection is recorded, not inferred from the process dying.** The first draft judged "no unhandled
  rejection" by the process surviving Node's default. This draft listens for `unhandledRejection` and reports each,
  so the criterion's "records no unhandled rejection" is observed directly, the failure names the rejection and its
  stack, and the run goes on to show whether the hub kept answering either way.
- **"Keeps answering" is checked against the log.** The later page must equal the log's events after the replied
  `log_pos`, first two, not just be non-empty.
- **A kill limit and longer waits**, for a loaded machine: the child is killed at 400 s, the waits are 120 s.
- **`tsconfig.json` includes `./*.ts` only**, not `./**/*.ts`, so the twin's copy of `log-reads.ts` (whose imports
  resolve only inside `packages/hub`) isn't type-checked here; the before lane builds it in place.

## The twin

`twins/read-ahead-uncaught/packages/hub/src/log-reads.ts` is the base file with one change: the read-ahead's
`.catch(() => undefined)` is removed, the wrong program the criterion names. It type-checks (`npm run build
--workspaces` passes on it). The test fails on it at its assertion: "the hub recorded an unhandled rejection from the
failed page read", with the planted error's stack through `LogReads.page` and the `setImmediate` (`BASE-RESULTS.txt`).

## Run it

With the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the run loads the hub's build (dist/)
cargo build -p deep-hook --locked        # the core needs target/debug/deep-hook to start
node node_modules/vitest/vitest.mjs run tests/acceptance/1841-redraft-ac1/
node node_modules/typescript/bin/tsc -p tests/acceptance/1841-redraft-ac1/tsconfig.json --noEmit
```

About 1.5 s. The run's folder is `<tmp>/dh1841r-*` with its own `HOME`, removed after the test; the test stops only the
process it started, by its handle. No network, sign-in or model call.

## Results

`BASE-RESULTS.txt`: on the base the test passes and the type check is clean; on the twin it fails at the unhandled
rejection assertion. The fix is already on the base, so the base here is the right program; the twin stands for the
merge base the criterion names.
