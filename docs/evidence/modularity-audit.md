# Modularity audit — partial implementation, not closed

## Latest completed proof

The machine queue cleared and the following checks actually ran under the repository throttle on Node 24.22.0:

- **PASS cold workspace build:** all 30 package `dist` directories were moved aside after acquiring a build grant, zero remained, and `npm run build --workspaces` exited 0. The ID repair no longer relies on stale generated files.
- **PASS changed-package builds and hub package typecheck.**
- **PASS 13 selected tests through `scripts/affected.mjs`:** ID cold loading and encoding, preserved replay hash, package boundaries, injected adapter capabilities (both directions), shared trust/cache revocation, real process observations, failed OS observations, missing runtime environment refusal, answer-record thread isolation, and stack-provider lifecycle routing.
- **Wrong-program proof:** separate adapter-ignore, split-trust-cache and always-gone-process variants each failed their corresponding regression. The real variants passed. Variants were task-local loader substitutions, not changes to production source or tests.
- **Before/after process fix:** the OS-read regression failed because `[]` was returned instead of unknown, then passed unchanged. Only `ESRCH` now proves absence; missing CPU samples break idle detection, and unreadable group observations leave the job stopping until supervisor cleanup proves its end.
- **Before/after environment API:** the missing-provider regression first failed because there was no runtime selection method. It now passes unchanged: selection of an absent environment refuses before any process starts. Trust/kit checks guard the added runtime surface. Installed-provider teardown and use by the running hub are still unfinished.

A second affected run reused existing coverage: #881 immediate revocation and symlink trust, asks continuation tests, wiki tests, and IDs. All **18 selected tests passed**; the aggregate remained FAIL on 38 new-baseline lint findings and 19 known findings. No acceptance tests were edited.

The first aggregate command completed in 70 seconds: **FAIL**, 38 new relative to the committed baseline, 16 known, 0 inconclusive/blocked, **13 passed**. The 38 remaining findings are repository lint findings outside this patch (acceptance-data scans, dependency/card declarations and canvas restrictions), not failing selected tests. No WIDE or INCONCLUSIVE line was emitted for this small selection. This is not a full affected-implementation or preflight pass.

### Current test correction request

The new installed-environment lifecycle test used `slotKits().find(...).reference`, which does not exist. Its run stopped at install with `Cannot read properties of undefined (reading 'up')`, before the intended lifecycle assertion. The proposed fixture-only correction is to import the public `cleanFills` helper and use `cleanFills(kit)[0]`. All startup, shutdown, disable, identity and no-duplicate-cleanup assertions stay unchanged. Approval is pending; the failing test is preserved, not skipped or weakened.

The historical sections below describe earlier checkpoints, not the current status of the cold-build and selected-test proofs.

## Further implementation progress — not yet verified

Work continued despite the resource queue:

- `packages/hub/src/answers.ts` now owns pending-answer queries, message formatting and delivery-outcome writes. The core supplies session exclusion and loop-input callbacks; it still owns hook scheduling and transcript acknowledgements. The extracted behavior keeps same-thread scoping and the existing delivery event versions. `packages/hub/test/answers.test.ts` exercises this boundary against the real record.
- `Stacks` now consumes a supplied `StackEnvironment` lifecycle for start, health and down. The core is the composition root that wires env-local. The stack-policy module has no runtime env-local import. `packages/hub/test/stack-provider.test.ts` covers this route with the shipped provider and a real supervisor. Installed-provider discovery/dispatch remains open; dependency inversion alone is not claimed as its completion.
- The supervisor now imports its shared liveness helper rather than keeping a second copy.
- Real-component regressions for injected adapter capabilities, shared trust and process readings are prepared. Separate failure regressions identify the absent environment runtime surface and unreadable process observations. Their expected failures have not yet run, so the planned behavior fixes were **not** applied.

Diff whitespace and syntax parsing of the changed TypeScript modules/tests passed. The queued hub build and process-failure reproduction each exhausted the documented 30-minute grant wait with exit 3. The dependent test job did not start. A conditional script required the expected assertion failure before applying the process behavior fix and correctly refused to apply it when the run was unexecuted.

No change in this continuation is represented as behaviorally verified. The original checkout remains untouched; no other session, throttle table or known-failure baseline was changed.

## Latest cold-workspace verification attempt — still blocked

The cold-workspace job was retried with the documented **30-minute build-grant wait**, in a persistent process instead of a short tool invocation. It exited **3**, `INCONCLUSIVE no grant: no build grant came within 30 min`. The cold-reset helper runs only after the grant, so this attempt moved no generated files and executed no build. Its follow-on mutation/affected checks did not start. A separate process-read regression waiter was cancelled by its own recorded PID while still waiting; that test was unrun.

Read-only inspection found both machine test grants occupied and timed requests pending. The pending timed requests prevent new top-level build/test grants by design. No other session was killed, no throttle state was edited, and no lease or check was bypassed. The job owners must finish or stop their work before this attempt can be verified here.

Prepared but **not verified** in this continuation:

- Real-component coverage for injected adapter capabilities in both directions, with a wrong program that ignores the callback.
- Shared project-trust cache coverage across the record and extension-host entries, including symlink approval, immediate revocation and refusal of untrusted writers; a separate-cache mutant is prepared.
- Real-child process-observation coverage and a boundary-failure regression for unknown OS observations. The latter is not yet reproduced, and no behavior fix for it has been applied.
- Removal of the supervisor's remaining duplicate liveness function in favor of the already shared helper. This refactor still needs the affected checks.

These tests are new regression files, not edits to acceptance criteria. Nothing in this section establishes that the broader audit is closed or that the PR is merge-ready.

## Current integration checkpoint

The branch has been reconciled with main at `0c153d7cd4dd167130f62fafc382114c47ed261a`. Six merge conflicts were resolved without changing acceptance tests or known-failure baselines. The extracted run service now carries main's durable journal recovery, `run.started@3` redaction/withheld fields, paid-run IDs, stand-in/host arguments, and gate-adjusted results. Retention preserves main's notice/series and reading evidence. Stack credential-mode plants and session-retention ownership are preserved.

Fresh checks on this integrated tree:

- Hub package TypeScript check: PASS.
- `npm run build --workspaces`, under the build throttle: PASS on the existing built tree. This does **not** establish cold-build correctness.
- Root typecheck: FAIL, including stale test interfaces; no test was changed to clear it.
- The small affected selection below: FAIL, 39 new relative to main's baseline, 16 known, 4 passed. The cold-ID test still fails. The other reports include repository lint/dependency findings; full implementation verification remains unrun.
- The first affected attempt ran no tests because the old built CLI lacked `deep lease`; after the workspace rebuild the updated wrapper executed the checks. No throttle/lease bypass was used.

### Approved cold-ID repair

The owner approved replacing the implementation-specific `record/src/ids.ts` filename assertion with equality to the public entry's resolved URL. That is the only change to `tests/record-ids.test.mjs`: its one-loaded-module assertion, exact encoding vectors, 1,000 seeded cases and uniqueness checks are unchanged. `tests/record-ids-cold.test.mjs` is unchanged in full.

IDs now have one plain-JavaScript implementation in `src/ids.js`, with `src/ids.d.ts` for TypeScript consumers. The public subpath resolves directly to that source module under both development and default conditions. Record and trust import the same subpath, so their emitted code needs neither a copied implementation nor `dist/ids.js`.

Fresh results for this repair (Node 24.22.0):

- Record package build: PASS.
- Through `scripts/affected.mjs`, both IDs tests, the replay-hash regression and both package-boundary tests reported PASS: five test results. The cold-package test installs under `node_modules` with no dist or database dependencies, so it also checks Node's installed-package behavior.
- The aggregate affected run was terminated by the command's 240-second limit while repository lint jobs were unfinished. No overall PASS, WIDE conclusion or completed aggregate result is claimed; the five test results are preserved independently in the runner reports.
- For a genuinely cold workspace build, all 30 generated package `dist` directories were moved aside. The machine throttle returned `INCONCLUSIVE no grant: no build grant came within 1 min`, exit 3; no build started. All 30 directories were restored without overwriting outputs. Thus the isolated cold-ID behavior is proven, but a full cold workspace build remains unrun.
- Diff check: PASS. No acceptance tests, baseline entries, timing limits or throttle policies were edited.

## Original checkpoint scope and base

This draft preserves the TypeScript package audit requested in the conversation. It does not claim a package-by-package Rust audit or complete architecture remediation.

- Audited base: `fd952b1c6f31`.
- Remote main observed during PR preparation: `79d98cbc200df73472c7aba3511ed48c39afaf75`, 601 commits ahead of that base. Integration with current main is unverified.
- The original working checkout and its pre-existing evidence scrubber, event serialization, cursor-save and append-probe performance edits are excluded from this PR and left untouched there.
- No acceptance tests, twins, golden files or known-failure baselines were changed.

## Requirement → change → proof

| Requirement | Change | Proof and remaining limit |
|---|---|---|
| Reduce the hub core's responsibilities | Move stacks, run lifecycle/journal, replica sessions and retention into `stacks.ts`, `runs.ts`, `drive.ts` and `retention.ts`; preserve shutdown order | Changed hub/CLI packages compile. Full lifecycle verification on this isolated PR tree has not run. Hook and answer-delivery responsibilities remain in `core.ts`. |
| Allow environment replacement | Document the actual limitation rather than calling it complete | **OPEN:** the hub still invokes env-local directly; registration/kit support is not runtime provider routing. No release allow-list or trust bypass was added. |
| Use the hub's adapter capabilities in asks | Inject the error-turn capability callback while retaining standalone callers' shipped default | `tests/asks-adapter-capability.test.mjs` covers capability enable/disable and no duplicate continuation with real components; execution and wrong-program proof remain blocked. |
| Remove wiki → extension-host coupling | Move shared project trust to record; keep extension-host's public re-export | Runtime dependency scan finds no relative import cycle. End-to-end trust/revocation tests need verification on the final branch. |
| Centralize process reads | Runner, hub and supervisor consume the same liveness helper | The duplicate implementation is removed. Real-child and OS-boundary regressions are prepared but unrun. Failed process reads still collapse to empty results; the behavior fix is gated on its expected failing reproduction. |
| Share IDs without loading SQLite | Add the public `@deepbuild/record/ids` entry; trust imports its implementation instead of record's barrel; hub keeps its clock-normalization wrapper | **PASS:** exact vectors, 1,000 seeded round trips, random-ID uniqueness, single-module import and the unchanged installed cold-package test. No generated file or database dependency is needed for IDs. Full cold workspace build remains INCONCLUSIVE (no build grant). |
| Preserve persisted hash formats | Share the identical legacy check/verdict helper; retain the replay encoder | **PASS:** new frozen replay-hash regression. Numeric-looking keys demonstrated that the previous attempted replay consolidation changed persisted bytes. The legacy helper is explicitly not advertised as RFC 8785. |
| Reduce accidental module surface | Make five file-private values non-exported; share elapsed-time and core-connection helpers | Package dependency/boundary checks pass. Complete behavioral regression selection has not run. |
| Fix status's repo label | Prefer the working repo's name over its opaque project ID | Existing #668 acceptance coverage was used earlier; not reverified on this isolated PR tree. |

## Fresh checks on the isolated PR tree

Node `v24.22.0`. Reported machine load was 47 at the end of the affected run; no timing claim is made.

Command:

```sh
node scripts/affected.mjs tests/record-ids.test.mjs tests/record-ids-cold.test.mjs packages/record/test/replay-hash.test.ts tests/package-deps.test.mjs
```

Result: **FAIL** — 13 new relative to the committed baseline, 17 known, 1 blocked, 4 passed.

The four passing tests are:

- `tests/record-ids.test.mjs`: the database-free IDs entry and encoding behavior.
- `packages/record/test/replay-hash.test.ts`: frozen replay-plan hash with numeric-looking file names.
- Both existing package dependency/public-boundary tests in `tests/package-deps.test.mjs`.

The new reproducible failure is:

- `tests/record-ids-cold.test.mjs`: `ERR_MODULE_NOT_FOUND` for the default `record/dist/ids.js` export when no build exists. A clean alphabetical workspace build reaches pi's tool generation before record's build. A warm rebuild is not evidence that this is fixed.

The other 12 new-baseline findings are outside changed implementation paths: existing secret-scan findings in acceptance data, two missing Rust dependency declarations, and three canvas-lint findings. They remain failures; they were not added to the baseline or suppressed.

The blocked check is canvas-lint: `crates/deep-canvas/src/cost.rs` cannot compile because a `registry::Manifest` initializer lacks `implementation` (`E0063`).

Additional results:

- `git diff --check`: PASS.
- Relative runtime import scan: 200 TypeScript source files, zero cycles. This scan is not a proof of arbitrary dynamic imports or Rust dependencies.
- Root TypeScript check: FAIL, 12 diagnostics in existing test files (`extension-host/test/sources`, `hub/test/background-hold`, `hub/test/codex-files`, `acceptance/356/helpers`). The full messages remain local; no tests were changed to clear them.
- Workspace build: the first isolated build failed, including the cold IDs dependency and a misplaced line while excluding pre-existing changes. The misplaced line was corrected; hub, CLI and pi builds then passed with record already built. Clean-build correctness remains FAIL as above.

## Full selection not executed

`node scripts/affected.mjs --list` with all changed paths selected 332 parallel Vitest files, 368 serial Vitest files, 64 Node test files and `deep-app` Cargo tests. It listed 32 skipped/manual or own-lane entries. There was no WIDE line for this combined selection; this is not evidence those tests ran. `package-lock.json` also requires preflight under the selector's global-input rule.

The full affected selection, release preflight, API surface comparison, platform/live checks and integration with current main have not been completed. Earlier repeated runs under heavy contention are not used to claim this branch passes. No `Closes` statement is justified.

## Size and delivery

This is a draft checkpoint of an accumulated audit, not a merge-ready single-issue change. Much of the large diff relocates existing implementations, but the remaining work can and should be split into reviewable changes before merging. New exports and dependencies are limited to demonstrated callers; independent client packages retain their existing runtime isolation.
