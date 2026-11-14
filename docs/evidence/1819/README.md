# #1819 proof

These are the blind suite's proof files (`tests/acceptance/1819/`, written from the issue, the design and base `990d4af8`; run one file at a time with `--no-file-parallelism` on macOS arm64, Node 24.22.0). 5 of 5 tests passed on their first run, on the implementation commit `518e9e11`. Every hub and `deep` command ran under `/tmp/dh1819-*` with a temp `HOME`. The model host ran on 127.0.0.1:8719 with the pinned weights fetched by hash into the user's cache. Nothing was sent off the machine, and no paid model was called.

The fixtures are made at test time and their truth is where the test placed the samples: a 10 s line of 17 words spoken by macOS `say`, three phrases between 1 s silences over a chord pad, and click tracks at 100 and 96 BPM.

The issue's Proof line maps to the files as follows.

| Proof | File | Reading |
|---|---|---|
| The fixture line's word times | `ac1-words.json` | 17 of 17 word starts within 50 ms; the worst is 15 ms early (errors in ms: −5, 3, 5, 2, 6, −7, 5, 8, 8, 10, 5, −15, −4, 7, 6, 13, −1) |
| The cache hit | `ac1-rerun.json` | The second `deep_job` run answers `cache: hit` with the same key `2ed1293b…` and record `b7ace2d9…` |
| AC1's planted cache | `ac1-planted-cache.json` | The old record asked under `charsiu-aligner@1.0.1` is refused: `unknown_analyzer`, naming `charsiu-aligner@1.0.1` and `charsiu-aligner@1.0.0` |
| The two click tracks' tempos | `ac2-tempo.json` | 99.992 and 95.944 BPM |
| AC2's plant | `ac2-planted.json` | `beats_fixed_120` reads 120 on both; each failure names its asset's hash |
| The speech spans | `ac3-spans.json` | Three spans; edges −8/+31, −9/−9, −17/−2 ms from the fixture's |
| AC3's plant | `ac3-planted.json` | `activity_level_threshold` gives one span from 0 to 8.832 s over the music; the first failure names span 1 |
| The viseme list | `ac4-visemes.json` | 152 visemes over two lines, each shape 1/24 s before its phoneme and X held between `l1` and `l2`; no failures |
| AC4's plant | `ac4-planted.json` | `visemes_no_lead` fails first at "shape 1, B at 0.963 s on l1" |
| BLOCKED, never PASS | `ac5-blocked.json` | With the host stopped after install, `bake.activity` on `silero-vad@6.2.3` is BLOCKED twice on one unblock ask naming it, makes no record, and the bake stays BLOCKED |
| AC5's plant | `ac5-planted.json` | `job-host-down-done` answers done with an empty record; the judge fails it naming `silero-vad@6.2.3` |
