# #2074 — setup failures are recorded before the lane ends

## Requirement → change → proof

| Requirement | Change | Proof |
| --- | --- | --- |
| AC1: snapshot error gives BLOCKED, original cause, chat line and `deep_status` | `StopJudging.runClaim` catches the lane's rejection in the lane itself and awaits recording BLOCKED with owner `you` | Frozen `tests/acceptance/2074/lane-failure.test.ts`, AC1: fails on base INCONCLUSIVE; passes unchanged after |
| Scope: open item states what closes it | Same catch records an item naming the cause, owner, and resolving the cause then rerunning checks | AC1 asserts actual `open_item.opened` on the claim's task and a closure action; after passes |
| AC2: monitor watch end with no stop to hold | Same `runClaim` catch, independent of a held reply | Frozen AC2 feeds Monitor/TaskStop through the real spool/parser, one Stop only: base INCONCLUSIVE; after BLOCKED |
| AC3: over-budget snapshot remains INCONCLUSIVE with untracked count | Existing typed `OverBudget` branch left unchanged | Frozen AC3: INCONCLUSIVE and 37 untracked files before and after, in actual stop reply too |
| Scope: checkout failure | Same lane recovery | Frozen checkout case plus approved update to `checks-not-started.test.ts`: base INCONCLUSIVE, after BLOCKED retaining copy error and owner |
| Check setup failing alongside snapshot cannot kill the core | `GateRunner.stop` awaits snapshot and install reads in one `Promise.all` | Subprocess `setup-failure-install.test.ts` fails on unhandled JSON rejection before, then proves survival, BLOCKED and open item |
| Error evidence contains no held/pattern-shaped credentials; long error retains owner/remedy | Scrub the complete cause before bounding it to leave room for required context | `setup-failure-safety.test.ts`: secret canaries and 20,000-character error fail before; pass unchanged after |
| An old slow run is not evidence that a newer failure recovered | Only the task's newest claim settles verdict-derived open items | Safety regression holds A's real slow check, fails B's snapshot, then ends A; B's item stays open after fix |
| Existing checks and held-stop/monitor behavior | No result/check/decision rules changed | Focused gate/stop/monitor tests: 42 passed; final focused selection including new safety tests: 37 passed |

The bug belongs in the existing hub done-gate orchestration: an extension cannot reliably finish a core lane whose setup threw, or ensure its held reply reads the committed verdict. No new dependency, config key, flag, package export, schema or production test hook was added. `claim-refusal.ts` shares the existing event writer between the validity/snapshot-budget refusal path and the setup-failure path, keeping `stop-judging.ts` inside its unchanged size limit.

## Proof and isolation

Original base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. A separate blind drafting job saw the issue, design and clean base only. Its frozen suite is copied byte-for-byte (SHA-256 `4227c9f789037004a30ea41baf4b271ade01adf56bf24c8795d90c9c8d1b1d85`). The implementer did not change it. Its required base run reported **3 failed, 1 passed**, all intended assertions; the issue predates a partial INCONCLUSIVE fallback, so the observed base is not reported as having no verdict.

The user approved replacing the old checkout regression's INCONCLUSIVE expectation with BLOCKED, retaining the cause assertion and adding owner. It failed first for the expected reason (`checkout-before.txt`). The four review regressions likewise failed first (`review-before.txt`) and passed unchanged after their fixes. No commits were made during the test-first work.

Implementation verification used an isolated base checkout containing only #2074 changes, not the shared workspace's unrelated modifications. Normal hub TypeScript build passed. Test typecheck passed with the repository's strict options (temporary external tsconfig). The full frozen acceptance suite and approved checkout regression passed after the first fix; the final run, after safety corrections, reported **6 files / 37 tests passed**, no skipped tests (`final-tests.txt`). The earlier four-file scheduling/stop/monitor regression run passed **42 tests** (`regressions-after.txt`). Overlapping tests are not added together as unique coverage.

Commands:

```sh
node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json
node scripts/affected.mjs tests/acceptance/2074/lane-failure.test.ts \
  packages/hub/test/checks-not-started.test.ts \
  packages/hub/test/setup-failure-safety.test.ts \
  packages/hub/test/setup-failure-install.test.ts \
  packages/hub/test/gate-runner.test.ts packages/hub/test/codex-files.test.ts
node scripts/affected.mjs packages/hub/test/codex-files.test.ts \
  packages/hub/test/gate-runner.test.ts packages/hub/test/gate-stop.test.ts \
  packages/hub/test/monitor-ends.test.ts
```

## Check limits / deviations

- **Overall repository verification is FAIL, not PASS.** Final `affected.mjs`: **172 new-to-known-failures findings, 11 already listed, 0 inconclusive/blocked, 0 listed skips, 37 passed** (`affected-final.txt`). The base acceptance run reported 175 new / 11 known / 1 passed, including its three expected acceptance failures. Comparing global findings gives the same set apart from one `canvas-closures` diagnostic's wording. Findings concern existing dependency declarations, vendor checks, canvas/slot/mapping lints, record-reader lint and stale known-failure entries, not #2074. No baseline/check was weakened to conceal them. This is not a clean global-preflight claim.
- These explicit focused selections emitted **no WIDE or INCONCLUSIVE lines**. A production-path `--list` expands through the hub to hundreds of process-based tests, timed/slow/manual cases and `deep-app`; that entire selection and release preflight were not run. Those unrun checks remain unproven.
- The first blind attempt was abandoned during fixture/toolchain preparation, before a frozen suite or usable behavioral proof; its scratch output is not evidence. A fresh job received only the original permitted inputs and prepared the final suite. No altered runner/metadata stand-in from the abandoned scratch work is used in proof. Final runners/lints are unchanged.
- Initial workspace/hook builds waited for shared build grants and were stopped by their own PIDs. Actual package builds and the hook binary were supplied from an identical clean base; hub source was then built normally for each implementation change. Final hook binary SHA-256: `2e9396b0a8a1998dcc3359d14773e6f81aef4a4ee276a03a51e8b76239d7b467`.
- The new review-test fixture initially omitted the core clock; that setup failure proved nothing. Only the fixture was corrected before the required behavioral red run. An ad-hoc typecheck without repository options failed in existing code; the corrected invocation with repository options passed.
- One task-owned `deep lease` wrapper stayed alive after its test runner's completed red report; it was stopped by PID to release its test slot. No other session's process was stopped. Global lint jobs ran to completion normally.
- The budget twin proves classification/count preservation, not the reference-machine wall-clock budget. No timing, live-agent or full release check is claimed.

## Current-main integration

The issue-only patch was separately applied to main `fcd8c385246acdac30011b43dd22e8d3e5dc2f58`. The same six focused files passed **37/37**, no skips (`current-main-tests.txt`), and the hub and CLI builds passed. The workspace build initially lacked the newly added `@deepbuild/briefs` local link in the copied `node_modules`; restoring that local link and rebuilding the affected hub and CLI resolved the setup errors. No package manifest or lockfile changed.

On that newer main, unchanged `affected.mjs` reported **FAIL: 153 new-to-baseline, 42 known, 0 inconclusive/blocked, 0 listed skips, 37 passed** (`affected-current-main.txt`). The earlier summary incorrectly said none named this change: `stop-judging.ts` had grown from 1,500 to 1,508 lines. That PR blocker is corrected below; this historical run is kept, not rewritten.

## PR closeout: paired base and final candidate

Both sides are pinned to main `a50d923232d01de486bdaae9e7680e15e9c3f5b1`. The independent acceptance files are unchanged. The base's hub was rebuilt from its own unmodified source before running; final candidate hub build exits 0 (`pr-build.txt`).

- **Size regression fixed:** the unchanged size guard failed at 1,508 lines before extraction (`size-before.txt`). The existing verdict event writer now lives in the 14-line `claim-refusal.ts`, with two current callers. `stop-judging.ts` is 1,500 lines again. Base and fixed candidate have the same 51 unrelated size findings (`size-base.txt`, `size-after.txt`); neither the guard nor its ceilings changed.
- **Fails on the PR base:** 3 acceptance cases fail on their BLOCKED/owner/chat/status/open-item assertions; the OverBudget twin passes (`pr-base-tests.txt`). Base `affected.mjs`: 155 new-to-baseline findings, 42 known, 1 pass, no inconclusive/blocked or skips (`affected-pr-base.txt`).
- **Passes after:** 7 selected files, **39 tests pass**, no skips (`pr-final-tests.txt`). This includes the four frozen acceptance cases, approved checkout regression, safety regressions, gate scheduling, check-start failure, and both existing validity-floor cases after the event-writer extraction.
- **Global classification is still FAIL, not PASS:** candidate `affected.mjs` reports 152 new-to-baseline findings, 45 known, 39 passed, no inconclusive/blocked or skips (`affected-pr-final.txt`). A counted comparison excluding only the three expected base acceptance failures finds **no new unlisted candidate failure**. Its three additional known Rust findings are in unchanged `deep-text` code (`paired-result.txt`). Existing conformance failures are tracked by #2146, closure/reader failures by #2148, and lapsed failure entries by #1873; #2444 tracks the full-preflight problem. No baseline, check, assertion or frozen test was altered to suppress them.
- **Unrun coverage remains explicit:** focused runs emitted no WIDE or INCONCLUSIVE lines. Production-path `--list` reports two WIDE files: `tests/acceptance/1906/exit/children-at-exit.test.ts` and `tests/acceptance/1906/exit/sync-children-at-exit.test.ts`. Its full selection (367 parallel Vitest files, 14 Node files, 649 alone files, 67 timed files, 30 slow files, `deep-app` and 73 manual entries) was not run. Neither full release nor live-agent/timing proof is claimed.
- **Machine waits:** the first base-build command timed out while waiting for its grant without executing a build; the background invocation subsequently built successfully. Paired lint work waited behind other sessions' builds, without bypassing the throttle or stopping their processes. The last newer-main commit while this pair ran is outside this patch's changed files; no run on that later merge is claimed.

The shared worktree retains all unrelated work. The single-issue branch is `fix/2074-setup-failures-blocked`; PR #2548 holds it. Handwritten proof notes take delivery over the approximately 400-line guideline; production changes are 36 added/20 removed lines, and frozen acceptance plus focused review regressions total 292 lines. Captured output is not handwritten code. Splitting would separate the issue's proof from its fix. The PR can say `Closes #2074` because all three acceptance criteria are proven; it must not claim a clean global preflight or merge automatically.

## Integration after #2075 landed on main

Main `291d63af61aa29e8221c135c51b7df94062d1e4c` (merge of #2550 for #2075) changed the same gate runner and stop-reply handoff. It merged cleanly into #2548; #2074's production delta is unchanged relative to that main. No acceptance test, existing test, runner, ceiling or baseline was edited for this integration.

- Rebuilt every TypeScript workspace and `cargo build --locked --offline -p deep-hook`: exit 0 (`integration-2075-build.txt`).
- Ran the 7-file #2074 selection above plus `packages/hub/test/{gate-queue,late-fast-lane,gate-stop,monitor-ends}.test.ts` and `tests/acceptance/2075/slow-checks.test.ts` through unchanged `node scripts/affected.mjs`: **12 files, 68 tests passed, no skips** (`integration-2075-tests.txt`). This verifies #2074's recorded setup failure together with #2075's late fast-lane completion, green/FAIL/INVALID handoff, loop/background deadlines, and cancellation at a new prompt.
- Overall affected result remains **FAIL: 167 new-to-baseline, 45 known, 0 inconclusive/blocked, 0 skips, 68 passed** (`integration-2075-affected.txt`). No finding names a #2074-changed code/test file. The new merged main has additional global dependency, canvas and size findings; the prior paired comparison is still historical evidence on its stated base, not a claim that this later main was rerun without the patch. No WIDE or INCONCLUSIVE line was emitted by this focused run. The broader production-path, timed, manual/live and release checks remain unrun.
- The first rebuild exited 134 before tests: Homebrew Node's `@rpath/libnode.137.dylib` resolution named another test's temporary hard link (`integration-2075-environment-failure.txt`). No test result was claimed from it. Verification then used a task-owned copy of the installed, self-contained Node **v24.22.0** interpreter with its SHA-256 recorded in the build log, and retained the machine throttle. This corrected the runtime environment without changing code/checks. No other session's process was stopped.
- `stop-judging.ts` remains 1,500 lines. The frozen #2074 acceptance file still hashes to `4227c9f789037004a30ea41baf4b271ade01adf56bf24c8795d90c9c8d1b1d85`.
