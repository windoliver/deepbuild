# #1633: `node scripts/affected.mjs`, and what its NEW failures are

Run on 59712fbd (this branch merged with main at 63e9e67a), Linux (Spark), 17943 s at load 11:

```
FAIL affected: 1412 new, 186 already failing on main, 499 inconclusive or blocked, 21 listed skips, 2726 passed, in 17943 s at load 11
INCONCLUSIVE 64 timed files were not run; --timed runs them under a timed grant
INCONCLUSIVE 36 slow files were not run; --slow runs them
```

No WIDE line: the run wasn't `--wide`. The other INCONCLUSIVE lines name single tests (screenshots, perf, timed reference
machines) that this machine can't take.

This change's own tests passed inside the run: `packages/hub/test/reopened-items.test.ts` 6 of 6, and
`tests/acceptance/1633/` 4 of 4.

## The 1412 NEW, checked against main

`scripts/known-failures.json` lags main, so each NEW failure was run again on a scratch worktree of the base, 63e9e67a.

- **The other 1223 lines** are lint lanes (fmt, secrets, deps, canvas-lint, slots, guide) and two drift checks
  (deep-app `record reader`, canvas closures). None names a file this change touches.
- **Test files, 189:**
  - 154 of the 169 vitest files fail on the base too.
  - All 18 `node --test` files fail there too.
  - So do the cargo tests: deep-app's `acceptance_1141` / `1141_memory` and deep-hook's spool tests.
- **The files that passed on the base,** run again on this branch alone at low load:
  - 14 pass. They failed in the run under its load.
  - `tests/acceptance/1348/fixture.test.ts` fails on the base too when run alone ("the lane wrote no dump").
  - `tests/acceptance/824/sessions/planted.test.ts`, `waiter-keeps-transcript`: this is the checkout's build, not this
    change.
    - Setup runs the newer of `target/release/deep-hook` and `target/debug/deep-hook` (`deepHook()` in
      `packages/hub/src/paths.ts`).
    - Only an `env-plants` build reads `DEEP_HUB_PLANT`. In this checkout the newer build was a release build without
      it, so the plant never ran.
    - The base worktree's newer build happened to be an `env-plants` debug build.
    - With `cargo build -p deep-hook --features env-plants` made the newer build here, the file passes 2 of 2.
