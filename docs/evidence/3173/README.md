# #3173: deep-show's full schedule snapshot drifted on main

Taken on the Mac (Mac18,1), main `61aa8eb06`, `cargo test -p deep-show --bin deep-show --locked`, captured with `rtk proxy` and trimmed to the test lines, panics and results. The machine's load was about 110 on 18 cores; the test is not timed.

| File | What |
|---|---|
| `mac-before-61aa8eb0.txt` | The test on main: `the full schedule drifted`, and the diff of the committed `schedule/full.json` against the schedule the test printed |
| `mac-after.txt` | The whole `deep-show` bin with `schedule/full.json` written from the test's printed schedule: the schedule test passes |

## The landing

PR #3060 (#278, rooms that gather and play again), merged as `ad168fecb`. It added `open` and `finish` to `logic@1` and a players range to `net@1`, so both modules' digests moved. The branch wrote its kit ledger again by kit run (`25468bcf9`) but never wrote `schedule/full.json` again: just before its second merge of main (`5bd82df56`'s first parent, `e806d843f`), the branch's ledger held core `624f48e5…`, logic `2c1c3d6c…`, net `8d7ea749…` while its `full.json` still held `6cd68647…`, `e08d57d3…`, `6c59b2fc…`. That merge (main `5f5791e2d`) wrote the ledger again on the merged tree (core `bb074126…`, logic `3f668143…`, net `d2299171…`) and took main's `full.json`, which holds main's old digests (core `3a1e5d7f…`, logic `8ea81670…`, net `1effe75b…`). The schedule on main has printed the merged tree's digests since.

The three digests the test printed equal the ones #3060's kit ledger records, and no other line differs, so the change was meant: the snapshot is written again rather than the schedule undone. `core.json`, `r1.json` and `r2.json` don't drift (the test checks them first and passed them), and the module slices in `schedule/modules/` hold no digest.

## Not this issue's

`kinds::tests::every_structured_field_prints_forms_that_take_its_own_values` fails in `mac-after.txt` (its panic message names `cut.words@1`'s `recording` and `keep` forms). #3100 lists it among deep-show's tests failing on main; this change touches no form.
