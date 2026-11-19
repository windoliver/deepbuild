# Acceptance tests for #1498: select and copy text the canvas drew

Written first and blind, from issue #1498 (its Scope, nine acceptance criteria and Proof), the design and the base commit
`d4cef00fb` (origin/main when this job ran; the brief named `f84bba036`, its first parent, and the one commit between them,
#2787's merge, touches no surface used here). No implementation of #1498 existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (technical design: Dogfooding).

## What was read

- `AGENTS.md`; `docs/canvas-primitives.md`: Selection (session state), Text `text@1`, Cell grid `cells@1`, Input router, focus
  and gesture serial, Replica `deep_drive`, Document envelope, Revision, Order keys, Honest numbers, Bound value, Frame and
  group: draw order, Control: picks on rows (reading order "by center y, then x"); `docs/technical-design.md`: Panels and
  devices (trusted ring), One way to interact, Dogfooding.
- Issues #1453, #1464, #1429, #1034 and #241, for context only.
- At the base, for surfaces only: `crates/deep-replica` (`drive/mod.rs`, `locate.rs`, `glyphs.rs`, `frames.rs`, `hubcopy.rs`,
  `plant.rs`, `deep_drive.rs`, `terminal.rs`), `crates/deep-app` (`views.rs`: the session page, its failure lines, Terminal
  button and tab; `cells.rs`; `canvas.rs`; `show.rs`; `text.rs`; `bound.rs`; `states.rs`; `list.rs`; `actions.rs`),
  `crates/deep-canvas/src/scope.rs`, `crates/deep-canvas-marks/src/scene.rs` (counters and the number format),
  `crates/deep-show/src/input.rs`, `packages/hub/src/tools.ts` (`checkArguments`), `packages/hub/src/hub-canvas.ts`,
  `scripts/proof-change.mjs`, `scripts/lanes.mjs`, and the suites #124, #384, #401, #402, #392, #1348, #1454, #1459, #1460, #2652
  for their conventions. The plain-words fixture (`crates/deep-replica/fixtures/plain-words.events.jsonl`) is the model for
  this suite's record.

## How to run

Node 24.22 first on `PATH`, cargo (`PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"` if it isn't), macOS:

```sh
npm ci                                                     # once
npx tsc -p tests/acceptance/1498/tsconfig.json             # typecheck
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/1498 --no-file-parallelism --testTimeout=600000
```

- Each file builds `deep-drive` once in `beforeAll` with `cargo build --locked -q -p deep-replica --bin deep-drive --features
  env-plants` (the planted replicas are selected by `DEEP_DRIVE_PLANT`, as #124's are) and copies it to
  `/tmp/dd1498-bin-<uid>/deep-drive`. A cold build takes 20 to 60 minutes on a loaded Mac; the hook waits an hour. No hub, no
  CLI build and no `npm run build --workspaces` is needed.
- Every replica gets `HOME` and `TMPDIR` in its own `/tmp/dd1498-*` folder, removed after its file; each `deep-drive` is stopped
  by its own PID. Nothing touches the system pasteboard, your hub or the network.
- Off macOS every test fails `INCONCLUSIVE:` (the replica renders on macOS only) and never passes.
- `scripts/lanes.mjs`: add `tests/acceptance/1498/` to `alone` (the files build a binary and run replicas). Nothing goes in
  `byHand`: no test is live, timed or paid. The implementer makes that edit; this job added no file outside this folder.
- With `--root`, Vitest may write `node_modules/.vite/` under this folder; delete it before committing.

## Criteria and tests

Tags are `scripts/proof-change.mjs`'s: `#1498.` and the first 8 hex of the SHA-256 of the criterion's text after `- [ ] `,
trimmed, white space collapsed. Each `describe` carries its tag.

| AC | Tag | Criterion, in short | Test |
| --- | --- | --- | --- |
| AC1 | `#1498.6939e51f` | a drag across two lines of one text copies the exact substring; a line mixing Arabic and Latin copies in logical order; a planted copy in drawn order fails, naming the offset | `ac1-two-lines.test.ts` |
| AC2 | `#1498.394750ea` | a drag across three labels copies three lines in reading order, also when draw order differs; a planted copy in draw order fails | `ac2-reading-order.test.ts` |
| AC3 | `#1498.01d0c6fd` | a press on a button's label fires it and selects nothing; on a map a drag pans and a double press flies in; ⌥-drag on a label selects its text; a click on a figure's label then ⌘C copies the whole label | `ac3-gestures.test.ts` |
| AC4 | `#1498.34117c23` | with a terminal program's mouse mode on, the press reaches the program and the grid selects nothing | `ac4-mouse-mode.test.ts` |
| AC5 | `#1498.0cea7471` | a drag over a failure line on a session's page then ⌘C gives its text; a drag over a row's title selects nothing | `ac5-kit-text.test.ts` |
| AC6 | `#1498.8c09539a` | an ellipsized text copies its whole source string; a bound number copies what's shown, with its unit | `ac6-whole-text.test.ts` |
| AC7 | `#1498.cb27fa53` | a terminal row wrapped across two grid rows copies as one line with no trailing blanks | `ac7-soft-wrap.test.ts` |
| AC8 | `#1498.26ac74e5` | a synthetic input without a serial writes nothing to the clipboard, and no agent tool returns the selection | `ac8-serial.test.ts` |
| AC9 | `#1498.0d8043dd` | selection never appears in the document's bytes, a revision or the record, checked by hash before and after | `ac9-hashes.test.ts` |

What each test does, and the wrong programs it fails on:

- **AC1.** The note (`fixtures/note.doc.json`, one `text@1` of three lines, the third `Paid in ريال سعودي and USD by March`)
  shown on its session's page. Your ⌥-drag from the caret before "rose" on line one to the caret after "held" on line two,
  then your ⌘C, must give exactly that substring, its line break included; your ⌥-drag across the whole third line must give
  it in logical order. The judge (`copyFailure`) names the first offset where the clipboard differs. Planted:
  `copies-drawn-order`, the same drag on the third line: the judge fails, naming offset 8 (where the Arabic run starts), and
  the copy holds the same graphemes in another order. Also fails: a copy rounded to whole lines, one missing the line break,
  one of the whole text.
- **AC2.** `fixtures/labels.doc.json`: two columns of three labels. The first is drawn in the order it reads; the second's order
  keys, its IDs and its JSON order each differ from top-to-bottom. Your ⌥-drag from the start of a column's top label to the end
  of its bottom one, then ⌘C, must give the three texts top to bottom, joined by newlines. Planted: `copies-draw-order` copies
  the second column in draw order, which the judge fails. Also fails: a copy by ID or by JSON order.
- **AC3.** Session `map`'s page shows `fixtures/map.doc.json` and hosts a terminal. Your click on the drawn "Terminal" of the
  page's Terminal button fires it (its cell grid draws, where none drew before); your drag across that label, then ⌘C, leaves
  the clipboard's marker. On the map: your plain drag from the middle of "Fish Market" by [160, 60] device px moves both
  labels by that (±3 px) and copies nothing; your ⌥-drag across "Harbor Lighthouse" copies it and moves nothing (±1 px); your
  double press on "Ferry Terminal" leaves its box at least twice as wide after 1.5 s (a flown-to item spans about 1/1.2 of the
  view, 3.3× here). On session `figure`'s page, your click on the caption then ⌘C copies the whole caption. Fails on: text
  selection inside a control, a press that never reaches the button, a drag that selects instead of panning, a double press
  that selects a word instead of flying, a ⌥-drag that pans.
- **AC4.** Session `build`'s terminal (40 × 6) prints two lines, then turns on mouse reporting (`ESC[?1000h ESC[?1006h`). With
  its tab open, your drag from cell 2 to cell 12 of row 1, then ⌘C, leaves the marker, and the program's input holds the SGR
  press `ESC[<0;3;2M` and release `ESC[<0;13;2m`. Control: with mouse mode turned off, the same drag copies cells 2 to 12
  (`ild finishe`), so the grid can select and "selects nothing" isn't a grid that never selects. Fails on: a grid that selects
  over mouse mode, a press kept from the program.
- **AC5.** Session `fail`'s page shows the failed run's line `expected total 18.01 USD, received 18.10 USD` (kit text, a
  check's failure line). Your drag over another session's row title in the list ("Quarterly forecast"), then ⌘C, leaves the
  marker; your drag over the failure line, then ⌘C, copies it exactly. Fails on: kit selection left off (the base), or on for
  rows too.
- **AC6.** `fixtures/figure.doc.json` on session `figure`'s page. Your click on a 95-character text in a 160 u box (one line,
  ellipsis), then ⌘C, copies the whole source string; your click on a counter of `data/p95` (12.46) with `format {unit: "ms",
  precision: 1}`, then ⌘C, copies `12.5 ms` (a space, no-break space or narrow no-break space between). Fails on: the drawn
  cut string, the source number `12.46`, the number without its unit.
- **AC7.** Session `build`'s terminal (24 columns) prints `rsync: wrote harbor app files to backup`, which wraps after its 24th
  character, a space. Your drag from cell 0 of grid row 0 to the last cell of row 1, then ⌘C, copies exactly that line. Fails
  on: a newline at the wrap, trailing blanks, each grid row trimmed before joining (which loses the space).
- **AC8.** Session `fail`'s page with three copy paths: the failure line (kit text), the note (a document's text, ⌥-drag) and
  its terminal's grid. On each: your selection; an agent's `see` before it (pointer already at the drag's end) and after it must
  be equal but for `focus`; a synthetic ⌘C (no `source`, so no serial) must leave the marker; then your ⌘C must copy the
  selection, so it was live and only the serial differed. Afterwards no call the app made of its hub (`see.hub`) holds a
  selected text, and the hub's strict check of `deep_drive` (`checkArguments`) refuses an agent's `clipboard` call and
  `act.source`. Fails on: a ⌘C gated only on how the selection was made, one path left ungated, a selection exposed in the
  snapshot (a node, an item value, a drawn string) or sent to the hub.
- **AC9.** The note on its session's page. `stored` before; your ⌥-drag across part of it and ⌘C, and your click on it and ⌘C,
  each copying (so both selections were live); `stored` after. The document's hash (checked to be the SHA-256 of its canonical
  bytes, which hold the note shown), canonical bytes, current revision and revision list, and the hash of the record's events
  (canonical JSON), must all be unchanged. Fails on: a selection written as a patch, a revision, or an event.

## The contract (this job's choice; the issue names the replica and its own clipboard, nothing more)

Everything #124's README defines for `deep-drive --out <dir>` stands: one replica a process, JSON lines in and out, `launch`
with `from: "fixture"` and `fixture: <absolute path>`, `open {address}`, `see`, `probe`, `wait_for`, `act`, and the reply
shapes. These tests add the following. All of it is the binary's, for checks: none of it goes in `SCHEMAS.deep_drive` in
`packages/hub/src/tools.ts`, and AC8 checks that an agent's `deep_drive` still refuses `clipboard` and `act.source`.

### Your input and its serial: `act.source`

- `act.source: "hid" | "synthetic"`, on any `act`. With `"hid"` the act stands for your hardware input in the replica's own
  world: the replica's input router gives it a gesture serial, as the app's router gives your press one, so what needs a
  serial (here, the clipboard write of a ⌘C) can happen, into the replica's own clipboard only. Without it, or with
  `"synthetic"`, the act is the replica's synthetic input, as at the base: it carries no serial, so it can't write the
  clipboard (design, Replica: "Actions are synthetic and mint no gesture serials"). A press's serial is the press's own: the
  ⌘C that writes the clipboard must carry one, whatever made the selection.
- Nothing a `hid` act does reaches your Mac: #124's isolation criterion stands (the system pasteboard, your record, focus,
  sound).

### Pointer actions from a point, and modifiers

- `act.kind: "drag"` takes `point: [x, y]` with no locator: the press at that point, moves in steps (at least 8) to `to_point`
  (or `to`), the release there; no wait for stillness and no hit test, as `click` and `hover` take `point` at the base (#1461,
  #1482). `double_click` takes `point` the same way (two presses at that point).
- `act.mods: ["alt" | "shift" | "cmd" | "ctrl"]`: modifier keys held through a pointer action, its press, moves and release,
  as the platform reports keys held (the window's modifiers change before the press and back after the release). The tests
  use `["alt"]` for ⌥-drag.

### The caret locator: `{item, offset}`

`{"item": "<text item ID>", "offset": n}` is the caret before grapheme `n` of that text item's source text, counted in logical
order (`n` = the text's length is the caret after its last grapheme). Where a locator goes it names a box `[x, top, 1, h]`: `x`
the caret's x, `top` and `h` its line's, in whole device px; `probe` answers it with `point: [x, top + h / 2]`. The caret comes
from the shaped run the item is drawn from, as the selection's own hit test does, so a press at that point lands at that
offset. The tests use it with `probe` only, then drag between the points it gives.

### Documents in the replica: `show`, and their items in `see` and `{item}`

- `{"call": "show", "show": {"session": "<session ID>", "document": <document>}}` → `{"doc": "<doc ID>", "rev": n, "hash":
  "<64 hex>"}`: the replica's own copy of the hub takes the document as that session's `deep_show` (a whole revision from the
  session's agent), through the canvas core the hub runs: checked, made current and presented; `hash` is the revision's, the
  SHA-256 of the canonical document (Revision). The app draws it where it draws that session's revisions, on the session's
  page, and your input over it reaches the core as the app's input does: a flat view where a drag pans, a pinch or scroll zooms,
  a click selects an item and a double press flies in (design: One way to interact). Then one frame. A document the check
  refuses answers `ok: false` with its issues.
- Each drawn item of a presented document is a canvas item of the frame: `see.snapshot.items` lists it by its item ID with its
  evaluated value, and `{"item": "<item ID>"}` locates it at its drawn box in the window, in device px. An item's value is a
  function of the document, the time and the view, never of a selection or a hover (AC8 compares snapshots).

### A session's terminal: `terminal`

`{"call": "terminal", "terminal": {"session": "<session ID>", "size": [cols, rows], "output": "<text>"}}` →
`{"terminal": {"session", "size", "input": "<text>"}}`. The first call for a session opens the terminal the replica's copy of
the hub hosts for it, as the hub hosts a session's terminal (#402), at `size`; later calls may leave `size` out. `output` (may
be empty or left out) is what the session's program writes, as UTF-8 (`\u001b` is ESC), which the terminal's emulator takes as
it takes a program's output. `input` is every byte the terminal has sent its program since it opened (mouse reports, keys), as
a string. The session page's Terminal tab draws this terminal through `cells@1`, as at the base (its `canvas.user` `cells`
call reaches the replica's copy of the hub). Then one frame.

### The replica's own clipboard: `clipboard`

`{"call": "clipboard"}` → `{"clipboard": {"text": string | null}}`: what the replica's own clipboard (GPUI's test platform
clipboard, which never reaches your Mac) holds now. `{"call": "clipboard", "clipboard": {"write": "<text>"}}` puts `text` there,
as another app's copy would, and answers the same. Neither sends the app input or passes a frame. The tests put a marker there
before each ⌘C, then poll for up to one second of the replica's clock until it changes.

### What the replica's copy of the hub stores: `stored`

`{"call": "stored"}` → `{"events": [<every event of the replica's record, in log order>], "documents": [{"doc", "session", "rev",
"hash", "canonical", "revisions": [{"rev", "hash"}]}]}`: the record (the fixture's events, fed ones and those the copy of the
hub appended), and each presented document: its current revision `rev`, its `hash`, its canonical bytes as text (`hash` is
their SHA-256; Revision: the canonical document), and every revision it holds, in order.

### Planted programs (`DEEP_DRIVE_PLANT`, an `env-plants` build only)

| Name | The wrong program | Test |
| --- | --- | --- |
| `copies-drawn-order` | ⌘C writes a text item's selected graphemes in the order they are drawn, left to right on each line, instead of logical order | AC1 |
| `copies-draw-order` | ⌘C joins selected text items in their draw order (writer layer band, layer order, then item order key, ties by ID) instead of reading order | AC2 |

Everything else about a planted replica is the honest one's. An unknown name exits 2 after one line, as at the base.

## Fixtures

- `fixtures/record.events.jsonl`: seven working sessions of one work run (the plain-words fixture's event shapes), every event on a
  whole minute 29 to 60 minutes before the replica's `NOW`: `fail` "Checkout totals" (a claim, a failed run whose `actual` is the
  failure line, a FAIL verdict), `note`, `labels`, `map`, `figure`, `build` and `row` "Quarterly forecast". IDs in `helpers.ts`.
- `fixtures/note.doc.json`, `labels.doc.json`, `map.doc.json`, `figure.doc.json`: figure documents of 800 × 450 u with an
  orthographic camera whose pan isn't bounded, text in the body role. No literal text holds a digit or a number word (Honest
  numbers); the one number is the counter of `data/p95`, sourced `story` in a document that binds no status or reading.

## Readings a redraft may revisit

- **Pan views and ⌥-drag.** Every document view pans (design: "The same gestures work on the Map, the lines, charts and
  figures: drag pans"), so in a document the text drag is ⌥-drag (Scope: "⌥-drag selects part of it"), and one ⌥-drag crosses
  items (Scope: "One drag can cross text items in a view"). AC1 and AC2's drags are ⌥-drags for that reason; a plain drag there
  pans, which AC3 requires. Plain drags select in views with no pan: kit text on a page (AC5) and the cell grid (AC4, AC7).
- **"A map"** is a flat document view where a drag pans and a double press flies in, which `map.doc.json` is; the app has no
  map view of its own at the base. **"A figure's label"** is a text item in a figure document.
- **Reading order** is top to bottom by place (the design's "reading order by center y, then x"); **draw order** is the order
  keys (Order keys: 2D draws by band, layer order, then item `order`). The base's Tab stops sort controls by order key; the
  criterion's "also when their draw order differs" needs reading order to be the spatial one.
- **"Fires the button"** is the Terminal button's own effect: its tab opens and a cell grid draws. The button is the session
  page's, a kit control at the base, and "its label" is its drawn text.
- **"The press reaches the program"** is the SGR report a program that asked for modes 1000 and 1006 gets (#402's README), for
  your press; a press with no serial isn't tested.
- **"Selects nothing"** is judged by the clipboard: a ⌘C after it leaves the marker. No pixel of the highlight is judged here;
  whether it is an outline is the compositor's, for a person's look.
- **"No agent tool returns the selection"** is read in the replica: an agent's `see` doesn't change with a selection, nothing
  the app sends its hub holds the selected text, and an agent's `deep_drive` can't read the replica's clipboard or give an act a
  serial. A hub tool over a real record isn't run here.
- **Cell geometry.** The grid's item box is its cells edge to edge (`crates/deep-app/src/cells.rs`), so a cell's place is the box
  divided by the size; drags start a quarter cell in and end three quarters in, so both end cells are inside under either rule
  of which cell a point picks. A soft-wrapped row's cells were all written, so its last cell, a space, is part of the line.
- **"What's shown, with its unit"** is `12.5` then `ms`, with a space, a no-break space or a narrow no-break space between them.
- **Timing.** Each ⌘C is read for up to one second of the replica's clock; a write that comes later counts as none.
