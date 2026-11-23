# Blind redraft of #3295's third criterion (`#3295.fae86cca`): a planted wrong deep-hook, since the before lane runs the change's test on the base

This folder redrafts one test of the first draft, `../3295/`: `#3295.fae86cca the late-close test reads INCONCLUSIVE,
never FAIL or PASS, on a deep-hook given no time to read its call` in `../3295/late-close.test.mjs`. Nothing in `../3295/`
is edited, moved or deleted here.

## Inputs

Only these, as a blind job sees them:

- issue #3295's body (its four criteria);
- `AGENTS.md`, `docs/technical-design.md` (Dogfooding, the proof sections);
- the blind commit `890bbad12` (base `a288ae247`): the first draft in `../3295/` (README, test, twins, `BASE-FAILURE.txt`),
  `crates/deep-hook/src/main.rs` (`watchdog`, `unanswered`, `RULING_LIMIT`), and `scripts/proof-runs.mjs`
  (`prepareRuns`, `twinsOf`, `twinOverlay`, `atAssertion`);
- the dispute below.

I read no other branch, PR, worktree or fix of the issue.

## The dispute

From the Spark's before lane on the change:

> `FAIL before: tests/acceptance/3295/late-close.test.mjs › #3295.fae86cca the late-close test reads INCONCLUSIVE, never FAIL or PASS, on a deep-hook given no time to read its call: passed on the merge base`

Cause: `prepareRuns` lays every file of the change under the test paths over the merge base, and the test paths include
`crates/*/tests/**`, so `crates/deep-hook/tests/cli.rs`. The issue's fix lives in that file only. The base bay therefore
runs the change's late-close test, which reads INCONCLUSIVE on the starved stand-in there as on the change: a criterion
about that test can't fail on the merge base. With no twin for `#3295.fae86cca` in `../3295/twins.json`, the lane reads
FAIL. The first draft's own base run (`../3295/BASE-FAILURE.txt`) failed only because it ran the base's `cli.rs`.

## What the redraft adds

The same test, under the same name and tag, with the same stand-in and assertions, plus a planted wrong program of
product source in `twins.json`, as the first draft gives its other two criteria. The before lane looks a test's twins up
in its own folder's `twins.json` (`twinsOf`), so the test is here, beside its twin.

`../3295/late-close.test.mjs` exports nothing, and importing it would register its three tests in this file (the first
draft's twinless `#3295.fae86cca` among them), so its helpers can't be imported. The few the test needs (`workbench`,
`run`, `after1`, `logStart`, `late`) are carried over as they are there, cut to what the starved stand-in uses; the
control and the other two stand-ins aren't. The test's body is the first draft's, line for line.

## The wrong program

| Twin | Edits | The planted fault | How the test fails on the change |
|---|---|---|---|
| `drops-unread-call` | `crates/deep-hook/src/main.rs` (`lines.json`, one edit in `watchdog`) | The watchdog's wait for an unread call is taken out: `\|\| PENDING.get().is_none()` goes, so with no fail_closed entry installed the watchdog no longer gives the hook until `RULING_LIMIT` to read its call. At `WATCHDOG` (48 ms) it lets a call still unread through with exit 0, unspooled | On the starved stand-in the hook exits 0 about 50 ms after its start with nothing spooled, well before 500 ms. The fixed late-close test, by the issue's rule, reads that as a hook that allowed the call without spooling it, which stays FAIL; so the lanes read FAIL, and the test fails at `assert.equal(ran.state, 'INCONCLUSIVE')` (`late-close.test.mjs`, under the test paths) |

Why it is a real wrong program: it breaks what `watchdog`'s own doc says ("a hook or agent the machine gave no time is
slow, not held up, and its call is spooled, never let through unrecorded"). On any machine that holds a hook's main thread
for more than ~50 ms, as a loaded one does, calls with no rules.json would be allowed and never reach the record. The
fail_closed half of the loop is untouched: a call a fail_closed entry may hold still waits for its match until
`RULING_LIMIT`. It is the honest negative of the criterion: a hook that drops a starved call early leaves the test no
ground to call the try starved, so the test must read FAIL, not INCONCLUSIVE.

It replaces no test path and no `node_modules` file. Its one `find` (two lines) matches once in the blind commit's
`main.rs`; a change that edits only `cli.rs` leaves it applying.

## Hand runs

`TWIN-RUN.txt` holds both, with date and load, home paths read `<home>`:

1. This folder's test on the blind commit (the base's `cli.rs`): fails at its assertion, as the first draft's did on the
   base. The late-close test reads FAIL on the starved stand-in after one try (`the call is spooled: ""`, test binary
   0.72 s: the watchdog let the call through at `RULING_LIMIT`). 2026-11-23, load 73 at the start, 98 at the end.
2. The same test on an APFS clone (`cp -c`) of the commit's workspace with the twin laid over `main.rs` by its
   `lines.json` (each `find` matched once, as `twinOverlay` does): the twin builds, and the late-close test as it stands
   here still reads FAIL, the test binary now done in 0.37 s, under 500 ms: the call was let through before
   `RULING_LIMIT`, which the fixed test must read FAIL. Load 97 at the start, 99 at the end.

The twin's run on the change (where the fixed test would read FAIL against it but INCONCLUSIVE on the change's own hook)
was not made: this job doesn't have the change. The proof lanes weren't run.

## Running it

```sh
node --test --test-concurrency=1 tests/acceptance/3295-redraft-fae86cca/late-close.test.mjs
```

As for the first draft: `cargo` and `node` 24 on `PATH`; the folder runs alone (`lane.json`, the first draft's rule), as
the test reads the hook's exit against 500 ms. A cold build of deep-hook takes minutes.

## Left to the owner

- **The first draft's `#3295.fae86cca`** in `../3295/late-close.test.mjs` still has no twin, so the before lane still
  reads it FAIL on the change. Retiring it (by the usual route, a `byHand` entry or a ruling in `scripts/lanes-lists.mjs`,
  which would also take the file's other two tests unless they move) is a separate commit with the owner's approval. This
  folder doesn't do it.
- **Criteria 1, 2 and 4** are unchanged: the first draft's tests and twins stand for the first two, and the fourth is by
  hand.

## Files

- `late-close.test.mjs`: the one test.
- `lane.json`: the folder runs alone (`timing:`).
- `twins.json`, `twins/drops-unread-call/lines.json`: the wrong program.
- `TWIN-RUN.txt`: the hand runs.

No fixture holds a secret or personal data.
