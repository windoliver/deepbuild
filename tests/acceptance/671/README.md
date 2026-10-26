# Acceptance tests for #671: a 3D scene through deep show and the GPU layer — boxes on a ground, an orbiting camera, a click that picks, and draws that replay

Written first, from issue #671 (its scope, its four acceptance criteria and its proof line), the design sections it
links and those they lean on, and base commit `d122341` ("Merge pull request #737 … feat/667-ask-checkpoint"), by a
job that never saw an implementation of #671; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (technical design: Dogfooding, 2518).

What was read:

- `docs/technical-design.md`: Rules every primitive follows (863: "Pure evaluation", data not code, typed and
  addressed by ID); The canvas core (1050), its Conventions; Camera and overlay (1313); Dirty classes and content key
  (1492: "A batch whose draw list is unchanged since the last frame replays what it encoded then"); Render-back
  (1500) and Document check (1508); How we know version 0 works (2476), with the parity suite and its blank guard
  (2538: "A blank guard runs first: a frame that is blank or black on either side (luma at most 0.06 over at least
  98% of its pixels …) makes the comparison BLOCKED and voids its other numbers"; "depth, normal and object-ID passes
  each have one exact encoding"); Dogfooding (2518); Tests written first (2549).
- `docs/canvas-primitives.md`: Writer layer (428: "A writer layer that holds any 3D item is a 3D writer layer … and
  draws its 2D items as marks in 3D or overlays"; "An item may refer to another writer's item … but never holds it";
  Lands "R2 several writers"); The trusted compositor (656): Writer connection (660), Admission and latch (703), Frame
  clock and scheduler (723), Frame callback and presentation feedback (756), Band (771), Input router, focus and
  gesture serial (799), Spatial index (813: "3D picking uses the object-ID target … holding stable IDs … never a draw
  position"), GPU surface (829: "A 2D layer anchored to a 3D layer's items draws from the evaluated data of the
  `frame_seq` its shown slot carries"), Render worker (862: `draw_key`; "Transform and shading changes … keep its
  encoding"), Render-back (934: "Actions such as click, hover and type run on an offscreen copy"); Selection (2334:
  "in 3D, the object-ID target"; Lands "R1 click to select"); Object (2767: "A move touches 64 B, never a mesh");
  Camera `camera@1` (4383: `orbit {azimuth, elevation, distance}`, `fov` "across the wider side"); Overlay (4504: "An
  overlay anchored to an item's point in a 3D writer layer draws in screen pixels at that point's projection at t
  plus its offset"); Marks in 3D (4546); Dirty classes (5038) and Content key (5054).
- At the base: AGENTS.md; the merged suites #671 depends on and drives — `tests/acceptance/377/` (the `deep-gpu`
  binary, `--backend noop`, `--planted`, the window capture, the `compare` call and its blank guard, the PNG writer),
  `378/` (the `view3d` call, its counts, `--planted encodes_every_frame`, the object-ID target and `picks`, the
  anchored overlay in a 2D writer layer, `fixtures/look.json`, the build-per-binary helpers), `393/` (`deep-show run`,
  `deep show` from a process in an agent's tree, the peer check, writer layers, bands, render-back snapshots in the
  evidence store) and `670/` (the checkpoint suite's form, its proof folder); `96/`'s README (shared documents several
  writers write: `docs[…].document`, whole revisions diffed against the writer's own layer, the `read` call);
  `crates/deep-show` (`hub.rs`, `shared.rs`, `scene3d.rs`), `crates/deep-gpu-layer` (`view3d.rs`, `compare.rs`),
  `crates/deep-canvas-scene3d` (kinds, roles, overlays), `crates/deep-canvas-marks/looks/clean.json`,
  `scripts/lanes.mjs`, `packages/evidence`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run tests/acceptance/671 --no-file-parallelism
npx tsc -p tests/acceptance/671/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

They build two cargo binaries in each file, as #377's and #378's suites do, so they run one file at a time.
`scripts/lanes.mjs` needs `tests/acceptance/671/` in its `alone` list (the one-at-a-time unit-lane line, and so
excluded from the parallel line), beside `tests/acceptance/378/`; this README is the instruction, and the implementer
makes that edit. Every file first builds what it uses, once, with `cargo build --locked --bin deep-show` and `--bin
deep-gpu` in the checkout, copies each binary out of `target/debug` under its own name into a temporary folder, and
fails each test that uses a build that failed. Each test writes into its own temporary folder (the evidence store, the
hub's document, targets and captures) and deletes it. The tests use node built-ins, vitest and `packages/evidence`'s
public entry.

The pixel tests (AC1's snapshot test, AC3 and AC4) draw on the GPU, on macOS, headless, as #378's do: off macOS, and
wherever a binary answers `unsupported_platform`, they fail with a message that starts `INCONCLUSIVE:`; they never pass
there. AC1's first test and both AC2 tests need no GPU: deep show checks without a snapshot, and the counts run on
wgpu's noop backend (`deep-gpu run --backend noop`). No test is gated on power, Low Power Mode or load: no criterion
here has a time budget.

**The proof** (the issue's Proof line) is written to `$TMPDIR/deep-671-proof/` (`PROOF_DIR` in `helpers.ts`,
`os.tmpdir()`), rewritten on each run and never read back (delete it first when you keep a run's proof):
`ac1-snapshot-{first,second,fresh}.png` with `ac1-hashes.json` (each run's snapshot file hash and pixel hash) and
`ac1-compare.json` (the blank guard's replies, the blank twin's among them); `ac1-replies.json` and
`ac1-hub-document.json`; `ac2-encode-counts.json` (every frame's encoded batches, replays and instance records on the
noop lane) with `ac2-planted-encode-counts.json` and `ac2-planted-failures.json`; `ac3-picks.json` (every click, the
item expected under it and what it picked); `ac4-label-capture.json` (every presented frame: the anchor, the label's
pin, their distance and the window capture's hash). Nothing in it is personal: the sessions, processes and handles are
the fixtures'.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names `deep show` from a test process standing in for an agent, the GPU layer (#377), scene3d (#378), the
app's surface with the 2D label in its own writer layer, the noop lane, a click, the blank guard, a per-frame capture
and a planted worker, but no new binary or API. So the tests drive the merged surfaces exactly as their suites define
them, and add one optional field (`clicks`, below) where the base has nothing a click can reach.

### The world: two test agents and one document (`deep-show run`, #393 and #96)

One `deep-show run` scenario per stdin line, as #393's README gives it. It names two agent sessions,
`sess-scene` (thread `thread-scene`, process 4100) and `sess-label` (thread `thread-label`, process 5100), the
process table the peer check reads (each agent's test process, 4102 and 5102, runs under its agent's tool shell), one
panel, and the document `01JB7D00000000000000000671`, minted as a shared document (#96's `docs[…].document`): the
envelope both agents send (`profile: scene`, 640 × 480, `camera: "cam"`, `transport.span` 6 s, `requires.modules`
naming scene3d) with no layer and no item. The calls, in order:

1. `deep show` from 4102 with the scene (`fixtures/scene.json`), so it writes as `thread-scene`, into that agent's
   writer layer; `include: ["issues", "pixels"]` with `t: "0s"` and `size: [640, 480]` in AC1's snapshot test, and
   `["issues"]` elsewhere;
2. `deep show` from 5102 with the label (`fixtures/label.json`), as `thread-label`, into a writer layer of its own;
3. `screen` (#393's bands);
4. `read` (#96's): the hub's current revision, the stored document with its `layers` (each `writer` the text
   `agent:<thread>`) and every item's `layer`.

### The app's surface: the GPU layer's view of the hub's document (`deep-gpu run`, #377 and #378)

The document `read` returns is written to a file and opened by #378's `view3d` call, unchanged: one document session
drawn by the GPU layer into a view of 640 × 480 at 60 fps on a virtual clock, its 3D writer layer through the GPU
layer and, with `window` (720 × 560, the view at (40, 40), a flat dark grey page), its 2D writer layers drawn over the
view by GPUI, the window presented once per frame. The look is `fixtures/look.json`, #378's look with the clean look's
four roles mapped to flat colors a test can measure. The move is a `patches` entry written as the scene's agent
(`agent:thread-scene`, read from the hub's document): `set items/box-17-08/at/pos` to `[11.1, 0.5, 4.5]` before frame
310. Counts (`counts: true`), the object-ID target with `picks` (`targets: ["ids"]`), window captures (`capture`),
`frame_seq`, `--backend noop` and `--planted encodes_every_frame` are #378's, unchanged.

### Added: `clicks` on the `view3d` call

```json
{"call": "view3d", …, "clicks"?: [{"frame": n, "at": [x, y]}]}
```

A click (your press and release with a hardware pointer) at `at`, in the view's px (origin at the view's top-left,
continuous coordinates, so `[x + 0.5, y + 0.5]` is pixel (x, y)'s centre), delivered while frame `n` is presented.
Frame `n`'s reply then carries `"clicks": [{"at": [x, y], "pick": item ID | null}]`, one per click given for that
frame, in the order given: the item the core's hit test names under the pointer in what frame `n` presented — the
topmost 2D item that visibly draws there, else the 3D item the frame's object-ID target holds there (Selection: "in
3D, the object-ID target"; Spatial index) — by its document ID, or `null` where nothing draws. A click changes nothing
the frames draw. The tests click only where no 2D item draws.

### Fixtures

Written by this job before any implementation of #671 ran; the scene and the label are sent as an agent sends a
document (no `id`, no `layers`, no item `layer`).

- `fixtures/scene.json`: the scope's scene. A perspective `camera@1`, `cam`, aimed at `[0, 0.5, 0]` with `orbit
  {azimuth: 0, elevation: 35, distance: 60}` and `fov` 40, whose azimuth a linear channel turns 0° → 360° from 0 s to
  5 s (#378's orbit form), so it orbits once over frames 0–299 and holds still from frame 300. A ground plane,
  `ground`, a `mark.box@1` 44 × 0.2 × 28 m whose top is at y = 0. 200 boxes, `box-II-JJ` for i in 0–19 and j in 0–9,
  each a 1 m `mark.box@1` at `[(i − 10) × 1.5, 0.5, (j − 5) × 1.5]`, standing on the plane, so `box-10-05` sits at the
  orbit's target. `beacon`, a 16 px `mark.point@1` at `[−12, 2, −6]`: 1.5 m above `box-02-01`'s centre, where the label
  is anchored; it is above every box's top, so nothing in the scene covers it. Paint uses only the clean look's roles
  (deep show refuses a role its look lacks): boxes and beacon `accent`, the plane `muted`.
- `fixtures/label.json`: the 2D label, a 2D writer layer's items (#378's anchored-overlay form): `tag-frame`, a 48 × 40
  `frame@1`; in it `tag`, a 48 × 16 `rect@1` (`muted`) at its top, and `pin`, a `circle@1` of radius 3 (`ink`) centred
  at (24, 32); and `label`, an `overlay.frame@1` showing `tag-frame`, anchored to `{item: "box-02-01", point: [0, 1.5,
  0]}` with offset (−24, −32), so the pin's centre is the anchor's projection.
- `fixtures/look.json`: #378's look (`basis: physical`, tone map none at the exposure whose scale is 1, the finish at
  identity, no deband) with roles `ground` black, `ink` green, `muted` silver and `accent` blue, so the label's pin is
  the only green in the window.

`helpers.ts` holds the world, the calls, the readers (PNG, the object-ID target, the evidence store) and the checks.

## Criteria to tests

Each test's name starts with its criterion's ID. Each states, in a comment or message at its assertions, the wrong
program it fails on.

| ID | Criterion (the issue's text) | Tests, the assertions that carry each condition, and the wrong program each fails on |
|---|---|---|
| AC1 | The scene is presented with no issues and its snapshot equals by pixel hash on a second run on one machine; the blank guard runs before the comparison, so two blank frames never count as equal | The first test now lives in `present-redraft.test.ts` (see A1-REDRAFT.md), its two layers compared in any order. `present.test.ts`, first test (no GPU): the fixtures hold the scope (200 1 m boxes standing on a ground plane whose top is y = 0; one overlay anchored to a box; the label's document holds no 3D item; neither names an `id`, `layers`, `writer` or item `layer`). The scene's and the label's `deep show` replies are each `presented` with `issues: []`; on screen two layers in the agent band, owned by `thread-scene` and `thread-label`; in the hub's document every scene item is in the layer whose writer is `agent:thread-scene`, every label item in `agent:thread-label`'s, a different layer; `read`'s `draws` holds every box, the plane, the beacon and every label item (the anchor resolves across writers). Fails on a check that refuses or warns on the scene (the base refuses its orbit channel), a hub that folds the label into the scene's layer or stamps either as you, and an anchor to another writer's item left unresolved. Second test (GPU): the scene's snapshot at 0 s from two runs in one process and one in a fresh process: each presented with no issues, one 640 × 480 PNG read back from the evidence store by its hash; the snapshot isn't one flat color (no color over 95%, two colors at 1% or more), since a render-back that draws nothing in 3D on a white ground isn't dark and the guard's measure would let it through. Then the comparison: first through #377's blank guard (`deep-gpu run`'s `compare` of the first run's PNG with the second's and with the fresh one's), which must answer PASS (a blank snapshot is BLOCKED there), and only then the pixel hashes (SHA-256 of the RGBA pixels), which must be equal. The guard's twin on the same path: the snapshot doctored to black, compared with itself and with the scene, is BLOCKED naming the blank sides with no number in the reply. Fails on a render-back seeded by the clock, a per-process order or cache that changes pixels, a blank or empty 3D render, and a comparison without the guard |
| AC2 | During the orbit each batch is encoded once, in the first frame, counted on the noop lane; moving one box encodes nothing again | `encode.test.ts`, first test (noop): the hub's document after both `deep show` calls, in `view3d` on `--backend noop` with `counts`, 330 frames (the 5 s orbit, then still), the move before frame 310. Every frame presented once in order with no pixels; `encodeProblems` returns nothing: frame 0 encodes each batch once (no name twice) and its batches hold every drawn 3D item (the plane, the 200 boxes, the beacon); no later frame encodes any batch, the orbit's frames, the move's frame and the frames after it included; the move's frame writes at least one instance record (the move reached the GPU layer). Fails on a worker that encodes a batch again when the camera moves or a box moves, one that leaves an item out of its batches, and a move that never reaches the view. **The proof's planted worker**, second test: `--planted encodes_every_frame` (#378's worker that encodes every batch every frame) fails the same check, with a failure at frame 1 naming each batch frame 0 encoded (`frame 1 encodes batch <name> again`) and one at the move's frame |
| AC3 | A click on a box picks that box's ID | `pick.test.ts` (GPU): the hub's document in `view3d`, 330 frames with the orbit and the move. A first run captures the object-ID target at frames 0, 75, 150, 225, 299 and 320; a second run, the same with `clicks`, must draw the same ID targets (by hash). At each of those frames: a click at the view's centre picks `box-10-05` (the box at the orbit's target projects there at every azimuth, independent of the camera's conventions); a click inside each of four boxes, one per quadrant of the view where the first run's ID target gives a 5 × 5 block to one box, picks that box; at frame 320 a click inside the moved `box-17-08`, where it now draws, picks it; a click where the ID target holds nothing picks `null`. Each click is answered in order at the point it was made. Fails on no picking (the base: no `clicks`), a pick by draw position or instance index instead of the item's ID, a flipped or offset readback, a pick from another frame than the one shown, and one that misses the move |
| AC4 | The 2D label stays within 0.5 px of its box in a capture of every presented frame while the camera orbits | `label.test.ts` (GPU): the label's items are in the label agent's layer, a layer apart from the scene's that holds no 3D item. `view3d` with the window, 300 frames (the orbit), the window and the ID target captured at every present. Every frame presented once, in order, its `frame_seq` its own frame. In each: the beacon (at the anchor) draws more than 100 px of the ID target, and its centroid plus the view's offset is the anchor in window px; the pin is the green ink's weighted centroid in the window capture; they are within 0.5 px. The anchor moves more than 1 px between every two frames, and the check's twin (each pin paired with the frame before's anchor, a label a frame late) fails. Fails on a label drawn from another frame's evaluation or a frame late, one anchored to the box's origin rather than its point, one not drawn, and one folded into the 3D layer |

## Open questions, where the issue and design leave an interface open

1. **Whose writer layer is the label's.** The scope puts the 2D label "in its own writer layer", and a writer has one
   layer (Writer layer; the base refuses a second), so the label comes from a second writer: a second test agent,
   whose own test process sends it with `deep show`, as the first sends the scene. The two write one document the hub
   minted as #96's shared document; its envelope is the minted one, and both agents send that same envelope, so
   whether a whole revision's envelope fields apply to a shared document doesn't matter here.
2. **The app's surface is two merged binaries joined by the hub's revision.** No binary at the base runs deep show and
   the GPU layer's frames together. The tests send the documents through `deep-show run`, read the hub's current
   revision with #96's `read`, and hand that document unchanged to #378's `view3d` on `deep-gpu`, which is the GPU
   layer drawing into the app's surface with the 2D layer beside it. The move is a `view3d` patch written as the
   scene's agent, not a live `deep show` patch, since the two run in separate processes. If one surface lands that
   does both, these readings carry over to it.
3. **The click.** Picking by pointer isn't on any merged surface (#378's README: "picking by pointer … not tested").
   `clicks` is the smallest addition: an optional field on `view3d` and its per-frame answer, defined above after
   Selection and Spatial index. Render-back's `actions` (click, hover, type on an offscreen copy) would be the other
   place; it has no pick result in its reply, and a click "on a box" in the app's surface is the live view's.
4. **The blank guard, and blank on a white ground.** "The blank guard runs before the comparison" is read as #377's
   guard (`compare`) passing both runs' snapshots before their pixel hashes are compared. The guard's measure is dark
   frames; the clean look's ground is white, so a render-back that draws nothing in 3D is caught by the
   not-one-flat-color check instead. Both must hold.
5. **"A second run on one machine"** is read as a second scenario line in the same process and a run in a fresh
   process, both against the first; "pixel hash" as the SHA-256 of the snapshot's RGBA pixels.
6. **Batches.** The design doesn't fix how a writer layer's items split into batches (#378's run of this scene, fed
   directly, makes one batch of the layer's 202 marks). "Each batch is encoded once, in the first frame" is read as:
   frame 0 encodes each batch once and its batches hold every drawn 3D item, and no later frame encodes any batch.
   A 2D writer layer drawn as vectors paints on the UI thread and isn't a batch (Render worker); a worker that encoded
   it every frame would fail. "Moving one box encodes nothing again" adds that the move's frame writes an instance
   record, so a move that never arrives can't pass by doing nothing.
7. **Measuring "within 0.5 px of its box".** The label is anchored 1.5 m above `box-02-01`'s centre, and the scene's
   beacon marks that world point; the anchor's projection is the beacon's centroid in the same frame's object-ID target
   (one exact encoding, no antialiasing, nothing over it), and the label's position is its pin's green centroid in the
   window capture, the pin centred on the anchor by the overlay's offset. Run on the base's `view3d` with this document
   (the orbit channel restored by hand, outside this suite), the distance was at most 0.18 px over 300 frames and the
   anchor moved at least 2.3 px a frame; every box stayed in view and `box-10-05` held the view's centre.
8. **The orbit** is a linear channel on the camera's `orbit.azimuth` (#378's form), one turn in 5 s; elevation,
   distance and field of view keep the whole grid in view at every azimuth.
9. **Roles.** deep show draws with the clean look and refuses a role it lacks, so the documents use only `ground`,
   `ink`, `muted` and `accent`; the view's look maps those four to measurable colors.

## What the merged code does at the base (found while writing these tests)

Read from the code and from running the base binaries; none of it changed the tests.

- The hub refuses the scene: a `channels` entry targeting `items/cam/params/orbit/azimuth` is `ref_unresolved` ("reaches
  nothing") in deep show's check, though #378's `view3d` drives the same channel. Every test fails there.
- With the channel left out, the shared document presents, but its render-back draws with the 2D path: the snapshot is
  one flat white frame, and `read`'s `draws` leaves out every mark. The blank guard's dark measure doesn't catch it.
- `view3d` has no `clicks`.
- Fed the hub's document directly (channel restored), `view3d` already meets AC2's count (one batch of 202 marks at
  frame 0, nothing later, one instance record at the move; the planted worker fails at frame 1 naming the batch) and
  AC4's measure (see open question 7).

Not tested, because no criterion asks: render-back actions; hover and the selection's outline; latency and the
`pairs_newest_slot` composer (#378's AC8 holds them); the label's pixels beyond its pin; the snapshot's colors; timing.
