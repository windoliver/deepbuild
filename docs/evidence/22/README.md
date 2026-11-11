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
