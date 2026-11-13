# Acceptance tests for #539: game input: picks on rows, grid focus as one Tab stop, and hover as viewer state

Written first, from issue #539 (its Scope, its Fields, six acceptance criteria, its Proof line and its Oracle line), the
parent #187 for what the sibling parts own, the design sections the issue links and those they lean on, and the base
commit `53c0e72a3` ("Merge pull request #2356"), by a job that never saw an implementation; none existed, and no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, each test carrying its
criterion's ID, and exactly the five planted twins the criteria name. The Oracle line's lane is
`tests/acceptance/539-oracle/`.

## What was read

- The issue (`gh issue view 539`) and its parent #187 (#540 owns the point control, ground points, box drags and throws;
  #541 actions, key repeat and pads; #542 text and scroll; #543 the camera's goto, edge pan and mouse look). Their
  behaviour isn't tested here.
- `docs/technical-design.md`: Control and input track; Dogfooding.
- `docs/canvas-primitives.md`: Scope and input classes; Input router, focus and gesture serial; Mark set: atlas tiles,
  logic columns and hex grid; Selection (session state); Instance `instance@1`: logic columns; Driver; Control; Control:
  picks on rows and grid focus; Control: point (hover, the 248 B form); Control: actions (the 16 B form); Control: text;
  Control: kinds as a registry; Input track; Logic `logic@1` (the read region); Logic: preview; Check input: logic kinds
  (`logic.determinism`).
- The Oracle page `doneright/oracles/issues/539.md` on branch `doneright` of `DeepBuildAI/deepbuild` and the vendor copies
  of the four files it pins (the Oracle lane's README).
- At the base, only for surfaces and conventions: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs` (`alone`); `crates/deep-show` (`main.rs`'s calls, the scenario's `planted` and `screen`; `hub.rs`;
  `input.rs`, where a press meets the rows a panel draws; `played.rs`'s input track; `access.rs`'s `see`; `logic.rs`;
  `spatial.rs`'s `row_boxes`; `frames.rs`'s `eval`; `export.rs`; `window.rs`); `crates/deep-canvas/src/scope.rs` (Tab
  stops, `state.focus`, a press, a drag, hover); `crates/deep-canvas-marks/src/atlas.rs` (row keys, the grid's centres,
  the hex hit area); `crates/deep-logic` (`world.rs`'s read region, `checks.rs`); `crates/deep-input`; the suites `535/`,
  `536/`, `537/`, `504/` (`input`, `appended`, `view`, the PNG export, Tab and Enter on targets), `531/` and `532/` (the
  logic module's step records), `1162/` and `scripts/checkpoint-1162-shots.mjs` (the reference window), `544/wat` (the
  assembler).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs.

## What the base already does, and these tests don't credit

A press on a panel meets the mark-set rows the document draws now (#535), a hex row by its hexagon (#536); a click on a
row selects it (`state.selection`, `<set>#<key>`); a row whose `alive` is false doesn't draw and isn't hit. A click on
a control's `targets`, or Enter on a focused one, appends one entry and selects nothing (#504). Tab walks each control's
own stop, then its targets. A plain drag in a flat view pans the camera. `see` lists the parts and controls that draw and
announces a readout when its text changes (#376). `view` draws the panel's view by render-back; `export` with `video:
{codec: "png_seq"}` writes a film's frames. A logic item reads a control's entries as 16 B (a u32 player, 4 zero bytes,
an f64). A logic item whose `reads` names `place.hover` is refused at check (`place` names no control or logic item
holding `hover`), naming the read. None of the rest exists: no `verb: pick` with `rows`, no pick entry, no `focus` on
rows, no arrow, Home or End keys over rows, no focus announcements, no `<control>.hover` (a driver var
`controls/place/hover/0` is refused, `bad_path`), no `logic` call, none of the five planted names.

So one test passes at the base, as a guard of behaviour that must not change (design: Proven on the base): criterion 4's
refusal of a logic read of `place.hover`. `BASE-FAILURE.txt` is the base run.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/539 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/539
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show`, the default `full` set),
honoring `CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists, and copies it to a temporary folder; and #544's
assembler (`tests/acceptance/544/wat`, read only) into `target/acceptance-539-wat/`. Every test passes its own 30-minute
timeout. Evidence stores and binaries are temporary and deleted; only `ac6-taste.test.ts` writes outside them, its
pictures to `docs/evidence/539/`. Node built-ins, vitest and `../467/helpers.ts`'s PNG reader and writers (imported read
only); no process is started but `cargo`, the assembler and `deep-show`, each waited for, none stopped by name or port.

**The lanes line.** The implementer adds this to `scripts/lanes.mjs`, beside #535's and #537's (this README is the
instruction):

```js
// #539's files each build deep-show and #544's assembler, run logic programs, export on the GPU and draw the app's window.
alone.push('tests/acceptance/539/', 'tests/acceptance/539-oracle/');
```

Gates: no cargo is `BLOCKED:`, and an assembler that doesn't build is `BLOCKED:`; `screen` off macOS
(`unsupported_platform`) is `INCONCLUSIVE:`; criterion 6 is `INCONCLUSIVE:` until its taste call is recorded. None is a
pass. No test reads a timing or the machine's load.

## The surface under test

The issue names a control's fields, an entry, read-region bytes, a selection, step hashes, a check, a golden, an
export, a screen reader and planted programs, but no call. As in #504's and #535's suites, everything is driven through
`deep-show run` (one JSON scenario on stdin, one answer `{"ok": true, "replies": [...]}`, one reply per call), on the
scope's virtual clock (`clock: {refresh_hz: 120, lead: 2 ms, check: 0.5 ms}`, a display, each call at its `at`), and
criterion 6 through `deep-show screen` (#1162). **Every field, call, reply field and planted name below that the issue or
the design doesn't give is this job's choice, the smallest the criteria need; the implementer builds exactly these, or a
dispute goes to a blind redraft.** Times are flicks (705,600,000 a second; a 60 Hz step is 11,760,000).

### Documents

Each is a figure with a transport, as #504's suite writes one, in #535's form: `{format: 1, id, profile: "figure",
title, description, size, seed: 539, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, requires: {modules:
{input: "^1", logic: "^1"}}, items, assets, controls, drivers?}`, the camera a 2D orthographic `camera@1` (`target` the
page's centre, `view_width` its width), each program and the atlas in the evidence store and listed in `assets` with a
license. A figure, not a film: a film's viewer takes the arrow keys for its frames (#501), which a game's grid focus
needs.

| Field | As written | Source |
|---|---|---|
| A pick control on rows | `controls.<id>: {kind: "press", class: "document", verb: "pick", label, role: "grid", rows: [<set ID>], focus?: {start?: [k0, k1]}}` | the issue's Fields (`rows` in place of `targets`; `focus` with its default label) |
| The next control | `{kind: "slider", class: "view", label, role: "slider", range: [0, 1], default: 0.5, increment: 0.1}` | Control |
| A grid of rows | `marks@1`, `mark: "image"`, `atlas: {asset, cell: [8, 8], padding: 1}`, `grid: {shape, cell, size: [cols, rows], hex?}`, `alive: {array: "<logic>.alive", as: "bool"}`, `columns.tile: {array: "<logic>.tiles", as: "u16"}`, no `n` | #535's form; Mark set: logic columns |
| Units | `marks@1` free rows: `place: "free"`, `grid: {shape: "square", cell: [12, 12]}`, `alive`, `columns: {x, y: {array, as: "f32"}, opacity: {array: "troops.fog", as: "f32"}, tile: {const: 2}}` | #535's free rows; the common `opacity` column |
| A logic item | `{kind: "logic@1", params: {program: <sha256>, step_rate: 60, reads?: [<control ID> \| "<control>.hover"], writes: {<name>: {type, count}}}}` | Logic `logic@1` |
| The ghost | `{kind: "rect@1", role: "part", params: {box: [0, 0, 16, 16], paint: {fill: {role: "accent"}}}, at: {pos: [-64, -64, 0]}}`, and `drivers: {ghost_x: {target: "items/ghost/at/pos/0", expr: "16 * cx", vars: {cx: "controls/place/hover/0"}, fallback: -64}, ghost_y: {… "/at/pos/1", "16 * cy", cy: "controls/place/hover/1" …}}` | Driver; the issue's `<control>.hover` |

### Calls and fields

| Call | What the tests send | What they read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"], at}` | `outcome`, `issues` (`code`, `severity`, `ids`, `path` and their own fields) | existing (#393) |
| `scope` | `{panel, at}` | `state.camera` (`target`, `view_width`), `state.rect`, `state.selection`, **`state.focus`** | existing (#383); `focus` on rows new |
| `input` | `{panel, at, event}`: `{type: "down" \| "up" \| "move", pos: [x, y]}` in panel px; `{type: "key", key}` with `Tab`, `ArrowRight`, `ArrowLeft`, `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter` | **`appended`**, `state` | existing (#383, #504); pick entries, keys over rows new |
| `see` | `{panel, at}` | `tree` (each node's `id`), **`announcements`** (`{t, id, text}`) | existing (#376); focus announcements new |
| `view` | `{panel, at}` | `snapshot.sha256` (a PNG in the evidence store): the panel's live view, **its viewer-class values (hover) included** | existing (#504); hover new |
| `eval` | `{doc, t, pixels: true, at}` | `outcome`, `snapshots[0].sha256`: the document's own frame at t (the golden's frame) | existing (#387) |
| `export` | `{doc, out, video: {codec: "png_seq"}, frame_rate: [4, 1], at}` | `outcome: "exported"`, the PNGs in `out` | existing (#501, #504) |
| **`logic`** | `{doc, steps: n, check?: "logic.determinism", at}` | `steps`, `track`, `check` (below) | **new** |
| scenario `planted` | one of the five names below | | existing form, new names |
| `deep-show screen` | the scenario with `window: [1512, 982]`, `out`, `t`, `scale` (1 or 2) | `ok`, the PNG at `out` | existing (#1162) |

**A pick entry.** A click or a tap on a drawn row of a named set (a press and its release on the same row), or Enter on
the focused row, appends one entry to the document's input track, shown in the gesture's `input` reply's `appended`:
`{t, seq, control: <control ID>, value: {set: <the set's index in rows>, key: [k0, k1]}, writer: "you", …}` (the
issue's Value). `key` is a grid's `[cx, cy]` or, for a set keyed by its row's index (no key column), `[index, 0]`. The
press and the release together append exactly one; a key that moves the focus appends none; a pick changes no
selection. A drag is no click and appends nothing.

**`state.focus`.** While a pick control's rows hold the focus, the focused row's ID: `<set>#<cx>,<cy>` for a set laid
out by `grid.size` (the base's row key there), `<set>#<index>` for a set keyed by its index; a control's own stop is its
ID, as at the base. A pick control with `focus` is exactly one Tab stop, the rows', entered at `focus.start` (default the
first drawn row) with no stop of its own before it; Tab from its rows goes to the next control. Controls keep their
document order.

**Focus announcements.** Each time the focus lands on a row (Tab entering the stop, an arrow, Home, End, or the focus
moving off a row that stopped drawing), `see`'s `announcements` gain `{t, id: <the row's ID>, text: <its label>}`, in
the order made. The default label is the key; the tests read only its integers, in order (`"3, 2"`, `"(3, 2)"` and
`"Cell 3, 2"` all say (3, 2)). A row that doesn't draw is never announced and never a node of `tree` (by `id`).

**Hover.** `controls/<id>/hover/0` and `/1` are the cell under the pointer (`cx`, `cy`) on a pick control's grid rows,
as the pointer moves with no button; none elsewhere. A driver reads them live, in the panel (`view`, the window);
`eval`, an export and every check evaluate hover as none, and a driver var reading none makes the result non-finite, so
the driver writes its `fallback` (Driver). A logic item whose `reads` names `<control>.hover` is refused at check: an
error, not `unknown_field`, whose own fields name `place.hover`, or whose `path` is that read's
(`items/<logic>/params/reads/<i>`) and names the item. The same item reading the control itself is presented.

**The read region.** A logic item that reads a pick control finds, as Logic `logic@1` lays a control out, a u32 count and
4 zero bytes, then each entry stamped since the last step as a u32 player, 4 zero bytes and the pick's 24 B: `u32 set, 4
zero bytes, i64 key[0], i64 key[1]`. Step k reads the entries stamped in ((k − 1) × step, k × step] (#531's rule), each
once.

**`logic`.** `{call: "logic", doc, steps: n, check?: "logic.determinism"}` runs the document's logic items, as its
current revision has them, from step 0 to n − 1 on the document's input track as the hub holds it, replaying it now (as
an `eval` or an export replays it). Reply:

```text
{"steps": [{"step": k, "t": flick, "hash": {<logic ID>: 16 hex}, "arrays": {"<logic ID>.<name>": [value]}}],
 "track": [Entry],
 "check": {"kind": "logic.determinism", "verdict": "PASS" | "FAIL" | "BLOCKED", "failures": [Failure]}}   (with check)
Entry   = the track's entries as `appended` gives them
Failure = {"item", "step", "entry": Entry | null, …}   (#532's DetFailure fields may stand beside these)
```

`hash` is each item's step hash (#531); `arrays` each item's arrays as that step left them (an i32 a number, a bool a
boolean). With `check`, logic.determinism (Check input: logic kinds) runs with this replay as one of its runs: the hub
keeps, per document, the steps it first ran on a track (its record of the play, by the track's entries), and a replay
whose step hash differs from the record's at some step fails, naming that step and the entry or entries it read
(`entry`, or `inputs: [Entry]` as `logic.trap` names them); its seeks and continuation probes are #532's. PASS only
with no failure.

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else; any
other `planted` value stays `bad_input` (at the base an unknown name answers the whole scenario `{"ok": false, "code":
"bad_input"}`). `twins.json` maps each criterion's ID to its twin.

| Name | Criterion | The wrong program |
|---|---|---|
| `pick_resolves_on_replay` | 1 | a pick entry keeps the panel point the pointer pressed at, and every read of the track (a `logic` run, a seek, an export) resolves its row again from that point through the panel's camera as it is then, instead of reading the entry's key |
| `hit_ignores_alive` | 2 | the pick's hit test meets a row whose `alive` is false as if it drew; drawing, focus and the screen reader are unchanged |
| `hit_by_quad_bounds` | 3 | on a hex grid the pick's hit test takes the topmost row whose w × h quad holds the point, not its hexagon |
| `export_keeps_live_hover` | 4 | the export evaluates `<control>.hover` as the panel's live hover, so a driver reading it draws there |
| `focus_stops_on_hidden_rows` | 5 | grid focus moves over, and announces, rows that don't draw as over drawn ones |

## Programs

`programs.ts`, in WebAssembly text assembled by #544's assembler. Each exports `memory` (1 page), `init`, `step`,
`reads_at` and `writes_at` (4096); arrays in declaration order on 8-byte boundaries.

- `world` (`worldProgram`): `tiles: i32` and `alive: bool`, one per cell of a cols × rows grid, row-major: tile (cx + cy)
  mod 2, every cell alive but the plan's `dead`, and its `dies` cell from that step on. Used for the 12 × 12 grid, the
  6 × 6 hex fixture (`hexworld`) and the Oracle lane's strips.
- `rules` (`rulesProgram`): reads `place` (`reads_at` 1024). Every step it copies the read region's first ten u32 words
  into `got` (w0 the count, w4 the set, w5 its 4 zero bytes, w6/w7 key[0]'s low and high words, w8/w9 key[1]'s), and
  lights in `lit` (bool × 144) the cell key[0] + 12 key[1] of the latest entry it read (none before any).
- `troops` (`troopsProgram`): 8 units, unit i at the centre of cell (2 + i, 8), (40 + 16 i, 136) u; `alive` and `fog`
  (f64) 1, but unit 5's alive false (`dead5`) or its fog 0 (`fog5`).

## Fixtures

`fixtures.ts`. The atlas has four solid 8 × 8 px cells: two greens, a unit's red, the picked cell's gold.

- **The 12 × 12 grid** (224 × 224 u page, an 896 × 896 px panel: 4 px a u): `board`, cell [16, 16], grid.size [12, 12],
  at (8, 8), from `world`; `place` names it. Under the base's layout cell (cx, cy)'s quad is centred on (8 + 16 cx,
  8 + 16 cy), so it covers [16 cx, 16 cx + 16) × [16 cy, 16 cy + 16): (120, 56) is cell (7, 3)'s centre, and the floor of
  (120, 56) over the cell is (7, 3) too. The 32 u margin right and below holds no row; a drag there pans.
- **The units** (criterion 2): the grid and `army` from `troops`, drawn above it; `place` names [board, army]; `orders`
  names [army] with `focus`.
- **The hex fixture** (criterion 3; 224 × 160 u, 896 × 640 px): `hexes`, #536's 6 × 6 pointy odd grid, cell [32, 28], at
  the origin, from `hexworld` by grid.size [6, 6] (the same cells as #536's written rows); `place` names it.
- **The ghost** (criterion 4): the grid, `place`, the ghost and its drivers.
- **The focus grid** (criterion 5): the grid, `place` with `focus: {}`, then `speed`; variants with (1, 0) dead, and with
  (2, 2), (4, 2) and (3, 3) dead and (3, 2) dying at step 120.
- **The taste fixture** (criterion 6): the grid, `rules`, `picked` (lit from `rules.lit`, gold, above the board), the
  ghost, `place` with `focus: {}`; camera `view_width` 345 so the page fits the reference window.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#539.` + the first 8 hex digits of the SHA-256 of each criterion's text, trimmed,
white space collapsed, from the live issue. Each test's name starts with `AC<n> #539.<id>`; each file quotes its
criterion in full. Test count: 3 + 4 + 2 + 3 + 6 + 1 = 19 (and 4 in the Oracle lane).

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#539.798cb59a` | `ac1-pick-entry.test.ts` (3) | The click at (120, 56) appends exactly one entry `{control: place, value: {set: 0, key: [7, 3]}, writer: you}` and the selection stays empty; `logic` (60 steps): the step at or after the entry's stamp reads count 1 and the row u32 0, 4 zero bytes, i64 7, i64 3; no other step reads an entry. A drag over the margin pans the camera 16 u (checked); `logic` again: the track holds the same one entry, the same step reads (7, 3), every item's hash at every step is the first run's, and logic.determinism is PASS. `pick_resolves_on_replay`: the click is unchanged, the replay reads (8, 3), the test's check fails naming (8, 3), logic.determinism is FAIL and a failure names the entry (control `place`, its `t`). Fails: an entry per press and release, a key resolved again, a selection, a read region in another layout |
| AC2 `#539.262f22dd` | `ac2-hidden-rows.test.ts` (4) | Drawn: the click on unit 5 at (120, 136) picks `{set 1, key [5, 0]}`; Tab and Right × 7 focus `army#0` to `army#7`, and `army#5` is announced. Alive false, and fog 0: the click picks `{set 0, key [7, 8]}`; Tab and Right × 6 focus `army#0` … `army#4`, `army#6`, `army#7`; neither `tree` nor `announcements` names `army#5`. `hit_ignores_alive`: the click picks unit 5 and the failure names `army#5`. Fails: a hit through a hidden row, a focus or an announcement of one |
| AC3 `#539.78972f29` | `ac3-hex-hit.test.ts` (2) | The design's geometry checked in f64 (the point inside (1, 0)'s hexagon and outside (1, 1)'s, which quad covers it; the second point on their edge); the clicks at (34, 9) and (40, 10.5) each append `{set 0, key [1, 0]}`. `hit_by_quad_bounds`: the first picks (1, 1), and the failure names the point (34, 9). Fails: a hit by quads, a tie to the larger (cy, cx) |
| AC4 `#539.953cfa78` | `ac4-hover-ghost.test.ts` (3) | With the pointer over (2, 3), `view` shows a color at that cell more than 40 codes from the golden's and the golden's own at (9, 6); moved to (9, 6), the ghost's color there and the board's at (2, 3). `eval` after the hover equals the golden at both cells; every exported frame equals it there. The logic item reading `place.hover` is refused, an error naming the read; reading `place`, presented (passes at the base: a guard). `export_keeps_live_hover`: an exported frame differs from the golden inside the item `ghost`'s box, and the failure names it. Fails: no ghost live, a ghost in a golden or an export, a logic read of hover taken |
| AC5 `#539.ece9dcef` | `ac5-grid-focus.test.ts` (6) | Tab, Tab focus `board#0,0` then `speed`. Tab, Right × 3, Down × 2 focus (0, 0) … (3, 2), none appends, each move announced by its label in order; Enter appends `{set 0, key [3, 2]}`. (1, 0) dead: Right from (0, 0) focuses (2, 0), (1, 0) never announced. Hex, `focus.start` (1, 1): Tab focuses it, Up (1, 0), announced. (3, 2) dying at 2 s: focus (3, 2) before, `board#3,1` after, announced after (3, 2) was. `focus_stops_on_hidden_rows`: the failure "the screen reader announces (1, 0)". Fails: a Tab stop per cell, a stop of the control's own, an entry per move, a hidden row focused, the wrong tie, a focus left on a row gone |
| AC6 `#539.95971461` | `ac6-taste.test.ts` (1) | The check run (below) checks its scenario by replies (the focus on (3, 2), one pick entry for (7, 3)), writes the four pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

## The taste call

`ac6-taste.test.ts` is the check run. Through `deep-show screen` (the app's window as #1162's check run draws it, the
panel filling the reference window, 1512 × 982 points) after a prefix of one scenario: present; Tab, Right × 3, Down × 2
(the focus on (3, 2)); a click on (7, 3) (the pick, lit gold from the step after it); the pointer over (2, 3), then
(9, 6) (the ghost). Each window is drawn 300 ms after the prefix's last call. Into `docs/evidence/539/`:

- `grid-focus.png`, `grid-pick.png`, `grid-hover.png`: after the walk, the click and the second move, at 2× (3024 ×
  1964 px), each re-encoded so the same pixels always give the same bytes;
- `pick-focus-hover.apng`: the recording, the window at 1× after each of the ten calls (shown, Tab, five arrows, the
  click, two moves), 2 frames a second.

Each SHA-256 is printed. `tests/acceptance/539/TASTE.json`, written by whoever records the call after the pictures are
attached to the PR and shown in the session: `{"issue": 539, "criterion": "#539.95971461", "verdict": "looks_right" |
"looks_wrong", "who", "when": ISO 8601, "screenshots": {<each of the four names>: sha256}, "note"?}`. A call stands while
this run's four hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## Readings where the issue leaves a choice

- **The square grid's origin.** The design leaves it open (#535's README); `board` sits at (8, 8), so the drawn quad and
  the floor of the position over the cell agree: (120, 56) is cell (7, 3)'s centre either way, and (136, 56), the panned
  camera's view of the same panel point, is (8, 3)'s.
- **"Writes one document entry"** is the press and release's `appended`, together exactly one; **"at its next step"** the
  first step at or after the entry's stamp; **"as u32 0, four zero bytes, i64 7 and i64 3"** the entry's 24 B, after the
  control's count and the entry's player word as Logic `logic@1` lays them.
- **"Replaying the track after the camera has panned by one cell"**: a `logic` run after a plain drag over the empty
  margin moved the camera 16 u along +x (the base's flat-view pan; a pick owns no drag). **"The same step hashes"**: every
  item's hash at each of 60 steps, against the run before the pan. **"Fails logic.determinism, naming the entry"**: its
  verdict FAIL, a failure carrying the entry (control and `t`).
- **"Both named in rows"**: `place` names [board, army], so set 1 is the units; unit 5's key is its index, so its pick is
  `{set 1, key [5, 0]}`. **"Keyboard focus skips unit 5"** is the units' own Tab stop, `orders` with `focus` over [army],
  in reading order (all at one y, so by x): the design gives no order across a grid set and a free one, and `place` has
  no `focus`. **"The screen reader never names it"**: no `tree` node and no announcement with ID `army#5`.
- **"Its opacity 0 from a fog array"**: the units' `opacity` column reads `troops.fog`.
- **The hex fixture's points** are page points: the set is at the origin, as #536's fixture is.
- **"The fixture's golden"** is `eval`'s frame at 1 s with pixels: the document's own frame, its track and view at their
  defaults and no viewer state, the frame a golden records. **"Follows the pointer's cell live"** is the panel's `view`.
  Pictures are sampled at cell centres at each picture's own scale; **"show no ghost"** is the golden's color there within
  3 codes, the ghost's color being more than 40 away.
- **The ghost's drivers** write their fallback, off the page, while hover is none; the ghost's own position is off the
  page too, so a reading where a driver skips its write instead gives the same frame.
- **"Refused at check, naming the read"**: an error naming `place.hover` in its own fields, or its path at that read and
  the item; `unknown_field` doesn't count.
- **"Tab reaches the grid as one stop"**: with `place` (rows, `focus`) and then `speed`, Tab from nothing focuses
  `board#0,0` (the first drawn row) and the next Tab `speed`. **"Each announced by its label"**: an announcement with the
  row's ID whose label's integers are its key, in the order of the moves. **"Enter then writes one pick entry (3, 2)"**:
  Enter's `appended`.
- **The hex tie** starts at (1, 1) by `focus.start`, so only Up's rule is under test.
- **"Focus moves to the nearest drawn row"**: the fixture leaves one nearest drawn row, (3, 1), 16 u from (3, 2) (its other
  three neighbours never draw), so the tie rule doesn't decide it; read after 2 s by `scope`.
- **"A planted focus that stops on hidden rows announces (1, 0) and fails, naming it"**: its announcement is the failure.

## Not tested, because no criterion reaches it here

A tap; Space on the focused row; picks on a logic-fed instancer (`(slot, gen)`) or on a 3D object-ID target; a string
key column refused for a control a logic item reads; `focus.label` templates and `{copy: …}`; the outline's drawing
(only criterion 6's pictures show it); Left on the 12 × 12 grid and off-grid reading order beyond one row of units (the
Oracle lane covers Left, Up and Home/End on small grids); a row out of range or hidden by the view; the read-region forms
of the point (248 B), actions, sticks and looks (16 B) and text, which the Scope lists and the siblings' criteria test;
the cost lines (0.1 ms a hit at 10,000 rows). They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above.
- In `deep-show`: pick controls on rows (the hit, the entry, no selection), `focus` on rows with `state.focus`, the keys,
  focus announcements in `see`, `<control>.hover` (live in `view` and the window, none in `eval`, exports and checks), the
  check's refusal of a logic read of hover, the `logic` call with logic.determinism, the window drawing the focus outline
  and hover, and the five planted names. In the logic module (`deep-logic`): the pick's 24 B in the read region.

`BASE-FAILURE.txt` is the run at the base.
