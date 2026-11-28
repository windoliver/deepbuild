# 0006: The web-export task's set ceilings

Status: accepted (#3518). The design states the rules these serve under Export: web player (a record in the repository gives each set's compressed size) and Numbers version 0 has to hold (a ceiling only moves down, and a count can be one); the report's fields and the ceilings' names are in `tests/acceptance/3518/README.md`. The decisions below are the ones written nowhere else.

## What a set's count is

- **A set's count is the record's size, and only while the record is true.** `benchmarks/web.mjs`, `untrueRecords`. Each run measures the two files the record names for a set at Brotli 11, each alone with its length as the size hint, as `scripts/player-wasm.mjs` writes the record. A record that differs by any amount fails the run, naming the set and both numbers. The lanes read a failed run BLOCKED and never as a count, so a ceiling can't be met by editing the record.
- **A set whose file can't be read has no count.** `benchmarks/web.mjs`, `brotliOrNull`. Its bytes and its share are `null`, never 0, so `judgeCount` reads its ceiling INCONCLUSIVE. The run still exits 0, so the other sets are read.
- **A share is of 12,000,000 B.** `benchmarks/web.mjs`, `PLAYER_LIMIT_BYTES`. It is #172's 12 MB as `tests/acceptance/172/budgets.test.ts` reads it, a fraction and not a percent.

## What a run costs

- **A file's Brotli 11 size is kept by the SHA-256 of its bytes.** `benchmarks/web.mjs`, `brotliOrNull` and `keptSizes`. The three sets take about 150 s of CPU to compress. A judge runs the command some fifty times, and holds its p50 and peak memory within 50% of its merge base's and its instructions retired within 2%. So a size is measured once and kept in the user's cache, under `deepbuild-perf/` beside the perf lane's counter, in a folder named for the Brotli library's version.
- **A file that hasn't changed isn't read again.** `benchmarks/web.mjs`, `brotliOrNull`. Reading and hashing the sets' 76 MB on every run cost 1.9% more instructions than the run before the ceilings, which the perf lane's judge couldn't tell from its 2%. So beside each size the cache keeps, by the file's path, the file's device, inode, size and its times of last change, as git's index does: a run that finds them the same takes the size kept, and any other reads the bytes. A copy of the tree made anew, as a budget window makes one for each commit, reads and hashes its files once and compresses none it has measured before.
- **A kept entry is written whole, and a broken one is measured again.** `benchmarks/web.mjs`, `keep` and `wholeBytesOrNull`. It is written beside its name and renamed onto it. A size that isn't a whole number above 0 is not trusted.

## With and without a build

- **The export runs only in a checkout with a debug build.** `benchmarks/web.mjs`, `hasDebugBuild`. With no `target/debug` the run gives the sets alone, and the export's three numbers are `null`: a set's bytes come from committed files, with no build. With one, the run must find `deep-show`, as it did before the ceilings, so a lane whose build of it failed stays BLOCKED and never passes with the export unmeasured. `target/` alone doesn't say a build was made, since `scripts/open-issues.mjs` writes there.

## Who judges a ceiling

- **The line that names a set over its ceiling decides nothing.** `benchmarks/web.mjs`, the loop over the record's sets. It compares the set with the ceiling in this checkout's own budgets and gives the difference, for whoever runs the task, and the run still exits 0. The lanes judge the ceiling through `judgeCount`, by the merge base's value (#2665), and their line gives the set and both sizes.
- **The ceilings landed as the task's one move with a reason.** `benchmarks/budgets.json`, `web-export`'s `changeReason`. #12 lets a task with no `changeReason` move its limits once, with a reason and no approval. The task took its reason with its first ceilings, so no such move is left: a later raise or removal is refused without an approved proposal.
