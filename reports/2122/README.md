# #2122 — five hub failure/restart fixes

**Current status:** the isolated PR branch merged with `main` at `291d63af` now has all five acceptance criteria and the previously missing integration proofs verified. See [closure/README.md](closure/README.md) for 31 passing tests, current-base failures, the await-ordering mutant, and the clean-base lint comparison. Repository-wide lint still fails; this is not a release-preflight PASS. The rest of this page preserves the earlier development record and its then-open gaps.

Base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17` (includes #2113).
This report records the implementation-time checks before commit. PR preparation preserves the tested base and copies only this issue's changes into a separate branch; unrelated original-worktree changes remain there.

## Requirement → change → proof

| Issue criterion | Change | Unchanged acceptance test | Base → fixed |
| --- | --- | --- | --- |
| AC1: replace a product folder absent from the index | `products.ts`: remove the orphan destination before the `ensure` and `keep` renames | `product-index.test.ts`: actual supervised build, lost index, same key/commit, fresh bytes and orphan-only file removed | ENOTEMPTY / missing index → PASS |
| AC2: a live session after restart protects its worktree | `Products.hook` resolves an unknown session's cwd with `repoAt`, registers its worktree, then records the hook; `core.ts` awaits this bookkeeping | `product-session.test.ts`: real placement, three-hour clock advance, reopened store, nested-cwd PreToolUse, low-disk reclaim | product removed → PASS |
| AC3: a late grant cannot erase C or weaken its resource needs | `heavy.ts`: guard the queue index before splice; refuse a poll with no matching ticket/secret | `heavy-queue.test.ts`: real table, gated external availability probe, terminated A, GPU-blocked C and missing-ticket poll | C granted cpu.slot only; unknown ticket granted → PASS |
| AC4: a canvas failure refuses the call without killing its host | `canvas.ts`: handle stdin errors and share pending-call cleanup between process error and exit | `canvas.test.ts`: real Canvas in isolated host, first reply then closed pipe; asynchronous spawn failure | uncaught EPIPE / ENOENT → unavailable, host survives; PASS |
| AC5: recognize command words and follow options correctly | `waits.ts`: match command position after the listed wrappers, preserve quoted arguments, accept tail's earlier options/numeric clusters, keep `-t`/`--tail` follow semantics only for Heroku, distinguish piped cat | `never-ends.test.ts`: issue cases and wrapper/separator variants | 15 incorrect classifications → PASS |

Acceptance files are in `tests/acceptance/2122/`. `acceptance.sha256` pins all eight executable test/helper files; hashes match the independent author's files. Existing `packages/hub/test/waits.test.ts`, including lines 31–32, is unchanged.

A supplemental regression test, `packages/hub/test/waits-command-position.test.ts`, catches the first implementation's confusion of logical OR with a pipe (`false || cat`). It failed before the two-character-operator correction (`command-position-red.txt`) and passes unchanged (`waits-final.txt`). This test does not replace an acceptance criterion.

## Checks actually run

- Independent base run: five tests failed for all five expected defects. `base-failures.txt` holds the test output; `affected-base.txt` holds the validator's separate lint findings.
- Fixed run via `node scripts/affected.mjs`, explicit five acceptance paths plus `packages/hub/test/waits.test.ts`: **18 tests passed, six files** (`passed.txt`).
- After the logical-OR correction, only affected checks were rerun: the supplemental regression, existing waits suite, and AC5: **15 tests passed, three files** (`waits-final.txt`). The other four acceptance tests' implementation did not change.
- Hub TypeScript build: `node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json`, under the build throttle and lease wrapper: **exit 0**, including after the last correction (`build-final.txt`).
- `git diff --check`: **exit 0** for tracked implementation edits. Acceptance SHA-256 verification and unchanged existing waits test: **exit 0**. PR staging additionally checks the new files; terminal logs have only trailing blank lines trimmed for that check.

Commands (Rust's installed bin directory was added to PATH for `affected.mjs`):

```sh
node scripts/affected.mjs \
  tests/acceptance/2122/product-index.test.ts \
  tests/acceptance/2122/product-session.test.ts \
  tests/acceptance/2122/heavy-queue.test.ts \
  tests/acceptance/2122/canvas.test.ts \
  tests/acceptance/2122/never-ends.test.ts \
  packages/hub/test/waits.test.ts

node scripts/affected.mjs \
  packages/hub/test/waits-command-position.test.ts \
  packages/hub/test/waits.test.ts \
  tests/acceptance/2122/never-ends.test.ts
```

## Earlier verification was BLOCKED (superseded by the closure report)

Both fixed validator runs exit **1**, despite their selected tests passing. `affected.txt` and `affected-final.txt` report **245 new lint findings, 11 known failures, six invalid/inconclusive/blocked findings**. These are outside this patch: research-note paths/manifests, dependency listings, vendor/canvas lint, size limits, contract/slot mappings, and expired known-failure entries. The `core.ts` size finding predates this change; our edit there replaces one line without adding lines. No check, threshold, baseline or unrelated file was changed to suppress them.

**WIDE / INCONCLUSIVE lines:** none in either explicit-path fixed run. The six non-FAIL findings are `INVALID deps` for research-note probe manifests, reproduced in the saved output.

**PR isolation / integration:** the passing runs above were made in the original dirty worktree, with unrelated changes present. The PR branch contains only this issue's patch on the same base; tests have **not** been rerun on that isolated branch or its merge with current `main`. These prior results are not a claim that the PR integration passed.

**Scope deviation / unrun checks:** the source-path `--list` reaches 341 parallel Vitest files, 11 node files, 585 alone files, 63 timed files, 28 slow files, and `cargo test -p deep-app`, plus by-hand/lane exclusions (`source-selection.txt`). That broad run and release preflight were **not run**; only the named component acceptance and waits regression checks ran. Full hub/socket integration, timing budgets, and other platforms are unproven. AC1 proves `ensure`; the additional `keep` rename is changed as scoped but has no separate orphan-path reproduction. Core's awaited-hook integration is typechecked, not end-to-end tested. The hook lookup is reused once a session is registered; sessions outside a git repo remain unregistered. Bare Vitest is no longer presumed to watch without an explicit watch flag, matching the issue's non-TTY example; that discretionary case is not asserted by the independent acceptance suite.

## Independence, size and setup notes

The acceptance job received only the issue, design and base checkout, before implementation edits. Its initial unfinished helper used a nonexistent type export; a fresh blind job repeated that authoring error. Before any tests existed, the implementing agent clarified that correcting the **type-only import** in the unfinished helper was permitted. No executable helper logic, assertion, or completed acceptance test was edited. The job then froze the tests and captured all five failures. Its first validation attempt lacked a required config-eval build, so it built that dependency chain before the one executable base run. These were setup problems, not defect evidence. During process diagnosis after freezing tests, the author reports that an overbroad process-list query exposed unrelated command lines; no other worktree files or implementation were read or used. This deviation is disclosed, not treated as proof.

The base-built `deep-hook` binary was reused for product guard fixtures; this change edits no hook/Rust code. The harness' lease wrapper reported no configured hub, so test/build commands ran unleased under the local throttle. No process belonging to another task was stopped.

About **418 handwritten code/test lines** (before this report), slightly above the 400-line guideline: five independent criteria are required by one issue, and 366 lines are the immutable acceptance fixtures/tests, including real supervisor/lease wiring and isolated canvas crash probes. Splitting would leave this issue's required proof incomplete; no new dependency, export, option, configuration or shared production abstraction was introduced. These fixes belong at existing hub-owned product, lease and process boundaries; an extension cannot correct their queue/index/pipe lifecycle.
