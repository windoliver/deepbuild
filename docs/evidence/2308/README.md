# #2308 evidence: small things at their true sizes

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) at base `85203f458`, in the
fixture's world: `step_rate: 480`, 4 substeps, `solver: {contact_hz: 240, length_unit: 0.01}`, g = 9.81 m/s². The
blind suite (`tests/acceptance/2308/`, 15 tests in 6 files) reads 15 of 15 on this change, each file run once; at the
base it read 14 failing at assertions and 1 passing (`BASE-FAILURE.txt`).

## The planted programs, failing first

| `--planted` | What it reads | The judge's failure names |
|---|---|---|
| `wrapper_ignores_length_unit` | the cube has not dropped 0.5 mm until step 33, its centre 2.09 sides past the edge | `cube` and step 33; the kit's `small_edge` row fails with `body: "cube"`, `step: 33`, 0.0209 m against 0.016 m |
| `wrapper_ignores_contact_hz` | the stack falls, its top 4.007 sides below 4.5 sides; `domino9` and `domino10` end 0.261 of a thickness inside each other | `cube5` (the kit's `small_stack` row, `body: "cube5"`); the pair (the kit's `small_dominoes` row, `bodies`) |
| `wrapper_scales_speed_cap` | the 1 m ball is held to 4 m/s and first bounces to 0.2009 m, 92.0% low | `ball` |
| `wrapper_scales_sleep_speed` | the cube writes `rest` at step 261, where it is due by step 257 | `cube` and step 261 |
| `lint_reads_first_shape` | a die whose thin shape is its second raises nothing | `die` |
| `check_reads_range_only` | `length_unit: 0.01` is accepted on `no_length_unit`; 0 is still refused | `solver/length_unit` and `no_length_unit` |

## The small bodies beside their answers

| Scene | Reading | Answer |
|---|---|---|
| The edge: a 1 cm cube, friction 0, at 0.886 m/s | dropped 0.5 mm at step 29, its centre 1.35 sides past the edge | before 1.6 sides |
| The stack: five 1 cm cubes, friction 0.5 | the top ends 0.92% of a side low and 0.06% aside; no cube faster than 0.003 mm/s in the third second | within 2% and 1% of a side; under 1 mm/s |
| The bounce: a 1 cm ball, restitution 0.5 on 0, `max`, from 0.1 m | 0.02510 m, 0.39% high | 0.025 m within 3% |
| The slide: a 1 cm cube, friction 0.5 on 0.5, from 0.7 m/s | 0.04977 m, 0.47% short of 0.05 m (0.37% short of v² ÷ 2μg) | 0.05 m within 3% |
| The dominoes: ten of 48 × 24 × 7.5 mm, 20 mm from centre to centre | pass 45° at steps 221, 242, 259, 275, 290, 305, 319, 330, 338, 343, the last at 0.715 s; at 4 s at most 0.005 of a thickness inside each other | in order; 0.6 s to 0.8 s; at most 0.05 |

## Big among small

In the same world a 1 m ball of restitution 0.5 dropped with its lowest point 10 m up reaches 14.0 m/s and first
bounces to 2.4806 m, 0.78% low of 2.5 m. A 1 cm cube sliding to rest from 0.2 m/s is under 0.05 m/s from step 15 and
writes `rest` at step 252, where the world's sleep time plus 2 steps allow step 257.

## The lint at check

| World | `physics.small_body` |
|---|---|
| a 1 cm die at the defaults (120 Hz, contacts at 30 Hz, no length) | kind `unit`: `extent` 0.01, `length_unit` 0.01; kind `soft`: `sink` 0.000552 m, `contact_hz` 50, `step_rate` 120, the world's own |
| a die of a 5 cm cube and then a 1 cm cube | the same two issues |
| a 5 cm cube at the defaults | none |
| the 1 cm die in the fixture's world | none |

## The kit

The five fixtures (`small_stack`, `small_bounce`, `small_slide`, `small_edge`, `small_dominoes`) pass on the reference
backend natively and on wasm32, where all 69 rows read `pass` with the same measures.

## An unwritten length changes nothing

The stack with no `length_unit` gives 1441 step hashes byte-identical to the merge base's. Each of the 64 fixture
worlds the base's kit holds, baked on the base's binary and on this change's, gives the same step hashes and the same
bake key. `length_unit` 0.01 and 0.1 on one world give two bake keys; 0, −0.01 and 1.01 are refused with
`out_of_range` at `solver/length_unit`; on the test backend `no_length_unit` 0.01 is refused with
`physics.backend_cap`, its sentence naming the backend.

## Pictures

Each world drawn from this change's own bake, a body a mark posed at the bake's states, at 100 times its size with the
camera moved to match (`pictures/`). In each pair the shipped program is on the left and the planted one on the right.

| File | What it shows |
|---|---|
| `pair-edge.png` | the cube every 6 steps: it tips and drops as it leaves the table; under `wrapper_ignores_length_unit` it stays level past the edge |
| `pair-stack.png` | the five cubes at 3 s: standing; under `wrapper_ignores_contact_hz` fallen |
| `pair-dominoes.png`, `pair-dominoes-last-two.png` | the row at 4 s, and its last two up close: resting on each other; under `wrapper_ignores_contact_hz` the ninth sunk into the tenth |
| `pair-big-ball.png` | the 1 m ball where it was built and at the top of its first bounce: 2.48 m; under `wrapper_scales_speed_cap` 0.20 m |
| `bounce.png` | the 1 cm ball where it was built and at the top of its first bounce, 0.0251 m |
| `dominoes-real-and-planted.mp4` | the row's first 1.2 s at a quarter speed, both programs |

## The suites beside it

Each file once on this change: #2309's four files (12 tests), #2306's kit file (2), #2241's level belt, tilted belt
and refusals (8), #2243's kit file (2), #251's kit file (3), #191's limits, excluded caps, queries and fast bodies (9)
and #182's wrong controllers (2) all pass.

## Open

- `tests/acceptance/191/ac1-reference-kit.test.ts` holds every fixture of the kit to 120 Hz and reads 0 of 2 on this
  change, naming the five fixtures at 480 Hz and nothing else. Its blind redraft, `tests/acceptance/191-redraft-2308/`,
  holds the five to #2308's world, answers and tolerances and every other fixture to 120 Hz as before; it reads 2 of 2
  at the base and 2 of 2 on this change, natively and on wasm32. The swap is the owner's.
- The first criterion's planted wrapper leans on the backend's reuse of contacts (the issue's note on #2317): a change
  to that reuse needs this plant read again.
