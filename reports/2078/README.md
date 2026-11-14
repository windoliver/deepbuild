# #2078 closure proof

PR base: `5c92a77023e251385c6b9c7727d103ec5ed61a0e`. Production fix: `89d118e50`.
Tests were committed first (`e45ed2445`, `6db882a34`); no acceptance assertion was edited.

## Requirement → change → proof

| Requirement | Change | Machine result |
| --- | --- | --- |
| AC1 `#2078.f33c092f`: an unhooked tracked-file edit appears in the next read-only stop's snapshot and its checks run on it | `packages/hub/src/gate-runner.ts` reads the tree/HEAD under the existing snapshot budget before considering reuse | On the merge base, the unchanged blind test fails at `src/cart.ts`'s contents: the second claim carries PASS and starts no run. On the fix, it reads the changed contents from the new snapshot, observes the check failing there, and asserts FAIL. See `merge-base-tests.txt`, `head-acceptance.txt`. |
| AC2 `#2078.f4160036`: unchanged tree/HEAD reuses the snapshot, writes no objects and starts no run | Reuse skips checkout only after the deterministic commit and state-adjusted tree match. The snapshot service publishes temporary objects only for a new snapshot. | Blind AC2 passes unchanged before and after. The test also rejects a planted gate that disables checkout/result reuse, at its no-new-run assertion (`ac2-wrong-program.txt`, recorded on the initial base). |
| Scope: HEAD must match | The deterministic snapshot commit pins tree and HEAD together | Blind HEAD test fails on the merge base and passes on the fix. |
| Scope: a tree read that exceeds its budget cannot carry PASS | `snapshot(cwd, budget)` is inside the existing `OverBudget` handler | Blind budget test carries PASS on the base; on the fix it asserts INCONCLUSIVE, `snapshot over budget`, and no run. |
| Unchanged snapshots do not rewrite existing objects or retention refs | `packages/gate/src/checkouts.ts` builds temporary objects without the permanent store as an alternate; publication links new objects atomically, without rewriting existing ones | The service regression fails on the base on object timestamps and a moved retention ref, then passes unchanged. |
| A sibling claim arriving during the read cannot leave a runnable claim without a checkout | Read the previous claim after awaiting the tree, not before | The independent `packages/hub/test/snapshot-sibling.test.ts` uses a real Git clean filter to hold the read. It fails on the initial candidate with `cwd: null` and BLOCKED (`sibling-before.txt`); after moving the lookup it passes unchanged (`head-gate.txt`). |

**Issue acceptance: both criteria proven; no #2078 criterion is open.** This supports `Closes #2078`. It does not assert a clean repository-wide release preflight.

The change belongs in the existing gate and snapshot service, not an extension: an extension cannot decide which commit the core's verdict covers. No option, API, dependency, lockfile, baseline or existing check was changed. `scripts/lanes.mjs` registers the real-hub acceptance file in the alone lane. A comment in `stop-judging.ts` now describes `same` as a hint, not evidence.

## Commands and results

All ran in an isolated checkout of the PR base, not the shared dirty worktree. Cargo was on PATH. The base build passed:

```sh
npm run build --workspaces
cargo build --locked -p deep-hook
```

The two changed packages' subsequent builds passed too. Normal verification used:

```sh
# Merge base with the frozen tests, before production changes:
node scripts/affected.mjs tests/acceptance/2078/reuse.test.ts packages/gate/test/snapshot-reuse.test.ts
# Snapshot service after its fix:
node scripts/affected.mjs packages/gate/test/snapshot-reuse.test.ts packages/gate/test/checkouts.test.ts tests/acceptance/31/snapshot.test.ts tests/acceptance/31/retention.test.ts packages/hub/test/checkouts.test.ts
# Final gate, including the sibling correction:
node scripts/affected.mjs tests/acceptance/2078/reuse.test.ts packages/hub/test/snapshot-sibling.test.ts packages/hub/test/gate-runner.test.ts
```

- Merge-base tests: **4 intended failures, 9 passes**. Three are the issue's changed-file/HEAD/budget cases; one is the store-write regression. AC2 passes. The selector also ran #1906's child-process regressions, which passed.
- Snapshot-service run: **40 tests passed**, no skip, including existing isolation, dependency cloning, deterministic snapshots, retention, and child-process tests (`head-service.txt`).
- Final gate run: **9 tests passed**, no skip: all four acceptance cases, the sibling regression, and four existing gate-runner tests (`head-acceptance.txt`, `head-gate.txt`).
- AC2 wrong-program probe: AC2 fails at the required assertion. The other three cases were explicitly unselected, not claimed as passing.
- Frozen acceptance files match the independent drafting job's output. Its original base and failure are preserved under `tests/acceptance/2078/`; the latest merge-base failure is additionally recorded here.

## Repository-wide findings, not waived

The affected runners also execute repository-wide lints. Their aggregate outcome is **FAIL**, not PASS:

| Run | New-to-baseline findings | Already recorded on main | Tests passed |
| --- | ---: | ---: | ---: |
| Merge base | 158 (4 intended test failures + 154 lints) | 45 | 9 |
| Fixed snapshot service | 154 lints | 45 | 40 |
| Fixed gate/acceptance | 154 lints | 45 | 9 |

`lint-comparison.txt` compares the findings, including duplicates: no new after-fix lint remains. Only the canvas-closures wrapper/Map-projections line is normalized because its two commands interleave output into one log; all other lines match exactly. The failures concern existing dependency declarations, vendor patch records, canvas/size guards, verdict mappings, a fixture path, and expired known-failure entries. The raw redacted aggregate logs are `merge-base-affected.txt`, `service-affected.txt`, and `head-affected.txt`. Nothing in `scripts/known-failures.json` was changed.

The focused runs emitted **no WIDE or INCONCLUSIVE lines**. A production-path selection also found hundreds of indirect consumers, 70 timed files, 33 slow files, manual suites and `deep-app`; that whole selection and release preflight were **not run**. Unrun timing/manual coverage remains **INCONCLUSIVE**. The issue's budget test proves the fail-closed result, not the separate 11-second reference-machine timing target. No push/PR CI is configured or added.

## Review and size notes

- The prior snapshot's retention ref is no longer refreshed on reuse. This follows the design's “writes nothing” and “30 days after it was written”; current claim/ask/evidence citations still pin snapshots. Existing retention tests pass.
- Temporary index/object files are still written and removed while reading the worktree. The no-write guarantee is for persistent objects and refs; Git must read the current worktree, rather than trust hooks.
- The independent sibling regression was drafted from the issue/design/base, without the implementation or the failed first fixture. Its final file was kept unchanged after its first failing candidate run. The first exploratory fixture failed in setup (required Git filter with no smudge command); it was not used as bug proof or edited into a pass. The valid regression reproduced the actual null-checkout failure.
- The diff exceeds the approximately 400 handwritten-line guideline because it keeps the independent real-hub acceptance fixture, its original failure, the independently drafted race regression and reviewable evidence. The production/lane/comment fix is only **30 added / 15 removed lines**. Splitting these tests away would remove the issue's proof; the implementing agent did not trim or rewrite the independent tests.
- Other sessions' changes in the original checkout are excluded from this branch. All evidence here is local command output with machine home paths redacted. No existing tests, goldens or checks were weakened.
