# Acceptance tests for #191, Oracle lane: the upstream physics engine's own tests, pinned by commit, run against our output

Written first, blind, from issue #191 (`gh issue view 191 --repo windoliver/deepbuild`), its Oracle page and cases
(`doneright/oracles/issues/191.md`, `doneright/oracles/cases/191.json` on branch `doneright` of `DeepBuildAI/deepbuild`),
the upstream files that page pins (read once from `doneright/oracles/vendor/rapier-3406750a38/…` at that ref to port
their setups and numbers; none is read at run time), the #191 suite's surface (`tests/acceptance/191/README.md`, written
by the same job) and the base this worktree stands on (`dc9b4315`), by a job that never saw an implementation of #191;
none existed, and no other worktree, branch, stash or PR was read. #136's rule applies: a linked test counts only when
run against our output, so every upstream case here builds our `physics.world@1` document and asserts on what
`deep-physics` answers, never on the engine called directly. Each test also runs one of the #191 suite's wrong programs
(a test backend or a planted name) and requires the same upstream assertion to reject its output. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1, 2, 3, 10 and 11, the five the page links upstream tests to. The other seven have none (the page's
"No upstream test" table) and stay with `tests/acceptance/191/`, as do the parts the page calls ours: the kit's report,
caps exclusions, tolerance ownership, the sensor matrix's steps, the first-contact step, `physics.fast_body` and budgets.

## Sources

| Criteria | Upstream, pinned | File (tests ported) | Use | Wrong program it rejects | License |
|---|---|---|---|---|---|
| 1, 3 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `crates/rapier3d/tests/issue_974_restitution.rs` (restitution_rebound_matches_e_squared) | port | `--backend restitution_min` | Apache-2.0 |
| 1, 2, 3 | the same commit | `src/dynamics/coefficient_combine_rule.rs` (geometric_mean_combine, its first two cases) | formula | `--backend friction_average` | Apache-2.0 |
| 1, 3 | the same commit | `crates/rapier3d/tests/issue_499_angular_limits.rs` (the motor drive of within, past and straddling half a turn) | port | `--backend no_joint_limits` | Apache-2.0 |
| 10 | the same commit | `bindings/python/tests/test_new_bindings.py:76-121` (test_active_collision_types_enables_kinematic_fixed_contact) | port | `--planted pair_filter_default` | Apache-2.0 |
| 11 | the same commit | `crates/rapier3d/tests/ccd_default_vs_fixed.rs` (default_ccd_vs_fixed_no_tunnel, bullet_still_hits_dynamic) | port | `--planted swept_collision_off` | Apache-2.0 |

No upstream code is copied: each test's setup and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and each assertion keeps upstream's numbers.

**Not ported**, each with why:

- `whole_island_sleep.rs` and `sleep_wake.rs` (criterion 1): none of the #191 suite's wrong programs reaches sleep, so
  a port could not be shown to reject a wrong program; the kit's `sleep` and `sleep_off` fixtures hold the rule.
- `src/control/character_controller.rs` and `bindings/python/tests/test_controllers.py` (criterion 1): our documents
  refuse `kind: character` until #182, which brings the controller and these ports with it.
- `issue_974_restitution.rs`' zero_restitution_does_not_bounce: no wrong program of the suite bounces a zero restitution.
- `coefficient_combine_rule.rs`' negative coefficients (our contact materials refuse them) and
  geometric_mean_wins_rule_priority (our world declares one rule per coefficient, so colliders never disagree).
- `issue_499_angular_limits.rs`' torque and multibody drives (our documents have no constant torque and no multibody
  joint), angular_limits_wider_than_a_turn_leave_the_joint_free (a joint without limits passes it too), and
  a_joint_shoved_past_its_limit_comes_back (it starts the body rotated 185° and reads the joint's angle from the bodies'
  frames; whether our hinge measures from the frames or from the pose it was built in is the backend interface's, so the
  port could fail for a reason the upstream test doesn't test).
- `joint_stability.rs`: its prismatic chains are already ported in `tests/acceptance/2009-oracle/`, and no wrong program
  of this suite makes them unstable.
- `test_new_bindings.py`'s test_active_collision_types_flags (the engine's default flag set, which our wrapper overrides;
  its dynamic pairs pass under every wrong program here).
- `ccd_default_vs_fixed.rs`' global_ccd_off_tunnels (it is the planted wrapper's own setting), default_tier_ignores_dynamic,
  and the trimesh and compound cases (no criterion reaches them).

## Run

```sh
npm ci                      # once, with node 24.22.0 first on PATH
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/191-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/191-oracle/tsconfig.json
rm -rf tests/acceptance/191-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #191 suite's helpers (`../191/helpers.ts`), so both lanes build and ask the same binaries the
same way: `cargo build --locked -p deep-physics-rapier --bin deep-physics`, with `--features test-backends` for the test
backends, each once per file. Every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs
`'tests/acceptance/191-oracle/'` in its `alone` list**; the implementer makes that edit. No cargo is `BLOCKED:`, never a
pass. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

The #191 suite's (its README: The surface under test): `deep-physics`'s `bake` of a `physics.world@1` document, its
`bodies` states (`pos`, `linear`, `rot`) with `read`, its `occurrences` rows, the test backends (`--backend`, in the
`test-backends` build) and planted names (`--planted`). Nothing new is named here.

## Upstream's world as ours

- `step_rate: 60` and `substeps: 4`: the engine's default step of 1/60 s and its 4 solver iterations, which our substeps
  are; gravity (0, −9.81, 0) unless upstream sets it to zero.
- A collider's defaults as a contact material: friction 0.5, density 1 kg/m³, restitution 0 unless the test sets them.
- A fixed body is `static`; `can_sleep(false)` is `sleep: false`; `angular_damping(3)` is `damping: {angular: 3}`.
- A revolute joint about +z from a fixed body at the origin is a `hinge` from `"world"` with `frame_a.anchor` the origin
  and both axes +z; `local_anchor2` is `frame_b.anchor`; `limits([a, b])` in radians is `limits: {min, max}` in degrees;
  `motor_velocity(±5, 20)` is a velocity motor of ±5 rad/s (±286.48°/s, our motor's unit) with `max_torque: 20`.
- issue_974's ball and ground both carry e under the average rule, so e combines; ours declares the maximum rule with the
  ground at 0, so e combines again, and the minimum (the wrong program) combines 0.
- coefficient_combine_rule asserts the combined coefficient; ours reads it from a box sliding along +x at 5 m/s on the
  ground under friction alone, as the behavior kit's slide does: μ = v0² ÷ (2·g·d) once it stops, μ = (v0 − v) ÷ (g · 1 s)
  for the frictionless case, within the slide fixtures' 3% (and under 0.01 for 0).
- test_new_bindings' kinematic ball inside a fixed cuboid is our static sensor box with a kinematic ball inside; the pair
  the narrow phase reports is our `sensor_enter` row between them at step 1 (criterion 10's static-sensor × kinematic
  case).
- ccd_default_vs_fixed's world has no gravity; its default `max_ccd_substeps` is our `solver.ccd: true`; `ccd_enabled` is
  the body's `ccd`.

## Criteria to tests

Each test's name starts with its criteria's IDs (`#191.<8 hex>`, as the #191 suite's `AC` table).

| IDs | File (tests) | Upstream assertion, on our bake | Rejects |
|---|---|---|---|
| AC1 #191.8c7c5edf, AC3 #191.5e3fd235 | `restitution-rapier.test.ts` (1) | a ball r 0.2 m at y 2.3 over a 30 × 0.1 × 30 cuboid, 400 steps: after it first dips below y 0.35, (highest y − 0.3) ÷ 2 within 0.05 of e² for e = 0.3, 0.5, 0.8, 0.95 | `restitution_min`, at every e |
| AC1, AC2 #191.7542a335, AC3 | `combine-rule-rapier.test.ts` (1) | 0.25 against 1.0 combines 0.5 (within 3%); 0.7 against 0.0 combines 0 (under 0.01) | `friction_average`, both cases |
| AC1, AC3 | `angular-limits-rapier.test.ts` (1) | a hinge driven by its motor either way for 600 steps settles within 2° of the limit, for [−45, 45], [−135, 135], [0, 90], [−170, −10], [0, 270], [−270, 0], [−90, 200], [−350, 0], [45, 315], [−315, −45], [135, 225] | `no_joint_limits`, all 22 |
| AC10 #191.9d50a1a7 | `pair-filter-rapier.test.ts` (1) | a kinematic ball r 2 inside a fixed cuboid of half extent 5 is a pair after one step | `pair_filter_default` |
| AC11 #191.e5696c9f | `ccd-rapier.test.ts` (1) | a 0.2 m cube at 200 m/s from x −3 toward a 0.1 m fixed wall ends on its near side after 120 steps; a bullet cube hits a 0.4 m dynamic cube, pushing it past x 0.05 and staying behind it after 60 steps | `swept_collision_off`, at least the wall case |

Test count: 5.
