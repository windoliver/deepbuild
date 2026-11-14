# #223: warps as the canvas draws them

Criterion 9 (`#223.85ce0afe`) asks for screenshots of the 21 × 21 line grid warped by cmul(z, z), the homotopy line and an arrow under shear, taken by the check run from the canvas's own frames, with a recording of the homotopy as its mix moves, and one taste call on them. These files are `tests/acceptance/223/ac9-taste.test.ts`'s own output on the PR's head: `deep-canvas-render raster`'s PNGs (Vello CPU, 800 × 600 at zoom 1), kept byte for byte and named by their SHA-256, and the recording the homotopy's 30 frames at 30 fps over its 1 s as its mix moves from 0 to 1, put into one animated PNG unchanged. Two runs gave the same bytes.

| Fixture | File |
|---|---|
| The grid fn `x [300, 500, 10]`, `y [200, 400, 10]` under `complex {f: cmul(z, z)}`, plane origin (400, 300), unit 100, y up | `grid-z-squared-e443a240….png` |
| The homotopy `(x, y + 1.5·u·sin(2x − 6u))`, `u` the time in seconds, on M 100 300 L 700 300 stroked 4 u, at 0.75 s | `homotopy-line-cc2109a1….png` |
| The arrow M 400 400 L 400 200, stroke 3, under `linear {matrix: [[1, 1], [0, 1]]}` with `ends: redraw` | `arrow-shear-4b557668….png` |
| The homotopy as its mix moves from 0 to 1 over 1 s | `homotopy-mix-3beb4785….apng` |

The taste call is yours. Record it as `taste-call.json` here, `{"criterion": "#223.85ce0afe", "by": "you", "screenshots": [the three PNG hashes], "recordings": [the APNG hash], "call": "looks_right" | "looks_wrong"}`, and run the test with `DEEPBUILD_TASTE_223` naming it. Until then the test reads INCONCLUSIVE, never PASS.
