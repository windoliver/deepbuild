# Acceptance tests for #383: one interaction scope, zoom that shows what needs you, and full screen

Written first, from issue #383 (its scope, its five acceptance criteria, its proof line and its Oracle line), the
design sections it links and those they lean on, and base commit `d122341` ("Merge pull request #737 …
feat/667-ask-checkpoint"), by a job that never saw an implementation; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: the Canvas bullet (516) and Rules every primitive follows (527: a stable name hands a
  primitive to an agent by reference; it has levels of detail); Zoom that reveals detail (529–535: "a database opens
  into its tables, what each holds … and which ones this week's changes touch"; "Files are one view among these.
  Children load by reference when their level is reached, so a large project costs only what's on screen.
  Double-click flies in, Esc backs out a level, and a breadcrumb says where you are"); One way to interact, in every
  scene (536); Editing by people and agents (619–629: "one interaction scope that owns every gesture, with no
  picking mid-gesture and one commit per gesture"; "camera framing only from navigation, such as the breadcrumb,
  never from a stray click"; "no key means one thing tapped and another held"); Full screen (716: "Every canvas
  fills the space it's given and has a full-screen button … the window then takes the whole screen too, and Esc
  leaves, one level at a time"); The canvas core (1050), Canvas modules (1056: the input router is ring-critical
  core, never a module; the camera is the core's), the module table's record (1066), input (1069) and scene3d
  (1073) rows; Salience (1244); Camera and overlay (1313); The canvas budget row (2405: "a core view or a
  window-sized figure under 2 ms of GPU and 4 ms of CPU per frame … under 256 MB of GPU memory per window measured
  on the device … a drag on screen within 2 frames, a patch within 1 frame of the latch"); Every task carries its
  own budgets (2418: five runs after warm-up, PASS / FAIL / INCONCLUSIVE, a frame-time p95 over at least 300 frames,
  "A budget's value comes from its issue"); Dogfooding (2518); Tests written first (2549); GPU memory for a
  full-screen 3D view (2630); The reference window (2668: 1512 × 982 points at 2×); The canvas's GPU layer (2673).
- `docs/canvas-primitives.md`: Scope and input classes (59: the camera on views of the record, the selection and
  hover are session state; level of detail is a pure function of the view); The cost model and its budget table
  (82–99); Patch (451: "one `doc.patched` event (per gesture for you …)"); Admission and latch (703); Frame clock
  and scheduler (723: "Arms a frame only on a commit, … input …"; a kit case on a virtual display clock); Frame
  callback and presentation feedback (756); Input router, focus and gesture serial (799); Spatial index (813);
  Window and display placement (891: `kind: main | popped(view) | full_screen`); Editor panel: patches as you
  (1352: "one key per gesture", "At release the panel commits once"); Salience `salience@1` (2313); Selection
  (session state) (2334); Camera `camera@1` (4383: "Outside a shot, only navigation reframes (the breadcrumb, a
  double-click), never a stray click"; "a pinch or a scroll zooms toward the pointer"); Level of detail (4953:
  `open: {at_px, doc}` "loads a deeper document by reference, off the frame loop"; "It can never: Change saved
  data"); Level of detail: chunks streamed by view (5018, for residency and settling); Dirty classes (5038); Content
  key (5054); Control (5481: `verb: … | canvas.full_screen`).
- At the base: AGENTS.md; `tests/acceptance/372/` (the camera you move: `deep-canvas session`, its Camera state and
  pinch law), `394/` (`deep-salience level`, the JSON-lines convention, `planted` values, facts), `378/` (`deep-gpu
  run`'s `view3d` call, the object-ID target, `look.json`, INCONCLUSIVE off macOS), `393/` and `96/` (`deep-show
  run`: panels, deep_show documents, shared documents, patches, the virtual display clock), `377/` and `237/` (the
  timing rule, the reference-Mac gate with the owner's October 24 change, the load check), `24/` (the perf lane
  task test); `crates/deep-canvas` (`session`, `render`), `crates/deep-canvas-record` (`deep-salience level`),
  `crates/deep-gpu-layer` (`view3d`), `crates/deep-show` (its calls, `Clock`), `crates/deep-app` (the shell);
  `scripts/lanes.mjs`, `scripts/benchmark.mjs`, `benchmarks/budgets.json`.

What the base already does and these tests don't credit: `deep-salience level` ranks one level's items by facts and
folds the rest (#394); `deep-canvas session` pans, turns and pinches a camera (#372); `deep-show run` presents
deep_show documents in panels, applies patches and makes them current at a latch on a virtual clock (#393, #96);
`deep-gpu run`'s `view3d` draws scene3d's marks on Metal with an object-ID target (#378). There is no zoom built from
a project, no interaction scope (click, double-click, Esc, ⌘K, commits, a full-screen button), no presented-frame
report, and no level loaded by reference or GPU timing per frame.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/383 --no-file-parallelism
npx tsc -p tests/acceptance/383/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds the binaries it uses, once, with `cargo build --locked --bin <name>` in the checkout, copies
each out of `target/debug` under its own name into a temporary folder, and fails each test that uses a build that
failed. Each test writes into its own temporary folder (the evidence store, the generated city) and deletes it. The
tests use node built-ins and vitest only. A run with `--root tests/acceptance/383` leaves Vitest's cache in
`tests/acceptance/383/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base (home paths
redacted): all 12 tests fail, each for a reason that names the missing behavior (below).

`scripts/lanes.mjs` needs `tests/acceptance/383/` in its `alone` list (the one-at-a-time unit-lane line, and so
excluded from the parallel line), beside `378/` and `377/`: the files build cargo binaries and `city.test.ts` times
the GPU. This README is the instruction; the implementer makes that edit, as #378's did.

`city.test.ts` draws with the GPU layer on Metal, on macOS, headless: off macOS it fails with a message that starts
`INCONCLUSIVE:`, never passing. Its budget test is judged by the design's timing rule and counts only on a reference
Mac (Mac15,7 or Mac15,12) with Low Power Mode off, a nominal thermal state and the machine not loaded past its core
count (battery or mains alike, by the owner's change recorded in `377/README.md`); anywhere else it prints the five
runs and is skipped with a message that starts `INCONCLUSIVE`, never passed. Everything else is deterministic: the
interaction scope runs on the hub's virtual display clock and reads no wall time. Expect `city.test.ts` to take a
while: fourteen runs of 360 frames at 3024 × 1964.

## The surface under test

The issue names zoom levels, gestures, commits, picking, frames, a latch, a GPU budget and a full-screen button, but
no code API. So these tests add the smallest surface they need to three binaries that exist, one per owner the design
gives: the record module's salience (`deep-salience`), the trusted compositor's input router, frame clock and window
(`deep-show`, which plays the hub's canvas side and its panels for tests, #393), and the GPU layer with scene3d
(`deep-gpu`). No new binary.

### The JSON-lines convention

#394's: one JSON object per stdin line, exactly one JSON object per input line out, in order, then exit 0. A line
that isn't JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false, "code":
"bad_input"}`. A run that writes fewer lines than it read, or exits non-zero, fails every test that drove it.

### `deep-salience zoom` (criterion 1)

Input:

```json
{"project": {"parts": [Part], "rows": [Row], "checks": [Check]}, "open": part ID, "fits": n, "show"?: 9,
 "planted"?: "files_as_items" | "evidence_by_folder" | "level_rule_off"}
```

- Part `{"id", "kind", "name", "files": [path]}`: a part of the Map and the repo files it is made of.
- Row `{"id", "kind", "parent", "level", "name", "holds", "facts"}`: what a map layer returns (technical design: A
  row has a kind, a parent and the level it shows at). `level` is the ID of the level it shows at; `holds` is what
  it holds, from the repo's files and the record, read with no model; `facts` are #394's
  `{needs_you, sent_back, failing, lacks_proof, touched, changed, priority}`, as a projection of the record gives
  them (`changed`: changed since you last looked).
- Check `{"id": "check:…", "part", "verdict", "points_at": [path]}`: a check on the part and the files it points at.
- `fits` is how many items fit at the minimum readable size, as #394's `level` takes it.

Output, the level `open` names as drawn:

```json
{"ok": true, "level": ID,
 "shown": [{"id", "kind", "name", "holds", "rank", "reasons": [fact key]}],
 "fold": {"count", "items": [ID], "line"} | null,
 "evidence": [{"check": ID, "files": [path]}]}
```

`shown` in rank order with #394's `{rank, reasons}`; `fold` the one count item holding the level's other items;
`evidence` every check on the part that points at a file, each with the files it adds, beside it. A level whose rows
list the part's files (rows of kind `file` at the part's own level) fails the level rule: `{"ok": false, "code":
string, "part": part ID}`, naming the part.

### `deep-show run` with the interaction scope (criteria 3, 4, 5)

#393's and #96's scenario, unchanged, with one field and three calls added. Every scenario here has `clock` (#96's
virtual display clock: vsync at `k × 705,600,000 ÷ refresh_hz` flicks, the latch `lead` before it, `check` flicks of
the checker per patch), so every call carries `at` (flicks) and calls arrive in `at` order.

- `display: [w, h]`: the display the window is on, in px. Full screen fills it: the canvas's `rect` becomes
  `[0, 0, w, h]`.
- `planted`: the values below (Planted programs), beside #393's and #96's.

Calls added:

- `{"call": "input", "at", "panel": panel ID, "event": Event}`: your hardware input (source `hid`) to the canvas in
  that panel. Pointer positions are window px. Answer `{"serial": n, "state": Scope, "picks": n, "commits":
  [{"gesture": serial}]}`: the serial the input router gave this input; the panel's scope after it; how many hit
  tests (picks) this input ran; the session-state commits this input made, each naming the serial of the input that
  ended its gesture.
- `{"call": "scope", "at", "panel"}`: answer `{"state": Scope}`, with no input.
- `{"call": "presented", "at", "panel"}`: answer `{"frames": [{"vsync": flicks, "rev": u64, "camera": Camera}]}`:
  every frame presented for that panel's document from the start of the run up to `at`, in order, each at the vsync
  it presented at, with the revision it drew and the camera it drew with (presentation feedback, Frame callback).

Event:

| Event | Meaning |
|---|---|
| `{"type": "down" \| "up", "pos": [x, y]}` | the primary button pressed or released at `pos` |
| `{"type": "move", "pos": [x, y]}` | the pointer moved to `pos` (with the button held between a down and its up) |
| `{"type": "scroll", "phase": "begin" \| "change" \| "end", "pos", "delta": [dx, dy]}` | a precise scroll at `pos`, `delta` in px; begin and end carry `[0, 0]` here |
| `{"type": "pinch", "phase": "begin" \| "change" \| "end", "pos", "scale"}` | a pinch at `pos`; each change multiplies the zoom by its `scale` (#372's law: in 2D the zoom divides the view width); begin and end carry 1 |
| `{"type": "key", "key": string, "mods": [string]}` | a key press: `Escape`, `Return`, `k` with `["cmd"]` |
| `{"type": "text", "text": string}` | text typed into the focused field (the ⌘K palette) |

Scope:

```json
{"camera": Camera, "rect": [x, y, w, h], "full_screen": bool, "buttons": [{"verb": string, "rect": [x, y, w, h]}],
 "selection": [ID], "details": ID | null, "hover": ID | null, "level": [ID], "palette": {"open": bool, "query": string}}
```

- `camera`: #372's Camera state; the tests read `target` and `view_width` (a 2D document's camera: orthographic,
  `target` and `view_width` in u, y down). The canvas's `rect` shows `view_width` u across, centred on `target`.
- `rect`: the canvas's rect in window px: its panel's, or the display's in full screen.
- `buttons`: the controls the canvas draws over itself, bound to canvas verbs (Control: `verb`), in window px; the
  full-screen button's verb is `canvas.full_screen`. A click on a button presses it and picks nothing under it.
- `selection`: the selected IDs (Selection); `details`: the item whose panel is open ("click selects and opens the
  panel"); `hover`: the item under the pointer.
- `level`: the breadcrumb below the document's top level: the IDs of the levels you flew into, outermost first (`[]`
  at the top). A level is an item and what it holds; for nested items it is their nesting path.
- `palette`: the ⌘K palette, open or not, with the query typed into it.

What a gesture is: a press, its moves and its release (a drag when the pointer moves while held, else a click; two
clicks close together on one item a double-click); a scroll's or a pinch's begin, changes and end; a key press. The
tests send drags of 30 px steps, clicks with 60 ms between press and release, double-clicks with 40 ms presses 80 ms
apart, and keep every other gesture 1.5 s from the next.

### `deep-gpu run` with levels by reference (criterion 2)

#377's `deep-gpu run [--planted <name>]` and #378's `view3d` call, unchanged, with fields added:

- On the call: `"docs": {doc handle → path}`, the documents an item may open by reference, each a whole document in a
  JSON file as `doc` is; `"timings"?: true`.
- On `mark.box@1`: the param `open: {at_px: f32, doc: doc handle}` (Level of detail: `open`): when the item's
  projected size in device px reaches `at_px`, the document it names loads by reference, off the frame loop, and its
  items draw in the opener's frame (a child document's `at.pos` is relative to its opener's `at.pos`; the city has
  no rotation or scale on openers). The child documents have no camera; the view's camera is the root's.
- On every Frame: `"settled": bool` (every document the view selects is resident, Level of detail: chunks streamed
  by view, settling), `"resident": [doc handle]` (the documents loaded by reference whose items are on the GPU as
  the frame draws, not the root); with `timings`, `"gpu_ms"` (the frame's GPU time from the device's timestamp
  queries, from the first pass's start to the last pass's end) and `"gpu_bytes"` (the GPU memory the view holds as
  the frame draws, measured on the device: targets, slots, buffers and textures).
- `ids` and `picks` as #378's.

The document's own `size` is the call's `size` (as #378's).

### Planted programs

Each reachable only through its field, only to prove a test fails on a wrong program; every test runs its own and
asserts that it fails.

| Where | Name | The wrong program | Test |
|---|---|---|---|
| `zoom` `planted` | `files_as_items` | the level also shows the part's files as items | AC1 tables |
| `zoom` `planted` | `evidence_by_folder` | a check adds every file of the folder it points into | AC1 check |
| `zoom` `planted` | `level_rule_off` | the level rule isn't checked: a layer's file rows show as the level's items | AC1 planted level |
| `deep-show` `planted` | `line_scroll_pans` | on a `view` document (the line) a scroll pans in time instead of zooming | AC3 shared |
| `deep-show` `planted` | `commit_every_move` | a drag commits on every move | AC3 scope |
| `deep-show` `planted` | `pick_mid_gesture` | a drag hit-tests on every move | AC3 scope |
| `deep-show` `planted` | `drag_shows_on_release` | a drag's moves reach the presented frames only when it ends | AC4 drag |
| `deep-show` `planted` | `patch_shows_a_frame_late` | a revision current at a latch is first drawn a frame after the vsync that latch begins | AC4 patch |
| `deep-show` `planted` | `full_screen_only_3d` | only `scene`, `world` and `figure` canvases get a full-screen button | AC5 button |
| `deep-show` `planted` | `esc_to_root` | Esc leaves full screen and goes back to the top at once | AC5 Esc |
| `deep-gpu --planted` | `loads_everything` | residency loads every document an item opens, wherever the item is | AC2 loaded |
| `deep-gpu --planted` | `slow_gpu_frame` | every frame adds a pass that keeps the GPU busy for at least 10 ms of its timestamped time | AC2 budget |

## Fixtures

All written by this job before any implementation ran.

- `project.json` (AC1): parts `postgres` (14 files: `db/schema.sql`, `db/seeds.sql`, eleven migrations and
  `db/README.md`), `api` and `web`; at Postgres's level 12 tables, each with what it holds, 3 changed since you last
  looked (this week): `refunds`, `sessions` and `users`, last by ID, so the first 9 by ID hold none of them; rows in
  shuffled order; three columns of `orders` at `postgres.orders`'s own level (two changed), and rows of `api` and
  `web`. No checks; the tests add one, `check:migrations-apply` (FAIL), pointing at
  `db/migrations/0007_add_refunds.sql`. Ranked by salience@1 (#394: the rank list, then ID), the 9 shown are
  refunds, sessions, users, accounts, audit_log, carts, coupons, invoices, line_items; orders, payments and products
  fold.
- `chart.json` (AC3, AC4): a `chart`, 800 × 450, six bars (`rect@1`, Monday to Saturday) on an axis; `line.json`
  (AC3): a `view`, a session's line: six event markers along one track ("Session started" … "Check passed"). Both
  have the same 2D camera (`camera@1`, orthographic, target [400, 225, 0], view width 800, `user {zoom: [0.25, 8],
  pan: {bounds: none}}`), so a gesture's numbers compare across them, and both are empty at the points the script
  uses for its drag, scroll and pinch (checked at run time against the starting scope and the canvas's buttons).
- `levels.json` (AC5): a `board` whose `region` (`frame@1`) holds `cluster` (`frame@1`), which holds `node`
  (`rect@1`), each at the origin so their boxes are in page u.
- `work.json` (AC4): a shared `board` (#96's form, revision 0) with alpha's layer, which alpha's patches add dots to.
- `look.json` (AC2): #378's look, copied.
- Generated: the minimal documents of AC5, one per profile (`minimal` in `helpers.ts`: one rect on an 800 × 450 page);
  the city of AC2 (`writeCity`): a root of 8 × 8 parts (40 m plates 60 m apart), each part's document of 12 tables
  (7 m plates 9 m apart), each table's document of 8 columns, 833 documents, each opener's `open.at_px` 600; a
  perspective camera on part 27's table 5 (target [−34.5, 0.3, −30], orbit azimuth 30, elevation 75, distance 10,
  fov 40) in the 3024 × 1964 view. By this job's own projection the view's ground footprint reaches about 10.5 m from
  the target, so nothing of another part (35 m or more away) is in view, while table 5 spans about 2,900 px.

## Criteria to tests

Each test's name starts with its ID. Each test returns its criterion's failures as sentences naming what failed, and
runs its wrong program to show that the same check fails on it.

| ID | Criterion (short) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | zooming into Postgres shows the 9 tables ranked first, the 3 changed among them, each with what it holds, folds the other 3 into one count, shows no file | `zoom.test.ts`: exactly the 9 in rank order, all tables, ranks increasing, each `holds` the row's, the 3 changed with `changed` among their reasons; a fold of exactly the other 3 whose line starts "3 more"; no path of any part's files anywhere in the answer, no evidence, no column of `orders`. Fails on: tables by ID or input order, all 12, descendants pulled up, `holds` dropped, `files_as_items` |
| AC1 | a check that points at one migration file adds that file alone, beside the check | `zoom.test.ts`: `evidence` is exactly `[{check: check:migrations-apply, files: [0007_add_refunds.sql]}]`; that is the only file the answer names, and it appears nowhere but beside its check. Fails on: `evidence_by_folder`, a level that ignores checks, one that lists the file as an item |
| AC1 | a planted level that lists the part's files fails, naming the part | `zoom.test.ts`: the project plus a layer listing Postgres's 14 files as rows of its level answers `ok: false` with a code and `part: postgres`. Fails on: `level_rule_off` (answered ok, the files shown) |
| AC2 | with the deepest level open only what's on screen is loaded | `city.test.ts`: 360 frames; at least 300 settled, and settled once settled; at the last frame every resident document's opener, or something inside it, is drawn in the object-ID target, and its holder is resident; the deepest document (`p27.t5`'s columns) is resident and a column drawn. Fails on: `loads_everything` (part and table documents far off screen resident) |
| AC2 | a window-sized 3D frame stays within the GPU budget | `city.test.ts`: five fresh runs after a warm-up at 3024 × 1964 with `timings`; each run's p95 of `gpu_ms` over its settled frames ≤ 2 ms and its most `gpu_bytes` ≤ 256,000,000, by the judge. `slow_gpu_frame` is judged FAIL in the same test. INCONCLUSIVE off the reference Mac or under load |
| AC2 | … against the merge base (the Oracle line) | `city.test.ts`: `benchmarks/budgets.json` has a task `map-deepest-level` whose first measurement names #383, valid against the merge base's budgets by `scripts/benchmark.mjs`'s `validateBudgets`, and its command exits 0. Fails on: the base (no task) |
| AC3 | the same gestures do the same thing on a chart and a session's line, by one shared input test | `input.test.ts`, the shared test: one script, from each document's own camera: a drag keeps the content grabbed under the pointer within 0.5 px after every move and keeps the view width; a scroll and a pinch keep the content under the pointer within 0.5 px and change the view width, the pinch by exactly 1 ÷ 1.40625; a click selects the item, opens its panel and leaves the camera bit for bit; a double-click's first click leaves the camera, and the double-click puts the item in `level`, wholly in view, closer; Esc goes back to the top level and out again; ⌘K opens the palette, takes the name, and Return closes it at that item, in view. The drag's pan in px and the scroll's and pinch's factors are equal on both documents. Fails on: `line_scroll_pans`, and on any document whose gesture does otherwise |
| AC3 | one commit per gesture, no picking mid-gesture (scope) | `input.test.ts`, same runs: every release, end, Esc and the ⌘K Return commits exactly once with its own serial; no press, move, begin or change commits; a double-click's first release commits at most once; no move of a drag and no change of a scroll or pinch runs a hit test or moves the hover. Fails on: `commit_every_move`, `pick_mid_gesture` |
| AC4 | a drag shows on screen within 2 frames | `frames.test.ts`: on the chart at 120 Hz, 40 moves of 12 px at seeded times 0.35–1.65 frames apart; for each, the first presented frame at or after it whose camera has panned that far is at most 2 frames (11,760,000 flicks) after it. Fails on: `drag_shows_on_release` |
| AC4 | a patch shows within 1 frame of the latch | `frames.test.ts`: alpha's 30 patches at seeded times; for each applied one, the first presented frame drawing its revision or later is at or after the latch it became current at (`current`) and at most 1 frame after it. Fails on: `patch_shows_a_frame_late` |
| AC5 | every canvas has a full-screen button | `screen.test.ts`: for each of the nine profiles, a canvas filling its 800 × 450 panel lists exactly one `canvas.full_screen` button inside its rect; a click on it puts it full screen at the display's [0, 0, 1600, 900]; Esc puts it back in its panel. Fails on: `full_screen_only_3d` (the chart has none) |
| AC5 | Esc steps back one level at a time | `screen.test.ts`: on `levels.json`, double-clicks fly into region, cluster and node (`level` [region], [region, cluster], [region, cluster, node]), then the full-screen button; each of four Esc presses steps back exactly one step, a level or full screen, never both and never more; after four the canvas is at the top and out of full screen; a fifth changes nothing. Fails on: `esc_to_root` |

## Readings where the issue and design leave a choice

- **The GPU budget in AC2 (open question for the owner).** The issue says "the GPU budget below" and states no
  number, while the design says "A budget's value comes from its issue" (technical design 2418). The design's own
  budget for a window-sized view is used: "a core view or a window-sized figure under 2 ms of GPU … per frame" and
  "under 256 MB of GPU memory per window measured on the device" (2405), which the cost model's table gives every
  window-sized class (data view, figure, work product: 2 ms; canvas primitives 90–99; the core view's 1 ms* is a
  proposal and draws no 3D). The Map's 3D city has no budget class of its own; the showpiece's 10 ms is for full
  screen. "MB" is read as 10^6 bytes, the stricter reading. The owner should confirm the number the issue meant; if
  it differs, the redraft changes `GPU_MS` and `GPU_BYTES` in `city.test.ts`.
- **"Window-sized"** is the reference window, 1512 × 982 points at 2× (2668): 3024 × 1964 device px.
- **"Because only what's on screen is loaded"** is read through residency: every document loaded by reference has
  its opener, or something inside it, drawn in the frame's object-ID target. The criterion's budget alone can't
  tell a view that loads everything from one that doesn't, so the residency test carries the "because".
- **AC2 against the merge base.** The Oracle line names the merge base; the repo does that through the perf lane, as
  #24's and #237's suites check, so one test asks for a `map-deepest-level` task. Its limits and command are the
  implementer's.
- **AC4 is counted in frames on the virtual display clock**, #96's, so it is deterministic and reads no wall time;
  the frame clock's own kit runs on such a clock. "On screen" is a presented frame (presentation feedback); "a drag
  shows" is the frame's camera having panned at least as far as that move takes it. A frame presented at vsync v
  carries inputs that arrived by its latch, so a correct pipeline shows a move within 1 frame plus the lead; the
  seeded times put moves at every phase of the frame. The wall-time part (the check and the frame finishing before
  their deadlines on the reference Mac) and a merge-base comparison for AC4 aren't tested here.
- **"A patch within 1 frame of the latch"**: the first frame drawing the patch's revision is presented no more than
  one frame period after the latch at which the revision became current (`current`, #96's reply field).
- **A chart and a session's line** are deep_show documents of profiles `chart` and `view` built from `rect@1` marks:
  the base build has no data module (its sealed modules are look, marks2d, motion, scene3d and text) and no timeline
  kind, and the interaction scope must not depend on what draws the items. Both are presented by an agent's session;
  neither is edited, so a drag on either pans.
- **"Drag pans or turns"** is tested as pan, since both documents are 2D; "turns" is #372's camera in 3D.
- **Outcomes in numbers.** A drag pans with the content under the pointer (#372's 2D pan); a scroll and a pinch zoom
  toward the pointer (Camera: "a pinch or a scroll zooms toward the pointer"); the pinch's factor is #372's law; the
  scroll's rate isn't fixed by the design, so only its direction of effect and its equality across the two
  documents are read. "Flies in" is read as: the item joins `level`, lies wholly in view, and the view comes closer;
  framing's exact fill and placement aren't read. "Esc backs out" is read as back to the level before and further
  out. "⌘K flies to anything by name" is read as: the palette takes the item's exact `name`, and Return navigates
  to that item, which ends the breadcrumb and lies wholly in view.
- **"Click … opens the panel"** is `details`: the item whose panel is open. A click never moves the camera (camera
  framing only from navigation, never from a stray click), checked bit for bit.
- **One commit per gesture** is read on session state for views (Patch: "per gesture for you"; Editor panel: "At
  release the panel commits once"): the commit lands on the input that ends the gesture and carries its serial. A
  double-click's first release may end a click of its own or wait for the double-click; either way it commits at most
  once. Opening the palette and typing into it aren't held to a count.
- **No picking mid-gesture** is read on the scope's own count of hit tests per input and on the hover, which stays
  as it was at the press while the gesture runs.
- **Every canvas** is read as a canvas of every profile the base presents through deep_show: the Document envelope's
  nine (figure, film, scene, world, view, board, sheet, chart, cells), all of which the base presents with one rect.
  "Has a full-screen button" is a control bound to `canvas.full_screen` (Control, 5481) inside the canvas, which a
  click presses; full screen fills the display (Full screen: "the window then takes the whole screen too"; Window:
  `kind: full_screen`). The display has the panels' 16:9 shape, so no letterbox or extend is read.
- **"Esc steps back one level at a time"** with full screen on top of three levels: the design doesn't order leaving
  full screen against backing out of a level, so the test accepts either order and asks only that each press take
  exactly one step, and that Esc at the top, out of full screen, change nothing.
- **Levels in the city** load through `open` on `mark.box@1`'s params, the one form the fixture commits to; the
  design's Level of detail names the field, not where an item kind carries it.

Not tested, because no criterion asks: point and ask (handles, `t`, `doc_rev`, precision, quotes), lenses, filters,
the time scrubber, compare, stale verdicts on a selected value, edits of a work product by patch, kinds as data and
pure builders, dirty sets and content keys, one camera pose for 2D and 3D, isolation, tapped against held keys, the
breadcrumb's own drawing, turning in 3D, and present mode.

## The Oracle lane

The issue's Oracle line says no engine's or project's own test checks these criteria (AC1 our interaction scope's
rules; AC2 and AC4 a time and memory budget on the reference Mac against the merge base; AC3 and AC5 app flows). So
nothing upstream is ported; these tests are the local proof for every criterion.

## A note on this draft's checks

Before the base run, the AC1, AC3, AC4 and AC5 tests were run against a scratch reference model of this surface (two
Python scripts outside the repo, written from this README, standing in for `deep-salience zoom` and `deep-show run`):
all 9 pass on it, and each planted program fails the test that names it. `city.test.ts` wasn't modelled; its
geometry was checked by hand (above).
