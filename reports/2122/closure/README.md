# #2122 closure proof on the isolated PR branch

**Issue criteria: 5/5 proven by unchanged acceptance tests. Overall repository validator: still FAIL for independently reproduced base lint findings, not a clean release preflight.**

- Clean comparison base: `291d63af61aa29e8221c135c51b7df94062d1e4c`.
- Tested PR integration: `e6adbcdda750673c167364e0ebd5525ead55b77f` (the original fix merged with that `main`), plus only the supplemental test files listed in `supplemental.sha256`.
- No production change was needed in this closure round. No existing test, acceptance file, check, baseline, threshold or configuration was changed.
- All workspace TypeScript/native-helper packages and this checkout's `deep-hook` were built locally. All `@deepbuild/*` links resolve into the isolated checkout; only third-party dependencies are shared. The dirty original worktree was not used for these runs.

## Requirement → change → proof

| Requirement | Implementation | Current-base failure | Isolated-head proof |
| --- | --- | --- | --- |
| AC1: missing product index does not make the next same-key build fail | Remove orphan destination before store rename | Unchanged `product-index.test.ts`: ENOTEMPTY, no index entry, orphan contents survive | Same test PASS: rebuilt bytes, restored index, no failed reading |
| AC2: live session after restart is not idle | Resolve unknown hook cwd to worktree, record activity, await it in Core | Unchanged `product-session.test.ts`: product reclaimed | Same test PASS, plus real hub restart/socket/low-disk integration below |
| AC3: late A grant removes no C; unknown ticket is refused | Guard splice index; reject unknown poll instead of creating new needs | Unchanged `heavy-queue.test.ts`: C granted cpu.slot alone; unknown ticket granted | Same test PASS: C still waits for GPU and unknown ticket refused; existing waiter/GPU integration also passes |
| AC4: dead/unstartable canvas refuses without killing host | stdin error listener; shared error/exit pending-call cleanup | Unchanged `canvas.test.ts`: uncaught EPIPE and spawn ENOENT | Same test PASS; actual hub/core-worker failure and recovery also proved below |
| AC5: command-position and tail flag classification | Tokenized command positions/wrappers; numeric/late follow flags; tool-specific tail semantics | Unchanged `never-ends.test.ts`: all reported false positives/negatives reproduced | Same test PASS; existing waits suite, quoted argument/Heroku/Vitest regression and deadline integration pass |

All five unchanged acceptance tests were rerun on **this merge base**, not just the original development base: [`acceptance-base.tests.txt`](acceptance-base.tests.txt). The fixed branch's five acceptance tests plus existing waits and logical-OR regression are **19 passing tests / 7 files**: [`acceptance-head.tests.txt`](acceptance-head.tests.txt). Their eight original source hashes still match `../acceptance.sha256`.

## Gaps closed

1. **`Products.keep` orphan rename:** independent supplemental test `products-keep-orphan-2122.test.ts` fails on the current base with ENOTEMPTY and passes unchanged on the PR. It checks replacement, restored index, no orphan-only file, and independent CoW placement. It does not duplicate `ensure`.
2. **Core's awaited hook and real restart:** independent `products-restart-reclaim-2122.test.ts` starts a real CLI hub/Core worker, builds/places into actual Git worktrees, restarts three hours later, sends active PreToolUse through the socket, and triggers a new build under a controlled OS free-space reading. The active product stays and an idle twin is actually reclaimed. The base loses the active product. Both tests pass: [`products-head.tests.txt`](products-head.tests.txt); failures: [`products-base.tests.txt`](products-base.tests.txt).
3. **Ordering, not merely eventual bookkeeping:** the same integration test gates the active worktree's external git lookup. A mutant on the base contains the async Products registration but deliberately omits Core's `await`. It fails specifically with **“Core must await product registration before later queued work”** and the low-disk ordering assertion (`ordering-mutant.tests.txt`). The complete fix passes unchanged. The mutant was confined to the disposable base checkout, then source-restored; none was committed.
4. **Actual hub survives a canvas failure:** `canvas-hub-failure.test.ts` uses the real CLI hub, Core worker, authenticated socket and Canvas. Only external executable discovery/launch is substituted. An asynchronous missing executable kills the base core, closes the socket and prevents health/recovery; the fix returns `unavailable`, keeps `hub.health` working, and serves the next canvas process. Base failure and head pass are saved as `canvas-*.tests.txt`. The original immutable stand-in test separately proves the post-reply EPIPE window.
5. **Follow flags / bare non-TTY Vitest:** `waits-follow-flags.test.ts` checks Heroku `-t`/`--tail` still follows, Docker/journalctl `-t` does not, explicit Vitest watch does, bare `npx vitest <file>` does not, and quoted shell text is not another command. Base fails; unchanged fix passes (`waits-base.tests.txt`, `deadlines-waits.tests.txt`).
6. **Relevant existing integration:** `tests/acceptance/120/deadline.test.ts` (3), `tests/acceptance/1015/waiter.test.ts` (3), `tests/acceptance/1015/gpu.test.ts` (2) all pass. These exercise real hooks/rewrites, killed waiters, process-group release, and shared/exclusive GPU leases, including existing planted wrong programs. Combined with the follow-flags regression, this run is **9 passes / 4 files**, not whole neighbouring suites (`integration.affected.txt`, `deadlines-waits.tests.txt`, `waiter.tests.txt`, `gpu.tests.txt`).

Total distinct passing tests in this closure round: **31** (19 acceptance/waits + 2 product supplements + 1 actual-hub canvas + 9 follow-flags/deadline/waiter/GPU). No test was retried to make an intermittent failure pass.

## Commands and outcomes

`PATH` included the installed Rust bin directory. Builds and checks used the repository throttle/lease wrapper. The wrapper reported no configured user hub and ran unleased under the throttle; no user-level settings were changed.

```sh
node scripts/throttle.mjs build --wait 30 -- scripts/lease npm run build --workspaces
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked -p deep-hook

node scripts/affected.mjs \
  tests/acceptance/2122/product-index.test.ts \
  tests/acceptance/2122/product-session.test.ts \
  tests/acceptance/2122/heavy-queue.test.ts \
  tests/acceptance/2122/canvas.test.ts \
  tests/acceptance/2122/never-ends.test.ts \
  packages/hub/test/waits.test.ts packages/hub/test/waits-command-position.test.ts

node scripts/affected.mjs \
  packages/hub/test/products-keep-orphan-2122.test.ts \
  packages/hub/test/products-restart-reclaim-2122.test.ts
node scripts/affected.mjs packages/hub/test/canvas-hub-failure.test.ts
node scripts/affected.mjs \
  packages/hub/test/waits-follow-flags.test.ts \
  tests/acceptance/120/deadline.test.ts \
  tests/acceptance/1015/waiter.test.ts tests/acceptance/1015/gpu.test.ts
```

The workspace build, hook build, focused new-test TypeScript checks and original/supplemental hash checks succeed. The frozen supplemental products were also typechecked by their author (`products-author.md`). Test outputs above all pass. Every affected invocation exits **1**, honestly retained, because of the lint failures below.

## Base failures kept separate

[`lint-comparison.txt`](lint-comparison.txt) compares the current clean base and head. **153 distinct non-test lint failure keys occur on both, with no head-only lint key.** Raw counts are generally 166 findings plus 42–45 entries already in `known-failures.json`; the integration run prints the same Map projections finding twice (167 occurrences). Known counts vary with the canvas lint's compiler diagnostics, and both raw runs remain attached. No baseline is updated.

The runner currently assigns its two `canvas-closures` commands the same log filename. Depending on their output interleaving it reports either the Map projections closure mismatch or that job's nonzero exit. The comparison explicitly treats those as the same failing job; it never labels it PASS. All other lint keys compare literally. The original dirty-worktree research-note invalid manifests do not occur in the isolated checkout.

**WIDE / INCONCLUSIVE:** no such prefixed lines in any executed closure check; all runs report zero inconclusive/blocked tests and zero listed skips. The runner prints its TIMED registry, which is not a timed-test execution.

## Limits retained, not prerequisites silently dropped

The full source-selected graph (`source-selection.txt`) is much broader than this issue: 395 parallel Vitest files, 15 node files, 659 alone Vitest files, 67 timed files, 30 slow files, plus the app crate and by-hand/lane exclusions. That entire graph, release preflight, unrelated app/GPU rendering suites and cross-platform runs remain **unrun**. This report proves the issue's named components and relevant integration on macOS; it is not a blanket repository/release PASS. The issue has no performance budget or cross-platform criterion. Physical disk exhaustion is represented by the statfs boundary, and the restart is graceful rather than power loss. These limits do not change the five issue criteria.

The product supplement author saw only the issue/design/current base and wrote frozen tests before seeing the repair. Its input and environment deviations are disclosed in `products-author.md`. The original acceptance tests and existing waits cases are unchanged. The canvas/follow-flags supplemental tests were authored separately as regression protection and failed on the clean base before passing on the fix.

This closure adds tests/evidence, not production logic. The issue now carries roughly **701 handwritten added code/test lines: 46 production lines and 655 test/helper lines**. The excess over the 400-line guideline is the independent five-criterion acceptance proof plus real restart/ordering/CoW/process-boundary regressions requested to close the gaps. Existing fixtures are reused; helpers are limited to the two product callers or necessary executable boundary probes. Splitting the closure proof into another issue would leave the requested integration gaps unproven here.
