# Acceptance tests for #1397: a material or effect that can go NaN is refused at check

Written first, from issue #1397 (its scope, its Fields line, its eight acceptance criteria and its Proof line), the
design sections it links and base commit `0beb4a141` ("Merge pull request #3754 …", main), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- Issue #1397: Scope, Fields (`operator.value {step, op, why: divide_by_zero | negative_root | log_domain |
  zero_normalize | acos_domain, input}`, "It can never: Assume a range nobody declared; ignore a step"), the criteria
  and Proof.
- `docs/technical-design.md`: Document check. `docs/canvas-primitives.md`: What holds a document to its rules; The
  closed function list; Compile, validate and cache (its `values` stage line, the paragraph on the values stage);
  Check input: export kinds (`frames.finite`).
- At the base, for surfaces and conventions only: `crates/deep-canvas-effects/src/check.rs` and `check/inner.rs`
  (`check_with`'s stage order, `read_and_check`, `read_and_check_with`, `CheckOptions`), `graph.rs` (`Issue` and
  `Issue::to_json`, `Input.range`, `port_range`), `interp.rs` (`pass`, `Env`, `Image`, `inputs`; math in f64 with no
  f32 rounding per step), `shipped.rs` (`all()`, the `G` builder's step JSON), `module.rs` (composed pass fixtures);
  `crates/deep-canvas/src/steps.rs` (the op table's ports) and `interval.rs`; `crates/deep-gpu/src/frame_checks.rs` and
  `.wgsl` (`finite`, the `nonfinite` reduction keeping the lowest texel index by an atomic max of its complement);
  `crates/deep-show/src/export/frames.rs` (`float_targets`, the export's `frames.finite` issue `{code, frame, item,
  count, first}`) and `export/test_guards.rs`; `crates/deep-show/src/probe.rs` (`render_back_3d`: the snapshot entry
  `{sha256, w, h, light}`), `main.rs` (the scenario's `planted` match); `crates/deep-canvas-loop/src/framing.rs`
  (`camera.framing`'s defaults: fill 0.2 to 0.9, margin 0.04) and `exposure.rs` (`render.exposure`'s limits),
  `scene.rs` (`kept`); `crates/deep-canvas/src/camera.rs` (`rig`: an orthographic camera's `view_width`);
  `crates/deep-effects-render/src/runner.rs` (`LINEAR`, the core color target, is rgba16float); `scripts/benchmark.mjs`
  (the reference Macs), `scripts/lanes-lists.mjs` (`lane.json`), `scripts/proof-change.mjs` (`criterionId`).
- Sibling suites for form: `tests/acceptance/157/` (`finite.test.ts`, `test.guards`), `2513/` and `1938/` (`deep-show
  run`, claims and `verdict`, a 3D render-back's snapshots), `2657/` and `1312/` (Rust acceptance tests as a crate's
  `[[test]]`), `1993/`, `405/`.
- Not seen: any branch, worktree, PR, session or other issue's comments.

## Run them

Two halves. Criteria 1 to 6 are Rust integration tests of `deep-canvas-effects`, the crate the values stage lands in;
criteria 7 and 8 are vitest files that drive `deep-show run` on this Mac's GPU.

This commit registers the five files as `[[test]]` targets of `crates/deep-canvas-effects/Cargo.toml`
(`acceptance_1397_refusal`, `_textures`, `_transfer`, `_ledger` and `_ablation`, each `path =
"../../tests/acceptance/1397/<name>.rs"`), the precedent being `crates/deep-scene3d-render`'s `acceptance_2657_*` and
`crates/deep-effects-render`'s `acceptance_1312`. That is the only change outside this folder.

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 nice -n 10 \
  cargo test --locked -p deep-canvas-effects \
  --test acceptance_1397_refusal --test acceptance_1397_textures --test acceptance_1397_transfer \
  --test acceptance_1397_ledger --test acceptance_1397_ablation

npm ci   # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1397 --no-file-parallelism --testTimeout=600000 snapshot.test.ts
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1397 --no-file-parallelism --testTimeout=600000 budget.test.ts
npx tsc -p tests/acceptance/1397/tsconfig.json   # type-check
```

Each Rust file is its own test binary, so a surface one criterion needs and the base lacks fails that file's build
alone; `common.rs` is shared by `mod common;`. They need no GPU and read no clock but the date (`ledger.rs`,
`ablation.rs`: the release run's today, UTC).

Each vitest file first runs `nice -n 10 cargo build --locked --bin deep-show --no-default-features --features
full,test-export-guards` (#157's test build, which holds the `test.guards` canvas module), copies the binary out of
`target/` (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. Every `it` passes a one-hour timeout,
which overrides `--testTimeout`. A 3D render-back draws on macOS's Metal device: off macOS, without cargo, or where a
verdict row says the frame couldn't be drawn on a GPU (`gpu_unavailable`, `unsupported_platform`, `software_adapter`),
a test fails with a message starting `INCONCLUSIVE:`; none passes or skips. Each prints what the Proof line asks for
as lines starting `PROOF #1397`. `lane.json` keeps the folder alone (the GPU is shared; each file builds deep-show) and
names `budget.test.ts` timed.

## Surfaces the tests rely on

Present at the base: `deep_canvas_effects::check::{read_and_check, read_and_check_with, CheckOptions, Checked}`,
`graph::Issue` and `Issue::to_json`, `interp::{pass, inputs, Env, Image}`, `shipped::all()`; operator JSON as the
check's own fixtures write it (an input's `range: [lo, hi]`); `deep-show run` with `deep_show` (render-back with
`include: ["issues", "pixels"]`), `claims`, `verdict` and `planted`; the `test-export-guards` feature and its
`test.guards` module; `camera.framing` and `render.exposure` as claim requirements.

New, each named by this job where the issue and design give no name (an implementation builds exactly these, or
disputes them):

| Surface | Used by | Why this name |
|---|---|---|
| A refusal's code `operator.value`, read from `Issue::to_json()`: `step` the step's ID, `op` the op (with or without `@1`), `why` one of the five words, and an `input` field (any non-null value) | AC1, AC2, AC3 | The issue's Fields line. Read through `to_json` so the Rust fields that carry them are the implementer's. |
| `CheckOptions { unit_float_textures: bool }` | AC3 | The planted analyzer the criterion names: a float texture with no declared range read as [0, 1]. Off in real builds, as the other flags. |
| `CheckOptions { mul_two_corners: bool }` | AC4 | The planted `mul` the criterion names: its interval from lo×lo and hi×hi only. |
| `deep_canvas_effects::values` | AC4 to AC6 | The stage's module, named for the design's `values` stage. |
| `values::Lane { lo, hi, may_nan, may_pos_inf, may_neg_inf, may_neg_zero }`, `values::Fact { lanes: Vec<Lane> }` | AC4 | The Scope's domain: a per-component interval plus the four flags, by the Scope's own names. `lo`/`hi` are f64. |
| `values::transfer(op: &str, args: &[Fact]) -> Fact`, `values::transfer_with(op, args, CheckOptions) -> Fact` | AC4 | "One transfer function per step": `op` as a step writes it (`mul@1`), `args` in the op table's port order (`gpu.step@1`), one fact per argument. |
| `values::Verdict { Proven, Unproven(Vec<Issue>) }`, `values::verdict(op: &Value) -> Result<Verdict, Vec<Issue>>` | AC6 | The design's verdict `proven | unproven`, on any operator's JSON whatever its origin; `Err` is a refusal by an earlier stage. |
| `values::ledger() -> Value`: the ledger as a JSON list of rows `{operator, reason, owner, ends: "YYYY-MM-DD"}` | AC5, AC6 | "A ledger with a reason, an owner and an end date". |
| `values::release_run(operators: &[Value], ledger: &Value, today: &str) -> Value`: `{issues: [issue JSON], ablations: [{operator, guard, verdict}]}` | AC5, AC6 | The release run the criteria name, given its operators, its ledger and its date so a test can plant each. `guard` is the guard step's ID, `verdict` `proven` or `unproven`. |
| The check refuses an agent's (`origin: composed`) unproven graph; it doesn't refuse a first-party (`origin: shipped`) one for its verdict, which the ledger and the release run judge | AC1 to AC5 | The design: "An agent's graph that isn't proven is refused … Only a first-party operator may sit on a ledger instead". AC4 runs the CPU reference on a first-party probe that computes `sqrt` of [-1, 1] and the like. |
| Item kind `test.divide@1` in the `test.guards` module (test build only), params `{rects: [[x, y, w, h]], guard: bool}` | AC7 | The ledgered first-party operator the criterion plants, the operator `test.divide@1`, on the test build's ledger: it draws into the frame's float target and, over each rect of view px, divides 0 by 0 (with `guard: true`, by `max(0, 1e-6)`, so nothing is non-finite). The item a refusal names is the item the ID view holds at the offending px (the card under it), not the test item. |
| A frame that settles for evidence carries `finite: {count, gpu_ms}` on its snapshot entry; one whose count is above 0 is refused: the reply returns no snapshot and holds an issue with code `frames.finite`, `count`, `item` (the smallest offending item) and the ledgered operators drawn into it (`test.divide@1` anywhere in it but `message`/`what`) | AC7, AC8 | The Scope's backstop, with the export's own `frames.finite` code and its `item` and `count` fields. `gpu_ms` is the count's GPU time on that frame. |
| A verdict row that read a refused frame is `FAIL`, with an issue naming `test.divide@1` and the item | AC7 | "Each check that read it fails, naming the target, the item and the ledgered operators". |
| Planted names `settle_skips_count` and `nonfinite_last_writer` (the scenario's `planted`) | AC7 | The two wrong programs the criterion names. The implementer adds them to `crates/deep-show/src/main.rs`'s planted match. |

Not pinned: message text; where in a reply the `frames.finite` issue sits; which field of an issue names the input,
operator or item (a value equal to the name, or a path ending `/<name>`, anywhere but `message`); any field beyond
those named.

## Fixtures

- AC1: an agent pass, params `a, b: f32` in [0, 1], `q = div(a, b)`, its color `compose(q, q, q, 1)`; the twin
  divides by `floor = max(b, 1e-6)`.
- AC2: agent passes with `x: f32` in [-1, 1] (and `v: vec3` in [-1, 1]), the refused step always `r`: `sqrt(x - 0.5)`,
  `log(x)`, `pow(x, 2.2)`, `acos(1.001 * x)`, `normalize(v)`, `inverse_sqrt(x)`; each twin clamps the step's argument
  first: `clamp(x - 0.5, 0, 2)`, `clamp(x, 1e-6, 1)`, `clamp(x, 0, 1)`, `clamp(1.001 x, -1, 1)`, `clamp(v, 0.1, 1)`
  lane by lane (so its length is at least 0.17), `clamp(x, 1e-6, 1)`.
- AC3: an agent pass reading `hdr`, the core's color target (rgba16float), `sqrt` of its sample's red; the twin
  declares `range: [0, 1]` on `hdr`.
- AC4: 37 math steps (the op table's float steps that compute: abs, acos, asin, atan, ceil, cos, exp, exp2, floor,
  fract, inverse_sqrt, log, log2, neg, round, sign, sin, sqrt, tan, trunc, add, sub, mul, div, min, max, mod, pow,
  atan2, clamp, mix, smoothstep, length, normalize, dot, distance, cross). Each is a first-party probe pass of 100 ×
  100 px that loads its arguments from float textures and runs once on the CPU reference (`interp::pass`): 10,000
  seeded inputs, in ten sets of 1,000, each set's argument ranges drawn (seeded) from a pool of ranges (some straddle
  0, some are a point, some reach 1e4); one in four inputs is an end of its range, 0 or −0 (the rest uniform, rounded
  to f32 where that stays in range). pow's base is drawn from
  non-negative ranges, clamp's and smoothstep's lo below their hi, as WGSL defines them only there.
- AC5: `test.unguarded_divide@1`, a first-party pass `div(1, b)` with b in [0, 1], and `test.proven_tint@1`, a
  first-party pass that outputs its param in [0, 1]; ledger rows end 2030-09-01 (valid) or 2030-05-01 (expired) on
  the date 2030-06-01.
- AC7 and AC8: `scene` documents of 1920 × 1080 px, an orthographic `camera@1` at view width 1 m looking at (0, 1, 0)
  from +Z (orbit azimuth 0, elevation 0, distance 5), exposure EV100 −log2 1.2 (a scale of 1), a black sky with no
  ambient light, unlit grey 0.18 boxes 0.05 m thick. The card is 0.28125 m square at (0, 1, 0): 540 px square at the
  frame's centre, fill 0.5, key 0 EV, so `camera.framing {keep: [card]}` and `render.exposure {subject: [card]}` both
  PASS on it (a scratch probe at the base, in BASE-FAILURE.txt). The divided card adds `test.divide@1` over the one
  px (960, 540). The four cards are 0.125 m (240 px) at x −0.3, −0.1, 0.1, 0.3 m, each divided over its central 200 ×
  200 px: 160,000 px.

## Criteria to tests

IDs are `#1397.` and the first 8 hex digits of SHA-256 of each criterion's text (`criterionId`). Every test's name
starts `ac<n>_<id>` (Rust) or with the ID (vitest).

| Criterion | Test | Asserts | Wrong program it fails on |
|---|---|---|---|
| `#1397.cde4e9ee` div refused, max(b, 1e-6) passes | `refusal.rs` `ac1_cde4e9ee_…` | `read_and_check` refuses `div(a, b)` with an `operator.value` issue `{step: q, op: div, why: divide_by_zero, input}` (a refusal: nothing reaches the emitter, so no pipeline); the guarded twin passes | the base (no values stage); a stage that misses a zero denominator; one that ignores `max` as a fact (the twin refused) |
| `#1397.8675e644` six planted graphs, 6 of 6 both ways | `refusal.rs` `ac2_8675e644_…` | each of the six refused with `operator.value` at step `r`; each clamped twin passes; the count of both ways in the message | the base; a stage that checks only `div`; one that ignores a step (`pow`, `acos`, `normalize`); one that doesn't take a clamp's range as a fact |
| `#1397.433429ee` undeclared rgba16float is unproven | `textures.rs` `ac3_433429ee_a_graph_…` | refused with an `operator.value` issue naming `hdr`; with `range: [0, 1]` declared it passes | an analyzer that treats an undeclared float texture as [0, 1]; one whose refusal doesn't name the input |
| ″ planted twin | `textures.rs` `ac3_433429ee_a_planted_analyzer_…` | under `unit_float_textures` the graph passes, and the judge above fails it | (the plant itself) |
| `#1397.e6fb8ccf` containment, 10,000 inputs per step | `transfer.rs` `ac4_e6fb8ccf_10000_…` | every CPU reference value lies inside its transfer lane: NaN needs `may_nan`, ±∞ its flag (or an infinite end), −0 `may_neg_zero`, a finite value past f32's range its infinity flag or the interval, any other value [lo, hi] | a `mul` interval from lo×lo and hi×hi; a `sqrt`/`log`/`div` without its NaN or infinity flag; a `round`/`ceil` that never yields −0 |
| ″ planted mul | `transfer.rs` `ac4_e6fb8ccf_a_planted_mul_…` | under `mul_two_corners` some value falls outside, every failure naming `mul@1` | (the plant itself) |
| `#1397.dc1a3fa8` proven or ledgered | `ledger.rs` `ac5_dc1a3fa8_…` | the release run over `shipped::all()` and `ledger()` today raises nothing; an unproven first-party operator on neither list raises an issue naming it; with a valid row none, with an expired row one; a proven operator with no row none, with a row one | a ledger check that ignores end dates; one that lets a row stand for a proven operator; a release run that skips operators it can't prove |
| `#1397.01ec943d` ablation | `ablation.rs` `ac6_01ec943d_…` | each ablation row the release run reports is `unproven`, and the test's own removal of that guard step (its value read in its place) makes `verdict` `Unproven`; every `max`/`min`/`clamp` step of a proven shipped operator whose removal turns it unproven is listed | a values stage that proves an operator without its guard (the guard ignored, or a range assumed); a release run that lists no ablation for a guard |
| `#1397.a937d47d` render-back refused, checks fail, guard restored passes | `snapshot.test.ts` first `it` | the divided card's render-back returns no snapshot and a `frames.finite` issue with count 1 naming `test.divide@1` and `card`; `camera.framing` and `render.exposure` FAIL naming both; with `guard: true` one snapshot, no `frames.finite`, both rows PASS | the base (render-back counts nothing); a count only on export frames; a check that reads a refused frame |
| ″ planted settle path | second `it` | under `settle_skips_count` the frame is returned, and the judge fails it | (the plant) |
| ″ smallest offending item | third `it` | two runs over the four cards: each refused with count 160,000 naming one of the cards, the same card both times | a counter keeping the last writer |
| ″ planted last writer | fourth `it` | under `nonfinite_last_writer` the same judge fails over two runs | (the plant) |
| `#1397.e8a0dc87` same hash, count at most 0.2 ms | `budget.test.ts` | the grey card's render-back returns one snapshot carrying `finite: {count: 0, gpu_ms}`, no `frames.finite` issue, its SHA-256 equal to the base's (recorded below, on the chip it was drawn on); then on a reference Mac `gpu_ms` ≤ 0.2 | a count that changes the picture; one that costs more than 0.2 ms at 1080p; the base (no count) |

## Readings where the issue leaves a choice

- **The merge base's pixel hash**: `eb92b08977dcd2393018d12e54c20a1b6e57a92bddcf6ba5d7b21ad81d71a6fb`, the PNG of the
  grey card's 1080p render-back drawn at the base on Apple M5 Max (macOS 27.2) by the `full,test-export-guards` debug
  build (BASE-FAILURE.txt).
- **"No pipeline is built"** is the check's refusal: `read_and_check` returns `Err`, and nothing reaches the emitter
  before the check passes (check.rs). No GPU is involved.
- **"Each twin with a clamp"**: a `clamp@1` on the unsafe step's argument, with literal bounds inside its domain; for
  `normalize` a lane-by-lane clamp to [0.1, 1], which bounds the length away from 0.
- **"Naming the input"** (AC3): the refusal holds the input's name `hdr`, or a path ending `/hdr`, as a value.
- **"For each math step"**: the 37 float steps above. Integer, texture, noise and structural steps aren't math steps
  here. The CPU reference is f64, so a value past f32's range counts as inside when the lane flags that infinity.
- **"Every shipped operator"**: each graph `shipped::all()` lists. **"Reported in the release run"**: the
  `ablations` list of `release_run`. The release run's date is today, UTC.
- **"A ledgered first-party operator planted to divide 0 by 0 at one pixel"**: `test.divide@1` in the test build, at
  the frame's centre px over the card; "the item" is the card the ID view holds there. **"With its guard restored"**:
  `guard: true`.
- **"Names different items on two runs"**: the judge needs the same item on both runs, so a last-writer counter that
  happens to name the minimum twice isn't caught by this test; four cards × 40,000 px make that unlikely.
- **"The count costs at most 0.2 ms of GPU at 1080p … measured beside the merge base"**: the merge base runs no count
  on a render-back, so the count's cost is its own GPU time, `gpu_ms` on the settled frame, one reading. The pixel
  hash is compared with the base's, drawn on this Mac (Apple M5 Max) by the same test build; on another chip that part
  is INCONCLUSIVE. Off a reference Mac the timing is INCONCLUSIVE; over 0.2 ms at a one-minute load above the cores it
  is INCONCLUSIVE (AGENTS.md: a timing criterion is best effort under load); over 0.2 ms on an unloaded reference Mac
  it FAILs.
