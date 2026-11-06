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

## The key per machine and clone, at `c815c505` and `75b3b1ad`

Mac15,12 (M3, 8 cores), macOS 14.7.7. Worktrees t3-a and t3-b at `c815c505` after `npm ci`, in a new kept folder
(`deepbuild-perf/<host>-<clone>` is a new name). With the owner's OK the old `MacBook-Air-97` folder (47 GB) was
deleted first. Files are in `~/deepbuild-handoffs/1119-mac/c815c505/` on the Spark.

**Why the key changed.** Suites 246, 568 and 583 spawn `scripts/perf.mjs` in fixture repositories with the user's
real cache. Keyed by machine alone, they shared the clone's folder and lock: they could block a real preflight, be
blocked by one, and replace the real base copy with their fixture, so the next real run rebuilt every crate. On the
Spark, suite 246 run with a scratch HOME kept its fixture's copies at `<HOME>/.cache/deepbuild-perf/spark-c89f`, the
real clone's name; at `c815c505` it keeps them at `spark-c89f-37241af8fb39`, beside the clone's `spark-c89f-4e3e746b8b7a`.

**Fail first, then pass:**
- `tests/perf.test.mjs` with `4b65552d`'s perf.mjs (`t3-key-unfixed.txt`, load 3.5): 13 of 20 pass. The two new
  tests fail at their assertions: "another repository on the machine…" with `BLOCKED perf: another perf run
  (process 66316) is using …/deepbuild-perf/MacBook-Air-97.local`, and "a Mac that adds .local…" with "the copies
  moved when the machine's name lost .local". Five lock tests fail too: they plant their lock at the new name.
- With the fix, `tests/acceptance/1119/*.test.mjs tests/perf.test.mjs`: 23 of 23, three times (load 3.3 to 4.7).
- At `75b3b1ad` (the host's first label, after the Mac's name became `MacBook-Air-97.attlocal.net`, a domain its
  router's DHCP gives): the domain test with `c815c505`'s perf.mjs fails, "the copies moved when the machine's name
  gained or lost a domain: …/fixture-mac-08fe51149fb8/…, …/fixture-mac.attlocal.net-08fe51149fb8/…"
  (`t3-domain-unfixed.txt`); with the fix, 23 of 23 (`t3-final.txt`).

**Settle runs at `c815c505`**, one at a time, each after no checks, perf, lanes, cargo or rustc process was left and
the 1-minute load was below 8. Every run's hostname was `MacBook-Air-97.attlocal.net` and its kept folder
`MacBook-Air-97.attlocal.net-dd61c41bd5e8`, one folder for both worktrees.

| Run | Load (1/5/15 min) | Record | Verdict | Wall / user / sys | Built |
|---|---|---|---|---|---|
| a1 (t3-a, cold) | 4.8 / 4.6 / 3.7 | `wrote 6929 files, deleted 0; … nothing` | `BLOCKED perf: spawnSync /usr/bin/time ETIMEDOUT` | 1981 s / 3558 s / 285 s | 2563 |
| a2 (t3-a) | 6.8 / 30.8 / 30.5 | `wrote 0 files, deleted 33; … nothing` | same | 1409 s / 99 s / 19 s | 172 |
| a3 (t3-a) | 5.3 / 27.3 / 38.4 | `wrote 0 files, deleted 33; … nothing` | same | 1464 s / 140 s / 32 s | 163 |
| b (t3-b) | 6.1 / 10.7 / 17.5 | `wrote 0 files, deleted 33; … nothing` | same | 1469 s / 170 s / 33 s | 116 |

- **No run rebuilt what another built.** a2 and a3 have 1 artifact file in common, a3 and b 1; 5 to 8 unit names
  repeat. Nearly all are `.rmeta` of third-party crates (gpui, wgpu, cranelift, toml, …). Each run carries on the
  base side's first build, which main's allowance for the copy's checks (1350 s, the frozen `preflight` budget's
  900 s × 1.5) stops every time on this Mac. So none of these is an AC1 count: the base side has never finished.
- b's second worktree did land on a's copy: `wrote 0 files`, the same folder, and only artifacts never built before.
- `deleted 33` is perf pruning what the last run's checks left in the copy; it starts no rebuild.
- user/sys time after `ETIMEDOUT` counts only what `/usr/bin/time` reaped, not the stopped checks' tree.

**R3, an uncapped settle at `c815c505`: INCONCLUSIVE, the Mac's disk filled.** It was the base side's full build with no
allowance (`node scripts/checks.mjs` in the kept base copy, `CARGO_TARGET_DIR` its target), then b in t3-b again (b2).
Its files are in the handoff folder `c815c505/r3/`.
- The settle started at 00:20 with load 3.6. Its parallel vitest ended after 1593 s, and its serial lane ran under
  `deep lease`, unleased because no hub was running.
- That vitest died at 06:28 with no error text. By then the disk was full: 430 MB free of 460 GB. The kept base
  target alone was 77 GB.
- `deep lease` then waited on the dead leader's group, whose pool worker and test children lived on. It hung until
  13:56, when the Mac session stopped it (exit 143). The Mac session reproduced the hang, and the fix is on its own
  branch (`claude/lease-leader-exit`), apart from this PR.
- The kept target was then deleted to free the disk, so b2's built list can't be made. b2 got only as far as its
  first lines.
- So AC1 `#1119.a84127b8` is still unproven on real crates. A rerun needs about 80 GB free on the Mac and the
  `deep lease` fix, or a settle that skips the serial lane.
