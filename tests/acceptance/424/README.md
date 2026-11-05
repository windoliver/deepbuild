# Acceptance tests for #424: 3D see-through and cutaways — adjust in 3D, additive surfaces, cutaways, picks by stable ID and the per-pixel resolve

Written first, from issue #424 (its scope, its two Fields blocks, its eleven acceptance criteria and its proof line),
the design sections it links and those they lean on, its oracle page, and the base commit `79d98cbc` ("Merge pull
request #1242 …", which holds #421's renderer, #422's light and sky and #423's maps), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean, as #421's to #423's: one file per criterion, at most two tests
each, plus the planted twins the criteria name.

## What was read

- Issue #424; #422 and #423 for vocabulary only. The oracle page (`doneright/oracles/issues/424.md` and
  `cases/424.json` in `DeepBuildAI/deepbuild`, branch `doneright`): upstream tests for criterion 1 only, Blender's
  `tests/files/render/shadow_catcher` scenes with `tests/python/cycles_render_tests.py` at `0a18557098`. **Not
  ported:** they are `.blend` scenes rendered by Cycles and compared with Cycles' reference images; running them needs
  Blender and judges Cycles' output, not ours, and nothing in them can be fed our renderer's output. Their property
  (the catcher's alpha is the share of light its shadow removes, over the background) is AC1's first test on our own
  fixture. The oracle page says no upstream test exists for criteria 2–11.
- `docs/canvas-primitives.md`: Cutaway `cutaway@1` (every field and sentence); Object (adjust in shading, the instance
  record, "opacity below 1 … a depth pass of its own"); Object: see-through order (`sort_bias`, `resolve`,
  `max_fragments`, add parts, `fragments_capped`, 16 B a fragment); Object: hidden view (picks land on the occluder);
  Material (`alpha_mode`, `shadow: auto`, "changing a value never recompiles", "a part whose channel … can move one off
  0 has both feature sets compiled at check"); Material: texture maps (`maps`, `alpha_cutoff`); Material: shadow
  catcher; Instance `instance@1` (`ids`, `hidden`, `<instancer>#<id>`, "the object-ID pass writes each element's stable
  ID, never its place in the compacted list"); Item (`visible`, `adjust`); Control: point (`hit: {margin: px = 3}`,
  "in 3D, the object-ID target"); Item and kind: adjust; The cost model (the figure class: 2 ms, 256 MB per window).
- `docs/technical-design.md`: Scenes, physics and the canvas core (Cutaway and particles: "Light falls through the
  cut, and its cap is lit in a physical look"); Dogfooding; taste calls and "Shown to you".
- At the base: `crates/deep-gpu-layer` (`main.rs`'s calls and `--planted` table; `view3d.rs`: `targets`, `picks`,
  `clicks` answered `{at, pick}` from one pixel of the object-ID target, `window`, `states`, `counts` with
  `meshes_built`, `cascades` with `splits`, `notices`, `passes`, `timings`), `crates/deep-canvas-scene3d` (`light.rs`:
  `alpha_mode` opaque, mask, blend and add, `shadow: auto`, `catch: shadow`; `scene.rs`: `adjust.opacity` as coverage,
  an item at opacity 0 skipped, `sort_bias`, `mark.line@1` widths in px, `mark.point@1` size in px, `mesh.asset@1`
  from a JSON glTF with a data-URI buffer; no `instance@1`, `group@1`, `visible` or `cutaway@1`),
  `crates/deep-scene3d-render` (see-through parts after opaque ones, back to front by view depth plus `sort_bias`, ties
  by ID; add parts depth-tested with no depth write; no per-pixel lists, no clip distances), and the suites
  `tests/acceptance/421/`, `422/`, `423/` and `1174/` (conventions, the taste record).

## What the base already does, which these tests don't credit

`view3d` draws see-through parts (blend and add) after the opaque ones, sorted by view depth plus `sort_bias`, ties by
ID; add parts are depth-tested and write no depth or shadow; a shadow catcher writes black with alpha; a mask cuts by
its cutoff; an item at adjust opacity 0 is left out; a 3D view composites over a page in a `window`; a click names the
item at one pixel of the object-ID target; status bindings draw outlines and badges. So parts of AC1 (the catcher) and
AC5 (the shipped beams) may pass at the base; nothing here credits them. There is no cutaway, no `instance@1`, no
`visible` on a group, no depth pre-pass for adjust opacity, no per-pixel resolve, no `fragments_capped`, no pick
window, no shadow-map keys or texel sizes in the report, no per-frame `compiled`, and none of the planted names below.

## Run them

They build `deep-gpu` with cargo, as #421's to #423's suites do, so they run one file at a time. `scripts/lanes.mjs`
needs `'tests/acceptance/424/'` added to its `alone` list, beside `tests/acceptance/421/`; this README is the
instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/424 --no-file-parallelism --testTimeout=600000 cutaway.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/424/tsconfig.json
```

Every test draws on macOS's Metal device; off macOS it fails with a message starting `INCONCLUSIVE:`, never passes.
AC8 also requires a reference Mac (`Mac15,7` or `Mac15,12`), as #421's and #422's budgets do; off one it is
INCONCLUSIVE. AC11 is INCONCLUSIVE until `TASTE.json` records the call on this run's screenshots. Nothing is gated on
power or load. A run with `--root` may leave Vitest's cache in `tests/acceptance/424/node_modules/.vite`; delete it.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped. Each test's name starts with `AC<n> #424.<id>`. Each file's header states its fixture, numbers and
wrong programs in full.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#424.599f5fc2` | `shadow-catcher.test.ts` (2) | A catcher floor under a casting key sun (π lx on the floor) and a non-casting fill (3π lx) over a page of sRGB 200: in the shadow's core the window reads the page × 0.75 in linear light, on the open floor the page, within 2 codes. Nested unlit shells (blue outer r 1, red inner r 0.5 with sort_bias 1, IDs ordered so a tie draws the outer first) under the view cutaway x > 0.6, at 12 orbit poses: overlap pixels read the inner drawn first within 2 codes on 99.5%; cut pixels aren't that composite; sort_bias 0 misses on most (control) |
| AC2 `#424.a28f3c85` | `cutaway.test.ts` (2) | A document `cutaway@1` (`class: document`) whose plane offset is a channel hides the cube past it at each of 11 frames, `meshes_built: 0` after frame 0; a view cutaway of two planes (union) hides their union. A pump with stroke and badge bound to a fail verdict, cut through its middle: both slots still reported in fail, 99% of the uncut frame's #bf232b pixels still #bf232b |
| AC3 `#424.649ef843` | `adjust.test.ts` (2) | The double-sided engine block at adjust opacity 0.3: over every block pixel, A = code(0.7 × hidden + 0.3 × opaque block) within 2 codes, on the crankshaft and over the ground (where a back face would show). A channel keying `emission_strength` 0 → 4: frames after the first report `compiled: []`, pixels 2 px from the lamps byte-equal to frame 0, the lamps' pixels changed |
| AC4 `#424.69a7a811` | `picks.test.ts` (2) | `instance@1` `trees`, 1,000 elements, ids 5,000 + (7,919 i mod 1,000), all in view: clicks on 5,742 (and 5,000, 5,999, 5,123) name `trees#<id>`; clicks on hidden 5,743, a hidden group's child, an opacity-0 item, a mask card's hole and past a cutaway name `ground`, the card's solid part `leaf`, the cut box's kept half `cut_box`; each with the final pixel in that item's color. `ids_by_draw_position` and `ids_ignore_mask` fail naming the pixel |
| AC5 `#424.b9bc25e9` | `additive.test.ts` (2) | Two unlit add beams crossing in an X over a 0.05 floor, sun at 45° casting: at each of 36 poses every overlap pixel (found by ray) adds [0.75, 0.5, 0.75] to the floor within 1% on the linear target; no floor pixel darker by 1%; a wall hides both within 1%; opaque beams do shade the floor (control). `add_writes_depth` and `add_skips_depth_test` fail, every failure naming its pixel |
| AC6 `#424.ba7f5708` | `per-pixel.test.ts` (2) | glTF saddle (0.5) crossing a plane (0.5), and a self-crossing figure-eight sweep (0.4), unlit double-sided, `resolve: per_pixel`: within 2 codes of an f64 ray-cast composite of the same triangles on 99.9% of judged pixels (at least 20,000). The twin, `resolve: sorted`, misses on at least 1% |
| AC7 `#424.f29789a6` | `fragments-cap.test.ts` (1) | Twelve full-frame per-pixel layers at 1080p in the figure class (24.9 M fragments, 398 MB): a `fragments_capped` notice, and every pixel equals the twelve-layer composite within 2 codes |
| AC8 `#424.73418e8a` | `budget.test.ts` (1) | AC6's saddle at 1080p: median `gpu_ms` per-pixel less sorted, 120 frames, five runs after a warm-up, under 2 ms; the two draws must differ on 1% of pixels. Reference Mac only |
| AC9 `#424.d0c14cb2` | `section.test.ts` (2) | The closed room cut at x > 0 (and −0.5) under a sun at 45° from +X: floor lit past x = offset − 2 m and dark short of it, beyond 2 × the largest `texel_m` plus a pixel's footprint; the sand cap reads sand × 0.75 within 2%; same plane, same keys; moved plane, other keys. `cut_color_only` fails naming `scene3d.shadow` |
| AC10 `#424.6c2f640a` | `pick-margin.test.ts` (1) | Clicks 2 px off a drawn 1 px `mark.line@1` and a 4 px `mark.point@1`, found from the ID target, name `edge` and `dot`; `single_pixel_pick` fails naming both |
| AC11 `#424.d1e2b251` | `taste.test.ts` (1) | Writes the four screenshots (README: The taste call) and reads `TASTE.json`: absent or on other SHA-256s INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes |

## Assumed surfaces

The issue and design name the behaviors and fields but not these calls; each is this job's choice, the most natural
extension of the base's `deep-gpu run` / `view3d`. The implementer provides exactly these.

1. **`view3d`'s `cutaway: {planes: [{normal, offset}], mode, applies_to, cap, class, shadows, cap_light}`**: a
   `cutaway@1`'s params as a view input in session state, applied to every frame of the call. A **`cutaway@1` item**
   in the document, `params` the same fields with `class: "document"`, its `params/planes/<i>/offset` a channel
   target, is the film's document input. A plane removes the half-space its normal points into: points p with
   n · p > offset (README: Readings).
2. **`instance@1`** with `params: {of: [item ID], ids: [u32], pos: [[x, y, z]], hidden: [u32 element IDs]}` (inline
   columns, one row per element), its element picks named `<instancer>#<id>` in the frame's `picks` and in clicks.
   The prototype item (`of`) is an ordinary item at the origin; elements take its geometry and material.
3. **`group@1`** in a scene3d document, `at` and `visible: false`, its children (`parent`) inheriting `visible`.
4. **Item fields** `resolve: "sorted" | "per_pixel"`, `max_fragments: u32` and `sort_bias` on a 3D item (including a
   `mesh.asset@1`); `adjust: {opacity}` drawn after the item's own depth pass; `budget: {class: "figure"}` on the
   document caps the redraw's room at the class's GPU memory.
5. **Frame notices**: a frame whose resolve fell back carries `{code: "fragments_capped", …}` in `notices`.
6. **Clicks with the hit margin**: `clicks: [{frame, at: [x, y]}]` (base) answered `clicks: [{at, pick}]` (base),
   `pick` the nearest drawn ID in the (2 × 3 + 1)² window of the object-ID target, ties by depth.
7. **`counts: true`** also reports, per frame, **`compiled: [pipeline name]`**, the pipelines compiled while drawing
   that frame (empty when none), beside the base's `meshes_built`.
8. **`cascades: true`** also reports, per frame, **`cascades.maps: [{key: string, texel_m: number}]`**, one per shadow
   map the key sun draws: its cache key (which includes the planes that reach its casters) and its texel's size in m.
9. **The reply's `passes`** keeps the base's names: `scene3d.shadow` writes `shadow`, `scene3d.geometry` writes
   `linear`, `ids`, `depth`.
10. **`tests/acceptance/424/TASTE.json`** records the taste call (README: The taste call).
11. **Planted programs**, each reachable only through `deep-gpu run --planted <name>`, added to `Planted` in
    `crates/deep-gpu-layer/src/main.rs`:

| Name | The wrong program | Criterion |
|---|---|---|
| `ids_by_draw_position` | The object-ID pass writes an instancer element's place in the draw order instead of its stable ID | AC4 (named) |
| `ids_ignore_mask` | The object-ID pass draws a mask part whole, ignoring its cutoff | AC4 (named) |
| `add_writes_depth` | Add parts write depth | AC5 (named) |
| `add_skips_depth_test` | Add parts draw without the depth test | AC5 (named) |
| `cut_color_only` | The cutaway's planes clip the color (geometry) pass but not the shadow pass | AC9 (named) |
| `single_pixel_pick` | A pick reads only the clicked pixel of the object-ID target (the base's behavior) | AC10 (named) |

AC6's twin is the shipped `resolve: sorted`, which needs no plant.

## The taste call

`taste.test.ts` writes, from one run's output, to `target/acceptance/424/`, each a byte copy of the renderer's final
target (so its SHA-256 is the renderer's own name for it), printing each SHA-256:

| File | What it shows |
|---|---|
| `engine-block.png` | AC3's engine block at adjust opacity 0.3 over its crankshaft |
| `cutaway-shells.png` | AC1's cutaway fixture: the nested shells under their cutaway, first pose |
| `cutaway-section.png` | AC9's half-section room, the plane at 0 m, with its sand cap and the light through the cut |
| `additive-beams.png` | AC5's two crossing additive beams, first pose |

They are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/424/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 424, "criterion": "#424.d1e2b251", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all four}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document, glTF and texture is generated in the test files and `helpers.ts`. The fixtures the
taste test shares (`shellsDoc`, `engineDoc`, `beamsDoc`, `sectionDoc`) and the meshes (`SADDLE`, `CROSSING_PLANE`,
`FIGURE_EIGHT`, `QUAD`) are in `helpers.ts`. The reference composite (`referenceComposite`) ray-casts the same f32
positions the glTF holds, both faces, in f64.

## Readings where the issue and design leave a choice

- **"Within 1%" for the catcher** is read on the composite, as the criterion's "composites over a 2D page": the
  window's sRGB code against the page × (1 − 0.25) in linear light within 2 codes, about 1% of the light at that
  level; an 8-bit window can't hold a tighter alpha.
- **"Every camera angle"** is 12 orbit poses every 30°; poses where the cut opens the whole overlap judge the cut.
- **The cutaway's side**: a plane removes where n · p > offset (the cap faces along the normal, toward the removed
  side, which agrees). **"Keeps its outline and badge"** is read with Cutaway's "can never hide a status color": the
  cut frame keeps every fail-colored pixel of the uncut frame (99%), so the outline and badge stay where the part was.
- **"0.3 of the block's own shaded color"** is the block drawn opaque at the same pixel; the mix is in linear light,
  judged on the final target's codes. "None of the block's back faces drawn" is held where a back face could show
  (over the ground), since over the crankshaft the depth test hides them anyway.
- **"Compiles no pipeline"** is read per frame after the first: `compiled` empty while the value moves.
- **"Names the item the color pass drew"** is the click's pick together with the final pixel showing that item's own
  unlit color within 2 codes; "a pose that culls none" is every element in view.
- **"Within 1% on one machine"** for the beams is per channel, relative to the floor plus the sum; overlap pixels are
  found by ray (center and ±1 px) so no picture judges itself.
- **"99.9% of pixels"** is of the judged pixels: those the reference sees layered with no silhouette, crossing or seam
  inside ±0.5 px, where a GPU's sample placement can't decide the answer.
- **"At the cap"** is `max_fragments` at its default 8,388,608 and the figure class's 256 MB, both exceeded.
- **"Adds under 2 ms"** is the per-pixel draw's median GPU time less the sorted draw's, by the five-run rule.
- **"Within 2 shadow-map texels"** uses the largest `texel_m` the frame reports, plus one pixel's floor footprint.
  "Changes the shadow map's key" is the list of keys differing between planes, and equal for the same plane.
- **"Shades as a matte surface facing along the plane's normal"**: the sand role's linear color × n · l × E ÷ π =
  × 0.75, within 2% (unlit would read × 1; facing −X, 0).
- **"2 px off"** is a click pixel whose nearest drawn pixel of the item is 2 px away, with nothing within 1 px of it.

Not tested, because no criterion asks: `applies_to: collection` (AC4 reaches one item with three planes in intersect
mode instead), `cap: none` with `cap_light: flat`, `shadows: whole`, a glTF export's warnings for add parts (in the
scope, with no criterion), adjust's other fields in 3D, a pick after the GPU cull (#201's), and four planes at once.
