# Acceptance tests for #464: print and pixel looks: separations, print finishes, dither fills, indexed pixel looks and a display-only GPU snapshot

Written first, from issue #464 (its scope, its six field rows and their "It can never" lines, its fifteen acceptance
criteria and its proof line: "A fixture per finish, and the separations and pixel fixtures read back on two GPUs,
BLOCKED with one unblock ask where only one exists"), its Oracle page (`doneright/oracles/issues/464.md` in
`DeepBuildAI/deepbuild`, branch `doneright`), the design sections it links and those they lean on, and base commit
`b52f7357` ("Merge pull request #1641 …"), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one file per criterion or pair of related criteria, one test per criterion clause that needs its own run, plus
exactly the planted twins the criteria name.

## What was read

- Issue #464 and its Oracle page; the titles of #418, #149, #429 and #421 it depends on.
- `docs/canvas-primitives.md`: Render-back and its diagnostic modes; Determinism class; Paint: dither fill; Look
  `look@1` and its rows tone mapping, grade, separations, drawn fills, print finishes, indexed basis; Flicker check;
  Check input (`film.flicker`); the Group's `blend` (Frame and group).
- `docs/technical-design.md`: Look; GPU operator; Render-back; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/418/`, `149/`, `252/`, `429/` and `1162/` (READMEs,
  helpers, the finish, grade, steps, taste and render-back tests); `crates/deep-gpu-layer/src/{main,film,marks2d,tone,
  effects}.rs` (the call table, `film2d`, `layers`, `tone`, `cross_gpu`), `crates/deep-canvas-marks/src/finish.rs`,
  `crates/deep-show/src/modes.rs` (render-back's `display_only` on a diagnostic mode), `crates/deep-canvas/src/grammar/
  unit.rs` (`%`, `px` and `fw` literals), `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

`film2d` plays a 2D film under a look@1, with `fps`, `from`, `frames`, `hash` (each frame's `pixel_hash`) and `capture`
(each listed frame's `final` PNG); 2D documents take a `camera@1` (#149), item `adjust.opacity` and `parent`. `view3d`
draws #382's status report and #418's grade (white balance as a Bradford adaptation, the ASC CDL after the tone curve);
`tone` runs a tone map over an f32 file. `deep show` returns render-back snapshots as `{sha256, w, h}`, and a diagnostic
mode's snapshot is labelled `display_only`. So `grade.test.ts`'s white-balance test passes at the base (run once, `BASE-FAILURE.txt`):
it reads #418's grade, and is here because the criterion names it; the criterion's CDL half fails there. Nothing of #464's exists: no `separations`, no
`grain`, `vignette`, `print_wear`, `tone_curve` or `screen` in a look's finish, no indexed basis, no `targets` on
`film2d` (no `linear` or `indices`), no `indexed` record, no `reduced_motion` or `flicker` on `film2d`, no `grade` on
`tone`, no GPU snapshot in a 2D render-back, and none of the six planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/464 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/464/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds what it drives once, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu` (and `renderback.test.ts` `cargo build --locked --bin deep-show --no-default-features --features full`),
adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH when cargo isn't on it,
copies the binary out of the target folder (`CARGO_TARGET_DIR` honoured) to a temporary folder, and fails each test
that uses a build that failed. So the files run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/464/'` in
its `alone` list beside `'tests/acceptance/418/'` and `'tests/acceptance/149/'`. This README is the instruction; the
implementer makes that edit. Each test writes into its own temporary folder and deletes it; Node built-ins, vitest and
`packages/evidence`'s public entry only. A run with `--root tests/acceptance/464` leaves Vitest's cache in
`tests/acceptance/464/node_modules/.vite`; delete it.

- Everything draws on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- **Two GPUs.** The pixel fixtures' indices (AC3's tables, AC6's stroke and circle, AC7's dithered puff) are written to
  `index-record-<fixture>-<family>.json` in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-464-evidence`) with this Mac's
  GPU family (its chip, as #429's suite reads it). The two-GPU test compares them with the same record made on a Mac of
  another GPU family, named by `DEEPBUILD_SECOND_GPU_464`; with none it fails with a message starting `BLOCKED:` and
  its one unblock ask (run this suite on a Mac of another GPU family and name its record), never passing.
- `taste.test.ts` keeps its five screenshots in `DEEPBUILD_EVIDENCE_DIR` and reads your taste call from the file
  `DEEPBUILD_TASTE_464` names; without it the test fails as `INCONCLUSIVE:`.
- No criterion has a time budget, so nothing is gated on the reference Mac, power or load.
- `BASE-FAILURE.txt` is one run of `tables.test.ts` at the base, and one of `grade.test.ts` as a check of the harness.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged:
#417's and #149's `film2d` for every 2D look, #378's `view3d` for status under the finish and the white balance, #418's
`tone` for the grade; and #393's `deep-show run` for render-back. Field names the issue and design give are used as
they give them; the rest are this suite's choices, marked **bold**, each the least a criterion needs.

### The look (`look@1`, passed inline as `look`, or by asset to the hub)

- `separations: [{role, halftone: "solid" | {angle, pitch, spot}, offset: [px, px], order, overprint, anchor}]`, a
  top-level look field, as the design's Fields list puts it beside `light` and `captions`.
- `finish: [effect]`, each effect **a one-key object** naming it: `{grain: {amount, size, tone, rate}}`,
  `{vignette: {color, shape, inner, outer, amount, aspect}}`, `{print_wear: {flicker, weave, scratches, dust, hair,
  gate, rate}}`, `{tone_curve: {black, white, contrast, toe, shoulder}}`, `{screen: {kind, scanlines, mask, curvature,
  …}}`. **A finish named with no field set (`{grain: {}}`) is that finish at its identity defaults; a field left out
  is at its default, and a screen's `scanlines`, `mask` and `curvature` left out are off.** Percentages and lengths
  given with a unit are unit literals (#149's grammar): `amount: "4%"`, `flicker: "5%"`, `size: "1px"`; a bare number
  in a px field is px.
- `basis: {indexed: {size, scale, palette: [role], tables: {name → {role → role}}, protected: [role], snap, see_through,
  light}}`: the indexed basis as a one-key object, as #418's `{agx: {…}}` is. **Index i is `palette[i]`**, and **a palette
  table is a map from a role to the role it draws as**; a role a table doesn't name keeps its index.
- `grade` as #418's, top level.

### Documents

2D documents as #149's: one writer layer `main` (writer `agent-a`), items keyed by ID with `kind`, `layer`, `order`,
`params`; `rect@1` (`box`), `circle@1` (`center`, `r`), `path@1` (`d`, `paint.stroke: {role, width}`), `group@1` with
children by `parent`; a `camera@1` named by the envelope's `camera` (`target`, `view_width`). Fields added: an item's
**`blend: "add"`** (the design's "`blend: add` marks"), and an item's or a group's `table: name | "none"`, an enum
channel keyed at `items/<id>/table` (**channel `type: "enum"`**, `interp: "hold"`). Indexed documents are the target
times the scale, 1280 × 720 for 320 × 180 at scale 4, so **target coordinates are document coordinates ÷ 4**.

### `film2d` (#417, #149): fields added

```json
{"call": "film2d", "doc", "look", "fps"?, "from"?, "frames", "hash": true, "capture"?: [n],
 "targets"?: ["final" | "linear" | "indices"], "reduced_motion"?: true, "flicker"?: true}
```

- **`targets`** on each captured frame's row: `final`, the PNG `capture` already writes; **`linear`**, the frame in linear
  light after the finish and before its 8-bit encode, `<sha256>.f32`, little-endian f32 RGBA, rows top-down, `w × h ×
  16` bytes (as `view3d`'s `linear`); **`indices`**, an indexed look's index target as read back, `<sha256>.u16`, one
  little-endian u16 per target pixel, rows top-down, `w × h × 2` bytes at the basis's `size`.
- **The reply's `indexed`** (an indexed look): `{operator, class, palette}`: the operator the index target was read back
  from, its computed determinism class, and the palette in index order.
- **`reduced_motion: true`**: the film drawn under reduced motion.
- **`flicker: true`**: the flicker check (`film.flicker`, canvas primitives: Flicker check) over the frames played,
  answered as **`flicker: {verdict}`**.
- A look the check refuses answers a refusal with a `code` and no `frames`; **a table that remaps a protected index
  adds `table` (its name) and `index` (the protected index)**.

### `tone` (#418): one field added

`{"call": "tone", "tone_map", **"grade"**, "input", "size"}`: the grade (#418's fields) applied inside the tone-mapping
pass the call runs, so the output is the pass's color before the encode.

### `view3d` (#378, #382, #418): unchanged

Read for AC2's status: `doc` (a path), `look`, `size`, `targets: ["final"]`, `capture: [0]`, `states`; the reply's
`status.{shows, marks[].{state, bounds}, legend[].{state, swatch}}` and each frame's `pixel_hash` and `final`.

### Render-back: `deep show` through `deep-show run` (#393, #403)

One scenario per line (#1162's world: an agent session, its processes, one panel, the document on it, the claims): `{call:
"deep show", peer, doc, document, t, size, include: ["issues", "pixels"]}` and, with `check: true, claim`, the claim's
checks, then `{call: "verdict", claim}` (`requirements[].{id, result, …}`). Added: **a 2D render-back whose look's finish
runs an operator returns two `snapshots`, the Vello CPU one and one with `display_only: true`**, the GPU snapshot from
this machine; and **a pixel check's input may name a snapshot to read, `{kind: "render.contrast", snapshot: <sha256>}`**,
which, for a `display_only` snapshot, is refused: its requirement's row is not PASS and carries the code `display_only`
and the snapshot's hash.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `vignette_pixels` | The vignette's radius measured in pixels from the centre (over the short half-axis), not normalised per axis | `8dfec0d8` |
| `grain_from_t` | Grain seeded from t, ignoring its rate and reduced motion | `8dfec0d8` |
| `partial_coverage` | The index rasterizer writes every target pixel a mark covers in part | `2b45c184` |
| `puff_full_opacity` | A see-through item drawn at full opacity on the index target | `0f0a7807` |
| `light_after_upscale` | The light target added to the frame after the nearest upscale, at full resolution | `1f75f469` |
| `flicker_wall_time` | Print wear's flicker gain seeded from the wall clock | `43c8684e` |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#464.56dd891a` | 1: separations | `separations.test.ts`: two solid separations, rose's offset `[3, 0]`, overprint in the overlap within one code value of c₁ × c₂ ÷ 255; the 3 columns the offset uncovers are cyan alone and the 3 it adds rose alone. A plate-anchored round halftone (pitch 24) at 35% coverage through a zoom 1× → 5×: every whole dot at 1.67× and 5×, mapped onto the plate through the camera, within 0.5 plate px of a dot at 1×. |
| `#464.bf7ef469` | 2: identity, status | `identity.test.ts`: all five finishes at identity give the pixel hash of `finish: []` on a 2D print, and each off identity changes it; #382's bound film under each finish, under halftoned separations and under all of them keeps the fail mark and the legend's fail swatch #bf232b, each changing the frame. |
| `#464.dc7d4ab3` | 3: indices | `indexed.test.ts`: `indexed.class` is `exact` and its palette the look's; no index past the palette; the protected `guard` keeps its index under `none`, `flash` and `frozen` while body and trim take each table's. Two GPUs: the record, BLOCKED with one. |
| `#464.c29f1d4c` | 4: render-back | `renderback.test.ts`: two snapshots, exactly one `display_only`, both 960 × 540 PNGs in the store; the same GPU snapshot on a second run; the check reading it refused with `display_only` naming it, the twin reading the CPU one not. |
| `#464.8dfec0d8` | 5: vignette, grain held still | `vignette-grain.test.ts`: r ≤ 0.45 exactly white; corners within 1 of 255 + 0.7 × (ink − 255); no ray brightens outward; the four points at 0.8 within 1. Grain at rate 0 and at 24 Hz under reduced motion: frames 0 and 37 (3.7 s at 10 fps) one hash; grain at 24 Hz moves; grain shows. Twins `vignette_pixels` (names a pixel) and `grain_from_t` (names frame 37). |
| `#464.2b45c184` | 6: binary coverage | `indexed.test.ts`: the stroke one pixel in each column 10–90, on the line, 81 in all; the circle exactly the 112 pixels whose centres lie within 6 of (100, 100). Twin `partial_coverage` names the first pixel. Two GPUs: as above. |
| `#464.0f0a7807` | 7: see-through | `see-through.test.ts`: each whole block away from the shield holds the puff exactly where Bayer < 8, at 0, 0.5 and 1.54 s; with `blend`, each covered pixel the formula with a = 128; the shield keeps guard's index and color. Twin `puff_full_opacity` names `item puff` and 16 of 16. Two GPUs: as above. |
| `#464.1f75f469` | 8: light | `light.test.ts`: the spark's block (255, 160, 60) in all 16 pixels, its neighbours the base, the guard exact; with `light: none` every pixel a palette color. Twin `light_after_upscale` names a pixel in the block of (60, 60). |
| `#464.6ebf11ae` | 9: tables by channel | `tables.test.ts`: played frames 99, 100, 104, 105 and seeked 102, 105 at 100 fps: hero-body through flash on 100–104, base otherwise; hero-cape frozen throughout. A table mapping guard refused with `table: "bad"`, `index: 4`. |
| `#464.737ef81a` | 10: grain | `grain.test.ts`: Y's deviation 4% of the mean ±10% on `linear`; the code mean within 0.25 of no grain; one hash per 1/24 s step and a new one each step, frames 1, 5, 10 seeked equal played; midtones: deviation at 0.01 and 0.9 ≤ ¼ of 0.18's. |
| `#464.1bc1fe40` | 11: scanlines | `screen.test.ts`: 240 dark bands, period 4.5 ± 0.1, each centre within 0.25 of (k + 0.5) × 4.5. |
| `#464.2cb143dd` | 12: curvature, mask | `screen.test.ts`: 25 dots within 0.5 px of the barrel map; corners under 10% of white; at curvature 0 no dot moves (0.05 px); every column passes exactly one channel above 229.5, R → G → B, red stripes every 3 px within 0.1. |
| `#464.43c8684e` | 13: print wear | `wear.test.ts`: each of 48 frames' mean Y in [0.95, 1.05] of unworn; the flicker shows; `flicker.verdict` PASS; a second play and cold seeks equal the first play. Twin `flicker_wall_time` names a frame. |
| `#464.93ecbe88` | 14: grade | `grade.test.ts`: `tone` with the grade over 64 seeded display-linear colors, each channel within one 10-bit code of the f64 CDL; white balance 6500 K tint 0 has the ungraded film's pixel hash and 5000 K doesn't. |
| `#464.d22bf5b7` | 15: taste | `taste.test.ts`: five renderer screenshots kept and printed; INCONCLUSIVE without your recorded call; `looks_wrong` fails. |

## Readings where the issue and design leave a choice

- **Multiply** is on 8-bit sRGB-encoded values, c₁ × c₂ ÷ 255, as the Oracle page's two implementations (Vello's
  `mix_multiply`, resvg's `mix-blend-mode: multiply`) blend; "within one code value" is per channel, per pixel.
- **"Within 0.5 px" for plate dots** is in plate pixels (document units): each dot's centroid, mapped back through the
  camera, lies within 0.5 of a dot found at 1×. Measured in screen pixels at 5×, 0.5 would hold the 1× centroids to 0.1
  px, finer than the 1× frame resolves.
- **Identity defaults** are each finish named with no field set. Separations have no identity of their own (a look
  without them prints none), so AC2's identity half holds the five finishes; its status half holds separations too.
- **Status in AC2** is read on `view3d`, the one surface with a status report; the finish is the look's, whichever
  renderer draws the frame.
- **The vignette's normalised radius** under `aspect: frame` is 1 at each half-axis's end, so the criterion's two points
  at 0.8 share a radius and lie in the frame; the corners sit at √2, past `outer`, at the full amount. **"70% of the way
  to ink"** is in code values, per channel, as the criterion's tolerance is. **A ray** is walked from the centre one
  pixel at a time at every 3°; "never brightens" allows equal neighbours, never a brighter one.
- **"The same pixels"** is the same pixel hash, each frame opened cold at its time (`from`).
- **Indexed coordinates** are target pixels; the document is the target times the scale. The stroke's row in each
  column is any whose centre lies within 0.5 of the line there (the line meets row boundaries at odd columns).
- **The exact operator** is named by the reply (`indexed.operator`, `indexed.class: "exact"`); the test doesn't
  inspect its steps, which #429's check computes.
- **The Bayer matrix** is the standard 4 × 4 recursive one, read at `[y mod 4][x mod 4]` of the target pixel, (0, 0) the
  target's top left; at 8 the covered pixels form a checkerboard either way it's read. **a** is the opacity's 8-bit
  value, ⌊0.5 × 255 + 0.5⌋ = 128.
- **A spark** is a circle of `blend: add` whose role's color is its glow, a disc of radius 0.5 target px centred on one
  target pixel: on the target it covers that pixel alone; at full resolution it leaves its block's corners out, which
  is how a light added after the upscale shows two values in one block.
- **"Refused at check"** is the look refused before any frame is drawn, which `film2d` answers as a refusal.
- **Grain's deviation** is the standard deviation of Rec. 709 Y over every pixel of the `linear` target; with
  `tone: midtones` "the deviation" is that same absolute deviation. The 0.18 grey is #767676 (0.1812), the nearest 8-bit
  grey; "a code value" is of the 8-bit final, averaged over R, G and B.
- **Scanline bands** are dark, centred at (k + 0.5) × H ÷ n, so all 240 lie whole in 1,080 lines; a band is a run of
  rows below the profile's midpoint, its centre the darkness-weighted centroid.
- **The barrel map** is the CRT shader's: the frame point at normalised q (per half-axis) shows the chart at q × (1 +
  k|q|²). "Masked" is under 10% of white. "Moves no pixel" is each dot's centroid within 0.05 px of the unscreened
  frame's.
- **The mask's stripes** are 1 device px each, so each column passes one channel; device px are frame px at scale 1.
- **The flicker check** is `film.flicker` over the played frames; a flicker from wall time is caught by a second play
  and cold seeks differing, failures naming the frame.
- **The grade** is held on `tone` (the pass the grade runs inside) over 64 seeded display-linear colors, so float output
  can be held to a 10-bit code; the CDL is #418's, clamped after saturation.
- **"A check that tries to read the GPU one"** is a claim's pixel check naming that snapshot by hash; refused is a row
  that isn't PASS and carries `display_only`.
- **The render-back document's operator** is its print look's finish (halftone, grain), which the 2D writer layer's
  frame runs.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- The dither fill (`dither {stops, matrix, by, anchor}`) and `cells(p, seed)`'s outputs: in the scope and fields, in no
  criterion.
- Registration jitter (`offset: {jitter, hz, seed}`), `knockout`, anchors `sheet` and `frame` beyond AC2's status run.
- Print wear's weave, scratches, dust, hair and gate, the tone curve's fields, screen kinds other than `crt`, `shadow`
  and `slot` masks, convergence, bleed, noise and rate, beyond AC2's identity and the taste screenshots.
- A CRT's afterglow drawn by the text animator; grain's `size` beyond 1 px; the vignette's `shape: hood`.
- The "It can never" refusals beyond AC9's protected table: a status role screened or used by a dither fill, an ink
  outside the look's roles, a LUT image, interpolating between indices, light onto a blended pixel.
- 3D indexed shading (ramps, `dither: ordered` per item, `indexed.near_step`, `pixel.texel_off_palette`,
  `pixel.ramp_flat`).

## The oracle page

Read. It pins upstream tests for 1 of 15 criteria (criterion 1, multiply overprint) and copies none:

| Row | Status |
|---|---|
| Vello `vello_tests/tests/mix.rs:81-84`, `mix_multiply.png` (235739c4f0) | **Ported as behavior** in `separations.test.ts`: the multiply rule on encoded values within one 8-bit code value, Vello's `cpu_u8_tolerance = 1`, held on our 2D renderer's overprint. The snapshot isn't compared: it blends a gradient and an image, and the criterion's separations are two flat inks. |
| resvg `painting/mix-blend-mode/multiply.svg` (77b12f4951) | **Ported as behavior**, the same assertion: two overlapping rects, one multiplied. Its PNG isn't vendored. |
| Criteria 2 to 15 | No upstream test, as the page says. Dots anchored to the plate through a zoom have none. |

Nothing from either project is copied into this folder.
