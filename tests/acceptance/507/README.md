# Acceptance tests for #507: present mode, markers that wait and branch, holds on the beat, the presenter view and the PDF handout

These tests were written before any implementation existed, by a job that saw only issue #507 (live, `gh issue view 507
--repo windoliver/deepbuild`, identical to the saved copy it was given), its Oracle page, the design and the base commit
`53c0e72a3` ("Merge pull request #2356 …", origin/main). No plan for #507, no other worktree, branch, PR or stash was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). The Oracle lane for criterion 5 is in `tests/acceptance/507-oracle/`.

**Not run against a binary.** The machine is shared and loaded, and the surfaces plainly don't exist at the base, so no
Rust was built and the suite wasn't run. `BASE-FAILURE.txt` says, per test, the assertion it meets first at the base and
why, read from the base's code. The type-check passes (`node node_modules/typescript/bin/tsc -p
tests/acceptance/507/tsconfig.json`). The fixtures' own numbers were checked with node: the grapheme counts of the four
waiting texts (45, 60, 51, 39), the 560-frame path, and the criterion IDs.

## What was read

- Issue #507: Scope, Fields (Marker: present mode; Export), the eight acceptance criteria, Proof ("A recorded present-mode
  session on two displays and on one, the branching film's export, and the handout read back by a separate reader") and
  the Oracle line.
- Its Oracle page: one upstream test, for criterion 5 only (`tests/acceptance/507-oracle/README.md`); the other seven
  criteria stay with our fixtures, as the page says.
- `docs/technical-design.md`: Films and figures on the canvas (591): Interactive figures (616: "In present mode the
  timeline holds at each stage while the clock and the music bed run on …"), Export (621: "A film whose stages wait or
  branch exports the path its input track takes"); Control and input track (1278); Transport (1286); Keymap, placement,
  window (2035); How we know version 0 works (2608): Criteria to tests (2634), Criteria in a checked shape (2636), Wrong
  programs (2637: "never chosen by an environment variable"), Dogfooding (2658).
- `docs/canvas-primitives.md`: Band (793); Question card (807: "While present mode shows a piece on a display, the card,
  toasts and the line under the menu bar never draw there: the card opens on another display, and with one display an
  ask waits unpresented, counted only in the menu bar's count, until present mode ends"; the deadline "when present mode
  ends"); Input router (821); Window and display placement (913); Transport (5177: "In present mode, and wherever a marker
  waits or jumps, t is the clock: the frame is eval(doc, p(t), inputs ≤ t, view)"); Transport: film viewer (5192: its
  keys; "It can never: Bind a key present mode or a control already holds without the keymap check naming it");
  Marker (5308); **Marker: present mode (5326)**, every sentence; Driver (5434); Control (5563: a choice reads as its
  option's index; a stage glides over 0.8 s from the pose shown); Input track (5795: present entries); Text animator and
  counter (5938); Tempo map and cue alignment (6006); The closed function list (6057); Strip and track (7357: `loop`,
  `at_stage: play | wait`); Bus (7400); Export (7681: `range … | stages`, `pdf {notes}`, `export.target@1`'s `pdf` read
  back by a pinned PDF reader, "each page's image must hash equal to the `still {marker}` export of its stage", all or
  nothing); Narration and captions (8222: a line's recording, its words record, its speech span); Film audit (8977: the
  hold rule `max(min, pad + n_cjk ÷ 4.5 + n_other ÷ 15)`, graphemes, whitespace never counted).
- At the base, to learn the surfaces only: `crates/deep-show/src/main.rs` (the call list, the scenario's `displays`,
  `clock`, `card`, `planted`; an unknown call answers `bad_input`), `input.rs` (`input`'s reply, `appended`, key
  events and `mods`), `film_viewer.rs` (the viewer's keys and the keymap check's `conflicts`), `frames.rs` (`eval`,
  `paths`, `film`), `time.rs` (`determinism`'s play and seek sides, `play`), `export.rs` (`parse`: `range`, `track`,
  `video.codec`), `mixdown.rs` (`media_mix`), `played.rs` (the session's track, `enter`), `ring.rs` (`install`,
  `attempts`, `toasts`), `gate.rs`, `hub.rs`; `crates/deep-canvas-motion/src/doc.rs` (`markers_of`: a stage marker with
  `waits_for` is refused `bad_marker_kind`), `tempo.rs` (`tempo_map.segments`); `crates/deep-canvas-input/src/track.rs`
  (an entry's JSON); `crates/deep-canvas/src/document/mod.rs` (the envelope's keys), `rules.rs` (`shows_number`: a
  text@1 showing a digit or a number word with no source is refused `number_unsourced`); `scripts/proof-change.mjs`
  (`criterionId`), `scripts/public-text.mjs`; the suites `400/`, `401/` (displays, windows, the card, the ring),
  `501/` and `157/` (export, stills, receipts), `502/` (narration lines and words records), `504/` (controls, stages,
  glides, `appended`, the taste test), `407/` (the hold rule's numbers), `1163/` (the Driver), `1965-oracle/` and
  `407-oracle/` (the Oracle pattern).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features full`, in
`beforeAll`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set), so the files
run one at a time. The implementer adds this line to `scripts/lanes.mjs` (this job edits nothing outside its folders):

```js
// #507's files each build deep-show with cargo; ac6 reads PDFs with poppler, ac3 renders a 50 s session's sound.
alone.push('tests/acceptance/507/', 'tests/acceptance/507-oracle/');
```

```sh
npm ci                                   # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/507 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/507/tsconfig.json
rm -rf tests/acceptance/507/node_modules/.vite
```

- **Needs:** poppler's `pdfinfo`, `pdfimages` and `pdftotext` for `ac6`'s handout (`brew install poppler`; this Mac has
  26.11.0); without them that test fails `BLOCKED:` with that one line. Nothing else outside the checkout.
- **Isolation:** every folder is a fresh one under the system temp folder, deleted after its test. No process is stopped
  by name or port; no network.
- **No decision:** a test that can't decide here fails with a message starting `INCONCLUSIVE:` or `BLOCKED:`; it never
  passes and is never skipped. A reply missing a field a test reads fails naming the field.

## The surface under test

The issue names fields, keys, displays, the presenter view, the card, the menu bar's count, the keymap check, the
export and its reader, but no command line. These tests drive the one binary that already plays the hub's canvas side,
its windows, displays, card and plug-in ring for tests, `deep-show run` (#393's JSON-lines scenarios; #400's
`displays`, virtual `clock`, `pop_out`, `card`, `presented`; #401's `install`, `attempts`, `toasts`, `keymap`;
#501's `export`, `determinism`, `keymap` conflicts; #502's `script`; #504's `control` input, `appended`, stage shots
and `film.cameras`). No new binary or subcommand. **Every name below that the issue or the design doesn't give is this
job's choice**; the implementer builds exactly these, or a dispute goes to a blind redraft.

### Documents

| Field | As the tests write it | Source |
|---|---|---|
| A waiting stage | `markers.<id>: {kind: "stage", t, waits_for: <control ID>, then?: {<option>: <marker ID>}}` | issue |
| A goto | `markers.<id>: {kind: "cue", t, goto: <marker ID>}` | issue |
| Notes | `markers.<id>.notes: string` on stage markers | issue |
| A looped hold | `markers.<id>.hold: {"loop": {"from": <marker ID>}}` (`"still"` is the default) | issue's `hold: still \| loop {from}`; the JSON form is a choice |
| A stage's name | the marker's `name` | Marker |
| Questions and the path | `controls.<id>: {kind: "choice", class: "document", options: [...], default?}` | Control |
| The counter | a `text@1` whose `params.text` is `{counter: {source: <driver ID>, tabular: true, format}}`, the driver summing `(q == right ? 1 : 0)` over the questions' `controls/<id>/value` | Text animator and counter; Driver; Control ("a choice reads as the index of its option") |
| Shown over a span | a hold-keyed channel on `items/<id>/adjust/opacity` | Item fields (#407's suite) |
| The tempo map | `tempo_map: {segments: [{at: "0s", bpm: 120, meter: [4, 4], span: 80}]}` | existing |
| Music that plays on | a strip with `loop: true` on `bus: "music"` (`at_stage` left to its default, play) | Strip and track |
| A narration line | `script.lines.<id>: {t, text, recording: {asset}}`, its asset's `attached` words record (#502's form) | existing |
| A stages control and its shots | `controls.views: {kind: "stages", stages: {<id>: {label, shot}}, default}`, `shots.<id>: {camera, move: "hold", target, view_width}` | existing (#504) |

### Calls and fields

Every call in a room (a scenario with `displays` and `clock`) carries `at` (flicks); the piece's clock is the scenario's
virtual clock, so `input` stamps entries on it and `eval`'s `t` is a clock time.

| Call | Request | Reply fields read | New or existing |
|---|---|---|---|
| `deep show` | `peer`, `doc`, `document` | `outcome: "presented"`; a refusal `outcome: "refused"` whose JSON names the `then` and its marker, the waiting control, or the stage marker | existing; the refusals new |
| `pop_out` | `panel`, `display`, `serial`, `full_screen: true` | `window: {kind: "full_screen", display}`; **a piece with stage markers enters present mode then** | existing (#400); present mode new |
| `input` key | `{type: "key", key, mods}`: `"ArrowRight"`, `" "`, `"ArrowLeft"`, `"b"`, `"7"`, `"Return"` (the scope's name for Enter), `"Escape"`, `"P"` with `mods: ["shift"]` | `appended: [Entry]` | existing (#504); present entries new |
| `input` control | `{type: "control", control, value}` | `appended` | existing (#504) |
| a present entry | — | `{t, seq, present: "advance" \| "back" \| "blank" \| {"goto": <stage marker ID>}, writer}` | **new**: the design's `present` entry; `blank` and `goto` are this job's names |
| `eval` | `doc`, `t` (clock), `film?`, **`texts?: true`** | **`position`** (flicks: the timeline position the frame at `t` shows; within one film frame where it moves), **`texts`** (`{<text item ID>: the string the frame draws}`), `film.cameras.cam.{target, view_width}` | existing; `position` and `texts` new |
| `determinism` | `doc`, `display_hz`, `at_times`, **`track?`** (with it, both sides replay the document on that track, outside present mode) | `frames[].{t, play, seek}`; each side's `pixel_hash`, **`position`**, **`texts`** | existing (#488); `track`, `position`, `texts` new. Without `track` the sides replay the document's session as it ran, present mode and its entries included |
| `export` | `doc`, `out`, `video: {codec: "png_seq"}`, `frame_rate`, `track`, `range: {still: {marker}}` | `outcome: "exported"`, `receipt.frame_hashes` (BLAKE3) | existing (#501, #544); the waiting path new |
| `export` handout | `range: "stages"`, `video: {codec: "pdf"}`, `pdf: {notes: bool}`, `out: <file>.pdf` | `outcome: "exported"`; otherwise not `exported`, with `issues` | **new** (issue's fields) |
| `media_mix` | **`session: <doc ID>`** in place of `doc`, `segments: [{from, to, write: true}]` (clock flicks) | `mix.{sample_rate, segments[].{first, wav}}` | existing (#499); replaying a session is new |
| **`present`** | `panel` | `present: {on, display, stage: <marker ID> \| null, number, blank, notice: string \| null}` | **new** |
| **`presenter`** | — | `presenter: {display, stage, number, name, notes, next: {stage, hash}, elapsed}` (`hash`: BLAKE3 of the next stage's first frame, as the export hashes it; `elapsed`: flicks since present mode began) | **new** |
| **`menu_bar`** | — | `count`: the menu bar's count of asks | **new** |
| `card` | — | `card.{display, states: [{state, at}], deadline_at}` (**`deadline_at`**: flicks, null while not started) | existing (#400); `deadline_at` new |
| scenario `card` | `{ask, question, options, size, at, `**`deadline`**`}` (flicks the default waits from when the deadline starts) | — | existing (#400); `deadline` new |
| `presented` | `panel` | `frames[].{vsync, display, `**`over`**`}` (`over`: what the shell drew over the piece in that frame on its display, each of `card`, `toast`, `menu_line`, `notes`, `presenter`; empty for the piece alone) | existing (#400); `over` new |
| `keymap` | — | `conflicts[]`; while present mode runs, one **`{chord, context: "film_viewer", doc, by: "present_mode"}`** per viewer key it shadows (chords as the base names them: `space`, `arrowleft`, `arrowright`, `0` … `9`) | existing (#401, #501); the present-mode rows new |
| `install`, `attempts`, `toasts` | #401's | `installed`; `attempts[].{op, outcome}`; `toasts[].{display, shown}` | existing |

### The planted program

One, the issue's: the scenario's `planted: "pdf_writer_skips_stage_4"`, a pdf writer that leaves stage 4's page out.
The export's own fidelity check must fail it, naming stage 4 (its marker `s4`, or "stage 4"), and leave nothing at
`out`. At the base the name is unknown, so the scenario answers `bad_input`. Every other test fails at the base at an
assertion in this folder (`BASE-FAILURE.txt`), and each file's header names the wrong programs its assertions fail.

## Fixtures

All made at test time in `helpers.ts`; no file outside the checkout, no personal data, CC0.

- **The quiz film** (criteria 1 and 2): 640 × 360, 50 s at 10 fps; a block sliding 12 u a second; stage markers
  `intro` 0 s, `fork` 8 s (waits for `path`, options A and B, default A; `then: {B: part2}`), `ask1` 33 s, `ask2` 37 s,
  `ask3` 41 s (wait for `q1` … `q3`, options a and b, no default); cues `jump` 20 s (`goto: resume`), `part2` 21 s,
  `resume` 30 s; texts shown only over [M, M + 0.1 s) at each waiting marker M, of 45, 60, 51 and 39 graphemes, none
  showing a digit or a number word; the counter from 45 s. Right answers: a, b, a. The reference twin plays straight: no markers, each question's default a.
- **The loop film** (criterion 5, the Oracle lane): 20 s at 30 fps; `s1` 0 s, cue `span_start` 4 s, `s2` 6 s with
  `hold: {loop: {from: span_start}}`, `s3` 12 s; a block sliding 30 u a second.
- **The nine-stage piece** (criteria 4 to 7): 36 s at 30 fps; stage `s<k>` at 4(k − 1) s, named Welcome, Setup, Method,
  Results, Detail, Compare, Summary, Questions, Close, with notes "Point k: talk about part <k> slowly".
- **The held film** (criterion 3): 40 s at 30 fps on 120 BPM 4/4 from 0 s; stages `s1` 0 s, `m1` 11 s, `m2` 21 s; a 2 s
  stereo 440 Hz tone looping on `music`; the line `voice_line` at 11.5 s, "Now the second part", its recording a 3 s
  1 kHz tone with a words record placing its four words over [0.2 s, 2.8 s); stages `front` and `side` framing
  (320, 180) at 640 u and (480, 180) at 320 u.
- **The narrated film** (criterion 1's third fault): 20 s; the same line at 10 s (spoken over [10.2 s, 12.8 s)); a stage
  marker `inside` at 11.5 s, and its fixed twin at 14 s.

## Criteria to tests

IDs are `#507.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`). Every suite and test name starts `AC<n> #507.<h8>`.

| AC | ID | File (tests) | What it asserts |
|---|---|---|---|
| 1 | `#507.0907f6fa` | `ac1-branching.test.ts` (3) | On the track (B at 10 s; a, a, a at 24, 30, 35 s), `determinism` at 11 clock times: both sides at the fold's position (4, 8, 21.5, 26, 33, 35, 37, 38.5, 41, 46, 49 s), play's frame equal to seek's, the counter showing 2 at 46 and 49 s. The export of that track at 10 fps: 560 frames, frame k equal to the straight film's frame on the path: [0, 8 s), 8 s held 45 frames, [21, 33 s), 33 s held 55 frames and resumed, 37 s 49, 41 s 41 (the hold rule's 4.5, 5.5, 4.9 and 4.1 s), then on to 50 s. The three faults refused, naming `fork` and `then`, `viewer_pick`, `inside`; their fixed twins presented |
| 2 | `#507.c7ade523` | `ac2-back.test.ts` (1) | In present mode: held at 37 s before ←; ← writes one `back` entry and the timeline is held at 33 s 0.5 s and 1.5 s later; the new answer plays on (34 s at 31 s); at 45 s the timeline is at 46 s and the counter shows 2 (the old answer would give 1) |
| 3 | `#507.4b380d1c` | `ac3-held-stage.test.ts` (4) | The 20 s hold (ten bars): every 3 s short-term loudness inside it within 1 LU of the 3 s before it (the music above −30 LUFS), the line's 1 kHz below −50 dBFS through the hold and sounding after it; the stage pick: timeline held at 11 s, camera on front's shot before, strictly between and moving at 0.2, 0.4 and 0.6 s, on side's shot at 1 and 2 s; the advance 3.3 s into the hold at 21 s: held at 3.0, 3.6 and 3.9 s in, 21.3 s at 4.3 s in, 22 s at 5 s in; the replay sought into the hold and across its end equals the replay played, sample for sample, and isn't silent |
| 4 | `#507.bd1e985c` | `ac4-asks.test.ts` (2) | Two displays, present mode on B: the toast raised, none shown on B, the card on A presented within 1 s of the ask, and B's 30 or more frames over [3, 6 s] drawing no card or toast. One display: the menu bar's count up by one, the card never presented and its deadline not started at 3.5 and 6.5 s, the display's frames over [3, 6.5 s] drawing nothing over the piece, present mode off after Esc, the card presented within 1 s of 7 s and its deadline 60 s from it |
| 5 | `#507.44897258` | `ac5-loop-and-keys.test.ts` (2) | The held loop at offsets 0, 1, 2, 4, 5, 6 s: both sides at 4 + (offset mod 2) s and the frame the timeline showed there on its way, play equal to seek; after the advance the timeline goes on from 6 s. B: one `blank` entry and `blank: true`; 7: no entry, Enter: one `{goto: s7}` entry, stage 7 (number 7), held at 24 s; 3 Enter: no entry, a notice saying back, still stage 7 |
| 6 | `#507.3b8c5798` | `ac6-presenter-and-handout.test.ts` (3) | Stage 3 held on B at 13 s; the presenter view on A: stage `s3`, number 3, name Method, its notes, next `s4` with the hash of `s4`'s still, elapsed 12.8 s and 2 s more at 15 s; the card on A; no B frame draws notes, the card or the presenter view. The handout, without and with notes: 9 pages by pdfinfo, page k's image (pdfimages) equal in size and RGB bytes to stage k's still; page text (pdftotext) holding stage k's notes on page k only with `notes: true`, and no notes without. The planted writer: not exported, an issue naming stage 4, nothing left |
| 7 | `#507.13a7577b` | `ac7-keymap.test.ts` (1) | Before present mode and after Esc no present-mode rows; while it runs exactly `space`, `arrowleft`, `arrowright`, `0`–`9`. → advances (0.5 s on at 1.5 s, not 5 s), Space advances from stage 2, ← goes back to stage 2 and holds, 5 alone writes nothing and moves nothing, Enter after it goes to stage 5 |
| 8 | `#507.0ee140b7` | `taste.test.ts` (1) | Reads the record only (The taste call) |

## Readings where the issue and design leave a choice

- **The piece's clock in a room** is the scenario's virtual clock. A film in a panel sits at its start until present
  mode begins, at the `pop_out` that makes it full screen. Expected positions are computed from the entries' own stamps
  (`appended`), so an input lead never decides a test; times are spaced 0.5 s or more from every boundary.
- **The fold.** The position follows the clock, holds at a waiting marker from the frame it arrives until the entry,
  then goes on from the marker its option names, or from the marker itself (the frame at the entry shows the marker's
  time). Seeking and playing are `determinism`'s two sides; `eval` at a clock time is a seek.
- **"Shows 2"** is the counter's drawn string (`texts.score`) holding the one number 2.
- **The export's holds.** At each waiting marker the export holds the marker's frame from its arrival for the hold rule's
  time for the one text that frame shows, rounded up to whole frames (here exact: 45, 55, 49 and 41 frames at 10 fps),
  then goes on as the fold does. "Exactly those two ranges" is the export's frame hashes, frame for frame, against the
  same film played straight (no markers, the answers as defaults), so no frame of (8 s, 21 s) and none past a hold's
  time.
- **"Naming them":** the refusal's JSON holds the marker with the `then` and the word `then`; the waiting control's ID;
  the stage marker's ID.
- **"Within 1 LU of its short-term loudness before the hold"** is BS.1770's short-term loudness (K-weighted, 3 s) of the
  session's replay, every 3 s window ending 3 s to 20 s into the hold against the window ending at the hold. The music is
  the only sound before and during the hold, so the mix reads the bus; the narration waits if its tone is absent through
  the hold and present after it.
- **Bars.** A hold's bars count from the hold's start at the marker's tempo, the fewest reaching past the advance: an
  advance 19.5 s into a hold ends it at 20 s, one 3.3 s in at 4.0 s. The first hold's start isn't pinned: m1's arrival is
  read from where the timeline plays at 5 s.
- **The glide** is #504's: from the pose shown, over 0.8 s, on the stage's shot after; checked on the camera's target
  and view width.
- **"Checked on B's presented frames"** is #400's `presented` with `over`; the piece plays during the ask, so the display
  presents frames to check. With one display "draws nothing on the presented frames" is `over` empty.
- **The deadline starts when present mode ends**: `deadline_at` is null in present mode and within [7.0, 7.1 s] plus the
  60 s deadline after Esc at 7 s.
- **The presenter view's elapsed time** runs from present mode's start (the pop-out); "the next stage's first frame" is
  the frame at its marker, hashed as the export hashes frames, so it equals `still {marker: s4}`'s receipt hash.
- **The handout's pages** each hold the stage's still as an image a PDF reader extracts without loss (pdfimages writes
  PNG), so "hash equal" compares its decoded RGB bytes with the still's PNG; notes are text a reader extracts
  (pdftotext). poppler is the reader apart from the writer: nothing in DeepBuild calls it.
- **Present entries:** `blank` and `{goto: <stage>}` name a blank and a jump; a stage number alone writes nothing; Enter
  after an earlier stage's number writes nothing and sets `present.notice` to a sentence that mentions back.
- **The shadowed keys** are the film viewer's keys present mode also holds: Space, ←, → and the digits; K, J, L, `,`, `.`,
  Home, End, M, F, ↑, ↓, `?` and the ⌥ arrows are not, so the check names exactly thirteen.

## Legs that read BLOCKED or INCONCLUSIVE

- `ac6`'s handout test is BLOCKED without poppler (`brew install poppler`).
- `taste.test.ts` is INCONCLUSIVE until the pictures and the call exist.

## The taste call

`taste.test.ts` judges no picture. It reads the check run's pictures under `docs/evidence/507/`:

- `stage-full-screen.png`: a stage shown full screen;
- `presenter-view.png`: the presenter view on the second display, with notes and the next frame;
- `handout-page.png`: a page of the PDF handout;
- `held-loop.apng`: a recording of a held stage and its looped span.

Each is taken by the check run from the app at the reference window, attached to the PR and shown to the owner in the
session. The one call on them is recorded in `tests/acceptance/507/TASTE.json` after the owner's answer (this job
writes none):

```json
{"issue": 507, "criterion": "#507.0ee140b7", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"stage-full-screen.png": "<sha256>", "presenter-view.png": "<sha256>", "handout-page.png": "<sha256>",
                 "held-loop.apng": "<sha256>"}, "note": "…"}
```

Missing pictures, no call, or a call made on other pictures (another SHA-256) is `INCONCLUSIVE:`, never PASS;
`looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads a picture to judge it: the
handout's pages are compared byte for byte with the stills, which is a value, not a taste.

## Not tested

No criterion asks for these: Page Up and Page Down, A's own path (8 s to 20 s, then 30 s), the 64-path refusal, the
film audit on every path, an export refused for a marker with no entry or default, `goto` refused at or before its
marker, Shift+P closing the view, B unblanking, a physics world holding with the timeline, `at_stage: wait` on a loop,
the fade at a jump, the handout with a tempo map, the PDF's page size, and a presenter view on one display.
