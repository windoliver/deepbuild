# Acceptance tests for #1401: Ask the picture — pixel probes on render-back say what's at a pixel, with exact points

Written first, from issue #1401 (its scope, its Fields block, its five acceptance criteria and its proof line), the
design sections it links and those they lean on, and the base commit `3134672ec` ("Merge pull request #2265 …", which
holds #424's object-ID pick and #1976's hit path), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion, one file each, the planted twins inside the tests that name them.

## What was read

- Issue #1401; its siblings #1400 and #1217 and its dependencies #424 and #1976, for vocabulary only.
- `docs/canvas-primitives.md`: Render-back (the request `{doc, rev, t, size, camera, include, actions}`, `camera: item
  ID | pose | view`, `probes: [[x, y]] ≤ 64`, the reply's `hits: [[{item, sub, point: f64[3], normal, distance, geo:
  {lon, lat, height}}]]`, "up to 8 a probe, nearest first", and the sentence "A probe returns what lies under a pixel on
  the offscreen copy at the requested `rev`, `t` and camera, through the object-ID pass and a CPU ray on evaluated
  triangles, ties broken by ID, … a sky pixel returns no hits, a pixel on another writer's layer returns
  `ref_unresolved` and no position, and a probe, like all of render-back, is display only, never evidence"; "It can
  never: Read other writers' layers"); Selection (session state) (point and ask's `view` pose and `hit`, "A `hit`
  comes from the object-ID pick, then a CPU ray on the evaluated triangles, never a depth reading"); Handles ("Any other
  handle is `ref_unresolved` for that writer, and a reply returns a value only to a caller that may read it too");
  Order keys ("Ties break by ID"); Writer layer; Patch; Revision; Camera `camera@1` (`position`, `target`, `fov`
  "across the wider side", `near`, `far`); Material (`alpha_mode: blend`); Object: see-through order; Marks in 3D
  (`mark.box {size: m}`); Channel and key (`type`, `keys`, `interp: linear`).
- `docs/technical-design.md`: Render-back ("never as evidence or proof"); Dogfooding.
- At the base: `crates/deep-show/src/main.rs` (the `render_back` call's parse: `session`, `doc`, `t`, `rev`, `size`,
  other fields ignored; the scenario's `planted`, an unknown name `bad_input`), `ask.rs` `render_back`, `input.rs`
  `snapshot`, `hub.rs` `draw3d`, `scene3d.rs` `Gpu3`, `shared.rs` (documents stored at revision 0 with their layers,
  patches by session), `modes.rs` (a 3D mode reads `mesh.asset@1` glTFs from the evidence store),
  `crates/deep-canvas-scene3d/src/hit.rs` and `scene.rs` (`Camera`, how box marks, materials and channels are
  evaluated), `crates/deep-gpu-layer` (`view3d`'s clicks and `--planted` table), `packages/hub/src/canvas.ts`
  `showCall` and `core.ts` (the `deep_show` tool forwards a call with no document or patch as `render_back`), only to
  learn what a fixture can hold and how a pose maps a pixel to a ray; and `tests/acceptance/384/`, `1976/`, `424/`,
  `427/` and `96/` for conventions.

## What the base already does, which these tests don't credit

`deep-show run`'s `render_back` draws a revision the document has had at a time, from the session that asks, as a PNG
in the evidence store (#384); `deep-show run` stores a shared document at revision 0 with one layer per writer and
applies each agent's patches as revisions (#96); a `deep_show` of a 3D revision draws on the GPU (#378); and
`deep-gpu`'s `view3d` answers a click with `{at, pick, hit: [{item, sub, point, normal, distance}]}`, from the
object-ID pick and a CPU ray in f64 on the item's triangles (#424, #1976). `render_back` takes no `camera` and no
`probes` (it ignores both), draws through the 2D renderer, and its reply has no `hits`; neither planted name below
exists. Checked by hand at the base (a scratch run, since removed): each fixture document is stored at revision 0 with
no issue, and AC4's two patches apply as revisions 1 and 2 with no issue.

## Run them

They build `deep-show` with cargo, so they run alone. `scripts/lanes.mjs` needs `'tests/acceptance/1401/'` added to its
`alone` list, beside `tests/acceptance/384/`; this README is the instruction, the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1401 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1401/tsconfig.json
```

Cargo may need `/opt/homebrew/opt/rustup/bin` on `PATH`. Every file first builds `deep-show` once (`cargo build
--locked --bin deep-show`), copies it out of `target/debug` and fails each test if the build failed. Each test writes
into its own temporary folder (the evidence store) and deletes it. The issue runs on any GPU machine; a 3D render-back
draws on macOS's Metal device here, so off macOS each test fails with a message starting `INCONCLUSIVE:`, never
passes, as does a reply with `code: unsupported_platform`. Nothing is gated on power or load. A run with `--root` may
leave Vitest's cache in `tests/acceptance/1401/node_modules/.vite`; delete it. Tests print the issue's Proof as lines
starting `PROOF #1401`.

`BASE-FAILURE.txt` is the run at the base (home paths redacted to `~`): every fixture check passes, the shared documents
are stored and AC4's patches apply, and every test then fails because render-back's reply carries no `hits`. The base
ignores `camera` and `probes`; it answers a revision holding `mark.box@1` items `module_missing` (its render-back draws
2D only) and the plane-and-sphere revision with a 2D snapshot.

## The surface under test

The issue puts probes on a render-back request and names the reply's fields, but no code API. Render-back at the base
is `deep-show run`'s `render_back` call: the hub's `deep_show` tool forwards a call with no document or patch to it
(`packages/hub/src/core.ts`), it already takes the session, the document, `t`, `rev` and `size`, and a `deep-show run`
scenario holds shared documents with several writers' layers, sessions, revisions and the `planted` field. So every
criterion is expressible there, and these tests extend it with exactly the design's fields. `deep-gpu`'s `view3d` holds
the pick and the hit path but has no sessions, writers or revisions.

Everything #384's and #96's READMEs define for `deep-show run` stays as it is (the JSON-lines convention, sessions and
the process table, panels, `evidence`, shared documents stored at revision 0 under `docs[id].document`, patches and
their replies, `clock` and `at`, `render_back`'s `session`, `doc`, `t` in flicks, `rev` and `size`). What follows
adds to it.

**Request:** `{"call": "render_back", "at", "session", "doc", "t": flicks, "rev": u64, "size": [w, h], "camera"?:
camera item ID, "probes": [[x, y]]}`

- `camera`: the ID of a `camera@1` item in that revision; the frame and every probe are taken through it, at `size`.
  Left out, the document's own camera (its envelope's `camera`). Only the item-ID form is used here.
- `probes`: at most 64 pixels `[x, y]` (u32) of the frame at `size`, x right and y down from its top left.

**Reply** (beside what render-back returns now): `"hits": [[entry]]`, one list per probe in the probes' order, each at
most 8 entries, nearest first, ties by ID:

- a hit: `{"item": ID, "sub": string | null, "point": [x, y, z], "normal": [x, y, z], "distance": m, "geo"?: {lon,
  lat, height}}`, `point` in the document's world frame in m, `distance` along the probe's ray from the eye in m;
- a pixel on another writer's layer: an entry `{"code": "ref_unresolved", …}` with no `point`, no `distance` and no
  `geo` (it may name the item or not);
- a pixel whose ray meets nothing (the sky): `[]`.

The tests read `item`, `point` and `code` (and `distance` in AC3) and nothing else; `sub`, `normal` and `geo` are
not read.

### Planted programs

Each reachable only through the scenario's `planted`, only to prove a test fails on a wrong program; an unknown name
stays `bad_input`.

| `planted` | The wrong program | Test, and what its failure must name |
|---|---|---|
| `probe_from_depth` | Each probe's hits are placed where the probe's ray reaches the view depth the render's depth target holds at the probe's pixel (a depth reconstruction), never a CPU ray on the triangles; items and the rest as the real path | AC1: the check fails, naming the first probe placed more than 1 mm from its analytic hit |
| `probe_nearest_item` | A probe whose ray meets nothing answers the item drawn nearest its pixel instead (one hit naming it, placed anywhere on it); the rest as the real path | AC2: the check fails on a sky probe, naming it |

AC3 to AC5 name no wrong program; their tests fail on the wrong programs their files' headers list, by construction.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1401.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | File | What it asserts |
|---|---|---|
| AC1 `#1401.e76a9655` | `analytic.test.ts` | 200 seeded pixels, 100 on a plane and 100 on a sphere, over seven cameras of one document (10 m to 400 m, and 100 km to 200 km on the plane): each probe's first hit names the item its ray meets and lies within 1e-5 m of the analytic hit. Then `probe_from_depth` fails the same check, which names the first probe off by more than 1 mm |
| AC2 `#1401.b2d6901b` | `sky.test.ts` | 18 sky pixels 0 to 16 px past the edge of a block's silhouette, and two far corners, each answer `hits: []`; 3 pixels on the block answer its one hit within 1e-5 m. Then `probe_nearest_item` fails the same check on a sky probe |
| AC3 `#1401.a6573e7a` | `order.test.ts` | Over 100 runs (10 processes × 10 render-backs), 4 probes through a glass pane over a box each answer exactly `pane` then `box`, and 4 probes on two boxes' shared top face each answer exactly `tie.a` then `tie.b`, at the analytic points and distances; each tie probe's order is the same on all 100 runs |
| AC4 `#1401.83ac6241` | `revision.test.ts` | A box a channel moves along the view axis and alpha's patches shift sideways, probed at t = 2 s of revision 1 while revision 2 is current: 3 probes hit its front face where it is at 2 s and revision 1 (z = 1), within 1e-5 m, and 3 just past that face's edges answer `[]` |
| AC5 `#1401.39142bf2` | `writers.test.ts` | Each of two agents' sessions probes its own block and the other's: its own answers its hit within 1e-5 m; the other's answers an entry with `code: ref_unresolved` and no `point`, `distance` or `geo` |

## Fixtures

None on disk: every document and glTF is generated in the test files and `helpers.ts`. Each document is stored at
revision 0 in a scenario with both test agents' sessions (`sess-alpha`, thread `thread-alpha`, writing layer
`alpha-main`; `sess-bravo`, thread `thread-bravo`, writing layer `bravo-main`), on a 120 Hz virtual clock, 320 × 240
px, over a black `sky@1`, in unlit materials. Every item is in alpha's layer except AC5's `bravo.block` and its
material, and every render-back is alpha's except AC5's second. Metres, +Y up.

- **Plane and sphere (AC1).** `plane`: a `mesh.asset@1` square y = 0, |x|, |z| ≤ 2^20 m, two triangles with
  whole-number corners. `sphere`: a `mesh.asset@1` UV sphere of radius 1/32 m (512 × 256, 261,120 triangles, f32
  positions) at (0.5, 1.25, −0.75). Both glTFs are put into the evidence store by their SHA-256, which the items' `sha256`
  names. Seven `camera@1` items, each value an f32: `cam-plane-near` (6 m up, looking down 15°, fov 60°),
  `cam-plane-far` (4,096 m up, looking down 3°, fov 30°) and `cam-sphere-0` to `-4` (10.06 m to 400 m from the sphere,
  each fov framing it at 80 px radius).
- **A block against the sky (AC2).** `block`, a 2 m `mark.box@1` at the origin; the camera 8 m in front and 1.5 m up.
- **Glass over a box, and a tie (AC3).** `pane`, a `mark.box@1` 3 × 1/32 × 3 m at (−2.5, 2, 0) in an unlit,
  double-sided `alpha_mode: blend` material at alpha 0.3; `box`, 1.5 × 1 × 1.5 m, top face y = 1, under it; `tie.b`
  (1.5 × 2 × 1.5 m from y = 0) and `tie.a` (1.5 × 1 × 1.5 m from y = 1) at x = 2.5, whose top faces are the same square
  at y = 2, to the bit. `tie.b` comes first, so its order key is the lower. The camera 12 m up and 4 m back.
- **A moving box (AC4).** `mover`, a 2 m `mark.box@1`; the channel `mover-z` on `items/mover/at/pos/2` (f32, linear,
  −6 m at 0 s to 6 m at 4 s); x = −3 m at revision 0, then alpha's patches `set items/mover/at/pos/0` to 0 (revision 1)
  and 3 (revision 2). The camera at (0, 0, 24) looking down −z.
- **Two writers (AC5).** `alpha.block` at (−2, 0, 0) in `alpha-main`, `bravo.block` at (2, 0, 0) in `bravo-main`, both
  2 m; the camera at (0, 1, 12).

## The analytic hit

A probe's ray goes from the camera's eye through its pixel's centre, (x + 0.5, y + 0.5), by camera@1's pinhole: forward
f from the position to the target, right = f × +Y, up = right × f, focal length (the wider side ÷ 2) ÷ tan(fov ÷ 2).
The analytic hit is that ray's nearest intersection with the item's analytic shape, in f64.

- **Boxes** (AC2 to AC5) are axis-aligned `mark.box@1` items, met by slabs; their faces are planes, so any
  triangulation of them is the analytic box and the two readings of "analytic" (the shape, or its triangles) agree.
- **The plane** is y = 0; its two triangles have whole-number corners at y = 0, so again they agree.
- **The sphere** is the analytic sphere of radius 1/32 m, computed from the ray's closest approach so nothing cancels
  at 400 m. The drawn sphere is evaluated triangles, which a correct probe meets, so the fixture is made fine enough
  that the two coincide well inside the bound: along every sphere probe's ray the triangles the glTF holds (f32
  positions, placed in f64) lie within 2e-6 m of the analytic sphere, which the test checks before it runs. The 1e-5 m
  bound then holds for a hit on the evaluated triangles with 8e-6 m to spare, either way one reads "analytic".

The 1e-5 m bound at 200 km is a relative 5e-11. A ray built in f64 meets it, even one found by subtracting the eye's
position from a point 1 m along the ray, which loses up to about 2e-6 m there to the eye's 4,096 m height; that loss
grows with the square of the distance, which is why the far probes stop at 200 km. A ray in f32 doesn't meet it.

## Why the planted reader must fail

A probe names a whole pixel and its ray passes through the pixel's centre, which is where a depth target samples, so a
depth reconstruction differs from the ray's hit only by the depth target's precision. Within a few kilometres that is
a fraction of a millimetre, so there a depth reader can't fail past 1 mm. The criterion asks for one that does, so the
fixture reaches where no GPU depth target holds a millimetre: `cam-plane-far`'s 50 probes meet the plane 100 km to 200
km away. A 32-bit float holding view depth there (reversed, ndc = near ÷ z, as the base's depth target is by #1976's
README, or any other 32-bit mapping) spaces its values at least z × 2^-24 apart, 6 mm at 100 km, so a reading is
within 1 mm of the true depth on at most about a third of those probes, and on all 50 only with negligible odds. The
test checks the fixture holds at least 25 probes past 100 km before it runs the plant.

## Readings where the issue and design leave a choice

- **Through that pixel** is through the pixel's centre, (x + 0.5, y + 0.5), as #1976's README defines a pixel's
  centre.
- **The camera** is a camera item's ID (`camera: item ID`, the design's first form), because it needs no pose format;
  a pose and a point and ask's `view` (#1400) aren't used. AC1 names one of seven cameras per render-back, so a probe
  taken through the document's camera instead fails; the other tests use the document's camera.
- **"Land within 1e-5 m of the analytic hit"** reads a probe's first (nearest) hit, which must also name the item the
  ray meets. Later hits (the plane behind the sphere) aren't read in AC1.
- **"Returns two hits, pane first"**: exactly two entries, `pane` then `box`. One hit per item: the nearest point of each
  item the ray meets, as #1976's hit list holds, since entries are keyed by item and ties break by ID. A thin box is
  a glass pane; the probe enters its top face.
- **"Two coplanar faces at equal distance"**: two boxes whose top faces are the same square, so the ray meets them at
  one distance to the bit and the order is the tie's alone; "the same order" is read as the issue's "ties break by
  ID", ascending, and checked on every run.
- **"100 runs"** is 100 render-backs answered, 10 in each of 10 processes, so an order that depends on a map's seed per
  process or per call shows.
- **"The evaluated position at that t and rev"**: the mover's pose at 2 s from the channel and at revision 1 from the
  patches; probes on its face there hit it at the analytic point, and probes just past its edges meet nothing. Any
  other pose (the current revision's, revision 0's, 0 s, the clock's 1 s, the end key's) answers some probe
  differently, which the test checks.
- **How `ref_unresolved` sits in a probe's answer**: an entry of the probe's hit list, `{"code": "ref_unresolved"}`, in
  the base's form for a handle a reader can't resolve (`{"handle", "code": "ref_unresolved"}` in `ask.rs`), keeping
  `hits` a list of lists. **"No position"** is no `point`, `distance` or `geo` in any entry of that probe's list; the
  distance along a known ray is a position. Whether it names the item isn't read.
- **Two writers** are two agents' sessions and two layers in one stored document, each layer's `writer` the agent's
  thread (#96's form). Each agent probes both blocks, so a program that takes a fixed layer as the caller's fails.
- **A sky pixel** is one whose ray meets no item, its sky drawn there. The sky pixels nearest the block clear it by at
  least 1 mm (about 0.05 px) and lie inside the object-ID pick's 3 px margin (#424), so the CPU ray, not the pick
  alone, decides.
- **Glass** is `alpha_mode: blend` at alpha 0.3 (see-through), unlit; transmission isn't used.

Not tested, because no criterion asks: `geo` on a geo placement, `sub`, `normal`, the cap of 64 probes and of 8 hits,
the camera's pose and `view` forms, the hub's `deep_show` tool forwarding `probes` and `camera` to the canvas core, that
a probe is never evidence, and a probe on a live window (out of scope).
