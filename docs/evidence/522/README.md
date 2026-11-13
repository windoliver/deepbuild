# Evidence for #522: inputs other modules fire, the checkpoint ring, seek versus edit, late inputs restored

Recorded on the reference Mac on 2026-11-13, on PR #2415 after its merge of main (2aa5eb8e6), plus the render-back
fix described below. The blind suites `tests/acceptance/522/` and `tests/acceptance/522-oracle/` (commit 5c37fcd4b,
written from the issue, the design and base 53c0e72a3 by a job that never saw the implementation) are unchanged and
pass 21/21 and 6/6 on that head.

| File | Criterion | What it shows |
|---|---|---|
| `launch-at-240.mp4`, `launch-at-240.gif` | 3 | The ball-and-goal lab drawn by deep-show's `render_back` on the GPU, 0–4 s at 30 fps, 960 × 540 (the GIF at 15 fps, 640 wide). The ball rests at the kick spot. A `test.launch@1` item fires `launch {linear: [6, 3, 0.4]}` for step 240, which reaches the world as a derived entry. The ball leaves at 2.0 s, lands near 2.6 s, rolls between the posts and crosses the goal line. |
| `launch-strip.png` | 3 | Eight frames of the film: 0 s, 2.0 s, 2.1 s, 2.3 s, 2.6 s, 3.0 s, 3.5 s and 4.0 s. |
| `launch-track.json` | 3 | The entry the bake keeps (`from: "test.launch:launcher"`, step 240), then, per frame, the ball's position from `eval` and the ball's centroid in the rendered frame. |
| `live-seek-frames.json` | 9 | A live view of the lab over 60 s with no bake: a seek to 2 s, a grab there (stamped at step 241), then a seek to 50 s. Each frame records its steps, its simulate CPU (`eval_ns`), its UI CPU (`ui_ns`), the state it shows and whether that state is stale. |

What the frames were checked against:

- **The film.** The ball's centroid in each of the 121 frames tracks the bake's x position with r² = 0.99991. The largest residual is 7 px against a ball about 17 px wide; that's perspective, as the ball drifts 0.64 m toward the camera. The centroid moves 0 px from 0 s through 2.0 s and first moves at 2.033 s, the first frame after the step-240 entry applies.
- **The live seek.** Its 5,760 steps run across 29 frames, every frame stale until the last, which lands on step 6,000. The slowest simulate phase took 3.34 ms of CPU against a 4 ms budget, and the slowest UI thread 0.04 ms against 2 ms, with the machine at load average 94–115. Every shown state's step hash equals a straight bake's of the lab with the same grab.

The render-back fix this evidence turned up: `render_back` of a 3D scene drew each item at its written position whatever the time, because it skipped the channels a world's outputs write (#2293's `with_outputs`). Every frame of the film was byte-identical until the fix. `crates/deep-show/tests/render_back_world.rs` failed at its first assertion on the code before the fix: the 0 s and 0.5 s frames had the same SHA-256. After the fix, render-back at 0.5 s draws the frame `deep_show` draws at 0.5 s, byte for byte.
