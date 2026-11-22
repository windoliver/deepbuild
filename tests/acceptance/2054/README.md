# Acceptance tests for #2054: familiar light range and falloff, the engine's range word mapped onto ours in metres and a falloff we can't draw refused

Written first, from issue #2054 (its scope, three acceptance criteria, proof line and "Runs on" line), its oracle page,
the design sections it links, and base commit `5f5791e2d` ("Merge pull request #3068 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus exactly the planted wrong programs
the criteria name.

## What was read

- Issue #2054, live, and its oracle page (`doneright/oracles/issues/2054.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): no upstream test checks any of the three criteria ("illuminance at 2, 4 and 6 m is a closed form on the
  pack's expanded light"), so every expected value here is the issue's own and nothing is ported.
- `docs/canvas-primitives.md` (`node scripts/design-section.mjs --issue 2054`): Light and the light policy (`range: m =
  auto`, √(power ÷ (4π × cut)), "0.05 lx at EV100 5.76, where 800 lm reaches about 36 m; a range given in metres is
  kept as given"; the window `(1 − (d ÷ range)⁴)²`), Recipe, Pack (its semantics paragraph states this issue's rules:
  the range word one for one onto `range`, unwritten 5 m and never the automatic range, 0 or less refused by name;
  the falloff exponent word, 2 accepted, anything else refused at `items/<id>/params/<word>` with a fix that says to
  write 2, nothing drawn with another falloff; "a published version never changes"), Units and axes.
- `docs/technical-design.md`: Criteria to tests, both ways; Wrong programs; The edit guard; Dogfooding.
- The engine's class docs at the release #433's suite pins (`tests/acceptance/433/reference.ts`: 4.5.1-stable), read
  through GitHub: `doc/classes/OmniLight3D.xml` and `doc/classes/SpotLight3D.xml`. Their words: `omni_range` and
  `spot_range` (default 5.0; "the light will never reach anything outside this radius"), `omni_attenuation` and
  `spot_attenuation` (default 1.0; "Use a value of 2.0 for physically accurate lights as it results in the proper
  inverse square attenuation").
- At the base, for call shapes only: `tests/acceptance/433/` (its helpers, `lights.test.ts`, `tool-words.test.ts`,
  `fixtures/tool-words.json`, its README's surface and planted programs); `packs/godot-1.0.0` (the point and spot light
  recipes map position, `light_intensity_lumens` and `spot_angle`, nothing else); `crates/deep-show/src/familiar.rs`
  and `packs.rs` (a twin of a pack's manifest applied at install through the scenario's `planted`);
  `crates/deep-canvas/src/document/packs/{expand.rs,inputs.rs,refused.rs}` and `document/mod.rs` (an issue's `path`
  and `fix`; a param outside an input's range is `out_of_range` at `items/<id>/params/<name>`; a recipe's `refuses`);
  `crates/deep-canvas-scene3d/src/light.rs` (`range`, the automatic range, `range_cut`, `follow_exposure`) and `scene.rs`
  (`at.rot`, R = Rz·Ry·Rx); `crates/deep-scene3d-render/src/scene3d.wgsl` (`arriving`); `crates/deep-gpu-layer`
  (`view3d`'s targets, `--planted`); `tests/acceptance/1634/` (its helpers and reference: the linear target, the
  object-ID target, the pinhole, the automatic range, the reference-Mac check), `421/`, `422/`, `1939/`;
  `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs` (a suite's `lane.json`).

## What the base already does, which these tests don't credit

`packs/godot-1.0.0` maps the engine's point and spot lights by position, light output and the spot's cone angle; the
range and falloff exponent words are unknown inputs there, refused as such; a light written without a range takes our
automatic range. There is no `packs/godot-1.1.0`, neither scenario `planted` value below is known to `deep-show`
(which refuses an unknown one as bad input), and `light_window_squared` is no `deep-gpu --planted` name.
`deep-gpu`'s view3d already draws a `light.point@1` with a `range` and the window the design names, and already
returns the linear and object-ID targets; nothing in it is new here except the planted window.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2054 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2054/tsconfig.json
```

Every file builds `deep-show` in the `full` set through #433's `useShow` (`cargo build --locked --bin deep-show
--no-default-features --features full`); `squares.test.ts` also builds `deep-gpu` through #1634's `useGpu` (`cargo
build --locked --bin deep-gpu`). So the folder runs alone: `lane.json` says so, and lands with the suite. The tests
import #433's and #1634's helpers and #1634's CPU reference rather than copying them; vitest and Node built-ins only.
Each test writes into its own temporary folder and deletes it. A run with `--root tests/acceptance/2054` leaves
vitest's cache in `tests/acceptance/2054/node_modules/.vite`; it is git-ignored.

`range.test.ts` and `falloff.test.ts` read expanded items and refusals and run anywhere the binary builds.
`squares.test.ts` reads frames: it counts on a reference Mac (the Macs `scripts/benchmark.mjs` lists, by model, chip
and memory, as #1634's `offReferenceMac` reads them) and fails with a message starting `INCONCLUSIVE:` anywhere else,
never passing there. Nothing is timed, so the machine's load doesn't decide a verdict.

## The surface

The issue names the words' meaning, the values and the wrong programs, but no folder, version string, planted name or
reading. These are this job's choices, each the plainest one beside the base's own surfaces; `helpers.ts`'s block
"The surface #2054 leaves open" holds each name once. The implementer provides exactly these.

1. **The pack's next minor**: `packs/godot-1.1.0`, a new folder beside `packs/godot-1.0.0` (a published version never
   changes, and #433's suite keeps reading 1.0.0), whose `pack.json` has `"name": "godot"` and `"version": "1.1.0"`.
   It is installed as `{id: "deepbuild/godot", dir: "<repo>/packs/godot-1.1.0"}` in the scenario's `packs`, and a
   document names it `"deepbuild/godot@1.1.0"`. Its recipes keep their kinds, `godot.omni_light_3d@1` (to
   `light.point@1`) and `godot.spot_light_3d@1` (to `light.spot@1`), and each adds the engine's own words for its class:
   - `omni_range` / `spot_range`, metres, mapped one for one onto the light's `params.range`; unwritten, `range` is 5;
     0 or less is refused with an issue in the revision's `issues` at `items/<id>/params/<word>`, and the instance is
     not drawn.
   - `omni_attenuation` / `spot_attenuation`: 2 expands to exactly the items the word unwritten does; any other value is
     refused with an issue in `issues` at `items/<id>/params/<word>` whose `fix` (the issue's text field) names 2 as a
     number of its own (`2` or `2.0`, not a digit of another number), and the instance is not drawn.
   How a recipe refuses (an input's range, `unmapped()`, `refuses`) is the implementer's; the tests read the issue's
   `path` and `fix` and the reply's `expansions`.
2. **`deep-show run`'s scenario `planted`**, each a twin of the pack's next minor applied to its manifest at install,
   as `crates/deep-show/src/familiar.rs` applies #433's, reachable only there:

| Value | The wrong program | Criterion |
|---|---|---|
| `range_word_dropped` | Both light recipes accept `omni_range` / `spot_range` (any value the real ones accept) and pass nothing on: the light names no `range`, so it takes our automatic range (35.68 m at 800 lm at EV100 5.7635) whether the word is written or not. Everything else as shipped | AC1, AC2 |
| `falloff_one_drawn` | Both light recipes accept any `omni_attenuation` / `spot_attenuation`, 1 and 0.5 included, with no issue, and expand it to exactly what 2 expands to: the inverse square. Everything else as shipped, a range of 0 still refused | AC3 |

3. **`deep-gpu run --planted light_window_squared`**: the renderer fades a local light's inverse square by
   `(1 − (d ÷ range)²)²` instead of `(1 − (d ÷ range)⁴)²`, everything else as shipped (the shader's `arriving`, where
   the base's own planted flags live). AC2.
4. **AC2's drawing and reading.** `deep-show run` (no planted, or `range_word_dropped`) shows a document holding the
   lamp word alone; its `expansions` row gives the one `light.point@1` it expanded to. The test copies that item's
   `kind`, `params` and `at`, as expanded, into a `deep-gpu` view3d document (#1634's `sessionDoc`, one writer layer,
   work-product class, 640 × 360) with: a `camera@1` at the lamp's position, target 1 m down −Z, fov 90° across the
   wider side, near 0.05 m; #1634's black `sky@1` with zero ambient; a `material@1` matte of base colour 1, roughness 1,
   specular level 0; and three `mark.box@1` slabs, `[side, side, 0.02]` m, each turned −azimuth about +Y (`at.rot:
   [0, −azimuth, 0]`) and placed so its face toward the lamp stands `distance` m from it, square to the line from the
   lamp along azimuth degrees from −Z towards +X. The look is #1634's `look('none', 5.7635)`: no tone map, at the
   exposure where an automatic range's cut is 0.05 lx. One frame, targets `linear` (f32 RGBA, before exposure and the
   tone map) and `ids`. A square's reading is the mean of R, G and B over the 3 × 3 pixels about the pixel its nearest
   point to the lamp projects into (#1634's pinhole), each of which `ids` must show as the square.

## The fixture

`fixtures/light-range.json` (the criterion's "new fixture"): AC1's four light words and the range each must expand to;
AC2's lamp word (800 lm, `omni_range` 5, at (0, 1.5, 0)), its squares (`sq_2m` at −30°, 0.5 m wide; `sq_4m` at 0°,
1 m; `sq_6m` at 30°, 1.5 m) and the readings; AC3's two pairs and four refused words. Where its numbers come from:

- 9.18%: (1/4) × (1 − 0.8⁴)² ÷ (1 − 0.4⁴)² = 0.091782, the inverse square and the window at range 5 (the 2 m square
  reads 4.810 in linear radiance, ρE ÷ π with ρ = 1).
- 25.0%: the same at our automatic 35.68 m, 0.249926; the 6 m square then reads 0.111 of the 2 m square, lit.
- 4.6%: (1/4) × (1 − 0.8²)² ÷ (1 − 0.4²)² = 0.045918.
- 35.68 m: √(800 ÷ (4π × 0.05)), #1634's `autoRange(800, EV_TODAY)`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed
(`scripts/proof-change.mjs: criterionId`), recomputed from the live issue. Each test's name starts with `AC<n>
#2054.<id>`.

| Criterion | Text (abridged) | Tests |
|---|---|---|
| AC1 `#2054.46de3b6b` | Point light word, 800 lm: range word 8 → `light.point@1` range 8, unwritten → 5, within 1e-9; a spot gives the same on `light.spot@1`; a planted recipe that drops the word leaves our automatic 35.68 m and fails, naming the word | `range.test.ts` (2). The first: four instances in one revision, each one light of its kind whose `params.range` is 8 or 5 within 1e-9, read with #433's `oneOfKind` and `paramOf`. The second, under `range_word_dropped`: `point_r8` still expands to one `light.point@1`, with no range (automatic, 35.68 m at 800 lm), and the judge fails naming `omni_range` and `spot_range`. Catches: the base; the word dropped or unknown; the automatic range when unwritten; the engine's default taken as 1 m or as the old range |
| AC2 `#2054.e44715ba` | Three white squares at 2, 4 and 6 m under that light at range 5: 9.18% within 0.2 points, 0 at 6 m; a dropped range reads 25.0% and a lit third square, the window `(1 − (d ÷ range)²)²` 4.6%, each failing naming the square | `squares.test.ts` (3). The first: `sq_4m` ÷ `sq_2m` within 0.0918 ± 0.002 and `sq_6m` at most 1e-5. The second, under `range_word_dropped`: fails naming `sq_4m` and `sq_6m`, its share prints 25.0 and `sq_6m` reads over 1e-5. The third, under `deep-gpu --planted light_window_squared`: fails naming `sq_4m`, its share prints 4.6. Catches: the base; the range dropped; the window's power wrong; the inverse square lost |
| AC3 `#2054.b0129c45` | Exponent 2 = unwritten; 1 and 0.5 refused at `items/<id>/params/<word>` with a fix naming 2, nothing drawn; range 0 refused the same way; a planted recipe that draws 1 as the inverse square presents a light and fails, naming the word | `falloff.test.ts` (2). The first: the point and spot pairs (2 and unwritten) expand to one light each and to the same items; `omni_attenuation` 1 and 0.5 and `spot_attenuation` 1 each leave an issue at its path whose fix names 2, and `omni_range` 0 one at its path, none drawn, each in a revision of its own. The second, under `falloff_one_drawn`: `point_falloff_1`'s revision is presented with one `light.point@1`, the same as the unwritten word's, and the judge fails naming `omni_attenuation`. Catches: the base; an exponent dropped silently; a refusal with no fix or one that doesn't name 2; a refused light drawn; a range of 0 drawn |

Proof line ("the expanded items' `range` values, the three squares' readings, the refusals, and each planted recipe's
failure"): AC1's first test, AC2's first, AC3's first, and the planted tests.

## Readings where the issue and design leave a choice

- **"The tool's range word" and "falloff exponent word"** are the engine's own property names for its point and spot
  light classes at the pinned release: `omni_range` and `omni_attenuation` on the point light, `spot_range` and
  `spot_attenuation` on the spot. The spot's cone falloff word, `spot_angle_attenuation`, is out of scope and not
  written here.
- **"Read from the expanded item as `power` is read in `tests/acceptance/433/`"**: the derived item of the instance's
  `expansions` row in the `deep_show` reply, one of the kind, its `params.range`. A light whose `params.range` is no
  number names no range and so takes our automatic range.
- **"Each within 1e-9"** is absolute, in metres.
- **"That 800 lm point light with range 5"** (AC2) is the point light word with `omni_range` written as 5, expanded
  through the pack. The light is drawn exactly as it expanded; the test doesn't change it. Expansion (`deep-show`) and
  drawing (`deep-gpu`, whose view3d has the linear target) run as two binaries, so each planted program lives in one
  place: the recipe twins with the pack's install, the window in the renderer.
- **"Each face that light … in three directions"**: each square's face is square to the line from the lamp, along
  three horizontal directions 30° apart, and the view sits at the lamp, so each face is seen square on at its point
  nearest the lamp and its reading there is the distance's alone, whatever the diffuse model does with angles.
- **"Linear radiance of the square"** is the linear target at that point, the mean of R, G and B over 3 × 3 pixels
  (white light, white squares). **"Reads 0 from the light"** is at most 1e-5 in linear radiance (the 2 m square reads
  about 4.8; #1634 reads its dark ground to the same bound). With no other light in the document, all a square reads
  is from the lamp.
- **"Reads 25.0%" and "reads 4.6%"** are the planted readings printed to one decimal, as the criterion writes them.
  Under the dropped range the lamp takes our automatic range at the look's exposure, 35.68 m, the criterion's figure.
- **"Naming the square"** is the square's item ID, `sq_2m`, `sq_4m` or `sq_6m`, in the failure. **"Naming the word"**
  is the engine's word, `omni_range`, `spot_range`, `omni_attenuation` or `spot_attenuation`.
- **"Holds an issue … whose fix names 2"** (AC3): an entry of the reply's `issues` (not `notices`) at the path, its
  `fix` naming 2. **"No light is drawn for that item"**: a presented revision holds no derived item of the instance; a
  refused revision draws nothing. **"A range of 0 is refused the same way"**: an issue at
  `items/<id>/params/omni_range` and nothing drawn; its fix isn't read, since 2 is the exponent's.
- **"Expands to the same item"** (AC3): the instance's derived items, compared whole with the instance's own ID set
  aside, each pair expanding to one light of its kind.
- **"The reference Mac for the frame readings"** is a Mac `scripts/benchmark.mjs` lists, by model, chip and memory, as
  #1634's `offReferenceMac` reads it; a count of pixels isn't a timing, so its power, heat and load don't matter.

## Not tested, because no criterion asks

A negative range (the scope's "0 or less": 0 stands for it here); the spot light's range of 0 and its exponent of 0.5;
the alias's stated conversion text saying the engine's default of 1 isn't drawn (scope); the cone falloff word
staying refused; a light's source size; the general familiar pack's cut-off distance word; the lane against the real
library (#1494); `deep_kinds` answering the new words; a light written with only the engine's required words drawing
(it is AC1's unwritten cases, read as expanded items, not as pixels). The implementer owes these a mapping or a note
(AGENTS.md: review requirement → change → proof).
