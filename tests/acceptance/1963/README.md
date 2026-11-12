# Acceptance tests for #1963: code and formula quotes, shown code and a formula's alt held to their source's bytes

Written first, from issue #1963 (its scope, its fields, its two acceptance criteria and its proof line), the design
sections it names and those they lean on, and base commit `4004257c` ("Merge pull request #2246 …"), by a job that
never saw an implementation; none existed. The issue's Oracle line says no upstream test checks these criteria. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Text `text@1`: code (`raw`, `quote: {source: ev handle | asset sha256, path, lines: [a,
  b]}`; "a quote compares raw bytes, never the display text … or it fails `quote_mismatch` naming the first line and
  byte that differ"; "its digits are quotation, which honest numbers lists and never counts, while an unquoted code
  item's digits count as numbers"); Vector and formula `vector@1` and its quote ("At check its `alt` must equal those
  lines' bytes, line ends included"; "A formula without a quote reads as the agent's own"; it can never "quote a
  source that isn't evidence or an asset"); Honest numbers, the summary and the check (`quotes`, `formulas`,
  `sources`); the glossary row for quote; Document envelope (`assets: {id → {sha256, license}}`, `data`).
- `docs/technical-design.md`: Films and figures on the canvas ("A formula may quote the LaTeX lines it was rendered
  from, such as a paper's source kept as evidence"; "code quoted from a commit must match it"), the handles line
  (`ev:<sha256>` for an evidence file), and Dogfooding.
- At the base, for the surface only: AGENTS.md; `tests/acceptance/406/` (README, helpers, quote and formula tests);
  `crates/deep-marks-render/src/lib.rs` (`check`'s request and answer, the `store` and `evidence` request fields) and
  `asset.rs`; `crates/deep-canvas-marks/src/check.rs` (`quotes`); `crates/deep-canvas-vector/src/lib.rs` (`numbers`,
  to see the listing's shape, so the no-source test doesn't trip on it); `crates/deep-canvas/src/document/rules.rs`'s
  test of an unquoted code item.

## Run

```sh
npm ci                      # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # where cargo lives on this Mac
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/1963 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1963/tsconfig.json   # type-check (exits 0)
```

Each file first runs `cargo build --locked --bin deep-canvas-render` and copies the binary out of `target/debug`; a
test whose build failed fails with cargo's error. Both files build the same binary, so they run one at a time
(`--no-file-parallelism`): the lane entry belongs in `scripts/lanes.mjs`'s `alone`, which the implementer adds. Node
built-ins and vitest only; temporary folders under the OS temp folder are deleted after each test. A run with `--root`
leaves Vitest's cache in `tests/acceptance/1963/node_modules/.vite`; delete it. With no built `deep` CLI in the
checkout, `scripts/lease` runs the command unleased and says so.

`BASE-FAILURE.txt` is the run at the base (below: Base run).

## The surface under test

**`deep-canvas-render check {doc, look: "clean", store, evidence}`** (#373's, #398's and #406's surface): one JSON
line in, one out, `{ok, issues: [{code, severity, ids, path, actual, what, fix}], numbers, notices}`. `store` is the
asset store, a folder whose files are named by the sha256 of their bytes; `evidence` is the evidence store, whose
files sit at `<first 2 hex>/<other 62 hex>` (the request field #397 added, which every command at the base already
takes). The AC2 test that names no source sends two lines to one process.

## How evidence reaches the check

The design says a document never names a path; only the request does. A code item's source is an asset by sha256,
put in `store` as #406's suite does. A formula's source is "a paper's LaTeX source kept as evidence", so its quote
names it by its handle, `ev:<sha256>` (technical design: handles), and the document lists no asset for it. The request
carries the evidence file's bytes in both stores, under its sha256 in `store` and under `<2 hex>/<62 hex>` in
`evidence`, so a check may resolve the handle from either; which store it reads is plumbing the design leaves open,
and the tests hold only what the criteria do. A check that resolves no `ev:` handle fails the pass case (the source
can't be read) or the mismatch case (no `quote_mismatch`).

## Where a line is named

The design names "the first line and byte that differ" but fixes no field. An issue **names line n** when, outside
its `fix`, some member whose key holds `line` (`line`, `first_line`, …) has the value n, at any depth (`actual: {line:
11, byte: 0}` passes), or its `what` or `path` says `line n` (`at line 11`, `#line:11`), n not followed by a digit.
Line numbers are the source file's, as the criteria count them: AC1's quote holds lines 10 to 12 and names line 11,
not the quote's second line; AC2's names line 4, not the alt's second line.

## Where a listing is read

#406's reading, kept: the design fixes the word (quotation) but no JSON path, so a number counts as **listed as
quotation** when some object in the check's answer outside `issues` holds the number's text (`"3"`, or the number 3)
as one of its own members and, in itself, its ancestors' own members or the keys on its path, the item's ID (or
`<id>#…`) and a word matching `quot` (quotation, quote), case-insensitively. `{item: "retry-fn", text: "3", source:
{quotation: …}}` passes.

## Criteria to tests

| ID | Criterion (the issue's text) | Tests and assertions |
|---|---|---|
| AC1 | A code item quoting lines 10 to 12 of a file at a commit fails quote_mismatch naming line 11 when its raw bytes differ from that line's, and passes otherwise with its digits listed as quotation; the same code unquoted fails honest numbers naming the item | `code.test.ts` (3). The file is a 15-line Go file, `retry/retry.go` at a commit, in `store` by sha256 and listed in `assets` (the commit in the asset's ID). The code item `retry-fn`: `font: mono`, `code: {language: go}`, `raw` lines 10 to 12 (the function `Default`; line 11 is `\treturn Policy{Attempts: 3, Wait: 250 * time.Millisecond}`), `quote: {source: <sha256>, path: "retry/retry.go", lines: [10, 12]}`. **(passes)** no error, `ok`, and `retry-fn`'s `3` and `250` each listed as quotation. **(twin)** line 11's tab replaced by four spaces, which draw the same at the default tab of 4: `ok` false, and a `quote_mismatch` error naming `retry-fn` that names line 11. **(unquoted)** the same item with no `quote` (and no asset): `ok` false and a `number_unsourced` error naming `retry-fn` |
| AC2 | A formula whose `quote` names lines 3 to 4 of a paper's LaTeX source kept as evidence passes when its `alt` equals those lines' bytes, and fails quote_mismatch naming line 4 when one byte of its `alt` differs there; the same formula with no `quote` names no source | `formula.test.ts` (3). The paper's source is a 5-line LaTeX file, `paper/refraction.tex`, kept as evidence (above). The `vector@1` item `eq` over a three-term SVG in `store`, `alt` lines 3 and 4 with their line ends, `\[ n_1 \sin\theta_1` LF `   = n_2 \sin\theta_2 \]` LF, and `quote: {source: "ev:<sha256>", path: "paper/refraction.tex", lines: [3, 4]}`. **(passes)** no error, `ok`. **(one byte)** the alt with a tab in place of line 4's first space, the same length: `ok` false, and a `quote_mismatch` error naming `eq` that names line 4. **(no quote)** in one process, the quoted formula, then the same document (same document ID) with its quote taken out: the second answer has no error, `ok`, holds neither the paper's sha256 (so no `ev:` handle) nor its path anywhere, and lists neither of `eq`'s numbers (`1`, `2`) as quotation |

Wrong programs the assertions fail:

- A check that compares display text, or text with its whitespace normalized: AC1's twin draws the same as the file
  (a tab at column 0 against four spaces), and AC2's twin differs by one whitespace byte.
- One that ignores a formula's `quote`: AC2's one-byte twin passes.
- One that names the wrong line: the quote's own line count (2 in both twins), the first line of the quote (10, 3), or
  its last (12).
- One that counts a quote's digits as unsourced (AC1 passes case: `number_unsourced` fires), or lists none (no
  quotation listing).
- One that skips an unquoted code item's digits (AC1 unquoted: nothing fails).
- One that resolves no evidence handle: AC2's pass case can't read its source, or its twin raises no
  `quote_mismatch`.
- One that makes a quote mandatory on a formula, or names a source for an unquoted one: by a cache kept by item or
  document ID across requests (the quoted revision is checked first in the same process), or by looking the alt up
  among the stored files (the paper's bytes are in both stores when the unquoted one is checked).

## Readings where the issue and design leave a choice

- **"A file at a commit"** is the file's bytes as they stood at that commit, an asset by sha256 with `path` its path in
  the repo, as #406's quote is; the quote has no commit field, so the commit is named only in the asset's ID. The
  issue's words keep evidence for AC2 ("kept as evidence"), so AC1 doesn't use an `ev:` handle.
- **The quote's source holds the one file**: `source` is that file's bytes and `path` names it; `lines` count from 1 in
  it. A source holding many files, with `path` choosing one, is not tested.
- **"Fails quote_mismatch"** is `ok: false` with an error whose code is `quote_mismatch` and whose `ids` hold the item.
  **"Fails honest numbers naming the item"** is an error with code `number_unsourced` (the base's honest-numbers code,
  which #406's suite reads) whose `ids` hold the item.
- **"Passes"** is no issue of severity error, and `ok`.
- **"One byte of its alt differs there"** is one byte substituted, the length kept: the first byte of line 4, a space,
  as a tab.
- **"Names no source"**: the design says "A formula without a quote reads as the agent's own". So the same document
  with the quote taken out passes as the agent's own formula, its answer holds neither the paper's sha256 (and so no
  `ev:` handle) nor its path, and none of its numbers is listed as quotation. It may still list its integers as notation,
  which the base lists as `source: {notation: "alt"}`, so the test doesn't refuse the word `source` itself.
- **The code item** carries `code: {language: go}` only, as #406's did, and no `text`: the design maps its text from
  `raw`.

## Base run

`BASE-FAILURE.txt`: 6 tests, 1 fails and 5 pass; the build and both files ran, and nothing broke in the tests
themselves.

- **AC1, all three pass at the base**, as the issue says: "Most of the code quote is on main from #406" (a quote by
  asset sha256 checked by raw bytes, `quote_mismatch` naming the first line and byte, a quote's digits listed as
  quotation). The unquoted branch isn't in the issue's list of what #406 landed, but it is on main too:
  `crates/deep-canvas/src/document/rules.rs` tests that an unquoted code item's digits count. These tests keep that
  behavior from regressing while the formula quote lands beside it.
- **AC2, the one-byte twin fails for the expected reason**: the base never reads a formula's `quote`, so the check
  passes (`ok: true`, no issues) where the criterion wants `quote_mismatch` naming line 4.
- **AC2, the pass case passes at the base**, since the base ignores the quote: it fails no program that skips the
  quote. It fails a different wrong program: a check that refuses every quoted formula, reads the wrong lines, drops
  the line ends, or can't resolve the `ev:` handle. With the twin, it pins the comparison from both sides.
- **AC2, the no-quote case passes at the base**, which quotes no formula and so names no source. It holds what must
  stay true once quotes land: the unquoted formula reads as the agent's own.

## BLOCKED, INCONCLUSIVE and not tested

- Nothing here times anything, so nothing is INCONCLUSIVE.
- Not tested, because no criterion asks: a code quote by `ev:` handle, a run's output as a source, a source that is
  neither evidence nor an asset, the byte a `quote_mismatch` names, a quote's raw byte ranges (#406's AC3), a raw held
  as an asset, tokens, diffs and the gutter, and the proof line's film.
