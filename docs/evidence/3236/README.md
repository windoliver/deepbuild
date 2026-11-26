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
| AC8 | `3236-redraft-ac8/live` (the blind redraft of `ac8-appkit`), unlocked, load 158 | PASS: the live window's `scatter` gives the replica's value and its announcements are the replica's 11. The first draft FAILs: its client hears each announcement twice (`tests/acceptance/3236-redraft-ac8/DISPUTE.md`). Its earlier BLOCKED runs were behind a locked screen, where every app's windows answer as `AXApplication` (`live-window.md`). |
| AC9 | `ac9-budgets` | INCONCLUSIVE by load: the 100,000-row node carries its value (the test's first half passed), then `judgeLimit` declined: load 52 above the 18 cores. The value is computed when the tree is read, not in the check or a frame. |

Unit tests: `cargo test -p deep-canvas -p deep-canvas-input -p deep-canvas-marks -p deep-play --lib` pass (354, 29, 177 with
`data::holds`'s range walk, 4). Not run: `node scripts/affected.mjs` and neighbouring suites (#539's and #1045's files).

## Second pass (November 23, later): corrections, and the defects it fixed

Three statements above were wider than what had been run. AC1, AC2, AC5 and AC6 had not been rerun after the column
order changed or after main was merged. The library counts were from before the restructure. The web player's walk, which
the PR described as working, had never been driven. The table below is what ran on the fixed source
(`71a58f0a0` with main `b41a1b521` merged, the player rebuilt from that source, Mac17,10, load 40 to 280).

| What | Result |
|---|---|
| AC1–AC7 (12 tests, four plants included) | PASS |
| `tests/web-reading-walk.test.ts` (Chrome: the scatter, the bars, the series) | PASS 3 of 3 |
| `picks::reading` hub tests (`crates/deep-show/src/picks/reading.rs`) | PASS 4 of 4 |
| `cargo test --lib` deep-canvas 357, deep-canvas-input 29, deep-canvas-marks 180, deep-play 4 | PASS |

Reading the change again found these. Each was seen before it was fixed, but for the one marked:

| Defect | Before | After |
|---|---|---|
| A cell bound to a reading of 45, written as 0 | heard as `y 0 to 30`, the row said `y 0 m` | `y 10 to 45`, the row says `y 45 m` |
| The same with no reading held | 3 rows drawn, though 2 draw | `2 rows drawn … 1 missing`, and the row is not landed on |
| A NaN in a column nothing encodes | its row vanished with nothing said | refused, `out_of_range`, as on the base |
| A NaN in a `rows_of` set's own column | `6 rows drawn … 1 missing`, and the row walked to | `5 rows drawn … 1 missing` |
| A cell written NaN and bound to a reading | hidden though the reading is held | drawn |
| The focused row stops drawing | focus jumped to the first row | the nearest drawn row by centre distance (#539) |
| A set that draws no row | a Tab stop that says nothing | no Tab stop |
| The page's walk on re-entry (read in the code, not run) | kept its old place and said nothing | starts over, as the app's does |
| A series' times | `t s 0.0000000014172335600907028 to 0.00007086167800453515` | `t s 0 to 0.0000709` |

The first two core tests and three of the four hub tests failed on the code as it was, for the reason given:
`left: "3 rows drawn, x m 0 to 2, y m 0 to 30"` against `y m 10 to 45`; `left: String("s#0")` against `s#3`;
`left: [String("gone"), String("s#0")]` against `[String("s#0"), Null]`; `left: ["s#a", "s#c"]` against three rows; and a
NaN nothing encodes accepted. Home, End and the arrows were untested and work; with Home sent to the last row that test
fails. A page with no walk, and one whose End does nothing, each fail all three charts in Chrome.

Not proven: the value of a set whose rows come from logic arrays or an occurrence list, which the suite's README leaves
out, and which has no walk (so no Tab stop) rather than a wrong one; caching, since a focused set costs a pointer move no
more than an unfocused one at 1,000,000 rows in a debug build (47 ms against 112 ms), and Tab about 1.4 s once there.
AC9 stays INCONCLUSIVE by load, as the owner accepted. AC8 is `live-window.md`'s.

Blindness: the suite's job shared this session's scratchpad. Its tool calls show it writing `probe.mjs` over this
session's file of that name without reading it, and no read of any other file of this session's there.
