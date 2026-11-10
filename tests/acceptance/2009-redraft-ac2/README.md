# Acceptance tests for #2009, criterion 2 redrafted: free fall and rest within 2e-5 m of the discrete solution

A blind redraft (design: Dogfooding) of criterion 2's tests, by the job that wrote `tests/acceptance/2009/` and
`tests/acceptance/2009-oracle/`, from the same inputs: issue #2009 as it reads now, its Oracle page, the design and base
commit `96b462a6` (here at `b2db1552`, the base plus those two suites; no implementation of #2009). No implementation,
diff, other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

The owner changed criterion 2's bound on free fall and rest from 1e-5 m to 2e-5 m of the discrete solution. The first
suite's README had found why 1e-5 m fails a faithful program: checked against Rapier 0.36.1 directly, f32's rounding over
480 substeps puts the drop at 1 s 1.15e-5 m off ½·g·h²·N(N+1) (1.1e-5 to 1.4e-5 m from other heights), and a plain f32
loop of `v += g·h; y += v·h` gives the same numbers to the bit. The text changed, so its ID did.

## What was read

- The issue, live with `gh issue view 2009 --repo windoliver/deepbuild`; criterion 2's ID recomputed from it.
- Its Oracle page (`doneright/oracles/issues/2009.md`, branch `doneright` of `DeepBuildAI/deepbuild`) and the three
  upstream files it pins that carry criterion 2 and that the first Oracle suite ports, read again from
  `doneright/oracles/vendor/rapier-3406750a38/crates/rapier3d/tests/`: `issue_974_restitution.rs`,
  `soft_bodies.rs` (fem_free_fall_is_exact), `total_contact_impulse.rs`, `joint_stability.rs`. The page's criteria
  list still quotes the old 1e-5 m text; its upstream tests and their bounds are unchanged by the edit.
- AGENTS.md; `docs/technical-design.md` Dogfooding; `scripts/proof-change.mjs` (criterion IDs); this job's earlier
  `tests/acceptance/2009/` and `tests/acceptance/2009-oracle/` (README, helpers, the files superseded below).

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2009-redraft-ac2 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/2009-redraft-ac2/tsconfig.json
rm -rf tests/acceptance/2009-redraft-ac2/node_modules/.vite
```

Each file builds `cargo build --locked --bin deep-physics` once and copies the binary out, through `../2009/helpers.ts`
(the Oracle ports through `../2009-oracle/helpers.ts`, which re-exports it); every test passes a 60-minute timeout. No
cargo on the machine fails `BLOCKED:`, never passes. **`scripts/lanes.mjs` needs `'tests/acceptance/2009-redraft-ac2/'`
in its `alone` list** (the files build a cargo binary); the implementer makes that edit. `BASE-FAILURE.txt` is the run at
`b2db1552`: every test fails because `deep-physics` doesn't exist there.

## The surface under test

Exactly `tests/acceptance/2009/README.md`'s (The surface under test): `deep-physics`'s `bake` of a `physics.world@1`
document, its `bodies` states (`pos`, `linear`, `angular`, and `contact_impulse` for total_contact_impulse), with `read`
and `every`. Nothing new is named. The helpers are imported as they stand; the criterion IDs come from `criteria.ts`,
not from `AC` in `../2009/helpers.ts`, whose criterion 2 entry is the old ID.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criteria's IDs.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 2 `#2009.f5168c7a` | `ac2-integrator.test.ts` (4) | free fall from rest at 120 Hz × 4 substeps: at every step k ≤ 120 the drop within **2e-5 m** of ½·g·h²·N(N+1), N = 4k (4.9152 m at 1 s); a 1 m box built resting on a floor rests at 1 s (centre within 1 mm of 0.5 m) and from 1 s to 2 s stays within **2e-5 m** of that height; restitution 0.5 against 0.9 dropped 1 m under each combine rule (max, min, average, geometric, multiply): first bounce within 3% of e²h (0.81, 0.25, 0.49, 0.45, 0.2025 m); a 4 kg bob on a distance joint's spring (hz 2, damping_ratio 0, rest 1 m) from the world: period from its upward crossings of its mean over 5 s within 1% of 0.5 s; a chain of 5 ball-jointed 1 kg spheres (r 0.05 m) 0.5 m apart released level from a world pivot: over 10 s its energy never above E0·(1 + 0.01·t), and some link passes 1 m/s. Fails: an Euler other than the pinned one (explicit Euler is off by g·h·t, 0.0204 m at 1 s), a sinking rest, a wrong combine rule, a spring tuned off hz, a solver that gains energy |
| 1 `#2009.59ac371b`, 2 `#2009.f5168c7a` | `restitution-rapier.test.ts` (2) | upstream issue_974_restitution: a ball r 0.2 m, density 1, at y 2.3 over a 30 × 0.1 × 30 cuboid at the origin, restitution e on both, Average, 400 steps: after it first dips below y 0.35, (highest y − 0.3) ÷ 2 within 0.05 of e² for e = 0.3, 0.5, 0.8, 0.95; under 0.02 for e = 0 |
| 2 `#2009.f5168c7a` | `fall-and-rest-rapier.test.ts` (2) | upstream fem_free_fall_is_exact's formula: a body at y 10, substeps 1, 60 steps at 60 Hz, its drop within 1e-4 × the expected of g·dt²·n(n+1)/2 (4.98675 m); total_contact_impulse: a 1 kg ball (r 0.5) or cube (half 0.5) at rest on a 10 × 0.5 × 10 cuboid, free and on a slider, 300 steps: contact impulse m·g·dt (0.1635 N·s) within 1% |
| 2 `#2009.f5168c7a` | `joint-stability-rapier.test.ts` (2) | upstream joint_stability: 10 chains of 10 boxes (half 0.4) on sliders along (±1, 1, 0) limited to ±1.5 m, 10,000 steps; a 32 × 32 net of balls (r 0.4) 1 m apart on ball joints, top row pinned at every fourth column and the last, 4,000 steps: after every 1,000 steps every body within 200 m (500 m for the net) of the origin and none faster than 100 m/s |

Test count: 4 + 2 + 2 + 2 = 10, as many as the originals carried for criterion 2 (4 in the suite, 6 in the Oracle lane).

The Oracle ports are re-expressed from upstream as before (Apache-2.0, rapier `3406750a38286a0d3c7d0f4be2f9d53153e81d90`,
each file names its source); no upstream code is copied, and upstream's numbers are kept. How upstream's world maps to
ours (60 Hz, 4 solver iterations as substeps, Rapier's collider defaults as a contact material, `warmstart_coefficient`
run once at the backend's setting, the multibody case as a slider from the world) is `tests/acceptance/2009-oracle/README.md`'s
"Upstream's world as ours", unchanged.

## What these supersede

With the owner's approval the implementer deletes these four files, which carry the old ID `#2009.67d10d73`, once this
redraft lands, and touches nothing else of this job's:

| Superseded | By |
|---|---|
| `tests/acceptance/2009/ac2-integrator.test.ts` | `ac2-integrator.test.ts` |
| `tests/acceptance/2009-oracle/restitution-rapier.test.ts` | `restitution-rapier.test.ts` |
| `tests/acceptance/2009-oracle/fall-and-rest-rapier.test.ts` | `fall-and-rest-rapier.test.ts` |
| `tests/acceptance/2009-oracle/joint-stability-rapier.test.ts` | `joint-stability-rapier.test.ts` |

`tests/acceptance/2009/helpers.ts` keeps its `AC[2]` (the old ID) as data no test then reads; the trace lane reads test
files only.

## Setup values

Changed from the originals, only where the new text requires it:

- Free fall's bound at every step: 1e-5 m → **2e-5 m**.
- Rest on the ground, the box's height from 1 s to 2 s against its height at 1 s: 1e-5 m → **2e-5 m** (the criterion's one
  bound covers free fall and rest alike).

Unchanged: 120 Hz × 4 substeps (h = 1/480 s); free fall from rest at y = 0 with no floor, a 1 kg sphere of r 0.1 m,
compared at each of 120 steps; the rest box 1 m (half 0.5) of 1 kg on a static 60 × 0.2 × 60 floor whose top is y = 0,
centre within 1 mm of 0.5 m at 1 s; the bounce fixture (r 0.1 m, 1 kg, 1 m drop, 0.5 against 0.9, 2 s, e per rule: max
0.9, min 0.5, average 0.7, geometric √0.45, multiply 0.45); the spring (hz 2, damping_ratio 0, rest 1 m, 4 kg sphere of r
0.1 m, built at its rest length, 5 s, at least 8 upward crossings); the chain (5 links, 1 kg, r 0.05 m, 0.5 m apart along
+x from a world pivot, 10 s, I = 2/5·m·r², energy from the states above hanging straight); contact material `plain`
friction 0.5, restitution 0, density 1000; and every Oracle setup and bound as upstream has it.
