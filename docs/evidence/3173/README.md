# #3173: deep-show's full schedule snapshot drifted on main

Taken on the Mac (Mac18,1), `cargo test -p deep-show --bin deep-show --locked`, captured with `rtk proxy` and trimmed to the test lines, panics and results. The machine's load was about 110 on 18 cores; the test is not timed.

| File | What |
|---|---|
| `mac-before-61aa8eb0.txt` | The test on main `61aa8eb06`: `the full schedule drifted`, and the diff of the committed `schedule/full.json` against the schedule the test printed |
| `mac-main-92647c68.txt` | The whole `deep-show` bin on main `92647c689`: the schedule test passes |

## The landing

PR #3060 (#278, rooms that gather and play again), merged as `ad168fecb`. It added `open` and `finish` to `logic@1` and a players range to `net@1`, so both modules' digests moved. The branch wrote its kit ledger again by kit run (`25468bcf9`) but never wrote `schedule/full.json` again: just before its second merge of main (`5bd82df56`'s first parent, `e806d843f`), the branch's ledger held core `624f48e5…`, logic `2c1c3d6c…`, net `8d7ea749…` while its `full.json` still held `6cd68647…`, `e08d57d3…`, `6c59b2fc…`. That merge (main `5f5791e2d`) wrote the ledger again on the merged tree (core `bb074126…`, logic `3f668143…`, net `d2299171…`) and took main's `full.json`, which holds main's old digests (core `3a1e5d7f…`, logic `8ea81670…`, net `1effe75b…`). From `ad168fecb` to `92647c689`'s parent, the schedule on main printed the merged tree's digests while the snapshot held the old ones.

The three digests the test printed on `61aa8eb06` equal the ones #3060's merge recorded in the kit ledger, and no other line differed, so the change was meant: the snapshot is to be written again, not the schedule undone.

## How it was written again

PR #3231 (#269, the grid image mark), merged as `92647c689`, wrote `r1.json`, `r2.json`, `full.json` and `modules/data.json` again from the printed schedule for its own `data` and `logic` change (`883db924f`). Its `full.json` also carries #278's `net@1` digest `d2299171…` and the logic and set digests over both changes, so on `92647c689` the test passes with no further change. This branch first wrote `full.json` again on `61aa8eb06` (`00e9f7c04`, the same three lines); merging main took main's `full.json`, so the branch now changes only this folder.

## Not this issue's

`kinds::tests::every_structured_field_prints_forms_that_take_its_own_values` fails in `mac-main-92647c68.txt` (its panic message names `cut.words@1`'s `recording` and `keep` forms). #3100 lists it among deep-show's tests failing on main.
