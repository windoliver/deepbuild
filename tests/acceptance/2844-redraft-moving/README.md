# Blind redraft of #2844's criterion 2: "without changing a pixel", held on scenes whose lights and occluders move

`ac2-moving.test.ts` here adds scenes to what `../2844/ac2-frames.test.ts` judges. It redrafts criterion 2 only
(`AC2 #2844.11438f50`): "Every frame that `tests/acceptance/2031/` and `tests/acceptance/2032/` draw is byte-identical
to the merge base, and both suites pass unchanged". The first draft stays as written and keeps what it holds: the
suites' own frames, "both suites pass unchanged" and criterion 1. Written blind from the issue, the design and base
commit `5fcfb690b`; no implementation, other worktree, branch or pull request was read, and nothing outside this
folder changed.

## Why

The issue's task is to bring the shadows' cost under budget "without changing a pixel", and criterion 2 is how it says
so. The first draft compares exactly the frames the two suites draw, and lists under "Not asserted" any frame they
don't draw. Nearly all of those frames are still: one light list, one set of outlines, one time. Shadows move in one
document of theirs, #2032's `shadow-drift`: four lights of range 220 and eight lobed outlines of 25 corners, each
crossing a 320 × 180 floor on one straight line. It holds no outline with straight sides, no path of two sub-paths
and no sun, and nothing at the cap moves. So a light pass that answers wrongly for a light at one place among
hundreds, beside an outline, inside one, or at the end of its range, can pass them. The owner asked for a redraft
that holds the same comparison with the merge base on scenes of its own, whose lights and occluders move, so that a
light sees each outline from many places.

## What the base already does

Everything here is in the base: shadows, a sun, the planted programs and both surfaces. At the base the merge base is
the base, so the two sides are one program built twice and the test passes by construction. A pass at the base proves
nothing; the wrong programs below are what make it count.

## The test

One test, `AC2 #2844.11438f50 … every frame of eight scenes of moving lights and occluders is byte-identical to the
merge base's, and each planted shadow is caught in each scene`. In order:

1. **The scenes hold what this README says**, on any platform: each scene's lights, outlines, segments and channels
   are the table's; no outline has two corners in a row at one place; every channel targets a number of its document.
2. **The merge base draws every frame.** A frame it refuses, or a process of its that ends without answers, is
   INCONCLUSIVE.
3. **The comparison is shown failing.** One window of each scene, drawn by the checkout under each of three planted
   programs, must be a picture other than the merge base's frame of that scene and time: 24 windows.
4. **The scenes move.** Of a scene's film frames by the merge base, and of its windows, more than one is a frame of its
   own and at least half are.
5. **Every frame the checkout draws is the merge base's**: 289 frames. A failure lists, for each scene that differs,
   its first three differing film frames and its first two differing windows, each with the scene, the time, both
   frames and how many of the scene's frames differ; a window also says how many pixels differ and reads the first.

One line is printed: the frames compared, how many differ in each scene, and how many planted windows were caught.

## The scenes

Documents are built as #2032's suite builds its own (`doc`, `group`, `rect`, `light`, `sun`, `outline`, `blob`,
`boxPoly`, `keyed`): the lit group `lamps`, a white floor over the whole document, and each outline a closed `path@1`
child with `occlude: true`, filled in `ground`, `accent` or `focus`. A walking light's `at` is keyed by two f32
channels (`items/lamps/params/light/lights/<k>/at/<0|1>`), the turning sun's `angle` by one, a moving outline's
position by two (`items/<path>/at/pos/<0|1>`), all linear between keys on whole seconds. Every call takes the look
`clean`. Energies are kept low, so that the white floor stays below full brightness and a shadow of any one light
shows.

| Scene (`moving-…`) | Size | Lights | Occluding outlines (segments) | Film | Windows |
|---|---|---|---|---|---|
| `walk-grid` | 480 × 320 | 4 point lights: 1 walks, 3 stand | 15 lobed, 24 to 40 corners each (480) | 48 frames, 8 fps | 12, every 0.5 s |
| `walk-seeded` | 480 × 320 | 4 point lights: 1 walks, 3 stand | 12 lobed, 20 to 36 corners each (329) | 42 frames, 7 fps | 8, seeded |
| `drift` | 400 × 260 | 4 point lights, all standing | 6 lobed, 4 boxes, 2 walls, all moving (195) | 32 frames, 8 fps | 6, seeded |
| `short-range` | 360 × 240 | 4 point lights: 2 walk (ranges 52, 64), 2 stand (48, 300) | a 280 × 9 wall, 3 lobed of radius up to 44 u, 2 boxes (104) | 24 frames, 8 fps | 5, seeded |
| `beside` | 320 × 200 | 3 point lights: 2 walk, 1 stands | a wall, 1 lobed of 32 corners, a box (40) | 32 frames, 8 fps | 5 |
| `yard` | 384 × 256 | 4 point lights: 2 walk, 2 stand | 3 boxes, a wall, an L, 2 lobed, 1 path of 2 sub-paths, 1 moving box (86) | 32 frames, 8 fps | 6 |
| `dusk` | 480 × 300 | a sun that turns, 3 point lights: 1 walks | 4 lobed, a box, a turned wall, 1 path of 2 sub-paths, 1 moving lobed (184) | 24 frames, 6 fps | 6, 4 seeded |
| `cap` | 960 × 540 | 16: a sun, 15 point lights of which 3 walk | 60 lobed of 64 corners, 4 of 60, 4 boxes; 4 move (4,096) | 4 frames, 2 fps | 3 |

238 film frames and 51 windows: 289 frames, each drawn by both sides, and 24 planted windows by the checkout. A film
plays every frame inside its span from frame 0 and stops one frame short of the span's end.

Why each, by the owner's list:

- **(a) A point light that walks among a dozen or more outlines of a few dozen corners each while other lights stay,
  at dozens of times.** `walk-grid`: the walker takes six 1 s legs through the lanes of a 5 × 3 grid of lobed outlines
  and cuts through two of them, at 48 film frames and 12 windows; three lights stand. `walk-seeded`: the same with
  nothing on a grid, at 42 film frames and 8 windows.
- **(b) Occluders that move while lights stay.** `drift`: twelve outlines each move by their position. One crosses
  over a standing light, two change places through each other, the rest drift 36 u a seeded way.
- **(c) A short-range light whose range ends part-way across outlines.** `short-range`: at every drawn time each of
  the three short ranges ends part-way across at least one outline, and across as many as four. The first walker
  crosses the long wall twice.
- **(d) A light close beside an outline.** `beside`: one light slides down a wall's face 1/4 u from it, in line with
  the wall's top edge at 1 s and its bottom edge at 3.5 s; one passes 1 u right of a lobed outline's rightmost corner,
  level with it at 2 s; one stands 1/8 u off a box's corner on both axes.
- **(e) Straight sides and right angles as well as lobed outlines, and one outline of two closed sub-paths.** `yard`:
  boxes, a wall and an L on whole units, a path of two closed sub-paths (two posts, a moving box passing between
  them) and two lobed outlines. One light walks down x = 128 and is in line with the boxes' and the L's horizontal
  sides at 1, 1.5, 2.5 and 3 s; one walks up the line of the wall's right face; one stands in the L's notch, on the
  diagonal through its inner corner. `dusk` holds the other kind of two sub-paths: an outline with a hole.
- **(f) A sun beside point lights.** `dusk`: the sun's angle is keyed from 0° to 90° over 4 s, so it reads 0° at
  frame 0 and 45° at 2 s, beside three point lights. One of them walks through the outline with the hole and stands
  in the hole at 2 s.
- **(g) A scene near the cap at a few times.** `cap`: 16 lights and 4,096 occluder segments, the cap itself, with
  three lights and four outlines moving, at four film frames and three windows.

**Exact and seeded coordinates.** `walk-grid`, `beside` and `yard` keep every corner, every light's place and every
drawn time on 1/8 u and 1/8 s. Their keys sit on whole seconds 1, 2 or 4 s apart, so at each drawn time the share of
the way between two keys is a binary fraction and the place is a multiple of 1/8 u, which f32 holds exactly.
`walk-seeded`, `drift`, `short-range` and `dusk` take seeded corners, places and window times with every digit f64
gives them (#467's `seeded`, each scene its own seed), and films at 7, 8 and 6 fps. `cap` holds its outlines and
lights on the grid and moves four outlines by seeded amounts.

**What the scenes hold at the drawn times**, computed in f64 from the documents alone (no frame was drawn): the
`walk-grid` walker is inside an outline at 6 of 48 times and comes within 0.8 u of one; the `walk-seeded` walker is
inside one at 5 of 50; in `drift` the first light is inside the outline that crosses it at 10 of 38 times and two
outlines overlap at 18; the first `short-range` walker is inside the wall or a lobed outline at 8 of 29 times, and
the standing short-range light is 0.95 u from an outline; the `beside` lights are 0.25, 1 and 0.18 u from their outlines
at nearest; in `dusk` the walker is inside the outline at 2 times and in its hole at 2 s. No light is on an outline
at any drawn time. With every light read as white, about 1% of a scene's floor is at full brightness at most.

## How a frame is compared

- **A frame** is a film frame's `pixel_hash` or a window's PNG.
  - `film2d` `{doc, look: "clean", fps, from: 0, frames, hash: true}` plays every frame of the scene's span in one
    process, so each frame is drawn after the one before it and anything the pass keeps between frames is in play.
  - `window2d` `{doc, look: "clean", t}` draws one time, `t` in flicks. Its PNG is read from `out` and compared by
    the SHA-256 of its bytes.
- **The two sides.** The checkout's `deep-gpu` is built by #467's `useBin`. The merge base is `git merge-base HEAD
  origin/main`, else `main`, exported and built by #2031's `useMergeBase`, the kept build under
  `<target>/acceptance-2031-base` that both suites' AC7 and the first draft share. Each side draws each scene in one
  `deep-gpu run` process (#467's `runGpu`): its film, then its windows in time's order.
- **A difference** is a frame whose text is not the merge base's: another hash, another PNG, a refusal, or no frame.
- **INCONCLUSIVE, never a pass**: off macOS's Metal device; where either side answers `unsupported_platform`; where
  the merge base can't be exported or built; where it draws no picture of a frame or its process ends without
  answers. A checkout that can't be built, or whose process ends without answers, fails.

## Wrong programs

| Where | The wrong program | Where the test fails |
|---|---|---|
| Every run | `deep-gpu run --planted shadow_edge_aliased`, `shadow_bounding_boxes` and `shadow_inside_outline`, the base's own (#2032's README: Planted programs), each on one window of each scene | Step 3: a planted window that is the merge base's frame, or no picture, fails `the comparison fails on each planted program in each scene`, naming the scene, the time and the plant |
| `twins.json`, twin `occluders-on-a-grid` | Each occluding outline casts its shadows from the nearest places of a 1/8 u grid, while its path draws where it is | Step 5, at its list of differing frames. Expected, by the stand-in below and not by a build of the twin: every frame of `walk-seeded`, `drift`, `short-range` and `dusk`, and each `cap` frame after 0 s. `walk-grid`, `beside` and `yard` hold |

**Why each plant changes each scene.** Every scene has shadow edges, which the first plant leaves unsmoothed; a lobed
outline, an L or a path of two sub-paths within a light's range, which its bounding box doesn't match; and the lit
face of an outline, which the third plant shadows. The plants are drawn on the checkout, so a change that stops one
of them changing a scene fails here too.

**The twin** is the base's `crates/deep-canvas-marks/src/light.rs`, 792 lines, with line 531 (`let occluders =
shadow::occluders(items, id)?;`) replaced by 21 lines that round each corner of each occluding outline to 1/8 u
before the light takes them. It moves only shadows, and only where an outline stands off that grid: an outline moved
by its position between keys, or one with seeded corners. Of the two suites' own occluders only `shadow-drift`'s
moving rocks leave that grid; every other one is a box on whole units or #2032's `blob`, which rounds to 1/8 u.

**How the twin is laid and built.** By the proof lanes (`scripts/proof-runs.mjs`, `twinsOf`): the file under
`twins/occluders-on-a-grid/` is copied over the same path in a copy of the change before its build, and the tagged
test runs there, building `deep-gpu` from it as it builds any checkout. By hand, in a scratch copy of the tree:
`cp tests/acceptance/2844-redraft-moving/twins/occluders-on-a-grid/crates/deep-canvas-marks/src/light.rs
crates/deep-canvas-marks/src/light.rs`, then the run below. Over a change that also edits `light.rs` it undoes that
edit and may not build, which the lanes read as BLOCKED or as a failure, never as a pass. `light.rs` is the file the
first draft's twin replaces too, and not among the files the issue's scope points the work at.

## Run it

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2844-redraft-moving/ac2-moving.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2844-redraft-moving    # type-check
```

Run from the checkout's root, so no tool's cache is left in this folder.

- **Lanes.** The test builds `deep-gpu` in the checkout and at the merge base and draws on Metal, so it runs alone.
  This folder holds no `lane.json`: `scripts/lanes.mjs` reads one only at `tests/acceptance/<digits>/lane.json`, and
  the guard refuses one anywhere else. The implementer adds this line to `scripts/lanes.mjs`; this README is the
  instruction, and this job edits nothing outside its folder.

  ```js
  // #2844's criterion 2, redrafted blind on moving scenes: it builds deep-gpu in the checkout and at the merge base
  // and draws on Metal. No timing.
  alone.push('tests/acceptance/2844-redraft-moving/');
  ```
- **Build.** `deep-gpu` in the checkout, and `deep-canvas-render` and `deep-gpu` at the merge base through
  `useMergeBase`, which the first draft and the suites' AC7 build too and keep for the next run at that merge base.
- **Time.** Not measured by this job. A run is 19 `deep-gpu run` processes: 126 windows, the largest 960 × 540, and
  476 film frames. The proof lanes stop a runner after 20 minutes and read its files as not run.
- **Isolation.** Pictures go under a temporary folder that is deleted; the merge base's tree and build stay under the
  target folder, as the suites keep them.

## Readings where the issue and the ask leave a choice

- **Whose frames.** The criterion's words name the frames the two suites draw. This test holds frames they don't
  draw, under the same criterion ID, because the issue gives the criterion its purpose ("without changing a pixel")
  and the owner asked for it. A change can pass the first draft and fail here; that is the point of the redraft.
- **"Byte-identical"** is the SHA-256 of a window's PNG file, and a film frame's `pixel_hash`, which is how a film's
  frame leaves the binary.
- **"The merge base"** is as both suites and the first draft take it.
- **"At many times".** A film at 6 to 8 frames a second over the whole span, and windows beside it. `cap` is drawn in
  seven frames, "a few".
- **"Moves".** The check in step 4. It doesn't ask that every frame differ from every other: while a light is inside
  an outline it lights only that outline's face, so two such frames can be the same frame.
- **"Each scene that has shadows"** is all eight.
- **"Near the cap"** is read as at the cap: 16 lights and 4,096 segments, which the base accepts.
- **"A few dozen corners"**: 24 to 40, and 20 to 36.
- **"Close beside"**: from 1/8 u to 1 u.

## Not asserted, because the ask doesn't say so

- What the frames show. They are compared with the merge base's, never with the CPU f64 test or a closed form.
- `deep-canvas-render raster` and `layers` of these scenes: the lit group on Vello CPU and by GPUI.
- That a sought frame is the played one (#2032's AC6), and frames under a planted program against the merge base's
  under the same plant.
- A light on an outline, a curved occluder, a lit group under a transform or a camera's zoom, an `unlit` child or a
  status mark under a shadow, an image with a normal page beside occluders.
- Any time. Criterion 1 stays with the first draft.

## What was read

- The issue, live (`gh issue view 2844`), and #2032, live.
- `docs/canvas-primitives.md`: Frame and group `frame@1`, `group@1`; Path `path@1`. `docs/technical-design.md`: 2D
  marks and paint; Criteria to tests, both ways; Wrong programs; The edit guard; Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/2844/` (the first draft, whole);
  `2032/` (README, helpers, the sun, wall, seek-and-play, AC7 and budget tests) and `2031/` (helpers, the head of its
  seek-and-play test); the helpers of `467/`; `2032-redraft-ac8/README.md`;
  `scripts/{lanes,proof-runs,proof-guard,proof-change,wait-ratchet,size-ratchet}.mjs`;
  `crates/deep-gpu-layer/src/{main,marks2d,film}.rs` (the planted names, `window2d`'s `t`, a film's reply),
  `crates/deep-groups-render/src/{lightfx.rs,lightfx.wgsl}` (what each plant changes),
  `crates/deep-canvas-marks/src/{light,shadow,path}.rs` (where a light takes its occluders, the cap, the path
  grammar), `crates/deep-canvas-motion/src/program.rs` (a channel's slot and range check) and the look `clean`. No
  expected value comes from them.

## What was run, and what was not

Not run, by instruction (a shared, loaded Mac): cargo, any build of the workspace, any draw on the GPU, either suite,
and so this test against the real binaries. The twin was not built. The proof lanes and `scripts/affected.mjs` were
not run. No base run is recorded here: the lead records it.

Not known until the base run, each a place this harness could fail for a reason of its own:

- Whether the base takes a channel on a sun's `angle`. The suites drive a light's `at` and `energy` only; the base's
  channel compiler gives any field of an item a slot (`program.rs`), so it should.
- Whether it takes an occluding path of two closed sub-paths, and one with a hole. Its path grammar reads both.
- `film2d` at 2, 6, 7 and 8 fps, and `window2d` at 960 × 540.
- That each plant changes each scene's window, and that each scene meets step 4. Both hold on the stand-in below.

Run:

- `node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2844-redraft-moving`: exit 0.
- **The test, on stand-ins.** In a scratch repository of its own under `target/`, with the base's real helpers of
  `467/`, `465/`, `2031/` and `2032/` and this test as it is, a stand-in `cargo` and a stand-in `deep-gpu` that draws
  each frame on the CPU in f64 from the design's sentences, on a lattice of every second to eighth pixel:
  - both sides the same: the test passes, 289 frames, none differing, 24 planted windows caught;
  - a checkout that rounds occluders to 1/8 u, as the twin does: fails at step 5 with 153 frames, in the five scenes
    the table names and no other;
  - a checkout that moves one pixel at 1.5 s in `beside` and in `yard`: fails naming those two film frames and two
    windows, each window with its one pixel;
  - a checkout whose plants draw as the right program: fails naming the 24 windows;
  - both sides ignoring `t`: fails at step 4, naming each scene;
  - a checkout that drops a film's last frame, refuses a scene, ends without answers, or doesn't build: fails, naming
    the frame, the scene or the build;
  - `unsupported_platform` from either side, and a merge base that refuses a scene, ends without answers or doesn't
    build: INCONCLUSIVE.
- **The twin's lines.** Over stand-ins of the types they touch, in one file, `rustc` 1.99.1 with warnings denied
  compiles them, and the result rounds a path's corners to 1/8 u. That is no build of the crate.
- **The lanes' reader.** `scripts/proof-change.mjs`'s `spans` reads the test's name, `tagsWithImports` finds
  `#2844.11438f50`, the twin's path is outside the test paths, and `scripts/lanes.mjs` reads no `lane.json` here.
