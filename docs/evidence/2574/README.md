# #2574 AC1 evidence: shards on Linux (the Spark, ext4, GNU cp 9.4), 2026-11-15

- `tests/acceptance/2574/shards-linux.test.mjs` (blind, first): on base `SHARD 1 not used: Try 'cp --help' for more
  information.` for each shard (`BASE-FAILURE.txt`); passes with the fix.
- A shard of this worktree made by `node scripts/shards.mjs <worktree> 24`:
  `SHARD 24 …: made, at tree 065bf77fb968…, node_modules cloned` in 27.8 s, 861 MB, no `target/`, `git status` clean,
  `scripts/shards.mjs` byte-identical to the worktree's. (The shard was removed afterwards.)
- `node scripts/affected.mjs` at `5f0fed03f`, under `systemd-run -p MemoryMax=24G`: `SHARD 1`, `2` and `3 …: reused`, no
  `not used` line, and the alone groups ran in them (`RUN v5.0.5 ~/deepbuild-shards/1`,
  `tests/acceptance/1015/redraft/own-repo.test.ts` 2 passed there). The same run on `main`'s scripts at the same hour
  printed `SHARD 4 not used: Try 'cp --help'` for every shard. Whole run 1,707 s at load 20.
- Its failures are main's: the lints are the same on a clean `origin/main` checkout; `tests/acceptance/1114/affected.test.mjs`
  and `timed-list.test.mjs` fail the same 3 tests with `main`'s `scripts/shards.mjs` in the same tree;
  `tests/acceptance/33/bootstrap.test.ts` fails on its own helper's `/bin/cp -cR` (macOS's flag) and a missing signed tag.

# #2574 AC2, AC3, AC4 evidence (the Spark), 2026-11-15

- AC2, the run's one test grant: `tests/acceptance/2574/grant.test.mjs` (blind, first) failed (a), (b) and (d) on base
  1ab891283 (`BASE-FAILURE-AC2.txt`); all pass with the change. A run started under a caller's build or test grant (the
  #1115 tests' `throttle.mjs build -- affected.mjs`) passes through on it and keeps it for its timed blocks: a first
  version released the caller's grant instead, so its timed request turned top-level and waited for load under the core
  count; the three #1115 `--timed` tests timed out at 300 s on it and pass with the fix.
- AC3, wide: `tests/acceptance/2574/wide.test.mjs` (blind) failed the `packages/b/src/index.ts` row and the real-tree
  check on base (`BASE-FAILURE-AC3.txt`); passes with the change. `tests/affected.test.mjs` follows the owner's
  acceptance of the trade-off on the issue (2026-11-15) and adds a helper case: the package rule reads the reached
  test's folder, not that of the helper that starts the build (it failed on the first version, which read the helper's).
- `node scripts/affected.mjs --list packages/hub/src/log-reads.ts`: base 1ab891283 selects 1,206 files (73 SKIP); the change
  selects 143 (4 SKIP), and its WIDE line counts 1,144.
- AC4: AGENTS.md's Proof line names the corrected paths' rerun; the file stays under one page (42 lines).
- `node scripts/affected.mjs` at b61bd1722 (this branch on main b1fc9abb2), under `systemd-run -p MemoryMax=24G`:
  `FAIL affected: 203 new, 41 already failing on main, 7 inconclusive or blocked, 91 passed, in 2432 s at load 21`, no
  ENOSPC. The run queued once and its shards ran on its grant. Each of the 203 NEW FAIL lines, checked in a clean
  detached worktree of the merge base b1fc9abb2 (`npm ci`, build, the same commands), the same day:
  - 194 lint lines, each lint's FAIL lines identical at the merge base (paths normalised): size-ratchet 62,
    repo-rules 50 deps + 8 secrets, conformance-lint 24 code mappings, vendor-rebase 19, canvas-lint 11 new (52 FAIL
    lines either side), color-literal-guard 6, canvas-closures drift 1, record-reader-guard 1. slots-check's 12 lines
    are `ps -Awwo: ENOBUFS` on a process table over 1 MiB (1.13 MB measured), the machine: the merge base hit it too.
  - 9 test lines. At the merge base the same tests fail: #1114.9fc6be33, #1114.f3e38214 ×2, #2144.35365960,
    `tests/shards.test.mjs`'s merge-base test (the merge base now has Linux shards, so that test's wrong program runs
    them at once too) and #33.6932417b ×3. #1113.a0183037 failed on `cargo metadata`: under the test's sandbox HOME,
    rustup's toolchain download timed out (os error 110). Rerun on this branch with the network up, all three #1113
    tests pass (2259 s).
  - The 7 inconclusive or blocked: #1123's three capture-redraft tests read BLOCKED on an offline `cargo build` and fail
    at the merge base; #1015's own-repo redraft ×2 BLOCKED; #1114.dc4376fb and #1114.f626edec INCONCLUSIVE at load
    87-102 (the merge base reads dc4376fb INCONCLUSIVE at load 24 too). The by-hand and slow files are listed.
