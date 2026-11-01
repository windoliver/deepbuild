# Acceptance tests for #140, view group: display timing, glyph runs, accessibility, live against headless, backends on results, render-back, the doctor's canvas verdict, locale

Written first, from issue #140 ("Canvas platform seams: one interface per platform part, macOS backends first,
each with its conformance suite"), its oracle page (`doneright/oracles/issues/140.md`: no upstream test for any
criterion here), the design sections it links and those they lean on, and base commit `f41a5b3e` ("Merge pull
request #888 …"), by a job that never saw an implementation; none existed. This folder holds the issue's criteria
**2, 3, 4, 6, 7, 8, 10 and 15**. Two other blind jobs write criteria 1, 5, 9, 11, 16, 17, 19, 20, 21, 22 (`gpu`)
and 12, 13, 14, 18 (`platform`) in `tests/acceptance/140/<group>/`. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: How it installs (the seams: the GPU backend, display timing "the display link
  through GPUI on macOS … canonical renders never read the display clock", fonts "bundled fonts only … with
  parley's system feature off, so CoreText, fontconfig and DirectWrite are never reached", accessibility "one tree
  per document through AccessKit", color, headless rendering "wgpu offscreen on each backend plus Vello CPU";
  each backend "a canvas module, chosen at build time, and its name and version enter every content key and result
  it feeds"; the per-seam suites: "predicted presentation within one refresh at 60 and 120 Hz; identical glyph runs
  on every platform; the same accessibility tree as data plus a screen-reader smoke test; … a headless snapshot
  that matches the settled live view on one machine"); How we know version 0 works (the canvas line; the parity
  suite; the perceptual oracle "written as reviewed test code"; the blank guard; "every pixel and any small window
  bounded too"); Numbers version 0 has to hold (the canvas row; five runs after warm-up; the reference Macs);
  Hooks are evidence; Dogfooding.
- `docs/canvas-primitives.md`: Seam and backend (and its device classes); Frame clock and scheduler ("Idle: 0
  frames and 0 wakeups as the target, with wakeups reported"; "evaluates every session at the predicted
  presentation time"); Frame callback and presentation feedback (`presented_at_ns`, `refresh_ns`); GPU surface
  (internal scale, upscale, "canonical renders run at scale 1"); Render worker; Render-back (request `{doc, rev,
  t, size, camera, include}`, reply `{rev, …, snapshots: [{sha256, w, h}]}`, "Snapshots render in a headless canvas
  worker on the same core, so they work with the app closed, and 2D snapshots render with Vello CPU", the settled
  rule, the visible item table); Replica `deep_drive` (`launch.locale`; "the replica's text snapshot … equals the
  live app's accessibility tree"); Document (`locale: BCP 47 = en`); Text `text@1`; Bound value (`format.group:
  none | locale = locale`); Canvas module; Registry and seal; Meter and degrade ladder; Liveness and recovery.
- The base: `crates/deep-show` (`run`, `screen`, `live`: #376's screen-reader window; `see`; `deep_show` with
  `include: pixels`), `crates/deep-gpu-layer` (`deep-gpu run` and its calls), `crates/deep-marks-render`
  (`deep-canvas-render raster | render | session | check`, #381's `texts`), `crates/deep-text`, `crates/deep-replica`
  (`deep-live`), `packages/hub/src/doctor.ts` and `packages/cli` (`deep doctor --json`, `doctor.item@1`),
  `scripts/text-lint.mjs`, and the suites `377/`, `376/`, `380/`, `381/`, `391/`, `392/`, `393/`, `400/`, `105/`,
  `19/doctor/` for conventions.

What the base already does and these tests don't credit: `deep-canvas-render raster` draws a document with Vello
CPU and reports each text item's glyph run (#381) and formats a bound value with en grouping (`1,234.5`);
`deep-show run` presents documents, answers `see` with the accessibility tree as data (#376) and takes render-back
snapshots through `deep_show`'s `include: pixels` (#393); `deep-show live` opens a real window with #376's
AccessKit tree and holds it for a person; `deep-gpu run` draws GPU-layer views headless (#377–#380); `deep doctor`
lists the hub's and the agents' items (#19). The canvas text and marks crates' trees already reach no system font
library (#381). There is no `backends` on any result, no `texts` from the app's GPUI frame, no document locale in
number formatting, no `live` options, no `render_back` call, no `live_frame` or headless worker in `deep-gpu`, no
canvas items in the doctor.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run --root tests/acceptance/140/view --no-file-parallelism
npx tsc -p tests/acceptance/140/view/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds each binary it uses, once per feature set (`cargo build --locked --bin <bin> [--features
…]`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`), copies it out of `target/debug` under its own name
into a temporary folder, and fails each test that uses a build that failed. `doctor.test.ts` builds the
workspace's binaries (`cargo build --locked --workspace --bins`) and, when `packages/cli/dist/main.js` is missing,
the CLI (`npm run build --workspaces`). Each test writes into its own temporary folder and deletes it. The tests
use node built-ins and vitest. A run with `--root tests/acceptance/140/view` may leave Vitest's cache in
`tests/acceptance/140/view/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

`scripts/lanes.mjs` needs this folder in both unit-lane lines, as #377's: `--exclude tests/acceptance/140/view/**`
on the parallel vitest line (it comes from the `alone` list) and `tests/acceptance/140/view/` in `alone`, the
one-at-a-time list, since the files build cargo binaries and open real windows. This README is the instruction;
the implementer makes that edit.

**Windows on screen.** `timing.test.ts`, `access.test.ts` and `renderback.test.ts` open the app's real, shown
window on the Mac's display (`deep-show live`), as #376's proof run does; they need a logged-in session with a
display. A binary that can't show a window answers `{"ok": false, "code": "no_display"}`, which the tests report
as INCONCLUSIVE, never a pass. Nothing needs Screen Recording or Accessibility permission: the app reads its own
window's accessibility tree in process.

**The reference Mac.** `parity.test.ts` counts only on a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off,
thermal state nominal; #377's gate) and is INCONCLUSIVE anywhere else (the criterion: "On the reference Mac").
`timing.test.ts`'s pacing test is judged anywhere a 120 Hz display is; when it misses on a machine that isn't a
fit reference Mac or is loaded (a 1-minute load average above half the cores), it is INCONCLUSIVE with every
miss attached, never FAIL; when it holds, it passes. Nothing here is a budget: the issue's budgets (criterion 18)
are the platform group's.

### The live runs (a person)

The VoiceOver half of criterion 4 runs only with `DEEP_140_LIVE=1`, at the reference Mac, with VoiceOver on (⌘F5)
and "Allow VoiceOver to be controlled with AppleScript" on in VoiceOver Utility; anywhere else, or with either
missing, the test fails as INCONCLUSIVE naming what's missing, never a pass or a skip (#105's pattern). It shows
the figure in the app's window, walks VoiceOver's cursor through it (`tell vo cursor to move right`, 16 times),
changes the readout from 3 to 4 at 15 s, and reads what VoiceOver said through `content of last phrase`.

```sh
DEEP_140_LIVE=1 npx vitest run --root tests/acceptance/140/view access
```

## The surface under test

The issue names seams, backends with a name and a version on every result, conformance suites, the doctor's
canvas items and verdicts, one scene path (`parity/gpu/live-headless.scene`), a planted one-code shift and a
planted formatter, but no binary, call or field. So these tests extend the binaries the base already proves the
canvas through, in their own conventions (JSON lines in, one line out per line in, `bad_input` for what can't be
read, `--planted` or a `planted` field for the wrong programs), with the smallest set of fields and calls the
criteria need. No new binary.

### Backends on every result (criterion 7)

Every result the canvas hands back carries `backends: {seam → {"name": string, "version": string}}`, one entry
per seam whose backend fed it; a seam is one of the issue's thirteen (`gpu`, `surface`, `display`, `fonts`,
`accessibility`, `input`, `color`, `codecs`, `audio`, `capture`, `cpu`, `headless`, `network`). The tests read it
on these results and require at least these seams:

| Result | Where | Seams it must name |
|---|---|---|
| a headless raster | `deep-canvas-render raster`'s answer line | `fonts`, `headless`, `cpu` |
| the app's frame | `deep-canvas-render render`'s answer line | `fonts`, `cpu` |
| the app's session | `deep-canvas-render session`'s answer line | `fonts`, `cpu` |
| a deep_show reply | `deep-show run`'s `deep_show` reply | `fonts`, `cpu` |
| a render-back reply | `deep-show run`'s `render_back` reply (below) | `fonts`, `headless`, `cpu` |
| a GPU snapshot | `deep-gpu run --headless`'s `snapshot` record (below) | `gpu`, `fonts`, `headless`, `cpu` |

`cpu.name` is the machine's architecture as Rust names it (`aarch64` here); `gpu.name` contains `metal` on macOS
(the issue: "wgpu on Metal").

**`deep-canvas-render --features test-fonts-next`**: a build whose `fonts` backend is the same backend (the same
`name`, the same bundled font files) at its next `version`, and nothing else changed; no shipped build has it.
Its results name that version, and the content key of every cache entry the fonts backend keyed (the `text`
entries of `session`'s `caches`, #391) changes with it.

### `deep-canvas-render` (criteria 3, 7, 15)

- **`render`** (the app's GPUI frame path, #391/#392) answers `texts` exactly as `raster` does (#381: `{item ID:
  {"shown": string, "glyphs": [Glyph]}}`, Glyph `{font, size, id, x, y, grapheme, role}`), for the document's
  text items, at any `view.zoom`: a glyph run is in document units, so the same document gives the same runs at
  zoom 1 and 2.
- **`raster`** takes `readings` (`{handle → number}`, as `render` and `frames` take it) for bound values, and
  `planted: "reads_process_locale"` (below).
- **Number formatting.** A bound value's `format: {"precision": n, "group": "locale"}` writes its number with the
  grouping and decimal marks of the document's `locale` (BCP 47; `en-US` writes `1,234.5`, `de-DE` writes
  `1.234,5`), or the view's where a view sets one, never the process's (`LANG`, `LC_ALL`, `LC_NUMERIC`).
- `session` and the rest are #391's; their answers gain `backends`.

### `deep-show live`: the `live` options (criteria 2, 4, 8)

`deep-show live` reads the `run` scenario (#393, #376: `evidence`, `sessions`, `processes`, `panels`, `docs`,
`window`, `clock`, `calls`, …). With a `live` object in the scenario it plays the calls, opens the app's real,
shown window on the main display drawing the first document's panel as `screen` draws it, does what `live` asks,
answers one line and exits 0, without #376's hold for a person. Without `live` it is #376's run, unchanged.

```json
"live": {"pace_hz"?: 60 | 120, "watch_from"?: "first_frame" | "settled", "watch_ms"?: n,
         "tree"?: true, "after"?: [{"after_ms": n, "call": Call}], "hold_ms"?: n}
```

- `pace_hz`: the rate the window's display link paces its frames at (the display seam's macOS backend: the
  display link through GPUI; on a ProMotion display both rates are the display's own); without it, the display's
  rate.
- `watch_from`, `watch_ms`: record the frames presented and the wakeups the frame clock scheduled for `watch_ms`
  from the window's first presented frame (`first_frame`) or from the moment the document's frame settled and the
  frame clock went idle (`settled`).
- `tree: true`: once the document is presented and settled, read the window's accessibility tree back through
  NSAccessibility, as an assistive client reads it (the elements under the window, depth first), and answer it.
- `after`: each call is played while the window shows, `after_ms` after its first presented frame (a call's `at`
  orders it on the virtual clock after the scenario's calls); `hold_ms`: how long the window stays open from its
  first frame (at least until the watch and every `after` call are done).

Answer `{"ok": true, "replies": [Reply], "live": Live}`, the scenario's replies as `run`'s, and:

```json
Live: {"display": {"uuid": string, "refresh_hz": n, "max_refresh_hz": n},
       "frames": [{"frame_seq": n, "rev": n, "predicted_ns": n, "presented_ns": n, "refresh_ns": n}],
       "wakeups": n,
       "tree": [{"id": string, "role": string, "subrole"?: string, "name": string, "value"?: string}],
       "after": [{"after_ms": n, "showing": {doc ID → rev}, "presented": n, "reply": Reply}]}
```

- `frames`: every frame the window presented within the watch, in order; `predicted_ns` is the presentation time
  the frame clock predicted at the frame's latch and evaluated the frame at, `presented_ns` the time the display
  seam's presentation feedback measured it presented at (on macOS, the drawable's presented time), both on the
  host's monotonic clock in ns; `refresh_ns` the pacing period (1e9 ÷ the paced rate). A discarded frame isn't
  listed.
- `wakeups`: every wakeup the frame clock scheduled within the watch: each display-link callback it asked for,
  each timer it armed and each frame it armed.
- `display.max_refresh_hz`: the most the main display can refresh at (120 on the reference Mac's).
- `tree`: one row per element with a non-empty `accessibilityIdentifier`: `id` that identifier (AccessKit's
  `author_id`: the item or control ID), `role` and `subrole` its `accessibilityRole` and `accessibilitySubrole`,
  `name` its `accessibilityLabel`, `value` its `accessibilityValue` as text.
- `after`: one entry per `after` call: the revision of each document the window was showing when the call ran,
  how many frames of it the window had presented, and the call's reply.

A machine where no window can be shown answers `{"ok": false, "code": "no_display"}`.

### `deep-show`: the `render_back` call (criteria 7, 8)

`{"call": "render_back", "session", "doc", "rev", "t"?: time, "size"?: [w, h], "camera"?, "include": ["pixels"],
"at"}`: render-back's request on a revision that exists (Render-back: Request), without a new revision. Reply
`{"rev", "outcome": "presented" | "not_presented", "reason"?, "snapshots": [{"sha256", "w", "h"}], "backends"}`,
each snapshot a PNG of `w` × `h` in the evidence store (#393's layout), taken by the headless canvas worker, the
same in `run` (no window) as in `live`'s `after` (the window showing the document).

### `deep-gpu`: the live-headless calls (criteria 6, 7)

- **`deep-gpu run`** (the app) gains `{"call": "live_frame", "scene": path, "case": name, "fault"?: {"holds":
  "fallback_pipeline", "ms": n}, "timeout_ms"?: n}`: the case's document in a live view in the app's window, at
  render scale 1 and internal scale 1 with no upscaling, its frames run until one reports settled; that frame is
  the one recorded. Reply `{"settled": true, "record": Record}`, or, when no frame settles within `timeout_ms`
  (default the implementer's), `{"settled": false, "reason": string}` with no record and nothing written. `fault`
  is #393's fault fixture: for `ms` a pipeline the document draws with stays compiling and its items draw with a
  fallback, so the frame reports settling.
- **`deep-gpu run --headless`** (the headless canvas worker render-back uses) opens no window and holds no app;
  it takes `{"call": "snapshot", "scene", "case"}` → `{"record": Record}`: the same document, revision, view,
  size and t, the GPU layer rendered offscreen and each 2D writer layer drawn by Vello CPU.
- **`--planted shifts_gpu_pixel`** (with `run`): the GPU layer's read-back has one pixel one code value off in one
  channel.

```json
Record: {"case", "doc": sha256, "rev": n, "t": time, "size": [w, h], "view": {…}, "scale": 1, "internal_scale": 1,
         "upscale": "none", "settling": false,
         "evaluated": sha256, "items": sha256, "gpu": sha256 | null,
         "layers": [{"layer": ID, "png": sha256, "edges": sha256,
                     "runs": [{"id": item ID, "kind": "glyphs" | "stroke", "png": sha256}]}],
         "backends": {…}}
```

Files go in the call's `out` folder named by the SHA-256 of their bytes: `<sha>.bin` the evaluated data (the
canonical bytes the frame's evaluation produced), `<sha>.json` the visible item table (Render-back: item IDs with
screen boxes, a JSON array of `{"id", "box": [x, y, w, h]}` sorted by ID) and each layer's edges, `<sha>.png`
images (8-bit RGBA, no interlace, rows top-down). `doc` is the hash of the canonical document (the revision);
`gpu` the GPU layer's pixels (live: read back from its on-screen slot; headless: its offscreen target), `null`
for a document with no GPU layer; `layers` every 2D writer layer, each drawn alone over transparent black at
`size` (live: by GPUI; headless: by Vello CPU), `edges` every edge that layer draws, flattened, as a JSON array of
segments `[x0, y0, x1, y1]` in device px, and `runs` each glyph run (a text item's) and each stroke (a path's) it
draws, alone, as a coverage mask whose alpha is the coverage.

### `parity/gpu/live-headless.scene`

JSON: `{"scene": "live-headless", "cases": [{"case", "doc", "look", "size", "t", "view"}]}`, paths relative to the
scene file. Three cases: `figure-2d` (#376's lens figure with a stroked pair of rays: 2D only, glyph runs
`caption` and `count`, stroke `rays`), `scene3d-glow-shadows` (#380's lamp box on a floor under a sun with
`shadow: true` and the look's bloom (the glow) on, generated once from #380's `effectScene(['glow', 'shadow'])`,
plus a 2D `notes` layer: glyph run `note`, stroke `rule`, a dot) and `film-frame` (a four-second film of a block
sliding along a stroked arc under a title, at t = 1.25 s: glyph run `title`, stroke `arc`). `look-2d.json` is a
role map `{light, dark}` as `deep-canvas-render` takes it; `look-3d.json` is #380's acceptance look with bloom on.

### `deep doctor`'s canvas items (criterion 10)

`deep doctor --json` lists, beside #19's items, the canvas's: `doctor.item@1` objects (`{item, agent, code,
level, evidence, fix}`) whose `item` starts with `canvas.`. The tests read three:

- `canvas.gpu`: the GPU adapter and its tier's feature table: its `evidence` names the adapter as macOS names the
  chip (`sysctl machdep.cpu.brand_string`, "Apple M3 Pro" here) and each feature of the tier's table, granted or
  absent; the tests look for the design's features by name (pass timestamps, depth-clip control, ray queries,
  MSAA counts).
- `canvas.verdict`: the canvas verdict. Healthy: `code: healthy`, `level: ok`, its evidence saying the fixture
  rendered headless within its golden. Unhealthy: `level: fail`, and a failed canvas finding whose `fix` holds a
  command an agent can run, in backticks. Unverified: `code: not_checked` (or a new code `unverified`), `level:
  skip`, the word "unverified" in its code or evidence; never `healthy` or `ok`.
- **`DEEP_DOCTOR_CANVAS_FAULT`**, a fault fixture only tests set: `render_fails` makes the headless render fail
  (as a machine whose headless rendering is broken), `render_skipped` skips it. The doctor's canvas items run the
  build's canvas binaries (in a checkout, `target/debug`).

### Planted programs

Each reachable only as named, only for this proof.

| Name | Where | The wrong program | Criterion |
|---|---|---|---|
| `shifts_gpu_pixel` | `deep-gpu run --planted` | the live GPU layer's read-back has one pixel one code value off in one channel | 6 (issue-named) |
| `reads_process_locale` | `deep-canvas-render raster`'s `planted` | the number formatter takes its grouping and decimal marks from the process locale | 15 (issue-named) |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading
`- [ ] ` dropped (#377's method, over the issue's 22 criterion lines). Each test's name starts with `#140.<ID>
(C<n>)`.

| ID | Criterion | Tests |
|---|---|---|
| `#140.81e434c9` (C2) | Predicted presentation lands within one refresh of the measured one at 60 and 120 Hz, and a still scene schedules zero wakeups over 10 s | `timing.test.ts`: the film in the app's window paced at 60 and at 120 Hz for 3 s each: every presented frame's `presented_ns` within its `refresh_ns` of its `predicted_ns`, `refresh_ns` the paced period, at least half the frames the rate gives, times in order, the measured frames a median period within 10% of the paced one (so the run was at that rate), and `wakeups` at least the frames presented (so the count counts). The figure, once settled: `wakeups` 0 and no frame over 10 s. Surface: `deep-show live`'s `live` options. Wrong programs: the base (no `live`); a prediction that is the latch time or the last vsync; a display link left running while idle |
| `#140.8f5be3c4` (C3) | The same document shapes to identical glyph runs in the app and headless, and no system font library is reachable from the canvas, checked from the dependency tree of the canvas's text and marks crates, which never depend on gpui | `glyphs.test.ts`: the figure, the film at 1.25 s and the locale figure: every text item's glyph run from `render` (the app's GPUI frame) at zoom 1 and at zoom 2 equals `raster`'s (headless, Vello CPU), glyph for glyph, each in its own process, and none is empty. The trees of deep-text, deep-canvas-marks, deep-marks-vello, deep-canvas-scene3d and deep-scene3d-render for every target hold no gpui crate, no system font library (CoreText, fontconfig, DirectWrite, FreeType, font-kit, fontdb, …) and no system-font feature (parley's or fontique's `system`, …); twins adding gpui-kit, core-text, fontconfig, dwrote, font-kit or parley/system each fail, named, and the clean twin passes. The tree half passes at the base (the property holds there; its twins are its wrong programs) |
| `#140.94c6f71e` (C4) | A fixture figure's accessibility tree is equal as data in the app and headless, and VoiceOver names every part and announces a changed readout | `access.test.ts`: the figure's `see` tree (headless) and the app window's tree read through NSAccessibility (`live.tree`), restricted to the document's items and controls: the same IDs in the same order, the same names, each role the NSAccessibility role AccessKit gives the headless role, the same values; every part and control present in both. Live, with a person (`DEEP_140_LIVE=1`): VoiceOver says every part's name and every control's label, and after the readout changes to 4, "Rays: 4" |
| `#140.e2e712fe` (C6) | Live against headless on the reference Mac (parity/gpu/live-headless.scene) | `parity.test.ts`, per case: `live_frame` (the app) then, after it exited, `snapshot` under `--headless`: the live frame not settling, at scale 1, internal scale 1, no upscale; doc, rev, t, size and view equal; the evaluated data and the visible item table byte for byte; the GPU layer (the 3D case) bit for bit and not blank, none in the 2D cases; per 2D writer layer, the interior pixels (farther than 1.5 device px from every edge either side lists) within one code value on at least 99.9%, and per glyph run and stroke the summed coverage within 2% of Vello CPU's and the centroid within 0.1 device px; every expected run compared. `--planted shifts_gpu_pixel`: the same comparison fails with exactly one GPU-layer pixel named, one channel one code apart. A frame held settling (`fault`) is answered not settled, with no record and no file |
| `#140.fabe5dd3` (C7) | Every result names its backends, and a backend with a new version misses the caches it keyed | `backends.test.ts`: the six results above each name their seams with a name and a version, `cpu` this machine's architecture, `gpu` Metal. The `test-fonts-next` build: its raster names the same fonts backend at another version; two runs of the default build key the figure's text cache alike, and no text entry of the new version's is found under a key the old version made |
| `#140.66011009` (C8) | A render-back snapshot taken while the app shows the document has the same pixel hash as the one the headless worker takes with the app closed, for the same revision, view, size and t | `renderback.test.ts`: the figure at 960 × 540 and the film at 1.25 s: `render_back` in `live.after` (the window showing revision 1, at least one frame presented) and in a later `deep-show run` (no window): the same revision and size, and the same pixel hash, read from the evidence store's PNGs, which aren't blank |
| `#140.a4a4b47c` (C10) | On a Mac whose headless rendering works, deep doctor lists the GPU tier's features and gives a healthy canvas verdict after its fixture renders within its golden; with headless rendering forced to fail, the verdict is unhealthy and the finding names a fix an agent can run; with the render skipped, the verdict is unverified, never healthy | `doctor.test.ts`: three `deep doctor --json` runs with a temporary HOME: as is (every canvas item has a level of the four, evidence and a fix; `canvas.gpu` ok, naming the chip and the tier's features; the verdict healthy, its evidence naming the golden); with `render_fails` (the verdict `fail`, not healthy, a failed finding's fix a backticked command); with `render_skipped` (the verdict `skip`, `not_checked`, "unverified", never healthy or ok) |
| `#140.1c7b76f7` (C15) | Locale independence under `LANG=de_DE.UTF-8` and `LANG=en_US.UTF-8` | `locale.test.ts`: the locale figure (a reading of 1234.5 through a bound value with one decimal and the locale's grouping, beside a caption) rendered headless under each LANG (with LC_ALL and LC_NUMERIC the same), for a document locale `en-US` and `de-DE`: under both LANGs the same glyph runs; `en-US` shows `1,234.5` and `de-DE` `1.234,5`, one glyph per character; the caption's run doesn't change with the document's locale. `planted: "reads_process_locale"` fails the same check naming the item `amount`, and under LANG=de_DE.UTF-8 writes `1.234,5` for the en-US document |

Each criterion's proof line ("the list of results with their backends") is criterion 7's run.

## Readings where the issue and design leave a choice

- **"The app" and "headless"** for glyph runs (C3) are the app's GPUI frame path (`deep-canvas-render render`,
  the code that draws a 2D writer layer in the app's window, run on GPUI's offscreen Metal renderer as #391–#393
  run it) and the headless Vello CPU raster render-back uses. For the accessibility tree (C4), the presentation
  timing (C2) and render-back (C8) the app is the real, shown window (`deep-show live`), since what they check is
  the window's: its NSAccessibility tree, its display link, and a snapshot taken while it shows the document.
  For C6 the app is `deep-gpu run`'s window (#377's), whose GPU layer has the on-screen slot the criterion reads
  back; the headless side is a second process started after the first exited, which opens no window: "taken with
  the app closed".
- **"Equal as data"** (C4): the same nodes in reading order with the same ID, name and value, and each role the
  one AccessKit's macOS adapter (accesskit_macos 0.26, the version in Cargo.lock) gives the role `see` reports:
  `part` → `AXImage` (AccessKit `Image`), `label` and `data` → `AXStaticText` (`Label`), `slider` → `AXSlider`,
  `switch` → `AXCheckBox` (subrole `AXSwitch`, not compared). These are the roles the base's `deep-show live`
  already gives parts and readouts. Nodes outside the document's items and controls (window chrome) aren't
  compared.
- **"Within one refresh"** (C2) is |presented − predicted| ≤ the paced period, per presented frame. The run's
  substance is checked too (at least half the frames the rate gives, and a measured cadence within 10% of the
  paced period), so a run that silently paced at the other rate can't pass. "Zero wakeups over 10 s" is counted
  from the moment the still scene's frame settled.
- **"A still scene"** is #376's lens figure, which has no motion; the moving scene is the film.
- **"Misses the caches it keyed"** (C7) is read through the content keys: a cache entry the fonts backend keyed
  (a shaped text run) is keyed differently by the next version, so no lookup by the new version finds the old
  version's entry, while one build keys the same text alike on every run. Entries the fonts backend didn't key
  (tessellations) aren't asserted either way.
- **"Every result"** (C7) is the six results above, one per surface the suite drives; a result fed by a seam
  must name it, and may name more.
- **The perceptual oracle** (C6) is test code, as the design asks: interior pixels are those whose centre lies
  more than 1.5 device px from every edge segment either side lists; "within one 8-bit code value" is per
  channel, alpha included, over the layer alone. The design's per-fixture ceiling for every pixel and bound for a
  small window have no numbers in the issue, so they aren't asserted. Coverage is a mask's alpha ÷ 255 summed;
  its centroid weights each pixel centre by it; "within 0.1 device px" is the Euclidean distance.
- **The planted one-code shift** (C6) fails the bit-for-bit comparison; the test asserts exactly one pixel is
  named and that it is one channel one code apart, so the planted program is what the issue describes.
- **"Healthy … after its fixture renders within its golden"** (C10) is read from the verdict's evidence naming
  the golden; "lists the GPU tier's features" from `canvas.gpu`'s evidence naming the adapter and the design's
  four feature families. "Names a fix an agent can run" is a backticked command in a failed canvas finding's fix.
  "Unverified" follows the doctor's own rule that an item that didn't run reads not checked, never OK.
- **Locale** (C15): "under LANG=…" sets LANG, LC_ALL and LC_NUMERIC alike, so a formatter reading any of them is
  caught. The document's `locale` is a BCP 47 tag (`en-US`, `de-DE`). "Only the document's locale changes 1,234.5
  to 1.234,5" is checked both ways: the process locale changes nothing, and the document's changes the number
  and not the caption.
- **The 2D look** is a role map, not a shipped look, so every role the fixtures paint is defined.

Not tested, because no criterion of this group asks: the doctor's fonts, codecs, audio and outside-tool items;
presentation feedback's `discarded` frames; a view's locale; the accessibility tree's bounds; other seams'
backends' names.

## Upstream tests

The oracle page lists no upstream test for criteria 2, 3, 4, 6, 7, 8, 10 or 15 ("Our seams' own conformance").
