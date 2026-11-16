# #2218: a spec check's runs, accept and min_tests are read, and a key the hub doesn't read is BLOCKED

**Status: Part of #2218, not Closes.** All five criteria passed through the blind suite, unchanged, on the change as
it stood on its base, and failed on the base as the issue says. Main was then merged with a hand-resolved conflict,
and the suite has not run on the merged tree: its build got no grant. What keeps it from Closes is under Open.

Base: `b9131dbd9857aefc4dcc39dd0d534d007b1ef671` (origin/main when the work started).

## Requirement, change, proof

| Issue | Change | Proof |
|---|---|---|
| Scope 1, AC1, AC2: `runs` and `accept` reach the claim's check and its clean runs are counted against them | `checksOf` keeps `runs`, `accept`, `min_tests`. `spec-checks.ts` turns `runs`, or the count `accept` computes (`runsNeeded`), into the check's run count. `gate-runner.ts` starts a spec check's runs one after another on the claim until `moreRuns` says none is to come; the check is pending till then | `runs.test.ts`, `accept.test.ts`: fail on the base (PASS on 1 run), pass on the change (a pass and a fail: INCONCLUSIVE; 29 runs, no PASS before the 29th) |
| Scope 2, AC3: `min_tests` | One row in the verdict engine: a pass that counted fewer tests is INVALID, naming both counts; carried there through the gate's `ClaimedCheck` | `min-tests.test.ts`: fails on the base, passes on the change |
| Scope 3, AC4: a key no reader takes | `unreadKeys` reads done.yaml with positions. Any such key, at the top or on a check entry, stands on the claim as one check, `.deepbuild/done.yaml`, missing a cause that is yours: BLOCKED, naming each key and line, owner you. The spec's other checks still run beside it (see Merged with main) | `unread.test.ts` (2 tests): fail on the base, pass on the change |
| AC5, the twin | The keys this repo's spec writes are all read | `twin.test.ts`: passes on both. Its wrong program is mutant M4 (`min_tests` taken off the read keys), which it fails |
| Scope 4: no version key | none added | |

Not asked for by a criterion, and kept because dropping a value silently is the bug: a `runs`, `accept` or `min_tests`
the hub can't read stands on its check as a missing cause (BLOCKED, naming the value). `spec-checks.test.ts`.

## Merged with main

Main moved 699 commits while this was verified, and #2205 landed in the same function (`specChecks`), so the merge
conflicted there. Resolved by hand in `spec-checks.ts`: #2205's checks the gate can't run and its unparseable file
are kept as main has them, and this change's keys and counts are read beside them. One behavior changed at the merge:
before it, a spec with an unread key ran none of its checks; #2205's suite needs `unit` to run in a spec whose journey
entry writes `file`, so the unread-key check now stands beside the spec's checks instead of in their place.
`after-acceptance.txt`, `affected-summary.txt` and the mutants are from before the merge; what ran after it is in
`after-merge.txt`.

## Evidence here

- `tests/acceptance/2218/BASE-FAILURE.txt`: the blind job's run on the base. 5 failed at their judgements, the twin passed.
- `after-acceptance.txt`: the same six tests on the change. 6 passed.
- `acceptance.sha256`: the blind job's files as delivered; the copies in this tree match.
- `blind-prompt.md`: all the blind job was given beside the issue, the design and the base.
- `unit-and-mutants.txt`: the two unit files on the final source, and six mutants of the change's lines with the test each fails.
- `affected-summary.txt`: `node scripts/affected.mjs`, its last line and what its lines say.

## Open

1. **One run a claim for a definition's check stays.** The blind suite needs a spec check's runs started on the one
   claim. #1018's AC4 needs a definition's check to get one run a claim. Both suites hold only if the two differ, so
   they do, by `source`. Yours to decide whether that stands.
2. **The engine has a row its reference and Lean model lack.** `min_tests` is not in `tests/acceptance/28`'s
   reference or `packages/verdicts/model`. The verdict-proofs lane was not run: no Lean toolchain under `.lean/`.
3. **`scripts/lanes.mjs` is unchanged.** The suite starts hubs of its own and belongs on `alone`; that file needs
   your signed approval. In the affected run its five files ran in the parallel block and passed.
4. **`node scripts/affected.mjs` read FAIL** at a load of 200 to 800: 609 new, 850 inconclusive or blocked, 2177
   passed. No WIDE line; 72 timed and 34 slow files unrun. Most lines are timeouts and hubs that had no `deep-hook`
   in their shard. The 33 nearest acceptance files that failed there were run again alone on the change (163 of 183
   tests passed) and the 14 files still failing on the base too: 19 fail on the base, the same 19 on the change.
5. **#2065's stalled-claim setup is INCONCLUSIVE.** Its two tests failed 2 times in 18 on the change ("one real
   stalled-claim ask: expected 0 to be 1") and 0 in 18 on the base; run turn about in one grant, 8 of 8 passed on
   each side. No cause found in the change. A load of 300 to 400 against the test's 20 s wait is the likely one.
6. **Not shown either way:** #322's `github.test.ts` wrong-program tests fail on both sides, on a different count each
   run, at `ENOTEMPTY` in their cleanup.
7. **Not run on the merged tree:** the blind suite, #2205's suite and `affected.mjs`. Only the hub typecheck and the
   two unit files ran there (`after-merge.txt`).
8. **Not run:** the proof lanes (before, trace, mutation), the full typecheck, the preflight.
