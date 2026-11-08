# Acceptance tests for #167: data stories: data that changes with time, standings that glide, reveals with a head point

Written first, from issue #167 (its scope, its Fields for Scale and encode, Mark set and columns and Bound value, its ten
acceptance criteria, its Proof line and its owner comment, "`rows_of` … `rows: {from: occurrence list + filter, columns}`,
in place of n and data columns, with no row taken from an occurrence after t"), its oracle page, the design sections it
links and those they lean on, and base commit `c12a65bb` ("Merge pull request #1281 …"), by a job that never saw an
implementation; none existed, and no other branch or worktree was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue and the oracle page (`doneright/oracles/issues/167.md`): upstream tests for AC4, AC8 and AC9, none for the rest.
- `docs/canvas-primitives.md`: Honest numbers (both sections); ID and sub-address; the path grammar ("`<sub>` is a nested
  key or a list index"); Text `text@1` (`template`, `numerals`, `widest`); Mark set and columns `marks@1`; Bound value;
  Scale and encode (the Semantics paragraph is what the mixes, fades and ticks below come from); Channel and key; Driver;
  Text animator and counter; Marker; Occurrence list.
- `docs/technical-design.md`: Films and figures on the canvas; Mark set, scale and encode; Dogfooding.
- At the base, for surfaces only: AGENTS.md; `crates/deep-marks-render` (`lib.rs`, `raster.rs`: `check`, `raster`,
  `geometry`, `idle`, `texts`), `crates/deep-canvas-marks/src/data.rs` (mark sets, the `bar` mark, scales, axes),
  `src/scene.rs` (counters, formats), `crates/deep-canvas-motion/src/doc.rs` (channel and driver targets), and the suites
  `397/`, `373/`, `392/`, `491/`, `443/`, `380/`, `854/`, whose form and helpers these follow.
- Upstream, fetched at the page's pinned commits: d3-scale `83555bd759` `test/linear-test.js` and `test/quantize-test.js`,
  palette `71011dee47` `palette/src/oklab.rs` (sRGB blue's OKLab values), WPT `2f57f45d21`
  `css/css-color/parsing/color-computed-color-mix-function.html`, d3-format `ebdc2d5302` `test/format-test.js`. d3-format's
  `format-type-f-test.js` and `locale-test.js` were not fetched: AC9 uses the page's published format, "+,.1f". The page's
  white-and-blue midpoint, oklab(0.726 -0.016 -0.156), is the page's figure; `color.test.ts` recomputes it from the formula.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/167 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/167/tsconfig.json   # type-check (exits 0)
```

Each file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, honoring `CARGO_TARGET_DIR`)
and copies it out, so files run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/167/'` added to its `alone`
list (this job writes only this folder; the implementer makes that edit). Every test passes a 1,800,000 ms timeout.
Temporary folders are deleted after each test. Only `budgets.test.ts` builds a release binary, and only when a timed test
will be judged. Node built-ins and vitest only. `--root` leaves Vitest's cache in
`tests/acceptance/167/node_modules/.vite`; delete it. `taste.test.ts` writes `docs/evidence/167/`.

`check`, `raster` and `geometry` run anywhere. AC7's rest test needs `idle`, Metal: `unsupported_platform` fails with a
message starting `INCONCLUSIVE:`.

## The surface under test

The issue names fields but no code API. These tests extend `deep-canvas-render` (crate `crates/deep-marks-render`) in its
JSON-lines convention (one object in per stdin line, one out per line, in order, exit 0) and add no binary. **Every name
below that the issue or the design doesn't give is this job's stated choice**; the implementer builds exactly these, or a
dispute goes to a blind redraft. Times are flicks. `look` is #373's role map, except where a test says `clean`.

### `geometry {doc, item, t, look}`: new answers

As at the base it runs the check first and answers `subpaths`. It adds, by the kind of `item`:

- **`marks@1`**: `rows: {<row key> → {columns, opacity, place, oklab}}`, the set's rows at t **after its transforms**.
  - `columns`: every column by name at t, mixed where periods mix, with the `standing` column (`into`) a number. For a
    `rows_of` set, the rows of the set it reads. For a `rows` set, `flick` and each payload field.
  - `opacity`: the row's final opacity at t: 1 by default, with periods' enter and leave, standing's fade and emphasis.
  - `place`: `{x, y, x2?, y2?}`, the encoded position properties at t after their scales, in document u. For `bar`, `y2` is
    the base. No `x2` or `y2` where the mark has none.
  - `oklab`: `[L, a, b]`, the row's color unrounded, in f32 or better, from `look`. Tests read it only through a linear
    scale over roles, but it may be answered for every row.
  - **Every key of any period is listed at every t**, at opacity 0 where it isn't shown, including a key missing from
    the period `at` rests on and a key past `top`. So rows is keyed by the set's key, not `(by, key)`.
- **`scale@1`**: `domain: [min, max]` at t, after `nice`.
- **`axis@1`**: `ticks: [{value, opacity}]` at t, one per tick over **every period's** domain, so a tick that has yet to
  enter is listed at opacity 0. A tick is at opacity 1 once it's fully shown, exactly 0 before it starts.

### `check` and `geometry` with `timing: true` (AC7)

`check {doc, look, timing: true}` also answers `timing: {rank_ms}`: the time standing took to rank every period, alone, in
this check. `geometry {…, timing: true}` also answers `timing: {mix_ms}`: the time the periods transform took to mix the
item's rows for this t, alone, not counting the check or the reply. In ms, floats.

### `raster`

As at the base. `texts` holds `labels#<key>` for a text set read through `rows_of` as for any text set, and `count` for a
counter, with `shown` and `glyphs`. Per-glyph `x` is the shaped run's (#381); the tests compare offsets, so the run's origin
isn't pinned, but a counter's glyphs must be one per character of `shown`. A row's `opacity` is drawn.

### `check` and `idle`

`check` as at the base (`issues` with `code`, `severity`, `ids`, `path`). `idle {doc, look, view, seconds}` as #854 gave it.

## Documents

All built in `helpers.ts`: `{format: 1, id, profile: "figure", title, description, size, layers, transport: {span}, items,
channels?, drivers?, data?, markers?}`, items as `{id, kind, layer, name, order, params, at?}`.

- **Transforms** are `params.transforms`, an ordered list of one-key objects named as the issue names them, as a counter is
  `{counter: {…}}`: `[{periods: {by, at}}, {standing: {by, top?}}]`, `[{reveal: {by, to}}]`, `[{emphasis: {keys, mix}}]`.
  A transform other than the closed list's is refused.
- **`at: channel`** is a number in the field that a document channel may key, as the path grammar reaches any field:
  `items/race/params/transforms/0/periods/at`, `…/transforms/0/reveal/to`, `…/transforms/0/emphasis/mix`, `type: "f32"`.
- **Rows of periods:** `n` counts every row of every period; the set's `key` repeats across periods and is unique within
  one, so `key_not_unique` looks within a period where a set has periods. Columns are inline (`year` i32, `key` str,
  `value` i32): tables through `from` read the same way, and the data views' suite covers them.
- **A race's bars** are the `bar` mark as #373 gave it, standing side by side: `x` and `x2` are `standing` through two
  scales, `y` the value through `ys`, so a bar rises from the scale's zero. Standing 1 to 4 maps to `[40, 280]` and
  `[100, 340]`, and `ys` maps `[0, 50]` to `[240, 40]`. `mid` maps standing to the middle.
- **`rows_of`:** a set with `rows_of: <set>` has no `n` and no `columns`; its `encode` reads the rows' columns.
- **`rows`:** a set with `rows: {from: {list: "markers.cue"}}` has no `n` and no `columns`; with no `columns` in `rows`, its
  columns are `flick` and each payload field. Rows are keyed by the occurrence's index in the list, from 0.
- **`domain: "periods"`** is the string, with the defaults (`nice` on). It reads the columns encoded through the scale, as a
  domain from a column does at the base, and `zero` holds for bars. Its axis is `{scale, side: "left", at: 30}`.
- **Palette ranges:** `scale@1` `range: ["blue", "yellow"]` on `type: "linear"`; `encode.role: {column, scale}`.
- **A log scale** is `{type: "log", domain: [1, 100], range: [220, 20]}`.
- **Anchors:** `items/<set>#head/<column>` is the revealed end's value in that column. A counter names it directly,
  `{counter: {source: "items/line#head/value", tabular: true}}`, with no `format`, and shows it at the column's precision.
  An attachment names `at: {anchor: "line#head", pos: [0, 0, 0]}`, drawn at the revealed end.
- **A driver as a counter's source:** `{counter: {source: <driver ID>, format, tabular: true}}`, where the driver's value is
  what the counter formats. The driver's `target` is `data/shown`, and it reads `data/goal` and a channel-keyed `data/share`,
  all `{value, source: "story"}`.

## Criteria to tests

Each test's name starts with its criterion's ID (`scripts/proof-change.mjs`).

| ID | Tests | Surfaces | What it asserts |
|---|---|---|---|
| AC1 #167.18793458 | `race.test.ts` (3) | `check`, `geometry`, `raster` | **(mixed)** values and standings at 0.25 s; rows at 0 s and 1 s equal each period's exactly, standings 3, 2, 1 and 1, 2, 3. **(seek)** rows as JSON and frames by SHA-256: played to 0.25 s, sought in a fresh process, sought back from 1 s; 0 s differs. **(labels)** `texts` show 18, 21, 26 |
| AC2 #167.cf27c591 | `reveal.test.ts` (2) | `check`, `geometry` `subpaths`, `raster` `texts` | **(end)** at 100 seeded times the last point within 0.01 u of the mixed point, the rows up to `to` before it. **(counter)** at every fifth time, the mixed value rounded to the i32 column's whole numbers |
| AC3 #167.0333a2fe | `standing.test.ts` (3) | `check`, `geometry`, `raster` | **(leaves)** c 3 → 4, opacity 1 → 0, past the third bar at 2001, in between at 2000.5, monotonic; d, past the top throughout, stays at 0. **(enters)** e 0 → 1, between at 2000.5, value 45 throughout. **(drawn)** c's bar is ink at 2000, the ground at 2001 |
| AC4 #167.662f5a55 | `domain.test.ts` (2) | `check`, `geometry` of a scale and an axis | **(domain)** exactly [0, 30] and [0, 40]; d3's nice rule leaves both alone. **(ticks)** tick 40 at exactly 0 and 1, between on some frame, monotonic; shown ticks on a 1, 2 or 5 × 10^k step |
| AC5 #167.5cc51988 | `rows-of.test.ts` (1) | `check`, `geometry` | at all 61 frames each label within 0.5 u of its bar's end, and holding its bar's mixed value |
| AC6 #167.3b65833f | `emphasis.test.ts` (1) | `check`, `geometry`, `raster` | a, c at 0.3 at mix 1 and 1 at mix 0; b at 1 at five times; pixels agree |
| AC7 #167.c3055836 | `budgets.test.ts` (3) | `check` and `geometry` `timing` (release); `idle` | **(rank)** under 5 ms. **(mix)** under 0.05 ms, p95 of 300 frames. **(rest)** 0 frames in 2 s held |
| AC8 #167.48674636 | `color.test.ts` (2) | `check`, `geometry` `oklab`, `raster` | **(midpoint)** 0.5 within 0.001 ΔEOK of the midpoint, ends at the roles, the middle pixel within one code. **(quantize)** six values, each exactly its band's role |
| AC9 #167.d181ea9b | `counter.test.ts` (1) | `check`, `raster` `texts` | 121 frames: `+12,345.6` at the end; every frame `+` grouped, one decimal, the driver's value; digits hold their place |
| AC10 #167.25ddf151 | `taste.test.ts` (1) | `raster` | pictures and recordings written; the recorded call on exactly those |
| It can never | `refusals.test.ts` (5) | `check`, `geometry` | below |

Refusals: values ≤ 0 on a log scale name `dots#q` and `dots#r` alone in an error's `ids`; a `regression` transform is an
error; a ramp over `status.pass` and `status.fail` under the clean look is an error, not `role_unresolved`, naming the
scale or the set; a later period changes nothing at 2000.5, and a key missing from the next period holds its value; rows
from an occurrence list are those at or before t, at five times in a non-monotonic order. Each has a positive control but
the mix and the rows, which assert numbers. Error codes aren't pinned: the design names none.

Wrong programs the assertions fail on, with no planted name: a mix that smooths across three periods, or rounds a mixed
standing; a cursor kept between frames; an `at` read a frame late; a label set that reads raw rows; a reveal that stops at
the last whole row; a counter with a stale value; a domain from all rows; a tick that pops; opacity reported but not drawn;
a ramp mixed in encoded sRGB; a counter in proportional figures. This job adds no `planted` field; a mutant of the
implementation is the implementer's proof that a test sees its wrong program (AGENTS.md, Proof).

## Readings where the issue and design leave a choice

- **Standing is 1-based**, which the issue's 2.5, 2.0, 1.5 fix: at 2000 c leads, at 2001 a does.
- **"Played"** is every 60 Hz frame in order in one process, since `geometry` and `raster` are the CPU surfaces that can
  report a row. `frames` is Metal and reports no rows.
- **"Slides below the third bar"**: bars stand side by side here, since `bar` rises from its y scale's zero. So below is
  along the standing axis: c's slot starts past the end of the bar at standing 3.
- **Rows past `top`** only have c and d read: c reaches standing 4 (`top` + 1) at opacity 0. How far d, at rank 5, slides isn't
  pinned, nor is the fade's curve: it's strictly between 0 and 1 at 2000.5.
- **A key entering** keeps its neighboring period's value throughout. Its standing before it enters isn't pinned.
- **"Tick … enters by opacity"**: the criterion pins the two ends; the scope's "enter and leave by opacity" is read as
  some frame strictly between, monotonic. A domain between periods isn't pinned: "mixed like them" could be either the mix
  of the two periods' domains or the domain of the mixed rows.
- **"Its column's precision"** is read on an i32 column, whole numbers, as the issue's AC1 does. A float column's or a table
  column's precision isn't read here.
- **"No glyph left of the decimal point moves"**: a number that grows must place new digits, and its sign moves as it grows.
  So the test holds every digit to one offset from the last glyph, by place value, across all frames, and every glyph left
  of the point to one x across frames of one length. Kerning a digit against the group comma would fail it.
- **"Compared with the merge base"**: the base has no periods and no standing, so it has no reading. The limits are absolute.
  "Ranking at check" and "mixing per frame" are the transform's own time, since `check` and `geometry` parse the document
  each line. Rank: the median of five checks in a run. Mix: p95 of 300 frames in a run.
- **"At rest"** is a race whose `at` holds: the first key is at 30 s, and `idle` holds t = 0 for 2 s. A race on a stage that
  holds is the same pure function.

## BLOCKED, INCONCLUSIVE and not tested

- AC7's rank and mix read INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12), with Low Power Mode on or unknown, a thermal
  warning, or a 1-minute load average above half the cores, as #397 AC1 and #380 do: they skip before building, so they
  print no reading there and never pass. On a reference Mac: five release runs after a warm-up, PASS when all are within the
  limit, FAIL when all are over it by more than the margin, the larger of 5% and their spread, else INCONCLUSIVE.
- AC10 is INCONCLUSIVE until a taste call is recorded (below).
- Not tested, because no criterion asks: `mix: hold`, `desc: false`, `into`, `others` other than its default, Axis
  `side: zero`, symlog scales, `#period` and templates, `unit_at`, `ellipsis`, a table's source tracing through a mix
  (honest numbers), `rows` with controls or a filter, the 1M-row limit. The Proof line's 30 s fetched race, the stage that
  stops on 2008 and the hash list are the PR's proof, not assertions here.

## The taste call

The test writes to `docs/evidence/167/`: `race-2000.png`, `race-2000-5.png`, `race-2001.png`, `reveal.png`, `ticks-2000.png`,
`ticks-2000-5.png`, `ticks-2001.png`, `race.apng` and `reveal.apng` (animated PNGs of `raster`'s frames at 30 and 15 per
second). Show them to the owner, attach them to the PR, and record the call in `tests/acceptance/167/TASTE.json`, as #443's:

```json
{"issue": 167, "criterion": "#167.25ddf151", "verdict": "looks_right", "who": "…", "when": "2026-11-06T00:00:00Z",
 "screenshots": {"race-2000.png": "<sha256>", "…": "…"}, "note": "…"}
```

`screenshots` names all nine files, with the SHA-256 the run prints. A call on other bytes reads INCONCLUSIVE.
