# #1123: run-private binaries — partial implementation

**Update:** two folders now have blind-redraft and per-file parallel wrong-program proof; see [migration-update.md](migration-update.md). The original stage's results below are historical. Full unit readings and actual Spark/approval gates remain open.

Base: `092754bb1` (current main when this branch was created). **Part of #1123, not Closes.**

## Requirement → change → proof

| Requirement | Implementation | Evidence / verdict |
| --- | --- | --- |
| Base and change execute their own binaries | Every before-lane copy/use builds into a fresh private final-artifact directory; compiler intermediates remain at that checkout's fixed `target/`. | Six blind mechanism checks: four expected assertion failures on current main, six passes on the change. The before fixture reports the base binary failed at its assertion. |
| Shell `DEEP_BIN_DIR` ignored; explicit childEnv value survives | Drop inherited key before merging extra; lanes and affected supply their own snapshot. | Shell/explicit cases pass; identical explicit-value assertion rejects a delete-after-merge wrong program. |
| Private snapshot survives concurrent Cargo rewrites | Cargo 1.99.1 publishes final artifacts privately using `--target-dir`, with `build.build-dir` retaining fixed-path intermediates. Copies never link to mutable target executables. | Approved blind capture redraft: all three cases pass on Mac and Linux arm64; unchanged lanes case rejects current main with `RUN_PRIVATE_ORIGIN`, after real own/foreign builds ran. |
| Scoped, once-per-run build | Discover actual environment reads/execution in each test/helper closure; ask Vitest for its selected files; don't build skipped/excluded/unrelated binaries. Each checkout/shard gets one snapshot. | Existing freshness/target-poisoning cases plus regressions for skipped lanes, excludes, root-relative Node files, mixed selections, absent workspace, and failed build. Required missing workspace/build prevents consumers from starting. Unit Node discovery now requests no application binary. |
| Safe cleanup and existing shard ownership | A detached IPC watcher removes the creating run's private folder after exit, including SIGKILL. Released shard handles are cleared before outer cleanup. | SIGTERM/SIGKILL tests failed before, passed unchanged after. Replacement-shard-lock test failed before, then passed unchanged; no second release may remove another run's lock. |
| Eligible folders move only after wrong-program parallel proof | #374 and #375 helpers adopted byte-for-byte from separate blind drafts, and those two folders leave alone after wrong-program evidence; all eight behavior files unchanged. | **Proof complete for these two proposed moves**: 23 clean tests pass; every file fails at an issue assertion in overlapping parallel runs. Prerequisite redraft proposals #2336/#2337 must merge first. See migration-update.md. No speedup claimed. |
| Alone-block before/after wall time reading | No fabricated reading or threshold. | **OPEN / UNRUN.** Actual full unit before/after on one source commit has not completed. Audit gives the required recipe. |

## Independent tests and approved dispute

`tests/acceptance/1123/` was drafted from the issue/design/base before the implementation. Its original base log is retained. The first capture draft guessed an artifact location and failed setup on two paths after private final-artifact publication. The single fresh blind redraft saw only original inputs; it passed all three paths while the first draft failed. The user's continuation on the presented adoption question authorized adoption. The active redraft is `tests/acceptance/1123/capture-redraft/`; the first draft is preserved byte-for-byte as `capture-first-draft.mjs`, outside the active test set, with its output. No acceptance assertion was edited.

The redraft was also run unchanged against current main. Its lanes case observed the foreign version and failed at the required `RUN_PRIVATE_ORIGIN` assertion; this closes the prior red-proof gap. Source provenance is tested through real deep-hook/Cargo, not a fake binary report.

## Checks actually run

- Current-main mechanism: **4 expected failures, 2 passes**, no skips.
- Current-main capture redraft, lanes case: **expected assertion failure** on foreign executable origin.
- Mac mechanism/capture/initial regressions: **17/17 passed**, no skips.
- Final Mac corrections (mechanism, demand, error handling, selection/lifetime and shard release): **14/14 passed**, no skips.
- Final demand/selection/lifetime checks: **10/10 passed**, no skips.
- Final import compatibility correction: two existing checks (`tests/preflight.test.mjs`'s declared-path listing and #1113's non-test lane) failed on the eager helper import, then passed unchanged after lazy loading. Six binary integration checks passed afterward.
- `npm run build --workspaces`: **passed**. Dependencies were copied into an isolated node_modules from a checkout with byte-identical package-lock, with workspace links recreated here; the earlier npm-ci attempt never started because its build grant was queued. No lock/package change.
- Linux aarch64 container, Node 24.22.0 / Rust 1.99.1: **17/17 passed** after installing the missing Cargo dependency cache. First run: 14 passes, 3 BLOCKED fixture-setup failures because offline Cargo lacked `ring`; retained, not treated as behavioral failures. Restarting the container also repeated the 14 earlier checks; that unnecessary repeat is disclosed. Linux container evidence is **not Spark evidence**. The actual configured `spark-ts` host does not resolve.
- `node scripts/affected.mjs tests/acceptance/1123/ tests/proof-binaries-gaps.test.mjs tests/proof-binaries-scope.test.mjs tests/proof-binaries-selection.test.mjs tests/proof-binaries.test.mjs`: completed, **17 tests passed; overall FAIL**, 152 new lint findings, 11 known failures, 2 BLOCKED results (unbuilt conformance/contracts output at that time). No WIDE or INCONCLUSIVE-prefixed lines. The lints concern unchanged main files/dependency rules/vendor records; no new #1123 path was named. Do not describe that as a passing affected run.
- Full affected selection for the four changed tooling files ran once after building workspaces. It selected parallel/sharded tests and left **27 timed files and 9 slow files unrun** without their flags. No WIDE line. At about five minutes the host load exceeded 300; only verified descendants of this run were stopped. **INCONCLUSIVE**, with partial failures and no full-run verdict. Unrun timed/slow files are not passes, and this was not retried as a full run.
- Syntax checks on all four changed scripts and scoped `git diff --check`: **passed**.

The redacted excerpts in this report directory retain the key check results. Full local logs are under `/tmp/deep-1123-close/`; that path is not portable PR evidence. The fixture's unrelated lint diagnostics never count as the fixture's overall PASS: only its consumer assertions are the mechanism proof.

## Remaining gates

1. Merge/approve the two separately drafted redraft proposals #2336/#2337 before the already-proven #374/#375 scheduling changes land.
2. Actual same-source-commit unit-lane before/after alone-block wall readings.
3. Actual Spark run (DNS/host access unavailable here); Docker is supplemental.
4. Full affected verification, including main failures and timed/slow omissions, remains non-PASS.
5. Human-signed approval of protected proof-tooling edits. No agent-created approval tag, allowlist edit or signature is supplied.
6. Signal cleanup during Cargo and through the real lease path now has red/green proof; broader bay-reuse/group-identity/failed-enumeration interleavings remain unproven (migration-update.md).
7. Genuine executed-binary consumers now prove exclusion/skipped-lane behavior against selector mutants, without editing the earlier tests. Named helper scoping has additional passing regressions.

The PR is deliberately a draft and says **Part of #1123**. The implementation is about 180 meaningful added/changed lines, but independent real-process fixtures, regression proof and the retained disputed draft take the total above the approximate 400-line target. Splitting the three tightly coupled runner entry paths would leave inconsistent binary provenance; folder migrations remain separate jobs. No product/core change, dependency, public option, CI workflow, test waiver, or acceptance-criterion edit is included.
