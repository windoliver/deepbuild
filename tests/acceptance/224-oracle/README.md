# Acceptance tests for #224, Oracle lane: a surface colored by its height through a color scale, run against our output

Written first, blind, from four sources:

- issue #224;
- its Oracle page, `doneright/oracles/issues/224.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the two upstream test excerpts that page pins for criterion 3, read from the vendor copy beside it;
- the #224 suite's surface (`tests/acceptance/224/README.md`, written by the same job) and base commit `c56fe5407`.

The job never saw an implementation of #224; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output, so the cases here build our documents and
assert on what `deep-show` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The page links upstream tests to criterion 3 of 11. Criteria 1, 2 and 4 to 11 have no upstream test (the page's "No
upstream test" table) and stay with `tests/acceptance/224/`.

## Sources

| Criterion | Upstream, pinned | Tests | Use | Here |
|---|---|---|---|---|
| 3 | the upstream math-film library, `a6d5cc02b430fb57d22add51236b6406fbf19d91` | `tests/test_graphical_units/test_threed.py` lines 117 to 138 and `tests/test_graphical_units/test_coordinate_systems.py` lines 60 to 77, with their control frames | port | `surface-colorscale.test.ts` (2 tests) |

**What the upstream tests check, re-expressed.** No upstream code is copied or run, and no upstream value is used but
the fixtures' own numbers. Each upstream test puts a surface on 3D axes and colors it by its z through a five-color
scale whose colors sit evenly over the z axis's range, then compares a rendered frame with its control frame. The
control frames are the upstream renderer's pixels, from its own camera, mixing between colors in RGB; we mix in OKLab
(Builder `surface`: "`color` maps a value through the ramp in OKLab per vertex"), so, as the page says, only values at
the scale's stops agree, and no frame of ours can be compared with theirs. What the tests check that holds for ours is
the coloring itself at the stops: a point whose z is a stop's value takes that stop's color. Here:

- each case is our `surface@1` over u, v ∈ [−3, 3] (x = u, y = v), parented to our `axes3d@1` (#226's: scales over
  [−3, 3], [−3, 3] and the case's z range, `up: z`) and carrying `mod.axes@1`, with `color: {by: z, ramp: [blue, green,
  yellow, orange, red], domain: the z range}`, the five roles in the #224 suite's look (#58c4dd, #83c167, #ffff00,
  #ff862f, #fc6255);
- read by `geometry` with `stage: "built"`: the builder's own positions, in the formula's numbers, and its
  `attributes.color` (OKLab, one per vertex);
- every vertex whose z equals a stop's value within 1e-12 is that stop's role color within OKLab ΔE 0.01, criterion 3's
  tolerance;
- the first upstream case: the saddle z = v²/2 − u²/2, z axis [−4, 4], stops −4, −2, 0, 2 and 4. `grid_lines: {u: 1,
  v: 1}` splits the grid at whole u and v (the upstream draws its surface's own grid), so every stop is sampled, at
  (3, 1), (2, 0), (0, 0), (0, 2) and (1, 3), and each must have a vertex;
- the second: z = 2 sin u + 2 cos v, z axis [−5, 5], stops −5, −2.5, 0, 2.5 and 5, lines every π/2; the surface
  reaches the stop 0 at (0, ±π/2) and (−π/2, 0), which must have a vertex; a vertex on another stop is held to it too;
- the planted mismatch the design asks of every comparison: the saddle with its scale reversed fails the same check,
  naming the stop at z = −4 and role blue, so the check can reject our output.

The checker half of criterion 3 is ours, with no upstream test; it stays in `../224/ac03-color-and-checker.test.ts`. The
upstream project's license is MIT as this job knows its own statement; nothing is copied, so no notice is carried.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/224-oracle --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/224-oracle/tsconfig.json
rm -rf tests/acceptance/224-oracle/node_modules/.vite
```

The file imports the #224 suite's helpers (`../224/helpers.ts`), so both lanes build and ask the same binary the same
way: `cargo build --locked -p deep-show --bin deep-show` once, copied out and deleted after. It runs on the CPU, on any
machine; no cargo is a failure starting `BLOCKED:`, never a pass. **`scripts/lanes.mjs` needs
`'tests/acceptance/224-oracle/'` in its `alone` list**; the #224 README gives the line, and the implementer makes that
edit. `BASE-FAILURE.txt` says what the tests meet at the base.

## The surface under test

The #224 suite's (its README: The surface under test), with nothing added: `deep_show`, `geometry`'s `stage: "built"`
(#420's), a row's `attributes.color`, `grid_lines` on `surface@1`, and the suite's look.
