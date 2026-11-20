# Acceptance tests for #194, Oracle lane: upstream FNV-1a vectors and CSV files run against our probe

Written first, blind, from issue #194 (`gh issue view 194 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/194.md` on branch `doneright` of DeepBuildAI/deepbuild), the upstream files that page pins
(read from `doneright/oracles/vendor/go-022c863611/…` and `…/csv-spectrum-b251546d5c/…` at that ref), the #194 suite's
surface (`tests/acceptance/194/README.md`, written by the same job) and base commit `6f225f46d`, by a job that never saw
an implementation; none existed, and no other worktree, branch, stash or PR was read. #136's rule applies: a linked test
counts only when run against our output, so every upstream case here is asserted against what `deep-catalog pack`
answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criteria 1 and 9, the two the page links upstream sources to. The rest of each criterion (the layout's packing,
the logic item's read, the planted packers, the checks' results) stays with `tests/acceptance/194/`.

## Sources

| Criteria | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 1 | go `022c8636110ebac86a9b88724cda168ed713c21f` | `src/hash/fnv/fnv_test.go` lines 56-61 (golden32a) and 95-97 (TestGolden32a) | port | BSD-style (Copyright 2011 The Go Authors) |
| 1, 9 | csv-spectrum `b251546d5ccb79217a61aa8ca623ce573977d7e1` | `csvs/*.csv` and `json/*.json`, all eleven pairs | run on our code | the project's own |

No upstream code is copied. The four golden32a pairs are copied into `fnv-go.test.ts` with their test's name, file,
lines and commit. The eleven CSV files and their JSON records are copied byte for byte into `fixtures/csv-spectrum/`
(CRLF line ends kept; the test fails `BLOCKED:` if a checkout normalized them).

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces          # once, in a fresh worktree
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/194-oracle --testTimeout=3600000 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/194-oracle/tsconfig.json
rm -rf tests/acceptance/194-oracle/node_modules
```

Each file builds `cargo build --locked -p deep-catalog --bin deep-catalog` once (the #194 suite's helpers, imported),
honoring `CARGO_TARGET_DIR`. Folders go under the OS temp folder (`dc194-*`) and are deleted after their file. The
folder belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/194/` (the implementer adds the line; the
#194 README names it). Nothing here depends on time, load or Docker.

## The surface under test

The #194 suite's: `deep-catalog pack` (`{op: "pack", tables: {<table>: {path}}, schema, out}` → `{ok, sha256, size,
ms, record}`), the bytes read by table.layout@1's doc and the As built rules (`../194/helpers.ts` `layoutOf`,
`judgeLayout`), the record's `tables[].hash` and `missing`.

## Criterion 1: Go's TestGolden32a, ported (`fnv-go.test.ts`)

FNV-1a 32 of "", "a", "ab", "abc" is 811c9dc5, e40c292c, 4d2505ca, 1a47e90b. A catalog of three tables named a, ab and
abc, each with its ID column `a`, columns `ab` (i32) and `abc` (f64), and rows a, ab and abc: the packed directory's
table name hashes, each table's column name hashes and each ID column's values are exactly the three golden hashes,
rising (1a47e90b, 4d2505ca, e40c292c); the record names the tables by them; the row found by the golden hash of ab in
table ab holds what was written for it; `judgeLayout` holds. The "" vector checks the suite's own hash, a precondition
(`BLOCKED:` if it disagrees), since no name can be empty. Wrong programs it fails: FNV-1 in place of FNV-1a, another
basis or prime, another encoding, signed ordering.

## Criteria 1 and 9: csv-spectrum, run on our code (`csv-spectrum.test.ts`)

The catalog holds no text column, so a CSV cell's text is read back through the probe two ways: an ID as its hash in
the ID column, and a `ref` to an ID no row holds as the record's `missing` entry, `ref` the cell's text as written.
Each file is one table `spectrum`: its ID column the first column whose JSON values are plain (`[\w.-]+`), distinct and
non-empty *(chosen)*, every other column `ref spectrum`. For each of the eleven files:

- **Criterion 1** (the CSV route): `judgeLayout` of the CSV's pack against the JSON records as rows (an empty value
  empty): each ID's hash in the ID column in hash order, each other value either the row it names, or 0xFFFFFFFF with a
  `missing` entry holding exactly its text (quoted commas, newlines, CR LF, doubled quotes, UTF-8), and an empty value
  0xFFFFFFFF with no entry.
- **Criterion 9** (the JSON lines route): the same records as JSON lines (an empty value as null) pack to the CSV's
  SHA-256, and meet the same judge.

*(chosen reading)*: an ID and a ref are any text the cell holds, raw (Asset: tables: "a text cell keeps its raw
bytes"); a ref's text is never trimmed or normalized. Wrong programs it fails: a reader splitting a quoted comma or
newline, keeping quotes or a doubled quote, dropping a CR inside quotes, trimming a cell, reading a quoted empty cell as
a value, dropping a last line with no line end; a JSON lines reader that differs from the CSV reader.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `fnv-go.test.ts`, `csv-spectrum.test.ts`,
`fixtures/csv-spectrum/{csvs,json}/` (the eleven upstream pairs).
