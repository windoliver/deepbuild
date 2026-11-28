# #2956 visual check: main 22d6a67b8 against the final merge 14799b30f

Run on the MacBook Pro (Mac18,1, M6, 32 GB) from a fresh GitHub clone, 2026-11-28, through
`tests/acceptance/2494` unchanged (3 of 3 pass on both sides): a real hub, `deep show` of the suite's
`fixtures/sliding-box.json`, and the real deep-app window (`deep-app --canvas`, the canvas-fixture build) at
480 × 360 points, captured as the compositor received it. 14799b30f is the PR's landing merge: main 22d6a67b8
merged into the PR.

- `main-frame-235-window.png`, `merge-frame-236-window.png`: the first frame at or after 9 s (main 9023 ms, merge 9033 ms).
- `main-frame-338-window.png`, `merge-frame-340-window.png`: the first frame at or after 13 s (main 13017 ms, merge 13017 ms).
- `before-after.png`: the four side by side.

Same colours and the same box. The 13 s pair is pixel-identical. The 9 s pair differs in one 1-pixel column at the
moving box's left edge (305 pixels), the edge's anti-aliasing at capture times 10 ms apart. The change draws nothing
differently: it adds the Mac18,1 to the reference lists, and no render code moves.
