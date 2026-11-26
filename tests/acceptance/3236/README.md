# Acceptance tests for #3236: a mark set's node gains a computed value, and its rows a reading focus

Written first, blind, from issue #3236 (live, updated 2026-11-23T08:56:49Z: its problem, Scope, nine acceptance criteria
and Proof line), the four design sections it links and those they lean on, and the base commit `f8c6cff82` ("Merge pull
request #3248"), by a job that never saw an implementation; none existed. No other worktree, branch, pull request, stash
or commit after the base was read, nor anything under `docs/evidence/3236/`. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per
criterion, one test per criterion, plus exactly the four planted programs the criteria name and the planted document of
criterion 1.

## What was read

- The issue (`gh issue view 3236`), and for context its dependencies #376 and #539 and its siblings #1045 and #1192.
- `node scripts/design-section.mjs --issue 3236`: Rules every primitive follows (Accessible: "the accessibility tree and
  its announcements are compared as data in a replica; a screen-reader run is a smoke test, never the check"); Mark set,
  scale and encode (M4 decimation per pixel column); Mark set and columns `marks@1`; Control: picks on rows and grid
  focus. And what those lean on in `docs/canvas-primitives.md`: Scale and encode `scale@1` ("Legend rows are written from
  the intervals and the column's unit"; a classed scale's missing values, null and NaN); Series and decimation
  `series@1`; Asset: tables (a unit per column); and in `docs/technical-design.md`: Dogfooding, Tests written first.
- At the base, for surfaces only: AGENTS.md; `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`,
  `scripts/benchmark.mjs` (`references`, `fingerprint`, `judgeLimit`); `crates/deep-play/src/access.rs` (the tree, shared
  by the app and the web player); `crates/deep-show/src/{access,picks,live,main,hub,frames,track_call,packs}.rs`;
  `crates/deep-canvas-input/src/rows.rs` (#539's moves); `crates/deep-canvas/src/scope.rs` (Tab stops);
  `crates/deep-canvas/src/document/{check,mod}.rs` (item fields, roles); `crates/deep-canvas-marks/src/data.rs` (columns,
  scales, the series' M4 and its pixel columns); `crates/deep-player/web/element.js` (#1045's tree as DOM); the suites
  `539/` (the house form, `deep-show run`, `state.focus`, focus announcements), `1045/` and `172/` (the web player's
  tree in headless Chrome), `376/` (`see`), `1459/` (an assistive client through AppKit), `142/` (budgets judged by
  `judgeLimit`) and `1097/` (a merge-base build from `git archive`).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
fixtures.

## What the base already does, and these tests don't credit

`see` gives the tree: the document's node, then one node per item heard (`{id, role, name}`; a mark set with `role:
data` is one node, with no value), then the controls. A mark set column accepts a `unit` field and ignores it; a column
holding a NaN is refused (`out_of_range` at `items/scatter/params/columns/y/data`), so the fixture scatter, whose
missing y is a NaN, is refused at the base. With no control, Tab focuses nothing (`state.focus` null). #539 is on main:
a pick control with `focus` on a set's rows is one Tab stop, Right follows reading order over the drawn rows, each
landing announced by its label (the key), Enter appends one pick entry, and after the last control Tab leaves the stops.
The check refuses an item field it doesn't know (`unknown_field`, naming the item). The web export of a scatter plays in
headless Chrome here, its page keeping #1045's tree; `deep-show live` opens its window. `deep_show` with `include:
["timing"]` answers `timing.check_ms`, and `eval` answers `frame_ms`. None of the four planted names exists (an unknown
`planted` answers the whole scenario `bad_input`).

So one test passes at the base, as a guard of behaviour that must not change (design: Proven on the base): criterion
1's planted document is refused, naming the item, at `items/scatter/value` (the base's `unknown_field`). Once the value
exists, the check must go on refusing a typed one. `BASE-FAILURE.txt` is the base run.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/3236 --testTimeout=600000 --hookTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3236/tsconfig.json
rm -rf tests/acceptance/3236/node_modules   # vitest's cache after a --root run
```

Each file builds `deep-show` once, in `beforeAll` (`cargo build --locked --bin deep-show`, the default `full` set),
honoring `CARGO_TARGET_DIR`, with rustup's bin first on PATH where it exists, and copies it to a temporary folder. Every
test passes its own timeout (30 minutes; criterion 7 an hour; criterion 9 six hours, for two release builds). Evidence
stores, bundles and binaries are temporary and deleted. Criterion 7 imports #172's browser harness and #169's tree
comparison read only; Chrome runs in a process group of its own and is stopped by that PID. Criterion 8 compiles
`appkit.swift` with `swiftc` into a temporary folder and starts `deep-show live`, stopped by its PID. Criterion 9 builds
in release in this checkout and, at the merge base, in `target/acceptance-3236-base/<sha>/` (kept, as #1097's base
build is). Nothing is stopped by name or port.

**The lanes line.** The implementer adds this to `scripts/lanes.mjs` (this README is the instruction):

```js
// #3236's files each build deep-show; criterion 7 drives headless Chrome, 8 a real window read through AppKit, 9 release builds.
alone.push('tests/acceptance/3236/');
```

Gates, none of them a pass: criterion 7 is `BLOCKED:` without Chrome or a WebGPU adapter (#172's harness); criterion 8
is `BLOCKED:`, naming where it stopped, off macOS, off the reference Macs, without `swiftc`, without Accessibility trust,
with no window AppKit lists, or with a window AppKit reads no identified element under; criterion 9 is `INCONCLUSIVE:`
whenever `judgeLimit` says this machine can't judge a budget now, and when its readings are neither within the target
nor over it. No test reads a timing or the machine's load to pass anything else.

## The surface under test

The issue names a node's value, a reading focus, announcements, an input track, a web player's tree, a live tree read
through AppKit and budgets, but no call. As #539's suite did, everything is driven through `deep-show run` (one JSON
scenario on stdin, one answer `{"ok": true, "replies": [...]}`), on the scope's virtual clock (`clock: {refresh_hz: 120,
lead: 2 ms, check: 0.5 ms}`, each call at its `at`), with `see`, `scope`, `input`, `track`, `eval`, `export` and the
scenario's `planted`; criterion 8 through `deep-show live` (#376's window). **Every field, call, reply field, value
shape and planted name below that the issue or the design doesn't give is this job's choice, the smallest the criteria
need; the implementer builds exactly these, or a dispute goes to a blind redraft.** Times are flicks (705,600,000 a
second).

### Documents (`fixtures.ts`)

Each is a figure with a 2D orthographic camera over its page and a transport (4 s at 60 fps), in #539's form, whose
`id` is its handle `01JB3236…`, shown by the agent's `deep_show` (session `sess-3236`) in an 800 × 600 px panel.

| Fixture | As written |
|---|---|
| The fixture scatter (`scatterDoc`) | `scatter: {kind: "marks@1", name: "Ball height", role: "data", params: {mark: "point", n: 12, columns: {x: {dtype: "f64", len: 12, data, unit: "seconds"}, y: {dtype: "f64", len: 12, data, unit: "metres"}}, encode: {x: {column: "x", scale: "time"}, y: {column: "y", scale: "height"}}}}`; x = 0 … 11; y = 40, 37, 33, 30, 26, **NaN**, 19, 15, 12, 8, 5, 2; scales `time` (linear, domain [0, 12], range [40, 360], `nice: false`) and `height` (linear, domain [0, 60], range [260, 20], `nice: false`) |
| Its edit (criterion 2) | the same, row 0's y 40 → 55, nothing else |
| The planted document (criterion 1) | the same scatter with the item field `value: "11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing"`: the agent typed the node's value |
| With a pick control (criterion 6) | the scatter and `controls: {place: {kind: "press", class: "document", verb: "pick", label: "Pick a reading", role: "grid", rows: ["scatter"], focus: {}}, speed: {kind: "slider", class: "view", …}}` |
| The bar chart (`barsDoc`) | `bars: {kind: "marks@1", name: "Sales by region", role: "data", params: {mark: "bar", n: 12, columns: {left, right (f64), sales (f64, unit "tonnes"), series (str)}, encode: {x: {column: "left"}, x2: {column: "right"}, y: {column: "sales", scale: "tons"}, role: {column: "series", scale: "colors"}}}}`; row i is quarter ⌊i ÷ 3⌋ of series North, South, West (i mod 3); `colors` is ordinal over [North, South, West] to roles ink, accent, focus |
| The series (`seriesDoc`) | `trace: {kind: "series@1", name: "Sensor trace", role: "data", params: {t: i64 1 … 50,000, v: f64, window: [0, 50000], decimate: "m4", bucket: "1px", marks: ["line"], box: [20, 20, 400, 200]}}`: 400 pixel columns, column k holding exactly the 125 rows 125 k < t ≤ 125 (k + 1), its least value 200 + k and its greatest 448 + k |
| The 100,000-row scatter (`bigScatterDoc`) | the scatter's form, 100,000 rows, every row drawn |

The missing y is an IEEE NaN in the f64 column's bytes: the design's missing value (Scale and encode: "null and NaN in
`missing`"), and the smallest form "one row missing y" takes in a `marks@1` column. Units are the column's `unit` field
(Asset: tables gives a table column its unit; "Legend rows are written from … the column's unit"). The scatter's scales
have fixed domains, so the drawn extent can't be read off the scale; y falls as x grows, so key order, x's order and
#539's reading order (centre y, then x) are one order.

### The node's value

A mark set's node in `see`'s tree is `{id, role, name, value}`: **`value` a string**, the text an assistive client reads,
computed by the core at check, never typed. It is judged by its parts, not its exact words:

- before the first column's name, exactly one integer: the rows drawn (11 for the scatter);
- each encoded column by its name as a whole word, in the encodings' order (x, then y), its part running to the next
  column's name: its unit as written in the column, as a whole word, and exactly these integers: its least and greatest
  drawn value and, where it has missing rows, their count after them (x: 0, 11; y: 2, 40, 1). So the issue's own
  "11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing" passes, and so would "11 rows drawn; x: 0 to 11
  seconds; y: 2 to 40 metres, 1 missing";
- a column of categories: each category's name as a whole word, in the scale's order, the first integer after it its
  count of rows (`… North 4, South 4, West 4`).

A typed value is the item field `value`; the check refuses it with an error at `items/<id>/value` naming the item.

### The reading focus

A mark set heard in the tree with no pick control on it is one Tab stop. `state.focus` (the scope's, #383) is, while
the stop holds the focus, the focused row's ID `<set>#<key>` (the base's row ID, as #539's suite reads it; the scatter
and the bars are keyed by their index), or the set's own ID before any row is focused (Tab may enter either way). For a
set walked by buckets (past 1,000 drawn rows) a stop's ID is `<set>#<anything>`. A **landing** is a key after which the
focus is a row or stop of the set it wasn't on just before. Each landing adds one announcement to `see`'s
`announcements`, `{t, id: <the row's or stop's ID>, text}`:

- a row: its encoded values with their units, in the scale's own number form: the text's integers are exactly the row's
  x then y, and the units `seconds` and then `metres` stand in it as whole words (`x 3 seconds, y 30 metres` passes);
- a stop of a series: its count and extent: the text's integers are exactly the count 125 and the stop's least and
  greatest value, the least before the greatest, in any place around the count (`125 rows, 203 to 451` passes).

Focus moves write no entry: no `input` reply's `appended` holds one, and the `track` call's `track` stays empty.

### Calls and fields

| Call | What the tests send | What they read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"] (+ "timing"), at}` | `outcome`, `issues` (`code`, `severity`, `ids`, `path`), `timing.check_ms` | existing; the value new |
| `see` | `{panel, at}` | `tree` (each node's `id`, `role`, `name`, **`value`**), **`announcements`** (`{t, id, text}`) | existing (#376, #539); values and reading announcements new |
| `scope` | `{panel, at}` | — (the walk's start) | existing |
| `input` | `{panel, at, event: {type: "key", key}}`: `Tab`, `ArrowRight`, `Enter` | **`state.focus`**, `appended` | existing; the reading focus new |
| `track` | `{doc, at}` | `track` | existing (#1164) |
| `eval` | `{doc, t: 0, at}` | `frame_ms` | existing |
| `export` | `{doc, out, video: {codec: "web"}, at}` | `outcome`, `receipt` (#172) | existing |
| scenario `planted` | one of the four names below | | existing form, new names |
| `deep-show live` | the walk's scenario on stdin | its reply line (`ok`, `shown`), then its window | existing (#376) |

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, changing nothing else; any
other `planted` value stays `bad_input`. `twins.json` maps each criterion's ID to its twin.

| Name | Criterion | The wrong program |
|---|---|---|
| `tree_keeps_old_value` | 2 | a mark set's node keeps the value of its document's first check; later checks don't write it again |
| `reading_walk_writes_entry` | 3 | each landing of the reading focus appends a pick entry for its row to the document's input track |
| `reading_walk_row_order` | 4 | the reading walk takes the rows in row order, ignoring a column of categories |
| `reading_walk_every_row` | 5 | the reading walk stops on every drawn row, never by buckets, whatever the set's size |

### The web player's tree (criterion 7)

The page is read as #1045's suite reads it (`web.ts`, its `pageTree` with the value added): each element marked
`data-deep-id` that the browser's computed accessibility tree holds and doesn't ignore, in document order, with the
computed name, description and value, the role as #1045 reads it. Node for node is #169's comparison (id, role, name, in
the app's order, nothing missing or extra); value for value is each app node's `value` as the page node's computed value
or computed description, the same text with white space collapsed, and no computed value on a page node whose app node
has none. The app's scatter node must carry a value.

### The live tree through AppKit (criterion 8)

`appkit.swift`, cut down from #1459's probe: `access` (AXIsProcessTrusted) and `watch <pid> <seconds>`: the process's
first window within 30 s, its elements (AXRole, AXTitle, AXDescription, AXValue, AXIdentifier), and every
`AXAnnouncementRequested` the process posts (its AXAnnouncementKey, what AccessKit's polite live regions post) over the
seconds the window shows each frame it lists in `shown` (6 s each, `live.rs`'s HOLD) and 15 s more, at least 30 s and at
most 240 s. The element whose AXIdentifier is `scatter` (AccessKit's author ID, #140) holds the replica's value as its
AXValue, AXDescription or AXTitle; the announcement texts, in order, equal the replica's `see` announcement texts for
the same calls.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#3236.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed, from the live issue. Each test's name starts with `AC<n> #3236.<id>`; each file quotes
its criterion in full. Test count: 2 + 2 + 2 + 2 + 2 + 1 + 1 + 1 + 1 = 14.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#3236.184c874e` | `ac1-value.test.ts` (2) | The scatter is presented and `see`'s node `scatter` has the value: 11 drawn; x `seconds` 0, 11; y `metres` 2, 40, 1. The planted document (the agent typed that value as the item's `value`) is refused with an error at `items/scatter/value` naming `scatter` (passes at the base: a guard). Fails: no value; a typed value kept; the scale's domain as the extent; the missing row counted |
| AC2 `#3236.00cad6c6` | `ac2-edit.test.ts` (2) | The test holds the two documents equal but for row 0's y (40 → 55). Before: y 2 to 40; at the next check: x 0 to 11, y 2 to 55, 1 missing, 11 drawn; every node's name unchanged. `tree_keeps_old_value`: a failure starting `column y:` and naming 2 to 55. Fails: a value written once |
| AC3 `#3236.b282e6d3` | `ac3-walk.test.ts` (2) | Tab reaches `scatter` (the set or a row); Tab and Right × 11 land on `scatter#0` … `#4`, `#6` … `#11` in order, never `#5`; one announcement per landing, in order, integers exactly [x, y], `seconds` before `metres`; no `appended` entry, an empty track. `reading_walk_writes_entry`: a failure "… wrote entry {…}" naming the entry. Fails: no reading focus, a stop per row, the missing row, an entry |
| AC4 `#3236.385f709f` | `ac4-categories.test.ts` (2) | The bars' value lists North, South, West in that order, 4 rows each; Tab and Right × 12 land on 12 distinct bars, North's four, then South's, then West's. `reading_walk_row_order`: the failure "landing 2 (bars#1) is series South, not North". Fails: no categories in the value, a walk across series |
| AC5 `#3236.9b62337c` | `ac5-buckets.test.ts` (2) | Tab and Right × 401 over `trace`: at most 400 stops and the last press moves no more; one announcement per stop, integers exactly 125 and one column's 200 + k, 448 + k; no column twice; every column a stop. `reading_walk_every_row`: the failure "the walk's stop count passes the series' 400 pixel columns …". Fails: a walk by rows, a stop without count or extent |
| AC6 `#3236.310067e5` | `ac6-pick.test.ts` (1) | With `place` (#539's pick, `focus`) and `speed`: Tab, Right × 5 focus `scatter#0`, #1, #2, #3, #4, #6, each announced by its label (integers exactly [key]), no entry; Enter appends one `{control: place, value: {set: 0, key: [6, 0]}}`, the track's only entry; then Tab focuses `speed` and the next Tab nothing. Fails: a second Tab stop, values announced in place of the label, the missing row focused |
| AC7 `#3236.09a204cf` | `ac7-web.test.ts` (1) | The scatter's web bundle in headless Chrome: its page's tree equals `see`'s node for node, and each node's value is the page node's computed value or description. Fails: a player without the value, or with one of its own |
| AC8 `#3236.b9b04201` | `ac8-appkit.test.ts` (1) | On a reference Mac with Accessibility trust: the replica's walk (as AC3's) and its value; `deep-show live` on the same calls; through AppKit, the element `scatter` holds the replica's value, and the window's announcements equal the replica's. BLOCKED, naming where it stopped, where AppKit can't be read |
| AC9 `#3236.b81a558a` | `ac9-budgets.test.ts` (1) | The 100,000-row scatter's node has a value; then, if `judgeLimit` says the machine can judge, release builds here and at the merge base, five rounds, and the differences in `timing.check_ms` and in `eval`'s `frame_ms` each judged against 0.1 ms; FAIL fails, anything but PASS is INCONCLUSIVE |

## Readings where the issue leaves a choice

- **"Gives its node the value: 11 rows drawn, x seconds 0 to 11, y metres 2 to 40, 1 missing"** is a text value whose
  numbers, names and units are exact and whose other words are free (README: The node's value). A structured value
  could stand beside it in another field; the tests read `value` as text, the form an assistive client reads, which
  the web page and AppKit carry as text too.
- **"1 missing"** is counted with the column whose rows are missing (y), after its extent, as the issue writes it; a
  column with none says no count.
- **"A planted document whose agent typed a value"**: the item field `value`, where the agent writes the node's name.
- **"At the next check"**: the agent's next `deep_show` of the whole document. **"With no edit to any name"**: the edit
  changes one y and nothing else, and the tree's names stay as they were.
- **"Tab reaches the scatter"**: the focus after Tab is the set or one of its rows. **"In order"**: the drawn rows by
  key, which is #539's reading order here. **"Each landing adds one announcement"**: exactly one announcement for each
  landing's row, in the landings' order, and none for a row not landed on.
- **"In the scale's own number form"**: the scales' ticks have no decimals here, so the values are integers; the tests
  read integers.
- **"Right lands on one series' four rows before the next series' first"**: the landings grouped by four, in the
  scale's order (North, South, West: the scale's domain, which is also alphabetical and first appearance); the order
  within a series isn't read. **"Naming the second landing"**: the failure starts `landing 2 (`.
- **"A series"** is a `series@1` line, the base's only set with pixel columns and M4; **"its pixel columns"** its box's
  1 px columns (400 here); **"its count"** the rows the column holds (125), not the four M4 keeps; **"extent"** the
  least and greatest value there. **"At most as many stops"**: a walk that reaches its end (a Right that moves no more)
  within 400 stops, each one column's, no column twice, every column reached. **"Naming the count"**: the failure about
  the walk's stop count.
- **"Behaves as #539 says, unchanged"**: the base's #539 behaviour on the drawn rows, the label (the key) announced,
  not the reading focus's values. **"No second Tab stop"**: after `speed`, the next Tab leaves the stops (focus none),
  as at the base.
- **"Equals the app's, node for node and value for value"**: #169's node comparison plus each value as the page's
  computed value or description (the page may carry it either way).
- **"The live tree read through AppKit holds the node's value"**: the element whose AXIdentifier is the item's ID, its
  AXValue, AXDescription or AXTitle the replica's value text. **"The walk's announcements equal the replica's"**: every
  announcement the live window asks AppKit for, in order, against every announcement in the replica's `see` for the
  same calls. **"Can't be read"**: off macOS, off a reference Mac, no `swiftc`, no Accessibility trust, no window, or a
  window AppKit reads with no identified element under it.
- **"Compared with the merge base"**: `git merge-base HEAD origin/main`, built from `git archive` of that commit.
  **"Adds under 0.1 ms to a mark set's check"**: the difference in `timing.check_ms` for the 100,000-row scatter, here
  less the merge base, five rounds. **"Costs nothing more"**: the same difference in `eval`'s `frame_ms` with no focus,
  held to the same 0.1 ms floor, since no measurement shows exactly nothing. **"A target, to be measured"**: anything but
  a clear PASS or FAIL is INCONCLUSIVE with the readings printed.

## Not tested, because no criterion reaches it here

Home and End over a reading focus; Left; the walk over equal ranges of a non-series set past 1,000 rows; a
`rows_of` set; a category column's own walk order within a category; the value of a set whose rows come from logic
arrays or occurrence lists; nested trees, sound for data, the words of a description (the Scope's "not in this task").
They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes line above.
- In the core and `deep-show`: the node's `value` computed at check, refusing a typed `value`; the NaN as a missing,
  undrawn row; the reading focus (one Tab stop, the walk by categories and by buckets, `state.focus`, announcements,
  no entry); the same value in the web player's page and in the live window's tree with its announcements; the four
  planted names.

## Files

- `fixtures.ts` (the documents; no test runner in it), `helpers.ts` (builds, the scenario, the judgements), `web.ts`
  (the page's tree), `appkit.swift` (the assistive client).
- `ac1-value.test.ts` … `ac9-budgets.test.ts`, one per criterion.
- `twins.json`, `tsconfig.json`, `BASE-FAILURE.txt` (the run at the base).
