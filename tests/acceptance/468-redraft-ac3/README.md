# Blind redraft of #468's AC3: a leader and a wire on lid#hinge

A fresh run of the blind acceptance-test job, redrafting one criterion of issue #468 ("Lens and focus: a camera lens,
depth of field, focus pulls and 3D lines anchored to parts"):

> AC3 `#468.632af807`: With a lid that opens 110° while the camera orbits 90°, a label anchored to the right edge with
> a leader to lid#hinge keeps the leader's end within 0.5 px of that anchor's projection at 200 random times, has the
> same pixel hash seeked or played on one machine, and hides exactly at the times the anchor's projection leaves the
> safe frame; a 3D line with one point at lid#hinge passes through that anchor at every sampled time

Written from the issue (read live), the design sections below and base commit `abf74b4ee` ("Merge pull request #2575
…", main), by a job that never saw an implementation of #468, the first draft, or any other worktree, branch, PR, stash
or session. Why a redraft: `DISPUTE.md`. The implementing agent doesn't edit these files (AGENTS.md, Proof; technical
design, Dogfooding). The ID is `#468.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white
space collapsed (`criterionId` in `scripts/proof-change.mjs`), computed from the live issue.

## What was read

- Issue #468, live (`gh issue view 468 --repo windoliver/deepbuild`): its Scope ("A 3D line's point can name an item's
  anchor, so a wire or a leader stays on the parts it joins") and AC3.
- `docs/canvas-primitives.md`: Overlay (4585: `anchor: corner | edge | {item, point}`, `margin: px = safe`, `leader {to:
  ID[#anchor], line, width, dash, end, elbow, gap}`, `hide: off_frame | never`, and the semantics paragraph: a leader
  "draws each frame from the overlay's nearest edge, less `gap`, to its target's anchor projected through the shot's
  camera at t"; with `hide: off_frame` "the overlay and its leader hide at every t where the anchor's projection falls
  outside the safe frame"); Overlay: clamped to the edge (4609, for what `hide` is not); Marks in 3D: lines (4651: "An
  entry of `points` may be `ID[#anchor]`", "evaluated at t through the same pure evaluation as a trail's source, so
  seeking equals playing"); Camera `camera@1` (4460); the document envelope's `safe: f32, u = 24` (304) and `at.pivot`
  (337); `at.place`'s edge names (384).
- `docs/technical-design.md`: Dogfooding (2658). `AGENTS.md` (Proof).
- At the base, only to find the surfaces: `crates/deep-gpu-layer/src/view3d.rs` (the call's fields; `seeks`;
  `overlays: true`'s rows `{id, at}`; `counts`' `segments`; `pixel_hash`, the SHA-256 of each drawn frame's bytes),
  `view3d/history.rs` (`order`: how `from`, `frames` and `seeks` chain), `fed.rs` (`segments`),
  `crates/deep-canvas-scene3d/src/scene.rs` (`overlay`: an `overlay.frame@1` must name `anchor.item`; `point_of`: a
  line's `ID#anchor` is the item's origin; `pivoted`), `inset.rs` (`named_frame`: item `anchors: {name: {pos, rot}}`),
  `views.rs` (the safe inset), `session3.rs` (every frame's bytes read back).
- `tests/acceptance/506/README.md` (Surfaces this job invents, items 5, 7 and 8) and its `helpers.ts`, reused unchanged;
  `506-redraft-ac5/README.md` (it keeps item 8 as it was); `378`, `419`, `466`, `1173`, `1174`, `173` for conventions.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/468-redraft-ac3 --no-file-parallelism --testTimeout=3600000 ac3-hinge.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/468-redraft-ac3/tsconfig.json    # type-check
```

The file builds `cargo build --locked --bin deep-gpu` once in `beforeAll` (#506's `useBins`: `CARGO_TARGET_DIR`
honored, Homebrew's rustup first on `PATH`, the binary copied to a temporary folder). Each test writes into its own
temporary folder, deleted after it. Gates: no cargo is `BLOCKED:`; off macOS, or where a reply says
`unsupported_platform`, a test fails with a message starting `INCONCLUSIVE:`, since the frames are drawn on macOS's
Metal device. The file builds a cargo binary and draws on the GPU, so the implementer adds, beside the other GPU suites
in `scripts/lanes.mjs`: `alone.push('tests/acceptance/468-redraft-ac3/');`.

## The surface under test

`deep-gpu run` (`{out, calls}` in, `{ok, replies}` out, #377) with its `view3d` call (#378). Times are whole flicks
(705,600,000 a second); frame n at 240 fps is t = n ÷ 240 s exactly. World places are metres, +Y up, R = Rz·Ry·Rx in
degrees; frame px from the frame's top left corner, x right, y down, a pixel's centre at (i + 0.5, j + 0.5).

Used as they stand at the base: `view3d`'s `doc`, `look`, `size`, `fps`, `from`, `frames`, `seeks: [{after, to}]`
(#484: right after frame `after` draws, the session jumps to frame `to`), `capture: "every"`, `targets: ["final"]`,
`counts: true`, each frame's `frame` and `pixel_hash`; the envelope's `safe`, `channels`; `camera@1` with `orbit`;
`mark.box@1`, `at.pivot` (#433), `material@1` (`unlit`), `sky@1`, `mark.line@1` (`points`, `width`, `paint.stroke`);
`overlay.frame@1 {frame, offset}`, `frame@1`, `rect@1`, `text@1`; #506's look and envelope (`506/helpers.ts`).

### Assumed surfaces

The issue and the design name these fields but not their shapes. **The implementer builds exactly these, or a dispute
goes to a blind redraft.** Each extends a surface the base already has, and #506's rows stay valid as they are.

1. **An overlay anchored to an edge.** `overlay.frame@1`'s `anchor` also takes an edge (`anchor: corner | edge`),
   named as `at.place`'s `edge` names it: the right edge is `"e"`. With `anchor: "e"` the frame's top left corner draws
   at (W − margin − w + offset.x, (H − h) ÷ 2 + offset.y) px, where (W, H) is the frame's size, (w, h) the overlay
   frame's box size and `margin` defaults to the safe inset (`margin: px = safe`). No test reads where the label draws;
   the guards use this place to keep the anchor clear of the label.
2. **`leader` and `hide` on `overlay.frame@1`**, as the Overlay fields give them: `leader: {to: "ID#anchor", line: role,
   width: px = 1.5, dash: bool = false, end: "dot" | "arrow" | "none" = "dot", elbow: "none" | "horizontal" =
   "horizontal", gap: px = 4}`, `hide: "off_frame" | "never" = "off_frame"`. The leader draws into `view3d`'s final
   target with its overlay (#506's item 7), each frame, ending at its anchor's projection through the camera at t.
   With `hide: "off_frame"`, at a t where the anchor's projection falls outside the safe frame, the overlay and its
   leader draw nothing.
3. **`ID#anchor` names an item anchor** (#506's item 5: an item's `anchors: {<name>: {pos: [m, m, m], rot: [deg, deg,
   deg]}}` in its own space, its `at.pivot` applied as to the item, which the base's insets already read) in a leader's
   `to` and as an entry of a `mark.line@1`'s `points`. At the base a line's `ID#anchor` is the item's origin.
4. **`view3d`'s `overlays: true` rows** (#506's item 8, `overlays: [{id, at: [x, y] | null}]`) also cover each overlay
   with a leader, anchored to an item's point or to an edge, and such a row adds `leader: {to: [x, y]} | null`: where
   the leader ends, f64 px in the frame, or null while the overlay is hidden; `at` is the place its frame's top left
   corner draws, or null while it's hidden. A row of an overlay without a leader is #506's, with no `leader` key.
5. **`view3d`'s `counts: true` `segments`** (at the base each mesh-edge line's and each logic-array line's segments in
   world metres, `{<line id>: [[a, b], …]}`) also list each `mark.line@1` one of whose `points` is `ID#anchor`: its
   segments in strip order, each `[a, b]` its two ends in world metres as the frame drew them.
6. **The safe frame** is the frame less the envelope's `safe` px on every side: x from `safe` to W − `safe`, y from
   `safe` to H − `safe` (here 24 to 456 and 24 to 246).

## The fixture (helpers.ts: lidDoc)

A whole scene document, 480 × 270 px, `safe: 24`, 4 s, #506's envelope (one writer layer `main`, seed 506, scene3d,
marks2d and effects, class showpiece) and #506's plain look (its roles `card`, `tint`, `glow`, `ink`). Unlit, dark
materials under a dark sky, so the leader (`tint`, orange) stands out wherever it ends.

- **The chest**: a 0.6 × 0.3 × 0.4 m box on a floor. **The lid**: a 0.6 × 0.04 × 0.4 m box with `at: {pos: [0, 0.3,
  −0.2], rot: [θ, 0, 0], pivot: [0, −0.02, −0.2]}`: its back edge's bottom sits on the chest's top back edge, and the
  channel `open` takes θ from 0° to −110° over 4 s, so it opens 110° about that edge. Its anchor `hinge` is at (0.28,
  0.02, −0.2) in its own space, the top of its back edge near its right end, where a strap hinge sits: 4 cm off the
  pivot's line, so it moves as the lid opens. In the world, lid#hinge = (0, 0.3, −0.2) + Rx(θ)·(0.28, 0.04, 0).
- **The camera**: perspective, fov 35°, orbiting (−0.6, 0.35, 0.4) at 1.2 m, 15° up, the channel `orbit` taking its
  azimuth from −30° to −120° over 4 s: 90°.
- **The label**: `overlay.frame@1` `label` holding the 120 × 40 px frame `label-frame` (background `label-bg` in `card`,
  the text "Hinge" in `ink`), `anchor: "e"`, `offset: [0, 0]`, `leader: {to: "lid#hinge", line: "tint", width: 1.5,
  end: "dot"}`, `hide: "off_frame"`. By item 1 it draws at (336, 115) px.
- **The wire**: `mark.line@1` `wire`, `points: [[0.6, 0, −0.6], "lid#hinge", [0.9, 0, −0.1]]`, 3 px, `glow`.
- **The 200 times**: distinct frames of the 960 on the 240 fps grid over 4 s, drawn by a seeded 32-bit generator (its
  seed 468), in that order (`SAMPLES`); the latest is frame 959.

The two documents a test compares, with and without the label, share their ID and every item before the label's four.
Checked from the numbers (the tests' guards, and a scratch run of them): every sampled projection of lid#hinge lies at
least 1.6 px from the safe frame's edge (the guard asks 0.5) and 1.6 m or more in front of the camera; 136 sampled
frames put it inside the safe frame and 64 outside, 8 of those inside the frame but outside the safe frame; over the
whole grid it crosses the safe frame's left edge once, at frame 610; inside, it stays 65 px or more clear of the
label's frame. Checked at the base in scratch runs (not kept; `BASE-FAILURE.txt`): #506's row for an overlay anchored
to the lid at the hinge's point lands within 1.8e-13 px of this suite's projection at all 200 times, so the reference is
the base's own camera and pivot; and the document without the label hashes the same played and sought, and the same
with the label's frame items but no overlay, at all 200.

## The tests (`ac3-hinge.test.ts`, 2 tests)

1. **`AC3 #468.632af807 the label's leader ends within 0.5 px of lid#hinge's projection at 200 random times, seeked and
   played have one pixel hash, and it hides exactly where the projection leaves the safe frame`.** One `deep-gpu run`,
   three calls: the label's document played (`from: 0`, 960 frames, `overlays: true`); the same sought (`from` the
   first sampled frame, 200 frames, `seeks` chaining the rest in order, `overlays: true`, `capture: "every"`); the
   document without the label sought the same way (`capture: "every"`). Asserted at each of the 200 sampled frames:
   - in the played and in the sought run, where lid#hinge's projection (worked out here) lies inside the safe frame,
     the label's row has `at` and `leader.to` within 0.5 px (Euclidean) of the projection; where it lies outside, `at`
     and `leader` are null;
   - the sought and the played frame have one `pixel_hash`;
   - where the projection lies outside the safe frame, the sought frame with the label and the one without it have one
     `pixel_hash`: the label and its leader draw nothing;
   - where it lies inside, some pixel of the 3 × 3 around the one holding the projection differs between the two final
     targets by 48 code values or more on a channel: the leader's end draws there.
2. **`AC3 #468.632af807 a 3D line with one point at lid#hinge passes through that anchor at every sampled time`.** The
   document without the label, sought through the 200 frames with `counts: true`. At each: the wire's `segments` are
   two, [first point, lid#hinge] and [lid#hinge, last point], each end within 1e-6 m of its place, lid#hinge's worked
   out here from the lid's pivot and its opening at that frame.

## Readings where the issue and design leave a choice

- **"200 random times"** are 200 distinct frames of a 240 fps grid over the 4 s, drawn by a seeded generator, so a
  rerun samples the same times. **"Seeked"** is #484's seek: each sampled frame is drawn right after a jump from the
  previous one in drawing order (the first opens the session there); **"played"** is frames 0 to 959 drawn in turn.
  **"On one machine"** is one `deep-gpu run`.
- **"The leader's end"** is read from the reply (item 4), as #506 reads a card's place: a sub-pixel place can't be
  read off antialiased pixels. The pixels confirm only that the leader ends there.
- **"Hides"** is read twice: the row's `at` and `leader` are null, and the frame is the frame without the label, bit
  for bit. **"Exactly"** is judged at every sampled time with no tolerance; the guard keeps every sampled projection
  at least 0.5 px from the safe frame's edge (the criterion's own precision on the projection), so a program within
  the criterion's 0.5 px of the true projection can't be judged on the wrong side by rounding. The anchor never goes
  behind the camera here.
- **"Passes through that anchor"** is the wire's drawn segments meeting at lid#hinge's place within 1e-6 m: the
  criterion gives no tolerance, and the anchor is evaluated in f64 by the program and here. It is read from the reply
  (item 5), not from pixels, since the lid and the chest hide the anchor from part of the orbit.
- **`gap`** is read as the leader's gap at the label's end: the criterion puts the leader's end on the anchor.
- **48 code values** for "the leader's end draws there": the scene around lid#hinge is dark or the wire's green, and
  the leader is orange; my bound, not the issue's.

## Wrong programs it fails

The base (test 1: the label is refused, since an `overlay.frame@1` must name `anchor.item`; test 2: the wire's segments
aren't reported, and its `lid#hinge` point is the lid's origin, 57 px off at worst). A leader or a line evaluated on the
lid's rest pose (15.8 px off at worst) or on the lid's origin (both bounded below by the tests' guards), or through the
previous frame's camera (0.64 px off at worst, from a scratch run); a label that hides only behind the camera, or on
the frame's edge instead of the safe frame's (8 sampled frames lie between them); a hidden label that still draws its
frame or its leader; a leader not drawn to the anchor; a seek that draws other pixels than play.

## What isn't covered

The leader's start, `elbow`, `dash`, `end: arrow`, `gap`; `hide: never` and `clamp`; corners and the other edges; where
the label draws (item 1 is asserted by no test); an anchor behind the camera; shots (the camera is keyed by a channel).
