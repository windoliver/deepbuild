# Acceptance tests for #1162: one agent piece through deep show with a chart, a formula placed beside it, a swept 3D frame in a finished look and a spring, read back, popped out and pointed at, the same every run

Written first, from issue #1162 (its scope, its seven acceptance criteria and its proof line), the design sections it
links and those they lean on, and base commit `5f63620c` ("Merge pull request #1221 …
worktree-github-issue-669-f74ae6"), by a job that never saw an implementation of #1162; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(technical design: Dogfooding).

What was read:

- `docs/technical-design.md`: The canvas core (1051), with its module table, build sets and `module_missing`, and its
  Conventions; Document (1088: "one whose canvas module this build lacks is refused with `module_missing`, naming the
  module, and a check that needs it is BLOCKED"); Item and kind; Render-back (1501) and Document check (1509); How we
  know version 0 works and its blank guard (2544: "luma at most 0.06 over at least 98% of its pixels"); the reference
  window (2674: "1512 × 982 points at 2×"); Dogfooding (2524); Tests written first (2555).
- `docs/canvas-primitives.md`: the path grammar (38: "A channel may key `data/<name>`"; "A sub-address after `#` names
  a part of an item"), Handles (46), the status-color rule (68: "Status colors draw unlit, after tone mapping and
  effects"), Honest numbers (76), Document envelope (`look: {asset: look@major, theme}`), Render-back (939) and its
  diagnostic modes (954), What holds a document to its rules (8170) with Check input, Honest numbers (8863) and the
  Status guard (9223), point and ask's attachment (2347).
- At the base, the merged suites the issue's dependencies define, for their surfaces only: `tests/acceptance/670` and
  `671` (the checkpoint form), `403` (claims, `verdict`, `verdicts`, BLOCKED rows), `411` (deep_query), `412`
  (deep_kinds), `376` (`see`), `400` (displays, `pop_out`, `windows`, `presented`, `card`), `384` (`ask`, `messages`,
  the playhead, the planted boxes), `488` (`determinism`, `play`), `489` (spring keys), `397` (`table_import`,
  `numbers`), `398`, `221`, `375`, `374`, `373` (the 2D kinds' fields), `420`, `441`, `421`, `417`, `418`, `381`
  (scene data, `curve@1` and `extrude@1`, `view3d`, the status report, looks, glyph runs); `crates/deep-show` (the
  call parser in `main.rs`, `hub.rs`'s calls, `snapshot.rs`'s reply entry, `media.rs`'s `table_import`,
  `evidence.rs`'s layout, `Cargo.toml`'s features) and `packages/evidence`, to learn the surfaces only.

## Run them

```sh
npm ci && npm run build --workspaces        # once, if node_modules or built packages are missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 npx vitest run tests/acceptance/1162 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1162/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds what it uses, once, in the checkout, copies each binary out of the target folder
(`CARGO_TARGET_DIR` honoured) under its own name, and fails each test that uses a build that failed:

| Build | Command |
|---|---|
| `deep-show` | `cargo build --locked --bin deep-show --no-default-features --features full` |
| `deep-show-no-data` | `cargo build --locked --bin deep-show --no-default-features --features full,test-leave-out-data` |
| `deep-gpu` | `cargo build --locked --bin deep-gpu` |
| `deep-canvas-render` | `cargo build --locked --bin deep-canvas-render` |

So the files run one at a time: `scripts/lanes.mjs` needs `tests/acceptance/1162/` in its `alone` list, beside the
earlier checkpoint suites; this README is the instruction, and the implementer makes that edit. Each test writes into
its own temporary folder (the evidence store, documents, view3d targets) and deletes it. The tests use node built-ins,
vitest and `packages/evidence`'s public entry.

AC4's outline test draws on the GPU on macOS (Metal), as #421's does: off macOS, and wherever `deep-gpu` answers
`unsupported_platform`, it fails with a message that starts `INCONCLUSIVE:`, never passes. AC3's glyph-run test runs
`deep-gpu` on its noop backend, as #381's does. Nothing else needs a GPU. No test is gated on power or load.

**The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1162-proof/` (`PROOF_DIR`), rewritten on each run
and never read back except `ac7/` (below): `ac1-piece.json` (the document), `ac1-replies.json`,
`ac1-no-data-replies.json`, `ac1-no-data-snapshot.png`, `ac1-no-data-kinds.json` (each reply with its issues, the
claim's check rows, deep_kinds' listing); `ac2-snapshot-<t>.png` and `ac2-hashes.json` (snapshots with hashes from
both runs and the fresh process), `ac2-determinism.json`, `ac2-play.json`, `ac2-planted-seeds_noise_from_clock.json`;
`ac3-summary.json`, `ac3-kinds-listing.json`, `ac3-sampled-rows.json`, `ac3-glyph-runs.json`,
`ac3-planted-relation_from_previous_box.json`; `ac4-unbound-replies.json`, `ac4-bound-replies.json`,
`ac4-outline-final.png`, `ac4-planted-status_before_tone_map.json`; `ac5-see.json` (the accessibility tree with its
announcement), `ac5-presented.json` (each window's presented frames), `ac5-card.json`; `ac6-ask.json` (the
point-and-ask message as sent and as received), `ac6-planted.json`. Nothing in it is personal: sessions, processes and
handles are the fixtures'.

`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue drives merged modules through their public surfaces: `deep show` from a test process standing in for an
agent, the claim with the document checks, the replica on the virtual display clock with two displays, and a test
agent session for point and ask. No new binary. The tests use the merged surfaces exactly as their suites define them
and add only what a criterion needs and the base lacks, each named below.

### The hub: `deep-show run` (#393's scenario binary)

One scenario per stdin line (each a fresh run of the hub), one `{"ok": true, "replies": […]}` line out per line in.
The world (`helpers.ts`): one agent session `sess-piece` (thread `thread-piece`, process 4100); its tool shell 4101
and the test process 4102 that runs `deep show`, so every `{"call": "deep show", "peer": {"pid": 4102, "start":
1200}, "doc", "document", …}` is the agent's (#393 AC4, AC6). One panel `main` of 960 × 540 holds the document
`01JB1162D00000000000000001`. `record` holds the verdict `verdict:01JB1162V00000000000000001`, state `fail`, which
AC4's binding reads (#670's form). `claims` holds #403's claim `claim:01JB1162C00000000000000001`: the piece is its
deliverable, with three requirements, `document.validate`, `honest_numbers` and `document.determinism` (`at_times`
0, 1, 2 and 4 s, `compare: same_machine`).

Calls, by criterion:

| AC | Calls and fields read |
|---|---|
| AC1 | `table_import {path, key: "key", session}` (#397: the agent's table, `asset.sha256`); `deep show` with `check: true, claim, t: "0s", size: [960, 540], include: ["issues", "pixels"]` (`outcome`, `issues`, `snapshots[0].sha256`, `visible[].id`); `revisions` (the `current` one's `hash`); `verdict {claim}` and `verdicts {claim}` (#403: `result`, `stale`, `key.revisions[].hash`, `requirements[].{id, result, blocked[].{code, kind}}`); `deep_kinds {op: "list", registry: "kind@1", cursor?}` (#412: `registries[].entries[].{name, available, code}`, every page by `next`) |
| AC2 | `deep show` with `t` `0s`, `1s`, `2s`, `4s`, `size`, `include: ["issues", "pixels"]` (`snapshots[0].sha256`, the PNG read back through `packages/evidence`); `determinism {doc, display_hz: 60, at_times: [flicks]}` (#488: `frames[].{play, seek}.pixels`); `play {doc, display_hz: 60, to: 6 s}` (#488: `outcome`, `drawn`, `last_drawn`) |
| AC3 | `deep_query {session, doc, what: "summary"}` (#411: `summary.{items, by_kind, by_layer, by_module}`); `registry` (`kinds`: kind → module); `deep_kinds {op: "list"}` (`modules[].{name, version, kit.verdict}`); `deep_query {session, doc, paths, at}` (`values[path][i]`); `read {doc, session}` (`document`, the piece as the hub holds it) |
| AC4 | `deep show --check` and `verdict` (the `honest_numbers` row's `result`, `issues[].ids` and `numbers`); a refused whole revision (`outcome: refused`, `issues[].{severity, ids}`); `revisions`; `read` |
| AC5, AC6 | the app world below |

### The app: the replica on the virtual display clock (#400, #384, #376)

`clock: {lead: 2 ms, check: 0.5 ms}` with no refresh, and `displays`: #400's A (the built-in display, 120 Hz, listed
first, so the main window opens on it) and B (60 Hz, its vsyncs 3 ms out of phase), `window: [1200, 700]`. Every call
carries `at` in flicks. The table is imported at flick 1 and the piece shown at flick 2, so the piece's time is the
clock's (#384: an attachment's `t` is "the playhead's time, else the clock's"). Each step replays the whole scenario
from the start with its calls added (#400's `Driver`). Calls: `scope` and `input` down/up (a click and its `serial`),
`pop_out {panel, display, serial}`, `windows`, `presented {panel}` (`frames[].{vsync, display}`), `card` (the
scenario's `card`, an ask arriving at 2.6 s; `card.display`), `see {panel}` (#376: `tree[].{id, name, role}`,
`announcements[].{t, id, text}`), `input` with `{type: control, control: playhead, value}` (#384), `ask {panel,
session, words, pointer}` and `messages {session}` (#384: `messages[].{words, attachment}`), `deep_query` and
`revisions`.

### The app's 3D view: `deep-gpu run` (#377, #378, #421)

As in #671: the document `read` returns is written to a file and opened by `view3d` unchanged, with `look` the piece's
look (`fixtures/look.json`, the look object #418's and #421's suites pass) and `assets` (#420: each SHA-256 the piece
names, at its file in the hub's evidence store). AC4: `size: [960, 540], frames: 1, capture: [0], targets: ["final",
"ids"], states: {<verdict>: "fail"}` on Metal (`status.marks[].{item, state, color, label}`, `status.legend`, the
final PNG and the object-ID target with `picks`). AC3: `labels: true` on `--backend noop` (`frames[0].labels[].{item,
glyphs}`).

### The 2D glyph run: `deep-canvas-render raster` (#381)

`{out, doc, look}` with `look` the piece's roles as #381's role map; `texts.title.glyphs`. `doc` is a 2D document
holding only the title item exactly as the hub stores it, with the stored `layers`: a text's glyph run depends only
on its own item.

### Added here (absent at the base), each named for the implementer

- **`relation_from_previous_box`**, a scenario `planted` value (AC3; the proof's "relation solved from the previous
  frame's box"): `at.place` relations are solved against the target's box as the previous evaluation in this run of
  the hub left it (with none before, its box at time 0), everything else as shipped. The base's
  `--planted relation_reads_previous_place` swaps marks2d's `constraint@1` entries, which the kit refuses at the seal
  (exit 2), so it never draws a frame and can't stand in here.
- **deep_kinds kind entries with `code: "module_missing"`** (#412's README names `Entry.code?`; the base lists no kind
  of an absent module) and **module rows with `kit: {verdict}`** (the base's `modules[]` hold `name` and `version`
  only). AC1 and AC3 read them.
- **The `honest_numbers` row's `numbers`**: the verdict's requirement row for `honest_numbers` lists each number it
  traced, in #397's `check` entry form, `{item, row, text, source: {table, column, row, …}}`. AC4 reads it.
- **deep_query paths `items/<id>/bounds`**: an item's evaluated box at each time, `[[x, y, z], [x, y, z]]` (#411 AC7's
  `bounds` form) or `{min, max}`, in document units, as the core's bounds array holds it (Render-back: diagnostic
  modes' `bounds`).
- **3D through the hub's render-back, `determinism` and `play`**: the piece's 3D items are part of the piece the hub
  renders back; the tests don't separate them.
- **AC7's files** (below).

Read as the base already gives them: a `deep show` reply's `visible[]` (Render-back: "a table of visible item IDs
with screen boxes"; AC1 reads its `id`s) and `deep-gpu --planted status_before_tone_map` (#421: "the status outline is
drawn into the linear target, so the tone map tints it"), which is the proof's "finish that tone-maps the status
outline", unchanged.

### Planted programs

| Name | Where | Criterion | Exists at the base |
|---|---|---|---|
| `seeds_noise_from_clock` | scenario `planted` | AC2 | yes (#670) |
| `relation_from_previous_box` | scenario `planted` | AC3 | no: added here |
| `status_before_tone_map` | `deep-gpu run --planted` | AC4 | yes (#421) |
| `box_drops_doc_rev` | scenario `planted` | AC6 | yes (#384) |
| `box_folds_quote` | scenario `planted` | AC6 | yes (#384) |

Each failure a planted program gives starts with its criterion's ID (`AC2 …` is named by the snapshot, `snapshot at
<t>`), and the test requires one naming the snapshot, `AC3 formula`, `AC4 frame`, `AC6 doc_rev` or `AC6 quote`.

### The test build without the data module (AC1)

The cargo feature `test-leave-out-data` of `crates/deep-show`, which the base already has (#489 built it to compare
motion@1's digest without data): `--no-default-features --features full,test-leave-out-data`, the full build set with
the data module left out. It is how the merged suites drop a module (#403's `test-leave-out-logic`, #238's
`test-leave-out-sandbox`); no scenario field or environment variable does.

## Fixtures

Written by this job before any implementation ran, as the agent sends them (no `id`, no `layers`, no item `layer`;
items keyed by ID, each given its `id` by `piece()`):

- `fixtures/piece.json`: a `film`, 960 × 540, `transport.span` 4 s, `seed` 1162, `camera: "cam"`, `look: {asset:
  "piece-look@1", theme: "light"}`, `requires.modules` naming marks2d, data, vector, motion and scene3d. Its assets:
  `sales` (the table, by SHA-256) and `piece-look` (the look). 2D: the title `title` (`text@1`, "Sales by region", 28
  px); a row frame `row` (`frame@1`, `layout: row`, gap 24) holding the badge `badge` (`star@1`, five points, accent,
  in `badge-cell`, a 64 × 64 fixed `frame@1`, since #375's row children are fixed frames and text leaves) and the
  chart `chart` (`frame@1`, 400 × 240 fixed) with its scale `ys`, the five bars `bars` (`marks@1`, `mark:
  bar`, keys and values from the agent's table, a stepped fill over its rows from `bar.a` to `bar.b`), their value
  labels `labels` (`marks@1`, `mark: text`, text from the table's `value` column) and `sheen`, a rect whose linear
  gradient spans the chart (`span: parent`), over the bars; the formula `formula` (`vector@1` of `formula.svg`, "s = a
  + b + c", `write_on` keyed 0 → 1 over 0–1.2 s), placed `beside: chart, side: e, gap: 24`; the readout `readout`
  (`text@1`, `Count: {data/count}`, `data.count` a story number keyed by the channel `count` to 3 at 0 s and 4 at
  2 s); one control `c-values` (a toggle, label "Show values", role `switch`). Parts (`role: part`): `row`, `badge`,
  `chart`, `formula`, `frame`. 3D: an orthographic `camera@1` (view width 24 m, so 40 px per metre about the frame's
  centre), a sun and a sky, `wood` (`material@1`), `path` (`curve@1`, a closed linear 6 × 4.2 m rectangle, tilted),
  `frame` (`extrude@1`, a 0.5 m square swept along `path`, material `wood`), and `label` (`mark.text@1`, the title's
  text at 28 px in screen size, facing the camera). Channels: `write`; `row-x`, which slides the row from x 24 to 64
  over 0–2 s (so the relation has a moving target); `badge-sx` and `badge-sy`, the badge's scale keyed from 0 at 0 s
  with `interp: {spring: {decay: 6.5, omega: 15}}` and `velocity: 6.5` to 1 at 4 s (#489's form, whose value is
  1 − e^(−6.5t)·cos(15t)); `count`.
- `fixtures/table.csv`: the agent's table, `key,region,value`, five rows; `fixtures/table-patched.csv`: the same with
  row 2's value 31 → 36.
- `fixtures/formula.svg`: seven parts with ids (`lhs`, `eq`, `t1`, `p1`, `t2`, `p2`, `t3`) filling a 240 × 64
  viewBox edge to edge, so the formula's bounds are its box; `eq` is the `=` sign, two bars at x 40–64, y 22–42.
- `fixtures/look.json`: `piece-look`, a physical look in #418's look-object form: the clean status map and glyphs, a
  filmic tone map at the exposure whose scale is 1, ambient occlusion (#418's defaults), `deband: spatial` with
  `deband_lsb` 1, bloom (intensity 0.04, radius 0.85); a light paper ground and data roles each at least 0.12 OKLab
  from every status color, so a status binding can be added.

The variants are made in `helpers.ts`, each changing nothing else: `bound()` adds `status_bindings: {"frame-state":
{target: "items/frame/params/paint/stroke", source: <verdict>}}` (on a 3D object a binding takes its stroke slot,
drawn as its outline, #421); `failMaterial()` is `bound()` with `wood`'s `base_color` `{role: "status.fail"}`;
`withTable(sha)` swaps `assets.sales.sha256`. The formula's SVG and the look are put into each scenario's evidence
store at their SHA-256, the layout the hub's `evidence::put` writes; the table is imported by `table_import`.

## Criteria to tests

Each test's name starts with its criterion's ID; each file's head quotes its criterion and names in `asserts` what
carries it and the wrong programs it fails on.

| ID | Criterion | Tests |
|---|---|---|
| AC1 | The piece is presented with no issues and its document checks read PASS keyed to the revision's hash; a patch to one bar's table value makes that PASS stale. In a test build without the data module the rest still draws, deep_kinds lists the data module's kinds unavailable with module_missing, and the claim reads BLOCKED naming the chart's kind, never PASS | `present.test.ts` (2) |
| AC2 | Render-back at 0, 1, 2 and 4 s gives snapshot hashes equal on a second run and in a fresh process on one machine, blank guard first; seeking to each time equals playing to it; and from 4 s, with nothing moving, no frame is presented for 2 s. A planted renderer that seeds noise from the clock fails, naming the snapshot | `renderback.test.ts` (2) |
| AC3 | deep_query's summary equals the document's counts by kind, writer layer and canvas module, and deep_kinds lists each of those modules with its version and a passing kit. At 120 sampled times the formula's west side reads 24 u ± 0.5 px from the chart's east side and the badge's scale 1 − e^(−6.5t)·cos(15t) within 1e-12, seeked and played; the label in depth shapes to the 2D title's glyph runs | `query.test.ts` (3) |
| AC4 | With no status binding, honest numbers passes, each bar label traced to the agent's table. With a verdict binding added on the frame, its outline draws in the exact status color after tone map and bloom, and honest numbers fails naming each label's row. A revision that writes the fail color on the frame's material is refused naming the item, and the last good revision stays shown | `status.test.ts` (3) |
| AC5 | The replica's accessibility tree holds one node per part and control with its name and role, and the readout's change emits exactly one announcement, '4'. Popped out to the second display, the view reopens there and presents at that display's rate, and the question card opens on the display you're using | `app.test.ts` (1) |
| AC6 | Pointing at the formula's part `#eq` in the popped-out window, paused at 1.5 s, and typing "too small" gives the test agent's session one message with that handle, t in flicks, the revision you saw and precision id, your words apart; the title's text arrives only as quote. A planted box that drops doc_rev or folds the quote into your words fails, naming the field | `ask.test.ts` (1) |
| AC7 | Shown to you: screenshots … taken by the check run from the app at the reference window, with a recording of the spring and the sweep … Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `shown.test.ts` (1) |

### AC7: the check run's files and the taste call

The check run (the implementer's capture from the app, a replica launched at the reference window, run before this
suite and named in the PR) writes into `$TMPDIR/deep-1162-proof/ac7/`:

| File | What it shows |
|---|---|
| `chart-formula.png` | the bar chart with its formula beside it |
| `frame-3d.png` | the swept 3D frame in its finished look |
| `spring.png` | the badge mid-spring |
| `spring-sweep.mp4` | a recording of the spring and the sweep |

Each screenshot is a PNG of the reference window, 3024 × 1964 px (1512 × 982 points at 2×); the recording an MP4.
`shown.test.ts` checks that they exist and have that form, prints their SHA-256s, and never reads their pixels. Those
files are attached to the PR and shown to you in the session; your answer is recorded in
`tests/acceptance/1162/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it
(#1174's form):

```json
{"issue": 1162, "criterion": "AC7", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "files": {"chart-formula.png": sha256, "frame-3d.png": sha256, "spring.png": sha256, "spring-sweep.mp4": sha256}, "note"?: string}
```

A missing or malformed file fails. No `TASTE.json` is INCONCLUSIVE; a call whose `files` aren't this run's SHA-256s
is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's files passes.

## Readings where the issue and design leave a choice

- **"One piece"** is one document holding the 2D and the 3D items, the 3D writer layer drawing its 2D items as
  overlays (canvas primitives: Writer layer). The agent writes it alone, so it is one writer layer.
- **"A patch to one bar's table value"**: a table is an asset by hash, so the agent writes the table again with bar
  2's value changed, imports it and sends the piece naming the new hash, a whole revision whose only change is
  `assets.sales.sha256`.
- **"Presented with no issues"** is `issues: []`, no issue of any severity.
- **"The rest still draws"**: the piece is presented, its snapshot passes the blank guard, and the reply's visible
  items hold the title, the formula, the badge and the readout and neither mark set. "The data module's kinds" are
  read as at least `marks@1` and `scale@1`, the two the piece uses; "the chart's kind" is `marks@1`.
- **Seeking equals playing** in AC2 is the time core's own comparison (#488's `determinism`), and in AC3 #489's
  convention: played is one read with every time in ascending order, seeked a fresh run per time.
- **"No frame is presented for 2 s"** is #488's `play` to 6 s: its `last_drawn` is at most 4 s.
- **"24 u ± 0.5 px"**: snapshots are the piece's size, so 1 u is 1 px; the gap is `formula.minX − chart.maxX`.
- **The 120 sampled times** are t = k/30 s, k = 0…119 (frames 0, 2, …, 238), all inside the spring's segment, which
  ends at its next key at 4 s.
- **The label in depth's glyph run** is compared with the title's as #381 compares a label with its 2D twin: face,
  size, glyph ID, grapheme and position in the run, f32 for f32. The label is the title's text at the title's font
  role and size, in screen size.
- **"Its outline draws in the exact status color after tone map and bloom"** is #421 AC5's check on the piece's 3D
  view, in its finished look (filmic tone map, AO, deband, bloom).
- **"Refused naming the item"**: an error whose `ids` hold `wood` (the material item the color is written on) or
  `frame` (the item it colors). "The last good revision stays shown" is the current revision unchanged.
- **The parts and controls of the tree** are the items whose `role` is `part` and the document's controls; a
  control's node name is its `label`. "Exactly one announcement, '4'" is one announcement in the whole run, the
  readout's, at or after 2 s, its text holding "4" and not "3".
- **"Presents at that display's rate"**: between 0.5 s and 1.5 s, while the piece moves, every frame of the popped-out
  view is at one of B's vsyncs and paced by B, 60 of them. "The display you're using" is the display of your latest
  input, a click in the popped-out view.
- **The pointer**: window px of the popped-out window, one px per document unit from the view's top-left, as #384's
  pointer reads the main window. It is put on the `=` sign's centre at 1.5 s from the formula's bounds and the SVG's
  geometry.
- **"That handle"** is `doc:<doc ID>#formula#eq`, the handle grammar's fragment holding the item and its part
  (Handles; vector@1's parts named by the SVG's ids). The doc ID compares case-folded, as #384's suite does.
- **"The title's text arrives only as quote"**: the attachment's `quote` is "the text of a text item under the
  pointer". The piece places the label in depth, which carries the title's text, behind the formula's `=` at 1.5 s
  (its anchor 150 px left of and 5 px above the sign's centre, so its text box holds the pointer whichever corner or
  centre anchors it), so pointing at `#eq` has the title's text under the pointer: the quote is exactly it, and it
  appears nowhere else in the message.
- **The proof's "planted point-and-ask box"** is #384's two boxes, `box_drops_doc_rev` and `box_folds_quote`.

## What the base does differently from the design (found while writing these tests)

From running the base (`BASE-FAILURE.txt`, which also lists two debug runs with `piece.json` changed by hand and
restored); none of it changed an expectation:

- A channel targeting `data/count` is refused `bad_path` ("a path names at least one field below the ID"), though the
  path grammar says "A channel may key `data/<name>`"; `data/count/value` is refused too ("motion.compile can't
  evaluate this").
- In the full build, `text@1`, `rect@1`, `frame@1`, `star@1`, `marks@1`, `scale@1`, `vector@1` and `sky@1` are not
  in the kind registry, so each such item is skipped with an `unknown_kind` notice (#411's AC1 redraft records the
  same for the 2D kinds).
- A `star@1` straight in a row frame is refused `no_box`; the fixture follows #375's form (a fixed frame child) by
  putting the badge in `badge-cell`.
- `deep show` doesn't read a table that `table_import` keeps (`asset_missing` at a `{from: asset}` column); #397's
  suite read such tables only through `deep-canvas-render`.
- In the build without data, the whole piece is refused `module_missing` at `requires/modules/data`, where AC1 asks
  that the rest still draws.

Not tested, because no criterion asks: the formula's write-on pixels, the stepped fill's and the gradient's colors, AO,
deband or bloom measured on their own (#418's), the badge's pixels, the 3D frame's geometry (#441's), the dark theme,
and the planted programs other suites already hold their criteria to.
