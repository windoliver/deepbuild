# Acceptance tests for #406: honest numbers: story numbers, quotes by raw bytes, and numbers inside formulas

Written first, from issue #406 (its scope, its Honest numbers fields, its four acceptance criteria and its proof
line: "The story number passing and failing by context, the CRLF quote's byte range, and the formula refused, then
passing once mapped"), the design sections it names and those they lean on, and base commit `881e2ed4` ("Merge pull
request #1136 …"), by a job that never saw an implementation; none existed. The issue's Oracle line says no upstream
test checks these criteria. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Honest numbers (76) and its check (8862: the fields `names`, `quotes`, `formulas`,
  `sources`; "an unsourced number fails, naming the item"; "the check lists it as a story number"; "a quote's digits
  are quotation, found in its display text and listed by their raw byte ranges"); the glossary rows for quote and story
  number (192, 250); The status-color rule (68: a return card is a view of the record; "A document shown inside another
  takes its host's status map"); Document envelope (`data: {name → … | {value, source}}`, `assets`); Text `text@1` and
  its code form (1383, 1433: `raw`, `quote: {source, path, lines}`, the display form's steps, `quote_mismatch`); Vector
  and formula `vector@1` and its quote (1814, 1838: `alt`, `numbers: {text → source path}`); Cell grid (2385).
- At the base: AGENTS.md; `crates/deep-canvas/src/document/rules.rs` (`number_unsourced`, a story constant through a
  template slot refused where a status or a reading is bound), `crates/deep-canvas/src/template.rs`,
  `crates/deep-canvas-marks/src/check.rs` (`numbers`), `crates/deep-marks-render/src/lib.rs` (`check`'s answer),
  `crates/deep-gpu-layer/src/host.rs` (#382's `host` call); `tests/acceptance/381/`, `397/`, `398/` and `382/`.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/406 --no-file-parallelism
npx tsc -p tests/acceptance/406/tsconfig.json   # type-check (exits 0)
```

Each file first runs `cargo build --locked --bin deep-canvas-render` (and `story.test.ts` also `--bin deep-gpu`) and
copies the binary out of `target/debug`; a test whose build failed fails with cargo's error. The files run one at a
time, so `scripts/lanes.mjs` lists `'tests/acceptance/406/'` in `alone`. Node built-ins and vitest only; temporary
folders under the OS temp folder are deleted after each test. A run with `--root` leaves Vitest's cache in
`tests/acceptance/406/node_modules/.vite`; delete it.

`BASE-FAILURE.txt` is the run at the base: all 7 tests fail, each for missing behavior (below).

## The surfaces under test

- **`deep-canvas-render check {doc, look: "clean", store?}`** (#373's, #397's and #398's surface, unchanged): one JSON
  line in, one out, `{ok, issues: [{code, severity, ids, path, actual, what, fix}], numbers, notices}`. `store` is the
  folder #398's vectors are read from, each file named by the sha256 of its bytes; the quote's source and the
  formula's SVG are put there.
- **`deep-gpu run`'s `host` call with `kind: "return_card"`** (#382's surface, the only one at the base that shows a
  document inside a view of the record): `{call: "host", kind, look, size, doc: path, frames: 1}`, the look #382's
  fixture look with a status map. A document whose check fails is refused before anything is drawn, as host.rs answers
  it: `{ok: false, code, issues}`.

## Where a listing is read

The design names what the check lists (a story number, quotation, notation) but fixes no JSON path, and the base's
`numbers` list (#397) holds only mark sets' numbers. So a number counts as **listed** when some object in the check's
answer outside `issues` holds the number's text (`"3"`, `"2"`) as one of its own members and, in itself, in its
ancestors' own members or in the keys on its path, the item's ID (or `<id>#…`) and the listing's word, matched
case-insensitively: `story` for a story number, `quot` (quotation, quote) for quotation, `notation` for notation; and,
for AC3, the raw byte range as `[11, 12]` or an object of exactly those two numbers. `{item: "cfg", text: "3", as:
"quotation", bytes: [11, 12]}` in `numbers` passes, and so does `quotation: [{item, text, bytes}]` at the top level.

## Criteria to tests

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 | A story number passes in an art film with no bindings, and fails naming the item once the film binds a status or a reading, or once it's shown inside a document that does, such as a return card | `story.test.ts` (2). The film (`profile: film`) shows `Round {data/round}` in `round-label`, `data.round = {value: 3, source: "story"}`. **(alone, bound)** `check`: no error, `ok`, and `round-label`'s `3` listed as a story number; with a verdict bound to a rect's fill, and separately with a reading bound into a text of its own, `ok` false and a `number_unsourced` error whose `ids` hold `round-label`. **(return card)** the same film through `host` `return_card`: `ok: false` and a `number_unsourced` error naming `round-label` |
| AC2 | A number on screen that isn't computed in the document or bound fails the audit naming the item; a name with digits passes only when marked as a name | `names.test.ts` (1). `eta` types `Arrives in 3 days`, `model` shows `T-800`. Unmarked: `ok` false, `number_unsourced` naming `eta` and naming `model`. With `model`'s params `name: true`: `number_unsourced` still names `eta`, and no error names `model` |
| AC3 | In a quote of a CRLF line that starts with a tab and reads retries = 3 # café with a decomposed é, honest numbers lists the 3 as quotation with the raw byte range that holds it and counts no number, and a twin whose raw bytes differ from the source by one byte fails quote_mismatch, never honest numbers | `quote.test.ts` (2). The source is 23 bytes: `09`, `retries = 3 # cafe`, `CC 81`, `0D 0A`; the 3 is byte 11. The code item `cfg`: `font: mono`, `code: {language: python}`, `raw` the same line, `quote: {source: <sha256>, path: "config/retry.py", lines: [1, 1]}`, the source listed in `assets`. **(quotation)** no error, `ok`, and `cfg`'s `3` listed as quotation with `[11, 12]`. **(twin)** `raw` with LF in place of CR LF (22 bytes): `ok` false, `quote_mismatch` naming `cfg`, and no `number_unsourced` |
| AC4 | A formula whose alt is `n = 1.33` fails honest numbers, naming 1.33 and the item, and passes once its vector maps `1.33` to `data/n_water` with a source; `a^2 + b^2 = c^2` passes with 2 listed as notation | `formula.test.ts` (2). The `vector@1` item `eq` over `fixtures/formula.svg`. **(refused, mapped)** `alt: "n = 1.33"`: `ok` false, a `number_unsourced` error naming `eq` whose fields other than `fix` hold `1.33`; with `numbers: {"1.33": "data/n_water"}` and `data.n_water = {value: 1.33, source: <a URL>}`: no error, `ok`. **(notation)** `alt: "a^2 + b^2 = c^2"`: no error, `ok`, and `eq`'s `2` listed as notation |

Wrong programs the assertions fail: a check that lists nothing (AC1, AC3, AC4); one that passes a story number on a
return card (AC1); one that refuses every bound document for another reason (AC1: the code and the item are read); one
that ignores a name mark, or treats the mark as clearing the whole document (AC2: `eta` still fails); one that counts
a quote's digits (AC3: `number_unsourced` would fire), lists display offsets (the tab expands to 4 columns, putting
the 3 at 14), or compares display text (the twin draws the same); one that leaves `alt` unscanned or counts a
formula's integers (AC4).

## Readings where the issue and design leave a choice

- **"Fails naming the item"** is an error with code `number_unsourced` (the base's honest-numbers code, and the one
  #381's and #397's suites read) whose `ids` hold the item's ID. "Naming 1.33" is `1.33` appearing in the issue's
  fields other than `fix` (as `actual`, or in `what`); the exact field is the implementer's.
- **"Shown inside a document that does, such as a return card"**: a return card is a view of the record, so it binds
  status whatever the film binds; the test shows the film, binding nothing, through #382's `host` `return_card`. The
  film has no camera: the 2D check refuses a 3D camera's params (`module_missing`), and the host checks revision 1
  before it frames anything, so a check that refuses the story number answers first. At the base the host's check
  passes and the call is refused later with `{code: "ref_unresolved", reason: "camera"}`, which has no `ok: false`
  and no issues.
- **"A marked name"** is `name: true` in the text item's `params` (the field list's `{name: true}` on a text item; the
  item's own `name` is its accessible name). The `names: [string]` form is not tested; one marking suffices.
- **The quote**: the source is the one line, so raw offsets and file offsets agree; `[11, 12]` is half-open, as #397's
  `bytes` are. The code item carries no `text`: the design maps its text from `raw`. The source is put in `store`, the
  base's asset store by sha256. "Differ by one byte" is the dropped CR: the design checks "line ends included", and the
  twin draws the same.
- **The formula's source** for `data/n_water` is a URL string; the envelope's `{value, source}` fixes no form.

## BLOCKED, INCONCLUSIVE and not tested

- AC1's return-card test runs `deep-gpu`, which opens a Metal device only after its check; nothing here times
  anything, so nothing is INCONCLUSIVE.
- Not tested, because no criterion asks: the `names: [string]` form, number words, a cell grid's recording as
  quotation, a formula's `quote` against LaTeX lines, `quote_mismatch`'s line and byte, the other hosts (`lod_open`,
  `sheet_cell`), precision and fit, and an unquoted code item's digits counting as numbers.
