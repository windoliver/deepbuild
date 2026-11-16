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
