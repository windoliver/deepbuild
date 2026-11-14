# Oracle lane for #1966: the pinned upstream list test, run on our code

Written first, blind, from issue #1966, its Oracle page (`doneright/oracles/issues/1966.md` and `cases/1966.json` in
`DeepBuildAI/deepbuild` branch `doneright`, as saved for this job), the one upstream file that page pins, `AGENTS.md`, the
design (`docs/canvas-primitives.md`: Text `text@1` and its `list` field) and base commit `c56fe540`, by a job that never
saw an implementation. #136's rule applies: a linked test counts only when run against our output, so the file's
assertion is ported onto what `deep-canvas-render` answers for the file's own words. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft (design: Dogfooding).

The Oracle page links an upstream test for 1 of 2 criteria, criterion 2 (`#1966.bbe0ca22`), "run on our code". Criterion
1 has none (the page says why: highlight dimming and look roles are our own); nothing here. Our own test of criterion 2
is `tests/acceptance/1966/list.test.ts`, with the judge this lane reuses.

## Source

| Criterion | Upstream, pinned | Use |
|---|---|---|
| 2 | the upstream project's commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1`, `css/CSS2/lists/list-style-position-021.xht` | run on our code |

The file is one list item set with an outside marker in a box with a 50 px left padding; its two lines are the same
words, split by a line break. It passes "if the two lines of text … are directly lined up with each other and there is a
single bullet to the left of the lines of text". Nothing of it is copied into this folder: it is read in place.

## Where the lane reads the file, and how a fresh checkout gets it

The lane reads `<oracles>/vendor/<pin>-2f57f45d21/css/CSS2/lists/list-style-position-021.xht`, the vendor folder whose name
ends in the pinned commit's first ten digits, where `<oracles>` is the folder `doneright/oracles/` of branch `doneright` of
DeepBuildAI/deepbuild (the byte-for-byte copy of the pins under `vendor/`). It is `$DEEP_ORACLES` when set, else
`../deep-oracles/doneright/oracles` beside this checkout (#1965's lane's `ORACLES`, imported). A fresh checkout gets it with:

```sh
git fetch origin doneright && git worktree add ../deep-oracles origin/doneright   # or: DEEP_ORACLES=/path/to/doneright/oracles
```

If the file is missing the test fails with `BLOCKED: the pinned upstream file … is missing …` and that one unblock ask
(#1965's lane's `vendored`, imported). It never passes and is never skipped. The lane makes no network call.

## Run

```sh
npm ci                      # once, if node_modules is missing
DEEP_ORACLES=<path> PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH \
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1966-oracle --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1966-oracle      # type-check (exits 0)
```

The file builds `deep-canvas-render` once (#467's `useBin`). A run with `--root` leaves
`tests/acceptance/1966-oracle/node_modules/.vite`; delete it. The folder imports `../1965-oracle/helpers.ts` and
`../1966/helpers.ts` by path.

`BASE-FAILURE.txt` is the run at the base: the one test fails at its own assertion for missing behavior.

## The surface under test

`deep-canvas-render raster {out, doc, look, t: 0}` → `texts.steps = {shown, glyphs}` and the PNG (see
`tests/acceptance/1966/README.md`, The surfaces under test). The item is `text@1` `steps` with the file's two lines
joined by a space as its one item, `font: body`, `size: 16`, `paint.fill.role: ink`,
`list: {marker: bullet, indent: <the file's padding-left, 50>}`, and `box: {w: indent + W + 2, h}` with
`autosize: height` and `overflow: mask` (drawn whole, as `tests/acceptance/1966/README.md` reads it), at `at.pos [60, 40]`,
where W is the width our renderer sets the file's first line in alone (the largest `x + advance` of
its glyphs, drawn as a plain `text@1` in the same face and size).

## Criteria to tests

| ID | Upstream | Tests and assertions |
|---|---|---|
| AC2 `#1966.bbe0ca22` | list-style-position-021.xht | `outside.test.ts` (1). The file is read: its style sets the marker `outside` and a `padding-left` in px; its item's text, split at its line break with white space collapsed, is two lines. Set as above on our code, the item takes exactly two visual lines (the file's two); the second's first glyph starts within 0.5 u of the first's ("lined up with each other"); and left of that x the PNG has exactly one marker, beside the first line, and none beside the second ("a single bullet to the left of the lines of text"): #1966's `listFailures`, whose plants `list.test.ts` runs |

Wrong programs the assertion fails: no marker (the base's program: `list` drawn as plain lines); the wrapped line set
under the marker or at the item's left edge; a marker beside each line; a marker inside the text's column; an item that
doesn't wrap at a box one first line wide.

## Readings where the issue and design leave a choice

- **The file's line break**: our list has no break inside an item (each `\n` starts an item), so the file's two lines are
  one item wrapped by its box, one first line wide after the indent. Both lines are the same words, so the wrap falls
  where the file breaks it whether a renderer counts the indent inside `box.w` (the text gets W + 2 u) or outside it
  (W + 52 u: one more word fits on the first line, and the rest still fits on the second); two lines either way.
- **The padding** is our `indent`: the file's text starts 50 px inside its box with the marker outside the item's own
  box, in that padding; our text starts `indent` in from the item's left with the marker in the indent.
- **The face and size** are ours (`body`, 16 u, the file's default size), and the box and marker colors aren't the
  file's (a blue box border is only where the file's reader looks).

## Not tested, because the page says no upstream test applies

Criterion 1 (highlights dimming and the `#line:4` anchor while the code scrolls), numbered markers, and inside markers.
