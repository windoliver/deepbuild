# AC4 drift: blind redraft

**Dispute.** The original test "AC4 the reference table passes the drift test as committed, and a planted row that calls the budget class a registry fails it, naming the list and both closures" in `../closures.test.ts` plants its row on the first line of `docs/canvas-primitives.md` that starts with `| Budget class |`. At the base that line is the header of the budget classes table (line 90). It isn't the row of the "Registries and closed lists" table (line 1253). Two other tables, around lines 650 and 9323, also have rows that start that way. The original then asserts that this line holds `| closed: budget |`, so it fails on any correct program.

**What changed.** Only the row lookup. The redraft finds the section that starts at the `### Registries and closed lists` heading and ends at the next heading. It requires exactly one `| Budget class |` row in that section, checks that the row's closure cell is `closed: budget`, and replaces that cell with ``registry `budget.class@1` ``. The surface and the expected values are the original's:

- `node scripts/canvas-closures.mjs drift --root <tree>` runs on `scratchTree(..., { docs: true })` from `../helpers.ts`.
- On the committed reference the run exits 0 with a `PASS drift` line and no `FAIL drift` line.
- On the planted copy it exits 1. A `FAIL drift` line names `Budget class`, `budget.class@1` and the table's closed budget closure (`/closed:? ?budget|closed \{?reason:? ?budget/`).

This redraft was written from the issue, `docs/canvas-primitives.md` and the base commit, plus `../helpers.ts`. It doesn't depend on any implementation.

**Base run.** The test fails at the base for the expected reason: `scripts/canvas-closures.mjs` doesn't exist, so the first assertion fails (exit 1, MODULE_NOT_FOUND). The row lookup was also checked on its own at the base: it finds one row, at line 1253, with `closed: budget`. `tsc -p tsconfig.json` exits 0. See `BASE-FAILURE.txt`.

Run with `node node_modules/vitest/vitest.mjs run --root tests/acceptance/200 redraft/closures-drift-redraft.test.ts`.
