# #2306 evidence: vehicles on ground that moves

Each world is the blind suite's own (`tests/acceptance/2306/helpers.ts`), baked by this change's `deep-physics` and,
beside it, by the planted wrong program the criterion names. The pictures are `deep-gpu` `view3d` frames (640 × 360,
30 fps) of scene3d marks posed from each bake's body states and wheel pose outputs; nothing in them is judged, and no
test reads them. In every picture and clip **the left half is this change and the right half the planted twin**.

| File | Left: this change | Right: the twin |
|---|---|---|
| `beam.mp4`, `beam.png` | the braked car tips the 200 kg beam to its 15° stop (from 0.43 s) | `controller_as_is`: the beam stays level |
| `slab.mp4`, `slab.png` | driven at 2,000 N, the car runs forward and the free slab runs back: its black centre band ends 4 m back | `controller_as_is`: the slab never moves |
| `platform.mp4`, `platform.png` | the braked car rides the platform 5 m along its axle, on the platform's black band | `controller_as_is`: the platform leaves the car where it was in the world |
| `disc.mp4`, `disc.png` | the braked car rides the turning disc's radial stripe around the axis | `grip_reads_chassis_only`: the stripe turns away and the car stays put |
| `weight.png` | the car on the 100 kg slab | `controller_as_is`: looks the same; the difference is the load below |

## Readings

The same bakes, read through the suite's helpers (the issue's Proof line):

| What | This change | Planted twin | Worked answer |
|---|---|---|---|
| The slab's contact impulse over each step of the fourth second ÷ the step | 10,791 N at every step | 981 N | (1,000 + 100) × 9.81 = 10,791 N |
| The beam's hinge from 0.5 s to 3 s | 15.0° at every step (within 0.1° from step 52) | 0° | 15° |
| The car's and the slab's velocities 2 s into the drive | 3.99998 and −4.00003 m/s; momenta sum −0.04 kg·m/s | 3.99998 and 0 m/s; 3,999.98 kg·m/s | ±4.00 m/s; 0 |
| Braked car on the ramping platform, from its place at 3 s | 0.0071 m | 5.000 m | within 0.02 m |
| Set down moving with the platform, from its place at 3 s | 0.0008 m | 5.804 m | within 0.02 m |
| Free car, platform moving along its heading, farthest from its start | 0 m | 0 m | within 0.02 m |
| The car's turn about the disc's axis at 4 s, and the disc's | 106.99° and 107.27°; 3.024 m out | 0.00° | within 3°; 3 ± 0.15 m |

The behavior kit on Rapier 0.36.1 reads `vehicle_weight` 10,790.88 N, `vehicle_beam` 15.0000°, `vehicle_slab`
4.00003 m/s and `vehicle_platform` 0.000001 m, each a pass; on `no_vehicle_controller` each is `excluded_by_caps`.

## Seen and left to #2307

On the beam the braked car is not still: it slides down the tilted beam from 2.5 m to 3.25 m from the pivot in 3 s, at
about 0.13 m/s at the end, where the brakes' 4,000 N exceed the slope's 2,539 N pull. A car that stands still on a
slope is #2307's (its hold resists the pull before the step, reading the body under the wheel). The slide here is
faster than #2307's static-slope probe because the brake's impulse, by the controller's own rule, shares itself with
the beam as a free body, while the beam's hinge limit takes that share back in the step.
