# #1123 closure attempt: two real folder migrations

This supersedes the earlier zero-qualified-folder inventory for **#374 and #375 only**. It does not turn missing readings into passes.

## Independent redrafts

Separate blind jobs read only issue #374 or #375, issue #1123, design and base `092754bb1`. The resulting helpers are copied byte-for-byte into their original acceptance folders; every original `.test.ts` byte, fixture, tolerance and seeded property remains unchanged. Full drafts and originals are archived under `blind-redrafts/` and `migration-374/`, `migration-375/`, outside the declared test paths, avoiding duplicate active behavior tests.

The owner explicitly requested one PR. #2336 (#374) and #2337 (#375) are therefore superseded by **#2321 as the sole review/merge surface**. All 27 helper/evidence files from the two proposals match their consolidated copies byte-for-byte (`consolidation-proof.json`). The helper-adoption commit `57d96a3f2` precedes scheduling commit `63e11e81a`; independent blind drafting, unchanged behavioral tests and wrong-program-before-removal ordering are preserved.

This is an owner-approved packaging deviation from separate prerequisite merges, not an agent waiver of proof/approval. Review the redraft adoption and protected tooling in the single PR. No agent signed an approval.

## Every moved file rejects a real wrong program in parallel

- #374: compiled parent-span, stroke-scale and rank mutations, through real `deep-canvas-render`. All **3 files failed at behavior assertions**, 4 failed tests / 7 passed. Clean supplied binary: **11/11 passed**.
- #375: compiled padding, row alignment, grid flow, widest-text and binary-owner mutations, through real `deep-layout`, `deep-text` and real Cargo metadata. All **5 original files failed at behavior assertions**, 7 failed tests / 5 passed. Clean supplied binaries: **12/12 passed**.
- Commands used normal Vitest configuration, file parallelism and three workers. Report start/end intervals show every original file overlapped another. `migration-*/proof.json` names each assertion and observed wrong values. The reporter timestamps are now retained in `migration-374/parallel-intervals.json` and `migration-375/parallel-intervals.json`, with source-file digests, per-file failed names and recomputable overlap intervals (3 and 5 overlapping pairs respectively). Every original-file end precedes scheduling commit `63e11e81a`'s recorded time. The #375 record explicitly excludes the five duplicate draft rows; no test was rerun to produce these extracts.
- Wrong-program executions completed **before** removing either original folder from `alone`. #375's substring filter also ran the duplicate redraft copies in the temporary proof tree; only original-file results are counted. Neither active copy remains duplicated in this branch.
- Unit command file selection now includes all eight original files in its parallel block; neither folder is in timed/exclusive. #236 remains alone/exclusive, and timed/exclusive/slow/byHand entries are unchanged.
- No speed improvement is claimed from these correctness runs.

## Execution and missing readings

- Original candidate suites before redraft: #375 all 12 tests passed; #374 stroke/steps passed, but paint's cold build exceeded its unchanged 900-second hook, so seven paint checks were unrun. Retained as FAIL/INCONCLUSIVE, not red proof or a valid full timing comparison.
- Real unit-lane **before and after** commands were requested under timed grants with five-minute wait caps. Both ended `INCONCLUSIVE no grant`. Neither unit command ran and neither is an alone-block wall-time reading. AC4 remains **unrun**.
- `affected.mjs` for the two adopted helpers completed: **23 tests passed**, overall **FAIL**, 157 repository lint findings, 11 known failures. No WIDE or INCONCLUSIVE-prefixed line. These lints concern unchanged main rules/files; no baseline was edited.
- Earlier #375-redraft affected run: **12 tests passed**, overall FAIL, 156 lint findings / 11 known. Lifetime-path affected run: **6 tests passed**, 58 lint failures and **10 INCONCLUSIVE no-grant lint jobs**. No WIDE lines.
- Actual Spark was unavailable (`spark-ts` name resolution failed). The owner made Spark optional on 2026-11-12, so this no longer blocks #1123. Earlier Linux-arm64 container proof remains correctly labelled as Linux, not Spark.

## Additional gaps addressed

- Genuine excluded/skipped binary consumers now have selector-mutant proof; identical assertions reject copied wrong selectors.
- Signal tests first failed while Cargo survived. The new supervisor lives inside the lease boundary, forks outside the reclaimable wrapper group, watches original PID/start/state and IPC, stops its own Cargo group, and cleans the run root. Direct and real-CLI lease SIGTERM/SIGKILL tests passed; wrapper-SIGKILL and leader-exits-first cases passed. Last mechanism/selection/lifetime run: **14/14 passed**; latest helper-demand discovery run: **11/11 passed**.
- Helper discovery now follows selected named helper declarations. Scope-only metadata checks request no binary; #375 row/grid request only deep-layout. Regression tests first failed on unrelated helper builds, then passed unchanged.
- Static review still flags broader process-lifetime hardening not fully proven here: exact completion barrier before immediate bay reuse, process-group identity reuse, process enumeration failure during cleanup, and per-shard ancestor cleanup. Do not present the implemented signal cases as proof of every lifetime interleaving.

**Remaining closure gates:** consolidated redraft/tooling approval in #2321, actual full unit before/after Mac reading, affected verification free of unexplained failures, and required human-signed tooling approval. Spark is optional by the owner's explicit 2026-11-12 decision. Until those exist, #2321 remains draft/Part of #1123; the issue cannot truthfully be closed.
