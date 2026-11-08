# Acceptance tests for #427: 3D diagnostic modes — deep_show's lighting, overdraw, cascades, bounds, lights and cameras, and the UV checker

Written first, from issue #427 (its scope, its eight acceptance criteria and its proof line), the design sections it
links and those they lean on, and the base commit `9d31efdb` ("Merge pull request #1642 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). The owner asked for a lean suite: one file per criterion, at most two
tests each, with the planted wrong programs the criteria name.

## What was read

- Issue #427; its epic #310 and parent #78 for context; its dependencies #411 (deep_query, deep_show's modes) and #425
  (levels of detail by error, the `simplify` job), both merged on this base.
- `docs/canvas-primitives.md`: Render-back (the reply's `rev`, snapshots by hash, "a table of visible item IDs with
  screen boxes", "never … touch the live session"); Render-back: diagnostic modes (the closed list, `drawn` "by stable
  ID, with its world position", "draw from a cached pose or an earlier frame", "the UV checker shades every surface with
  a two-role checker of 8 cells per uv0 unit", "never a status color", "none of it feeds a check or counts as
  evidence"); Meter and degrade ladder (rungs; canonical renders never step); Level of detail: levels by error (the
  simplify job's levels, the probe's `lod_errors`); Light and the light policy (spot `inner`, `outer`); Light probe
  `light.probe@1` (`type: reflection | irradiance`, stored captures and bakes; "figures and data views refuse probes");
  Emitter (`item`, `src`, `distance: {model, ref, max, rolloff}`, `cone: {inner, outer, outer_gain}`); the document
  envelope's `transport.frame_rate = 60/1`; Replica and render-back probes for the hierarchy built for surface hits.
- `docs/technical-design.md`: Dogfooding (blind acceptance jobs, taste calls).
- At the base: `crates/deep-show/src/modes.rs` (#411: the closed list `MODES`, only `bounds` drawn, every other mode
  `module_missing`; a mode reply is #411's `show_call` reply plus `mode`, `display_only`, `snapshots`, `drawn`, `next`;
  the mode call goes through `show_call`, which mints a revision), `hub.rs` (`show`: every deep_show mints the next
  revision; the 3D `visible` table), `main.rs` (the deep_show parse: `document` required, `mode` only from `MODES`,
  #412's `cursor`; the scenario's `planted`), `verdict.rs` (#464: a requirement whose check names a snapshot held as
  display only is refused `{code: display_only, snapshot}`), `watch.rs` (`deep-show live`'s `live` object: `after`
  calls each `after_ms` past the first presented frame, each entry's `showing` and `presented`; the frame clock's
  `wakeups`), `scene3d.rs` (3D render-backs on the GPU); `crates/deep-gpu-layer` (`simplify.rs`: `extras.lod`,
  `lod_errors` as meshopt's relative error; `live.rs`, `view3d.rs`, the `--planted` table, read for surfaces);
  `crates/deep-canvas-scene3d` (`builders.rs`: `ball@1`'s UV vertices and normals; `spatial.rs`'s hierarchy; `gltf.rs`
  reading `TEXCOORD_0`); `crates/deep-gpu/src/meter.rs` (rungs); and the suites `tests/acceptance/411`, `425`, `422`,
  `378`, `1325`, `140/view` (`liveRun`, `after`) and `464` (a claim citing a display-only snapshot) for layout, helpers,
  INCONCLUSIVE handling and the taste call.

## What the base already does, which these tests don't credit

deep_show takes `mode` from #411's closed list and draws `bounds` from the core's 2D boxes, with a display-only snapshot
and `drawn` rows; every other mode, the 3D ones included, answers `module_missing`. A mode call carries a document and
mints a revision. The bounds snapshot isn't held as display only, so a claim citing it isn't refused. `deep-show live`
plays `after` calls into the shown window's hub and reports `showing` and `presented` per call, but not the frame
callbacks or a meter rung. `deep-gpu simplify` gives index-only levels and meshopt's relative error, not a measured
distance. There are no deviation, tangents, probes, sound sources, motion paths or pick hierarchy modes, no
`light.probe@1`, and no emitters.

## Run them

They build `deep-show` and (for `deviation`) `deep-gpu` with `cargo build --locked --bin <name>`, as #378's and #464's
suites do, and `live`, `quiet` and `paths-picks` open the app's real window through `deep-show live`, so they run one
file at a time. `scripts/lanes.mjs` needs `'tests/acceptance/427/'` added to its `alone` list; this README is the
instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/427 --no-file-parallelism --testTimeout=1800000
node node_modules/typescript/bin/tsc -p tests/acceptance/427/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS each fails with a message starting `INCONCLUSIVE:`, never passes.
A Mac with no display for `deep-show live` (`no_display`) is INCONCLUSIVE too. Nothing compares times, and nothing is
gated on power or load. `taste.test.ts` writes into `docs/evidence/427/` and keeps what it writes; every other test
writes into its own temporary folder and deletes it.

The suite wasn't run against the base: its calls plainly don't exist there (a mode call without a document doesn't
parse, the new modes aren't on the closed list, the 3D modes answer `module_missing`, `live`'s entries lack `wakeups`
and `rung`), so there is no BASE-FAILURE.txt. Typecheck passes.

## The fixtures

All generated by the tests (`helpers.ts`), none on disk. Scenes are `profile: scene` work-product documents with a
`camera@1`, painted in grey roles only, so any status color in a snapshot comes from the mode.

- **The still cubes** (AC1): `cube.a`, `cube.b`, `cube.c` on a ground slab, a casting sun and two point lights; shown 12
  times (each revision's description names its number), then revision 13 replaces `cube.b` with `cube.d` at (0, 0, 0)
  with the same size, keeping 8 items.
- **The sliding cube** (AC2): a 1 m `mark.box@1` whose channel moves x linearly from 0 at 0 s to 2 at 1 s (span 2 s);
  `spot`, a `light.spot@1` with `parent: cube` at (0, 1, 0); `plate`, a glTF plate 2 × 1 m in the XY plane, 2 × 1 quads,
  uv0 in metres from its corner (u 0–2, v 0–1).
- **The sphere and its simplification** (AC4): a capped UV sphere, radius 0.5 m (1 m across), 100 segments by 101 rings,
  20,000 triangles; `simplify` with `levels: [{ratio: 0.01, max_triangles: 200}]`; the level's indices over the source's
  vertices make the simplified glTF. **The bulge**: a flat 2 × 2 m plate of 4 × 4 quads (the reference) and the same
  plate with vertex 6 (grid (1, 1)) raised 0.1 m; the faces around it are computed from the indices, face `2q` and
  `2q + 1` for quad `q`.
- **The UV sphere** (AC5): scene3d's `ball@1 {tessellation: uv, radius: 0.5, segments: 32}`, 561 vertices. **The
  plates**: glTF meshes of two 1 × 1 m quads in the XY plane facing +z, each quad its own 4 vertices; `plate` with u
  along +x and v along +y; `mirror` the same with its left quad's (vertices 0–3) u running along −x.
- **Probes and voices** (AC6): `probe.irr` (irradiance) at (−2, 1, 0); `probe.refl` (reflection) parented to a box at
  (2, 0.5, −1), authored at (0, 1, 0), so at (2, 1.5, −1) in the world. Two emitters on small boxes, each with its own
  cone and distance.
- **The moving box** (AC7): x keys 0 → 1 → 0 m at 0, 0.5, 2 s, z 0 → 1 m over 0–2 s, linear; **the grid**: 24 boxes of
  0.4 m, 6 × 4, 1.5 m apart.
- **The taste scene** (AC8): three boxes on a ground slab, a casting sun, a spot, two point lights and the glTF plate.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with its ID.

| AC | ID | File | What it asserts, and the wrong programs it catches |
|---|---|---|---|
| AC1 | `#427.eec6bc2e` | `live.test.ts` (2) | `deep-show live` at revision 12: between two `presented` reads around 20 overdraw/lights_per_cluster calls, each reply presented at rev 12 with a snapshot, the window's `showing`, `presented`, `wakeups` and `rung` don't move; revision 13 replies rev 13 and the next overdraw call names rev 13 with `cube.d`, not `cube.b`, in `visible`. Planted `mode_draws_live_surface` fails on the frame callbacks; `mode_ids_by_count` fails naming `cube.d`. Catches: the base; a mode that mints a revision, draws on or wakes the live view, steps its meter, or reuses an ID table |
| AC2 | `#427.341d687d` | `positions.test.ts` (2) | At 1 s: the cube's bounds row at (2, 0, 0) m, centred there, x from 1.5 to 2.5 within 1e-6; the spot's lights_cameras row at (2, 1, 0) m; the plate's uv_checker row `cells: [16, 8]`, `per_unit: 8`. Planted `bounds_authored_position`, `lights_local_position`, `checker_fits_surface` each fail naming `cube`, `spot`, `plate`. Catches: the base; a mode reading authored or local transforms or an earlier frame; a checker fitted to the surface |
| AC3 | `#427.dff2871f` | `quiet.test.ts` (1) | `quietProblems` over lights_cameras, bounds and uv_checker: no snapshot pixel within 2 per channel of the clean look's pass, fail, invalid or running color; with the app showing revision 1, the window's revision, frames, frame callbacks and rung unchanged across the three, each at rev 1 with the run's snapshot; a claim citing each snapshot gets verdict rows not PASS carrying `display_only` and the snapshot's hash. Catches: the base; a status color; a mode that mints or touches the live view; a snapshot a claim can cite |
| AC4 | `#427.43a16f33` | `deviation.test.ts` (2) | The sphere: `largest_m` equals `simplify`'s `measured_m[1]` within 1e-6, is at least the geometric floor, equals the larger way and `worst[0]`; the legend's top reads it in metres; `mean_m` in (0, largest]; 10 worst faces, worst first. The bulge: `largest_m` 0.1 within 1e-6 at a face around the peak; planted `deviation_one_way` reports less than 0.1 and fails naming the first face around the peak; a reference hash the store lacks answers `reference_missing` naming it, with no snapshot. Catches: the base; a one-way measure; a probe and a mode that disagree; a plain render for a missing reference |
| AC5 | `#427.6de2b260` | `normals.test.ts` (2) | 561 normal rows, one per vertex, each from the vertex the test computes to vertex + 0.05 m × its normal within 1e-6 (paged by #412's cursor); planted `normals_from_faces` fails naming vertex 0. Tangents: `plate`'s 8 rows (1, 0, 0) with `w` +1; `mirror`'s left-half rows `w` −1 and right-half rows (1, 0, 0) with +1. Catches: the base; face normals; wrong length or origin; tangents not from uv0; lost handedness |
| AC6 | `#427.88bc74a6` | `probes-voices.test.ts` (2) | Each probe's row at its world position (the parented one at (2, 1.5, −1)), with its type and `data`, a hash the evidence store holds, different per probe. Each voice's row at its item's position with `inner`, `outer`, `outer_gain` and `range` (its `distance.max`) equal to its fields. Catches: the base; authored positions; shared or missing probe data; fields not the voice's |
| AC7 | `#427.f8669ef0` | `paths-picks.test.ts` (2) | The mover's path: 121 samples at k × 11,760,000 flicks, each at the position computed from the keys within 1e-6, ticks at 0, 0.5 and 2 s on the path. The pick hierarchy to depth 64: leaf boxes as many as `hierarchy.leaves`, every box inside one; to depth 2, no box deeper. Then `quietProblems` over deviation, normals, tangents, probes, sound sources, motion paths and the pick hierarchy. Catches: the base; samples not at the frame rate or not evaluated; ticks off the keys; a drawn hierarchy that isn't the one built; any new mode that draws a status color, mints, touches the live view or can be cited |
| AC8 | `#427.78a8171b` | `taste.test.ts` (1) | Writes the six modes' snapshots from this run's evidence store, byte for byte, then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Assumed surfaces

The issue and design name the behaviors but not these calls and fields; each is this job's choice, the most natural one
beside the base's own calls. The implementer provides exactly these.

1. **A mode call draws the current revision and mints none.** `{"call": "deep_show", "session", "doc", "mode", "t",
   "size", "include", "cursor"?}` with no `document` draws the doc's current revision at `t` and never changes the
   document or its revision (a mode call with a document, as #411's tests send, may keep #411's behavior). Its reply is
   #411's: `outcome: "presented"`, `rev` (the revision drawn), `mode`, `display_only: true`, `snapshots: [{sha256, w,
   h, display_only: true}]` (a PNG in the evidence store), `visible: [{id, box}]` (the visible table of the frame this
   mode drew, refreshed for every revision), `drawn: [row]`, `next` per #412. Each mode's snapshot hash is held as
   display only, so #464's refusal applies to it. A mode the build lacks still answers `module_missing`.
2. **`deep-show live`'s `after` entries gain `wakeups` and `rung`.** Each entry, as `showing` and `presented` already
   are, measured before its call runs: `wakeups`, the count of frame callbacks the window's frame clock has asked for
   or received so far (#140's `wakeups`, display-link callbacks included); `rung`, the live view's meter rung name now
   (`base` while nothing stepped).
3. **Mode names and request fields.** On the closed list: `lighting_only`, `overdraw`, `cascade_splits`, `bounds`,
   `lights_cameras`, `lights_per_cluster`, `normals`, `uv_checker`. New: `deviation` (`item`: the item measured,
   `reference`: an asset's SHA-256 in the evidence store), `tangents`, `probes`, `sound_sources`, `motion_paths`
   (`select: [item]`, `span: [time, time]`), `pick_hierarchy` (`depth`: integer, the root at depth 0).
4. **`drawn` rows, all world metres at `t`, each with `id` and `what`:**
   - bounds: `{id, what: "box", pos, min, max}` (#411's row; `pos` the item's world position, for a box its centre).
   - lights_cameras: `{id, what: "light" | "camera", pos}`.
   - uv_checker: `{id, what: "checker", cells: [across u, across v], per_unit}` for each surface item, cells counted over
     its uv0 extent.
   - normals: `{id, what: "normal", vertex, from, to}` one per vertex of the item's mesh, `vertex` its index in the
     built mesh (for `ball@1`, the builder's order).
   - tangents: `{id, what: "tangent", vertex, from, to, tangent: [x, y, z], w: 1 | -1}` one per vertex, `tangent` the
     unit world tangent from uv0 and `w` the glTF handedness (bitangent = w × normal × tangent).
   - probes: `{id, what: "probe", type: "irradiance" | "reflection", pos, data}`, `data` the SHA-256 of the stored
     capture or bake the sphere is shaded from, held in the evidence store after the call.
   - sound_sources: `{id: emitter ID, what: "voice", pos, inner, outer, outer_gain, range}`, `range` the emitter's
     `distance.max`, the cone's angles as authored.
   - motion_paths: `{id, what: "path", samples: [{t: flicks, pos}], ticks: [{t: flicks, pos}]}`, a sample at each
     frame of the transport's frame rate across `span` inclusive, a tick at each key time of the item's channels
     inside `span`.
   - pick_hierarchy: `{what: "pick_box", depth, leaf: bool, min, max}` for every node down to `depth`; the reply adds
     `hierarchy: {depth, leaves}`, the counts of the hierarchy render-back's surface hits use.
5. **The deviation reply** adds `deviation: {item, reference, largest_m, mean_m, to_reference: {largest_m, mean_m},
   from_reference: {largest_m, mean_m}, worst: [{face, distance_m}] (10, worst first, ties by face), legend: {unit:
   "m", top}}`; `face` is the triangle's index in the item's mesh (glTF index order ÷ 3); `largest_m` is the larger
   way's. A `reference` the store lacks answers `{code: "reference_missing", …}` naming the hash, with no snapshots.
6. **`simplify` adds `measured_m: [f64]`**: per level, its probe's measured error in metres, the largest distance
   between that level's surface and the input's, both ways; `measured_m[0] = 0`.
7. **Document fields** this suite sends: `light.probe@1 {type, size}` items; `emitters: {ID: {item, src, distance,
   cone}}` and `strips: {chime: {synth: "sine", freq: 440, span: "2s"}}` with `requires.modules.media: "^1"`; item
   `parent` for a 3D item; `mesh.asset@1 {sha256, node: 0}` read from the evidence store by its hash, uv0 from
   `TEXCOORD_0`.
8. **Planted programs**, each reachable only through the scenario's `planted` field:

| Name | The wrong program | Criterion |
|---|---|---|
| `mode_draws_live_surface` | A mode render-back draws on the live view's surface (and asks its frame clock for a frame) instead of the offscreen copy | AC1 (issue-named) |
| `mode_ids_by_count` | A mode's visible table is cached per document and rebuilt only when the item count changes | AC1 (issue-named) |
| `bounds_authored_position` | bounds reads each item's authored position, not its evaluated one at t | AC2 (issue-named) |
| `lights_local_position` | lights_cameras reports a light's local position, ignoring its parent | AC2 (issue-named) |
| `checker_fits_surface` | uv_checker fits 8 × 8 cells to each surface's uv0 extent | AC2 (issue-named) |
| `deviation_one_way` | deviation measures only from the reference to the item's surface | AC4 (issue-named) |
| `normals_from_faces` | normals draws each vertex's line along a face normal of a face using it | AC5 (issue-named) |

9. **The taste call** is recorded in `tests/acceptance/427/TASTE.json`, the one file anyone adds to this folder after
   this commit, and only to record the owner's answer: `{"issue": 427, "criterion": "#427.78a8171b", "verdict":
   "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the six PNGs}, "note"?}`.

## Readings where the issue leaves a choice

- **"1 m"** is the full size: the cube's box runs 1.5 to 2.5 m around x = 2, so a "1 m UV sphere" is 1 m across
  (radius 0.5, `ball@1`'s default).
- **"Draws 0 frames, gets no frame callback"** is read from the shown window between two reads around the 20 calls, as
  #140 reads a still scene's idle clock; "its meter moves no rung" is the live view's rung at the two reads.
- **"The job probe's measured error"** can't be meshopt's relative estimate (`lod_errors`): a quadric bound is not a
  distance and couldn't equal a two-way measure within 1e-6 m, so the probe adds a measured distance in metres.
- **"Naming the face"** for the bulge: the first face, by index, among those around the raised vertex, where the
  largest distance lies.
- **"Naming the first vertex"**: vertex 0, the pole, where a face normal and the vertex normal already differ.
- **"Shaded from its own stored data"** is checked by the hash of the data each probe's sphere reads, not by its
  pixels; no criterion here judges a picture.
- **A status color** is a pixel within 2 per channel of the clean look's pass, fail, invalid or running color; the
  greyer states (blocked, inconclusive, needs you, stale, idle) are left out because shaded grey surfaces can reach
  them.

## The taste call

`taste.test.ts` writes to `docs/evidence/427/`: `lighting_only.png`, `overdraw.png`, `cascade_splits.png`,
`bounds.png`, `lights_cameras.png` and `uv_checker.png` (TASTE.json's names), each the renderer's own snapshot, and
prints their SHA-256s. The implementer attaches them to the PR, shows them in the session, and records the owner's
answer in `TASTE.json`. The pictures are evidence for the one taste call only; no other test reads them.
