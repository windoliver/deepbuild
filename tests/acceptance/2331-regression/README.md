# #2331 criterion 3: `tests/acceptance/1463/` passes as it does on main

Written blind at base `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` from issue #2331 (updatedAt 2026-11-15T07:52:50Z), `AGENTS.md`,
`docs/technical-design.md` and the base's tests and proof scripts. No implementation, branch, failure output or earlier draft was
seen. This covers criterion 3 **only**; criteria 1 and 2 (`#2331.04651a1b`, `#2331.aee6e8f0`) are another job's. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Criterion to check

| Criterion | ID (`scripts/proof-change.mjs` `criterionId`) | Test | Wrong program it fails on |
|---|---|---|---|
| 3: "`tests/acceptance/1463/` passes as it does on main" | `#2331.90748b6c` | `suite-1463.test.ts`: `tests/acceptance/1463` is the merge base's, unchanged and with nothing added; run whole through its own entry, every one of main's 35 tests in its 10 files (`judge.ts` `MAIN_1463`) finishes `passed` and the run exits 0 with no error outside a test | a `clock`/`when` that writes another time than today's: AC8, AC10 and AC3 of #1463 fail at their assertions, and this test fails at `expect(j.failed).toEqual([])`, naming each |

`judge.test.ts` (no criterion tag, no hub or app) holds the judge to written runs: main as it is is PASS. A failed assertion is
FAIL, naming the test and its message. A BLOCKED or INCONCLUSIVE test, a skip, a todo, a missing test or file, an extra file, a
file that errored, no report, an unfinished run, or exit ≠ 0 with every test passed is never PASS.

## What "as it does on main" is read as

- **The suite** is main's: `git diff` and untracked files under `tests/acceptance/1463` against `git merge-base HEAD origin/main`
  (the merge base #1463's own `budget.test.ts` uses) must be empty. If there's no `origin/main`, the result is BLOCKED.
- **How main does**: every test passes. `scripts/known-failures.json` at this base sets none of #1463's tests apart, so no
  failure is waived here. 1463's `BASE-FAILURE.txt` is from #1463's own base `0c4a4ec7`, from before its implementation. It isn't
  main's result.
- **The tests main has**: 10 files and 35 tests, counted from the declarations at this base: budget 2, deep 4, detail 1,
  inbox 5, judges 8, list 4, notification 2, scope 2, words 2, `redraft-judges/table-judges` 5.

## Commands

Same prerequisites as `tests/acceptance/1463/README.md`: macOS, Node 24.22 first on `PATH`, `npm ci --ignore-scripts`,
`npm run build --workspaces`, and `cargo build --locked -p deep-hook`. The 1463 suite builds `deep-drive` itself. It also runs
`tests/acceptance/992/agree.test.ts`, which takes minutes.

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2331-regression --no-file-parallelism            # the criterion
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2331-regression judge                            # the judge alone, anywhere
node node_modules/typescript/bin/tsc -p tests/acceptance/2331-regression/tsconfig.json
```

The test itself runs `NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1463 --no-file-parallelism
--reporter=default --reporter=json --outputFile.json=<tmp>`. That is 1463's own command plus the report, and it gets 3 hours
before it is killed (an unfinished run is INCONCLUSIVE).

## Expected results

- **Main, and a correct #2331, on a fit, quiet reference Mac** (#1551's `timingProblem`): PASS.
- **Off a reference Mac or under load:** INCONCLUSIVE, never PASS. 1463's AC7 timing (`budget.test.ts`, "deep answers within
  100 ms …") fails there with `INCONCLUSIVE:`. This applies to main too. Nothing here waives it.
- **Wrong program:** `clock` in `packages/hub/src/list.ts` writes the UTC hours and minutes (`getUTCHours`/`getUTCMinutes`)
  instead of your zone's. 1463 runs every process with `TZ=Asia/Kolkata`, so for the 16:40 ask `deep inbox` prints `at 11:10`.
  Three #1463 tests fail at their assertions:
  - `#1463.8ad45787` …reads "If you don't answer: No, at 16:40"… (`inboxFailures`)
  - `#1463.dacb7e33` deep inbox undo says when… (`clockFailures`)
  - `#1463.59289fca` with the hub stopped… since when (`downFailures`)

  This test then fails at "tests/acceptance/1463 must pass as it does on main", listing `failed: <each name>: <its message>`.
  The same happens to a `when` that loses `tomorrow` or the weekday, or writes `4:40 PM`.
- **#2331's base (1c4d1f0e2) itself**, if #1463 passes there: PASS. This is a regression guard, so a failure at the base is
  not expected and proves nothing. A `scripts/proof-change.mjs` "fails before" requirement for this criterion would have to
  use the wrong program above, not the base.

## Ambiguities, stated

1. **"As it does on main"** is read as "all of main's tests pass", not as "the same failures as main". If main's 1463 fails on
   some test on the machine that runs it, this check fails too. It doesn't copy main's failures as a waiver. If such a
   failure exists, the person should rule on it.
2. **AC7's 100 ms** depends on the machine. This check passes only where 1463's AC7 passes, on a fit, quiet reference Mac.
   Elsewhere it is INCONCLUSIVE.
3. **The pinned counts** are this base's. If main's 1463 changes later through an approved proposal, `MAIN_1463` no longer
   matches and this check fails, naming the file. That case needs a redraft, not an edit.

## Not done here (for the implementer)

- **Lanes:** add `tests/acceptance/2331-regression/suite-1463.test.ts` to `scripts/lanes.mjs` `alone` and `slow`. It runs
  1463, which is itself `alone`. This is a landing edit, outside this folder.
- **Cache:** delete `tests/acceptance/1463/node_modules/.vite/` and `tests/acceptance/2331-regression/node_modules/.vite/`
  before committing.

## Unrun here

Nothing here was run. This checkout has no `node_modules` and no builds, and this job may not build or run the full suite.
`tsc`, `judge.test.ts` and `suite-1463.test.ts` are all unrun. Only `judge.ts` was exercised: under plain Node, against
written reports, it returned PASS for main as it is, FAIL naming the failed test, and INCONCLUSIVE or BLOCKED for those
prefixes, a skip, no report and an unfinished run. It returned FAIL for exit 1 when every test had passed.
