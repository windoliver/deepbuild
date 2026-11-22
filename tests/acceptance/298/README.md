# Acceptance tests for #298: overlays pinned to the frame's edge and the pointer's place over an item

Written first, from issue #298 (its Scope, its Fields, its six acceptance criteria, its Proof line "The clamp fixture's
positions and angles at both sizes, the seek comparison, the card's live frame beside its golden, and each planted twin
with its failure" and its Oracle line), the design sections it links and those they lean on, and base commit
`7a256fd4b` ("Merge pull request #2947 …", main), by a job that never saw an implementation, a plan, another worktree,
a branch, a pull request or anyone's notes for this issue. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion, and exactly the six planted wrong programs the criteria name (`twins.json`).
The Oracle page says no upstream test checks these criteria, so there is no Oracle lane.

**Not run against a binary.** The surfaces plainly don't exist at the base (no `hide: clamp`, no `edge` or
`edge_angle`, no `hover_at`, none of the six planted names), and the machine was under a load above 100, so no Rust was
built; `BASE-FAILURE.txt` says where each test fails there, read from the base's code. The type check passes. A scratch
test (not kept) ran every fixture's own numbers through the references in `helpers.ts`; they are listed under Fixtures,
and each test asserts them again as guards before it reads a reply.

## What was read

- Issue #298, live (`gh issue view 298 --repo windoliver/deepbuild`); for scope only, #76 (which it extends), the epic
  #219 and #506 (its dependency, closed).
- `docs/canvas-primitives.md`: Overlay: clamped to the edge; Overlay; The closed function list; Scope and input classes
  (`node scripts/design-section.mjs --issue 298`); Driver, Driver: time offsets; Logic `logic@1`; Item and kind (`at`);
  Replica `deep_drive`; Golden; the envelope's `safe: f32, u = 24`. `docs/technical-design.md`: Dogfooding, the trusted
  ring's question card. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, only to find the surfaces: `crates/deep-canvas-scene3d/src/scene.rs` (`overlay`: `overlay.frame@1`'s
  `anchor`, `offset`, `leader`, `hide`; `Camera::project`), `scene/scattered.rs` (`placed_at`);
  `crates/deep-gpu-layer/src/main.rs` (`--planted`), `view3d.rs` and `view3d/parse.rs` (`overlays`, `evaluate`, `seeks`,
  `from`, `capture`, `pixel_hash`), `view3d/history.rs` (`order`), `fed.rs` (`values`); `crates/deep-canvas/src/expr.rs`
  (swizzles, the name arguments of `table` and `ease`), `scope.rs` (`hit`, `state.hover`, a flat target's bounds);
  `crates/deep-canvas-motion/src/doc.rs` (`driver_of`: the forms a var takes), `program/groups.rs`, `hover.rs`;
  `crates/deep-canvas-marks/src/place.rs` (a 2D turn: `at.rot[2]`, x toward y, about a box-point pivot), `scene.rs`
  (`KINDS`), `path.rs`; `crates/deep-logic/src/piece/checks.rs` (`region_map`: what a read may name);
  `crates/deep-show/src/main.rs` (the calls, the scenario's `planted`), `frames.rs` and `crates/deep-play/src/read.rs`
  (`eval`'s `paths`), `over3d.rs`; `crates/deep-replica/README.md`; `scripts/proof-change.mjs` (`criterionId`, how a
  test's name is read), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs`, `scripts/wait-ratchet.mjs`.
- For conventions and reused tools: `tests/acceptance/506/` and `506-redraft-ac5/` (cards over 3D, the `overlays` rows,
  the taste test, `twins.json`), `468/` and `468-redraft-ac3/` (leaders, `seeks`, pixel hashes), `539/` (hover as viewer
  state through `deep-show run`: `input`, `view`, `eval`, `export`, a logic read refused, a planted export), `504/`,
  `424/`, `449/`. Helpers are imported from `506/`, `539/` and `424/`, never copied.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/298 --testTimeout=600000 --hookTimeout=180000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/298/tsconfig.json    # type-check
```

Each file builds what it drives once, in `beforeAll` (#506's `useBins`): `cargo build --locked --bin deep-gpu`
(criteria 1, 2, 3, 5 and 6) and `cargo build --locked --bin deep-show --no-default-features --features full` (criteria
3, 4 and 6), honoring `CARGO_TARGET_DIR`, and copies each binary into a temporary folder; the two logic tests also
build #544's assembler (`tests/acceptance/544/wat`, through #539's `assemble`). Every `it` passes its own one-hour
timeout. Each test writes into its own temporary folder, deleted after it; processes are started by `spawnSync` and
stopped only by their own timeout. The taste test writes its pictures to `docs/evidence/298/`.

Gates: no cargo is `BLOCKED:` (a failed test, never a pass). The 3D frames are drawn on macOS's Metal device: off
macOS, or wherever a reply says `unsupported_platform`, a test fails with a message starting `INCONCLUSIVE:`.
`taste.test.ts` is INCONCLUSIVE until the owner's call is recorded.

This job added one line to `scripts/lanes.mjs`, beside #506's, since the files build cargo binaries and draw on the
GPU: `alone.push('tests/acceptance/298/');`. It changed nothing else outside this folder.

## The surface under test

No new binary and no new call: `deep-gpu run [--planted <name>]` with `view3d` (#377, #378) for the clamp, and
`deep-show run` (#393's scenario, on #383's virtual clock) for the pointer, the golden, the export and the check.
Frame px run from the frame's top left corner, x right, y down; world places are metres, +Y up; frame n at fps is
⌊n × 705,600,000 ÷ fps⌋ flicks.

Used as they stand at the base: `view3d`'s `doc`, `look`, `size` (which sets the document's), `fps`, `from`, `frames`,
`seeks: [{after, to}]`, `capture`, `targets: ["final"]`, `evaluate: ["items/<id>/…"]` with each frame's `values`,
`overlays: true` with each frame's rows `{id, at, leader?}`, each frame's `pixel_hash`; the envelope's `safe`,
`channels`, `drivers`; `overlay.frame@1 {frame, anchor: {item, point}, offset, leader, hide}`, `frame@1`, `rect@1`,
`path@1`, `camera@1`, `mark.box@1`, `material@1`, `sky@1`, `light.sun@1`, `logic@1`; `deep-show run`'s `deep_show`
(`outcome`, `issues`), `scope` (`state.camera`, `state.rect`, `state.hover`), `input` with `{type: "move", pos}`,
`view` (`snapshot.sha256`), `eval` with `pixels` and `paths` (`snapshots[0].sha256`, `values`), `export` with
`video: {codec: "png_seq"}`, and the scenario's `planted`.

### Surfaces this job chooses

The issue and the design name the fields but not these shapes. **The implementer builds exactly these, or a dispute goes
to a blind redraft.**

1. **`hide: "clamp"` and `clamp_inset: <px>`** are params of `overlay.frame@1` anchored to an item's point
   (`anchor: {item, point}`), with or without a `leader`, drawn by `view3d` and presented by `deep_show`. Such an
   overlay always has a place: its row's `at` is never null, behind the camera included.
2. **The overlay's box** is its frame's box size (the `frame@1`'s `params.box` width and height) from the row's `at`,
   the base's member: the place the frame's top left corner draws. Every tag here has `offset: [-24, -24]` on a 48 px
   frame, so its box centers on its anchor's projection; clamped, its box's center is the point the rule gives. (A
   clamp that adds the offset to the clamp point and one that centers the box on it agree here.)
3. **The `overlays` rows** of an overlay with `hide: "clamp"` add `edge` (the number 0 or 1) and `edge_angle` (a number
   of degrees in [0, 360)). `leader` stays #468's: `{to: [x, y]}`, or `null` while the leader hides, which now
   includes every frame where `edge` is 1.
4. **A driver reads them as vars** named `<overlay ID>.edge` and `<overlay ID>.edge_angle`, the form a logic array's
   var takes (`vars: {a: "tag-east.edge_angle"}`, `expr: "a"`). `view3d` evaluates the driver, so `evaluate` reports
   its target (`items/arrow-east/at/rot/2`); `deep_show` presents a scene document holding one.
5. **`hover_at(card)`** in a driver's `expr`: the argument is the item's ID written bare, as `table(name, x)` and
   `ease(name, x)` take a name, with no var declared for it; its value is a vec2 read by swizzle (`hover_at(card).x`,
   `.y`). It reads (−1, −1), two finite numbers, while the pointer isn't over the item, so a driver needs no
   `fallback`. The item here is a 2D `rect@1`; its bounds are its box at its position on the page, as the scope's hit
   test reads a flat item's at the base.
6. **A replica's hover** is `deep-show run`'s `input` with `event: {type: "move", pos: [x, y]}` (panel px, no button
   down) on the panel showing the document; the live frame is that panel's `view`. `deep-show run` is the headless
   copy of the core on a virtual clock, as #376's, #539's and #549's suites read "a replica".
7. **The golden** is `eval`'s frame (`pixels: true`) with `paths`' `values`; **the export** is `export` with
   `png_seq`. Both, and the check, evaluate `hover_at` as (−1, −1) whatever the panel's pointer does.
8. **A logic read that is refused**: `reads` entries `"hover_at(card)"`, `"drivers/<driver ID>"` and the path a driver
   writes (`"items/card/at/rot/2"`, `"items/arrow-east/at/rot/2"`), where the driver reads `hover_at`, `edge` or
   `edge_angle`. `deep_show` answers `outcome: "refused"` with an issue of `severity: "error"` that names the logic
   item: in its `ids`, by a `path` at or under `items/<logic ID>`, or in its own fields.
9. **Planted programs**, each reachable only by its switch, changing nothing else:

| Name | Switch | Criterion | The wrong program |
|---|---|---|---|
| `clamp_each_axis` | `deep-gpu run --planted` | 1 `#298.febe6b8e` | a clamped overlay's center is its anchor's projection with x and y each held to the inset frame's range on its own |
| `clamp_unmirrored_behind` | `deep-gpu run --planted` | 1 | an anchor behind the camera keeps the projection the division by its negative depth gives, unmirrored, and is clamped from there |
| `clamp_to_frame` | `deep-gpu run --planted` | 2 `#298.ef87b0b5` | the clamp holds the overlay to the view's frame (less `clamp_inset` and its half size) instead of the safe frame; which overlays are clamped is unchanged |
| `edge_from_previous_frame` | `deep-gpu run --planted` | 3 `#298.85119906` | a driver's read of `edge` and `edge_angle` takes the anchor's projection the frame drawn before left, not this frame's |
| `leader_draws_while_clamped` | `deep-gpu run --planted` | 5 `#298.1903184f` | a leader on a clamped overlay goes on drawing, from the overlay on the edge to its part's projection |
| `export_keeps_live_hover_at` | `deep-show run` scenario `planted` | 4 `#298.fd687640` | the export evaluates `hover_at` as the panel's live hover |

10. **Evidence files** the taste test writes to `docs/evidence/298/`: `clamped-1920x1080.png`, `clamped-390x844.png`,
    `edge-arrow.png`, `card-tilted.png`, `flythrough.apng`.

## The rule, as the tests work it out (helpers.ts: clampRule)

From Overlay: clamped to the edge. With (W, H) the frame, c = (W ÷ 2, H ÷ 2) its center (the safe frame's too), s the
`safe` margin, h the overlay's half size and i its `clamp_inset`:

- p is the anchor's projection; behind the camera, the pinhole's division by the negative depth lands it through the
  center from where it lies, and the design mirrors it back: p′ = 2c − p.
- `edge_angle` = atan2(p′y − cy, p′x − cx) in degrees, plus 360 where negative: 0 to the right, clockwise.
- Inside the safe frame (s ≤ p′x ≤ W − s and s ≤ p′y ≤ H − s, in front of the camera): the overlay draws on p′, `edge` 0.
- Else `edge` 1, and its center is c + k (p′ − c), with k the smaller of (W ÷ 2 − s − i − h) ÷ |p′x − cx| and
  (H ÷ 2 − s − i − h) ÷ |p′y − cy|: where the ray first meets the safe frame inset by i and h.

## Fixtures (helpers.ts)

- **The clamp fixture** (`clampDoc`; AC1, 2, 3, 6): a scene document, `safe: 48`, a floor at y = −2.5 m and five posts,
  each with `tag-<post>`, an `overlay.frame@1` holding a 48 px square frame (`tag-<post>-frame`, its background in
  `accent`), anchored to the post's top, `offset: [-24, -24]`, `hide: "clamp"`. The tops: `east` (14.4, 0, 0), `north`
  (0, 8.4, 0), `corner` (14.4, 8.4, 0), `rear` (−6, 1, 12.6), `near` (1.5, −2, 0). With `arrows`, each frame holds
  `arrow-<post>`, a `path@1` triangle in `ink` turned about the frame's middle by the driver `turn-<post>`
  (surface 4); a 2D turn runs x toward y, clockwise on screen, as `edge_angle` does.
- **The still** (AC1): the camera at (0, 0, 9.6) aimed at the origin, fov 90° across the wider side. At 1920 × 1080
  its focal length is 960 ÷ tan 45° = 960 px, so a point (x, y, 0), 9.6 m deep, projects to (960 + 100x, 540 − 100y).
  The inset frame is x 72 to 1848, y 72 to 1008 (48 + 24).

| Tag | Projects to | By the rule | Center | `edge` | `edge_angle` |
|---|---|---|---|---|---|
| `tag-east` | (2400, 540) | ray (1440, 0), k = 888 ÷ 1440 | (1848, 540) | 1 | atan2(0, 1440) = 0 |
| `tag-north` | (960, −300) | ray (0, −840), k = 468 ÷ 840 | (960, 72) | 1 | −90 + 360 = 270 |
| `tag-corner` | (2400, −300) | ray (1440, −840), k = min(0.6167, 0.5571): the top | (1762.2857, 72) | 1 | −30.2564 + 360 = 329.7436 |
| `tag-rear` | (2880, 860), 3 m behind; mirrored (−960, 220) | ray (−1920, −320), k = 888 ÷ 1920 | (72, 392) | 1 | 189.4623 |
| `tag-near` | (1110, 740) | inside the safe frame | (1110, 740) | 0 | not asserted |

  The planted clamps: each axis on its own puts `tag-corner` at (min(2400, 1848), max(−300, 72)) = (1848, 72); no
  mirror sends `tag-rear` along the ray (1920, 320) to (1848, 688), on the right side.
- **The flythrough** (`motion: "fly"`; AC2, 3, 6): two linear channels on the camera over 4 s: its position from
  (5, 1, 10) to (−6, 2, −4) m and the point it aims at from (3, −1, −3) to (−2, 0, 5), so it flies past the posts and
  ends looking back. `tag-north` has `clamp_inset: 16`. The 20 sampled times are frames 0 to 19 at 5 a second. The
  scratch run, by the rule: at 390 × 844, 88 of the 100 pairs of a tag and a time are clamped, 20 put the anchor behind
  the camera and 12 leave the tag on its anchor; at 1920 × 1080, 76, 20 and 24; at both the clamped tags reach all
  four sides, every pair is at least 25.8 px (17.8 px) clear of the two open readings below, and no post's top comes
  within 0.515 m of the camera's plane. 70 (63) clamped pairs turn by more than 0.5° from the frame before.
- **The leader fixture** (`leaderDoc`; AC5): 960 × 540, `safe: 24`, the still camera (50 px a metre). The post `mate`
  slides along x from 3 m to 16 m by 2 s and back by 4 s; `tag` is anchored to its top, (x, 1, 0), which projects to
  (480 + 50x, 220), and its leader (`to: "mate"`, `line: "ink"`, `end: "dot"`, `elbow: "none"`) ends at the post's
  middle, (480 + 50x, 270). 21 frames at 5 a second: the anchor is inside the safe frame (x ≤ 936) at frames 0 to 4 and
  16 to 20 (at most 890, so the tag's box is 22 px clear), outside it at frames 5 to 15 (at least 955), and the
  leader's end is off the frame from frame 6 to 14 (1020 to 1280). The twin has no `leader`.
- **The card** (`cardDoc`; AC4, 6): a figure, 640 × 400 u, 2 s at 60 frames a second, shown 1:1. `card` is a `rect@1`
  in `accent`, 400 × 240 u at (120, 80), `at.pivot: "c"`; the driver `tilt` writes `items/card/at/rot/2` from
  `hover_at(card).x < 0 ? 0 : 30 * (hover_at(card).x - 0.5)`. (0.9, 0.5) of its bounds is the page point (480, 200)
  and gives 30 × 0.4 = 12°, clockwise: the card leans toward the pointer on its right half. `probe`, a 4 u square kept
  off the page at (−64, −64), has drivers writing `-64 + hover_at(card).x` and `-64 + hover_at(card).y` to its
  position: (−65, −65) says `hover_at` read (−1, −1). Probe points, with u inside (+) or outside (−) the card at each
  turn: `toward` (527, 152): −7.0 flat, +5.2 at 10.5°, +7.5 at 12°, +8.3 at 12.5°, −12.5 at −12°; `flat` (512, 88):
  +8.0 flat, −25.1, −29.5, −30.9; `away` (113, 152): −7.0 flat, −12.3 to −12.5 leaning clockwise, +7.5 at −12°.

## Criteria to tests

IDs are `#298.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Every test title starts `AC<n> #298.<id>`;
each file holds its ID as a string constant, so the proof lanes read the names from the source.

### AC1 `#298.febe6b8e`: `ac1-clamp-still.test.ts` (2 tests)

- **`… tags whose anchors project to (2400, 540), (960, −300) and (2400, −300) draw centered at (1848, 540), (960, 72)
  and (1762.3, 72) with edge 1 and edge_angle 0, 270 and 329.7, and one behind the camera and to its left draws on the
  left edge`**: one frame of the still at 1920 × 1080. Each of the five rows: its center (`at` + 24) within 0.05 px of
  the table's, its `edge` equal, and for the four clamped ones `edge_angle` in [0, 360) within 0.05° of the table's.
  Guards: the tops project where the criterion says, and the rule gives the issue's values to the digit it prints.
- **`… the planted clamps fail, naming the frame …`**: `--planted clamp_each_axis`: one failure names `frame 0`,
  `overlay tag-corner` and `draws centered at (1848.00, 72.00)`; `--planted clamp_unmirrored_behind`: one names
  `frame 0`, `overlay tag-rear` and a center on the inset frame's right side.

### AC2 `#298.ef87b0b5`: `ac2-safe-area.test.ts` (2 tests)

- **`… every clamped overlay's box lies inside the safe area at the flythrough's 20 sampled times`**: one run, the fly
  document at 390 × 844 and at 1920 × 1080. At each of the 20 frames each of the five tags has a row, draws (`at` not
  null), and its box (48 px from `at`) lies within 48 to W − 48 by 48 to H − 48, to 0.01 px; `tag-north`, where the
  rule clamps it, within 64 to W − 64 by 64 to H − 64. Guards: the fixture's numbers above.
- **`… the planted clamp to the frame puts a tag under the inset and fails, naming the overlay`**: `--planted
  clamp_to_frame`: one failure names a tag's box, the safe area it leaves and `under the inset`.

### AC3 `#298.85119906`: `ac3-edge-angle-seek.test.ts` (3 tests)

- **`… equals its value after a seek to each, by evaluated data`**: the fly document with arrows at 1920 × 1080,
  `evaluate` on the five `items/arrow-<post>/at/rot/2`, in one run: played (frames 0 to 19 in turn) and sought (opened
  at frame 3, then `seeks` through 10, 17, 4, 11, 18, 5, 12, 19, 6, 13, 0, 7, 14, 1, 8, 15, 2, 9, 16: no frame follows
  the one before it). At each time, each tag: the played frame holds a number; where the rule clamps the tag it is the
  rule's `edge_angle` then, within 0.05°; the sought frame holds the same number, compared with `===`.
- **`… the planted driver … differs after a seek and fails, naming the time`**: `--planted edge_from_previous_frame`:
  one failure starts `t = <seconds> s (frame n):` and ends `is <a> played and <b> after a seek`.
- **`… a logic item whose read names a driver over edge_angle is refused at check, naming the item`**: one
  `deep-show run`, three `deep_show` calls of the still with arrows and a logic item `brain`: reading nothing, it is
  presented with no error; reading `drivers/turn-east`, and reading `items/arrow-east/at/rot/2`, each is refused with
  an error naming `brain`.

### AC4 `#298.fd687640`: `ac4-card-tilt.test.ts` (3 tests)

- **`… tilts toward a hover at (0.9, 0.5) of its bounds live, while its golden and its export draw it flat, since
  hover_at reads (−1, −1) there`**: one `deep-show run`: `eval` at 1 s (pixels, `paths`); `move` to the panel point of
  page (480, 200); `view`; `eval` again; `export` at 4 frames a second. The golden, before and after: `values` give the
  tilt 0 and the probe (−65, −65), and its picture shows the card's color at `flat` and the page's at `toward`. The
  live view: the card's color at `toward`, the page's at `flat` and at `away`. Every exported frame: as the golden.
  "Same color" is within 3 code values, and the card's and the page's are checked to be more than 40 apart (#539's
  bounds).
- **`… a logic item that reads hover_at, directly or through a driver, is refused at check, naming the item`**: four
  `deep_show` calls of the card with a logic item `peek`: reading nothing, presented with no error; reading
  `hover_at(card)`, `drivers/tilt`, and `items/card/at/rot/2`, each refused with an error naming `peek`.
- **`… the planted export that keeps the live hover tilts the card and fails the golden, naming the item`**: scenario
  `planted: "export_keeps_live_hover_at"`: frames are exported, and one failure starts `export frame <k>` and names
  `the item card`.

### AC5 `#298.1903184f`: `ac5-leader-clamped.test.ts` (2 tests)

- **`… draws nothing while edge is 1 and returns when the anchor comes back into the safe frame`**: one run, the leader
  fixture and its twin, 21 frames each. At each frame the tag's `edge` is the rule's (1 at frames 5 to 15). While 1:
  the row's `leader` is `null` and the frame's `pixel_hash` equals the twin's. While 0 (frames 0 to 4, and 16 to 20,
  after it comes back): `leader.to` is within 0.5 px of the post's middle as projected then, and the frame's
  `pixel_hash` differs from the twin's.
- **`… the planted leader that keeps drawing crosses the frame and fails, naming the overlay`**: `--planted
  leader_draws_while_clamped`: one failure names `overlay tag is clamped (edge 1)` and `crosses the frame` (its leader
  ends off the frame, or its frame differs from the twin's while its part is off the frame).

### AC6 `#298.4ae89dd7`: `taste.test.ts` (1 test)

See The taste call.

## Readings where the issue and design leave a choice

- **Tolerances.** The issue prints 1762.3 and 329.7 to one decimal, so a place or an angle is held within 0.05 of the
  rule's own value (1762.2857, 329.7436); the same 0.05 holds the values it prints whole. A box inside the safe area is
  judged to 0.01 px; a leader's end to 0.5 px, #468's bound for one. Seek against play is exact: both are numbers the
  core evaluated.
- **"Naming the frame"** (criterion 1) is read as the drawn frame, by its number and size; each failure also names the
  overlay and its own `frame@1`, so the other reading holds too.
- **"Draws on the left edge"** is asserted as the whole place the design's rule gives, (72, 392) with 189.46°: the
  design says the anchor "projects mirrored through the center first", and then the same ray applies.
- **`tag-near`** isn't in the criterion. It holds the fixture to its own claim, that a tag centers on its anchor, and
  the Fields' "`edge` … else 0".
- **"The safe area"** is the frame less the envelope's `safe` on each side, the same as the safe frame; "under the
  inset" is inside that margin. One document is drawn at both sizes, so `safe` is 48 at both.
- **"Every clamped overlay"** is every overlay with `hide: "clamp"` at every sampled time: it draws at each, since a
  clamp keeps it on the edge and never hides it. `tag-north`'s `clamp_inset: 16` is held to the Fields' words, "more
  space inside the safe area": 16 px more on every side while the rule clamps it.
- **"20 sampled times of a flythrough"** are frames 0 to 19 of a 4 s flight at 5 frames a second.
- **"By evaluated data"** is the value a driver wrote from `edge_angle`, read through `evaluate`: the criterion's
  planted twin is a driver, so the driver's read is what is compared. That it is the right angle at all is held to the
  rule where the tag is clamped; without that, a driver stuck at 0 would seek as it plays.
- **"A seek to each"** is #484's `seeks`: each sampled frame drawn right after a jump from another, in an order where
  none follows the frame before it; "played" is frames 0 to 19 in turn. Both in one `deep-gpu run`.
- **"A logic item whose read names a driver"**: the design's `reads` takes a path and doesn't say how a driver is
  named, so the read names it both ways: by its place in the document (`drivers/<ID>`) and by the path it writes. "At
  check" is `deep_show`'s check, where #539's suite reads a refused logic read.
- **The card** is a 2D item in a figure: the criterion says "a card", and `hover_at` takes any item. A card frame over
  3D (#506's) isn't used: the base's scope hits no overlay frame, and no criterion asks it to.
- **"Tilts toward"** is the card's turn about its middle with the sign that leans it toward the pointer's side:
  clockwise for a pointer on its right half. It is read off the live picture at three points, placed so that a lean
  anywhere from 10.5° to 12.5° passes: once the card has turned, its bounds under a still pointer can be read three
  ways (the hover as it was when the pointer moved, 12°; the card's own turned box, 11.75°; the turned card's upright
  box, 10.95°), and the design doesn't choose.
- **"Its golden"** is `eval`'s frame at 1 s with pixels, the document's own frame with no viewer state, as #539's suite
  reads a fixture's golden; "its export" every frame of a PNG sequence at 4 frames a second. "Since `hover_at` reads
  (−1, −1) there" is read as data, from the probe's evaluated place.
- **"A logic item that reads it directly"** is a `reads` entry that is the call itself, `hover_at(card)`.
- **"Draws nothing"** (criterion 5) is read twice: the row's `leader` is null, and the frame is the frame of the same
  document without a leader, bit for bit. **"Returns"**: the leader ends on its part again and the frame differs from
  the twin's. **"Crosses the frame"**: a leader drawn while clamped runs from the tag on the edge to a part off the
  frame.
- **The leader's two points**: the tag is anchored to the post's top and its leader runs to the post's middle, 50 px
  below, so the leader has a length; both cross the safe frame's side together, so "the anchor" is the same either way.

## What the base already does, which these tests don't credit

- `overlay.frame@1` anchored to an item's point draws at the point's projection plus its offset, hides behind the
  camera, takes a `leader` and `hide: off_frame | never`, and `view3d` reports `{id, at, leader}` rows. `tag-near`'s
  place is therefore right at the base; its test still fails there, on the four clamped tags and on `edge`.
- The logic module refuses every read that names no control, reading or logic array, so at the base a read of
  `drivers/turn-east`, of a path or of `hover_at(card)` is already refused, for that reason. The two logic tests don't
  credit it: each asks first that the same document, its logic item reading none of them, is presented, which the base
  can't do, since it refuses the drivers themselves.
- The scope already knows which item the pointer rests over (`state.hover`); a driver already reads a pick control's
  hover (`controls/<id>/hover/<k>`, #539), which goldens, exports and checks evaluate as none, with #539's own planted
  export. `hover_at` is asked through its own function and its own planted name.
- A document without `edge_angle` already seeks as it plays.

## What couldn't be tested without guessing, and isn't

- **An anchor inside the safe frame but nearer its edge than the overlay's half size** (plus its `clamp_inset`): the
  design says it "draws there as before" and also that the overlay never leaves the safe area. Every fixture keeps
  every sampled anchor at least 2 px clear of that band (a guard in each test).
- **An anchor behind the camera whose mirrored projection falls inside the safe frame**: the words allow drawing it
  there or on the edge. Every sampled anchor behind the camera mirrors to outside the safe frame.
- **`edge_angle` while `edge` is 0**: only that it seeks as it plays. An anchor in the camera's own plane.
- **That a logic read is refused for being a view or viewer value**, not for being a read the logic module doesn't
  know: at the base no logic item reads any driver, so there is no accepted read to hold it against.
- **A world input** that names `edge`, `edge_angle` or `hover_at`: in the Scope, under no criterion.
- `<overlay>.edge` through a driver; an offset that doesn't center the overlay, clamped; `clamp` on `overlay.text@1`
  or `overlay.controls@1`; where `clamp_inset` puts the overlay to the pixel; "draw over the question card";
  `hovered(id)`; checks other than `deep_show`'s reading `hover_at`; the cost lines.

## The taste call

`taste.test.ts` writes, from this run's own frames: `clamped-1920x1080.png` and `clamped-390x844.png` (the flythrough
with its arrows at 1.2 s, frame 6), `edge-arrow.png` (the still with its arrows at 960 × 540: the tag on the right
side points right at its post off the frame), `card-tilted.png` (the card's panel live, the pointer at (0.9, 0.5) of
its bounds, 640 × 400 u) and `flythrough.apng` (the flight's 40 frames at 10 a second at 960 × 540, the canvas's PNGs
moved into one animated PNG unchanged), all in `docs/evidence/298/`, printing each SHA-256. Show them to the owner in
the session and attach them to the PR; record the one answer in `tests/acceptance/298/TASTE.json` (this job writes
none):

```json
{"issue": 298, "criterion": "#298.4ae89dd7", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"clamped-1920x1080.png": "<sha256>", "clamped-390x844.png": "<sha256>", "edge-arrow.png": "<sha256>",
                 "card-tilted.png": "<sha256>"},
 "recordings": {"flythrough.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge whether it looks right.
