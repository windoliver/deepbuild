# Acceptance tests for #399: graph views, routes, labels, grouped nodes and the data, graph and vector kits

Written first, from issue #399 (its scope, its graph@1/layout@1, route@1 and label@1/labels@1 fields, its eight
acceptance criteria and its proof line), its Oracle page (`doneright/oracles/issues/399.md` in `DeepBuildAI/deepbuild`,
branch `doneright`, with the tsdownsample files it vendors), the design sections it names, and base commit `29d29ba5`
("Merge pull request #1210 …"), by a job that never saw an implementation; none existed. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- `docs/canvas-primitives.md`: The status-color rule; The cost model (the data view class); Canvas module: interface
  and implementation, Registry and seal and its registries; Array and table: column view; Vector and formula
  `vector@1` (`currentColor` maps through `colors`); Series and decimation `series@1` (M4 "equals the full data's
  pixel for pixel for a line drawn without antialiasing"; "The crosshair reads the raw row, never a decimated
  vertex"; "exceed 4 vertices per column"); Graph and layout memory (kept nodes keep rank and order as hard
  constraints, new nodes take their neighbours' barycenter slot, only changed ranks are re-placed,
  `layout.relayout_needed` keeps the old picture; a node naming an item takes its measured bounds and writes its
  place; `groups: box`; the metamorphic fixture; 10,000 nodes in under 50 ms per local change and under 100 MB);
  Route `route@1`; Labels `label@1`, `labels@1`; Auto layout.
- `docs/technical-design.md`: Dogfooding; Tests written first; The canvas core and the module table (graph holds
  graph, layout, route, labels and the memory; data holds series and decimation; vector holds SVG import).
- At the base: `crates/deep-canvas-graph` (`deep-graph layout`, `params.graph`, `params.layout`, `params.memory` on a
  graph@1 item, `layout.relayout_needed` with `names` and `relayout`), `crates/deep-marks-render`
  (`deep-canvas-render check | look | raster | geometry`), `crates/deep-canvas-marks` (`deep-layout solve`, series@1),
  `crates/deep-canvas-vector`, `crates/deep-show` (`run`, `schedule`, `manifest`, `kit`, test features, the kit
  ledger and `DEEP_KIT_LEDGER`); the suites `394/` (deep-graph and the memory format), `397/` (series@1, raster,
  the reference-Mac gate and judge), `398/` (vector@1), `185/` and its redraft, `138/`, `418/` (an interface's kit,
  a planted implementation, a release build) and `1174/` (the taste call).

## Run

```sh
npm ci                     # once, if node_modules is missing
npx vitest run --root tests/acceptance/399 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/399/tsconfig.json
```

Each file builds what it drives once before its tests (`cargo build --locked --bin <name>`, debug, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies each binary out
under its own name, and fails each test that uses a build that failed. `kit.test.ts` builds `deep-show` four ways
(`--no-default-features --features full[,<test feature>]`) and makes three release builds, so it is slow; its tests
carry their own 2-hour timeouts. The files build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/399/'` added to its `alone` list (this job writes only this folder; the implementer makes that
edit). Temporary folders are deleted after each test. Node built-ins and vitest only. A run with `--root` leaves
Vitest's cache in `tests/acceptance/399/node_modules/.vite`; delete it.

Gates: `budgets.test.ts` takes its timing and memory readings only on a fit reference Mac (Mac15,7 or Mac15,12, Low
Power Mode off, thermal state nominal, a 1-minute load at most half the cores; mains power never gates); elsewhere it
skips as INCONCLUSIVE after its structural check, never a pass. `taste.test.ts` is INCONCLUSIVE until a taste call on
this run's pictures is recorded. Everything else runs headless on the CPU (Vello CPU), on any platform.

`BASE-FAILURE.txt` says why every test fails at the base.

## The surfaces under test

The issue names kinds, fields, codes, interfaces and planted programs but no command. These tests extend binaries that
exist, in their conventions (#391's JSON lines: one object per stdin line, exactly one answer line per input line, in
order, exit 0; a line that isn't JSON, lacks a required field or names an unknown `planted` value answers
`{"ok": false, "code": "bad_input"}`; every refusal is `{"ok": false, "code"}`). **Every name below that the issue or
the design doesn't give is this job's choice**; the implementer builds exactly these, or a dispute goes to a blind
redraft. Positions are in u, y down, origin top left; at zoom 1 a view px is a u. A box is `[x, y, w, h]`.

| Binary (crate) | What these tests add | Criteria |
|---|---|---|
| `deep-graph layout` (`crates/deep-canvas-graph`) | incremental layout into a kept memory; `replaced`; `ms`; `memory` on the refusal; `planted: "from_scratch"` | 1, 5 |
| `deep-canvas-render` (`crates/deep-marks-render`) | documents holding `graph@1` and `label@1`; `labels` and `crosshair` subcommands; `geometry` of a graph, a series and a frame; `raster`'s `antialias` and two planted decimators; `labels`' and `geometry`'s plants | 2, 3, 4, 6, 7, 8 |
| `deep-layout solve` (`crates/deep-canvas-marks`) | nothing: used as it is (#375) to measure the cards alone | 4 |
| `deep-show run` (`crates/deep-show`) | three test features; their kits and release builds | scope |

### `deep-graph layout`

Input as #394's README gives it, `{"graph": {"nodes", "edges"}, "layout": {"algo", "direction", "seed"}, "memory"?,
"planted"?}`, nodes `{id, kind, w, h}`, edges `{id, a, b, kind}`, the memory `{id → [rank, order, x, y]}` (rank and
order from 0, `x, y` the box's top-left in u). Added:

- **With a memory, a graph that adds nodes is laid out into the kept picture** (Graph and layout memory): every kept
  node keeps its rank and order, and its x and y bit for bit unless its rank was re-placed; a new node takes its
  neighbours' barycenter slot (below); only the ranks a change touches are re-placed. Output
  `{"ok": true, "memory": Memory, "replaced": [rank], "ms": number}`: `replaced` the ranks (memory numbering, from 0)
  whose places it computed, ascending (every rank on a layout with no memory); `ms` the layout's own wall time for
  that line, from the line read to the answer ready (parsing the line and writing the answer may be left out).
- **A change whose kept constraints can't hold** (an edge its kept ranks break, as at the base) answers
  `{"ok": false, "code": "layout.relayout_needed", "memory": Memory, "names"?: …, "relayout"?: Memory}`, where `memory`
  is the memory it was given, every entry unchanged bit for bit: the old picture kept. `names` and `relayout` stay as
  at the base and aren't read.
- **`planted: "from_scratch"`** (criterion 1's wrong program, reachable only here): ignores the memory and lays the
  whole graph out afresh with the same seed, answering as an accepted line.

### `deep-canvas-render`: documents

The envelope as #373's and #398's suites write it (`{format: 1, id, profile, title, description, size, layers, items,
status_bindings?}`; items `{id, kind, layer, name, order, parent?, at?, params}`). Kinds these tests use:

| Kind | Params the tests set |
|---|---|
| `graph@1` | `graph: {nodes, edges}` (nodes `{id, kind, w?, h?, item?, group?}`, edges `{id, a, b, kind}`), `layout: {algo: "layered" \| "pinned", direction: "down", seed}`, `memory?` (the base's param: the layout memory the view holds), `route?: {mode: "orthogonal"}`; `groups` left at its default `box` |
| `label@1` | `target` (`<marks item>#<row key>` or `<graph item>#<node ID>`), `text`, **`size: [w, h]`** (this suite's field: the label's box in px, padding not included; the design sizes a label by its text, and criterion 7's 40 × 12 px needs it fixed), `fold` (`count` or the default `dot`), `priority?`, `anchors?` (`["s"]` for C's label) |
| `marks@1` | `mark: "point"`, `n`, `key: "key"`, columns `key` (u32), `x`, `y` (f32), `encode: {x, y}`: one point per row, row `k` addressed `<id>#k` |
| `rect@1` | `box`; with a status binding to a verdict (`status_bindings: {id: {target: "items/<id>/params/paint/fill", source: "verdict:<ULID>"}}`) it is a status mark |
| `frame@1`, `text@1` | as #375's auto layout gives them (a card is a column frame, `gap` 4, `padding` 8, `at.pos [0, 0, 0]`, holding two text leaves) |
| `series@1` | as #397's README gives it, with `t` an i64 column (flicks), `v` an f32 column, `window: [t0, t1]`, `decimate: "m4" \| "none"`, `bucket: "1px"`, `marks: ["line"]`, `box` |

- **A node that names an item** (`item`) takes that item's measured bounds as its w and h (the node's `w` and `h` are
  left out), and the layout writes the item's place as a contribution to its transform, so the item draws where its
  node is laid out (Graph and layout memory).
- **Groups**: with `groups: box` (the default) the nodes of one `group` lay out inside one box titled by the group's
  name; routes avoid titles.
- **`algo: "pinned"`**: every node at its memory's x and y.
- **Series pixel columns**: the window `[t0, t1]` maps linearly onto the series box's width; a row at time t belongs
  to the pixel column k (from 0 at the box's left) with `t0 + k·(t1−t0)/w < t ≤ t0 + (k+1)·(t1−t0)/w`, the first row in
  column 0, computed exactly (tsdownsample's edge rule; `columnOf` in `helpers.ts`). M4 keeps each column's first,
  min, max and last rows (the first of equal values), drawn in time order.

### `deep-canvas-render raster` (as at the base, plus)

`{"out", "doc", "look", "t", "antialias"?: false, "planted"?}`: **`antialias: false`** draws the whole frame without
antialiasing (a pixel is covered or not); the default draws as at the base. `planted` values added, each a wrong
program reachable only here: **`decimate_first_last`** (M4 keeps only each column's first and last rows) and
**`decimate_min_max`** (only its min and max rows). The PNG is written to `out`, the document's size at scale 1.

### `deep-canvas-render geometry` (as at the base, plus)

`{"doc", "look", "item", "planted"?}` → `{"ok": true, "subpaths": […], …}`. Added:

- for a **`graph@1`** item, `"graph": {"nodes": {node ID: box}, "groups": {group: {"box": box, "title": box}},
  "routes": {edge ID: [[x, y], …]}}`: each node's laid-out box; each group's box and its title's box; each edge's
  route as the polyline of its corner points (before corner rounding), from a port on the first node's border to one
  on the second's (within 0.5 u), in document u;
- for a **`series@1`** item, `"series": {"rows": [row index]}`: the data row behind each vertex the line draws, in
  draw order, each row once;
- for a **`frame@1`** item, `subpaths` hold its border box's outline (corner rounding aside), with every transform
  contribution applied, a node's place among them, so the bounds of its points are the box it draws in;
- **`planted: "straight_router"`** (criterion 7's wrong program, reachable only here): every route is the straight
  segment between the two nodes' centres' ports, ignoring obstacles.

### `deep-canvas-render labels` (new)

`{"doc", "look", "path": [{"zoom": number, "t"?: flicks}], "planted"?}`: the view's camera stops at each zoom of the
path in order (t default 0), zooming about the document's top-left (a point at u `p` is at view px `p × zoom`), and
places every `label@1` of the document at each stop as it would show there, settled (Labels: per √2 bucket, chained
from the document's base zoom, zoom 1). Answer:

```json
{"ok": true, "steps": [{"zoom": number, "bucket": int, "t": flicks, "folded": int,
  "labels": {label item ID: {"state": "placed" | "folded", "box": [x, y, w, h] | null, "opacity": number}}}]}
```

One step per stop; `bucket` the k with √2^k ≤ zoom < √2^(k+1); each label's `box` its placed box in view px (null
when folded); `opacity` in [0, 1], its fade at that zoom (0 when folded and not fading); `folded` the number of labels
folded at that stop. **`planted: "folds_every_label"`** (criterion 7's wrong program): every label folds.

### `deep-canvas-render crosshair` (new)

`{"doc", "look", "item", "x"}` (x in document u, at zoom 1) → `{"ok": true, "row": int, "t": flicks, "v": number}`:
the series' crosshair snapped to the nearest raw row by time (Series: `crosshair: {snap: nearest row}`), with that
row's index, time and value.

### The kits: `deep-show`

Everything is #185's and #138's: the published plan's `interfaces` (`{"call": "schedule"}`), `{"call": "manifest"}`,
`{"call": "kit", "sequences": 100, "param_sets": 50, "modules"?, "ledger"?}`, the release build's seal reading
`DEEP_KIT_LEDGER`, and its `seal_refused` startup line (exit 2) naming the interface and listing the module in
`modules`. Three test features of `deep-show`, each in no shipped build, each replacing one module's implementation
with a planted one (its own name, `equivalence: bit`, `state: canonical`):

| Feature | The planted implementation |
|---|---|
| **`test-graph-tie-by-registration`** | graph@1's layered layout breaks a tie by registration order instead of by ID |
| **`test-data-m4-drops-last`** | data@1's m4 decimation drops each column's last row |
| **`test-vector-currentcolor-ink`** | vector@1 maps `currentColor` to ink instead of through `colors` |

Each module's own fixtures (the `manifest` entries whose `module` is it) must let its kit catch its plant.

## Fixtures

Written by this job before any implementation ran. The rest are generated in `helpers.ts` from fixed seeds.

- `fixtures/layered-40.json`: a hand-placed layered memory of 40 nodes in 6 ranks of 5, 7, 8, 8, 7 and 5 (IDs
  `n01`–`n40` shuffled across the slots), 52 edges, each between adjacent ranks, so every rank is its longest-path
  rank; each rank's spacing and offset are unusual (gaps 30 + 3r u, offsets 17.25 + 11r u, ranks 90 u apart), so a
  fresh layout with the same seed moves rank 2's nodes (the planted test requires it to move at least one). `added`: node `n41` (48 × 30) and its
  one edge from `n03` in rank 3, whose centre lies between rank 4's third and fourth nodes, so the barycenter slot is
  3, by x and by order alike; `broken`: an edge from a rank-5 node up to a rank-2 node.
- Generated: the crowd (30 points in an 80 × 60 u patch, 56 × 14 px labels, a status mark at (326, 224, 28, 14)
  among them; they can't all fit); the zoom board (60 points over 800 × 500 u, labels 30–70 × 12–16 px, priorities
  −2 to 2); the grid (50 points 60 px apart, ten by five, 40 × 12 px labels); the route graph (A, B, C, D, E pinned,
  60 × 30 u; edges A→B, A→D, E→B; C's label `s` of C, on the straight line from A to B); the six cards (Build: b1, b2,
  b3; Ship: s1, s2, s3; edges b1→b2, b1→b3, b3→s1, s1→s2, s1→s3, so b3→s1 enters Ship's box past its title); the
  million rows (t = i ms in flicks, v seeded noise in [0, 0.5) as f32, row 500,166 at 1.0, mid-column 1,500 of 3,000);
  the 10,000-node graph (40 ranks of 250, each node fed from the node above it and odd ones also from its left
  neighbour's), and ten changes each adding one node to rank 21 with one edge from rank 20.

## Criteria to tests

IDs are `#399.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (#305's rule); the scope's kit item is `#399.7d35b13d` by the same rule over its bullet.

| ID | Tests, and the wrong programs each fails on |
|---|---|
| `#399.ea818db6` (1) | `layout.test.ts` (2). Adding n41 with the memory: every node outside rank 4 keeps rank, order, x and y bit for bit (a relayout fails); n41 in rank 4 at slot 3 (appending, or slotting by ID, fails); rank 4's kept nodes keep their order around it, 24 u apart; `replaced` is `[3]`. The broken edge: `layout.relayout_needed` with `memory` equal to the old one, no node moved (a layout that moves nodes, or answers without the old picture, fails). **Planted** `from_scratch`: the same kept-ranks check fails, naming a rank-2 node it moved |
| `#399.8c38ebbf` (2) | `labels.test.ts`: the crowd at zoom 1: every label placed or folded, some folded and some placed, no two placed boxes overlap, none overlaps the status mark, `folded` equals the folded count (a placer that ignores status marks or overlaps, or drops labels uncounted, fails) |
| `#399.b6d3c9ba` (3) | `labels.test.ts`: the zoom board reached at 0.6 by zooming in (0.25 → 0.6), out (2 → 0.6) and by a seek: one bucket, the same labels' states, boxes and opacities (a placement kept from the previous frame fails); some label part way through a fade at a zoom near 1 (no fade fails), and held at that zoom at t 0, 0.5 s and 5 s every opacity is the sweep's (a fade by time fails) |
| `#399.79b9406f` (4) | `cards.test.ts`: each node's size is its card's measured size (`deep-layout solve`) within 0.5 u, each card's drawn box its node's box within 0.5 u (a layout that never writes the place fails); groups `Build` and `Ship`, each box holding its three cards and none of the other's, each card under its title; every edge routed, none entering a title |
| `#399.4bd0e343` (5) | `budgets.test.ts`: everywhere, the million-row M4 line draws 1 to 4 vertices in every column; on a fit reference Mac, five runs of ten changes to the 10,000-node graph, each run's slowest `ms` judged against 50; the peak memory (`/usr/bin/time -l`) of `deep-graph layout` on one change and of `raster` of the million-row series, three runs each, judged against 100 MB; the merge base's `deep-graph` answer and time on the same change printed beside |
| `#399.53449721` (6) | `series.test.ts` (3). The M4 raster equals the full-rows raster pixel for pixel without antialiasing, the full line inks every column and the spike's column highest; the crosshair at the spike's x reads row 500,166 at its t and 1.0, and at row 500,266's x (same column, none of its M4 rows) that raw row (a crosshair on decimated vertices fails); the Oracle lane below. **Planted** `decimate_first_last`: differs, naming its first column, the spike's among the columns; **planted** `decimate_min_max`: differs, naming its first column |
| `#399.bf5632b7` (7) | `place-route.test.ts` (3). The grid at zoom 1: all fifty placed, none folded; the route A→B: from A's border to B's, at least 8 u from C's box and C's label, x and y never decreasing (B lies right of and below A), at most one shared segment with A→D and with E→B. **Planted** `folds_every_label` fails the first case (fifty folded); **planted** `straight_router` fails the second, naming C |
| `#399.93b00910` (8) | `taste.test.ts`: `raster` draws the 40-node graph before and after n41, the crowd's labels and the six cards; the PNGs it wrote go to `target/acceptance/399/` with their SHA-256s printed; then `TASTE.json` (below) |
| `#399.7d35b13d` (scope) | `kit.test.ts` (4). In `full`: data@1, graph@1 and vector@1 each implemented by the module of that name (vector sealed through the registry), the reference, bit and canonical, no behavior part, every part of the canvas kit listed; the kit over each module at its interface's digest runs only listed parts, each every declared case, all PASS, the fixtures part running each of the module's own fixtures. Each planted feature: the plan names a bit implementation other than the reference; the kit over its module FAILs with a failure naming one of that module's own fixtures it ran and a non-empty `field`; the whole kit's ledger records it FAIL; the release build embedding that ledger refuses to start, naming the interface and the module |

## The taste call

`taste.test.ts` writes `graph-before.png`, `graph-after.png`, `labels.png` and `cards-groups.png` to
`target/acceptance/399/` (the PNGs `raster` wrote, byte for byte). Those files are attached to the PR and shown to the
owner in the session; that is the implementer's, outside any test. The owner's answer is recorded in
`tests/acceptance/399/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 399, "criterion": "#399.93b00910", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"graph-before.png": sha256, "graph-after.png": sha256,
 "labels.png": sha256, "cards-groups.png": sha256}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes. No other test reads a picture to judge it.

## Readings where the issue and design leave a choice

- **Ranks.** The criterion counts ranks from 1; the memory from 0. Rank 4 is memory rank 3.
- **"Re-places only rank 4"** is read as `replaced: [3]` beside every other rank's entries kept bit for bit.
- **"Its neighbours' barycenter slot"** is the place among rank 4's kept nodes after every node whose centre x lies
  left of the mean centre x of the new node's neighbours (here one); the fixture makes it agree with the mean-order
  reading.
- **"Kept order can't hold"** is a change that breaks the kept ranks (an edge up the ranks), the base's case; **"the
  old picture kept"** is the refusal's `memory`, equal to the one given.
- **"Fails naming it"** for a planted program is this suite's check, the one that holds the honest program, failing on
  the plant with a message naming the node (1), the column (6) or C (7), as #394's suite reads a planted twin.
- **"Status mark"** is a rect bound to a verdict; "overlap" is shared interior area of the label's box (padding not
  included) and the mark's box.
- **"Fold and are counted"** is `folded`, with the labels set `fold: count`.
- **"The same however it got there"** compares the last stop's labels (state, box, opacity) of three runs in three
  processes. **"By zoom, never by time"**: some label part way at a zoom near the bucket edge, the same opacities at
  that zoom at any `t`.
- **Card boxes** are the frame's drawn box from `geometry`; the measured size is #375's `deep-layout solve` of the
  cards alone.
- **"Keeps 8 u"** is the least distance from the route's polyline to each box, at least 8 − 0.01; **"never doubles
  back"** is monotone x and y toward B; **"shares at most one segment"** counts overlapping collinear segment pairs.
- **"Without antialiasing"** is `raster`'s `antialias: false`; **"the crosshair at the spike's x"** is the x of the
  spike's time on the box.
- **Budgets.** The 50 ms is the layout's own `ms` per change, on the dev binary (the implementer may set the graph
  crate's dev `opt-level`, as `Cargo.toml` does for others); "each view" is the graph view's layout process and the
  series view's raster process, each by peak resident memory. The limits are absolute; "compared with the merge
  base" is read as the merge base's `deep-graph` run on the same change, printed beside ours (at the base it answers
  `layout.relayout_needed`, having no incremental layout).
- **The kits' failures** name `fixture` and `field` as #185's and #418's suites read them; the field's value isn't
  pinned. "A release build refuses each" is the refusal naming the interface as data and the module in `modules`.

## Upstream tests (the Oracle lane)

| Criterion | Upstream test (pinned) | How it runs here |
|---|---|---|
| 6 | tsdownsample `567f68f5f5`: `downsample_rs/src/m4.rs:310-452`, `tests/test_algos_python_compliance.py`, `tsdownsample/_python/downsamplers.py:181-222` | port and formula: `M4_py` and `_get_bin_idxs` are ported into `helpers.ts` (MIT notice there), binning by pixel column over the window with its `side="right"` edge rule; the port reproduces `test_m4_scalar_with_x_correct`'s indices (0, 0, 33, 33, 34, 34, 66, 66, 67, 67, 99, 99 for 100 rising values in 3 bins), our decimator's `geometry` rows for that series must be those rows, and its rows for the million-row fixture must equal the reference's. The pixel equality, the crosshair and the twins are ours |

Criteria 1–5, 7 and 8 have no upstream test (the page says so); these tests are their local proof.

## Not tested, because no criterion asks

`aggregate` and portals, `focus`, `query`, `compare`, `rank_hint`, `pin: rank | order`, tree, treemap and grid
layouts, `direction: right`, route modes other than orthogonal and its plant's straight line, `corner_radius`,
`ends`, per-kind route `paint`, `crossing: hop`, routes cached by corridor, label `fold: dot | hide`'s drawing,
`keep_previous`, `zoom: [min, max]`, needs-you labels placing first, labels leaving their frame, nothing recomputed
while the camera moves, `budget: ms` on the layout, and the relayout offered as a previewed patch.
