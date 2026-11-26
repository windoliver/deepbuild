# Acceptance tests for #3360: `parity/logic/readers.board` shows its counter at zero at 0 s

Written first and blind, from issue #3360 (its body and two acceptance criteria), `AGENTS.md`,
`docs/technical-design.md` and base commit `dbbddd5dd`, by a job that saw no fix, no diff and no other session's
work. The implementer doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft.

Every call goes through `deep-show run` (#393). The fixture's document is the one the build's `manifest` lists for
`parity/logic/readers.board`, never a copy written here, so the fix may change the fixture's document or its program.

## Criteria to tests

All in `readers.test.ts`.

| Criterion | Test | What it reads |
|---|---|---|
| `#3360.5bf370a9`: `deep show` of the shipped fixture at 0s with `include: ['issues']` lists no `copy.missing` and no `flip.unmapped` issue | `#3360.5bf370a9 …` | the `deep show` reply (`t: '0s'`, `include: ['issues']`): `outcome` is `presented`, and its `issues` hold no row with code `copy.missing` or `flip.unmapped` |
| `#3360.80772b65`: at 0s `counter.presses` reads 0, so the caption shows the `labels` entry `0`, and `choices` shows its child `dot` | `#3360.80772b65 …` | after the same `deep show`, an `eval` at `t: '0s'` with `arrays: ['counter.presses']`, `texts: true`, `pixels: true`: (1) `arrays['counter.presses']` is `0`; (2) `texts.caption`, the string the caption draws, is the fixture's own `data.copy.en.labels["0"]` (`Ready`; `en` is the session's default locale); (3) in the frame's snapshot (the PNG in the evidence store, at `<sha[0..2]>/<sha[2..]>`, checked to hash to its name) the pixel at the `dot` item's `center` is not the ground's (the pixel two in from the bottom-right corner) |

The three clauses of the second criterion are soft assertions in one test, so a run reports each one.

## Notes on surfaces

- `choices` shows `dot`: no `deep-show run` reply on the base names the child a flip group shows (`eval`'s nodes
  give content hashes only, and `see`/`probe` are the app's and 3D render-back's). The test reads it from the
  pixels: where `choices` shows no child (the issue's `flip.unmapped`), the ground shows at the dot's center. A
  scratch check at the base, not part of the suite, confirmed the reading discriminates: with the shipped document
  the pixel is the ground `[255,255,255,255]`; with the same document's `flip` taken off (dot always shown) it is
  `[26,163,200,255]`. So this clause would also pass on a program that draws the dot without the flip choosing it;
  the first criterion's `flip.unmapped` check and clause (1) cover the flip's reading of 0.
- The caption's text is read from `eval`'s `texts` (#507: each text item's drawn string), the core's own reading,
  not a pixel guess.

## What the base does

`BASE-FAILURE.txt` has the run. Both tests fail at their assertions for the issue's reason: `counter.presses` is
1138747060 at 0 s, so `deep show` lists the issue's two `copy.missing` (caption, labels) and one `flip.unmapped`
(choices) with that key; the caption draws the `missing` string `Counting`, not `Ready`; and no dot is drawn.

## Run them

```sh
npm ci && npm run build --workspaces --if-present    # once, in a fresh clone
cargo build --locked --bin deep-show                  # or set DEEP_BIN_DIR to a folder holding deep-show
npx vitest run tests/acceptance/3360
node node_modules/typescript/bin/tsc -p tests/acceptance/3360/tsconfig.json   # type-check
```

The file takes about 2 s once deep-show is built, and needs no `lane.json`: it shares no port, clock or folder
with other suites (each run gets its own evidence folder under a temp directory, removed after the file).
