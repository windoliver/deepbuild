# Acceptance tests for #3517: the app's 3D view draws what render-back draws, at the session's time and your view

Written first, blind, from issue #3517 (its opening, `Runs on:`, Scope, eight acceptance criteria and Proof line; it
has no comments), the issues it links, the design sections it links and the base commit `a7ae0e804` (origin/main,
"Merge pull request #3696 …"), by a job that never saw an implementation, a plan for one or another agent's notes; no
other worktree, branch, pull request or session was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, and one for
each planted wrong program the criteria name. The test files carry no comments (AGENTS.md); what they would say is
here.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-view-count.test.ts` | `#3517.6be4cfad` | `node scripts/view-count.mjs` on the checkout, then on a scratch copy with one more refused document planted |
| `ac2-castle.test.ts` | `#3517.1021b920` | the castle through a hub and `deep show`, paused at 6 s, in the app's window |
| `ac3-look-shots.test.ts` | `#3517.234b03aa` | a document with a `look` and one with `shots`, each in the app's window, as shipped and under its plant |
| `ac4-text-over-box.test.ts` | `#3517.a6d46379` | a 3D document with one text item, in the app's window, captured |
| `ac5-session-time.test.ts` | `#3517.5a0bce0e` | a sliding box, paused at 3 s and then sought to 10 s, as shipped and under its plant |
| `ac6-drag-turns.test.ts` | `#3517.1933faf6` | a still document, your drag played through the hub, its replies handed to the app's window |
| `ac7-refusal-recorded.test.ts` | `#3517.514071e2` | a document that requires physics, followed from the hub by the app's panel, as shipped and under its plant |
| `helpers.ts` | | the builds, the hub, `deep show`, calls made as the app, the app's window, the GPU lease, PNG and pixel hash |
| `fixtures/` | | the documents and the look (Fixtures, below) |
| `lane.json` | | the folder runs alone (`shared: the GPU`) |
| `BASE-FAILURE.txt` | | what each file read at the base |

## What was read

- The issue, live (`gh issue view 3517 --repo windoliver/deepbuild --comments`), and the issues it names: the epic
  #241, #2494 (whose suite this one extends and whose decision stands), #2679, #1638 and #3516.
- `docs/canvas-primitives.md`: Draw path: GPUI or the GPU layer; Render-back; Frame clock and scheduler; Transport;
  Camera `camera@1`; Shot. `docs/technical-design.md`: How we know version 0 works; Dogfooding.
  `docs/parallel-proof.md`: a suite's own lane file. AGENTS.md, GLOSSARY.md.
- At the base, for surfaces and facts, never for an expected value: `crates/deep-app/src/scene_view.rs` (`lacks`,
  `SceneView::paint`, `Ask::Frame`, the render thread), `show.rs` (`Presented`, `Layer.scene`, `follow`, the paint of
  a reason), `canvas_fixture.rs` (#1485's and #2494's fixture mode, `DEEP_CANVAS_PLANT`), `hub.rs` (`root`);
  `crates/deep-canvas/src/scope.rs` (`control`, `drag`, `to_json`) and `camera.rs` (`Pose`, `user.turn`);
  `crates/deep-show/src/main.rs` (the calls), `input.rs` (`input`, `view`), `probe.rs` (`render_back_3d`), `ask.rs`
  (`render_back`), `hub.rs` (`deep_show`, `draw3d`), `hub/presented.rs`, `canvas_side.rs`, `over3d.rs`, `film.rs`
  (`posed`), `track_call.rs`, `golden.rs`, `kit/lease.rs`; `packages/hub/src/hub-canvas.ts` (`show`, `canvasUser`,
  `drawnBy`, `recordRevision`), `canvas.ts`, `show.ts`, `packs.ts`, `paths.ts` (`deepHook`), `server.ts` (the
  methods a role may call);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/benchmark.mjs` (`fingerprint`, `references`),
  `scripts/lanes.mjs`.
- Prior suites, for conventions only (nothing imported): `2494/` (the app's window, a hub in a temporary home,
  `deep show`, `canvas.drawn` as the app, the PNG reader), `3506/` and `3507/` (the GPU lease, the four states,
  `lane.json`), `1719/` and `1722/` (a 3D revision's render-back in a look and under 2D items, the pixel hash), `806/`
  and `26/` (`events.read`), `493/` (shots).

## What the base does

Read at `a7ae0e804`. The hub's and the canvas core's side of it was also seen on runs (`BASE-FAILURE.txt` says
which); the app's side was read only, since its window could not draw when this job ran:

- **The view refuses a document whole.** `lacks` gives `module_missing: <module>` for any required module but
  `scene3d`, `motion` and `effects`, `module_missing: marks2d` for a 2D item, and `feature_absent: <what>` for
  `arrange@1`, `overlay.view@1`, `look` and `shots`. The panel paints the reason in the layer's place. So the castle
  shows `module_missing: building`, the look document `feature_absent: look`, the shots document
  `feature_absent: shots` and the text document `module_missing: marks2d`.
- **The view's time is its own.** `SceneView::paint` asks for a frame at the time since the view was made. Nothing the
  hub says of the session reaches it.
- **A presented 3D layer carries its document's hash** (`Layer.scene`) and nothing of the session.
- **The fixture mode** (`deep-app --canvas`) reads `evidence`, `window`, `decode_ms`, `run_ms`, `read_every_ms`,
  `revisions`, `capture_ms` and `out`, and ignores every other key. Its report's frames hold `slots: [{layer,
  frame_seq, path, pixels}]` and `capture`; no slot holds `t` and no frame holds `reasons`.
- **Nothing counts the refusals.** There is no `scripts/view-count.mjs`, no `crates/deep-app/view-count.json` and no
  `deep-app --view-count`.
- **Nothing records a refusal.** The hub has no `layer.refused` event, and the app tells the hub nothing of a layer it
  doesn't draw.
- **The session's time and your camera** are the canvas core's: an `input` call with `{"type": "control", "control":
  "playhead", "value": <flicks>}` pauses the transport there, and a drag turns the camera 0.25° a px of sideways
  travel (`user.turn`). The reply's `state` names `view.playhead` and `camera`.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
scripts/lease npm run build --workspaces # the tests run the built CLI: deep hub run, deep show
node node_modules/typescript/bin/tsc -p tests/acceptance/3517/tsconfig.json
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3517 --no-file-parallelism --silent=false --reporter=verbose
rm -rf tests/acceptance/3517/node_modules
```

The verbose reporter prints each skipped test's note, which is where `BLOCKED` and `INCONCLUSIVE` are said; a run
whose tests all skip exits 0 and proves nothing.

`PATH` only needs the line where cargo isn't on it already. Each file but `ac1` builds what it uses once:

- `cargo build --locked --release -p deep-app --bin deep-app --features canvas-fixture`, #2494's build of the app,
  copied out of `target/release`;
- `cargo build --locked --bin deep-show`, the hub's canvas core, and `cargo build --locked -p deep-hook --bin
  deep-hook`, without which `deep hub run` stops at its start in a checkout. Both are left under the checkout's
  `target/`, where the hub looks for them. With `CARGO_TARGET_DIR` set elsewhere the hub can't find them and the
  tests read `BLOCKED`.

`ac1` builds nothing itself: `scripts/view-count.mjs` builds the app.

Each test starts hubs of its own under `/tmp/dh3517-*` (a socket path must fit in 104 bytes) with `HOME` there, so the
real `~/.deepbuild` is never touched, and stops them by PID. The app's window opens on this Mac's screen, not
focused, eleven times, for 6 to 16 s each, and once a file for a third of a second to see that a window draws here
and to read the display's scale. The
proof (the issue's Proof line) is written to `$TMPDIR/deep-3517-proof/`, rewritten on each run and never read back:
each run's report, each slot's frame beside render-back's, the window's capture, the record's events and the count.
Tests also print it as lines starting `PROOF #3517`. Nothing in it is personal. The tests use node built-ins and
vitest only.

Criterion 8's proof is #2494's own suite, run as its README says, with no file under its folder changed:

```sh
git diff --quiet "$(git merge-base HEAD origin/main)" -- tests/acceptance/2494
npx vitest run --root tests/acceptance/2494 --no-file-parallelism
```

## The surface under test

The issue names the surfaces: the real app, render-back, the record, the count. The tests go through them end to end.
What the task fixed before this job wrote a line is listed as fixed; what this job chose is marked *(chosen)*.

### Used as the base has them

- **The hub**: `deep hub run` with `HOME` at a temporary home, #806's world file (`DEEP_HUB_TEST_SHOW`: `{"panels":
  {"<panel>": {"rect": [x, y, w, h]}}, "docs": {"<doc ID>": {"panel": "<panel>"}}}`) and #24's confirm stub.
- **`deep show --doc <doc ID> --document <file> [--t <n>s] [--size <w>x<h> --snap] --json`**, run by you. Its reply
  says `presented`, names no error and gives the `rev` it made. With `--snap` its first snapshot is render-back's
  frame of that revision at `--t` (0 s when left out) and `--size`, read from the hub's evidence store by its hash.
  That is **render-back's frame** in criteria 2 to 6: the issue's own words for it are "the reply to `deep_show`,
  which carries a render-back snapshot of the whole document".
- **`canvas.drawn`** on a connection that presented the control token as the app: the document's newest presented
  revision, handed to the app's window as it came, every field of it (#2494's way). The tests read its `rev`, `rect`
  and the `layer` of the one layer whose `doc` is the document.
- **`canvas.user`** as the app, one call each: `{"call": {"call": "input", "panel", "event"}}` with the events
  `{"type": "control", "control": "playhead", "value": <flicks>}`, `{"type": "down" | "move" | "up", "pos": [x, y]}`.
  Each result is handed to the app's fixture untouched (`replies`, below). Criterion 6 also reads
  `state.camera.azimuth` in the first and last result, as the base gives it, to see that the drag turned the session's
  camera 30°; no test reads anything else in a result, so what in it carries the time and the pose to the view is the
  work's to settle.
- **`canvas.revisions {doc}`** as the app, and through `canvas.user` the canvas core's **`track`** call (`{"call":
  "track", "doc"}`: its `hash` is the input track's hash) and its **`golden_record`** and **`golden_verify`** calls
  (`{"call": "golden_record", "doc", "steps": 2}` answers `{golden}`, a golden of the document's evaluation, #525's;
  `{"call": "golden_verify", "doc", "golden"}` answers its `verdict`) *(chosen: these calls stand for "the input
  track's hash" and "every golden")*. `canvas.user` hands any call on to the canvas core at the base; these tests
  need it to go on handing these three.
- **`events.read {after, limit}`** as the app: the hub's record, read page by page, as #26's and #806's suites read
  it.
- **`deep-app --canvas <scenario.json>`** in a `canvas-fixture` build, as #2494's suite uses it: `evidence`,
  `window`, `decode_ms: 0`, `run_ms`, `revisions: [{at_ms: 0, presented}]`, `capture_ms`, `out`; of the report,
  `scale` and each frame's `at_ms`, `slots[] {layer, frame_seq, path, pixels}` and `capture`.

### Fixed with the task, for the work to build

- **`slots[].t`**: each entry of a frame's `slots` gives `t`, a whole number: the time in flicks the slot's frame was
  evaluated at.
- **`replies: [{at_ms, reply}]`**, an optional scenario key. Each `reply` is the result of one `canvas.user` input
  call made as the app, as the hub gave it. The fixture hands it to the panel right after the first frame that starts
  at or after `at_ms`, as `revisions` are handed, the way the app's panel takes the reply to its own input call, and
  it applies to every 3D layer the panel draws.
- **`follow: true`**, an optional scenario key: the fixture's panel also follows the hub at `HOME` as the shipped app
  does (`show::follow`), beside any `revisions`.
- **`reasons: [{layer, reason}]`** on each frame of the report: the layers the panel painted a reason for in that
  frame, `[]` when none.
- **The record's `layer.refused@1`**: `subject` `doc:<doc ID>`, `data: {doc: "doc:<doc ID>", rev, layer, reason}`,
  `reason` the text the panel paints.
- **`crates/deep-app/view-count.json`**: `{"counted": <n>, "refused": {"<reason>": ["<path>", …]}}`, each path
  relative to the tree and each list sorted, over every `.json` file under `packs/examples/` and `tests/acceptance/`
  whose top level is an object that holds a 3D item. **`node scripts/view-count.mjs [--root <tree>]`** builds the
  app's fixture build from the checkout it sits in, asks it (`deep-app --view-count <tree>`) about every document
  under `<tree>` and compares with `<tree>/crates/deep-app/view-count.json`: `PASS view count: …` and exit 0, or exit
  1 with one line a finding (`FAIL view count: <path>: the view refuses it (<reason>) and the count leaves it out`,
  `FAIL view count: <path>: the count lists it under <reason> and the view draws it`, `FAIL view count: counted <n>,
  the file says <m>`), or `BLOCKED view count: …` and exit 3 when it can't build or run.

### Planted programs *(chosen: the names, and what each does)*

Each is selected by `DEEP_CANVAS_PLANT=<name>`, read only in a `canvas-fixture` build, where #2494's
`reads_every_frame_back` is read. Each is the shipped program but for the one thing it names.

| Name | The wrong program | Criterion |
|---|---|---|
| `draws_in_default_look` | The view draws a document that names a `look` in the session's roles, as a document that names none is drawn: the document's look is never read. It paints a frame from a slot, and reports no reason | 3 |
| `draws_at_first_camera` | The view draws a document that has `shots` through the document's `camera` at the pose that camera's own params give, as if the document had no `shots`: no shot writes the pose. It paints a frame from a slot, and reports no reason | 3 |
| `keeps_own_clock` | The view asks for each frame at the time since the view was made, as the merge base does, whatever the session's transport says: a pause and a seek don't reach it. `slots[].t` is that time | 5 |
| `paints_reason_records_nothing` | The panel paints a refused layer's reason and reports it in `reasons`, and the app tells the hub nothing: the record gains no `layer.refused` | 7 |

Criterion 1's planted example is a document, not a program: this suite's `fixtures/needs-physics.json` copied to
`packs/examples/planted-3517.json` in a scratch copy of what the check reads (every `.json` file under
`packs/examples/` and `tests/acceptance/`, and the kept count; never `.git`). Criterion 2 names the merge base as its
wrong program. Criteria 4 and 6 name none.

### What the fixture mode must keep

As #2494's README has it: `presented` reaches the panel through the same reading of a presentation that `follow`
uses, and nothing but the scenario, the evidence store and, under `follow`, the hub feeds the panel. A capture reads
pixels for the fixture alone.

## Fixtures

Writers' payloads for `deep show` (no `id`, no `layers`, no item `layer`), in the shapes #2494's, #1719's and #493's
documents use. Every one has an opaque sky or ground, so a slot's premultiplied bytes are its straight ones.

| File | Document |
|---|---|
| `sliding-box.json` | #2494's: 480 × 360, a red box that a channel slides from x = −1.5 to 1.5 over a 60 s span, so every time has its own frame |
| `turned-box.json` | 480 × 360, still: a red slab and a green post, the document's camera `cam` orbiting the origin at azimuth 0°, and a second camera `turned`, alike but at azimuth 30° |
| `text-over-box.json` | 480 × 360, still: a pale box under a pale sky and one `text@1`, "Hello", in the `ink` role, so the text is the frame's only dark pixels |
| `look-box.json`, `brick.look.json` | 320 × 240, still: a box painted in the `accent` role on the look's ground; the document names the look `brick-3517@1` by the hash of `brick.look.json`, whose ground is paper and whose accent is brick red (#1719's own-look shape), neither the shipped look's |
| `two-shots.json` | 320 × 240: the slab and the post; two shots on the one camera, `front` (0 to 4 s, azimuth 0°) and `side` (4 to 8 s, azimuth 60°, higher and nearer), and the camera's own params at a third pose (azimuth −40°) |
| `needs-physics.json` | 480 × 360, still: a red box in a document whose `requires` names `physics`, which the view still refuses after this task (the issue's "Not in this task") |

The castle is `packs/examples/castle.json`, as committed, shown on a 640 × 400 panel.

A document shows on a panel of its own size in points, and the app's window is that size, so the layer's place is the
whole window and its slot is the document's size times the display's scale. Render-back is asked for at that size.

## Criteria to tests

IDs are `#3517.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and whitespace collapsed
(`criterionId` in `scripts/proof-change.mjs`). Every test's name starts with its criterion's tag.

| Criterion | File (tests) | What it asserts | Fails on |
|---|---|---|---|
| AC1 `#3517.6be4cfad` The count is in the record for the examples and the fixtures, by reason. A planted example that the view refuses and the count leaves out fails, naming the document | `ac1-view-count.test.ts` (1 + 1 planted example) | The check exits 0 with one `PASS view count:` line; the kept file holds `counted` and, by reason, sorted paths of files under the two folders, with `needs-physics.json` under `module_missing: physics`. With the example planted the check exits 1 and its findings are exactly the planted document's line, with its reason, and the count it moves | The merge base, which has no check and no count; a check that passes the planted tree, or names another document |
| AC2 `#3517.1021b920` In the real app the castle example is painted from a GPU-layer slot, and its frame at a set `t` equals render-back's frame of that revision at that `t` by pixel hash on one machine. On the merge base the layer shows `module_missing: building` | `ac2-castle.test.ts` (1) | Some frame's `slots` holds the castle's layer; the captured frame's slot was evaluated at 6 s (`t`); its bytes hash to render-back's frame of that revision at 6 s | The merge base, which paints no slot (the first assertion; its message gives what the panel painted in the layer's place) |
| AC3 `#3517.234b03aa` A document with a `look` and one with `shots` are each painted, equal by pixel hash to render-back's frame. A planted view that draws them in the default look, or at the document's first camera, fails, naming the field | `ac3-look-shots.test.ts` (2 + 2 plants) | For each document: painted from a slot, and the captured slot's bytes hash to render-back's frame at 6 s. Under its plant the same check finds one thing, a frame that is not render-back's, in a sentence that names the field | The merge base (`feature_absent`); `draws_in_default_look`; `draws_at_first_camera` |
| AC4 `#3517.a6d46379` A 3D document with one text item over a box is painted with the text within 0.5 px of where render-back draws it | `ac4-text-over-box.test.ts` (1) | Render-back's frame holds the text; the layer is painted from a slot; the window's capture holds the text; the two ink centres are within 0.5 px in x and in y | The merge base (`module_missing: marks2d`); a view that leaves the text out, or draws it elsewhere |
| AC5 `#3517.5a0bce0e` With the session paused the view draws 0 frames, and after a seek to 10 s the frame on screen is the frame at 10 s. A planted view that keeps its own clock fails, naming both times | `ac5-session-time.test.ts` (1 + 1 plant) | From 5 to 9 s of the run, paused at 3 s since 0.5 s, the window shows one view frame, evaluated at 3 s; the frame captured 4 s after the seek was evaluated at 10 s and hashes to render-back's frame at 10 s. Under the plant the check fails and a failure holds both times | The merge base, whose view draws on; `keeps_own_clock` |
| AC6 `#3517.1933faf6` A drag that turns the camera 30° changes the frame on screen to the one render-back draws from that pose, and leaves the document's revision, the input track's hash and every golden unchanged | `ac6-drag-turns.test.ts` (1) | The hub's replies say the camera turned 30°; `canvas.revisions` and the track's hash are the same before and after the drag, and the golden recorded before it verifies `PASS` after it; the frame captured 2.5 s after the drag differs from the one before it and hashes to render-back's frame through the camera at the turned pose | The merge base, where the drag changes nothing on screen; a view that turns the wrong way or by another angle; a drag that makes a revision or a track entry |
| AC7 `#3517.514071e2` A layer the app refuses is in the record with its reason. A planted app that paints a reason and records nothing fails, naming the layer | `ac7-refusal-recorded.test.ts` (1 + 1 plant) | The record holds `layer.refused` with the document as subject and `{doc, rev, layer, reason: "module_missing: physics"}`, and the panel painted that reason for that layer (`reasons`). Under the plant the reason is painted and the one failure names the layer | The merge base, which records nothing; `paints_reason_records_nothing` |
| AC8 `#3517.b32111eb` #2494's suite and #2679's first criterion pass unchanged: a played 3D frame in the app makes no read-back buffer | none here | #2494's suite is the proof, run as its README says with no file under its folder changed (Run them, above); its AC3 is the count of read-back buffers over played frames, which #2679's first criterion reads on the same surface. This job writes no copy of it |

## Readings where the issue leaves a choice

- **"In the real app."** The shipped `deep-app` binary's own `CanvasPanel` in its real window, through #2494's
  fixture mode, since it exists at the base and the tests fail there at an assertion.
- **"Render-back's frame."** The snapshot `deep show` answers with, from the same hub, of the same revision the app is
  handed, at the time and the size the slot's frame has. Render-back is not asked for again once the app has drawn: a
  render-back call needs an agent's session, and a second `deep show` makes a second revision.
- **"By pixel hash."** #1722's: SHA-256 of the picture's width and height and its decoded RGBA bytes. A slot's bytes
  are premultiplied and render-back's are straight; the fixtures' frames are opaque, so they are the same bytes. A
  failure also says how many pixels differ and by how many codes.
- **"At a set `t`."** The session is paused there: a playhead entry made as the app, its reply handed to the app's
  fixture half a second into the run, and the frame captured seconds later. The slot's `t` must be exactly that time.
- **"Painted from a GPU-layer slot."** #2494's: some frame's `slots` holds the layer. That the window shows the slot's
  frame is #2494's own criterion, which criterion 8 keeps.
- **"The layer shows `module_missing: building`."** The base's report has no `reasons`, so on the base the failure's
  message says the report gives none; `lacks` is where the base's reason is read. With `reasons` in the report the
  message names what was painted.
- **"The castle example"** is `packs/examples/castle.json` as committed. It names no look, so render-back draws it in
  the session's roles, where most of it is white under an orange sky; that frame is what the slot must hold.
- **"A document with a `look`"** names a look of this suite's own, by hash, with the look's bytes in the hub's
  evidence store. **"One with `shots`"** has two, so the frame judged, at 6 s, is in the second.
- **"In the default look" and "at the document's first camera."** The planted programs above. The second is read as
  the document's `camera` at the pose its own params give. The fixture's second shot differs from that pose and from
  its first shot's, so a view that held the first shot's pose would fail too.
- **"Naming the field."** The failure's sentence starts with the field of the document whose frame is not
  render-back's, `look` or `shots`. Each plant is run on its own document; the check must find a frame that differs,
  not a layer left unpainted.
- **"Within 0.5 px of where render-back draws it."** Read on screen: the window as the compositor received it, in
  device px, against render-back's frame at the same size, so a view that draws the text into the slot and one that
  draws it over the slot are judged alike. Where the text is: the centre of its ink, each pixel weighing by how far
  its luma falls below 110, which only the text does in this fixture. Both centres' x and y are within 0.5 px of
  those device px. A centre is steadier than an edge under antialiasing; it doesn't see a text drawn at another size
  about the same centre.
- **"With the session paused the view draws 0 frames."** Over 4 s of the run, well after the pause was handed over,
  the window's frames show one view frame (`frame_seq`), evaluated at the paused time. A window that drew fewer than
  60 frames in those 4 s is INCONCLUSIVE.
- **"After a seek to 10 s."** A seek is a new playhead (the base's control), so the session stays paused, at 10 s.
  **"The frame on screen is the frame at 10 s"**: the slot captured 4 s after the seek was evaluated at 10 s and
  hashes to render-back's frame at 10 s. **"A rate scales it"** (Scope) has no criterion and no control at the base.
- **"Naming both times."** One failure sentence holds the session's time, 7,056,000,000 flicks, and the time the
  planted view's frame was evaluated at, in flicks and seconds.
- **"A drag that turns the camera 30°."** A press at (300, 180) of the panel, six moves and a release 120 px to the
  left, at the base's 0.25° a px. The hub's own replies must say 30°.
- **"The one render-back draws from that pose."** Render-back takes a camera item at the base, not a pose, and a
  render-back call needs an agent's session. So the document holds a second camera at the turned pose, and
  render-back's frame from it is `deep show`'s snapshot of the same document with `camera` naming that camera, shown
  on a second doc ID of the same hub *(chosen)*. The comparison is by pixel hash, as criteria 2 and 3 are.
- **"Leaves the document's revision, the input track's hash and every golden unchanged."** `canvas.revisions` answers
  the same rows and the `track` call the same hash before and after the drag, and a golden recorded before it
  (`golden_record`) verifies after it (`golden_verify`: `PASS`). A golden is #525's: the document's evaluation over
  steps, keyed by the revision's document, which your view never enters. The frame is captured 2.5 s after the drag,
  inside the 4 s a camera's `yield` waits before a shot takes the view back; this document has no shot.
- **"A layer the app refuses is in the record."** The hub's event log, read through `events.read`. The revision is
  handed to the fixture's panel both by `revisions` and by `follow`, so on the base the panel does paint the reason
  and the test fails on the record alone.
- **"The count is in the record."** The kept file in the repo, as fixed with the task; "the record" here is not the
  hub's. The test doesn't hold `counted` to a number: this suite's own fixtures are in the population.
- **Criterion 8 needs no new test.** A tagged test that passes on the merge base proves nothing by the proof lanes'
  rule, and a second copy of a suite is a duplicate.

## Legs that read BLOCKED or INCONCLUSIVE

The states are #3506's: `BLOCKED`, a reading is missing or unrun; `INCONCLUSIVE`, what was read can't decide. Neither
is a pass.

- Off macOS: criteria 2 to 7, `BLOCKED` (a skip whose note starts so): no GPU to draw on.
- On a Mac that isn't a reference model (`scripts/benchmark.mjs`): criteria 2 to 6, which judge frames,
  `INCONCLUSIVE` (the issue's `Runs on:`). Criterion 7 judges no frame and runs on any Mac.
- The machine's GPU lease (`~/.cache/deepbuild-gpu/lease`) held by another live process for ten minutes: `BLOCKED`.
  Each test of criteria 2 to 6 holds the file while it draws and lets it go after.
- Where the app's window draws no frame with nothing to show (no display, a locked screen, a sleeping display, a
  hidden window, no Metal device): criteria 2 to 7, `BLOCKED`, after the 90 s that short run is given. This is what
  the base's run read (Base, below). A run that ends without a report is followed by that short run again: still
  drawing, the test fails; no longer drawing, `BLOCKED`.
- AC5, either test: a window that drew fewer than 60 frames in the 4 s the pause is judged over, `INCONCLUSIVE`.
- A render-back snapshot that is blank or black: `BLOCKED` (a failed assertion whose message starts so).
- No built CLI, a `deep-show` or `deep-hook` built outside the checkout's `target/`, a hub that doesn't start or
  refuses the app's hello or a call: `BLOCKED` (thrown, naming which).
- AC1: `scripts/view-count.mjs` exiting 3: `BLOCKED` (thrown, with its line).
- Not INCONCLUSIVE, by design: a Mac whose GPU the GPU seam refuses paints no slot and reads FAIL.

## Not tested, and why

- **A rate** on the session: the Scope names it, no criterion does, and the base's scope has no rate control.
- **Maps, insets and readouts over the frame**: the Scope names them; criterion 4 asks for one text item.
- **That the count only falls**: a rule for the changes that follow, which the check holds by failing a document the
  count leaves out.
- **`deep show`'s reply saying a layer is refused**: the opening names it; criterion 7 asks for the record.
- **Fling, walk and fly, window frames, the meter and the ladder, a piece that plays**: the issue's "Not in this task".
- **The window showing the slot's frame, and read-back buffers**: #2494's suite, criterion 8.

## Base

`BASE-FAILURE.txt` says what each file read at the base, `a7ae0e804`. In short: `ac1` ran and fails at its
assertions; the six files that open the app's window read `BLOCKED`, every test of them, because this Mac's screen
was locked and its display asleep, so no frame of the real app was judged at the base. What each is written to read
there is given from the base's code, not from a run. The suite's own logic was run once against a throwaway
stand-in for the app, with a real hub and a real canvas core; that shows the tests pass and fail where they are
written to, and says nothing of the base's app.
