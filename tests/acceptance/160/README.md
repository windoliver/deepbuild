# Acceptance tests for #160: path ops and stroke widths, kinetic shapes as data

Written first, from issue #160 (its Scope, its Fields, its seventeen acceptance criteria, its Proof line, "The
path-op parity fixtures against their CPU references, a loader and a radial burst that seek and play alike, and the
timings", its Oracle note, and its one comment: stroke gradients landed in #373's PR #661, taper and wave are this
issue's), read live with `gh issue view 160 --comments`; the design sections it names and those they lean on; and
base commit `69803b94` ("Merge pull request #1021 … env-local-lsof-path", equal to `origin/main` when written), by a
job that never saw an implementation; none existed, and no other worktree or branch was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- `docs/canvas-primitives.md` at the base: Conventions every primitive uses (line 7), with Time and the flick, Units
  and axes (28: y down, degrees, "subtract the pivot, scale, shear, rotate, add the position") and The cost model (82:
  the figure class, 4 ms frame CPU); Item and kind (321); Path `path@1` (1526); Path `path@1`: ops (1554); Star
  (1637); Paint (fill and stroke) (1656); Paint: shade (1676); Paint: stroke gradients, taper and wave (1759); Frame
  and group (1873); Frame and group: union outline (1939); Frame and group: draw order (1955); Mark set and columns
  (2055); What holds a document to its rules (8169).
- `docs/technical-design.md`: The canvas core (1051) and its module table's marks2d row (1064); 2D marks and paint
  (1114); How we know version 0 works (2482), with Criteria in a checked shape (2502), Dogfooding (2524) and Tests
  written first (2555).
- At the base: AGENTS.md; `crates/deep-marks-render` (`src/lib.rs`: the `parse` fn and the subcommands with their
  `planted` values; `src/raster.rs`: `geometry`; `src/place.rs`: a document evaluated at `t` through the motion
  program before it is drawn); `crates/deep-canvas-marks/src/path.rs` (verbs from `d`: M, L, H, V, Q, C, Z);
  `crates/deep-canvas/src/kinds.rs` (circle@1 already lists an `ops` param); `crates/deep-canvas-motion/src/doc.rs`
  and `modifier.rs` (channel types, enum channels, the wave modifier's `period`); the earlier blind suites
  `tests/acceptance/373/` (README, helpers, parity, star and stroke tests) and `tests/acceptance/489/` (README,
  helpers, budgets test).
- Probes of the base build: `check` passes documents carrying `ops`, `z`, `outline`, `ends`, `attach` and channels on
  `params/...` (the base check ignores params it doesn't know); `geometry` answers a stroked circle@1 as four cubics
  starting at angle 0 and running toward +y; a channel on `items/<id>/params/box/3` with a wave modifier moves the
  box; `deep-canvas-render path` exits 2 with its usage line.

## Run

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/160 --no-file-parallelism
```

Every file first runs `cargo build --locked --bin deep-canvas-render` in the checkout (cached after the first file)
and fails each of its tests when the build fails. The files build a cargo binary, so they run one at a time, as
#373's do: `scripts/lanes.mjs` needs `'tests/acceptance/160/'` added to its one-at-a-time list (this job writes only
this folder; the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min). PNGs go under the OS temp
folder and are deleted. Node built-ins and vitest only. The folder type-checks under the root `tsconfig.json`'s
strict options with `allowImportingTsExtensions` and `noEmit` (checked with a copy of the options outside the repo
whose `include` is this folder: `tsc -p` exits 0). A run with `--root` leaves Vitest's cache in
`tests/acceptance/160/node_modules/.vite`; delete it, it is not part of the suite.

Every test runs on every platform (Vello CPU needs no GPU) except AC9's, which judge only on the reference Mac and
skip with a message starting `INCONCLUSIVE` elsewhere (below).

**On Linux at the base the binary doesn't build.** `deep-canvas-render` depends on `deep-replica`, which depends on
`deep-app`, whose `src/show.rs` (since #806) calls the `image` crate while `crates/deep-app/Cargo.toml` lists `image`
only under its macOS dependencies; `cargo build --locked --bin deep-canvas-render` fails there with `E0433 cannot
find module or crate image`. That is an unrelated break on main (an unrelated finding for the implementer to note
separately), and the reason #373's suite can't run on Linux at this base either. `BASE-FAILURE.txt` therefore holds
two runs, each in an export of the base commit (`git archive 69803b94`) holding these files and the repo's
node_modules: the base as committed (every test fails on the build), and the same export with only that one
dependency line moved to `[dependencies]` (every test then fails for its own reason, below).

## The surface under test

The issue names fields and no code API, so these tests extend #391's, #392's and #373's proof surface, the
`deep-canvas-render` binary (crate `crates/deep-marks-render`), with one subcommand, `path`, and one planted value of
`raster`, and read `check` and `raster` as they are. **Every name below that the issue or the design doesn't give is
this job's choice** (each is listed again under Readings), the smallest surface consistent with the design and the
base; the implementer builds exactly these, or a dispute goes to a blind redraft. #391's JSON-lines convention holds:
one JSON object in per stdin line, exactly one out per line, in order, exit 0; a line that isn't JSON, lacks a
required field or names an unknown `planted` value answers `{"ok": false, "code": "bad_input"}` with no panic; every
refusal is `{"ok": false, "code": string, …}`. Everything #391's, #392's and #373's READMEs define for `frames`,
`session`, `render`, `check`, `look`, `raster` and `geometry` stays as it is.

### `deep-canvas-render path` (every platform; new)

Input `{"doc": Document, "item": ID, "times"?: [flick] = [0], "look"?: look, "anchors"?: [string], "timing"?: bool,
"planted"?: string}`.

- It runs the document check first, as `geometry` does. A document the check refuses is never built: the answer is
  `{"ok": false, "code": <the check's first error's code>, "issues": [...]}`, with no `frames`.
- Otherwise it evaluates the document at each time, in the order given, in this process (one line with several times
  is a play; a cache this process filled may serve later times and lines), and answers `{"ok": true, "frames":
  [Frame]}`, one frame per time, in order.

A frame, for the item `item` at time `t`:

| Field | What it holds |
|---|---|
| `t` | the time, flicks, as given |
| `subpaths` | `[{closed, verbs, points}]` exactly as #373's `geometry` writes them: the item's outline after its ops, its attachment and its bend, before its ends, in document u, y down, the item's transform applied. A rect@1, circle@1 or star@1 with ops is the path it becomes. For a repeater, copy 0's sub-paths come first, then copy 1's, and so on, in copy order whatever its `composite`. For a group with a union outline, each child's outline, children in draw order |
| `segments` | the segments in `subpaths`: every L, Q and C, and every Z whose closing line has length |
| `declared` | the segment count the item's ops computed from their params before building (Path: ops' formulas, op by op from the input's segments), the count the budget check holds to 50,000 |
| `tessellation` | a hex digest of the item's tessellation as built and cached (in its own space, before its transform; its ends included): equal exactly when the build is equal |
| `rebuilt` | `true` when this frame built the item's tessellation, `false` when it reused a cached one |
| `copies` | on a repeater's item: `[{transform: [a, b, c, d, e, f], opacity, t}]`, one per drawn copy, copy 0 first. `transform` maps the item's own coordinates to copy k's (x' = a x + c y + e, y' = b x + d y + f), the repeater's part only (not the item's own `at`); `opacity` the copy's opacity multiplier (between the repeater's first and last, times the fraction for a fading partial copy); `t` the flick copy k's content evaluates at (t − k × lag) |
| `ends` | on a path with ends: `{start?, end?: {kind, tip: [x, y], angle, length, width}}` for each end that isn't `none`: `tip` the head's point where it meets the path's end, in document u; `angle` the direction it points, outward along the tangent, as atan2(dy, dx) in degrees in document u (y down: 0° is +x, 90° is +y); `length` along the tangent and `width` across it, in u, as drawn (after the quarter-length cap) |
| `anchors` | with `anchors` in the input: `{name → value}` for each, `"#length"` a number (u) and `"#at:<f>"` `{point: [x, y], angle}` (angle as `ends`) |
| `columns` | on an item with per-point columns: `{name → [number]}`, one evaluated value per point; for a group with a union outline, its joined rows (its children's rows in draw order, each child's points in path order) for every column any child has |
| `build_ms` | with `timing: true`: this frame's wall time, in ms, spent building the item's ops output and tessellation, measured by the binary (0 when it reused them) |

Planted values (`planted`; any other value is `bad_input`):

| Value | On | Criterion | The wrong program |
|---|---|---|---|
| `moved:<op>`, op one of `trim`, `round_corners`, `offset_path`, `zigzag`, `pucker`, `twist`, `repeater` | `path` | AC5 | that op's output, every point of it (a repeater's every copy, its transform's `e` included), moved 0.02 u along +x before the next op |
| `merge_zero_fills` | `path`, `raster` | AC8 | a union, a group flatten or a builder join gives the new rows of a column a part lacks 0 instead of the column's default |
| `repeater_evaluates_at_t` | `path` | AC17 | a repeater that evaluates every copy's content at t, ignoring `lag` |

### `raster`, `check` (as at the base)

`raster` is #373's: input `{out, doc, look, t?, planted?, …}`, the check first, a refused document answered with the
check's first error's code; `planted` gains `merge_zero_fills`. `check {doc, look}` answers `{ok, issues: [{check,
code, severity, ids, path, actual, what, fix}]}`. The tests read codes, `ids`, `path`, `severity` and the numbers an
issue carries, never message text. Codes:

| Code | Severity | When | Source |
|---|---|---|---|
| `column_length` | error | a path's `width` or `opacity` column whose length differs from its point count, at `items/<id>/params/<column>` | the issue |
| `z_inside_isolated` | notice | a child of an isolated group whose z would lift it out, naming the child | the issue and Frame and group: draw order |
| `segment_budget` | error | an item whose ops' computed segments pass 50,000, at `items/<id>/params/ops/<i>` (the op that passes it, or a path under it), carrying the computed count as a number | coined here: the design says the budget check refuses before building and names no code |
| `out_of_range` | error | an op's field outside its range, or more than 8 ops (`items/<id>/params/ops`) | the base check's code for a value outside its min and max (Item and kind), as #373 used it for the star's vertex limit |

### Documents

#373's envelope (`{format: 1, id, profile, title, description, size, layers: {main}, items}`, items `{id, kind,
layer, name, order, params, parent?, at?}`), with #391's `transport: {span}` and `channels` (`{target, type: "f32" |
"enum", keys: {id → {t: "<s>s", value, interp}}, modifiers?}`), and the issue's fields as canvas-primitives spells
them:

| Field | As the tests write it |
|---|---|
| ops | `params.ops: [{trim: {start, end, offset}} \| {round_corners: {radius}} \| {offset_path: {amount, join, miter_limit}} \| {zigzag: {size, ridges, points}} \| {pucker: {amount}} \| {twist: {angle, center}} \| {repeater: {copies, at: {pos, rot, scale}, opacity, partial, ease, lag}}]`: each op an object with one key, its kind. Channels target `items/<id>/params/ops/<i>/<field>` (and `…/at/rot`) |
| repeater partial and lag | `partial: "slide" \| "fade"`, `ease: "out_cubic"` (an ease's name), `lag: "0.2057s"` (a time literal) |
| taper | `paint.stroke.taper: {end: 80, end_width: 0, ease: 0}` (`end` a bare number, in u) |
| ends | `params.ends: {end: "arrow", size: 4}` |
| attach | `params.attach: {start?: ID, end: ID \| "ID#at:<f>", at?: "edge" \| "outline", gap?: 4}` |
| bend | `params.bend: 60` |
| per-point columns | `params.opacity` or `params.width`: `{dtype: "f32", len, data: base64}` (the mark set's column form) |
| union outline | group `params.outline: {kind: "union", width: 3, role, slits?: [ID]}` |
| draw order and z | `params.draw_order: "back" \| "front"` on a child, `params.z: number` on any 2D item; channels target `items/<id>/params/draw_order` (an enum channel) and `items/<id>/params/z` |
| isolation | group `params.isolate: true` |

## Fixtures

Written by this job before any implementation ran (`fixtures/parity/2d/`); the expected values are computed in the
tests:

- `path-ops.scene` (named by the issue): one item per op on a 980 × 400 figure: `trim` (0.1..0.6 of `M 20 40 L 120
  40 L 120 340`), `round` (round_corners 10 on the square 160..260 × 40..140), `offset` (offset_path 10, miter, on
  the square 310..390 × 60..140), `zigzag` (size 10, 5 ridges, corner, on `M 440 100 L 640 100`), `pucker` (0.5 on
  the square 680..780 × 40..140), `twist` (30° about [0, 0] on a 6-point star of radii 100 and 40 centred at [0, 0],
  placed at (860, 280) by its `at.pos`), `repeater` (3 copies 40 u apart of a triangle).
- `loader.film`: a ring of radius 80 drawn as a path of four cubics, stroked 10 u, with a trim whose end grows from
  0.05 to 0.8 over 1 s, whose start follows from 0 to 0.75 over the next second and whose offset travels 0° to 360°
  over 2 s, an arrow at its end; and a still hub beside it.
- `burst.film`: one petal (two cubics) at (150, 150) through a pucker deepening from 0 to −0.3 over 2 s and a
  repeater 30° apart, fading from 1 to 0.4, whose copies grow from 1 to 12 over 1 s.

Each fixture's planted-fault twin is written in `parity.test.ts`, as #373's are:

| Fixture | Planted fault | Its code, at |
|---|---|---|
| path-ops.scene | the zig zag's ridges 257 (≤ 256 a segment) | `out_of_range`, `items/zigzag/params/ops/0/ridges` |
| loader.film | nine ops (≤ 8) | `out_of_range`, `items/loader/params/ops` |
| burst.film | 65 copies (≤ 64) | `out_of_range`, `items/burst/params/ops/1/copies` |

## Criteria to tests

Each test's name starts with its criterion's ID.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A trim with start 0, end 0.25 and offset 90° on a circle covers the quarter of its length that starts 90° round it, within 0.01 u at 64 sampled points, and an offset of 450° gives the same arc | `trim.test.ts` (2): a circle@1 of r 25 with the trim; the start and sense of its path are read from the same circle trimmed 0..1, which must lie on the circle within 0.01 u; 64 points evenly by arc length along the 90° trim each within 0.01 u of the circle at 90° + 90° × j ÷ 63 from that start (a trim that ignores its offset is about 35 u off); the 450° trim the same against the circle and within 0.01 u of the 90° one (an offset not wrapped by 360° fails) |
| AC2 | A repeater with 3.5 copies draws four copies, the last at half its opacity, and copy k's transform equals the repeater's applied k times within 1e-6 | `repeater.test.ts` (2): four `copies`, opacities 1, 1, 1, 0.5; each transform within 1e-6 of T^k (T from `at`: pos [60, 20], rot 10°, scale 0.9, in f64); four squares in copy order at T^k of the tile; 16 segments; pixels: copies 0–2 ink at their centres, copy 3 about 127.5, no fifth copy (a count that rounds 3.5 to 3, or draws a fifth, or fades every copy, fails) |
| AC3 | zigzag with 5 ridges on a 4-segment path builds the 24 segments computed before the build, as Lottie's zig zag with 5 ridges per segment does, and a repeater whose computed segments pass 50,000 is refused before anything builds, naming the op | `segments.test.ts` (2): `declared`, `segments` and the output's own count all 24; 64 copies of a 1,000-segment polyline: the check's only error `segment_budget` naming `big` at `items/big/params/ops/0…` and carrying 64,000; `path` refuses it with no frame, `raster` too; 50 copies (exactly 50,000) passes and builds 50,000 (a budget off by one, or counted after building, fails) |
| AC4 | Seeking a film whose ops animate gives the same tessellation and pixel hash as playing to it on the same machine, and a still path rebuilds nothing | `seek-play.test.ts` (3): loader.film and burst.film played at 30 fps (and 1.234 s) in one process and seeked to 0.5, 1, 1.234 and 1.5 s in fresh ones: equal `tessellation` and sub-paths, equal RGBA bytes, four different tessellations (the ops do animate); during the loader's play the still hub and a spinner with still ops that moves report `rebuilt: false` after their first frame with one tessellation, the loader `true` every frame (a cache keyed by t for everything, or a frame-to-frame accumulator, fails) |
| AC5 | Each op matches its CPU reference within 0.01 u on its parity fixture (parity/2d/path-ops.scene), and a planted change in any op's output fails it | `parity.test.ts` (8 + 4): each op's output against its f64 reference (Hausdorff distance both ways sampled every 0.25 u, or vertex sets for zigzag, twist and repeater) within 0.01 u; `moved:<op>` fails its op's check, for each of the seven; each fixture passes the check, draws the same raster in two processes, and its twin fails with exactly its code at its path; `path`'s bad_input lines |
| AC6 | A taper from 1 to 0 over the last 20% of a stroke draws widths that follow its ease within 2% at sampled lengths, and a width under 1 device px draws at 1 px with its alpha scaled by its width | `taper.test.ts` (2): a 400 u stroke 12 u wide tapered over its last 80 u with ease 0: at 11 arc lengths the column's summed coverage within 0.24 u (2% of 12) of 12 × (1 − (s − 320) ÷ 80) past 320 (an untapered stroke draws 12 throughout); past 393.3 u, where the width is under 1 px, each column sums to its width within 0.05 and no pixel is covered more than that width plus 0.05, and something draws (a thin end drawn opaque at 1 px, or dropped, fails) |
| AC7 | A path drawn on by a trim from 0 to 1 over 1 s with an arrow at its end has the arrow's tip at the trim's end within 0.1 u at 0.25, 0.5 and 1 s, pointing along the tangent there within 1°, and an end attached with a 4 px gap to a 100 × 40 u box at (200, 100), from a start at (0, 120), ends at (196, 120) | `ends.test.ts` (2): on `M 40 200 L 200 200 L 280 120 L 280 40` (353.1 u) the tip within 0.1 u of the point 0.25, 0.5 and 1 of the way along, its angle within 1° of 0°, −45° and −90° (an arrow at the untrimmed end, or one that doesn't turn, fails); `M 0 120 L 250 120` attached to the box ends within 0.01 u of (196, 120) |
| AC8 | A path whose `opacity` column is one row short of its points is refused with `column_length`, naming the column; a union of a path with an `opacity` column and one without draws the joined points at opacity 1; a planted merge that zero-fills draws them invisible and fails by evaluated value, naming the column | `columns.test.ts` (4): 3-row `opacity` and `width` columns on a 4-point path: the only error `column_length` naming `stroke` at `items/stroke/params/<column>`, `raster` refuses it, 4 rows pass; the union's joined `columns.opacity` is p1's four values then 1, 1, 1, and p2 draws in full ink; under `merge_zero_fills` p2's pixel is the ground and the joined rows fail by value, the failures naming the opacity column |
| AC9 | Budgets, on the reference Mac in the local preflight, compared with the merge base: building 8 ops on a 1,000-segment path takes under 1 ms on change, a still path costs nothing per frame, and a 64-copy repeater stays within the figure budget at 1080p | `budgets.test.ts` (3): median `build_ms` of frames 10–69 of an animated 8-op path under 1 ms; a still 8-op path's frames 1–69 rebuild nothing and spend 0 ms; a 1080p figure (`budget: {class: "figure"}`) with a 64-copy repeater passes its check and builds within 4 ms per changed frame; five fresh processes each, judged; **INCONCLUSIVE off the reference Mac** |
| AC10 | An arrow 20 u long at stroke 3 with size 4 draws a head 5 u long, not 12 | `ends.test.ts` (1): on a 20 u path the head is 5 u long and 5 u wide (scaled down whole from 12 × 12), its tip at the path's end; on a 100 u path the same head is 12 × 12 (a head never capped, or capped always, fails) |
| AC11 | A path attached from A to B with bend 60 is an arc whose turning angle is 60° within 0.1° and whose ends land on the edges within 0.5 u, still so after B moves 80 u | `bend.test.ts` (1): at 0 and 1 s (B's x channel moves it 80 u): the ends within 0.5 u of A's and B's outlines where they are, the turn between the end tangents 60° ± 0.1°, every flattened point within 0.5 u of the 60° circle through the ends; the end moves with B (a bend solved once, or ends left at the boxes' centres, fails) |
| AC12 | An arrow attached at `outline` to a circle of radius 50 u from 45° stops 4 px (its gap) from the circle within 0.5 px; at `edge` it stops 4 px before the box corner, 24.7 u short of the circle | `ends.test.ts` (2): from (100, 100) toward a circle of r 50 at (300, 300): at `outline` the tip is 4 ± 0.5 u from the circle; at `edge` 4 ± 0.5 u from the corner (250, 250) and 50√2 + 4 − 50 = 24.71 ± 0.5 u from the circle; both on the 45° line (an outline that reads the box, or the reverse, fails) |
| AC13 | `#at:0.5` of a path made of a 100 u line then a 300 u line lies 100 u into the second line within 0.1 u, and `#length` reads 400 ± 0.01 u | `anchors.test.ts` (3): `#at:0.5` at (120, 150) within 0.1 u, its angle 90° ± 1°; `#length` 400 ± 0.01; a rect's 300 and a star's ten closed-form edges within 0.01; an attachment naming `two#at:0.5` ends there within 0.1 u (an anchor by vertex count, which puts 0.5 at (120, 50), fails) |
| AC14 | A union outline draws one ring around overlapping parts with no inner seam, and a slit child keeps its own line | `outline.test.ts` (2): rim 1.5 px outside the union on five sides, ground 9.5 px out, body on the edges where the parts cross inside, no rim pixel 1 px or more inside the union, one 4-connected ring (per-child outlines fail); with `slits: ["b"]` rim 1.5 px outside b's west and north edges inside a, where without it is body, and the outer ring kept |
| AC15 | draw_order moves a hand from behind the body to in front exactly on its key, and seeking equals playing | `draw-order.test.ts` (2): the overlap pixel is the body's at 0, 0.5 s and one flick before the 1 s key, the hand's on it and after (a swap a flick late or early, or an interpolated order, fails); seeks to 0.5 s, the key − 1 flick, the key and 1.5 s draw the play's bytes |
| AC16 | A dot in group A with z 1 draws over a line in group B with z 0 though B comes later; inside an isolated group the same dot stays under B, with the notice `z_inside_isolated` | `draw-order.test.ts` (2): the dot's color at their crossing with z 1, the line's at equal z, no notice; with A isolated: the check passes with one notice `z_inside_isolated` naming `dot`, the line's color at the crossing, and the dot's again when isolation is removed (a z that ignores isolation, or never orders across groups, fails) |
| AC17 | A repeater of a 24 × 60 u bar with at.rot 30° and partial: slide with out_cubic, at copies 2.5, draws three bars at full opacity, the third at 56.25° within 1e-6°, where fade draws it at 60° at half opacity; with lag 0.2057 s and a child scale wave of 1 ± 0.22 with period 2.35 s, copy k's scale equals the child's at t − k × 0.2057 s within 1e-9; a planted repeater that evaluates every copy at t draws all twelve at one scale and fails, naming the op | `repeater.test.ts` (4): slide: three copies at 0°, 30° and 30° + 30° × out_cubic(0.5) = 56.25° within 1e-6°, all opacity 1; fade: 0°, 30°, 60°, opacities 1, 1, 0.5; lag: at 3, 3.5 and 4.25 s, twelve copies, copy k's `t` exactly t − k × 145,141,920 flicks, its bar's scale (longest side ÷ 60) within 1e-9 of 1 + 0.22 sin(2π (t − k × 0.2057) ÷ 2.35) and of the bar's own at that time, each turned k × 30°; `repeater_evaluates_at_t` draws all twelve at one scale and fails, its failures naming `items/bar/params/ops/0` |

## Readings where the issue and design leave a choice

1. **One binary, one new subcommand.** The design's goldens render with Vello CPU through `deep-canvas-render`, which
   already links marks2d, the motion program and the look, so the path's evaluated state is read there, as `path`,
   beside #373's `geometry` (kept unchanged). Its frame fields are the smallest set the criteria observe.
2. **Which way a closed path runs and where it starts** (AC1) are the implementation's: the test reads them from the
   same circle trimmed to its whole length.
3. **Which way degrees turn** in 2D isn't stated (as in #373's suite): the repeater tests read the sense from copy 1
   and hold it for every copy, compare angles by magnitude, and the twist test accepts either sense, consistently.
   Tangent and head angles are atan2(dy, dx) in document u, which needs no sense.
4. **The repeater's transform** is the item transform's order (Units and axes: scale, rotate, add the position) with
   pivot 0, applied once more per copy: copy k's is T^k. Its `copies[].transform` is in the item's own space.
5. **The CPU references** (AC5), from the op's definition and, where the design gives none, its namesake: trim by arc
   length; round_corners as quarter circles tangent to both sides (Lottie's round corners within 0.003 u at r 10);
   offset_path with a positive amount growing a closed path outward, miter joins; zigzag as Lottie's, ridges at j ÷
   (ridges + 1) of each segment, size off it to alternate sides (the corners' own offset, Lottie's corner rule, isn't
   pinned: only the ends' positions along the line); pucker as Lottie's pucker and bloat, the centre the vertices'
   mean, amount as a fraction (positive bloats); **twist** turns every point (vertices and control points, so the
   segment count is kept) about `center` by angle × (1 − d ÷ R), R the largest distance of any of the path's points
   from `center` (After Effects' Twist turns "more sharply in the center than at the edges"; the design gives no
   profile); `center` is in the path's own coordinates, and the fixture's star is centred on [0, 0] so a reading of
   it as relative to the box centre agrees. Tolerances are the criterion's 0.01 u, as Hausdorff distances both ways.
6. **The planted change in an op's output** (AC5) is one parametric plant, `moved:<op>`, 0.02 u along +x: past the
   tolerance, so each reference check is shown to fail on it.
7. **`segment_budget`** is coined here; the refusal is the check's, which runs before anything builds, and `path`
   answers it with no frames. 50,000 is within the budget ("refused past 50,000").
8. **Taper's ease**: ease 0 is the straight ramp; the design gives no curve for other values, so only 0 is tested.
   `end: 80` is a bare number in the field's first unit, u (20% of the 400 u stroke). A width is read from pixels as a
   column's summed coverage, which for a line under 1 px drawn at 1 px with its alpha scaled is still its width; the
   1-px rule shows in the column's darkest pixel, never more covered than the width allows.
9. **"Ends at (196, 120)"** and the other attached ends are read from `subpaths` within 0.01 u (none is given), the
   arrow heads from `ends`.
10. **Bend's ends "on the edges"** need no gap, so AC11's path writes `gap: 0`; the arc is a circular arc (Path: "an
    arc through this angle between its ends").
11. **"Stops 4 px from the circle"** (AC12) is read at the arrow's tip; the figures draw at zoom 1, so px are u.
12. **Per-point columns** use the mark set's column form; a path's point count is its points (the fixtures use M and
    L only, so no control point is counted). "A union" is the group's union outline, the issue's one union; its
    joined rows are read as `path`'s `columns` on the group, and "fails by evaluated value" is that read failing.
13. **A slit child's own line** draws over the children before it and under itself, so a joint shows over the body
    (with it under every child, as the union's ring, nothing would show inside the union).
14. **draw_order and z are params** of the item (`items/<id>/params/draw_order`, `…/z`), since the design lists them
    among the group's fields "on a child" and as "a channel on any 2D item" without placing them; `auto` keeps the
    body band.
15. **"The child's scale"** (AC17): a path op's copies have no child items, so the repeated content is the item's own
    animated geometry; the bar's length is a channel on its box height (60 u held, a wave of 13.2 u = 0.22 × 60 with
    period 2.35 s), and a copy's scale is its bar's longest side ÷ 60. `lag` is a time literal; 0.2057 s is
    145,141,920 flicks exactly. "Naming the op" is the failures naming `items/bar/params/ops/0`, as #489 read
    "failing, naming" a channel.
16. **The slide's ease** is a repeater field `ease` holding an ease's name (`"out_cubic"`, Penner's 1 − (1 − u)³);
    the slide interpolates the copy's turn, 30° → 60° by out_cubic(0.5), so the third bar is at exactly 56.25°.
17. **Budgets** (AC9): the figure class's 4 ms frame CPU and the base's `over_budget` check at `budget: {class:
    "figure"}`; "on change" is a frame whose animated op field moved; the reference-Mac gate is #489's (Mac15,7 or
    Mac15,12, Low Power Mode off, no thermal warning). "Compared with the merge base" is the preflight's perf lane: the
    merge base builds no ops, so there is no base timing for this suite to read, and it judges the absolute budgets.

## Upstream tests (the Oracle lane): BLOCKED

The issue's Oracle note links upstream tests for 8 of the 17 criteria at
`https://github.com/DeepBuildAI/deepbuild/blob/doneright/doneright/oracles/issues/160.md`. From this machine that page
and `gh api repos/DeepBuildAI/deepbuild/contents/doneright/oracles/issues/160.md?ref=doneright` both answer 404, so
no upstream test was read or ported, and the lane is **BLOCKED**. One unblock ask: read access to
`DeepBuildAI/deepbuild` (branch `doneright`) for this job, so the oracle page's tests can be run against our output
(#136). Until then the proof that runs is this suite's own CPU references.

## What the base already does and these tests don't credit

The base check passes most documents with these fields, because it ignores params it doesn't know on path@1, rect@1,
star@1 and group@1, and `raster` draws them without their ops, taper, outline or draw order; circle@1 already lists
`ops` as a param it doesn't read, and refuses `z` (`unknown_field`); a channel whose target runs into `params/ops/...`
is `ref_unresolved`. So at the base the pixel tests fail on what is drawn, the check tests on the codes they don't
raise, the film fixtures on `ref_unresolved`, and the `path` tests on the missing subcommand (`BASE-FAILURE.txt`).

## Not tested, because no criterion asks

Wave (`amount`, `wavelength`, `phase`), taper's `start` and non-zero ease, gradient strokes (#373's), focal points
(#373's), `shade`, trim's `each`, offset_path's copies, round and bevel joins, smooth zig zags, the repeater's offset,
composite and opacity ramp beyond the default, the 500,000-segment document limit, end kinds other than arrow
(`open`, `stealth`, `dot`, `ring`, `square`, `diamond`, `bar`) and a head's own `width`, ends naming a mark set's row
or a text's line, `build.fill`, a group flatten and a builder join (beside the union), union outline's `offset` and
`edge`, and draw_order's `body` band. The Scope's other lines that state no observation (jittered paths staying the
boil and displace modifiers, merge staying out, the closed list of end shapes) are left to the implementer's own tests.
