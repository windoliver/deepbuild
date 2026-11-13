# #545 criterion 3, redrafted blind: a linear write draws one step late, and only drawing reads the blend

A blind redraft (design: Dogfooding) of the first two tests of criterion 3, `#545.10859a3c`, in
`tests/acceptance/545/ac03-linear-writes.test.ts`:

- (a) "the 10 Hz item's linear vec3 draws 0.5 m at 0.15 s and 0 m at 0.1 s played and seeked, held it draws 1 m; a reader
  reads whole metres; step and full-state hashes are equal either way"
- (b) "a planted blend toward the next step (linear_blends_forward) draws 1.5 m at 0.15 s and fails, naming the time and
  both values"

The first draft's other tests of criterion 3 (the i32 and bool refusal, the issue comment's f64, vec2 and quat) stand.

**Written blind.** Written from the issue, its oracle page, the design and the base, at `933d6c952` (base `f38d2b398`
plus the first draft, `tests/acceptance/545/`), by a job that saw no implementation of #545, no diff, branch, PR or other
worktree, and not the first draft's `ac03-linear-writes.test.ts` or `ac05-seek-blend.test.ts`. The implementing agent
doesn't edit these files (AGENTS.md, Proof).

## What was read

- Issue #545 (`gh issue view 545 --repo windoliver/deepbuild --comments`): Scope, Fields, criterion 3, and its one comment.
- The oracle page (`doneright/oracles/issues/545.md`, DeepBuildAI/deepbuild, branch `doneright`): Bevy `12a94e0cd6`
  `crates/bevy_time/src/fixed.rs`, `Time<Fixed>`'s overstep_fraction, 0.5 halfway through a step. Used as the formula for
  α = (t − t(k)) ÷ the step length: at 0.15 s, k = 1 and α = 0.5; at 0.1 s, k = 1 and α = 0.
- `docs/technical-design.md`: Interpolated writes, Turn clock, Logic bake and checks, Dogfooding.
  `docs/canvas-primitives.md`: Logic `logic@1`, Logic: interpolated writes, Logic: checkpoints and bake.
- The first draft's `README.md` (the surface: `view`, `frame` with `play` and `seek`, the frame's `draws`, `bake`, the
  planted twin `linear_blends_forward`), `helpers.ts`, `programs.ts`, `tsconfig.json` and `wat/`; the
  `tests/acceptance/532/README.md` it defers to for `view` and `frame`.
- The base, read-only: `crates/deep-logic` (`lib.rs` `view`, `frame` and `bake`; `live.rs`; `world.rs` `run`, checkpoints,
  `seek`, `restore`; `piece.rs` types and writes).

## Run it

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/545-redraft-ac3 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/545-redraft-ac3/tsconfig.json
rm -rf tests/acceptance/545-redraft-ac3/node_modules
```

It imports `../545/helpers.ts` and `../545/programs.ts` as they stand. They build that suite's assembler (`../545/wat/`)
and `deep-logic` (`cargo build --locked --bin deep-logic`), and stop each `deep-logic` they start by its PID. No GPU or
deep-show is needed. **`scripts/lanes.mjs` needs `'tests/acceptance/545-redraft-ac3/'` in its `alone` list**: it builds
a cargo binary and drives long-lived processes frame by frame. The implementer makes that edit.

## The tests

The programs are the first draft's: `mover`, 10 Hz, whose step k writes [k, 0, 0] into the vec3 `pos`, and `reader`, 60 Hz,
which reads `mover.pos` and stores it in its own vec3 `seen`.

**(a)** In order:

1. **Bake.** The mover and the reader are baked for 72 steps each, once with `pos` linear and once with hold. With linear:
   - every step stores `mover.pos` = [[k, 0, 0]];
   - reader step j (at j/60 s) stores a whole metre the mover stored: step ⌊j/6⌋'s, or, at a time both items step,
     the step before's. At j = 9 (0.15 s) that is 1 m.
   - Each item's step records (number, step hash, arrays) and checkpoints (with full-state hashes, at least the ones at
     0 and 60) are equal with linear and with hold.
2. **Views.** Each view holds the mover alone.
   - Played straight: one view moved on by `play: 1/60` 60 times, from 0 s to 1 s. Each frame lands at i × 11,760,000
     flicks.
   - Seeked: the same view sought back to 0.15 s, back to 0.1 s and on to 0.15 s; and two fresh views, one sought to
     0.15 s and one to 0.1 s.
   - With linear, `draws["mover.pos"]` is [[0.5, 0, 0]] at 0.15 s and [[0, 0, 0]] at 0.1 s by every route. With hold it
     is [[1, 0, 0]] at 0.15 s by every route.
   - The mover's full-state hash (`deep_hash`) is the same with linear and hold at every frame.

It fails on:
- no blend;
- a blend from the wrong step or by the wrong α;
- a seek that blends differently from play;
- a blend that reaches the stored arrays, the bake, a reader, a step hash or a full-state hash;
- a hold that draws a step late.

**(b)** The same views, with linear only:
- First the real `deep-logic`. Criterion 3's judgement (0.5 m at 0.15 s, 0 m at 0.1 s, by every route) must find nothing.
- Then `deep-logic --planted linear_blends_forward`. The judgement must fail it, and one failure must name `at 0.15 s`,
  the drawn `x = 1.5 m` and the due `x = 0.5 m`.

## Readings where the criterion leaves a choice

- **"Played straight and seeked alike"**:
  - Played is live play by `play`, one 60 fps frame at a time, never sought.
  - Seeked is the played view sought back and forth after play has passed both times, and a fresh view sought once.
- **"Another logic item … reads only whole metres, the values the steps stored"**:
  - The reader steps at 60 Hz, so most of its steps fall between the mover's. A blend would show there, as 0.5 m at its
    step 9.
  - At a time both items step, the order inside the step is not this criterion's, so either the step before's value or
    that step's own is accepted.
  - The reader is checked in a bake, not a view. The base view counts steps by the first item's rate, so it can't step
    two rates by time.
- **"Full-state and step hashes are equal"**: the bake's step hashes and checkpoint `deep_hash`, and each frame's
  `deep_hash`.
- **"Names the time and both values"**: one failure holds the time (0.15 s), what the twin drew (1.5 m) and what is
  due (0.5 m).

## BASE-FAILURE.txt

The run at HEAD `933d6c952`. Both tests fail on the missing `play`: the playhead stays at 0 s, and frames have no
`draws`. In (a), the bake leg passed at the base before the views started. The view legs the base has were checked
once by a throwaway probe, since deleted, that stood in seeks for `play`:
- 660 frames of 1/60 s land on i × 11,760,000 flicks;
- 0.15 s and 0.1 s land on 105,840,000 and 70,560,000 flicks;
- the mover's full-state hashes there are equal with linear and hold.
