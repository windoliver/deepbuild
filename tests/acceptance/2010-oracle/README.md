# Acceptance tests for #2010, Oracle lane: upstream determinism tests, pinned by commit, run against our output

Written first, blind, from issue #2010 (`gh issue view 2010 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/2010.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the three upstream files that
page pins (read from the vendor copies of `doneright/oracles/vendor/`), the #2010 suite's surface
(`tests/acceptance/2010/README.md`, written by the same job) and base commit `d51be2c3`, by a job that never saw an
implementation of #2010; none existed, and no other worktree, branch or PR was read. #136's rule applies: a linked test
counts only when run against our output, so every case here builds our `physics.world@1` document and asserts on what
`deep-physics` answers, never on Rapier or Chaos called directly. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 2, the one the page links upstream tests to. Criteria 1, 3, 4 and 5 have none (the page's "No upstream
test" table) and stay with `tests/acceptance/2010/`, as do the parts the page calls ours: the ulp distance at the next
checkpoint and the rounding-hash twin.

## Sources

| Criterion | Upstream, pinned | File (tests) | Use | License |
|---|---|---|---|---|
| 2 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `crates/rapier3d/tests/issue_868_same_machine_determinism.rs` (same_machine_runs_are_bitwise_identical) | port | Apache-2.0 |
| 2 | rapier, the same commit | `crates/rapier3d/tests/snapshot_roundtrip.rs` (awake_pile, sleeping_pile, ccd_bodies, joints_and_sensor) | port | Apache-2.0 |
| 2 | unreal `396c9f059903aed5fec78ecd3d437a40c6415368` | `Engine/Source/Programs/HeadlessChaos/Private/HeadlessChaosTestRewind.cpp` (DeterministicSim_DifferentCreationOrder) | the rule only, not ported | Unreal Engine EULA |

Both Rapier files are byte for byte the ones the rapier3d 0.36.1 crate ships (`diff` against the crate's `tests/`), so
the pin is the version our backend runs. No upstream code is copied: each test's scene and assertion are re-expressed in
the receiving file, which names its upstream file, commit and license, and keeps upstream's numbers. Unreal Engine's
source is Epic's under the Unreal Engine EULA ("Copyright Epic Games, Inc. All Rights Reserved."), which doesn't allow
its code to be redistributed outside licensees, so it can't be ported here: `creation-order-chaos.test.ts` asserts the
same rule (bodies created in reverse order end with zero position and rotation error) on a scene of our own written from
the test's published parameters, with no text of the file.

Left out of snapshot_roundtrip: multibody_articulation (our document has no multibody joint), restoring_into_a_live_pipeline
and replacing_the_pipeline_changes_nothing (no world field reaches Rapier's pipeline or CCD workspace), structural_changes
(a body is never created or removed mid-run: Body `body@1`), and the `#[ignore]`d 43k-body pyramid.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2010-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2010-oracle/tsconfig.json
rm -rf tests/acceptance/2010-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #2010 suite's helpers (`../2010/helpers.ts`, which re-exports #2009's), so both lanes build
and ask the same binary the same way: each file builds `cargo build --locked --bin deep-physics` once and copies it
out; every test passes a 60-minute timeout. Upstream's world as ours comes from `../2009-oracle/helpers.ts`
(`upstreamWorld`, `upstreamMaterial`): 60 Hz, 4 solver iterations as substeps, gravity (0, −9.81, 0) (Rapier 0.36.1's
`PhysicsWorld::new()`), a collider's friction 0.5 and density 1. **`scripts/lanes.mjs` needs
`'tests/acceptance/2010-oracle/'` in its `alone` list**; the implementer makes that edit. No cargo is `BLOCKED:`, never a
pass. `BASE-FAILURE.txt` is the run at the base: every test fails at its assertion because the base's bakes and restores
answer no `step_hashes`.

Checked at the base, before that run: every scene here builds and runs on the base's `deep-physics` (each pile 200 steps
with a checkpoint every 20 in under 2 s; a checkpoint's state about 1.1 MB of base64), and a restore of each pile's
step-100 checkpoint runs.

## The surface under test

The #2010 suite's (its README: The surface under test): `bake` with `step_hashes` and `checkpoints`, `restore` with
`step_hashes` and `checkpoints: true`, and #2009's `bodies` states. Nothing new is named here.

## Upstream's world as ours

- Rapier's default coefficient combine rule is Average, so each world's `combine` is average for friction and
  restitution. A collider with no parent body (upstream's ground in issue_868, the sensor in joints_and_sensor) is a
  static body holding that shape. `can_sleep(false)` is `sleep: false`, `ccd_enabled(true)` is `ccd: true`, `linvel` is
  `velocity.linear`.
- joints_and_sensor's chain hangs from a fixed body at (0, 7, 0) through local anchors ±0.3 m along x; ours is a `ball`
  joint from `"world"` at (0.3, 7, 0), then link to link at (0.3, 0, 0) and (−0.3, 0, 0), with `collide_connected: true`
  (upstream's impulse joints leave contacts on).
- snapshot_roundtrip saves the world at step 100, restores it into a fresh world, and compares the two worlds' serialized
  bytes after each of the next 100 steps. Ours: the bake's checkpoint at step 100 is the save (a checkpoint's `state` is
  the backend's whole-world state), `restore` the restore, and the comparison runs at every step by step hash and at
  every checkpoint after the restore (every 20 steps) by the checkpoint's state bytes; the ring's budget is raised to
  1 GiB so its spacing never doubles.
- Chaos's test: fifty boxes 100 units on a side, 100 units apart and 5 apart sideways, falling under 980 units/s² onto a
  large kinematic box whose top is at 0, 20 steps of 1/30 s, the second run creating them in reverse order. Ours: 1 m
  boxes of 1 kg, y up, g = 9.8 m/s², a static box below y 0, step_rate 30; "created in reverse order" is the document
  writing its bodies in reverse, as in the #2010 suite's reading (the module creates in canonical order).

## Criteria to tests

Each test's name starts with its criterion's ID (`#2010.<8 hex>`, as `CRITERIA` in `../2010/helpers.ts`).

| ID | File (tests) | Upstream assertion, on our output |
|---|---|---|
| 2 `#2010.fa073c97` | `same-machine-determinism-rapier.test.ts` (1) | eight balls (r 0.5, restitution 0.7, density 1) at (0.51x + 3, 0.5y + 3.5, 0.5z + 3) over a 100 × 0.1 × 100 cuboid, 200 steps, baked in two processes: every ball's position after step 200 equal, and every step hash |
| 2 `#2010.fa073c97` | `snapshot-roundtrip-rapier.test.ts` (2) | awake_pile and sleeping_pile; ccd_bodies and joints_and_sensor: 192 unit boxes in an 8 × 3 × 8 jittered pile (with four rolling balls when sleepy; eight CCD balls at (90, −45, 3i) m/s; a four-ball chain through a sensor), restored at step 100 and run 100 steps: every step hash equal to the uninterrupted run's, and every checkpoint after the restore byte-identical, naming the first step or checkpoint that differs |
| 2 `#2010.fa073c97` | `creation-order-chaos.test.ts` (1) | Chaos's rule: fifty boxes written in reverse order, 20 steps at 30 Hz: every position and rotation equal to the bit, and every step hash |

Test count: 1 + 2 + 1 = 4.
