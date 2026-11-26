# #3467 evidence: a live video decodes each sample once

Recorded on Nov 25, 2026 on a Mac17,10 (M5 Max, 18 cores, 64 GB, macOS 27.2), shared with other sessions. Two builds,
both debug, both at `a1ef97760`: the merge base's own (`deep-canvas-render` sha256 `718dc9eb…`) and this change's
(`5b4daede…`), the build every reading below was taken on. The readings were taken before main was merged in; the PR
says what ran on the merged head. No test reads a file in this folder.

## The clip

`live-4k-base-and-change.mp4` (10 s at 30 fps) and `live-4k-at-5s.png`, its frame at 5 s. The blind suite's 4K
fixture (`REORDERED_4K` in `tests/acceptance/3467/fixtures.ts`: 3840 × 2160, 250 frames at 30 fps, two B-frames
between reference frames, one key frame) plays in a 640 × 360 player through `deep-canvas-render idle` for 10 s of
the real clock, once on each build. Each panel replays the frames that run reported showing (`players.rec.shown`),
each placed when its draw began; the pictures are the fixture's own frames, and the labels sit outside the panels.
`live-4k.json` holds both runs' rows.

| | Merge base | This change |
|---|---|---|
| Frames shown of 250 | 72 | 250 |
| Longest gap between two new frames | 1,060 ms | 43 ms |
| Requests to the worker | 95 | 250 |
| Samples decoded | not reported | 250 |
| 1-minute load before, after | 38.2, 35.4 | 35.4, 33.4 |

Both builds draw the same picture for the same time: `render` at frames 0, 1, 2, 3, 125 and 249 writes byte-equal
PNGs on the two (`stills` in `live-4k.json`).

## The Proof line's readings

`readings.json`, written by `readings.mjs`: the request lines the suite's tests send, judged by the suite's own
judges (`tests/acceptance/3467/judges.ts`). The merge base reports no `samples`, so its rule is read through the
planted worker `keeps_base_start_rule` on the change, and its own runs are read for what they answer and how long
they took.

| Criterion | This change | Planted worker | Merge base |
|---|---|---|---|
| 1 `#3467.261c442a` | 250 requests, `samples` sum 250, on the real clock and stepped | `keeps_base_start_rule`: 10,789, 248 for one request | 250 rows, none holds `samples` |
| 2 `#3467.6bd8eb71` | 200 of 200 jumps show the canonical decode's planes (`jumps-200-hashes.json`); 17,189 samples | `answers_picture_kept_for_another`: 121 of 200 fail, each naming the frame | `session` answers no `players`; the same jumps by its rule decode 25,462 |
| 3 `#3467.f53de7f6` | the request for frame 1,515 after frame 30: 16 | `keeps_base_start_rule`: 1,485 | `session` answers no `players` |
| 4 `#3467.4c4b1527` | 92 samples for 92 frames; the jump back to frame 47: 18 | `starts_every_request_at_key_frame`: 1,398 | `session` answers no `players` |
| 5 `#3467.1a19a5d4` | 691,200 B in the app and 691,200 B in the worker | `keeps_every_picture`: 87,782,400 B | `session` answers no `players` |

The canonical decode names the same 250 hashes on both builds. As a reading of time, at a load of 35 to 50: the 4K
recording stepped through its 250 frames takes 50.0 s on the merge base and 1.8 s on the change.

## Criterion 6's timing: not proven on this build

The allocations half passed in every run below. The timing half, 150 frames a second with under 0.5% dropped, counts
only on a fit reference Mac at a 1-minute load no higher than its cores (the suite's README, reading 13). The merge
base met that once, and the change's build has not yet:

| When (local) | Build | Machine when the five runs ended | Five runs | Verdict |
|---|---|---|---|---|
| 15:54, timed grant | merge base | mains, nominal, load 12.27 | 5 pass | PASS, counted (`tests/acceptance/3467/BASE-FAILURE.txt`) |
| 14:48 | change | thermal state fair, load 45.6 | run 1 dropped 1.67%, 4 pass | INCONCLUSIVE (`runs/players-final-build-1448.log`) |
| 15:54, timed grant | change | mains, nominal, load 20.82 | 5 pass | INCONCLUSIVE: load above the cores (`runs/players-final-build-1554-timed.log`) |
| 16:56, timed grant | change | battery, nominal, load 9.09 | 5 pass | INCONCLUSIVE: not on mains (`runs/players-final-build-1656-timed.log`) |

Two more timed grants, at 18:30 and 19:22, ran nothing: the machine did not read fit within the minutes each waited.

**The owner's waiver (Nov 25, 2026).** In the session that opened PR #3561 the owner was told this timing still read
INCONCLUSIVE on the change's build, and answered that where that is down to load it is waived. Two of the three
readings are: load and heat right after two cold builds at 14:48, and a load above the cores at 15:54. The third, at
16:56, was taken on battery at a load of 9.09: that is the machine's power, not its load, and all five runs passed
there, as they did at 15:54. No run failed with the machine drained. So the issue closes on the allocation count and
these readings, with no counted run of the timing on the change's build. The suite is unchanged, and its timing test
still reads INCONCLUSIVE wherever the machine isn't fit. The waiver is written here and in the PR only: in no check,
and in no list a lane reads.

## Making them again

From the checkout's root, with both builds' binaries in two folders, on a Mac with ffmpeg:

```sh
node docs/evidence/3467/readings.mjs <change bin dir> <base bin dir> docs/evidence/3467
node docs/evidence/3467/video.mjs <change bin dir> <base bin dir> docs/evidence/3467
```
