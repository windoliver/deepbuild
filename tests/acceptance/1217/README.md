# Acceptance tests for #1217: Measure in 3D, a viewer tool that reads the distance, run and rise between two points picked on surfaces, at true scale, in the app and the web player

Written first, blind, from issue #1217 (its Scope, its Fields, its seven acceptance criteria, its Proof line and its one
comment), the design sections it links and those they lean on, and the base commit `7a256fd4b` ("Merge pull request
#2947"), by a job that never saw an implementation; none existed, and no other worktree, branch, pull request or stash
was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). Lean: one test per criterion, plus the two planted programs the Proof line names.

## The surface under test

**One binary, no new call.** Everything runs through `deep-show`, built as #169's and #172's suites build it
(`cargo build --locked --bin deep-show --no-default-features --features full`): `deep-show run` (#393's scenario: one
JSON line in, one answer line `{"ok": true, "replies": [...]}` out) on #383's virtual clock, `deep-show screen`
(#1162's window) and #172's web export, its bundle served over HTTP and opened in headless Chrome with WebGPU. `deep-gpu`
is not used. "The app" in a criterion is `deep-show`, as #172's, #539's and #1045's suites read it. **Every name marked
*(chosen)* is this job's**, the least the criteria need and shaped like the base's neighbouring surfaces; the rest are
the issue's or the design's words. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The document

| Field | As the tests write it | Whose word |
|---|---|---|
| `viewer_tools` | envelope `viewer_tools: {measure: true}`: the document offers the tool. At the base the key is `unknown_field` and the document is refused | the issue's (Fields: Document) |

Nothing else is new in a document. The fixtures use only what the base reads (Fixtures, below).

### The app: turning the tool on, and the inputs

| Input (`{call: "input", panel, at, event}`) | What it does with the tool | Whose word |
|---|---|---|
| `event: {type: "control", control: "measure", value: true \| false}` | the viewer's setting: `true` turns the tool on in a document that offers it, `false` off. The form is the base's for the scope's own settings (`filter`, `isolate`, `lens`, #383) | *(chosen)*; the setting `measure` on or off is the issue's |
| `{type: "down", pos, button: "primary"}` then `{type: "up", pos, button: "primary"}` at one `pos` (panel px; the panel's rect is the document's `size`, so a panel pixel is a frame pixel) | a click: with the tool on, the first places A, the second B, a third starts again at A | the base's events; the issue's behaviour |
| `{type: "key", key: "Escape"}` | clears both points; the tool stays on | the base's event; the issue's behaviour |
| `{type: "key", key: "Tab"}` | with the tool on, moves keyboard focus among the parts' anchors | the base's event; the issue's behaviour |
| `{type: "key", key: "Enter"}` | places a point (A, then B) at the focused anchor | the base's event; the issue's behaviour |

### The app: what is read

Every `input` reply's `state` and the `scope` call's `state` (#383's scope state) gain **`measure`** *(chosen: where it
is read; its fields are the issue's Session state)*:

```json
"measure": {
  "on": true,
  "a": {"item": "column", "point": [0, 0, 0]},
  "b": {"item": "column", "point": [0, 5, 0]},
  "snap": 8,
  "precision": 2,
  "readout": {"distance": "5.00 m", "run": "0.00 m", "rise": "5.00 m"}
}
```

- `on`, `a`, `b`, `snap`, `precision`: the issue's Session state. `a` and `b` are `null` or absent until placed. `item`
  is the picked item's ID; `point` is in the document's world frame, in m as drawn (#1976's `hit.point`), never divided
  by a scale.
- **`readout`** *(chosen: the key and its shape; the three numbers and their text are the issue's)*: what the overlay
  shows once A and B are placed. `distance`, `run` and `rise` are each the text shown, a number at `precision` decimals,
  one space, and a unit: `"5.00 m"`, `"0.00 m"`, `"2.00 mm"`. The tests compare text after collapsing white space of any
  kind (U+00A0 and U+202F included) to one space. With A and B on parts drawn at different scales, none of the three is
  a string and **`why`** *(chosen)* is a sentence that holds each scale as a number in digits: for `shown_at` 1000 and 1,
  both `1000` (group marks allowed: `1,000`) and `1` appear in it as numbers of their own. `readout` is `null` or
  absent with fewer than two points.
- `state.focus` (the base's Tab stop with focus): with the tool on and an anchor focused, **`"<item>#<anchor>"`**
  *(chosen: the design's sub-address)*, such as `"plinth#top"`.
- `state.selection` and `state.details` (the base's): a click the tool takes leaves them as they were.

The app's other readings are the base's own: `track` (`{doc}` → `{track, hash, fork_at}`, #1164), `eval` with
`data_hash: true` (#222), `export` with `video.codec: "png_seq"` (`receipt.frame_hashes`, #501), `geometry` (`{doc,
items}` → each builder's `positions`, `indices` and `anchors: {name: {pos}}`, #420), and `scope`'s `state.camera`.

### The web player

| Surface | As the tests use it | Whose word |
|---|---|---|
| `<deep-player>` member **`measure`** | a boolean property the element has before anything sets it (`'measure' in player`): `player.measure = true` turns the tool on in a piece that offers it, as a viewer's setting (Export: web player: a host "may also drive a `<deep-player>` as a viewer would", "all of it is viewer input held in session state"); reading it gives whether it is on | *(chosen)* |
| clicks | real mouse presses and releases on the player's `<canvas>` (DevTools `Input.dispatchMouseEvent`, left button), at the canvas's client rect scaled from frame px | the browser's; the issue's behaviour |
| `probe().measure` | the same object as the app's `state.measure`, field for field | *(chosen: where; Export: web player: every check of the player reads it through `probe()`)* |

The player is #172's (`index.html` with one `<deep-player>`, `ready`, `probe()`), exported by `{call: "export", doc, out,
video: {codec: "web"}}`. The committed player under `crates/deep-player/web/dist/` must be rebuilt with the tool
(`node scripts/player-wasm.mjs`); the export embeds it.

### Planted programs (the scenario's `planted`, reachable only there) *(names chosen)*

| Name | The wrong program | Criterion | The test fails |
|---|---|---|---|
| `measure_ignores_shown_at` | the readout is computed from the drawn points alone, never divided by a part's `shown_at`, and never refuses two scales | 2 | the part reads `2.00 m`; the measure across two scales reads a number |
| `measure_writes_entry` | each point the tool places also appends an entry to the document's input track | 4 | the input track's hash differs from the run with the tool off, naming the entry |

At the base each name makes the scenario `bad_input`. `twins.json` maps each criterion to its planted program.

### The taste call *(names chosen)*

`ac7-taste.test.ts` writes `docs/evidence/1217/measure-app.png` (`deep-show screen` at the reference window, 1512 × 982
points at 2×) and `docs/evidence/1217/measure-web.png` (the web player's page at 1512 × 982 CSS px, device scale 2,
captured by the browser), and reads `tests/acceptance/1217/TASTE.json`, which only a person's recorded answer adds:

```json
{"issue": 1217, "criterion": "#1217.a0c92377", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"measure-app.png": sha256, "measure-web.png": sha256}, "note"?: string}
```

No file, or a call on other SHA-256s, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly this run's
two pictures passes. No other test reads a picture.

## What was read

- The issue as saved (`issue-1217.md`, `issue-1217-body.md`): criterion IDs computed from the body with
  `scripts/proof-change.mjs`'s `criterionId`.
- `docs/canvas-primitives.md`: Selection (session state) (the measure tool's sentences, `hit`, `hit.margin`); Cutaway
  `cutaway@1`; Units and axes; Export: web player; Assembly (`shown_at`); Honest numbers; Builder (`anchors`); Item and
  kind (`role`, `at.anchor`); ID and sub-address; Scope and input classes; Input router, focus and gesture serial;
  Render-back; Determinism; Recipe and Curve (anchors). `docs/technical-design.md`: One way to interact, in every
  scene; Who drafts it; Proven on the base; Criteria to tests; Wrong programs; Dogfooding; Tests written first; The
  reference window. AGENTS.md, CONTRIBUTING.md.
- At the base, for call shapes only: `crates/deep-show` (`main.rs`'s calls and planted table, `input.rs`, `points.rs`,
  `played.rs`, `track_call.rs`, `data_hash.rs`, `geometry.rs`, `export.rs`, `export/run.rs`, `export/web.rs`,
  `window.rs`, `ring.rs`'s router), `crates/deep-canvas` (`scope.rs`, `lengths.rs`, the envelope's keys),
  `crates/deep-canvas-scene3d` (`hit.rs`, `cut.rs`, `builders.rs`'s lathe, slab and anchors, `geom.rs`),
  `crates/deep-canvas-input/src/track.rs`, `crates/deep-player` (README, `web/element.js`), `scripts/lanes.mjs`,
  `scripts/proof-runs.mjs`; and the suites `1976/`, `424/`, `1183/`, `540/`, `539/`, `504/`, `1897/`, `169/`, `172/`,
  `1045/`, `1041/`, `2691/` for conventions. Helpers are copied in part from `169/`, `172/` and `540/`, since suites
  don't import each other.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and the fixtures.

## What the base already does, and these tests don't credit

`deep-show` presents 3D scenes, takes clicks, keys and control events into a panel's scope (a click selects, Tab walks
controls, Esc backs out), names the item under a 3D click from the object-ID target and meets it on the CPU in f64
(#540's point control, #1976's hit path, which keeps only what a cutaway keeps, so a ray through a cap lands on the
geometry behind it), records `shown_at` on an assembly (#1183), hashes its input track and evaluated data, exports
frames with a GPU hash each, with no session state in them (#501), and exports a web bundle whose player replays the
recorded track and takes no input from the viewer (#172). There is no `viewer_tools`, no measure setting, no point
placed, no snap, no readout, no anchor Tab stops and no `measure` on `probe()`, and neither planted name. So every test
fails at the base, at its first assertion on the new behaviour: the document that offers the tool is refused
(`unknown_field` at `viewer_tools`), and each planted name is `bad_input`. `BASE-FAILURE.txt` gives each test's failing
line, what the fixtures were seen to do on the base with the field taken out, and what each test would meet next.

## Run them

Put Node 24 and cargo on PATH; in a fresh worktree run `npm ci` and `npm run build --workspaces` once; then one file at
a time:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
for f in ac1-column ac2-scale ac3-cap ac4-session ac5-keyboard ac6-web ac7-taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs test --wait 120 -- \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/1217 --no-file-parallelism --testTimeout=3600000 $f.test.ts
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1217/tsconfig.json   # type check
rm -rf tests/acceptance/1217/node_modules                                       # vitest's cache after a --root run
```

Each file builds `deep-show` (`full`) once in `beforeAll` and copies it out of `target/` (honouring
`CARGO_TARGET_DIR`). Every test and hook passes its own timeout; none reads a timing or the machine's load. Temporary
folders are removed after each test; the server is a child process and Chrome runs in a process group of its own, each
stopped by its PID; nothing is stopped by name or port. `lane.json` says the folder runs alone.

Gates, none ever a pass: off macOS, or where the machine draws no 3D, a test fails `INCONCLUSIVE:`; without Google
Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), when Chrome opens no DevTools port within 60 s, or when
the player isn't ready and Chrome offers no WebGPU adapter, a browser test fails `BLOCKED:`; criterion 7 is
`INCONCLUSIVE:` until `TASTE.json` records the call on this run's pictures.

## Criteria to tests

IDs are `#1217.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed.
Each `describe` and test title starts `AC<n> #1217.<id>`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 1 | `#1217.727f50dc` | `ac1-column.test.ts` (1) | The column, 5.000 m tall, seen from inside so one pose shows both caps: clicks 4.5 px off the projections of the bottom and top caps' centres place A and B on the centres within 1e-5 m (each a vertex of the built mesh, read from `geometry`), and the readout is distance `5.00 m`, run `0.00 m`, rise `5.00 m`; the selection and the open card are untouched. Fails on: the base; no snap, or a point from the pixel's centre or from depth (run reads `0.08 m`); run and rise swapped or taken along another axis; a click that selects |
| 2 | `#1217.a1a883c2` | `ac2-scale.test.ts` (2) | A part drawn 2 m across under an assembly at `shown_at: 1000`: clicks near the midpoints of its two end edges read distance `2.00 mm`. A third click starts again on that part and a fourth lands on a part at `shown_at: 1`: no number, and `why` names 1000 and 1. The planted `measure_ignores_shown_at` fails, naming `2.00 m`. Fails on: the base; a readout in the drawn length; a number across two scales; a reason that names no scale |
| 3 | `#1217.21c1b4f7` | `ac3-cap.test.ts` (1) | A closed cube cut by a view cutaway at x > 0.25 with a cap, seen along −x: a click on the cap, 90 px from any vertex or edge midpoint, places A on the cube with its point within 1e-5 m of the plane x = 0.25 and of where the click's ray meets it. Fails on: the base; the point on the wall behind the cap (1.25 m off the plane); a point pushed onto the plane from the wall behind |
| 4 | `#1217.582db303` | `ac4-session.test.ts` (2) | One recorded session played twice, once with the tool turned on and once with it turned off, the same inputs otherwise: two entries on a document slider, four clicks, Esc, a click. With the tool on: A, B and a readout of `1.00 m`; a third click starts again (A placed, B empty); Esc leaves neither; the next click places A. Then the two runs' input track hashes are equal (two real entries each), their evaluated data hashes are equal at five times (and differ across each entry), and their exports' frame hashes are equal (24 frames, three kinds). The planted `measure_writes_entry` fails, naming the entry. Fails on: the base; Esc that clears one point; a third click that moves B; a tool that writes an entry, a value or a pixel |
| 5 | `#1217.bf9688c3` | `ac5-keyboard.test.ts` (1) | Two parts, no pointer event in the scenario: Tab presses reach `<part>#<anchor>` for every anchor `geometry` reports of each part; Enter on one part's anchor and Enter on the other's place A and B on those anchors within 1e-5 m and read the distance between them. Fails on: the base; Tab that skips an anchor or a part; Enter that places nothing; a distance between other points |
| 6 | `#1217.628255fc` | `ac6-web.test.ts` (1) | The column's web bundle in headless Chrome with WebGPU (`backend` names WebGPU): `measure = true`, the same two clicks on the canvas, and `probe().measure.readout` is the app's three texts from the same scenario and the issue's `5.00 m`, `0.00 m`, `5.00 m`; A and B are the app's within 1e-5 m. Fails on: the base; a player that takes no click; another point or number than the app's |
| 7 | `#1217.a0c92377` | `ac7-taste.test.ts` (1) | Makes a measure on the column from outside in the app and in the web player at the reference window (checked by the replies, not by a picture), writes the two pictures, prints their SHA-256s, and reads `TASTE.json` (The taste call). Never passes on its own |

Test count: 1 + 2 + 1 + 2 + 1 + 1 + 1 = 9.

## Fixtures

All made at test time in `helpers.ts`, truth by construction; no file on disk, no personal data; CC0. Metres, +Y up.
Every solid is a trusted builder (`lathe@1`, `slab@1`) of `role: part` with a lit, double-sided `material@1`, under a
sun and a sky. Before it reads the tool a test reads each part's built mesh through `geometry` (item space, placed here by the
fixture's own `at.pos`) and checks the fixture: the snap target is a vertex or an edge's midpoint of that mesh within
6 px of the click, and no other vertex or edge midpoint of any part projects within 16 px (twice `snap`) of it, so
the reading doesn't turn on which candidates a snap looks at. Every click lies inside one triangle of the face it is
on, off its edges. On the base, with `viewer_tools` taken out, every fixture is presented and passes these checks.

- **The column** (criteria 1, 6, 7): `column`, a `lathe@1` of outline `[[1.25, 0], [1.25, 5]]`, 16 segments, flat
  caps: a cylinder 5 m tall whose caps are fans about a centre vertex at (0, 0, 0) and (0, 5, 0). *Inside view*
  (criteria 1 and 6), 800 × 800: the eye at (−1, 2.5, 0) looking along +x, fov 150°, so the top cap's centre projects
  at (400, 132.05) and the bottom's at (400, 667.95); the clicks are at +(4, 2) and −(4, 2) px from them, where an
  unsnapped ray meets the caps 3.8 cm from each centre (run 0.08 m). No single pose outside a column sees the faces of
  both its caps, and the base's web player takes no orbit, so the fixture looks from inside. *Outside view*
  (criterion 7), 1512 × 982: the eye at (12, 9, 0) looking at (0, 2.5, 0), fov 40°; the clicks are 5 px from the top
  cap's centre and from the base ring's vertex at (1.25, 0, 0), a measure of √(5² + 1.25²) m, `5.15 m`.
- **The scaled parts** (criterion 2), a figure of 800 × 600: assemblies `micro` (`shown_at: 1000`) and `bench`
  (`shown_at: 1`); `chip`, a `slab@1` of size [2, 1, 1] at (−1.5, 0, 0) in `micro` (2 m drawn across, 2 mm real), and
  `block`, a `slab@1` of size [1, 1, 1] at (1.75, 0, 0) in `bench`; the eye at (0, 5, 7) looking at (0, 0.5, 0), fov
  40°. The clicks are 5 px inside the midpoints of the top face's end edges: (−2.5, 1, 0) and (−0.5, 1, 0) on `chip`,
  2 m apart, and (1.25, 1, 0) on `block`.
- **The cut cube** (criterion 3), 800 × 600: `solid`, a `slab@1` of size [2, 2, 2] at the origin, and `cut`, a
  `cutaway@1` of one plane, normal (1, 0, 0), offset 0.25, `cap: "accent"`, class view at its declared default; the eye
  at (6, 1, 0) looking at (0, 1, 0), fov 40°. The click is at the projection of (0.25, 1.45, 0.3), on the cap.
- **The recorded session** (criterion 4), 640 × 480, 4 s at 6 frames a second: `post`, a `slab@1` of size [1, 2, 1] on
  the origin, and `marker`, a `slab@1` of 0.5 m at (2.5, 0, 0) whose height above the ground a driver reads from the
  document-class slider `lift` (`items/marker/at/pos/1 = h`); the eye at (4, 5, 6) looking at (0.5, 1, 0), fov 40°;
  entries `lift = 0.5` at 1 s and `lift = 1.5` at 2.5 s; the clicks are 5 px inside three corners of `post`'s top
  face, (0.5, 2, 0.5), (−0.5, 2, 0.5) and (0.5, 2, −0.5).
- **The two parts** (criterion 5), 800 × 600: `plinth`, a `slab@1` of size [1, 1, 1] at (−2, 0, 0), and `beam`, a
  `slab@1` of size [1, 2, 1] at (2, 0, 0); the eye at (0, 4, 9) looking at (0, 1, 0), fov 40°.

## Readings where the issue and design leave a choice

- **"The app"** is `deep-show`: its `run` scenarios for what the tool reads, its `screen` for the picture.
- **"With snapping, clicks on the centers of its top and bottom caps"**: clicks a few px off the centres' projections,
  inside `snap` (8 px), which a snap moves onto the centre vertices; an exact hit there reads another run. "Reads" is
  the readout's text, `5.00 m`, `0.00 m` and `5.00 m`, at the default precision 2.
- **"2 mm real across, reads 2.00 mm"** is the readout's distance between the midpoints of the part's two end edges.
  The unit a zero run or rise takes isn't given, so only the distance is read there. **"Reads no number and names both
  scales"**: none of the three is text, and the reason holds 1000 and 1 as numbers.
- **"A cutaway"** is a `cutaway@1` item, class view, at the planes the document declares (Scope and input classes: a
  view setting the document declares with a default). **"On the cap plane within 1e-5 m"** is |n · p − offset| ≤ 1e-5;
  the test also holds the point to the click's ray (Scope: "the exact hit"), so a point moved onto the plane from the
  wall behind doesn't pass.
- **"A recorded session … with the tool used and unused"**: the same inputs in both runs, the setting `true` in one and
  `false` in the other. The base stamps each entry with its gesture's serial, which counts every input, so a run with
  fewer inputs would differ by hash for that alone. **"Every evaluated data hash"** is `eval`'s `data_hash` at 0 s,
  0.5 s, 1.5 s, 3 s and 3.9 s. **"An export's pixel hash"** is every frame's GPU hash, `receipt.frame_hashes`.
- **"Tab reaches each part's anchor"**: the anchors are the ones the builder returns (Builder: `anchors: {name →
  frame}`), read through the base's `geometry` for each `role: part` item; the design names no anchor of a slab, so no
  name is assumed. Other stops may sit between them. **"Two Enters read the distance"**: Enter on an anchor of one part,
  Tab to an anchor of the other, Enter; the distance is between the anchors' world points, from `geometry`'s `pos` and
  the item's `at.pos`.
- **"The same two clicks … the same three numbers as the app"**: the same fixture and frame points as criterion 1, the
  app's readout made again in the same test.
- **"At the reference window"**: 1512 × 982 points at 2× for both pictures; the web player's page is the bundle's index
  page with its canvas filling a 1512 × 982 viewport.

## Not asserted, because no criterion says so

That a document without `viewer_tools.measure` can't turn the tool on; the values of `snap` and `precision` and their
change; the overlay's line, points and readout as drawn (criterion 7 shows them); the unit of a zero length; run and
rise at another scale than 1; a geo placement's `geo_km`; hover; the tool in a film or a golden; a drag with the tool on;
orbit in the web player; Tab and Enter in the web player; the fallback page; the accessibility tree's node for the
readout; areas, angles and paths (not in scope); the depth-buffer measurer (#1976's suite).

## What the implementer adds outside this folder

- `deep-show`: the document key, the scope's `measure`, the two planted names (`crates/deep-show/src/main.rs`'s planted
  match), and the overlay in `screen`. The web player's member and `probe().measure`, with `crates/deep-player/web/dist/`
  rebuilt.
- Nothing in `scripts/lanes.mjs`: `lane.json` here says the folder runs alone.
- `docs/evidence/1217/` holds the two pictures a run writes; `tests/acceptance/1217/TASTE.json` is added only to record
  a person's answer.

## Files

- `helpers.ts`: the build, the scenario, the calls, the fixtures, the references (pinhole, snap candidates, text), the
  server and the browser.
- `ac1-column.test.ts`, `ac2-scale.test.ts`, `ac3-cap.test.ts`, `ac4-session.test.ts`, `ac5-keyboard.test.ts`,
  `ac6-web.test.ts`, `ac7-taste.test.ts`.
- `twins.json`, `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
