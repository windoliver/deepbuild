# Blind redraft of #2820's no-build-grant test under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. `tests/acceptance/2820/helpers.mjs` hard-codes `BUILD_SLOTS` as 1 on macOS and 2 elsewhere, and the second test of `tests/acceptance/2820/failures.test.mjs` starts that many neighbours to hold "every build slot of the table". Under the ceiling the class isn't full with them, so the run gets its build grant inside its wait, and the test fails on a right program. This folder redrafts the test from #2820's criterion, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/2820-redraft-3549/failures.test.mjs
```

It imports `tests/acceptance/2820/helpers.mjs` unchanged, and through it #1115's and #2574's helpers, as the original does. `helpers.mjs` here holds `buildLimit()`. It reads the source text of `scripts/throttle.mjs`, the file the neighbours run (`THROTTLE` of `tests/acceptance/1115/helpers.mjs`), because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `2820/failures.test.mjs` › #2820.AC5b when no build grant comes within the wait, the run ends INCONCLUSIVE no grant, takes no test grant, and nothing passes | #2820.AC5b | It starts `BUILD_SLOTS` neighbours, 1 on the Mac and 2 on Linux. Under the ceiling of 4 (6) the class isn't full, so the run's build request is granted inside its 0.02 min: it builds, takes its test grant and runs the planted test, on a right program | `failures.test.mjs` › same name. The only change: `buildLimit()` neighbours, and the wait for that many to have started. The neighbours' 9 min, the run's 0.02 min wait, the assertions and the expected values are the original's, line for line |

## Kept as they are

- Carried into `failures.test.mjs` here, unchanged: `2820/failures.test.mjs` › #2820.AC5a when a binary's build fails, the run ends BLOCKED naming the binary, takes no test grant, and nothing passes. It holds no build grant, so nothing in it is redrafted: its name, ID, scene, waits, assertions and expected values are the original's, line for line, and it imports from `tests/acceptance/2820/helpers.mjs` what it imports there, `BROKEN` with it. It is here because the swap is by file: once a redraft lands, its original file runs by hand only (`redrafted` and `byHand` in `scripts/lanes-lists.mjs`), so every test of the original file runs in the redraft file, or the swap would drop it from the lanes. The file holds the original's two tests in the original's order.
- Staying where they are: `2820/bin-dir.test.mjs`, `no-binary.test.mjs`, `shard.test.mjs` and `worktree.test.mjs`. The brief for this redraft names only `failures.test.mjs` for #2820, and the others aren't reviewed or run here.

No twins here: #2820's folder has none, and the file keeps both IDs.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place. The carried test was added to the file after that request; this job ran it nowhere either, and asked for no second grant.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/2820-redraft-3549/failures.test.mjs` | the base `e09236864` (Mac build limit 1) | its two tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/2820-redraft-3549/failures.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | its two tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test --test-name-pattern='#2820.AC5b' tests/acceptance/2820/failures.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run by this job |

Both tests start the real `cargo`, as the originals do; `cargo` isn't on this session's `PATH`, and whether the sandbox finds it in the folders #2820's helpers add wasn't read.

Checked without a test run, which proves nothing about the test: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
