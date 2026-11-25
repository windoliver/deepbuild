# Twins for the 3350 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation's `scripts/lanes.mjs` with exactly one rule broken as below, and nothing else changed: same flags, same
lines, same record fields, same exit statuses. It goes at `twins/<name>/scripts/lanes.mjs`. A twin replaces a file of
the product, never a file under `tests/`. If the merged change decides "this lane runs for a far end" in
`scripts/lane-remote.mjs` rather than in `lanes.mjs` (say, by an option it passes to `runLanes`), the twin still breaks
the rule in `lanes.mjs`, by ignoring what it was passed. Each fault was planted in a throwaway implementation in this
job's scratch folder and failed the test named at its assertion (`../BASE-FAILURE.txt`).

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3350.46301a6a` | `far-fixed-wait` | `scripts/lanes.mjs` | A lane run for `lane-remote.mjs`'s far end asks for each command's grant, and for each cargo listing, with `--wait 30`, as the base does, in place of `--stall <DEEP_LANE_REMOTE_STALL_MIN>`. The far end's own install and build (`lane-remote.mjs`) still ask `--stall`, and a lane run any other way is unchanged | `far-moving.test.mjs`: the far table's `granted` entry for the lane's `cargo test` carries `"wait":30` and no `stall`, so the assertion "asked with --stall 0.05, the far end's bound, not --wait" fails |
| `#3350.48bfd705` | `stall-everywhere` | `scripts/lanes.mjs` | Every lane run, whether for a far end or not, asks for each command's grant and each cargo listing with `--stall <DEEP_LANE_REMOTE_STALL_MIN, 30 when unset>` in place of `--wait 30` | `near-wait.test.mjs`: the test's own table logs `cargo test`'s grant with `stall` and no `"wait":30`, so "cargo test's grant was asked with --wait 30, not --stall" fails |

`#3350.cd64baa0` has no twin: its test fails on the merge base at its assertion. The base's lane asks its cargo test's
grant with `--wait 30`, so behind the held far build slots the near end is still running at the test's 6-minute bound.

`#3350.46301a6a` fails on the merge base at its assertion too (the base is `far-fixed-wait`'s behavior: the grant is
logged with `"wait":30`), but the issue asks for the planted `lanes.mjs` that keeps `--wait`, so it keeps its twin.
`#3350.48bfd705` passes on the merge base, which asks every lane with `--wait 30`; its twin is its only proof of
failing first.
