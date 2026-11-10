# #545 criterion 5, redrafted blind: a seek that restores the checkpoint at step 60 blends as playing does

A blind redraft (design: Dogfooding) of both tests of criterion 5, `#545.fd1e802b`, in
`tests/acceptance/545/ac05-seek-blend.test.ts`. The criterion: "With a checkpoint every 60 steps, the 10 Hz item seeked
to 6.05 s draws x = 59.5 m, the blend of steps 59 and 60, as playing does; a planted seek that restores only the arrays
of the checkpoint at step 60 draws 60 m and fails, naming the time and both values."

**Written blind.** Written from the issue, its oracle page, the design and the base, at `933d6c952` (base `f38d2b398`
plus the first draft, `tests/acceptance/545/`), by a job that saw no implementation of #545, no diff, branch, PR or other
worktree, and not the first draft's `ac03-linear-writes.test.ts` or `ac05-seek-blend.test.ts`. The implementing agent
doesn't edit these files (AGENTS.md, Proof).

## What was read

- Issue #545 (`gh issue view 545 --repo windoliver/deepbuild --comments`): Scope ("each checkpoint also keeps the values
  every linear write held at the step before it"), Fields, criteria 3 and 5.
- The oracle page (`doneright/oracles/issues/545.md`, DeepBuildAI/deepbuild, branch `doneright`). Criterion 5 has no
  upstream test. For criterion 3's α it gives Bevy's overstep_fraction: at 6.05 s, k = 60 and α = 0.5.
- `docs/technical-design.md`: Interpolated writes, Turn clock, Logic bake and checks, Dogfooding.
  `docs/canvas-primitives.md`: Logic `logic@1`, Logic: interpolated writes, Logic: checkpoints and bake.
- The first draft's `README.md` (the surface: `view`, `frame` with `play` and `seek`, the frame's `draws`, `bake`, the
  planted twin `seek_restores_arrays_only`, and its reading of "the checkpoint at step 60"), `helpers.ts`, `programs.ts`,
  `tsconfig.json` and `wat/`; the `tests/acceptance/532/README.md` it defers to for `view`, `frame` and seeks.
- The base, read-only: `crates/deep-logic` (`lib.rs` `view`, `frame` and `bake`; `live.rs`, where a seek restores the
  nearest checkpoint at or before it when that is behind the playhead or nearer than stepping on; `world.rs`
  checkpoints, `seek`, `restore`).

## Run it

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/545-redraft-ac5 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/545-redraft-ac5/tsconfig.json
rm -rf tests/acceptance/545-redraft-ac5/node_modules
```

It imports `../545/helpers.ts` and `../545/programs.ts` as they stand. They build that suite's assembler (`../545/wat/`)
and `deep-logic` (`cargo build --locked --bin deep-logic`), and stop each `deep-logic` they start by its PID. No GPU or
deep-show is needed. **`scripts/lanes.mjs` needs `'tests/acceptance/545-redraft-ac5/'` in its `alone` list**: it builds
a cargo binary and drives a long-lived process frame by frame. The implementer makes that edit.

## The tests

The program is the first draft's `mover`: 10 Hz, its step k writes [k, 0, 0] into the vec3 `pos`, declared linear, with
`checkpoint: {every: 60}`.

**(a)** In order:

1. **Bake.** A bake of 121 steps takes the mover's checkpoint at step 60, and steps 59 and 60 store [[59, 0, 0]] and
   [[60, 0, 0]], the two values the blend joins.
2. **View.** One view, span 12 s:
   - Played straight by `play: 1/60` from 0 s, 660 frames to 11 s, each landing at i × 11,760,000 flicks. Frame 363 is
     6.05 s, 4,268,880,000 flicks.
   - Then sought back to 6.05 s, to 0.5 s, and on to 6.05 s.
3. **Judgement.**
   - Playing draws `mover.pos` [[59.5, 0, 0]] at 6.05 s.
   - Each seek to 6.05 s draws the same, with playing's full-state hash there, and runs at most one step from its act to
     landing.
   - The seek back (from 11 s) and the seek on (from 0.5 s) each restore the checkpoint at step 60, the nearest at or
     before 6.05 s, as #532's view seeks do.

It fails on:
- a checkpoint restored without what drawing needs to blend after it;
- a seek that draws differently from play;
- a seek that replays from an earlier checkpoint instead of restoring the one at step 60.

**(b)** The same view and acts:
- First the real `deep-logic`. The judgement must find nothing.
- Then `deep-logic --planted seek_restores_arrays_only`. The judgement must fail it, and one failure must name
  `at 6.05 s`, the drawn `x = 60 m` and playing's `x = 59.5 m`.

## Readings where the criterion leaves a choice

- **"Seeked"**: the view sought to 6.05 s after play has passed it, back from 11 s and on from 0.5 s. Both seeks restore
  the checkpoint at step 60, and the frame's `steps` (at most 1) shows it. A fresh view sought to 6.05 s is not used,
  since its ring holds no checkpoint at step 60 yet.
- **"As playing does"**: the same draw and the same full-state hash as the played frame at 6.05 s.
- **"Names the time and both values"**: one failure holds the time (6.05 s), what the twin drew (60 m) and what
  playing drew (59.5 m).

## A note for whoever reads the dispute

Under #531's convention, the first draft's README keeps on a fixed clock: the checkpoint at step 60 is taken before
step 60 runs and holds step 59's arrays. A seek to 6.05 s restores it and then runs step 60. So a restore that keeps
only the arrays still has step 59's value from the arrays as they stood before step 60, and naturally draws 59.5 m at
6.05 s. The twin draws 60 m there only because the first draft's README defines it to.

The case that needs the checkpoint's kept values under that convention is a seek that lands before step 60 runs, such
as 5.95 s: 58.5 m, step 58's value blended toward step 59's. The criterion doesn't name that case, so no test here
asserts it.

## BASE-FAILURE.txt

The run at HEAD `933d6c952`. Both tests fail on the missing `play`: the playhead stays at 0 s, and frames have no
`draws`. In (a), the bake leg passed at the base before the view started. The view legs the base has were checked once
by a throwaway probe, since deleted, that stood in seeks for `play` frame by frame:
- 660 frames of 1/60 s land on i × 11,760,000 flicks;
- the seek back from 11 s to 6.05 s and the seek on from 0.5 s each ran 1 step, with the full-state hash of the state
  reached frame by frame.
