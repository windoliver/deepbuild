# Issue #2122 supplemental base regression proof

Base: `291d63af61aa29e8221c135c51b7df94062d1e4c` (verified before and after).
Platform: macOS / Node v24.22.2 / real copy-on-write filesystem.
These are supplemental hub tests, not replacement acceptance tests. No implementation, existing test, check, configuration or acceptance file was edited. `git diff --exit-code` remained clean. No commit, push, CI dispatch or global settings/hook modification was made.

## Requirement → test → observed failure

| Requirement | New test | Actual base result |
| --- | --- | --- |
| Scoped `Products.keep` rename replaces a same-key nonempty orphan after `products.json` is lost; restores the index and serves the replacement as an independent CoW clone | `packages/hub/test/products-keep-orphan-2122.test.ts` | **Expected defect reached.** Line 55's resolves assertion failed with `ENOTEMPTY` at `Products.keep`, `products.ts:383`, renaming the stage onto the orphan. First keep, guard installation, declared key lookup, stored old content, index deletion and reopened `holds() === false` all completed. |
| Real restarted hub receives active worktree PreToolUse before low-disk reclaim; preserves its >2-hour-old product but actually reclaims an idle old worktree product | `packages/hub/test/products-restart-reclaim-2122.test.ts` | **Expected defect reached.** Line 108's active-product existence assertion received false. Real build, both Git worktree placements, idle SessionEnd, restart over the same root, durable active `tool.before`, below-floor statfs observation, idle target deletion, idle index removal and unchanged idle source all completed first. |

Actual output: `base-vitest.log` and `base-vitest.jsonl`. Exactly two tests executed, both assertion failures; no setup/import errors. Test duration: 13.49 seconds. Tests and helpers were never edited after writing; SHA-256 values were checked unchanged after the run.

## Components and ordering protection

- Keep test uses real Products, Git, filesystem, `addGuards` with the checkout-built `deep-hook`, and supervisor `openUnder`. Unused dependency callbacks throw if reached rather than supplying fake success. No `ensure()` regression is duplicated.
- Integration reuses `test/hub.ts` (`withHub`, socket hook client, authenticated RPC client, session/transcript fixture, record polling). It starts/stops/restarts an actual CLI hub process with its actual Core worker, Products, record, lease/build path, supervisor and filesystem. Initial product build is a tiny shell command, not app/render work. All project functions are real.
- Real `git worktree add` creates the two worktrees after the warm build so normal tracked-file mtime checks permit placement. Active placement precedes idle placement; the test asserts this ordering, making active removal observable on the broken base rather than accidentally reclaiming only idle first.
- The idle session ends before restart and sends no later hook. Only active sends PreToolUse after restart. A seed session in the main checkout asks for the next default-branch key, driving real `roomFor()` / `reclaimOne()`.
- `products-2122-disk-boundary.mjs` changes only `fs.statfsSync`'s available-space result under the temporary HOME, preserving real filesystem metadata and operations. It reports 1 GB while the idle product exists under pressure, then 1 TB; it writes a marker when low space is actually observed. No real disk is filled. Keeping pressure until idle is removed makes the broken base remove both active and idle, whereas a correct program can remove idle alone.
- The executable Git wrapper holds only the active worktree's `--git-common-dir` lookup, then delegates original arguments to `/usr/bin/git`. The test queues `events.read` and a build-driving SessionStart behind the active hook. If the lookup is entered, neither queued RPC completion nor low-disk reclaim may overtake it. The gate is released in `finally`. Thus a future async Products hook called without awaiting it cannot pass merely because the lookup usually finishes quickly.
- The base performs no lookup for the unknown product session. The test deliberately continues to actual reclaim rather than treating a missing gate as a setup timeout. The conditional held-lookup assertions are **not exercised on this base**; no fixed implementation or mutant was inspected or run.
- No private-map assertions or source-text assertions. On-disk product index and actual product/source files are the behavior observations.

## Setup, freeze and commands

All build/test commands inherited `PATH=/opt/homebrew/opt/rustup/bin:$PATH`. All @deepbuild resolution was to this checkout. Third-party dependency links were left alone.

1. Read `AGENTS.md`, supplied `/tmp/deepbuild-2122-closure-issue.json`, relevant design sections (hub/socket, Lease, Before each command, Sessions that know about each other, and Dogfooding), base Products/Core/socket/build code and existing fixtures. Inspection used `read`, `rg`, `ls`, `find`, `git status`, `git rev-parse` only; no other implementation or draft was opened.
2. `node scripts/throttle.mjs build --wait 30 -- npm run build --workspaces` → exit 0, `build.log`. This compiles TypeScript and package-native helpers without the full Rust workspace/app build.
3. `node scripts/throttle.mjs build --wait 30 -- cargo build --locked -p deep-hook` → exit 0, `hook-build.log`.
4. Under `node scripts/throttle.mjs test --wait 30 -- node --input-type=module`, an inline setup-only probe imported the existing hub fixture and built Products/guards/supervisor, created a real fixture repo, built/placed a warm product, restarted the hub with the filesystem preload, and exercised a non-orphan keep/place. All four setup assertions passed (`setup.log`). It tested no claimed defect and was run before executable regression files were written.
5. After writing the tests, under `node scripts/throttle.mjs build --wait 30 -- node --input-type=module`, TypeScript API `readConfigFile`, `parseJsonConfigFileContent`, `createProgram([the two explicit new tests], {...options, noEmit:true})`, and `getPreEmitDiagnostics` checked the two tests and their imported graph. Result: **0 diagnostics** (`types.log`). `node --check packages/hub/test/products-2122-disk-boundary.mjs` also exited 0. No test or expected value was adjusted.
6. `shasum -a 256 packages/hub/test/products*2122*` froze the four source files before execution.
7. `node scripts/affected.mjs --list packages/hub/test/products-keep-orphan-2122.test.ts packages/hub/test/products-restart-reclaim-2122.test.ts` selected exactly the two tests in parallel Vitest.
8. `node scripts/affected.mjs packages/hub/test/products-keep-orphan-2122.test.ts packages/hub/test/products-restart-reclaim-2122.test.ts` → exit 1 (`affected.log`). This was the only regression test run; no neighbouring suites, full preflight, acceptance run, or rerun.
9. Copied only this run's Vitest log/reporter output into this report directory, redacting home, checkout, temporary test-home and runner-log paths. No test rerun was used to obtain detailed failures.
10. `git diff --exit-code`, `git rev-parse HEAD`, `git status --short`, and source SHA-256 checks verified the unchanged tracked base and frozen files after execution.

Saved evidence files are only under `reports/2122-supplemental/`. The required affected runner itself creates temporary runner logs outside the repository; these were not redirected by changing its implementation. Persisted evidence is redacted. Standard output from commands was streamed through redaction before saving.

## Runner findings, limits and deviations

- `affected`: **168 new failures**, **42 known**, **0 inconclusive or blocked**, **0 listed skips**, **0 passed**, 20 seconds, load 42. Two new failures are the intended regression assertions; **166 other new findings** are the runner's automatic repository-wide lint findings, not test setup failures. They concern dependency allowlists, carried patches, canvas restrictions/closures, size ceilings, mappings, record-reader rules, an existing fixture home path and aged known-failure entries. They remain unchanged; full emitted findings are in `affected.log`.
- **No WIDE lines and no INCONCLUSIVE lines.** The runner prints its full TIMED registry but selected no timed suite. Nothing timed was claimed as proven.
- `scripts/lease` reported no local hub token and ran its command unleased. The machine's **throttle grants were still acquired by the required runner/build commands**; no throttle bypass was used. No real-user hub was started to change that condition.
- Successful post-repair keep/index/clone assertions occur after the expected rejection and therefore did not execute on this base. Active-content/index/no-extra-SessionStart assertions following line 108 likewise did not execute. They are frozen expectations, not claimed passes.
- Real restart is graceful SIGTERM/restart, not a crash/power-loss test. Age uses the hub's existing test-clock option (3 hours forward), not wall-clock waiting. Filesystem pressure is controlled rather than physical. The gate's 500 ms observation interval is an ordering challenge, not a performance budget; no timing result is claimed.
- These tests require `/usr/bin/git`, real copy-on-write support, the built CLI/packages/native supervisor helper and `deep-hook`; only this macOS host was exercised. The guard's real CoW operation has no byte-copy fallback. Windows/non-CoW filesystems are not claimed.
- No second-thread session storm, multiple-product arbitration, ensure orphan criterion, whole issue acceptance closure, other #2122 defects, or full app/render proof is claimed.
- Existing fixture `withHub` owns hub process cleanup; the wrapper releases only this test's Git, and teardown removes only its temporary folders. No process not started by this job was stopped.
- The initial AGENTS filename search mistakenly used `find .. -name AGENTS.md -print`; it timed out and returned no matches. No other worktree contents were read. All subsequent searches were scoped to this checkout.
- Three unrelated untracked files appeared during the job: `packages/hub/test/canvas-2122-boundary.mjs`, `packages/hub/test/canvas-hub-failure.test.ts`, `packages/hub/test/waits-follow-flags.test.ts`. Only their names in status were observed; they were not opened, changed, run or included in this job's source hash manifest. Tracked files stayed identical to the base.
- Setup/types were checked before the executable test freeze. No dispute/redraft occurred. These frozen tests must not be repaired in place to accommodate an implementation; any dispute follows the repository blind-redraft procedure.

## New source files and SHA-256

```
da0cd26571974a98a2b12ee6edb3865bec5908cbbe5bc8b649d752f31a5682bb  packages/hub/test/products-2122-disk-boundary.mjs
0585751ccc439f247a739aeb5ce439cfd76b88648326edeee6d749b6f9f14ece  packages/hub/test/products-2122-fixture.ts
2d1bac438681f9c81fe51286d4539c41112b92e74a9403cd6d0be1443ebb8336  packages/hub/test/products-keep-orphan-2122.test.ts
3d078b4b5b984b4d5f58715704dad03a426d1b4bf58debaf735af7c08ada1d4f  packages/hub/test/products-restart-reclaim-2122.test.ts
```

`SHA256SUMS` includes these sources plus the report and each evidence file (not itself).
