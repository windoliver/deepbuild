# Acceptance tests for #382: status in hosts — status colors exact after tone mapping, the status guard, and a host's look on its card

Written first, from issue #382 (its scope, the Status guard's fields and "It can never" line, its five acceptance
criteria and its proof line), the design sections it names and those they lean on, and base commit `ab61bea` ("Merge
pull request #748 … issue-745-315-redraft"), by a job that never saw an implementation; none existed. The Oracle page is
not reachable, so every criterion is read as having no upstream test family: local proof only. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863; Honest numbers and colors: "Status colors come only
  through a status binding …; data colors keep a stated distance from them wherever status can show (a document with a
  status binding, a view of the record, or anything shown inside one), while any other document, such as an art film
  played or exported on its own, may use any palette"; Checked before it shows); Dogfooding (2518); Tests written first
  (2549).
- `docs/canvas-primitives.md`: The status-color rule (68–74: "A document shown inside another takes its host's status
  map, legend and status distance", "the check refuses a data palette that comes closer, naming the data role and the
  status color it clashes with", "Status colors draw unlit, after tone mapping and effects, with an automatic legend");
  The trusted compositor (656): Document session (`mode: view_of_record | work_product`, "A revision becomes current
  only after its check passes; a refusal keeps the last good one", "It can never: Show an unchecked revision"),
  Invalidation and damage ("A changed item rebuilds … only itself, an unchanged layer re-composites from its cache", a
  layer's `output_key`), Render-back; Frame and group: blend modes ("Wherever status can show, the status guard runs
  over blended pixels, and status colors still draw after"); Status binding (2177: a 3D object's binding takes its
  stroke or badge slot, "Draws unlit after tone mapping and effects, so the color is exact", the legend); Sheet
  `sheet@1` (2352: a cell "cached by (content key, size, treatment, look)"); Look `look@1` (2407–2470: the status map,
  `status_treatment`, `min_distance: OKLab ΔE = 0.10`, "The status distance and the status guard apply wherever status
  can show …; any other document, such as an art film played on its own, may use any palette", tone mapping: "Status
  colors still draw after tone mapping, so no curve can change one", grade); Level of detail (4953: `open: {at_px, doc}`
  "loads a deeper document by reference, off the frame loop"); the order of one evaluation (5078–5085: "each shot's tone
  mapping, grade and finish, then transitions and the status guard, in compose", "then the status guard and status
  colors"); Status guard (9218: `applies_to`, `min_distance`, `colors`, `order`, the `status_guard {op, pixels_moved}`
  notice, "A pixel an operator wrote that lands within the look's distance of a status color moves to the nearest
  allowed color", "recolor a status binding's own pixels" never); the returns projection and "What every return card
  draws" (623, 9404).
- At the base: AGENTS.md; `tests/acceptance/380/` (the `deep-gpu run` JSON-lines protocol, `--planted <name>`,
  `view3d`, `reference` and its f32 targets, 10-bit codes, the criterion IDs), `392/` (the `deep-canvas-render` binary's
  `check`, `look` and `render`, marks and legend in the report, the `deltaEOk` helper, the clean look), `373/` and
  `374/` READMEs; `crates/deep-gpu-layer` (the calls and `Planted`), `crates/deep-canvas-scene3d/src/look.rs` (`Look3`
  reads roles, tone map and exposure and nothing of the status map), `crates/deep-scene3d-render` (the shading `0.25 +
  0.75 × facing`, a sun's `toward` as its local +Z), `crates/deep-canvas-marks/src/look.rs` (`Status {colors,
  min_distance}`, `distance()`, the refusal `status_distance {theme, role, state}`, `status_glyph_shared`,
  `status_contrast`) and `check.rs` ("status can show" = `status_bindings` non-empty), `crates/deep-canvas-marks/looks/
  clean.json`, `crates/deep-canvas-sheet` (`deep-sheet render` takes stills, not documents; `cell_key`),
  `crates/deep-canvas-record` (`deep-salience`), `crates/deep-show`, `crates/deep-app`.

What the base already does and these tests don't credit: the 2D look (`deep-canvas-marks`) resolves a `look@1`, refuses
a look whose data roles come within `min_distance` of a status color with `status_distance`, and draws 2D status marks
with glyphs and a legend (#392); the GPU layer (`deep-gpu`) draws 3D documents with the shipped effects through
`view3d`, with tone mapping and exposure (#378, #380). There is no status guard pass, no status binding on a 3D object,
no status map read by the 3D look, no `status` in `view3d`'s reply, no host (return card, level-of-detail open or sheet
cell) that draws a document inside it, and no revision cache a host could miss. So these tests define the surface below.

## Run them

They build one cargo binary, as #377's, #378's and #380's suites do, so they run with `--no-file-parallelism`.
`scripts/lanes.mjs` needs this folder in its `alone` list, beside `tests/acceptance/380/`. This README is the
instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/382 --no-file-parallelism
npx tsc -p tests/acceptance/382/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds the binary, once, with `cargo build --locked --bin deep-gpu` (with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0`) in the checkout, copies it out of `target/debug` to a temporary folder, and fails each test
that uses it if the build failed. Each test writes into its own temporary output folder and deletes it. The tests use
node built-ins and vitest. A run with `--root tests/acceptance/382` leaves Vitest's cache in
`tests/acceptance/382/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

Every test that draws or guards runs the GPU layer on Metal, on macOS, headless, as #380's do: off macOS they fail with
a message that starts `INCONCLUSIVE:`, and never pass there; a reply of `unsupported_platform` reads the same way. The
first test of each file holds the suite's own colors to its OKLab math and needs no GPU.

## The surface under test

The issue names the status guard's fields, hosts and looks, but no code API. The guard runs over pixels material and pass
operators wrote, after the finish and before status colors, which only the GPU layer draws; so these tests extend **#377's
`deep-gpu run` with its JSON-lines protocol unchanged: #378's `view3d` with three more input fields and one reply field,
and two new calls, `host` and `guard`.** No new binary. The base's `deep-sheet` takes stills, not documents, and no
binary at the base draws a return card or a level-of-detail open, so the hosts are this suite's `host` call (Readings).

### `deep-gpu run [--planted <name>]`

Unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with exactly one line `{"ok": true,
"replies": [Reply]}`, one reply per call, then exit 0; a line that isn't a scenario answers `{"ok": false, "code":
"bad_input"}`; an unknown argument or planted name answers one such line and exits 2. Files are written under `out`,
each named by the SHA-256 of its bytes with its extension (`.png`, `.f32`). A reply with a `code` is a refusal, except
`unsupported_platform` off the reference platform.

### Looks and documents (`helpers.ts`)

A look is #380's `look@1` for a 3D writer layer (physical basis, `tone_map: none` at EV100 −log₂ 1.2, the exposure whose
scale is 1, `finish: []`, `deband: none`, bloom and the ground grid off unless a test turns them on) with the status
fields the issue names and the clean look's values: `status` (the nine states' colors), `status_treatment` (one glyph
per state), `min_distance: 0.1`, `attention_treatment`, `legend: "auto"`, `themes.light` and `themes.dark`, and the
clean look's fonts. `look3(id, roles, change)` writes one; `roles` maps each data role to an 8-bit color through the
palette, the ground is `night` (#101114). A test that changes the status map changes `status.fail` only.

Documents use #378's shape (envelope, one writer layer `main` whose writer is `agent-a`, items `mark.box@1`,
`camera@1`, `light.sun@1`, `requires: {modules: {scene3d: "^1", effects: "^1"}}`), 480 × 360. `film(id, {binding})`
in `helpers.ts` is the one scene every test draws: three boxes (`lamp`, `block`, `crate`, by role) on a floor slab
(`floor`), a sun with `illuminance` π and `rot: [0, 0, 0]` (it shines along −Z, so its `toward` is +Z) and a
perspective camera at orbit azimuth 0, elevation 0 (on the +Z axis). Each box's +Z face faces both the sun and the
camera, so with the shading `0.25 + 0.75 × facing` at facing 1 and the exposure's scale 1, it draws its role's color
exactly; the other visible faces draw darker. With `binding`, the document carries

```json
"status_bindings": {"b-lamp": {"target": "items/lamp/params/paint/badge", "source": "verdict:01JB3820000000000000000382"}}
```

a status binding on the lamp's badge slot (Status binding: a 3D object's binding takes its stroke or badge slot, never
its fill). The badge is a status mark: a square of the look's `core_min_px` or more, anchored to the item on screen,
drawing the state's color exact with the state's glyph in the same item.

### `view3d` (#378's call, three more input fields and one reply field)

```json
{"call": "view3d", …#378's and #380's fields…, "states"?: {handle → state}, "theme"?: "light" | "dark"}
```

- `look` may be a `look@1` with the status fields above; the call reads them. A `look@1` with no status map keeps
  #380's behavior.
- `states`: the record's state for each status binding's source, pinned to the frames, as #392's `render` takes it.
- `theme`: the theme the status map and roles resolve in (default `light`).
- The document may carry `status_bindings` (above). Status can show in a `view3d` call exactly when the document has a
  status binding (the status-color rule's first case; there is no host here). Then: the look's check applies to the
  document's data roles (every role of its palette the document's items use, the ground aside) against the look's
  status map at the look's `min_distance`, and a role within it refuses the call with the look's existing refusal,
  `{"ok": false, "code": "status_distance", "role": role, "state": state, "theme": theme}`, naming the data role and the
  status color it clashes with; the status guard runs over every pixel a material or pass operator wrote, after the
  finish and before status colors; the status marks and their legend draw on top. Without a status binding the
  document is an art film played on its own: any palette, no guard, no legend, no marks.

The reply adds `status`:

```json
"status": {"shows": bool, "look": "document" | "host", "distance": f64 | null,
           "guard": {"ran": bool, "pixels_moved": n} | null,
           "marks": [{"item", "binding", "state", "slot": "badge" | "stroke", "color": [r, g, b], "bounds": [x, y, w, h], "glyph": string | null, "label": [x, y, w, h]}],
           "legend": [{"state", "glyph", "word", "color": [r, g, b], "swatch": [x, y, w, h], "label": [x, y, w, h]}]}
```

`shows`: whether status can show in this frame. `look`: whose status map, legend and distance applied (`document` here).
`distance`: that look's `min_distance` when status can show, else null. `guard`: whether the status guard ran on the
frames drawn and how many pixels it moved in frame 0 (the `status_guard` notice's count, unsampled), null when status
can't show. `marks`: one per status binding drawn in frame 0, with its 8-bit sRGB color, its bounds and its glyph's box
in frame px; `legend`: one entry per state on screen, with its swatch's and label's boxes. Boxes are in pixels of the
final target. Colors are sRGB-encoded 8-bit, as the final target holds them.

### `host`

```json
{"call": "host", "kind": "return_card" | "lod_open" | "sheet_cell", "look": look@1, "theme"?: "light",
 "size": [w, h], "doc": path, "doc_look"?: look@1, "states"?: {handle → state},
 "frames"?: 1, "fps"?: 60, "revisions"?: [{"frame": n, "writer": id, "ops": [op]}],
 "targets"?: ["final" | "ids"], "capture"?: [n]}
```

Draws the document at `doc` inside a host of `kind` through the GPU layer, frames 0 … `frames − 1` at t = n ÷ `fps`,
at `size`: a return card that shows the document (a view of the record showing a work product), an item whose
level-of-detail `open` loaded the document by reference, or a sheet cell whose `show` is the document's handle. `look`
is the host's look; `doc_look` the document's own (its roles color its items; when left out the host's roles do). In
every kind the document is shown inside a view of the record, so status can show whatever the document binds: the
host's status map, legend and status distance apply ("A document shown inside another takes its host's status map,
legend and status distance"), the data roles the document uses are checked against the host's status map at the host's
distance, and a clash refuses the call with `status_distance` as `view3d` does. `revisions` are #378's patches on the
document's writer layer: at `frame` the writer commits a new revision with `ops`; the host checks it (the host's check:
the document check in the host's look, the status distance among it) off the frame loop, and it becomes current only if
the check passes, a refusal keeping the last good revision current. The host keeps its own cache of what it shows (the
card's drawing, the opened document's layer, the cell's texture), keyed by the shown revision's content key, size,
treatment and look; a new current revision misses it. Replies:

```json
{"frames": [{"frame": n, "rev": r, "current_rev": c, "pixel_hash": sha256, "final"?: sha256, "ids"?: sha256, "picks"?: {…},
             "cache": {"key": sha256, "hit": bool}}],
 "checks": [{"rev": r, "ok": bool, "issues": [Issue]}],
 "status": {…as view3d's, "look": "host"…}}
```

Per frame: `rev`, the document revision whose pixels the host shows at that frame; `current_rev`, the newest checked
revision at that frame; `pixel_hash`, `final`, `ids`, `picks` as #378's `view3d` gives them for the frame as drawn
(the host at `size`); `cache.key`, the host's cache key for what it showed, and `cache.hit`, whether that key was
already in the host's cache when the frame drew. `checks`: every run of the host's check, in order, one per revision
checked, with #389's issue shape (`{check, code, severity, ids, path, actual, what, fix}`); a refused revision's issues
include one with code `status_distance`. `status` as `view3d`'s, for frame 0, with `look: "host"`.

### `guard`

```json
{"call": "guard", "look": look@1, "theme"?: "light", "size": [w, h], "input": path}
→ {"output": sha256, "pixels_moved": n, "distance": f64, "colors": {state → [r, g, b]}}
```

Runs the status guard's pass on this machine's GPU over `input`, an f32 image (little-endian f32 RGBA, rows top-down,
`w × h × 16` bytes, as #380's `reference` writes targets) of display-referred, sRGB-encoded pixels in [0, 1], as the
finished frame of a document where status can show, and writes the result as an f32 file of the same shape under
`out`, named by its hash. `pixels_moved` is the count of pixels the guard moved; `distance` the look's `min_distance`;
`colors` the look's status map in `theme` as 8-bit sRGB. Alpha passes through. Off the reference platform it answers
`unsupported_platform`.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `guard_everywhere` | The status guard runs and the legend draws in every document, a film that binds no status and is played on its own included | 1 (a mutant) |
| `guard_half_distance` | The guard moves pixels only within half the look's distance (0.05) | 2 (a mutant) |
| `host_keeps_document_look` | A host draws a document's status marks and legend with the document's own status map and checks its roles at the document's own distance | 3 (a mutant) |
| `host_cache_by_doc_id` | A host keys its cache by the document's ID, so a new revision hits the cache and the host shows the earlier one | 4 (a mutant) |
| `host_check_once` | A host checks only the first revision; later ones become current unchecked | 4 (a mutant) |
| `guard_to_grey` | The guard moves every clashing pixel to the achromatic OKLab (0.80, 0, 0) instead of along the line | 5 (issue-named: "a planted guard that maps to grey") |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading
`- [ ] ` dropped (#305's command, with the issue's five criterion lines on stdin). Each test's name starts with its
criterion's ID. Where a criterion names a wrong program, the test runs it through `--planted` and asserts it fails the
way the criterion says; where it names none, a planted mutant or the base shows the check can fail. The first test of
each file holds the suite's own colors to its OKLab math (below, "holds at the base").

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#382.1baf9f5b` | An art film that binds no status, played on its own, keeps a data color 0.02 OKLab from the fail color unchanged, runs no status guard and shows no legend; the same film shown on a return card, or given one status binding, is refused naming the data role and the status color it clashes with | `art-film.test.ts`: the film's lamp takes the 8-bit color 0.02 OKLab lighter than fail (#c62c31, 0.0201 from #bf232b by this suite's math). Played alone (`view3d`, no binding): accepted; `status.shows` false, no guard ran, no legend, no marks; the lamp's most common pixel (by the ID target) is its role within one code; at least 100 pixels of the frame lie within 0.10 of fail. On a return card (`host` with `doc_look`) and with one status binding (`view3d`): refused `status_distance` naming `lamp` and `fail`; the bound film with the lamp 0.12 from fail is accepted, so the refusal is the clash's. Wrong programs: the base (`view3d` reports no `status`, refuses nothing, has no `host`); `--planted guard_everywhere` fails the film alone, naming the guard, the moved pixels or the legend |
| `#382.1b194e8e` | Wherever status can show, no operator pixel ends within the look's status distance of a status color, checked on a fixture that tries | `guard-pixels.test.ts`: the film with its lamp bound, bloom on, roles 0.11 OKLab lighter than fail, pass and running (#e64d4c, #36964a, #3385dc; the look's check passes at 0.10), so the shading darkens the boxes' side faces into the status colors. With the binding in state fail: `status.shows`, the guard ran and moved at least one pixel; every pixel outside the marks' and the legend's boxes (grown 2 px) keeps at least 0.10 − 0.005 from every status color (none listed); the mark's most common pixel and reported color are the fail color exactly. The fixture tries: the same film with no binding, played alone, has at least 200 pixels within 0.10 (holds at the base). Wrong programs: the base (no guard, no `status`); `--planted guard_half_distance` leaves pixels between 0.05 and 0.10, named |
| `#382.ad26ea13` | A document whose look maps fail to a different red than its host's, drawn on a return card, shows its status binding in the card look's fail color under one legend, and the status distance its data colors keep is the card look's | `card-look.test.ts`: the document's look maps fail to #b93c85, 0.12 from the card's #bf232b (a cooler crimson, 0.12 from every other status color too); its lamp is #ea504f, 0.12 from both reds and every status color. On the card: `status.look` is `host`, `status.distance` 0.10; one mark, state fail, reporting and drawing (most common pixel inside its bounds) #bf232b; the legend names fail once, every entry in the card's colors, none within 0.01 of the document's red. The distance: a lamp #dc4243 (0.08 from the card's fail, 0.12 from the document's own, 0.12 from every other status color) passes drawn alone under the document's look and is refused on the card naming `lamp` and `fail`. Wrong programs: the base (no `host`); `--planted host_keeps_document_look` draws the mark in the document's red |
| `#382.90bd5f67` | A new revision of a document that a host shows through level-of-detail open or a sheet cell misses the host's caches and reruns the host's check, so the host never shows the earlier revision after the new one is current | `host-revision.test.ts`, for `lod_open` and for `sheet_cell`: nine frames at 60 fps of the bound film; revision 2 at frame 3 recolors the lamp to the crate's role, revision 3 at frame 6 to `spill` (#d1373a, 0.05 from fail). Frames 0–2 show revision 1 (frame 0 a cache miss, 1–2 hits on one key), 3–8 show revision 2 (frame 3 a miss on a new key, 4–8 hits), `rev` equals `current_rev` at every frame, frame 3's pixel hash differs from frame 2's and equals a fresh host run whose first revision is the recolored document; `checks` has exactly three entries, revisions 1 and 2 ok, revision 3 refused with a `status_distance` issue, and revision 2 stays current. Wrong programs: the base (no `host`); `--planted host_cache_by_doc_id` hits at frame 3 and shows revision 1 (named); `--planted host_check_once` checks once, so revision 3 becomes current and two checks are missing |
| `#382.5bb38907` | The guard moves a pixel along the OKLab line from the nearest status color through it to the look's distance, gamut-clipped and checked again against every status color: a pixel 0.05 from fail red lands 0.10 from it within 0.002, and one 0.12 away keeps its value; of 10,000 seeded pixels near each status color none ends within the distance; a planted guard that maps to grey passes the second test and fails the first, naming the pixel | `guard-line.test.ts`: a 300 × 301 f32 image: (0, 0) fail moved 0.05 along +L in OKLab, (1, 0) the same moved 0.12, then 10,000 pixels near each of the nine status colors from the seeded sampler (below), then black. Through `guard`: (0, 0) lands 0.10 from fail within 0.002 and within 0.002 OKLab of the point on the line from fail through it; (1, 0) keeps its value within 1e-4 per channel. Of the 90,000 seeded pixels none ends under 0.10 − 0.0005 from any status color; those already at the distance keep their value; those whose line stays in gamut and keeps the distance from every other status color (about 30,000) land within 0.002 of the line's point; `pixels_moved` equals the count of inputs inside the distance. `--planted guard_to_grey`: the seeded check raises no "ends within" failure, and the line check fails naming `pixel (0, 0)`. Wrong programs: the base (no `guard`); the planted grey; a guard that stops short or overshoots (the 0.002), one that moves pixels already at the distance, one that leaves the line |

Holds at the base: the first test of each file, which holds the suite's own colors to its OKLab math (0.02, 0.05, 0.08,
0.11 and 0.12 from the status colors, the lamps nearer fail than any other state, the sampler's determinism) and runs no
binary, and `guard-pixels.test.ts`'s "the fixture tries", which draws the AC2 fixture with no binding through the base's
`view3d` and finds the pixels a guard must later move. They catch a doctored color table or sampler, which would make
the other tests vacuous; they prove nothing about the implementation and are not criterion proofs on their own.

## Readings where the issue and design leave a choice

- **One binary.** The guard runs over pixels operators wrote after the finish, which only the GPU layer draws, and the
  hosts show documents drawn through it; so this suite adds calls on #380's `deep-gpu`, not on `deep-canvas-render`
  (whose look and marks are 2D) and not a new binary. The refusal is the look's existing `status_distance {theme,
  role, state}` (`crates/deep-canvas-marks/src/look.rs`), so an agent branches on a code, never on text.
- **The hosts.** The base has no surface that shows a document inside a return card, a level-of-detail open or a sheet
  cell (`deep-sheet` renders stills; `deep-salience` ranks; the app's return card is R2). The `host` call is the
  smallest one: a kind, the host's look, the document and its own look, frames and revisions. The three kinds are read
  as one rule with three hosts: in each, the document is shown inside a view of the record, so status can show and the
  host's map, legend and distance apply. `return_card` is used for criteria 1 and 3, `lod_open` and `sheet_cell` for 4
  (the ones the criterion names); the other combinations are not tested.
- **"Shown on a return card"** for the art film: a return card is a view of the record, so the status-color rule's
  third case applies and the film's data palette is checked against the card's status map; the refusal names the role
  and the state, as the rule says, through `status_distance`.
- **"Given one status binding."** The binding is on the lamp's badge slot: a 3D object has a material, so its binding
  takes its stroke or badge slot (Status binding). The badge is read as a status mark with bounds and a glyph in frame
  px, as #392's `render` reports 2D marks; its exact shape and anchor are the implementer's.
- **"Keeps a data color unchanged"** is read on the +Z face that faces the sun and the camera: at facing 1 the shading
  is 1 and the exposure's scale 1, so the face draws the role exactly; one 8-bit code of slack covers the encode. The
  test also counts the frame's pixels within the distance of fail (hundreds, from the lamp's lit face and the near
  shades): a guard would have moved them.
- **"Checked on a fixture that tries"** is the film with roles 0.11 from three status colors (so the look's check
  passes) whose shaded faces fall inside the distance, with bloom on so a pass operator writes every pixel. The
  tolerance 0.005 is the largest OKLab move an 8-bit quantization gives a guarded pixel at the status colors'
  lightnesses (about 0.003 per code at L ≈ 0.5); pixels the marks and the legend own are excluded by their reported
  boxes grown 2 px.
- **"The status distance its data colors keep is the card look's"** is read both ways: a lamp inside the card's
  distance but outside the document's own is refused on the card and accepted alone, and the report says the host's
  distance. The two fail reds are 0.12 apart so one 8-bit code can't confuse them; the document's red is 0.12 from
  every other status color too, so the document's own look is a plausible look.
- **"Misses the host's caches and reruns the host's check"** is read through the reply's `cache.hit`, `cache.key` and
  `checks`, since no pixel shows a cache hit; and through pixels where they can: the new revision's frame differs from
  the old one's and equals a fresh run of the recolored document. "Never shows the earlier revision after the new one
  is current" is `rev == current_rev` at every frame. The host checks a revision off the frame loop; the test gives it
  no frames of slack: the revision committed at frame 3 is current at frame 3. A revision the check refuses never
  becomes current (Document session), so revision 3 keeps revision 2 on screen; this is the proof that the check reran.
- **Gamut clipping** is each linear sRGB channel clamped to [0, 1]. Where the line's point leaves the gamut, or where it
  lands within the distance of another status color, the issue's "checked again" leaves the landing point to the
  implementer; the test then requires only that the pixel ends outside the distance of every status color. Where the
  point stays in gamut and clear, the landing point is predicted and held to 0.002.
- **The guard's pixel space** is display-referred, sRGB-encoded, in f32: the guard runs after the finish, on what the
  finish wrote, before 8-bit quantization. The `guard` call takes and returns f32 so the 0.002 is measurable (one
  8-bit code can move a pixel 0.003).
- **The seeded pixels.** A 32-bit LCG (x ← 1664525·x + 1013904223 mod 2³², uniform = x ÷ 2³²) from seed 382, the
  issue's number; per status color, in the legend's order, 10,000 pixels: a direction uniform over the sphere (three
  uniforms in [−1, 1), rejected outside the unit ball or inside radius 0.001, normalized) and a distance uniform in
  [0, 0.10); the point in OKLab, to linear sRGB, clamped, encoded. About 89,960 of the 90,000 lie inside the distance
  after clipping; the rest are "already at the distance" and must keep their value.
- **"A planted guard that maps to grey"** is the achromatic OKLab (0.80, 0, 0), which is at least 0.29 from every
  status color (all nine sit at L 0.49–0.52), so it passes the seeded test and fails the first, as the criterion says.
  "Naming the pixel" is the failure sentence that starts `pixel (0, 0)`.
- **Planted programs** are `--planted` names on the binary, each reachable only there, as #377's, #378's and #380's.
  `pixels_moved` in the guard's report is read unsampled in a test run; the design's notice is sampled.
- **Themes.** Every test runs in the light theme; the clean look's status map is the same in both themes.

Not tested, because no criterion asks or the surface can't reach it: the dark theme; the stroke slot's outline; a
return card showing a document through `lod_open` or `sheet_cell` combinations other than the criterion's; legend
clicks; the `status_guard` notice's sampling; the guard over blended groups and composed graphs; grade and tone maps
other than `none` under the guard (the mark's exactness is checked at `none`; "after tone mapping" is read on the
compose order the design fixes); the 2D marks module's own guard; the host's timing and budgets.
