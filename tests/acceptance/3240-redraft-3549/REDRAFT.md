# Blind redraft of #3240's line test under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. `tests/acceptance/3240/line.test.mjs` holds one build grant and takes a second build request to wait behind it, "the Mac's build limit is 1" written in its own header. Under the ceiling that request is granted beside the first, so nothing waits and the test fails on a right program. This folder redrafts the test from #3240's criterion, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3240-redraft-3549/line.test.mjs
```

It imports `tests/acceptance/3240/helpers.mjs` unchanged. `helpers.mjs` here holds `buildLimit()`. It reads the source text of `scripts/throttle.mjs`, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3240/line.test.mjs` › #3240.f0d5ecc3 one build grant held whose child spins 2 cores and one build request waiting: the sample records 1 request waiting, of class build, and idle and busy cores that sum to the machine's | #3240.f0d5ecc3 | One build grant fills the class only at a limit of 1. Under the ceiling of 4 (6) the second request is granted beside it, so the test fails at "the second build request was granted beside the held one", on a right program | `line.test.mjs` › same name. The class is full: the grant whose child spins 2 cores, as before (`holder`), and a build grant for each other slot, `buildLimit() - 1` of them, whose child idles (`holder-2` and on), each read under a build grant before the request is made. The request, the 8 s it is shown waiting, the sample, the assertions and the expected values are the original's, line for line |

"One grant held" in the criterion is read as the class full, one of its grants the spinning one: the criterion needs a request that waits, and under #3549 a request waits only behind a full class. The busy cores are still held to the spinning grant's tree alone, as the original holds them.

Beside the count, three texts change with it: the two messages that called the request "the second build request" and the holder "the held one" now say "the build request" and "the held ones"; "never the grant held" reads "never a grant held"; and the diagnostic and the last message say "the spinning grant" where they said "the held grant". Every failure message that showed the holder's output shows each holder's.

## Kept as they are

- `3240/cost.test.mjs`, `gpu.test.mjs`, `gpu-unread.test.mjs`, `log.test.mjs` and `report.test.mjs`, and `twins.json` with the twins. The brief for this redraft names only this test for #3240, and the others aren't reviewed or run here. `log.test.mjs` holds one build grant with a build request behind it too.

No twins here: `tests/acceptance/3240/twins.json` maps #3240.f0d5ecc3 (`holder-waits`), and the redraft keeps the ID.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/3240-redraft-3549/line.test.mjs` | the base `e09236864` (Mac build limit 1) | pass | `INCONCLUSIVE`: not run |
| `node --test tests/acceptance/3240-redraft-3549/line.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | pass | `INCONCLUSIVE`: not run |
| `node --test --test-name-pattern='#3240.f0d5ecc3' tests/acceptance/3240/line.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run |

Checked without a test run, which proves nothing about the test: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
