# Acceptance tests for #392: status and bound values, and the clean pipeline look

Written first, from issue #392 (its scope, the Bound value, Status binding and Look `look@1` fields, its three
acceptance criteria and its proof line), its Oracle page (`doneright/oracles/issues/392.md` in
`DeepBuildAI/deepbuild`, branch `doneright`, which says no upstream test covers any criterion), the design
sections it names and those they lean on (`docs/canvas-primitives.md`: Conventions every primitive uses, line
7, with the path grammar, 38, Handles, 46, the status-color rule, 68, Honest numbers, 76, and the cost model,
82, with its budget table's "core view" row, 92, and "Every class draws nothing while still", 99; Frame clock
and scheduler, 713; Invalidation and damage, 729; Marks, data and diagrams, 1363, with Text, 1369, Mark set,
2041, Bound value, 2128, Held reading, 2150, Status binding, 2167, Scale and encode, 2184, and Look `look@1`,
2397; What holds a document to its rules, 8155; Status guard, 9208; the operator budgets' "core view" row,
9313; `docs/technical-design.md`: The canvas core, line 1041, with its module table and the Conventions
paragraph after it; Document, 1088; Dogfooding, 2508, and Tests written first, 2539; and the replica's text
snapshot "of accessibility roles, names, values and bounds … plus the canvas items drawn", line 2662) and base
commit `5f498a6` ("Merge pull request #651 … feat/391-line-motion-marks"), by a job that never saw an
implementation; none existed. The conventions follow #389's, #390's and #391's suites. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (like #391's they build a cargo binary, so they run with `--no-file-parallelism`; `scripts/lanes.mjs`
needs its exclude and its one-at-a-time line widened to this folder, as #391's README says for its own):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/392 --no-file-parallelism
```

Every file first runs `cargo build --locked --bin deep-canvas-render` in the checkout (cached after the first
file) and fails each of its tests when the build fails. The GPU files write PNGs under the OS temp folder and
delete them. The tests use only node built-ins and vitest, and type-check under the root `tsconfig.json`'s
strict options with `allowImportingTsExtensions` and `noEmit` (checked with a copy of the options outside the
repo whose `include` is this folder). A run with `--root tests/acceptance/392` leaves Vitest's cache in
`tests/acceptance/392/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base: every test
fails there, because `deep-canvas-render` has no `check` or `look` subcommand, and its `render` and `frames`
answer `bad_input` to a look named by ID.

`check.test.ts` and `look.test.ts` run on every platform: the document check and the look need no GPU.
`status.test.ts` and `stale.test.ts` (pixels, frames and GPU time) need macOS, as #391's GPU tests do: off
macOS, and whenever `deep-canvas-render` answers `unsupported_platform`, they fail with a message that starts
`INCONCLUSIVE:`; they never pass there.

## The surface under test

The issue names no code API. These tests extend #391's proof surface, the `deep-canvas-render` binary
(`target/debug/deep-canvas-render`, crate `crates/deep-marks-render` at the base), since it is the one binary
that links the 2D marks, the text module and the frame clock. Nothing else is read. #391's JSON-lines
convention holds unchanged: one JSON object in per stdin line, exactly one out per line, in order, exit 0; a
line that isn't JSON, lacks a required field or names an unknown `planted` value answers `{"ok": false,
"code": "bad_input"}` with no panic, before anything platform-specific. Times are flicks as JSON integers.
Everything #391's README defines for `frames` and `render` stays as it is; the fields below are added.

### Looks

Wherever a request takes `look`, it is one of:

- #391's role map `{"light": {role → [r, g, b]}, "dark"?: {…}}` (unchanged, so #391's tests still run);
- the ID of a shipped look: `"clean"`, the clean pipeline look this issue ships;
- a `look@1` object, in the form `look` returns it (below). The tests only ever send the clean look as `look`
  returned it, with one change: two entries of `status` swapped, or one entry of `status_treatment.glyph`
  set to another state's glyph. They never write a color, so the colors' notation is the implementer's.

The clean look, as `look` resolves it, is a `look@1` with `id: "clean"`, `status` naming a color for each of
the nine states (`pass`, `fail`, `invalid`, `blocked`, `inconclusive`, `running`, `needs_you`, `stale`,
`idle`), `status_treatment.glyph` giving each state a non-empty glyph, all nine different, `legend: "auto"`,
and `themes` with exactly `light` and `dark`. Its roles include `ground`, `ink` and `muted`, which the
fixtures' texts and the scale twin name. A status color is reached in a document only through a status
binding; a paint or a scale that names one does so as the role `status.<state>` (such as `status.fail`).

### Documents

As #391's README, plus:

- `status_bindings: {ID → {"target": "items/<id>/params/paint/fill", "source": handle}}`; the handle is a
  `verdict:`, `run:`, `ask:` or `session:` handle (Status binding). A `rect@1` with no `paint` and a fill
  binding is a status mark: the binding gives its fill.
- `bound_values` entries may carry `stale_after` (a time literal, `"2s"`).
- `budget: {"class": "core view"}` (the cost model's class for the line).
- `scale@1` may take `range` as a list of roles and `marks@1` may encode `role: {column, scale}` (Scale and
  encode), only in the check's documents.

### `deep-canvas-render check` (every platform)

Input `{"doc": Document, "look": look}`. Output `{"ok": bool, "issues": [Issue]}`, the issue shape #389's
README gives (`{check, code, severity, ids, path, actual, what, fix}`); `ok` is false when any issue has
severity `error`. Two codes are read:

- `number_unsourced`: a number shown with no source and as-of time; `ids` holds the item, `path` the field
  that shows it (`items/<id>/params/text`). A number in a text's own string is one (the honest-numbers rule:
  every number on screen is computed in the document or is a bound value with its source and as-of time).
- `status_color_unbound`: a status color taken from anything but a status binding whose source is a verdict,
  a run, an ask or a session: a paint that names a status role (a literal), a status binding whose source is
  a reading (a number that only a threshold could turn into a state) or a scale whose range holds status
  roles. `ids` holds the item that takes the color (for the scale, the mark set; the scale may be named with
  it).

### `deep-canvas-render look` (every platform)

Input `{"look": look}`. Output `{"ok": true, "look": look@1}`, the look resolved (a shipped look's whole
definition), or the status guard's refusal `{"ok": false, "code": "status_glyph_shared", "pair": [state,
state]}` for a look that gives two states one glyph, naming exactly those two (in either order).

### `deep-canvas-render render` (macOS)

Added input `"states"?: {handle → state}`: the record's state for each status binding's source, pinned to
the frame, standing in for the record as `readings` does for bound values. Added output, the text snapshot
of the status marks and the legend drawn:

```json
{"ok": true, "width": n, "height": n,
 "marks": [{"item", "binding", "state", "color": [r, g, b], "bounds": [x, y, w, h], "glyph"?: string, "word"?: string, "label": [x, y, w, h]}],
 "legend": [{"state", "glyph", "word", "color": [r, g, b], "swatch": [x, y, w, h]}]}
```

One `marks` entry per status binding drawn: its item and binding IDs, its state, the sRGB-encoded color its
pixels draw, its bounds, the glyph (the look's for its state) or the word it draws in the same item, and the
box of that glyph or word, which lies wholly inside the mark's bounds or wholly outside them. One `legend`
entry per state on screen, with the glyph, word and color it shows and its swatch's box. Boxes are in pixels
of the PNG (u at zoom 1, scale 1). A look the status guard refuses is refused here too, with the same
answer, and nothing is drawn.

### `deep-canvas-render frames` (macOS)

Added input:

- `readings` values may be `{"value": number, "as_of": flick}`: the reading and its as-of time, on the
  record's clock (a bare number is #391's, with no staleness);
- `"start"?: flick = 0`: the host time of vsync 0;
- `"replay"?: {"record_t": flick}`: the run replays the record, so the frame at vsync k is pinned to record
  time `record_t + k × Δ`; in a live run (no `replay`) it is pinned to host time `start + k × Δ`;
- `"captures"?: [{"vsync": k, "out": path}]`: write the frame on screen at vsync k (the last one presented)
  as a PNG, as `render` writes one. The counters of a run with captures are not read;
- `"planted"?: "arms_only_on_readings"`: the criterion's planted frame clock, reachable only through this
  field and only for this proof: it arms frames on readings (and the session's first frame) but never at the
  time a bound value goes stale.

Added output, per vsync: `"bound": {bound value ID → {"text": string, "stale": bool, "age": flick | null}}`,
each bound value as the frame on screen at that vsync shows it: its text, whether it is shown stale, and the
age it shows (the pinned time minus the reading's as-of time) when stale, null when live. `t` stays `k × Δ`
from the run's start, as in #391.

## Fixtures

Written by this job before any implementation ran.

- `fixtures/ask-line.json`: the ask line, a 640 × 376 core view with nine rows, one per state: a 96 × 24
  `rect@1` status mark at x 16 whose fill is bound to a `verdict:`, `run:` (running), `ask:` (needs you) or
  `session:` (idle) handle, and its title as text beside it (words only, no numbers). The tests give each
  handle its row's state through `states`. The rows are 40 px apart, so 2–4 px around each mark is
  background; the right of the line is free for the legend.
- `fixtures/stale-value.json`: a 320 × 96 core view with a label and one text, `count`, at (16, 48) in a
  280 × 24 box, whose text is the bound value `open-asks` of `reading:01JB3000000000000000000001` with
  `stale_after: "2s"`. Nothing else moves.

## Criteria to tests

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, a comment at the
assertion that catches it says so.

| ID | Criterion clause (the issue's text) | Test, and the wrong program it fails on |
|---|---|---|
| AC1 | A document that shows a number without its source and as-of time … is refused naming the item | `check.test.ts`: "12 checks passed" and "Took 3.5 s" typed into a text are refused with `number_unsourced` naming `tally` at `items/tally/params/text` (a check that never reads texts for numbers fails); the same text bound to a reading, and "All checks passed", pass (a check that refuses every text fails) |
| AC1 | … or takes a status color from a threshold, a scale or a literal, is refused naming the item | `check.test.ts`: a paint naming `status.fail`, a status binding whose source is a reading, and a mark set whose role goes through a scale onto `status.fail` and `status.pass` are refused with `status_color_unbound` naming `gate`, `gate` and `scores` (or `band`); the same mark bound to a verdict passes, and the scale onto `ink` and `muted` raises no `status_color_unbound` (a check that refuses every binding or every role scale fails). The ask line and the stale value pass, and the ask line with one literal status color is refused naming that mark |
| AC1 | … and a look that recolors status shows a legend | `status.test.ts`: the clean look's legend shows every state on screen with the look's glyph, a word and its marks' color, its swatch drawn in that color, in both themes; a look that swaps pass's and running's colors draws them swapped and its legend shows pass in running's old color (a legend fixed to the default map, or none, fails) |
| AC2 | Rendered under simulated protanopia, deuteranopia and tritanopia, the ask line fixture's text snapshot names a glyph or word for every status mark | `status.test.ts`: in both themes, for each deficiency, every one of the nine bindings is one mark in its state, naming a glyph (the look's for that state) or a word; where Machado 2009's simulation at full severity, computed by the test from the drawn fill pixels, leaves two states closer than 0.10 OKLab, their marks name different glyphs or words and draw different label pixels (a line that shows status by color alone fails) |
| AC2 | a planted look that gives pass and fail one glyph fails the status guard, naming the pair | `look.test.ts`: the clean look with fail given pass's glyph is refused `status_glyph_shared` naming pass and fail, while the clean look passes; each of the 36 pairs of states sharing a glyph is refused naming exactly its pair (a guard that special-cases pass and fail fails). `status.test.ts`: the ask line drawn with the planted look is refused the same way. `look.test.ts` also holds the clean look to the issue's look fields: all nine states in its status map, nine different glyphs, `legend: auto`, a light and a dark theme |
| AC2 | in the light and dark themes every status mark keeps 3:1 contrast with its background, and its glyph or word 4.5:1 | `status.test.ts`: in each theme, for each mark, from the PNG: its fill (the most common pixel inside it) equals the color the snapshot names (status colors drawn exact), its contrast with the most common pixel 2–4 px around it is at least 3:1, and the label pixel with the most contrast against what is behind the label is at least 4.5:1, WCAG 2.x relative luminance (a look with a low-contrast idle grey or a glyph in the mark's own color, or a render with no glyph, fails) |
| AC3 | A still core view with one bound value of `stale_after: 2 s` and no further reading draws exactly one frame between 2.0 and 2.1 s after its as-of time, greyed with its age, and none before | `stale.test.ts`: the reading's as-of time is 7,000,000 flicks before vsync 0, so 2.0–2.1 s after it are vsyncs 120–125 at 60 Hz. Vsync 0 presents; vsyncs 1–119 present nothing and report no command buffer and 0 ns; exactly one of 120–125 presents, with GPU work, showing the value stale with age = its pinned time − the as-of time (a clock that never arms fails, one that rounds down draws at 119, one that redraws once stale draws six). From the captures at vsyncs 119 and 125: the value's text turns grey (OKLab chroma ≤ 0.05) with less contrast on the ground than the live text, and its text on screen changes (its age) |
| AC3 | and a replay greys it at the same frame | `stale.test.ts`: the run replayed an hour later (`start` 3,600 s, `record_t` 0) passes the same check on its record time and presents and shows the same at every vsync as the live run (a replay that reads the host clock greys it at vsync 0) |
| AC3 | a planted frame clock that arms only on readings never greys it and fails, naming the value | `stale.test.ts`: the planted run shows the value live at every vsync, and the same check fails on it, every failure naming `bound value open-asks`, one of them the missing frame between 2.0 and 2.1 s |

The bad_input convention is checked once for each new subcommand (`check.test.ts`, `look.test.ts`).

## Readings where the issue and design leave a choice

- **One binary.** The check and the look are CPU work, but the document check must read the 2D marks and the
  text module, which only `deep-canvas-render` links; the core's `deep-canvas` never imports a module. So
  `check` and `look` join `render` and `frames` there and answer on every platform.
- **The codes.** The design names no code for these refusals; `number_unsourced`, `status_color_unbound` and
  `status_glyph_shared` are this suite's, so an agent branches on a code, never on text (What holds a
  document to its rules).
- **"A threshold, a scale or a literal".** In R1's documents a literal is a paint naming a status role; a
  threshold is a status binding fed a reading, the number a threshold would cut into states; a scale is a
  role scale whose range holds status roles. A status binding's own sources are verdicts, runs, asks and
  sessions (Status binding).
- **"Shows a number without its source and as-of time"** is read through Honest numbers: digits in a text's
  own string. Number words ("one taste call") and names with digits marked as names are not tested.
- **The ask line fixture.** The design's ask line (the line under the menu bar that lists asks as rows) has
  no fixture in the repo, so this job wrote one: a row per state, so every state's mark is checked.
- **"Rendered under simulated …".** The text snapshot doesn't depend on color, so the render takes no
  simulation option; the test computes Machado, Oliveira and Fernandes 2009 at full severity (in linear
  light, as colorspacious and DaltonLens apply it) from the drawn pixels, and uses it to find the states that
  only a glyph or word tells apart, with the look's 0.10 OKLab as "apart" (Look: `min_distance`). No
  contrast threshold is applied under simulation; the criterion sets those for the themes.
- **Contrast** is WCAG 2.x relative luminance and ratio. "Its background" is what is behind the mark, the
  most common pixel 2–4 px outside it; the glyph's or word's background is the mark's fill when it sits
  inside the mark, else the most common pixel around it. The glyph's own color is its fully covered pixel,
  the one with the most contrast.
- **"Greyed"** is read as drawn in an achromatic color (OKLab chroma ≤ 0.05, which slate greys meet) with less
  contrast on the ground than the live value, and **"with its age"** as the snapshot's `age` and a text on
  screen that is no longer the live text. Frames after 2.1 s are not judged: the age a stale value shows ticks
  (Frame clock and scheduler arms a frame when it does), and the issue doesn't say how often.
- **"Between 2.0 and 2.1 s"** is inclusive at both ends. The as-of time sits off the vsync grid so the window
  holds vsyncs whose ages run from 2.0099 s to 2.0932 s.
- **The replay** is the same run pinned to the mapped record time ("in a replayed film, the mapped record
  time", Bound value), started an hour later on the host clock so a replay that reads the host clock differs.
- **Planted programs**: the planted look is data (the clean look with one glyph changed), and the planted
  frame clock is a `frames` field documented above as reachable only for this proof.

Not tested, because no criterion asks: `min_distance` and the data distance between data and status colors,
the attention treatment, `select`, `format` and `missing` on bound values, held readings, the status guard's
pixel pass, a status binding's stroke and badge slots, `session:` handle rules beyond giving a state, and
legend clicks opening evidence.
