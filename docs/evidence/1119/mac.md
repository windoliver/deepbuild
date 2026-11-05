# #1119 perf's kept copies per machine, on the Mac (2026-11-04)

Run by the Mac's Remote Control session in `~/private/deepbuild-core`, with the owner approving writes to the real
HOME and the real `timed` grant. Readings, not budgets.

- **Machine:** Mac15,12 (MacBook Air, 8 cores), macOS 14.7.7, Node 24.22.0, on AC power. The run held the Mac's
  lock alone.

## Suites at `5c13c2e3`

- `node --test tests/acceptance/1119/*.test.mjs tests/perf.test.mjs`: 19 tests, 19 pass.
- Twin `path-keyed-copy` over `scripts/perf.mjs`: 3 tests, 3 fail, as they should. `scripts/perf.mjs` was restored
  afterwards, and `git status` was clean.

## The first real runs, at `5c13c2e3`: ENOBUFS

Four perf runs, two at the merge base `a2ea54a5` and one each from worktrees t3-a and t3-b. All four printed
`BLOCKED perf: spawnSync git ENOBUFS` within 0.7 s, before any copy. The cause was that `git archive a2ea54a5` is
147,927,040 bytes, over the 128 MiB `maxBuffer` of perf's `run()`; main has the same bug. It was fixed in
`c48d66c9`, which streams `git archive | tar`, with a 140 MiB regression test.

## The rerun at `06032daf`: past ENOBUFS, then stopped by main's allowance

Two worktrees of one commit, `npm ci` in each, run in turn with the observation
`{"status":0,"elapsedMs":1,"cpuMs":1,"peakBytes":1}`:

| Run | Kept copy before | Record | Verdict | Wall / user / sys |
|---|---|---|---|---|
| t3-a | empty (the first run on the machine) | `perf: base copy ~/Library/Caches/deepbuild-perf/MacBook-Air-97/base/copy: wrote 6391 files, deleted 0; rewrote what the last run left with other bytes: nothing` | `BLOCKED perf: spawnSync /usr/bin/time ETIMEDOUT` | 2033 s / 3732 s / 337 s |
| t3-b | t3-a's | `perf: base copy ~/Library/Caches/deepbuild-perf/MacBook-Air-97/base/copy: wrote 0 files, deleted 31; rewrote what the last run left with other bytes: nothing` | `BLOCKED perf: spawnSync /usr/bin/time ETIMEDOUT` | 1698 s / 111 s / 26 s |

- **The second worktree landed on the first's copy.** It wrote 0 files and deleted 31 that the first run's checks
  had left outside the tree. Its CPU fell from 3732 s to 111 s.
- **Each run stopped at perf's own allowance for a copy's checks.** That is the preflight budget's
  `elapsedMs × (1 + margin)`, 900 s × 1.5 = 1350 s, which is less than the full checks take on this Mac. This
  comes from main's frozen budget, not from this change.
- **No AC1 count yet.** t3-b's base side shows 755 units whose `invoked.timestamp` is newer than its start. t3-a
  was stopped partway through its checks, so these are most likely builds it never reached. The timestamp also
  can't tell a rebuild from a fingerprint check, so this is no count for AC1. A rerun that lets the base side settle
  first and counts the artifacts written (`.rlib`, `.rmeta`, binaries) was asked of the Mac.
- **AC3 "before" could not be read.** Main's perf with only the archive call streamed, from a third worktree,
  started a fresh path-keyed copy of about 20 GB with 15 GB free, and it was stopped. That a new worktree needs a
  whole new copy is the cost this issue removes. t3-a's cold 2033 s is what main pays in every new worktree.
- To free disk, the owner's OK cleared `~/Library/Caches/deepbuild-perf` (38 GB) afterwards.

## The settle run at `0f132a2a`: a lock race, and checks that outlive their allowance

Mac15,12 (M3, 8 cores), macOS 14.7.7, Node 24.22.0. Worktrees t3-a and t3-b at `0f132a2a` after `npm ci`, the
kept copies empty at the start. Files are in `~/deepbuild-handoffs/1119-mac/` on the Spark.

**Suites:** `node --test tests/acceptance/1119/*.test.mjs tests/perf.test.mjs` passed 19 of 20. The failure was
`tests/perf.test.mjs:319`, "perf runs racing for a killed run's lock never check at the same time, however they
interleave": `2 runs checked: [[1793871512894,1793871513894],[1793871513448,1793871514449]]`, two check windows
overlapping by 0.45 s.

| Run | Record | Verdict | Wall / user / sys | Built |
|---|---|---|---|---|
| a1 (t3-a, first) | `wrote 6391 files, deleted 0; … nothing` | `BLOCKED perf: spawnSync /usr/bin/time ETIMEDOUT` | 2161 s / 4536 s / 375 s | 2837 |
| a2 (t3-a, again) | `wrote 0 files, deleted 32; … nothing` | `BLOCKED perf: Command failed: npm ci` (`ENOTEMPTY … base/copy/node_modules/.vitest-cache`) | 26 s / 7 s / 13 s | 0 |
| b (t3-b) | `wrote 0 files, deleted 30; … nothing` | `BLOCKED perf: spawnSync /usr/bin/time ETIMEDOUT` | 1430 s / 109 s / 19 s | 39, none of them deep-show |

- **The lock race was this change's.** `underTakeover` made its mark with `writeFileSync(…, { flag: 'wx' })`, which
  creates the file empty and writes the pid after. A run that lost the race and read it in between read `''`, took
  the mark for a killed run's, removed it and went on beside its holder. Fixed in `964dc5d2`: the mark is written
  to `lock.takeover.<pid>` and linked into place, as the lock already is. Its test holds one run's mark empty for
  2.5 s. On the Mac it failed 3 of 3 at `0f132a2a` (`2 runs checked: [[1793916666300,1793916674302],
  [1793916673923,1793916681926]]`, in `t3-mark-unfixed.txt`); with the fix, the 1119 and perf suites passed 21 of 21
  three times (`t3-mark-fixed.txt`). The Spark could not run perf.test then: its load stayed over its 20 cores.
- **A check stopped at its allowance keeps running; that is main's.** `measureOnce` in `scripts/benchmark.mjs`
  times the checks with `spawnSync('/usr/bin/time', …, { timeout })`, which kills only `/usr/bin/time`. On the Spark,
  a command it ran wrote its file 2 s after `ETIMEDOUT`. On the Mac, a1's checks most likely kept building in the
  kept copy after perf released the lock: a2's `npm ci` met a `.vitest-cache` still being written, and b used 109 s
  of CPU in 1430 s and counted builds it may not have made. So **b is no AC1 count.** The fix is its own task.
- **t3-b2 (rerun of b, nothing left running):** a cold start, not a settled one. The Mac's hostname had changed from
  `MacBook-Air-97.local` to `MacBook-Air-97`, so perf made a new per-host folder (25 GB, beside the old 47 GB one)
  and rebuilt it all: `wrote 6391 files, deleted 0`, `ETIMEDOUT`, 2095 s / 3843 s / 335 s, 2835 built. The earlier
  runs in this file were also under `MacBook-Air-97`, and the settle run under `MacBook-Air-97.local`: macOS's name
  changes with the network.
