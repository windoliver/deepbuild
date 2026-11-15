## Issue

Closes #2074

A claim whose snapshot, checkout or check setup fails now records **BLOCKED** with its cause and owner `you` before its lane completes. Its open item names how to recover; the held-stop reply and `deep_status` see the recorded verdict. The same path handles monitor-watch completion without a held stop. Typed snapshot-budget overruns remain **INCONCLUSIVE**, retaining the untracked-file count.

Also covers parallel dependency-read rejection, error redaction/length bounds, and an older claim incorrectly closing a newer setup-failure item. The refusal event writer is shared by two existing paths in `claim-refusal.ts`, keeping `stop-judging.ts` at its unchanged 1,500-line limit. No public API, dependency, schema, setting or check baseline change.

## Proof

Both proof sides are pinned to main `a50d923232d01de486bdaae9e7680e15e9c3f5b1`.

- **Fails before:** `node scripts/affected.mjs tests/acceptance/2074/lane-failure.test.ts` — 3 intended failures, 1 OverBudget twin pass. The base has a partial INCONCLUSIVE fallback, rather than no verdict; failures name the affected claim. [Base output](reports/2074/pr-base-tests.txt).
- **Passes after:** `node scripts/affected.mjs tests/acceptance/2074/lane-failure.test.ts packages/hub/test/checks-not-started.test.ts packages/hub/test/setup-failure-safety.test.ts packages/hub/test/setup-failure-install.test.ts packages/hub/test/floor.test.ts packages/hub/test/codex-files.test.ts packages/hub/test/gate-runner.test.ts` — **39/39 pass**, no skips. Hub build passes. [Final test output](reports/2074/pr-final-tests.txt).
- **Evidence:** real recorded verdict/open item, actual stop chat reply, session-bound MCP status and monitor/TaskStop spool events; no UI rendering changed. Independent acceptance file remains byte-identical. The user approved changing the pre-existing checkout INCONCLUSIVE expectation to BLOCKED while retaining its cause assertion.
- **Size:** old candidate failed at 1,508 lines; final is 1,500. No guard or ceiling change. [Mapping and detailed checks](reports/2074/README.md).

## Still open

No #2074 acceptance criterion remains unproven. **Global repository checks are not green:** base affected reports 155 new-to-baseline / 42 known / 1 pass; candidate reports 152 new-to-baseline / 45 known / 39 passes. The counted comparison, excluding the three expected base acceptance failures, has **no new unlisted candidate failure**; the three additional known findings are unchanged Rust code. [Paired result](reports/2074/paired-result.txt). Existing issues include #2146, #2148, #1873 and #2444. No failing check or baseline was weakened.

Focused runs emitted no WIDE or INCONCLUSIVE lines. The production-path selection reports two unrun WIDE suites (`tests/acceptance/1906/exit/{children-at-exit,sync-children-at-exit}.test.ts`); its other broad process-reachable suites, manual/live-agent, timed and release preflight were not run. This PR does not claim a clean global preflight or automatic merge readiness.
