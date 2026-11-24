# Acceptance tests for #3032: familiar@1 decides the names an agent reaches for first

Written first, from issue #3032 (its opening paragraphs, its Scope, its five acceptance criteria, its Proof and
"Runs on" lines), the design sections it links and those they lean on, the reference library's files at the pack's
pin, and base commit `9187aab36`, by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one test per criterion, plus exactly the three planted wrong programs the criteria name.

## What was read

- Issue #3032 as saved on 2026-11-24: no comments, no oracle line. Each criterion's ID was computed from its body
  (`scripts/proof-change.mjs`: `criterionId`).
- `docs/canvas-primitives.md`: Recipe; Units and axes ("lumens for point, spot and area lights, lux for the sun");
  Light and the light policy; Camera `camera@1`; Pack (its `census` and `aliases` fields; "Each mapped word works with
  only the inputs its reference itself requires and takes the reference's own default for the rest, and an input a
  recipe can't honor is refused by name, never dropped"; "a published version never changes"); Pack: math@1 (the
  `aliases` line: "deep_kinds answers a word from it, and from its census with the word's state and reason"); Pack:
  kind rules and the kind kit; Material (`unlit`; "It can never: … bring shader code"); Sky `sky@1` (`ambient_top,
  ambient_low: linear RGB`, its fog) and its height fog; Light: area emission; Instance `instance@1`; Frame and group;
  Item and kind (close names on `unknown_kind` and `unknown_field`).
- `docs/technical-design.md`: How we know version 0 works ("Familiar names, counted"; Criteria to tests; Closed issues
  stay proven; Criteria in a checked shape; Wrong programs; the edit guard), Dogfooding, and the canvas core's line on
  familiar-names packs.
- The reference library at the pin the pack's census names (`65c4864b…`, 0.186.0): the class file of each of the
  twenty names, the classes they extend (`src/lights/Light.js`, `src/math/Color.js`, `src/core/Object3D.js`),
  `src/lights/PointLight.js`, `src/materials/ShaderMaterial.js`, and the renderer's own light code
  (`src/renderers/webgl/WebGLLights.js`, the shader chunks `lights_pars_begin`, `lights_fragment_begin`,
  `lights_physical_pars_fragment` and `common`). They were handed to this job as files with their SHA-256; nothing was
  fetched. Every line the suite rests on is cited in `fixtures/` and `judges.ts`.
- At the base, for call shapes only: `tests/acceptance/1493/` and `1493-redraft-ac1/` (the census script on the
  checkout, `deep_kinds`' `word`, the pack check through `install_pack`, a planted pack written at test time, close
  names and fix read from `deep_show`'s issues), `433/` (a recipe's expansion read from the reply's `expansions`, a
  light's `power`), `2054/` (the newest suite over a familiar-names pack's lights, its fixture and `lane.json`),
  `903/` (a `twins.json` of planted names), `3238/`; `scripts/census.mjs`, `scripts/proof-runs.mjs`;
  `packs/familiar-1.0.0/`; `crates/deep-canvas/src/document/` (`close.rs`, `check.rs`, `pack_kinds.rs`, `packs.rs`,
  `packs/{aliases,census,refused,expand}.rs`); `crates/deep-show/src/` (`main.rs`, `packs.rs`, `kinds_word.rs`,
  `familiar.rs`); `crates/deep-canvas-scene3d/src/` (`spec.rs`, `light.rs`, `sky.rs`, `probe.rs`) and
  `crates/deep-scene3d-render/src/ambient.wgsl`, which say what our sky's ambient light and our area light's lumens
  mean in the picture.

## What the base already does, which these tests don't credit

`packs/familiar-1.0.0` maps 22 names and keeps a census of 444: 22 mapped, none refused, 422 open, each of the twenty
among the open. `node scripts/census.mjs --check` passes there. The pack check already runs `field.effect` on each
recipe an alias targets, `deep_kinds`' `word` already answers a mapped word with its target, a refused one with its
reason and target and an open one with `state: "open"`, and the document check already refuses a library name written
as a kind, as text that is no kind (`out_of_range` at `items/<id>/kind`), with no close name and no word of the pack.
So every test here is guarded by what the tree's census decides of the twenty: on the base it decides nothing, and
each test fails there at an assertion of its own (`BASE-FAILURE.txt`, which also holds what the base's binary does
with each fixture and each planted pack).

## Run them

From the checkout root, after `npm ci`, with cargo on PATH:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3032 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3032/tsconfig.json
```

`census.test.ts` runs the census script and needs the pack's reference files in the fetch cache at their pin
(`DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch`, once); a cold cache reads BLOCKED and fails, never passes.
The test itself never allows the network. The other four files each build `deep-show` once (`cargo build --locked
--bin deep-show --no-default-features --features full`) and copy it out, so the folder runs alone: `lane.json` says
so and lands with the suite. Node built-ins and vitest only; no suite is imported. Each test writes into its own
temporary folder and deletes it. A run with `--root tests/acceptance/3032` leaves Vitest's cache in
`tests/acceptance/3032/node_modules/.vite`; it is git-ignored. Nothing is timed.

`judges.ts` imports nothing but Node, so every judge can be run against a planted set with no binary; each test does
so first (`suite()`: `judgeProblems`, and each fixture against what it rests on).

## The surface under test

Everything is read through surfaces the issue or the base's suites name. A name marked **yours** is this job's
choice where the issue and design leave the interface open; the implementer provides exactly that.

1. **The pack.** The folder under `packs/` whose `pack.json` is named `familiar`, at its newest version, with the
   census its `"census"` key names (on the base, `packs/familiar-1.0.0` and `census.json`). The suite installs it as
   `{call: "install_pack", id: "deepbuild/familiar", dir}` and a document names it `deepbuild/familiar@<version>`.
2. **Its census** (#1493's shape). A name row `{name, state, target?, reason?}`; a parameter row `{name, param, state,
   target?, reason?}`; `totals {names, params}`, each `{mapped, refused, open}`.
   - A mapped name: `{"name": "RectAreaLight", "state": "mapped", "target": "familiar.<name>@1"}`, with
     `pack.json`'s `aliases.RectAreaLight = {target: <the same>, conversion}` and `recipes[<target>] = <file>`. The
     recipe's name is the implementer's.
   - A refused name: `{"name": "Scene", "state": "refused", "reason": <one of imperative, renderer, superseded,
     no_counterpart>, "target": "<what ours has in its place>"}`. The reason and a non-empty `target` are both held.
   - **Yours:** `ShaderMaterial` has such a refused row too (readings: the shader-text material).
   - A parameter row for each parameter `fixtures/names.json` lists for a mapped name, `mapped` or `refused` (with a
     reason): `{"name": "RectAreaLight", "param": "width", "state": "mapped", "target": "width"}`.
3. **`node scripts/census.mjs --check`** on the checkout: exit 0, a `PASS census:` line, no `FAIL`, `BLOCKED`,
   `INVALID` or `INCONCLUSIVE` line.
4. **A mapped name in a document.** One item whose `kind` is the alias's target and whose `params` are the library's
   own parameter names: `{"kind": "familiar.<name>@1", "params": {"intensity": 2, "width": 3, "height": 0.5}}`. The
   suite writes only `intensity`, `width` and `height` (the lights' cases) and what the reference requires (`color`
   on `Fog` and `FogExp2`, `count` on `InstancedMesh`, each only when the census maps that parameter). **Yours:** a
   color is the integer 0xRRGGBB, as the pack's 22 recipes take one (`"color": 16777215`). The `deep_show` reply's
   `outcome` is `presented`, and its `expansions` row for the item holds its derived items, `{instance: "word",
   derived: {"word.<step>": {kind, params}}}` (#433's reading).
5. **Yours: a refused name in a document.** One item whose `kind` is the name as the library spells it,
   `{"kind": "Scene", "params": {}}`, in a document that names the pack. The `deep_show` reply is not `presented`,
   nothing is derived for the item, and its `issues` hold one whose
   - `path` is `items/<id>/kind`,
   - `close` holds `{"name": "deepbuild/familiar@<version>", "refuses": "Scene", "reason": "<the row's>", "target":
     "<the row's>"}` (the entry the base's `close.rs` already makes of a refused row, which #1493's suite reads on a
     field), and
   - `fix` holds the reason as a word and the target as text, as the base's `"… refuses `Scene`: <reason>; write
     <target> instead."` does.
   The issue's `code` and its other fields aren't read.
6. **The pack check** (`install_pack`): `{outcome: "installed" | "refused", issues}`. The planted parameter is
   refused with an error that names, as data and not only in prose, the kit part `field.effect` and the field
   `unreadParameter` (#1493's reading: the base writes `actual: {part, field, tried}`).
7. **`deep_kinds {op: "word", word}`**: `{word, state: "mapped", target}` with the alias's recipe; `{word, state:
   "refused", reason, target}` as the row gives them; `{word, state: "open"}` for a name still open. `pack`,
   `conversion` and anything else the answer carries aren't read.

No new binary, call, flag or `planted` name: the three planted programs are written by the suite.

## The planted programs

Each is a copy of the tree's pack folder in a temporary folder, every file as shipped, with one thing changed,
installed under the pack's own ID in a `deep-show run` of its own (`helpers.ts`: `copyPack`, `plantUnread`,
`plantShaderMaterial`, `plantCopied`). The same copy unchanged is the control: it must pass the check the planted one
fails. `twins.json` maps each criterion to its name; they are not twin folders, since each is made from the tree's
own recipes, whose names this job can't know.

| Name | The wrong program | Criterion |
|---|---|---|
| `parameter_draws_nothing` | The recipe of the first of the twenty the census maps gains an input, `unreadParameter` (a number, 0 to 1), that no step reads, and the census a `params` row that calls it mapped, as it calls every input a recipe takes | AC2 |
| `shader_text_material_mapped` | The pack maps `ShaderMaterial`: a recipe `familiar.shader_material@1` of one step that makes a `material@1` and takes no shader text, an alias onto it stating that the shader text is dropped, and the census row mapped | AC3 |
| `light_number_copied` | The recipe of a mapped light is replaced by one that takes the library's words the fixture writes and copies its number into our field as written: an area light's `power: intensity`, an ambient or hemisphere light's `ambient_top` and `ambient_low` each `[intensity, intensity, intensity]` (`fixtures/lights.json`: `planted`) | AC4 |

## The fixtures

- `fixtures/names.json`: the twenty, in the issue's order, each with its class in the reference at the pin: the file,
  the line of its constructor and its parameters as the census counts them (the constructor's arguments, or the
  properties its constructor sets when it takes one `parameters` object). This job listed them from the reference's
  files apart from `scripts/census.mjs` and compared the two: the same lists. Three parameters are required by the
  reference's own docs (`Fog` and `FogExp2`'s `color`, `InstancedMesh`'s `count`). Nine names carry the kind the
  issue's second paragraph pairs them with: `DirectionalLight` `light.sun@1`; `RectAreaLight` `light.area@1`;
  `AmbientLight`, `HemisphereLight`, `Fog` and `FogExp2` `sky@1`; `OrthographicCamera` `camera@1` holding
  `projection: orthographic`; `MeshBasicMaterial` `material@1` holding `unlit: true`; `InstancedMesh` `instance@1`.
  `shader_text` is the reference's `ShaderMaterial` and the lines that give it its shader text.
- `fixtures/lights.json` (the criterion's fixture): for each of the four lights, the library's number, its unit and
  what it means in the picture, with the reference's lines; our field and its unit, with the design's lines; the
  conversion; two cases each (the number written, and unwritten at the library's own default); and the planted
  recipe. `judges.ts`'s `CONVERSIONS` derives every expected number again, and a fixture that states another fails
  the test before anything runs.

| Light | The library's number | Ours | Conversion | Written | Unwritten |
|---|---|---|---|---|---|
| `DirectionalLight` | `intensity`, the illuminance on a surface that faces it, lx | `light.sun@1` `illuminance`, lx | the same number | 3 → 3 lx | 1 lx (ours alone would be 10,000) |
| `AmbientLight` | `intensity`, the illuminance every surface receives, lx | `sky@1` `ambient_top` and `ambient_low`, the radiance a white diffuse surface reflects, cd/m² | ÷ π | 2 → 0.63662 each | 0.31831 each |
| `HemisphereLight` | `intensity`, the illuminance from the sky color facing up and from the ground color facing down, lx | the same two fields | ÷ π | 2 → 0.63662 each | 0.31831 each |
| `RectAreaLight` | `intensity`, its face's luminance, cd/m² (nits) | `light.area@1` `power`, lm, over `size`, m | × width × height × π | 2 on 3 m × 0.5 m → 9.42478 lm, size [3, 0.5] | 314.159 lm, size [10, 10] |

Where the numbers come from: the library's renderer adds each light's color × intensity into an irradiance and
reflects it from a diffuse surface as irradiance × color ÷ π, and it names its own units where it has them (a point
light's candela and lumens, an area light's nits and lumens: power = intensity × width × height × π). Ours takes lux
for the sun and lumens for an area light (Units and axes), and our sky's ambient light is what a white diffuse
surface reflects, mixed from below to above by n.y ÷ 2 + ½ exactly as the library mixes a hemisphere light, so it is
the illuminance ÷ π. Colors stay white, which is 1 in every channel in both color spaces.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, `- [ ] ` dropped.
Each `describe` and each test's name starts with `AC<n> #3032.<id>`.

| Criterion | Text (abridged) | Tests, and what fails each |
|---|---|---|
| AC1 `#3032.dae946a2` | `census.mjs --check` passes with at most 402 names open, none of the twenty among them, totals equal to the rows; 422 open on the merge base | `census.test.ts` (1). The script on the checkout exits 0 with a `PASS census:` line and no other state; the census it checked has each total equal to its rows in both tables, at most 402 open names and one row, mapped or refused, for each of the twenty. Fails on: the merge base (422 open, the twenty among them); one of the twenty open or without a row; a total written by hand; a cold cache (BLOCKED) |
| AC2 `#3032.b6de0329` | Each mapped name's recipe lowers to one item of its target kind, and each of its parameters has a `params` row; a planted recipe that accepts a parameter and draws nothing from it fails the pack's check, naming the field | `recipes.test.ts` (2). First: each of the twenty the census maps has an alias onto a recipe of the pack, the row's target; one `params` row, mapped or refused, for each parameter of `fixtures/names.json`; and, alone in a document with only what its reference requires, lowers to exactly one item, of the paired kind where the issue pairs one. Fails on: the merge base (none mapped); no recipe; a parameter with no row or open; two items, none, another kind, a lit material. Second: the control copy installs; `parameter_draws_nothing` is refused naming `field.effect` and `unreadParameter`. Fails on: a pack check that runs no kit on a mapped name's recipe, or can't judge it |
| AC3 `#3032.5da79b5b` | A document that uses a refused name is refused at check with the name, its reason and the nearest kind or recipe; a planted pack that maps a shader-text material onto `material@1` fails, naming the word | `refusals.test.ts` (2). First: each of the twenty the census refuses has a reason and a target, and a document whose item has it as its `kind` is not presented, with an issue at `items/word/kind` whose close entry and fix hold the name, the reason and the target, and nothing drawn. Fails on: the merge base (none refused; the base's refusal carries no reason and no target); a reason or target dropped; the name drawn. Second: `ShaderMaterial` is refused in the census and passes that check under the control copy; `shader_text_material_mapped` is refused by the pack's check naming the word, or installs, lowers the word to one `material@1`, and fails that check, naming `ShaderMaterial` |
| AC4 `#3032.876d5479` | For each mapped light, a fixture states the library's own value and ours with the conversion between them, and a planted recipe that copies the number as written fails, naming both values | `lights.test.ts` (2). First: for each of the four lights the census maps, each case lowers to one item of the light's kind holding ours within 1e-9 (relative). Fails on: the merge base (none mapped); our default kept unwritten; illuminance written into the sky's radiance; nits taken for lumens; another size. Second: for each mapped light whose number differs, the control copy passes and `light_number_copied` installs, leaves the library's number in our field, and fails each case with one failure naming the light, the library's value and ours (`intensity 2 cd/m²`, `power 9.424777961 lm`, `size [3, 0.5] m`). INCONCLUSIVE, as a failure, when no such light is mapped |
| AC5 `#3032.5d808b13` | `deep_kinds` asked for each of the twenty returns its recipe or its refusal; a word still open answers that it is undecided, never an empty reply | `words.test.ts` (1). Each of the twenty answers `{state: "mapped", target}` with the alias's recipe, or `{state: "refused", reason, target}` as its row gives them; the first name the census still leaves open answers `{word, state: "open"}`. Fails on: the merge base (each of the twenty answers `open`); an answer that disagrees with the census; a refusal with no reason or target; `no_match` or no state for an open word |

Proof line ("the census's counts on the merge base and on the change, each recipe lowered, each refusal, the lights'
conversion fixtures and the planted packs failing"): AC1's test, whose failure on the merge base prints its count;
AC2's first; AC3's first and AC5's; AC4's first; and the three planted tests.

## Readings where the issue and design leave a choice

- **Which names are mapped and which refused** is the tree's to say: the suite reads the census and holds whatever it
  finds to the criterion. So that a tree with nothing to read can't pass, AC2 needs at least one of the twenty mapped,
  AC3 at least one refused, AC4 at least one of the four lights mapped, and AC5 one name still open beside the twenty.
- **The pack** is the newest version of the pack named `familiar` under `packs/`. On the base that is
  `packs/familiar-1.0.0`, the census the issue names. The design says a published version never changes, and #2054's
  pack took a new folder for its next minor, so the suite reads whichever the work lands in: the same folder, or a
  newer one. `--check` must pass over all of them.
- **"Its target kind"** (AC2) is the kind the recipe is over (the Scope: "a recipe over the kind that does it"). Where
  the issue's second paragraph pairs a name with a kind, that kind is held, with `projection: orthographic` and
  `unlit` where it says so; the pairing of its six kinds with nine names is this job's reading of that sentence
  (`fixtures/names.json`). For the other eleven no kind is fixed: the one item must be of a kind the build knows (the
  revision is presented, with no `unknown_kind` notice) and never a recipe of the pack.
- **"Lowers to one item"** is exactly one derived item in the instance's `expansions` row, in a revision that is
  presented, the instance written with only the inputs its reference itself requires (Pack: "Each mapped word works
  with only the inputs its reference itself requires"). The reference's docs require only `Fog` and `FogExp2`'s
  `color` and `InstancedMesh`'s `count`; each is written when the census maps it and left out when it refuses it.
- **"Each of its parameters has a `params` row"** is read with the Scope's "each mapped or refused": one row for each
  parameter, and never `open`. The Scope adds "as the 22's are", yet 34 parameter rows of the 22 are open on the
  base; those stay out of this task and aren't held. A parameter is what the census counts as one (the constructor's
  arguments, or the properties it sets from one `parameters` object). `MeshPhysicalMaterial` sets eight of its
  properties under private names behind accessors (`_clearcoat` and the rest), which the base's rule lists as
  written; the suite holds no row for those, under either name.
- **"A document that uses a refused name"** writes the name as an item's `kind`, as the library spells it. On the
  base that text is no kind and is refused without a word about the pack; the criterion's refusal adds the name's
  reason and what to write instead. **"Refused at check"** is a reply that isn't `presented` and that draws nothing
  for the item. **"With the name, its reason and the nearest kind or recipe"** is the close entry `{name, refuses,
  reason, target}` and a fix that holds the reason and the target: the shapes the base gives a refused word on a
  field, now on the kind. The document names the pack; whether one that doesn't is answered the same isn't read.
- **"The nearest kind or recipe"** is the row's `target`, as text, non-empty. For `Scene` nothing of ours is a kind
  (a document stands in its place), so the suite doesn't ask that the text name a registered kind.
- **The shader-text material** is the reference's `ShaderMaterial` (`src/materials/ShaderMaterial.js:127`, `:134`).
  The Scope says a material that takes shader text is refused, never bent to fit, and the criterion's planted pack
  maps one. For that pack to fail "the same check its shipped twin passes", the shipped pack must refuse the name:
  the suite holds `ShaderMaterial` to a refused row with a reason and a target. That is a twenty-first decided name,
  which "at most 402" allows, though the Scope's last line leaves the other 402 out of the task. It is the one place
  the suite fixes a name's fate. `RawShaderMaterial` isn't held.
- **"Fails, naming the word"** (AC3) is either the pack's check refusing the planted pack with an issue that names
  `ShaderMaterial`, or, if it installs, the document check's judge failing on it with a failure that names
  `ShaderMaterial`. The suite takes either, so the criterion doesn't fix where the pack is caught.
- **"For each mapped light"** is each of `DirectionalLight`, `AmbientLight`, `HemisphereLight` and `RectAreaLight`
  the tree maps. `PointLight` and `SpotLight` are the base's, held by #433's suite. **"A fixture states"**: the
  suite's own `fixtures/lights.json` states the values and the conversion, derived from the reference and the design
  and never read from the tree, and the tree's recipe is held to it.
- **Our sky's ambient light** has no unit in the design ("linear RGB"). The suite reads what it means from the base's
  own shading (`ambient.wgsl`, `probe.rs`: the radiance a white diffuse surface reflects, mixed from below to above),
  which gives the ÷ π. If the design meant an illuminance, this conversion is wrong and the fixture goes to a redraft.
- **A recipe that "copies the number as written"** differs from the right one only where the two numbers differ. A
  directional light's is lux in both, so the suite can't tell a copying recipe from the right one there and says so
  (`fixtures/lights.json`: `copied`); it holds that light to the number written and to the library's default
  unwritten. The planted program runs on every mapped light whose number differs. If the tree maps none of those,
  the planted clause is unproven and the test fails as INCONCLUSIVE rather than pass.
- **"Naming both values"** is one failure that holds the library's value with its unit and ours with its unit.
- **"Its recipe"** (AC5) is `{state: "mapped", target}` with the alias's recipe; **"its refusal"** is `{state:
  "refused", reason, target}`; **"undecided"** is `state: "open"`, the census's own word for it, as #1493's suite
  reads it; **"an empty reply"** is `no_match`, any other `code`, or an answer with no state.
- **"On the merge base 422 are open"** is the wrong program AC1's test fails on, and its failure there prints the
  count; the test doesn't read the merge base's census itself.

## Not asserted, because no criterion says so

- Which of the twenty is mapped and which refused, beyond `ShaderMaterial`; that `Mesh`, `Scene` and `Group` are
  refused, or what line their rows give for what stands in their place (the Scope's fourth line): a refused one's
  reason and target are held as any refused name's.
- A mapped name's stated conversion text, and any conversion but the four lights' numbers: an orthographic camera's
  `left`, `right`, `top`, `bottom` onto `view_width`; a material's color, `emissive` or `shininess`; a fog's `near`,
  `far` and `density`; a light's color, position, target or shadow; a hemisphere light's ground color; an area
  light's range.
- A light "with a falloff we don't draw" (the Scope's third line): none of the four has a falloff, and the base
  already refuses a point or spot light's other decay.
- That every parameter the census maps changes the picture: the pack check's `field.effect` holds that, and AC2's
  planted program shows it does on a mapped name's recipe.
- The census of the other names, the reasons chosen, the `reference.files` the census lists, and break files:
  `--check` holds what it holds (#1493).
- A refused name written anywhere but an item's `kind`; a mapped or an open name written as a kind; a document that
  doesn't name the pack.
- `deep_kinds`' other operations, and what a word answers beside its state, target and reason.
- The game engine's pack (#2038, #2054, #2890), and running the library beside the pack (#1494): the Scope leaves
  them out.

## What the implementer adds outside this folder

Nothing for the suite to run: `scripts/lanes.mjs` reads `lane.json`, and no planted name or flag is asked of any
binary. The work itself adds what `--check` needs to list a mapped name's parameters: its class file among the
census's `reference.files`, and a row of `scripts/fetch-lock.json` for it at the pin.

## Base failure

`BASE-FAILURE.txt` holds the run at the base (`9187aab36`, `deep-show` built in the full set), one file at a time:
5 files, 8 tests, 8 failed, each at an assertion of its own, none at load, and no file's own build compiled anything.

- AC1 fails on the census: 422 names open, more than 402, and each of the twenty open. `--check` itself passes there
  and the totals equal the rows.
- AC2's two, AC3's first and AC4's two fail at their guard: the base's census maps none of the twenty, refuses none,
  and maps none of the four lights. They stop before the binary is asked for anything.
- AC3's second fails on `ShaderMaterial`, open in the base's census.
- AC5 fails on what the binary answers: `state: "open"` for each of the twenty. Its second sentence holds on the base
  already (an open word answers `open`), inside the same test.

Since seven tests stop at the census on the base, what they do past their guards was probed outside the suite, with
the suite's own helpers and judges driving the base's binary: the base's pack installs and its words lower to one
item; `deep_kinds` answers a mapped, an open and an unknown word as item 7 of the surface reads them; each of the twenty
written as a kind is refused as text that is no kind, with no close name; each planted pack, as `helpers.ts` writes
it on a name the base maps, is refused or fails its judge as meant; and on a stand-in pack written for the probe the
flows of AC2, AC4 and AC5 pass and AC3's fails, since the base's document check says nothing of the pack.
`BASE-FAILURE.txt` gives each finding. The probes changed nothing in the suite.

Unproven until the work exists: that a tree which decides the twenty passes. The stand-in shows the judges pass
recipes written to the fixture; it is this job's own, and no evidence about the work.
