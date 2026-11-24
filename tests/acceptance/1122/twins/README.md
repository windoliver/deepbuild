# Twins for the 1122 tests

The base has no `scripts/lane-remote.mjs`, and its `mergeRecords` takes the worst state of a tree's records whole. So
every test but one already fails there at its assertion (`../BASE-FAILURE.txt`), and the before lane needs no twin for
those.

The one that passes on the base is `merge.test.mjs`'s "a Spark FAIL and a Mac pass of the same test id merge to FAIL":
the base's merge gives FAIL too, by taking the worst record. Its wrong program is a merge per test ID that gets this
one rule wrong, and it is here:

- `mac-pass-wins/scripts/lanes.mjs` is the base's `scripts/lanes.mjs` (`c948b6473`) with `mergeRecords` replaced by a
  merge per test ID in which the Mac's row, where a Mac ran the test, stands over any other machine's. It replaces that
  one file and no test or helper. The copy goes stale as `lanes.mjs` changes, and still holds its fault; the test it
  fails calls nothing of `lanes.mjs` but `mergeRecords`.

The issue's Proof also asks for each planted wrong program shown failing first. No implementation existed when these
tests were drafted, so the other folders aren't here yet: each is to be the merged implementation's file with exactly
one rule broken as below, and nothing else changed (same lines, same record fields, same exit statuses). Until a
folder exists the before lane never needs it, since every test of its criterion fails on the merge base first.

Each was checked against a throwaway implementation with that fault (`../BASE-FAILURE.txt`), and failed the tests
listed.

| Criterion | Twin | Replaces | The one rule it breaks | Tests it fails |
|---|---|---|---|---|
| `#1122.e6c3b0b8` | `mac-pass-wins` | `scripts/lanes.mjs` | Where a Mac ran a test ID, its row stands over another machine's row of that ID | Both `#1122.e6c3b0b8` tests: the merge reads PASS |
| `#1122.821346f6` | `spark-lint-counts` | `scripts/lanes.mjs` | The lint lane merges as every lane does, so another machine's lint record counts | `merge.test.mjs`, "a Spark lint FAIL beside the Mac's lint PASS": the tree reads FAIL |
| `#1122.7d260bb4` | `skipped-row-stands` | `scripts/lanes.mjs` | A `skipped` row counts beside the row that ran, so the Spark's skip holds the lane INCONCLUSIVE after the Mac ran the test | `merge.test.mjs`, "a row the Mac ran stands over the Spark's skipped row"; `only.test.mjs`, "a tree that passes" |
| `#1122.7d260bb4` | `spark-alone-passes` | `scripts/lanes.mjs` | A lane with a record from another machine and none from a Mac reads by its rows, so it can be PASS | `merge.test.mjs`, "a lane with a Spark record and none from a Mac is never PASS" |
| `#1122.7d260bb4`, `#1122.b0863068` | `only-skipped-rows` | `scripts/lane-remote.mjs` | `--only` runs the files of the rows the far record marks `skipped`, and nothing a platform-branching source reaches | `only.test.mjs`, "a bug in a darwin-only branch" (the merge reads PASS), the three scenes that read the narrowed run and the `#1122.e6c3b0b8` `--only` test (the Mac never runs the test); both `planted.test.mjs` tests |
| `#1122.7d260bb4` | `only-platform-sources` | `scripts/lane-remote.mjs` | `--only` runs what a platform-branching source reaches, and not the rows the far record marks `skipped` | `only.test.mjs`, "a failing test the Spark skipped" (the merge reads INCONCLUSIVE) and the scenes that read the narrowed run |
| `#1122.51c750de` | `tracked-only` | `scripts/lane-remote.mjs` | The shipment holds the commit and the bundle, and no tarball of the untracked files | `ship.test.mjs`, "an untracked tagged test": the run reads `BLOCKED lane-remote`, or its record holds no row of the test |
| `#1122.394befd9` | `trusted-base` | `scripts/lane-remote.mjs` | The far end sets `refs/remotes/origin/main` to the shipped merge base and runs, without computing its own | `ship.test.mjs`, "a shipped merge base that differs": no `BLOCKED lane-remote` line, and the lane runs |
