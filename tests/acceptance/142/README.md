# Acceptance tests for #142: film recipes, explainer grammars that turn a cue list into shots

Written first, blind, from issue #142 (its Scope, its Fields, its 12 acceptance criteria and its Proof line: "The nine
examples rendered in 2D and 3D beside their cue lists, and the refusal fixtures"; no comments), the design sections it
links and those they lean on, its Oracle page, and base commit `64c9be338` ("Merge #223's branch (PR #2505, group
warps) as #142's base"), by a job that never saw an implementation; none existed, and no other worktree, branch, PR,
stash or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one file per criterion, plus the plants the criteria name: the
refusal fixtures with a breaking cue list per grammar rule (criterion 3), the planted recipe that reads each cue's
start as an absolute time (criterion 9), the test pack acme/acme with its rule, planted twin and clean twin (criterion
10), and the boundary pairs (criterion 11).

## What was read

- Issue #142, live. Its criteria are quoted, exactly as their `- [ ]` lines, at the top of each test file.
- Its Oracle page (`doneright/oracles/issues/142.md`): one criterion (4) cites upstream files only as the formula's
  source, with no test our code can run, so there is no `142-oracle/` folder. The formula is taken from the page:
  1 − e^(−10t)·cos(2π·2.2t), a slam from 1.7 to 1 along it, sub-lines rising over 0.35 s.
- `docs/canvas-primitives.md`: Pack: explain@1 film recipes; Recipe (the step ops shot, marker, cue, strip and
  transition; the inputs text, asset and records; `repeat: {over, as}`); Pack; Pack: kinds in any pack; Pack: kind
  rules and the kind kit; Pack: dependencies; Transition (align: reveal, a push's 90%); Transition: operator, iris and
  dip; Tempo map and cue alignment; Cue list `cues@1`; Frame and group: warp; Marker; Shot; Placement; Camera
  `camera@1`; Document envelope; Item and kind; Text animator and counter; Bound value; Driver; The closed function
  list; Time and the flick.
- `docs/technical-design.md`: Films and figures on the canvas (motion grammars, timeline and camera shots, canvas
  done); Dogfooding.
- At the base, for surfaces only: `crates/deep-show` (`main.rs`'s calls `deep show`, `eval` with `paths`, `texts`,
  `film`, `pixels` and `size`, `path` with `t`, `registries`, `registry`, `install_pack`, `packs`; `packs.rs`'s
  `expansions` and `timing`; `frames.rs`; `film.rs`'s film block; `function.rs` and `warps.rs`),
  `crates/deep-canvas/src/document/packs.rs` and `pack_kinds.rs` (recipes, input types, step ops and repeats, kinds,
  rules, twins, the kit, the `kind_rule` issue), `crates/deep-canvas-motion/src/cues.rs`, `cues/kit.rs`,
  `shots.rs` and `shots/kinds.rs` (transitions, `align`, the reveal offset), `tempo.rs`, `crates/deep-canvas-marks/
  src/warp.rs` and `looks/`, `crates/deep-gpu-layer/src/budget.rs` (#1899's `frame_budget`), `packs/verbs-1.0.0/`;
  the merged suites `222/`, `222-redraft-ac7/`, `223/`, `466/`, `202/`, `306/`, `1969/`, `417/`, `493/`, `239/`,
  `1899/`; `scripts/proof-change.mjs` (criterion IDs), `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`). Code was
  read to learn the surface; every expected value comes from the issue and the design.

## Run them

```sh
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"   # cargo, where it isn't on PATH
npm ci                                             # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/142 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/142/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/142/node_modules/.vite
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features
--features full`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the
binary out, and fails every test whose build failed. `ac6-budgets.test.ts` also builds `deep-show` in release and
`deep-gpu` (`cargo build --locked --bin deep-gpu`, as #239's suite does), only on a machine that can judge a timing.
Every `it` passes a long timeout (60 min; more where it renders every example or times). Temporary folders are deleted;
`ac12-taste.test.ts` keeps its pictures (The taste call). Node built-ins and vitest only, plus `scripts/benchmark.mjs`'s
`judgeLimit` and `fingerprint`, imported. A test that can't decide here fails with a message starting `INCONCLUSIVE:`
(or `BLOCKED:` for a check the binary answers BLOCKED), never passing.

The files build cargo binaries, render every example and time them, so they run one at a time. The implementer adds to
`scripts/lanes.mjs` (this job writes only this folder):

```js
alone.push('tests/acceptance/142/');
timed.push('tests/acceptance/142/ac6-budgets.test.ts');
```

## The surface under test

`deep-show run` as #393, #222, #223 and #306 left it: one scenario line in, one answer line out; the scenario's
`packs: [{id, dir}]` and `planted`; `deep show` of a whole document from your shell with `include`; `eval {doc, t,
paths, texts, film, pixels, size}`; `path {doc, item, t}`; `registries`; `registry`; `install_pack`; `packs`; and
`deep-gpu run`'s `frame_budget` (#1899). **Every name below that neither the issue nor the design gives is this job's
choice, marked *(chosen)***; the implementer builds exactly these, or a dispute goes to a blind redraft.

### The pack

- explain@1 is a first-party pack in `packs/explain-1.0.0/` *(chosen folder, as `packs/verbs-1.0.0/`)*, ID
  `deepbuild/explain`, version 1.0.0; documents name `deepbuild/explain@1.0.0`, and each scenario offers it with the
  first-party verbs: `packs: [{id: "deepbuild/explain", dir: <checkout>/packs/explain-1.0.0}, {id: "deepbuild/verbs",
  dir: <checkout>/packs/verbs-1.0.0}]`.
- Its manifest `pack.json` (#306's and #202's format) lists the ten recipes in `recipes` and declares each as a pack
  kind in `kinds`, `explain.<recipe>@1` (`explain.dark_math@1` … `explain.linear_map@1`) backed by its recipe, with its
  grammar's rules in `rules` and their planted twins in `twins: [{example: sha256, expect: code}]`, each twin an asset
  of the pack (`assets: [{path, sha256, size, license}]`): a document naming the pack, presented as it is.
- The pack's verbs are `cue.kind@1` entries (#222's `entries` form) named `explain.<verb>`. This suite plays two:
  **`explain.slam`** *(chosen name)*, class `enter`, the kinetic-type slam (criterion 4), and **`explain.apply`**, the
  linear map's `apply {matrix}`, its matrix by rows, `params: {matrix: [[a, b], [c, d]]}`. The linear map's other verbs
  take the issue's names the same way (`explain.inverse`, `explain.transpose`, `explain.warp`, `explain.add_vector`,
  `explain.write_coordinates`, `explain.to_coordinates`, `explain.label`); no test plays them.

### The recipes' inputs

- Every recipe takes `cues` (records: a `cues@1` list whose cues also carry `text`, `sub` and `data`), `stage`
  (`"2d" | "3d"`), `look` and `palette`. **`look` is a shipped look's ID** *(chosen: #417's, kept at
  `crates/deep-canvas-marks/looks/<id>.json`)*, which the frame budget draws under. **Every input but `cues` has a
  default** *(chosen)*, but for linear_map's `plane.x` and `plane.y`, so a fixture sets only `cues`, `stage` and the
  linear map's own inputs; ranges are `[min, max]` and records are JSON lists of objects, as the base reads them.
- `explain.linear_map` takes the issue's fields as written: `plane: {x, y, background, coordinates}`, `basis`,
  `vectors: [{id, coords: [x, y], role, label}]`, `square`, `ghosts`, `cues`.

### Cues in a film recipe

- A cue's kind is any `cue.kind@1` entry (one namespace: a first-party verb such as `fade_in`, `fade_out` or `rotate`
  plays in a film recipe's list as `explain.slam` does). Times follow `cues@1` (`when: "after" | "with" | {at: time}`,
  `span`, `gap`); a time is the grammar's text or whole flicks.
- **A cue's `targets` may name an earlier cue's `id`** *(chosen)*: the items that cue's `text` and `sub` made.
- **`data: {size: u, sub_size: u}`** on a kinetic-type cue *(chosen)* sets its main word's and its sub-line's text size.
- **An entrance** is a cue whose kind's entry has class `enter`, **an exit** class `exit` (#222's classes, read from
  the entry's `value.class` in `registries`); a cue with only a span is a wait. **A cue's landing** is the moment its
  entrance ends, its `cues.<id>` marker's `t + span`.
- **A section** *(chosen reading)* runs from the list's start, or from a cue that starts a new section (the recipe's
  own section break, such as a transition between shots), to the next such cue or the list's end; a list with none is
  one section.
- **The beat grid** is the document's `tempo_map` (#491's root field: `{segments: [{at, bpm, meter: [n, d], span,
  ramp}]}`); the fixtures carry 120 BPM in 4/4 from 0 s, a beat every 0.5 s.

### Derived items

- **Each cue's `text` is drawn by exactly one derived item whose `params.text` is that text, and its `sub` by one
  whose `params.text` is the sub** *(chosen)*, on both stages, so the examples' cue words are distinct.
- **The slam moves its word's own scale, `at.scale`, x and y**, from 1.7 times the scale the item is written with (its
  derived `at.scale`, 1 when unset) to 1 times it; **the sub-line rises by its own `at.pos`**, ending higher on the frame
  (a smaller y in 2D's y-down u) *(chosen)*.
- **explain.linear_map's derived items** *(chosen IDs, `<instance>.<name>`)*: `<i>.moving`, the `group@1` whose
  `params.warp` is the moving plane's warp (Frame and group: warp; `linear {matrix}` mixing (1 − u)I + uM), carrying no
  `at`, so its space is the document's u and its warp's `plane` (origin, unit, y; the design's defaults when unset)
  maps the plane's coordinates to u; `<i>.grid`, the moving plane's grid; `<i>.i_hat` and `<i>.j_hat`, the basis arrows,
  each drawn from the plane's origin to its tip; `<i>.area`, the area readout, a text whose shown string holds |det M|
  with two decimals. Ghosts need no ID: each is a derived item whose own `adjust.opacity` reads 0.3, drawing an arrow
  from the origin to an old tip. The still grey plane, the labels and the square aren't read.
- **`path {doc, item, t}`** (#223's call) answers a derived item's outline as the frame draws it at t, in document u
  (its ancestors' warps applied); an arrow's tip is its drawn point farthest from the plane's origin.

### The expansion, on the `deep show` reply's `expansions`

- A film recipe's instance has its row (`instance`, `kind: "explain.<recipe>@1"`, `derived`, as #306's), and so does
  every instance it derives (`<instance>.…`, such as a `cues@1` list it writes); the tests read them together.
- **Rows list the sections a film recipe writes** *(chosen, as #222's module rows list theirs)*: `markers`, holding
  each cue's `cues.<id>` marker `{t, span}`; `shots` (`{start, end, camera, …}`) and `transitions` (`{from, to, kind,
  span, align, …}`), keyed by ID as the document's maps hold them, **every time resolved**, in whole flicks or
  `"<decimal>s"`.
- With `include: ["timing"]`, **`timing.expand_ms.<instance>`** *(chosen, beside #222's per cue list)*: the wall time
  of the recipe instance's whole expansion at check, its cue list's lowering included.

### Rule codes and refusals

- The six grammar rules' codes *(chosen)*: `explain.one_entrance`, `explain.main_word_size`, `explain.on_beat`,
  `explain.still_once_landed`, `explain.exit_faster`, `explain.section_length`. Every recipe carries at least one;
  `explain.kinetic_type@1` carries all six.
- **A refusal**: `deep show` doesn't present the document, and an issue of severity `error` names the cue (its `id`)
  and the rule (its code) somewhere in its JSON (as #222's refusals are read); a cue that breaks nothing isn't named in
  it. The one-entrance rule names the later of two overlapping entrances; the section rule names **the first cue of
  the section that ends past 8 s from the section's start** *(chosen)*; the others name the breaking cue. A 3D stage
  given to linear_map is refused with an error naming `explain.linear_map`.

### A rule over a cue list *(chosen)*

Pack kind rules (#202's `{code, expr, at, fix}`) gain **`over: "<input>"`**, naming a `cues@1` input of the kind's
recipe. Such a rule is evaluated, at rest, for **each pair of cues** of that list, `cue` and `other`, `other` before
`cue` in the list's order, after `cues@1` resolves the list's times (no pair for a one-cue list). Its expression reads
`cue.start` and `cue.end` (seconds from the list's start), `cue.class` (the cue's kind's class as text, `wait` for a
wait) and the same of `other`; a pair for which it is false raises the rule's code as an error naming `cue`'s `id`, and
the document is refused. The test pack's rule is written in it; the explain pack may write its own rules any way the
kind rules allow.

### The test pack *(chosen)*

`acme/acme@1.0.0`, written by `writeSlides` (helpers.ts) into a temporary folder and installed with `install_pack {id:
"acme/acme", dir}`, the verbs offered in the scenario. `pack.json`: `requires: {core, modules: {motion, marks2d},
packs: ["deepbuild/verbs@1.0.0"]}`; `recipes: {"acme.slides@1": "acme.slides@1.json"}`; `kinds: {"acme.slides@1":
{minor: 0, recipe, children: [], capabilities, rules: [{code: "acme.one_entrance", over: "cues", at: "rest", expr:
"!(cue.class == enter && other.class == enter && other.start < cue.end && cue.start < other.end)", fix}], twins:
[{example: <overlap.json's sha256>, expect: "acme.one_entrance"}], migrate: {}, examples: [<clean.json's sha256>],
cost: {class: "figure", at_defaults: {cpu_ms: 0.5, gpu_ms: 0.2, items: 8}}}}`; `assets`: the two examples. The recipe
`acme.slides@1.json` takes `cues` (records, default `[]`) and `stage` (choice, `2d`) and has one step, `title: {op:
"mark", kind: "text@1", repeat: {over: "cues", as: "c"}, params: {text: "c.text", font: "body", size: 48}, at}`: a
title per cue (the design's `repeat: {over, as}` and `a.name` into a records input). The clean example: slide_one
then slide_two, each `fade_in` over 0.5 s; the twin: slide_two `with` slide_one.

### The planted program *(chosen)*

Scenario `planted: "film_cue_starts_absolute"`: every film recipe starts each cue at an absolute time read from its
place in the list, k seconds for the k-th cue (from 0), an `at` cue at its time, whatever the spans and gaps written
before it; all else as shipped. Reachable only through the scenario's `planted`.

### The frame budget *(chosen)*

`deep-gpu run`'s `frame_budget` (#1899: `{call, look, writer, doc, render: {seconds, pixels}, fps}`) gains **`packs:
[{id, dir}]`**, the scenario's form, so a document naming a pack is checked, expanded and drawn as `deep-show` does.
`look` is the shipped look the example's recipe names in `params.look` (`clean` when it names none); `writer` is
`agent:alpha`; `render` is the example's span and size; `fps` its rate.

### The examples *(chosen location and form)*

`packs/explain-1.0.0/examples/<recipe>.json`, one per recipe, each a film document as your shell sends it (no `id`,
no `layers`) holding **exactly one item**, an instance of `explain.<recipe>@1` whose params set `stage: "2d"` (the tests
change only that to `"3d"`), with envelope fields only: `format`, `profile`, `title`, `description`, `size`, `safe`,
`aspect`, `transport`, `look`, `camera`, `locale`, `requires`, `packs` (naming `deepbuild/explain@1.0.0`),
`tempo_map`, `seed`, `assets`. No channels, shots, markers, transitions, drivers or other map: everything the film
shows comes from its cue list through the recipe. Its `params.cues` is under 1,200 bytes as compact JSON, its cue IDs
and its words distinct, and it has at least one entrance with a word. The kinetic-type example holds at least one
`explain.slam` cue, one cue with a `sub`, a tempo map and one transition that isn't a cut.

## Fixtures

Generated in `helpers.ts` and the test files; no file on disk. Explain films are 640 × 360 u with the tempo map
`{segments: [{at: "0s", bpm: 120, meter: [4, 4], span: 64}]}`, one instance `film` on the 2D stage, every landing on
a beat but where a fixture breaks that.

| Fixture | What it is | Used by |
|---|---|---|
| the six breaking lists | explain.kinetic_type: cue_opening `fade_in` MAKE 0–0.5 s, then: cue_crowd `with` it (one entrance); cue_small TINY at 80 u over a 40 u sub-line (main word); cue_offbeat over 0.3 s, landing at 0.8 s (beat); cue_turn, `rotate {angle: 15}` on cue_opening's word (still); cue_leave, `fade_out` on it over 1 s (exit); cue_hold, a 9.5 s wait (section, 10 s); all but the last end with cue_coda, which breaks nothing | AC3 |
| the clean twin | cue_opening MAKE with the sub "it move" at 124 u over 40 u, cue_leave over 0.25 s, cue_coda over 0.75 s, landing at 1.5 s | AC3 |
| the boundary pairs | cue_small at 116 u (2.9×) and 124 u (3.1×) over 40 u; cue_hold waiting 7.5 s + 1 flick and 7.5 s after a 0.5 s entrance (a section of 8 s + 1 flick and 8 s); cue_leave as long as its entrance, 0.5 s | AC11 |
| the reveal films | 2D, 320 × 180 u, 60 fps: shots `shot_out` [0, 2 s) on a field of ink and `shot_in` [2 s, 4 s) on a field of accent; one `push`, `wipe` or `zoom_through`, span 1 s, `align: "reveal"`, `progress: "in_cubic"` | AC5 |
| the shear | explain.linear_map, plane x −4…4, y −3…3, basis and square: `shear` apply [[1, 1], [0, 1]] 0–1 s, `stretch` apply [[2, 0], [0, 1]] 1–2 s | AC7, AC12 |
| the singular map | the same plane with ghosts and the vector v at (1, 1): `squash` apply [[1, 2], [2, 4]] 0–1 s; and on the 3D stage | AC8 |
| the dark-math lists | explain.dark_math: cue_one ONE, cue_two TWO (0.5 s each), cue_three a 0.5 s wait, cue_four FOUR, cue_five FIVE, cue_six SIX `at` 5 s; its twin with cue_three 1.5 s | AC9 |
| acme/acme@1.0.0 | The test pack | AC10 |

## Criteria to tests

IDs are `#142.` and the first 8 hex digits of SHA-256 of each criterion's text (`scripts/proof-change.mjs`). Each
test's name starts with `AC<n> <ID>`; each file's header states its fixtures, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts | The wrong programs it fails on |
|---|---|---|---|
| AC1 `#142.44730151` | `ac1-render.test.ts` (2) | the ten examples: one instance each, envelope only, cue list < 1.2 KB; no Rust source outside tests names a recipe, no code in the pack; each presents on the 2D stage and (but linear_map) the 3D stage, its row derives items, cameras fov 0 in 2D and > 0 in 3D, six frames each showing something and not all one picture | the base; hand-written shots or channels; a recipe that ignores `stage`; one that draws nothing; recipe code in a canvas module |
| AC2 `#142.77ca866d` | `ac2-stages.test.ts` (1) | nine examples, 2D against 3D: every `cues.<id>` marker equal to the flick; the derived words equal; each landing's word settles within one frame of its 2D landing and by one frame past its cue's end | a 3D stage that re-times, rewrites or delays |
| AC3 `#142.083a5161` | `ac3-rules.test.ts` (2) | six breaking lists refused, each error naming its cue and rule and not cue_coda; the clean twin presented; every rule of the ten kinds has a twin, the six codes among them, all six on kinetic_type; the pack installed; each twin refused naming its code | the base; a refusal naming no cue or every cue; a check refusing the clean twin; a rule with no twin |
| AC4 `#142.648b2324` | `ac4-kinetic.test.ts` (1) | each `explain.slam` word's scale within 0.5% of 1.7 − 0.7·(1 − e^(−10τ)cos(2π·2.2τ)) at every frame of its cue; each sub-line rises over 0.30–0.35 s ± one frame; each non-cut transition aligns on its reveal with its cut on a bar line within one frame | another curve or start; a slow or still sub-line; a centred transition or a cut off the bar |
| AC5 `#142.ee5f5cff` | `ac5-reveal.test.ts` (1) | push, wipe, zoom_through with `in_cubic` progress: the first frame whose pixels show the incoming side at 0.5 of the picture (a push 0.9) is within one frame of the cut at 2 s | the base (zoom_through can't align on its reveal); a centred window; a push revealed at half its travel |
| AC6 `#142.3a4bcf6d` | `ac6-budgets.test.ts` (1) | every example on each stage reports `timing.expand_ms.<instance>`; then, only on a machine judgeLimit can judge, the largest example's expansion under 20 ms over five release processes and each example's `frame_budget` PASS; **INCONCLUSIVE off the reference Mac** | the base; costs over the budgets |
| AC7 `#142.58304480` | `ac7-shear.test.ts` (1) | î (1, 0) and ĵ (1, 1) within 1e-9 at 1 s, ĵ (0.5, 1) at 0.5 s; the readout 1.00 at every frame 0–1 s, 2.00 at 2 and 2.5 s | a matrix by columns; an arc; a readout not driven by M |
| AC8 `#142.0b0a5201` | `ac8-singular.test.ts` (1) | after [[1, 2], [2, 4]], the grid within 1e-6 of y = 2x and spread along it, î (1, 2) and ĵ (2, 4); the readout 0.00; an item at 0.3 opacity at each old tip (1, 0), (0, 1), (1, 1); the 3D stage refused naming explain.linear_map | a point or a plane; −0.00; ghosts at 1 or carried; a 3D stage drawn |
| AC9 `#142.30bc3e5b` | `ac9-timing.test.ts` (2) | cue_four and cue_five 1 s later, cue_six and the earlier cues where they were (markers to the flick), each word not shown a frame before its start and shown a frame after; under `film_cue_starts_absolute` the same judge fails naming cue_four | the planted recipe; markers that move while the words stay |
| AC10 `#142.d708e2b3` | `ac10-pack.test.ts` (1) | acme installs with no error, `set_digest` unchanged, no Rust names acme.slides or acme.one_entrance; the overlap refused naming slide_two and acme.one_entrance; the clean twin presented | the base; a rule compiled into a module; a refusal without the cue |
| AC11 `#142.53adec01` | `ac11-boundaries.test.ts` (1) | 2.9× refused naming cue_small, 3.1× presented; 8 s + 1 flick refused naming cue_hold, 8 s presented; an exit as long as its entrance refused naming cue_leave | each rule off by its boundary |
| AC12 `#142.0815c532` | `ac12-taste.test.ts` (1) | writes the 23 files from the canvas's own frames and prints their paths, then reads the record; none or another's is INCONCLUSIVE, `looks_wrong` fails | any run without your call |

## Readings where the issue leaves a choice

1. **"Renders from its cue list alone … with no film-specific code"**: the example document holds the recipe
   instance and nothing hand-written; "renders" is presented with no error, its frames drawn and showing something
   that changes; "no film-specific code" is no Rust source under `crates/` outside tests naming a recipe, and no code
   or shader file in the pack (Pack: explain@1, "It can never: Carry code or shaders").
2. **"In 2D and in 3D"**: the same document with `params.stage` changed; the 3D stage is read as a perspective camera
   (the film block's `fov` > 0), the 2D stage as an orthographic one (`fov` 0, Camera `camera@1`).
3. **"Changes no cue, time or word"**: the cue markers and the derived words; **"every landing stays on its beat
   within one frame"**: the frame each entering word settles on, 3D against 2D, within one frame, settling by one
   frame past its cue. A word another cue touches within two frames of its landing would read as unsettled; the
   examples are written so none does.
4. **"Refused naming the cue and the rule"** is an error issue whose JSON holds both, as #222 reads its refusals.
   **"Each rule has a planted-fault twin"**: the pack's twins, each run by this suite, plus this suite's own breaking
   list per rule.
5. **The slam** is read on the word's scale relative to its written scale, at every frame of its cue's window
   [start, end), τ from the cue's start; **"sub-lines rise in 0.30 to 0.35 s"** is the span of frames over which the
   sub-line's position changes, within one frame, ending higher. **"Each transition's reveal lands on its bar line"**:
   the transition aligns on its reveal (where its reveal lands is criterion 5's, measured) and its cut is on a bar
   line of the example's tempo map.
6. **"Covers half the picture"** is measured on the canvas's own frames, the mean over pixels of each pixel's place
   between the two sides' colors: the share a split covers, the weight a blend gives. Reading pixels for a measure is
   not reading a picture to judge it: no criterion before 12 judges how anything looks.
7. **Budgets**: "expanding the largest example" is the example whose document is largest as compact JSON, on each of
   its stages, judged as #222 judges its expander (`judgeLimit`, five fresh release processes after a warm-up); "plays
   within the canvas frame budget" is #1899's frame-budget run on every example and stage. "Compared with the merge
   base": the merge base has no film recipe, so no base reading exists; the limits are the issue's 20 ms and the
   budget class's frame limits, as #223 read the same words.
8. **The linear map's numbers** are read in plane coordinates through the moving group's warp `plane`; "at the middle"
   is the cue's middle time (a symmetric ease gives the mix 0.5); "through the shear" is every 60 fps frame of it;
   "after [[2, 0], [0, 1]]" is its end and half a second later. **"Collapses the plane onto a line"**: every grid
   point within 1e-6 of y = 2x, spread over more than one unit.
9. **"Cue 3"**, **"cue 4"** are the third and fourth cues of the list; cue 3 is a wait so the planted recipe's film
   stays clean of other rules.
10. **The test pack's rule** needs a way to read a cue list's resolved times in a rule, which neither the issue nor the
    design spells: the pair form above is this job's smallest reading of "a pack kind rule" over cues.

## The taste call

`ac12-taste.test.ts` keeps, in `DEEPBUILD_EVIDENCE_DIR` (else `deep-142-taste` under the temporary folder), each file
named by its name and SHA-256: `<recipe>-2d.png` (ten), `<recipe>-3d.png` (nine), `kinetic-slam.png`,
`linear-map-shear.png`, `kinetic-type.apng` (the kinetic-type example at 30 fps) and `linear-map-shear.apng` (the shear
at 30 fps), each from `deep-show`'s own frames byte for byte. You record the one call in a file named by
**`DEEPBUILD_TASTE_142`** *(chosen)*:

```json
{ "issue": 142, "criterion": "#142.0815c532", "verdict": "looks_right", "who": "…", "when": "2026-11-15T09:00:00Z",
  "files": { "dark_math-2d.png": "<sha256>", "…": "…", "linear-map-shear.apng": "<sha256>" }, "note": "…" }
```

`verdict` is `looks_right` or `looks_wrong`; `files` names all 23 with their SHA-256. This job records none. Attaching
the files to the PR and showing them in the session is the implementer's, outside any test. No other test reads a
picture to judge it.

## Not tested here

- Scope and fields no criterion asks for: the asset input by hash; the `strip` and `marker` step ops beyond what the
  examples need; the explain verbs' cue kit (#222's kit runs on every entry at the pack check); people as puppet@1
  rigs, licensed or generated assets or your own video; the linear map's other verbs, labels, coordinates and still
  plane; the look and palette inputs beyond the frame budget's look; "It can never" beyond carrying code (read the
  clock, change a published version, draw a person outside a puppet@1 rig); landings on a spoken word.
- **The Proof line** ("the nine examples rendered in 2D and 3D beside their cue lists") is criterion 12's files and
  criterion 1's renders; laying them beside their cue lists is the implementer's PR note.

## At the base

At `64c9be338` nothing of #142 exists: no `packs/explain-1.0.0/` (so no examples, no manifest, no explain verbs), no
film recipes, no rule over a cue list, no cue-list sections on an expansion row, no `timing.expand_ms` for a recipe,
no `film_cue_starts_absolute` plant (an unknown scenario `planted` is refused), and `frame_budget` takes no `packs`;
`zoom_through` can't align on its reveal (motion knows no coverage for it). `BASE-FAILURE.txt` records a run with no
cargo on PATH, so no binary was built: each test fails at its first missing file or at the build. The type-check
exits 0.
