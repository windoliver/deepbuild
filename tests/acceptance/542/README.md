# Acceptance tests for #542: game input: text for logic and the scroll control

Written first, from issue #542 (its Scope, its Fields, ten acceptance criteria, its Proof line and its Oracle line), the
parent #187 for what the sibling parts own, the design sections the issue links and those they lean on, and the base
commit `a50d92323` ("Merge pull request #2504"), by a job that never saw an implementation; none existed, and no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, each test carrying its
criterion's ID, and exactly the six planted twins the criteria name. The Oracle line says no upstream test checks these
criteria, so there is no Oracle lane.

## What was read

- The issue (`gh issue view 542`) and its parent #187 (#539 owns picks on rows, grid focus and hover; #540 the point
  control; #541 actions, key repeat and pads; #543 the camera's goto, edge pan and mouse look). Their behaviour isn't
  tested here.
- `docs/technical-design.md`: Control and input track; Dogfooding.
- `docs/canvas-primitives.md`: Scope and input classes; Input router, focus and gesture serial; Seam and backend (the
  input seam) and its device classes; Control; Control: text; Control: kinds as a registry; Control: scroll; Input track;
  Logic `logic@1` (the read region); Logic: saves.
- At the base, only for surfaces and conventions: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs` (`alone`); `crates/deep-show` (`main.rs`'s calls and `planted`; `input.rs`'s events and the
  `input` reply; `picks.rs`'s `logic` call; `played.rs`; `access.rs`'s `see`; `seams.rs`); `crates/deep-canvas`'s
  `scope.rs` (a scroll and a pinch zoom the camera at the pointer, Tab, Esc) and `template.rs`; `crates/deep-canvas-input`
  (`session.rs`, the session `deep-input` plays at a frame rate, its `planted` names; `kit.rs`, the control@1 kit's
  replay at 30, 60 and 120 fps; `track.rs`'s hash; `rows.rs` and `point.rs`'s `PLANTED`); `crates/deep-input`;
  `crates/deep-canvas-seams` (no input backend yet); `crates/deep-logic` (`world.rs`'s read region, `piece.rs`'s slot
  for a text control, `main.rs`); the suites `539/` (this suite's model: helpers, the taste call), `540/`, `534/` (saves
  through `deep-logic`), `531/`, `308/` (`deep-input`'s protocol), `383/` (the `scroll` event), `504/` (`read`,
  `revisions`), `467/helpers.ts` (PNG reader and writers) and `544/wat` (the assembler).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs.

## What the base already does, and these tests don't credit

`deep-show`'s `input` takes `{type: "text"}` (into the ⌘K palette only), `{type: "key", key, mods}` and #383's
`{type: "scroll", phase, pos, delta}`, which zooms the camera at the pointer on every change, wherever the pointer is.
Tab walks each control's own stop; Esc backs out of a level. `read`, `revisions`, `eval` with pixels, `see` and #539's
`logic` (with #548's `track`) exist. `deep-logic` sizes a text control's read slot (4 + `max_bytes`, rounded up to 8)
and leaves it zero ("A text commit's bytes come with its control kind (#542)"), takes saves (#534), and reads no entry
whose value is a string. `deep-input`'s session refuses a control of kind `scroll` (`out_of_range`) and has no `scroll`
op. None of the rest exists: no text control takes keys or commits, no `paste` or `ime` event, no scroll control, no
`unit` or `momentum` on a scroll, none of the six planted names.

So no test passes at the base. `BASE-FAILURE.txt` is the base run.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/542 --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/542
```

Each file builds the binaries it uses once, in `beforeAll` (`cargo build --locked --bin <name>`, the default features),
honoring `CARGO_TARGET_DIR`, with rustup's bin on PATH where it exists, and copies them to a temporary folder:
`deep-show` (criteria 1, 3, 4, 6 to 10), `deep-input` (2, 5) and `deep-logic` (1); and #544's assembler
(`tests/acceptance/544/wat`, read only) into `target/acceptance-542-wat/`. Every test passes its own 30-minute timeout.
Evidence stores, saves folders and binaries are temporary and deleted; only `ac10-taste.test.ts` writes outside them,
its pictures to `docs/evidence/542/`. Node built-ins, vitest and `../467/helpers.ts`'s PNG reader and writers (imported
read only); no process is started but `cargo`, the assembler, `deep-show`, `deep-input` and `deep-logic`, each waited
for, none stopped by name or port.

**The lanes line.** The implementer adds this to `scripts/lanes.mjs`, beside #539's and #540's (this README is the
instruction):

```js
// #542's files each build deep-show, deep-input or deep-logic and #544's assembler, run logic programs and draw the app's window.
alone.push('tests/acceptance/542/');
```

Gates: no cargo is `BLOCKED:`, and an assembler that doesn't build is `BLOCKED:`; `screen` off macOS
(`unsupported_platform`) is `INCONCLUSIVE:`; criterion 10 is `INCONCLUSIVE:` until its taste call is recorded. None is a
pass. No test reads a timing or the machine's load.

## The surface under test

The issue names a control's fields, entries, read-region bytes, a save, a document's hash and golden, the camera's zoom,
announcements, the input seam's test backend's input method, track hashes at three frame rates and planted twins, but no
call. Three existing binaries carry them, each as its sibling suites drive it:

- **`deep-show run`** (one JSON scenario on stdin, one answer `{"ok": true, "replies": [...]}`; #383, #504, #539): the
  app's router, focus, controls, camera, accessibility and logic runs, on the scope's virtual clock (`clock:
  {refresh_hz: 120, lead: 2 ms, check: 0.5 ms}`, each call at its `at`). Its `input` events are what the input seam's
  test backend delivers (the scenario has no other backend). Criteria 1, 3, 4 and 6 to 9; criterion 10 through
  `deep-show screen` (#1162).
- **`deep-input input`** (#308's protocol: one session of the input module per JSON line, `{doc, viewport, fps, planted?,
  ops}` in, `{ok, hash, fork_at, track, entries, results}` out): the input module's own session played at a frame rate,
  where gestures reach the module on frames at that rate but every stamp comes from the op's `t`; the control@1 kit's
  replay part plays each kind there at 30, 60 and 120 fps. Criteria 2 and 5 ("the same recorded deltas replayed at 30, 60
  and 120 frames a second give one track hash").
- **`deep-logic`** (#531 and #534: JSON lines, a `bake` with a `saves_dir`, then `open_save` in another process):
  criterion 1's save at step 300.

**Every field, event, op, reply field and planted name below that the issue or the design doesn't give is this job's
choice, the smallest the criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.**
Times are flicks (705,600,000 a second; a 60 Hz step is 11,760,000). Pointer positions and pixel deltas are panel px
(`deep-show`) or viewport px (`deep-input`); every fixture shows its page at 1 px a u.

### Documents

Each is a figure with a transport in #539's form: `{format: 1, id, profile: "figure", title, description, size: [480,
240], seed: 542, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, requires: {modules: {input: "^1", logic:
"^1"}}, items, assets, controls, drivers?}`, the camera a 2D orthographic `camera@1` (`target` the page's centre,
`view_width` 480), each program and the atlas in the evidence store and listed in `assets` with a license.

| Field | As written | Source |
|---|---|---|
| A text control | `controls.<id>: {kind: "text", class: "document", label, role: "textbox", text: {max_bytes, lines: "one" \| "many"}}` | the issue's Fields |
| A scroll control | `controls.<id>: {kind: "scroll", class: "document" \| "view", label: "Rows", role: "scrollbar", default: 0, value_text: "Row {value}", scroll: {axis: "y", step: 24, range: [lo, hi], page, area: "listbox", snap?: n}}` | the issue's Fields; `snap: steps` inside `scroll` |
| `{value}` in `value_text` | the control's value (its position) | this job's reading of Control's `value_text: template` |
| The list's area | `listbox`: `rect@1`, `params.box: [0, 0, 240, 240]` (the page's left half) | Control: scroll (`area: item ID`) |
| The 200 rows | `rows`: `marks@1`, `mark: "image"`, an atlas of four solid cells, `grid: {shape: "square", cell: [240, 24], size: [1, 200]}`, `at.pos` (120, 12), `alive` and `columns.tile` from the logic item `tiles` | #539's atlas sets |
| The list reads the position | `drivers.rows_y: {target: "items/rows/at/pos/1", expr: "12 - 24 * p", vars: {p: "controls/<scroll id>/value"}}` | Control: scroll ("a group's offset … reads the position"); #169's driver vars |
| Elsewhere | `elsewhere`: `rect@1`, `params.box: [400, 176, 64, 48]`, in the text fixtures | criterion 6's "clicking elsewhere" |

**Where a text control's field draws** is the implementer's: the design's Fields give it no item, and the fixtures give
it none. It draws inside its panel and never over `elsewhere`, and criterion 10's picture of it after the commit is the
taste call's to judge.

### `deep-show`: events

`input`'s `event`, as #383's table gives them, with these added (new) or read anew:

| Event | Meaning | New or existing |
|---|---|---|
| `{type: "key", key, mods?: ["cmd"]}` | `Tab`, `Enter`, `Escape`, `ArrowDown`, `End`, `x`; Cmd+Enter commits a `lines: many` field; Cmd+`z` undoes in the focused field | existing (#383) |
| `{type: "text", text}` | text typed into the focused field; each event is one undo step | existing (#383); into a text control new |
| **`{type: "paste", text}`** | a paste of `text` into the focused field | **new** |
| **`{type: "ime", marked}`** | the input seam's test backend's input method: its marked text (the composition, the candidate shown) is now `marked`; `""` ends it. While marked text is non-empty, the backend's input method takes the next Enter: it confirms the candidate, inserting `marked` into the field as typed text, and no key reaches the control | **new** |
| `{type: "scroll", phase: "begin" \| "change" \| "end", pos, delta: [dx, dy]}` | a trackpad's precise scroll, `delta` in px; positive `dy` scrolls down, toward the end of the range | existing (#383); over a scroll area new |
| **`unit: "line"`** on a scroll | a mouse wheel's notch: `delta` in lines, sent as one `change` with no begin or end (a wheel reports no phase); each is a gesture of its own | **new** |
| **`momentum: true`** on a scroll | the event belongs to the gesture's momentum tail, which the platform reports after the fingers lift, with its own begin, changes and end | **new** |

### `deep-show`: what the tests read

| Call | What they read | New or existing |
|---|---|---|
| `deep_show` | `outcome: "presented"`, no error `issues` | existing (#393) |
| `input` | **`appended`**: the entries the input wrote. A text control's entry: `{t, seq, control, value: <string>, writer: "you", …}`, the value a JSON string whose UTF-8 bytes are the field's exactly as typed (line ends LF). A scroll control's: `value: <integer>`, the new position, one entry a whole step, in the reply of the event that completes the step (a snap's move to the next snap point, in the reply of the gesture's `end`). `state.focus`: a control's own Tab stop is its ID | existing (#504, #539); the entries new |
| `scope` | `state.camera` (`target`, `view_width`), `state.rect` | existing (#383) |
| `see` | `announcements` `{t, id, text}`: a scroll control's position, when keys move it with focus, by its `value_text` (`id` the control); **a refused paste's notice** (`id` the text control, its text naming the cap, its digits 16384 with or without separators) | existing (#376); both new |
| `read` / `revisions` | `hash`, the saved document's; the document's revisions | existing (#504) |
| `eval` | `{doc, t, pixels: true}` → `snapshots[0].sha256`, the document's own frame at t, as a golden records it | existing (#387) |
| `logic` | `{doc, steps}` → `steps[].arrays["echo.len" \| "echo.head"]` (i32 numbers), `track` | existing (#539) |
| scenario `planted` | one of the four `deep-show` names below | existing form, new names |
| `deep-show screen` | the scenario with `window: [1512, 982]`, `out`, `t`, `scale` | existing (#1162) |

**The text read region** (Control: text; Logic `logic@1`): a logic item reading a text control finds at the slot's
offset the committed field's `u32` length, its bytes, then zero bytes to the next multiple of 8 from the length's
start; on a step that reads no commit, length 0. Step k reads a commit stamped in ((k − 1) × step, k × step] (#531's
rule), once; at most one commit a step.

**Class view** (Scope and input classes; Control: scroll): a view-class scroll control's position is session state:
no entry, no new revision, the document's `read` hash unchanged, `eval` (a golden's frame) at its default; the panel
draws it live.

### `deep-input input`: what this suite adds

| Op | Meaning | Result |
|---|---|---|
| **`{op: "scroll", phase: "begin" \| "change" \| "end", at: [x, y], delta: [dx, dy], unit?: "line", t}`** | the `deep-show` scroll event as the session takes it: `at` in viewport px, `delta` in px (or lines with `unit: "line"`, one `change` a notch), positive `dy` down, `t` the event's own platform timestamp | `appended`: the entries it added (a count, #308's). A scroll's whole step is written by the event that completes it, at the gesture, as every op of the session writes its own entries, never by a later op's frame |

The answer's `track` lists every entry in order (#308's Entry: `{t, seq, control, value, writer, serial?}`), a scroll
entry's `value` its new position (an integer); `hash` is the track's hash. The fixture document is the same list figure;
the session finds `listbox` by its `params.box` and maps px to u through the document's camera and `viewport: [480,
240]` (1 px a u).

### `deep-logic`: what this suite adds

The piece (#534's form): `{seed, controls: {program: <the text control>}, items: {echo: {kind: "logic@1", params:
{program, step_rate: 60, reads: ["program"], writes, saves: {slots: 1, request: "request"}}}}, assets: {<sha256>:
<base64>}}`. A track entry of a text control carries the string value `deep-show` gave it, `{t, seq, control, value:
<string>, writer: "you", player: 1}`, and fills the read region as above. `bake` (`saves_dir`, `steps`) and
`open_save` (`saves_dir`, `slot`, `track`, `steps`) are #534's; the tests read `saves[].step`, `opened.step`,
`deep_hash`, `checkpoints` and `steps`.

### Planted twins

Each is one criterion's wrong program, reachable only through a scenario's or a session's `planted` (as #539's and
#540's names reach `deep_canvas_input::rows::PLANTED` and `point::PLANTED` through deep-show's `planted`, and #308's
reach `deep-input`'s `Planted::named`), and changes nothing else; any other name stays `bad_input`. `twins.json` maps
each criterion's ID to its twin.

| Name | Binary | Criterion | The wrong program |
|---|---|---|---|
| `text_normalizes_nfc` | deep-show | 1 | a text control's commit normalizes the field's text to NFC |
| `scroll_rounds_each_frame` | deep-input | 2 | a scroll control sums the pixel deltas each frame takes and rounds that frame's share to whole steps on its own, keeping no rest |
| `wheel_to_list_everywhere` | deep-show | 3 | the router gives the wheel and the trackpad to a scroll control wherever the pointer is, never to the camera |
| `text_commits_on_ime_confirm` | deep-show | 4 | a text control commits on an Enter that confirms the input method's candidate |
| `scroll_snaps_to_nearest` | deep-input | 5 | a snapping scroll control ends a gesture on the snap point nearest its position, not the next one in its direction |
| `scroll_tail_survives_keys` | deep-show | 9 | a key press leaves a gesture's momentum tail running, still scrolling its target |

## Programs

`programs.ts`, in WebAssembly text assembled by #544's assembler. Each exports `memory` (1 page), `init`, `step`,
`reads_at` and `writes_at`; arrays in declaration order on 8-byte boundaries.

- `tiles` (`tilesProgram`): `tile: i32 × 200` (row i's tile i mod 4) and `alive: bool × 200` (all true), the list's rows.
- `echo` (`echoProgram`): reads one text control at `reads_at` 1024; writes at 32768 `len` (the slot's u32 length as
  the step read it), `head` (the slot's first 32 bytes as eight u32 words), `sum` (a running hash of every byte of every
  commit read, kept in memory) and `request` (1 at step 299, else 0); it copies each commit's bytes to memory at 40960.

## Fixtures

`fixtures.ts`. A 480 × 240 u page in a 480 × 240 px panel.

- **The list** (`listDoc`): `listbox`, `rows` (200 rows of 24 u, four colors), `tiles`, and a scroll control with its
  driver: `list` (range [0, 190], class document or view) or, for criterion 5, `pager` (range [0, 21], `snap: 7`,
  `page: 7`). Over the area: (120, 120); outside it: (360, 120). The camera's zoom fixture is the same document with no
  scroll control.
- **The text fixtures** (`textDoc`): one text control, `program` (max_bytes 16,384, lines many) or `name` (256, lines
  one), `echo` reading it, and `elsewhere`. The deep-logic piece (`logicPiece`) holds `program` and `echo` with `saves`.
- **The taste fixture**: the list with `program` ahead of `list` in the Tab order, in the reference window (1512 × 982)
  with the panel across its top 1512 × 756 points, which shows the page whole.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#542.` + the first 8 hex digits of the SHA-256 of each criterion's text, trimmed,
white space collapsed, from the live issue. Each test's name starts with `AC<n> #542.<id>`; each file quotes its
criterion in full. Test count: 4 + 3 + 4 + 2 + 3 + 2 + 1 + 1 + 2 + 1 = 23.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#542.c4a60183` | `ac01-text-to-logic.test.ts` (4) | Tab, the program typed (Enter between lines), Cmd+Enter: one entry of `program` holding the 24 bytes; typing and the paste append nothing; the step at or after its stamp reads 18 00 00 00, the 24 bytes, 4 zero bytes, and `echo.len` 24; no other step reads a commit. The 16,385-byte paste: an announcement of `program` naming 16384 after it, and the commit after it still the 24 bytes. The save: a straight `bake` of 600 steps on that entry and "end" at step 400 saves once at step 300 (and reads 24, then 3); `open_save` in another process opens at 300 with the straight run's full-state hash there, every checkpoint to 600 and every step 300 to 599 equal. e then U+0301 commits 65 cc 81; `text_normalizes_nfc` commits c3 a9 and the failure names the entry `{control: program, t}`. Fails: cut, normalized or re-encoded bytes, CR line ends, a paste cut or taken, an entry per keystroke, a read region in another layout, a save without the text's state or input position |
| AC2 `#542.e7435bc2` | `ac02-scroll-steps.test.ts` (3) | At 30, 60 and 120 fps: three wheel lines write 1, 2, 3; the gesture's begin and four changes of 15 px write 4 and 5; 12 px more writes 6; its end nothing; every entry yours on `list`. One track hash at the three rates. `scroll_rounds_each_frame`: other positions at 30 fps than at 120, and the failure names the entry where the tracks part. Fails: steps per frame, a rest dropped mid-gesture, a stamp from the frame |
| AC3 `#542.8b5ba7e9` | `ac03-view-scroll.test.ts` (4) | `list` in class view: three wheel lines over it, the gesture outside, Tab, ArrowDown and End append nothing; `read`'s hash, the one revision and `eval`'s frame at 1 s are as before; the lines did scroll it (Tab focuses `list` and ArrowDown then announces "Row 4"). End announces "Row 190". The camera after the gesture outside equals the zoom fixture's (and that fixture's zooms). `wheel_to_list_everywhere`: the camera stays, and the failure names the control, which ArrowDown shows took the wheel ("Row 9"). Fails: a view-class entry or revision, a golden that reads the session, a router that takes the camera's wheel |
| AC4 `#542.8bfb66e0` | `ac04-ime.test.ts` (2) | Tab, marked text に, にほ, にほん, Enter, Enter: nothing until the second Enter, which appends one entry of `name` holding e3 81 ab e3 81 bb e3 82 93. `text_commits_on_ime_confirm`: the confirming Enter appends, and the failure names control `name`. Fails: an entry while composing or on the confirming Enter, marked text lost |
| AC5 `#542.e6403c8d` | `ac05-snap.test.ts` (3) | At 30, 60 and 120 fps on `pager`: 17 + 17 px down writes 1 as it moves and 7 at its end; 17 + 17 px up ends on 0, written at its end; 10 px writes nothing. One track hash at the three rates. `scroll_snaps_to_nearest`: the first gesture ends on 0, and the failure names control `pager`. Fails: no snap, the nearest snap, a snap per frame |
| AC6 `#542.748790f7` | `ac06-leave-and-esc.test.ts` (2) | Tab, "a", "b", a click on `elsewhere`: one entry "ab" of `name`, over every input. The same with Esc: none, beside the first run's "ab". Fails: no commit on leaving, a commit on Esc, an entry per keystroke |
| AC7 `#542.36e8999e` | `ac07-undo.test.ts` (1) | Tab, "a", "b", "c", Cmd+Z twice, Enter: nothing until Enter, which appends "a"; `logic`'s track holds that one entry of `name`. Fails: undo on the track, an undo step per field, entries between |
| AC8 `#542.49a44569` | `ac08-flick-drift.test.ts` (1) | The flick from (120, 120) drifting to (460, 120) with its tail: the camera after equals the camera before; the flick appends `list`'s rising positions. Fails: a tail handed to the camera when the pointer leaves the area |
| AC9 `#542.f0bbc9b7` | `ac09-key-stops-tail.test.ts` (2) | The gesture and the tail's first changes scroll `list` (checked); the key "x" and every tail event after it append nothing, and the camera doesn't move. `scroll_tail_survives_keys`: the tail scrolls on after the key, and fails. Fails: a tail a key doesn't end, a tail handed to the camera |
| AC10 `#542.5cccb17f` | `ac10-taste.test.ts` (1) | The check run (below) checks its scenario by replies (positions 1, 2, 3; the focus on `program`; the commit), writes the five pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

## The taste call

`ac10-taste.test.ts` is the check run. Through `deep-show screen` (the app's window as #1162's check run draws it, the
canvas's own frames) after a prefix of one scenario: present; three wheel lines over the list (positions 1, 2, 3); Tab
(the focus on `program`); the program typed; Cmd+Enter. Each window is drawn 300 ms after the prefix's last call. Into
`docs/evidence/542/`:

- `list-0.png`, `list-1.png`, `list-3.png`: the list at positions 0, 1 and 3, at 2× (3024 × 1964 px);
- `text-program.png`: the text control after the committed program, at 2×;
- `scroll-steps.apng`: the recording, the window at 1× at positions 0, 1, 2 and 3, 2 frames a second.

Each is re-encoded so the same pixels always give the same bytes, and each SHA-256 is printed.
`tests/acceptance/542/TASTE.json`, written by whoever records the call after the pictures are attached to the PR and
shown in the session: `{"issue": 542, "criterion": "#542.5cccb17f", "verdict": "looks_right" | "looks_wrong", "who",
"when": ISO 8601, "screenshots": {<each of the five names>: sha256}, "note"?}`. A call stands while this run's five
hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## Readings where the issue leaves a choice

- **"Step 24 px"** (criterion 2) and **"step 24 u"** (criterion 5): the fixtures show the page at 1 px a u, so a step of
  24 u covers 24 px on screen, and the px deltas the criteria name are px on screen.
- **"Down"** is a positive `dy`, toward the end of the range.
- **"Writes 4 and 5"**: two entries, one a whole step. The gesture's changes come 1/120 s apart, half a 120 Hz frame off
  the frames, so at 120 fps each frame takes one change of 15 px and at 30 fps one takes all four: a control that rounds
  each frame's share writes other positions at the two rates whichever way it rounds a half. **"Keeps 12 px"** is read
  by its consequence, the 12 px more writing 6.
- **"Replayed at 30, 60 and 120 frames a second"**: `deep-input`'s `fps`, the same ops each time. **"Naming the entry"**:
  the failure gives the entry's index on the control's track and its stamp and position at both rates.
- **"Leaves the document's hash and its golden as they were"**: `read`'s hash and `revisions` after scrolling against
  before, and `eval`'s frame at 1 s with pixels against before. **"Announces it by its value text"**: an announcement of
  `list` whose text says "Row" and 190. **"Scrolling"** must scroll: ArrowDown after the three wheel lines announces
  "Row 4", so a control that ignores the wheel doesn't pass the no-entry part. **"Zooms the camera as before"**: the camera after the same gesture at the same
  point equals the one the document with no scroll control gets (#383's zoom), not a number this suite picks.
  **"Naming the control"**: the camera failure says `list` took the wheel, from ArrowDown's announcement after it.
- **"Fed 'にほん' through the input seam's test backend's input method"**: marked text に, にほ, にほん, the way an input
  method shows a composition; **"the Enter that confirms the candidate"** the first Enter while marked text shows.
- **"A paste … refused whole with a notice naming the cap, and the field keeps its text"**: no entry from the paste, a
  `see` announcement of the control naming 16,384, and the commit after it holding exactly the text typed before it.
- **"A save at step 300"**: the save `echo` asks for at the end of step 299, which holds the state before step 300
  (#534's reading); **"opened again and played on"**: in a second `deep-logic` process, on the same track, to step 600,
  with a second commit after the save; **"the same full-state hash as a straight run"**: at the opened state and every
  checkpoint after it.
- **"Clicking elsewhere"**: a press and release on `elsewhere`. **"Esc writes none"** counts beside the click's run,
  where the same typing writes "ab", so a field that writes nothing at all doesn't pass it.
- **"⌘Z twice"**: Cmd+`z` twice; each typed character is its own `text` event, so its own undo step.
- **"Drifts off"**: the scroll events' `pos` moves out of the area during the gesture and its tail; **"moves the camera
  0"**: `scope`'s camera equal before and after. The flick being the list's (it appends `list`'s entries) is read too,
  so a control that drops the wheel altogether doesn't pass.
- **"A key press mid-tail"**: a plain key no control takes, after the tail has written an entry; **"stops the tail on that
  event"**: the key and every tail event after it append nothing and the camera stays.

## Not tested, because no criterion reaches it here

A scroll control's 8 B read region (`i32 position, i32 delta`); arrows, Page Up, Page Down and Home with focus (End and
ArrowDown only); axis x; smoothing; a pasted CR LF or CR becoming LF and a pasted line end refused under `lines: one`;
typing stopping at `max_bytes`; a second commit in one step waiting for the next; leaving a `lines: many` field by
Tab ("Tab commits and moves"); the undo stack gone at commit; the modifier rule ("phases drop from the first modifier
change until a new gesture"); an agent typing only through the parameter tool; the cost lines. They are follow-ups for
the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above.
- In `deep-show`: text controls (focus, typing, Enter and Cmd+Enter, leaving, Esc, Cmd+Z, paste with its notice, the
  test backend's `ime` event), scroll controls (wheel lines, px deltas with their rest, momentum tails, the area's
  hold on the wheel, keys with focus and their announcements, class view as session state), the window drawing both, and
  the four `deep-show` planted names. In `deep-input`'s session: the scroll kind, the `scroll` op and the two planted
  names. In the logic module (`deep-logic`): a text entry's string value and its bytes in the read region.

`BASE-FAILURE.txt` is the run at the base.
