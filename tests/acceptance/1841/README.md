# Acceptance tests for #1841: `events.read` builds its next page with no catch, so a read that fails as the core stops rejects unhandled

Written first, blind, from issue #1841 (its report, Scope, one acceptance criterion, Proof and the owner's comment that
the code is now `LogReads.read` in `packages/hub/src/log-reads.ts`) as the brief quoted it, the design and base commit
`72fe11a11` ("Merge pull request #2523 …"), by a job that never saw an implementation; none existed, and no other
branch, worktree, pull request or stash was read, nor the live issue. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: the one criterion, one
test.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1841.d29cb857` | `events-read.test.ts` (1): one run of `fixtures/hub-run.mjs`, the hub's core in a Node process of its own, the read of the next page failed once after `events.read` replied |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over the criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so it isn't checked against it. The test's name starts
with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: One event log, with tables built from it (the issue's design link) and How
  we know version 0 works (Dogfooding).
- At the base: `packages/hub/src/log-reads.ts` (`LogReads.read`, `page`, `reflecting`; the `setImmediate` whose
  promise has no catch), `core.ts` (how `LogReads` gets the record's `raw`, `stop`), `hub-control.ts` (`events.read`'s
  route), `hub-runtime.ts` (`createCore`), `core-worker.ts` and `server.ts` (the core in its worker or inline, what a
  worker's error does, `events.read`'s roles), `wire.ts` (`CoreOptions`), `vfs.ts` and `plant.ts` (neither fails a
  read), `packages/record/src/index.ts` (`raw`: better-sqlite3's `Statement.all`, statements kept compiled),
  `scripts/proof-change.mjs` (`criterionId`). Suites `822/` (its `hub.test.ts`: the core from the hub's build in the
  test's process, a session met through the spool; its README and `BASE-FAILURE.txt`) and `2497/` (README layout).

## Readings where the issue leaves a choice

- **"the hub"**: the hub's core, made by `createCore` from the hub's build (`packages/hub/dist/hub-runtime.js`), the
  factory the hub's worker and its inline core both use, as #822's hub test reaches it; on a fresh root with its real
  record, called as the server calls it (`core.call('events.read', …, { role: 'cli' })`). It runs in a Node process of
  its own (`fixtures/hub-run.mjs`), not in the test's, because vitest listens for unhandled rejections itself. A whole
  hub process behind its socket was not used: nothing outside it can act between the reply and the read, which is one
  turn of the core's event loop later.
- **"the next page's read made to fail after `events.read` has replied"**: the issue's own case is the core stopping
  between the reply and the read; a stopped core answers nothing more, so that case can't show "keeps answering". The
  test takes the criterion's wider words: the read itself fails. In the same turn as the reply (awaited, before any
  immediate runs) the run arms SQLite's binding, better-sqlite3, the one boundary under the record the hub doesn't
  own: the next read of `events` whose bound values are the replied page's `log_pos` and the page's limit throws once,
  with a disk's `SQLITE_IOERR`. That is the read of the page after the one replied, by its meaning, whatever the SQL's
  text. Every other read is the real one. The run waits for that read to have failed (an event, 30 s at most), never
  for time to pass; a run in which no such read is made ends `blocked` and the test fails `BLOCKED:`, never passes.
- **"records no unhandled rejection"**: nothing in the run's process listens for one, so Node's default holds, the one
  a hub's process and its core's worker run under: an unhandled rejection ends the process with status 1 and its
  stack on stderr. After the failed read the run lets the event loop turn twice (Node reports a rejection nothing
  handled as the turn that made it ends), then goes on. The test wants the run alive past those turns and status 0
  at the end. What a fix does with the failure it catches (drop it, write a line of it) is the implementer's choice:
  stderr is shown when the test fails, and not judged.
- **"keeps answering"**: after the failed read, the same hub answers `events.read` for the page whose read had failed,
  with that page's events and a `log_pos` past the first page, and answers `health`; then it stops when asked.
- **"on the merge base the same run ends with an unhandled rejection from the page read"**: `BASE-FAILURE.txt`, the
  suite's run at the base. The stack there runs from the planted read through `SqliteRecord.raw` and `LogReads.page`
  to the `setImmediate` in `log-reads.js`, and the process ends with status 1 before `alive`.
- **The log's events**: a fresh hub's log is empty, and `events.read` builds no next page after an empty one. The run
  puts one SessionStart line in the root's spool, as deep-hook writes it and #822's hub test does; the core replays
  it as it starts (four events here), and the run waits until the log holds more than one page of two.

## Run them

With the repo's Node (`.node-version`, 24.22.0), on macOS or Linux:

```sh
npm ci                                  # once, if node_modules is missing
npm run build --workspaces              # the run loads the hub's build and its packages' (dist/, which git ignores)
cargo build -p deep-hook --locked       # the hub's core needs target/debug/deep-hook to start
node node_modules/vitest/vitest.mjs run tests/acceptance/1841
node node_modules/typescript/bin/tsc -p tests/acceptance/1841/tsconfig.json
```

About 1 s. After a change to `packages/hub/src`, build the hub again
(`node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json`): the run loads `dist`, so without it the test
judges the old build. With no build or no deep-hook the test fails `BLOCKED:`, naming what to build. The run's folder
is `<tmp>/dh1841-*` with its own `HOME`, removed after the test; the test stops only the process it started, by its
handle. No network, sign-in or model call.

## Base results

`BASE-FAILURE.txt` is the run at the base (1 test, fails, nothing BLOCKED), whole, with the checkout's path replaced by
`<repo>`. `events.read` replied with the first page (2 events, `log_pos` 2), the read of the page after 2 failed, and
the process ended with status 1, the planted error on stderr as an unhandled rejection from `LogReads.page` in the
`setImmediate`: the issue's failure.

That a right fix can pass was checked once outside the suite: with `.catch(() => undefined)` put on the `setImmediate`'s
promise in `log-reads.ts` and the hub rebuilt, the test passed; the file was then restored with `git checkout --`, the
hub rebuilt, and the test failed again as in `BASE-FAILURE.txt`.

## Not tested, because no criterion reaches it here

The core stopping between the reply and the read (above: nothing answers after it); the stream's reads
(`flushStream`), which the issue doesn't name; what `events.read` answers when its own page's read fails; the hub's
server and worker around the core.
