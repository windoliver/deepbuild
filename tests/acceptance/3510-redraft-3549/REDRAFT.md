# Blind redraft of #3510's three full-class tests under #3549

#3549 changes what the `build` number of `scripts/throttle.mjs` (`LIMITS`) means. It was a fixed limit, 1 on macOS
and 2 on Linux. Under #3549 it is a ceiling, 4 on macOS and 6 on Linux: a build asked for under no grant is admitted
while fewer than the ceiling are held, and then takes a turn on the machine's pool, with no limit on that wait
(`docs/parallel-proof.md`, sections 6 and 13, "Builds on the pool"). `tests/acceptance/3510/` fills "every build slot"
with `SLOTS` from `tests/acceptance/3334/helpers.mjs`, 1 on macOS and 2 elsewhere. Under the ceiling the class isn't
full with them, so the call is admitted at once and two tests fail on a right program before they read their
criterion; the third still passes, but no longer holds every slot. This folder redrafts them from issue #3510, the
design and the base `d303e2b64`, as `tests/acceptance/3334-redraft-3549/` did for #3334.

The originals are not edited or deleted; a person approves the swap. Run with Node 24 and cargo:

```
node --test tests/acceptance/3510-redraft-3549/stalled-line.test.mjs tests/acceptance/3510-redraft-3549/drain.test.mjs tests/acceptance/3510-redraft-3549/under-grant.test.mjs
```

Each file imports `tests/acceptance/3510/helpers.mjs` unchanged and `buildLimit()` from
`tests/acceptance/3334-redraft-3549/helpers.mjs`, which reads the platform's `build` value from the `LIMITS` line of
`scripts/throttle.mjs` and throws on anything else, never a default number. There is no helpers file here.

## What the redraft replaces

| Original (path › test) | Criterion | Why the old scene no longer holds | Replaced by |
|---|---|---|---|
| `3510/stalled-line.test.mjs` › #3510.9618ba88 with DEEP_TEST_GRANT_STALL at 0.05 and every build slot held past the bound, a buildBinaries call throws … | #3510.9618ba88 | `holders(box, SLOTS)` holds 2 of 6 (1 of 4). The call is admitted at once and builds; on a merged tree: "the call returns nothing: it got no grant" | `stalled-line.test.mjs` › same name. The only change: `holders(box, buildLimit())` |
| `3510/drain.test.mjs` › #3510.773f906e with DEEP_TEST_GRANT_STALL at 0.2 and every build slot held for 8 s, … | #3510.773f906e | `holders(box, SLOTS, EIGHT_SECONDS)`: the call is admitted before the timed request is made; on a merged tree: "the call got its build grant after the timed request ended" | `drain.test.mjs` › same name. The only change: `holders(box, buildLimit(), EIGHT_SECONDS)` |
| `3510/under-grant.test.mjs` › #3510.87170af2 with every build slot held, a buildBinaries call made by the command of throttle.mjs build … | #3510.87170af2 | `SLOTS - 1` others plus the wrapper hold 2 of 6: it passes, but not with every build slot held, which its criterion states | `under-grant.test.mjs` › same name. The only change: `SLOTS` is a local `const SLOTS = buildLimit()`, used in its three places (others, the count of granted entries, the message) |

Names, `#3510.<tag>` IDs, waits, assertions, comments and expected values are the original's line for line. Each file
holds one test, so the swap by file carries nothing else.

## Kept as they are

`3510/default-stall.test.mjs` (#3510.7fd1b181, empty table) and `3510/moving-line.test.mjs` (#3510.a06361ca, #3334's
`movingLine`, which keeps six holders a slot in line, as #3334's redraft keeps its moving-line test) don't fill the
class and stay. So do `helpers.mjs`, `twins.json` and the twin `fixed-wait`, which maps #3510.a06361ca and
#3510.773f906e by ID.

## Runs

Linux, 20 cores, node 24.22.0, each run in a memory-capped user unit, on tables of the tests' own. Programs: the base
`d303e2b64`; a throwaway right program, the base with only `buildBinaries`'s two lines changed as the issue asks
(`acquire('build', { stall })`, `DEEP_TEST_GRANT_STALL` or 720, the stall's words), deleted after; the twin
`fixed-wait` laid over the base.

| Run | Program | Expected | Result |
|---|---|---|---|
| the three files here | throwaway right program | pass | 3 pass, 0 fail (#3510.9618ba88, #3510.773f906e, #3510.87170af2) |
| the three files here | base `d303e2b64` | #3510.9618ba88 fails at its criterion; the other two pass (the base's 30-minute wait outlasts the 8 s; #3510.87170af2 is regression protection) | #3510.9618ba88 fails: "the call behind a line that never moved threw within 5 minutes of a stall bound of 0.05 min", call still waiting after 5 min; #3510.773f906e and #3510.87170af2 pass |
| `drain.test.mjs` | twin `fixed-wait` | #3510.773f906e fails | fails: "buildBinaries threw: INCONCLUSIVE no grant: no build grant came within 0.05 min for test binaries" |
| `3510/{stalled-line,drain,under-grant}.test.mjs` | throwaway right program | the two disputed fail, which is why they are redrafted | #3510.9618ba88 "the call returns nothing: it got no grant"; #3510.773f906e "the call got its build grant after the timed request ended"; #3510.87170af2 passes |

Under #3549 each scene can be set up: on a test's own table with no readings only the ceiling decides admission, so
all 6 holders are admitted within a second. In a scratch copy that printed the logs of passing runs, each admitted
build, the call's included, got its turn within about 1 s of its grant (the call's 2 ms after); no call sat in the
unbounded turn wait. #3510.9618ba88's call is never admitted, so it takes no turn.
