# Acceptance tests for #2123: wiki builds, channel sends, library fetches, review threads and disputes each finish or say why not

Written first and blind, at base commit `b9131dbd9857aefc4dcc39dd0d534d007b1ef671` (origin/main, read as an export of
that commit), from the issue, `AGENTS.md`, `docs/technical-design.md` and the base, before any work on the issue. The
drafting job saw no fix, diff, branch, other checkout, session or pull request. The implementing agent does not edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## Run

```sh
node scripts/throttle.mjs test --wait 30 -- node node_modules/vitest/vitest.mjs run tests/acceptance/2123 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2123/tsconfig.json
```

- Node 24 and the pinned Rust toolchain first on PATH, on macOS. The tests run the built CLI (`packages/*/dist`) and
  `target/debug/deep-hook`; a missing build reads BLOCKED, never a pass.
- `--no-file-parallelism`: five of the six files start real hubs. `scripts/lanes.mjs`'s one-at-a-time list is the
  implementer's to extend; this job changes no lane list.
- Nothing leaves 127.0.0.1: no GitHub call, no model call. HOME is a temp folder for every child. Every process is one
  the suites started, stopped by its PID or its own handle.
- The whole folder took 124 s on the base. `tsc` on the folder exits 0.

## The criteria

Each tag is `#2123.` and the first 8 hex digits of the SHA-256 of the criterion's `- [ ]` line, whitespace collapsed, as
`criteria()` in `packages/hub/src/acceptance.ts` makes it. One test each, in a file of its own. Every test fails on the
base at an assertion in its own file; `BASE-FAILURE.txt` holds that run.

| Tag | File | Enters through | Asserts (the criterion's "then") | On the base |
|---|---|---|---|---|
| `#2123.6e6ae79d` wiki build | `wiki-build.test.ts` | `wiki.build`, `job.list` and `windows.report` on the hub's socket, after `deep setup` (#356's world) | once the window clears, `job.list` shows two read jobs | three read jobs, all finished: as the issue says |
| `#2123.8ad68fab` channel send | `channel-stalled.test.ts` | the hub's `Channels` class, its `call` answering null for a deliver | in two seconds of ticks deliver is called once; one `channel.delivered` with outcome `stalled` is recorded; the next deliver comes later, once, and is recorded `stalled` too | deliver called at each of the eight ticks, nothing recorded: as the issue says |
| `#2123.4627e131` fetch again | `fetch-again.test.ts` | `deep_kinds` fetch through `deep mcp`, under `library.rule` (#1731's world) | the second fetch's status is `fetched` | the second fetch is `refused`, repeating the first's reason. Not the issue's "held with no ask": see below |
| `#2123.f6e57c22` thumbnail | `thumbnail.test.ts` | `deep_kinds` search through `deep mcp` (#1731's world) | the search answers; the library's two rows come back; each row's thumbnail is null | the search fails (`unavailable`, "deep_kinds failed in the hub"): as the issue says |
| `#2123.68e68bf4` review threads | `review-threads.test.ts` | a session's stop on a claim with a pull request (#1633's world: #322's hub and session, #323's recorded GitHub answers) | the 101st thread, unresolved, is one open item of the task | the task has no open item: as the issue says |
| `#2123.750aef7f` dispute | `dispute-restart.test.ts` | `acceptance.dispute`, then the hub killed and started again on its root, `acceptance.status` and `job.list` (#1328's world) | after the restart the dispute has no outcome and lists two redrafts, the second a job the runner lists | the dispute reads `stands` with one redraft: as the issue says |

## What stands in, and what is real

Everything this repo owns runs for real, reused by import from the neighbouring suites, none of them edited: the hub,
its record, runner, extension host and source block, `deep setup`, `deep install`, `deep mcp` and deep-hook. Stand-ins:

- **The agent a runner job launches**: #356's fake reader (wiki build) and #1328's fake Claude Code (dispute).
- **Plan windows**: `windows.report` on the hub's socket, as #356's helpers report them: 95% used holds the default 10%
  reserve, 5% clears it.
- **The library's remote host**: #1731's fixture library on 127.0.0.1. The tests change what that host holds, in the
  test's own process: the chair's file is gone for the first read and back for the second; the two armchairs name
  their thumbnails as protocol-relative URLs on another host.
- **The forge**: the hub's recorded GitHub answers (`DEEP_HUB_TEST_GITHUB`), the review threads in two pages.
- **The channel package's provider, the asks and the record**, for `Channels` only: the `call`, `asks` and `append`
  it is constructed with, as `packages/hub/test/duration-fold.test.ts` constructs it.

## Where the base differs from the issue's "Today"

The issue was written against `20f19f16`. On this base:

- **Fetch again.** The networked job no longer reads a library's file through `libraryFile`; it downloads through the
  source block (`assetFile`), inside a try in `run()`. A read that throws no longer leaves the fetch `fetching`: the
  job records the fetch as `refused` and every later fetch of that id repeats that refusal until the hub restarts. A
  spent quota is different again: it carries `until`, answers `pending` and is forgotten. So the base does not answer
  "held with no ask"; it answers `refused` twice. The criterion's "then" still fails: the second fetch is not fetched.
  The Scope line for this criterion names code this base no longer has in that shape; the test asserts only the
  "then".
- The other five behave as their "Today" sentences say. No criterion already holds on the base.

## Choices this job made, and gaps

- **Fetch again: how the first file read throws.** The library's host answers 404 for the chair's file when the hub
  first reads it, which the hub's download throws on, and 200 for the second read. The issue's own examples (a spent
  quota, a missing secret, a failed put) could not be staged through #1731's fill: its quota is 600 a minute and it
  names no secret. A fix that keeps refusing an id whose host once answered 404 fails this test.
- **Thumbnail: how the read throws.** A thumbnail path that starts `//` passes the library module's own check and is
  refused by the source block's path check, which throws a plain error. The issue's example, a quota spent by the
  thumbnail reads, could not be staged for the same reason. A control run with a thumbnail path that is never read
  passed the same assertions, so they can be met.
- **Review threads: the cursor's variable name.** The hub's recorded GraphQL answers match on variables. The fixture
  gives the second page to a request whose `after` or `cursor` variable equals the first page's `endCursor`, and the
  first page to any other request. `after` is GitHub's argument and the name the issue's Scope uses. A fix that sends
  the cursor under another variable name gets the first page again, which always says `hasNextPage: true`. A control
  run with the unresolved thread on the first page passed, so the harness opens the item when the thread is read.
  #323's own `review.test.ts` could not carry this test: its first case fails on this base (its `gh pr create` is
  refused), so the session is #1633's.
- **Channel send: the clock.** The ticks are the class's own 250 ms timer on Vitest's fake clock, as the hub's unit
  test runs them, so load cannot stretch them: two seconds are eight ticks. The issue gives no back-off length. The
  test asserts one deliver within the two seconds, a second more than one tick after the first and within 60 s, and
  none one tick after that. The base's own back-off after a first failed send is 2 s, so the first deliver, at the
  first tick, leaves the second outside the two seconds.
- **Wiki build: when the reading is over.** Nothing on the socket says a build's background reading has ended. The
  test waits until no read job is active and every worth-reading message has been delivered to a read job, held for
  20 s, or stops as soon as a third read job shows. A correct program whose second job starts more than 20 s after its
  first ends would be read as one job and fail.
- **Dispute: stopping the hub there.** The hub is killed (SIGKILL, by its PID among this process's own children) the
  moment `job.list` shows the second redraft's job, which is after the first draft is saved and before the dispute
  records that job. That is a race the test checks: after the restart the dispute must not list the job the stopped
  hub was submitting; otherwise the scene is played again, up to three times, then BLOCKED. It was won on the first
  play in both base runs. The runner had already listed that job, so "never submitted" holds for the dispute's
  record, not for the runner's. A fix that adopts that orphan job as the dispute's second redraft would read as a lost
  race and end BLOCKED. `acceptance.status` does not show drafts, so "the first redraft passed on the work" is known
  only from the hub having started a second one.
- **Dispute: clean-up.** #1328's `Stage.close()` signals its hub by PID. After the kill that PID is no longer the
  suite's, so the stage is not closed; its 50 ms plan timer runs, failing quietly, until the test file ends. A fake
  agent the killed hub had started may live for up to its own 180 s plan wait.
- **Not asserted.** No message wording, and nothing of the Scope lines: not where sessions are held, not the null
  check, not the query's shape, not part (a) of the dispute Scope (a submit that throws), which no criterion states.
