# Blind redraft of AC3 #177.ab6f72b4: exports, render-back and goldens stay SDR with HDR output on

Written blind, from issue #177's AC3, the design and the base commit `0e5572731`, by the same job that wrote
`tests/acceptance/177/` and never saw an implementation; none existed, and no other worktree, branch, PR or stash was
read. It replaces `tests/acceptance/177/ac3-sdr-outputs.test.ts` only, after the dispute in `DISPUTE.md`: the first
draft's golden and snapshot were blank to #380's blank guard, so its golden leg could never pass. The implementing
agent doesn't edit these files (AGENTS.md, Proof).

## What was read

Everything the first draft read (`tests/acceptance/177/README.md`: What was read), and for this redraft
`crates/deep-gpu-layer/src/golden.rs` at the base again: `fn blank`, `COLORS`, `OFF_MODAL`, `fn golden` (the blank
guard runs before the size check and the hash oracle), `fn decide` (it stores the blessed PNG's bytes as given) and
`fn canonical`; `tests/acceptance/424/helpers.ts`'s `ball`, `sun`, `material`, `box`.

## Run it

```sh
npm ci                                                                     # once, if node_modules is missing
node node_modules/typescript/bin/tsc -p tests/acceptance/177-redraft-ac3/tsconfig.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/177-redraft-ac3 --no-file-parallelism
rm -rf tests/acceptance/177-redraft-ac3/node_modules/.vite
```

It builds `cargo build --locked --bin deep-gpu --features test-meter` once (`../177/helpers.ts`'s `useBuild('gpu')`)
and runs on macOS's Metal device; anywhere else it fails `INCONCLUSIVE:`. Lane: `alone`, as `tests/acceptance/177/`.

## The surface under test

The first draft's, unchanged (`tests/acceptance/177/README.md`: The surface under test): view3d's `hdr`,
`stub_display` *(chosen)*, the `surface` target *(chosen)* and each frame's `hdr: {state, headroom}` *(chosen)*; view3d's
existing `class: "export" | "render_back"`; #380's `decide` (`via: "you"`) and `golden` with `oracle: "hash"`, whose
`numbers.pixels` is the snapshot's pixel hash. Imported from `../177/helpers.ts` (and #424's documents).

## Planted program

`deep-gpu run --planted export_reads_hdr_surface` *(chosen, as in the first draft)*: an export, a render-back snapshot
and a golden made while a view presents HDR draw from the HDR surface (rolled off to the headroom, then 8-bit). It
fails, naming an output.

## Criteria to tests

| Criterion | Test | What it asserts |
|---|---|---|
| AC3 `#177.ab6f72b4` | `ac3-sdr-outputs.test.ts` (1 + 1 plant) | A gradient blessed by you as the golden. Two processes over the shaded ball: a live view with hdr auto (it must present HDR) or off on the stub display (4, 4), then the export, the render-back and the golden of the same revision. The export's and render-back's frames and the gradient pass a port of the blank guard, and the golden reply isn't `blank`. The export's and render-back's `final` and `pixel_hash`, and the golden snapshot's `numbers.pixels`, are equal across the two processes. `export_reads_hdr_surface` fails, naming an output |

## Fixtures

Generated at test time; no files.

- **The golden** (`gradient`): 480 × 240 RGBA, red 255·x ÷ 479, green 255·y ÷ 239, blue 96, opaque.
- **The shaded ball** (`shadedBallDoc`, 480 × 240, orthographic, 40 px per m, #424's black sky with no ambient): a
  sphere of radius 2.4 m at the centre (base color 0.8, roughness 1), front-lit by a sun of π lx along −Z; a 1.6 m lamp
  of emission 8 at x −4.6 m; a 1.6 m highlight of emission 2 at x 4.6 m. The look is `../177`'s (agx, white 8,
  exposure scale 1).

## The blank guard

`blank` at the base: dark when at least 98% of pixels have luma (0.2126 r + 0.7152 g + 0.0722 b) ÷ 255 ≤ 0.06; flat
when under 32 distinct RGBA colors or under 5% of pixels off the modal color. Checked here by reading the code and by
a model (not a GPU run; this job built no Rust, the machine being loaded):

| Image | Distinct colors | Off the modal color | Dark | Blank? |
|---|---|---|---|---|
| The blessed gradient (exact) | 61,440 | 99.998% | 0.4% | no |
| The shaded ball's SDR frame (modelled: 0.8 cos θ through agx white 8, sRGB 8-bit) | 138 | 32.3% | 67.7% | no |
| The same rolled off to 4 and clipped (the planted program's frame, modelled) | 167 | 32.3% | 67.7% | no |
| The first draft's checker | 2 | 50% | 0% | yes (flat) |

The sphere covers about 29,000 px (25%); its shading keeps luma above 0.06 nearly to its rim, and the sun's specular
term at roughness 1 only adds colors. The test itself rejects a blank frame before comparing, so a fixture that fails
the guard on some GPU reads as a fixture failure naming the condition, never as a pass.

## Readings

As the first draft (`tests/acceptance/177/README.md`: Readings): "HDR output on or off" is the live view's session
state on the stub display at headroom 4 in the same process before the three outputs, and the run with it on must
present HDR. "A golden of the same revision" is the snapshot the golden call draws of that revision, compared by its
pixel hash; the blessed golden is only there so the call compares and reports it.

## Legs that read INCONCLUSIVE

Off macOS, or an `unsupported_platform` answer. Nothing reads BLOCKED: a `blank` golden answer fails the test, naming
the fixture.
