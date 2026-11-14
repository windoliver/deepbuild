# #1903 evidence

Made on 2026-11-10 on a Mac17,10 (Apple M5 Max, 64 GB, macOS 26B8119), from this branch's release `deep-gpu`, with
`node docs/evidence/1903/run.mts target/release/deep-gpu`. The Mac was on battery with its thermal state `fair`, so it
was not a reference Mac in its conditions. Under `machines: same`, every verdict below is a reading (INCONCLUSIVE), and
no limits ask was raised: the first run in conditions on a reference Mac raises it.

`envelope.json` holds the scene document and the whole reply. The run plays three fixtures full screen (3456 × 2234) on
Metal: the every-pass scene, `separate-items` and its instanced twin. Each gets five 60 s runs after warm-up, at the
showpiece class's base rung (internal scale 0.5 while moving, the history window, the upscale). The every-pass scene is
what this build has: a sky, a shadowed sun and lamp, a mirror floor, a patterned material, a 400-element instancer past
the GPU cull's line and a lens flare. Rays, volumes, hair, physics, text and narration are not in the build yet.

| Reading | Every-pass scene | `separate-items` |
|---|---|---|
| Frame GPU time p95, five runs (limit 10 ms) | 6.50, 5.74, 6.67, 6.71, 6.08 ms | 4.11, 4.50, 4.16, 3.98, 3.91 ms |
| Frame GPU time p99, five runs | 7.25, 6.68, 7.36, 7.31, 6.87 ms | 4.64, 5.05, 4.68, 4.57, 4.30 ms |
| Device GPU memory at peak (cap 256 MB) | 659 MB | 378 MB |

The calibration baseline, kept under this device, with no limit set:

| Metric | Reading |
|---|---|
| `frame_time_p99` | 7.25 ms |
| `seek_rebuild` | 9.9 ms |
| `peak_memory/app` | 259 MB |
| `peak_memory/decode_worker` | not run: no media, so no decode worker |
| `export_throughput` | not run: `deep-gpu` has no delivery-film export |
| `first_frame_wait/fresh` | 8,682 ms, 44 pipelines made |
| `first_frame_wait/same_process` | 65 ms, 0 pipelines made |
| `separate_items_ratio` | 1.26 |

Input on screen reads BLOCKED (`missing: inputs`). The run sends no test inputs, and a headless run has no display
seam that reports presentation times. The blind suite proves input on screen on the stub display.

What this shows beyond the suite:
- The frame times hold the class with room to spare.
- The device's GPU memory does not: 659 MB against the showpiece's 256 MB, where the check's own estimate admitted the
  view.
- A fresh process waits 8.7 s for its first frame, almost all of it compiling 44 Metal pipelines. The second open in
  the same process makes none of them again.
