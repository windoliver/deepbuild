# Twins for the 2033 tests

No implementation existed when these tests were drafted, so each twin here is the merge base's whole
`crates/deep-scene3d-render/src/scene3d.wgsl` (at `1b4929ae7`) with only the shadow lookups' bias lines changed. A
twin replaces product files only, never a file under `tests/`: it goes at
`twins/<name>/crates/deep-scene3d-render/src/scene3d.wgsl`. Once the fix is merged, each twin should be that merged
shader with exactly the one rule below broken and nothing else changed. A twin that no longer builds over the change
reads as BLOCKED, never as a pass.

| Criterion | Twin | The one rule it breaks | Test it fails, and where |
|---|---|---|---|
| `#2033.572c2d31` | `no-bias` | No depth bias or normal offset: `cascade_lit` looks up at `world` and compares at `t.z`; `local_lit` looks up at `world` with `bias = 0.0` | `ac1-sun-lit.test.ts`: "sunlit pixels against the frame with shadow: false, by elevation and cascade", all 28 configs (e.g. elevation 15°, cascade 0: 117230 of 117286 px, worst 92 codes) |
| `#2033.51cea4a6` | `no-bias` | As above | `ac3-local-lit.test.ts`: "pixels a local light lights against its own frame with shadow: false, by light and distance", all 18 configs (e.g. the spot light at 1 m (sphere2): 58419 of 78302 px, worst 94 codes) |
| `#2033.6912f5fe` | `two-metre-bias` | A 2 m bias: `cascade_lit` looks up at `world + toward_sun × 2 m`; `local_lit` at `world − ray × 2 m`, `bias = 0.0` | `ac2-sun-wall.test.ts`: "the plane behind the wall against the frame with the sun off", all 28 configs (e.g. elevation 15°, cascade 0: 2850 lit px behind the wall, worst 102 codes) |
| `#2033.4b94b05f` | `two-metre-bias` | As above | `ac4-local-wall.test.ts`: "the plane behind the wall against the frame with the local light off", all 6 configs (e.g. the spot light at 1 m: 15589 lit px behind the wall, worst 113 codes) |

AC1, AC2 and AC3 pass on the merge base, so their twins are their only proof of failing first. AC4 also fails on the
base, at 16 m for both lights (`../BASE-FAILURE.txt`).
