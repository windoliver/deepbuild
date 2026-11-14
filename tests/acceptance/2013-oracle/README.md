# Acceptance tests for #2013, Oracle lane: the upstream tests the issue pins, run against our output

Written first, blind, from issue #2013, its Oracle page (`doneright/oracles/issues/2013.md`), the one upstream file
that page pins as a port (SciPy's `scipy/stats/tests/test_qmc.py`, lines 938 to 968, read from the vendor copy), the
#2013 suite's surface (`tests/acceptance/2013/README.md`, written by the same job) and base commit `7c5e1cc8`, by a job
that never saw an implementation of #2013; none existed, and no other worktree, branch or pull request was read. #136's
rule applies: a linked test counts only when run against our output, so every case here builds our document and
asserts on what `deep-show` answers, never on SciPy called directly. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to 2 of the 3 criteria. This lane ports criterion 3's and is BLOCKED on criterion 1's.
Criterion 2 has no upstream test and stays with `tests/acceptance/2013/`.

## Sources

| Criterion | Upstream, pinned | File (tests) | Use | License | Here |
|---|---|---|---|---|---|
| 3 | scipy `e4e854eaa8f18d807cd3496028e257e36caa93cc` | `scipy/stats/tests/test_qmc.py:938-968` (TestPoisson: test_mindist, test_fill_space) | port | BSD-3-Clause | `poisson-mindist-scipy.test.ts` (2 tests) |
| 1 | blender `0a185570987c77ae54d4f77fa7888f08609e2b96` | `tests/files/modeling/geometry_nodes/points/distribute_points_poisson.blend`, `point_distribute.blend` | needs Blender | GPL | **BLOCKED**, no test |

**Criterion 3, ported.** No SciPy code is copied or run. The receiving file re-expresses the two tests' rule, the least
pairwise distance of a Poisson-disk sample is at least its radius, on our `distribute`, and keeps upstream's numbers:
the radii's range 0.08 to 0.2, the cap of 50 samples, radius 0.2 with rtol 1e-6, and the bounds none, [−5, 5]² and
[1.1, 5.1]². It names the upstream file, its commit and its license, and carries SciPy's BSD-3-Clause notice
(AGENTS.md: ported code keeps its license notice in the receiving file). The notice is SciPy's `LICENSE.txt` as this
job knows it; the vendor copy given held only the test file, so the notice's wording wasn't compared with the pinned
commit's.

**Criterion 1, BLOCKED.** The page's two files are `.blend` goldens of Blender's Distribute Points on Faces. They can
be opened only by Blender, can't be fed our output, and aren't data our code reads. Blender is GPL, so nothing of it is
ported (AGENTS.md: never port GPL code). No test here passes for this row, and none stands in for it. The one unblock
ask: a runner that opens the two goldens in Blender at the pinned commit, outside this repo, and writes their points
and minimum distance as plain data, so a test here can hold our scatter to the same rule. The page itself says pruning
by prototype bounds, sibling order and cross-machine equality "are not tested there"; those stay with
`tests/acceptance/2013/`.

Left out of the port:

- **Upstream's dimensions.** test_mindist samples in 1, 3 and 4 dimensions. Our scatter is over a part's area, so each
  case is the plane.
- **Upstream's `hypersphere: volume | surface`.** It chooses how SciPy draws candidates. Our distribute has no such
  field.
- **Upstream's five radii** are drawn from a seeded NumPy generator. NumPy isn't run here, so the five are spread
  evenly over the same range: 0.08, 0.11, 0.14, 0.17 and 0.2.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2013-oracle --no-file-parallelism
npx tsc -p tests/acceptance/2013-oracle/tsconfig.json
rm -rf tests/acceptance/2013-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #2013 suite's helpers (`../2013/helpers.ts`), so both lanes build and ask the same binary
the same way: the file builds `cargo build --locked --bin deep-show --no-default-features --features full` once and
copies it out, and every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs
`'tests/acceptance/2013-oracle/'` in its `alone` list**; the implementer makes that edit (the #2013 README gives the
line). `BASE-FAILURE.txt` says what each test meets at the base.

## The surface under test

The #2013 suite's (its README: The surface under test), with nothing added: a `scene` document whose `instance@1` is
fed by `from: {distribute: {on, mode: "poisson", min_distance, seed, max?}}` over a flat `plate@1`, shown by the
working agent through `deep_show`, and read back by the `geometry` call's row for the instancer,
`elements: [{id, proto, pos}]`. Here `max: 50` is also written, the issue's `max: u32` ("it can never exceed max").

## Criteria to tests

Both tests carry criterion 3's ID, `#2013.2dab09c8`, the one the page links this upstream test to.

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#2013.2dab09c8` | test_mindist | 50 samples over the unit hypercube for each of five radii in [0.08, 0.2]: at most 50 samples, least pairwise distance ≥ radius | a poisson scatter over a 1 × 1 m plate on [0, 1]² with `min_distance` the radius and `max: 50`, for radii 0.08, 0.11, 0.14, 0.17 and 0.2: at most 50 points, at least 2, least pairwise distance ≥ radius × (1 − 1e-6) |
| `#2013.2dab09c8` | test_fill_space | radius 0.2, the plane filled inside no bounds, [−5, 5]² and [1.1, 5.1]²: least pairwise distance ≥ radius × (1 − 1e-6) | a poisson scatter with `min_distance: 0.2` over a 1 × 1 m plate on [0, 1]², a 10 × 10 m plate on [−5, 5]² and a 4 × 4 m plate on [1.1, 5.1]² (x and z for upstream's two axes): at least 2 points, least pairwise distance ≥ 0.2 × (1 − 1e-6) |

All five radii's documents go to one `deep-show run` process, and all three plates' to another.

## Fixtures and their numbers

`poissonDoc` of `../2013/helpers.ts`: a flat `plate@1` of the given size centred on the square's centre (`at.pos`),
one hidden 0.1 m prototype, and the instancer `stones` with seed 2013. The base's `geometry` call reads the 1 × 1 m
plate as moved to (0.5, 0, 0.5) and the 4 × 4 m plate to (3.1, 0, 3.1), so each covers its square (seen with the
base's binary).

## Wrong programs

A sampler that places two points closer than its radius fails both tests. One that ignores `max` fails test_mindist's
cap. An empty scatter, or a single point, fails "at least two points". The least-pairwise-distance judge is run in the
file on the planted sets of the #2013 suite (`judgesFailTheirPlants`: the 0.5 m lattice passes, the lattice with a
point 0.4 m off fails), so a judge that passes everything can't pass the file.

## Readings where the port leaves a choice

- **rtol.** Upstream's test_mindist asserts with no rtol and test_fill_space with 1e-6 ("to accommodate Accelerate").
  Both of ours use 1e-6: an instancer's `pos` is a column of f32.
- **At least two points.** Upstream's least pairwise distance has no value for fewer; a scatter of none or one would
  otherwise pass.
- **test_mindist's "at most 50"** is our `max: 50`. Upstream asks its engine for 50 samples.
- **"No bounds"** is SciPy's default, the unit square.

## Not tested

What the page calls ours, and the #2013 suite holds: the empty-disc rule, the density mask and the planted ten-point
sampler. Also SciPy's other TestPoisson cases, which the page doesn't pin.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
