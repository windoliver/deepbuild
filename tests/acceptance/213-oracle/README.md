# Acceptance tests for #213, Oracle lane: upstream ray-query tests, pinned by commit, run against our output

Written first, blind, from issue #213 (`gh issue view 213 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/213.md` on branch `doneright` of DeepBuildAI/deepbuild), the two upstream files that page
pins (read from its vendor copies under `doneright/oracles/vendor/`), the #213 suite's surface
(`tests/acceptance/213/README.md`, written by the same job) and base commit `fe5a88f17`, by a job that never saw an
implementation of #213; none existed, and no other worktree, branch, pull request or plan was read. #136's rule applies:
a linked test counts only when run against our output, so every case here builds our scene, world and logic item and
asserts on what `deep-show run` answers through physics.cast@1, never on an engine called directly. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 1 (`#213.170f7e56`), the one the page links upstream tests to. The other seven have none (the page's
"No upstream test" table) and stay with `tests/acceptance/213/`, as do the parts the page calls ours: answering
against the state step 30 read, the service registry, its timing after a step, fuel, traps and mirror reads.

## Sources

| Criterion | Upstream, pinned | File (case) | Use | License |
|---|---|---|---|---|
| 1 | the upstream engine, commit `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | its 3D crate's `tests/query_pipeline_subshapes.rs` (ray_hits_report_the_triangle) | port: `ray-box.test.ts` | Apache-2.0 |
| 1 | the upstream geometry library, commit `3383f51cbbe9af70565427e7a66c605e1557c1fc` | its 3D crate's `tests/geometry/cuboid_ray_cast.rs` (shape_ray_cast_points_to_surface) | port: `cuboid-rays.test.ts` | Apache-2.0 |

No upstream code is copied: each case's scene and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and keeps upstream's numbers where our document can hold them (1e-4 m for a time of
impact, 5 m out, 1 mm in and out, the four shapes, 1,000 rays a shape, about 1 rotation in 100 the identity).

Left out of query_pipeline_subshapes: the triangle a mesh hit reports and its back face (our worlds hold no mesh shape a
service names a triangle of; a hit's `address` is the shape use), and point projections and shape casts (point
projection is no service request; sweeps are no criterion's). Left out of cuboid_ray_cast: its last assertion, a second
ray cast from the point nudged out, which no criterion's reading needs.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/213-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/213-oracle/tsconfig.json
rm -rf tests/acceptance/213-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #213 suite's helpers, fixtures and programs (`../213/`, read only), so both lanes build and
ask the same binary the same way: each file builds `cargo build --locked -p deep-show --bin deep-show` once and copies it
out; programs are assembled by #544's assembler; every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs
`'tests/acceptance/213-oracle/'` in its `alone` list**; the implementer makes that edit (the #213 README says so too).
No cargo is `BLOCKED:`, never a pass; nothing here is timed. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

The #213 suite's (its README: The surface under test): a scene's world beside a logic item declaring
`services: {"physics.cast@1": {max_per_step}}`, the services region's ray request and hit layouts, `deep-show run`'s
`logic` call with its `handles`, and the step records' arrays. Nothing new is named here. The suite's `caster` program
asks its batches of rays (a data segment in the program) at steps 1, 2, …, up to 250 a step, and copies each answer's
hit count and first hit (body handle, distance, point, normal) into its arrays at the step that reads it.

## Upstream's cases as ours

- **ray_hits_report_the_triangle** casts a ray down onto a mesh over a box and requires the hit to name the collider
  struck, its time of impact within 1e-4 of 5; then a query filter excludes the mesh and the same ray must pass on to the
  box, at 9.5. Ours: a world of two static 1 m blocks along +x, `near` (faces at 5 m) a member of collision group
  `front`, `far` (faces at 9 m) of `back`; two rays from the origin along +x, one over every group, one over `back` alone
  (the request's `groups` mask). The first's first hit names near at 5 m within 1e-4 m and it meets both blocks; the
  second's one hit names far at 9 m within 1e-4 m.
- **shape_ray_cast_points_to_surface** casts 1,000 seeded rays from 5 m out toward the centre of a ball of radius 1, a
  cube of half-side 1 and boxes of half-sides (1, 1, 0.5) and (0.5, 1, 0.5), each turned by a seeded rotation per ray,
  and requires each hit point, moved 1 mm along the hit's normal inward, inside the shape, and 1 mm outward, outside.
  Ours: one world of 100 static bodies, each shape at 25 seeded rotations (a seeded quaternion of components in [0, 1),
  the identity when a draw is under 0.01), 30 m apart; 40 seeded rays at each body, from its centre plus 5 m along a
  seeded direction of the positive octant toward its centre, max 10 m (no other body within reach): 1,000 a shape. The
  hit point is upstream's, the ray's origin plus its unit direction times the distance read; inside and outside are this
  test's own geometry of the body as the world document places it. Each hit must also name the body aimed at, and the
  point the service reports must be that point within 1e-4 m.
