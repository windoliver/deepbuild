# Blind redraft of #3567's build-grant test under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. The second test of `tests/acceptance/3567/grant.test.mjs` starts two neighbours' build grants, "one slot on macOS and two elsewhere" written in its own comment, to keep the build class from the run. Under the ceiling two neighbours leave 2 slots free (4 on Linux), so the run gets the build grant it was to wait for, and the test fails on a right program. This folder redrafts the test from #3567's criterion, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The original is not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3567-redraft-3549/grant.test.mjs
```

It imports `tests/acceptance/3567/helpers.mjs` unchanged. `expectNoGrant`, `starts` and the fixture's names aren't exported there, so they are copied from the original file as they are. `helpers.mjs` here holds `buildLimit()`. It reads the source text of the checkout's `scripts/throttle.mjs`, the file the scratch tree copies, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3567/grant.test.mjs` › #3567.f4411929 a run still waiting for the build grant of its binaries at the bound ends INCONCLUSIVE naming the build class, and holds no request in the throttle's table afterwards | #3567.f4411929 | Two neighbours fill the class only at a limit of 1 or 2. Under the ceiling of 4 (6) the run is given a build grant at once, so it isn't waiting for its first grant at the bound, on a right program | `grant.test.mjs` › same name. The only change: a neighbour for each build slot, `buildLimit()` of them, where the original started two. The wait for them (one or more holding, each in the table), the run, its bound, the assertions and the expected values are the original's, line for line |

One difference on the base, on macOS only. The original's two neighbours are one that holds the Mac's one slot and one left in line ahead of the run. The redraft's count is the slots, so on the Mac's base it starts one neighbour, which holds, and none is left in line; on Linux's base it starts two, as the original does. The criterion needs the class held, not a neighbour in line.

## Kept as they are

- Carried into `grant.test.mjs` here, unchanged: `3567/grant.test.mjs` › #3567.f4411929 a run still waiting for its test grant at the bound ends INCONCLUSIVE naming the test class, and holds no request in the throttle's table afterwards. It keeps the `test` class from the run by readings and holds no build grant, so nothing in it is redrafted: its name, ID, scene, waits, assertions and expected values are the original's, line for line, and it imports from `tests/acceptance/3567/helpers.mjs` what it imports there, `readings` with it. It is here because the swap is by file: once a redraft lands, its original file runs by hand only (`redrafted` and `byHand` in `scripts/lanes-lists.mjs`), so every test of the original file runs in the redraft file, or the swap would drop it from the lanes. The file holds the original's two tests in the original's order, and both read `expectNoGrant`, copied once.
- Staying where they are: `3567/bound.test.mjs`, `fail.test.mjs`, `slow.test.mjs`, `today.test.mjs` and `unstarted.test.mjs`, and `twins.json` with the twins. The brief for this redraft names only `grant.test.mjs` for #3567, and the others aren't reviewed or run here.

No twins here: `tests/acceptance/3567/twins.json` maps #3567.f4411929 (`leaves-its-request`), and the redraft keeps the ID.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place. The carried test was added to the file after that request; this job ran it nowhere either, and asked for no second grant.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/3567-redraft-3549/grant.test.mjs` | the base `e09236864` (Mac build limit 1) | its two tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test tests/acceptance/3567-redraft-3549/grant.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | its two tests pass | `INCONCLUSIVE`: not run by this job |
| `node --test --test-name-pattern='build grant of its binaries' tests/acceptance/3567/grant.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run by this job |

Checked without a test run, which proves nothing about the test: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
