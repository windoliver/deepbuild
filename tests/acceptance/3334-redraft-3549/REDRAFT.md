# Blind redraft of #3334's two stalled-line tests under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. `tests/acceptance/3334/helpers.mjs` hard-codes `SLOTS` as 1 on macOS and 2 elsewhere, and its `stillLine` holds that many build grants as "every build slot". Under the ceiling the class isn't full with them, so the request behind the still line is granted at once, and the two tests that need it to stall fail on a right program. This folder redrafts them from #3334's criteria, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3334-redraft-3549/stall.test.mjs
node --test tests/acceptance/3334-redraft-3549/far-stalled.test.mjs
```

Both import `tests/acceptance/3334/helpers.mjs` unchanged, and `far-stalled.test.mjs` imports `tests/acceptance/1122/helpers.mjs` as the original does. `helpers.mjs` here holds `buildLimit()` and `stillLine`. `buildLimit()` reads the source text of `scripts/throttle.mjs`, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number. `stillLine` is the original's with its count from `buildLimit()`: the holders' names (`hold-3334-<k>`), their `--wait 10`, their command and the 2 min each is given to take its grant are the original's, through the original's `start` and `within`.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3334/stall.test.mjs` › #3334.ed504fe3 a build --stall 0.05 request behind build grants that never change hands ends INCONCLUSIVE no grant naming each holder, exits 3 and never runs its command | #3334.ed504fe3 | `stillLine` holds `SLOTS` build grants, 1 on the Mac and 2 on Linux. Under the ceiling of 4 (6) the class isn't full, so the `--stall` request is granted at once, runs its command and exits 0, on a right program | `stall.test.mjs` › same name. The only change: `stillLine` is this folder's, which holds `buildLimit()` build grants. The request, its 3 min, the assertions and the expected values are the original's, line for line; each holder is named, as the original's loop already asks |
| `3334/far-stalled.test.mjs` › #3334.f5046205 a far end whose build queue stalls past the bound reads INCONCLUSIVE on the near end, exits 2, and its fetched record names the holder | #3334.f5046205 | The same `stillLine`, on the far machine's table. Under the ceiling the far end's `npm ci` gets its build grant, the lane runs, and the near end reads the lane's own state, not INCONCLUSIVE, on a right program | `far-stalled.test.mjs` › same name. The only change: `stillLine` is this folder's. The fixture far machine, the near end's 6 min, the assertions and the expected values are the original's, line for line; the note names each holder, as the original's loop already asks |

"One build grant is held" in #3334's second criterion is read as the class full, every slot held and each holder named: the criterion needs a line that stalls, and under #3549 a request stalls only behind a full class.

## Kept as they are

- Carried into `stall.test.mjs` here, unchanged: `3334/stall.test.mjs` › #3334.6c8b5837 a build --stall 0.05 request behind a line whose grants change hands about every 2 s for 20 s is granted and runs its command. Nothing in it is redrafted, its counts least of all: its name, ID, scene, waits, assertions and expected values are the original's, line for line, and it imports from `tests/acceptance/3334/helpers.mjs` what it imports there, `movingLine` and `SLOTS` with it. It is here because the swap is by file: once a redraft lands, its original file runs by hand only (`redrafted` and `byHand` in `scripts/lanes-lists.mjs`), so every test of the original file runs in the redraft file, or the swap would drop it from the lanes. The file holds the original's two tests in the original's order. `3334/far-stalled.test.mjs` holds one test, so `far-stalled.test.mjs` here holds the whole file.
- Staying where they are: `3334/far-moving.test.mjs` and `far-failed.test.mjs`, and `twins.json` with the twins. The brief for this redraft names only `stall.test.mjs` and `far-stalled.test.mjs` for #3334, and the others aren't reviewed or run here. The moving line (`movingLine`) and the two tests that read it, the carried one and `far-moving.test.mjs`'s, count by `SLOTS`.

No twins here: `tests/acceptance/3334/twins.json` maps #3334.6c8b5837 (`fixed-wait`) and #3334.f5046205 (`far-blocked`), and the files keep all three IDs.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place. The carried test was added to `stall.test.mjs` after that request; this job ran it nowhere either, and asked for no second grant.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/3334-redraft-3549/stall.test.mjs` | the base `e09236864` (Mac build limit 1) | its two tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/3334-redraft-3549/far-stalled.test.mjs` | the base | pass | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/3334-redraft-3549/stall.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | the redrafted test passes; the carried one, which counts by `SLOTS`, isn't predicted here | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/3334-redraft-3549/far-stalled.test.mjs` | the throwaway | pass | `INCONCLUSIVE`: not run by this job |
| `node --test --test-name-pattern='#3334.ed504fe3' tests/acceptance/3334/stall.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run by this job |
| `node --test --test-name-pattern='#3334.f5046205' tests/acceptance/3334/far-stalled.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run by this job |

Checked without a test run, which proves nothing about the tests: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
