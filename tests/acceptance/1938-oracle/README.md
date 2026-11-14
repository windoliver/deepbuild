# Acceptance tests for #1938, Oracle lane: the WCAG 2 contrast ratio, run against render.contrast

Written first, blind, from four sources:

- issue #1938;
- its Oracle page, `doneright/oracles/issues/1938.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the WCAG 2 definitions of relative luminance and contrast ratio, which the pinned tests hold (the vendored test files
  themselves were not read);
- the #1938 suite's surface (`tests/acceptance/1938/README.md`, written by the same job) and base commit `23baa43b4`.

The job never saw an implementation of #1938; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output. So the case here builds our document and
asserts on what `deep-show` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

The page links an upstream source to criterion 1 of 2, for its text-under-4.5:1 fault. Criterion 2 has no upstream test
(the page's "No upstream test" table) and stays with `tests/acceptance/1938/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 1 | the upstream accessibility library, `e797173108eadfa4355fe06af331791734e1757f` | `test/commons/color/has-valid-contrast-ratio.js`, `test/commons/color/get-contrast.js`, `test/checks/color/color-contrast.js` | port | `contrast.test.ts` (1 test) |

**The formula, re-expressed.** No upstream code is copied or run. The receiving file writes out WCAG 2's definitions,
which the linked tests hold the library to:

- each sRGB channel c of 0..1 is c ÷ 12.92 at or below 0.03928, else ((c + 0.055) ÷ 1.055)^2.4;
- relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B;
- contrast ratio = (L_lighter + 0.05) ÷ (L_darker + 0.05), the same either way round;
- normal text needs at least 4.5:1 (large text 3:1, which no fixture uses).

Its self-checks are values of that definition: black on white 21:1, a colour on itself 1:1, either order alike, and the
two greys either side of 4.5:1 on white: #767676 (4.54, passes) and #777777 (4.48, fails). Nothing is copied, so no
notice is carried.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1938-oracle --no-file-parallelism
npx tsc -p tests/acceptance/1938-oracle/tsconfig.json
rm -rf tests/acceptance/1938-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #1938 suite's helpers (`../1938/helpers.ts`), so both lanes build and ask the same binary
the same way: `cargo build --locked --bin deep-show --no-default-features --features full` once, copied out, a 60-minute
timeout. The #1938 README gives the `scripts/lanes.mjs` line that puts this folder in the `alone` list. The fixture is
2D and draws on the CPU, so nothing here needs a GPU. `BASE-FAILURE.txt` says what the test meets at the base.

## The surface under test

The #1938 suite's (its README: The surface under test), with one reading added: **a `render.contrast` failure names
the ratio it measured**, as `ratio` on the issue, as `actual.ratio`, or as `actual` itself, a number (Check input: loop
kinds: "Each code kind returns numbers").

## Criterion to test

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#1938.f19b61dd` | `contrast.test.ts` | the WCAG 2 contrast ratio and its 4.5:1 floor for normal text | See below |

What ours does:

- The fixture is the #1938 contrast pair (`contrastPair`): a 48 px body caption on a board's ground, in the `muted`
  role (planted) and the `ink` role (twin), drawn in the shipped clean look's light theme.
- The roles' colours are read from the look as the binary ships it (`crates/deep-canvas-marks/looks/clean.json`):
  ground #ffffff, muted #8b8f97, ink #1b1d22. By the formula muted on ground is 3.24:1, under 4.5, and ink on ground
  16.86:1; the test checks both before it asks the binary.
- `render.contrast` must fail the muted caption with an issue by `render.contrast` naming `caption`, and the ratio it
  names must lie within 0.1 of the formula's 3.24; it must pass the ink caption with nothing raised.

## Wrong programs

| Wrong program | What catches it |
|---|---|
| a ratio without the 0.05 flare, or on gamma-encoded values, or the channels weighted equally | the self-checks (21:1, the two greys), and the measured ratio off the formula's by more than 0.1 |
| a ratio measured from antialiased edge pixels or the box's mean, not the text's colour | the measured ratio off the formula's |
| a floor other than 4.5:1 for normal text (3:1, say) | the muted caption, 3.24:1, passes |
| the base: render.contrast unregistered | BLOCKED, not FAIL |

## Readings where the port leaves a choice

- **0.03928.** WCAG 2 writes the linear segment's knee at 0.03928; the sRGB standard's 0.04045 gives the same ratios
  for every colour here, since none has a channel between the two.
- **The tolerance**, 0.1 in the ratio (3%), allows for a measure taken from pixels whose 8-bit values round, and no
  more: a measure that mixes the text's edges with the ground lands further off.

## Not tested

The rest of the upstream tests (their alpha blending, large-text 3:1, pseudo-element and background-image cases), APCA,
and `subject_ratio`, which the formula doesn't speak to.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs` (the #1938 README gives it). Nothing else.
