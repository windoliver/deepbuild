# #2307 evidence: a parked vehicle stays parked

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) on the blind suite's own worlds
(`tests/acceptance/2307/helpers.ts`), on the merge with main. The blind suite reads 14 of 14 on this change; at the
base, `85203f458`, 10 failed at their own assertions and 4 passed, each of those held by its planted program
(`tests/acceptance/2307/BASE-FAILURE.txt`).

## Pictures

Each world is the blind suite's own, baked by this change's `deep-physics` and, beside it, by the planted program its
criterion names. The frames are `deep-gpu` `view3d` frames (640 × 360) of scene3d marks posed from each bake's body
states and wheel pose outputs: the chassis in sand, the wheels dark. Nothing is drawn on them, nothing in them is
judged and no test reads them. In every picture and clip **the left half is this change and the right half the planted
program**. `pictures.json` holds the car's position at each clip's first and last step.

| File | Left: this change | Right: the planted program |
|---|---|---|
| `slope.mp4`, `slope.png` (12 s) | braked at 4,000 N facing up the 20° slope, the car stays at the post that marks where it was set down, its wheels unturned | `controller_without_hold`: it creeps 0.43 m down the slope, its wheels turning |
| `sleeping-drive.mp4`, `sleeping-drive.png` (to 2 s after the drive) | asleep on level ground and driven at 2,000 N from step 480, it is 4.00 m from the post at step 720 | `controller_runs_asleep`: 3.32 m from the post |
| `hop.mp4`, `hop.png` (steps 470 to 520) | the same car close up as the drive wakes it: it stays on its springs | `controller_runs_asleep`: the velocity stored while it slept lifts it 0.08 m, its wheels hanging |
| `platform.mp4`, `platform.png` (steps 560 to 960) | asleep on the platform that moves after step 600, it wakes and rides the platform's dark band 4.99 m | `leaves_asleep_on_moving_ground`: the band leaves from under it and it stays where it slept |

## Wrong programs, failing first

| Wrong program | World | Reading |
|---|---|---|
| the base | braked at 4,000 N, sleep off, 2 s to 12 s | moves 0.1443 m facing up 10°, 0.2850 m facing up 20°, 0.1490 m across 10°, 0.2929 m across 20° |
| the base | asleep on the platform that moves after step 600 | no `wake`; ends 5.000 m from its place |
| `--planted controller_without_hold` | the same four slopes | 0.1866 m facing up 10° (the issue's 0.183 m), 0.3676 m facing up 20°, 0.0957 m and 0.1879 m across |
| `--planted hold_ignores_brake_limit` | brakes of 1,000 N facing up 20° | 0.0000 m/s at 4 s, where 9.42 m/s is due |
| `--planted hold_takes_out_side_slip` | the kit's `vehicle_turn`, its own run | the car ends at 0.0000 m/s, 7.05 m on from the steer |
| `--planted controller_runs_asleep` | braked facing up 10°, sleep on | `rest` at step 116; the hash first changes at step 117, the body then holding (0, 0.0774, −0.0098) m/s; 1,264 steps change it |
| `--planted controller_runs_asleep` | asleep on level ground, driven at 2,000 N at step 480 | 1.2589 m/s upward stored by step 480; 3.633 m/s at 2 s, its centre rising 0.0795 m, four `contact_end` rows |
| `--planted leaves_asleep_on_moving_ground` | asleep on the platform | no `wake`; 0.0000 m from where it slept, the platform 5 m on |

## This change

- **The four slopes** (sleep off, 2 s to 12 s): 0.0000012 m facing up 10°, 0.0000032 m facing up 20°, 0.0000010 m
  across 10°, 0.0000044 m across 20°.
- **Never more than asked**: 9.42904 m/s at 4 s (worked 9.4207); 0.590368 m/s² (worked 0.5897); 13.635 m back at 4 s
  (worked 13.6279). The base read 9.42902, 0.59037 and 13.6350.
- **Level ground**: the kit's `vehicle_brake`, `vehicle_drive` and `vehicle_turn` measure 12.458488464438041 m,
  3.999981880203879 m/s and 9.336458772691012 m, the base's rows digit for digit; #251's lap gives the base's 1,201
  step hashes.
- **Asleep on the 10° slope**: `rest` at step 117, no `wake`; no step hash changes after it, no wheel row, 0 m moved
  from step 180 to 1,380.
- **Driven from sleep**: `wake` on step 481 on both; 3.99998 m/s at 2 s on level ground, its centre rising 0 m, no
  `contact_end`; 8.59299 m/s up the 10° slope.
- **The platform**: awake and braked it ends 0.00652 m from its place; asleep, `wake` on step 601 and 0.00653 m.
- **The kit**: `vehicle_slope` 0.0000265 m, `vehicle_weak_brake` 9.42904 m/s, `vehicle_sleeping_drive` 3.99998 m/s,
  each `pass`; `--backend no_vehicle_controller` reads `excluded_by_caps` on the three.

## Beyond the criteria

- **A slope that is a dynamic body.** On #2306's beam, tipped to its 15° limit under the braked car, the car slid
  0.300 m from 1 s to 3 s at the base and still moved 0.135 m/s at 3 s. Here it moves 0.072 m in those 2 s and
  0.0003 m/s at 3 s. The hinge reads 15° from step 52 on, as before, and #2306's suite reads 16 of 16.
- **Dynamic ground that wakes or moves** has no criterion; the crate's test
  `a_sleeping_car_wakes_on_the_step_the_body_under_it_wakes_or_moves` holds it: a slab asleep under the car that is
  poked awake at 0.01 m/s, and one that never sleeps poked to 0.5 m/s, each wake the car on that step, and
  `leaves_asleep_on_moving_ground` leaves it asleep on both.
- **Where the hold pushes.** Along a wheel's heading it pushes at the contact, as the brake does. Sideways it pushes
  level with the centre of mass: at the grip's own point, a tenth of the way down to the contact, the car standing
  across the 10° slope crept 0.03 m up it in 10 s.
