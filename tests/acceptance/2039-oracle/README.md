# Acceptance tests for #2039, Oracle lane: an upstream engine's smallest-size case, pinned by commit, run against our check

Written first, blind, from issue #2039, its Oracle map (`doneright/oracles/issues/2039.md` on branch `doneright` of
DeepBuildAI/deepbuild, as saved for this job), the one upstream file it pins (read from its vendor copy), the #2039
suite's surface (`tests/acceptance/2039/README.md`, written by the same job) and base commit `dbbddd5dd`, by a job that
never saw an implementation of #2039. #136's rule applies: a linked test counts only when run against our output, so
the case builds our documents and asserts on what `deep-canvas-render check` answers, never on an engine called
directly. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criterion 3 (`#2039.87a8de22`), the one the map links an upstream test to, and only the half the map names:
"the smallest-size rule, left plus right by top plus bottom, behind the refusal of a row narrower than its corners".
The upstream file never reads a pixel, so the undrawn centre of the same criterion has no upstream test, and neither
has its planted check; both stay with `tests/acceptance/2039/`.

## Source

| Criterion | Upstream, pinned | File (lines) | Use | License |
|---|---|---|---|---|
| 3 | an upstream engine, commit `ed1daf0bf001b61586d9930840f2f1394092c079` | `tests/scene/test_nine_patch_rect.cpp` (156-175: the case "Patch margins drive minimum size") | port | MIT |

No upstream code is copied: the case's inputs and its expected value are re-expressed in the receiving file,
`minimum-size.test.ts`, which names its upstream file, commit and license.

## Run

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2039-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2039-oracle    # type-check
```

On a shared machine the first command goes through its throttle: `node scripts/throttle.mjs test --wait 60 -- node
node_modules/vitest/vitest.mjs run …`. Vitest may leave a cache: look for `tests/acceptance/2039-oracle/node_modules/`
and for `node_modules/.vitest-cache/` at the checkout's root (where `vitest list` left one for this job), and remove
it.

`helpers.ts` re-exports the #2039 suite's own tools (`../2039/helpers.ts`, `../2039/fixtures.ts`, `../2039/judges.ts`),
as the #1500 Oracle lane re-exports its suite's, so both lanes ask the same check the same way and read its answer
the same way. The one file builds `deep-canvas-render` once (`cargo build --locked --bin deep-canvas-render`, debug,
the default features) and copies it out, then sends three documents through one `check` process; with the binary
built it takes seconds. No cargo on the machine is `BLOCKED:`, a failed test. Nothing is timed, nothing is skipped,
and nothing is written outside temporary folders. **This folder needs `alone.push('tests/acceptance/2039-oracle/')` in
`scripts/lanes-lists.mjs`, with that entry under `binary` in `scripts/lanes.mjs`'s `aloneReasons`**: a suite's own
lane file is read only in a folder named by an issue's number, so this folder ships none (the #2039 README's lines for
the implementer hold it). `BASE-FAILURE.txt` is the run at the base.

## The surface under test

The #2039 suite's (its README: The surface under test): a nine-part set's `slice` and its rows' `w` and `h`, and
`deep-canvas-render check`'s refusal of a row smaller than its corners, read by that suite's `rowRefusalProblems`:
`ok: false`, an error issue that names the row (`plate#1` whole in its own fields, or the set named and `row` 1), and
one that does holds the smallest size as a whole number in its message, `what`, or its own fields. Nothing new is
named here.

## Upstream's case as ours

| Upstream | Ours | Judge |
|---|---|---|
| A nine-part rect with margins left 10, top 20, right 30, bottom 40, on no picture: its minimum size is (40, 60), "minimum width is left + right; minimum height is top + bottom" | The set `plate`, `slice: {left: 10, top: 20, right: 30, bottom: 40}`, on a one-cell atlas of 48 × 64 px, two free rows. Row 0 is 100 × 100 u in every document; row 1 is 40 × 60 u, then 39 × 100 u, then 100 × 59 u | With row 1 40 × 60 u `check` passes; 39 u wide it refuses, naming `plate#1` and 40; 59 u tall it refuses, naming `plate#1` and 60 |
| The same rect with right set to 0: its minimum size is (10, 60) | Not ported (below) | |

What is ours and not upstream's: the atlas and its cell. Upstream sets its margins on a rect with no picture; our
check refuses "a `slice` whose sides leave no texel between them", so the cell must be wider than 40 px and taller
than 60 px. 48 × 64 px leaves 8 and 4 texels. The row to name is the set's second, so a refusal that names the set
alone, or always its first row, fails. A size of exactly (40, 60) passing is upstream's meaning of a minimum and the
issue's of "the smallest": a row "narrower than left + right" is refused, and one of exactly that width is not.

One weakness of upstream's own numbers: its smallest width, 40, is also its bottom margin. An error that named row 1
and listed the slice's four sides, with no smallest width, would hold 40. Its smallest height, 60, is no other number
of the document, so the height's half has no such twin; and the #2039 suite's own row (12 u wide, smallest width 16)
holds the width's rule with numbers that don't collide.

## The case that is not ported, and why

**Right 0 giving (10, 60)**, the second half of the upstream case (lines 170 to 172). Put to our check it needs a
`slice` with `right: 0` to be a slice the check takes: only then is a row 10 u wide taken and one 9 u wide refused for
its width, with the smallest width 10. Neither the issue nor the design says whether a side of 0 is a slice. They say
`slice: {left, top, right, bottom: px}` "cuts each cell in nine parts", which a side of 0 does not, and the refusals
they list name no side of 0 either way. A test of it would hold the implementer to a choice the issue leaves open: a
check that refuses a side of 0, naming the set, would fail it for a reason no criterion names. What unblocks it: a
line in the issue or the design that says a side of a `slice` may be 0. Then the port is the same test on
`slice: {left: 10, top: 20, right: 0, bottom: 40}`: a row 10 × 60 u taken, one 9 u wide refused naming the row and 10.

## What fails it

The merge base, whose check takes a row of any size. So does a check that refuses with another smallest size than
left + right by top + bottom (twice the left side, the larger side, the cell's size), one that names the set alone or
another row, and one that refuses a row of exactly (40, 60).
