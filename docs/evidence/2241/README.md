# #2241 evidence: belts, a surface that carries what rests on it

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build; `no_belts` on the
`test-backends` debug build) on the blind suite's own worlds: a 0.5 m box of friction 0.5 set at rest on a static
belt of friction 0.5, at 120 Hz, 4 substeps and g = 9.81 m/s², baked 240 steps. "Reaches" is the first step the
box's speed along the belt is within 1% of 1 m/s. The blind suite (`tests/acceptance/2241/`) reads 12 of 12 on this
change in one run; at the base it read 12 failing, each at an assertion of its own (`BASE-FAILURE.txt`).

Worked answers: v ÷ (μg) = 0.2039 s, step 24.46; v·t − v² ÷ (2μg) = 1.8981 m;
1 ÷ (g × (0.5 cos 10° − sin 10°)) = 0.3198 s, step 38.38; cos 10° = 0.9848.

## The wrapper without the hook, first

| Run under `--planted belt_hook_left_out` | Result |
|---|---|
| level belt, `tangent_speed: 1` | the box never moves: 0.0000 m along +X at 2 s, 0.0000 m/s |
| kit, `belt_level`, `belt_turned`, `belt_reversed` | each `fail`: measured 0.0000 m where the answer is ±1.8981 m within 1% |
| kit, `belt_tilted` | `fail`: measured 0.0000 m/s where the answer is 1 m/s within 1% |

## The three belts

| Belt | Reaches 1 m/s | Moved at 2 s | Speed from reaching it to 2 s |
|---|---|---|---|
| level, along its +X | step 25, 0.2083 s (worked 0.2039 s) | 1.8991 m (worked 1.8981 m) | 0.9976 to 1.0071 m/s, 1.0000 at 2 s |
| turned 90° about +Y, along world −Z | step 25, 0.2083 s | 1.8991 m, and 0.0000 m along world +X | 0.9976 to 1.0071 m/s |
| level, `tangent_speed: −1`, along x | | −1.8991 m | |
| tilted 10°, up the slope | step 38, 0.3167 s (worked 0.3198 s) | 1.8412 m | 0.9902 to 1.0040 m/s, 1.0000 at 2 s |

The level belt's body holds its built pose with zero velocities at all 241 states.

| Planted wrapper | What it does to the box |
|---|---|
| `belt_speed_along_world_x`, turned belt | 1.8991 m along world +X and 0.0000 m along world −Z, the belt's own +X |
| `belt_speed_along_level_ground`, tilted belt | held at 0.9848 m/s up the slope; kit `belt_tilted` `fail`, measured 0.9847 m/s |

## Kit

| Fixture | Measure | Answer | Reads |
|---|---|---|---|
| `belt_level` | how far the box has moved along world +X by step 240 | 1.8981 m within 1% | 1.8991 m |
| `belt_turned` | the same along world −Z, the belt turned 90° about +Y | 1.8981 m within 1% | 1.8991 m |
| `belt_reversed` | the same along world +X at `tangent_speed: −1` | −1.8981 m within 1% | −1.8991 m |
| `belt_tilted` | the box's speed up the slope from step 41 on, the reading farthest from the answer | 1 m/s within 1% | 1.0004 m/s |

All four pass, with all 62 fixtures, and each names the cap `belts`. The measures are signed along the belt's own
direction, so the kit holds any backend to it: under `belt_speed_along_world_x` `belt_turned` reads 0.0000 m and
fails, with `belt_tilted`; without the hook all four fail; along level ground `belt_tilted` alone fails
(`cargo test -p deep-physics-rapier --lib belt`, which also runs `belt_level` with its belt's body kinematic: it
carries the same, and fails without the hook).

## Refusals (check)

| World | Result |
|---|---|
| the first world, `tangent_speed: 1` on its static belt | accepted |
| `tangent_speed: 1` on the dynamic box's material | `out_of_range` at `contact_materials/box/tangent_speed`, actual 1: "only a static or kinematic body's shape use carries a tangent_speed" |
| `rolling_resistance: 0.05` | `physics.backend_cap` at `contact_materials/box/rolling_resistance`, actual 0.05, naming rapier3d 0.36.1 |
| `tangent_speed: 0` on the static belt | accepted |
| the first world on `--backend no_belts` | `physics.backend_cap` at `contact_materials/belt/tangent_speed`, actual 1: "no_belts 0.36.1 claims no belts" |

`no_belts` answers caps `["ccd"]` against Rapier's `["ccd", "soft_bodies", "character_controller",
"vehicle_controller", "belts"]`. The kit admits it, and `belt_level` and `belt_tilted` read `excluded_by_caps` on it
and `pass` on Rapier in the same build.

## Seek and step hashes

- The first world baked into a store and sought to step 120: it restores step 120 and plays 120 on, and its 121
  step hashes equal the straight run's (the last, `4aaf973cc852a221`, in both).
- With `tangent_speed` left out, the same world gives 241 step hashes byte-identical to the merge base's
  (`9d0256132543` before the merge with main, `81c6b9c340f6` after); so does that world with its box sliding from 2 m/s.
- The first world's hashes differ from the plain surface's from step 1, so the hash sees the belt carry the box.

## Open

- **#2009's third criterion.** Its frozen test asserted that `tangent_speed: 1` is refused on Rapier naming the
  backend, and failed on this change at that case, as the issue says it would. Its blind redraft,
  `tests/acceptance/2009-redraft-2241/`, reads 2 of 2 on this change and at the base and carries the criterion's ID
  as #2009 reads today, `#2009.43ed60cb`. The frozen file is removed in a commit of its own, which waits for an
  approver's signed tag: that signature is the ruling the issue leaves to the owner. #2009's text is not edited;
  with "or tangent_speed 1 m/s" struck its ID would be `#2009.b8b12d95`.
- **`scripts/lanes.mjs`.** The line that runs the two new folders one file at a time is a commit of its own and
  waits for an approver's signed tag.
- **2D.** The design now states the 2D direction (the contact's tangent, counter-clockwise about the shape). No 2D
  world runs on this backend (#2098), so nothing here runs it.
