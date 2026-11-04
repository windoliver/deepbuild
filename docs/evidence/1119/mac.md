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
