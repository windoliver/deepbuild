# Acceptance tests for #2014, Oracle lane: the pinned height field's cell split, run against our output

Written first, blind, from four sources:

- issue #2014;
- its Oracle page, `doneright/oracles/issues/2014.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the one upstream file that page pins, read from the vendor copy on that branch;
- the #2014 suite's surface (`tests/acceptance/2014/README.md`, written by the same job) and base commit `35df4523f`.

The job never saw an implementation of #2014; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output. So the case here builds our document and
asserts on what `deep-show` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The page links an upstream source to criterion 1 of 2. Criterion 2 has no upstream test (the page's "No upstream test"
table) and stays with `tests/acceptance/2014/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 1 | the upstream physics library, `3383f51cbbe9af70565427e7a66c605e1557c1fc` | `src/shape/heightfield3.rs`: `triangles_at` (lines 338 to 410), with `x_at`, `z_at` and the unit cell sizes (lines 223 to 230 and 576 to 583) | formula | `triangles-at.test.ts` (1 test) |

**The formula, re-expressed.** No upstream code is copied or run. As the 505 oracle lane does with formulas, the
receiving file writes out which corners form each of a cell's two triangles, in upstream's own indexing, and names it
after its function:

- rows i run along z and columns j along x;
- cell (i, j) spans x from x_at(j) to x_at(j + 1) and z from z_at(i) to z_at(i + 1);
- x_at(j) = (−0.5 + j ÷ columns) × scale.x, so the samples lie centred on the shape's origin;
- a cell not flagged to zigzag is (p00, p10, p01) and (p10, p11, p01), split along p10–p01, the diagonal from (x0, z1)
  to (x1, z0);
- a cell flagged to zigzag is (p00, p10, p11) and (p00, p11, p01), split along p00–p11.

The page calls the fixture and its planted twin ours: "No upstream test checks a renderer and a physics shape against
each other". The license is Apache-2.0 as this job knows the upstream project's own statement; the vendor copy holds no
license file. Nothing is copied, so no notice is carried.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2014-oracle --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2014-oracle/tsconfig.json
rm -rf tests/acceptance/2014-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #2014 suite's helpers (`../2014/helpers.ts`), so both lanes build and ask the same binary
the same way. The file builds `cargo build --locked --bin deep-show --no-default-features --features full` once and copies
it out, and every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs `'tests/acceptance/2014-oracle/'` in its
`alone` list**; the #2014 README gives the line, and the implementer makes that edit. `BASE-FAILURE.txt` says what the
test meets at the base.

## The surface under test

The #2014 suite's (its README: The surface under test), with nothing added:

- a `plate@1 {terrain}` document shown by the working agent through `deep_show`;
- its drawn triangles from the `geometry` row (`positions`, `indices`);
- `terrain_rays`' `physics` for rays straight down.

## Criterion to test

The test carries criterion 1's ID, `#2014.13d18756`, the one the page links this source to.

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#2014.13d18756` | `triangles-at.test.ts` | `triangles_at(i, j)`: a cell's two triangles, split along p10–p01 unless flagged to zigzag, then along p00–p11 | See the list below |

What ours does:

- The fixture is a 4 × 4 m terrain plate at 1 m spacing. Its field (x × z + x) × 0.125 twists every cell by 0.125 m,
  so the two splits differ everywhere off a cell's diagonals.
- Every cell's drawn triangles must be exactly one of the formula's two pairs, at the field's heights.
- Rays fall straight down at four points of each cell, off both its diagonals: (¼, ½), (¾, ½), (½, ¼) and (½, ¾) of
  its side. Where they meet the physics height-field shape, they must lie on the formula's surface for that cell's
  drawn pair, within 1e-6 m.

## Fixture and numbers

`plateDoc` of `../2014/helpers.ts`:

```
ground: plate@1 {terrain: {height: "(position.x * position.z + position.x) * 0.125",
                           size: [4, 4], spacing: 1, tile: 4, lod_levels: 1}}
```

- The 25 samples sit at whole metres from −2 to 2.
- Their heights are multiples of 1/8 m, from −0.75 to 0.75.
- The field isn't symmetric in x and z, so a shape built with them swapped is off at the samples.
- At each probe point the two splits differ by 1/32 m.
- Every height and point here is a multiple of 1/32 m, exact in f32, so a backend in f32 meets it exactly.

## Wrong programs

| Wrong program | What catches it |
|---|---|
| a cell drawn one way and met the other | every probe of that cell is 1/32 m off, naming the cell |
| a cell drawn otherwise than as two triangles along a diagonal (four round a centre vertex, a finer grid) | neither of the formula's pairs |
| heights other than the field's, or x and z swapped, in the drawing or the physics shape | the drawn triangles miss the formula's points, or the physics hits leave its surface |

The judges are run in the file on planted sets before the binary is asked for (`judgesFailTheirPlants`), so a judge
that passes everything can't pass the file. Those sets are:

- the formula's default split, drawn and met, passes;
- drawn default and met zigzag fails at all 64 probes;
- a cell drawn as four triangles fails as neither pair;
- the #2014 suite's planted sets read as the formula's splits: its `anti` split is upstream's default, and its `main`
  split, the base's `plate@1` grid, is upstream's zigzag.

The binary's planted builder, `terrain_splits_other_diagonal`, is run by `tests/acceptance/2014/` (criterion 1's second
test), not here.

## Readings where the port leaves a choice

- **Default or zigzag, per cell.** The formula lets each cell take either, by its status flag. The test lets the plate
  choose per cell. It requires only that drawing and the physics shape choose the same.
- **Removed triangles** (upstream's left and right triangle flags) have no counterpart in a terrain plate and are left
  out.
- **The tolerance**, 1e-6 m, is the criterion's.

## Not tested

The rest of the upstream file (its feature IDs, its pseudo-normals, its AABB queries). Criterion 1's rest_on and pick
readings, which the formula doesn't speak to; the #2014 suite holds them.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
