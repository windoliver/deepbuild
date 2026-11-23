# #3236 evidence: a mark set's computed value and its reading focus

`replica.json` is the issue's Proof line, written by `deep-show run` from the blind suite's own fixtures
(`tests/acceptance/3236/fixtures.ts`): the document shown, `scope`, Tab, then Right n times, then `see` and `track`.

- **scatter**: the node's value `11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing`; Tab and Right × 11 land
  on 11 rows (`scatter#5`, the NaN row, never), each announced with its x and y and their units; the track holds no entry.
- **scatter_edited**: row 0's y 40 → 55, and the value says `y metres 2 to 55` at the next check.
- **scatter_planted_entry**: `reading_walk_writes_entry` writes one pick entry per landing, which AC3's check names.
- **bars**: the value lists `series North 4, South 4, West 4`; the walk lands on North's four bars, then South's, then
  West's. **bars_planted_row_order**: `reading_walk_row_order` changes series at every landing.
- **series**: the 50,000-row `trace` is walked in 400 stops, its pixel columns, each `125 rows, v <least> to <greatest>`.
  **series_planted_every_row**: `reading_walk_every_row` moves on all 402 keys.

## Runs (Mac17,10, load 50 to 110, November 23, 2026)

| Criterion | Test | Verdict |
|---|---|---|
| AC1–AC6 | `ac1-value` … `ac6-pick` (11 tests, plants included) | PASS, on the final source |
| AC7 | `ac7-web` (headless Chrome, the rebuilt player) | PASS |
| AC8 | `ac8-appkit` | BLOCKED: AppKit reads `deep-show live`'s window with no element that carries an identifier (its roles: `AXApplication`). The window opens, and its reply's `shown` lists the node `scatter` with the value it gives AccessKit; AppKit, from outside the process, answers every element of the window as the application. The blind job saw the same at the base. |
| AC9 | `ac9-budgets` | INCONCLUSIVE by load: the 100,000-row node carries its value (the test's first half passed), then `judgeLimit` declined: load 52 above the 18 cores. The value is computed when the tree is read, not in the check or a frame. |

Unit tests: `cargo test -p deep-canvas -p deep-canvas-input -p deep-canvas-marks -p deep-play --lib` pass (354, 29, 177 with
`data::holds`'s range walk, 4). Not run: `node scripts/affected.mjs` and neighbouring suites (#539's and #1045's files).
