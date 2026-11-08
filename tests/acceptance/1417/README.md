# Acceptance tests for #1417: graph.layout's cost row, and a graph over its class refused at check

Written first, from issue #1417 (its scope, four acceptance criteria and proof line), the design sections it touches,
and base commit `ede4b367` ("Merge pull request #1284 …"), by a job that never saw an implementation; none existed.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- `docs/canvas-primitives.md`: The cost model (per-item terms, "Before it shows", the budget class table: graphs are
  data views, Frame CPU 2 ms); Graph and layout memory (its Cost line: full O((V + E) log V × sweeps), about 100 B per
  node and 64 B per edge); Operator cost and limits; Operator budgets by class.
- `docs/technical-design.md`: Dogfooding; Tests written first; the canvas module table's `graph` row.
- At the base: `crates/deep-canvas-graph` (`module.rs`: `layout` registered with no cost, the `layered` and `tie`
  fixtures, the planted `tie_by_registration`; `lib.rs`: `read_graph`, `layered`; `main.rs`: `deep-graph layout`, its
  `ms` only on incremental lines); `crates/deep-canvas` (`cost.rs`: `estimate`/`estimate_by`, `Terms`, `costs_for`;
  `budget.rs`; `costs.json`, whose `graph.layout` row is `ns_per_item` 10,792 with the Mac15,7 / Apple M3 Pro
  fingerprint; `document/check.rs`: `budget_check`'s error `over_budget` at path `budget` with `actual {cpu_ms, gpu_ms,
  gpu_mb, fingerprint}` and `ids` the top three, and `module_checks`' warning `over_budget` past 16 ms; `registry`:
  `Cost`, `Registrar::cost`, `costs_for`); `crates/deep-show` (`deep_show`, `fixtures`, `schedule`, `kit`, `registry`
  calls; `modules()` sealing planted implementations under `test-*` features; `Cargo.toml`'s
  `test-graph-tie-by-registration`); `scripts/lanes.mjs` (`alone`, `timed`); the suites `399/` (kit tests, planted
  features, `budgets.test.ts`'s reference-Mac gate), `379/` (the estimate's `over_budget`) and `394/` (deep-graph's
  bytes in every process).

## What the base already does (not credited)

- The check estimates every document that names a budget class from `costs.json` alone, and refuses one over its
  class with an error `over_budget` (#379). A graph@1 item is counted (the `graph.layout` operator applies to it) but
  at a flat 10.8 µs per item, whatever its size: a 100,000-node graph in a data view is presented (measured here: no
  issue, outcome `presented`, check in about 6 s on a debug build).
- deep-show skips a graph@1 item as `unknown_kind` when it draws (the module registers no kind), so no frame lays it
  out in deep-show today; the check's estimate still reads it.
- The graph module's kit passes on the shipped build, its `layered` fixture with it, and `deep-graph layout` gives the
  same bytes in every process (#394), so AC2 holds at the base. These suites only keep it holding.

## Run

```sh
npm ci                     # once, if node_modules is missing
npx vitest run --root tests/acceptance/1417 --no-file-parallelism --testTimeout=7200000
npx tsc -p tests/acceptance/1417/tsconfig.json
```

Each file builds what it drives once before its tests (`cargo build --locked`, debug with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies each binary out under its own name, and
fails each test that uses a build that failed. `over-budget.test.ts`'s second test exports the merge base
(`git merge-base HEAD origin/main`) with `git archive` into `target/acceptance-1417-base/<sha12>/` and builds its
`deep-show` there with `--target-dir` (a whole build, slow the first time). The files build cargo binaries, so they
run one at a time: `scripts/lanes.mjs` needs `'tests/acceptance/1417/'` in its `alone` list, and
`'tests/acceptance/1417/estimate.test.ts'` in its `timed` list (this job writes only this folder; the implementer
makes those edits). Temporary folders are deleted after each test. Node built-ins and vitest only. A run with
`--root` leaves Vitest's cache in `tests/acceptance/1417/node_modules/.vite`; delete it.

Gate: `estimate.test.ts`'s comparison is a reading, taken only on the reference Mac `costs.json`'s fingerprint names
(model, chip and memory bytes equal), Low Power Mode off, thermal state nominal, a 1-minute load at most half the
cores. Elsewhere it prints the three pairs and skips as INCONCLUSIVE after its structural part, never a pass.
Everything else runs on any platform.

`BASE-FAILURE.txt` says what fails at the base and why.

## Assumed surfaces

The issue names an operator, a code, a fixture and a planted program but no command. These tests reach them through
binaries that exist, in their conventions (JSON lines; `deep-show run` takes one scenario line and answers
`{"ok": true, "replies": [...]}`). **Every name below that the issue or the design doesn't give is this job's
choice**; the implementer builds exactly these, or a dispute goes to a blind redraft.

### The graph documents

A board `{format: 1, profile: "board", seed: 1417, title, description, size: [1280, 720], budget, items: {g}}` whose
one item `g` is `{id: "g", kind: "graph@1", name: "Graph", order: "a0", params: {graph, layout}}`, with `layout`
`{algo: "layered", direction: "down", seed: 1417}` and `graph` `R` ranks of `W` nodes: node `v{r}x{j}` is
`{id, w: 40 + 8 × ((r + j) mod 5), h: 30}`; for `r > 0` an edge `e{r}x{j}` from `v{r-1}x{j}`, and for odd `j` also
`f{r}x{j}` from `v{r-1}x{j-1}` (about 1.5 edges per node). Sizes: 100 = 10 × 10, 1,000 = 20 × 50, 10,000 = 40 × 250,
100,000 = 100 × 1,000.

### The check: `deep-show run` → `deep_show` (exists)

Scenario `{evidence, sessions: {"sess-alpha": {thread, name, process: {pid: 4100, start: 1000}}}, panels: {main:
{rect: [0, 0, 1280, 720]}}, docs: {<doc>: {panel: "main"}}, calls: [{call: "deep_show", session: "sess-alpha", doc,
document, include: ["issues"]}]}`, as #379's suite sends it.

- **Refused at check** (AC1, AC3): the reply's `outcome` is `"refused"` and its `issues` hold exactly one issue with
  `code: "over_budget"` and `severity: "error"` (the budget check's; `module_checks`' warning, if one is raised, is
  not it). On that issue:
  - `ids` holds `"g"` (it is among the top contributors).
  - `what` contains the text `graph.layout`.
  - **`actual.operators`** (new): an object from operator key to that operator's estimated CPU ms a frame in this
    document; it holds at least `"graph.layout"`. `actual.cpu_ms`, `gpu_ms`, `gpu_mb` and `fingerprint` stay.
    `actual.operators["graph.layout"]` ≤ `actual.cpu_ms`.
  - For the 100,000-node graph under `budget: {class: "data_view"}`, `actual.operators["graph.layout"]` alone is over
    2 ms (the data view's Frame CPU).
- The estimate for AC3 is read the same way, from a document whose `budget` is `{class: "data_view", frame_cpu_ms:
  1e-6}` (a document may tighten its class), so the check refuses every size and the issue carries the estimate.
- **Passes the check** (AC1 at the merge base, AC2): no `over_budget` issue (AC1) / no error issue (AC2), and
  `outcome: "presented"`.

### The layout's measured time: `deep-graph layout` with `timed: true` (new field)

`deep-graph` built `--release`. An input line may carry `timed: true`; its accepted answer (a fresh layout, no
`memory`) then carries `ms`: the layout's own wall time in ms, from reading the graph to the memory computed (as the
incremental lines' `ms` is timed today), excluding parsing the line and writing the answer. Without `timed`, a fresh
layout's answer is unchanged (#394's same bytes in every process). The test sends the size's graph and layout seven
times in one process and takes the median of the last six.

### The fixture: `fixtures` (exists) and `deep-graph layout` (exists)

`{call: "fixtures"}` answers `{fixtures: [{module, name, document}]}`; the graph module's fixture named `layered` is the
board. Its graph@1 item `flow`'s `params.graph` and `params.layout`, sent as one line to `deep-graph layout` (debug),
answer `ok: true` with the `memory` member spelled exactly as `fixtures/layered-layout.json`'s `memory` (the text
between `"memory":` and the closing `}` of that object; compared as text, not as parsed numbers). That file was
written by this job at the base `ede4b367`: the `fixtures` call on the base's debug `full` build of deep-show, the
item's params sent to the base's `deep-graph layout` (debug; the release build answered the same bytes), the answer
line recorded whole as `line` and its memory member as `memory`.

### The kit: `kit` (exists) and the feature `test-graph-layout-no-cost` (new)

`{call: "kit", sequences: 100, param_sets: 50, modules: ["graph"]}` (#138). Its reply's `modules[]` entry for
`graph` has `verdict` and `parts[] {part, verdict, cases[] {case, fixture?, verdict, failure?}, failures[]}`.

- On the shipped `full` build the graph module's `verdict` is `PASS`, and every case whose `fixture` ends in
  `graph/layered.board` (at the base `parity/graph/layered.board`) has `verdict: "PASS"`.
- **`test-graph-layout-no-cost`**: a new `deep-show` Cargo feature, beside `test-graph-tie-by-registration`, that
  seals in the shipped graph module's place a planted graph@1 implementation under its own implementation name
  (`schedule`'s `interfaces["graph@1"].implementation.name` is not its `reference`), whose `layout` lays out exactly as
  the reference does and declares no cost; nothing else differs. Built `--no-default-features --features
  full,test-graph-layout-no-cost`, the kit call above answers the graph module `verdict: "FAIL"`, with at least one
  failure (the module's, a part's, or a case's `failure`) outside the `bit` part whose JSON contains `graph.layout`;
  the `bit` part, when the kit runs it, passes.

## Criteria to tests

IDs are `#1417.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (#305's rule).

| ID | Criterion | Tests, and the wrong programs each fails on |
|---|---|---|
| `#1417.52357c9c` (1) | A 100,000-node graph is refused at check with `over_budget`, naming the operator and its estimate; on main it passes the check | `over-budget.test.ts` (2). The 100,000-node graph in a data view: refused, one error `over_budget`, `ids` holding `g`, `what` naming `graph.layout`, `actual.operators["graph.layout"]` over 2 ms and within `actual.cpu_ms`; the refusal is printed for the proof (a flat per-item cost, as the base's, presents it and fails; a refusal that names no operator or carries no per-operator estimate fails). The merge base's own deep-show presents the same board with no `over_budget` |
| `#1417.e58ee238` (2) | The fixture `layered` board passes, with its layout unchanged byte for byte | `layered.test.ts` (2). The kit passes the graph module, every `layered` case PASS, and the board from `fixtures` is presented with no error; its item `flow`'s layout memory from `deep-graph layout` equals the base's bytes (a cap or cost that changes or refuses the layout fails) |
| `#1417.c04ec518` (3) | The estimate is within 2 times the measured layout time for 100, 1,000 and 10,000 nodes | `estimate.test.ts` (1, timed lane). Everywhere: each size's `actual.operators["graph.layout"]` is positive and grows 100 → 1,000 → 10,000 (a cost that ignores nodes and edges fails), and the release `deep-graph` answers `ms` with `timed: true`; the three pairs are printed for the proof. On a fit reference Mac: each estimate / median measured within [0.5, 2] passes, outside by more than the runs' margin fails, else INCONCLUSIVE |
| `#1417.b17a643a` (4) | A planted `layout` that declares no cost fails the module's check | `planted.test.ts` (1). The `test-graph-layout-no-cost` build seals the plant; the graph kit fails it with a non-`bit` failure naming `graph.layout`, its `bit` part (if run) passing; the shipped build passes the same call (a kit that never checks a declared cost fails) |
