# Blind redraft of #1113's no-grant and forged-`DEEP_THROTTLE` tests under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. `tests/acceptance/1113/helpers.mjs` hard-codes `LIMIT.build` as 1 on the Mac and 2 off it, and `fill` in `tests/acceptance/1113/cli.test.mjs` starts that many holders to fill the build class. Under the ceiling the class isn't full with them, so the request each test makes behind it is granted at once, and the test fails on a right program. This folder redrafts the two tests from #1113's criteria, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/1113-redraft-3549/cli.test.mjs
```

It imports `tests/acceptance/1113/helpers.mjs` unchanged. `helpers.mjs` here holds `buildLimit()` and `fill`. `buildLimit()` reads the source text of `scripts/throttle.mjs`, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number. `fill(box, ms)` is the original's `fill(box, 'build', ms)` with its count from `buildLimit()`: the holders' names (`build-holder-<i>`), their `--wait 1` and their hold are the original's.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `1113/cli.test.mjs` › #1113.99a9da00 a no-grant timeout exits non-zero with INCONCLUSIVE no grant as its first line, and never runs the command | #1113.99a9da00 | `fill` holds `LIMIT.build` = 1 build grant on the Mac, 2 on Linux. Under the ceiling of 4 (6) the class isn't full, so the late request is granted at once: it exits 0 and its command runs, on a right program | `cli.test.mjs` › same name. The only change: `fill` holds `buildLimit()` build grants. The holders' 8 s, the request's 0.02 min wait, the assertions and the 6 s bound are the original's, line for line |
| `1113/cli.test.mjs` › #1113.06c9ec7b a forged DEEP_THROTTLE is ignored and a fresh grant is requested: a live holder's value copied from outside its chain, or a made-up one | #1113.06c9ec7b | The same `fill`. With slots free under the ceiling each forger's fresh grant comes at once, before any holder ends, so the test reads a fresh grant as a trusted forgery and fails on a right program | `cli.test.mjs` › same name. The only change: `fill` holds `buildLimit()` build grants; the copied value is still the first holder's. The holders' 3 s, the forged values, the assertions and the 100 ms slack are the original's, line for line |

One thing the larger count changes that no line shows: each holder's hold runs from its own start, and each test asks only once the last holder has started. With more holders the first is further into its hold by then, so the original's margins (the 1.2 s wait inside the holders' 8 s; the forgers asking inside the holders' 3 s) are shorter by the time the other holders take to start. The holds are the original's all the same.

## Kept as they are

- Carried into `cli.test.mjs` here, unchanged: `1113/cli.test.mjs` › #1113.060e7bae a wrapped command that exits 3 makes throttle.mjs exit 3, and one killed by SIGTERM exits 143. It asks for `test` grants on an empty table and fills no class, so nothing in it is redrafted: its name, ID, scene, waits, assertions and expected values are the original's, line for line, and it imports from `tests/acceptance/1113/helpers.mjs` what it imports there. It is here because the swap is by file: once a redraft lands, its original file runs by hand only (`redrafted` and `byHand` in `scripts/lanes-lists.mjs`), so every test of the original file runs in the redraft file, or the swap would drop it from the lanes. The file holds the original's three tests in the original's order.
- Staying where they are: the rest of #1113 (`before`, `drain`, `guard`, `load`, `measured`, `waits`), `tests/acceptance/1113-redraft-2833/`, and `twins.json` with the twins. The brief for this redraft names only `cli.test.mjs` for #1113, and the others aren't reviewed or run here. `1113-redraft-2833/drain.test.mjs` fills "the rest of build" with `LIMIT.build - 1` holders.

No twins here: `tests/acceptance/1113/twins.json` maps #1113.060e7bae (`exits-0`) and #1113.06c9ec7b (`trusts-throttle-env`), and the file keeps all three IDs.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place. The carried test was added to the file after that request; this job ran it nowhere either, and asked for no second grant.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/1113-redraft-3549/cli.test.mjs` | the base `e09236864` (Mac build limit 1) | its three tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/1113-redraft-3549/cli.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | its three tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test --test-name-pattern='#1113.99a9da00' --test-name-pattern='#1113.06c9ec7b' tests/acceptance/1113/cli.test.mjs` | the throwaway | both tests fail, which is why they are redrafted | `INCONCLUSIVE`: not run by this job |

Checked without a test run, which proves nothing about the tests: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
