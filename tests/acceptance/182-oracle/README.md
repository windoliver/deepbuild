# Acceptance tests for #182, Oracle lane: Rapier's own character-controller tests, pinned by commit, run against our output

Written first, blind, from issue #182 (`gh issue view 182 --repo windoliver/deepbuild`), its Oracle page and cases
(`doneright/oracles/issues/182.md`, `doneright/oracles/cases/182.json` on branch `doneright` of `DeepBuildAI/deepbuild`),
the upstream files that page pins (read once from `doneright/oracles/vendor/rapier-3406750a38/…` at that ref to port
their setups and numbers; none is read at run time), the #182 suite's surface (`tests/acceptance/182/README.md`, written
by the same job) and the base this worktree stands on (`1ab89128`), by a job that never saw an implementation of #182;
none existed, and no other worktree, branch, stash or PR was read. #136's rule applies: a linked test counts only when
run against our output, so every upstream case here builds our `physics.world@1` document with a character body and
asserts on what `deep-physics` answers, never on the engine called directly. Each test also runs one of the #182 suite's
wrong programs and requires the same upstream assertions to reject its output. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1, 2, 3, 6, 8, 10 and 12, the seven the page links upstream tests to. The other ten have none (the
page's "No upstream test" table) and stay with `tests/acceptance/182/`, as do the parts the page calls ours: the ramp
angles, the 20° descent, contact rows and their order, the offset plus 1 mm and the box's drift.

## Sources

| Criteria | Upstream, pinned | File (tests ported) | Use | Wrong program it rejects | License |
|---|---|---|---|---|---|
| 1, 3, 8, 10 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `src/control/character_controller.rs` (character_controller_climb_test) | formula | `--planted slope_limit_ignored` | Apache-2.0 |
| 1, 3, 8, 10 | the same commit | `src/control/character_controller.rs` (character_controller_ground_detection) | formula | `--backend ground_distance_1mm` | Apache-2.0 |
| 12 | the same commit | `src/control/character_controller.rs` (character_controller_impulses_with_multiple_dynamic_bodies, its collision) | formula | `--planted character_as_kinematic` | Apache-2.0 |
| 2, 6, 8, 10 | the same commit | `bindings/python/tests/test_controllers.py` (test_character_controller_autostep_clears_step) | port | `--planted character_as_kinematic` | Apache-2.0 |
| 2, 6 | the same commit | `bindings/python/tests/test_controllers.py` (test_character_collision_event_callback) | port | `--planted character_as_kinematic` | Apache-2.0 |

No upstream code is copied: each test's setup and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and each assertion keeps upstream's numbers.

**Deviations**, each forced by our documents or rules:

- A ball character is our one capsule of the same radius with a half height of 0.001 m: a character body holds one
  capsule.
- Upstream moves a character by a translation a step; ours is a `move {velocity}` held from step 0, that translation
  times 60 a second, its part along up ignored, so gravity pulls the character where upstream adds a downward part.
- Our character always has a step height (0.3 m by default): the climb and ground tests keep the default where upstream
  has no autostep; "without autostep" is a step height of 0.25 m, under the 0.3 m step.
- character_controller_ground_detection starts both characters sunk half into the ground; ours stand on it.
- test_character_controller_autostep_clears_step starts its ball over the step's x span while its docstring says "just to
  the left of the step"; ours starts left of it (x −2). Its final assertion, `y_with >= 0.55 or x_with > 0.0`, passes on
  any character that walks right, since after 600 frames it has walked off the step's far end; the port reads it as its
  docstring says: with the autostep the centre reaches y 0.55, and without one it stays on the lower ground.
- character_controller_impulses_with_multiple_dynamic_bodies then pushes the box ahead with
  solve_character_collision_impulses; our character pushes no dynamic body and never makes that call, so the port keeps
  the collision with the box ahead, the obstacle it stops at (it moves less than the 0.1 m asked), and the box beside
  left alone.

**Not ported**: character_controller_negative_up_axis (our up is against the world's gravity, never set apart from
it); test_character_controller_moves_flat_ground (no wrong program of the suite fails it); the remaining tests of
`test_controllers.py` (CharacterLength and autostep defaults of the Python bindings, PID controllers, vehicles).

## Run

```sh
npm ci                      # once, with node 24.22.0 first on PATH
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/182-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/182-oracle/tsconfig.json
rm -rf tests/acceptance/182-oracle/node_modules/.vite
```

`helpers.ts` builds `cargo build --locked -p deep-physics-rapier --bin deep-physics`, with `--features test-backends`
for the test backend, once per file, honoring `CARGO_TARGET_DIR`, `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`.
Every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs `'tests/acceptance/182-oracle/'` in its `alone`
list**; the implementer makes that edit. No cargo is `BLOCKED:`, never a pass. `BASE-FAILURE.txt` says why each test
fails at the base.

## The surface under test

The #182 suite's (its README: The surface under test): `deep-physics`'s `bake` of a `physics.world@1` document holding
`kind: "character"` bodies with their `character` fields, `move {velocity}` entries on its `track`, each state's
`character.grounded`, `pos` and `linear`, its `contact_begin` rows, `--backend ground_distance_1mm` and `--planted
slope_limit_ignored` and `character_as_kinematic`. Upstream worlds run at `step_rate: 60`, 4 substeps, a collider's
default density of 1 kg/m³ and friction 0.5. Nothing new is named here.

## Criteria to tests

| IDs | File (tests) |
|---|---|
| `#182.78fd65bc` `#182.11a4f4a4` `#182.a3e169f2` `#182.ca0e2323` `#182.e7c14b4e` | `character-controller-rapier.test.ts` (3): the climb test, the ground detection test, the impulses test's collision |
| `#182.d146e624` `#182.e8a0f46c` `#182.a3e169f2` `#182.ca0e2323` | `controllers-py-rapier.test.ts` (2): the autostep test, the collision callback test |
