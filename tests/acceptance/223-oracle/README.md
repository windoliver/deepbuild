# Acceptance tests for #223, Oracle lane: the upstream projects' tests, run against our warps

Written first, blind, from issue #223 (`gh issue view 223 --repo windoliver/deepbuild --comments`), its Oracle page
(`doneright/oracles/issues/223.md`, with `cases/223.json` and `pins.json`, read from a local sparse clone of the Oracle
repository at its pinned ref), the upstream files that page pins (read from its `vendor/` folder with `git show`), the
#223 suite's surface (`tests/acceptance/223/README.md`, written in the same commit) and base commit `65f383b3f`, by a
job that never saw an implementation of #223; none existed, and no other worktree, branch, PR or session was read.
#136's rule applies: a linked test counts only when run against our output, so every ported assertion here is checked
against what our binaries answer. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

Scope: criteria 1 to 5, each with upstream tests on the page. Criteria 6 to 9 have none (the page's "No upstream test"
table) and stay with `tests/acceptance/223/`. Every port also runs on a planted fault and must fail on it: the #223
suite's `warp_maps_anchors_only` for criterion 1, and for the others a fault planted in this lane's test code (a
fixture written the wrong way, or the program's own output read as a wrong program's), each first shown to be live.

## Sources

Each upstream test is pinned by commit; no upstream code is copied, and each assertion is re-expressed in the test that
ports it, named after its upstream test. Both projects' licenses are MIT as the pins file records; nothing is copied,
so no notice is carried.

| Criterion | Upstream, pinned | Tests | Ported as |
|---|---|---|---|
| 1 | a fork of an upstream animation library, `cfd33af5aa` | `tests/unit/test_mobject.py` 2479–2511 (test_an_image_is_within_its_tolerance_all_along) | `ac1-split.test.ts` |
| 2 | the upstream library, `a6d5cc02b4` | `tests/test_graphical_units/test_transform.py` 109–117 (test_ApplyComplexFunction), `control_data/transform/ApplyComplexFunction.npz` | `ac2-rises.test.ts`; the frames: BLOCKED |
| 3 | the library, `a6d5cc02b4` | `test_transform.py` 120–125 (test_ApplyMatrix), `test_movements.py` 38–41 (test_Rotate), `ApplyMatrix.npz`, `Rotate.npz` | `ac3-matrix.test.ts`; the frames: BLOCKED |
| 4 | the fork, `cfd33af5aa` | `tests/unit/animation/test_timeline.py` 256–291 (TestEveryAnimation.test_it_is_a_function_of_its_progress) | `ac4-progress.test.ts` |
| 5 | the fork, `cfd33af5aa` | `tests/unit/mobjects/test_shapes.py` 159–190 (test_a_tip_points_along_the_path_at_its_end), 230–241 (test_an_arrows_tip_is_where_it_ends) | `ac5-tips.test.ts` |

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/223-oracle --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/223-oracle/tsconfig.json   # type-check
rm -rf tests/acceptance/223-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #223 suite's helpers (`../223/helpers.ts`), so both lanes build and ask the same binary the
same way. Each file builds `cargo build --locked --bin deep-canvas-render` once, in `beforeAll`, and fails every test
whose build failed. `scripts/lanes.mjs` needs `'tests/acceptance/223-oracle/'` in its `alone` list; the #223 README
gives the line, and the implementer makes that edit. Every `it` passes a 60-minute timeout. Node built-ins and vitest
only.

## The surface under test

The #223 suite's, with nothing added: `deep-canvas-render path` of an item under a group's `warp` (its `subpaths`,
`tessellation` and `ends.end`), the planted `warp_maps_anchors_only`, and the documents' fields as that README spells
them (`params.warp` with `map`, `linear` or `complex`, `vars: {u: "time"}`, `mix` and its channel at
`items/<group>/params/warp/mix`, `plane`, `ends`).

## Ports

- **test_an_image_is_within_its_tolerance_all_along** (1): three maps, waves (x + 0.5 sin y, y + 0.5 sin x), square
  (x|x| ÷ 10, y) and complex square ((x² − y²) ÷ 10, xy ÷ 5), on six random paths of one to three cubics each, held
  alone and in a nested group. Every curve is cut into one whole number n of pieces, and piece j of n at 33 parameters
  t lies within 0.75 u of the map of its curve at (j + t) ÷ n: 1.5 × the 0.5 px tolerance, as the upstream test holds
  1.5 × its own. Planted fault: `warp_maps_anchors_only`.
- **test_ApplyComplexFunction** (2): a square of side 2 at the plane's origin under z + 2i, its mix keyed from 0 to 1:
  at progress 0, ¼, ½, ¾ and 1 every corner has risen 2 × progress plane units up the screen, within 1e-6 u. Planted
  fault: the same film on a plane read y down, where it sinks.
- **test_ApplyMatrix** (3): [[1, 0.5], [1, 0]] about (−10, 5) on the upstream square, our plane's origin the about
  point (unit 20 u): each corner at ((1 − u)I + uM)v at each progress, within 1e-6 u. **test_Rotate**: a half-turn key
  on a square keeps every corner 20√2 u from its centre and turns it 180° × progress. Planted faults: the matrix read by
  columns; a half turn written as the matrix −I, which passes through the centre.
- **test_it_is_a_function_of_its_progress** (4): for the #223 homotopy and a complex homotopy (`cmul(z, vec2(cos(u),
  sin(u)))`), at eight drawn pairs (a, b): the frame at b reached by way of a (one `path` line `[a, b]`) has the same
  sub-paths and tessellation as the frame at b reached directly (a fresh process). Planted fault: the frame built at a
  shown at b.
- **test_a_tip_points_along_the_path_at_its_end** and **test_an_arrows_tip_is_where_it_ends** (5): twelve random paths
  (straight last cubic, bending, a collapsed last handle) and eight straight arrows under the shear [[1, 1], [0, 1]]
  with `ends: redraw`: the tip on the sheared end within 1e-6 u, along the sheared arriving tangent (B′(1), else
  −B″(1), else B‴) within 1e-6 straight or 2e-3 bending as unit vectors, at the unwarped head's length within 1e-6 u.
  Planted fault: the unwarped heads read as the warped ones.

## Not ported

- **The frame comparisons** of test_ApplyComplexFunction, test_ApplyMatrix and test_Rotate against their `.npz` control
  frames: those frames are another renderer's, and comparing ours with them needs the pinned tests rendered once outside
  the repo and stored as goldens beside our fixtures' (the issue's Proof line). Each reads `BLOCKED:` with that one
  unblock line, never a pass.
- **test_an_arrows_tip_is_where_it_ends' shaft end**: the upstream arrow's shaft stops at its tip's base; our `path`
  reports an item's sub-paths before its ends (#160), so there is no shaft end to compare.
- **The upstream draw counts** (the upstream property tests' default of 100 examples): this lane draws a fixed, seeded handful
  per case, so a run is repeatable and a binary is spawned a bounded number of times.

## At the base

Not run: at `65f383b3f` nothing reads a group's warp, and no `path` plant of this name exists; `BASE-FAILURE.txt` says
where each test fails. The type-check exits 0.
