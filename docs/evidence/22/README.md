# #22 by hand: asks through a live hub, `deep` and MCP, and the re-judge

#22 closes when its four parts close (its body's Parts). Re-judged at its merged commit a23eecaa once this repo was
gated (#33 AC8), it read INCONCLUSIVE, naming `#22.1f14a778`, the line for part #319 (ask timing and the inbox).

## Why #319 read INCONCLUSIVE

`scripts/spine.mjs judge` on this Linux box, run from a local copy that reopens nothing (`reopen` removed, `cp -a` for
the macOS-only `cp -c`, the commit taken from `AT`):

| Commit | #318 `#22.48b6696b` | #319 `#22.1f14a778` | #320 `#22.f57a814c` | #321 `#22.3d85284a` |
|---|---|---|---|---|
| main 6042ef5a | PASS | INCONCLUSIVE | PASS | PASS |
| this change 12ea8c63 | PASS | INCONCLUSIVE | PASS | INCONCLUSIVE |

The row for this change is its first fix; the correction after it (the batch time read every beat) changed only
`nextBatch()` and the beat, and #319's suite but its budgets was rerun on it, 90 of 90.

#319's only criterion that can't pass here is AC10 `#319.43d13eb3`, the budgets: `tests/acceptance/319/budgets.test.ts`
counts a timing only on a reference Mac (Mac15,7 or Mac15,12) on mains power, and skips as INCONCLUSIVE anywhere else.
Its proof is the Mac run below.

#321 read INCONCLUSIVE at this change because its AC5 `#321.e6090cff` (`deadline.test.ts`, a push held with nobody
answering) failed once under load, with deep-hook's own message that its sync "didn't finish within the hook's 50 ms",
so the push went through. It does the same at the merge base 2a69a293: run alternately on this box, head failed 1 of 4
and base 1 of 3, the same message each time (`ac5-321-base-vs-head.txt`). It is a load flake on main, not this change;
that deep-hook lets a call through when its sync times out is a finding of its own, outside #22.

## What the run by hand found: a running hub never showed a batch

Run against a real `deep hub run` (`e2e-asks.test.ts`), three taste calls raised at 09:20 with batches every 2 minutes
were all still `queued` at 09:22:04. The hub's one-second beat ran the asks core only when a stop or verdict had landed,
a deadline had passed or an unblock was open (#85's gate, which came after a23eecaa), so a batch time passing called
nothing: on a live hub every batched ask waited until its deadline, then showed at once. #319's suite drives the asks
core on a virtual clock and calls `tick()` itself, so it never saw this.

The fix: the asks core says when your next batch is (`nextBatch()`, from your settings as they are now), and the hub's
beat asks every second and ticks once that time passes, so a change to your batches counts from the next beat.

- Failing first: `packages/hub/test/asleep.test.ts`, "a hub that stays up shows an ask waiting for its batch at the
  batch time, … after you change the batches": the hub starts with setup's 8-hour batches, you change them to every
  minute, and the next minute's batch must show the ask. On main's hub (`failing-first-main.txt`, the test's first
  form, without the change of batches) and on this branch's first fix, which read the batch time once at start
  (`failing-first.txt`): `expected [] to deeply equal [ 'batch:…' ]`.
- With the fix: `passing-after.txt` (both tests in the file pass, the #908 sleep test beside it unchanged), and the
  asks package with #319's suite but its budgets, 90 of 90.

## The runs by hand, after the fixes (rerun on the final code)

Both run the real hub, `deep setup`, the real `target/debug/deep-hook` and `deep mcp` through the Claude Code
stand-ins of tests/acceptance/27 and 321 (no model, no network; HOME is a temp folder; the OS confirmation is the
test stand-in `DEEP_HUB_TEST_CONFIRM`). Scripts and full transcripts are in this folder.

**`e2e-asks.txt`** (`e2e-asks.test.ts`): batches every 2 minutes, cap 2 a day, taste deadline 7 minutes with 1
minute's notice, everything else as `deep setup` drafts it (the transcript prints the drafted settings: taste 3d →
your 7m, authority 1d, unblock, exception and choice 2d, definition 4h; fold 5).

1. Sessions A, B and C each raise a taste call through `deep_ask`; `deep inbox` lists all three `queued`.
2. The next batch shows two (`ask.batched batch:…`), the cap is spent, the third stays `queued`.
3. `deep_ask` had returned the provisional answer at once ("Go on with Green header: it is provisional and can be
   undone"); you answer `blue` with `deep inbox answer`, and the agent's `deep_wait` returns `blue`.
4. Session D raises six; the sixth folds into "This session keeps asking: answer its asks together, pause it, or leave
   them to their defaults?" and shows as `folded` in the inbox.
5. C waits past later batches (cap spent) and shows at once (`now:`) at the last batch before its deadline, then takes
   its default `green` at its deadline, after it showed. `deep inbox undo` opens it again.
6. The exception shows at the last batch before the earliest deadline it holds; `deep inbox answer <exception>
   together` closes all six of D's asks, each `answered`.

Answering the exception while it was still queued (an earlier run) closed only the exception: "together" answers only
asks you have seen (`packages/asks/src/index.ts`, the fold's comment), which is the design, not a defect.

**`e2e-authority.txt`** (`e2e-authority.test.ts`, part #321): an MCP server you added (`tracker`, local scope) gains
`delete_repo` between two session starts. Its call is held at PreToolUse by an authority ask ("has new or changed tools
that can change or destroy: delete_repo"), default `decline`, deadline one day out; `git push origin main`, which no
typed request names, is held the same way. Five seconds on neither has run. `deep inbox` shows both with their plans;
your `approve` lets `delete_repo` run (the server receives one call), your `decline` leaves the push denied (deep-hook
exits 2: "DeepBuild denied this (guard push-needs-ask)…").

## `node scripts/affected.mjs`

At this change it selected nearly the whole repo (the asks and hub packages reach most suites) and read FAIL: 487 new,
16 already failing on main, 484 inconclusive or blocked, 21 listed skips, 2526 passed, in 15733 s at load 16. Its
INCONCLUSIVE lines: **67 timed files were not run** (`--timed`; `tests/acceptance/319/budgets.test.ts` among them, the
Mac run below) and **36 slow files were not run** (`--slow`). No WIDE line.

The 487 are not this change's. The same files at the merge base 2a69a293 (a built worktree, same box) gave 478 new
failures; of the 31 failing only at head, a rerun at load 2 put each on this box or load: the macOS-only `cp -c`
(shards, #33's kit), an `lstat` of linux-vdso, the deep-replica build, leases' pid timing, and #342's environment
BLOCKED. The ones that touch asks, #26 `ask`/`binding`, #39 `session` and #120 `start`, give the same result at base and
head, test by test. The lint lane's NEW FAIL lines (slots' kits, drift, the app's record reader) are main's.

## `node scripts/affected.mjs` on the final commit

On this branch replayed onto the rewritten main (2721ca7b), it read FAIL: 577 new, 19 already failing on main, 574
inconclusive or blocked, 22 listed skips, 3704 passed, in 12658 s at load 4. INCONCLUSIVE: **86 timed files were not
run** (`--timed`; #319's budgets are the Mac's) and **44 slow files were not run** (`--slow`). No WIDE line. No lint
line names a file this change touches.

The same 200 failing test files at main's tip 2721ca7b, in a built worktree on the same box: 341 of the head's 357 test
failures fail there too. The 17 that didn't, in 14 files, run again on both sides: 7 files pass at head; #1097's depth,
#344's reach and #806's replay fail the same at the tip; #824's planted test prints no result on either side; and
codex-hub's measured hold, #340's terminal and #348's sandbox places fail on both sides across three alternating runs
each (codex-hub's hold passed all three on both). No failure is this change's.

## The Mac, at f0b4db39: answering an ask was over its budget

The owner's Mac runner (Mac15,12, Apple M3, 16 GB, on AC power, Low Power Mode off, no thermal warning:
`mac-f0b4db39/machine.txt`) ran #319's budgets at f0b4db39 (`mac-f0b4db39/budgets.txt`):

| Budget | Five runs after a warm-up | Limit | Result |
|---|---|---|---|
| create an ask, p50 | 2.268, 2.127, 1.816, 1.989, 1.918 ms | 5 ms | PASS |
| answer an ask, p50 | 6.532, 5.871, 6.094, 6.014, 6.102 ms | 5 ms | **FAIL** |
| inbox of 10,000 asks | 0.899, 0.709, 0.659, 0.551, 0.543 ms | 100 ms | PASS |

The rest of #319's suite passed, 19 of 20, with the same answer reading skipped as INCONCLUSIVE
(`mac-f0b4db39/suite-319.txt`). The app run passed (`mac-f0b4db39/app-run.txt`: the asks wait, the batch shows them,
the exception is answered together), but its three screenshots are black: the display was asleep
(`mac-f0b4db39/SCREENSHOTS-NOTE.txt`), so they aren't kept.

**Why answering cost more.** Answering a taste ask appends `ask.answered` and the `decision.created` it saves, and the
record commits each of those kinds FULL (the design: "a commit that records … a decision, an answer uses
`synchronous=FULL`", with F_FULLFSYNC on macOS). Each was its own commit, so an answer paid two disk syncs where creating
an ask, a stream event, pays none. Here, on the same loop as the budget, answer p50 was 7.8 ms and create 1.0 ms, and
the two appends were 7.6 ms of the 7.8.

**The fix.** FULL appends made in one turn of the event loop now share one FULL commit, in the order they were made, and
`answer()` appends the answer and its decision (with any overrule) in one turn. Each still goes through `append`, so the
hub's stream and #23's planted programs, which hook `append`, see both. The agent hears the answer only once both are
durable. Answer p50 here: 3.8, 3.9, 3.8 ms (create 0.9 to 1.6).

- Failing first: `packages/asks/test/asks.test.ts`, "syncs the record once": two FULL syncs where one is wanted
  (`failing-first-answer.txt`). It passes with the fix, and both events survive a power cut in the test storage.
- With the fix: the asks package 73 of 73 and the record package 102 of 102. #14, #1014's projection test, #23, #66,
  #319 (without its budgets) and #365 pass, except `tests/acceptance/14/ac6-redraft.test.ts` (330 events where it
  appended 307), which fails the same way with the record change taken out. #318, #320 and #321 pass. #26's and #27's
  failures (8 in #27's desktop, outcomes, waits and repeat files) are the same with both changes taken out. The hub
  package's 11 failures are in files that also failed in the earlier `affected.mjs` run, before this change.
- The budgets at the final commit: see the next section. The app's screenshots were not retaken.

## The Mac, at 25f35437: the budgets pass at nominal

Two runs at 25f35437, on the same Mac15,12 (Apple M3, 16 GB):

- **22c** (`mac-25f35437/`): it passed, with answer p50 at 3.732, 3.513, 3.971, 3.632 and 3.645 ms. It doesn't count.
  `pmset -g therm` showed no warning, but the thermal state wasn't recorded and was likely "fair", and load averages
  were 3.85 / 12.21 / 14.10. The design counts a budget only with "the thermal state nominal".
- **22d** (`mac-25f35437-nominal/`): this is the run that counts. It ran on AC power (100%, charged), with Low Power Mode
  0 and `thermalState 0` at the budgets' start and end. Load averages were 2.33 → 2.35 (`machine.txt`).

| Budget (22d, `budgets.txt`) | Five runs after a warm-up | Limit | Result |
|---|---|---|---|
| create an ask, p50 | 1.806, 1.813, 1.817, 1.809, 1.855 ms | 5 ms | PASS |
| answer an ask, p50 | 4.170, 4.139, 4.156, 4.115, 4.075 ms | 5 ms | PASS |
| inbox of 10,000 asks | 1.070, 0.761, 0.666, 0.545, 0.486 ms | 100 ms | PASS |

#319's whole suite passed right after, 20 of 20 in 7 files (`suite-319.txt`). Its own budget readings were: create
1.56–1.81 ms, answer 3.475–4.131 ms, inbox 0.470–0.927 ms.

The answer margin is thin. At about 4.1 ms the answer sits 5% under its 5 ms limit on a cool, quiet Mac. One FULL sync
(F_FULLFSYNC) is most of that cost, and the design requires that sync.

## The judge, at 25f35437

`judge-25f35437.txt` is `scripts/spine.mjs`'s judge, run from a local copy (`cp -a`, no reopen) at 25f35437 on Linux.

| Part | Verdict |
|---|---|
| #318 `#22.48b6696b` | PASS |
| #319 `#22.1f14a778` | INCONCLUSIVE: only its two budget tests, which skip off a reference Mac |
| #320 `#22.f57a814c` | PASS |
| #321 `#22.3d85284a` | PASS |

The two budget tests pass on the reference Mac at nominal (section above).

The first attempt read BLOCKED on every part. It wasn't the code: the Spark's sccache server hung every compile, so deep-hook never built within the judge's 3 hours. The judge ran again with `RUSTC_WRAPPER=` set empty, which skips sccache for that run only.

## The app on the Mac, at 093c5bc8

`mac-093c5bc8-app/` is the Mac's run of the app at 093c5bc8 (Mac15,12, macOS 27.2.1, on AC, screen unlocked;
`machine.txt`, `exits.txt`). The app's own code is unchanged from there to the head: the later commits add
`tests/acceptance/83/redraft-319/`, three lines of `scripts/lanes.mjs` and this evidence.

- **Failing first.** `failing-first-b898344e.txt`: at b898344e, the test commit,
  `views::tests::a_record_no_batching_core_wrote_shows_its_asks_at_once` fails on its assertion, `left: []`,
  `right: ["ask:a1", "ask:a2"]`. A record with no batch of the core's drew no asks.
- **The app's unit tests.** `1b-deep-app-lib.txt`: `cargo test --locked -p deep-app --lib`, 101 passed, 0 failed, that
  test among them. The whole of `cargo test -p deep-app` is BLOCKED by main, not run: `tests/acceptance/995/app/panel.rs:180`
  doesn't compile against `crates/deep-app/src/show.rs:185` (main's fix is PR #2474, still open).
- **The run by hand.** `e2e-app.test.ts` passed (`vitest.txt`, 100 s, load 6.7 to 3.8). `app-run.txt` holds `deep inbox`
  at each step and the three pictures are the app's window at the same moments:
  - `0-before-batch.png`: eight asks raised and waiting, Needs you empty, "Nothing needs you".
  - `1-needs-you.png`: after the batch, 8 rows, A1, B1, D1 to D5 and "This session keeps asking"; D6 has no row.
  - `2-after-bulk-answer.png`: after `deep inbox answer <exception> together`, A1 and B1, count 2.
- **A separate agent's check** of the pictures against the log is `SCREENSHOT-CHECK.md`: nothing blocks the claim.
  It notes, outside this change: in the first picture the three sessions, 7 to 8 s old, sit under "No project" with an
  empty repo heading, and a minute later under the repo (the diff doesn't touch grouping; cause not traced); ask titles
  are clipped mid-letter with no ellipsis; "Tue 12:17" is when the default applies (Tue 17 Nov), unlabelled.

### The 28 app suite files, one at a time

`2-app-suites.txt`, exits in `exits.txt`: 9 files pass, 19 fail (at 8c3c19ee, with the Mac's compiler broken, 5 passed;
none that passed then fails now). Main's side wasn't run then: the Mac fell under 30 GB free. A separate agent read each
failure against the diff and main's code, with no run; six of the files ran on main later (next section):

| Files | Reading |
|---|---|
| 1002 and 994 `first-screen-redraft/shown`, 1172/shown | BLOCKED or INCONCLUSIVE by their own words: this Mac's screen is 1470 × 841 pt, not the reference window's 1512 × 982 |
| 1457/budgets | INCONCLUSIVE: `BASE_BIN_DEBUG` and `BASE_BIN_RELEASE` not supplied |
| 41/app/screens, 41/app/finder | `--screenshot` is unknown to main's `main.rs` too; set-up's message, the same at 8c3c19ee, involves no record |
| 1172/shell, 1172/popout | every ask is in the list; they fail on clipped row text, an open card and a missing status item, none of it in the diff |
| 1454/commands, panel, panel-redraft/refused | the board fixture imports `gpui-kit`, which main refuses since #1425; some launches SIGKILLed before the window |
| 1454/canvas, 1459/voiceover | `deep-app exited (SIGKILL) before its window`, empty stderr: the criterion is unjudged |
| 1454/answer, 1454/shown, 1462/real, 1462-redraft-ac2 | **main's**: they fail the same way on main on this Mac (below) |
| 1459/identifier, 1459/panel | they pass on main and, run again at the head, pass twice each (below): that run's, not this change's |

None of the 28 appends a bare `ask.created`: each raises through the asks core or a live `deep_ask`, with no batches
declared.

### Six of them on main

`mac-b1a1ff86-main/` is the same Mac's run of six of those files at main b1a1ff86, one at a time, 46 minutes later
(`3-main-suites.txt`, `exits.txt`; load 9 to 27).

| File | On main | Reading |
|---|---|---|
| 1454/answer | fails, 2 of 3, the same two tests | main's: a press on the card's option records no answer |
| 1454/shown | fails, `BLOCKED: deep-app has no window` | main's |
| 1462/real | fails, 4 of 4 | main's: the card takes no key (#1842), no status item |
| 1462-redraft-ac2 | fails, 1 of 1 | main's (#1842) |
| 1459/identifier | passes | passes at the head too when run again (next section) |
| 1459/panel | passes | the same |

### The two #1459 files again, and seven more on main

`mac-07587e38/` is the Mac's run at 07587e38, whose `crates/` and `packages/` equal 093c5bc8's (`exits.txt`).

- `tests/acceptance/1459/identifier.test.ts` and `1459/panel.test.ts` pass, twice each (`1-` to `4-*.txt`): once at
  load 25 to 34 and once at load 6 to 7. The failures at 093c5bc8 didn't come back.
- The probe between them (`probe1459.test.ts`, output in `probe/probe1459.txt`) read the app every 3 s for 33 s, plain
  and with `--panel asks`: alive throughout (no exit code, no signal, 24 readings), one window, and each of the three
  questions on a row label an assistive client reads, the panel reading "Needs you 3".
- So the two failures at 093c5bc8 were that run's, most likely an app killed before or after its window as in five
  other files of that run; the cause of those kills isn't traced. Nothing in this change was altered between the
  failing and the passing runs.

Then, at main b1a1ff86 (`5-main-13.txt`, load 34 to 74), the files so far only read against the code:

| File | On main |
|---|---|
| 1002 and 994 `first-screen-redraft/shown` | fail, the same `BLOCKED: the window didn't take 1512 × 982` |
| 1172/shown, 1172/popout | fail, `BLOCKED: deep-app has no window` |
| 1172/shell | fails, 4 of 4 (2 of 4 at the head) |
| 1457/budgets | fails, the same two INCONCLUSIVE tests for `BASE_BIN_*` |
| 41/app/screens | fails, the same `unknown argument --screenshot` (third run, below) |
| 41/app/finder | fails, the same two AC17 tests and message |
| 1454/commands | fails, the same three: two assertions on the board fixture, one SIGKILL before the window |
| 1454/panel | fails, the same three: two SIGKILLs and the same assertion |
| 1454/panel-redraft/refused | fails, 3 of 4: two SIGKILLs and a missing window |
| 1454/canvas | fails, the same SIGKILL before the window |
| 1459/voiceover | fails, 1 of 3: no buttons labelled with the fixture's rows (at the head, a SIGKILL before the window) |

The last seven rows are a third run on main (`mac-b1a1ff86-main/7-more-suites.txt`, `7-more-exits.txt`, load 13 to
76, thermal state 1 from the second file on). With it, each of the 19 files that failed at the head has a result on
main: 17 fail there too, and 1459/identifier and 1459/panel pass on both. `deep-app exited (SIGKILL) before its window`
happens on main as well, six times in this run; its cause isn't traced.

## #83's status file, redrafted

`tests/acceptance/83/status.test.ts` (AC2 `#83.5bcede40`) passes on main and fails on this change: it runs `deep setup`,
raises an ask and expects "needs you: 1" at once; with setup's batches 8 hours apart the ask waits and the answer says 0,
as `deep inbox` and the app do. The owner settled it: the count is what Needs you shows, and the file goes to its blind
redraft. `tests/acceptance/83/redraft-319/` is that redraft, written on main b1a1ff86 by a job that saw the issues, the
design and the base only. Its `BASE-FAILURE.txt` is the base run: 4 of 5 pass and the waiting-ask test fails on its own
expectation. At the head 5 of 5 pass. The first draft is kept and runs by hand (`scripts/lanes.mjs`, 8e6224b1, which
waits for the owner's signed tag).

## `node scripts/affected.mjs` at 22cd7b05, and main beside it

Linux, load 1: `FAIL affected: 753 new, 48 already failing on main, 891 inconclusive or blocked, 22 listed skips, 4525
passed, in 24313 s`. INCONCLUSIVE: 115 timed files and 45 slow files not run. No WIDE line. The new failures held 247
test files; a separate agent ran each on main b1a1ff86 in its own worktree:

- 241 fail the same way on main.
- `tests/acceptance/83/status.test.ts` is this change's (section above).
- `tests/acceptance/120/overrun.test.ts`, `tests/acceptance/1106/standin.test.ts` and `tests/bays.test.mjs` pass at the head.
- `tests/acceptance/84/reach/switch.test.ts` is INCONCLUSIVE: 3 of 7 runs failed in the working checkout at the head;
  4 of 4 passed in a clean worktree at the head, 4 of 4 at 22cd7b05 and 5 of 5 on main.
- `tests/acceptance/1332/show.test.ts` fails the same way on main: run to a finish at b1a1ff86 in the clean worktree
  (`1332-show-main-b1a1ff86.txt`, 81 minutes), 1 of 2 failed with the branch run's message, "the run serves the Mac's
  issue: #100 landed: expected false to be true". Main's run was at load 56 to 79 and the test waits up to 40 minutes
  for that landing, so by itself it would be INCONCLUSIVE; the branch's failure was at load 1, with the same message.
- Of the lint lines, `packages/asks/src/index.ts` over its ceiling was this change's and is fixed in 093c5bc8 (2059 of
  2059); `packages/hub/src/core.ts` is at main's own 2639. `crates/deep-app/src/views.rs` is over a ceiling main already
  exceeds, and this change adds 70 lines to it.

## The budgets at the head, on the Mac

`mac-07587e38/budgets.txt`: #319's budgets at 07587e38 on the Mac15,12, on AC power with `thermalState 0` at the start
and the end. Load averages were 3.30 → 3.76, higher than the 2.33 of the run at 25f35437, after a 10-minute wait for
the Mac to settle.

| Budget | Five runs after a warm-up | Limit | Result |
|---|---|---|---|
| create an ask, p50 | 0.986, 0.872, 0.914, 1.089, 1.251 ms | 5 ms | PASS |
| answer an ask, p50 | 2.196, 2.982, 2.982, 2.035, 2.199 ms | 5 ms | PASS |
| inbox of 10,000 asks | 1.185, 0.854, 0.685, 0.582, 0.571 ms | 100 ms | PASS |

#319's whole suite passed right after, 20 of 20 in 7 files (`suite-319.txt`).

## `tests/acceptance/84/reach/switch.test.ts`: a race in main's check controls

It failed 3 of 7 runs in the working checkout at the head (and once inside the `affected.mjs` run), all within six
minutes, and passed 8 of 8 in clean worktrees of the branch and 5 of 5 on main. A separate agent traced it:

- **The race** (`packages/checks-command/src/controls.ts` and `index.ts:302`, the same on main, untouched by this
  change): a claim's three checks run at once in one temporary checkout. Each plants a control test in every test file
  and records its line (7, 9, 11), and removes its own when it ends. When the first run ends before the third has read
  its file, the third's control sits at :9 and the run is refused: "failed at session-store.test.cjs:9, not at :11".
  Stop D's claim goes INVALID, nothing runs it again, and no PASS comes in the test's 60 s.
- **Proof**, in a probe worktree at 31b5fd54 with its own install and build, with logging and a delay before the third
  run's start patched into its `dist` only: failed 0 of 10 with no delay, 3 of 6 at 40 ms, 4 of 4 at 80 ms, 3 of 3 at
  200 ms, each with the saved message. The log showed the three plants 35 to 90 ms apart and the first removal a median
  180 ms after the third plant.
- **Not this change's:** with main's `dist` of asks, hub and record in the probe, 0 of 6 failed with no delay and 2 of 6
  at 40 ms, the same error.
- **Not the checkout's:** its `dist` equals the clean worktree's, the helpers use only `target/debug/deep-hook`, and
  each of its five debug builds passed 4 of 4 in the probe. It has passed 9 of 9 since. What differed on the machine in
  those six minutes wasn't found.

The probe's raw outputs were in a scratch folder the Spark's reboot at 14:52 on 2026-11-14 cleared; the counts above
are from the agent's report. A fix belongs in `checks-command`, outside this change.

## The second and third reviews, fixed test-first, and the Mac at each fix

A separate agent reviewed the final diff at 2ed20aaf, then again at b51d52cd and at 6915a4fb. What each round found, and
where it went:

| Round | Found | Where |
|---|---|---|
| 1 (2ed20aaf) | asks held or folded were never shown when the core showed them; any core exception folded the next ask; panels lost the folded asks; a record with no batches never notified | fixed in b51d52cd, tests in 5be14fc0 and 321a4d5b |
| 2 (b51d52cd) | the notification was lost when the hub's `row.set` came after the ask was due; a row stayed folded or held after the hub listed it | fixed in 6915a4fb, tests in 9cb02473 |
| 3 (6915a4fb) | both fixed; no compile risk | three edge cases disclosed below |

Disclosed, not changed: answering an ask and its decision are two writes (`Promise.all`), so one can land without the
other; `batchDue()` rereads settings each second; FULL appends made in one turn share one commit; an `inbox.read`
exception of any kind still folds the session's next ask; the count fold (after five) ignores the `fold` setting; a
record replayed listed, unlisted, listed can notify twice; after a hub restart the app may notify at the next `row.set`;
an ask released from a fold now notifies; `ask.batched` doesn't restart the delay.

- **Failing first, on the Mac.** `mac-b51d52cd/0-failing-first.txt`, at 321a4d5b: 101 pass, the seven new tests fail
  on their assertions. `mac-6915a4fb/0-failing-first.txt`, at 9cb02473: 108 pass, the two new tests fail
  (`left: []`, `right: ["ask:a1"]`; `left: "folded"`, `right: "shown"`).
- **After each fix.** `1-deep-app-lib.txt`: 108 of 108 at b51d52cd, 110 of 110 at 6915a4fb.
- **The whole `cargo test -p deep-app`**, with main's #2474 merged in a scratch checkout (`2-deep-app-full.txt`):
  every test passes except six, the same six as main with #2474 (`mac-b51d52cd/2b-main-full.txt`):
  `acceptance_1141` ac2 and ac3, `acceptance_34` ac11, and `hub_client`'s three. 1141 ac2's message is byte for byte
  main's.
- **The app by hand** (`e2e/`): at b51d52cd, a separate agent's check (`mac-b51d52cd/SCREENSHOT-CHECK.md`) finds all
  three pictures OK. At 6915a4fb the run passes again (Nothing, 8, 2).
- **Three app suite files** that passed at b51d52cd (`mac-b51d52cd/3-suites.txt`) failed at 6915a4fb
  (`mac-6915a4fb/3-suites.txt`): 1459/identifier, 1459/panel and 1172/rows. A small A/B of the same three files, one
  head after the other (`mac-ab-b51d52cd-6915a4fb/`), doesn't follow the change: b51d52cd failed identifier and rows,
  6915a4fb passed identifier and panel and failed rows. The Mac was in use throughout, load 13 to 46 with Windows App,
  Chrome or WeChat in front (`exits.txt`), so this alone settles little; the four-round A/B at the merged head is below.
- **Size.** `crates/deep-app/src/views.rs` is over its ceiling on main already (3938 against 3606); this change adds 76
  lines to it, all in its `mod tests`.

## The Mac at the merged head, adaa0e19 (part of 22p)

`mac-adaa0e19/`: adaa0e19 is 6915a4fb with main 2252dfd6 merged in. The run stopped at 23:27 when the Mac's free disk
fell under 20 GB (`exits.txt`), after its first A/B round.

- **Unit tests:** `1-deep-app-lib.txt`, 110 of 110.
- **The whole `cargo test -p deep-app`:** `2-deep-app-full.txt` fails six tests, and main at 2252dfd6 alone
  (`2b-main-full.txt`) fails the same six (`2-failed-names.txt` and `2b-failed-names.txt` are identical): `acceptance_1141`
  ac2 and ac3, `acceptance_34` ac11, `hub_client`'s three. No #2474 merge is needed any more; it is on main.
- **A/B round A1, at b51d52cd** (`3-ab.txt`): 1459/identifier and 1459/panel pass; 1172/rows fails, its planted-row test
  "BLOCKED: deep-app exited (SIGTERM) before its window". So 1172/rows has now failed at b51d52cd twice and at 6915a4fb
  twice, and passed at b51d52cd once (22n): it doesn't follow the change.

### The rest of 22p, rerun at adaa0e19 (`mac-adaa0e19/rerun/`)

- **The A/B, two rounds per head, the temp binary folder cleared before each** (`3-ab.txt`, `exits.txt`): the merged head
  passed all three files in both its rounds (B1, B2). b51d52cd failed all three in A1 and passed all three in A2. The
  failures follow the machine, not the change. The Mac was in use (Windows App in front, load 7 to 38); the runner
  can't move the pointer and records it at each step.
- **The probe** (`probe/probe1459.txt`): the real app, launched plain and with `--panel asks`, keeps its window, and an
  assistive client finds each ask's row by its question.
- **The app by hand** (`e2e/`): passes. Before the batch Needs you is empty and says "Nothing needs you". After it there
  are 8 rows, A1, B1, D1 to D5 and "This session keeps asking", with no row for D6. After the bulk answer, A1 and B1,
  count 2. A separate agent's check of the pictures is `rerun/SCREENSHOT-CHECK.md`.
- **1172/panel and 1460/cli** (`4-suites.txt`): pass.
- **The judge** (`judge.txt`), from a copy that pins #22 to adaa0e19 and doesn't reopen issues: #318, #320 and #321
  PASS; #319 (`#22.1f14a778`) INCONCLUSIVE. The Mac was on battery power at the judge's start and end, and #319's budgets
  refuse to time off mains power (`tests/acceptance/319/helpers.ts:188`), so the part can't pass there by its own rule.
