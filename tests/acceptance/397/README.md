# Acceptance tests for #397: data views: tables as assets, scales and encodings, series decimated per pixel, and the column view

Written first, from issue #397 (its scope, its `series@1`, `scale@1`/`axis@1`/`legend@1` and Asset: tables fields,
its six acceptance criteria, its proof line "Fixtures for each view with frame timings, the CRLF table with a
decomposed letter, and the column view's out-of-range row and planted sources", and its one comment on
`{from: table asset ID, column: name}`), its Oracle page (`doneright/oracles/issues/397.md`) with the upstream files it
pins, the design sections it names and those they lean on, and base commit `960045da` ("Merge pull request #1027 …"),
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: The status-color rule (68); Honest numbers (76: "Every number on screen is either
  computed in the document … or a bound value with its source"; story numbers pass "only in a document that binds no
  status and no reading"); The cost model (82: the budget table's "data view" row, frame GPU 2 ms and frame CPU 2 ms;
  "Warm frames are judged against the table"); Document envelope (291: `assets: {id → {sha256, license}}`,
  `budget: {class, …}`); Item and kind (321: `module_missing`); ID and sub-address (393: `<id>#<row key>`, segments
  `[a-z0-9][a-z0-9_-]{0,47}`); Canvas module, Registry and seal, Registry and seal: registries (993–1095); Array and
  table and Array and table: column view (1130–1168, quoted below); Mark set and columns `marks@1` (2054: "A column may
  read a table: `{from: table asset ID, column: name}`"; picking returns `<id>#<key>`); Bound value and Status binding
  (2141–2195); Scale and encode (2197, quoted below); Series and decimation `series@1` (2220); Look `look@1` (2410:
  `data_distance: OKLab ΔE = 0.06*`); Asset (7050) and Asset: tables (7201, quoted below); Honest numbers, the check
  (8858: "A number read from a table with a source …, or derived from one by an encode's format, a transform or a
  counter, traces to that table"; a quote's digits "listed by their raw byte ranges"; "the check lists it as a story
  number").
- `docs/technical-design.md`: The canvas core and Canvas modules (1050–1100: the core holds "the column view, which
  reads any `column.source@1` entry under one narrowing rule"; the data row: "table assets; data, const and table
  columns as entries of the core's `column.source@1`"; the decode worker "with its asset probes" is ring-critical);
  Mark set, scale and encode; Packs and `module_missing`.
- The Oracle page's files: colorspacious `cb21a8d0aa` `colorspacious/cvd.py` (Machado, Oliveira and Fernandes 2009's
  matrices; the severity-100 rows are copied into `helpers.ts`); d3-scale `83555bd759` `test/quantize-test.js`
  (thresholds and bisect-right banding, clamping); ICU4X `b1cec62bb7` `components/normalizer/tests/tests.rs` (named
  only: NFC of a base letter plus U+0301 is the precomposed letter, which the AC5 test states directly).
- At the base: AGENTS.md; `crates/deep-marks-render` (`deep-canvas-render check | look | raster | geometry`, `store`,
  `planted`), `crates/deep-canvas-marks/src/data.rs` (mark sets, `column_of`, linear and time scales, the axis),
  `crates/deep-canvas/src/document/rules.rs` (honest numbers: `number_unsourced`, story constants),
  `crates/deep-canvas-marks/looks/clean.json`, `crates/deep-show` (`run`, the scenario, `deep_show`, `registries`,
  `--planted`, `test-*` features, `evidence.rs`'s `<2 hex>/<62 hex>` layout, the decode worker of #498),
  `crates/deep-gpu-layer` (`deep-gpu run`'s `live` call), `benchmarks/canvas.mjs` (`class`: the perf lane's warm
  frames per budget class); the suites `373/`, `381/`, `392/`, `398/` (README format, `deep-canvas-render`
  conventions, the status-bound rect), `200/` (registries listing, kit results, feature builds copied out), `379/`
  (the `live` call), `380/` and `855/` (timing gates and the judge), `393/` (`deep_show` and its reply), `498/decode/`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 npx vitest run --root tests/acceptance/397 --no-file-parallelism
npx tsc -p tests/acceptance/397/tsconfig.json   # type-check (exits 0)
```

Each file builds what it drives once, before its tests (`cargo build --locked --bin <name> [--features …]` in the
checkout, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies
each binary out under its own name into a temporary folder (two `deep-show` feature sets share one target path), and
fails each test that uses a build that failed. So the files run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/397/'` added to its `alone` list (this job writes only this folder). Every test passes an explicit
timeout of 1,800,000 ms. Temporary folders (PNGs, evidence stores, the agent's table, the live call's document) are
deleted after each test. The two CSV fixtures are served by a node HTTP server on 127.0.0.1 inside the test process
for the run that fetches them. Node built-ins and vitest only. A run with `--root tests/acceptance/397` leaves
Vitest's cache in `tests/acceptance/397/node_modules/.vite`; delete it.

Platforms: `deep-canvas-render check`/`raster` (Vello CPU) and `deep-show run` (render-back with Vello CPU) run
anywhere. `deep-gpu run live` is the reference platform's Metal window: an `unsupported_platform` answer fails the
AC1 live tests with a message starting `INCONCLUSIVE:`, never a pass. AC1's judged test takes its reading on any Mac,
then, off a reference Mac (Mac15,7 or Mac15,12), with Low Power Mode on or unknown, a thermal warning, or a 1-minute
load average above half the cores, prints it and skips as `INCONCLUSIVE (reading only)`; mains power never gates (the
owner's rule). On a reference Mac the design's judge applies: PASS when all five runs are within 2 ms, FAIL when all
are over it by more than the margin (the larger of 5% and the runs' spread), else INCONCLUSIVE.

`BASE-FAILURE.txt` is the run at the base (paths redacted): all 19 tests fail, each at a missing surface. AC1:
`check` answers `module_missing` for `series@1`, and the live window refuses the 2D chart with `ref_unresolved` at
`camera` (at the base it draws only documents viewed through a camera; a `chart` names none, and the envelope's
`camera` is optional). AC2 and AC5: `deep-show run` answers `bad_input` to `table_import`. AC3 and AC4: `check`
refuses the `ordinal` and `quantize` scale types (`scale_type`). AC6: `deep-show` has no `test-column-source` feature,
so that build fails, and the default build refuses the column `{source, as}` with `bad_column`, not `module_missing`.

## The surfaces under test

The issue names kinds, fields, codes and a registry but no code API. These tests extend three binaries that exist,
in their existing conventions (#391's JSON lines: one object in per stdin line, one out per line, in order, exit 0;
an unknown call, field or `planted` value answers `{"ok": false, "code": "bad_input"}`), and add no binary.
**Every name below that the issue or the design doesn't give is this job's choice**, the smallest consistent with the
design and the base; the implementer builds exactly these, or a dispute goes to a blind redraft.

| Binary (crate at the base) | What these tests add | Criteria |
|---|---|---|
| `deep-show run` (`crates/deep-show`) | the `table_import` call; the scenario's `planted: "probe_stores_normalized"`; `column.source@1` in `registries`; `deep_show` drawing a mark set whose column reads a column source; the cargo feature `test-column-source` | AC2, AC5, AC6 |
| `deep-canvas-render` (`crates/deep-marks-render`) | `check` and `raster` take `evidence`; `check` answers `numbers`; `raster`'s `texts` (#381) gain mark-set text rows; documents use `series@1`, table columns, `scale@1` types `ordinal` and `quantize`, `encode.role`, scale domains from a column | AC1 (draw), AC2–AC5 |
| `deep-gpu run` (`crates/deep-gpu-layer`) | its `live` call (#379) draws a `chart` document holding a `series@1` | AC1 |

### Tables as assets: `deep-show run`'s `table_import`

Asset: tables: "`source: {url, fetched: time} | handle | agent` (written by what brought it: the hub for a fetch …
and `agent` for a table an agent wrote)"; "Probed once in the decode worker into typed columns, with a header, a unit
per column and a key column". `deep-show run` is the hub here, as in #393, and has #498's decode worker.

- `{"call": "table_import", "url": string, "key": column}`: the hub fetches the URL (HTTP GET), keeps the bytes in the
  scenario's `evidence` store by SHA-256, has them probed as CSV (header row first) and records the source the hub
  writes, `{"url", "fetched"}`.
- `{"call": "table_import", "path": file, "key": column, "session": session ID}`: a table that session's agent wrote
  (as #200's `install_pack` takes `session` for an agent's pack); its source is `"agent"`.
- Reply: `{"asset": {"sha256", "kind": "table", "probe": {"table": {"rows", "columns": [{"name", "dtype", "unit"}],
  "key"}}, "source": {"url", "fetched"} | "agent"}}`. The tests read `sha256`, `kind`, `probe.table.rows`, the
  columns' names in order, `key`, and `source` (its `url` equal to the URL fetched and a `fetched` present, or
  `"agent"`); never a dtype, a unit or a time's value.
- Scenario field `planted: "probe_stores_normalized"` (AC5's wrong program, reachable only there): the probe stores
  each text cell NFC-normalized instead of its raw bytes, its byte range unchanged.

### Documents that read a table: `deep-canvas-render check` and `raster`

Both take `"evidence": dir`, the evidence store a `deep-show run` scenario wrote; a document names its table in
`assets: {id → {sha256, license}}` (Document envelope; the tests write `license: {id: "CC0-1.0", terms, shareable:
true, credit}`, Asset's license fields), and a `marks@1` column reads it as `{from: asset ID, column: name}` (Mark set
and columns; the issue's comment). The renderer reads the table, the import's probe and its source from that store
(how the store holds the record is the implementation's). `look`, `out` and the rest are as #373 gives them.

**`check` answers `numbers`** (Honest numbers, the check: "the check lists it as a story number"; a quote's digits
"listed by their raw byte ranges"): one entry per number the honest-numbers check finds in displayed text,

```json
{"item": ID, "row": row key | null, "text": string,
 "source": {"table": asset ID, "column": name, "row": integer | null, "bytes": [start, end] | null, "raw": base64 | null, …}}
```

`text` is the number as displayed (`44`, or the `3` in `Q3 Café`); `row` the mark set's row key that shows it (null
for an axis tick); `source.table` the document's asset ID the number traces to, `column` the table column, `row` the
0-based data row (the header not counted), `bytes` the cell's `[start, end)` byte range in the file (row ends and
delimiters outside it), `raw` the cell's bytes as the table keeps them, base64. A number traced to anything else has
some other `source` (a bound value, a constant); the tests only require that it isn't a table. An error about a
mark set's row names the row in `ids` as `<set>#<row key>` (ID and sub-address; picking returns `<id>#<key>`).

**`raster`'s `texts`** (#381's `{"shown", "glyphs"}`) gain one entry per row of a `marks@1` set with `mark: "text"`,
keyed `"<set>#<row key>"`.

### `series@1` (AC1)

As Series and decimation gives it: `source` (a reading handle, `reading:<ulid>#candles`; the tests read nothing
through it), `t` an `i64` column in flicks, `o, h, l, c` `f32` columns, `window: [t0, t1]`, `decimate: "ohlc"`,
`bucket: "1px"`, `marks: ["candle"]`, `candle: {up, down}` roles. Columns are marks@1's form (`{dtype, len, data:
base64}`): the live window has no record to read a reading's batch from. **Stated choice:** the design gives a
series no placement, so the tests give it `box: [x, y, w, h]` in u (as `rect@1`'s box): the pane it fills, its time
axis across the width and its values across the height.

### Scales and encodings (AC3, AC4)

`scale@1` `type: "ordinal"` with `domain` a list of categories and `range` a list of palette roles, and `type:
"quantize"` with `domain: [min, max]`, `range` five roles and `nice: false`; a mark set's `encode.role: {column,
scale}` (Scale and encode: "`role` through a scale whose range is palette roles; a quantize scale gives one role per
band"). A legend is automatic, so "a legend that tells two series apart" is read as two `marks@1` path sets whose
`role` each goes through one ordinal scale (each set's `series` column a `const` category); "takes a dashed line" is
the second set's `paint.stroke.dash: [6, 4]` (Paint: `dash: [u]`). The look is the clean look (as `look` answers it)
with the pair's roles added as palette entries; its `data_distance` is left at its default, 0.06.

### The column view: `deep-show` and `column.source@1` (AC6)

Array and table: column view: "`column.source@1`, a registry the core declares …, filled only by canvas modules at
the seal, `resolve: check`; an entry: `{name@major, form, types}`"; "A column: `{source: an entry's form, as: dtype,
part, range}`"; "Issue: `column.out_of_range {reader, column, row, value, step}`"; "The registry's kit …: a source's
rows at t after a seek equal a clean evaluation, and a planted source that keeps the previous frame's rows fails,
naming the frame; the changed ranges cover every row that changed, and a planted source that reports none while values
change fails clean-rebuild equality". `fixtures/column-source.json` holds this job's names:

| Name | What it is |
|---|---|
| cargo feature `test-column-source` of `deep-show` (none in a shipped build) | adds the test canvas module `test.columns`, which fills `column.source@1` with the entry `test.column@1` (`form: "test.column.<name>"`, `types: ["i32"]`) and one source, `test.column.big`: an i32 column of 6 rows, 70,000 at row 3 (index 3, 0-based) and 5 in every other row, the same at every t |
| planted entry `keeps_previous_rows` of `column.source@1` | a source whose rows change with t that, after a seek, hands the view the previous frame's rows; fails the kit rule `seek_equals_clean`, the rule's result carrying `frame`: the frame it fails at, an integer |
| planted entry `reports_no_changes` of `column.source@1` | a source whose values change with t and that reports no changed ranges; fails the kit rule `clean_rebuild_equality` |

- `registries` (#200's listing) lists `column.source@1` with `owner: "core"`, `fill: ["module"]`, `resolve: "check"`,
  the test module's entry (its `value.form` and its `kit.verdict: "PASS"`), and both planted entries with `result`
  `{verdict: "FAIL", rules: [{rule, verdict, …}]}`, each failing its one rule alone (Registry and seal: registries:
  "each rule has its own planted wrong entry … that breaks that rule alone").
- `deep_show` (#393's, `include: ["issues", "pixels"]`) of a `chart` whose `marks@1` set `cells` reads `v: {source:
  "test.column.big", as: "u16"}`: the reply is `presented`; `issues` hold one `column.out_of_range` whose object
  carries the design's fields as keys, `reader` (the set's ID), `column` (the set's column name, `v`), `row`, `value`
  and `step`; the snapshot (a PNG in the evidence store) shows every row but row 3.
- In the build without the feature, the same `deep_show` is `refused` with an error `module_missing` (Canvas module:
  "A build without it refuses documents that need it with `module_missing`"; column view: "A column whose form no
  entry in the build fills belongs to a document that needs a missing module, refused with `module_missing`").

### The live window (AC1)

`deep-gpu run`'s `live` call as #379 gives it (`{"call": "live", "look": look@1, "frames", "fps", "sessions": [{session,
writer, doc: path}]}` → `frames: [{frame, gpu_ms, cpu_ms, views: [{session, drawn}]}]`, `sessions: [{state, class,
issues, revisions}]`), the call the perf lane's `benchmarks/canvas.mjs class` reads for a class's warm frames. The
document is a `chart` with `budget: {class: "data_view"}` and a channel easing the series' `at/pos/0` by 2 u over 60 s
(as the perf lane's `data_view` fixture eases a bar), so every frame draws.

## Fixtures

Written by this job before any implementation ran (`fixtures/`):

| Fixture | What it holds |
|---|---|
| `candles-5d-1m.csv` | `t,o,h,l,c`: 7,200 one-minute candles (five days × 1,440), t in flicks from 0 in steps of 42,336,000,000 (60 s), prices a seeded random walk with two decimals; both up and down candles |
| `sales.csv` | `key,region,value`, LF row ends: 1 North 12, 2 South 31, 3 East 44, 4 West 27 (region names hold no digits) |
| `menu-crlf.csv` | bytes `key,value,label` CR LF, then `1,12,Q1 Tea`, `2,31,Q2 Bar`, `3,44,Q3 Cafe` + `CC 81` (U+0301), `4,27,Q4 Deli`, each row ending CR LF; label last, so a cell that keeps the CR shows |
| `quantize-400.json` | 400 values on a 20 × 20 grid of 24 u cells from (20, 20): a permutation of 0, 0.25, …, 99.75 with 99.75 replaced by 100, so 0, 20, 40, 60, 80 and 100 occur; domain [0, 100] |
| `roles.json` | `series_red` (255, 90, 80) and `series_green` (0, 193, 29): 0.370 apart as seen, 0.0200 under deuteranopia (both in gamut there); `series_blue` (90, 169, 230) and `series_orange` (255, 127, 14): at least 0.25 apart as seen and under each simulation; `heat_a` and `heat_b`, two colorings of five roles; `candle_up` (76, 155, 232) and `candle_down` (255, 176, 74). Every `series_*` and `candle_*` role lies at least 0.16 from each of the clean look's status colors, past its 0.10 status distance, so the base's status guard (#392), which refuses a look whose role comes closer, never answers for the criterion |
| `column-source.json` | AC6's test module, source and planted sources (above) |

The distances in `roles.json` are recomputed by the tests before each use (OKLab from the sRGB transfer function;
Machado's severity-100 matrices applied in linear sRGB, as colorspacious applies them), so a fixture that drifted
fails as a fixture, not as the criterion.

## Criteria to tests

Each test's name starts with its criterion's ID and, in parentheses, the condition of the criterion it asserts.

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 | Five days of one-minute candles draw within the frame budget | `candles.test.ts` (3). **(draw)**: the fixture is 7,200 minutes, t strictly increasing; the chart passes `check` with no error and no `unknown_kind`/`module_missing`/`unknown_field`; `raster` draws more than 500 pixels in each of `candle_up` and `candle_down` (within 2 codes). **(live)**: in `live`, the session is `live`, its class `data_view`, its revision `current`, no `unknown_kind`/`module_missing`, and all 60 frames draw it. **(budget)**: five `live` runs of 30 + 300 frames; every judged frame draws; each run's p95 `gpu_ms` and p95 `cpu_ms` judged against 2 ms (The cost model's data view row) by the design's rule; INCONCLUSIVE off the reference Mac or under load |
| AC2 | A bar chart whose values and labels come from a table fetched by URL passes honest numbers with every label and tick traced to that table; the same chart from a table an agent wrote passes in a document with no status binding and, with one, fails naming each label's row | `honest.test.ts` (3). **(fetched)** the import: `kind: table`, 4 rows, columns `key, region, value`, key `key`, `source.url` the URL served, `fetched` present, `sha256` the file's. **(fetched)** the chart (bars, value labels and region names read from the table, a y axis over a scale whose domain comes from the column) passes `check` with no error, with and without a status binding; `numbers` lists each value label by row key showing the table's value, at least one axis tick, and every entry's `source.table` is `sales`. **(agent)** the agent's import has `source: "agent"`; the chart passes with no status bound; with a status bound it fails, an error's `ids` holding `labels#<key>` for each of the four rows |
| AC3 | A legend that tells two series apart only by a red and a green role whose simulated deuteranopia colors lie 0.02 apart is refused naming both roles, passes once the second series takes a dashed line, and a blue and orange pair passes unchanged | `legend.test.ts` (3). Preconditions computed first: red/green 0.02 ± 0.0005 apart under deuteranopia (clipped and not) and more than 0.06 as seen; blue/orange more than 0.06 in all four visions. **(refused)** both lines solid: `check` fails with an error naming `series_red` and `series_green` as data (outside `what` and `fix`). **(dashed)** the second line `dash: [6, 4]`: no error. **(blue and orange)** both solid: no error |
| AC4 | A mark set of 400 cells whose role encodes a value through a quantize scale over five palette roles colors each cell with the role of its value's band, and no cell takes a literal color | `quantize.test.ts` (2). **(bands)** the fixture holds the band edges and every band; `check` passes; each cell's center pixel is exactly its band's role (d3's thresholds and bisect-right, so 20 is band 2 and 100 band 5). **(no literal)** under a second look giving the five roles other colors, every cell is its band's new role, and no cell keeps its color between the two looks |
| AC5 | A CSV fetched by URL, with CRLF row ends, whose label column holds Q3 Café with a decomposed é keeps each cell's raw bytes unchanged, draws the label with one NFC é, and passes honest numbers with the 3 traced to its row by raw byte range, while a planted probe that stores the cell normalized fails the comparison with the file's bytes, naming the row | `crlf.test.ts` (4). **(raw bytes)** each of the four label cells (each holds a digit, so each is traced) is listed with `source` `menu`, `label`, its 0-based data row, `bytes` its cell's range (CR LF outside), and `raw` equal to the file's bytes there, `65 CC 81` included. **(NFC)** `raster`'s `texts["labels#3"].shown` is `Q3 Café` and the é's grapheme is one glyph. **(trace)** `check` passes with no error; exactly one entry lists the `3` of row key 3, traced to `menu` data row 2 by the cell's byte range. **(planted)** with `probe_stores_normalized`, `check` fails with an error naming `labels#3`, and none naming rows 1, 2 or 4 |
| AC6 | A test canvas module fills column.source@1 with a source whose i32 column holds 70,000 at row 3 and 5 elsewhere; a mark set reading it as u16 hides row 3 and raises column.out_of_range naming the set, the column, row 3 and 70,000, while every other row draws; the registry's kit fails a planted source that keeps the previous frame's rows after a seek, naming the frame, and one that reports no changed ranges while values change, which fails clean-rebuild equality; and a mark set that names a source no module in the build fills is refused with module_missing | `columns.test.ts` (4). **(narrowing)** `deep_show` is `presented`; one `column.out_of_range` with `reader` `cells`, `column` `v`, `row` 3, `value` 70,000 and a `step`; in the snapshot, row 3's cell is the ground and each other row's cell is drawn, all alike, nothing above the value 5. **(seek)** `column.source@1` is the core's, filled by modules, resolved at check; the test entry passes its kit; `keeps_previous_rows` FAILs on `seek_equals_clean` alone, with an integer `frame`. **(changed ranges)** `reports_no_changes` FAILs on `clean_rebuild_equality` alone. **(module_missing)** without the feature, the same document is `refused` with an error `module_missing` |

The planted wrong programs: `probe_stores_normalized` (AC5, a scenario field), and `keeps_previous_rows` and
`reports_no_changes` (AC6, planted entries of the registry, which the seal runs its kit on). Wrong programs the
assertions also fail without a planted name: a check that traces no label or tick (AC2, AC5), one that refuses every
chart bound to a status (AC2 fetched), a scale that ignores dashes or simulations (AC3), a quantize that rounds instead
of bisecting or paints a literal (AC4), a parser that keeps the CR or normalizes on read (AC5), a view that wraps,
clamps or drops every row (AC6).

## Readings where the issue and design leave a choice

- **"Fetched by URL"** is a `table_import` by `url` that the hub runs (Asset: tables: "A table fetched through the
  Source block keeps its URL and fetch time, which the hub writes, never the agent"); the document never writes a
  source.
- **"Traced to that table"** is a `numbers` entry whose `source.table` is the table's asset ID. "Every label and tick"
  is every value label (one per row key) and every axis tick listed, and no number of the chart traced elsewhere; the
  region names hold no digits, so honest numbers has nothing to trace in them.
- **"Fails naming each label's row"** is an error whose `ids` hold `labels#<key>`; the code isn't read (the base's
  `number_unsourced` would do).
- **"Refused naming both roles"** is an error holding both role names as data; the design names no code for it.
- **"Traced to its row by raw byte range"** is the trace's `source.row` and `source.bytes`, the cell's range in the
  file; "keeps each cell's raw bytes unchanged" is `source.raw` equal to the file's bytes at that range, read for
  every label cell (each holds a digit, so each is listed).
- **"Draws the label with one NFC é"**: the row's shown string is NFC and the é is one glyph.
- **Row 3** of AC6 is the row at index 3 (rows are indices from 0, as an occurrence list's rows are keyed by index);
  of AC5, the row whose key is 3 (data row 2).
- **"Naming the frame"** is the failing rule's `frame`, an integer, as data; the frame's value isn't pinned.
- **The frame budget** is The cost model's data view row (frame GPU 2 ms, frame CPU 2 ms), judged per run at p95 over
  the warm frames, as the perf lane judges a class's warm frames; five runs; the reference-Mac gate as #855's without
  mains power.
- **Five days** are five calendar days of minutes (7,200 candles), not trading sessions; no `calendar` is set.

## BLOCKED, INCONCLUSIVE and not tested

- AC1's judged test is INCONCLUSIVE off a reference Mac or under load (it never passes there), and the live tests are
  INCONCLUSIVE off macOS.
- The Oracle lane: colorspacious's matrices are the formula AC3's tests compute with; d3's quantize test is ported as
  AC4's band function and its edge cases (thresholds, bisect-right, the domain's ends); ICU4X's normalizer tests run
  Unicode's NormalizationTest.txt on ICU4X, not on our output, and our output's only normalization the criterion
  names (one decomposed é) is asserted directly, so that file isn't run here.
- Not tested, because no criterion asks: JSON lines tables, the 16 MB cap, parsing outside the decode worker, a
  formula in a table, a source from an agent's say-so, `handle` and `job` sources, units, `append`, `chunk`,
  `capacity`, `gap`, `calendar`, window columns, the crosshair, bands, tags and panes, the M4 pixel equality, log and
  symlog scales, `zero` for areas, the R6 transforms, the status distance of candle roles, the narrowing fixtures
  per `as`, `part` and `range`, the logic and physics entries, the data module's own entries of `column.source@1`,
  and the vector, graph and data interfaces' seal.
