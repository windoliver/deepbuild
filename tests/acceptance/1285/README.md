# Acceptance tests for #1285: a sky@1 or puff@1 blanks the whole frame (their draws miss the material-maps bind group)

Written first, blind, by a job that never saw an implementation of #1285; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1285 as of 2026-11-04: Cause, Repro, and its five acceptance criteria.
- `docs/technical-design.md`: the parity suite's blank guard ("luma at most 0.06 over at least 98% of its pixels,
  film.blank's measure"), Dogfooding. `docs/canvas-primitives.md`: Sky `sky@1`, Puff `puff@1` (lit by the key sun and
  the sky's ambient), film.blank.
- At the base (`0c153d7c`): `crates/deep-gpu-layer/src/view3d.rs` (`from`, `frames`, `capture`, `targets`,
  `timings` → `gpu_ms`, `packs`), `crates/deep-scene3d-render/src/lib.rs` (`sky_draw`, `puff_draw`) and
  `scene3d.wgsl` (`sky_fs` draws the sky's gradient as the background; `puff_fs`), `packs/examples/castle.json`,
  `scripts/proof-change.mjs` (criterion IDs), and `tests/acceptance/422/` (its helpers, imported, not copied: the
  build, `runGpu`'s checks, `view3dCall`, `framesOf`, `decodePng`, `castle()`, `PLAIN_LOOK`, `sessionDoc`, `camera`,
  `box`, `material`, `sun`, `changedShare`) and `tests/acceptance/1016/` for this README's form.

## What the base does

Every `view3d` of a document with a `sky@1` or a `puff@1` draws a black final target and reports `gpu_ms` 0: the
sky's and the puffs' pipelines expect bind group 3 and their draws set only 0 to 2, so wgpu drops the frame's encoder
and stderr says so (`The current set RenderPipeline with 'scene3d.sky' label expects a BindGroup to be set at index 3`,
and the same for `scene3d.puff`). A document without either draws, with `gpu_ms` above 0. Also at the base, every
`view3d`, a camera alone included, writes a second device validation error to stderr:
`In Device::create_bind_group: Number of bindings in bind group descriptor (0) does not match the number of bindings
defined in the bind group layout (11)`. AC1 and AC3 say no device validation error is written while drawing, so that
one has to go as well. `BASE-FAILURE.txt` is the suite's output at the base.

## Run them

They build `deep-gpu` (`cargo build --locked --bin deep-gpu`, through #422's `useGpu`), so they run one file at a time.
`scripts/lanes.mjs` needs `'tests/acceptance/1285/'` added to its `alone` list, beside `tests/acceptance/422/`; this
README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1285 --testTimeout=1800000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1285/tsconfig.json
```

`--root` keeps the checkout's own `vitest.config.ts` out of it (it needs the workspace packages built). Every test
draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes. Nothing needs
a reference Mac, the network or a model. Each test writes into its own temporary folder and deletes it. Each takes a
few seconds after the build.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1285.<id>`. film.blank's measure is
this suite's own: a pixel's luma from its 8-bit final values with Rec. 709's weights, ÷ 255; a frame is blank when at
least 98% of its pixels are at or under 0.06. "No device validation error" means no stderr line matching
`validation error`, `expects a BindGroup` or `wgpu error` (case aside).

| ID | Criterion (short) | Test, what it asserts, and the wrong programs it catches |
|---|---|---|
| AC1 `#1285.2ac36129` | A camera and a bright `sky@1` draw a final frame that isn't blank; no device validation error on stderr | `sky.test.ts` (1): a camera and `sky@1 {top: 0.95, low: 0.85 grey}`, 64 × 48, one frame, final target, the plain look. The frame isn't blank, at least 98% of its pixels have luma ≥ 0.5 (the near-white sky fills the view), and stderr holds no validation error. Catches: the base (black, `scene3d.sky` error); a sky over part of the view; a fix that skips the sky's draw |
| AC2 `#1285.9b9bfe99` | With a lit `mark.box@1` in front of the camera, the box draws over the sky: its pixels differ from the sky's | `box.test.ts` (1): AC1's document and the same with a key sun and a red 1.6 m box 5 m in front of the camera (it covers about x 16–50, y 9–42 of the frame). With the box: not blank; every pixel of the four 6 × 6 corners bright (luma ≥ 0.5) and within 8 codes of the sky alone; every pixel of the middle 12 × 12 more than 16 codes from the sky alone; no validation error. Catches: the base (both black); a sky that draws but a box that doesn't; a box under the sky; a box drawn with the sky dropped |
| AC3 `#1285.a78aa552` | `puff@1` clouds with no `sky@1` draw: the frame differs from the one without them, `gpu_ms` above 0, no validation error | `puffs.test.ts` (1): a camera, a key sun and three puffs (0.7–0.9 m, density 0.8) over the middle, no sky; the control is the same without the puffs; one frame each with `timings`, one process. ≥ 5% of pixels differ by > 2 codes; every pixel of the middle 8 × 8 brighter than the control by > 16 codes in some channel; every pixel of the four 4 × 4 corners (no puff reaches them) within 2 codes of the control; both frames' `gpu_ms` above 0; no validation error. Catches: the base (black where the control is its dark grey background, `gpu_ms` 0, `scene3d.puff` error); clouds that don't change the frame; a frame that differs only by going black |
| AC4 `#1285.3c874962` | The castle draws non-blank frames, each frame's `gpu_ms` above 0 with `timings` | `castle.test.ts` (1): the castle as #422's `castle()` reads it (its size, its look, `packs/composites-1.0.0`, 30 fps), final target and `timings`, frames 0–2 and 360–362 (its half-turn, by `from`), every one captured: each isn't blank and has `gpu_ms` above 0. Catches: the base (all black, all 0); a fix that draws only a first frame; a timer that reads 0 |
| AC5 `#1285.b504b684` | Any change to #422's goldens and to its `castle`, `taste`, `furnace-materials` and `layers` suites once the sky draws is reported on the PR | No test: a reporting duty of the implementer on the PR (what changed in `tests/goldens/422` and in those four suites' results once the sky draws, with their output). It is proven by the PR's text, not by a check this job can write |

## Not covered

The criteria name no fixture size; the small ones are this job's choice (64 × 48 as the issue's repro draws). The
castle draws at its own size, six frames, not its full orbit. That the tests pass on a correct program was not run
here: no implementation existed, and this job didn't write one. The fixtures were checked at the base only where the
base can draw them: the box without a sky draws over x 16–50, y 9–42 of the frame, clear of the corners AC2 reads, and
a document without a sky shows a dark grey background (16, 17, 20), which AC3's corners compare against.
