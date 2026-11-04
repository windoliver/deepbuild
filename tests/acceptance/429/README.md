# Acceptance tests for #429: GPU operators — the three kinds as data, the operator check, costs and computed determinism classes

Written first, from issue #429 (its scope, fields, 17 acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/429.md`) and the two upstream files it pins for criterion 12, the design sections it links
and those they lean on, and base commit `5f63620c` ("Merge pull request #1221 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: the whole of GPU operators, as data (GPU operator; Step and the closed step list and its
  structural steps; Operator input, its Cost line on copies into 32-bit words and whole-word partial uploads; Operator
  output and its light response; Place in the frame; Compile, validate and cache, pass fusion and the WGSL subset;
  Operator cost and limits, with the calibration run and the step-down; Determinism class; Status guard; Shipped
  operators and composed graphs, and pack graphs; Draw path; Every public step; Operator budgets by class); Recipe;
  Placement; Time remap; Check input; Material (`material.op`).
- `docs/technical-design.md`: GPU operator; Numbers version 0 has to hold (the canvas row; Every task carries its own
  budgets: five runs after warm-up, the margin, INCONCLUSIVE; the reference Macs); Dogfooding.
- The Oracle page's criterion-12 files at gpuweb/cts `e325d0bcc2`: `binary/f32_comparison.cache.ts` (makeCase accepts
  the result for each input as given or flushed) and `call/builtin/floor.cache.ts` with `util/floating_point.ts:915-919`
  (addFlushedIfNeeded), fetched from the vendored copies in DeepBuildAI/deepbuild's `doneright` branch.
- At the base: AGENTS.md; `tests/acceptance/377/`, `378/`, `379/`, `380/`, `420/`, `421/` (READMEs, helpers, a test or
  two each: one binary built once per file, JSON lines, `--planted` twins, the reference-Mac gate with the owner's change,
  INCONCLUSIVE off macOS, BLOCKED with one ask); `crates/deep-gpu-layer/src/{main,effects,live,view3d}.rs`;
  `crates/deep-canvas-effects/src/{graph,check}.rs`; `crates/deep-canvas/src/steps.rs` (the op table);
  `crates/deep-canvas/src/document/{mod,packs}.rs`; `scripts/lanes.mjs`; `benchmarks/budgets.json`.

What the base already does and these tests don't credit: #380's `check_operator` reads an operator graph, checks it
against the core's op table (types, DAG, fixed repeat counts, limits), refuses a declaration stronger than the class it
computes with `not_exact` at path `determinism` (naming no step), refuses an estimate more than 25% over the declaration
with `cost_understated`, then compiles and runs the operator once; `op`, `exact` and `cross_gpu` run public steps,
shipped exact operators and the one-GPU BLOCKED ask; #379's `live` and `canonical` run sessions with a stub meter whose
`operators` factor scales an operator's measured cost. There is no document item that is a GPU operator (no
`gpu.material@1`, `gpu.pass@1` or `gpu.compute@1`), no `role@1`, `normal@1`, `atomic_add@1`, noise or column steps,
no computed class in any reply, no kind rule on a write's index, no live-only fallback, no `live_only_canonical`, no
column or attribute inputs, no time remap, no fx@1 pack, no step reference, no calibration run and no
`operator_compile` hook. So these tests define the surface below.

## Run them

They build `deep-gpu` (and, for `stepdown.test.ts` and `compile-fail.test.ts`, its `test-meter` build), so they run
with `--no-file-parallelism`, and `scripts/lanes.mjs` needs this folder in its `alone` list beside
`tests/acceptance/377/` … `380/`. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/429 --no-file-parallelism
npx tsc -p tests/acceptance/429/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu [--features test-meter]`, copies it out of `target/debug` to a temporary folder and fails each test that uses
it if the build failed. Each test writes into its own temporary folder and deletes it. Delete Vitest's cache in
`tests/acceptance/429/node_modules/.vite` after a run.

- Anything the GPU draws runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- Timings (`budgets.test.ts`' three timed tests, `calibration.test.ts`) run only on a reference Mac (Mac15,7 or
  Mac15,12; power and Low Power Mode not gated, by the owner's rule) and through the design's judge; a miss on a
  machine whose one-minute load is over 1 a core reads INCONCLUSIVE, never FAIL or PASS.
- `steps.test.ts`' two-GPU test needs a record from a GPU of another family, named by `DEEPBUILD_SECOND_GPU_RECORD`
  (a file `deep-gpu`'s `exact` call wrote there); without it the test fails as `BLOCKED:` with the binary's one ask.
- `taste.test.ts` keeps its three screenshots in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-429-taste`) and reads
  your taste call from the file `DEEPBUILD_TASTE_429` names; without it the test fails as `INCONCLUSIVE:`.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged (one scenario
`{"out", "calls"}` per line, one `{"ok": true, "replies"}` line back, files under `out` named by SHA-256), with more
fields on five existing calls, six new calls, one test hook and ten planted programs.

### Operators, as documents and as `check_operator` takes them

- `check_operator` takes #380's form: `kind: "material" | "pass" | "compute"`, `origin: "composed"`, and the design's
  fields (`about`, `inputs`, `steps` as `{op: name@major, args}` with literals and `step.port` references, `outputs`,
  `determinism`, `cost`, `resolution`, `fallback`, `chain`, `order`, `elements`, `workgroup`).
- In a document, an operator is an item of its writer's layer with kind `gpu.material@1`, `gpu.pass@1` or
  `gpu.compute@1`, its ID the operator's `id` and every other field in `params` (`helpers.ts: asItem`). A material
  operator is attached by a `material@1` item's `params.op: <operator item ID>`, named by a box's `material`. Documents
  require `{scene3d: "^1", effects: "^1"}` and name a budget class.
- Inputs used: `texture` targets `{op: "core", output: "color" | "object_id"}`, `param`, `storage {op, output}` (with
  `count`), as #380 reads them; outputs: a pass's `color`, a material's `emission` and `base_color`, compute
  `storage {type, count}` and `readback {type, count, bytes}`.
- Public steps these tests use beyond the base table, each from Every public step: `role@1 {name}`, `normal@1 {space}`,
  `atomic_add@1 {buf, i, v}` (a statement), and `hash@1` with one argument.

### `check_operator` (#380's call): reply fields added

```json
{"outcome", "issues": [{code, severity, step?, path?, item?, …}], "reached", "class": "exact" | "same_machine" | "live_only",
 "estimate_ns": number, "timing": {"check_ms", "compile_ms", "thread", "ui_thread"}}
```

`class` is the computed class (present whenever the check got that far); `estimate_ns` the check's cost estimate per
pixel or element; `timing` the check's and the compile's wall time and the thread the compile ran on. Issue naming:
`not_exact` names the f32 step by `step` or the input by `path: "inputs/<name>"`; `live_only_canonical` names the
item by `item`; `operator_kind_rule` names the write by `step`; a status-role step is refused naming its `step` with a
code other than `operator_unknown_op`.

### `canonical` (#379's call) and `live` (#379's call): fields added

- `canonical` refuses a document whose check fails as `{"code": "refused", "issues"}` (as today). A check input
  (`checks: {id: {kind, probe: "items/<op>/outputs/<name>", expect, machines: "any"}}`) that reads an operator that
  isn't exact through a readback raises `not_exact` with `path` starting `checks/<id>`.
- `live` call fields: `fail_pipelines: [operator item ID]` (`test-meter` only, the test hook: the device rejects that
  operator's pipeline after it passes the check); `report: ["passes"]` passes gain `operator: item ID | null`. Each
  frame's view gains `settled: bool` and `operators: [{"operator", "item", "resolution": 1 | 0.5 | 0.25 | 0, "drew":
  "operator" | "fallback" | "off"}]`. `stub_meter.operators` is keyed by operator item ID. `told` gains entries
  `{"frame", "session", "writer", "scope": "operator", "operator", "rung": "half" | "quarter" | "off", "reason"}`.
  `sessions[].issues` holds `{"code": "operator_compile", "module", "operator", "item", "evidence"}` (evidence: the
  backend's message).
- `canonical` events and calls gain `purpose: "pixel_check"` (a check that needs that frame), and a Canonical gains
  `presented: bool`, `reason` (why not), and `verdict` for a pixel check. A render-back of a frame drawn with a
  fallback is `presented: false` with a reason; a pixel check of it is `verdict: "BLOCKED"`.
- Documents may carry `time_remaps: {id: {target: <recipe instance ID>, map: "reverse"}}` (Time remap; `reverse` maps
  child time to the document's span minus parent time).

### `view3d` (#378's call, #380's `from`): fields added

`packs: [{"id", "dir"}]` installs packs (deep-show's pack folders: `pack.json` and its recipes) before the
document's check; the document names them in `packs: ["<id>@<version>"]`. `evaluate: [path]` adds to each frame
`values: {path → value}`, the canvas core's evaluated value of each path at that frame (a derived item is
`<instance>.<step>`).

### New calls

| Call | Input | Answer |
|---|---|---|
| `op_table` | — | `{"version", "entries": [{"name", "ports", "weight", "fetches", "exact", "kinds", "module", "public"}]}`: every entry of gpu.step@1 in the build |
| `steps_reference` | — | `{"steps": [{"op", "size": [w, h], "gpu": sha256, "cpu": sha256}]}`, one per public step: the step on this GPU and in the f64 interpreter over at least 64 × 64 seeded inputs, as `.f32` RGBA files (rows top-down, `w × h × 16` bytes) |
| `exact` (#380's) | — | its record gains `steps: {name@major → sha256 of its output bits}` for every exact public step |
| `cross_gpu` (#380's) | `records` | with one family, its one ask gains `gpu`: the missing GPU's Metal family (`apple7`, …), not this one's |
| `columns` | `{"columns": {name → {"type": "u16" \| "f64", "values"}}, "attributes": {name → {"type": "vec3", "domain", "values"}}, "rows": [r], "patch": {"column", "row", "value"}}` | `{"read": {name → [value per row]}, "patch": {"uploads": [{"column", "offset", "bytes", "outcome": "written" \| "refused", "error"?}], "read": {…}}}`: a composed compute operator reading `column` and `attribute` inputs, read back at the rows, then the patch applied and read again |
| `interp_suite` | `{"generated": 10000, "max_steps": 64, "seed": 1}` | `{"shipped": [Row], "fx": [Row], "generated": {"count", "max_steps", "with_repeat", "with_select", "with_swizzle", "outside": [{"seed", …}]}}`, Row `{"operator", "uses_swizzle", "outcome": "within" \| "outside", …}` |
| `calibrate` | — | `{"result": "PASS" \| "FAIL", "composed": "ships" \| "held", "graphs": [{"name", "origin": "shipped" \| "fixture", "uses_noise", "own_pass", "warmup", "p95_ns": [5 runs], "estimate_ns"}], "outside": [{"name", "steps"}]}` |

The release preflight runs `calibrate` as a release lane named `operator calibration` in `scripts/lanes.mjs`
(`releaseLanes`), and `benchmarks/budgets.json` holds a task whose `initialReason` names #429 (the merge-base
comparison of criterion 11).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `render_back_draws_live_only` | Render-back draws live-only passes | 02800e1a |
| `takes_declared_class` | The check takes the declared class instead of the computed one | 776136eb |
| `attribute_stride_16` | The vec3 attribute is bound at a 16-byte stride over packed 12-byte data | 7004cb63 |
| `partial_update_2_bytes` | A patch writes row 713's 2 bytes alone | 7004cb63 |
| `recopies_whole_column` | A patch re-copies the whole column | 7004cb63 |
| `f32_compare_floor_exact` | The op table marks f32 compares and f32 floor exact | de9c4690 |
| `trusts_write_index` | The check trusts a compute write's index | 8c4a173e |
| `drops_swizzle_last` | The emitter drops a swizzle's last component | bb5bf037 |
| `noise_weight_halved` | The op table's noise octave weight is halved | b460869b |
| `settles_with_fallback` | The core marks a frame settled with an operator's fallback drawn | fd8c9ee7 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with its ID. Every planted twin a criterion names has a test asserting it fails the way the
criterion says.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#429.0e8f9a1a` | 1: shader text, a callback, an unbounded loop, a status-color write refused, naming the step | `refusals.test.ts`: the control (role `accent`) accepted and run; steps `raw` (a `wgsl` field), `cb` (a callback literal), `sum` (repeat counted by an unbounded input), `r` (role `fail`, not as an unknown op) each refused naming the step, reaching no pipeline or GPU |
| `#429.c05896b0` | 2: estimate > declaration × 1.25 → `cost_understated` | `refusals.test.ts`: declared at estimate ÷ 1.2 accepted, at ÷ 1.3 refused with it |
| `#429.19822424` | 3: a same_machine operator feeding a check → `not_exact` | `classes.test.ts`: `checks/total_ok` probing a same_machine readback refused with not_exact; the exact readback not |
| `#429.2c1db06d` | 4: seek equals play with a composed operator | `seek.test.ts`: frame 90 sought = played = played again; 30 ≠ 90 |
| `#429.3d6a3f13` | 5: over twice its cost steps its own writer down, half, quarter, off, and tells it | `stepdown.test.ts`: tint at 2.5×: told half, quarter, off in order, resolution 1 → 0.5 → 0.25 → 0; bravo's glaze at 1 every frame, never told, drawn every frame |
| `#429.3eb19699` | 6: public steps within one 10-bit code on 99.9%; exact steps bit for bit on two GPUs; one GPU BLOCKED with one ask naming the missing GPU; f32 declared exact refused | `steps.test.ts`: every public step's reference within one code on 99.9% of ≥ 4,096 pixels; an f32 add declared exact refused with not_exact; one record BLOCKED with one ask whose `gpu` is another family; the two-GPU run BLOCKED without a second record |
| `#429.df16a202` | 7: red t ÷ 2 s in a reversed instance shows 0.25 at parent 1.5 s, its channels at child 0.5 s | `remap.test.ts`: frame 90 at 60 fps: instance box red 0.25, width 1.5 m; a box outside red 0.75 |
| `#429.02800e1a` | 8: a live-only tint shows live; render-back and headless canonical equal the figure without it; live-only material with fallback none refused; planted render-back fails naming the pass | `live-only.test.ts`; twin `render_back_draws_live_only` |
| `#429.776136eb` | 9: classes computed; not_exact naming the step and the input; live_only draws its fallback canonically; planted declared-class check | `classes.test.ts`; twin `takes_declared_class` |
| `#429.7004cb63` | 10: columns and attribute read exactly; the patch uploads only row 713's word; three planted twins | `columns.test.ts`; twins `attribute_stride_16`, `partial_update_2_bytes`, `recopies_whole_column` |
| `#429.04be27ea` | 11: under 20 ms check and compile off the UI thread; GPU time within class; refused in a core view; a still canvas dispatches none; against the merge base | `budgets.test.ts` |
| `#429.de9c4690` | 12: one f32 lt or floor → same_machine, not_exact naming the step; planted op table | `classes.test.ts`, with the CTS port on `op`; twin `f32_compare_floor_exact` |
| `#429.8c4a173e` | 13: write at another index refused with operator_kind_rule; atomic_add checks; planted check | `refusals.test.ts`; twin `trusts_write_index` |
| `#429.bb5bf037` | 14: shipped, fx@1 and 10,000 generated graphs within bound; planted emitter | `interpreter.test.ts`; twin `drops_swizzle_last` |
| `#429.b460869b` | 15: the calibration run; a failed run ships no composed graph; planted noise weight | `calibration.test.ts`; twin `noise_weight_halved` |
| `#429.fd8c9ee7` | 16: operator_compile; fallback while settling; snapshot not presented; check BLOCKED; planted core | `compile-fail.test.ts`; twin `settles_with_fallback` |
| `#429.49543705` | 17: screenshots and one taste call | `taste.test.ts`: INCONCLUSIVE until your call is recorded on these screenshots |

## Readings where the issue and design leave a choice

- **"Refused before it runs"** is read on #380's `reached`: no pipeline and no GPU run (naga may parse a module, as the
  check's own validation).
- **A callback** is a literal arg holding a function's text; **shader text** a step carrying a `wgsl` field; **a
  status-color write** a `role@1` step naming a status role, which the check refuses as such (the step exists, so not
  as an unknown op).
- **The 25% bound** is tested on both sides of it, at 20% and 30% over the declaration.
- **"Feeds a check"** is a document check input whose probe names an operator's readback; `honest_numbers` stands for
  any kind whose result holds on any machine. The document is refused at its check.
- **Classes.** Floats enter the integer graphs only as bits, so each test graph has exactly one f32 step and the
  issue's "naming the step" is unambiguous. The object_id operator is a pass (compute runs before targets exist).
- **One 10-bit code** for a step whose result can leave [0, 1] is 1/1023 of max(1, |reference|).
- **Step-down.** "Half, quarter, off" are the operator's resolutions 0.5, 0.25 and 0; "tells that writer" a `told`
  entry per rung; "other writers keep running" bravo drawn every frame at full resolution.
- **Time remap.** "Reversed over 2 s" is `map: reverse` over the document's 2 s span; "the item's own channels read
  child time" is the derived box's own width channel read through `evaluate`.
- **Columns.** The u16 column is widened into 32-bit words (Operator input: Cost), so row 713's word is bytes 2,852 to
  2,856 and the whole copy 4,004 bytes. The f64 values compare as the f32 they narrow to (round to nearest).
- **Budgets.** The data-view class is measured at its half resolution in a 1,280 × 720 view and the showpiece at full
  resolution full screen on this Mac's display, each over 320 frames, p95 per run; the merge-base comparison is the
  perf lane's task in `benchmarks/budgets.json`, run in the budget window. A still canvas is judged from frame 4 on.
- **Calibration.** Each graph's measured value is the largest of its five runs' p95s; the 25% bound is recomputed here.
  "Ships no composed graph" is the run's `composed: "held"`.
- **Not tested** (not asked by a criterion, or not reachable from outside): that the interpreter goes through the one
  ops module and computes in f64 (an implementation fact; the generated graphs are its proof), the WGSL subset, pass
  fusion, the status guard, structural steps beyond those used, and wgpu's own cts_runner list (run in wgpu's repo).

## Upstream tests (the Oracle lane)

Two criteria have upstream tests. For criterion 12 (`classes.test.ts`), gpuweb/cts `e325d0bcc2`'s
`binary/f32_comparison.cache.ts` and `call/builtin/floor.cache.ts` with `util/floating_point.ts:915-919` (port;
formula) are ported against our output: `lt(-2^-149, 0)` and `floor(-2^-149)` run on this GPU through `op`, each
held to CTS's accepted set for a flushable subnormal, which has two members, the reason an f32 compare or floor is
same machine. For criterion 6, the CTS `binary`, `unary` and `call/builtin` families are already ported against our
`op` call in `tests/acceptance/380/cts-exact.test.ts`; wgpu's `cts_runner/test.lst` is wgpu's own runner, so that
row stays BLOCKED here until a runner reads our output.
