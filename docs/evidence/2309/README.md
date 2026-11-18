# #2309 evidence: a contact frequency the step can't settle is refused

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64) on five and ten 1 m cubes (density 1000,
friction 0.5) stacked on a static floor at 120 Hz, 720 steps. Speeds are each cube's fastest in the sixth second.
The blind suite (`tests/acceptance/2309/`, commit fb3190b51) reads 12 of 12 on this change (AC1 and AC3 in the first run, AC2 and AC4 in the rerun after the kit fix, below); at the base it read 8 failing at assertions and 4 passing.

## Refusals (check)

| World | Result |
|---|---|
| 120 Hz, 4 substeps, `contact_hz` 81 | `out_of_range` at `solver/contact_hz`, actual 81, "at most (step_rate × substeps) ÷ 6 = 80 Hz" |
| same, 80 | accepted |
| 120 Hz, 1 substep, `contact_hz` 30 | refused, bound 20 |
| same, 20 | accepted |
| planted `contact_hz_quarter`, 110 at 4 substeps | accepted (the shipped check refuses it) |

## Stacks

| Run | Fastest speed per cube, m/s (bottom to top) | Top below its start |
|---|---|---|
| five, 80 Hz, 4 substeps | 2e-6 … 7e-5 | 0.82 mm |
| ten, 80 Hz, 4 substeps | 2e-6 … 9e-5 | 3.59 mm |
| five, default (30 Hz), 4 substeps | 4e-6 … 9e-5 | 5.845 mm; worked answer 5.867 mm |
| five, default, 1 substep (20 Hz) | 5e-6 … 2.2e-4 | 13.2 mm |
| planted `static_contact_same_hz`, default | up to 8e-5 | 6.880 mm; worked 6.903 mm (25 g ÷ (2π·30)²) |
| planted `contact_default_30`, 1 substep | 2.9e-3 … 1.2e-1 | 5.99 mm; fastest cube 0.124 m/s |
| planted `contact_hz_quarter`, 110 Hz | up to 2.0e-2 | 0.44 mm |

Worked answer, default: 2 × (4+3+2+1) × g ÷ (2π·30)² + 5 × g ÷ (2π·60)² = 5.867 mm.

## Kit

`resting_stack` (five cubes, the top's sink along y, answer 5.867 mm ± 0.3 mm) passes natively and on wasm32, all 58 fixtures.

## Step hashes

At 4 substeps with no `contact_hz`, 721 step hashes are byte-identical to the merge base's (AC3).

## Not run

The blind suite's first run read 10 of 12; its two AC4 failures were my kit measure (straight-line distance, 15 µm off the vertical sink) and were fixed in the change, not the tests. AC2 and AC4 were rerun (6 of 6); AC1 and AC3 were not rerun after that kit-only change. Builds ran under `nice` outside the throttle.
