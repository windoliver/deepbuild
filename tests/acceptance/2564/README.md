# Acceptance tests for #2564: the stream's flush has no catch, so a subscriber read that fails rejects unhandled

Written first, blind, from issue #2564 (its report, Scope, one acceptance criterion and Proof) as the brief quoted it,
the design and base commit `8bfb6a633` ("Merge pull request #2917 …"), by a job that never saw an implementation; none
existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
the one criterion, one test, modeled on #1841's suite.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#2564.ab15a450` | `stream-flush.test.ts` (1): one run of `fixtures/hub-run.mjs`, the hub's core in a Node process of its own, one subscriber's page read failed once during a flush |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over the criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so it isn't checked against it. The test's name starts
with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: One event log, with tables built from it and How we know version 0 works
  (Dogfooding).
- At the base: `packages/hub/src/log-reads.ts` (`LogReads.subscribe`, `stream`, `flushStream`, `turn`: the
  `setImmediate` whose promise has a `.finally` and no catch), `core.ts` (`LogReads` given the record's `raw` and the
  core's `emit`; every append calls `stream()`; `Core.subscribe`), `core-worker.ts` (`answer`'s `subscribe` op calls
  `core.subscribe`; frames posted from `emit`), `server.ts` (`stream.subscribe`'s route: the subscriber
  `<conn>:<id>`, unscoped `after`, asked of the core as `{ op: 'subscribe', sub, after }`; roles), `hub-runtime.ts`
  (`createCore`), `hub-control.ts` (`events.read`, `health`, `session.rename`), `session-state.ts` (`renameSession`),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/wait-ratchet.mjs` (timers only to bound a wait). Suite `1841/`
  whole (its approach is copied here).

## Readings where the issue leaves a choice

- **"the hub"**: the hub's core, made by `createCore` from the hub's build (`packages/hub/dist/hub-runtime.js`), the
  factory the hub's worker and its inline core both use; on a fresh root with its real record, its frames taken by the
  `emit` it is given, as the worker's posts them. It runs in a Node process of its own (`fixtures/hub-run.mjs`),
  because vitest listens for unhandled rejections itself. A whole hub process behind its socket was not used: the
  flush runs inside the core, and the server only forwards the subscribe and the frames.
- **"a subscriber"**: one subscribed the way the server's `stream.subscribe` asks the core to (`core.subscribe(sub,
  after)`, what the worker's `answer` calls for `op: 'subscribe'`): unscoped, as the app subscribes, after log_pos 0,
  named as the server names one (`<conn>:<id>`). A scoped subscribe (#1575) reads through the same `turn` and wasn't
  added: one subscriber reaches the flush.
- **"a subscriber's page read made to fail during a flush"**: the issue names a disk read failing, or the core stopping
  between an append and the flush. A stopped core answers nothing more, so that case can't show "keeps answering"; the
  test takes the disk read. Just before the subscribe the run arms SQLite's binding, better-sqlite3, the one boundary
  under the record the hub doesn't own: the next read of `events` bound to the subscriber's last log_pos (0) and the
  flush's turn of 128 events (`TURN`) throws once, with a disk's `SQLITE_IOERR`. That is `turn()`'s read for that
  subscriber, by its meaning, whatever the SQL's text; nothing else in the run reads `events` with those two values.
  Every other read is the real one. The subscribe's own `setImmediate` starts the flush, so no append is needed for
  it. The run waits for that read to have failed (an event, 30 s at most as a deadline), never for time to pass; a run
  in which no such read is made ends `blocked` and the test fails `BLOCKED:`, never passes. A precondition checks no
  frame went out before it: the failed read is the subscriber's first page.
- **"records no unhandled rejection"**: as in #1841: nothing in the run's process listens for one, so Node's default
  holds, the one a hub's process and its core's worker run under: an unhandled rejection ends the process with status 1
  and its stack on stderr. After the failed read the run lets the event loop turn twice, then goes on. The test wants
  the run alive past those turns and status 0 at the end. What a fix does with the failure it catches (drop it, log
  it, drop the subscriber, retry) is the implementer's choice and isn't judged.
- **"keeps answering"**: after the failed read, the same hub answers `events.read` (a page from log_pos 0 with the
  log's events) and `health` (with its readings); then it stops when asked. Before the stop the run unsubscribes, so the
  stop's own append doesn't start a flush against a closing record: that is the issue's other case, not this run's.
- **"on the merge base the same run ends with an unhandled rejection from the flush"**: `BASE-FAILURE.txt`, the suite's
  run at the base. The stack runs from the planted read through `SqliteRecord.raw`, `LogReads.turn` and
  `LogReads.flushStream` to the `setImmediate` in `log-reads.js`, and the process ends with status 1 before `alive`.
- **The log's events**: the run puts one SessionStart line in the root's spool, as deep-hook writes it, which the core
  replays as it starts; the run checks the log holds at least one event once `started` resolves (else `blocked`).

## Seen, not judged

After `health`, the run renames the session (`session.rename`, as the app asks it), an append, and records whether a
frame carrying the new name reached the subscriber within 10 s (`appended` step). The criterion says "keeps answering",
not "keeps streaming", so the test doesn't assert it. With the fix checked below, it did: `{"step":"appended",
"streamed":true,"frames":4}` (the subscriber, still at log_pos 0, got the log's events and the rename's frame).

## Run them

With the repo's Node (`.node-version`, 24.22.0), on macOS or Linux:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the run loads the hub's build and its packages' (dist/, which git ignores)
cargo build -p deep-hook --locked       # the hub's core needs target/debug/deep-hook to start
node node_modules/vitest/vitest.mjs run tests/acceptance/2564
node node_modules/typescript/bin/tsc -p tests/acceptance/2564/tsconfig.json
```

About 1.5 s. After a change to `packages/hub/src`, build the hub again
(`node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json`): the run loads `dist`, so without it the test
judges the old build. With no build or no deep-hook the test fails `BLOCKED:`, naming what to build. The run's folder
is `<tmp>/dh2564-*` with its own `HOME`, removed after the test; the test stops only the process it started, by its
handle. No network, sign-in or model call.

## Base results

`BASE-FAILURE.txt` is the run at the base (1 test, fails, nothing BLOCKED), whole, with the checkout's path replaced by
`<repo>`, on macOS (arm64) under heavy load. The subscriber subscribed, its first page read in the flush failed before
any frame, and the process ended with status 1, the planted error on stderr as an unhandled rejection from
`LogReads.turn` in `LogReads.flushStream`'s `setImmediate`: the issue's failure.

That a right fix can pass was checked once outside the suite: with `.catch(() => undefined)` put on `flushStream()`'s
promise before its `.finally` in `log-reads.ts` and the hub rebuilt, the test passed; the file was then restored with
`git checkout --`, the hub rebuilt, and the test failed again as in `BASE-FAILURE.txt`.

## Not tested, because no criterion reaches it here

The core stopping between an append and the flush (above: nothing answers after it); whether the stream keeps
delivering to the subscriber after the failure (seen above, not judged); scoped subscribers; the hub's server and
worker around the core.
