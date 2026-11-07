# Acceptance tests for #446: Light without history — soft, cascaded and cached local shadows, receivers, casters and IES

Written first, from issue #446 (its scope, its Fields blocks, its nine acceptance criteria and its proof line), the
design sections it links, its oracle page, and the base commit `80ba48fe` ("Merge pull request #1403 …", which holds
#421's renderer, #422's light and sky and #424's cutaways), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean, as #421's to #424's: one file per criterion, at most two tests each, plus the planted twins the rules
need. The proof line lives in AC2's second test and adds no file.

## What was read

- Issue #446. The oracle page (`doneright/oracles/issues/446.md` and `cases/446.json` in `DeepBuildAI/deepbuild`, branch
  `doneright`): upstream tests for criteria 1, 3, 4 and 7. **None is ported:** Blender's `tests/files/render/light*` and
  `tests/files/render/light_linking` are `.blend` scenes rendered by Cycles and EEVEE against stored references; running
  them needs Blender and judges Blender's output, and nothing in them can be fed ours. pbrt-v4's
  `src/pbrt/lights_test.cpp:84-136` is C++ over pbrt's own light class. Their properties are held on our own fixtures:
  penumbras grow with the light's size (AC1); a light lights only its receivers, only its blockers cast (AC3, AC7); a
  table over the sphere integrates to the power (AC4, the integral taken over our pixels). The page says no upstream test
  exists for criteria 2, 5, 6, 8 and 9.
- `docs/technical-design.md`: Light without history; Frame history; Cutaway and particles; Dogfooding.
- `docs/canvas-primitives.md`: Units and axes; Light and the light policy; Light policy: cascades, soft shadows, local
  shadows; Light: receivers, casters, IES distribution; Cutaway `cutaway@1`; Material (`shadow`); Look: frame history;
  document `collections`; the step table (`t@1`, `discard_if@1`).
- At the base: `crates/deep-gpu-layer` (`main.rs`'s `--planted` table; `view3d.rs`: `shadows` isn't a call field,
  `cascades` reports `splits` and `maps: [{key, texel_m}]`, `timings` reports `gpu_ms` and `passes_ms`, `pixel_hash`),
  `crates/deep-canvas-scene3d` (`light.rs`, `cut.rs`, `spec.rs`: the sun's `cascades`, `split`, `shadow_far`, `fade`,
  `angle`), `crates/deep-scene3d-render` (`shadow.rs`, the cascade keys and fits, the light loop's range fade), and the
  suites `tests/acceptance/422/`, `424/` and `429/` (conventions, the taste record, the operator shape).

## What the base already does, which these tests don't credit

Cascades fit, snapped and cached (#422); the cut in the sun's shadow pass, in its key, and `shadows: whole` (#424);
`shadow: auto` for glass (#421). So the sun half of AC8, the pool in AC2 and the seek half of AC1 may pass at the base;
nothing here credits them. There are no local maps (a spot asking for a shadow draws none), no soft filter sized by the
light, no contact shadows, no receivers, casters or distributions, no `shadows` report, no `clip` or `drawn` on a cascade,
and none of the new planted names below.

## Run them

They build `deep-gpu` with cargo, as #421's to #424's suites do, so they run one file at a time. `scripts/lanes.mjs` needs
`'tests/acceptance/446/'` added to its `alone` list, beside `tests/acceptance/424/`; this README is the instruction, the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/446 --no-file-parallelism --testTimeout=600000 soft.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/446/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes. AC9
is INCONCLUSIVE until `TASTE.json` records the call on this run's screenshots. No criterion names a budget, so nothing
here reads a wall clock or needs a reference Mac; nothing is gated on power or load. A run with `--root` may leave
Vitest's cache in `tests/acceptance/446/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped. Each test's name starts with `AC<n> #446.<id>`. Each file's header states its fixture, numbers and wrong programs
in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#446.0ba58c87` | `soft.test.ts` (2) | The blade under suns of 3° and 9°: the penumbra at 0.25 m from the foot under 0.35 of the one at 2.5 m and growing with distance, the 9° sun's 2 to 4 times the 3° sun's, each within 40% of the disk's. A spot's plank at radius 0.1 and 0.3 m: 2 to 4 times, within 40%. `method: pcf` fails naming harden and widen. Frames 3 and 12 sought equal the played ones by pixel hash; frames 7 to 12 of a stilled scene are one picture; `soft_noise_from_frame` fails |
| AC2 `#446.1a955ffe` | `point-cache.test.ts` (2) | An interior under a shadowed point lamp, eight frames: six passes at frames 0, 3 (an item enters) and 7 (the lamp moves), none at the rest, by the report and the GPU timer, an item moving outside the range included; every frame equals `cache: none` by pixel hash; `cache: none` and `local_map_stale` fail. The house by day and at night: per-pass GPU timings at frame 0, no shadow pass while still, frame 2 equal to a clean rebuild; the sun's pool through glass under `shadow: auto` within 2%, dark under `cast` |
| AC3 `#446.42931fc0` | `receivers.test.ts` (1) | Two rooms in plan under one lamp, and under eleven, `receivers` a collection or a list: every pixel outside room A (at least 50,000) under 1e-5, room A lit; without receivers it fails naming `floor_b` |
| AC4 `#446.9f0a17a9` | `ies.test.ts` (1) | Six 90° cameras at a lamp in a matte cube integrate its intensity over the sphere: 800 lm bare (the control), 2,400 at `power: 2400`, 1,200 at `from_file` (the candelas sum to 960), 2,400 turned by 90°, each within 1%; the shape within 4% on 99% of directions, turned at the turned lamp; a lamp ignoring the file and `ies_peak_normalized` fail |
| AC5 `#446.77ebb2fa` | `cascade-edge.test.ts` (2) | A camera walking a fifth of a texel a frame: each cascade's `clip` holds (`drawn` false) or moves by whole texels (`drawn` true), at most ⌈travel ÷ texel⌉ + 1 changes; the last frame equals a clean render; `cascade_unsnapped` fails. A bar's penumbra on a hard split equals the same penumbra off it within 0.12 of the lit level in seven strips across the frame; each cascade grows by at least the penumbra's reach; `cascade_filter_in_texels` and `cascade_no_penumbra_reach` fail |
| AC6 `#446.3834c570` | `caster-t.test.ts` (1) | A caster discarded on odd frames by `t@1`, and one whose operator reads t only for emission, each under its own spot, eight frames at 10 fps: the first's shadow on even frames only, its map drawn with a new key every frame; the second's map drawn at frame 0 only; `local_map_ignores_t` and `local_map_rekeys_on_any_t` fail |
| AC7 `#446.5786734d` | `casters.test.ts` (1) | A lamp shut in its shade, `casters: furniture`: every open floor pixel (at least 100,000) reads ρ I cos θ ÷ (π d²) within 2%, the table's shadow (at least 2,000) under 2% of it, the shade still draws; `casters: all` fails naming the shade |
| AC8 `#446.d9d8c199` | `engine-cut.test.ts` (2) | The piston's face through the cut, under a sun and a spot: ρ E ÷ π within 1% on every pixel (at least 1,500), under 1% at `shadows: whole`; `cut_color_only` fails. The plane moved from past the block to the cut: frames 1 and 2 equal a clean render on both targets; `cut_key_omits_planes` fails |
| AC9 `#446.cf21f50f` | `taste.test.ts` (1) | Writes the five screenshots (README: The taste call) and reads `TASTE.json`: absent or on other SHA-256s INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes |

## Assumed surfaces

The issue and design name the behaviors and most fields but not these calls and reports; each is this job's choice, the
most natural extension of the base's `deep-gpu run` / `view3d`. The implementer provides exactly these.

1. **`light_policy` on the document**, a top-level field: the design's policy fields, of which the tests use
   `soft: {method, max_penumbra}`, `contact: {length, samples}`, `shadowed: {spots, points}` and `cache: static | none`.
   Unnamed fields keep the design's defaults. The cascades stay on the sun's params, as at the base.
2. **Light params**, as the issue names them: `angle` on a sun, widening its penumbra (a field the base already accepts);
   `radius` and `shadow: true` on a point light and a spot, drawing a local map; `receivers` and `casters` as a collection
   ID or a list of them; `distribution` (a SHA-256), `distribution_rotation` and `power: "from_file"`.
3. **`collections: {ID: {members: [item ID]}}` on the document**, as the design's map; `casters: "all"` keeps every caster.
4. **An IES file through the call's `assets: {sha256: path}` and `licenses: {sha256: {id, terms, shareable, credit}}`**, the
   fields #423's maps read, the file LM-63-2002 text, its photometric axis (vertical angle 0) along the light's local −Z.
5. **A material operator's `discard_if@1` runs in shadow passes**, on a part whose material names a `gpu.material@1` by
   `params.op`, so a caster's coverage over t reaches its map.
6. **A cutaway reaches local maps** as it reaches the sun's: a document `cutaway@1` applies in a spot's map, `shadows:
   whole` keeps its casters, and a patch to `items/cut/params/planes/0/offset` redraws it.
7. **`shadows: true` on `view3d`**: each frame reports `shadows: {passes: number, maps: [{light: item ID, kind: "spot" |
   "point" | "area", key: string, drawn: boolean}]}`. `passes` counts the depth passes the frame issued for every light,
   the sun's cascades included: one per cascade or spot map drawn, six per point map drawn, five per area map. `maps` lists
   each local map the frame reads; `drawn` says this frame drew it, and `key` is its cache key.
8. **`cascades: true`** also reports, on each of `cascades.maps`, beside the base's `key` and `texel_m`: **`clip`**, the
   cascade's light clip matrix after snapping, 16 numbers column-major, and **`drawn`**, whether this frame drew it (the
   base's `counts.cascades_drawn`). The base's `splits` stays.
9. **`timings: true`**: a frame's `passes_ms` holds a key containing `shadow` or `cascade` exactly when the frame issued a
   shadow pass (the base's `scene3d.cascade` for cascades; a local map's pass under any name holding `shadow`), and
   `scene3d.geometry` in every frame.
10. **`pixel_hash`** on every captured frame, as at the base, and a channel target `items/<id>/at/pos/0` (the path grammar).
11. **`docs/evidence/446/`** receives the screenshots at run time and **`tests/acceptance/446/TASTE.json`** records the taste
    call (README: The taste call).
12. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `soft_noise_from_frame` | The soft filter's disk rotation also hashes the frame number | AC1 |
| `local_map_stale` | A local map is keyed by its light alone, so an item entering its range keeps the map | AC2 |
| `ies_peak_normalized` | A distribution's table is scaled to its peak, not to its integral | AC4 |
| `cascade_unsnapped` | A cascade's projection follows the camera with no texel snapping | AC5 |
| `cascade_filter_in_texels` | The filter disk is sized in the cascade's own texels, so it jumps at a split | AC5 |
| `cascade_no_penumbra_reach` | A cascade's box isn't grown by the penumbra's reach | AC5 |
| `local_map_ignores_t` | A caster's t isn't in its local map's key | AC6 |
| `local_map_rekeys_on_any_t` | Any material operator that reads t joins the key, even for color alone | AC6 |
| `cut_key_omits_planes` | The planes clip the shadow pass but aren't in the map's key | AC8 |

`cut_color_only` (AC8) is #424's, at the base. Three twins need no plant: `method: pcf` (AC1), `cache: none` (AC2), and the
documents without `receivers` (AC3) or at `casters: all` (AC7).

## The taste call

`taste.test.ts` writes, from one run's output, to `docs/evidence/446/`, each a byte copy of the renderer's final target
(so its SHA-256 is the renderer's own name for it), printing each SHA-256:

| File | What it shows |
|---|---|
| `house-day.png` | The house by day, EV 11, filmic |
| `house-night.png` | The house at night, EV 1.5, filmic |
| `soft-contact.png` | AC1's blade under the sun's own 0.53° with contact shadows |
| `soft-widened.png` | AC1's blade under a 9° sun |
| `engine-cut.png` | AC8's engine cut by a plane under its sun |

They are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/446/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 446, "criterion": "#446.cf21f50f", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all five}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's
pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document, the IES file and the look are generated in the test files and `helpers.ts`. The fixtures the
taste test shares (`bladeDoc`, `houseDoc`, `engineDoc`) are in `helpers.ts`. Every measuring fixture sits at the look of
exposure scale 1 with radiance near 1; the house's looks are EV 11 and EV 1.5, each checked in `helpers.ts`'s comment so a
20,000 lx sun doesn't white out. A light read for its exact illuminance has a `range` at least 25 times its distance,
since the base's light loop fades by (1 − (d ÷ range)⁴)².

## Readings where the issue and design leave a choice

- **"Harden" and "widen"** are held as ratios of a measured width, 6 ∫ v (1 − v) dx (`penumbraWidth`), which reads through the
  disk's per-pixel rotation; the 40% band against a uniform disk leaves room for PCSS's estimate. A width under 8 px by the
  disk isn't held to that band: a few texels decide it.
- **"Moves less than one texel"** can't be read literally: any grid keeps a point in a cell only until it crosses a line,
  however small the move. It's read as a move inside one texel cell: walking a fifth of a texel a frame, each change is a
  whole number of texels, at most ⌈travel ÷ texel⌉ + 1 of them, and every frame between hits the cache. Depth is left out of
  the walk by moving across the light, and the floor is wide enough to set the map's depth range.
- **"Isn't cut"** is held two ways, since the base's cascades reach a map's edge only at the frustum's rim. In pixels, a
  penumbra lying on a hard split (`fade: false`) equals the same penumbra with the split elsewhere, so nothing breaks at the
  split. And on `clip`, each cascade's half-width grows from a 0.001° sun to a 5° sun by at least this bar's reach, 6.08 m ×
  tan 2.5°: the design's "tan of the light's angle × the depth range" passes it, as does the half angle over a wide range.
- **"The cache hits"** is `drawn: false` with the projection unchanged, and the last frame equal to a clean render.
- **"A still interior issues no shadow passes"** is held by the report and by the GPU's own timer. **"Every item meeting its
  range"** is a sphere of `range` around the light: an item 30 m away moves without a pass; AC6's spots stand 12 m apart at
  range 8 so neither's key holds the other's caster.
- **"A still one"** in AC6 is a caster whose coverage doesn't depend on t though its operator reads t for its glow; a caster
  with no operator couldn't tell a key that adds t for any t-reading operator.
- **The IES axis**: the design names `distribution_rotation` "about the light's axis" but not φ = 0's direction, so the test
  reads it off the unturned lamp (local +X or +Y) and holds the turned lamp 90° from that. "Over the cone for a spot" isn't
  tested; the criterion says over the sphere.
- **"The house"**: the repo holds no whole house a `view3d` call can draw (`building.rs` has a corner of one), so `houseDoc`
  builds two rooms of boxes with the fields the design's house uses: glazed windows, lamps kept to their rooms, casters.
- **"The engine fixture"** is #424's block over its crankshaft with a piston added, since the criterion names a piston.
- **"Full direct illuminance within 1%"** is every judged pixel, on the matte face, with its specular level at 0.
- **The screenshots' place**: the criterion says "attached to the PR"; the run writes them to `docs/evidence/446/`.

Not tested, because no criterion asks: rect and disk area lights in `points` slots, shadows dropped over budget and their
notice, `receiver_sets`, `caster_sets` and `distributions` budgets, true area shadows under samples per frame, cluster order,
the far plane from this frame only, unclipped depth, `shadow: none`, the mode in a feature key, displacement in a map's key,
reflection captures and irradiance bakes under a cutaway, a lit cap (#424's AC9 holds it), a distribution on a spot or an
area light, how far contact shadows darken.
