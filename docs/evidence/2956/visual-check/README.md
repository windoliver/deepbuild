# #2956 visual check: main 0dbd16ef7 against the PR head 88f2adcc8

Run on the MacBook Pro (Mac18,1, M6, 32 GB) from a fresh GitHub clone, 2026-11-28, through
`tests/acceptance/2494` unchanged (3 of 3 pass on both sides): a real hub, `deep show` of the suite's
`fixtures/sliding-box.json`, and the real deep-app window (`deep-app --canvas`, the canvas-fixture build) at
480 × 360 points, captured as the compositor received it.

- `main-frame-236-window.png`, `head-frame-235-window.png`: the first frame at or after 9 s (main 9000 ms, head 9034 ms).
- `main-frame-341-window.png`, `head-frame-339-window.png`: the first frame at or after 13 s (main 13025 ms, head 13009 ms).
- `before-after.png`: the four side by side.

Same colours and the same box. Each pair differs in one 1-pixel column at the moving box's right edge (305 pixels),
the edge's anti-aliasing at capture times 16 to 34 ms apart. The change draws nothing differently: it adds the
Mac18,1 to the reference lists, and no render code moves.
