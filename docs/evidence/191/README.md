# Evidence for #191: the physics behavior kit

The issue's Proof: the kit's report on Rapier for both targets, each planted backend's failure with what it names, and
the run with a test fixture excluded by caps.

- `kit-rapier-aarch64-apple-darwin.json`: `deep-physics` `{"call":"backend"}` and `{"call":"behavior_kit"}` on the shipped
  debug build, macOS arm64. Verdict `pass`: 34 fixtures pass, each `measured` beside its `answer` and `tolerance`; the six
  character and `place` cells of the sensor matrix read `excluded_by_caps`, since Rapier's caps claim no
  `character_controller` until #182.
- `kit-rapier-wasm32-unknown-unknown.json`: the same `behavior_kit` through `node scripts/physics-wasm32.mjs`. Verdict
  `pass`, the same 40 results.
- `test-backends.json`: `behavior_kit` on the `test-backends` build under each test backend and planted kit, with every
  failing result's `what`:

| Run | Verdict | Fails |
|---|---|---|
| `--backend friction_average` | fail | slide_geometric (2.543 m against 3.186 m, 3%), slide_min, slide_max, slide_multiply; slide_average passes |
| `--backend no_joint_limits` | fail | hinge_limit (largest angle 179°, joint `pin`), slider_limit |
| `--backend restitution_min` | fail | bounce_max (0.246 m against 0.81 m), bounce_average, bounce_geometric, bounce_multiply |
| `--backend drops_cap` | pass | none; `test_capped` and `ccd_wall` read excluded_by_caps |
| `--backend drops_cap --planted kit_runs_excluded` | fail | `test_capped` and `ccd_wall`, refused by the caps; the character cells, refused at check |
| `--backend query_ignores_groups` | fail | queries, naming the hit on a body the ray's groups filter out |
| `--backend rapier_caps` | refused | refused before any fixture runs, naming `soft_bodies` |
| `--backend no_soft_bodies` | pass | none |
| `--backend rapier_caps --planted kit_admits_unfixtured` | pass | the planted kit admits the candidate (the acceptance test fails it) |
| `--backend loose_tolerance` | fail | free_fall at 2.2% against the interface's 1%, though its manifest declares 5%; others its 2% gravity moves |
| `--planted pair_filter_default` | fail | sensor/static/kinematic and sensor/kinematic/kinematic write nothing |
| `--planted swept_collision_off` | fail | ccd_wall: the ball's centre passes the far face, naming the body and the step |

Readings beside the answers on Rapier (macOS arm64): free fall 4.9152 m (4.905), projectile 10.179 m (10.194), pendulum
2.0109 s (2.0099), bounces 1.2–1.7% under e²h, slides within 0.4%, slope hold 0.2 mm, slope slide 1.326 m (1.314), hinge
30.000° (≤ 30.5°), slider 0.500 m (≤ 0.505), motor 89.99°/s, first contact at step 55 (0.4515 s), 4.4145 m/s (4.429),
sensor entry at step 39 (0.3193 s), rest 62 steps after the speed falls under 0.05 m/s (≤ 60 + 2), the fast ball's first
contact at step 6.
