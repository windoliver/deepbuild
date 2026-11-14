# #524: the soft scenes as the canvas draws them

Criterion 8 (`#524.b97ba86d`) asks for screenshots of the rope bridge, the banner on its plate and the balloon cube, taken by the check run from the canvas's own frames, with a recording of each settling, and one taste call on them. These files are `tests/acceptance/524/ac8-taste.test.ts`'s own output on the PR's head: `deep-gpu`'s `view3d` final PNGs, kept byte for byte and named by their SHA-256, and each recording the canvas's own frames at 320 × 180 and 30 fps for the first 3 s, put into one animated PNG unchanged.

| Scene | Screenshot (640 × 360, 3 s) | Recording (0 to 3 s) |
|---|---|---|
| The rope bridge lab (`packs/examples/labs/rope-bridge.json`) | `rope-bridge-d08da6c4….png` | `rope-bridge-settling-afe98d65….apng` |
| The banner lab, on its plate (`packs/examples/labs/banner.json`) | `banner-bdb833f5….png` | `banner-settling-3f5c686f….apng` |
| The balloon cube (the suite's `cubeScene(60)`, inflate 1.2) | `balloon-cube-3f0da3a8….png` | `balloon-cube-settling-d8fae412….apng` |

The balloon cube is the suite's own scene: it holds no ground item or light and no track, so the inflated cube rests in grey with its ball unlaunched beside it.

The taste call is yours. Record it as `taste-call.json` here, `{"criterion": "#524.b97ba86d", "by": "you", "screenshots": [the three PNG hashes], "recordings": [the three APNG hashes], "call": "looks_right" | "looks_wrong"}`, and run the test with `DEEPBUILD_TASTE_524` naming it. Until then the test reads INCONCLUSIVE, never PASS.
