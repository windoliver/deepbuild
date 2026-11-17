# #2218: a spec check's runs, accept and min_tests are read, and a key the hub doesn't read is BLOCKED

**Status: Closes #2218.** Branch `fix/2218-spec-check-keys`, merged with main once: `78307b1c4` (merge commit
`eda286640`), with one conflict resolved by hand. Base when the work started: `b9131dbd9`. All five acceptance
criteria pass on the merged tree, on tests a blind job wrote before any implementation. Four fail on the base and on
main `78307b1c4` at their own judgement, as the issue says; the fifth, the twin, passes there and fails on a mutant.
One thing waits for you: the commit that touches `scripts/lanes.mjs` needs your approval tag. No `affected.mjs` run
gave a verdict: the machine stayed at a load of 200 to 800 on 18 cores. What that leaves unshown is under Not run.

## Requirement, change, proof

| Issue | Change | Proof |
|---|---|---|
| Scope 1, AC1, AC2: `runs` and `accept` reach the claim's check and its clean runs are counted against them | `checksOf` keeps `runs`, `accept`, `min_tests`. `spec-checks.ts` turns `runs`, or the count `accept` computes (`runsNeeded`), into the check's run count. `gate-runner.ts` starts a spec check's runs one after another on the claim until `moreRuns` says none is to come; the check is pending till then | `runs.test.ts`, `accept.test.ts`: fail on the base and on main (PASS on 1 run), pass on the merged tree (a pass and a fail: INCONCLUSIVE; 29 runs, no PASS before the 29th) |
| Scope 2, AC3: `min_tests` | One row in the verdict engine: a pass that counted fewer tests is INVALID, naming both counts; carried there through the gate's `ClaimedCheck` | `min-tests.test.ts`: fails on the base and on main, passes on the merged tree |
| Scope 3, AC4: a key no reader takes | `unreadKeys` reads done.yaml with positions. Any such key, at the top or on a check entry, stands on the claim as one check, `.deepbuild/done.yaml`, missing a cause that is yours: BLOCKED, naming each key and line, owner you. The spec's other checks still run beside it (see Merged with main) | `unread.test.ts` (2 tests): fail on the base and on main, pass on the merged tree |
| AC5, the twin | The keys this repo's spec writes are all read | `twin.test.ts`: passes on all three. Its wrong program is mutant M4 (`min_tests` taken off the read keys), which it fails |
| Scope 4: no version key | none added | |

Not asked for by a criterion, and kept because dropping a value silently is the bug: a `runs`, `accept` or `min_tests`
the hub can't read stands on its check as a missing cause (BLOCKED, naming the value). `spec-checks.test.ts`.

The fix is 113 added lines of source in `packages/hub`, `packages/gate` and `packages/verdicts`, and 77 of unit
tests. The rest of the PR's lines are the blind suite (916) and this folder. It adds no option, dependency or
contract. An extension can't meet it: which checks a claim takes, and how its runs become a verdict, are the done
gate's floor in the core.

## Merged with main

Main moved 699 commits while this was verified, and #2205 landed in the same function (`specChecks`), so the merge
conflicted there. Resolved by hand in `spec-checks.ts`: #2205's checks the gate can't run and its unparseable file
are kept as main has them, and this change's keys and counts are read beside them. One behavior changed at the merge:
before it, a spec with an unread key ran none of its checks; #2205's suite needs `unit` to run in a spec whose journey
entry writes `file`, so the unread-key check now stands beside the spec's checks instead of in their place.
No reader on `78307b1c4` takes a key of done.yaml that the two lists in `spec-checks.ts` lack (read, not run).

## What was run

Loads are the machine's 1-minute load on 18 cores; other sessions ran throughout.

- **Fails before.** The blind job's run on the base `b9131dbd9`: 5 failed at their judgements, the twin passed
  (`tests/acceptance/2218/BASE-FAILURE.txt`). On main `78307b1c4`, the merged branch's merge base, the same: each
  of the five fails at its own judgement with the hub's PASS in its message, and the twin passes
  (`before-on-main.txt`). The `chekcs` test stopped in its setup in the first run there, at a load of 500 to 600,
  and reached its judgement in a second.
- **Passes after.** On the merged tree, workspaces and deep-hook rebuilt: 6 passed (`after-merge.txt`). Before the
  merge, on the fix at the base: 6 passed (`after-acceptance.txt`).
- **The suite is the blind job's.** Its 21 files match `acceptance.sha256`, as delivered; `blind-prompt.md` is all
  the job was given beside the issue, the design and the base.
- **#2205's suite on the merged tree** (`after-merge.txt`): 7 of its 8 tests passed twice. AC1 failed once, its
  fixture's claim INCONCLUSIVE on `snapshot over budget` after 944 s with no run of its check, and passed once: a
  pass and a fail, so INCONCLUSIVE, not a pass.
- **The twin can fail, and so can the unit tests.** Six mutants of the change's lines each fail a test
  (`unit-and-mutants.txt`). Run before the merge.
- **The nearest tests of the selection**, on the merged tree (`neighbours.txt`): the 16 files of `packages/verdicts`,
  `packages/gate`, the hub's four nearest unit files, `tests/acceptance/28` and `684/engine.test.ts`. 198 of 207
  tests passed at a load of 400 to 530. The 9 that failed are time: three budgets and three 5 s timeouts in
  `verdicts.test.ts`, the 5 s timeout of #28's 10,000 generated claims, and two hub unit tests whose hub gave no
  answer in 10 s. The same four files fail on main `78307b1c4` at that load, each on time or on a hub that gave no
  answer. With vitest's 5 s timeout raised, #28's reference agrees with the engine on its 10,000 claims on the
  merged tree. The two hub unit tests passed on both sides at a load of 270.
- **The files that start hubs** (`neighbours.txt`), each alone under one test grant, on the merged tree and on main
  `78307b1c4` built beside it:
  - #1018's hub file: 9 of 10 passed on the merged tree, AC3's and AC4's run counting among them. AC1's
    five-session test failed, and fails for the same reasons on main.
  - #2065's two stalled-claim tests, turn about, 6 repetitions a side: 11 of 12 passed on each side, and each side
    failed once in its setup. Main gave `one real stalled-claim ask: expected 0 to be 1`, the message the change
    gave twice in 18 before the merge, so it isn't this change's.
  - #684's lane file: one 5 s timeout on both sides at a load of 260 to 290; 5 of 5 pass on the merged tree with the
    timeout raised.
- **Guard** (`guard.txt`): `node scripts/proof.mjs guard` on the merged branch gives one finding, the lane commit,
  below.
- **Lints**, from the third `affected.mjs` run's logs: the repository's own findings, 194 lines. One names a file
  this change touches: `stop-judging.ts` is 1,503 lines, over 1,500 with no ceiling. Main holds it at 1,517; this
  change takes 14 out.
- **`node scripts/affected.mjs`**: three runs, no verdict of its own on the merged tree (`affected-summary.txt`,
  `affected-merged.txt`).
  - Before the merge: FAIL, 609 new, 850 inconclusive or blocked, 2,177 passed, in 15,011 s. No WIDE line; 72 timed
    and 34 slow files unrun. The 33 nearest acceptance files that failed there were run again alone on the change
    (163 of 183 tests passed) and the 14 still failing on the base too: 19 fail on the base, the same 19 on the change.
  - On the merged tree: one run got no test grant in 30 minutes and started nothing; the next ran seven hours and was
    killed with its session before its last line. Its lists: `WIDE 1061`, 47 timed, 16 slow and 40 skipped files
    unrun, and `scripts/lanes.mjs feeds every suite`. Of the jobs that ended, 641 test lines read NEW FAIL, 479 of
    them a timeout, a hub not ready or a file that reported no test.
- Workspace build and `cargo build --locked -p deep-hook` on the merged tree: exit 0. Hub typecheck: exit 0.

## Not run

- The change's whole selection to a verdict, on either tree: see above. The timed, slow and WIDE files never ran.
- The proof lanes other than the guard (before, trace, mutation), the full typecheck, the preflight, anything live.
- `proof.mjs replay`, which a change to `packages/verdicts/src` calls for: this repository holds no seeded case
  under `tests/fixtures/false-done` or `tests/fixtures/cheat`, so by its code it would read BLOCKED.
- The verdict-proofs lane: no Lean toolchain under `.lean/`.
- The mutants on the merged tree; they ran before the merge.
- Anything on main as it stands now. Main has moved 326 commits since the merge; `git merge-tree` of the branch
  with `3c124dee5` gives no conflict.

## Waits for you

- **The lane commit.** Each of the suite's files starts hubs of its own, as #2205's and #322's do, so `f47f84c63`
  puts its folder on `scripts/lanes.mjs`'s `alone` list. The guard reads that file as the proof lanes' own code:

  ```
  FAIL guard: scripts/lanes.mjs: the proof lanes' own code changed (commit f47f84c63f3c)
  ```

  The commit changes that file alone, so your approval tag on it (`Approves: scripts/lanes.mjs`) clears it. Without
  the tag, say so and the branch is rebuilt without it: the fix and its tests don't depend on it, and the suite then
  runs in the parallel block.
- **One run a claim for a definition's check stays.** The blind suite needs a spec check's runs started on the one
  claim. #1018's AC4 needs a definition's check to get one run a claim. Both suites hold only if the two differ, so
  they do, by `source`. Yours to decide whether that stands.

## Found beside it, not changed

- **The engine has a row its reference and Lean model lack.** `min_tests` is not in `tests/acceptance/28`'s
  reference, a blind job's file, or in `packages/verdicts/model`. Neither writes the key, so the reference still
  agrees with the engine wherever it looks.
- Release checks still drop `runs`, `accept` and `min_tests`; the issue names spec checks.
- The design's own `done.yaml` example is now BLOCKED on `file`, on its journey entry, and on `rules`: no reader
  takes either.
- Main has since landed #2332, which loads `yaml` through `packages/hub/src/yaml.ts` to keep it off the hub's
  start. `spec-checks.ts` imports `yaml` at its top, as main's `landing.ts` still does. Moving it behind `yaml()`
  wants a second merge with main.
- Main `78307b1c4` holds `stop-judging.ts` at 1,517 lines and `core.ts` at 2,660, over its ceiling of 2,638.
- Main `78307b1c4` fails #1018's AC1 five-session test at a load of 240 to 370. It is not in
  `scripts/known-failures.json`.
- #322's `github.test.ts` wrong-program tests fail on both sides, on a different count each run, at `ENOTEMPTY` in
  their cleanup. Seen before the merge.
