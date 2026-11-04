# Blind redraft: #429.04be27ea, the two GPU-time tests

A fresh run of the acceptance-test job on a disputed test (design: Dogfooding), with the job's inputs and the
criterion, never the implementation. Nothing here has run: no build, no test, no type-check.

## Inputs used

- Issue #429's body, criterion `#429.04be27ea`: "Budgets, on the reference Mac in the local preflight, compared with the
  merge base: a composed operator checks and compiles in under 20 ms off the UI thread, its GPU time stays within its
  class (the data-view class up to 4 ms for a showpiece), and a composed operator in a core view is refused, and a still
  canvas dispatches no operator".
- At base `706f3525`: `docs/canvas-primitives.md` (Document envelope; Transport; Budgets by class; Operator budgets by
  class), `docs/technical-design.md` (GPU operator; Every task carries its own budgets), the original suite
  `tests/acceptance/429/` (README, `helpers.ts`, `budgets.test.ts`), `crates/deep-gpu-layer/src/live.rs` (how `live`
  maps a frame to a time), and `tests/acceptance/379/` and `421/` (how `live` reports passes and how a still scene
  behaves).

## The dispute holds

The two tests time 320 frames at 60 fps of `figure(..., { moving: true })` and require the tint's pass in every frame
from frame 21 on. That figure's only motion is the channel `slide`, keyed from 0 at `0s` to 1 at `4s`, in a document
whose `transport.span` is `4s` (`helpers.ts: sceneDoc`, `figure`). At the base, `live` shows frame k at
t = (k − 1) ÷ fps (`live.rs`: `fn t`), so frame 241 is t = 4 s and frames 242 to 320 (79 of the 300 timed frames) show
a figure in which nothing changes. The design says such a frame does no work:

- Budgets by class: "Every class draws nothing while still."
- Transport, Cost: "a still frame does no GPU work"; It can never: "Run while nothing changes".
- Document envelope: `transport.loop` defaults to `none`, so nothing restarts the slide at 4 s.
- The criterion itself: "a still canvas dispatches no operator".

#421's still test shows the same contract at the base surface: its moving control runs 60 frames inside its 2 s keys,
and its still scene must draw nothing once settled. A correct program therefore dispatches no tint from frame 242, and
the original tests fail it at "frame 242: the tint's pass is timed". They can only pass on a program that keeps
dispatching operators on a still canvas, which the same criterion forbids.

## The redraft

`budgets.test.ts` here holds only the two GPU-time tests and imports `../helpers.ts` unchanged. The figure now moves
through all 320 frames: the same slide, at the same rate (1 per 4 s), carried on to 1.5 at `6s`, with
`transport.span: 6s`, past the last frame's t = 319/60 s ≈ 5.32 s. The span is lengthened with the key so the reading
holds whether `live` ends motion at the last key or at the span's end. The 320 frames stay, as the original README's
reading ("each over 320 frames") and the dispute's scope ask, rather than cutting the window to the 4 s span.

| Test | Original | Redraft |
|---|---|---|
| data_view, 0.5 ms | `figure(..., { moving: true })`: slide 0 → 1 over `0s`–`4s`, span `4s`; frames 242–320 still | slide 0 → 1.5 over `0s`–`6s`, span `6s`; all 320 frames move |
| showpiece, 4 ms | the same figure | the same change |
| both | `liveCall` at its default 60 fps | `fps: 60` named in the call (the same value), so the 6 s bound is checked against it |

Unchanged in both: the reference-Mac gate and its display sizes (Mac15,7 3,456 × 2,234; Mac15,12 2,560 × 1,664), the
1,280 × 720 data view, the tint's `half` and `full` resolutions, 320 frames, timing from frame 21 on, the tint's pass
named in every timed frame, the session `live`, p95 per run, six runs with the first a warm-up, `judge` against 0.5 ms
and 4 ms.

## Wrong programs these still fail

- An operator over its class's limit: `judge` fails it (or reads INCONCLUSIVE under load), as before.
- A tint whose pass isn't dispatched or isn't named while the figure moves: the per-frame check fails, now on every
  timed frame, since every timed frame moves.
- A program that keeps dispatching on a still canvas passes these two but fails the original's still-canvas test.

## What stands

The other four tests of the original `budgets.test.ts` stand unchanged: check and compile under 20 ms off the UI
thread, the core view's refusal, the still canvas dispatching no operator from frame 4, and the perf lane's task in
`benchmarks/budgets.json`. The original two GPU-time tests are replaced by these two.
