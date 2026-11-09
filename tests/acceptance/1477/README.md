# Acceptance tests for #1477: long lists and tables stay fast, measured first, built only if the kit's misses 4 ms

Written first and blind, from issue #1477 (updatedAt 2026-11-09T00:38:31Z: its Scope, ten acceptance criteria, Proof
and Not in scope), the design sections it links and the base commit `dd83ac2f` ("Merge pull request #1692 …"), by a job
that never saw an implementation; none existed at the base. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Panel runtime and panel host ("list rows come from data, never from script run per
  frame … where the toolkit's table misses the update budget on the reference Mac, ours is one element that finds its
  visible range and paints quads and shaped lines directly"; `update_budget: ms ≤ 4`), Frame budget (five runs after
  warm-up; pass when all five are within, fail when all five are over by more than the margin, else INCONCLUSIVE;
  zero allocations with a counting allocator).
- `docs/technical-design.md`: Panel; How we know version 0 works (wrong programs, planted twins); Tests written first;
  Dogfooding.
- Issue #1433 (open; its record will be `docs/spikes/1433/record.json`, in #337's style, with a `gpui-fast` arm and a
  long-list gate). No #1433 record exists at the base.
- At the base: `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`: the lane's reference-Mac and load rule),
  `scripts/lanes.mjs` (`alone`, `timed`), `crates/deep-app/Cargo.toml` (`plant-*` features, `[[test]]` targets with
  `harness = false`), `crates/deep-app/spike_402.rs`, `docs/spikes/402/record.json`, `docs/spikes/337/record.json`,
  gpui-kit's `DataTable` and gpui-shell's `data_table` component (`render_cell`) at the pinned revision; and the suites
  `tests/acceptance/402`, `1413` and `1172` for style.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1477 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1477/tsconfig.json   # type-check
```

- **Builds.** Each file builds the bench once in release, `cargo test --release --locked -p deep-app --test lists_1477
  --no-run --message-format=json-render-diagnostics`, and copies the executable cargo names into a temp folder. A
  planted twin is built the same way with `--features <plant>`, only when a twin test runs under a build decision.
- **Real windows.** The bench opens a real window on your screen; keep it uncovered while a run takes readings.
- **Machine.** Every timing or memory limit is judged by `scripts/benchmark.mjs`'s own `judgeLimit` on five runs, with
  its `fingerprint()` and the one-minute load read before and after each run: off the reference Macs, off mains power,
  in Low Power Mode, at a thermal state other than nominal, or with a load above the core count, it reads INCONCLUSIVE
  (a failure starting `INCONCLUSIVE:`), never a pass. Every arm in a record is held to the same rule on the fingerprint
  and load it carries. Off macOS every test fails with a message starting `INCONCLUSIVE:`.
- **Accessibility.** #1477.035131da compiles `probe.swift` with `swiftc` and reads the bench's tree through the
  Accessibility API, so the process running the tests needs the Accessibility permission; without it that test fails
  `BLOCKED: …`. It writes the system clipboard with ⌘C and puts the text it found back afterwards.
- **Lanes.** These files take real windows and time them: `scripts/lanes.mjs` needs `tests/acceptance/1477/` in
  `alone` and both test files in `timed` (they call `judgeLimit`). This README is the instruction; the implementer makes
  that edit.
- **Time.** record.test.ts: one full `measure`, one partial, five paired list runs and a remeasure, about 5 min after
  the build. built.test.ts under stop: one blank, kit and panel run, about 40 s; under build about 8 min plus three twin
  builds.
- **Cache.** A run leaves Vitest's cache in `tests/acceptance/1477/node_modules/.vite`; delete it.

## The surface under test

The issue names a bench, a record and three planted twins but no command, path or feature name. **Every name below is
this job's choice**, the smallest one that fits the repo's conventions (`spike_402`'s `[[test]]` bench, `docs/spikes/`
records, `plant-*` features). The implementer builds exactly this.

### The bench

`crates/deep-app/lists_1477.rs`, a `[[test]]` of deep-app named `lists_1477` with `harness = false`, as `spike_402`.
With no arguments it does nothing and exits 0, so `cargo test --workspace` stays fast. It runs from the checkout's root
(the tests set it as the working directory). No environment variable is read. Calls:

| Call | Needed | Prints |
|---|---|---|
| `arm <name>` | always | one JSON line: that arm, measured in this process (below) |
| `measure --out <file> [--arms <a,b,…>]` | always | writes the record to `<file>`, running each arm as `arm <name>` in its own child process; `--arms` runs only those, and every other arm is listed reading INCONCLUSIVE with its reason; exits 0 whatever it found |
| `remeasure` | always | one JSON line (#1477.466ab542, below) |
| `offsets` | if built | one JSON line (#1477.4e971aa0) |
| `sort --data <file>` | if built | a line session (#1477.fd384f01) |
| `access` | if built | a line session (#1477.035131da) |
| `soak` | if built | a line session (#1477.1899ebe0) |
| `back` | if built | one JSON line (#1477.1899ebe0) |

A line session prints one JSON line when ready, then answers each JSON line on stdin with JSON lines as below, and exits
0 when stdin closes.

### Arms

Names: `blank` (an empty window), `kit` (gpui-kit's `DataTable` with a Rust delegate), `panel` (the same table through
gpui-shell's `data_table` component and a panel's `render_cell`, rows passed as data), `list-10k` and `list-100k` (the
variable-height list at 10,000 and 100,000 rows), and `ours` (our element), which exists only when it was built.

Every arm opens a real window of 1,200 × 700 px, warms up for 1 s uncounted, then scrolls two rows (64 px) a frame for
8 counted seconds. Tables (`kit`, `panel`, `ours`) have 100,000 rows of 8 columns at 32 px; the blank arm gets the same
scroll events. List arms then go back up for 120 frames at two rows a frame, over rows shown in the last 240 frames.
`arm <name>` prints:

```json
{
  "arm": "kit", "status": "measured",
  "fingerprint": { "model": "Mac15,7", "chip": "Apple M3 Pro", "memoryBytes": 38654705664, "power": "ac",
                   "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "…" },
  "load": { "start": 2.1, "end": 2.4 },
  "window": [1200, 700], "seconds": 8, "frames": 960, "rows": 100000, "columns": 8,
  "raw": { "p50_ms": 1.1, "p95_ms": 1.9, "p99_ms": 2.6, "allocations_per_frame": 3120.5, "cpu_ms_per_frame": 1.4,
           "working_set_bytes": 91000000, "data_bytes": 12800000 }
}
```

- `fingerprint` has `scripts/benchmark.mjs`'s `fingerprint()` fields; `load` is the one-minute load average at the arm's
  start and end.
- `frames`: frames counted, at least 480. `rows`: on every arm but blank. `columns`: 8, on table arms.
- `raw`: update time per frame (from applying the frame's scroll through layout, prepaint and paint) at p50, p95 and
  p99 in ms; heap allocations per counted frame (a counting global allocator); process CPU time per counted frame in
  ms; the working set (physical footprint) in bytes at the end of the counted frames; and the bytes of the arm's data
  (0 for blank). p50 is above 0 and p50 ≤ p95 ≤ p99.
- List arms add `"list": "<the list measured>"` and `"shaped": {"frames": 120, "down": <mean strings shaped per frame
  over the last 120 counted frames>, "back": <mean over the 120 frames back>}`.
- `ours` adds `"assistive": <whether assistive tech was running>` and `"access_allocations": <allocations made by its
  accessibility code over the arm>`.
- An arm that can't run prints `{"arm": …, "status": "INCONCLUSIVE", "reason": "<why>"}`.

### The record

`docs/spikes/1477/record.json`, written by `lists_1477 measure --out docs/spikes/1477/record.json` on the reference
Mac and committed (the issue's Proof):

```json
{
  "spike": 1477,
  "what": "…",
  "arms": { "blank": {…}, "kit": {…, "net": {…}}, "panel": {…}, "list-10k": {…}, "list-100k": {…}, "ours": {…} },
  "gpui_fast": { "issue": 1433, "record": "docs/spikes/1433/record.json", "at": null, "reading": null },
  "decision": "stop: kit p99 2.6 ms and panel p99 3.1 ms net of the blank arm, within 4 ms; no #1433 gpui-fast reading yet"
}
```

- `arms` holds every arm by name, each as `arm` printed it, unrun ones reading INCONCLUSIVE with a reason; `ours` only
  when it exists, and it must when the decision is build. No other arm.
- Each arm but blank adds `net`: `p50_ms`, `p95_ms`, `p99_ms`, `allocations_per_frame` and `cpu_ms_per_frame`, each its
  raw reading less the blank arm's, and `working_set_above_data_bytes`, its working set less its data less the blank
  arm's working set. The tests recompute these from `raw`.
- `decision` is the record's last key and one line. It starts `build` when the kit or panel arm's p99 net of the blank
  arm is over 4 ms, `stop` when both are within, and `INCONCLUSIVE` when blank, kit or panel didn't run.
- `gpui_fast` cites #1433. While `docs/spikes/1433/record.json` doesn't exist, `at` and `reading` are null. Once it
  does, `at` is a JSON pointer (RFC 6901) into it naming the gpui-fast arm's list reading (the pointer contains
  `gpui-fast` or `gpui_fast`, and `list`), `reading` is the value there, and the decision line contains `#1433`.

### The other calls

- `remeasure`: the `list-100k` list in a real window, scrolled into its middle, the pointer at window point (600, 350).
  A row above the viewport gets a record whose height differs by at least 32 px and is remeasured, and a frame drawn.
  Prints `{"rows": 100000, "pointer": [600, 350], "first_visible": n, "changed": {"row": n, "height_before": px,
  "height_after": px}, "before": {"row": n, "top": px}, "after": {"row": n, "top": px}}`: the row whose bounds hold the
  pointer, and its top in window px, before and after.
- `offsets`: `ours` at 1,000,000 rows in a real window, scrolled to the last row with End (its bottom on the viewport's
  bottom), then a precise scroll of 0.75 px back up. Prints `{"rows": 1000000, "viewport": {"top": px, "height": px},
  "tops": [{"row": n, "top": px}, …]}`: the table body's viewport and every visible row's top as painted, in window px,
  in row order.
- `sort --data <file>`: `<file>` is `{"columns": [{"name", "type": "number" | "text", "values": […]}]}`, non-finite
  numbers written `"NaN"`, `"Infinity"`, `"-Infinity"`. It loads the columns into `ours`'s typed cells, prints
  `{"ready": true, "rows": n}`, then answers each `{"sort": {"by": "<column>", "filter": null | {"column": "<number
  column>", "at_least": x}}}` with `{"sorted": <rows in the view>}` as soon as the view is sorted, then `{"order": [row
  indices in view order]}`. A process's first sort is a cold one; the tests time it from sending to the `sorted` line.
- `access`: `ours` at 100,000 × 8 in a real window, scrolled to the top with row 0 selected and focused. Prints
  `{"ready": true, "pid": n, "visible": [first, last], "selected": [0, 0]}`, then answers each `{"key": "down" | "up" |
  "shift-down" | "enter" | "cmd-c"}`, dispatched to the window through GPUI's key dispatch, after the frame it causes,
  with `{"visible": [first, last], "selected": [a, b], "activated": row | null}`. ⌘C writes the selected rows to the
  system pasteboard as TSV (cells joined by tabs, rows by newlines). An Accessibility API client reading the window
  counts as assistive tech running. When stdin closes it prints `{"access_allocations": n}` and exits 0.
- `soak`: `ours` starting at 100,000 rows in a 1,200 × 700 viewport (it may lay the element out without a visible
  window). Prints `{"ready": true, "rows": "100000", "viewport": [1200, 700]}`, then answers each event `{"rows":
  "<decimal>"}`, `{"scroll": <px> | "NaN" | "Infinity" | "-Infinity"}`, `{"resize": [w, h]}`, `{"key": "down" | "up" |
  "pagedown" | "pageup" | "home" | "end"}` or `{"select": "<decimal row>"}` with `{"rows": "<decimal>", "viewport":
  [w, h], "offset": <px, a JSON number>, "visible": null | ["<first>", "<last>"], "selected": null | ["<a>",
  "<b>"]}`. Row counts and indices are decimal strings, exact past 2^53.
- `back`: `ours` at 100,000 × 8 in a real window scrolls down 1,000 rows at two rows a frame, then back up. Prints
  `{"rows": 100000, "down_rows": 1000, "shaped_down": n, "shaped_back": n}`: strings shaped on the way down and back.

### Planted twins

Cargo features of deep-app, each in no shipped build, as the base's `plant-*` features:

- `plant-element-per-cell`: `ours` builds one element per cell (#1477.97f5d7c9).
- `plant-f32-offset`: `ours` keeps its scroll offset and row positions in f32 (#1477.4e971aa0).
- `plant-unstable-text-sort`: `ours` sorts text by its first 8 bytes without the stable fix for equal prefixes
  (#1477.fd384f01).

## Criteria and tests

| Criterion | Test |
|---|---|
| `#1477.e66d9bdb` The record gives all arms with their fingerprint, and an unrun arm reads INCONCLUSIVE. It ends in one line: stop, or build | `record.test.ts`: `measure --arms blank,list-10k` lists kit, panel and list-100k reading INCONCLUSIVE with reasons and decides INCONCLUSIVE. A full `measure` here and the committed record each hold every arm measured, with fingerprint and load on a reference Mac by the lane's rule, the issue's window, rows, columns and seconds, `net` equal to raw less blank, and the decision as the last line giving stop or build by the scope's rule on its own numbers. The two must decide the same, else INCONCLUSIVE |
| `#1477.46aa3ab4` A variable-height list of 100,000 rows has update p99 under 4 ms and working set above data under 64 MB, net of the blank arm, or the record names what was built instead | `record.test.ts`: five paired `arm blank`, `arm list-100k` runs of the list the committed record names; p99 within 4 ms and working set above data within 64,000,000 bytes, each net of its blank run, judged by `judgeLimit` |
| `#1477.466ab542` Remeasuring a row above the viewport moves the row under the pointer by 0 px | `record.test.ts`: `remeasure`: the changed row is above the first visible row and changed by at least 32 px; the same row is under the pointer, its top moved under 0.01 px |
| `#1477.97f5d7c9` If built: at 100,000 × 8 for 8 s, update p99 at most 4 ms and allocations per frame net of the blank arm at most 200. A planted twin that builds an element per cell fails, naming the count | `built.test.ts`: five paired `arm blank`, `arm ours` runs judged by `judgeLimit` against 4 ms and 200. Twin `plant-element-per-cell`: the allocation check fails, naming a count over 200 |
| `#1477.4e971aa0` If built: at 1,000,000 rows scrolled to the last row, every row's top within 0.5 px of its exact position. A planted f32 offset fails, naming the row | `built.test.ts`: `offsets`: rows consecutive through row 999,999, covering the viewport's top, each top within 0.5 px of `viewport.top + viewport.height − (1,000,000 − row) × 32 + 0.75`. Twin `plant-f32-offset`: fails naming a row |
| `#1477.fd384f01` If built: sorting 1,000,000 shuffled rows by a number at most 40 ms from cold; the typed path equals a plain comparator on random columns with NaN, infinities, ties and a filter. A planted unstable text sort fails, naming the row | `built.test.ts`: six sorts of 2^18 + 1 seeded rows (two number and two text columns, with and without a filter) equal the plain comparator below; five fresh processes each sort a shuffled 0…999,999 by number once, in order, judged by `judgeLimit` against 40 ms. Twin `plant-unstable-text-sort`: fails naming a row |
| `#1477.035131da` If built: with VoiceOver active, the tree holds a row node for each visible row, and arrows, Shift ranges, Enter and ⌘C as TSV work. With no assistive tech running it costs 0 extra allocations | `built.test.ts`: `access` with `probe.swift` reading the tree: one AXRow per visible row (by AXIndex) with 8 cells; Down, Down, Up select 1, 2, 1; Shift-Down twice selects 1–3; ⌘C puts rows 1–3 on the pasteboard as TSV equal to the tree's cells; Enter activates a row in 1–3. Then `arm ours` with no assistive tech reads `access_allocations` 0 |
| `#1477.1899ebe0` If built: a soak of random events with hostile sizes keeps every invariant, and scrolling down 1,000 rows and back shapes 0 strings on the way back | `built.test.ts`: 2,000 seeded events (rows to 0, 1, usize::MAX ÷ 4 and others; NaN, ±∞ and ±1e300 scrolls; zero sizes; keys; selections past the end): an answer per event, exit 0, and after each the invariants below. `back`: `shaped_down` above 0, `shaped_back` 0 |
| `#1477.af9cb943` The variable-height arm reports strings shaped per frame on a return over rows shown in the last 240 frames. An unrun reading is INCONCLUSIVE | `record.test.ts`: in the full run's record each list arm reports `shaped` over 120 frames down and 120 back, `down` above 0; an unrun list arm reads INCONCLUSIVE |
| `#1477.55753e50` The stop-or-build line cites #1433's `gpui-fast` list reading when it exists | `record.test.ts`: the committed record and the full run's cite by pointer and value, with `#1433` in the decision line, when `docs/spikes/1433/record.json` exists; and cite nothing while it doesn't |

## Under a stop decision

"If built" criteria read the committed record's decision (`builtOrProvenStop` in helpers.ts):

- **build**: the criterion and its twin run as above.
- **stop**: the criterion's condition is false, which is a claim, so it is proven here before anything passes: the
  committed record must pass every #1477.e66d9bdb check (all arms measured on a reference Mac, its stop the one its own
  table arms give), and a fresh `arm blank`, `arm kit` and `arm panel` on this machine, counted by the lane's rule, must
  give both table arms within 4 ms at p99 net of the blank arm (once per file). Then the test passes and logs `not
  built: … decides stop, and this run confirms it (…)`. A fresh run that reads over 4 ms fails ("the decision is
  build"); a run the lane doesn't count reads INCONCLUSIVE. The twins then pass the same way, since there is no element
  to plant them in, and the `plant-*` features and the if-built calls need not exist.
- **INCONCLUSIVE**, a missing record or anything else: fails, or reads INCONCLUSIVE. Never a pass.

So nothing passes on the record's word: a stop passes only as a measured "not built", the same measurement that
decides it, taken again (invariant 2: what passes ran). This job's reading; the issue says "If built" and that a stop
means "we don't build what we don't need".

## Readings where the issue leaves a choice

- **The reference Mac and a loaded machine**: the lane's rule is `scripts/benchmark.mjs`'s `judgeLimit`, imported, not
  copied: any of its reference Macs (Mac15,7 among them), mains power, Low Power Mode off, thermal state nominal, and a
  one-minute load at each run's start and end no higher than the core count. Each limit is judged on five runs, as
  that function and the design's Frame budget require; the record's single reading per arm only decides stop or build.
- **Net of the blank arm**: each percentile less the blank arm's same percentile, run in the same window with the same
  scroll events; working set above data less the blank arm's working set.
- **64 MB** is 64,000,000 bytes. **0 px** is under 0.01 px.
- **"Or the record names what was built instead"**: `list-100k`'s `list` names the list measured, kit's or one built
  instead, and the limits hold for that list either way; naming one is never a pass by itself.
- **Scrolled to the last row**: End, then 0.75 px back up. An offset of 1,000,000 × 32 px less a whole-pixel viewport
  is exactly representable in f32, so without the nudge an f32 twin would place every row exactly.
- **The plain comparator**: ascending; numbers by value, −∞ first and NaN after every number; text by its UTF-8 bytes;
  ties by row index (stable). The filter keeps rows whose number is at least `at_least`; NaN never is. The table has
  2^18 + 1 rows so the parallel path runs. Numbers are multiples of 1/64, which every JSON parser reads exactly.
- **VoiceOver active**: an Accessibility API client reading the window, as VoiceOver does, from outside the process
  (`probe.swift`). Turning VoiceOver itself on would speak aloud and change a system setting, so no test does. Keys go
  through GPUI's key dispatch inside the bench, since GPUI drops input posted to a process (#1172's finding).
- **0 extra allocations** with no assistive tech: the allocations its accessibility code makes over an `ours` arm are 0,
  read while `assistive` is false; a machine with assistive tech running reads INCONCLUSIVE. The `access` session's own
  count is not judged; its tree is.
- **Every invariant** under the soak, as this job can check from outside: the rows and size are those set; the offset
  is a finite number in [0, rows × 32 px]; nothing visible exactly when there are no rows or no height, else a range in
  [0, rows) of at most ceil(height ÷ 32) + 1 rows; a selection within [0, rows); one answer per event; exit 0.
- **The #1433 citation** passes while `docs/spikes/1433/record.json` doesn't exist and both citation fields are null;
  the criterion says "when it exists". Once #1433's record lands this test fails until the record is measured again
  and cites it.
- The scope's run cache, its bound, its bytes for #1431, chrome-role colors, the replica's text snapshot and the two
  height rules have no criterion of their own and no test here, except where a criterion reads them (the run cache
  through `back`, a row's height through `remeasure`).
