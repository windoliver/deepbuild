# #1123: alone-block wall time before and after, a reading

The folders that move, #374 and #375 (8 files, 23 tests), run through the unit lane's own two vitest blocks on one commit. That is the scope the owner set on 2026-11-13. Every run passed 23 of 23.

| Round | Before: the 8 files in the alone block | After: the alone block | After: the same 8 files in the parallel block | 1-minute load at start, before / after |
|---|---|---|---|---|
| 1 | 127.76 s (lane 128.83 s) | holds none of them | 4.99 s (lane 8.81 s) | 164 / 102 |
| 2 | 22.01 s (lane 22.86 s) | holds none of them | 4.58 s (lane 7.94 s) | 102 / 92 |
| 3 | 22.74 s (lane 23.53 s) | holds none of them | 4.28 s (lane 7.64 s) | 94 / 84 |

The first number is vitest's own Duration for the block. The lane's number is `runLanes`' elapsed time around it, which on the after side includes the run's one build of the three binaries into its private `bin/`.

## How it was taken

- `run-pair.sh` and `driver.mjs`, here, under one build grant of the machine's throttle. One checkout at `0915f3873`, whose merge base with main is `f6d811c79`.
- **Before** is that commit with the merge base's `scripts/lanes.mjs`, `scripts/affected.mjs` and `scripts/proof-runs.mjs`, and the merge base's `helpers.ts` of the two folders. Its `alone` list names both folders, so the lane's serial command runs them one file at a time, each file building its binary first.
- **After** is the commit as it is. Neither folder is in `alone`, so the lane's parallel command runs them, reading the binaries from `DEEP_BIN_DIR`.
- Both sides share the checkout's one fixed-path `target/`, built cold once before round 1 with the three binaries in one cargo call (546 s, `warm.txt`).
- Each run's log, and the evidence record the lane wrote for it, is beside this file. `meta.txt` has the machine and the tools.

## What it does not say

- **Round 1's before is not like the other two.** 103.6 s of it is `tests/acceptance/375/never.test.ts`, which took 3.4 s in rounds 2 and 3. Its helper builds `deep-layout` and `deep-text` as a pair, which the warm-up had not built in that combination. That cause is likely and was not checked.
- **The rest of the alone block was not run.** Its other 446 entries are the same files on both sides. The whole block's wall time is not measured: the 2026-11-12 run of the whole lane stopped at 506 of 1,932 alone files after 6 h 55 min ([mac-run-blocker.md](../mac-run-blocker.md)).
- **These are readings, never budgets.** The load was 84 to 164 on 18 cores throughout. One Mac (Apple M5 Max, macOS 27.2); no Spark.
- An earlier take on the same day, before the machine restarted, lost its logs with `/tmp`. Its numbers are not cited.

The logs leave out the checkout's path (`<checkout>`), the home folder (`<home>`) and the machine's name (`<host>`); nothing else in them is changed. Each run's tree hash differs from the last because the logs written before it are untracked files of that tree.
