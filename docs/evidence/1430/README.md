# #1430: the same pictures, less shaping

`reflow.apng` (13 frames) and `typed.png` (its 12th) draw the text-reflow bench's 50 KB text. The text is `benchmarks/text-reflow.mjs`'s 100 paragraphs of 512 characters, at 16 u in a masked box. It is drawn by the window's frame path (`deep-canvas-render render`, debug, the clean look's light theme, zoom 1):

- left: main's `deep-text`, at the merge base `a0d3713a7`;
- right: this branch's, at `b9c4c2d24`.

The box narrows from 640 u to 440 u. Then "hello " is typed into the second paragraph, one character per frame, and the box returns to 640 u. Each side draws all 13 frames in one process, as a window would.

The strip under each frame, outside the pictures, gives:

- how many pixels the two pictures differ in: none, in all 13 frames;
- what each side's `deep-text shape` (release) shaped for the same text, size and box (its `shaped` answer);
- how long that took, from writing the line to reading the answer. It is the best of 9 processes, taken in turn: the Mac was at load 110–113 over 18 cores, so most of a slow run is waiting for a core. Every run's time is in `frames.json`.

| # | frame | pixels differing | main shaped | main | #1430 shaped | #1430 |
|---|---|---|---|---|---|---|
| 1 | first layout, box 640 u wide | 0 | the whole text, 51,299 characters | 39.2 ms | 100 paragraphs, 51,299 characters | 38.2 ms |
| 2 | box 600 u wide | 0 | the whole text, 51,299 characters | 29.2 ms | nothing | 7.24 ms |
| 3 | box 560 u wide | 0 | the whole text, 51,299 characters | 38.3 ms | nothing | 6.43 ms |
| 4 | box 520 u wide | 0 | the whole text, 51,299 characters | 32.8 ms | nothing | 7.17 ms |
| 5 | box 480 u wide | 0 | the whole text, 51,299 characters | 31.8 ms | nothing | 7.69 ms |
| 6 | box 440 u wide | 0 | the whole text, 51,299 characters | 30.3 ms | nothing | 8.00 ms |
| 7 | "h" typed into paragraph 2 | 0 | the whole text, 51,300 characters | 32.3 ms | 1 paragraph, 514 characters | 2.62 ms |
| 8 | "he" typed into paragraph 2 | 0 | the whole text, 51,301 characters | 35.0 ms | 1 paragraph, 515 characters | 2.06 ms |
| 9 | "hel" typed into paragraph 2 | 0 | the whole text, 51,302 characters | 34.5 ms | 1 paragraph, 516 characters | 1.94 ms |
| 10 | "hell" typed into paragraph 2 | 0 | the whole text, 51,303 characters | 35.5 ms | 1 paragraph, 517 characters | 2.43 ms |
| 11 | "hello" typed into paragraph 2 | 0 | the whole text, 51,304 characters | 32.9 ms | 1 paragraph, 518 characters | 1.39 ms |
| 12 | "hello " typed into paragraph 2 | 0 | the whole text, 51,305 characters | 38.7 ms | 1 paragraph, 519 characters | 1.27 ms |
| 13 | box 640 u wide again | 0 | the whole text, 51,305 characters | 32.3 ms | nothing | 6.45 ms |

These are this run's times on a loaded Mac, not budget readings; AC4's are (`node benchmarks/canvas.mjs text-reflow`).

To draw them again:

```sh
node docs/evidence/1430/shoot.mjs <main's bin dir> <this branch's bin dir> docs/evidence/1430 [video.mp4]
```

Each bin dir holds `deep-canvas-render` (`cargo build --locked --bin deep-canvas-render`) and `deep-text` (`cargo build --locked --release --bin deep-text`).

Main's were built in this branch's worktree with `git checkout a0d3713a7 -- crates/deep-text`, the one crate on the renderer's path that this change alters, then copied out, and the crate was restored.
