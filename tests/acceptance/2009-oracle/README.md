# Acceptance tests for #2009, Oracle lane: Rapier's own tests, pinned by commit, run against our output

Written first, blind, from issue #2009 (`gh issue view 2009 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/2009.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the four upstream files that page
pins (read from `doneright/oracles/vendor/rapier-3406750a38/…` at that ref), the #2009 suite's surface
(`tests/acceptance/2009/README.md`, written by the same job) and base commit `0c4a4ec7`, by a job that never saw an
implementation of #2009; none existed, and no other worktree, branch or PR was read. #136's rule applies: a linked test
counts only when run against our output, so every upstream case here builds our `physics.world@1` document and asserts
on what `deep-physics` answers, never on Rapier called directly. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1 and 2, the two the page links upstream tests to. Criteria 3 and 4 have none (the page's "No upstream
test" table) and stay with `tests/acceptance/2009/`, as do the parts the page calls ours: the restitution_threshold
refusal, the 1e-5 m bound, the 3% bounce, the spring's 1% period and the chain's 1% a second.

## Sources

| Criterion | Upstream, pinned | File (tests ported) | Use | License |
|---|---|---|---|---|
| 1, 2 | rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | `crates/rapier3d/tests/issue_974_restitution.rs` (restitution_rebound_matches_e_squared, zero_restitution_does_not_bounce) | port | Apache-2.0 |
| 2 | rapier, the same commit | `crates/rapier3d/tests/soft_bodies.rs` (fem_free_fall_is_exact: its formula only) | port (formula) | Apache-2.0 |
| 2 | rapier, the same commit | `crates/rapier3d/tests/total_contact_impulse.rs` (resting_impulse_matches_gravity_for_any_warmstart_coefficient) | port | Apache-2.0 |
| 2 | rapier, the same commit | `crates/rapier3d/tests/joint_stability.rs` (prismatic_limit_chains_remain_stable, joint_net_remains_stable, their dim3 forms) | port | Apache-2.0 |

No upstream code is copied: each test's setup and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and each assertion keeps upstream's numbers. Left out: the two `#[ignore]` long runs
of `joint_stability.rs`, every other test of `soft_bodies.rs`, and its free fall's "no internal motion" check (a soft
body's; our build leaves Rapier's `fem` feature off, as the page says).

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2009-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2009-oracle/tsconfig.json
rm -rf tests/acceptance/2009-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #2009 suite's helpers (`../2009/helpers.ts`), so both lanes build and ask the same binary
the same way: each file builds `cargo build --locked --bin deep-physics` once and copies it out; every test passes a
60-minute timeout (the 32 × 32 net runs 4,000 steps of 1,024 bodies on a debug build). **`scripts/lanes.mjs` needs
`'tests/acceptance/2009-oracle/'` in its `alone` list**; the implementer makes that edit. No cargo is `BLOCKED:`, never a
pass. `BASE-FAILURE.txt` is the run at the base: every test fails because `deep-physics` doesn't exist there.

## The surface under test

Exactly the #2009 suite's (its README: The surface under test): `deep-physics`'s `bake` of a `physics.world@1` document,
its `bodies` states (`pos`, `linear`, and `contact_impulse` for total_contact_impulse), with `read` and `every`. Nothing
new is named here.

## Upstream's world as ours

Upstream builds a `PhysicsWorld` (or the parts of one) with its defaults and sets only what each test names. Ours:

- `step_rate: 60` and `substeps: 4`: Rapier's default `dt` of 1/60 s (total_contact_impulse's own comment: "the default
  60 Hz timestep") and 4 solver iterations, which our substeps are (World and backend: "whose substeps are the solver's
  iterations"); gravity (0, −9.81, 0), the issue's default and upstream's `GRAVITY`.
- A collider's defaults as a contact material: friction 0.5, density 1 kg/m³, restitution 0 unless the test sets it.
  Where upstream picks `CoefficientCombineRule::Average`, the world's `combine` says `average`.
- `RigidBodyBuilder::fixed()` is a `static` body; `can_sleep(false)` is `sleep: false`; `additional_mass(1)` with
  `density(0)` is `mass: 1`.
- A joint's anchors are `frame_a.anchor` / `frame_b.anchor`; `PrismaticJointBuilder::new(axis)` is a `slider` with that
  axis on both frames; `SphericalJointBuilder` is a `ball` joint. Upstream's joints leave contacts between the joined
  bodies on, so ours set `collide_connected: true`.
- The multibody variant of total_contact_impulse hangs the body on a prismatic joint along y from a fixed anchor body at
  y = 10 that has no collider; ours is a `slider` from `"world"` at that point (our document has no multibody joint).
- total_contact_impulse loops `warmstart_coefficient` over 1, 0.5 and 0. No world field names it, and none may (it is
  Rapier's own knob, criterion 4), so each case runs once at the backend's setting; upstream's 1% bound is kept.
- upstream reads `total_impulse_magnitude()` summed over the contact pairs after 300 steps; ours reads the body's
  `contact_impulse` in its state after step 300 (the body touches only the ground).

## Criteria to tests

Each test's name starts with its criterion's ID (`#2009.<8 hex>`, as the #2009 suite's `AC` table).

| ID | File (tests) | Upstream assertion, on our bake |
|---|---|---|
| AC1 #2009.59ac371b, AC2 #2009.67d10d73 | `restitution-rapier.test.ts` (2) | a ball r 0.2 m, density 1, at y 2.3 over a 30 × 0.1 × 30 cuboid at the origin, restitution e on both, Average, 400 steps: after it first dips below y 0.35, (highest y − 0.3) ÷ 2 within 0.05 of e² for e = 0.3, 0.5, 0.8, 0.95; under 0.02 for e = 0 |
| AC2 #2009.67d10d73 | `fall-and-rest-rapier.test.ts` (2) | a body at y 10, substeps 1, 60 steps: its drop within 1e-4 × the expected of g·dt²·n(n+1)/2 (4.98675 m); a 1 kg ball (r 0.5) or cube (half 0.5) at rest on a 10 × 0.5 × 10 cuboid, free and on a slider, 300 steps: contact impulse m·g·dt (0.1635 N·s) within 1% |
| AC2 #2009.67d10d73 | `joint-stability-rapier.test.ts` (2) | 10 chains of 10 boxes (half 0.4) on sliders along (±1, 1, 0) limited to ±1.5 m, anchor 1 m up the child, 10,000 steps; a 32 × 32 net of balls (r 0.4) 1 m apart on ball joints, top row pinned at every fourth column and the last, 4,000 steps: after every 1,000 steps every body within 200 m (500 m for the net) of the origin and none faster than 100 m/s |

Test count: 2 + 2 + 2 = 6.
