# Acceptance tests for #226, Oracle lane: a point placed through three scales, run against our output

Written first, blind, from four sources:

- issue #226;
- its Oracle page, `doneright/oracles/issues/226.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the one upstream test file that page pins for criterion 1, read from the vendor copy on that branch;
- the #226 suite's surface (`tests/acceptance/226/README.md`, written by the same job) and base commit `9b77cd2cd`.

The job never saw an implementation of #226; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output. So the cases here build our documents
and assert on what `deep-gpu` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

The page links an upstream test to criterion 1 of 8. Criteria 2 to 8 have no upstream test (the page's "No upstream
test" table) and stay with `tests/acceptance/226/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 1 | the upstream math-film library, `a6d5cc02b430fb57d22add51236b6406fbf19d91` | `tests/module/mobject/graphing/test_axes_shift.py`, lines 30 to 63: its 3D axes test and its log twin | port | `point-through-three-scales.test.ts` (2 tests) |

**What the upstream test checks, re-expressed.** No upstream code is copied or run, and no upstream value is used.
The upstream test places a point through a 3D axes' three scales and asserts it lands where each of the three axes
places its own coordinate, once with linear scales and once with log scales. Here:

- each point is a `mark.point@1` parented to our `axes3d@1` and carrying `mod.axes@1`, at its coordinates (a, b, c);
- "where an axis places a coordinate" is the axis's tick at that value, its `at` in the `axes` report (the #226
  suite's Assumed surfaces 2), so each coordinate is chosen on a tick;
- "lands there" is measured along that axis's own direction, û from its first tick to its last:
  (P − T(v)) · û = 0 within 1e-6 m, the criterion's tolerance, for each of the three axes, so the test holds wherever
  the axis lines are drawn;
- with our numbers: linear domains [−4, 4], lengths [8, 8, 8] m, `up: z`, the points (2, 3, 1) (criterion 1's) and
  (−4, −4, −4) (the domains' start corner, the corner the upstream test places); the log twin over [1, 1000] on all
  three axes, the points (10, 1000, 100) and (1, 1, 1) (the start corner).

The page calls the z-up convention ours: "Turning math z into world +Y and math y into world −Z is our convention,
with no upstream test", so this lane checks only that a point reads its numbers through the three scales; criterion
1's (2, 1, −3) is `../226/ac1-point-at-its-numbers.test.ts`'s. The upstream project's license is MIT as this job knows
its own statement; nothing is copied, so no notice is carried.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/226-oracle --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/226-oracle/tsconfig.json
rm -rf tests/acceptance/226-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #226 suite's helpers (`../226/helpers.ts`), so both lanes build and ask the same binary
the same way. The file builds `cargo build --locked --bin deep-gpu` once and copies it out; off macOS it fails
INCONCLUSIVE, never passing. **`scripts/lanes.mjs` needs `'tests/acceptance/226-oracle/'` in its `alone` list**; the
#226 README gives the line, and the implementer makes that edit. `BASE-FAILURE.txt` says what the tests meet at the
base.

## The surface under test

The #226 suite's (its README: The surface under test and Assumed surfaces 1 to 3), with nothing added: `view3d` with
`world` (each point's position in world space) and `axes` (each tick's `at`).
