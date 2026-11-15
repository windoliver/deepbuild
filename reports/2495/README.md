# #2495 — configuration eval reports reach evidence

Base: `291d63af6` (current main when this branch began). No replay/comparison rule changed. No command, option or dependency added.

**Superseded by the [closure proof](closure/README.md).** The three issue criteria are now proven on the current integration: 42 distinct passing tests, five expected assertion failures on its exact base, and the unchanged #112/#1108 automated suites. The earlier draft's live/repository-wide blockers below were over-scoped; their unrun/FAIL states remain disclosed, never counted as PASS.

## Requirement → change → proof

| Requirement | Change | Proof |
|---|---|---|
| Finished report stored by hash through the hub; run prints its handle | Script sends its exact JSON serialization through the public hub entry to authenticated CLI method `eval.report`; the hub stores the bytes and appends `evidence.stored`. Client verifies the returned hash. | Approved blind suite: three missing-handle failures on base (`base-failure.txt`), three passes on the change (`test-results.jsonl`). Separate capture: base has no report entry or handle; change prints its actual SHA-256 and store bytes equal the kept file (`base-store.json`, `change-store.json`, corresponding `*-report.json`). |
| Keep `~/.deepbuild/evals/` file | Same bytes remain in the variants-digest file; a failed hub write is BLOCKED and leaves it. | Acceptance file equality; unchanged plan/gate tests 2/2; new unavailable-hub regression 1/1 (`script-results.jsonl`). |
| Local-first widening adopts or refuses by cited replay outcome | No change to `compareReplay` or `replayCheck`. | Acceptance: adopt applies to the repo and later session; regresses refuses naming its outcome. #112's unchanged rule/widen tests also hold INCONCLUSIVE at session scope. |
| #112 and #1108 suites unchanged | No edits to either directory. | #112 automated 19/19; #1108 4/4. The repository's by-hand #112 live file was not run; no live-eval or timing claim is made. |
| Transport regression protection | Real hub rejects malformed JSON, wrong role and wrong token; exact bytes deduplicate by SHA; raw input is never labelled fully redacted. | `packages/hub/test/eval-report.test.ts` 2/2; unknown method failed on the old base, and the label test failed on the initial fix (`raw-label-failure.txt`). All five CLI lazy-loading tests pass. |

The hub addition is a storage transport to its existing record/evidence owner. The eval remains an extension; it does not import the hub or open a second evidence writer. Review caught the initial raw report's incorrect `complete` label: the route now records `redaction: unknown`, license `session`, with no sharing allowed, while preserving exact bytes. The transport does not authenticate the run's producer; it does not change the existing replay checker or grant permission to widen a change.

## Acceptance adoption and runtime

Two independent jobs drafted tests from the issue, design and `1c4d1f0e2`, without seeing implementation work. The first passed its behavioral assertions but removed the fixture home before the hub had exited (`first-draft-failure.txt`). The blind redraft awaits exit. The user's follow-up approved closing the stated gaps, including the proposed redraft adoption and changing its evidence import to `@deepbuild/evidence`. That one import is the only change to the redraft. Assertions remain frozen; #112/#1108 remain byte-identical. The original and both drafts are retained in the prior local dispute evidence; only the approved draft is active here.

The earlier #1108 failures were a runtime-install problem, not weakened checks: Homebrew Node 24.22.2 links `@rpath/libnode.137.dylib`; #1108 copies its interpreter to a fixture bin, so dyld aborted before a request. The installed self-contained Node **24.22.0** satisfies the repo floor and runs all four tests unchanged. No sandbox grant, launcher behavior, test or baseline was altered to fix that.

## Verification and remaining inherited failures

- Base workspace build and deep-hook build passed; changed hub build passed; #2495 acceptance typecheck and contract check passed (`contracts.txt`).
- `node scripts/affected.mjs` with the explicit #2495, #112/#1108, transport, lazy-loading and gate/plan test paths completed: **35 tests passed, zero test failures**. `affected.txt` records **FAIL: 166 unlisted lint findings, 42 known, 0 inconclusive/blocked**. It emitted no WIDE or INCONCLUSIVE line for this focused selection. #112 live is printed as by-hand SKIP, never PASS.
- Each failing lint was run on the clean current base. After keeping the new route on the existing registry row (no server size growth), failure keys/counts match base with **zero added findings** (`lint-comparison.json`). The full affected summary still reads FAIL; the baseline and checks were not edited. The two canvas-closure modes write the same affected log, so its combined line was compared to a separate base drift run.
- The root `tsc --noEmit` reports eight errors in unrelated existing tests (`workspace-types.txt`), byte-identical on base and change. Package builds and the new acceptance typecheck pass.
- Full source-path selection would run 1,231 ordinary test files plus two crates, leaving 89 timed and 38 slow files unless requested; no WIDE files. That selection and full release preflight were **not run**. This change is verified by the targeted real command/hub tests, not a claim that every hub consumer was checked.
- The registry formatting correction was rebuilt and checked with the transport test (1/1; `final-route-test.txt`). After the redaction-label correction, only its affected acceptance, transport and unavailable-hub checks ran again through `affected.mjs`: **6 passed, zero test failures**, with the same inherited 166 unlisted/42 known lint findings (`label-affected.txt`, `final-*-results.jsonl`). Final lint failure keys and counts equal the base exactly. Diff review confirms only this issue's files and unchanged #112/#1108.

Raw report JSON is kept byte-for-byte, so `sha256sum *-report.json` matches the inventories. All reports contain synthetic fixture data only. Log paths are redacted. No real agent eval, live spend, timing budget or Linux run is claimed.
