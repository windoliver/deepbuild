# #2084: held core replies retain the settled reply

## Criterion → change → proof

| Criterion | Proof |
|---|---|
| `#2084.2c4c3709`: both original #1015 files pass unchanged | Blind `closure/closure.test.ts` pins their bytes and runs both real files. Both fail on base `b9131dbd9`, then all four of their tests pass on the fix. `trace.log`: PASS before at the test's assertion. |
| `#2084.ef9a3ee6`: two changed sessions; first heavy call after the second's prompt is leased and carries its sibling notice | Blind `closure/held-reply.test.ts` observes the returned rewrite, live `cpu.slot`, notice in the same reply and recorded delivery. Base fails at missing rewrite; fix passes. `main-held-tagged.log`, `candidate-tests.log`, `trace.log`. The original blind case remains unchanged too. |
| `#2084.76e6811e`: the two failures are listed while they fail | Blind closure test reads the actual results and exact known-failure IDs: failing+unlisted fails on base; fixed+unlisted passes. No stale failure exemptions remain. `trace.log`: PASS before at its assertion. |
| Scope: one denial for an adapter that cannot rewrite | Codex scope case passes on the fix and fails at its assertion on the independently drafted `codex-claims-rewrite` twin. `trace.log`. The original blind Codex case also verifies that retrying the leased form is allowed. |
| Preserve other settled output | `hook-replies.test.ts` holds rewrite/deadline, scoped rule, wait line and stderr together with core context/message; existing wait and scoped-rule regressions pass. `closing-tests.log`. |

`node scripts/proof.mjs trace` reports:

> PASS trace: Closes #2084: each of its 3 criteria has a tagged test that ran, passed and failed on a wrong program

`candidate-guard.log` is the edit guard's PASS. `remaining-proof-lanes.log` records lifecycle/crash/replay as not applicable, not executed passes. Hashes are in `hashes.txt`.

## What changed

The socket passes `ruled` through `coreReply`; no core output returns that settled reply rather than an empty one. The reply formatter starts from settled stdout, retains its rewrite, merges context/chat messages and preserves stderr and denials. Formatting was extracted into `hook-replies.ts`, including the existing heavy formatter unchanged, to take the current `server.ts` from 1,565 to 1,491 lines without raising any ceiling. This is the hub's socket composition, which an extension cannot repair after its reply is dropped.

Only the issue's changes are on the branch. Existing work in the original checkout was not staged. No test, expected value, timeout, golden or check was edited to pass; neither `scripts/lanes.mjs` nor `scripts/known-failures.json` changes in this PR. The earlier local scheduling edit was not adopted: the added suite passes in the default parallel block, and the before/trace runner runs files sequentially. The independent draft READMEs' scheduling recommendations are retained as written, not silently treated as implemented.

## Checks and baseline findings

- Clean workspace build, fixed hub build, hub typecheck and acceptance-folder typecheck: exit 0. A copied old node_modules initially missed the new `briefs` workspace; a clean lockfile install corrected that setup, with no package or lockfile edits.
- `closing-tests.log`: 10/10 selected tests passed in the affected runner; the wrapper executes the unchanged four #1015 cases as well.
- `closing-affected.log`: **FAIL overall**, 151 findings absent from the known baseline, 42 listed baseline findings, 10 tests passed. The 151 lints also fail on the untouched base. `lint-comparison.json` normalizes one interleaved log line and shows no introduced lint, with the server's size finding resolved. No exemptions were added for these unrelated findings.
- `packages/hub/test/extensions.test.ts`: both cases fail before reaching the replies with `the hub wasn't ready within 10 s` on both base and candidate, after the required hook was built. `main-extensions-built.log`, `candidate-extensions.log`. Earlier runs lacked deep-hook at the extension test's start; those results are invalid as behavior comparisons and remain visible in `base-tests.log` and `candidate-tests.log`.
- The explicit-path affected runs emitted no WIDE or INCONCLUSIVE lines. Their failures are not relabelled PASS. Source-based selection is much broader; the entire hub/app selection, timed budgets, release preflight and full mutation lane were not run. They are not required by this non-timed issue's criteria and are not claimed as passed.
- Build/test jobs used the machine throttle. The outer lease reports no installed development hub; the fixture hubs grant the actual command leases asserted by #1015/#2084. Homes and checkout paths in copied logs are redacted.

## Proof authorship and size

The first blind job used base `1c4d1f0e2`; the closure job and wrong-program job used `b9131dbd9`, only the live issue, design and archived base, never this implementation. All files were copied unchanged. The twin's additional two type files are byte-for-byte base copies (the generated one retains its Apache notice), needed to typecheck the overlay in the test tree; the only wrong behavior is Codex claiming it can rewrite.

The PR exceeds the roughly 400-line guideline because it retains the frozen first draft, adds independently authored tagged closure proof, and carries a 522-line source-overlay twin (338 lines are unchanged type dependencies). The actual production change is reply composition plus a small mechanical extraction. Splitting away any of this proof would leave a closing PR without its before/trace evidence; no new API, option, dependency or runtime flag is introduced.

The saved first trace is at candidate `76ce65580` on `b9131dbd9`. After a clean merge of newer main `fcd8c3852`, `node scripts/proof.mjs guard trace lifecycle crash replay` passed again at merge `503f803de`: guard checks all three commits, all four tagged cases pass and fail at assertions on base or their twin, and all three criteria pass trace. See `merged-proof.log` (exit 0). No lifecycle/crash/replay inputs changed, so those lanes correctly ran no cases. There is no claim that the repository-wide preflight is green.
