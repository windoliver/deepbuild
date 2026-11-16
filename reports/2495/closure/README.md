# #2495 closure: criterion proof, not a release-wide PASS

Tested integration: `7c35ffb27727778262ee91ee1a866e86e13f4d89`, merge base `9c5b755ef5e0ae25416df7620c48ccb67ecbf1e0`. No production change was needed in this closure round. All earlier acceptance tests, #112/#1108 files and check/baseline files remain unchanged. `suites.sha256` verifies all 18 files of the two suites against this base.

## Criterion → result

| Criterion | Proof |
|---|---|
| `#2495.f43599c5`: after a run the store holds report bytes and its printed handle resolves | Original acceptance and blind supplement fail on the **exact current merge base** for the missing handle: `base-results.json`, 5/5 assertion failures, no setup failures/skips. On the integration the original 3/3 and supplemental 2/2 pass. The earlier byte-exact store inventories/report files remain under `../`. |
| `#2495.9f9da789`: local-first widening accepts adopt and refuses other outcomes by name | Original adopting and regressing runs pass unchanged; new independent supplement covers the real command's **INCONCLUSIVE** result, reading directly from the hub-written store after hub shutdown. Its widening is refused with INCONCLUSIVE in the reason; an adopting control applies. `head-results.json`: 2/2 pass, zero skips. The control is synthetic and does not replace the original adopting-run assertion. |
| `#2495.69b5913d`: #112 and #1108 suites pass unchanged | Repository-scheduled automated regression files: #112 19/19, #1108 4/4, with original helpers/fixtures/expected values byte-identical to base. The runner's existing by-hand classification for #112's separate live-budget test is retained, not introduced here. |

Other regression protection: transport 2/2, lazy-loading 5/5, gate/plan 2/2, unavailable-hub 1/1 and #821 config-eval lane 4/4. **42 distinct passing tests** in this closure round: 40 from the focused affected invocation, plus 2 new supplemental tests. Typecheck of the whole #2495 acceptance folder passes. Both base and integration workspace/hook builds pass. The edit guard passes for the two implementation/integration commits (`guard.txt`); new supplemental files remove or weaken nothing.

## Proof author and surfaces

The supplemental author saw only issue/design/base, never the implementation or original draft. It produced `tests/acceptance/2495/closure/report-handle.test.ts` and its README, now kept unchanged (`blind-author.txt`). It enters through the real config-eval command, real hub and public record/evidence entries. Existing #1108's stand-in external CLI and fixture model are reused unchanged. Runtime criterion IDs are recorded in the JSON reporter; source-only trace discovery does not see those computed IDs. **No trace-lane PASS is claimed.** The issue-to-test mapping above is explicit, and AC3 reuses the existing suites instead of a duplicate wrapper.

## Why the previous closure blockers were over-scoped

The previous report conflated the issue's regression-suite criterion with rerunning #112's entire original live-eval milestone and with making all repository lints green.

- `scripts/lanes.mjs` already classifies `tests/acceptance/112/live.test.ts` as **by hand**, not part of its automated regression run. The original #112 PR [#810](https://github.com/windoliver/deepbuild/pull/810) explicitly recorded its live budget as INCONCLUSIVE and closed at the owner's request; #1108's merged PR [#1281](https://github.com/windoliver/deepbuild/pull/1281) likewise verified the automated suites with those live tests skipped. This fix does not change eval logic, launcher, comparison rule, tasks or model use. We preserve the established regression scope, not count an unrun live test as PASS.
- The live check remains **unrun**. This machine is Mac17,10/M5 Max, not either reference Mac named by that frozen test; it has no exported live input, no installed Codex judge and no archive ledger. No fake workload or altered machine identity was substituted. This is a disclosed inherited live-budget limitation, not a new storage criterion or a waived check.
- #2495 has no whole-repository lint, release, performance-budget or cross-platform criterion. Those runs can stay FAIL/unrun while the named issue behavior is proven. No check, known-failure entry or threshold is edited to obtain closure.

## Runner outcomes retained honestly

`affected.txt`: 40 tests passed, 175 unlisted lint findings, 45 listed known, zero inconclusive/blocked; overall **FAIL**, not a clean preflight. The new count reflects main's intervening unrelated changes. `inherited-path-comparison.json` verifies the named failing files against the exact base: 105 are identical; the sole changed named file is server.ts, whose flagged line count is **1525 on both sides**, with only the eval route added on its existing registry row. The earlier full failing-lint base comparison remains in `../lint-comparison.json`. No issue-owned test failed.

The two later affected attempts could not acquire a test/build grant within 30 minutes. Their INCONCLUSIVE lines are preserved in `no-grant-head.txt` (11 jobs/file states) and `no-grant-base.txt` (12). Nothing ran in those test blocks, so zero passes are claimed there. Once a slot became free, one queued, throttle-governed base/head run executed the frozen files: base exit 1 at five expected assertions; head exit 0 at both supplemental assertions. This was not a retry of a failed test: the prior tests never started. No other session's process or throttle setting was changed. No WIDE line was emitted in these focused runs.

Full source-selected graph, timed/slow checks, live-budget proof, Linux and release preflight remain unrun; root typecheck's existing test errors remain disclosed in `../workspace-types.txt`. This closure is **all three issue criteria proven within their established automated regression scope**, not a blanket repository PASS.

## Reproduce

Use self-contained Node 24.22.0 (the #1108 fixtures relocate their Node interpreter; Homebrew's relative libnode dylib does not relocate), with Rust on PATH. Run builds through `scripts/throttle.mjs build`, then:

- `node scripts/affected.mjs tests/acceptance/2495/report.test.ts tests/acceptance/112/{ci,eval,rule,widen,live}.test.ts tests/acceptance/1108/{chat,diverged,normalize,sandbox}.test.ts packages/hub/test/eval-report.test.ts packages/cli/test/loads.test.ts tests/config-eval.test.mjs tests/config-eval-storage.test.mjs tests/acceptance/821/config-eval.test.mjs`
- `node scripts/affected.mjs tests/acceptance/2495/closure/report-handle.test.ts`
- For the isolated base comparison: overlay only unchanged test files on the base, build its packages/hook, then run `vitest run tests/acceptance/2495 --reporter=json`; the same supplemental file on head passes.

The closure adds 155 frozen test lines for the missing INCONCLUSIVE/store-restart path. Together with independent acceptance/transport proof, handwritten code/tests exceed the 400-line guideline (~500); splitting that proof would leave this requested gap open. Captured outputs are not handwritten implementation.
