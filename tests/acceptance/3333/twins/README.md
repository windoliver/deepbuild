# Twins for #3333

Each twin is a whole copy of `scripts/lanes.mjs` at the base (3c564bbdd) with one change to the end of `cargoResults`.
Two of them start from a reference reading of the fix: a run that exits non-zero with no failed target, no passed
test and output starting with the throttle's `INCONCLUSIVE no grant: <reason>` line returns `noGrant: <reason>`.
Under that reference reading (kept out of the repo), all five tests pass.

- `every-exit-inconclusive` (for `#3333.5a039cd1`): every non-zero exit with no failed target reads as a missing grant
  (`noGrant`), a compile error too. Both compile-error tests fail at
  `cargoResults reads the compile error as a FAIL naming it`; the no-grant tests pass.
- `no-grant-fail` (for `#3333.82f286dc`): the refusal is recognised and named, but as a failure `cargo test` in state
  `FAIL` with the throttle's line as its message. The AC3 test fails at `no failure of the refused run reads FAIL`
  (the AC1 tests fail too); the compile-error tests pass.
- `no-grant-beside-fail` (for `#3333.82f286dc`): the refusal sets `noGrant`, yet the base's `cargo test` `FAIL` row
  (`exited 3`) stays beside it, so readRun's verdict reads INCONCLUSIVE while a FAIL row remains in the record. The
  AC3 test fails at `no failure of the refused run reads FAIL`, the AC1 row test at
  `cargo ran no test, so no row passes or fails`; the compile-error tests pass.

Each was run by copying its `scripts/lanes.mjs` over the clone's, running `node --test tests/acceptance/3333/*.test.mjs`,
and restoring with `git checkout -- scripts/lanes.mjs`.
