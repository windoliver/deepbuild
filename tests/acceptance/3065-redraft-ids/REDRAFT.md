# Blind redraft of #3065's acceptance tests: criterion IDs in the test names

The lanes (`node scripts/proof.mjs before`, `trace`, `scripts/proof-change.mjs`) know a criterion only by its ID:
`#3065.` followed by the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs` and `scripts/budget-window.mjs`). A test carries a criterion when its
name contains that ID literally. The tests in `tests/acceptance/3065/` are named `#3065.AC1` … `#3065.AC4`, which name
no criterion, so no lane can see them. This folder redrafts them with the IDs, and changes nothing else.

The same blind job wrote it, from the same inputs only: issue #3065's body (not its comments), the design sections it
links (`node scripts/design-section.mjs --issue 3065`), AGENTS.md and the commit `a3aaaf3cb` (base `c7dc0edc3` plus the
original tests). `scripts/reach.mjs` does not exist there. The original folder is not edited or deleted; a person
approves the swap.

## The IDs

Computed from the four `- [ ]` lines of the issue's "Acceptance criteria", in its order:

| Was | Criterion (start of its text) | ID |
|---|---|---|
| `#3065.AC1` | For a fixture test that imports a helper naming `deep-hook` and never starts it, … | `#3065.064dd59e` |
| `#3065.AC2` | A test file that didn't run, was skipped, or whose process was killed has no row, … | `#3065.f0068a87` |
| `#3065.AC3` | `compare` on the three fixture changes of #2673 prints selected, … | `#3065.b2bdedd7` |
| `#3065.AC4` | The record holds no file content, argument or environment value: … | `#3065.e9e9237a` |

## What the redraft replaces

| Original (path › test) | Criterion ID | Replaced by |
|---|---|---|
| `3065/record.test.mjs` › #3065.AC1 a test that imports a helper naming deep-hook and never starts it has no binary in the record, and its twin that starts it has deep-hook | `#3065.064dd59e` | `3065-redraft-ids/record.test.mjs` › #3065.064dd59e a test that imports a helper naming deep-hook and never starts it has no binary in the record, and its twin that starts it has deep-hook |
| `3065/record.test.mjs` › #3065.AC1 a test that starts deep-hook by its path under target/ has deep-hook in the record | `#3065.064dd59e` | `3065-redraft-ids/record.test.mjs` › #3065.064dd59e a test that starts deep-hook by its path under target/ has deep-hook in the record |
| `3065/record.test.mjs` › #3065.AC2 a test file that didn't run has no row in the record | `#3065.f0068a87` | `3065-redraft-ids/record.test.mjs` › #3065.f0068a87 a test file that didn't run has no row in the record |
| `3065/record.test.mjs` › #3065.AC2 a test file that was skipped has no row in the record | `#3065.f0068a87` | `3065-redraft-ids/record.test.mjs` › #3065.f0068a87 a test file that was skipped has no row in the record |
| `3065/record.test.mjs` › #3065.AC2 a test file that had its process killed has no row in the record | `#3065.f0068a87` | `3065-redraft-ids/record.test.mjs` › #3065.f0068a87 a test file that had its process killed has no row in the record |
| `3065/record.test.mjs` › #3065.AC4 the record holds no file content, argument or environment value: paths and binary names only | `#3065.e9e9237a` | `3065-redraft-ids/record.test.mjs` › #3065.e9e9237a the record holds no file content, argument or environment value: paths and binary names only |
| `3065/compare.test.mjs` › #3065.AC2 compare counts a selected test file that didn't run, with no row, as reaching the change | `#3065.f0068a87` | `3065-redraft-ids/compare.test.mjs` › #3065.f0068a87 compare counts a selected test file that didn't run, with no row, as reaching the change |
| `3065/compare.test.mjs` › #3065.AC2 compare counts a selected test file that was skipped, with no row, as reaching the change | `#3065.f0068a87` | `3065-redraft-ids/compare.test.mjs` › #3065.f0068a87 compare counts a selected test file that was skipped, with no row, as reaching the change |
| `3065/compare.test.mjs` › #3065.AC2 compare counts a selected test file that had its process killed, with no row, as reaching the change | `#3065.f0068a87` | `3065-redraft-ids/compare.test.mjs` › #3065.f0068a87 compare counts a selected test file that had its process killed, with no row, as reaching the change |
| `3065/compare.test.mjs` › #3065.AC3 compare on a one-line change to the hub source file prints selected, recorded as reaching and recorded as not reaching, summing to selected | `#3065.b2bdedd7` | `3065-redraft-ids/compare.test.mjs` › #3065.b2bdedd7 compare on a one-line change to the hub source file prints selected, recorded as reaching and recorded as not reaching, summing to selected |
| `3065/compare.test.mjs` › #3065.AC3 compare on a one-line change to the canvas crate prints selected, recorded as reaching and recorded as not reaching, summing to selected | `#3065.b2bdedd7` | `3065-redraft-ids/compare.test.mjs` › #3065.b2bdedd7 compare on a one-line change to the canvas crate prints selected, recorded as reaching and recorded as not reaching, summing to selected |
| `3065/compare.test.mjs` › #3065.AC3 compare on a one-line change to the design doc prints selected, recorded as reaching and recorded as not reaching, summing to selected | `#3065.b2bdedd7` | `3065-redraft-ids/compare.test.mjs` › #3065.b2bdedd7 compare on a one-line change to the design doc prints selected, recorded as reaching and recorded as not reaching, summing to selected |

In each file only three things differ from the original: the header comment (it names the IDs and this redraft), the
import path (`../3065/helpers.mjs` instead of `./helpers.mjs`), and `#3065.ACn` → its ID in the test names. Mapping
the IDs back to `#3065.ACn` and the import back to `./helpers.mjs`, then dropping the header comment lines, `diff`
finds both files identical to the originals: the scenes, surfaces, assertions, messages and expected values are the
original's line for line.

## Kept as they are

- `tests/acceptance/3065/helpers.mjs`, imported unchanged (it finds the checkout from its own location, so the import
  from this folder builds the same fixture), with the fixture, surfaces and judgment calls `tests/acceptance/3065/README.md`
  states. That README still describes these tests; read `#3065.ACn` there as the ID above.
- `tests/acceptance/3065/BASE-FAILURE.txt`, as the original's run.
- No `twins.json` and no `twins/` here: the implementing side adds those, mapping the IDs above.

## Runs

On `a3aaaf3cb` (the base, no `scripts/reach.mjs`), macOS arm64, 12 cores, one-minute load 64.5, Node v24.22.0,
cargo 1.99.1, after `npm ci` and `npm run build --workspaces`:

```
$ node --test --test-reporter=spec tests/acceptance/3065-redraft-ids/*.test.mjs
✖ (all 12 tests)
ℹ tests 12  ℹ pass 0  ℹ fail 12
exit 1
```

Each of the 12 fails at an assertion of the suite's (`AssertionError [ERR_ASSERTION]`, `0 !== 1`), in `theRecord`
(`tests/acceptance/3065/helpers.mjs:243`), the first thing every test checks: "the recording run left 0 records under
~/.deepbuild/reach/ of its HOME, not the one <tree>.json the issue names", with `node scripts/reach.mjs record`
exiting 1 on MODULE_NOT_FOUND in the message. None crashes before an assertion. That is the original suite's failure
at the base, test for test. The base can't take a test past that shared first assertion to its own later ones: they
need a record. The full output is `BASE-FAILURE.txt`.

Not run here: any implementation or planted twin; this job never sees them.
