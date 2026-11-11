# Blind redraft of #504 AC8: a take-apart shot keeps every part in the safe frame

This folder is the blind redraft of #504's eighth criterion (docs/technical-design.md: Dogfooding, "A disputed test
goes to a fresh run of that job, with the same inputs and the criterion, never the work, the diff or the dispute"):

> A take-apart shot that keeps every part has every part's bounds inside the safe frame at all 30 samples a second

Its ID is `#504.a17a1463` (scripts/proof-change.mjs `criterionId`, line 153), which both test names carry. It was
written before any implementation, from the issue, the design and the base commit only, by a job that never saw the
work, the diff or the dispute. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- The issue, live (`gh issue view 504 --repo windoliver/deepbuild`): Scope, Fields (Assembly: `parent`, `at`, `motion`,
  `value`, `apart`, `order`, `repeat`), the nine criteria. Its Oracle page (`doneright/oracles/issues/504.md`, branch
  `doneright` of `DeepBuildAI/deepbuild`): criterion 8 has no upstream test ("our shot rule").
- AGENTS.md (the four invariants, Proof).
- `docs/technical-design.md`: 591 (Films and figures on the canvas), 740–755 (Figures that are machines: assemblies with
  a parent, a motion and an apart vector; "taking it apart into its assemblies, eased"; the staggered take-apart), 680
  (Scenes, physics and the canvas core: opening only), 2628–2632 and 2652 (criteria to tests, wrong programs, the edit
  guard, Dogfooding).
- `docs/canvas-primitives.md`: 39–45 (the path grammar: `data/<name>`, "A channel may key `data/<name>`"), 292–321
  (Document envelope: `size`, `safe: f32, u = 24`, `transport.frame_rate`, `data`, the `assemblies` and `shots` maps),
  323–345 (Item and kind: `parent`, `role: part`, `at`), 2890–2905 (Assembly), 4455–4481 (Camera `camera@1`), 4503–4519
  (its framing: `fit.place`, `fit.fill`, the union over the shot's span "so parts that fly apart stay in frame at every
  instant"), 4540–4561 (Shot: `frame.keep`, `frame.fill`, `pad = 0.08`, `[start, end)`, one framed pose, `hold`),
  5238–5241 (Placement's stagger), 5342–5358 (Channel and key: `mode: keyed | follow`), 5412–5426 (Follow: `stagger:
  {targets, lag, order, reverse_on_close}`, "target i starts i × lag later"; the spring model), 8842–8858 (Geometry
  audit: `take_apart` among the states).
- The code at the base, only for its surfaces: `crates/deep-motion/src/main.rs` (`eval`: the line's `doc`, `times`,
  `project`, `planted`; `planted_of` 55–91; the `shots` block 446–456; `projected_json` 547–564);
  `crates/deep-canvas-motion/src/shots.rs` (the Pose JSON 43–150; `framing_of` 460–476; `extent` 479–499, which knows
  `mark.box@1` and `rect@1`; `project` and `through` 514–536; the safe frame and `place` 539–553; `fit` 558–615;
  `settle` 668–740; `union_over` 773–821; `bounds_at` 841–846; `Plan::compile` 866–882);
  `crates/deep-canvas/src/camera.rs` (`orbit_direction` 961, `screen_basis` 1000, `Projector` 1048–1152);
  `crates/deep-canvas-motion/src/doc.rs` (`spring_of` 818–848, `target_of` 1141–1167, `follow_spec_of` 1480–1560, the
  follow branch of `channel_of` 1680–1745, `read_with` 2010–2140, the placement stagger 2713–2740, `parents_of`
  3015–3048); `crates/deep-canvas-motion/src/program.rs` (`compile_with` 466–530, `evaluate` and `parent_to`);
  `eval.rs` `items`; `held.rs` `check`; the `serde_json` features (`preserve_order`).
- Patterns: `tests/acceptance/493/` (README 1–140, its surface; `framing-bound.test.ts`; `helpers.ts`), whose eval
  surface this suite reuses and whose helpers it trims; `tests/acceptance/405/README.md` (only to learn that no take-apart
  is exercised there); `tests/acceptance/1485-redraft-ac2/README.md` and `2009-redraft-ac2/` (a redraft's layout);
  `tests/acceptance/532/helpers.ts` (the rustup PATH prefix); `tests/acceptance/1897/README.md` (Run section).
  `tests/acceptance/501/` was listed, not read. Nothing under `tests/acceptance/504*` existed or was read, nor any other
  worktree, branch, PR or stash.

**Base.** The job named base `a04378eb2` (origin/main). The worktree this was written in was checked out at `e546517e9`,
49 commits later; between the two, nothing changed under `crates/deep-motion`, `crates/deep-canvas-motion`,
`crates/deep-canvas/src/camera.rs`, `tests/acceptance/493/` or the design sections listed (the design diff is an
`unknown_field` paragraph, a repeat-over-parts paragraph and the MCP tools row), so every line number above holds at both.

## Run them

```sh
npm ci                      # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/504-redraft-ac8 --no-file-parallelism
npx tsc -p tests/acceptance/504-redraft-ac8/tsconfig.json   # type-check (exits 0)
```

The file builds `cargo build --locked --bin deep-motion` once, in `beforeAll` (with `CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` and `/opt/homebrew/opt/rustup/bin` put first on PATH when it exists), copies the binary out
under the OS temp folder and deletes it after. Both tests fail when the build fails. Every `it` passes `TIMEOUT`
(60 min). `--root` keeps the repo's `vitest.config.ts` out and leaves Vitest's cache in
`tests/acceptance/504-redraft-ac8/node_modules/.vite`; delete it. The file builds a cargo binary, so it runs alone:
`scripts/lanes.mjs` needs `alone.push('tests/acceptance/504-redraft-ac8/')` (this job writes only this folder; the
implementer makes that edit). The criterion states no timing, so nothing is timed. Node built-ins and vitest only.

## The surface under test

`deep-motion eval` (#391's JSON lines, with #493's surface as `tests/acceptance/493/README.md` states it). No new binary,
subcommand or output field. Every name below that the issue or the design doesn't give is this job's choice, the
smallest one consistent with the design and the base; the implementer builds exactly these, or a dispute goes to the
dispute process.

### The eval line and its answer

- In: `{"doc", "times": [flick], "project": [item ID], "planted"?: "framer_ignores_apart"}`, one line, `deep-motion
  eval`, exit 0, one line out.
- Out, read by the tests: `ok`; `frames[i].t` (one frame per time, in order); `frames[i].cameras.cam`, a Pose
  (`position`, `target`, `fov`, `roll`); `frames[i].projected.<part ID>` = `{"center": [x, y], "box": [x0, y0, x1,
  y1]}` in px of the document's `size` (#493: `box` bounds the projections of the item's evaluated bounds' 8 corners,
  `center` is the projection of their centre); and, in the planted test only, `shots.apart_shot.union` = `{"lo": [x, y,
  z], "hi": [x, y, z]}`, the kept items' union the framing fit.
- For a part, "the item's evaluated bounds" are its bounds where it is drawn: its assembly's transform (the assembly's
  `at`, then its take-apart offset) composes before the part's own (Assembly: "its transform composes before theirs"),
  so `projected` and the framing's union both see the part taken apart.

### The document

#391's envelope with #493's camera and shot, plus #504's assemblies:

| Field | As the test writes it |
|---|---|
| Envelope | `format: 1`, `id`, `profile: "film"`, `title`, `description`, `size: [1920, 1080]` (no `safe`: 24 u), `camera: "cam"`, `layers`, `transport: {span: "4s", frame_rate: "30/1"}`, `items`, `assemblies`, `data`, `channels`, `shots` |
| Camera | `cam`: `camera@1`, `params: {projection: "perspective", target: [0, 0, 0], orbit: {azimuth: 0, elevation: 0, distance: 10}, fov: 40}` |
| Part | `mark.box@1` with `id`, `layer`, `name`, `order`, `role: "part"`, **`parent: <assembly ID>`**, `params: {size, paint: {fill: {role: "accent"}}}`, `at: {pos}` (in the assembly's space) |
| Assembly | `assemblies: {ID → {at: {pos: [x, y, z]}, apart: [x, y, z], order}}`; `parent` left out (null), no `motion`, `value` or `repeat` |
| Take-apart | `channels.take_apart = {target: "data/apart", type: "f32", mode: "follow", follow: {source: {keys: {k0: {t: "0s", value: 0}, k1: {t: "0.5s", value: 1}}}, model: {spring: {freq_hz: 2, damping_ratio: 1}}, stagger: {targets: ["base", "body", "lid"], lag: "0.5s", order: "index"}}}`, with `data: {apart: 0}` |
| Shot | `shots.apart_shot = {start: "0s", end: "4s", camera: "cam", move: "hold", frame: {keep: [the six parts], fill: 0.6}}` |

**The take-apart channel (this job's choice).** A follow channel whose `follow.stagger.targets` names assemblies is a
take-apart: target i (in the stagger's order) reads the follow's value at t − i × `lag` as its take-apart share
s_i(t), 0 assembled and 1 apart, and the assembly's transform moves by s_i(t) × `apart` (Assembly: "a take-apart moves
each assembly by `apart` in `order`, timed by the follow's stagger"; Follow: "target i starts i × lag later"). The
channel's own `target`, `data/apart`, keys the undelayed share (target 0's) as a named value (the path grammar: "A
channel may key `data/<name>`"), so a card or a driver can read how far the figure is apart; the document declares it
in `data`. The design names no field for the share, so none is invented on the assembly.

### The plant

Selected by the eval line's `planted`, never by an environment variable (design: Wrong programs).

| Name | Wrong program |
|---|---|
| `framer_ignores_apart` | the shot's framing bounds the kept parts at rest: as if every assembly's take-apart share were 0 over the span, so its union is the parts' rest bounds and it fits that. Everything else, the take-apart included, evaluates as without the plant |

Any other `planted` value stays `bad_input`, as at the base.

## The test and the fixture's arithmetic

`take-apart-framing.test.ts`, two tests, both named `#504.a17a1463 …`:

1. **The criterion.** The film is accepted with one frame per sample, and (a) every part ends taken apart: from sample 0
   to sample 119 each part's projected centre moves by its assembly's `apart`, as the frame's own camera pose projects
   it (camera@1's pinhole, the field of view across the wider side), within 1% and 0.5 px; (b) at every one of the
   shot's 120 samples, t = k/30 s for k = 0…119, every part's `projected.<part>.box` lies inside the safe frame
   `[24, 24, 1896, 1056]` (x0 ≥ 24, y0 ≥ 24, x1 ≤ 1896, y1 ≤ 1056). A failure names the part and the sample.
2. **The plant.** With `planted: "framer_ignores_apart"` the film answers with frames, its union lies within the parts'
   rest bounds (x −0.6…0.7 m, y −0.6…0.8 m, to 0.02 m), and the same safe-frame check fails, naming the plate and the
   knob at sample 119.

The figure, all centres at z = 0, every `apart` across the view (the camera looks down −Z):

| Assembly | `at.pos` | `apart` | `order`, stagger start | Parts (`at.pos` in the assembly; size, m) |
|---|---|---|---|---|
| base | [0, −0.5, 0] | [0, −2, 0] | 0, 0.5 s | plate [0, 0, 0] (1.2 × 0.2 × 0.6); peg [0.4, 0.2, 0] (0.2) |
| body | [0, 0, 0] | [1.2, 0, 0] | 1, 1.0 s | drum [0, 0, 0] (0.8 × 0.4 × 0.6); gear [0.55, 0, 0] (0.3) |
| lid | [0, 0.5, 0] | [0, 2, 0] | 2, 1.5 s | cap [0, 0, 0] (1.0 × 0.2 × 0.6); knob [0, 0.2, 0] (0.2) |

- The follow's source steps from 0 to 1 at 0.5 s; target i starts i × 0.5 s later. The spring is critically damped
  (ω = 4π rad/s): s(τ) = 1 − (1 + ωτ)e^(−ωτ), which never overshoots, is 0.6 at τ ≈ 0.16 s and within 1e-9 of 1 by
  τ ≈ 2 s; at the last sample (3.967 s) the lid, the latest, has had 2.47 s, so every share is 1 to 1e-12.
- Rest union: x [−0.6, 0.7], y [−0.6, 0.8], z [−0.3, 0.3]. Union over the shot: x [−0.6, 1.9], y [−2.6, 2.8], z
  [−0.3, 0.3] (each part moves on a line from rest to apart).
- #493's fit (`shots.rs` `fit`): the union widened by `pad` 0.08 of its extent per side; `half` = fill × the safe frame's
  shorter side ÷ 2 = 0.6 × 1032 ÷ 2 = 309.6 px; focal = 960 ÷ tan 20° = 2637.58 px; distance = max over the padded
  corners of depth + √(r² + u²) × focal ÷ half; the target at the padded centre, since `place` [0.5, 0.5] of the safe
  frame is the frame's centre. Every padded corner then projects within 309.6 px of (960, 540), and so does every part
  inside the union.
- **The framing over the shot** (any correct union): distance 29.75 m, 88.65 px per m at the parts' depth. The least
  margin to the safe frame over all 120 samples and six parts is 274.2 px (the plate's bottom at sample 110); fully apart,
  the knob's box tops out at y 299.8 and the plate's bottoms at 781.8, the gear's right edge at x 1071.4.
- **The plant** (the rest union): distance 9.79 m, 269.5 px per m. At sample 119 the plate's box reaches y 1290.6
  (234.6 px past 1056) and the knob's y −195.1 (219.1 px past 24); the plate leaves from sample 20, the peg from 21, the
  knob from 50, the cap from 51, and the drum and gear stay inside (gear's right edge 1466.3).
- The take-apart check, for the correct framing: the plate and peg move 177.3 px down, the cap and knob 177.3 px up, the
  drum and gear 106.4 px right.

These numbers come from a scratch script with the camera math of `crates/deep-canvas/src/camera.rs` and `fit` of
`shots.rs` (not kept); the suite was not built or run here (the machine is shared and loaded).

## Readings

1. **"A take-apart shot"** is a timeline shot of a film (Shot: "A segment of a film") over the whole take-apart, here a
   `hold`, so its one framed pose is the pose of every sample. The `assemblies` map is the envelope's, in any profile.
2. **"Keeps every part"**: the shot's `frame.keep` names every part, the six items whose `parent` is an assembly, and
   not the assemblies themselves.
3. **"Every part's bounds"**: each part's evaluated bounds where it is drawn, projected through the frame's camera
   (#493's `projected.<id>.box`). Parts are `mark.box@1`, the 3D kind #493's framing and projection already bound by
   its size; the design's figure part kinds aren't named at the base, and the criterion is about bounds, not a kind.
4. **"Inside the safe frame"**: within the frame inset by the envelope's `safe` (24 u = 24 px at 1920 × 1080), edges
   included, as #493's AC10 test holds it.
5. **"At all 30 samples a second"**: every 1/30 s over the shot's span `[0, 4 s)`, 120 samples, which are the frames
   of the film at `frame_rate: "30/1"`.
6. **The take-apart.** Assemblies with `apart` vectors and `order`, taken apart by a follow channel whose stagger
   names them (The take-apart channel, above). The stagger's `targets` are listed in the assemblies' `order` (0, 1, 2),
   so reading the order from either gives the same timing; `lag` is a time literal, so it is no ratio of anything.
   Assemblies here only translate (`at.pos`, `apart`), so the order of composition can't change a number.
7. **The take-apart check** is there so the criterion's check can't pass vacuously: parts that never move stay inside
   any frame. It asks only that each part ends displaced by its assembly's `apart`, not when or how fast.
8. **The plant's union check** makes sure the plant is the wrong program it names (framing that ignores the take-apart),
   not some other failure.

## Not tested

Nested assemblies and the depth limit; an assembly's `parent`, rotation or scale in `at`, `motion`, `value` and
`repeat`; the take-apart coming back, its order as a criterion (AC3), stagger `reverse`, `seeded` and
`reverse_on_close`; moves other than `hold`, `place` other than the centre, fill other than 0.6, 2D figures, overlays and
reduced motion; frames between the 30-a-second samples (#493's AC10 holds framing between samples); the card and
readout; the geometry audit's take-apart state; other wrong framers (one that ignores the assembly's `at`, or samples the
take-apart); pictures, exports and the taste call (AC9).
