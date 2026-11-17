# #2309 evidence: a contact frequency the step can't settle is refused

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64) on five and ten 1 m cubes (density 1000,
friction 0.5) stacked on a static floor at 120 Hz, 720 steps. Speeds are each cube's fastest in the sixth second.
**The blind acceptance suite for #2309 was not delivered before this PR; none of these readings is its verdict.**

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

`resting_stack` (five cubes, top's sink, answer 5.867 mm ± 0.3 mm) reads 5.860 mm natively and on wasm32; the kit's
verdict is pass on both, all 58 fixtures.

## Not run

Step hashes at 4 substeps with no `contact_hz` against the merge base (the default stays 30 Hz there, by code
reading); the blind suite; lanes.mjs registration.
