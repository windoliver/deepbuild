# Acceptance tests for #1312: a particle born inside emit.span vanishes at its slot's next birth after the span

Written first, from issue #1312 (its cause, its repro and its three acceptance criteria), the design sections it
links and the base commit `1d3ae632` ("Merge pull request #1310 …", main), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

## What was read

- Issue #1312: Cause, Repro on main (1d3ae632), Expected, Acceptance criteria.
- `docs/technical-design.md`: Dogfooding, "Tests written first, by a job that never sees the code".
  `docs/canvas-primitives.md`: Particles `particles@1` (its fields; "Particle i's state at t is a closed-form function
  of its age, its index and the seed").
- At the base, for surfaces and conventions only: `crates/deep-canvas-effects/src/shipped.rs` (`particles()`, its
  inputs and defaults, `PARTICLE_FLOATS`, and the tests module's `positions()`, whose way of running the operator is
  copied, not imported), `src/interp.rs` (`Env`, `inputs`, `compute`), `src/check.rs` (`read_and_check`);
  `crates/deep-gpu-layer/src/effects.rs` (`sparks_of`: how a `particles@1` item's `emit`, `life`, `motion.ballistic`,
  `draw` and `size` reach the operator and the draw), `src/view3d.rs` (`targets`, `from`, `frames`, `fps`, `capture`;
  the linear target written as `<sha>.f32`), `src/main.rs` (`no_device` at startup), `crates/deep-effects-render/src/
  particles.wgsl` (a sprite `size` in px; a dead slot, w < 0, draws nothing), `crates/deep-gpu/Cargo.toml` and
  `crates/deep-gpu-layer/Cargo.toml` (wgpu's `vulkan` feature is off at the base; only macOS adds `metal`);
  `tests/acceptance/422/helpers.ts` (imported), `1285/` and `1297/` (the GPU suites' form), `327/` (Rust acceptance
  tests as `[[test]]` targets), `scripts/lanes.mjs` (`alone`), `scripts/affected.mjs` and `scripts/proof-change.mjs`
  (criterion IDs).
- Not seen: any branch, worktree, PR or other issue's comments, including #1173's tests and PR #1302.

## Surfaces used

- Criteria 1 and 2: `deep_canvas_effects::shipped::particles()` (the shipped `particles.sparks@1`), with
  `op["elements"] = 64`, checked by `deep_canvas_effects::check::read_and_check` and run by
  `deep_canvas_effects::interp::compute` at seed 7, every parameter the criterion doesn't name at its default through
  `interp::inputs`. Instance columns: 8 floats per slot, position x, y, z, w (age ÷ life, −1 when dead), velocity x,
  y, z. `operator.rs`, the `[[test]]` target `acceptance_1312` in `crates/deep-canvas-effects/Cargo.toml`; no
  dev-dependency added.
- Criterion 3: `deep-gpu run` with `view3d` calls (`from`, `frames: 1`, `fps: 60`, `capture`, `targets`), the reply's
  frames and their SHA-named target files. `repro.test.ts` and `helpers.ts`; #422's helpers for JSON, `sessionDoc`,
  `camera`, `PLAIN_LOOK`, `view3dCall`, `framesOf`, `readLinear` and PNG reading. All present at the base.

## How each criterion is read

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed. Every failure
message names the slot, t, the expected value and the value got.

| Criterion | Read as |
|---|---|
| AC1 `#1312.326099bf` A particle born inside the span lives out its life | `count 2, rate 2, span 1.2, life_min = life_max = 1.5`. w within 1e-4 of: t 1.7 → slot 0 0.7 ÷ 1.5, slot 1 1.2 ÷ 1.5; t 2.2 → slot 0 1.2 ÷ 1.5, slot 1 −1; t 2.6 → both −1 (`ac1_a_particle_born_inside_the_span_lives_out_its_life`). The clause on a slot first born after the span is its own test: same emitter with `span: 0.4`, slot 1's w is −1 at t 0.45, 0.6 and 2.0 (`ac1_a_slot_first_born_after_the_span_never_draws`); it holds on main. |
| AC2 `#1312.73432a75` It keeps its own path across the span's end | `count 1, rate 1, span 0.5, life_min = life_max = 10, v0_min = v0_max = 1, gravity [0, 0, 0], drag 0`. At t 1.0, 5.0 and 9.5: each velocity component within 1e-4 of the velocity at 0.4 s, each position component within 1e-4 of position(0.4) + velocity(0.4) · (t − 0.4), w within 1e-4 of t ÷ 10; at 10.5 s w is −1. As preconditions, at 0.4 s w is 0.04 and the speed is 1 (v0), so the reference itself is alive and has a direction to compare. "life: 10" is read as `life_min = life_max = 10`. |
| AC3 `#1312.1cc5895b` The repro draws | The repro's document: a `camera@1` at (0, 0, 5) looking at the origin, fov 40, and one `particles@1` at the origin, `{count: 1, emit: {shape: point, rate: 1, span: 0.5}, life: [10, 10], motion: {ballistic: {v0: [0, 0], gravity: [0, 0, 0], drag: 0}}, draw: puff, size: 48}`, doc seed 7, 160 × 120, #422's `PLAIN_LOOK`. The control is the same document without the emitter. For each frame n of 30, 59, 60, 300 and 630, both are drawn by a `view3d` opened at n (`from: n`, one frame, 60 fps, t = n ÷ 60), all in one process. Footprint: the pixels whose R, G or B differ between the two. On Linux the `linear` target is read (f32); elsewhere the `final` PNG. Frames 30, 59, 60 and 300 need at least 1,000 px; frame 630 needs 0. |

Readings the issue leaves open, and how this suite reads them:

- **The puff's size.** The repro names no `size`; the default (3 px) can't cover 1,000 px. A sprite's `size` is its
  diameter in px (`particles.wgsl`), and a 48 px disc covers about the issue's 1,800 px, so `size: 48`. At the base it
  measures 1,792 px at frames 30 and 59.
- **"A camera that frames it", the frame size and the look.** Not named; chosen as above, with tone map none so the
  linear and final targets both see the puff.
- **Linux.** "wgpu on Vulkan": the base builds `deep-gpu` without wgpu's `vulkan` feature, so on Linux `helpers.ts`
  builds `cargo build --locked -p deep-gpu-layer --bin deep-gpu --features wgpu/vulkan` (no lock or manifest change);
  on macOS the plain `cargo build --locked --bin deep-gpu`, which draws on Metal. On any other platform, or when
  `deep-gpu run` answers `no_device`, the test fails with `INCONCLUSIVE: …; this is not a pass`.
- **Why the linear target on Linux.** At the base on this box the final target doesn't carry the particles on
  Linux: with the puff alive at frame 30 the final PNG (and `pixel_hash`) is byte-identical with and without the
  emitter, while the linear target differs over 1,792 px. The issue's "On Linux read the linear target" is followed.
- **A crash at exit.** At the base on Linux with Vulkan (NVIDIA GB10), `deep-gpu run` often dies by SIGSEGV at exit,
  after writing its whole answer line (5 of 5 runs by hand; the suite's first run exited 0). It is no part of the
  criteria and happens on every program, so `helpers.ts` judges an answer written in full before a signal, and logs
  the signal; a process that exits non-zero without a signal, or dies before answering in full, still fails.
- **Seeking.** Each frame is drawn by a `view3d` that opens at it, rather than playing 631 frames, since a particle's
  state is a closed form of t (design: "seeking equals playing").

## Wrong programs each criterion names

- **Main (the base):** AC1 fails, slot 1 is −1 at 1.7 s and slot 0 at 2.2 s; AC2 fails, w is −1 from 1 s on, and its
  velocity there is a new generation's; AC3 fails, 0 px at frames 60 and 300. All for the issue's reason
  (`BASE-FAILURE.txt`). The AC1 guard (`span: 0.4`) and AC3's frames 30, 59 and 630 hold on main, as the issue says.
- **A fix that keeps the particle alive but hashes the uncapped generation** (AC2): its velocity after 1 s is the
  uncapped generation's direction. With no gravity or drag the velocity is v0 alone, so the base already writes that
  program's velocity at t ≥ 1 s, and the base's run shows AC2's velocity assertions rejecting it (for example at
  t = 1 s, x −0.479 against −0.146), independently of w.
- **A fix that drops the born-inside-the-span test** and keeps generation 0 for every slot: the AC1 guard (slot 1,
  first born at 0.5 s after a 0.4 s span, would draw at 0.6 s).
- **A fix that keeps a particle past its life:** AC1 at 2.2 s (slot 1) and 2.6 s, AC2 at 10.5 s, AC3 at frame 630.
- **A renderer that draws nothing:** AC3's frames 30 and 59.

## Run them

```sh
cargo test --locked -p deep-canvas-effects --test acceptance_1312
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1312 --testTimeout=1800000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1312/tsconfig.json
```

The vitest file builds `deep-gpu`, so `scripts/lanes.mjs` lists `tests/acceptance/1312/` in `alone`, beside 1297.
`--root` keeps the checkout's `vitest.config.ts` out (it needs the workspace packages built); it leaves a
`node_modules/.vite` cache in this folder, which isn't committed.

## What was run

On the base `1d3ae632`, Linux arm64 (NVIDIA GB10 on Vulkan), once each: the Rust target (AC1 and AC2 fail, the AC1
guard passes) and the vitest file (AC3 fails at frames 60 and 300, linear target; in the recorded run `deep-gpu`
died by SIGSEGV at exit after answering in full, as above); `tsc` passes on these files. See `BASE-FAILURE.txt`. Not run: a fixed program (none exists), a planted twin for the uncapped-hash fix (argued from the
base's velocities, above), or macOS's final-target path.
