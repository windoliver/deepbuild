# Acceptance tests for #458, relations group: rendering relations on linear targets, the software adapter, translation invariance and light-level invariance

Written first, blind, from issue #458 ("Parity suite: lanes, planted twins, no retries, the release bar and the fixture
scan": its Scope, its acceptance criteria and its Proof line), its Oracle page (no upstream test checks any criterion),
the design sections it links and those they lean on, and base commit `06e231702` ("Merge pull request #2735 …"), by a
job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

This folder holds the criteria of the **relations group**: 10, 12, 13 and 14, numbered as the issue lists them. Criteria
1 to 6 and 8 (the suite group), 7, 9 and 11 (the pairs group) and 15 to 19 (the views group) are written by other blind
jobs in their own folders under `tests/acceptance/458/`; this job never saw them.

## What was read

- Issue #458 and its Oracle page (`doneright/oracles/issues/458.md` in `DeepBuildAI/deepbuild`, branch `doneright`):
  "no upstream test" for criteria 10, 12, 13 and 14, so nothing is ported.
- `docs/technical-design.md`: How we know version 0 works (Rendering relations; Wrong programs; Kit hygiene; the
  parity suite paragraphs: planted-fault twins, goldens blessed only by your decision, no may-fail fixture, a share of
  pixels beside a ceiling for every pixel); How it installs (the GPU backend's seam, headless rendering and its software
  adapters, "every receipt names it with `adapter.software: true`").
- `docs/canvas-primitives.md`: Determinism; Determinism class (targets the GPU rasterized are same machine; the
  environment fingerprint); Look `look@1` and its bloom (`threshold: EV100 | none = none`); Light and the light policy
  (`range: m = auto`, "threshold 0.05 lx by default"; the margin; the window `(1 − (d ÷ range)⁴)²`); Sky `sky@1`
  (`top`, `low`, `ambient_top`, `ambient_low`, `exposure: EV100`, "from the look unless set"); Material; Instance
  `instance@1`; Camera `camera@1`; Motion blur: velocity; Render-back: diagnostic modes (lighting only).
- At the base: AGENTS.md, CONTRIBUTING.md; `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table; `view3d`
  and its `targets`; `golden.rs`'s `decide` and `golden`; `seam.rs`'s `--adapters`; `timing.rs`'s `adapter`);
  `crates/deep-gpu/src/seam.rs` (an adapter's identity and its `type`: `integrated_gpu`, `discrete_gpu`, `virtual_gpu`,
  `cpu`, `other`); `crates/deep-scene3d-render` (`LINEAR` is rgba16float; `pre_tone` is read before exposure; the
  lighting-only view); `crates/deep-canvas-scene3d` (`look.rs`: the look's `exposure` is an EV100, scale
  1 ÷ (1.2 × 2^EV100); `sky.rs`; `light.rs`; the `ball@1` builder); the suites `tests/acceptance/1897/`, `140/gpu/`,
  `138/`, `378/`, `418/`, `419/`, `421/`, `422/`, `425/`, `427/`, `431/`, `1173/` (READMEs and helpers, for
  conventions and document forms); `scripts/lanes.mjs`, `scripts/gpu-validation.mjs`.

## What the base already does, which these tests don't credit

`view3d` draws every fixture document here (the first test of each file checks that before it asks anything new), and
on the base's rgba16float targets the fixtures already read as follows: A's plus B's equals the frame lit by both
within 2⁻⁹ relative; the orthographic move shifts the frame by exactly (7, −3) pixels; the turned sphere keeps its
pixels within 2⁻⁹; the slab's shadow never brightens the lit frame; the mesh and the instances of its parts write the
same `final`, `linear`, `normal` and `depth` files (their `ids` differ: one pick for the mesh, one per instance);
`pre_tone` doesn't move with the look's exposure; and the scaled light-level side reads the base side ÷ 100 within
1.5e-3 with bloom off, and up to 2.2% off with bloom on. The translated fixture draws wrong at the base (34% of its
pixels within one code value, the worst 243 off), and its velocity blur shows (545 pixels move by more than one code
value against the same frame with blur off). There is no
`relation` call, no `full_lane` call, no `exposed`, `lighting` or `velocity` target to read, and none of the planted
names below. So each test fails at the base on `bad_input` (BASE-FAILURE.txt), apart from criterion 12's second test,
which is BLOCKED on this Mac.

## Run them

Each file builds `deep-gpu` once (`cargo build --locked --bin deep-gpu`, and with `--features test-seam` for
`software-adapter.test.ts`), copies the binary out of the target folder and draws on the GPU, so the files run one at a
time. `scripts/lanes.mjs` needs `'tests/acceptance/458/relations/'` in its `alone` list; this README is the
instruction, the implementer makes that edit.

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/458/relations relations.test.ts --no-file-parallelism --testTimeout=600000         # AC10
npx vitest run --root tests/acceptance/458/relations software-adapter.test.ts --no-file-parallelism --testTimeout=600000  # AC12 (test-seam)
npx vitest run --root tests/acceptance/458/relations translation.test.ts --no-file-parallelism --testTimeout=600000       # AC13
npx vitest run --root tests/acceptance/458/relations light-level.test.ts --no-file-parallelism --testTimeout=600000       # AC14
npx tsc -p tests/acceptance/458/relations/tsconfig.json
```

Off macOS the drawing tests fail with a message starting `INCONCLUSIVE:`. Criterion 12's second test needs Linux with
the Vulkan loader and a software rasterizer's driver manifest; on this Mac it fails with a message starting `BLOCKED:`,
never a pass (Readings). Nothing times a budget, so nothing is gated on power or load. Each test writes into its own
temporary folder and deletes it. Delete Vitest's cache in `tests/acceptance/458/relations/node_modules/.vite` after a
run.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and with white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #458.<id>`.

| AC | ID | File | Tests |
|---|---|---|---|
| 10 | `#458.a35e570a` | relations.test.ts | (1) the six relations, each on its fixture: the base's `view3d` draws every side; the lane's `relation` call answers PASS; and this file's own reading of the returned targets finds nothing: `up` = 2 × `base` in `exposed`; `ab` = `a` + `b` in `linear`, A and B overlapping past 1.05 on at least 200 pixels; `moved`(x, y) = `base`(x + 7, y − 3) in `linear`; `turned` = `base` in `linear`; `with` ≤ `without` in `lighting` on every pixel, halved on at least 200; the mesh and the instances write byte-equal color, normal, depth and velocity with equal pixel hashes, and the ID target shows the same item at every pixel. (2) each relation's planted twin makes the lane FAIL, its reason naming the relation, and breaks this file's reading; under `light_sum_clamped` the frame lit by both stops at 1.0 on at least 200 pixels where A's plus B's is past 1.05 |
| 12 | `#458.d7eebc1a` | software-adapter.test.ts | (1) on the seam's software test adapter (type `cpu`) with the lane configured for this Mac's hardware adapter: the run records the device's adapter; every fixture of `full_lane`, the eight relations among them, is BLOCKED with a reason naming the adapter and `cpu`; no golden is compared or blessed, a blessing asked as yours is refused naming the adapter, the golden store keeps its bytes, and the golden blessed on hardware reads BLOCKED naming the adapter. `--planted lane_adapter_from_configuration` records the configured adapter, reports PASS fixtures, and fails the same check, naming the adapter. (2) the same on a real software adapter forced by the Vulkan loader's driver setting: Linux only, BLOCKED elsewhere |
| 13 | `#458.824452c4` | translation.test.ts | (1) the fixture and its copy moved by (1e7, −3e6, 5e6) m: `relation` answers PASS, and the two final frames it returns are within one code value on at least 99.9% of pixels with none more than 4 off. (2) `--planted absolute_f32_world_positions`: a pixel is more than 4 code values off, the lane answers FAIL naming the relation, and `first.item` and the reason name an item of the fixture |
| 14 | `#458.52b742e2` | light-level.test.ts | (1) the fixture and its copy at 1/100 with log2 100 EV more exposure, bloom on with no threshold: `relation` answers PASS, and every pixel of the two `exposed` targets it returns is within 1e-4 relative. (2) `--planted light_cut_absolute_illuminance`: a pixel changes, the lane answers FAIL naming the relation, and `first.light` and the reason name `lamp-far` |

## The surface under test

The issue names rendering relations, the full lane, GPU fixtures, an adapter read from the device, a loader setting and
planted twins, but no command, call or field. These tests extend **#377's `deep-gpu run`**, the binary the base proves
the GPU layer through, with its protocol unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, one
answer line `{"ok": true, "replies": [Reply]}`, files written under `out` named `<sha256>.<ext>`; an unknown call is
answered `{"code": "bad_input", …}`; an unknown `--planted` name answers `{"ok": false, "code": "bad_input"}` and exits
2. No new binary, script or cargo feature. **Two new calls, three new target names and nine planted names; every name
below is this job's choice, since the issue and the design give none. The implementer builds exactly these.** Used as
they are: `view3d` (#378, with #419's `class: "export"`), the `adapter` call and test-seam's `--adapters <file>`
(#140), `decide` and `golden` (#380).

### `relation`: one rendering relation, as the full lane holds it

```json
{"call": "relation", "relation": name, "size": [w, h], "frame": n, "fps": n,
 "sides": {side: {"doc": path, "look": look@1}}, "k"?: [kx, ky], "assets"?: {sha256: path}}
```

draws each side once on this run's device, as a check draws a canonical render (`view3d`'s `class: "export"`: frame
`frame` at t = `frame` ÷ `fps`, at `size`, the look's export samples, nothing settling), judges the named relation by
its rule, and answers

```json
{"relation": name, "result": "PASS" | "FAIL", "reason"?: text,
 "sides": {side: {target: sha256}},
 "hashes"?: {side: {target: hex32}}, "picks"?: {side: {pick ID: name}},
 "first"?: {"target": name, "pixel": [x, y], "item"?: ID, "light"?: ID}}
```

- `relation` is one of the eight names in the table below; `sides` holds exactly the sides that relation names.
  `doc`, `look` and `assets` are `view3d`'s. `k` is `ortho-shift`'s alone.
- `sides.<side>.<target>` names the file of each target the relation compares, as that side drew it: `<sha256>.png`
  for `final` and `ids`, `<sha256>.f32` for the rest. `linear`, `color`, `exposed` and `lighting` are little-endian
  f32 RGBA, rows top-down, `w × h × 16` bytes, as #378's `linear`; `normal` and `depth` are the bytes `view3d` writes
  for those targets. A relation returns at least the targets its row lists, on PASS and on FAIL.
- `result` is `PASS` when the rule holds on every pixel it covers and `FAIL` otherwise. On `FAIL`, `reason` names
  the relation by its name here, and `first` gives a pixel that breaks the rule and the target it was read in. On a
  software adapter the relation is `BLOCKED` (criterion 12) and draws nothing.
- The relations run in the release preflight's full lane only (the issue's Scope): the full lane's GPU fixtures hold
  one fixture per relation, named `parity/relation/<name>.scene` (`full_lane`, below), and `relation` is how the lane
  judges one. No live view and no export runs one.

| `relation` | Sides | Targets returned | The rule |
|---|---|---|---|
| `exposure-doubles` | `base`, `up` (the same document; `up`'s look one stop more exposure) | `exposed` | `up` = 2 × `base` on every pixel |
| `lights-add` | `a`, `b`, `ab` (light A alone, light B alone, both) | `linear` | `ab` = `a` + `b` on every pixel |
| `ortho-shift` | `base`, `moved`, with `k` (the orthographic camera moved `k` whole pixels in its plane, x to the right and y down in the view) | `linear` | `moved`(x, y) = `base`(x + kx, y + ky) wherever both are inside the frame |
| `sphere-turn` | `base`, `turned` | `linear` | `turned` = `base` on every pixel |
| `occluder-never-brightens` | `without`, `with` (the same document with one opaque item added) | `lighting` | `with` ≤ `without` on every pixel that shows the same receiver in both |
| `instances-keep-hash` | `mesh`, `instances` | `color`, `normal`, `depth`, `velocity` with `hashes` for each; `ids` with `picks` | `color`, `normal`, `depth` and `velocity` have equal pixel hashes on both sides, and `ids` shows the same item at every pixel |
| `translation` | `base`, `moved` | `final` | within one code value on at least 99.9% of pixels, and no pixel more than 4 code values off |
| `light-level` | `base`, `scaled` | `exposed` | every pixel within 1e-4 relative |

Float rules other than `light-level`'s hold within 2⁻⁹ relative per channel (Readings). Targets:

- `linear`, `final`, `ids`, `normal`, `depth`: `view3d`'s targets of those names, as the base writes them. In
  `instances-keep-hash`, `color` is the `linear` target under the issue's name for it.
- **`exposed`** (new): the linear image the tone map reads, after the effects chain, bloom and exposure: `pre_tone`
  (#418: before exposure) times the look's exposure scale, f32 RGBA.
- **`lighting`** (new): the lighting-only mode's frame of the side (the renderer's frame on a white albedo, the light
  alone; #427's `lighting_only`), in linear light before any exposure, f32 RGBA.
- **`velocity`** (new as a file): #431's velocity target as the frame built it, its f32 values rows top-down. The
  fixture's look turns velocity blur on, so the frame builds it.
- `hashes.<side>.<target>` (`instances-keep-hash`: `color`, `normal`, `depth`, `velocity`): the GPU pixel hash
  (#1897: 128 bits, 32 lower-case hex digits) of that side's target. Two targets have equal hashes exactly when their
  files are byte-equal.
- `picks.<side>` (`instances-keep-hash`): `view3d`'s pick table of that side's frame, `{pick ID in decimal: name}`,
  for its `ids` target (#378: pick ID r + 2⁸ g + 2¹⁶ b + 2²⁴ a). An instance's name is `<item>#<n>`; the item is the
  part before `#`.
- `first.item` (`translation`): the ID of an item of the document whose pixels moved. `first.light` (`light-level`):
  the ID of the light whose share of the frame changed between the sides.

### `full_lane`: every GPU fixture of the full lane, on the adapter the device reports

The lane's general verdict rules, its report and the release bar belong to the suite group's criteria. Criterion 12
needs only the smallest entry that runs every GPU fixture of the full lane and reports each one's verdict:

```json
{"call": "full_lane", "store": dir, "configured": {"adapter": {"name": string, "driver": string, "type": string}}}
```

```json
{"lane": "full", "adapter": {"name": string, "driver": string, "type": string},
 "fixtures": [{"fixture": name, "result": "PASS" | "FAIL" | "BLOCKED" | "INVALID" | "INCONCLUSIVE", "reason"?: text}],
 "goldens": {"compared": [fixture], "blessed": [fixture]}}
```

- `fixtures` lists every GPU fixture of the full lane, by its name in the canvas kit's scheme
  (`parity/<category>/<name>.<profile>`), the eight `parity/relation/<relation>.scene` among them, each with the
  verdict this run gave it. `store` is the golden store the run reads (#380's `store`).
- `adapter` is the run's record of the adapter that ran it: its name, driver and device type (`type`: the GPU seam's
  words, `integrated_gpu`, `discrete_gpu`, `virtual_gpu`, `cpu`, `other`), read from the device, as the `adapter` call
  reads them (#140), never from `configured`.
- `configured.adapter` is the lane's configuration: the adapter the lane is set up to run on, as a lane file or a
  hosts block names it. It holds for the rest of the run. A right lane may report that it differs from the device; it
  never records it or judges by it.
- On a CPU or software adapter (the device's `type` is `cpu`): every fixture's `result` is `BLOCKED` and its `reason`
  names the adapter by the device's name and its device type (the word `cpu`); nothing is drawn or judged;
  `goldens.compared` and `goldens.blessed` are empty. In the same run `decide` answers `{"outcome": "refused", …}`
  with the adapter's name in the reply and writes nothing into the store, and `golden` answers `{"verdict":
  "BLOCKED", "reason": …}` with the adapter's name in its reason, before any fingerprint or pixel comparison.
- `goldens.compared` and `goldens.blessed` list the fixtures whose goldens this run compared and recorded.

Criterion 12's adapters: test-seam's `--adapters <file>` (#140) with one test adapter `{"name": "llvmpipe (LLVM 19.1.7,
256 bits)", "type": "cpu", "vendor": 65541, "device": 0, "driver": "llvmpipe", "memory": …, "features": [every feature
of the tier's table]}`, which the base already takes (the seam reports whatever `type` the file gives); and, on Linux,
the Vulkan loader's driver setting (`VK_DRIVER_FILES`, and `VK_ICD_FILENAMES` for older loaders, set in the process's
environment to a software rasterizer's manifest), which is the loader's own surface, not ours.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `light_sum_clamped` | The light loop clamps the summed light to 1.0 before tone mapping, so the frame lit by A and B stops at 1.0 where they overlap | 10 (issue-named) |
| `exposure_after_tone_map` | Exposure is applied after the tone map, so the image before tone mapping doesn't move with it | 10 (`exposure-doubles`'s twin) |
| `ortho_camera_snaps_to_grid` | An orthographic camera's position in its plane snaps to a 0.1 m grid before the view is built, so a move of k pixels shifts the frame by another count | 10 (`ortho-shift`'s twin) |
| `shades_by_local_tangent` | Every surface's specular lobe is stretched along its object-space +X direction projected on the surface, so an isotropic sphere changes as it turns | 10 (`sphere-turn`'s twin) |
| `shadow_brightens` | A shadowed light's share is multiplied by 2 − visibility in place of visibility, so a caster brightens what it shades | 10 (`occluder-never-brightens`'s twin) |
| `instances_skip_normal_target` | The instanced path leaves its instances out of the normal target alone, so the color target keeps its bytes and the normal target differs | 10 (`instances-keep-hash`'s twin) |
| `lane_adapter_from_configuration` | The lane takes the adapter's name, driver and device type from `configured.adapter`, never from the device: it records the configured adapter and judges its fixtures on the software adapter | 12 (issue-named) |
| `absolute_f32_world_positions` | The renderer uploads absolute f32 world positions (no f64 composition, nothing relative to the camera), so at 1e7 m vertices land on a 1 m grid and jitter by whole pixels | 13 (issue-named) |
| `light_cut_absolute_illuminance` | The light policy shades a point or spot light only while (power ÷ 4π) ÷ d², d its distance from the eye, is at least 0.05 lx: a cut that uses an absolute illuminance | 14 (issue-named) |

## The fixtures

Every document is generated in `helpers.ts` and written to a temporary folder; nothing is committed as a fixture file.
All draw through the base's `view3d` (BASE-FAILURE.txt: each test's fixture checks pass before the first new call).

| Relation | Fixture (`helpers.ts`) | Size, frame |
|---|---|---|
| `exposure-doubles` | `exposureFixture`: a floor, a crate and a ball under a casting sun (3 lx), a 600 lm point light and a sky with ambient light whose own `exposure` is written; filmic; looks at EV100 0 and −1 | 320 × 200, 0 |
| `lights-add` | `lightsFixture`: two 120 lm point lights 2 m over a white diffuse floor, 1 m apart, black sky, bloom off; alone each reads at most 0.76, together about 1.39 between them | 320 × 200, 0 |
| `ortho-shift` | `orthoFixture`: an orthographic camera looking along −Z, 4 m across 320 px (1/80 m a pixel), over two boxes turned 20° and 50° and a ball, all `unlit`, no light, black sky; `moved`'s camera target at (7, 3) pixels' worth of metres along +X and +Y, k = (7, −3) | 320 × 240, 0 |
| `sphere-turn` | `sphereFixture`: a `ball@1` of radius 1 m and 32 segments about its Y axis, roughness 0.35, under a 2,000 lm point light at (0, 4, 0) on that axis, black sky; `turned` is `at.rot: [0, 45, 0]`, a turn that maps the 32-segment mesh onto itself | 240 × 240, 0 |
| `occluder-never-brightens` | `occluderFixture`: a floor and a pedestal under a casting sun shining straight down, black sky; `with` adds an opaque slab 6 m up, outside the view, whose shadow falls in view | 320 × 200, 0 |
| `instances-keep-hash` | `instancesFixture`: one glTF (`partsGltf`) whose node 0 is a mesh of two parts (two cubes) and whose nodes 1 and 2 are the parts alone; `mesh` draws node 0 as the item `thing`; `instances` draws an `instance@1` named `thing` of the two parts, one instance of each, at the same place; `thing` slides 1 m/s; velocity blur on | 320 × 200, 15 of 30 fps |
| `translation` | `translationFixture`: a floor, a crate, a post, a ball and a box sliding 4 m/s under a casting sun and a 3,000 lm point light, a sky with ambient light, velocity blur on, filmic; `moved` adds (1e7, −3e6, 5e6) m to every item's position, the point light's, the camera's position and target and the slide's keys (the sun has a direction only) | 480 × 270, 15 of 30 fps |
| `light-level` | `lightLevelFixture`: a floor, a crate and a wall under a casting sun (50 lx), `lamp-near` (8,000 lm, 6.4 m from the eye) and `lamp-far` (800 lm, 11.3 m from the eye), both with a written range of 30 m, a sky with a gradient and ambient light and its own `exposure` written, an emissive box, bloom `{intensity: 0.04, radius: 0.85}` with no threshold; `scaled` multiplies the sun's illuminance, both powers, the sky's four colors and the emission's strength by 1/100, with the look's EV100 lower by log2 100 | 320 × 200, 0 |

Under `light_cut_absolute_illuminance`, `lamp-far` reads 0.50 lx at the eye in `base` (kept) and 0.005 lx in `scaled`
(cut), while `lamp-near` reads 15.7 and 0.157 lx (kept in both): the planted cut changes `lamp-far` alone.

## Readings where the issue and design leave a choice

- **"Exposure +1 EV" and "raising exposure by log2 100 EV" mean more exposure**: the scale on linear light doubles per
  EV. The look's `exposure` field is an EV100, whose scale is 1 ÷ (1.2 × 2^EV100), so one stop more exposure is that
  number less 1. Criterion 14 fixes the direction: lights at 1/100 are undone only by 100 times the scale.
- **"Before tone mapping" and "after exposure"** are one image: linear light after exposure, which the base has no
  target for (`pre_tone` is before exposure). Hence `exposed`.
- **The sky under a changed exposure.** A sky takes the look's exposure unless its own is set (Sky `sky@1`), so its
  gradient would move against the look's. The fixtures that change exposure write the sky's own `exposure`, so the sky
  is a fixed light and "scaling the sky by 1/100" scales its four colors.
- **Criterion 10 gives its float relations no tolerance.** "Equals", "doubles" and "keeps" are held within 2⁻⁹
  relative per channel (two steps of a 16-bit float, the base's linear target format), and "never raises" as
  `with` ≤ `without` × (1 + 2⁻⁹). Criterion 14's 1e-4 relative is the issue's own and is used as written, with no
  absolute floor: |a − b| ≤ 1e-4 × max(|a|, |b|) on R, G and B. A 16-bit float target can't hold 1e-4 (its steps are up
  to 4.9e-4 relative), so `exposed` needs more precision than the base's rgba16float `linear` for that relation.
- **Light ranges.** The design's automatic range ends a light where it falls to 0.05 lx, an absolute illuminance,
  which a light at 1/100 doesn't keep; the issue says light-level invariance catches "any cut, range or threshold that
  uses an absolute light level". The fixture writes every local light's `range`, so the relation holds whichever way
  the automatic range is settled; the planted cut is the criterion's wrong program.
- **"Its axis" and the turn.** A `ball@1` is a mesh of `segments` around its Y axis, so only turns by a multiple of
  360° ÷ segments map it onto itself; the fixture turns 45° with 32 segments.
- **"Any receiver's direct light"** is read with the added item outside the view, so every pixel shows the same
  receiver in both frames, under a black sky, so the lighting-only frame holds direct light alone. The lighting-only
  mode "never feeds a check" in the design (Render-back: diagnostic modes); here the lane reads its linear frame for
  a relation of the suite, not for a claim.
- **"A mesh split into instances of its parts"** is one mesh item of two parts against an `instance@1` of those parts,
  one instance each, under the same item ID, compared in every target the Scope lists. Color, normal, depth and
  velocity are compared byte for byte and by pixel hash. The ID target can't be: at the base it holds one pick ID per
  instance (`thing#0`, `thing#1`) against the mesh's one (`thing`), so its bytes differ by design. It is compared by
  item instead: the same item at every pixel, which still catches an instanced path that leaves its instances out of
  the ID pass.
- **"Naming the relation"** is the lane's own `FAIL` carrying the relation's name in `reason`; "naming the item" and
  "naming the light" are `first.item` and `first.light`, also in `reason`.
- **"Forced onto a software adapter by its loader setting"** is the Vulkan loader's driver setting, which exists on
  Linux only: macOS has no loader and no software rasterizer (design: How it installs). The first test holds the
  lane's rule and its planted twin on the seam's software test adapter, which the seam reads from the device as it
  reads any adapter; the second holds it on a real one and is BLOCKED on this Mac.
- **"No golden is compared or blessed"** is read three ways at once: the lane's own lists are empty, a blessing asked
  as yours is refused, and a golden blessed on hardware is not compared.
- **Small sizes.** The criteria give no frame size for 10, 13 and 14; the fixtures use 240 to 480 px frames and one
  frame each.

## Not covered, and why

- A real software adapter on this Mac: none can be had (criterion 12's second test is BLOCKED here).
- That the release preflight's full lane runs the relations, and that no live view or export does (the Scope's last
  bullet): the lane's runner and report are the suite group's; here only `full_lane`'s fixture list is held to name
  the eight relations.
- The adapter's driver in the run's record beyond its presence in `adapter`: Metal reports an empty driver on this Mac.
- Spots, area lights, IES and light functions in the light-level fixture: the criterion names powers, the sky and
  emission; the fixture holds a sun, two point lights, a sky and one emissive item.
