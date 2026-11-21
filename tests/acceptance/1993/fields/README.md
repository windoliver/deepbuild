# Acceptance tests for #1993, part "fields": the cloth in three fields, 4,096 points under softened gravity, and the taste call

Written first, from issue #1993 (its scope, fields, 8 acceptance criteria, proof line and its one comment), its Oracle
page (no upstream test checks any criterion) and base commit `9550dc0f`, by a job that never saw an implementation.
This is one of three parts of the suite, written apart and merged side by side under `tests/acceptance/1993/`; this
part holds criteria 5, 6 and 8 and imports nothing outside its folder. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one file per criterion,
each with the wrong program its criterion names.

## What was read

- Issue #1993 and its Oracle page.
- `docs/canvas-primitives.md`: Carried state; Checkpoint ring; GPU operator; Step and the closed step list and its
  structural steps; Operator input; Operator output; Operator cost and limits; Determinism class; Operator budgets by
  class. `docs/technical-design.md`: GPU operator; Cut, or deferred; Who drafts it and Proven on the base; Every task
  carries its own budgets and The reference Macs; Criteria to tests and Wrong programs; Dogfooding. Neither document
  describes `stepped`, `carry` or a frame's `carried`: those are read from #252's suite and the base's code.
- At the base: `tests/acceptance/252/` (the model: README, helpers and its four tests), `483/budgets.test.ts` and
  `483/mips.test.ts` (GPU timings; texture outputs, `store@1`, `load@1`), `1551/helpers.ts` and `1929/helpers.ts`
  (the reference-Mac list; cargo's path); `crates/deep-canvas-effects/src/{graph,graph/read,check,check/inner,table}.rs`,
  `crates/deep-canvas/src/steps.rs` (the op table), `crates/deep-effects-render/src/{docops,docops/methods}.rs`,
  `crates/deep-gpu-layer/src/{main,view3d,view3d/parse}.rs`; `scripts/{proof-change,proof-runs,lanes}.mjs`.
- The base's binary, run while drafting: every fixture's operators through `check_operator`, and the cloth and the
  points played through `view3d` (they run at the base; see "What the base already does").

## What the base already does, which these tests don't credit

At `9550dc0f` a stepped compute operator already carries several storage outputs: each `carry` output has a ring of
its own (its own spacing and thinning), a `step: previous` read binds each one's last state, and a seek restores the
newest checkpoint every ring holds, or steps from 0. So a document may already hold a cloth or 4,096 points in several
carried outputs, step them and seek them consistently. What it lacks, of what this part tests:

- **Fields checkpointed together.** The three rings thin apart when the fields differ in size: with the cloth's
  ring, `position` and `previous` hold checkpoints 0, 120, 240, 360 from step 360 while `pinned` holds every 60.
- **Carried textures.** A texture output's `carry`, a texture input's `step: previous` and `stepped.bound` are read
  past by the check, and a stepped operator that writes a texture doesn't run (its fallback draws; its frames carry
  no `carried` row).

The limits the fixtures fit, all the base's: a compute operator reads at most 8 values an element (so a cloth pass
pairs a point with one neighbour, and a pull pairs a point with three others), binds at most 8 storage buffers (so
the six pulls are summed in an operator of their own), runs at most 1,048,576 elements a dispatch, writes storage only
at its own element's slots (or with integer atomic adds), and holds scalars only in storage.

## Run them

They build `deep-gpu`, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs
`'tests/acceptance/1993/'` in its `alone` list, as `'tests/acceptance/252/'` is. This README is the instruction; the
implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1993/fields --no-file-parallelism
npx tsc -p tests/acceptance/1993/fields/tsconfig.json   # type-check
```

Each file builds its binary once with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
deep-gpu`, copies it out of `target/debug` to a temporary folder and fails each test that uses it if the build failed.
Each test writes into its own temporary folder and deletes it.

- Anything the GPU runs runs on Metal: off macOS a test fails with a message starting `INCONCLUSIVE:`, never passing.
- The one timed test (`bodies.test.ts`, GPU time a step) runs only on a reference Mac (Mac15,7, Mac15,12 or Mac17,10,
  by `hw.model`; power and Low Power Mode not gated, as #252's and #483's budgets aren't) and through the design's
  judge; a miss on a machine whose one-minute load is over 1 a core reads INCONCLUSIVE, never FAIL or PASS. It reads
  the dev binary.
- `taste.test.ts` keeps its three screenshots and three recordings in `DEEPBUILD_EVIDENCE_DIR` (else
  `$TMPDIR/deep-1993-taste`) and reads your taste call from the file `DEEPBUILD_TASTE_1993` names; without it the test
  fails as `INCONCLUSIVE:`.
- `BASE-FAILURE.txt` holds what was run at the base and each test's result there.

## The surface under test

**No new binary, call, flag or planted name.** #377's `deep-gpu run` with its JSON-lines protocol, #429's
`check_operator`, #378's `view3d` with #380's `from` and `timings`, #483's `read`, #484's `seeks` and #252's stepped
operators and `carried`, each as the base's suites use it. What the implementer has to provide, in the exact forms
these tests write and read:

### Fields of one stepped operator, checkpointed together (criterion 5; no new document field)

| What | Form these tests write or read | Why it's the least |
|---|---|---|
| Several carried storage outputs on one stepped operator | `outputs: {position: {storage: {type: "f32", count: 12288}, carry: {every: 60, budget: 294912}}, previous: {storage: {type: "f32", count: 12288}, carry: {…same}}, pinned: {storage: {type: "u32", count: 4096}, carry: {…same}}}` on `cloth` (`elements: 4096`, `stepped: {rate: 600}`) | The base's own storage outputs; Scope: "named storage fields of one element count on one stepped operator, each with its own type" |
| Each read as the previous step left it | `inputs: {pos: {type: "f32", count: 12288, from: {storage: {op: "cloth", output: "position", step: "previous"}}}, …}` | #252's form, unchanged |
| **Checkpointed together** | On every frame the three rows `frames[].carried["cloth.position" \| "cloth.previous" \| "cloth.pinned"]` report the same `step` and the same `ring.checkpoints`; on the seek's frame each has the same `restored: {from, steps}` with `from + steps` the step sought | Scope: "carried and checkpointed together, so a seek never restores fields from two different steps". Nothing is asserted of `ring.bytes` or `ring.budget` (see Readings) |
| The fields read back | `read: ["cloth.position", "cloth.previous", "cloth.pinned"]` on `view3d`: `frames[].read[key].file`, the SHA-256 naming `<sha>.u32` under `out`, little-endian 32-bit words | #483's `read`, unchanged |

Criterion 6 needs nothing the base lacks: two carried storage outputs (`bodies.position`, `bodies.velocity`, f32 ×
8,192), `step: previous` reads, a plain storage read of scratch storage written earlier in the step, `{time: "step"}`,
and with `timings: true` a frame's `passes_ms["op.<operator id>"]` for the stepped operators (the tests sum the keys of
the step's nine operators that a frame reports; the base reports a whole step under its first operator's, `op.bodies_move`).

### Carried textures (criterion 8's ring and pattern documents)

| Field | Form these tests write | From |
|---|---|---|
| `outputs.<name>.carry` on a `texture` output of a stepped operator | `{texture: {format: "r32float", size: [128, 128]}, carry: {every: 60, budget: 16777216}}` (`water.height`, `water.rate`); `{texture: {format: "r32float", size: [1024, 1024]}, carry: {…same}}` (`pattern_a.a`, `pattern_b.b`) | Fields, as the issue spells it |
| `inputs.<name>.from.texture: {op, output, step: previous}` | `{type: "texture", from: {texture: {op: "water", output: "height", step: "previous"}}}`; an operator reads its own and another stepped operator's (`pattern_a` reads `pattern_b.b`), zeros before step 0; read with `load@1`, the value in the texel's first lane; written with `store@1` | Fields, as the issue spells it |
| `stepped.bound` | `stepped: {rate: 60, bound: {speed: 0.24, cell: 0.01}}` on `water` (`max` left at its 0.5; the ratio is 0.4) | Fields |
| A pass reads the grid | `{type: "texture", from: {texture: {target: {op: "water", output: "height"}}}}` in a pass, read with `load@1`, as the frame's latest step left it | Scope: "Passes and materials after it read the grid with `load`"; #483's input form |
| A carried texture's row on a frame | `frames[].carried["water.height"]`, `["water.rate"]`, `["pattern_a.a"]`, `["pattern_b.b"]`: `{step, ring: {bytes, budget, checkpoints: [step]}}`, as a carried storage output's | #252's reply field, for a carried texture |

`taste.test.ts` reads the taste call from the file `DEEPBUILD_TASTE_1993` names: `{"criterion": "#1993.c2ad7c76",
"by": "you", "screenshots": [sha256 × 3], "recordings": [sha256 × 3], "call": "looks_right" | "looks_wrong"}`, as
#252's does from `DEEPBUILD_TASTE_252`.

### Planted programs

Each of this part's wrong programs is a wrong step, written as operator data by the test, so none lives in the binary
and no `--planted` name is added:

| Name (helpers.ts) | The wrong step | Criterion |
|---|---|---|
| `clothOps({ignoresPinned: true})` | The cloth's operators never read the `pinned` field to hold a point: `cloth_move` moves every point and `cloth` keeps every moved position | `#1993.9b40f0f2` |
| `bodiesOps({othersThisStep: true})` | The pulls read the other points' positions from `bodies_move.moved`, which this step already wrote, in place of `bodies.position` as the previous step left it | `#1993.7a269d05` |

## The fixtures (helpers.ts)

Every document is a showpiece scene, 65 s long: a camera, a box the passes draw over, and the operators, each
declaring the cost the check estimates for it. The look is #252's (`fixtures/look.json`, its ID changed).

- **The cloth**: 64 × 64 points, an edge 0.1 m at rest (6.3 m a side), 600 steps a second, gravity 9.81 m/s². Three
  fields on `cloth`: `position` and `previous` (x, y, z of each point, 3 f32 words a point) and `pinned` (one u32 a
  point). A step is ten stepped operators: `cloth_move` (each free point moves by its last step's movement and
  falls g ÷ rate²), `cloth_pass1` … `cloth_pass8` (the 8 constraint passes: each takes the edges of one colour, even
  columns, even rows, odd columns, odd rows, twice over, and moves each edge's two points to one rest length apart,
  a pinned point not at all) and `cloth` (keeps the three fields; a pinned point's position is the one it had). Step
  0 writes the start: flat, swung 0.5 rad out of the hanging plane about its top row, twisted 0.17 rad across its
  width, at rest, the top row pinned. `cloth_flat`, `cloth_cover` and `cloth_view` show it each frame, woven in a
  check of 8 × 8 quads.
- **The points**: 4,096 of equal mass in a plane, 60 steps a second, G × the disc's mass 1, softening 0.05 (Plummer's:
  the pull of j on i is G m d ÷ (|d|² + ε²)^1.5). Two fields on `bodies`: `position` and `velocity` (x, y of each
  point). A step is nine stepped operators: `bodies_move` (x + v ÷ rate), `pull0` … `pull5` (each element a point and
  three others, every point meeting each of the 4,095 others once; the three pulls are added in fixed point, 2²² to
  an acceleration of 1, with integer atomic adds), `pull_sum` and `bodies` (keeps the moved position, adds the summed
  pull ÷ rate to the velocity). Step 0 places them in a disc of radius 1 turning about its centre, from hashes of
  their index.
- **The ring** (the taste call's): criterion 1's grid, 128 × 128 cells of 1 cm at 60 steps a second and 0.24 m/s, as
  height and rate of change in two carried textures of `water`; step 0 is a drop of height 1 and σ 2 cells at the
  centre. The same arithmetic on the CPU puts the crest 20.5, 40.5 and 60.5 cells out at steps 50, 100 and 150.
- **The pattern** (the taste call's): criterion 4's two 1,024 × 1,024 `r32float` textures at 600 steps a second, a
  Gray–Scott pair (feed 0.037, kill 0.06) on a torus, each texture stepped by an operator of its own, seeded in 6 × 6
  squares in about one 16 × 16 block of a hundred. The same arithmetic on the CPU grows a labyrinth over about 60% of
  the grid in 6,000 steps.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), computed from `issue-1993-body.md`. Each test's name starts with its ID.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `#1993.9b40f0f2` | 5: the cloth in three fields | `cloth.test.ts`, one test. Played 600 steps at one frame a step and seeked back to 300: step 0 is the stated start and the fields step (`previous` at k is `position` at k − 1, by hash; the cloth comes down); every pinned point's position at every step is its first, bit for bit (0 m); the longest of the 8,064 edges is at most 0.11 m at every step; on every frame the three fields report one step and the same checkpoints, and the seek restores all three from one; the seek's three hashes are the play's at step 300. Then the planted `ignoresPinned` cloth: every top-row point ends lower than it started, and the 0 m line fails on it with "pinned point 0 (row 0, column 0) moved … m by step 1, not 0 m" |
| `#1993.7a269d05` | 6: momentum, and GPU time a step | `bodies.test.ts`, two tests. (1) Played 1,000 steps: at steps 1, 250, 500, 750 and 1,000 the fields are 8,192 finite words, the points move, and total momentum is within 1e-5 × the summed momentum magnitudes of step 0's; then the planted `othersThisStep` points fail that line with "at step … total momentum has drifted … of the summed momentum magnitudes (…), past 0.00001". (2) On a reference Mac, six runs of 1,000 steps with `timings`, the first a warm-up: each run's 95th-percentile step GPU ms, judged against 2 ms; INCONCLUSIVE off a reference Mac or when the five disagree |
| `#1993.c2ad7c76` | 8: taste | `taste.test.ts`, one test: the three documents check; each screenshot's frame reports its carried outputs at the step named (ring 100, pattern 6,000, cloth 600); each recording holds its frames, not all one picture; INCONCLUSIVE until your call is recorded on these three screenshots and three recordings |

The right program and its planted one share a test, so the planted run is judged by the same line, in the same run,
as the right one passes.

## Readings where the issue and design leave a choice

- **A field** is a carried storage output of the base's kind: scalars, `{type, count}` with `count` in words. "Of one
  element count" is read as the one stepped operator's element count (`elements: 4096`, a point): a field of vectors
  holds 3 words an element, as #252's flock holds 3 a boid, so `position` and `previous` are 12,288 f32 words and
  `pinned` 4,096 u32 words. Read as "one `count`", the criterion's three fields (a position and a flag) could not be
  held in the base's scalar storage; a vector storage type would be a new surface the issue's Fields don't name.
- **"Carried and checkpointed together"** is read off the rows the base already reports: one step and one list of
  checkpoints for the three fields on every frame. Each field declares the same `carry`. How three declarations make
  one ring's budget (the same number, or their sum) the issue doesn't say, so no test here reads `ring.bytes` or
  `ring.budget`; the cloth's `budget`, 294,912 bytes, is six checkpoints of a 12,288-word field, small enough that
  rings kept apart would thin apart within 600 steps under either reading.
- **The cloth's size and rate.** With 8 passes of local constraints a step, a hanging cloth's stretch grows with its
  rows × g ÷ rate² ÷ the rest length; at 600 steps a second and 0.1 m that is 1.7% at rest, and 3.7% at worst as it
  is let go (step 82, at the base and in the same arithmetic on the CPU). The size and rate are the fixture's; the
  criterion's numbers are 64 × 64, three fields, 8 passes, 600 steps, 0 m, 10% and step 300.
- **"8 constraint passes"** are 8 stepped operators between the move and the keep, each over one colour of the 8,064
  row and column edges, the four colours twice. "The longest edge" is the longest of those edges. "Within 10% of its
  rest length" is at most 1.1 × 0.1 m.
- **"Over 600 steps"** is every step from 1 to 600, each read at its own frame (`fps: 600`). "Moves 0 m" is the same
  bits as at step 0. The pinned points are those whose `pinned` word is not 0 at step 0: the top row's 64.
- **"A seek to step 300 equals play by hash"** is one session played to step 600 that jumps back (`seeks: [{after:
  600, to: 300}]`); the hash is each field's SHA-256, the name of its read file.
- **The planted programs are wrong documents.** Each criterion says "a planted step", and a step is operator data, so
  each is a fixture the test writes, reachable only from the test. Read uniformly from this step's positions the
  pulls would still pair exactly and keep momentum, so criterion 6's planted step reads only the *other* points'
  positions from this step, the in-place update the criterion describes; and a planted binary that bound every
  `step: previous` read to the state being written would change nothing here, since the points' positions are
  written last in a step.
- **Momentum.** The points have equal mass, taken as 1 in both sums, so total momentum is Σv and the summed
  magnitudes Σ|v|, in f64 over the f32 words read. "Keep … within 1e-5" is |P(k) − P(0)| ≤ 1e-5 × Σ|pᵢ(k)|; the
  start's total isn't 0 (a start mirrored through the centre would keep a wrong step's total at 0 too). It is read
  at five steps of the 1,000, the last among them, since a drift accumulates.
- **All pairs, within the base's limits.** One operator can't loop over 4,095 others (8 fetches an element, 256 trips),
  so the pulls are six operators of 3 others an element. The fixed point's rounding (half a unit of 2⁻²² a group) and
  f32's move total momentum by about 4e-8 of the summed magnitudes over 1,000 steps (read at the base), against the
  planted step's 9e-2.
- **"Under 2 ms of GPU a step"** is judged as #483's GPU budgets are: a run's value is the 95th percentile of its
  1,000 steps' GPU time, each the sum a frame's `passes_ms` reports for the step's operators at one step a frame;
  five runs after a warm-up, PASS when all five are within 2 ms, FAIL when all five are over by more than the margin
  (the larger of 5% and their spread) on a machine that isn't loaded, otherwise INCONCLUSIVE. The reference Macs are
  the design's three.
- **The taste call's pictures.** "The ring at step 100" is criterion 1's grid, "the pattern at 10 s" criterion 4's
  textures at step 6,000, "the hanging cloth" criterion 5's at step 600. Screenshots are 512 × 512 finals; a recording
  is the canvas's own final PNGs put into one animated PNG with their compressed data unchanged: the ring to step 150
  at 30 frames a second, the pattern's 10 s at 12, the cloth's first 2 s at 30. The ring's and the pattern's textures
  each declare the design's default ring (every 60 steps, 16 MiB); criterion 4's 160 MiB ring is another part's.
- **Not tested** (no criterion of this part asks it): a refusal of more than 8 fields or of fields whose counts
  differ; the ring's bytes against its budget (criterion 4, another part); the comment's four open lines of #252
  (energy, mass kept on merging, seek time, 3D textures); and that the pictures are attached to the PR and shown in
  the session, which a test can't see: the files are kept and their paths printed.

## Upstream tests (the Oracle lane)

None: the Oracle page lists no upstream test for any of the eight criteria.
