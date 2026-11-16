# Acceptance tests for #903: the tour pointer

Written first, from issue #903 ("Tour pointer: the idle tour shows a pointer that travels to each control it changes,
so a viewer sees what to press": its Scope, its Fields, its eight acceptance criteria, its Proof line, Not in scope and
Depends on), the design sections it links and those they lean on, and base commit `d8c46f0d5` ("Merge pull request
#2601", main), by a job that never saw an implementation, a plan, a branch, a pull request or anyone's notes for this
issue; none was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

The suite is lean: one file per criterion, 14 tests, and exactly the three planted wrong programs the issue names.

**Not run against a binary.** The machine this was written on was shared and loaded, so no Rust was built and no test
was run. `BASE-FAILURE.txt` says where each test fails at the base, read from the base's code; it is a note, not a
run. The type check passes and `vitest list` shows the 14 tests in 8 files. The fixtures' own numbers (the card's
projection, the sample times) were worked out in a scratch script, not kept; they are listed under Fixtures.

## What was read

- Issue #903, live (`gh issue view 903 --repo windoliver/deepbuild`), every line.
- `docs/canvas-primitives.md`: Time and the flick, Units and axes, Scope and input classes; Document envelope; Look
  `look@1` (`time.state: {span, interp = ease in_out_cubic}`, "which … the tour pointer's glide take"); Overlay; Channel
  and key (`interp`: "owns the segment to the next key"); Control and its sub-sections; Input track; Tour (with
  `tour.pointer`); Input track entries; Transport (reduced motion); Export; Determinism as #1897's suite quotes it.
- `docs/technical-design.md`: Films and figures on the canvas; Control and input track; What done means (Who drafts it,
  Proven on the base); How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong programs, the
  edit guard, Dogfooding); The reference Macs. `AGENTS.md`, `CONTRIBUTING.md`.
- The suites of the issues #903 depends on, for conventions and the surfaces that exist: `308/` (README, helpers,
  `track.test.ts`, `redraft/`), `489/` (README), `506/` and `506-redraft-ac5/` (README, helpers, the card, the taste
  test, `twins.json`), `501/` (README, helpers, `exports.test.ts`), `1897/` (README, helpers, `seek-play.test.ts`),
  and `542/` (the nearest suite that drives both `deep-input` and `deep-show`, and `deep-show screen`), `1162/` (README).
- At the base, only to find the surfaces: `crates/deep-input/src/main.rs` and `crates/deep-canvas-input/src/session.rs`
  (the session's line, ops, `Planted::named`, how a press, a toggle and a slider are hit, the tour, `tour_of`);
  `crates/deep-show/src/main.rs` (the call list, `eval`'s fields, `screen`), `time.rs` (`determinism`, `eval_time`),
  `export.rs` (`parse`, the still and range forms), `played.rs`, `determinism.rs`, `geometry_audit.rs` (it reads
  `tour.keys`); `crates/deep-canvas/src/document/mod.rs` and `check.rs` (`ENVELOPE_KEYS`: any other key is
  `unknown_field`), `variants.rs` (a control's `targets`), `scope.rs` (targets and Tab stops);
  `crates/deep-canvas-marks/looks/clean.json`; `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs`
  (`twins.json`), `scripts/lanes.mjs`, `scripts/benchmark.mjs` (the reference Macs).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

```sh
npm ci                                   # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/903 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/903/tsconfig.json     # type-check
rm -rf tests/acceptance/903/node_modules          # Vitest's cache
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, with rustup's bin on `PATH` where it
exists, and copies the binary into a temporary folder:

| File | Builds |
|---|---|
| `ac1-keys-seek-play`, `ac2-keys-in-a-gap`, `ac4-click-yield-resume`, `ac5-show-changes-nothing`, `ac7-reduced-motion` | `cargo build --locked --bin deep-input` |
| `ac3-card-over-3d`, `ac6-export`, `ac8-taste` | `cargo build --locked --bin deep-show` (its default features, the full set) |

Every test passes its own timeout. Evidence stores, export folders and binaries are temporary and deleted; only
`ac8-taste.test.ts` writes outside them, to `docs/evidence/903/`. Node built-ins and vitest only; no process is started
but `cargo`, `sysctl`, `deep-input` and `deep-show`, each waited for, none stopped by name or port.

**The lanes line.** These files build cargo binaries, export on the GPU and draw the app's window, so the implementer
adds to `scripts/lanes.mjs`, beside #542's (this job edits nothing outside this folder):

```js
alone.push('tests/acceptance/903/');
```

**Gates, none of them a pass.** No cargo is `BLOCKED:`. A reply that names no GPU or adapter is `BLOCKED:`; one that
says `unsupported_platform` (the app's window and the 3D frame draw on macOS) is `INCONCLUSIVE:`. Criterion 6's hash
test is `INCONCLUSIVE:` off a reference Mac (Mac15,7, Mac15,12 or Mac17,10, by `sysctl`), after every hash was
compared. Criterion 8 is `INCONCLUSIVE:` until its taste call is recorded on exactly the run's bytes.

## The surface under test

The issue names fields and behavior, and no call. Two existing binaries carry them, each as its sibling suites drive
it; no new binary, subcommand or Cargo feature. **Every name below marked "this job's" is this job's choice, the
smallest the criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.** Times are
whole flicks (705,600,000 a second). Positions are px from the view's or the frame's top left corner, x right, y down.

### Documents

| Field | As written | Source |
|---|---|---|
| The tour | `tour: {keys: {control → [[t, value, interp]]}, idle_after, resume_after, loop}` at the top level of the document, `t` in seconds on the tour's clock | Tour: Fields; the place is #308's suite's and the base's readers' (see Readings 1) |
| The pointer | `tour.pointer: {show: bool = true, glide: s = 0.5, ring: s = 0.3}`; absent, it has those defaults | the issue's Fields; Tour |
| An interpolated key | `gain: [[4, 0, "linear"], [6, 1, "hold"]]`: the key at 4 s owns the segment to the next, so the slider's value at t in [4 s, 6 s] is (t − 4) ÷ 2 | Channel and key (`interp`); the reading is this job's (Readings 4) |
| A slider's hit box | its `handle.item`'s box as drawn at the slider's value: the thumb. `handle: {item, along: "x", travel, drag: "along"}` puts the item's centre at its authored centre at `range[0]` and `travel` u along x at `range[1]` | #308's suite; that it is the hit box is this job's (Readings 7) |
| A press's or a toggle's hit box | the box of the item its `targets` names: `targets: {<name>: <item ID>}`, one item | the base's session and scope hit a press and a toggle through `targets`; that it is the hit box is this job's (Readings 7) |
| A control's anchor | the centre of its hit box in the layout evaluated at the key's time | the issue's Scope |

### `deep-input input` (#308's protocol; criteria 1, 2, 4, 5, 7)

One session of the input module per JSON line, `{doc, viewport, fps?, reduced_motion?, planted?, ops}` in,
`{ok, hash, fork_at, track, entries, results}` out, one result per op, exit 0. All existing. The tests use `viewport:
[1920, 1080]`, `fps` `[30, 1]`, `[60, 1]` (the default) and `[120, 1]`, `reduced_motion: true`, the ops `advance`,
`seek`, `pointer` (`down`, `move`, `up`) and `read`, the answer's `hash` and `track` (`t`, `control`, `value`,
`writer`), and a `read`'s result compared whole.

Added, this job's:

| What | Shape | Meaning |
|---|---|---|
| op `tour_pointer` | `{"op": "tour_pointer"}`, no `t` | reads the tour pointer as a frame at the playhead draws it; it moves no playhead and writes nothing |
| its result | `{"tip": [x, y] \| null, "opacity": number}` | `tip`: the point of the pointer that touches a control, viewport px, f64. `opacity`: the share of itself the pointer draws with, 0 to 1: exactly 1 while the tour plays and you give no input; between 0 and 1 during the 0.2 s fade; exactly 0 whenever no pointer pixel draws (`show: false`, reduced motion, from the fade's end until the tour resumes). `tip` may be `null` only when `opacity` is 0. Other fields are not read |
| `planted` names | `tour_pointer_frame_clock`, `tour_pointer_glide_before_key`, `tour_pointer_takes_hits` | the planted programs below, reached as #308's are (`Planted::named`); any other name stays `bad_input` |

A reading is a pure function of the playhead's flick, the tour's keys and the layout there: played to a flick at any
frame rate, or sought to it after the tour was played, it is the same, number for number (criterion 1 compares the
JSON numbers with `===`).

### `deep-show run` and `deep-show screen` (criteria 3, 6, 8)

One JSON scenario on stdin, `{"ok": true, "replies": [...]}` out, one reply per call (#393; as #501, #542 and #1897
drive it). Existing and used as they stand: the scenario (`evidence`, `sessions`, `processes`, `panels`, `docs`,
`calls`; for the window `clock`, `display`, `window: [1512, 982]` and each call's `at`), `deep_show` (`outcome:
"presented"`, `issues`), `eval {doc, t}` (`outcome: "evaluated"`), `export {doc, out, range?: {still: {t}}, video:
{codec: "png_seq"}}` (`outcome: "exported"`, `receipt.size`, `receipt.frame_rate`, `receipt.frame_hashes`; a folder of
PNGs at `out`, names in frame order), `determinism {doc, display_hz, at_times, compare: "same_machine"}` (`outcome:
"compared"`, `frames[].{t, play.pixel_hash, seek.pixel_hash}`), and `deep-show screen` (the scenario with `out`, `t`,
`scale`; #1162).

Added, this job's:

| What | Shape | Meaning |
|---|---|---|
| a document's `tour` | as under Documents | `deep_show` presents a document that holds a `tour`; the base's check refuses the key (Readings 1) |
| `eval`'s `tour_pointer: true` | the reply gains `"tour_pointer": {"tip": [x, y] \| null, "opacity": number}` | the same reading as the session's op, at `t`, in px of the document's frame at its own size |
| the tour where no one gives input | no field | an `eval`, an `export`, a `determinism` run and a window no one touches play the document's tour from `idle_after` past the start, with its pointer, as the base's logic bake already takes a tour's keys (Readings 8). Every fixture sets `idle_after: 0`, so the tour's clock is the document's |

No planted name is added to `deep-show`: the three planted programs are the input module's, and the criteria that
name them read positions and entries, not pixels.

### Planted programs

Each is one criterion's wrong program, reachable only through a session's `planted`, and changes nothing else.
`twins.json` maps each criterion's ID to its name (none for the criteria without one).

| Name | Criterion | The wrong program | The test's failure names |
|---|---|---|---|
| `tour_pointer_frame_clock` | 1 `#903.dd86ae00` | the pointer moves by the frame clock: each frame the session plays moves it by that frame's share of its glide or ride, and a seek draws no frame, so where it is depends on the frames played and not on the playhead's flick | the first sample that differs, by index and time |
| `tour_pointer_glide_before_key` | 2 `#903.406ccd5b` | every glide starts `glide` before its key, whatever the previous key's time, so at the earlier of two close keys the pointer has already left | the earlier key, on `fire` at 2 s |
| `tour_pointer_takes_hits` | 4 `#903.da7f464f` | the pointer is a hit target: a press that lands on it is taken by it and reaches no control | the control the click never reached, `gain` |

A planted program that refuses, crashes or draws no pointer doesn't count: each planted test needs its own failure
text, which only a program that runs and is wrong in that way produces.

## Fixtures (helpers.ts)

Made in code, with no outside tool and no personal data.

**The tour board** (`tourBoard`): a `figure`, 1920 × 1080 u, its 2D camera the frame (`view_width` 1920), `transport`
10 s at 12 frames a second, drawn in the shipped clean look (flat fills, no finish). In a 1920 × 1080 px view and in an
export at its own size 1 px is 1 u.

| Item | Box (u) | Role | Control |
|---|---|---|---|
| `ground` | (0, 0, 1920, 1080) | `ground` | – |
| `fire-button` | (240, 300, 360, 180), centre **(420, 390)** | `muted` | `fire`, a press, `targets: {fire: "fire-button"}` |
| `lamp-button` | (1320, 700, 360, 180), centre **(1500, 790)** | `muted` | `lamp`, a toggle, default false, `targets: {lamp: "lamp-button"}` |
| `gain-track` | (800, 530, 680, 20) | `accent` | – |
| `knob` | 60 × 60, centre **(800 + 680 v, 540)** at value v | `muted` | `gain`, a slider, range [0, 1], default 0.5, `handle: {item: "knob", along: "x", travel: 680, drag: "along"}` |

A driver (`items/knob/at/pos/0 = 800 + 680 × controls/gain/value`) draws the thumb in the app where the session's
reading of `handle` puts it. What a key's pointer lands on is drawn in `muted`, so a pointer in ink, in the ground's
color or in the accent shows on it; criterion 6 can't see a pointer drawn in exactly `muted`. The tour: `keys: {fire: [[2, 1, "hold"]], gain: [[4, 0, "linear"], [6, 1, "hold"]], lamp:
[[8, true, "hold"]]}`, `idle_after: 0`, `loop: false`: the issue's "press key at 2 s, a slider key from 0 to 1 over 4 s
to 6 s and a toggle key at 8 s".

| Used by | Variation | Expected values, and where they come from |
|---|---|---|
| AC1 | none (pointer at its defaults) | at 2 s the tip within 1 px of (420, 390); at 4 s of (800, 540), the thumb at the key's value 0 (it rests at 0.5, (1140, 540), until then); at 4 s + i × 0.1 s, i = 0…20, of (800 + 680 × (t − 4) ÷ 2, 540); at 8 s of (1500, 790): the criterion's 1 px, the fixture's boxes. 120 sample times: mulberry32 seeded 903, 1 + ⌊r × 10 s⌋ flicks, sorted; none falls on a frame of 30, 60 or 120 fps; 24 lie in (4 s, 6 s) |
| AC2 | keys `fire` at 2 s and `lamp` at 2.2 s only; `pointer: {glide: 0.5}` | at 2 s within 1 px of (420, 390), at 2.2 s of (1500, 790), 1,152 px away: the criterion's 0.2 s and 0.5 s |
| AC4 | `resume_after: 2`; `lamp`'s key at 14 s | at 6.4 s within 1 px of the thumb at 1, (1480, 540); the click at 6.5 s; the fade read 0.1, 0.15 and 0.3 s after it began (the issue's 0.2 s); the drag from 7 s to 8 s; nothing drawn until 10 s = 8 s + `resume_after`; back at 10.1 s where it was |
| AC5 | `pointer: {show: true}` and `{show: false}` | equal hash, track and 51 control readings; `gain` reads 0.5 at 1 s and 1 at 7 s |
| AC6, AC8 | none, and `pointer: {show: false}` | 120 frames at 12/1, 1920 × 1080; the keys' frames 24, 48, 96; the anchors (420, 390), (800, 540), (1500, 790) |
| AC7 | none, with the session's `reduced_motion` | no entry, opacity 0 at 21 times |

**The riding card** (`cardDoc`, AC3): a `scene`, 640 × 360, in #506's scene form. A cart (`mark.box@1`, 0.4 m) whose
position a channel moves linearly from (−1.5, 0.5, 0) m at 0 s to (1.5, 1.5, 0) m at 4 s; a pinhole `camera@1` at
(0, 1.6, 6) m aimed at (0, 1, 0) m, `fov` 50° across the frame's wider side (#378, as #506's suites read it); the card
`overlay.frame@1 {frame: "card-frame", anchor: {item: "cart", point: [0, 0, 0]}, offset: [-60, -40]}` holding a
120 × 80 px frame with a background and the button `card-button`, box (40, 20, 40, 40) px; the toggle `card-switch`,
`targets: {switch: "card-button"}`; a tour with one key, `card-switch: [[3, true, "hold"]]`. The button's centre is the
frame's centre, which the offset puts on the projection of the cart's point. Scratch run: the cart's point projects to
(362.765, 165.816) px at 2.5 s and **(405.708, 151.572) px at 3 s**, 45.2 px apart; the card stays inside the 24 px
safe frame from 0 s to 4 s.

## Criteria to tests

IDs are `#903.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #903.<id>`;
each file quotes its criterion in full and lists what it asserts.

| AC | ID | File (tests) | What it asserts | Planted program |
|---|---|---|---|---|
| 1 | `#903.dd86ae00` | `ac1-keys-seek-play.test.ts` (3) | the tour's entries at 2, 4 and 8 s; the tip within 1 px of each key's anchor at its time and of the thumb at 21 times from 4 s to 6 s; 120 seeded readings played at 30, 60 and 120 fps equal the seeked ones, with 20 or more different places among them; the plant fails naming the first sample that differs | `tour_pointer_frame_clock` |
| 2 | `#903.406ccd5b` | `ac2-keys-in-a-gap.test.ts` (2) | at 2 s on `fire`'s anchor, at 2.2 s on `lamp`'s; the plant fails naming the earlier key | `tour_pointer_glide_before_key` |
| 3 | `#903.92244161` | `ac3-card-over-3d.test.ts` (1) | `eval` at 3 s: the tip within 1 px of the cart's point projected, where the card's control then is | – |
| 4 | `#903.da7f464f` | `ac4-click-yield-resume.test.ts` (3) | the click at the pointer's own tip writes your entry on the slider under it; the fade; nothing drawn while you drag or in the quiet; back at its last position after `resume_after`; under way half a glide before the tour's next entry and on that control's anchor at it; the plant fails naming the control | `tour_pointer_takes_hits` |
| 5 | `#903.b48e3025` | `ac5-show-changes-nothing.test.ts` (1) | hash, track and every control reading equal with `show` true and false, the pointer drawn in one and not in the other | – |
| 6 | `#903.772321ac` | `ac6-export.test.ts` (2) | both exports 1920 × 1080; with `show: false` every pixel of each key's frame is its rectangle's flat color; with the pointer, that frame differs within 4 px of the key's anchor; `determinism`: played and seeked pixel hashes equal at 8 times and not the hidden twin's; INCONCLUSIVE off a reference Mac | – |
| 7 | `#903.f0bb108a` | `ac7-reduced-motion.test.ts` (1) | under reduced motion no entry and opacity 0 at 21 times, against the same run without it | – |
| 8 | `#903.1034b873` | `ac8-taste.test.ts` (1) | the check run's five files, then the recorded taste call on exactly those bytes | – |

Criteria 3, 5, 6 and 7 name no wrong program. Each fails at the base on its own assertion and on a program that
ignores its clause (the wrong programs each file's header lists), so no plant is added for them.

## The taste call

`ac8-taste.test.ts` is the check run. It first checks by replies, never by a picture, that a pointer draws at the
times it photographs. Then, into `docs/evidence/903/`, each encoded again here so the same pixels give the same bytes:

- `pointer-press.png`, `pointer-slider.png`, `pointer-toggle.png`: the app's window at the reference size at 2×
  (3024 × 1964 px), through `deep-show screen`, at 2.1 s (0.1 s into the press's ring), 5 s (riding the thumb) and
  8.1 s (0.1 s into the toggle's ring);
- `export-1920x1080.png`: the film's frame 25 (2.083 s) from `export`, 1920 × 1080;
- `tour-pointer.apng`: the recording, the window at 1× at 73 times from 1.4 s to 8.6 s, ten frames a second.

Their SHA-256s are printed. Attach them to the PR and show them in the session; whoever is given the answer records it
in `tests/acceptance/903/TASTE.json` (this job wrote none, and no agent records a call it wasn't given):

```json
{"issue": 903, "criterion": "#903.1034b873", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "<ISO 8601>",
 "screenshots": {"pointer-press.png": "<sha256>", "pointer-slider.png": "<sha256>", "pointer-toggle.png": "<sha256>",
                 "export-1920x1080.png": "<sha256>"},
 "recordings": {"tour-pointer.apng": "<sha256>"}, "note": "..."}
```

With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it. No other test reads a
picture to judge it: criterion 6 compares pixels with pixels and counts them, and never says how the pointer looks.

## Readings where the issue and the design disagree or leave a choice

The first three are disagreements a criterion runs into. They are not settled silently here: each is tested in the one
way both sides allow, or flagged for the issue.

1. **Where a document holds its tour.** Tour's Fields give `tour: {…}`. The Document envelope's field list has no
   `tour`, and the base's check refuses any key outside that list (`unknown_field`), so the app presents no document
   with a tour today. #308's suite, the base's session, its logic piece and its geometry audit all read `tour` at the
   top level, so this suite writes it there, and criteria 3, 6 and 8 need `deep_show` to take it. The envelope's list
   and the Tour section should be made to agree in the design.
2. **The fade against "never draw while you give input".** The Scope and criterion 4 say your first gesture fades the
   pointer over 0.2 s; the Fields say it can never draw while you give input. For a gesture held longer than an
   instant the two disagree about its first 0.2 s. No test reads the pointer while the first gesture is held: the first
   gesture is a click, over 0.05 s after it began, and the fade is read after its release; "no pointer pixel draws
   while you drag" is read in a drag that starts after the fade has ended.
3. **Riding the thumb against the glide rule.** "A slider key from 0 to 1 over 4 s to 6 s" needs a second key row at
   6 s in `[[t, value, interp]]`. The glide rule ("for each key on an anchored control … starts gliding at the later of
   the previous key's time and the key's time minus glide") applied to that row would pull the pointer up to 33 px off
   the moving thumb between 5.5 s and 6 s; "an interpolated slider key keeps it on the thumb until the value stops"
   says otherwise. Criterion 1 states the thumb, within 1 px from 4 s to 6 s, and that is what is asserted.
4. **A tour's interpolated key.** The base's tour ignores `interp` and writes every key as a held entry (#308's suite
   used hold keys only). Criterion 1 needs the slider's value to move, so the key is read by Channel and key: linear
   from 0 at 4 s to 1 at 6 s. How the track carries it is not asserted; only that the tour writes an entry on `gain`
   stamped 4 s.
5. **A resumed tour's clock.** The design doesn't say whether a resumed tour starts its keys again or goes on (#308's
   suite left it open; the base starts again). Criterion 4 reads the tour's next entry from the run's own track and
   holds the pointer to that entry's control and time; the fixture's last key is late enough that one is still to
   come either way.
6. **"The card's anchor"** (criterion 3) may be the control's anchor on the card or the overlay's own anchor point.
   The fixture makes them one place.
7. **A control's hit box.** The design draws a control's own UI through `overlay.controls@1`, which the base doesn't
   build. This suite takes the box the base's own hit tests take: a slider's handle item at its value (criterion 1
   forces this: at 4 s the tip must be within 1 px of the anchor and of the thumb), a press's or a toggle's `targets`
   item. #506's card button named its item by `handle: {item}`, which no code at the base reads; the riding card uses
   `targets`, as the board does. A control with neither has no anchor.
8. **"An export of the tour."** Export has no field that picks the tour. No one gives input to an export, so the
   viewer is idle from the start and the tour plays from `idle_after`; the same for `eval`, `determinism` and a window
   no one touches. `idle_after: 0` in every fixture makes the tour's clock the document's under any other reading of
   where it starts.
9. **"The same pixel hash seeked and played"** is Determinism's GPU `pixel_hash` through #1897's `determinism` on the
   film, not the export receipt's BLAKE3 frame hashes. "On the reference Mac" is the criterion's proof depth:
   INCONCLUSIVE elsewhere.
10. **Seeked and played** (criterion 1): played is one session advancing to each time in turn, at each of three frame
    rates; seeked is a session that plays the whole tour once, then seeks to the times in a shuffled order, as #308's
    scrub does. Equality is exact.
11. **Tolerances the issue doesn't give.** The export's pointer is located by its differing pixels, some within 4 px of
    the anchor (the 1 px of the tip, plus what antialiasing and an unknown glyph leave); flat rectangles are read 2 px
    or more from an edge. The fade's curve is not given: it is held to lie between 0 and 1, never rise, and end.
12. **`opacity`** is this job's reading of "draws": 0 is no pointer pixel; 1 is the pointer undimmed.
13. **"The app at the reference window"** (criterion 8) is `deep-show screen` at 1512 × 982 points, as #542's and
    #539's check runs take theirs.

## Not tested, and why

- **The ring** (`ring`, 0.3 s on a press or a toggle), the pointer's look and size, and the shape of the glide's ease
  between its ends: no criterion gives a number; the taste call sees them. Criterion 4 asserts only that the pointer is
  under way mid-glide.
- **A key on a control with no anchor** leaving the pointer where it is: in the Scope, in no criterion.
- **Where the pointer is before the tour's first key and after the last key of a tour that doesn't loop:** not given.
  Those times are only compared seeked against played.
- **A looping tour** and the tour's own timing (`idle_after`, the yield, the resume): #308's criteria.
- **A click on a press's or a toggle's own button under the pointer:** the click-through is asserted on the slider,
  where both ways a resumed tour may keep its clock leave a next key in another place.
- **Pixels in the live window while you drag:** "no pointer pixel draws" is read as `opacity` 0 from the module that
  owns the pointer; the app's live yield and resume have no criterion of their own beyond it.
- **The Oracle lane:** the issue has no Oracle line.
