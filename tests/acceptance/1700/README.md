# Acceptance tests for #1700: geometry.shape, a part's true shape read as counts and measures

These tests were written before any implementation existed. The writer had issue #1700 (its scope, readings, fields,
eight acceptance criteria and its proof line: "The window through both build routes, the posts, the gear and the
flipped box, each reading beside its planted wrong program"), the design sections it links, the sections those lean
on, and base commit `fb993a5eb` ("design(#1700): geometry.shape joins the core's check kinds …"). It never saw the work.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file and one test per criterion, each holding the planted wrong program
its criterion names, and no other case.

**Not run against a binary.** The machine's load was 190 to 260 on 18 cores, so no Rust was built and the suite wasn't
run at the base. `BASE-FAILURE.txt` says why each test fails there, read from the base's code. The type-check passes. A
scratch script (not kept) checked the fixtures' own numbers: the cut window's weld, genus and volume, the boxes' volume
and flipped edges, the gears' hull stretches, the posts' areas and the budget torus's triangle count, lowest point,
volume and section (README: Fixtures).

## What was read

- Issue #1700, as the job's brief gave it.
- `docs/canvas-primitives.md`:
  - What holds a document to its rules: issues as data, `{check, code, severity, ids, path, actual, t, what, fix}`.
  - Check input, and Check input: shape readings (its fields, `expect`, results, the `geometry.reading` issue,
    semantics, cost, "It can never" and Lands).
  - Builder (`slab`, `lathe`, `extrude` and `mesh.asset`), Asset: meshes, and Asset job: modeling, simulation and
    render kinds (a boolean is an offline job whose mesh asset an item places).
- `docs/technical-design.md`: How we know version 0 works (Criteria to tests both ways, Criteria in a checked shape,
  Wrong programs, the edit guard and Dogfooding).
- At the base:
  - `AGENTS.md`.
  - `crates/deep-show`: `main.rs`'s scenario (`docs`, `claims`, `planted`, whose unknown value is `bad_input`) and
    `verdict.rs`'s `judge`, where a kind neither in `CORE_CHECK_KINDS` nor registered by a module is BLOCKED
    `module_missing`, and `judge_audit`'s row with `timing.check_ms`.
  - `crates/deep-canvas/src/registry/mod.rs`: `CORE_CHECK_KINDS`, which at the base doesn't list `geometry.shape`.
  - `crates/deep-canvas-scene3d`: `builders.rs` (`slab`, `extrude`, `lathe`, `layered` and their counts) and
    `scene.rs`'s item transform (`at.pos`, `at.rot`, `at.scale`).
  - `scripts/proof-change.mjs` (`criterionId`), `proof-runs.mjs` (twins and "at its assertion"), `benchmark.mjs`
    (`judgeLimit`, `fingerprint`) and `lanes.mjs`.
  - The earlier blind suites `405/` and `1936/` (geometry.audit, stored scenes, budgets) and `453/` (glTF fixtures
    written at test time, results on a requirement's row), the models for this layout.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds these lines to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside the folder.

```js
// #1700's files each build deep-show; budgets.test.ts also builds it in release and times every geometry.shape
// reading against the lane's rule.
alone.push('tests/acceptance/1700/');
timed.push('tests/acceptance/1700/budgets.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1700 --no-file-parallelism --testTimeout=600000 <file>
npx tsc -p tests/acceptance/1700/tsconfig.json   # type-check
rm -rf tests/acceptance/1700/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`. It
  sets `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, copies the binary out of `target/`
  (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. Every `it` passes its own timeout.
- **Release build.** `budgets.test.ts` also builds `--release`, but only on a machine `judgeLimit` says can judge a
  timing now.
- **Processes.** The tests start only `cargo` and `deep-show`. The glTF fixtures are written by Node at test time, so
  nothing binary is committed.
- **Isolation.** Every test writes into temporary folders and deletes them. The suite uses Node built-ins and vitest
  only, and no network.
- **No decision.** A test that can't decide here fails with a message starting `INCONCLUSIVE:`. It never passes.

## The surface under test

**No new binary.** The suite drives the #393 `deep-show run` (one scenario line in, one answer line out), with the #96
stored documents in the scenario's `docs`, the #403 scenario `claims` and `requirements`, and its
`{"call": "verdict", "claim"}`. Every name below that the issue and design don't give is this job's choice, listed
again under Names this job chose. An implementation builds exactly these, or disputes them.

### The scenario

- `evidence` is a fresh folder per run. A glTF fixture is kept there by SHA-256 at `<first 2 hex>/<other 62 hex>`, as
  #453's suite keeps it.
- `docs` holds each fixture as a stored scene document, opened as revision 0 on the panel `main`:
  `{format: 1, profile: scene, title, description, size, requires: {modules: {scene3d: "^1"}}, layers: {you-main:
  {writer: "you:you", …}}, items}`. Each item carries its `id`, `name`, `order` and `layer`.
- `claims` holds one claim of the working agent alpha (`sess-alpha`) per document, the document its one deliverable,
  its locked definition one or more requirements `{id, check}`.
- `planted` names a planted wrong program, or is absent.

### The check, as a claim's requirement

Each requirement's `check` is the design's Check input of kind `geometry.shape`:
`{kind: "geometry.shape", of: ID | [ID], readings: [reading], expect: {reading → value | [min, max]}}`, read at the
start (no `at`; no fixture moves).

- A reading is `"parts"`, `"closed"`, `"holes"`, `"volume"`, or a one-key object: `{section: {axis, at}}`,
  `{probe: {from, dir}}`, `{tips: {axis}}`, `{rests: {on}}`.
- `expect` keys a reading by its name (`section`, `probe`, `tips`, `rests` for the object readings). A volume is
  always given as `[min, max]`, since the design says only that a count or a flag compares exactly.
- Where a reading's expected value differs within one check (the probes through holes and through the bar, the two
  gears, the two cubes), each is its own requirement of the same claim.

### The verdict's row

The requirement's row (the #403 `{id, kind, result, blocked?, issues}`) is decided: never BLOCKED with
`module_missing`, as it is at the base.

**Results.** The design's `results: [{reading, path: "readings/<i>", ids, value}]` sits on the row. A test finds a
reading's results by `path` alone, `readings/<i>` exactly, `i` the reading's index in the check's `readings`.
- `value` is the count, the flag or the m³, or the string `"unknown"`.
- `closed`, `holes` and `volume` give one result per part, and every fixture here is one part, so each reads one
  result. A part is named `<item>#<n>` in `ids`, `n` any whole number.
- An open part's results carry `edge`, two world points `[[x, y, z], [x, y, z]]`, and `faces`, triangle indices in
  the item's own order (the glTF primitive's).
- `section` carries `loops: [{area, centroid}]` and `open`, read as a count or as a list whose length is the count.
- `probe` carries `entry` and `exit`, in m along `dir` from `from`.
- `rests` carries `gap`, in m.

**Issues.** A reading that differs from its expected value raises `geometry.reading`. Its fields `ids`, `path`,
`reading`, `expected` and `actual` sit on the issue itself.
- `path` is `readings/<i>`, alone or at the end of a longer path.
- `reading` is the reading as the check names it: the string for a plain reading (`"holes"`, `"volume"`), the
  one-key object for the others (a test reads that it mentions `section` or `probe`).
- `expected` is the value as `expect` gave it; `actual` is the result's `value`.

**Result.** PASS when every expected reading holds; FAIL when one differs; INCONCLUSIVE when a reading the check
expects is `unknown`.

**Timing.** Each row reports `timing: {check_ms}`, in ms, from the evaluated arrays to the compared results, as the
design's Cost says, and as #405's geometry.audit row reports it.

### The planted programs (the scenario's `planted`, reachable only there)

The implementer adds each to the planted names `deep-show run` accepts. Any other value stays `bad_input`, as the base
answers an unknown one. `twins.json` maps each criterion to its planted name. No Cargo test feature is needed: every
test builds `full`.

| Name | The wrong program | Criterion |
|---|---|---|
| `holes_count_face_contours` | `holes` counts the inner contours of a part's flat faces (each hole shows one on the front and one on the back) in place of the genus; everything else as shipped | `#1700.7a26c76e` |
| `asset_read_unplaced` | a `mesh.asset@1` item's triangles are read as its glTF file holds them, without the item's placement (`at`), while a builder's item is placed as shipped; everything else as shipped | `#1700.c01ffdd0` |
| `volume_sums_flipped_faces` | `volume` sums every triangle's signed volume as wound, on a part that isn't closed too, so a part whose winding is wrong reads a number, never `unknown`; everything else as shipped | `#1700.3deedc17` |
| `section_leaves_segments_unjoined` | `section` reports each segment the plane cuts as an open chain of its own, never joining segments into loops; everything else as shipped | `#1700.84bd8888` |
| `probe_tests_bounds_only` | `probe` meets the item wherever its line crosses the item's bounds, never testing a triangle; everything else as shipped | `#1700.77550f02` |

## Criteria to tests

IDs are `#1700.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them (trimmed, whitespace collapsed); this job computed all eight and they equal the issue's. Each file holds
its criterion's ID as `const ID`, and its one test's name starts with `${ID}`. Each file's header states its
fixtures, numbers and planted program in full.

| ID | File | What it asserts |
|---|---|---|
| `#1700.7a26c76e` | `holes.test.ts` | The extruded window PASSes `{parts: 1, closed: true, holes: 4}`, reading 1, true and 4, the per-part results naming `window#<n>`; the 1 m cube reads holes 0 and the torus holes 1, each PASS. Under `holes_count_face_contours` the window reads holes 8 and FAILs, a `geometry.reading` on readings/2 naming `window#<n>`, `holes`, expected 4 and actual 8. |
| `#1700.c01ffdd0` | `routes.test.ts` | The extruded window and the cut window each PASS `{parts: 1, holes: 4, volume: [0.0839, 0.0841]}`; their parts and holes are equal and their volumes within 1e-9 relative. Under `asset_read_unplaced` the extruded window still PASSes, the cut window reads volume 84 and FAILs, a `geometry.reading` on readings/2 naming `volume`, expected [0.0839, 0.0841] and actual 84. |
| `#1700.3deedc17` | `volume.test.ts` | The box reads 1 m³ and the extruded window 0.084 m³, each within 1e-12 relative, each PASS. The flipped box reads closed false (PASS of `{closed: false}`) and volume `unknown` (INCONCLUSIVE of `{volume: [1 ± 1e-12]}`), naming `flipped-box#<n>`; both results name `faces` [2, 3] and an `edge` around the flipped face; the claim isn't PASS. Under `volume_sums_flipped_faces` the volume is a finite number and the requirement FAILs, a `geometry.reading` naming `flipped-box#<n>`, `volume` and that number. |
| `#1700.84bd8888` | `section.test.ts` | The five posts PASS `{section: 5}` for a section along y at 0.1 m: value 5, five loops each of area 0.01 m² within 1e-12 relative, `open` 0. Under `section_leaves_segments_unjoined` the section reports `open` above 0 and fewer than 5 loops and FAILs, a `geometry.reading` on readings/0 naming the section, expected 5 and actual the loops read. |
| `#1700.77550f02` | `probe.test.ts` | On the extruded window, four probes along +z through the holes' centres PASS `{probe: false}`, each false, and one through the bar's centre PASSes `{probe: true}` with `exit − entry` 0.1 m within 1e-9 m. Under `probe_tests_bounds_only` each hole probe reads true and FAILs, a `geometry.reading` on each probe's own readings/<i> naming the probe, expected false and actual true. |
| `#1700.542d9581` | `tips.test.ts` | The 12-tooth gear reads tips 12 around z and the gear with one tooth removed 11, each PASS. No planted program is named. |
| `#1700.44a11d63` | `rests.test.ts` | The 0.3 m cube on y = 0 reads rests true; the cube raised 2 mm reads false with `gap` 0.002 m within 1e-9 m, each PASS. No planted program is named. |
| `#1700.b24f5071` | `budgets.test.ts` | On this machine each of the eight readings on the closed 100,000-triangle torus is its own requirement and PASSes with its own `timing.check_ms`. If `judgeLimit` can judge a timing now: a release build, one warm-up, five fresh processes, each deciding as above; each reading's `check_ms` judged against 50 ms and the section's also against 10 ms. None may FAIL; anything else is `INCONCLUSIVE:`. |

## Fixtures

Metres, +Y up, every document a stored scene. Each fixture's route, and why it holds the precision its criterion
states:

- **The extruded window** (`windowDoc`, item `window`): `extrude@1 {outline: the 1 × 1 m square about the origin,
  holes: four 0.2 m squares centred at (±0.25, ±0.25), depth: 0.1}`. The base's extrusion lifts the outline's
  (x, y) to z = 0 and z = 0.1 with no rotation, so every position is a decimal the document gives, read in f64. Its
  volume is 0.1 − 4 × 0.004 = 0.084 m³; a sum over its triangles in f64 errs near 1e-16, far inside 1e-12.
- **The cut window** (`cutWindowDoc`, item `cut-window`; `gltf.ts` `cutWindow`): a boolean of a slab and four cuts
  has no builder at the base, and the design makes a boolean an offline job whose mesh asset an item places, so the
  cut window is the glTF such a job would leave, written by the test into the evidence store and placed by
  `mesh.asset@1`. A glTF holds f32 positions, and 0.1, 0.15 and 0.35 aren't exact in f32 (0.1 m stored as f32 is off
  by 1.5e-8 relative, past the criterion's 1e-9), so the file is in decimetres, every coordinate a multiple of 0.5,
  and the item places it at `at: {scale: [0.1, 0.1, 0.1]}`, f64 in the document. Placed, it is the same surface as the
  extruded window within 1e-16 relative. Its faces are the cut's grid (21 cells a side, four walls a cut, each outer
  side split at the grid's lines), every quad its own four vertices with a flat normal, so only a weld joins them: 156
  triangles, 312 vertices welding to 72, genus 4, 84 dm³. Checked by the scratch script: every edge held by exactly
  two triangles in opposite directions after the weld, and the placed volume 0.084 within 1.7e-16 relative.
- **The cube** (`cubeDoc`, `cube`): `slab@1 {size: [1, 1, 1]}`. **The torus** (`torusDoc`, `torus`): `lathe@1` of a
  closed 32-point circle of radius 0.25 m centred 1 m out, 32 segments; holes is a count, so its faceting doesn't
  matter.
- **The boxes** (`boxDoc` `box`, `flippedBoxDoc` `flipped-box`; `gltf.ts` `box`): no builder at the base winds one
  face backwards, so both boxes are glTF meshes placed by `mesh.asset@1`, written from the same corners and triangles
  so they differ only in that face. Corners at x ±1, y ±0.5, z ±0.25, exact in f32, so the closed box's volume is exactly 1
  m³. The flipped box winds triangles 2 and 3 (its +Z face) backwards; the scratch script found the four edges around
  that face each held twice in one direction, every other edge fine, and the as-wound sum 2/3 m³.
- **The posts** (`postsDoc`, `post-1` … `post-5`): `slab@1 {size: [0.1, 1, 0.1]}` standing on y = 0 at x = −1, −0.5,
  0, 0.5 and 1. A section at y = 0.1 cuts only their sides, each loop 0.1 × 0.1 m in f64, within 3e-15 relative of
  0.01 m².
- **The gears** (`gearsDoc`, `gear`, `gear-11`): `extrude@1 {outline: gearOutline(), depth: 0.05}` and the same with
  tooth 0 left out, 2 m along x (README: Readings for the profile). The scratch script found 12 and 11 stretches of
  each outline on its convex hull.
- **The resting cubes** (`restingDoc`, `cube`, `raised`): `slab@1 {size: [0.3, 0.3, 0.3]}` at the origin, its lowest
  face on y = 0, and at `[1, 0.002, 0]`, its lowest face 0.002 m up (0.002 in f64).
- **The budget torus** (`bigTorusDoc`, `torus`): `lathe@1` of a closed 250-point circle of radius 0.25 m centred 1 m
  out, 200 segments, placed 0.25 m up. The base's lathe makes 2 triangles a segment for each band of a closed outline,
  so 250 × 200 × 2 = 100,000 triangles (its `lathe_count`), and 100,500 vertices before the weld, under the builder's
  cap. The scratch script found its lowest points 2e-5 m above the ground, its faceted volume about 1.2333 m³, and no
  ring of vertices at y = 0.26.

## Readings where the issue and design leave a choice

- **Stored documents, one claim each.** Item IDs are one document's, so every fixture is its own document and each
  claim has one deliverable. The windows, boxes and gears could share documents; separate ones keep each reading's
  surface alone, and every probe, edge and gap in world space as the headers state it.
- **The window's place and holes.** "A 1 × 1 × 0.1 m slab with four 0.2 m square through holes along z" doesn't place
  the holes. They're centred at (±0.25, ±0.25), so each bar between two holes is 0.3 m wide, and "the bar between
  holes" is the one between the two upper holes, centred at (0, 0.25).
- **"0.5 m apart"** reads as centre to centre.
- **"A 0.3 m cube at y = 0"** reads as its lowest face at y = 0: it rests on the ground there. "Raised by 2 mm" moves
  it 0.002 m up.
- **The gear profile.** The issue gives the radii, the tooth count and the extrusion. Tooth k is centred at 30k°; its
  flanks run from the root radius 0.42 m at ±9° to the outer radius 0.5 m at ±5°, its top a straight land between
  its two outer corners, and each two teeth are joined by a straight root. "One tooth removed" leaves tooth 0 out and
  joins its neighbours' roots straight across. Every top land is a stretch of the outline on the hull, and no root
  point reaches the hull (the hull's chord lies 0.492 m from the centre between two teeth, 0.453 m across the gap).
- **"Naming the face".** The box's face is its +Z quad, two triangles; `faces` lists both, [2, 3] in the file's
  order. "Its first open edge" is any of the four edges around that face, since the design doesn't order edges.
- **The flipped box's two checks.** "Reads closed false" is a requirement `{closed: false}`, which PASSes; "a check
  that needs its volume" is `{volume: [1 − 1e-12, 1 + 1e-12]}`, which is INCONCLUSIVE, and the claim holding both
  isn't PASS.
- **"Fails, naming the part / the reading / the probe / the section"** reads as the planted run's requirement FAILing
  with a `geometry.reading` issue that names it: the part in `ids` as `<item>#<n>`, the reading in `reading`, the probe
  and the section by `path` `readings/<i>` and a `reading` that mentions it.
- **"Both values"** (criterion 2) are the issue's `expected` and `actual`: under `asset_read_unplaced` the cut window's
  volume reads the file's 84 against [0.0839, 0.0841], while the extruded window, built by a builder, still passes.
  The route is what differs: an asset read without its placement.
- **"Returns a number"** (criterion 3) is a finite `value` where the true program reads `unknown`. The number isn't
  pinned (2/3 m³ about the origin), since a sum over a surface that isn't closed depends on its reference point.
- **"Reports open chains instead of loops"** is `open` above 0 and fewer than 5 loops.
- **"Meets the slab through every hole"** is each hole probe's value true; the window's bounds hold every hole.
- **"Every reading … takes under 50 ms"** reads as each reading timed on its own: one requirement per reading, each
  row's own `timing.check_ms`. The eight readings are all the issue lists, each with an expected value so each is
  decided and proven to have read the whole part. "One section under 10 ms" is the section's own row judged against
  10 ms as well.
- **"On the reference Mac in the local preflight"** is `judgeLimit`'s rule: five runs after a warm-up, each a fresh
  release process. PASS is possible only on a reference Mac under its conditions; anything else is INCONCLUSIVE.
- **"Compared with the merge base"** reads as the preflight's edit guard running this file on the merge base too, as
  it does every new test. There no module registers `geometry.shape`, every row is BLOCKED, and the test fails; the
  base has no reading whose time a regression could be measured against.

## Names this job chose

None of these is in the issue or the design; an implementation builds them as written, or disputes them.

- **Planted names:** `holes_count_face_contours`, `asset_read_unplaced`, `volume_sums_flipped_faces`,
  `section_leaves_segments_unjoined`, `probe_tests_bounds_only`, each the scenario's `planted`.
- **Result and issue shapes assumed:** `results` on the requirement's row; `value: "unknown"` as a string; a part as
  `<item>#<n>` with `n` a whole number; an open part's `edge` as two `[x, y, z]` points and `faces` as numbers;
  `loops[].area`; `open` as a count or a list; `entry`, `exit` and `gap` as numbers on the result; the
  `geometry.reading` issue's `ids`, `path`, `reading`, `expected` and `actual` on the issue itself, its `path`
  `readings/<i>` alone or ending a longer one; `timing.check_ms` on each row.
- **Item IDs:** `window`, `cut-window`, `cube`, `torus`, `box`, `flipped-box`, `post-1` to `post-5`, `gear`, `gear-11`,
  `raised`.
- **Document, claim and requirement IDs:** `01JB1700D…`, `claim:01JB1700C…`, `req:01JB1700Q…`, numbered per file; the
  layer `you-main`; the session `sess-alpha`.
- **Helpers and fixtures:** in `helpers.ts`, `useBuild`, `buildInto`, `useFolders`, `putEvidence`, `putMesh`, `run`,
  `scenarioOf`, `claimOf`, `verdict`, `shape`, `section`, `probe`, `tips`, `rests`, `rowOf`, `decided`, `resultsAt`,
  `oneAt`, `readingIssuesAt`, `namesPart`, `countOf`, `point`, `nearRel`, `nearAbs`, `stored`, `windowDoc`,
  `cutWindowDoc`, `cubeDoc`, `torusDoc`, `boxDoc`, `flippedBoxDoc`, `postsDoc`, `gearOutline`, `gearsDoc`,
  `restingDoc`, `bigTorusDoc`, `judgeLimit`, `load`, `timingOf`; in `gltf.ts`, `glb`, `cutWindow`, `box`,
  `BOX_CORNERS`, `FLIPPED_FACE`, `FLIPPED_Z`.

## Not tested

No criterion asks for these, so none is tested:

- **Readings:** `at` other than the start; a section's `centroid`; a probe's `entry` alone; `rests {on: ID}` and its
  `unknown` when the item lies under none of the lowest points; `[min, max]` on a count.
- **Inputs:** an ID the document lacks (INVALID), an item with no triangles (BLOCKED), a check with no `expect`
  (INCONCLUSIVE), more than 16 readings, and the weld's tolerance at its edge.
- **Other routes:** a mesh edit, an imported asset that isn't a boolean's output, and a primitive mark.
