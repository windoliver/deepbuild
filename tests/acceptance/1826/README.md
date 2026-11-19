# Acceptance tests for #1826: graph's own layouts, tree, treemap and grid, beside layered and pinned

Written first, from issue #1826 (its scope, its five acceptance criteria and its proof line), its Oracle page (no
upstream test checks these criteria; each is held to our own fixture and planted twin), the design sections it names,
and base commit `9550dc0f` ("Merge pull request #2831 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue and its Oracle page (`doneright/oracles/issues/1826.md`, as given to this job).
- `AGENTS.md`, `CONTRIBUTING.md`.
- `docs/canvas-primitives.md`: Graph and layout memory `graph@1`, `layout@1` (the fields, `algo`'s graph-own entries
  `layered | tree | treemap | grid | pinned`, `direction: down | right = down`, `seed`, `spacing: {node = 24, rank = 48,
  edge = 12}`, `memory: {id → (rank, order, x, y)}`; the memory rules: kept nodes keep rank and order, and x and y
  unless their rank's width changed; the same graph, memory and seed give the same bytes).
- `docs/technical-design.md`: Graph, layout, route, label; What done means, fixed at the start; under How we know
  version 0 works: Criteria to tests, both ways (the ID rule), Criteria in a checked shape, Wrong programs, Dogfooding,
  Tests written first.
- `docs/parallel-proof.md` section 6 (the throttle).
- At the base: `crates/deep-canvas-graph` (`deep-graph layout`: `read_graph`, `read_layout`, which refuses every `algo`
  but `layered` and `pinned` with `layout.algo_unsupported`, `read_memory`, `keep`, the `planted` field), its
  `view.rs` and `module.rs`; `crates/deep-marks-render` (`deep-canvas-render raster`, which draws `graph@1` through the
  graph module's `view::place`); the suites `394/` and `399/` (their helpers, `layout.test.ts`, and
  `redraft/taste-redraft.test.ts` with `TASTE.json`, the taste call this suite copies).

## Run

```sh
npm ci                     # once, if node_modules is missing
npx vitest run --root tests/acceptance/1826 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1826/tsconfig.json
```

On a shared machine, through the throttle, as this job ran it:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs test --wait 30 -- \
  npx vitest run --root tests/acceptance/1826 --no-file-parallelism --testTimeout=600000
```

Each file builds what it drives once before its tests (`cargo build --locked --bin <name>`, debug, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies the binary out,
and fails each test that uses a build that failed. `tree`, `treemap`, `grid` and `memory` need only `deep-graph`
(`crates/deep-canvas-graph`, small); `taste.test.ts` needs `deep-canvas-render` (`crates/deep-marks-render`, a large
build). The files build cargo binaries, so they run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/1826/'`
added to its `alone` list (this job writes only this folder; the implementer makes that edit). Temporary folders are
deleted after each test. Node built-ins and vitest only; everything runs headless on the CPU, on any platform. A run
with `--root` leaves Vitest's cache in `tests/acceptance/1826/node_modules/.vite`; delete it.

`taste.test.ts` is INCONCLUSIVE until a taste call on this run's pictures is recorded (The taste call, below).
`BASE-FAILURE.txt` is the suite's run at the base.

## The surfaces under test

The issue names `algo: tree | treemap | grid`, the node column `size`, `direction`, `spacing.rank`, `spacing.node`, the
layout memory and two planted programs, but no command. These tests extend `deep-graph layout`, the graph layout's proof
surface since #394, in its conventions (JSON lines: one object per stdin line, exactly one answer line per input line, in
order, exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value answers
`{"ok": false, "code": "bad_input"}`; a refusal is `{"ok": false, "code", "names"}`, `names` a string), and use
`deep-canvas-render raster` as #399's taste call does. Positions are in u, y down; a box is `[x, y, w, h]`.

**Every name below that the issue or the design doesn't give is this job's choice and a requirement of these tests**;
the implementer builds exactly these, or a dispute goes to a blind redraft.

### `deep-graph layout` (`crates/deep-canvas-graph`)

Input as at the base: `{"graph": {"nodes", "edges"}, "layout": {"algo", "direction"?, "seed", "spacing"?}, "memory"?,
"planted"?}`, nodes `{id, kind, w, h}`, edges `{id, a, b, kind}`, the memory `{id → [rank, order, x, y]}` (rank and order
from 0, `x, y` the node box's top-left in u). Answer as at the base: `{"ok": true, "memory": Memory, …}`. Added:

| Name | Required behavior |
|---|---|
| `layout.algo: "tree"` | accepted; a rooted tree from the edges, memory rank = depth from the root (0), one rank per depth along `direction`, the gap between a parent's box and its child's box along `direction` = `spacing.rank`; siblings' boxes at least `spacing.node` apart; each parent's centre across the ranks = the mean of its children's centres (within 0.5 u). With a `memory`, the layout memory's rules (kept nodes keep rank, order, x and y unless their rank's width changed) |
| refusal **`layout.not_a_tree`** | a `tree` line whose graph isn't a tree answers `{"ok": false, "code": "layout.not_a_tree", "names": "<edge ID>"}`, `names` the ID of the edge that breaks it (here, the one edge that closes a cycle) |
| `layout.algo: "treemap"` | accepted; nested rectangles by `group` tiling the box, each leaf's area in proportion to its `size` |
| node column **`size`** | the issue's `size: f64 = 1`, at least 0, read from each node object |
| **`layout.box: [x, y, w, h]`** | the box (in u) a treemap tiles; the criterion's "400 × 200 u box" is `[0, 0, 400, 200]` |
| answer field **`boxes`** | on every accepted `treemap` answer: `{"boxes": {node ID: [x, y, w, h]}}`, each leaf's rectangle in u (the memory's `[rank, order, x, y]` holds no size) |
| `layout.algo: "grid"` | accepted; nodes in stable-ID order (by ID string, as the base sorts IDs), in rows of ceil(√n), left to right then top to bottom (direction down), neighbours `spacing.node` apart box edge to box edge, across a row and between rows. With a `memory`, the memory's rules |
| **`planted: "rank_by_id"`** | criterion 1's wrong program, reachable only here: lays out as `tree` does, except that the ranks come from stable-ID order instead of depth (the nodes in ID order fill the ranks in turn, each rank taking as many nodes as the tree has at that depth, so the first ID is in rank 0); answered as an accepted line |
| **`planted: "even_treemap"`** | criterion 2's wrong program, reachable only here: lays out as `treemap` does, except that every leaf gets an equal share of the box whatever its `size`; answered as an accepted line with `boxes` |

`planted: "from_scratch"` stays as it is.

### `deep-canvas-render raster` (`crates/deep-marks-render`), as at the base

`{"out", "doc", "look": "clean", "t": 0}` draws the document with Vello CPU and writes the PNG to `out` at the
document's size. Required: a `graph@1` item whose `params.layout` is `tree`, `treemap` (with `box`; each node drawn as
its rectangle) or `grid` draws, as `layered` does at the base.

## Fixtures

Written by this job in `helpers.ts`, from the issue's numbers. Every node is 40 × 24 u; `spacing` is left out, so the
design's defaults hold (node 24 u, rank 48 u: the criterion's 48 u is `spacing.rank`'s default).

- **The 7-node binary tree**: root `n4`; its children `n2`, `n6`; `n2`'s children `n1`, `n3`; `n6`'s children `n5`,
  `n7`; edges `e1` n4→n2, `e2` n4→n6, `e3` n2→n3, `e4` n2→n1, `e5` n6→n5, `e6` n6→n7, rows listed out of ID order. The IDs
  are numbered in order, so ID order is not depth order: `n1`, the first ID, is a leaf at depth 2. `layout: {algo:
  "tree", direction: "down", seed: 1826}`.
- **The cycle**: the same graph with `e7` n1→n4, which closes the cycle n4→n2→n1→n4.
- **The added leaf** (criterion 4): `n8` under leaf `n3`, edge `e8` n3→n8; `n8` sorts last by ID but hangs under the
  second leaf from the left.
- **The treemap**: leaves `t1`, `t2`, `t3`, `t4` with `size` 1, 1, 2, 4, no group, no edges; `layout: {algo: "treemap",
  direction: "down", seed: 1826, box: [0, 0, 400, 200]}`. The areas asked are closed forms: size ÷ 8 × 80,000 u² =
  10,000, 10,000, 20,000 and 40,000 u².
- **The grid**: `g01` … `g10`, listed shuffled, no edges; the 11th `g11` sorts last. `layout: {algo: "grid", direction:
  "down", seed: 1826}`; ceil(√10) = ceil(√11) = 4.

## Criteria to tests

IDs are `#1826.` and the first 8 hex digits of the SHA-256 of each criterion's text after `- [ ] `, trimmed, white space
collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test name carries its ID.

| ID | Test | What it proves, and the wrong programs it fails on |
|---|---|---|
| `#1826.8c543993` (1) | `tree.test.ts` (3) | The tree: the memory holds the 7 nodes and `treeProblems` is empty: in ID order, each node's rank is its depth, each child's box top is 48 u (±1e-9) below its parent's box bottom, each parent's centre x is its children's mean within 0.5 u, siblings at least 24 u apart; the same line in two processes gives the same answer bytes. The cycle: `{"ok": false, "code": "layout.not_a_tree", "names": "e7"}`. **Planted** `rank_by_id`: `treeProblems` is not empty and its first problem names `n1` (rank 0, depth 2), the first misplaced node in ID order. Fails also: a layout that stacks every node at one x (siblings), one that takes `spacing.rank` as the rank pitch (48 u below), and the base's `layered` layout answering for `tree` (on this fixture it puts `n2`'s centre at 84 u over children whose mean is 52 u) |
| `#1826.f1dd5338` (2) | `treemap.test.ts` (2) | One rectangle per leaf in `boxes`; `treemapProblems` is empty: each area within 0.5% of its share, each rectangle inside the box within 0.5 u, no two overlapping (beyond 1e-6 u, float rounding), no gap wider than 0.5 u (each rectangle grown 0.25 u a side covers the box shrunk 0.25 u a side, checked exactly cell by cell). **Planted** `even_treemap`: `treemapProblems` names `t1` first, and exactly `t1`, `t2` and `t4` (each even share is 20,000 u²; `t3`'s size 2 asks 20,000 u² and passes) |
| `#1826.52792868` (3) | `grid.test.ts` (1) | The 10 nodes' rows, read as drawn (equal y, top to bottom, left to right), are 4, 4 and 2 long and read `g01` … `g10`; neighbours 24 u apart across and between rows. With the memory that answer wrote, `g11` added: rows 4, 4 and 3, the third `g09, g10, g11`; every one of the first 10 keeps x and y bit for bit (`Object.is`). Fails: a grid in input order, one in rows of another length, one that centres a short row (it moves `g09` and `g10` when `g11` arrives) |
| `#1826.86ed5db7` (4) | `memory.test.ts` (1) | The 7-node tree laid out, then the graph with `n8` under `n3` laid out with that memory: the memory holds the 7 kept nodes and `n8`, and every kept node's rank, order, x and y are bit for bit as before. Fails: a layout that re-centres the tree or reorders a rank when a node arrives |
| `#1826.a4284c92` (5) | `taste.test.ts` (1) | `raster` draws the 7-node tree (with its edges), the 4-leaf treemap (box `[20, 20, 400, 200]` in a 440 × 240 document) and the 10-node grid; each PNG is its document's size and carries ink; the PNGs raster wrote go to `target/acceptance/1826/` byte for byte with their SHA-256s printed; then `TASTE.json` (below). No other test reads a picture |

The base is the wrong program each test also fails on (`BASE-FAILURE.txt`).

## The taste call

`taste.test.ts` writes `tree.png`, `treemap.png` and `grid.png` to `target/acceptance/1826/` (the PNGs `raster`
wrote, byte for byte). Those files are attached to the PR and shown to the owner in the session; that is the
implementer's, outside any test. The owner's answer is recorded in `tests/acceptance/1826/TASTE.json`, the one file
anyone adds to this folder after this job, and only to record it:

```json
{"issue": 1826, "criterion": "#1826.a4284c92", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"tree.png": sha256, "treemap.png": sha256, "grid.png": sha256}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes.

## Readings where the issue leaves a choice

- **"48 u below its parent"** is the gap from the parent's box bottom to the child's box top, along `direction`, as the
  base's layered layout spends `spacing.rank` between ranks (`at += depth + rank`); not the pitch between box tops.
- **"Laid out `tree`"** carries the scope's tree: one rank per depth (memory rank = depth from 0) and siblings at least
  `spacing.node` apart. Without the sibling spacing a layout that stacks every node at one x would satisfy "centred"
  trivially; without rank = depth the planted program could not be "misplaced".
- **"The same graph twice gives the same bytes"**: the same input line in two processes gives the same answer line.
- **"Refused, naming that edge"**: the refusal's `names` is the edge's ID, as the base's refusals name what they refuse
  in `names`; the code is this suite's `layout.not_a_tree` (the scope: "a graph that isn't a tree is refused").
- **"The first misplaced node"**: the first, in stable-ID order, of the nodes the check that holds the honest tree
  flags. Any ranking by ID order puts `n1`, a depth-2 leaf, in rank 0, so the name doesn't depend on the plant's
  details.
- **"Fails, naming the leaf"**: the treemap check flags each leaf out of proportion, in ID order; the even split's
  leaves out of proportion are `t1`, `t2`, `t4`, the first `t1`.
- **"No overlap and no gap over 0.5 u"**: a gap narrower than 0.5 u is allowed; an overlap is allowed only within
  1e-6 u, float rounding. The treemap's box is a new layout field, `box`, since the design gives none; the leaves'
  rectangles are a new answer field, `boxes`, since the memory holds no size.
- **The treemap's leaves** are the nodes; with no `group` the nesting is one level, the box itself.
- **Rows** of the grid are read as drawn (nodes sharing a y), not from rank and order, which the issue doesn't map for a
  grid; "where they were" is x and y. **"Stable-ID order"** is the ID string's order, as the base sorts IDs; the
  fixture's zero-padded IDs agree with numeric order.
- **"Leaves the first 10 where they were"** and **criterion 4** run with the memory the first answer wrote, as the view
  keeps it (Graph and layout memory).

## At the base

Run once at `9550dc0f` (`BASE-FAILURE.txt`): both binaries build, and all 8 tests fail on an assertion, none at a load,
a build or a type error (`npx tsc -p tests/acceptance/1826/tsconfig.json` exits 0).

- `tree.test.ts`: the tree and the planted line fail at `accepted` (`layout.algo_unsupported`, then `bad_input` for the
  unknown `planted` value); the cycle fails at the refusal's `[ok, code]`, `layout.algo_unsupported` where
  `layout.not_a_tree` is asked.
- `treemap.test.ts`, `grid.test.ts`, `memory.test.ts`: at `accepted`, `layout.algo_unsupported` (the plant: `bad_input`).
- `taste.test.ts`: at `raster draws tree.png`; raster's document check answers `layout.algo_unsupported` at
  `items/g/params/algo`. The same documents with `algo: "layered"` draw at the base, so the envelope is sound.

## Not tested, because no criterion asks

`direction: right`; groups nested in a treemap and its group rectangles; `size`'s refusal below 0 and its default 1;
a graph with two roots or a node with two parents; tree, treemap and grid under `layout.relayout_needed`; the
`graph.layout@1` registry; the first-party pack's layouts; `mix`.
