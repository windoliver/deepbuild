# Acceptance test for #2740: `tests/acceptance/1463/` passes whole, as main holds it

This test was written first and blind, as a redraft, at base `188b3100a` (main on Nov 22: "Merge pull request #3092 …").
The job saw issue #2740's body, the text of the issues it names, the design and that base. It saw no other branch,
pull request, worktree, report or failure output. The implementing agent doesn't edit these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #2740's body: its problem, the four measured points (what PR #2689 measured, main's three failures, the timing,
  the earlier blind test that isn't on main), Scope, its one criterion, Proof ("The whole suite's run on main, and on a
  `clock` that writes UTC") and Depends on #2668. Issues #2331 (closed; its third criterion moved here word for word),
  #2668 (open: the blind redrafts of `1463/list` AC1, `992/agree` AC3 and `1463/words` AC6), #2643 (open: the
  case-insensitive `gone quiet` match in `1463/helpers.ts`) and #1463 (closed), for their text only.
- `AGENTS.md`. `node scripts/design-section.mjs --issue 2740` (How we know version 0 works: Case lists, Criteria to
  tests, Closed issues stay proven, Wrong programs, the edit guard, Dogfooding, "Tests written first"), and in
  `docs/technical-design.md` the reference Macs and "Every task carries its own budgets".
- At the base, for surfaces and conventions only: `tests/acceptance/1463/` (README, `criteria.json`, `BASE-FAILURE.txt`,
  every test file's names, `helpers.ts`'s head, `words.test.ts`, `budget.test.ts`, `redraft-judges/README.md`);
  `tests/acceptance/1551/helpers.ts` (`timingProblem`, `inconclusive`); `packages/hub/src/list.ts` (`when`) and
  `packages/hub/src/client.ts` (`clock`, `notAnsweringSince`), with `inbox.ts`'s two calls of `when`;
  `scripts/proof-change.mjs` (`criterionId`, `readIssue`, tags); `scripts/proof-runs.mjs` (twins, `atAssertion`, the
  vitest report, its 20-minute run cap); `scripts/lanes.mjs` (`alone`, `slow`, `timed`, `byHand`, `redrafted`, the lane
  file, `stateOf`, `worst`); `scripts/proof-guard.mjs` (the lane file's shape); `scripts/bays.mjs` (a bay's git);
  `scripts/closed-sweep.mjs` (which files hold an ID); `scripts/wait-ratchet.mjs`; `scripts/known-failures.json`; and
  `tests/acceptance/2513-redraft-2047/` as the pattern for a suite run unchanged through vitest's JSON report.

## The criterion

> `tests/acceptance/1463/` passes as it does on main

Its ID is `#2740.90748b6c`: `#2740.` and the first 8 hex digits of the SHA-256 of the line's text, `- [ ] ` dropped,
trimmed, white space collapsed (`criterionId` in `scripts/proof-change.mjs`). It matches the ID the issue gives. The
same text under #2331 had `#2331.90748b6c`, which nothing here names.

| Criterion | ID | Test | Wrong program it fails on |
|---|---|---|---|
| `tests/acceptance/1463/` passes as it does on main | `#2740.90748b6c` | `as-on-main.test.ts` (1 test) | the merge base while #2668's swaps and #2643's fix aren't on main (expected; see below); `utc-clock` (`twins.json`), `clock` writing UTC, failing the suite's cases `#1463.59289fca`, `#1463.8ad45787` and `#1463.dacb7e33`; and any change to the suite's files (FAIL before anything runs; a twin can't plant this, so `judge.test.ts` holds the comparison) |

`judge.test.ts` holds the judge to written inputs and carries no criterion tag, as #1463's `judges.test.ts` carries none.

## What the test holds

`as-on-main.test.ts`, in order:

1. **Main's suite.** Every file of `tests/acceptance/1463/` as git lists it (tracked, or untracked and not ignored, so
   vitest's `node_modules/.vite` cache is left out), and every file under `tests/` those files import by relative path,
   near and far (`../16/helpers.ts`, `../26/helpers.ts`, `../1359/helpers.ts`, `../1551/helpers.ts` at the base), must
   hold main's bytes: git's blob ID at `git merge-base HEAD origin/main`, as #1463's own budget test finds main. No
   file may be added to the folder or gone from it. Otherwise the test fails, naming each file, before anything runs.
   The imported helpers count because a test whose helpers changed isn't the same test: #1551's `timingProblem`, the
   gate on the 100 ms timing, is one of them.
2. **The whole suite, as its README runs it.** First `vitest list --root tests/acceptance/1463 --staticParse=false
   --json` lists the cases without running them (a static parse can't read names built from `ID.…` constants). Then
   `vitest run --root tests/acceptance/1463 --no-file-parallelism`, with `NO_COLOR=1` and vitest's JSON report beside
   its usual output. The suite sets `TZ=Asia/Kolkata` itself (`helpers.ts`), so the environment passes through as it
   is.
3. **Row by row** (`judge.ts`, the design's Case lists). Every listed case must have its own row and have passed. A
   failed case is FAIL, unless its failure's first line names its own state as the lanes read one (`BLOCKED`,
   `INVALID`, `INCONCLUSIVE`; `scripts/lanes.mjs` `stateOf`). A skipped, todo, pending or never-run case is BLOCKED. A
   row the listing never found, a file that isn't the suite's, or a report count unlike its rows is INVALID. A test
   file of the suite the run never reported is BLOCKED, and so are no report, no listing, no case, and a run stopped
   at its deadline. A file failed outside its cases (a hook, an import), or a runner that exited non-zero with no
   failed case or file, is FAIL.
4. **The verdict.** FAIL outranks INVALID, then BLOCKED, then INCONCLUSIVE, and only none of them is PASS. A FAIL
   fails at the test's assertion, naming each case. Any other state is thrown as a plain `Error` starting with its
   name, so the lanes read that state. The proof lane then never counts an INCONCLUSIVE or BLOCKED run of a wrong
   program as one caught at its assertion. Every case's line is printed as `PROOF #2740 <state> <file> › <name>: …`.

**The timing.** The suite's `budget.test.ts` reads its own 100 ms timing on 700 rows and is INCONCLUSIVE off a fit,
quiet reference Mac (#1551's gate: a Mac15,7, Mac15,12 or Mac17,10 on mains, Low Power Mode off, thermal state
nominal, 1-minute load at most half the cores). This test reads that row, so its own verdict is then INCONCLUSIVE,
never PASS. The issue's "read on a fit reference Mac" holds only when that case passes. This Mac, a Mac17,10 at a load
of 100–200, reads INCONCLUSIVE.

## Expected results

| Where | Expected | Why |
|---|---|---|
| This base `188b3100a` | **FAIL**, plus INCONCLUSIVE on this loaded Mac | `list.test.ts` `#1463.f9ab70a8` (the drawn-row judge) and `words.test.ts` `#1463.cc5d1e3f` (`992/agree`), both in `scripts/known-failures.json` under #2668; `redraft-judges/table-judges.test.ts` (case-sensitive `gone quiet`, #2643). A known failure is still a failure here, since the criterion says "passes". Expected from the issue and the known-failures file, not run. |
| Main once #2668's swaps and #2643's fix land, on a fit, quiet reference Mac | **PASS** | All cases pass, the timing among them. |
| The same main anywhere else, or at load | **INCONCLUSIVE** | Only the timing case can't be judged. |
| Twin `utc-clock` on that main | **FAIL** | Exactly `#1463.59289fca` (the hub stopped: "since HH:MM"), `#1463.8ad45787` ("If you don't answer: No, at 16:40") and `#1463.dacb7e33` (`deep inbox undo`'s clock time) fail, as the issue measured on `b1efbb3c9`. |
| A branch whose `tests/acceptance/1463/` or its imported test helpers differ from main's | **FAIL** before any run | It names each file. |

## Wrong program (`twins.json`)

| Twin | File it replaces | The wrong program | Where this test fails |
|---|---|---|---|
| `utc-clock` | `packages/hub/src/client.ts`, blob `4ef1c14640f858c011f599ace9434a181fe94eae` at `188b3100a` (162 lines) | `clock` writes `getUTCHours()` and `getUTCMinutes()` where the base writes `getHours()` and `getMinutes()`; one comment added, nothing else changed | Row by row, at its FAIL assertion, naming the three cases above. `clock` reaches each one: `notAnsweringSince` for the hub that isn't answering, and `when` (in `list.ts`) for the default line and the undo (`inbox.ts`). Asia/Kolkata is UTC+5:30, so UTC never passes for it. |

`clock` lives in `client.ts`; `list.ts` imports it and builds `when` on it, so the twin replaces `client.ts`. A twin
replaces code under test, never a test's files, and the proof lane builds the workspaces after laying it, so the
CLI's `dist` carries it. **Risk:** the twin is a whole copy of the base's file. If `client.ts` changes on main after
`188b3100a`, the copy drops that change and may not build there. Rebuild it from main's file with the same two words
changed.

**Not run here.** The twin run takes the whole suite, an hour or more on this Mac, and is the coordinator's. Its
failure is reasoned from the code and the issue's measurement.

## How to run

Prerequisites, from #1463's README: Node 24.22 first on `PATH`; `npm ci --ignore-scripts`; `npm run build
--workspaces`; `cargo build --locked -p deep-hook`; cargo on `PATH`; macOS. The suite builds the replica's
`deep-drive` itself.

```sh
# The criterion's test: runs all of tests/acceptance/1463/ (an hour or more on a loaded Mac; its deadline is 7 hours).
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2740 --no-file-parallelism as-on-main.test.ts

# The judge's self-test alone: written inputs, no hub, app, git or build.
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2740 judge.test.ts

node node_modules/typescript/bin/tsc -p tests/acceptance/2740/tsconfig.json

# Before committing: the caches vitest's --root leaves.
rm -rf tests/acceptance/2740/node_modules tests/acceptance/1463/node_modules tests/acceptance/992/node_modules
```

For the twin by hand, as the proof lane does: lay `twins/utc-clock/packages/hub/src/client.ts` over a copy of the
checkout, rebuild the workspaces there, and run the first command in that copy. Keep the copy's `.git` real, since
this test and #1463's budget test both read `git merge-base HEAD origin/main`. Never copy a worktree's `.git` file.

## Left to the implementer

- **`scripts/lanes.mjs`**, which this job doesn't edit. `lane.json` here already makes the folder run alone.

  ```js
  // #2740's as-on-main runs all of tests/acceptance/1463 (an hour or more), whose budget test judges a timing on the
  // reference Mac.
  slow.push('tests/acceptance/2740/as-on-main.test.ts');
  timed.push('tests/acceptance/2740/as-on-main.test.ts');
  ```

- **The proof lane's cap.** `scripts/proof-runs.mjs` stops a runner after 20 minutes and counts its files not run. A
  run of this test there reads BLOCKED. The merge-base and twin legs have to be run by hand and recorded.
- **A double run.** Wherever the lanes run both `tests/acceptance/1463/` and this test, the suite runs twice. Whether
  this test runs only in the release preflight or by hand is a lanes call.
- **Evidence:** the run on main and on `utc-clock`, on a fit, quiet reference Mac.

## Ambiguities, and how they were resolved

1. **"Passes as it does on main".** Read as "the suite main holds, run whole, passes", not "gives the same results as
   on main". The issue says the suite can't yet be shown to pass and waits on #2668 and #2643. Its measured run is 35
   run, 34 pass, 1 INCONCLUSIVE, and the regression reading would pass today over three failures. So this test
   requires every case to pass and the suite's files to be main's.
2. **"The whole suite".** This means every test file vitest finds under the folder, as its README runs it. A file
   main's lanes run by hand only (`byHand`) still counts. If #2668 swaps a first draft by keeping it, failing, in this
   folder with its redraft elsewhere, this test fails on it. That is a dispute for a redraft. No case count is pinned:
   the listing is the plan (35 cases in 10 files at the base).
3. **Known failures.** A case `scripts/known-failures.json` sets apart still reads FAIL here. The lanes' set-apart is
   for their own runs, and the criterion says "passes".
4. **Which files are "the suite".** These are the folder and the test files it imports. `992/agree.test.ts`, which
   `words.test.ts` runs by path rather than by import, isn't compared with main here. The edit guard holds it.
5. **Where "main" is.** Main is the merge base of `HEAD` with `origin/main`. With no git, or no `origin/main`, the test
   is BLOCKED. A proof copy made by `git archive` with no `.git` is BLOCKED too, and so is #1463's budget test there.
6. **The states' error class.** INCONCLUSIVE here is a plain `Error`, where #1551's `inconclusive` is an assertion.
   The point is that an INCONCLUSIVE or BLOCKED run of a wrong program is never counted as one caught at its
   assertion. The lanes read the state from the message either way.
7. **The deadline** is 7 hours, above the sum of the suite's own per-test timeouts (about 6.6 hours). Past it the
   runner gets SIGTERM by its PID, then SIGKILL a minute later, and the run reads BLOCKED.
8. **The twin's file.** The brief pointed at `list.ts` for `clock` and `when`. `clock` is defined in `client.ts`, so
   that is the file the twin replaces.

## What was run here, and what wasn't

- `judge.test.ts`: 12/12 pass (vitest 5.0.5, Node 24.22.2).
- 20 planted mutants of `judge.ts` were run against it, one at a time, and each fails it. They cover the precedence
  swapped, a skip that passes, INCONCLUSIVE as PASS, a state read anywhere in a line, each reconcile check dropped,
  changed bytes ignored, a blob without git's header, imports followed one level or into code under test, and the
  stack kept. `judge.ts` was restored after.
- `tsc -p tests/acceptance/2740/tsconfig.json`: exit 0. The twin is excluded, since it imports its siblings.
- The main's-suite half was run on this checkout against `HEAD` (to stay blind to a later main). It found 21 files (17
  in the folder, plus the `16`, `26`, `1359` and `1551` helpers) and no difference. The listing's shape, the report's
  shape and the failure lines were checked with vitest 5.0.5 on a throwaway file, since deleted.
- `scripts/wait-ratchet.mjs`: no finding in this folder. The two timers are marked `// deadline:`. The ratchet is red
  elsewhere on this checkout.
- **Not run:** `as-on-main.test.ts` itself (it runs the whole #1463 suite), the listing over the real suite (it needs
  the workspace build), the base run and the twin run. They are the coordinator's.

## Files

- `as-on-main.test.ts`: the criterion's test, tagged `#2740.90748b6c`.
- `judge.ts`: the judge (reconcile, case states, verdict, blob IDs, imports, differences). It is pure, with no vitest.
- `judge.test.ts`: the judge's self-test, untagged.
- `twins.json`, `twins/utc-clock/packages/hub/src/client.ts`: the wrong program.
- `lane.json`: runs the folder alone. `tsconfig.json`: extends the root's and excludes `twins/`.
