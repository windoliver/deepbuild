# Blind redraft of #3588's two scene tests under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. It was a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, then takes a turn on the machine's pool (`docs/parallel-proof.md`, sections 6 and 13, "Builds on the pool"). `tests/acceptance/3588/helpers.mjs`'s `runScene` takes "every build slot of the table" with `BUILD_SLOTS` holders, from `tests/acceptance/2820/helpers.mjs` (1 on macOS, 2 elsewhere). Under the ceiling the class isn't full with them: the run's rebuild before the timed job is admitted at once beside the holders, and both tests fail on a right program before they read their criterion. This folder redrafts them from #3588's criteria, #3549 and the base `d303e2b64`. The count's surface is the one #2833's, #2820's and #3334's redrafts settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap (`tests/acceptance/3588/DISPUTE-3549.md`). Run with:

```
node --test tests/acceptance/3588-redraft-3549/bound.test.mjs tests/acceptance/3588-redraft-3549/granted.test.mjs
```

`helpers.mjs` here re-exports `tests/acceptance/3588/helpers.mjs` unchanged, but for `runScene`, which is the original's line for line with its holder count from `buildLimit()` of `tests/acceptance/2820-redraft-3549/helpers.mjs` (imported, not copied: it reads the `LIMITS` line of the checkout's `scripts/throttle.mjs`, the file the fixture copies, throws on anything but one `build` integer for this platform, and has no default). The original's 20 s grace past the 4 minutes, unexported there, is written here with the same value. The two test files are the originals byte for byte, under a two-line header comment.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3588/bound.test.mjs` › #3588.7a8aaa71 with every build slot held from before the timed phase, the rebuild before the timed job waits at most the time left and at the bound builds nothing: … | #3588.7a8aaa71 | `BUILD_SLOTS` (2) holders leave 4 of the ceiling's 6 free, so the rebuild is admitted at once, the timed file runs, and no `INCONCLUSIVE … not started: the run reached its bound of 3 min` line comes, on a right program | `bound.test.mjs` › same name. Only change: `buildLimit()` holders (6 on Linux, 4 on macOS), and the wait for that many to hold |
| `3588/granted.test.mjs` › #3588.704a8c75 with every build slot held from before the timed phase, and the holders letting go 20 s after …: … | #3588.704a8c75 | The same holders: the rebuild's build grant comes before the holders let go, so none is granted after them: "no build grant was granted to the run once the holders let go" on a right program | `granted.test.mjs` › same name. Only change: as above |

## Kept as they are

- Each original file holds one test, so each redraft file holds the whole file.
- Staying where they are: `3588/twins.json` and `twins/skips-the-rebuild` (#3588.704a8c75's twin, kept by ID; its `find` line is the base's `ready(root);` and goes stale only if the change rewrites it), `README.md`, `BASE-FAILURE.txt`. No twins here.
- Criteria 3 (`#3588.56831124`, the 3296 and 3567 suites unchanged) and 4 (`#3588.1ab9c87c`, by diff review) have no test, as in the original.

## Runs

On the Linux machine (arm64, 20 cores, node v24.22.0, 1-minute load 220 to 306), each run in a unit capped at MemoryMax=24G, CARGO_BUILD_JOBS=2, on the tests' own throttle tables; `buildLimit()` read 6.

The throwaway right program, from the issue's text alone: the base's `scripts/affected.mjs` with one change in the timed jobs' loop. Before each timed job, when a binary of the run's plan is missing, it asks one build grant of its own, waiting `min(30, time left)` minutes. With the grant it runs the base's check under it, so `buildBinaries` and the in-place builds pass through. With no grant and less than 30 min left, it sets the bound and builds nothing. Otherwise it throws `INCONCLUSIVE no grant: no build grant came within <min> min to build again what a cleanup removed`. The twin is the base with the timed loop's `ready(root);` removed, as `3588/twins/skips-the-rebuild` does. All copies were outside this checkout and are deleted; they prove nothing about the real change.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test 3588-redraft-3549/bound.test.mjs 3588-redraft-3549/granted.test.mjs` | throwaway | both pass | #3588.7a8aaa71 pass (183 s, run ended at the bound), #3588.704a8c75 pass (65 s) |
| same | base `d303e2b64` | #3588.7a8aaa71 fails as named, #3588.704a8c75 passes (regression protection) | #3588.7a8aaa71 fail: "affected.mjs was still running 260 s after its start, … its rebuild before the timed job was still waiting for a build grant behind the holders" (6 holders, holding: 6); #3588.704a8c75 pass |
| `node --test 3588-redraft-3549/granted.test.mjs` | twin `skips-the-rebuild` on the base | fail as named | #3588.704a8c75 fail: "no build grant was granted to the run once the holders let go: nothing was built again of what the cleanup removed" |
| `node --test 3588/bound.test.mjs 3588/granted.test.mjs` (the originals) | throwaway | fail, which is why they are redrafted | both fail, with the dispute's words (`3588/DISPUTE-3549.md`) |

Under #3549, read from the throwaway's rebuild's own entries in its table's log (a second throwaway run with a write-only probe, both tests passing again):

- #3588.7a8aaa71: the state can be set up. Six holders hold the ceiling, so the rebuild is never admitted: it asked with 2.60 min left and logged `timeout` 156 s later, at the bound. No admission means no turn wait.
- #3588.704a8c75: the state can be set up. The rebuild was admitted (`granted`, `waited` 20 294 ms, just after the holders let go) and took its pool `turn` 2 ms later, with 2.27 min left. #3549's unbounded turn wait did not run past the time left here: the test table's pool is its cores less one (19), and the holders' 6 turns leave tokens free. The turn wait is still not capped by the bound: a pool full of other runs' turns would keep an admitted rebuild waiting, which no criterion here sets up.
