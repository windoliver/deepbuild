# Acceptance test for #1417, criterion 3: the layout's estimate against its measured time

Written first, by a blind job, from issue #1417 ("graph.layout has no cost row and no size cap, so a huge graph lays
out inside the frame"), the design and base commit `259473aea7fb6ea6afa74d6bfd1ae716514ee04c` (main). No
implementation existed when it was written. The implementing agent doesn't edit these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job (design: Dogfooding).

**Criterion** (the issue's third, verbatim): "The estimate is within 2 times the measured layout time for 100, 1,000
and 10,000 nodes". **ID** `#1417.c04ec518`: the first 8 hex digits of the SHA-256 of that text. Every test name
carries it. The other three criteria are other jobs' work.

## What was read

- `AGENTS.md`.
- `docs/technical-design.md`:
  - Dogfooding, and "Tests written first, by a job that never sees the code" and "Wrong programs".
  - Every task carries its own budgets. A timing result is five runs after warm-up. It passes when all five are
    within the limit, and fails when all five are over it by more than the margin, the larger of 5% and the spread
    of the five. Anything else is INCONCLUSIVE.
  - **The reference Macs**: Mac15,7 (M3 Pro, 12 CPU cores, 36 GB), Mac15,12 (M3, 8 CPU cores, 16 GB) and Mac17,10
    (M5 Max, 18 CPU cores, 64 GB, added 2026-11-07). A timing counts only on one of them, on mains power, with Low
    Power Mode off and the thermal state nominal. Anywhere else it is a reading and the check is INCONCLUSIVE.
- `docs/canvas-primitives.md`:
  - The cost model: coefficients come from micro-benchmarks on the reference Mac. The check sums them into CPU time
    per frame, names the top three contributors and refuses a document over its class. The budget class table.
  - Operator cost and limits.
  - Graph and layout memory (`graph@1`, `layout@1`). Its Cost line: full O((V + E) log V × sweeps), and 10,000
    nodes in under 50 ms per local change.
- Base code:
  - `crates/deep-canvas-graph`: `module.rs`, where the `layout` operator registers with no cost; `lib.rs`'s
    `read_graph`, `read_layout` and `layered`; `main.rs`, the `deep-graph layout` line protocol.
  - `crates/deep-canvas`: `cost.rs`, `costs.json` (`graph.layout` is a flat `ns_per_item` of 10,792, measured on
    the 4-node `layered` fixture), `budget.rs`, and `document/check.rs`'s `budget_check`, which raises `over_budget`
    at `budget` with `actual: {cpu_ms, gpu_ms, gpu_mb, fingerprint}`.
  - `crates/deep-show`: the `run` scenario, `deep_show`, the `costs` micro-benchmark.
- `tests/acceptance/379` (`estimate.test.ts`, `helpers.ts`) and `tests/acceptance/399` (`helpers.ts`, its
  reference-Mac gate and judge) for style and helpers.

## The surfaces assumed (all exist at the base)

- **The estimate**: the document check's budget estimate, through `deep-show run`'s `deep_show` call (#393, #379).
  - Each board holds one `graph@1` item, the generated graph, with `requires.modules.graph: "^1"`.
  - It names `budget: {class: core_view, frame_cpu_ms: 0.001, frame_gpu_ms: 0.001}`. Any estimate is then over, so
    the check always raises its `over_budget` at path `budget`.
  - The test reads `actual.cpu_ms`: the frame CPU the cost model estimates from the build's reference coefficients.
  - The graph is the only item, so that number is the layout operator's estimate plus the core's per-item operators
    on that one item (about 12 µs at the base, independent of size).
  - Assumed: the cost `layout` declares enters this estimate, as AC1's "refused at check with `over_budget`, naming
    the operator and its estimate" implies. Any other `over_budget` issue the fix adds is printed, not used.
- **The measured time**: graph's own layered layout of the same `graph` and `layout`, through `deep-graph layout`
  (#394's surface). It is the same `layered` function the operator runs.
  - It runs in one long-lived process of a `--release` build, because the coefficients are measured optimized
    (#855).
  - Each run sends a batch of the graph with a refused `algo` (`layout.algo_unsupported`, answered after the graph
    is read and before any layout), then a batch of the real line. The batch is ⌈20,000 ÷ n⌉ lines, so a run
    outlasts pipe jitter.
  - The run's value is the difference per line: the layout and writing its answer. The round trip, the JSON text and
    reading the graph cancel out.
  - Each answer must be `ok` with a memory that places all n nodes.
  - There are 3 warm-up runs, then 5 runs.
- **The graphs**: generated from a fixed seed (`helpers.ts`, `layeredGraph`). They are layered DAGs of n nodes in
  about √n ÷ 2 ranks, with about 1.5 edges a node, each to the next rank: 125, 1,401 and 14,616 edges.

## The judgment

For each size, "within 2 times" means every one of the five measured times lies in [estimate ÷ 2, estimate × 2].

- **PASS**: all five are in the band.
- **FAIL**: all five are outside it by more than the margin, either above 2 × estimate × (1 + margin) or below
  estimate ÷ 2 ÷ (1 + margin). The margin is the larger of 5% and the five runs' spread.
- **INCONCLUSIVE** otherwise.

**The machine rule.** A verdict counts only where `notCounted()` finds nothing:

- `sysctl hw.model`, `machdep.cpu.brand_string`, `hw.ncpu` and `hw.memsize` match one of the three reference Macs
  (model, chip, CPU cores and GiB).
- `pmset -g batt` says AC Power.
- `pmset -g` gives `lowpowermode 0`.
- `pmset -g therm` reports no thermal warning level and no CPU speed limit under 100.
- The 1-minute load average is at most half the cores. The design states no load rule for CPU timings. This job
  reads it from "under the GPU lease, with DeepBuild's own other GPU work held" and from the owner's note that
  timings under load are INCONCLUSIVE.

Anywhere else, each size prints its pairs and fails with a message starting `INCONCLUSIVE:` that says which verdict
the reading would give. It never passes. Every line also prints the machine, and the macOS build on a Mac.

**Wrong programs.** A layout that declares no cost, as at the base, has the same estimate at every size: the flat
fitted coefficient plus the core's per-item terms. On a reference Mac it FAILs at least at 1,000 and 10,000 nodes,
where the layout takes 50 to 1,000 times that. The message then says "the estimate is the same at every size, so the
layout declares no cost derived from its nodes and edges". A cost that overstates by more than 2 times FAILs on the
low side. Off a reference Mac, both end INCONCLUSIVE, with the reading's verdict and reason in the message.

## Run it

```sh
npm ci                                   # once, if node_modules is missing
npx vitest run --root tests/acceptance/1417-redraft-ac3
npx tsc -p tests/acceptance/1417-redraft-ac3/tsconfig.json   # type-check, as sibling suites do
```

**What it builds.** Once per file, before the tests: `cargo build --locked --release --bin deep-graph` and
`cargo build --locked --bin deep-show`. It uses `CARGO_TARGET_DIR` when that is set, else `<checkout>/target`. The
binaries are copied into a temporary folder that is deleted afterwards. A failed build fails each test that uses it.

**What it writes.** Each deep-show run takes a fresh temporary evidence folder, which is deleted afterwards.
`--root` leaves Vitest's cache in `tests/acceptance/1417-redraft-ac3/node_modules/.vite`; delete it. It uses only
node built-ins and vitest.

`BASE-FAILURE.txt` is the run at the base, on the Linux Spark (not a reference Mac).
