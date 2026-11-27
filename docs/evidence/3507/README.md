# #3507: what the geometry pass shades

The overdraw view now counts, beside its own count, the fragments the geometry pass shades. On #3031's every-pass
fixture that is under the drafted 1.1 a covered pixel, so no pass changed. On each class's fixture it is 1.32. The
owner reworded the issue's second criterion on 2026-11-26 to the count the Scope describes, from 1 to 2 a covered
pixel, after a cull that brought the classes to 1 moved one pixel of another suite's frame and was taken out.

Shaded on `every_pass`: 1.0247 a covered pixel, 0.8722 a pixel, over 300 frames
Geometry pass: unchanged

Read on main at `5a81b58de` with this change, on 2026-11-26, on a Mac17,10 (Apple M5 Max, macOS 26B8119), on Metal,
headless, under the GPU lease's file, on mains power, at a one-minute load of 32 to 37 on 18 cores, and twice more
at higher loads with the same bytes. The readings are counts, which don't move with load. They are from one machine
and set no budget.

## The count

`deep_show`'s `overdraw` mode returns the row it returned, with two whole numbers more:

```json
{ "id": "frame", "what": "overdraw", "max": 9, "shaded": 6730807, "covered": 6596328 }
```

- `shaded` is the fragments the frame's geometry pass shades: its opaque solids, in the order the pass draws them
  (writer layers in order, a layer's sets in the pass's set order with a lower band's last, a set's solids in the
  layer's order, an instancer's batch as the rows the camera's cull kept this frame), each set with the faces the
  pass culls for it, against a depth the pass's compare tests and writes, at one sample a pixel
- `covered` is the pixels an opaque solid covers: those where `shaded` is at least 1
- `max` is the mode's own count, as it was: every face, depth ignored

The view draws the same triangles it counts for `max` once more against depth, in the pass's order. Where a set
draws through the GPU cull, it draws the frame first, so the cull's list is that frame's. It adds no mode, and
nothing reads the count but the row.

What the count leaves out: a fragment the pass's shader discards (a cutaway's far side, a mask's holes) counts and
hides what is behind it; a lower band inside a margin isn't counted, as the mode's own count leaves it out; and the
pass draws 4 samples a pixel where the count takes one.

## The seven fixtures

Each fixture's 300 frames are #3031's: frame k at k ÷ 5 s. A class's fixture is `benchmarks/canvas/<class>.json`
under the perf lane's look; `every_pass` is `docs/spikes/3031/fixtures/every-pass-plus.json` under its own look.
A fixture's count is the mean over its frames of each frame's quotient.

Shaded on `core_view`: 1.3184 a covered pixel, 0.4982 a pixel, over 300 frames

Shaded on `data_view`: 1.3187 a covered pixel, 0.4983 a pixel, over 300 frames

Shaded on `figure`: 1.3194 a covered pixel, 0.4493 a pixel, over 300 frames

Shaded on `work_product`: 1.3195 a covered pixel, 0.3744 a pixel, over 300 frames

Shaded on `showpiece`: 1.3191 a covered pixel, 0.4491 a pixel, over 300 frames

Shaded on `export`: 1.3184 a covered pixel, 0.4981 a pixel, over 300 frames

| Fixture | Size | Frames | The mode's own count a pixel | Its largest | Shaded a pixel | Shaded a covered pixel | Least to most in a frame |
|---|---|---|---|---|---|---|---|
| `core_view` | 480 × 270 | 300 | 0.756 | 2 | 0.498 | 1.318 | 1.313 to 1.323 |
| `data_view` | 640 × 360 | 300 | 0.756 | 2 | 0.498 | 1.319 | 1.313 to 1.323 |
| `figure` | 640 × 400 | 300 | 0.681 | 2 | 0.449 | 1.319 | 1.313 to 1.327 |
| `work_product` | 800 × 600 | 300 | 0.568 | 2 | 0.374 | 1.319 | 1.313 to 1.327 |
| `showpiece` | 1280 × 800 | 300 | 0.681 | 2 | 0.449 | 1.319 | 1.313 to 1.326 |
| `export` | 1280 × 720 | 300 | 0.756 | 2 | 0.498 | 1.318 | 1.313 to 1.323 |
| `every_pass` | 3456 × 2234 | 300 | 1.792 | 9 | 0.872 | 1.025 | 1.014 to 1.036 |

The mode's own count a pixel is #3031's reading (`docs/spikes/3031/README.md`); the view's own count is unchanged.
The other columns are this run's, kept frame by frame in [`counts.json`](counts.json) as `[max, shaded, covered]`.

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-show
DEEP_BIN_DIR=target/debug node docs/evidence/3507/count.mjs   # counts.json, and the lines and tables here
```

`count.mjs` reads the mode through the acceptance suite's own driver (`tests/acceptance/3507/drive.mjs`).

## The every-pass fixture, and why no pass changed

The pass shades 1.025 fragments a covered pixel there, between 1.014 and 1.036 in a frame: under the drafted 1.1, and
under the 1.05 a change would have had to reach. #3031 bounded it between 0.85 and 1.32 a pixel, which is 1 to 1.55 a
covered pixel. It sits near 1 because the floor, which alone is what #3031 found on 47% of the frame's pixels, draws
last and fails depth wherever a box or a crowd element stands, and because each solid there has a material, so its
back faces are culled. What is left is a box or a crowd element drawn before a nearer one: the fragments past one a
covered pixel are 1.4% to 3.6% of the covered pixels.

So the geometry pass is as the merge base's. No depth is kept, no depth pass is added and no order changes; the
planted pass the suite names for a changed pass (`geometry_pass_at_merge_base`) doesn't exist, and the timing rounds
time nothing.

## The two walls

Two 4 m × 3 m walls of one material face an orthographic camera, one 2 m behind the other; each covers 19,200
pixels (`tests/acceptance/3507/fixtures/`).

| Order | Shipped count | Planted `shaded_count_skips_depth_test` |
|---|---|---|
| The nearer drawn first | 19,200 over 19,200: 1 | 38,400 over 19,200: 2 |
| The farther drawn first | 38,400 over 19,200: 2 | 38,400 over 19,200: 2 |

The suite's check fails the planted count with `FAIL: two walls, the nearer drawn first: the count is 2.000 a
covered pixel (38400 fragments over 19200 covered pixels), not 1`.

## Criterion 2, as the owner reworded it

The issue said the geometry pass culls back faces, and that each class's fixture therefore counts 1 a covered pixel.
The pass culls them only for a solid with a material (`prepare_batch` in `crates/deep-scene3d-render/src/lib.rs`: a
solid with no material gets no cull, and draws through `mesh_pipeline`). Each class's bars are painted marks with no
material. A box's faces draw in the order +X, −X, +Y, −Y, +Z, −Z, and the class's camera stands on the +X, +Y, +Z
side of every bar. So a bar's −X face draws before the +Y and +Z faces in front of it, and its −Y face before +Z:
those back fragments pass depth, shade, and are then shaded over. No bar hides another in any of the 1,800 frames
(the mode's own largest count is 2 in each), and every frame counts between 1.313 and 1.327.

The criterion now reads "the count is from 1 to 2 a covered pixel in every one of the 300 frames, and the report
gives each fixture's count". Its test is the blind redraft `tests/acceptance/3507-redraft-ac2/`, which holds each
frame to that range and the six lines above to its own count. The first draft's test, for the criterion as it was,
is kept as written and runs by hand only; it fails on all 1,800 frames, the first as `core_view, frame 0 (0s): the
count is 1.313 a covered pixel (62559 fragments over 47661 covered pixels), not 1`.

### What was tried first: culling a closed mark's back faces

At the owner's choice, boxes, cylinders and spheres with no material, that no cutaway reaches, culled their back
faces as a solid with a material does. Every class then counted 1.000 in all 1,800 frames, and four of the five
suites still hashed as the merge base. The fifth did not: frame 50 of #418's still room differed on one pixel of
307,200 (x 246, y 181: 219/209/198 for 208/198/188), with ao on and with none, and the frames on each side of it
were the same. The camera is outside every box there, so the pixel is an edge sample that a back face held. No cull
keeps such a sample, so the cull was taken out and the criterion reworded. The class fixtures still pass the drafted
1.1, and what would bring them to 1 without moving a pixel (a depth pass for sets that cull nothing, color where
depth is equal) is not in this change.

## The hashes

On Metal, each of the five suites ran whole in this checkout, and the merge base's build (`5a81b58de`) drew each
frame again from the same input (`tests/acceptance/3507/ac4-hashes-<n>.test.mjs`). Every hash is the same.

| Suite | Frames | Children drawn by both builds | Left out |
|---|---|---|---|
| `tests/acceptance/418/` | 186 | 11 | 1 planted child |
| `tests/acceptance/424/` | 130 | 19 | 6 planted children |
| `tests/acceptance/428/` | 318 | 33 | 10 planted children |
| `tests/acceptance/465/` | 7,953 | 11 | 2 planted children; `budgets.test.ts`, run by hand |
| `tests/acceptance/1637/` | 243 | 20 | 4 planted children; `budgets.test.ts`, timed |

That is 8,830 frames, on the build this change ends with. No pass changed, so the suites' frames never reach the
changed code: the overdraw view is the only caller. With the cull above in, #418's suite differed on the one frame
named there and the other four read the same.

## What was run, and what was not

On the final build, each once, one at a time, under a test grant:

- `ac1-two-walls`: both tests pass
- `3507-redraft-ac2/ac2-classes`: passes: every one of the 1,800 frames counts from 1 to 2 a covered pixel, and the six
  lines above are its own counts
- `ac3-report`, `ac3-branch` (frames 0, 75, 150 and 225 by both builds: one pass list, the same 16 timed passes, the
  same draws) and `ac3-timing` (no pass changed, so it times nothing): pass
- the five `ac4-hashes` files: pass. `ac4-hashes-418` first read BLOCKED, the GPU lease taken from it by another
  run, and passed when run again
- `ac5-unedited`: passes, 0 files under `tests/acceptance/` differ from the merge base
- `cargo fmt --all -- --check`: exit 0. `cargo clippy` on `deep-scene3d-render`: clean
- `cargo test -p deep-scene3d-render`: passes but for two tests of #3016's, neither this change's (Also found)
- #427's suite, the overdraw mode's own, whole: 14 of 14 in three rounds, and in six more alternated with the merge
  base on the same sources
- `node scripts/affected.mjs` for the three `deep-scene3d-render` files: 640 passed, 178 new failures, 91 known, 24
  inconclusive or blocked. None of the 178 names this change: 162 are lints of files it doesn't touch, 9 were vitest
  files that didn't start, and 7 are cargo tests that fail the same on the merge base or need a built hub. The 9
  ran once the packages were built: 6 pass, and `3016/query`, `381/depth` and `140/view/glyphs` each fail one test
  the same way on the merge base

One thing went wrong on the way and was put right. The first cut drew the frame before every overdraw view. With it,
#427's live-window tests failed in 4 of 8 whole runs of that suite, against 1 of 7 on the merge base. The view now
draws the frame first only where a set draws through the GPU cull. The counts are byte for byte the same.

Not run:

- `node scripts/affected.mjs` for the whole change. The four `deep-show` files select 1,711 files that run alone,
  hours on this machine
- `tests/acceptance/3256/ac7-budget.test.mjs`, a timed file
- Any timing: no pass changed

## Also found

- **#3031's program stops on this tree.** `spikes/3031`'s `overdraw` mode takes the view's count by keeping the one
  buffer the view reads back. The view now reads two back, so that mode ends with "the view's count read-back was
  not the one buffer". Its kept outputs and its report are of `9e77c2ad6` and stand
- **#3016's device-bytes test flickers on the merge base.** `acceptance_3016_metal`'s criterion 3 test fails by 0.6
  MiB of 506 when it runs after the binary's criterion 5 test, and passes alone. Run whole eight times by each
  tree's own binary, it failed 3 times on the merge base and 2 on this change. It is not in
  `scripts/known-failures.json`
- **Main's own failures met on the way**, each the same on the merge base: #3016's criterion 9 test (five open
  issues link a heading `docs/technical-design.md` doesn't have); `deep-gpu-layer`'s every-pass check test and
  `deep-replica`'s `replica_equals_live_tree`; #418's `kit-shipped-redraft`; and clippy lints under this toolchain in
  `deep-canvas-physics` and three `deep-show` files
- **The opaque solids' pipelines blend.** Their color target has premultiplied blending on, and their shader can
  discard. A GPU that removes hidden surfaces before it shades does so only for draws that do neither, so on such a
  GPU the pass's order costs what this count says. Whether an opaque write there would change a pixel was not read
