# Acceptance tests for #491: markers and the tempo map: beat grids, tempo ramps, occurrence lists, first-time markers and layouts that glide

Written first, from issue #491 (its Scope, its Fields, its six acceptance criteria and its Proof line: "Beat and tempo
fixtures to the flick, the occurrence-list reads at chosen times, and the refused literal time"), the design sections
it names and those they lean on, and base commit `e2e6e1cc` ("Merge pull request #1211 …", origin/main), by a job that
never saw an implementation; none existed, and no other worktree or branch was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 491 --repo windoliver/deepbuild`.
- Its Oracle page, `doneright/oracles/issues/491.md` on branch `doneright` of `DeepBuildAI/deepbuild`: **not
  reachable** from this job (`gh api` answers 404 for the account this box is logged in as). The issue says no upstream
  test checks these criteria, so nothing is ported.
- `docs/canvas-primitives.md` at the base: Time and the flick (the units, the `"2:1b"` form, "Display times round to
  the nearest flick"); Transport (`frame_rate`, "hold time in f32 seconds" under It can never); Marker (`t: time | first
  {expr, vars, after, before}`, `kind`, `payload`, `tags`, "beat markers come from the tempo map or a beats bake",
  `markers.<kind>`, the `first` solve); Marker: present mode (holds in whole bars); Channel and key (types, `enum`
  hold only, interps); Driver (`vars` with an occurrence list and its filter `{list, kinds, a, b, tags, where}`,
  `fallback`), Driver: time offsets (look-ahead refused where inputs feed the chain); Tempo map and cue alignment (the
  segment and cue fields, the closed form, "refused, naming both", the `literal_time_with_tempo_map` notice); The
  closed function list's Occurrence lists row (count, last, since, next, rank, inside; "last(list) the latest match's
  flick"; next refused as a look-ahead where inputs feed the list; `last(list).field`); Occurrence list; Frame and
  group `frame@1`; Auto layout ("A frame's layout fields are channel targets … a row glides into a grid"); Spawn:
  tempo grid (lines from n in integer arithmetic); Input track (entries).
- `docs/technical-design.md`: Films and figures on the canvas; Dogfooding; Tests written first; the "Who drafts it",
  "Proven on the base", "Failing on an assertion" and "Numeric contracts" paragraphs.
- At the base: AGENTS.md; `crates/deep-motion/src/main.rs` (the `deep-motion` CLI: `eval`'s input line and answer,
  its `markers` and `cuts`, `planted`, `input`, `bounds`); `crates/deep-canvas-motion` (`src/doc.rs`: markers and
  their kinds, `time_of`, drivers and their vars `time`, `controls/<id>/value`, item paths; `src/eval.rs`; the
  enumerated channel fields); `crates/deep-canvas/src/grammar/time.rs` (the time grammar: `"<s>s"` with at most five
  fraction digits, `"<n>f"`, `"<bar>:<beat>b"` with whole bar and beat, `@anchor`; a bar:beat is `time_unresolved`
  with no tempo map); `crates/deep-canvas-marks/src/layout.rs` and `src/main.rs` (`frame@1`'s `params.layout`, `gap`,
  `grid.cols`, children by `parent` and `order`; `deep-layout solve` answering `boxes: {id: [x, y, w, h]}`); the
  merged blind suites `tests/acceptance/489/` and `490/`, whose layout and conventions this one follows.
- Probes of the base build: `deep-motion eval` on a film with a `tempo_map` (ignored, its literal marker resolved),
  a `beat` marker (`bad_marker_kind`), an enum channel keyed `linear` (`bad_interp`); `deep-layout solve` on this
  suite's frame in `row` and in `grid`, which gave the boxes `layout-glide.test.ts` writes by hand.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/491 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/491/tsconfig.json   # type-check (exits 0)
```

`--root` keeps the repo's `vitest.config.ts` out; a root with no config of its own uses Vitest's defaults. It leaves
Vitest's cache in `tests/acceptance/491/node_modules/.vite`; delete it, it is not part of the suite.

Each file builds `deep-motion` once, in `beforeAll` (`cargo build --locked --bin deep-motion`, honoring
`CARGO_TARGET_DIR`), and copies it out under its own name; every test of a file fails when its build fails. The files
build a cargo binary, so they run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/491/'` added to its
`alone` list (this job writes only this folder; the implementer makes that edit). Every `it` passes `TIMEOUT` (30 min).
Once built, the whole suite runs in seconds at the base; the 100,001-marker grid is the largest input (about 4 MB).
The issue states no timings, so nothing is timed. Node built-ins and vitest only.

## The surface under test

The issue names fields, functions, a notice code and observations but no code API, so these tests extend the surface
#391, #489 and #490 left (`deep-motion eval`), add no binary and no subcommand, and read nothing else. **Every name
below that the issue or design doesn't give is this job's choice** (each is listed again under Choices), the smallest
surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind
redraft.

### `deep-motion eval` (#391's JSON-lines convention, unchanged)

Input `{"doc": Document, "times": [flick], "planted"?: name, "input"?: [entry]}` as at the base. Output `{"ok": true,
"frames": [Frame], "markers": {id: {kind, t, end}}, …}` or a refusal `{"ok": false, "code": string, …}`; the tests read
a refusal's whole JSON for the IDs and times it must name. New:

- `planted: "beat_grid_f32_seconds"` (Planted programs).
- In the answer, `notices: [notice]`: the notices the check raised on an accepted document, each `{code, …}` naming
  what raised it (its ID or path) and, for `literal_time_with_tempo_map`, offering its fix forms as strings (the tests
  search the notice for a string of the form `<bar>:<beat>b`; the field's name is the implementer's, `fix` suggested).
- In each frame, `boxes: {id: [x, y, w, h]}`: every item a laying-out `frame@1` places, in document u, as
  `deep-layout solve`'s `boxes` gives them, at that frame's time (with a key on the layout, the mixed boxes).
- In `markers`, as at the base, every marker's resolved `t` in flicks; now also markers written in bar:beat form,
  `first` markers, and kinds `beat` (and the rest of the design's kinds).

### Documents

#391's envelope (`{format: 1, id, profile: "film", title, description, size, transport, items, …}`) with:

| Field | As the tests write it |
|---|---|
| Tempo map | document `tempo_map: {segments: [{at, bpm, meter, span, ramp}]}`; `at` a bar:beat (`"5:1b"`) or a time (`"2s"`); `meter: [beats per bar, beat unit]`; `span` in beats (a number); `ramp: "none"` or `{to_bpm, shape: "linear_in_beats"}` |
| Marker | `markers: {ID → {kind, t, span?, tags?, payload?}}`, `kind` `cue`, `section` or `beat`; `t` a time literal, bar:beat included, or `{first: {expr, vars, after, before}}` |
| Occurrence list var | a driver var `{list: "markers.beat", tags: ["kick"]}` (Driver: the filter `{list, kinds, a, b, tags, where}`); `{list: "input.<control>"}` the input track's entries for that control, a list inputs feed |
| Occurrence functions | `count(v)`, `last(v)`, `since(v)`, `next(v)`, `rank(v)`, `last(v).<payload field>` in a driver's `expr` |
| Driver | `drivers: {ID → {target, expr, vars, fallback}}` (#411/#489), writing `items/<id>/at/pos/0` |
| Control | `controls: {tap: {kind: "slider", class: "document", label, range, default}}` (#489's) with input entries `{t, seq, control, value, writer: "you"}` |
| Frame and layout | a `frame@1` item with `params: {box, layout: "row", gap: 10, grid: {cols: [40, 40]}}` and `rect@1` children by `parent` and `order` (#375's fields) |
| Layout key | channel `{target: "items/<frame>/params/layout", type: "enum", keys: {row: {t: "0s", value: "row", interp: "linear"}, grid: {t: "1s", value: "grid"}}}` |

### Planted programs

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `beat_grid_f32_seconds` | eval `planted` | 1 | the beat grid kept in f32 seconds: beat k's time is the f32 product f32(k) × f32(60 ÷ bpm), converted to flicks by an f32 multiply by 705,600,000 and rounded to the nearest integer; everything else as the real program. At 120 BPM its first wrong beat is beat 13 (helpers.ts `f32GridFirstWrong`) |

## Criteria to tests

Each test's name starts with `criterion <n>`. The criteria, quoted in full from the issue:

1. "A 120 BPM beat grid places beat k at exactly k × 352,800,000 flicks for k up to 100,000; a planted grid kept in
   f32 seconds fails, naming the first beat that differs"
2. "With a tempo map, a boundary written on a downbeat lands within one frame of it, and beat times round to the
   nearest flick"
3. "A 16-beat ramp from 90 to 150 BPM, linear in beats, ends 8.1732 s after it starts, within one flick of its closed
   form, and a segment whose explicit time is 2 flicks off its chained start is refused naming both times"
4. "A cue written as a literal 12.5 s in a film with a tempo map raises literal_time_with_tempo_map, and the bar:beat
   form it offers lands on the same flick"
5. "Over `markers.beat` filtered by the tag kick, with kicks at 1.0, 2.5 and 4.0 s whose payloads carry gain 0.6, 0.8
   and 1.0, a driver at t = 3 s reads count 2, last 2.5 s, since 0.5 s, next 4.0 s, rank 1 and last(kicks).gain 0.8;
   at t = 0.5 s count reads 0 and last(kicks).gain takes the driver's fallback; and next over a list that inputs feed
   is refused at check, naming the driver"
6. "With x = −4 + 3t, a marker at `first {expr: x − 3}` resolves to 7/3 s within one flick, and a condition never
   true before `before` is refused, naming the marker; and a linear key on a frame's layout from row to grid over 1 s
   puts each child at the midpoint of its two layout positions at 0.5 s within 0.5 px, seeking equal to playing"

| Criterion | File | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 | `beat-grid.test.ts` (2) | a 120 BPM 4/4 map of 100,004 beats; markers at beat k = 0 … 100,000 in bar:beat form each resolve to exactly k × 352,800,000 (fails any grid off by a flick anywhere); `beat_grid_f32_seconds` on the same document is accepted and fails that check, its first failure naming beat 13, the first beat whose flick differs |
| 2 | `tempo-map.test.ts` (2) | 107 BPM 4/4 for 8 bars, then 118 BPM 3/4 at `9:1b`, 24 fps: the `section` marker at `9:1b` within one frame (29,400,000 flicks) of 32 × 60 ÷ 107 s; every beat of both sections (56 markers) exactly its rational time rounded to the nearest flick (fails truncation, f32, a boundary off its downbeat, a meter change read wrong) |
| 3 | `tempo-ramp.test.ts` (2) | the ramp's `5:1b` minus its `1:1b` within one flick of 60·16 ÷ 60 · ln(150 ÷ 90) s and 8.1732 s to four places (fails a ramp linear in time, an Euler sum); an explicit `1.1021s` 2 flicks after a ramp's chained end 777,641,758 refused, naming 777,641,758 and 777,641,760 (or `1.1021s`), while an explicit `1.5s` on a chained start of exactly 1.5 s is accepted (fails a check that refuses every explicit time, or allows 2 flicks) |
| 4 | `literal-time.test.ts` (1) | the cue `hit` at `12.5s` accepted at 8,820,000,000 flicks; a `literal_time_with_tempo_map` notice naming `hit` offers a bar:beat string; written back, that form resolves to 8,820,000,000 (fails no notice, a wrong offered beat) |
| 5 | `occurrence-lists.test.ts` (3) | at 3 s: count 2, rank 1, last(kicks).gain 0.8 (1e-12), last 2.5, since 0.5 and next 4.0 in seconds (1e-9) or flicks (1 flick), one unit for the three (fails a filter that lets the snares in, a read after t); at 0.5 s: count 0, gain the fallback 0.25; next(taps) over `input.tap` refused naming `peek`, while last(taps) over it is accepted and reads the entry's 1.5 s at 2 s |
| 6 | `first-marker.test.ts` (2) | x reads −4 at 0 and 3 at 7/3 s; `first {expr: "x - 3", …, before: "4s"}` resolves within one flick of 1,646,400,000; with `before: "2.5s"` it resolves there too, and with `before: "2s"` it is refused naming `late` |
| 6 | `layout-glide.test.ts` (1) | the frame's children at 0 s on their row boxes, at 1 s on their grid boxes, at 0.5 s on the midpoints (c at (70, 30), d at (120, 30)), each 40 × 30, within 0.5 px; a seek to 0.5 s gives the same boxes as the play (fails a layout that snaps, a hold, a glide that steps per frame) |

## Choices where the issue is open

1. **Surface.** Everything is read through `deep-motion eval`, motion's proof binary, as #489 and #490 did: marker
   times from the answer's existing `markers`, driver values from the items they write, notices from a new answer
   field `notices`, laid-out boxes from a new frame field `boxes` (named after `deep-layout solve`'s answer). No new
   binary or subcommand.
2. **The tempo map** is the document field `tempo_map: {segments}` (Spawn's `quantize` names "the document's"
   `tempo_map`). `meter` is `[beats per bar, beat unit]`; bpm counts the meter's beats; `span` is a JSON number of
   beats; `ramp` is `"none"` or `{to_bpm, shape: "linear_in_beats"}`. Every segment the tests write holds whole bars.
3. **"time (first segment only)"** is read as: the first segment's time sets where bar 1 starts; a later segment may
   still carry an explicit time, which must lie within 1 flick of its chained start (the criterion's refusal needs
   one). A segment's explicit time is written as a time literal; `1.1021s` is the one 2 flicks off the 2-beat 80 → 144
   BPM ramp's chained end (777,641,757.67 rounded), found because a literal of five fraction digits is a multiple of
   7,056 flicks. Its accepted twin is a constant 80 BPM first segment, exactly 1.5 s, followed by `1.5s`.
4. **"Naming both times"** is read in flicks or seconds: the refusal's JSON holds the chained start as 777,641,758 (or a
   number of seconds that rounds to it) and the explicit time as 777,641,760, 1.1021 or `1.1021s`.
5. **Reading a beat's time.** A beat is read through a marker written at its bar:beat (the time grammar already parses
   `"<bar>:<beat>b"` and the answer already lists markers' flicks), so criterion 1 needs no new output. The grid's map
   runs 100,004 beats so beat 100,000 falls inside it, not on its end.
6. **Criterion 2's boundary** is a `section` marker written on the downbeat where the tempo and meter change (the
   issue's Scope: "each section holds whole bars and its boundary lands on a downbeat"); "within one frame" is one
   frame at the film's 24 fps. **"Round to the nearest flick"** is round(exact rational time): the fixture's tempos
   (107 and 118 BPM, neither a whole number of flicks a beat) keep every beat at least 0.04 flick from a tie, and give
   the same flick whether the second section's start is rounded first or not, so the reading of the chain doesn't
   matter.
7. **The ramp's length** is the second segment's `5:1b` minus the first's `1:1b`, the first segment starting at 2 s;
   "8.1732 s" is checked to its four places (±0.00005 s), the closed form (8.173210 s, computed here) within one flick.
8. **The literal cue** is a marker of kind `cue` at `"12.5s"`; the document is accepted (a notice is no refusal); the
   notice is the one with that code whose JSON names `hit`, since other literal times (the transport's span) may raise
   their own. Its offered bar:beat form is any string in the notice matching `<bar>:<beat>b`; only that it lands on
   12.5 s is asserted, not which bar it names (here `6:2b`).
9. **Beat markers** are authored with kind `beat` on the tempo map (their times in bar:beat), each with `tags` and a
   `payload`, so they come from the tempo map as the Marker section requires; untagged beat markers a map may generate
   are left out by the `kick` filter.
10. **The units of last, since and next.** The design says last and next read a match's flick and since t minus it;
    the criterion writes seconds. The tests accept either (seconds within 1e-9, flicks within one flick), the same unit
    for all three reads.
11. **A list inputs feed** is `input.<control>`: the input track's entries for one control, each an occurrence at its
    `t` with its `value` as payload. Motion has no other list an input feeds without the logic or physics module. So
    the refusal is the look-ahead's, the same list read with last(taps) is accepted and reads the entry's time.
12. **The fallback** is the driver field `fallback: 0.25`, given to every driver of the fixture; only count's 0 and
    the gain driver's fallback at 0.5 s are asserted.
13. **The `first` time** is written `t: {first: {expr, vars, after, before}}`; x is an item path a linear channel
    writes, so the solve reads the same x a frame does. "Refused naming the marker" is a refusal whose JSON holds its
    ID; its accepted twin (before 2.5 s) shows the refusal is the condition's.
14. **The layout key** is an `enum` channel on `items/<frame>/params/layout` with `interp: linear` on the row key (the
    one channel where a linear key on an enum mixes, as Auto layout says); "each child's position" is its laid-out box
    `[x, y, w, h]` in document u (px at zoom 1), sizes included. The row and grid boxes are written by hand from the
    fields and agree with the base's `deep-layout solve`. Seeking equals playing is one seek to 0.5 s against a play
    through 0, 0.25, 0.5, 0.75 and 1 s.
15. **The plant** is defined exactly (Planted programs), so its first wrong beat, 13, is computed here and asserted;
    the check names a beat as `beat <k>:` at the start of its failure line.

## What the base already does and these tests don't credit

`deep-motion eval` resolves markers of kinds cue, shot, section and record from seconds, frames and `@marker` times,
evaluates drivers over `time`, controls and item paths, and accepts a `tempo_map` field by ignoring it. A bar:beat
time is `time_unresolved` (no tempo map is read), a `beat` marker is `bad_marker_kind`, an object `t` and an object
driver var are refused, an enum channel keyed `linear` is `bad_interp`, no notice is reported and no frame reports
laid-out boxes. Every test fails at the base, on its assertion (`BASE-FAILURE.txt`).

## Scope not under a criterion

The issue's Scope also names shots, hard cuts and cross-fade, wipe and zoom-through transitions; tempo changes at a
marker written as `@marker`; word markers from a bake; the cue fields (`anchor`, `offset`, `move`, `snap`,
`tolerance`, `land`); `inside` and `count(list, a, b)`, the filter's `kinds`, `a`, `b` and `where`; `next(list).field`;
a `first` condition that reads the input track or that the forms can't settle. No criterion states an observation
for them, so these tests don't check them; they are follow-ups for the implementer's own tests.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria; its Oracle page was not reachable from this job. Nothing is
ported.

`BASE-FAILURE.txt` is the run at the base.
