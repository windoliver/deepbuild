# Acceptance tests for #417: canvas looks: the look asset, the first four looks, role tokens and bundled fonts

Written first, from issue #417 (its scope, its fields, its ten acceptance criteria and its proof line: "Headless
renders of one scene in every shipped look, the font licence list, and the fallback and derived-role fixtures"),
its parent #73, the design sections they link, and base commit `960045da` ("Merge pull request #1027 …"), by a
job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Films and figures on the canvas (546–590: "Four ship first: clean, chalk, dark math,
  and notebook: colored pencil on ruled or grid paper, with hatched fills and a line boil"; "Switching the look
  never changes the data, and it's the same look asset the canvas core uses"); Look (1305: "Status colors keep their
  distance from data colors wherever status can show"; "It can never: … use a system font that can't ship");
  Every task carries its own budgets and the reference Macs (2423–2425); Dogfooding and Tests written first.
- `docs/canvas-primitives.md`: The status-color rule (68: "The look declares the distance (`status.min_distance`,
  by default 0.10 in OKLab), and the check refuses a data palette that comes closer, naming the data role and the
  status color it clashes with … Any other document, such as an art film played or exported on its own, may use
  any palette"); The cost model and its class table (76–110); Document envelope (`look: {asset, theme}`, `controls`,
  `shots`); Text `text@1` (1382: `lang`, `fallback`, `text.glyph_missing {item, grapheme}`); Scale and encode
  (2197: `data_distance`); Look `look@1` (2410) and its indexed basis, paper, drawn fills and print finishes rows;
  Shot (4469: `look: name`, `join: glide`, "A shot's `look` defaults to the document's"); Follow (5331); Control
  (5474: toggle, stages, "A stage's shot … glides there … from the pose shown"); Tour (5744); Transition (5773);
  Input track (5706). The issue's `time.state` and `transition` follow model aren't in the design text at the base;
  the issue is their source.
- At the base: AGENTS.md; `tests/acceptance/381/`, `380/` (budgets, INCONCLUSIVE off the reference Mac), `398/`,
  `373/` (status bindings, the clean look, OKLab), `391/` (`deep-motion eval`, sessions and their caches), `854/`
  (perf-lane tasks in budgets.json); `crates/deep-canvas-marks/src/look.rs` and `looks/clean.json`;
  `crates/deep-marks-render` (`deep-canvas-render look | check | raster | session`); `crates/deep-text` (`fonts`,
  the five bundled faces and their two licence files); `crates/deep-canvas-motion` (`deep-motion eval`);
  `benchmarks/canvas.mjs`, `benchmarks/budgets.json`, `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`).

What the base already does and these tests don't credit: one shipped look, `clean`, with a palette, roles per
theme, a status map with a glyph per state, `min_distance` 0.10 and a guard that refuses a role within it of a
status color in any document; two bundled families (Inter and JetBrains Mono, OFL-1.1, a licence file each beside
them); `raster` reports each text's glyphs with their face file and grapheme. There is no other look, no list of
shipped looks, no font role in `roles`, no `math` role, no fallback list or `text.glyph_missing`, no derived role,
no `time` on a look, and motion has no follow, control, shot or look.

## Run them

They build cargo binaries, so they run one file at a time. `scripts/lanes.mjs` needs this folder in its `alone`
list (the one-at-a-time unit-lane line), as #381's README asks for its own; this README is the instruction, and
the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/417 --no-file-parallelism
npx tsc -p tests/acceptance/417/tsconfig.json   # type-check: the root's strict options, noEmit
```

Each file first runs `cargo build --locked --bin <name>` for the binaries it drives (`deep-canvas-render`,
`deep-text`, `deep-motion`) and fails each of its tests when a build fails. `budgets.test.ts` also runs
`node benchmarks/canvas.mjs look-switch | look-frames` (which build what they time with `--release`) and
`git merge-base HEAD origin/main`. PNGs go to temporary folders that are deleted. A run with `--root
tests/acceptance/417` leaves Vitest's cache in `tests/acceptance/417/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

`raster`, `check`, `look`, `deep-text fonts` and `deep-motion eval` run on every platform. `session` (AC2) draws
through GPUI's offscreen Metal renderer: off macOS its tests fail with a message that starts `INCONCLUSIVE:`.
AC5's judged tests skip as `INCONCLUSIVE` off a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal
state nominal, as `judgeLimit` decides) and never pass by skipping; their report checks run on any Mac.

## The shipped looks

The issue names the first four looks "clean, notebook pencil, chalk and dark math". These tests give them the
IDs `clean`, `notebook_pencil`, `chalk` and `dark_math` (`FIRST_LOOKS` in helpers.ts). Every shipped look must
have its fixture `fixtures/looks/<id>.json` (`{"look": id, "scene": "scene.json", "film": "film.json", "themes":
["light", "dark"]}`), and every fixture's look must be shipped: a look added later comes with its fixture, as the
scope says ("more come later, each proven by a fixture").

## The surface under test

The issue names a look asset, its fields, text@1's `fallback` and `lang`, `text.glyph_missing`, derived roles and
`time.state`, but no code API. These tests extend three binaries that exist and two bench files, and add no
binary. JSON lines as #381 gives them: one JSON object per stdin line, exactly one out per line, in order, exit
0; a line that can't be read or names an unknown `planted` value answers `{"ok": false, "code": "bad_input"}`.

| Surface (crate at the base) | What these tests add | Criteria |
|---|---|---|
| `deep-canvas-render look` (`crates/deep-marks-render`) | `{"list": "shipped"}`; the four looks by ID; `roles` with font roles; `oklab` | AC1, AC3, AC4, AC7, AC8 |
| `deep-canvas-render check`, `raster` | looks by ID or look@1 with font roles, `fallback`, derived roles, `time`; the status distance only where status can show; `text.glyph_missing`; glyph `lang`; `planted: "status_distance_0_03"` | AC1, AC3, AC6, AC9 |
| `deep-canvas-render session` | a step's `look`; a step's `built` and `rebuild_key`; `planted: "look_switch_rebuilds"` | AC2 |
| `deep-text fonts` (`crates/deep-text`) | `faces`: every bundled face with its licence and licence file | AC4, AC8 |
| `deep-motion eval` (`crates/deep-canvas-motion`) | `look`, `track`, `planted: "state_ease_linear"`; documents with controls, shots, a follow channel; frames' `cameras`; the answer's `hash` | AC10 |
| `benchmarks/canvas.mjs`, `benchmarks/budgets.json` | modes `look-switch` and `look-frames`; tasks `canvas-look-switch` and `canvas-look-frames` | AC5 |

### `deep-canvas-render look`

- `{"list": "shipped"}` answers `{"ok": true, "shipped": [id]}`: every shipped look's ID, once each.
- `{"look": id | look@1}` answers, as at the base, `{"ok": true, "look": definition, "roles": {"light": {role →
  value}, "dark": {…}}}`, where a color role's value is `#rrggbb` (or `#rrggbbaa` at an alpha) and a font role's
  (`roles: {role → palette name | font}`) is the name of one of the look's `fonts` entries. `math` is a font role in
  every shipped look; a text whose `font` is a role (`body`, `mono`, `math`) is set in the face that role names, or,
  where the look's `roles` don't name it, in its `fonts` entry of that name.
- New: `"oklab": {"light": {role → [L, a, b]}, "dark": {…}}`, every color role in OKLab as the check resolved it,
  in f64, before 8-bit encoding: derived roles (`{mix: [role, role, 0..1]} | {lighter: role, by} | {darker: role,
  by} | {invert: role}`) are resolved in OKLab and reported here.
- The definition carries `fonts: {name → {family, file, license, embed, single_line}}` (`file` a bundled face's
  file name), `fallback: [font name]` and `time: {state: {span, interp}, …}`.

### `check` and `raster`

As at the base (`{"doc", "look", "view"?, "states"?, "out"}` for raster), with:

- The status distance applies where status can show (a document with a status binding): a data role nearer a
  status color than `min_distance` (the look@1 field the clean look holds at the base, 0.10 by default) is refused
  as `status_distance`, naming the role and the state, either as the answer `{"ok": false, "code":
  "status_distance", "role", "state"}` (the guard's form at the base) or as an error issue whose `actual` holds
  `role` and `state`. A document with no status binding (an art film played on its own) takes the look's palette
  as given: the role is drawn exactly.
- `planted: "status_distance_0_03"` (check and raster): the criterion's wrong check, comparing against 0.03 in
  place of the look's distance. Reachable only through this field.
- text@1 takes `lang` (BCP 47) and the look's `fallback` list: a grapheme the run's face lacks is set in the first
  face of the list that has it. `raster`'s glyph rows (#381's `texts`) gain `lang`, the language the glyph's run was
  shaped with (`null` with none). A grapheme no face can draw is refused at check as an error issue `{"code":
  "text.glyph_missing", "ids": [item], "actual": {"item": item, "grapheme": string}}`, one per missing grapheme;
  `raster` answers `{"ok": false, "code": "text.glyph_missing", …}`.

### `session`

As at the base (#391: `{"look", "steps": [{"doc"?, "t", "view"?, "frames"?}]}`), with:

- A step may carry `look` (an ID or a look@1): from that step on the session is shown in that look; the document
  is unchanged.
- Each step's answer gains `built: {"tessellation": [{item, bucket, key}], "text": [{item, key}]}`, the cache
  entries the step made rather than reused, in the form `caches` reports them, and `rebuild_key`: the scene's
  rebuild key (hex), a function of the scene and the look it is shown in.
- `planted: "look_switch_rebuilds"` (on the line): a look switch that empties every node cache.

### `deep-text fonts`

The answer keeps `fonts` and gains `"faces": [{"file", "family", "license", "license_file"}]`, one per font file in
`crates/deep-text/fonts` (`.ttf`, `.otf`, `.ttc`, `.otc`), each path relative to the checkout; `license` an SPDX
ID; `license_file` the licence's text, in the same folder.

### Licences

A licence allows embedding when it is one of OFL-1.1, Apache-2.0, MIT, BSD-3-Clause, CC0-1.0, Ubuntu-font-1.0 or
Bitstream-Vera, never GPL (AGENTS.md), and its file holds that licence's own words (helpers.ts,
`EMBEDDABLE_LICENSES`). The face's own OS/2 `fsType` must not set bit 1 (restricted licence embedding) or bit 9
(bitmap embedding only), in every face of a collection. A math face is one with an OpenType `MATH` table.

### `deep-motion eval`

As at the base (#391: `{"doc", "times"}` → `{"ok": true, "frames": [Frame]}`), with:

- `look`: the look the document is shown in, an ID or a look@1; every shot that names no `look` of its own takes it.
  The look's `time.state: {span: time = "0.25s", interp = {"ease": {"name": "in_out_cubic"}}}` is the time feel for
  a change of state.
- `track`: the input track, `[{t: flick, seq, control, value, writer}]`; a frame reads the entries at or before it.
- Documents may hold `controls` (`toggle`, `stages` with `stages: {id → {label, shot}}`, class document, a
  `default`), `shots` (`{camera, move: "hold", target: [x, y, z], join?: {glide: {span}}, ease?}`), a `camera@1`
  item, and a channel with `follow` in place of `keys`: `{"source": {"control": id, "values": {option → number}},
  "model": {"transition": {span?, interp?}}}`. A transition follow eases from its value at a source entry to the
  entry's value over its `span` by its `interp`, each taken from the look's `time.state` when it names none. A
  stage's shot starts at the stage's entry and, with `join: glide`, glides the camera from the pose shown over the
  glide's span by the shot's `ease`, else the look's state ease.
- Each frame gains `cameras: {id → {"target": [x, y, z], …}}`, the pose each camera draws at t; the answer gains
  `hash`, the document's revision hash (`deep_canvas::canon::revision_hash`), which no request field enters.
- `planted: "state_ease_linear"`: a reader that takes `time.state`'s ease as linear.

### AC5's reports: `benchmarks/canvas.mjs look-switch | look-frames`

budgets.json gains two tasks, each with `margin: 0.5` (the perf lane's, against the merge base), `limits` the
lane's validator accepts, an `initialReason` naming #417, and `targets`, the issue's numbers:

| id | command | targets |
|---|---|---|
| `canvas-look-switch` | `["node", "benchmarks/canvas.mjs", "look-switch"]` | `{"switch_ms": 100}` |
| `canvas-look-frames` | `["node", "benchmarks/canvas.mjs", "look-frames"]` | `{"frame_gpu_p95_ms": 2, "frame_cpu_p95_ms": 4}` (fixtures/film.json is a `figure`) |

Each mode builds what it times with `--release`, runs one warm-up run and then five, exits 0 whether or not a
target holds, and prints one report as its last stdout line: `{"task", "fingerprint": {…scripts/benchmark.mjs
fingerprint()…, "build": {"profile": "release", …}}, "runs": [Run × 5], …}`.

- `look-switch`: `"fixture": "tests/acceptance/417/fixtures/film.json"`; `Run = {"samples": [{"from", "to", "ms",
  "ground"}]}`, at least one sample per ordered pair of distinct shipped looks. The film plays in a window in the
  light theme; `ms` runs from the switch's request to the settled frame drawn in `to`, and `ground` (`#rrggbb`) is
  pixel (4, 4) of the frame on screen when the clock stops, read back from the window. `--planted
  stops_at_request` stops the clock at the request.
- `look-frames`: `Run = {"looks": {id: {"fixture": "tests/acceptance/417/fixtures/looks/<id>.json", "frames":
  [{"gpu_ms", "cpu_ms"}]}}}`, every shipped look, each playing its fixture film for at least 300 frames, each
  frame's GPU and CPU time.

## The fixtures

- `scene.json`: the one scene for every look: a filled region, a stroked curve, a bar and a dot in `accent`, a
  title in `body`, a θ in `math` (a lone symbol), and code in `mono`. The bar's centre (380, 180) is all bar.
- `film.json`: the scene as a 5 s figure whose dot moves every frame; `looks/<id>.json` name it as each look's
  fixture film.
- `caption.json`: the caption `Area 面积 مساحة 🙂` in `body` with `lang: zh-Hans`.
- `derived.json`: AC7's palette colors (`#5b9bd5` blue, `#f2c230` yellow), roles and recorded OKLab values.
  `lighter` isn't defined numerically in the design ("made lighter or darker … resolved at check in OKLab"); these
  tests take the reading that changes lightness only: `{lighter: r, by}` is `L' = L + by × (1 − L)` with `a` and
  `b` kept (and `darker` would be `L' = L × (1 − by)`). For blue, OKLab `[0.6708386928085134, −0.0416873530753167,
  −0.1006338116150344]`, lighter by 0.2 is **`[0.7366709542468107, −0.0416873530753167, −0.1006338116150344]`**,
  inside sRGB's gamut, so no gamut mapping moves it. Computed in f64 with Ottosson's published M1/M2 matrices and
  the sRGB transfer function (helpers.ts), and recomputed by `derived.test.ts`. The midpoint of blue and yellow is
  `[0.7524011875940269, −0.0194094752345281, 0.0288869517012390]`. A mix of the sRGB codes misses it by 0.032 and a
  lighter that mixes toward white misses the recorded value by 0.022, so either wrong program fails.
- `knob.json`: AC10's document: the toggle `power`, the knob whose x follows it (17 off, 47 on) by a transition
  follow naming no span or interp, the stages control `steps` and the shots `shot-a` (target [0, 0, 0]) and
  `shot-b` (target [200, 100, 0], `join: {glide: {span: "0.8s"}}`, no ease), the camera `cam`.

The planted accents of AC3 and AC9 aren't written in: they're searched at run time from the clean look's own fail
color, the 8-bit color nearest 0.02, 0.095 and 0.105 OKLab from it (each within 0.0005), with every other status
color kept at least 0.06 (AC3) or 0.12 (AC9) away. With the base's clean look they are `#bb263c` (0.0200),
`#ee173b` (0.0950) and `#eb402d` (0.1050).

## Criteria → tests

| Criterion | Test (file: name) | What fails it |
|---|---|---|
| AC1 the same scene in every shipped look, no change to its description, a fixture per look | `looks.test.ts`: "the four first looks ship, and every shipped look has its fixture…"; "each shipped look draws the one scene, light and dark…" | a first look missing; a shipped look without a fixture; a look the scene can't be drawn or checked in; a frame whose median isn't the look's ground (within 0.05 ΔEOK); the title or θ not set in the look's `body` / `math` face, or .notdef; two looks drawing the same picture (fewer than 100 pixels apart); the document changed |
| AC2 switching looks redraws only the look's passes | `switch.test.ts`: "through every shipped look and back to clean…"; "the check sees a rebuild…" | a node in `built` whose content key the previous step held; no node kept across a switch; `rebuild_key` unchanged by a switch, or not the opening one back in clean; `planted: look_switch_rebuilds` must fail it |
| AC3 data roles keep the status distance; 0.02 from fail refused where status can show, naming role and color; an art film on its own keeps the palette | `looks.test.ts`: "every shipped look, in both themes, keeps each data role…"; "where status can show, the clean look with its accent 0.02 OKLab from fail…" | a data role (each role but `ground`, alpha roles over the ground) within `min_distance` of a status color; the status-showing scene accepted, or refused without naming `accent` and `fail`; the scene on its own refused, or its bar not drawn in the planted color exactly, light and dark |
| AC4 every bundled font's licence allows embedding, recorded beside it | `fonts.test.ts`: "deep-text fonts lists every font file bundled…"; "every bundled font file's own embedding bits…"; "every font a shipped look names…"; the oracle's own wrong inputs | a font file `faces` doesn't list; a licence not in the list, GPL, its file elsewhere or not its text; a restricted or bitmap-only fsType; a look's font not a bundled face, not `embed: true` or recording another licence |
| AC5 budgets vs the merge base: switch < 100 ms, every look within the frame budget on its fixture film | `budgets.test.ts`: the budgets.json entries; the switch report; the planted clock; "switching looks takes under 100 ms…"; the frames report; "every look stays within the figure class's frame budget…" | an entry missing, off the issue's numbers or the lane's margin, or refused by `validateBudgets` against the merge base's; a switch pair untimed or stopping on the old look's ground (`--planted stops_at_request` must); fewer than 300 frames, an undrawn frame or another fixture; a judged FAIL. INCONCLUSIVE off a reference Mac |
| AC6 the caption draws each grapheme from a face that has it, Han as zh-Hans; without the CJK face, `text.glyph_missing` naming 面 and the item | `fallback.test.ts`: three tests | a grapheme with no glyph, .notdef, or from a face whose cmap lacks it; Han not shaped as zh-Hans; fewer than three faces; without the CJK face: accepted, no `text.glyph_missing` naming `caption` and 面, a non-Han grapheme named, or raster not refused |
| AC7 mix to the OKLab midpoint and lighter to its recorded value within 0.001 | `derived.test.ts`: three tests | `oklab` missing; green farther than 0.001 from the midpoint or the recorded value; sky farther than 0.001 from the recorded value; the wrong programs (sRGB mix, mix toward white) are shown to miss by more than 0.001 |
| AC8 every shipped look's `math` role names a bundled math face whose licence allows embedding, recorded beside it | `fonts.test.ts`: "each shipped look's math role…"; "the math-face oracle tells a text face from a math face" | no math font role in a theme; its face not bundled, without a MATH table, not embeddable, its licence not allowed or not beside it, or the look recording another licence |
| AC9 0.095 refused, 0.105 accepted under 0.10; a planted 0.03 check accepts the first and fails | `distance.test.ts`: three tests | the planted colors not at 0.095 / 0.105 (±0.0005); 0.095 accepted, or refused without naming accent and fail, by check or raster; 0.105 refused; `planted: status_distance_0_03` must accept 0.095 and fail the same criterion |
| AC10 time.state drives the follow and the glide; out_cubic reads 43.25 with the same hash; a linear reader fails naming the look | `state.test.ts`: three tests | the knob (item and channel) off 17 / 18.875 / 32 / 47 under in_out_cubic, or 17 + 30 × 37/64 / 43.25 under out_cubic, by more than 1e-4; the camera not half way at half the glide's span, or not at b's target at its end; the hash changing with the look, or not changing with an edit; `planted: state_ease_linear` must read 32 and fail with every failure naming the look `brisk` |

## Deviations and open points

- The look IDs and every field name above that the design doesn't spell out (`list`, `oklab`, `built`,
  `rebuild_key`, `faces`, glyph `lang`, `track`, `cameras`, `hash`, the `transition` follow model's JSON, the
  planted names, the bench modes and tasks) are this job's minimal proposal; an implementer who needs another
  shape asks for a blind redraft rather than editing a test.
- `lighter`'s formula is this job's reading (above), recorded with the fixture.
- The status distance field is the look's top-level `min_distance`, where the base's clean look holds it; the design
  calls it `status.min_distance`.
- AC2 observes rebuilds through the session's caches; it can't see a GPU pass, so "redraws only the look's passes"
  is held as "no node rebuilt unless its content key changed, and the scene's rebuild key changes with the look".
- AC5's merge-base comparison is the perf lane's own, through the two budgets.json entries; the merge base has no
  look switch, so these are first measurements.
