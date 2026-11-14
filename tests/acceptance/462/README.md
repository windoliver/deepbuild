# Acceptance tests for #462: look regions, motifs and strokes that hold on 3D surfaces

Written first, from issue #462 (its summary, Scope, Fields, five acceptance criteria, Proof line and Depends on), its
oracle page, the design sections it links and those they lean on, and base commit `f6d811c79` ("Merge pull request #2392
…"), by a job that never saw an implementation; none existed, and no other branch, worktree or pull request was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- Issue #462, live with `gh issue view 462 --repo windoliver/deepbuild`, and its oracle page
  (`doneright/oracles/issues/462.md` in DeepBuildAI/deepbuild, branch `doneright`): no upstream test checks any of the
  five criteria, so nothing is ported (the Oracle lane has nothing to run).
- `docs/technical-design.md`: Look; GPU operator; Frame history; Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Look `look@1` (its fields and semantics: one look per shot, the status map and legend the
  document's) and its sections regions and edges, motifs, strokes on surfaces and frame history (seek equals play);
  The status-color rule; Status binding (the legend "appears whenever a status color is on screen"); Pack: art@1
  painterly looks; Shot; Transition (both sides draw offscreen and blend inside the window; status draws once, after
  the blend); Transport (reduced motion: "motifs … hold"); Marker (kind `hold`); the Reading holds row; Held reading;
  Order keys and collections (`collections: {ID → {members}}`); Units and axes (m, +Y up, degrees, px, flicks).
- At the base, only to find the surfaces that exist and how earlier suites drive them: `crates/deep-gpu-layer`
  (`main.rs`: `enum Planted`, `fn call`, `refused`; `view3d.rs`: `parse`, the status layer per frame, the reply;
  `film.rs`: `film2d`'s fields; `status.rs`: the status report and legend; `frames.rs`: `pixel_hash`);
  `crates/deep-canvas-scene3d/src/{look,history,scene,samples}.rs` (Look3, a look without `history` keeps none, the
  camera's projection, reading holds as `hold` markers); `crates/deep-canvas/src/camera.rs` (`orbit_direction`,
  `screen_basis`, the field of view across the wider side), `canon.rs` and `main.rs` (`deep-canvas canonical`);
  `crates/deep-canvas-motion/src/shots.rs` (shots and transitions compiled at check); `crates/deep-canvas-marks/looks/`
  (`clean.json`); `scripts/proof-change.mjs` (criterion IDs); `scripts/lanes.mjs` (`alone`); and the suites
  `tests/acceptance/450/` and `449/` (helpers this suite imports, `twins.json`, the taste call, README layout), `382/`
  (the `status` report, the status film's sun and camera, PNG reading; helpers this suite imports), `493/` (shots and
  transitions as documents write them), `464/` and `417/` (`film2d`, `reduced_motion`), `420/` and `422/` (an orbit keyed
  on `items/cam/params/orbit/azimuth`), `372/` and `1965/` (a document's hash).

## What the base already does, which these tests don't credit

`deep-gpu run`'s `view3d` draws a document's 3D writer layers under one look@1, the call's `look`, frame n at
⌊n × 705,600,000 ÷ fps⌋ flicks, each frame with its `pixel_hash` (SHA-256 of the final slot's bytes); `from` opens the
view at a frame (a seek); a channel on `items/cam/params/orbit/azimuth` orbits the camera. With `status_bindings` and
`states`, status shows: badge marks in the look's status colors after tone mapping, and a legend, reported in `status`
for the call's first frame (#382). `film2d` plays a 2D film under one look, with `hash`, `capture`, `targets` and
`reduced_motion` (#417, #464). `deep-canvas canonical` answers a document's revision hash. Shots and transitions compile
in the motion program (#493), and markers of kind `hold` are the reading holds the frame's samples read (#419). There is
no `strokes`, `regions`, `motifs` or `motif_slots` anywhere in `crates/`: no look draws strokes, no shot draws a second
look, no motif moves anything, `view3d` draws every frame in its one look and reads no shot's look, and neither call
reports strokes or a document hash.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/462 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/462/tsconfig.json
rm -rf tests/acceptance/462/node_modules/.vite
```

Each file builds what it drives once, in `beforeAll` (#449's `useBins`): `cargo build --locked --bin deep-gpu`, and for
`ac4` also `cargo build --locked --bin deep-canvas`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0` and `NO_COLOR=1` unless set and Homebrew's rustup put first on `PATH` when present, and copies
each binary into a temporary folder. No test feature is needed: a planted program is `deep-gpu run --planted <name>`.
Every test passes its own timeout (60 minutes); each call writes into the test's own temporary folder, deleted after it;
processes are started by `spawnSync` and stopped only by their own timeout.

**`scripts/lanes.mjs` needs this suite in its `alone` list**, beside the other `deep-gpu` suites, because its files build
cargo binaries and draw on the Metal device. This README is the instruction; the implementer adds the line:

```js
alone.push('tests/acceptance/462/');
```

Gates: no cargo is `BLOCKED:`, a failed test, never a pass. Every reading here comes from `view3d` or `film2d` drawing on
Metal: off macOS, or wherever a reply says `unsupported_platform`, a test fails with a message starting `INCONCLUSIVE:`,
never passing. `taste.test.ts` is INCONCLUSIVE until the owner's call is recorded (below). No test reads a timing.

## The surface under test

The issue names fields but no call. **Every call field, reply field, refusal shape, document field shape and planted name
below that the issue or the design doesn't give is this job's invention**, the smallest the criteria need, on the two
binaries that already draw 3D views (`view3d`) and 2D films (`film2d`) in `deep-gpu run`. The implementer builds exactly
these, or a dispute goes to a blind redraft. `runGpu`'s scenario is #449's (`{"out", "calls"}` in, `{"ok": true,
"replies"}` out); #378's, #380's, #382's, #417's and #464's fields hold unchanged except where said below. Times in
requests and replies are whole flicks (705,600,000 a second); places are world metres as f64; frame px have their origin
at the frame's top left corner, x right and y down, a pixel's centre at (i + 0.5, j + 0.5).

### `deep-gpu run`: `view3d`, two request fields

```json
{"call": "view3d", …, "looks"?: {"<name>": look@1, …}, "strokes"?: true}
```

- **`looks`**: the looks the document's shots and regions name, by name. The call's `look` stays the document's own look:
  a frame outside every shot, or in a shot that names no look, draws in it, and its status map, status distance and
  legend are the ones status draws with in every shot, region and transition (#382's `status` report, unchanged in
  shape). A shot's or region's look not in `looks` is a refusal of the document.
- **What a frame draws** (the document fields below): a frame in a shot draws the shot's look, and each region of that
  shot draws its look over what its mask holds; each pixel is the drawing looks' renders mixed by their coverage, which
  sums to one at every pixel. A region's `edge` shapes where, and how softly, coverage passes from the outer look to the
  region's along the mask's boundary as seen (seeded from the region's `seed`); it adds no paint of its own. Inside a
  transition window both sides draw, each with its own looks, and blend by the transition; status marks and the legend
  draw once, after everything, in the document's look. Whether `view3d` moves the camera by a shot's pose these tests
  don't read: every shot here holds the camera's own pose.
- **The three-look refusal**: a document in which some frame outside every transition window would draw three or more
  looks is refused by the check before any frame is drawn. The reply carries a `code` (not pinned) and no `frames`, and
  holds, at any depth, an object `{"shot": "<shot ID>", "t": <whole flicks>, …}`: the shot, and a time at which three
  looks would draw in it.
- **`strokes: true`**: each frame gains

  ```json
  "strokes": [{"id": "<stroke ID>", "item": "<item ID>", "anchor": [x, y, z], "at": [x, y]}, …]
  ```

  one entry for every stroke the frame draws (a stroke a live view leaves out while moving isn't listed): `id`, the
  stroke's stable ID, unique in the frame and the same in every frame that draws the stroke; `item`, the item whose
  surface it is laid on; `anchor`, the point on that surface where it is laid, world m, f64, as the check laid it out;
  `at`, where the frame draws the centre of its quad, frame px, f64. Asking for `strokes` changes no pixel.

### `deep-gpu run`: `film2d`, one reply field

```json
{"size": …, "frames": […], "switches": […], "document": {"opened": "<sha256>", "played": "<sha256>"}}
```

`document.opened` is the canvas core's revision hash of the document the film opened (`deep_canvas::document::canonical`,
the `sha256` that `deep-canvas canonical` answers for it); `document.played` is the same hash of the document the film
holds after drawing its last frame. Always present on a drawn film.

### Document fields (the shapes the issue leaves open)

- **`strokes`**, a look@1 field: `{"on": "all" | "<collection ID>", "density": strokes per px² at design size, "size":
  [min px, max px], "orient": {"surface": "u" | "v"} | {"flow": "<vector_field@1 ID>"}, "palette": {"<role>":
  ["<palette name>", …]}, "layers": 1 to 3, "seed": "item"}`. `orient.surface` names a surface direction, the face's
  first or second tangent; `palette`'s keys are the fill role of the surface the strokes are laid on (the issue's
  "region" read as the part of the picture a role paints), each a list of the look's palette names a stroke takes its
  color from. Design size is the document's `size`, which these tests draw at.
- **`motifs`**, a look@1 field, as the issue writes it: `{"<slot>": {"motion": "drift" | "swirl" | "pulse" | "sway" |
  "shimmer" | "flicker" | "boil", "amount", "hz" | "rate": {"beats": f32}, "phase": "free" | "alternate", "hold_on":
  ["<marker kind>"], "desync": bool, "seed": "document" | "item"}}`; `amount` in the motion's own unit (u for drift,
  degrees for sway).
- **`motif_slots`**, on the document's top level beside `collections`: `{"<slot>": "<collection ID>"}`, a collection
  being `collections: {"<ID>": {"members": ["<item ID>", …]}}` as at the base.
- **A shot's look and regions**: #493's shot (`shots: {"<ID>": {"start", "end", "camera", "move", "target", "orbit",
  …}}`) with `"look": "<name>"` (a key of the call's `looks`) and `"regions": [{"mask": "<item ID>", "look": "<name>",
  "edge": "straight" | "torn" | "pixel" | "brush", "width": px, "seed": u32}]`. A mask is the world-space volume of the
  item it names at the item's evaluated pose: here a `mark.box@1` with `"visible": false`, so it draws nothing itself.
- **A cross-fade**: #493's transition, `transitions: {"<ID>": {"from": "<shot>", "to": "<shot>", "kind": "cross_fade",
  "span": "1s", "align": "center"}}`.
- **A reading hold**: a marker `{"kind": "hold", "name", "t", "span"}` (Marker; #419's `hold` markers).

### Planted programs (`deep-gpu run --planted <name>`; `twins.json` maps each criterion to its names)

| Name | Criterion | The wrong program |
|---|---|---|
| `strokes_from_previous_frame` | 1 | each frame draws its strokes where the previous frame this call drew projected their anchors (the first frame of a call projects them itself), and reports those places as `at` |
| `region_sides_clip_independently` | 2 | each look clips its side of a region's edge by its own antialiased copy of the edge, the outer look's copy moved half the edge's width outward, so along the edge the two coverages sum to less than one |
| `status_in_look` | 3 | status marks and the legend draw in the look under them: its status map, through its tone map and exposure |
| `motifs_write_document` | 4 | each motif's offset is written into the film's document every frame (into its items' `at`), so the document the film holds changes as it plays |

## Fixtures

All are built by `helpers.ts`. The 3D documents are whole session documents (one writer layer `main`, `seed: 462`,
`requires: {modules: {scene3d, effects}}`), 480 × 270, drawn at that size unless a call says otherwise. Every 3D look is
#382's acceptance look (`look3`: physical, the clean status map and glyphs, `min_distance` 0.10, an automatic legend,
tone map none at exposure −log₂ 1.2, whose scale is 1, the finish at identity, no history) with its own roles.

- **The orbit** (`orbitDoc`, criteria 1 and 5): three boxes in role `body`, a plinth 3 × 0.4 × 3 m at (0, 0.2, 0), a
  block 1.2 m at (−0.3, 1, 0.2) and a tower 0.5 × 1.8 × 0.5 m at (0.9, 1.3, −0.7); a camera (fov 40°) orbiting
  (0, 0.6, 0) at 7 m and elevation 25°, its azimuth keyed linearly from 20° to 110° over the 3 s transport; a sun. The
  stroke looks (`strokeLook`): brush (density 0.006, size [4, 12], `orient: {surface: "u"}`, two palette colors, 2
  layers), dab (0.004, [7, 9], `{surface: "v"}`, two colors, 1 layer) and dot (0.01, [3, 3], `{surface: "u"}`, one color,
  3 layers), all `on: "all"`, `seed: "item"`, the palette keyed by `body`.
- **The edge films** (`edgeDoc`, criteria 2, 3 and 5): a camera on the +Z axis 7 m from (0, 0.5, 0) (fov 40°), a sun
  shining along −Z (#382's film: a +Z face facing both draws its role's color exactly), a slab 4 × 0.8 × 0.2 m at
  (0, 0.5, 0) in role `body`, and the mask `zone`, an unseen box 4 × 3 × 3 m at (2, 0.5, 0), so the slab's right half is
  in the region and the edge crosses it at the frame's middle column. Every shot holds the camera's own pose.
  - `split`: one shot `one`, 0–4 s, in look `a`, its region (`zone`, look `b`, edge torn, width 16 px, seed 3).
  - `fade`: shot `one` (0–2 s, look `a`, region `b`, torn) and shot `two` (2–4 s, look `c`, region `d`, brush, seed 5),
    joined by the cross-fade `fade`, 1 s centred on 2 s. With status: two posts 0.4 m at (∓1.4, 1.5, 0), `post-l`
    outside the zone and `post-r` inside it, their badges bound (`b-left`, `b-right`) to two verdicts the call pins to
    fail and running.
  - `crowded`: one shot `crowded`, 0–4 s, in look `a` with the zone in look `b` and, with the third look, a second region
    in look `c` whose mask `zone2` (1 × 3 × 3 m) a `hold` channel keeps at x = 30 m, off screen and around nothing,
    until 2 s, then at x = −1.5 m over the slab's left end.
  - The coverage looks a, b, c, d draw the slab (`body`) in (240, 210, 130), (240, 150, 230), (240, 110, 60) and
    (240, 250, 180): red 240 in each. The status looks keep tone mapping on (a filmic at EV 0, b AgX at 0.5, c neutral at
    −0.5, d filmic at 1), and b, c and d carry status maps of their own (fail #b93c85, running #1f7a8c); the status
    test's document look (the call's `look`) keeps the clean map and no shot or region names it. Every role these
    documents' items paint with is at least 0.14 OKLab from every status color, a look's own and the clean map's.
- **The motif film** (`motifFilm`, criteria 4 and 5): a 2D film, 480 × 270, 4 s, under the clean look
  (`crates/deep-canvas-marks/looks/clean.json` at the base) with two motifs, `sway` (amount 12, 0.5 Hz, alternate
  phases) and `drift` (amount 8, 0.4 Hz); three reeds (`rect@1`, collection `reeds`), a title (`text@1`, collection
  `words`), a sill nothing binds, and a reading hold from 1.5 s to 3 s. `all` binds `reeds` to `sway` and `words` to
  `drift`; `text` binds only `words`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`'s rule, applied to the live issue). Every test title starts `AC<n> #462.<id>`.

| Criterion | File | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| AC1 `#462.c53608f8` strokes stay on their reprojected anchors through an orbit; seek equals play by pixel hash | `ac1-strokes-orbit.test.ts` (4) | For brush, dab and dot: frames 0–45 at 15 fps, each stroke's anchor on its box's surface within 1e-6 m, the same anchor in every frame that draws it, its drawn centre within 0.5 px of the anchor projected through the camera the document gives at that frame; at least 50 strokes a frame, at least half drawn again in the next. Frames 13 and 37, each in a fresh process, equal the played frames by pixel hash; they differ, and frame 13 without the look's strokes hashes otherwise | `strokes_from_previous_frame` (named: "from its anchor's reprojection"); strokes laid in screen space or renamed each frame; reseeded anchors; strokes chosen by an earlier frame |
| AC2 `#462.1b887b5d` an item across a region's edge in both looks, coverage summing to one; a third look refused naming the shot and time; four looks inside a cross-fade | `ac2-region-edges.test.ts` (4) | `split` at 1 s: every slab pixel (3 px inside) has red 240 ± 1; left of the edge (30 px off) the slab is look a's color, right of it look b's, within one code. `crowded` with the third look: refused, naming `crowded` with t in [2 s, 4 s); without it, drawn at 2.5 s. `fade`: drawn; red 240 ± 1 on the slab at 1, 2 and 3 s; a \| b at 1 s, c \| d at 3 s; at 2 s green strictly between a's and c's on the left and between b's and d's on the right (3 codes in) | `region_sides_clip_independently` (named: "red other than 240"); one look for the whole shot; a check that counts looks only at a shot's start, or counts them inside a transition |
| AC3 `#462.2e279aeb` status colors exact in every look and region; the legend whenever they show | `ac3-status-exact.test.ts` (2) | The status film at 1, 2 and 3 s: status shows; two marks, each reporting and drawing (most common pixel inside its bounds, 1 px in) the clean map's color for its state; the legend lists exactly the states on screen, each entry and swatch in the clean color. Guards: two slab colors across the edge at 1 s and at 3 s, and the left half changing between them | `status_in_look` (named: `b-right`); status tone mapped, or from a shot's or region's status map |
| AC4 `#462.aac0f1f4` the document's hash unchanged; motifs still under reduced motion; text unmoved in a reading hold | `ac4-motifs.test.ts` (4) | `film2d`, frames 0–119 at 30 fps: `document.opened` is `deep-canvas canonical`'s hash of the document sent and `played` equals it; the frames change, and under the look without motifs frames 0, 15 and 30 are alike. Under `reduced_motion` all 120 frames hash alike (played normally they don't). With only the title bound, frames 46–89 (inside the hold) hash alike and frames 0–44 don't all | `motifs_write_document` (named: `played`); motifs that keep moving under reduced motion or move text in a hold |
| AC5 `#462.28d871fe` shown to you | `taste.test.ts` (1) | Writes three screenshots and two recordings from the renderer's own final PNGs to `target/acceptance/462/`; reads `TASTE.json` (below) | none: it is a person's call |

Every test but the taste call fails at the base at the missing surface (`BASE-FAILURE.txt`). None can pass on a program
that does nothing: each reads strokes, pixels, hashes or a refusal the program must produce, and holds guards (stroke
counts and persistence, two looks' colors across an edge, frames that differ, the strokes in the pixels) that an empty,
one-look or still answer fails.

## Readings where the issue and design leave a choice

- **Hosts.** Strokes, regions and status are read in 3D through `view3d`, where an orbit and world-space masks mean
  something (the Proof line asks for orbit recordings of the stroke looks and the region-edge fixture); motifs, the
  reading hold, reduced motion and the document's hash through `film2d`, the 2D film with text that already takes
  `reduced_motion`. The 2D halves of the sections (strokes on a moving page, regions in a long scroll) are not tested.
- **Stroke looks.** The fields have no stroke shape; brush, dab and dot are read as three settings of the same fields
  (size range, orientation, layers, density). Physical looks carry them here, so no drawn-look field enters.
- **"Its reprojected anchor".** A stroke's anchor is where the check laid it on its surface; "reprojected" is that
  point projected through the frame's own camera, which the test works out from the document (camera@1: the eye at
  target + distance · (cos el sin az, sin el, cos el cos az), forward toward the target, right = forward × +Y, focal
  length (wider side ÷ 2) ÷ tan(fov ÷ 2)), never from what the program reports. A stroke laid in screen space, reseeded
  or renamed between frames fails through its anchor moving, leaving its surface or its ID not persisting.
- **"Coverage summing to one"** is read in the pixels: every coverage look draws the slab with red 240, so any mix that
  sums to one keeps red 240 in linear or encoded light alike, and a gap or overlap moves it. That needs an edge that adds
  no paint of its own, which is how this README defines `edge`. One code of tolerance covers rounding; "every pixel" is
  every slab pixel 3 px inside its silhouette (the slab's own antialiased outline mixes with the ground).
- **"Draws all four inside its window"** is read at the window's centre: on each side of the edge the slab's green lies
  strictly (3 codes) between the two shots' looks for that side, which holds for any mix of both with weights in
  (0, 1), in either light, and fails when either side is missing.
- **"Refused naming the shot and time"**: the time is any at which three looks draw, so it lies in [2 s, 4 s) here; the
  refusal's code is not pinned. Three looks are judged by what each region's mask holds in view, so the second mask
  is kept off screen and around nothing before 2 s.
- **"Exact in every look and region"** is the clean map's color, bit for bit, as the mark reports it and as its most
  common pixel draws it, in a shot look, a region look, a second shot's looks and inside a cross-fade, under looks that
  tone map, expose and carry status maps of their own. "The legend shows whenever they do" is read at the same frames:
  exactly the states on screen, each swatch exact.
- **"The document's hash"** is the canvas core's revision hash (`deep-canvas canonical`) of the film's document as it
  opened and after its last frame; a look is no part of the document.
- **"Hold still under reduced motion"** is read as no motion at all: every frame alike, which holds wherever the motifs
  freeze; "never move text during a reading hold" as the title's frames alike inside the hold, the edges of the hold
  left out by one frame.

## The taste call

`taste.test.ts` writes, from this run's own frames: `region-edge.png` (the split film at 1 s, its slab across a torn edge
between looks a and b), `strokes.png` (the brush look's strokes on the boxes, orbit frame 22) and `status-legend.png`
(the status film at 1 s with its two marks and the legend), 640 × 360 each; `orbit.apng` (the brush look's orbit, frames
0–45 at 15 fps, 320 × 180) and `motifs.apng` (the motif film, frames 0–59 at 15 fps, 480 × 270), all in
`target/acceptance/462/`, printing each SHA-256. Show them to the owner in the session and attach them to the PR; record
the one answer in `tests/acceptance/462/TASTE.json`:

```json
{"issue": 462, "criterion": "#462.28d871fe", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"region-edge.png": "<sha256>", "strokes.png": "<sha256>", "status-legend.png": "<sha256>"},
 "recordings": {"orbit.apng": "<sha256>", "motifs.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it.

## Not tested

Strokes in 2D (on a page that pushes or rolls); `orient` from a flow field; `on` a collection; stroke sizes, colors and
`layers` beyond their being drawn; a live view drawing half its strokes while moving and settling at rest; regions in a
2D film; the `straight` and `pixel` edges; `edge` defaulting to the incoming look's; an edge's seed; a look's legend or
status map changed by a region beyond the colors read; motifs' rate in beats on the tempo map, `alternate` phases,
`hold_on`, `desync` offsets and `seed`; motifs touching only the items a scene binds; the swirl, pulse, shimmer, flicker
and boil motions; costs and budget classes; art@1's looks.

## Upstream tests (the Oracle lane)

The oracle page lists no upstream test for any criterion. None is ported.
