# #1633: `node scripts/affected.mjs`, and what its NEW failures are

Run on 92701c02 (this branch, merge base with main 4004257c), Linux (Spark), 65696 s at load 1:

```
FAIL affected: 525 new, 14 already failing on main, 1146 inconclusive or blocked, 21 listed skips, 2501 passed, in 65696 s at load 1
INCONCLUSIVE 77 timed files were not run; --timed runs them under a timed grant
INCONCLUSIVE 36 slow files were not run; --slow runs them
```

There's no WIDE line because the run wasn't `--wide`. The other INCONCLUSIVE and BLOCKED lines name single tests this
machine can't take: screenshots, perf, timed reference machines, and forge or sandbox setups.

This change's own tests passed inside the run:

- `packages/hub/test/reopened-items.test.ts`: 12 of 12.
- `tests/acceptance/1633/`: 4 of 4.

## The 525 NEW, checked against main

`scripts/known-failures.json` lags main. So each NEW failure was run again on a scratch worktree of the merge base,
4004257c. That worktree had its own `npm ci`, a workspace build, and a `deep-hook` built with `--features env-plants`.

### Lint and lane lines: 129

These lines are canvas-lint, size, deps, slots, cards, secrets, the vendor carried-patch table, code mappings, record
reader, `cargo test`, and two vitest unhandled errors.

- Each names a file this change doesn't touch.
- The `size` lines name `packages/hub/src/core.ts` and `server.ts`, which this change leaves alone.
- `cargo test` and the unhandled errors are the `gpui-pre-wgpu` compile error (`PrimitiveBatch::Chrome(_)` not
  covered). The base hits the same error.

### Test lines: 396, in 239 files

Vitest acceptance files, 197:

- 161 fail on the base too.
- The 36 that passed on the base were run again on this branch at low load. 35 pass.
- `tests/acceptance/340/flow/terminal.test.ts` is flaky on both trees, which fail the same counts on each pass:
  - Run twice on each tree, both failed 2 of 4, then 1 of 4.
  - On the branch it first also failed AC2. That was the checkout's `deep-hook`, which had no `env-plants`. With an
    `env-plants` build, AC2 passed, the same build issue #824 hit before.

Package files, 13:

- `contracts` `rust-checks`, 8 `hub` files and 4 `reading` files fail on both trees.
- The failing tests are identical by name.

`node --test` files, 29, holding 52 NEW tests:

- 47 of the 52 fail on the base too.
- The 5 that passed on the base (`1119/ledger`, `1119/warm`, `689/preflight-env`) pass on this branch.
- `605/catalogue-311` criterion 3 fails on both trees.

None of the 525 is this change.
