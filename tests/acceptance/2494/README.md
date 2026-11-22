# Acceptance tests for #2494: no shipped surface draws through the GPU layer's view

Written first, blind, from issue #2494 (its problem, Scope, four acceptance criteria and Proof), the owner's decision
recorded on it (the comment of 2026-11-18, which is criterion 1), the design and the base commit `9550dc0f0` ("Merge
pull request #2831 …"), by a job that never saw an implementation, a plan for one or another agent's notes; no other
worktree, branch, pull request or session was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue and its one comment, live (`gh issue view 2494 --repo windoliver/deepbuild --comments`), and the issues it
  links: the epic #241, #377, #379, #806, #2679 (which this blocks, and whose first criterion counts 300 played
  frames on this surface) and #2692 (which follows this decision in the proof binary's live view).
- `docs/technical-design.md`: The canvas core; What done means, fixed at the start (a check enters through a surface
  the issue names and fails on the base at its assertion); How we know version 0 works (the blank guard); Dogfooding.
- `docs/canvas-primitives.md`: Draw path: GPUI or the GPU layer; GPU surface (`device: one per app`, `slots`,
  `path: zero_copy | copy`, the `frame_seq` a shown slot carries, "show an unchecked frame" among what it can never
  do); Render worker; Render-back; Writer layer; Frame clock and scheduler.
- At the base, for facts and surfaces: `crates/deep-app/src/show.rs` (the panel: `Presented::from_json`, `present`,
  `follow`, the paint of each layer's picture, outline and name), `gpu_view.rs` (`watch`, `unwatch`, `paint`),
  `canvas_fixture.rs`, `probes/canvas.rs`, `main.rs` and `Cargo.toml` (#1485's `--canvas` mode in a `canvas-fixture`
  build and `DEEP_CANVAS_PLANT`), `hdr_fixture.rs` (#177's fixture: a view on the render thread, the window's capture
  through #140's drawable read-back), `hub.rs` (the app's hello and calls); `crates/deep-gpu/src/view.rs`,
  `surface.rs`, `counted.rs`, `device.rs`; `crates/deep-scene3d-render/src/module.rs` (`Module3`, `draw_offscreen`),
  `lib.rs` (`read_back`, `read_texture`) and `oit.rs`; `crates/deep-show/src/hub.rs` (`presented_revision`, `show`,
  `bands`); `packages/hub/src/canvas.ts`, `hub-canvas.ts` (`show`, `recordRevision`, `drawnBy`), `show.ts`,
  `server.ts`; `scripts/lanes.mjs`, `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (a tagged
  test fails on the merge base at its assertion).
- Prior suites, for conventions only (nothing imported): `tests/acceptance/1485/` (the panel in the app's window,
  `ctx.skip` as INCONCLUSIVE), `177/` (README shape, a plant by environment variable), `806/` and `26/` (a hub in a
  temporary home, the world file, `deep show` run by you, the socket), `377/` (the blank guard, a slot's bytes against
  a window capture), `1401/` and `173/` (a scene document with an unlit box, a sky and a channel), `2513/` (a
  criterion that is other suites' own runs).

## What the base does

Confirmed by reading, as the decision found:

- `gpu_view::watch`, `unwatch` and `paint` are called from `crates/deep-gpu-layer` and from `hdr_fixture.rs` alone.
  `show.rs` paints a layer's `picture` with `paint_image`, an agent layer's outline and name tab, and nothing else.
- `presented_revision` makes each layer's picture with the 2D raster's `Renderer::prepare` alone, and keeps `null`
  where that fails. The decision's run of a camera and one `mark.box@1` got `"picture": null`. So for a 3D layer the
  panel paints no picture and no slot: an outline and a name for an agent's layer, nothing for yours.
- The hub hands the app `{doc, rev, rect, layers, session}` for each presented revision (`recordRevision`). It
  records the canonical document's hash and does not hand it over.
- The counted device counts bind groups, buffers, pipelines, bytes uploaded and queue writes. It has no count of
  read-back buffers.
- A renderer holds one mappable buffer from the moment it is built (`Oit::new`, "scene3d oit count"), before any
  frame. `draw_offscreen` makes a snapshot texture and, through `read_back`, a read-back buffer on every call.

No binary was built and neither the hub nor the app was run by this job: its brief ruled out cargo and suites that
build, on a machine other sessions share. The type-check ran, and the suite's own logic once against a throwaway
stand-in for the app's report (`BASE-FAILURE.txt` says what that covered).

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js: deep hub run, deep show
node node_modules/typescript/bin/tsc -p tests/acceptance/2494/tsconfig.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2494 --no-file-parallelism
rm -rf tests/acceptance/2494/node_modules/.vite
```

On macOS each file builds what it uses once, with `cargo` from `PATH`:

- `cargo build --locked --release -p deep-app --bin deep-app --features canvas-fixture`, #1485's build of the app,
  copied out of `target/release`;
- `cargo build --locked --bin deep-show`, the hub's canvas core, left under the checkout's `target/`, where the hub
  looks for it (`packages/hub/src/canvas.ts`). With `CARGO_TARGET_DIR` set elsewhere the hub can't find it and the
  tests fail `BLOCKED`.

Each file starts one hub under `/tmp/dh2494-*` (a socket path must fit in 104 bytes) with `HOME` there, so the real
`~/.deepbuild` is never touched, and stops it by PID. The app's window opens on this Mac's screen, not focused, for
about 14 s and twice for 12 s, and briefly before each of those to see that a window draws here. The
proof (the issue's Proof line) is written to `$TMPDIR/deep-2494-proof/`, rewritten on each run and never read back:
the presentation, each run's report, each captured window and slot as PNGs, and the counts. Nothing in it is
personal. The tests use node built-ins and vitest only.

Criterion 4's proof is the three suites' own runs, as their READMEs say, with their files unchanged:

```sh
git diff --quiet "$(git merge-base HEAD origin/main)" -- tests/acceptance/377 tests/acceptance/379 tests/acceptance/806
npx vitest run --root tests/acceptance/377 --no-file-parallelism
npx vitest run --root tests/acceptance/379 --no-file-parallelism
npx vitest run --root tests/acceptance/806 --no-file-parallelism
```

## The surface under test

The decision names the surface: the app's canvas panel (`crates/deep-app/src/show.rs`), fed by what the hub
presents. The tests go through it end to end and add as little as the criteria need. New names are marked
*(chosen)*.

### Used as the base has them

- **The hub**: `deep hub run` with `HOME` at a temporary home, #806's world file (`DEEP_HUB_TEST_SHOW`:
  `{"panels": {"main": {"rect": [0, 0, 480, 360]}}, "docs": {"<doc ID>": {"panel": "main"}}}`) and #24's confirm
  stub.
- **`deep show --doc <doc ID> --document fixtures/sliding-box.json --json`**, run by you. Its reply's `outcome` must
  be `presented`, with no error among its `issues`.
- **`canvas.drawn`** on a connection that presented the control token as the app (`{"v": 1, "hello": "app",
  "token"}`), as `crates/deep-app/src/hub.rs` makes it: `{"presented": [{doc, rev, rect, layers, …}]}`. The tests
  take the document's newest entry and read only `rev`, `rect` and, of the one layer whose `doc` is the document,
  `layer`. They hand the entry on **as it came**, every field of it. So however the presentation comes to name a 3D
  layer's canonical document (the decision's point 2) is the hub's and the app's to settle; no test spells it.
- **`deep-app --canvas <scenario.json>`** in a `canvas-fixture` build (#1485's fixture mode,
  `tests/acceptance/1485/README.md`): the app's `CanvasPanel` alone in the app's real window, a frame every vsync
  for `run_ms`, each revision of `revisions` handed to the panel as `follow` hands the hub's. The scenario here is
  `{"evidence": "<the hub's evidence store>", "window": [480, 360], "decode_ms": 0, "run_ms", "revisions":
  [{"at_ms": 0, "presented": <the entry>}]}`. Of the report the tests read `scale`, `handed` and each frame's
  `frame`, `at_ms` and `pictures`. `HOME` is the hub's temporary home.

What the fixture mode must keep: `presented` reaches the panel through the same reading of a presentation that
`follow` uses (`Presented::from_json` at the base), and nothing but the scenario and the evidence store feeds the
panel. The build holds whatever the shipped app holds to draw a 3D layer.

### What the implementer adds to `deep-app --canvas` *(chosen)*

Two scenario keys, both optional:

| Key | Meaning |
|---|---|
| `capture_ms: [ms, …]` | For each time, counted from the first frame's start as `at_ms` is, the first frame whose start is at or after it is **captured** |
| `out: "<folder>"` | An existing folder the captured frames' files are written under; given whenever `capture_ms` is |

Each record of the report's `frames` gains:

| Field | Meaning |
|---|---|
| `slots: [{layer, frame_seq, path}]` | The GPU-layer slots the panel painted in that frame, in paint order: one entry for each `gpu_view::paint` that latched a slot. `[]` when it painted none |
| `slots[].layer` | The presented layer the slot was painted for: its `layer`, as presented |
| `slots[].frame_seq` | The view frame the slot holds, a whole number: what `gpu_view::paint` returned. Every frame a view draws has its own, and a later frame's is larger |
| `slots[].path` | The slot's handoff, `"zero_copy"` or `"copy"` (`deep_gpu::surface::Path::name`) |
| `readback_buffers` | A whole number: the read-back buffers the app's device has made since the app started, read when the frame starts, where `at_ms` is read. A read-back buffer is a buffer created with `MAP_READ` usage, the only kind the CPU can read the GPU's bytes through. It is the counted device's count (`deep_gpu::counted`), on the one device the app opens for its GPU-layer views, not GPUI's own. `0` while the app has opened no such device |
| `capture` | On a captured frame only: the path of an 8-bit RGB or RGBA PNG, not interlaced, of the whole window in device px, as the compositor received that frame (the drawable read-back of #140, `layer_colorspace`, which #177's fixture uses) |
| `slots[].pixels` | On a captured frame only: the path of an 8-bit RGBA PNG, not interlaced, of that slot's own frame at the slot's size in px: the bytes the slot held when the frame painted it, as GPUI samples them (`View::read`), each pixel's premultiplied B, G, R, A written as R, G, B, A |

A run with no `capture_ms` reads no pixels for the fixture and makes nothing on the app's device for it. Other
fields may be added; the tests read none of them.

### Planted programs

| Name | Selected by | The wrong program | Criterion |
|---|---|---|---|
| `reads_every_frame_back` *(chosen)* | `DEEP_CANVAS_PLANT`, read only in a `canvas-fixture` build, where #1485's `decodes_in_place` is read | The panel's view reads every frame it draws back to the CPU, as the base's `deep-show` does through `draw_offscreen`: for each frame drawn, a read-back buffer is made on the app's device. The rest is the honest program's: the slot is painted in place and its `frame_seq` rises | AC3 (issue-named: "a planted view that reads every frame back") |

Criterion 2 names the merge base as its wrong program, so it has no plant.

### Lanes

`scripts/lanes.mjs` needs, beside #1485's lines (this README is the instruction; the implementer makes the edit):

```js
// #2494's files build deep-show and the app, start a hub each and open the app's window.
alone.push('tests/acceptance/2494/');
```

No `[[test]]` entry, no new cargo feature, no new binary and no new hub method.

## Fixtures

`fixtures/sliding-box.json`, a writer's payload for `deep show` (no `id`, no `layers`, no item `layer`), in the shapes
#1401's and #173's scene documents use: a 480 × 360 scene; a perspective camera at (0, 0, 24) looking at the origin,
30° across; a sky of one blue, opaque, with no ambient; an unlit red material; and one `mark.box@1`, 8 × 4 × 1 m, in
that material, which a channel slides from x = −1.5 to 1.5 over the document's 60 s span. So every frame of it is a
new one for a minute, the box always covers the frame's center, and the sky always fills its corners, whatever time a
frame is drawn at. It shows on a panel of its own size, and the app's window is that size, so the layer's place is
the whole window.

## Criteria to tests

IDs are `#2494.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and whitespace collapsed
(`criterionId` in `scripts/proof-change.mjs`). Every test's name starts with its criterion's tag.

| Criterion | File (tests) | What it asserts |
|---|---|---|
| AC1 `#2494.827d856c` The decision is written in this issue before any code moves | none | Proven by the record, not by a test: the owner's comment on the issue (dated 2026-11-18 in its own text; GitHub's `createdAt` is 2026-11-19T04:42:52Z) is older than the change's first commit (`git log --reverse --format=%cI "$(git merge-base HEAD origin/main)"..HEAD \| head -1`), and the pull request links it. This suite reads its surface from that comment |
| AC2 `#2494.99fbfc41` In the real app, a document with a 3D writer layer is painted from a GPU-layer slot: a test reads the slot's frame on screen, and fails on the merge base | `ac2-slot-on-screen.test.ts` (1) | The fixture through `deep show` and the hub, its presentation handed to the app's window, two frames captured at 9 s and 13 s of 14 s. Some frame's `slots` holds the 3D layer; each captured frame painted a slot for it; that slot's `pixels` show the red box at the center and the blue sky at the corner; the capture is the whole window in device px; and at every sample where the slot's frame is flat, the window's pixel at the same place of the layer's rect is within 6 codes of the slot's (at least 300 samples judged, at most 1% of them differing). Wrong program: the merge base, which paints no slot |
| AC3 `#2494.b45bba38` A played 3D frame in the app makes no read-back buffer: counted on the app's device, and a planted view that reads every frame back fails, naming the count | `ac3-no-readback.test.ts` (1 + 1 plant) | The same path, 12 s, no capture. The frames played are the distinct `frame_seq` the window showed from the frame after the first that painted the layer's slot to the last; at least 60 of them. Over those frames `readback_buffers` does not move, and every slot's `path` is `zero_copy`. `reads_every_frame_back`: the same check fails, its failure says "made N read-back buffers", and N is at least the frames played less 3. Wrong programs: the merge base, which plays no 3D frame; the plant |
| AC4 `#2494.40f22707` #377's, #379's and #806's suites pass unchanged | none here | Those suites are the proof, run as their READMEs say, with no file under the three folders changed (Run them, above). This job writes no copy of them |

## Readings where the issue and design leave a choice

- **"In the real app."** The shipped `deep-app` binary, its real window on this Mac's screen and its own
  `CanvasPanel`, not the headless replica #806 reads. The window is #1485's fixture mode because it exists at the
  base: the tests run there and fail at an assertion, as the design asks of a check for new behavior. The hop from
  hub to app is the hub's own answer to `canvas.drawn`, carried by the test and handed over untouched. The app's
  100 ms poll of the hub (`follow`) isn't run: a poll racing a 14 s window would make the order of the run a matter
  of timing.
- **"A document with a 3D writer layer."** The layer is yours: `deep show` run outside any agent's process tree.
  An agent's layer differs only by the outline and name the panel draws over it, which no criterion reads, and it
  would need a stand-in session.
- **"Painted from a GPU-layer slot."** The panel's own record of each `gpu_view::paint`, the call the decision
  names, with the layer it painted for.
- **"Reads the slot's frame on screen."** Two things are read and compared: the slot's own bytes, and the window as
  the compositor received the same frame. The comparison samples a 48 × 36 grid less an 8% margin (1,200 samples)
  and judges a sample only where the slot's frame is one flat, opaque color for 3 px around, so an edge of the
  moving box, or a slot painted at another scale than the window's, can't make a sample differ by itself. Flat is
  within 4 codes, since a look's deband moves a pixel by up to 2 either way. A flat sample must match within 6
  codes: those 4, one for the composite (#377 found a slot composited within one code) and one for a resample.
  Up to 1% of judged samples may differ; a picture from another path differs over the whole box or sky.
  The layer's place is its presented rect at the window's scale, computed by the test, so a slot painted elsewhere
  fails (Scope: "painted in place").
- **The blank guard.** A slot's frame or a capture that is blank or black (luma at most 0.06 over at least 98% of
  its pixels, #377's reading) is `BLOCKED`, never compared. The slot's frame must also show this document: red
  leading at its center and blue at its corner by 40 codes, which holds under any tone map that keeps a hue.
- **"Fails on the merge base, where the panel paints a picture decoded from the evidence store."** The decision
  corrects the clause: at the base the hub gives a 3D layer no picture, so the panel paints nothing inside it. The
  test fails there either way, on the same assertion: no frame painted a slot. Its message lists the pictures the
  panel did paint.
- **"A played 3D frame."** A frame the panel's view drew and the window showed, of a document that moves for its
  whole span, so each frame is new. The frames played are counted by their `frame_seq`. The suite fixes neither the
  time a frame is drawn at nor whether the transport loops; it needs only that the frames keep coming, at least 60
  in a 12 s window that drew at least 120 frames.
- **"Makes no read-back buffer: counted on the app's device."** Buffers created with `MAP_READ` usage on the app's
  `deep-gpu` device, by a count the counted device keeps. The count is read over the played frames, from the frame
  after the first that painted the slot: at the base a renderer makes one mappable buffer when it is built, so a
  count from the device's opening would not be zero for a view that reads nothing back.
- **"No read-back on the live path"** (Scope) is wider than the count. The copy path makes its read-back buffers
  once and reads every frame back through them, so the count alone would pass it. The honest test therefore also
  holds every slot to the `zero_copy` path, which the decision names.
- **"A planted view that reads every frame back … naming the count."** The plant makes a read-back buffer for each
  frame it draws, as `draw_offscreen` does, so the count rises by about one a frame. The failure's sentence holds
  the number. The bound "frames played less 3" allows for the frames a three-slot ring had drawn before the count's
  first reading.
- **Criterion 4 needs no new test.** The three suites are their own proof, and "unchanged" is `git diff --quiet`.
  A tagged test that passes on the merge base proves nothing by the proof lanes' rule, and a second copy of a
  suite is a duplicate.
- **Criterion 1 is a record.** A test of it would pass on the merge base, since the comment exists whatever the
  code is.

## Legs that read BLOCKED or INCONCLUSIVE

- Off macOS: every test, INCONCLUSIVE.
- Where the app's window draws no frame with nothing to show (no display, a locked screen, a hidden window, no Metal
  device): every test, INCONCLUSIVE. Each run is preceded by that short run, and a run that ends without a report
  is followed by it again: still drawing, the test fails; no longer drawing, INCONCLUSIVE.
- AC3, either test: a window that drew fewer than 120 frames, or a view that played fewer than 60, INCONCLUSIVE. A
  run that played none fails.
- A slot's frame or a capture that is blank or black: `BLOCKED` (a failed assertion whose message starts so).
- No built CLI, a `deep-show` built outside the checkout's `target/`, a hub that doesn't start or refuses the app's
  hello: `BLOCKED` (thrown, naming which).
- Not INCONCLUSIVE, by design: a Mac whose GPU the GPU seam refuses shows the placeholder, paints no slot and reads
  FAIL. The report carries no reason to tell it apart.

## Not tested, and why

- **The decision's other points**, which no criterion states: the device opening only with the first 3D layer; one
  device for the app; a revision the app can't evaluate or draw showing the placeholder with its reason; the view
  recording every pass render-back records (#2692 follows it); drawing off the UI thread and the UI thread's time
  (#377's and #2679's); an agent layer's outline and the card over the slot (#377's card criterion).
- **That the hub makes no picture of a 3D layer**: the decision says it makes none "as it makes none today". The
  tests hand the presentation on whole and judge the screen, so a picture painted over the slot fails AC2.
- **The app's poll of the hub** and a session's page: the fixture mode shows the panel alone (Readings).
- **Snapshot textures and 300 frames**: #2679's first criterion, which this issue unblocks.
- **Frame times, GPU memory, the meter and the ladder in the app**: not decided here, by the decision.
- **Render-back with the app open or closed**: #806's own suite, criterion 4.

## Base

`BASE-FAILURE.txt` says what each test meets at the base, from reading it, and what little this job ran. The suite
was not run at the base.
