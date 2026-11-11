# Acceptance tests for #504: figures as documents, with assemblies, cards, stages that glide, start_on and switch, picks from the scene and variants

These tests were written before any implementation existed, by a job that saw only issue #504, its Oracle page, the
design and the base commit `a04378eb2` ("Merge pull request #2190 …", origin/main). No plan for #504, no other worktree,
branch, PR or stash was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding).

The suite is lean: one file per criterion, a few with one test per leg the criterion names, and one planted wrong
program per leg the base can't show failing.

**Not run against a binary.** The machine is shared and loaded, and the surfaces plainly don't exist at the base, so no
Rust was built and the suite wasn't run there. `BASE-FAILURE.txt` says, per test, the assertion it fails at on the base
and why, read from the base's code. The type-check passes. A scratch script (not kept) checked the fixtures' own numbers:
the projectile's launch, top and landing points, the bars' overlap below 8 mm, the room's click points and the box
figure's heights at rest and apart.

## What was read

- Issue #504, live (`gh issue view 504 --repo windoliver/deepbuild`): its Scope, its Fields (`start_on` and `switch`,
  Assembly, Variant), its nine acceptance criteria and its Proof line ("A recorded session with the projectile board, the
  stage glide, the scene picks and the variant export, and the check that no plug-in code ran per frame").
- Its Oracle page (`doneright/oracles/issues/504.md`, branch `doneright` of DeepBuildAI/deepbuild): no upstream test
  checks any criterion, so this suite ports nothing.
- `docs/technical-design.md`:
  - Films and figures on the canvas (591): "no plug-in code runs per frame", "A figure explains and never proves";
    Interactive figures (616); Export (621: "A film whose stages wait or branch exports the path its input track
    takes"; "A film can be attached to a claim as an explanation, never as evidence"); Figures that are machines
    (740 to 761: assemblies with a parent, a motion and an apart vector; "a readout that templates the same values";
    "only parts whose shape changes are rebuilt, which is also how a saved file reloads in place").
  - Scenes, physics and the canvas core (680; the canvas core 703; physics 723: "A lab measures what it shows: its
    controls fire its inputs, such as a launch at the angle and speed two sliders set").
  - Canvas (561 to 568: "a figure explains and never proves"); Control and input track (1278).
  - Criteria to tests, Criteria in a checked shape, Wrong programs, the edit guard (2628 to 2632); Dogfooding (2652).
- `docs/canvas-primitives.md`: Scope and input classes (60); Patch (453: the `set {id, path, value}` op); Assembly
  (2890); Camera `camera@1`: framing (4503); Shot (4540: `join: cut | glide {span} = cut`, "glide by default for a
  stage's shot", "the pose at the stage's entry"); Overlay (4580: the card, "a readout and the parts it describes come
  from one model"); Variant (5019); Follow (5412: `stagger`); Control (5555: `targets`, `variant`, `stages` with
  `shot`, `set`, `readout`; "never selects the item or opens its panel"; "each announced as a button named by its
  option's label"); Input track (5787); `start_on` and `switch` (5840); Geometry audit (8842); Control sweep (8878:
  "a dry run's lazy-tongs bars overlapped only below an 8 mm pitch").
- At the base, to learn the surfaces only:
  - `crates/deep-show`: `main.rs` (the call list, `at` and `clock`, the scenario's `planted`), `input.rs` (`input`,
    `scope`, `view`), `access.rs` (`see`: the tree `{id, role, name}`), `frames.rs` (`eval`: `nodes`, `steps`,
    `film`), `film.rs` (`film.cameras`), `export.rs` (`export` with `out`, png_seq, `track`; `session`), `shared.rs`
    (`read`: `hash`, `document`), `verdict.rs` (`verdict`, `key.revisions`), `geometry_audit.rs` (states, sweeps,
    assemblies not run), `sandbox.rs` (the `sandbox` call's counts: "the proof that a document naming no program costs
    it nothing").
  - `crates/deep-canvas`: `scope.rs` (a click selects and opens `details`; the state's JSON), `document/mod.rs`
    (`ENVELOPE_KEYS`: `assemblies`, `inputs`, `variants`, `card`), `template.rs` (`{path}` slots).
  - `crates/deep-canvas-motion`: `doc.rs` (`controls_of`: stages with a `shot`; `shot_of`: a stage's shot is `hold` with
    a `target`; `target_of`: `items/…` and `data/<name>`), `input.rs` (a stage's glide moves the camera's target only),
    `shots.rs` (#493's timeline shots), `program.rs` (child-of parenting composed in `evaluate`).
  - `crates/deep-motion/src/main.rs` (`eval`: `track`, `planted`, `project`; `cameras_json` reports `{target}` alone for
    a camera only a stage moves).
  - `crates/deep-canvas-input/src/session.rs` (`deep-input`'s `targets` and picks, 2D only).
  - `packages/hub/src`: `core.ts` (`inbox.read`, `ask.card`, `changes.read`, the canvas world), `canvas.ts`,
    `tools.ts` (`deep_show`: "the doc ID the hub minted for your claim, ask or prompt"; `deep_ask`; `deep_claim`).
  - `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs`.
  - The suites `tests/acceptance/405/`, `493/`, `501/`, `544/` (layout, README, BASE-FAILURE, taste), `383/` (the
    scope, the virtual clock), `393/` (deep_show and the scenario), `806/` and `26/` (the hub, its agent stand-ins and
    world file), `65/` and `325/` (Needs you and the receipt through `inbox.read` and `changes.read`).

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## Run them

Every file builds cargo binaries, so the files run one at a time. The implementer adds this line to
`scripts/lanes.mjs` (this job edits nothing outside this folder):

```js
// #504's files each build deep-show or deep-motion with cargo, and criterion 2's hub test starts a hub and agents.
alone.push('tests/acceptance/504/');
```

```sh
npm ci                          # once, if node_modules is missing
npm run build --workspaces      # criterion 2's hub test runs the built CLI, packages/cli/dist/main.js
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/504 --no-file-parallelism
npx tsc -p tests/acceptance/504/tsconfig.json   # type-check
rm -rf tests/acceptance/504/node_modules/.vite
```

- **Builds.** Each file builds what it uses once, in `beforeAll`: `cargo build --locked --bin deep-show
  --no-default-features --features full` and `cargo build --locked --bin deep-motion`. It sets `CARGO_INCREMENTAL=0
  CARGO_PROFILE_DEV_DEBUG=0` unless they're already set, puts `/opt/homebrew/opt/rustup/bin` first on `PATH`, copies
  each binary out of `target/` (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. Every `it` has a
  one-hour timeout.
- **The hub.** `ac2-explains.test.ts`'s second test starts a real hub (`deep hub run`) in a temporary home with #806's
  world (`tests/acceptance/806/figure.ts`, `openFigures`): a Claude Code and a Codex stand-in, each in its own session
  with its own `deep mcp`. Its canvas core is this checkout's `target/debug/deep-show`, which the file builds first.
  Without `packages/cli/dist/main.js` it fails `BLOCKED:`. Processes are stopped by PID (#806's `cleanup`).
- **Isolation.** Every test writes into temporary folders and deletes them. Node built-ins and vitest only.
- **No decision.** A test that can't decide here fails with a message starting `INCONCLUSIVE:` or `BLOCKED:`. It never
  passes.

## The surface under test

The issue names fields, behaviors and observations but no command line. These tests extend the surfaces the base
already has: `deep-motion eval` (#391's JSON lines, as #417, #489 and #493 extended it) for evaluated figures, poses and
projections; `deep-show run` (#393's scenarios) for the canvas core's interaction scope, accessibility, checks, renders
and exports; and the hub (`deep hub run`, #806's world) for Needs you, the opened ask and the receipt. No new binary or
subcommand. **Every name below that the issue or the design doesn't give is this job's choice**; the implementer builds
exactly these, or a dispute goes to a blind redraft.

### Documents

#391's envelope (`{format: 1, id, profile, title, description, size, camera, layers, items, …}`; `layers` and item
`layer` for `deep-motion`, stripped for `deep-show`, which stamps them). Metres and +Y up in 3D, u (= px) and y down in
2D. The #504 fields the fixtures write:

| Field | As the tests write it | Source |
|---|---|---|
| Assembly | envelope `assemblies: {ID → {parent: ID \| null, at: {pos}, motion?: {kind: slide, axis, range}, value: 0, apart: [x, y, z], order}}` | the issue's and Assembly's fields |
| A part in an assembly | the item's `parent` names the assembly's ID | Assembly: "items join by naming the assembly as their parent" |
| An assembly's value | a driver's `target: "assemblies/<ID>/value"` | Assembly: "set by a driver or a channel"; the path: choice |
| The take-apart | a follow channel `{target: "assemblies/apart", type: f32, mode: follow, follow: {source: {keys: {…interp: hold}}, model: {transition: {span, interp: linear}}, stagger: {targets: [assembly IDs], lag, order: index}}}`: the follow's value at each stagger target (0 to 1) is the share of that assembly's `apart` it is moved by | Assembly: "a take-apart moves each assembly by `apart` in `order`, timed by the follow's stagger"; Follow; the target path: choice |
| The card | envelope `card: {fig, title, hint, readout}`; `readout` a template, `Lift {assemblies/body/value} m` | Overlay: the card's fixed set; the slot path: choice |
| A readout | a `text@1` with `params.template`, `Range {data/range} m` | Text `text@1` |
| A stage | `controls.<id>.stages.<stage>: {label, shot, set?: {path → value}}`, `default` a stage | Control: Stages |
| A stage's shot | `shots.<id>` with no `start`: `{camera, move: hold, target, orbit: {azimuth, elevation, distance}}` in 3D or `{camera, move: hold, target, view_width}` in 2D (an explicit framed pose), and `join: cut` where it cuts | Shot |
| Targets | `controls.<id>.targets: {stage or option → item ID}` | Control |
| A variant set | envelope `variants: {set → {options: [{name, label, patch: [{op: set, id, path: "items/<id>/params/paint/fill", value: {role}}]}]}}` | Variant; Patch's `set` op |
| A choice on a variant set | `controls.<id>: {kind: choice, class: view \| document, variant: <set>, options: [names]}` | Control: `variant` |
| A driver on data | `drivers.<id>: {target: "data/<name>", expr, vars: {x: "data/<name>" \| "controls/<id>/value"}}` | Driver; Path ("A channel may key `data/<name>`") |

An input track entry, wherever a test writes one: `{t: flicks, seq, control, value, writer: "you", player: 1}` (#417's,
#497's and #544's form).

### `deep-motion eval`

Input as at the base: `{doc, times: [flick], track?: [Entry], planted?, project?: [item ID]}`. Read from each frame:

- `items.<id>.at.pos`: the item's evaluated position **in world space**, its assemblies' transforms (value along the
  motion, take-apart share of `apart`) and parents composed before its own, as child-of parenting reports it at the
  base.
- `cameras.<id>`: #493's full Pose `{position, target, azimuth, elevation, distance, fov, view_width, zoom, roll, shot}`,
  **for a camera a stage's shot moves too** (the base reports `{target}` alone there), `shot` naming the active shot.
- `projected.<id>.box`: #493's projected bounds `[x0, y0, x1, y1]` in px through the frame's pose.
- **`readouts`** (new): `{<text item ID>: string, card: string}`, each readout's text as this frame shows it: every
  `text@1` with a `template`, and the card's `readout` under `card`.

New `planted` names (each answers `bad_input` at the base):

| Name | The wrong program | Criterion |
|---|---|---|
| `take_apart_all_at_once` | every assembly of a take-apart starts at the stagger's first start, ignoring lag and order | 3 |
| `readout_reads_document` | a readout's and the card's template slots fill from the values as the document writes them (an assembly's stored `value`), not as the frame evaluates them | 3 |
| `assembly_value_from_previous_frame` | an assembly's value steps toward its driver's value from the value the previous evaluated frame left (frame history) | 4 |
| `stage_glide_moves_target_only` | a stage's glide eases the camera's target alone; its eye takes the framed position at the entry's frame | 5 |
| `framer_ignores_apart` | a shot's framing bounds its kept parts at rest, ignoring the apart offsets a take-apart moves them by | 8 |

### `deep-show run`

The scenario as #393, #383 and #501 left it: `{evidence, sessions, processes, panels, docs, claims?, clock?, planted?,
calls}`; the working agent alpha (`sess-alpha`); your shell (pid 3002) as the `deep show` peer. With `clock` (#383's
`{refresh_hz, lead, check}`), every call carries `at` in flicks. New or extended:

| Surface | What the tests send and read | New or existing |
|---|---|---|
| scenario `docs.<id>.for` | the claim or ask handle the hub minted the document for (`deep_show`'s "the doc ID the hub minted for your claim, ask or prompt") | **new field** |
| `deep show` / `deep_show` | a whole revision; reply `outcome: "presented"`, `changed` (criterion 3) | existing |
| `eval` | `{doc, t}`: `outcome: "evaluated"`, `steps: [{module, count}]`, `nodes: [{operator, module, item, run}]`; with `film: true`, `film.cameras.<id>.shot` (#493) | existing; a stage's shot must reach `film.cameras` |
| `sandbox` | `{module: "sandbox", checks, links, rewrites, runs}` | existing |
| `verdict` | `{result, key: {revisions: [{doc, …}]}, requirements: [{id, result, issues}]}` (#403, #405) | existing |
| `geometry.audit` | `scope: figure` over a figure with assemblies, `sweeps: {pitch: 5}`; an overlap issue `{code: geometry.overlap, severity, ids, sweep: {control, value}}` (#405) | existing check; figures and assemblies new |
| `read` | `{doc}` → `{hash, document}` | existing |
| `revisions` | `{doc}` → `{revisions: [...]}` | existing |
| `view` | `{panel}` → `{snapshot: {sha256}}`, the panel's render with the viewer's session state (a chosen variant included), PNG in the evidence store | existing; the variant new |
| `input` `{type: "control", control, value}` | an entry on a document's own choice control: in class view it changes session state only | existing event; a document's control new |
| `input` reply **`appended`** | `[Entry]`: the entries this input appended to the panel document's input track (empty when none) | **new field** |
| `input` keys | `{type: "key", key: "Tab"}` moves the focus over the Tab stops; `{type: "key", key: "Return"}` (the scope's name for Enter, as its ⌘K palette reads it) picks the focused target | existing event; Tab stops new |
| `scope` state **`focus`** | the Tab stop holding keyboard focus: a target as its item ID (`"sofa"`), a control as its ID, or null | **new field** |
| `scope` state | `selection`, `details` (the item whose panel is open, or null) | existing |
| `see` | `tree: [{id, role, name}]`: each target a node with role `button` named by its stage's or option's label | existing call; target nodes new |
| `export` | `{doc, out, video: {codec: png_seq}, frame_rate: [12, 1], track: [Entry]}` → `outcome: "exported"`, one PNG per frame in `out` | existing (#501, #544's `track`); a document-class choice read from `track` new |

New scenario `planted` names (each makes the base answer the scenario `bad_input`):

| Name | The wrong program | Criterion |
|---|---|---|
| `board_runs_program_per_frame` | every evaluated frame of a document with controls runs a program through the sandbox module, as a per-frame plug-in callback would | 1 |
| `figure_feeds_verdict` | the verdict judges, beside a claim's deliverables, the documents its agent showed on it (`docs.<id>.for` naming the claim) | 2 |
| `reload_rebuilds_every_part` | a whole revision presented again rebuilds every part's geometry, changed or not | 3 |
| `sweep_poses_assemblies_at_rest` | a control sweep steps the control but poses every assembly at its rest value | 4 |
| `pick_selects_item` | a pick on a target also selects the item and opens its panel, as a click on any item does | 6 |
| `variant_pick_writes_revision` | a view-class pick applies the option's patch as a revision of the document | 7 |
| `variant_export_final_choice` | an export applies only the last entry's option, over its whole span | 7 |

### The hub

`deep hub run` with #806's world file (`DEEP_HUB_TEST_SHOW`, the test seam #806 defined) and its agent stand-ins.
Existing: `deep_claim`, `deep_ask`, `deep_show` through the stand-in's `deep mcp`; `inbox.read` (`asks: [{ask, …}]`,
Needs you); `ask.card {ask}`; `changes.read {id: claim}` (`change: {claim, runs, verdicts, checks, …}`, the receipt).
New:

- world file `docs.<id>.for`: the claim or ask handle the hub minted the document for, as in the scenario above.
- **`ask.card` → `explains: [{doc, rev}]`**: the agent's documents shown on that ask, beside it when it's opened (a
  `doc` may be the bare ID or `doc:<ID>`).
- **`changes.read` → `change.explains: [{doc, rev}]`**: the receipt's explains-never-proves section, the agent's
  documents shown on that claim.

No hub plant is needed: at the base the card and the receipt have no `explains`, so the hub test fails there.

## Criteria to tests

IDs are `#504.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them (`- [ ] ` dropped, trimmed, white space collapsed). Each file holds its criterion's ID as a string
`const ID`, and every test's name starts with `${ID}`, so the trace lane's static scan reads each test's tag (checked
with `spans` from `scripts/proof-change.mjs`: all 24 suite and test names carry their tag). Each file's header states
its fixture, its numbers and its wrong programs in full.

| ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|
| `#504.2171aba8` | `ac1-projectile.test.ts` (2) | On a recorded track, the ball at the closed form's launch, top and landing points within 1e-6 u at 45°/15 m/s and 30°/20 m/s, the camera on each stage's shot, the range readout v²·sin 2θ ÷ g; 31 frames with no fixed step, no logic or sandbox node and unchanged sandbox counts. Fails on `board_runs_program_per_frame` |
| `#504.3b622b2f` | `ac2-explains.test.ts` (2) | The verdict PASSes on the deliverable alone, keyed by it alone, naming neither the agent's figure (which an audit would fail) nor its film; fails on `figure_feeds_verdict`. On the hub: Needs you gains no row and no row names the documents; the opened ask's card lists its figure in `explains`; the claim's receipt lists the figure and film in `explains` and never in checks, runs or verdicts (fails at the base) |
| `#504.df4b9c8f` | `ac3-assemblies.test.ts` (3) | Each assembly leaves its parent after the one before it in order, sits apart by its vector, all back at rest by 5.5 s (fails on `take_apart_all_at_once`); the parts rise by the lift and the card shows that number (fails on `readout_reads_document`); a saved figure reloaded with the cap edited rebuilds the cap alone (fails on `reload_rebuilds_every_part`) |
| `#504.9b99950d` | `ac4-sweep.test.ts` (2) | A pitch sweep on the track evaluated in order, reversed and shuffled gives identical items, the jaw where each entry puts it (fails on `assembly_value_from_previous_frame`); the definition's sweep FAILs naming the two bars below 7 mm (fails on `sweep_poses_assemblies_at_rest`) |
| `#504.746e9d85` | `ac5-glide.test.ts` (1) | Close, chosen at 4 s mid-glide: within 1e-6 m of the pose shown at 4 s, moving and off its framed pose until 4.8 s, on it from 4.8 s; snap (join: cut) on its framed pose at 6 s. Fails on `stage_glide_moves_target_only` |
| `#504.86e6ed7d` | `ac6-picks.test.ts` (1) | Lamp click: one entry, nothing selected, no panel, the lamp's shot current; Tabs append nothing, Return on the sofa one entry and its shot current; three buttons Lamp, Sofa, Window; a wall click appends nothing. Fails on `pick_selects_item` |
| `#504.94ba2936` | `ac7-variants.test.ts` (2) | Each view-class pick recolors the case to its reference, the `read` hash and the one revision unchanged (fails on `variant_pick_writes_revision`); the export's 96 frames show muted, lagoon, orchid and graphite from 0, 2, 4 and 6 s (fails on `variant_export_final_choice`, naming frame 24) |
| `#504.a17a1463` | `ac8-take-apart-frame.test.ts` (1) | Every part's projected box inside the safe frame at all 180 samples, 30 a second. Fails on `framer_ignores_apart` |
| `#504.a3d1f3d0` | `taste.test.ts` (1) | Reads the record only (The taste call) |

## Readings where the issue and design leave a choice

### Criterion 1

- **"Works"** reads as: the stages and the sliders put the ball where the closed form says, each stage frames its own
  shot, and the readout shows the value the drivers compute. Each stage's `set` writes `data/phase`, the share of the
  flight it shows, and the drivers read it. The design's stage `set: {path → value}` is used as written; whether a set
  value eases in is left open, so each check is 1 s after its entry.
- **"No plug-in code per frame"** reads as the check the Proof line names, over a play of the board's frames: no fixed
  step ran (`steps`), no node of the logic or sandbox module ran (`nodes`), and the sandbox module, which runs every
  program a pack or plug-in carries, ran nothing (`sandbox`'s counts unchanged). The board itself holds no logic item,
  physics world or program.
- **The default stage's shot** holds from the start, as at the base, so the camera is checked only after an entry.

### Criterion 2

- **Two surfaces.** The verdict is the canvas core's (`deep-show run`'s `verdict`, the gate's judgement of a claim's
  documents). Needs you, the opened ask and the receipt are the hub's (`inbox.read`, `ask.card`, `changes.read`). Each
  half runs where its surface lives.
- **"An agent's figure or film"** is a document the agent showed through `deep_show` on a document the hub minted for
  its claim or its ask (`docs.<id>.for`), as opposed to a deliverable its definition names. "Never feeds a verdict" reads
  as: the verdict's key and rows read the deliverables alone, so a figure an audit would fail leaves a PASS standing.
- **"Never appears in Needs you"** reads as: showing the documents adds no row to `inbox.read`, and no row names a
  document or one of its snapshots. The agent's own ask is in Needs you, as it must be; its figure isn't.
- **"Shows beside an opened ask"** reads as the ask's card (`ask.card`, what the app draws when you open the ask)
  listing the figure in `explains`; **"a receipt's explains-never-proves section"** as `changes.read`'s
  `change.explains`, with the receipt's proof (`checks`, `runs`, `verdicts`) naming none of it.

### Criterion 3

- **The take-apart's wiring** is the follow channel on `assemblies/apart` above: Assembly says the take-apart is "timed
  by the follow's stagger" without naming the follow's target. The stagger's target list follows the assemblies'
  `order`, so the two never disagree.
- **"In order"** reads as each assembly's own offset (its part's displacement less its parent's part's) leaving zero
  strictly after the one before it in `order`. "Come back" reads as every part at rest within 1e-9 m once the reverse
  take-apart has had time to end (5.5 s). No easing curve is pinned beyond the fixture's own linear transition.
- **"Its readout shows the values that move the parts"** reads as the card's readout showing, as its one number, the
  body's slide value at each frame, which the parts' displacement equals within 1e-9 m. The slot path
  `{assemblies/body/value}` names the value that moves them.
- **"Saving the document reloads it in place"** reads, from the design ("only parts whose shape changes are rebuilt,
  which is also how a saved file reloads in place"), as: the document `read` back as saved, with one part's shape
  edited, presented again as a whole revision, rebuilds that part alone (`nodes[].run` is `ran` only for it at the same
  time). A node kept or taken from the cache (`kept`, `hit`) counts as not rebuilt.

### Criterion 4

- **"A control swept across its range in a fixture"** is an input track whose entries step the pitch across its range;
  **"replays identically from the input track"** reads as the frames after each entry, evaluated in order, in reverse
  and shuffled, giving identical items, with the jaw where each entry puts it.
- **"The sweep"** is the definition's control sweep, #405's `geometry.audit` with `sweeps`, now on a figure
  (`scope: figure`, parts in assemblies). "Below one setting" is a pitch of 8 mm; with the fixture's 1 mm tolerance the
  overlap counts below 7 mm, so the reported `sweep.value` must lie in [0.004, 0.007).

### Criterion 5

- **"The pose shown at 4 s"** is the camera's pose at 4 s with everything but the 4 s entry: the same document on the
  track without it. The fixture chooses `mid` at 3.6 s, so at 4 s the camera is half way through mid's glide, a pose no
  shot frames, and a glide from any framed pose fails.
- **"Over 0.8 s … ending on the framed pose"** reads as: at every 60 fps frame after 4 s and before 4.8 s the eye moves
  and stands off the framed pose; from 4.8 s on it's on it within 1e-6 m. The framed pose is the stage shot's explicit
  pose, its eye computed with camera@1's orbit convention (azimuth 0 puts the eye on +Z, #493's).
- **"Join: cut … on the entry's own frame"** reads as the frame at the entry's flick, 6 s, already on the framed pose.

### Criterion 6

- **"Appends one entry"** is read from `input`'s new `appended`: the click's press and release together append exactly
  one `{control: room, value: lamp, writer: you}`. **"Makes the lamp stage current"** reads as the document's camera on
  the lamp stage's shot in a frame after that entry and before the next (`eval` with `film`). The three stage shots hold
  the room's own pose, so the view never moves under the pointer.
- **"Without selecting the lamp or opening its panel"** is the scope's `selection` empty and `details` null.
- **"Tab then Enter on the sofa"** reads as Tab pressed until the scope's `focus` is the sofa (found in a first run;
  the design puts targets after the control's own UI in reading order, so the count isn't pinned), then Enter, which
  the scope names `Return`.
- **"Three buttons named by the stage labels"** counts the tree's `button` nodes whose names are the labels: exactly
  Lamp, Sofa and Window, once each.
- **The room is 3D**, seen through an orthographic front view, so the click points are the items' centres projected
  through the camera the scope reports (picking in 3D, #378); the wall's point is a bare stretch of it.

### Criterion 7

- **"Recolors the case on each pick"** reads as the case's centre in the panel's `view` render matching the color the
  same build draws when the document itself sets that option's role, within 3 code values per channel. No variant
  default, so before a pick the case shows its own fill.
- **A view-class pick** is an `input` control event naming the option. **"The saved document's hash stays the same"**
  is `read`'s hash after each pick equal to the presented revision's, with `revisions` still holding one revision.
- **"Entries at 2, 4 and 6 s"** are the export's `track` (#544's field: the input track an export reads). "From those
  times" reads frame by frame at 12 fps: frame 24 (2 s) is the first lagoon frame.

### Criterion 8

- **"All 30 samples a second"** are the times k ÷ 30 s across the shot's 6 s span, 180 of them; **"bounds"** are
  #493's projected boxes; **"the safe frame"** the envelope's default safe area, 24 px in from each edge.

## Not tested

No criterion asks for these, so none is tested:

- **`start_on` and `switch`**: the issue says they are on main from #492 and #544; no criterion names them.
- **Other Assembly fields**: `motion` of kind turn or path, `repeat`, `at` other than the origin; the refusals of two
  parents, a cycle and nesting past 4.
- **Parts from the versioned vocabulary of kinds** and **handles and marks described as data**: the fixtures use the
  core's `mark.box@1` and `rect@1`.
- **The card's other fields** (`legend`, `caption`) and **readouts announced** to a screen reader.
- **A figure stepped by the physics module or a piece's logic.**
- **A stage's `lit`, `keys` and `readout`; a choice read as an index in an expression; picks on mark-set rows; hover.**
- **Variants in a taste call's answer or a sheet, and accepting a variant as a patch.**
- **The geometry audit's other states** (`take_apart` with reversals, `loop`, `tour`, `motion_angles`) and fields.

## The taste call

`taste.test.ts` judges no picture. It reads the check run's pictures under `docs/evidence/504/`:

- `projectile-board.png`: the projectile board with its sliders and stages;
- `take-apart.png`: a take-apart assembly;
- `recoloured-case.png`: the recoloured case;
- `stage-glide.apng`: a recording of a stage gliding;
- `take-apart.apng`: a recording of a take-apart.

Each is taken by the check run from the canvas's own frames, attached to the PR and shown to the owner in the session.
The one call on them is recorded in `tests/acceptance/504/TASTE.json`, written after the owner's answer (this job
writes none):

```json
{"issue": 504, "criterion": "#504.a3d1f3d0", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"projectile-board.png": "<sha256>", "take-apart.png": "<sha256>", "recoloured-case.png": "<sha256>",
                 "stage-glide.apng": "<sha256>", "take-apart.apng": "<sha256>"}, "note": "…"}
```

Missing pictures, no call, or a call made on other pictures (another SHA-256) is `INCONCLUSIVE:`, never PASS;
`looks_wrong` fails; `looks_right` on exactly these pictures passes. No other criterion reads a picture to judge it:
criterion 7 compares the case's color against what the same build draws for the role, a value, not a taste.
