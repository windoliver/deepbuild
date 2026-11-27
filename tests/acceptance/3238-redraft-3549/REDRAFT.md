# Blind redraft of #3238's serial and no-grant tests under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. Today it is a fixed limit, 1 on macOS and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted while fewer than the ceiling are held, and then takes a turn on the machine's pool. `tests/acceptance/3238/helpers.mjs` hard-codes `BUILD_SLOTS` as 1 on macOS and 2 elsewhere, and two tests hold build grants by it: `serial.test.mjs` so that one slot is left, `no-grant.test.mjs` so that none is. Under the ceiling 4 slots (5 on Linux) are left in the first and 3 (4) in the second, so each test's `scripts/lease` command is granted at once, and the test fails on a right program. This folder redrafts the two tests from #3238's criteria, #3549 and its comment (the owner's answer (a)), and the base `e09236864`. The surface for the count is the one #2833's redraft settled: the machine's build limit is the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line.

The originals are not edited or deleted; a person approves the swap. Run with:

```
node --test tests/acceptance/3238-redraft-3549/serial.test.mjs
node --test tests/acceptance/3238-redraft-3549/no-grant.test.mjs
```

Both import `tests/acceptance/3238/helpers.mjs` unchanged; its `holdBuild(box, n)` takes the count. `helpers.mjs` here holds `buildLimit()`. It reads the source text of the checkout's `scripts/throttle.mjs`, the file each test copies into its sandbox, because `LIMITS` isn't exported. It requires exactly one `const LIMITS =` line of the form `process.platform === 'darwin' ? {…} : {…}`, picks the branch for this platform, and requires exactly one `build` key there whose value is a positive integer literal. Anything else throws, and it never falls back to a default number.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3238/serial.test.mjs` › #3238.52168c75 two scripts/lease commands started together with build at 1, no hub and no built CLI run one after the other, each under a top-level build grant in the log | #3238.52168c75 | It holds `BUILD_SLOTS - 1` build grants, none on the Mac and one on Linux, so that one slot is left. Under the ceiling 4 (5) are left, both commands are granted at once, and the test fails naming the second, on a right program | `serial.test.mjs` › same name. The only change: `holdBuild(box, buildLimit() - 1)`, so the holders take every slot but one and build is at 1 for the two commands, as the original already has it on Linux. The waits, the assertions and the expected values are the original's, line for line |
| `3238/no-grant.test.mjs` › #3238.4febe21a with every build slot held and DEEP_LEASE_WAIT=0, scripts/lease prints INCONCLUSIVE no grant, exits non-zero and never starts its command | #3238.4febe21a | It holds `BUILD_SLOTS` build grants, 1 on the Mac and 2 on Linux. Under the ceiling not every slot is held, so the command is granted and starts, on a right program | `no-grant.test.mjs` › same name. The only change: `holdBuild(box, buildLimit())`. The wait, the assertions and the expected values are the original's, line for line |

## Kept as they are

- `3238/inherited.test.mjs`, `admitted.test.mjs`, `cli.test.mjs`, `design.test.mjs` and `hub.test.ts`, and `twins.json` with the twins. The brief for this redraft names only these two tests for #3238, and the others aren't reviewed or run here. `inherited.test.mjs` holds `BUILD_SLOTS` build grants too.
- `3238/lane.json` says the folder runs alone for `hub.test.ts`, which starts a hub and a binary of the checkout's `target/`. Neither redrafted test starts a hub or a binary, so no lane file is copied here.

No twins here: `tests/acceptance/3238/twins.json` maps #3238.52168c75 (`runs-directly`) and #3238.4febe21a (`runs-after-wait`), and the redraft keeps both IDs.

## Runs

None ran: every run below reads `INCONCLUSIVE`. Testing was bounded at one hour, the wait for a grant included, and went through the machine's throttle in one request, made from the checkout on macOS (18 cores, node 24.22.2, a 1-minute load between 49 and 135 where it was read):

```
$ node scripts/throttle.mjs test --wait 60 -- node <a script that makes each run below, one after the other>
INCONCLUSIVE no grant: no test grant came within 60 min
```

It asked at 2026-11-26T23:36:25Z and ended at 2026-11-27T00:36:26Z, exit 3. The script never started, so no test ran, on the base or on the throwaway, and none was run bare in its place.

| Run | Program | Expected | Result |
|---|---|---|---|
| `node --test tests/acceptance/3238-redraft-3549/serial.test.mjs` | the base `e09236864` (Mac build limit 1) | pass | `INCONCLUSIVE`: not run |
| `node --test tests/acceptance/3238-redraft-3549/no-grant.test.mjs` | the base | pass | `INCONCLUSIVE`: not run |
| `node --test tests/acceptance/3238-redraft-3549/serial.test.mjs` | a throwaway: the base with only `build: 1` → `build: 4` and `build: 2` → `build: 6` on the `LIMITS` line, the ceiling alone and nothing else of #3549 | pass | `INCONCLUSIVE`: not run |
| `node --test tests/acceptance/3238-redraft-3549/no-grant.test.mjs` | the throwaway | pass | `INCONCLUSIVE`: not run |
| `node --test --test-name-pattern='#3238.52168c75' tests/acceptance/3238/serial.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run |
| `node --test --test-name-pattern='#3238.4febe21a' tests/acceptance/3238/no-grant.test.mjs` | the throwaway | fail, which is why it is redrafted | `INCONCLUSIVE`: not run |
| `node --test tests/acceptance/3238-redraft-3549/no-grant.test.mjs` | a planted wrong program: the throwaway with #3238's own twin `runs-after-wait` (`tests/acceptance/3238/twins/runs-after-wait/scripts/lease`) as its `scripts/lease` | fail at "its command … started with no build grant" | `INCONCLUSIVE`: not run |
| `node --test --test-name-pattern='#3238.4febe21a' tests/acceptance/3238/no-grant.test.mjs` | the same planted program | fail, as on the throwaway alone, so the original tells the two programs apart no longer | `INCONCLUSIVE`: not run |

Checked without a test run, which proves nothing about the tests: each file here parses (`node --check`), each name it imports is exported by the module it names, and `buildLimit()` returned 1 in the checkout and 4 in the throwaway, whose `scripts/throttle.mjs` differed from the base's in the `LIMITS` line alone. The throwaway is deleted; no run made an output.
