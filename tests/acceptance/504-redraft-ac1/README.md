# Blind redraft of #504's criterion 1: the projectile board

Criterion `#504.2171aba8` (the first 8 hex digits of SHA-256 of its text, `- [ ] ` dropped, trimmed and whitespace
collapsed, as `scripts/proof-change.mjs`'s `criterionId` computes it; checked against the live issue): "A projectile
board with angle and speed sliders and launch, top and landing stages works with no plug-in code per frame".

Written from the issue, its oracle page, the design and base commit `a04378eb2` ("Merge pull request #2190 …") by a job
that never saw an implementation, a diff, another session's work, another branch or worktree, or any earlier draft of
this criterion's test (`tests/acceptance/504*` was not opened; none exists at the base). The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: this one
criterion, one file, four tests.

## What was read

- Issue #504 (`gh issue view 504 --repo windoliver/deepbuild`): its Scope, Fields, nine criteria and Proof line ("A
  recorded session with the projectile board, … and the check that no plug-in code ran per frame"), and its oracle
  page `doneright/oracles/issues/504.md` (DeepBuildAI/deepbuild, branch `doneright`): no upstream test for criterion 1;
  "no plug-in code per frame is our own rule".
- `docs/technical-design.md`: Films and figures on the canvas (591; 593 "Every frame is a function of the time and the
  controls … and no plug-in code runs per frame"; 616 Interactive figures: "closed form where one exists, as for a
  projectile", steps that jump to their own camera pose, "the camera gliding there from where it was"; 740–761 Figures
  that are machines: a readout drawn from the same model that moves the parts); Scenes, physics and the canvas core
  (680; 703 `frame(t) = eval(doc, t)`; 711 agents author documents, and code only as a piece's sandboxed logic; 729 "a
  launch at the angle and speed two sliders set"); Control and input track (1278–1284); Transport (1286–1292);
  Dogfooding and its neighbours (2628–2632, 2652).
- `docs/canvas-primitives.md`: Conventions, paths (41–45); Scope and input classes (60–67); Honest numbers (77–81);
  Document envelope (292–321); Item and kind (323–357, `role: part | control | label | data | decoration`, `name`
  required when pickable); Text `text@1` (1407–1439, `template`); Rect (1515–1531); Circle (1533–1549); Assembly
  (2890–2907); Camera `camera@1`: framing (4503–4519); Shot (4540–4561, `join: cut | glide {span: 0.8s}`, "glide by
  default for a stage's shot", "for a stage's shot the pose at the stage's entry"); Marker and Marker: present mode
  (5303–5340); Driver (5428–5446); Control (5555–5580, `stages: {ID → {label, keys, shot, lit, set, readout}}`, "the
  value is the last input-track entry at or before t … its default's before any entry", "A stage's shot starts at the
  stage's entry and, unless it says `join: cut`, glides there over 0.8 s from the pose shown"); Input track
  (5787–5803); `start_on` and `switch` (5840–5853); The closed function list (6049–6071: `sin cos rad`); What holds a
  document to its rules (8302–8304); Check input (8306–8319); Check input: plug-in reads (8321–8336).
- At the base, to learn surfaces only: `crates/deep-show/src/main.rs` (call parsing: `deep_show`, `registry` 577,
  `sandbox` 605, `eval` 656–679, `deep_query` 313–375 and 712; deep_query's `at` as read times 1421–1443; the scenario's
  `planted`, 1184–1363, where a name the base doesn't know refuses the scenario); `src/hub.rs` (the `Call` enum
  562–851, `Eval`, `Call::Sandbox` 1667, `show` 1997–2260: an error issue refuses the revision); `src/frames.rs`
  (`registry_reply` 103–183: `modules`, `operators` by key with their `module`; `eval` 234–363: `rev`, `nodes` with
  `operator`, `module`, `run`, `steps`, `film`); `src/query.rs` (`rows_reply` 307–363, `read_path` 504–547);
  `src/film.rs` (`block` 217–247: `cameras` by ID, each a pose); `src/access.rs` (readouts); `src/export.rs` and
  `src/mixdown.rs` (`track` on a call, 246 and 66); `crates/deep-canvas-motion/src/doc.rs` (`controls_of` 918–981: a
  stages control's stages each name a `hold` shot; `shot_of`; `driver_of` 1171–1252: vars `controls/<id>/value` and
  `data/<name>`), `src/input.rs`, `src/shots.rs` (`Pose::to_json` 114–121: `target`, `shot`, …);
  `crates/deep-canvas/src/document/check.rs` (`check_controls` 1991), `src/document/rules.rs` (`template_numbers`
  269–305), `src/template.rs` (`value` 75: slots read `data/<name>` only); `crates/deep-canvas-input` (the control
  kinds); `crates/deep-motion/src/main.rs` (`track` and `input` on an eval line); the suites `405`, `405-redraft-ac4`,
  `411`, `417`, `489`, `493`, `501`, `544`. Every expected value comes from the issue, the design and a projectile's
  closed form.

The worktree was made at `ba3bb543` (origin/main by then) and was moved to `a04378eb2`, the base this job was given,
before any design or code was read and before anything was written; none of the commits between them names #504.

## Run them

The file builds `deep-show` and runs six `deep-show run` processes, so it runs one file at a time. The implementer adds
this line to `scripts/lanes.mjs` (this README is the instruction; this job edits nothing outside its folder):

```js
// #504's criterion 1 runs from its blind redraft: it builds deep-show with the full set and runs the projectile board.
alone.push('tests/acceptance/504-redraft-ac1/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/504-redraft-ac1 --no-file-parallelism
npx tsc -p tests/acceptance/504-redraft-ac1/tsconfig.json   # type-check
rm -rf tests/acceptance/504-redraft-ac1/node_modules/.vite
```

In `beforeAll` the file runs `cargo build --locked --bin deep-show --no-default-features --features full` once, with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set and `/opt/homebrew/opt/rustup/bin` put first on `PATH` when
it exists, copies the binary out of `target/` (honoring `CARGO_TARGET_DIR`) and fails each test with cargo's error if
the build failed. Each run writes its evidence store into a temporary folder, deleted after the file. The right
program's run is made once and shared by the four tests; each planted program's run once. Node built-ins and vitest
only. Every `it` and the build take a 3,600,000 ms timeout.

## The surface under test

**One new field and one new read on existing calls; no new binary or call.** #393's `deep-show run` (one scenario line
in, one answer line out, `{"ok": true, "replies": [...]}`, exit 0). Each run is one scenario: the session `sess-504`
(an agent whose process is pid 4100), one panel `main` of 1200 × 675 px showing the board's document
`01JB504D000000000000000001`, and these calls, in order:

1. **`deep_show`** (#393) from the agent: `{"call": "deep_show", "session": "sess-504", "doc", "document": <the board>,
   "include": ["issues"]}`. Read: `outcome` is `"presented"`; `rev`, a number.
2. **`registry`** (#305, #387): read `modules` (each sealed canvas module's name) and `operators` (every operator the
   seal kept, by key, each with its `module`; the core's own as module `core`).
3. **`sandbox`** (#238): read `runs`, the sandbox's count of programs run.
4. **`eval`** (#387, with #493's `film`), once per time 0.5, 1.4, 1.9, 2.9, 3.9, 4.9, 5.9 and 7.9 s, in that order:
   `{"call": "eval", "doc", "t": <flicks>, "film": true, "track": <the track>}`. Read: `outcome` is `"evaluated"`;
   `rev`; `nodes`, each `{operator, module, run, …}`, every node of the frame as at the base; `steps`, each stepping
   module's steps in the frame, as at the base; `film.cameras.cam`, the pose the camera `cam` draws at t, of which
   `target` (`[x, y, z]`, u) and `shot` (the ID of the shot that writes the camera at t).
5. **`sandbox`** again: read `runs`.
6. **`deep_query`** (#411) from the agent: `{"call": "deep_query", "session": "sess-504", "doc", "paths":
   ["items/ball/at/pos", "items/readout/params/text"], "at": ["0.5s", "1.9s", "2.9s", "3.9s", "5.9s", "7.9s"],
   "track": <the track>}`. Read: `values["items/ball/at/pos"]`, one evaluated position per time (its first two numbers,
   u), and `values["items/readout/params/text"]`, one string per time.

What is new:

- **`track` on `eval` and `deep_query`**: the document's input track for that evaluation, a list of entries `{t:
  flicks, seq: u32, control: ID, value, writer: "you"}` (Input track), as `export` and `media_mix` take one in
  `deep-show run` (#544) and `deep-motion eval` takes one (#417). A frame or a read at t reads the entries at or before
  t; a control's value is its last entry's at or before t, its `default` before any (Control). Every `eval` and the
  `deep_query` of a run carry the same whole track. At the base both calls ignore the field.
- **What a stage entry does** in those evaluations (Control): from the entry's flick its stage is current, its `set`
  values hold (`{path → value}`), and its shot writes the camera, gliding from the pose shown at the entry over 0.8 s
  (the shot names no `join`), so `film.cameras.cam` is on the shot's pose with `shot` naming it once the glide is over.
  Before any entry the default stage is current and its shot's pose shows. At the base the film block holds only
  timeline shots (those with a `start`).
- **`items/<id>/params/text` of a text with a `template`**, read through `deep_query`: the string the text shows at
  that time, its template with each slot filled with the evaluated value at the slot's path (Text `text@1`:
  `template`, "in place of `text`"). Slots read `controls/<id>/value` and `data/<name>`. At the base a template slot
  reads only a `data/<name>` constant as the document holds it, and one naming `controls/…` is refused at check.

### The board (helpers.ts `board`)

A `figure` document, 1200 × 675 u, `camera: "cam"`, `transport.span` 10 s, no `look` (the shipped clean look), no
`layers` or `layer` (the hub stamps the agent's), no logic item, world, pack or `requires`. Every field is one the
design defines, with its allowed values:

- `data`: `g` 9.80665, `scale` 10 (u per metre), `phase` 0, `x` 0, `y` 0, each `{value, source: "story"}`.
- Items: `cam` (`camera@1`, orthographic, target (600, 337.5, 0), `view_width` 1200, role `decoration` by default);
  `ground` (`rect@1`, box (0, 600, 1200, 75), fill role `muted`, role `decoration`); `ball` (`circle@1`, centre (0, 0),
  r 8, fill role `accent`, role `part`, `at.pos` (100, 600, 0)); `readout` (`text@1`, role `data`, size 18, at (40, 40),
  `template: "Angle {controls/angle/value} deg, speed {controls/speed/value} m/s, distance {data/x} m, height {data/y}
  m"`). Each has a `name` and an `order`.
- `controls`: `angle` (`slider`, class `document`, label "Angle", role `slider`, range [15, 75], default 45, increment
  1); `speed` (`slider`, class `document`, label "Speed", role `slider`, range [5, 30], default 20, increment 0.5);
  `stage` (`stages`, class `document`, label "Stage", role `radiogroup`, default `launch`, stages `launch` {label
  "Launch", shot `launch-shot`, set {`data/phase`: 0}}, `top` {"Top", `top-shot`, {`data/phase`: 0.5}}, `landing`
  {"Landing", `landing-shot`, {`data/phase`: 1}}).
- `shots`, each a stage's shot with no `start` or `end` (it starts at its stage's entry): `{camera: "cam", move:
  "hold", target}`, targets (200, 500, 0), (450, 350, 0) and (700, 500, 0) u.
- `drivers` (each `{target, expr, vars, fallback?}`, expressions from the closed function list): `flight-x` writes
  `data/x` = `2 * v * v * sin(rad(a)) * cos(rad(a)) * p / g` and `flight-y` writes `data/y` = `2 * v * v * sin(rad(a)) *
  sin(rad(a)) * p * (1 - p) / g`, with vars a = `controls/angle/value`, v = `controls/speed/value`, p = `data/phase`, g =
  `data/g`, fallback 0; `ball-x` writes `items/ball/at/pos/0` = `100 + k * x` and `ball-y` writes `items/ball/at/pos/1` =
  `600 - k * y`, with k = `data/scale` and x, y = `data/x`, `data/y`.

### The input track (helpers.ts `TRACK`)

Your entries, `seq` 0, writer `you`: `stage` → `"top"` at 1 s, `angle` → 60 at 2 s, `speed` → 25 at 3 s, `stage` →
`"landing"` at 4 s, `stage` → `"launch"` at 6 s.

### Planted programs

The scenario's top-level `planted` field, one name per run, as the base selects its other wrong programs (never an
environment variable). A name the base doesn't know refuses the scenario. Each keeps the board presented and every
frame evaluated; only what the name says is wrong.

| `planted` | The wrong program | Caught by |
|---|---|---|
| `slider_entries_ignored` | A slider's value is its `default` whatever its entries, so the drivers that read `controls/<id>/value` read 45 and 20 throughout. | the sliders test |
| `stage_sets_nothing` | A stage entry makes its stage current and its shot fly the camera, but applies none of its `set` values: `data/phase` stays 0 and the ball stays at the launch point. | the stages test |
| `stage_shot_cuts` | A stage's shot shows its pose from its entry's flick on, with no glide. | the stages test |
| `readout_reads_defaults` | A template slot shows the value the document holds as written: a control's `default`, a data constant's own `value`, never the value evaluated at t. | the readout test |
| `plugin_code_per_frame` | Each frame of a document runs a plug-in's code: once per frame evaluated, the hub calls a program that is not an operator the build sealed to compute the ball's position (the values it writes are right), and lists the call in that frame's `nodes` under an `operator` and a `module` the registry doesn't hold. | the plug-in code test |

## Criteria to tests

One file, `board.test.ts`; each test's name starts with `#504.2171aba8`.

| Test | What it asserts | Fails on |
|---|---|---|
| the angle and speed sliders move the ball where a projectile's closed form puts it | The ball's position at 1.9 s (top stage, 45°, 20 m/s), 2.9 s (60°), 3.9 s (60°, 25 m/s) and 5.9 s (landing) is (100 + 10 x, 600 − 10 y) u within 0.01 u, x and y the closed form's (Readings). | `slider_entries_ignored`, the base |
| the launch, top and landing stages put the ball at their moment and glide the camera to their own shot | The ball at 0.5 s (launch, the default), 1.9 s (top), 5.9 s (landing) and 7.9 s (launch again) as above; the camera at every frame: at 1.4 s, 0.4 s into the glide from the launch shot to the top shot, its target strictly between the two targets, at least a tenth of the way from each on both axes; at every other frame on its stage's shot target within 0.01 u, with `shot` naming that shot. | `stage_sets_nothing`, `stage_shot_cuts`, the base |
| the readout shows the angle, the speed and the distance and height that move the ball | At every read time the readout shows four numbers, in order the angle, the speed and the closed form's distance and height in metres, each within 0.05 or 2% of it, whichever is larger. | `readout_reads_defaults`, the base |
| no plug-in code runs in any frame of the board | Every frame evaluates the shown revision and lists its nodes; each node's `operator` is a key of the registry's `operators`, with that entry's `module`, which is a sealed module or `core`; no frame lists a step; the sandbox's `runs` is a number and the same before the first frame and after the last. | `plugin_code_per_frame`, the base |

Each test first holds the right program's run to its check, then runs its planted program(s) and requires its check to
fail there, with a failure naming what the plant breaks (a time the ball or the camera is wrong at, the readout, or a
node that isn't sealed).

## Readings where the issue and design leave a choice

- **"Works"** is read through what the board's own data says it does: the sliders' entries and the stages' entries
  move the ball where a projectile's closed form puts it, each stage flies the camera to its own shot, gliding as a
  stage's shot does, and a readout shows the values that move the ball. The board is the test's document, so it is
  written to work in closed form (Interactive figures: "closed form where one exists, as for a projectile").
- **The closed form** (helpers.ts `flight`): launched from the ground at angle θ and speed v under g = 9.80665 m/s²,
  no drag; at time τ into the flight x = v cos θ τ, y = v sin θ τ − g τ² ÷ 2. The launch stage is τ = 0, the top is
  where the vertical speed is 0 (τ = v sin θ ÷ g) and the landing is where the height is 0 again (τ = 2 v sin θ ÷ g).
  The board shows it at 10 u to the metre from (100, 600) u, y down. Expected values come from these formulas, not
  from the drivers' text.
- **The stages' moment**: each stage's `set` writes `data/phase`, the share of the flight's time (0, 0.5, 1); the
  values hold from the entry's flick. Reads are made 0.9 s or more after an entry, so a value that eased in over the
  glide would read the same.
- **"Each stage's shot"**: an explicit pose (a target), so its framed pose doesn't depend on a framing solve; the
  test reads that the camera ends on it, names it, and is between the two poses during the glide. The glide's exact
  start, span and end are criterion 5's.
- **The readout's numbers** are read in order from the text it shows (a U+2212 minus read as `-`); "within 0.05 or
  2%" leaves the number its own precision (Honest numbers: "no more precision than its source carries"), while every
  planted readout is off by far more.
- **"No plug-in code per frame"**: in each frame evaluated, nothing ran but operators the build sealed (the registry's,
  the core's among them), no stepping module stepped (the board has no logic item or world, so nothing needs a step)
  and the sandbox, which runs any program a pack or an agent brings, ran nothing between the first frame and the last.
  A plug-in's code, whether in the extension host or sandboxed, is never one of the seal's operators. The frames read
  are the same ones whose camera the stages test reads, with the same track.
- **The track rides on each call** (`track`), as `export` and `media_mix` take it, rather than arriving through `input`
  calls on the hub's clock, so every entry's flick is exact and no stamping lead enters a read.
- **An agent's figure**: the board is shown through the agent's `deep_show` and read through its `deep_query`; the
  entries are yours (`writer: "you"`), as moving a slider is.

## Not tested

Criteria 2 to 9; the input module's gestures (dragging a slider's handle, keys, a click on a stage), present mode's
keys, handles, the accessibility tree and announcements, pictures, the glide's exact path and `join: cut` (criterion
5), assemblies and take-apart, saving and reloading, `start_on` and `switch`, variants, export.
