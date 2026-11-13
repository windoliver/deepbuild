# #2072: approval belongs to the held call

These tests exercise `deep-actions` through a real hub, answer its ask with
`deep inbox answer`, and inspect the hub's events and the plug-in's handler counts.
They reuse #363's sandboxed stocks fixture; its send handler counts calls but
sends nothing to an outside service.

## Requirements and observations

| Requirement | Test and observation |
| --- | --- |
| AC1: approving input A must not authorize B under the same request ID | `held-action.test.ts`, AC1: refusal names the request ID; B produces no handler run, event or second ask; A then enters once. |
| AC2: approval must not authorize another change/send action | `held-action.test.ts`, AC2: send → change and change → send, with no execution or writes. The first case also checks the original send still runs. |
| AC3: a 2,000-character input is marked as cut, with its length | `held-action.test.ts`, AC3: the recorded question names the action, keeps the input's start, omits its tail, and states the length and cut. |
| Scope: bind the whole input, not its preview or length | `digest-binding.test.ts`: equal first 500 characters and length, different tail; the changed input is refused and the original runs. |
| Scope: bind the plug-in version | `digest-binding.test.ts`: approval at 1.0.0 cannot run 2.0.0; restoring 1.0.0 preserves the original approval. |
| Preserve equivalent JSON input | `digest-binding.test.ts`: formatting alone does not change the input that was approved. |

The AC1 and AC2 failure messages include the wrong retry's reply and recorded
input or action. Those must show the wrong retries actually running on the merge
base; a setup error or an unrun check is not that proof.

## Provenance

Two independent jobs drafted the test files from issue #2072, the design and an
archive of base commit `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, before any
production edit. Their inputs contained no fix or working-session transcript.
The second job covered scope requirements without reading the first test file.

The test bytes remain unchanged:

```text
21c6a60c0387032bc552a88adbe4d1a9df996c0ccf4c1e56a7d53cf61e8018b5  held-action.test.ts
871d30ad5f465fb64167ee7f963dada850e1e6bc197eb8e4fda446f723e91433  digest-binding.test.ts
```

The PR starts from `e63447bea`, whose held-action implementation and reused #363
fixtures are unchanged from the drafting base. A test defect goes to a blind
redraft under AGENTS.md, never an implementation-side assertion or fixture edit.

## Run from the repository root

Use the repository's pinned Node and Rust toolchains, available on `PATH`, and
installed dependencies (`npm ci` when needed). Build the workspace before testing:

```sh
node scripts/throttle.mjs build --wait 30 -- scripts/lease npm run build --workspaces
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked -p deep-hook
```

On an unchanged merge-base checkout with these tests overlaid, capture the
baseline before editing production code:

```sh
node scripts/throttle.mjs test --wait 30 -- scripts/lease \
  node node_modules/vitest/vitest.mjs run \
  tests/acceptance/2072/held-action.test.ts \
  tests/acceptance/2072/digest-binding.test.ts \
  --no-file-parallelism --reporter=verbose
```

After the fix, use the affected selector rather than a neighbouring whole suite:

```sh
node scripts/affected.mjs \
  packages/hub/src/mcp-operations.ts \
  packages/hub/src/hub-control.ts \
  tests/acceptance/2072/held-action.test.ts \
  tests/acceptance/2072/digest-binding.test.ts \
  tests/acceptance/2072/redraft/retry.test.ts
```

Use `--list` to inspect selection without running it. From the repository root,
Vitest retains the repository's setup and process cleanup; do not change its root
to this test folder. A throttle timeout runs no test and proves no behavior.

## Final proof and blind redraft

All **11 acceptance tests pass unchanged** after the production fix. The original
files fail on the merge base (6 failed, 1 passed). The digest-only intermediate
change left two total-ledger-count assertions failing because answer-related
`session.state` / `row.set` updates arrived later. The final change waits for
those existing state updates before acknowledging the answer, so the original
assertions now pass too. No test was edited, skipped or weakened.

`redraft/` is a fresh independent draft from the original issue, design and base,
without the work, first draft or dispute. Its 4 tests fail on the base and pass on
the fix, unchanged; its typecheck also passes. It never replaced the first draft,
and no acceptance dispute remains because both drafts pass.

[The proof report](../../../reports/2072/README.md) links all before/after output,
the intermediate failure and its correction, 13 passing answer/action regression
tests, the scheduling deviation, inherited lint failures, and the broad affected
run's INCONCLUSIVE status. Every #2072 acceptance criterion is proven; broader
unrun checks are not represented as PASS.
