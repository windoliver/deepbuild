# Modularity audit — partial implementation, not closed

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
| Use the hub's adapter capabilities in asks | Inject the error-turn capability callback while retaining standalone callers' shipped default | Code path exists; a regression test specifically exercising the injected callback is still missing. |
| Remove wiki → extension-host coupling | Move shared project trust to record; keep extension-host's public re-export | Runtime dependency scan finds no relative import cycle. End-to-end trust/revocation tests need verification on the final branch. |
| Centralize process reads | Runner and hub consume supervisor's process helpers | **PARTIAL:** supervisor still has its own liveness helper; read failures still collapse to empty results. This is not a complete fail-closed process-observation redesign. |
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
