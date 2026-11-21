# Acceptance tests for #1889: Gmail's sent check tells a failed read from a missing marker, so a reply is never sent twice

Written first, blind, from issue #1889 (its report, scope, three acceptance criteria and proof) as the brief quoted
it, the design and base commit `ee05e7257` ("Merge pull request #2963 …", origin/main), by a job that never saw an
implementation; none existed, and no other branch, worktree, pull request or stash was read, nor the live issue. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1889.3ff068ee` | `held.test.ts` (3): the send kept, its answer lost; find's message read answers 503, 429 or 500 at three ticks: one message sent, no second request, the delivery held; then Gmail answers and it reads sent, one reply in the thread |
| AC2 | `#1889.312f3a56` | `notfound.test.ts` (1): the send lost before Gmail keeps it; find's message read answers 404: the reply goes out at that tick, once |
| AC3 | `#1889.5e4d1e1c` | `held.test.ts` (1): AC1's check on the 503, which the planted `find` (`twins/failure-reads-false`) fails |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, whitespace collapsed, first 8 hex) over each
criterion's text as the brief gave it, after `- [ ] `; the live issue body wasn't read, so it isn't checked against
it. Every test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Dogfooding).
- At the base: `packages/sources/gmail/index.ts` (`deliver` reads the message, 404 → `gone`, other non-200 → throw,
  then POSTs `messages/send` with the `X-DeepBuild-Send` header; `find` reads the message, any non-200 → `false`,
  then the thread, non-200 → throw); `packages/extension-host/src/work.ts` (`send`: the claim synced, then `deliver`;
  no answer leaves it `claimed`; `settle` at a later tick runs `find`: `true` → sent, `false` → tried and sent again, a
  throw → stays claimed, retried at the next tick; `deliveries()` shows a claimed one with no request out as
  `unknown`); `packages/extension-host/src/sources.ts` (`workFetch`/`call`: a client that throws gives "no answer",
  `NoAnswer`); `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`twins.json`); suite `66/`
  (`helpers.ts`, `providers.ts`'s recorded Gmail, `worlds.ts`'s `gmailWorld`, `email.test.ts`, `markers.test.ts`,
  `unknown.test.ts`, `crash.test.ts`); suites `2629/` and `2492/` (layout).

## The surface under test

A real delivery through the shipped Gmail source (`packages/sources/gmail`, copied and sealed by suite 66's
`shipped`) in a real extension host on a real world (record, asks, supervisor), through suite 66's helpers, imported
rather than copied: `clock`, `openWorld`, `openHost`, `installAndLoad`, `runNow`, `deliveryOf`, `result`, its
recorded Gmail (`gmail()`), its token and reply rule. `helpers.ts`'s `stand` is `gmailWorld` with two changes: the
hub's client goes to a front of our own (a local HTTP server, suite 66's `provider`) that forwards to suite 66's
mailbox, and the work source runs every day, so only "run now" reads the label and no scheduled run falls between
the ticks a test drives. The front can, once, lose a send's answer (the request reaches it; with `kept` the mailbox
keeps the reply; then the connection drops with no answer, which the hub records as no answer) and answer the next
bare `GET /messages/<id>` reads with planned statuses (a Gmail-shaped error body; `retry-after` on 429/503).

"Sent" is counted at the stand-in: messages labelled SENT in the mailbox (`gm.sent()`), and send POSTs that reached
the front. The delivery's state is `h.deliveries()`'s row, as suite 66 reads it.

## Readings where the issue leaves a choice

- **"accepts the send and then answers 503 to the message read"**: the send reaches Gmail and is kept, but its answer
  is lost; otherwise the hub records `sent` from the answer and never runs `find`. "The message read" is `find`'s
  read of the email (`GET /messages/<id>`), the first bare one after the lost answer. The 503 is given at three
  ticks in a row, each tick's first message read, then Gmail answers as usual.
- **"the retry held"**: while the reads fail, no second send request reaches Gmail, and the delivery's row is not
  settled: `unknown` or `queued`, never `sent` by a second send (nor `not sent`). "Ends with one message sent": once
  Gmail answers again, the marker is found, the row reads `sent`, and the thread holds one reply carrying the send
  key. 429 and 500 are tried alike (the issue: "a 5xx or a rate limit included").
- **"With a 404 on the message read, the reply is sent once"**: the first request is lost before Gmail keeps it, so
  there is nothing to find; `find`'s message read answers 404 ("Gmail says the message isn't there"), which reads
  not sent, and the reply goes out once at that tick. `deliver`'s own read of the email right after is answered as
  Gmail does (200): a 404 there would make the delivery `gone` with nothing sent, which is `deliver`'s rule, not the
  one this issue changes. The test asserts the send at the tick of the 404: a `find` that threw on the 404 would
  hold it and send it only when a later read succeeds, or never while the 404 lasts.
- **AC3**: its test is AC1's check on the 503, tagged with AC3's ID; `twins.json` maps it, and AC1's ID, to
  `twins/failure-reads-false`, the planted `find` that reads every failed read (the message's and the thread's) as
  `false`. Both fail on it with two sent.
- **AC2's twin**: AC2 passes at the base (the base reads a 404 as `false`), so its wrong program is
  `twins/not-found-throws`, a `find` that throws on any failed message read, a 404 too (the over-fix that never says
  "not there").

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS (arm64),
Node 24, under heavy load (~150). 5 tests: 4 fail, 1 passes, nothing BLOCKED.

- AC1 (3 tests) and AC3 (1 test) fail for the issue's reason, at the tick of the failed read: "one message sent: Gmail
  kept the first send, and its 503 to the message read at tick 1 is no "not sent": expected 2 to be 1" (and 429, 500
  alike): the base's `find` read the failure as `false`, the hub sent the reply again, two are sent.
- AC2 (1 test) passes at the base, as expected; it guards the fix.

Checked once outside the suite, by swapping `packages/sources/gmail/index.ts` for a while and restoring it with
`git checkout` (the checkout ends at the base):

- `twins/failure-reads-false`: AC1's 3 and AC3's test fail, two sent; AC2 passes.
- `twins/not-found-throws`: AC2 fails ("the 404 reads not sent: the reply is sent, once: expected +0 to be 1"); AC1's
  and AC3's pass.
- A right fix (`find`'s message read: 404 → `false`, any other non-200 → throw): all 5 pass.

The twins type-check (`tsc --noEmit --strict --types node --module nodenext` on each file, as on the base's file).

## Run them

With the repo's Node (24), on macOS or Linux, from the repo root:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # once: vitest.config.ts resolves the workspaces' dist
node node_modules/vitest/vitest.mjs run tests/acceptance/1889
node node_modules/typescript/bin/tsc -p tests/acceptance/1889/tsconfig.json
```

About 70 s under load. Temp folders are suite 66's `/tmp/dh66-*`, removed after each file. No network: every Gmail
call goes to 127.0.0.1; the token is suite 66's test value. The plug-in's process is the host's, stopped by it.

## Not tested, and noted separately

- `find`'s thread read already throws on a failed answer at the base; no test gives it a failure of its own (the
  planted twin reads it as `false` too, and AC1 doesn't reach it with the message read failing).
- The marker missing from a thread that reads 200 (`find` → `false`, sent again) is suite 66's AC14 path for the
  tracker; it isn't repeated here for Gmail.
- A hub restart between the lost answer and the settle (suite 66 `unknown.test.ts`'s kill) isn't driven: the claim
  with no answer is reached in one process, which `settle` treats the same.
