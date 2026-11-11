# Acceptance tests for #2293: deep_show's 3D frame and 3D modes draw a world output's item where eval puts it

Written first, from issue #2293 (its two acceptance criteria and the rally it names), the design sections below and base
commit `331b68be1` ("Merge pull request #2273 …"), by a job that never saw an implementation; none existed, and no other
branch, pull request or worktree was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, each with the one sanity
assertion that keeps its comparison from passing vacuously.

## What was read

- The issue, live with `gh issue view 2293 --repo windoliver/deepbuild`.
- AGENTS.md (Proof). `docs/technical-design.md`: Dogfooding and Tests written first; Render-back; The physics module's
  Input, occurrence, output. `docs/canvas-primitives.md`: Render-back; Render-back: diagnostic modes; Physics output.
- At the base, only for the surfaces these tests drive: `tests/acceptance/1918/` (README, `helpers.ts`,
  `ac4-scene-lab.test.ts`: the rally and how it drives `deep-show run` with `showCall`, `evalCall` and `paths`);
  `tests/acceptance/1921/helpers.ts` (how it reuses 1918's helpers); `tests/acceptance/427/helpers.ts` and
  `positions.test.ts` (how a mode call without a document is shaped and its rows read);
  `crates/deep-show/src/main.rs` (the call shapes: `deep_show`'s `include` and `t`, the `mode` call, `eval`'s `paths`);
  `crates/deep-show/src/query.rs` (`eval`'s `paths`: `items/<id>/at` reads `{pos, rot, scale}`, rot in Euler degrees as
  the core's transform holds it); `crates/deep-show/src/snapshot.rs` (`visible`: rows `{id, box: [x, y, w, h]}` in
  pixels, those on screen, sorted by ID); `crates/deep-show/src/modes.rs` (`mode_show`, and `bounds_3d`'s rows
  `{id, what: "box", pos, min, max}`); `crates/deep-canvas/src/schedule/core_ops.rs`'s `Transform` (rot as three Euler
  degrees); in `hub.rs` only the reply fields (`visible`, `outcome`, `reason`) and `flicks`. Not read: hub.rs's 3D draw
  path, `physics.rs` and `played.rs`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/2293 --testTimeout=1800000 --no-file-parallelism
npx tsc -p tests/acceptance/2293/tsconfig.json
rm -rf tests/acceptance/2293/node_modules/.vite
```

The frames need the GPU (Metal on the reference Mac), so run outside a sandbox that hides it. Each file builds
`deep-show` once in `beforeAll` through `../1918/helpers.ts` (`cargo build --locked -p deep-show --bin deep-show`, the
default `full` set, honoring `CARGO_TARGET_DIR`) and copies it to a temporary folder. A cold build takes many minutes.
Every test passes an explicit 60-minute timeout (#2009's `TIMEOUT`); each `deep-show run` within it has 30.

## The surface under test

`deep-show run` (#393's convention, as #1918's suite drives it): one scenario line on stdin, one answer with a reply per
call. The calls:

- `deep_show` with a `document`, `include: ['pixels']` and `t: '0.5s'`: the 3D frame drawn at 0.5 s, its `visible`
  table (Render-back: "a table of visible item IDs with screen boxes").
- `eval` at frame 30 (0.5 s × 60 fps, in flicks) with `paths` `items/ball/at/pos`, `items/ball/at/rot` and
  `items/ball/at/scale` (`ac1`), or `items/ball/at/pos` (`ac2`).
- `deep_show` with `mode: 'bounds'` and `t: '0.5s'` and no document: the bounds mode of the current revision
  (Render-back: diagnostic modes: "bounds draws each item's evaluated bounds at t"), its `drawn` rows.

## The rally

#1918's criterion 4 scene (`tests/acceptance/1918/ac4-scene-lab.test.ts`, paddle channel from x0 = 5), copied into
`helpers.ts` with each `mark.box@1` item's params given `paint: { fill: { role: 'accent' } }`, as the issue says. Its
world `lab` kicks the ball at (6, 3, 0) m/s from (0, 0.11, 0); its output `ball` binds the ball's pose to
`items/ball/at`; the ball's item has no `at`, so its authored place is the origin. The camera sits at (3, 3, 12) looking
at (3, 0.5, 0), so both the origin and the baked pose at 0.5 s are on screen. At the base, eval reads that pose at
(3.000, 0.379, 0) m, as the kick predicts: y = 0.11 + 3 × 0.5 − 9.81 × 0.5² / 2 ≈ 0.384 m, before any bounce. The issue
says about (3.000, 1.019, 0); the tests read the pose from eval and don't depend on either number.

`rally({ output: false, ballAt })` is the same scene with the output to `items/ball/at` left out and the ball's `at`
authored as given; `rally({ output: false })` leaves the ball at its authored place.

## Criteria to tests

| Criterion | ID | Test |
| --- | --- | --- |
| In the rally at 0.5 s, `deep_show` with `include: ['pixels']` answers a `visible` row for `ball` whose box is the one the same scene draws when the ball's `at` is authored at the pose `eval` reads for `items/ball/at` at 0.5 s | `#2293.8649cfa0` | `ac1-frame-box.test.ts` |
| The `bounds` mode of the rally at 0.5 s answers the ball's bounds centred on the position `eval` reads for `items/ball/at/pos` at 0.5 s | `#2293.9d1c0f9e` | `ac2-bounds-mode.test.ts` |

IDs: `scripts/proof-change.mjs`'s `criterionId` (the first eight hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed).

- `ac1`: run 1 shows the rally with its pixels at 0.5 s and reads `eval`'s pose at `items/ball/at` (its `pos`, `rot`
  and `scale`) at 0.5 s. Run 2 shows the comparison scene, the ball's `at` authored as the `{pos, rot, scale}` run 1
  read, with its pixels at 0.5 s, then the scene with the ball at the origin. Sanity: eval's ball is more than 1 m from the origin, and the comparison's ball box
  centre is more than 10 px from the origin one's. The criterion: every number of the rally's `ball` box is within
  0.5 px of the comparison's.
- `ac2`: one run shows the rally, reads `eval`'s `items/ball/at/pos` at 0.5 s and asks for the `bounds` mode at 0.5 s.
  Sanity: eval's ball is more than 1 m from the origin. The criterion: the mode's one `drawn` row for `ball` has its
  box's centre, (min + max) / 2, within 1 mm of eval's position on each axis.

## Readings where the issue leaves a choice

- "The pose `eval` reads for `items/ball/at`": read as its three fields, `items/ball/at/pos`, `/rot` and `/scale`.
  `eval` reads `items/<id>/at/<field>` from the evaluated transform, but a bare `items/ball/at` falls through to the
  authored document, where the ball has no `at`, so at the base it answers null. Reading the whole path made `ac1`
  fail on that null, before it reached the frame. The fields hold the same pose: the transform's pos, rot (Euler
  degrees) and scale.
- "In the same run": a scenario's calls are all given up front, so the pose `eval` reads can't feed a later call of
  the same `deep-show run`. Each test reads it in its own first run and builds the comparison from that reply, in the
  same test; nothing is hard-coded.
- "The same scene … when the ball's `at` is authored at the pose": the comparison leaves out the world's output to
  `items/ball/at`, so only the authored `at` places the ball. With the output kept, a fix that drew the output at some
  wrong pose would draw both scenes there and pass; without it, the comparison is the ball at eval's pose and nothing
  else.
- "Centred on": the centre of the row's `min` and `max`. A turned box's axis-aligned bounds stay centred on its pose, so
  the ball's spin doesn't move it.
- A GPU this machine can't open: a frame or mode reply that isn't presented and names `unsupported_platform` or
  `gpu_unavailable` makes the test fail with `INCONCLUSIVE: …; this is not a pass`; any other reply that isn't presented
  fails at "is presented", naming the reply. Neither passes.

## Tolerances

- `ac1`, 0.5 px on each of x, y, w and h: both boxes are the same item, the same size, at the same pose (the comparison
  authors exactly the numbers eval read), drawn by the same renderer at the same camera and size, so they agree to
  rounding. Half a pixel admits f32 rounding of the pose, which is well under a micrometre and so far under a pixel at
  about 70 px a metre here, and nothing else. The ball's box is 16 to 20 px across. At the base, the baked pose
  draws 215 px from the authored place, so a ball drawn at its authored place misses by far more.
- `ac2`, 1 mm on each axis: the bounds' centre and eval's position are the same f32 pose read twice. The authored
  place is 3 m away, and the ball is 0.22 m across.
- The sanity floors, 1 m and 10 px, sit far under the expected 3 m and 215 px, and far over any rounding.

## At the base

See `BASE-FAILURE.txt`.
