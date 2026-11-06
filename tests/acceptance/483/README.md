# Acceptance tests for #483: Structural GPU steps — iterate, a stable sort, scan, compaction, small arrays, 3D textures and mips

Written first, from issue #483 (its scope, fields, 10 acceptance criteria and proof line), its Oracle page
(`doneright/oracles/issues/483.md`) and the upstream files it pins, the design sections it links and those they lean
on, and base commit `1d3ae632` ("Merge pull request #1310 …", which holds #429's GPU operators), by a job that never
saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion, plus the planted twins the
criteria name.

## What was read

- Issue #483 and its Oracle page, with the vendored upstream files it pins: SciPy `e4e854eaa8`
  `ndimage/tests/test_morphology.py:525-690` (criterion 1); CUB (cccl `28101b0741`)
  `catch2_test_device_radix_sort_pairs.cu` (3), `catch2_test_device_scan_deterministic.cu` and
  `catch2_test_device_select_flagged.cu` (4), from `doneright/oracles/vendor/` in DeepBuildAI/deepbuild's `doneright`
  branch.
- `docs/canvas-primitives.md`: GPU operators, as data (GPU operator; Step and the closed step list and its structural
  steps; Operator input; Operator output; Place in the frame; Compile, validate and cache; Operator cost and limits;
  Determinism class; Every public step; Operator budgets by class); Registry and seal: registries; Material: texture
  maps (`filter_taps`, which compute texture outputs with mips share).
- `docs/technical-design.md`: GPU operator; Numbers version 0 has to hold (Every task carries its own budgets: five
  runs after warm-up, the margin, INCONCLUSIVE; the reference Macs); Dogfooding.
- At the base: AGENTS.md; `tests/acceptance/429/` (README, helpers, tsconfig, BASE-FAILURE, its refusals, steps,
  budgets, taste, seek and compile-fail tests: the model for these), `200/` (gpu.step@1), `423/` (the floor and
  CPU-reference pattern), `crates/deep-gpu-layer/src/{main,effects,view3d}.rs`,
  `crates/deep-canvas-effects/src/{graph,check,module}.rs`, `crates/deep-effects-render/src/docops.rs`,
  `crates/deep-canvas/src/steps.rs`, `crates/deep-canvas-scene3d/src/look.rs`, `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

#429's `check_operator` checks an operator (types, DAG, fixed repeat counts, limits, the write rule that a storage
write lands only in the invocation's own slots `k × element + j`, the computed class, `estimate_ns`,
`cost_understated`), compiles it and runs it once on blank inputs; the op table holds `index@1` (a literal index past
the array refused with `operator_limit`), the type `array<T, n ≤ 16>` parses and a literal array checks its length;
`repeat@1` with accumulators; storage and readback outputs; `view3d` and `live` draw a document's pass and compute
items (`live`'s passes name their operator), `view3d` writes a `pre_tone` target. There is no `iterate`,
`sort_by_key`, `scan`, `compact`, `with`, `store`, `load3d` or `sample3d` step, no `texture` or `texture3d` output, no
mips, no `texture3d` input or texture input from a compute operator's output, no channel value fed to an operator in a
document, no `operators`, `data`, `size`, `repeat`, `read` or `pool_marker` on `check_operator` and nothing read back
from it, no `read` on `view3d`, none of the seven planted names below, and no #483 task in `benchmarks/budgets.json`.

## Run them

They build `deep-gpu` (and, for `pool.test.ts`, its `test-meter` build), so they run with `--no-file-parallelism`,
and `scripts/lanes.mjs` needs `'tests/acceptance/483/'` in its `alone` list
beside `'tests/acceptance/429/'`. This README is the instruction; the implementer makes that edit, and adds the #483 task to
`benchmarks/budgets.json` (criterion 9).

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/483 --no-file-parallelism
npx tsc -p tests/acceptance/483/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu [--features test-meter]`, copies it out of `target/debug` to a temporary folder and fails each test that uses
it if the build failed. Each test writes into its own temporary folder and deletes it.

- Anything the GPU runs runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- Timings (`budgets.test.ts`' three timed tests) run only on a reference Mac (Mac15,7 or Mac15,12; power and Low Power
  Mode not gated, by the owner's rule) and through the design's judge; a miss on a machine whose one-minute load is
  over 1 a core reads INCONCLUSIVE, never FAIL or PASS.
- `sort.test.ts` writes this GPU's record, `sort-483-<family>.json`, into `DEEPBUILD_EVIDENCE_DIR` (else
  `$TMPDIR/deep-483-evidence`). Its two-GPU test reads the record the same test wrote on the other of an M1 and an M3,
  named by `DEEPBUILD_SECOND_GPU_RECORD_483`; without it the test fails as `BLOCKED:` with one ask naming the Mac to
  run it on.
- `taste.test.ts` keeps its two screenshots in `DEEPBUILD_EVIDENCE_DIR` (else `$TMPDIR/deep-483-taste`) and reads your
  taste call from the file `DEEPBUILD_TASTE_483` names; without it the test fails as `INCONCLUSIVE:`.
- `BASE-FAILURE.txt` says why the suite can't pass at the base; it wasn't run there beyond the type-check.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run [--planted <name>]` with its JSON-lines protocol unchanged,
#429's `check_operator`, #378's `view3d` and #379's `live`, with fields added to `check_operator` and `view3d`, the
structural steps and outputs in the operator's own data, one test hook and seven planted programs.

### The structural steps, as operator data

| Step or field | Form these tests write |
|---|---|
| `iterate@1` (pass) | `{op: "iterate@1", args: {count, index: "k", ping_pong: {format: "rgba16float", resolution: "full"}, body: {steps, outputs: {color: <body step>}}}}`. The step's value is the last run's output, a texture (`load@1`, `sample@1`). The body reads `prev` (the last run's output; run 0's `prev` reads the ping-pong target's clear value, 0), its run index (`index`, a `u32`, as `repeat`'s), its own steps, a `repeat` inside it, and the operator's inputs. |
| `sort_by_key@1` (compute) | `{keys: <storage input>, values: <storage input>, count}`; its value is the values in stable key order |
| `scan@1` (compute) | `{in: <storage input>, op: "add"}`, `op` a literal field of the step; its value the exclusive prefix sum |
| `compact@1` (compute) | `{in, flag: <bool storage input>, count}`; ports `.out` (kept elements in index order) and `.count` |
| A storage output from a step | `{storage: {type, count}, from: "<step>[.<port>]"}`: the output holds that step's result |
| `array<T, n>`, `with@1`, `index@1` | `const@1 {value: [..n], type: "array<f32, 9>"}`; `with@1 {a, i, v}` (a copy); `index@1 {a, i}` with i read at run time clamps into [0, n − 1] |
| `store@1` (compute) | `{tex: <texture output>, ixy, v}`; on a texture3d output `ixy` is a `vec3<u32>`. A store lands in the invocation's own slots, the texel's index in x-fastest order being `k × element + j`, as #429's write rule |
| Compute outputs | `{texture: {format, size: [w, h], mips: bool}}`; `{texture3d: {format, size: [w, h, d]}}` |
| `load3d@1`, `sample3d@1` | `{tex, ixyz}`, `{tex, uvw}`, each giving a vec4 |
| Inputs | `{type: "texture3d", from: {texture3d: {op, output}}}`; `{type: "texture", from: {texture: {target: {op: <compute operator>, output: <texture output>}}}}`; the read of a 3D texture in the next frame, written `{texture3d: {op, output, frame: "previous"}}`, refused at check naming `inputs/<name>`; `{type: "f32", from: {channel: <document path>}}`, the value the document's channels give that path at the frame's flick |

### `check_operator` (#380's, #429's reply): fields added

| Field | Meaning |
|---|---|
| `operators: [operator]` | In place of `operator`: one frame of them, each checked as `operator` is, then run in the frame's order (compute first, then passes by order) if every one passes. `outcome` is `refused` if any is; each issue carries `item`: its operator's ID |
| `data: {name → path}` | What `{op: "core", output: name}` reads: storage as little-endian 32-bit words (a bool one word, 0 or 1); a texture (`color`) as little-endian f32 RGBA rows top-down at `size` |
| `size: [w, h]` | The frame's size (64 × 64 when absent, as today) |
| `repeat: n` | The frame dispatched n times on the same inputs (1 when absent) |
| `read: ["<op>.<output>"]` | Outputs read back after each dispatch |
| `pool_marker: [r, g, b, a]` | `test-meter` only, the test hook: every target the GPU layer's pool hands out for the frame starts filled with this value |

The reply adds `dispatches: [{read: {"<op>.<output>": Read}}]`, one per dispatch, and `timing.gpu_ns: {<op> → [ns per
dispatch]}`, each operator's GPU time (all of a multi-dispatch step's passes) from timestamp queries. A Read is
`{type, count, file}` for storage, `file` the SHA-256 naming `<sha>.u32` under `out`; `{format, size, file, png?,
levels?}` for a texture or a pass's `color`, `file` naming `<sha>.f32` (f32 RGBA rows top-down, a 3D texture's slices in
z order; a unorm texel as the format reads it, in [0, 1]); a pass's `color` adds `png`, the same pixels as an 8-bit PNG
the way the final target encodes them (`<sha>.png`); a texture with mips adds `levels: [{size, file}]`, its whole chain,
level 0 first.

### `view3d` (#378's): field added

`read: ["<op>.<output>"]` adds to each captured frame `read: {"<op>.<output>": Read}`, the operator item's output as it
stood when that frame drew.

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `iterate_feeds_first` | Every run of an iterate reads the first run's output as `prev` instead of the last | d1623c31 |
| `sort_ties_decreasing` | sort_by_key breaks ties by decreasing index | 2a6f04d8 |
| `compact_by_atomic` | compact appends each kept element at an atomic counter's returned value | c7526ca0 |
| `index_wraps` | index takes i mod n instead of clamping | 67c08cd2 |
| `mips_level0_only` | The chain is left at level 0: no level below it is made | aae924bf |
| `mips_kept_under_old_key` | The chain is kept under the old key when the output is made again | aae924bf |
| `pool_without_clear` | The target pool hands a target out as it was left, without its clear | dadc80dd |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped.
Each test's name starts with its ID.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#483.d1623c31` | 1: jump flood | `jump-flood.test.ts`: counts 1 to 9 each within 1 px of the CPU's run of the same graph on 99.9%; 9 runs within 1 px of the exact f64 transform on 99.9%; (e9 − e1) ÷ (e2 − e1) = 8, declared at 9 × e1 it checks with e9 within 25%; SciPy's edt01 ported; twin `iterate_feeds_first` fails first at iteration 2 naming a pixel |
| `#483.c4423040` | 2: limits | `limits.test.ts`: count 16 checks, 17 → `operator_limit`; nested → an error naming `outer_flood` and `inner_flood`; the body reading the tint's target → `operator_kind_rule` at `inputs/other`, while the outer graph reading it checks |
| `#483.2a6f04d8` | 3: stable sort | `sort.test.ts`: both fixtures one hash over 20 dispatches, the CPU stable sort's; twin `sort_ties_decreasing` names output 0; the M1 and M3 records equal (BLOCKED without the second) |
| `#483.c7526ca0` | 4: scan and compact | `scan-compact.test.ts`: both scans bit for bit on two dispatches; compact's order and count; twin `compact_by_atomic` names the first index out of order |
| `#483.67c08cd2` | 5: small arrays | `arrays.test.ts`: the median within one 10-bit code on 99.9%; index(a, 20) → element 8; twin `index_wraps` returns element 2, naming `pick` |
| `#483.c832ba9c` | 6: 3D textures | `texture3d.test.ts`: sample3d and load3d of the 128³ density in the same frame; `frame: previous` refused at `inputs/vol`; 256³ rgba8unorm in a figure refused `over_budget` naming `big3d`, 128³ live |
| `#483.aae924bf` | 7: mips | `mips.test.ts`: 11 levels as the CPU chain, the floor within 2 codes on 99.9%, level 3 (127.5, 0, 0) after the channel; r32uint + mips → `operator_type`; twins `mips_level0_only`, `mips_kept_under_old_key` name level 3 |
| `#483.dadc80dd` | 8: clear value | `pool.test.ts`: left half written, right half 0 under the marker; twin `pool_without_clear` shows the marker naming `prod.tex` |
| `#483.a5f56c33` | 9: budgets | `budgets.test.ts`: sort < 2 ms, scan and compact < 0.5 ms each, iterate < 0.02 ms a run at 1080p (judged); a still canvas dispatches none from frame 4; a #483 task in `benchmarks/budgets.json` |
| `#483.06a48810` | 10: taste | `taste.test.ts`: INCONCLUSIVE until your call is recorded on these two screenshots |

## Readings where the issue and design leave a choice

- **Iterations count from 0.** Iteration 2 is the third run, the first whose `prev` differs between the last run's
  output and the first's, so a planted iterate can first fail there. Each run's output is read as the same graph with
  count k + 1, held to the CPU's k + 1 runs of the graph `helpers.ts: jumpFlood` spells out (exact in floats: integer
  coordinates and squared distances). The flood checks every mask pixel at its 9 offsets on every run, so run 0's
  `prev`, the target's clear value, needs no seeding pass.
- **"Costs it as 9 passes, within 25% of its declaration"**: the estimate grows by one body a run, and declared at nine
  runs of the one-run flood the 9-run flood checks, its estimate within 25% of that.
- **"Reads another operator's target"** is an operator input naming another operator's target, read inside the body;
  read by the operator's outer graph it checks. "Naming both" is one error whose fields hold both step IDs.
- **The sort's output** is its values in key order; with the values the indices, that is the permutation, whose hash
  is the output hash and whose first wrong entry is "the first index out of order".
- **The two-GPU half** needs an M1's and an M3's hashes; a record this test writes on the other Mac carries them.
- **index(a, 20)** reads 20 at run time (from storage), so the clamp, not the check's refusal of a literal index past
  the array, is what's tested.
- **128³ in one dispatch**: twice the 1,048,576-element cap, so each element stores its own two texels.
- **"Reads it in the next frame"** is written `frame: "previous"` on the `texture3d` input, the smallest field for the
  read the design forbids ("read storage from an earlier frame"). The 256³ operator dispatches one element, so the
  refusal can only be its storage; the 128³ one (8 MB) beside it is live.
- **The floor** is a pass that intersects each pixel's ray with the plane y = 0 and samples the checker with an
  explicit level from the footprint's longer axis, so the CPU makes the same trilinear lookups; under `filter_taps: 1`
  the sampler takes one isotropic lookup. The checker is uniform from level 3 down, and wherever the level is under 3
  the floor's uv stays inside [0, 1], so the sampler's address mode can't move a pixel. A showpiece holds the
  1,048,576-element dispatch and full-resolution passes.
- **"Every texel at 0 or 255"** reads a texel's color, RGB; alpha is 255 throughout. Levels 0 to 2 are held to the CPU
  chain exactly, 3 to 10 within one code.
- **"The channel turns the white squares red"**: the checker's `red` input reads `items/b0/at/pos/1`, which the
  channel `turn` moves from 0 to 1 over 0.25 s; frame 30 is past it.
- **"Discards half its pixels"**: a compute producer whose store runs under `when` on half its texels (passes can't
  `discard_if`); the declared clear value is 0, since no output here declares another.
- **Budgets.** A sort, scan or compact run is the p95 of 300 dispatches; iterate's per-run cost beyond its body is a
  difference of medians. The merge-base comparison is the perf lane's task in `benchmarks/budgets.json`. A still canvas
  is judged from frame 4 on, as #429's is.
- **Not tested** (no criterion asks it, or #200's suite already does): each step's `gpu.step@1` entry, its weight,
  exactness fixture and planted twin (the Proof line's "each entry's micro-benchmark weight" belongs to that entry's
  listing); scan over i32; ping-pong formats other than rgba16float; `filter_taps` above 1 on compute textures; a pack
  or document adding a step; SciPy's `sampling` variants (edt03, edt4), which a jump flood has no field for.

## Upstream tests (the Oracle lane)

Three criteria have upstream tests, each made here against our output. Criterion 1: SciPy's
`test_distance_transform_edt01` holds its exact transform to the brute force on a 9 × 9 array; `jump-flood.test.ts`
holds our CPU reference to the brute force there to 6 decimals and our GPU flood to it within the target's precision.
Criterion 3: CUB's `catch2_test_device_radix_sort_pairs.cu` requires pairs sorted equal to `std::stable_sort`'s,
stable on a large array: `sort.test.ts` makes that comparison on our output. Criterion 4: CUB's
`catch2_test_device_scan.cu`, `catch2_test_device_scan_deterministic.cu` and `catch2_test_device_select_flagged.cu`
(an exclusive sum against a host reference, bit-equal run to run; flagged items kept in index order with their count):
`scan-compact.test.ts` makes those checks on our output, the scan dispatched twice.
