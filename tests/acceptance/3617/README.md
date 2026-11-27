# Acceptance tests for #3617: the GPU surface's draw-and-finish time gets a number and a budget

Written first, from issue #3617 (scope, five acceptance criteria, proof line), the issues it names (#241, #1433, #377),
the design sections it links (`docs/canvas-primitives.md#gpu-surface` and `#frame-budget`) and base commit `35956a44a`,
by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read, and what the base does and lacks

Read: `AGENTS.md`, `CONTRIBUTING.md`, `docs/technical-design.md` (Dogfooding, Numbers version 0 has to hold, How we know
version 0 works, Repo guards), `docs/parallel-proof.md`, `tests/acceptance/377/` (the protocol, scene format, fence audit
and builds this suite reuses), `tests/acceptance/1413/` and `2039/` (README shape, `lane.json`, the timed-file and lane-judge
pattern), `docs/spikes/1433/raw/candidate-canvas-handoff.json` (its `frame_ms` and `frame_parts_ms`, read in the spike's own
harness at loads 16.1 to 19.6), `scripts/benchmark.mjs` (`references`, `fingerprint`, `judgeLimit`), `benchmarks/canvas.mjs`
and `canvas-judge.mjs` (`judge`, `EFFICIENCY`, `named`), `scripts/lanes.mjs`, `lanes-lists.mjs`, `wait-ratchet.mjs`,
`repo-rules.mjs`, and `crates/deep-gpu/src/{view,ring,encode}.rs` with `crates/deep-gpu-layer/src/{frames,scene}.rs`.

The base already has: `deep-gpu run`'s `frames` call (#377) with `timings: true`, whose frames carry `handoff_ms` and
`ui_ms`; `View::render` (encode on the pool, submit, `on_submitted_work_done`), `View::wait_done`, `View::collect`;
`Times::handoff()`, which starts at `render_done`, when the GPU is done, so it never shows the draw; the scene
module `test.scene@1`, which draws a scene's `regions` in one pass; `benchmarks/canvas.mjs judge` with `judgeLimit`
(five runs, margin, INCONCLUSIVE off the reference Macs and above the cores).

The base lacks: any report of the time from the start of `View::render` to the slot being ready, or of its parts; the
one-pass fixture's task in `benchmarks/budgets.json` and a `draw-finish` bench; the judge's `canvas-gpu-draw-finish`
task; the two planted programs; and the cost line's machine and scene for each figure.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/3617 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3617/tsconfig.json   # type-check
```

Each file builds the debug binary once, `cargo build --locked --bin deep-gpu` (with `CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` unless set), from `$CARGO_TARGET_DIR/debug` (default `target/debug`), copies it to a temporary
folder, and fails each test with cargo's error if the build failed. Correctness reads (parts, planted runs, pixels, fences)
use that **debug** build: they check the report's shape and arithmetic, not a time. The one timed result, AC2's five runs,
is `node benchmarks/canvas.mjs draw-finish`, which builds and runs **release** `deep-gpu` itself (as #854's bench tasks do,
and as the #1433 reading did: `"profile": "release"`). A run leaves Vitest's cache in `tests/acceptance/3617/node_modules/.vite`;
delete it. Temporary folders are removed by each test.

Lane notes for the implementer (these are edits outside this folder, not mine to make): the folder carries `lane.json`, so
it runs alone. `ac2-onepass.test.ts` is a timed file: add `timed.push('tests/acceptance/3617/ac2-onepass.test.ts')` to
`scripts/lanes-lists.mjs` (its test checks it). Add the task `canvas-gpu-draw-finish` to `benchmarks/budgets.json` (below).

## The surface under test

The issue names no code API. **Every name below that the issue or design doesn't give is this job's choice**, the smallest
consistent with #377's protocol and the existing judge; the implementer builds exactly these, or a dispute goes to a blind
redraft. Everything is `deep-gpu run`'s JSON-lines protocol: one scenario `{"out": dir, "calls": [Call]}` on stdin, one line
`{"ok": true, "replies": [Reply]}` out, exit 0; `--planted <name>` at startup.

### The timing report: `frames` with `timings: true` (ms, finite numbers)

Each frame object that the call returns, beside `handoff_ms` and `ui_ms`, gains:

- `draw_ms`: the time from the start of `View::render` for the frame to the slot being ready to show (`View::wait_done` /
  `View::collect` having seen the done signal). It includes the encode, the submit and the wait; `handoff_ms` still starts at
  the GPU's done and is unchanged. The whole of a frame the view drew; a frame skipped for want of a free slot has no whole.
- `draw_parts_ms`: `{encode, submit, gpu, wait}`, each at or above 0. `encode`: the module's encodes on the pool. `submit`:
  the submits. `gpu`: the GPU's own time for the passes. `wait`: the wait for the done signal, beyond what the other parts
  already cover. The four are disjoint, and **on every frame their sum is within 5% of `draw_ms`** (`|sum − draw_ms| ≤
  0.05 × draw_ms`). The key set is exactly those four, in a real run; no other key.

The tests require both fields on every frame of a `timings: true` call (every frame is `drawn: true`), on the zero-copy and the
copy path, and that `handoff_ms` is still present. Without `timings` the fields may be absent.

### The one-pass fixture, `fixtures/parity/gpu/one-pass.scene` (#377's scene format, JSON)

1936 × 1584, `frames: 300`, one region `fill` of `rect: [0, 0, null, null]` and colour `[160, 90, 40, 255]` over a black
background, no `layers`, no `pipelines`. `test.scene@1` draws a scene's regions as its single `regions` pass, so this is one
full-screen pass and nothing else. The binary is given the scene by absolute path in the call (`scene`), as in #377; the
implementer needs no code for the scene beyond what the base reads. `surface-handoff.scene` is #377's own, copied here
unchanged so that this suite stands alone.

### Planted programs (`--planted <name>`, each reachable only there)

- `leaves_out_part`: the timing report omits one part, the frame's largest (a quarter of the whole at least), from
  `draw_parts_ms` (the key absent or 0), while `draw_ms` stays the true whole. AC1's check must then fail on every frame.
- `sleeps_in_encode`: the render module's encode on the pool sleeps 2 ms (at least) each frame. `draw_ms` and
  `draw_parts_ms.encode` hold it honestly: each frame's `encode` is at least 1.9 ms, `draw_ms` at least 2 ms, the parts still
  add up to the whole within 5%, and no other part grows by 1 ms or more over the plain run.

An unknown name is refused at startup (exit 2) as the base does.

### The report and the judge: `benchmarks/canvas.mjs`

- `node benchmarks/canvas.mjs draw-finish` (a new `workloads['draw-finish']`) builds release `deep-gpu`, plays the one-pass
  fixture on the zero-copy path with `timings: true` for 300 frames, one warm-up run and five runs, each a fresh process, and prints
  one last stdout line `{"task": "canvas-gpu-draw-finish", "fingerprint": {...fingerprint(), "build": {"profile": "release", ...}},
  "runs": [five × {"draw_finish_p95_ms", "parts_mean_ms": {"encode", "submit", "gpu", "wait"}, "loadStart", "loadEnd"}]}`.
  `draw_finish_p95_ms` is the p95 of `draw_ms` over every frame of the run; `parts_mean_ms` is each part's mean over the same frames;
  `loadStart` / `loadEnd` are the one-minute load at the run's start and end (as `runs()` in `canvas.mjs` takes them).
- `node benchmarks/canvas.mjs judge` takes `{current: <that report>, base}` and for `task: "canvas-gpu-draw-finish"` prints a verdict as
  it does for #854's tasks (`EFFICIENCY['canvas-gpu-draw-finish'] = {draw_finish_p95_ms: (r) => r.draw_finish_p95_ms}`): `status`,
  `targets.draw_finish_p95_ms` and `reason`. PASS only on a reference Mac (`references` in `scripts/benchmark.mjs`, mains, Low Power
  Mode off, thermal nominal) at a one-minute load below the cores, when all five runs are at most 0.5; FAIL when all five are over
  by more than the margin; otherwise INCONCLUSIVE; a build that isn't release is INVALID. The FAIL `reason` **names the part the
  time went to**: the part with the largest `parts_mean_ms` over the five runs (ties by `encode`, `submit`, `gpu`, `wait` order), as the
  word, e.g. `… over 0.5; the time went to encode`. Each of the four parts yields a different reason.
- **A load at the core count already reads INCONCLUSIVE** for this task: the issue says "at or above its cores", where
  `judgeLimit` today reads "above". Apply `>=` for this task (a change to `judgeLimit` for every task would move other suites).
- `benchmarks/budgets.json` task `canvas-gpu-draw-finish`: `command: ["node", "benchmarks/canvas.mjs", "draw-finish"]`,
  `targets: {"draw_finish_p95_ms": 0.5}`, `limits: {}`, `margin: 0.5`, `criteria: ["#3617.ff2c540d", "#3617.e5d2f1f1"]`, an
  `initialReason` naming #3617, accepted by `validateBudgets` against the merge base.

### The design's cost line

The GPU surface's `**Cost:**` line in `docs/canvas-primitives.md` is split on `;`. Each clause with a time in ms that is not an
estimate names a machine (`Mac17,10`, `M3 Pro`, `M5 Max` …) and a scene (the Map's 3D city, the one-pass fixture, the
surface-handoff fixture …); the copy path's `6.6 to 6.8 ms` stays; one clause gives the spike's `0.9 to 1.0 ms` for the one-pass slot
on the `Mac17,10`; and the line names the `draw-and-finish` time and its `0.5 ms` budget. The numbers after the change are the
implementer's, read on the reference Mac.

## Criteria to tests

| Criterion | File | What fails on a wrong program |
|---|---|---|
| `#3617.ac333e6b` parts add up; planted run names the frame | `ac1-parts.test.ts` | a report with no `draw_ms` / parts, parts off by more than 5%, a part-less planted run that isn't named per frame |
| `#3617.ff2c540d` one-pass under 0.5 ms at p95 | `ac2-onepass.test.ts` | a fixture that isn't one pass at 1936 × 1584; no report; a budget task missing or unlisted as timed; five runs over 0.5 ms on a reference Mac at rest (FAIL) |
| `#3617.55464991` a 2 ms sleep in encode is caught, naming the part | `ac3-planted.test.ts` | the sleep charged to another part or lost, parts not adding up, a judge that doesn't name the part |
| `#3617.00965c72` pixels byte-equal, fences clean | `ac4-pixels.test.ts` | a slot that differs from the scene's bytes on either path; a fence record with a slot drawn into while on screen or released early |
| `#3617.e5d2f1f1` INCONCLUSIVE off a reference Mac or under load | `ac5-inconclusive.test.ts` (and the live bench in AC2) | a pass or a fail off a reference Mac, at a load at the cores, with no load reading or from a debug build |
| scope: the cost line | `scope-design.test.ts` | a figure with no machine or scene; no draw-and-finish budget |

## Readings where the issue and design leave a choice

- **"Byte-equal before and after the change."** A blind job can't run the base's frames beside the change's. The base's slots are
  exactly the scene's bytes (#377 proves it, frame by frame, on both paths), so the suite compares each slot's SHA-256 with the
  bytes computed from the scene alone, on `surface-handoff.scene` (a marker that moves every frame, 600 frames) and on the one-pass
  fixture. A change that alters a pixel on either path fails; the PR's proof line may add the base's own hashes beside it.
- **"The fence record still audits clean"** is #377's audit (replayed per slot from `fences: true`, over the fixture's frames), here
  run with `timings: true`, so the new timing code runs in the frames compared. The slot count is read as at most 3.
- **"The timing check"** (AC3) is two things: the report's own arithmetic read by the suite (p95 of `draw_ms` over the limit, naming
  the part with the largest mean), and the lane's judge, whose FAIL reason names the part. A planted run reaches a failure on any machine: 2 ms is
  far over 0.5 ms, so no margin or machine can make it INCONCLUSIVE in the suite's own read.
- **"Over five runs of at least 300 frames on a reference Mac."** The runs are the bench's, judged by the lane (all five within the
  limit passes; all five over by more than the larger of 5% and the spread fails; otherwise INCONCLUSIVE). On a machine that isn't a
  reference Mac at rest the AC2 test records the readings, requires the verdict INCONCLUSIVE, and skips with the reading. That is
  the only skip; it is never a pass.
- **The parts.** The issue lists "the module's encodes on the pool, the submits, the GPU's own time for the passes, and the wait
  for the done signal". They are named `encode`, `submit`, `gpu`, `wait`. Because the GPU's time runs inside the wait for it, `wait`
  is what the wait adds beyond the GPU time, so that the four add up; an implementation may choose other disjoint cuts if it keeps these
  four names and the 5% sum.
- **"Brought down" (the largest part)** has no test of its own: its proof is AC2's number.
- **Not in this task:** the copy path's read back, the window's own composite, HDR output. The copy path is checked only for the
  report's shape and its pixels, never for a time.

## Blind redraft notes

None yet. Dispute AC wording through a blind redraft of this job, not by editing a test.
