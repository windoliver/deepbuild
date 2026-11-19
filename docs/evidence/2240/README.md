# #2240 evidence: a body's centre of mass as a field

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) at 120 Hz and 4 substeps, taken
by the blind suite (`tests/acceptance/2240/`), which reads 14 of 14 on this change; at the base it read 14 of 14
failing, the field being one the reader didn't know.

## The planted programs, failing

| Planted | What it reads | Where the real program reads |
|---|---|---|
| `centre_of_mass_ignored`, the box on the 33° slope with `centre_of_mass: (0, −0.75, 0)` | turns 90.26°; the kit's `box_slope_33_centre` fails, naming `box` | 0.0012° |
| `centre_of_mass_ignored`, the bar with the centre 0.75 m from the hinge | 1.6414 s; the kit's `bar_period_centre` fails against 1.865 s | 1.8653 s |
| `centre_of_mass_parallel_axis`, the same bar | 1.9534 s; the kit's `bar_period_centre` fails against 1.865 s | 1.8653 s |
| `check_accepts_centre_outside`, the point (0, 3, 0) on the 2 m box | no issue, and the bake builds the box | refused, below |
| `pose_reads_centre_of_mass`, the box at rest on level ground | `box_pose` 0.75 m lower at every step | the same position within 0.02 mm |

## The box on a slope

A 100 kg box 1 m wide and 2 m tall on a static slope, both of friction 2, baked 3 s. Its turn is the most it turns from
how it was built at any step.

| Slope | `centre_of_mass` | Turn | Tips at |
|---|---|---|---|
| 20° | none | 0.0030° | atan(0.5 ÷ 1.0) = 26.57° |
| 33° | none | 90.26°, past 45° | 26.57° |
| 33° | (0, −0.75, 0) | 0.0012° | atan(0.5 ÷ 0.25) = 63.43° |
| 45° | (0, −0.75, 0) | 0.0015° | 63.43° |

## The bar

A uniform bar 1 m long on a hinge at its top end, released from 10°, baked 5 s.

| `centre_of_mass` | Period | Worked answer | Off |
|---|---|---|---|
| none | 1.64139 s | 2π√(2L ÷ 3g) × (1 + θ² ÷ 16) = 1.64107 s | 0.02% |
| 0.75 m from the hinge | 1.86529 s | 2π√((L² ÷ 12 + 0.75²) ÷ (0.75 g)) × (1 + θ² ÷ 16) = 1.86510 s | 0.01% |

## Refusals (check)

| World | Result |
|---|---|
| `centre_of_mass` on a static body | `out_of_range` at `bodies/box/centre_of_mass`: "only a dynamic body takes centre_of_mass, and this body's kind is static" |
| on a kinematic body | the same, naming kinematic |
| on a character body | the same, naming character |
| (0, 3, 0) on the 2 m box | `out_of_range` at `bodies/box/centre_of_mass`: "centre_of_mass (0, 3, 0) lies outside the bounds of this body's shapes: x from -0.5 to 0.5, y from -1 to 1 and z from -0.5 to 0.5 m" |
| (0, −0.75, 0), and (0, −1, 0) on its base | accepted |

## Step hashes

The 45° world with the centre written, sought to 1.5 s (restored at step 140) and played on: its 221 step hashes are the
straight run's, the last `6b96d3719b3d96dd`. Thirteen worlds with no `centre_of_mass` (the box on three slopes, the bar,
#251's lap and eight drawn worlds of one and two shapes a body): 4,573 step hashes, each the same string as on the merge
base `9d0256132543`.

## Kit

`box_slope_20`, `box_slope_33`, `box_slope_33_centre`, `box_slope_45_centre`, `bar_period` and `bar_period_centre` pass
natively and on wasm32, with the other 58 fixtures.

## A vehicle body

The kit's fixture car (1,000 kg, its chassis 0.5 m tall) takes the field as any dynamic body does. No criterion reads
it, so these are readings, not a test.

| `centre_of_mass` | Check | Settled on its springs (3 s) | Most lean in the 15° turn at 3 m/s |
|---|---|---|---|
| none | accepted | y 0.5379 m, four wheels touching | 0.133° |
| (0, −0.2, 0) | accepted | y 0.5379 m, four wheels touching | 0.084° |
| (0, 0.6, 0) | refused at `bodies/car/centre_of_mass`, naming y from -0.25 to 0.25 | not built | |

## Unit tests

`the_bounds_a_centre_of_mass_is_held_to_are_the_built_shapes` holds the check's bounds to the built shapes' for turned
boxes, capsules, hulls and compounds; with the turns about X, Y and Z composed the other way round it fails, naming the
body. `a_written_centre_of_mass_keeps_the_mass_the_shapes_give` fails when a body with the field reads its shapes' mass
from its shapes alone (0 kg against 500 kg).
