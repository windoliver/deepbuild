# Blind tests for #2239's fourth criterion, rewritten, and its seventh, added

Issue #2239 was amended on November 19, 2026, after #191 gave a body with `ccd` on its contact prediction: criterion 4
was rewritten (`#2239.fdc08cd1` became `#2239.9cc14721`) and criterion 7 (`#2239.2136cd3f`) was added. These are the
tests of those two, written first and blind from the amended issue, the design and base commit `9d0256132`, by a job
that never saw an implementation, a diff of one, or the first draft's test of the old fourth criterion. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft (design: Dogfooding).
Criteria 1, 2, 3, 5 and 6 stay with `tests/acceptance/2239/`.

| File | Criterion | Tests |
|---|---|---|
| `ac4-fast-ball-resting-ball.test.ts` | `#2239.9cc14721` | 3 |
| `ac7-turning-bar-resting-ball.test.ts` | `#2239.2136cd3f` | 3 |
| `helpers.ts` | what `../2239/helpers.ts` (imported read only) doesn't give | |
| `twins.json` | each of the two IDs to its planted program | |
| `BASE-FAILURE.txt` | each file run once at the base: 5 tests fail, 1 passes, as it should | |

## What was read

- The job's brief; the issue as amended (title, state, body) and its one comment. Both IDs are computed here from the
  body with `scripts/proof-change.mjs`'s rule, and match.
- `docs/canvas-primitives.md`: World and backend `physics.world@1`, Body `body@1`, Physics: behavior kit.
  `docs/technical-design.md`: The physics module (World; Shape, body, contact material, collision group; Bake and
  golden; Behavior kit). Neither names the lint; the design's words on `ccd` are the body's `ccd: bool = false` and the
  world's `solver.ccd`. AGENTS.md, and CONTRIBUTING.md's line on public text.
- At the base, for surfaces and form only: `tests/acceptance/2239/` (README, `helpers.ts`, `ac2`, `ac3`, `ac5`,
  `twins.json`, `tsconfig.json`); `tests/acceptance/191/helpers.ts`, which that one imports; `2309/BASE-FAILURE.txt`,
  `503-redraft-ac4/` (README, `tsconfig.json`) and `2306/` (`twins.json`, its README's lines on it);
  `crates/deep-canvas-physics/src/fast.rs`; `crates/deep-physics-rapier/src/` `main.rs`, `planted.rs`, `runner.rs` (a
  bake's states and issues) and `lib.rs` (where a body's `ccd` reaches the backend); `scripts/proof-change.mjs`,
  `scripts/proof-runs.mjs`, `scripts/lanes.mjs` (its `alone` list); the root `tsconfig.json`.
- The pinned backend's source, rapier3d 0.36.1: `src/dynamics/ccd/ccd_solver.rs` and `sweeps.rs`,
  `src/dynamics/rigid_body_components.rs`, `src/geometry/narrow_phase/pair_update.rs`, `src/geometry/collider.rs`.

The first draft's README, which this job was told to read, describes its test of the old fourth criterion in its
tables. That test file is not in the checkout and was not looked for. Nothing else was read.

## The surface under test

The first draft's, unchanged: `deep-physics` bakes, the lint's issues in a bake's `issues`, `--planted <name>`.

| Name | Whose | For the implementer |
|---|---|---|
| **`deep-physics --planted lint_reads_sweep_alone`** | *ours*: the one new name | build it (below) |
| `deep-physics --planted lint_one_body_at_a_time` | the first draft's name; "reads one body at a time" is the issue's | now criterion 7's: it runs over the bar and the ball |
| `{"call": "bake", "world": World, "steps": 12}` → `ok`, `issues`, `bodies.<ID>[k].pos` and `.linear` | the base's, as the first draft reads it | nothing new |
| `bodies.bar[k].rot`, a quaternion `[x, y, z, w]` | the base's bake already writes it; new to this suite's reading | nothing new |
| an issue's `code: "physics.fast_body"`, `kind: "pair"`, `ids`, `step`, `fix` | `pair` and `physics.fast_body` the issue's; `kind` as a field the first draft's | as the first draft |
| a fix that names `ccd`, the ball's ID and `off` or `false` | the first draft's tokens for the issue's "turn `ccd` off on" | as the first draft |

Body IDs are this suite's worlds' own: `moving`, `resting`, `bar`, `ball`.

Each planted program is `deep-physics --planted <name>` on the shipped build, exits 0 and answers every call.

- **`lint_reads_sweep_alone`** (criterion 4): the lint reads the backend's sweep alone, without the contact prediction
  of a body with `ccd` on. For the shot with `ccd: true` on both balls, each of the ten starts' bakes holds a
  `physics.fast_body` issue with `kind: "pair"` whose `ids` hold `moving` and `resting`.
- **`lint_one_body_at_a_time`** (criterion 7): the lint reads one body at a time. For the bar and the ball with
  `ccd: true` on both, no start's bake holds a `physics.fast_body` issue.

## The worlds

Both at 120 Hz and 4 substeps, every body dynamic with `gravity_scale: 0`, one contact material of friction 0.5,
density 1,000 kg/m³ and restitution 0. Each bake is 12 steps, a tenth of a second. `ccd` off is `ccd: false` written.

- **The shot** (criterion 4), the first draft's `shotWorld`: `moving`, a sphere of radius 0.05 m at 100 m/s along +x
  with `ccd: true`, and `resting`, the same sphere at the origin. Start 0 puts `moving` three steps and one radius
  before `resting`'s centre, at x = −2.55 m; start j is j tenths of a step, j × 0.0833 m, farther back. Left alone,
  `moving` flies 10 m in the run.
- **The bar and the ball** (criterion 7): `bar`, criterion 3's bar (a box of half extents (1, 0.01, 0.01) m at the
  origin, turning about z at 720°/s, 6° a step, with no linear velocity) with `ccd: true`; and `ball`, a sphere of
  radius 0.02 m at rest in the plane of the turn, its centre 0.95 m from the bar's centre. In start j the ball is
  15° + j × 0.6° ahead of the bar's +x arm, in the direction of the turn. Left alone, the bar turns 72° in the run.

## How a struck ball is told from one left at rest

A ball **left at rest** is within a micron of where it was built and slower than a micron a second at the end of every
step of the run (the first draft's bound for criterion 1). A **struck** ball isn't: at the end of some step it is off
that spot or moving. `helpers.ts`'s `struckStep` gives that first step, or −1.

## Criteria to tests

| File | Test | What fails it | Wrong program |
|---|---|---|---|
| `ac4` | `ccd` off on the resting ball | `moving`'s centre past `resting`'s at the end of a step in any start; `resting` left at rest in any start, so never reached; any `physics.fast_body` issue in any start | the base: it flags the struck ball |
| | `ccd: true` on both | the same three, for the second world | `lint_reads_sweep_alone`; passes at the base, as it should |
| | planted `lint_reads_sweep_alone` | the planted program not running; any start of the second world without an issue of kind `pair` whose `ids` hold both balls; the judge of the test above not failing in every start with a sentence naming `moving` and `resting` | the base lacks the name |
| `ac7` | `ccd` off on the ball | the ball left at rest in any start; any `physics.fast_body` issue in any start | the base: it flags the struck ball |
| | `ccd: true` on both | no start in which the ball is left at rest and the bar turns clear past it; the bar's turn unread (`INCONCLUSIVE:`); any start's bake not holding exactly one `physics.fast_body` issue, of kind `pair`, naming `bar` and `ball`, a step of the run, with a fix naming `ccd`, `ball` and `off` or `false` | the base: it raises nothing |
| | planted `lint_one_body_at_a_time` | the planted program not running; it raising any issue in any start; the judge of the test above not failing in every start | the base lacks the name |

Each start's outcome is printed, and listed in the failure message of the four tests that count over starts. A bake
whose reply lists no issues is `INCONCLUSIVE:`, a failure. No test times anything.

## Readings where the issue leaves a choice

- **Starts.** Each later start begins a tenth of a step farther back, as the first draft's do. For the bar that is a
  tenth of a step's turn: the bar is built as criterion 3 builds it and the ball is placed 0.6° farther ahead, the same
  layout as turning the bar's start back.
- **"Never passes"** (criterion 4) is the first draft's: at the end of no step is `moving`'s centre past `resting`'s
  along x. So that it isn't vacuous, `resting` must also be struck in every start.
- **"The bar passes it"**: at the end of some step the bar has turned past the ball's bearing by more than
  asin(0.03 ÷ 0.95) = 1.81°, so its trailing face is clear of the ball's far side, as the first draft reads "after the
  box has passed it". Counted only with the ball left at rest over the whole run.
- **Counts** are the issue's: never in any start, in every start, in at least one start. The issue's "five starts of
  ten" is its opening's, not the criterion's, and is not asserted.
- **The lint's clauses** are asserted in each of the ten starts, as the first draft does. "Raises nothing" is a bake
  with no `physics.fast_body` issue at all; "raises one issue of kind `pair`" is a bake with exactly one, of that kind.
- **"Raises an issue of kind `pair`"** (criterion 4's planted lint) is at least one such issue in each start; its
  step, its fix and how many it raises are not held.
- **"Fails, naming both balls"**: the judge's sentence holds both IDs, taken from the issue's `ids`. The starts'
  labels hold neither ID.

## Where the issue pulls two ways

1. After a held hit the struck ball has `ccd` off and is fast (in the shot, two equal balls of restitution 0 go on at
   50 m/s, 0.417 m a step against a half extent of 0.05 m). #191's rule for one body flags it, as the base does, and
   Scope's second `pair` case read alone would flag the two after the hit. Both criteria say the lint raises nothing
   for that world, and the tests hold the whole bake to it. The first draft recorded this for criteria 2 and 4; the
   amendment keeps the sentence.
2. In criterion 7's second world, where the bar happens to strike the ball anyway, the ball is fast afterwards with
   `ccd` on beside a bar fast by its turn, which Scope's second case (a fix naming `step_rate`) could also be read to
   cover. The criterion says one issue whose fix turns `ccd` off on the ball, so each start is held to exactly one:
   a pair has one issue, for the case at the first step it is flagged.
3. Criterion 4's "since a body with `ccd` on predicts its contacts along its own move" is a reason. The tests assert
   what it leads to, not the mechanism.

Not asserted, because neither criterion says so: the data in `caps()`; a `pair` issue's step beyond being a step of
the run, its severity, or a move on it; how many starts pass; where or how fast a struck ball ends.

## Run them

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2239-redraft-ac4 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2239-redraft-ac4/tsconfig.json   # type-check
rm -rf tests/acceptance/2239-redraft-ac4/node_modules tests/acceptance/2239/node_modules  # vitest's caches
```

Each file asks cargo for #191's release build of `deep-physics` once, as the first draft's files do. Every test passes
#191's 60-minute timeout and each file's build hook its 4 hours.

## What the implementer adds outside this folder

- `lint_reads_sweep_alone` among `deep-physics`'s planted names, and `lint_one_body_at_a_time` over the bar and the
  ball; the lint's rules as the amended issue states them.
- `'tests/acceptance/2239-redraft-ac4/'` in `scripts/lanes.mjs`'s `alone` list, since the files build a cargo binary.

Nothing in this folder or in `tests/acceptance/2239/` changes.
