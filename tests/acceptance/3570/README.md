# Acceptance tests for #3570: public tables come in as they are published

Written first, blind, from issue #3570 as saved for the job on November 27, 2026 (its opening paragraph, Runs on line,
Scope, Fields, nine acceptance criteria, Proof, Not in scope and Depends on), the design sections it links (Asset:
tables, Asset job: imports, Pack: assets fetched on first use, Honest numbers, read with `node
scripts/design-section.mjs --issue 3570`), AGENTS.md, and base commit `2daec1c4b`
(`2daec1c4b501caa600f6d8c3a400f4ca623f8945`), by a job that never saw an implementation, a diff of one, or any other
worktree, branch, stash or pull request. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus the three planted readers
the Proof line names and the Scope's fifth zip refusal.

## Files

| File | Criterion | Tests |
|---|---|---|
| `ac1-county.test.ts` | `#3570.d751be37`: the 600,000-row pipe file cut to 3 columns and 3,200 rows; receipt counts; peak under 128 MB | 1 |
| `ac2-zip-member.test.ts` | `#3570.dabc4318`: a zip's member to the same table hash; the other member's table and hash; planted `takes_first_member` | 2 |
| `ac3-zip-refusals.test.ts` | `#3570.090eb211`: encrypted, nested, `../x.csv`, 3 GiB bomb, each refused by name with nothing written; Scope: a path held twice | 2 |
| `ac4-workbook.test.ts` | `#3570.c30fc78d`: the named sheet's 5 rows, B6 as its stored 250, `formula_cells` 1, no stored value is missing; planted `evaluates_formulas` | 2 |
| `ac5-missing.test.ts` | `#3570.9251b800`: `(D)` listed is missing and counted; unlisted is refused naming row and column; planted `reads_marker_as_zero` | 2 |
| `ac6-group.test.ts` | `#3570.39c1c79a`: `1,234` refused in a plain column, 1234 under `group: ","` | 1 |
| `ac7-encoding.test.ts` | `#3570.df4af9a2`: 0xE9 is `é` under latin-1, refused under utf-8 naming the row | 1 |
| `ac8-trace.test.ts` | `#3570.112c972a`: one machine's table; the label passes honest numbers with a bound reading, traced to URL and fetch time; the Mac pair; a Linux host | 4 |
| `ac9-budget.test.ts` | `#3570.1144aef4`: one timed import of the 40 MB file, judged once | 1 |
| `helpers.ts` | the world (hub, deep mcp, cli socket, HTTPS file server, data pack), the fetch, the import, readers of what it writes, the plants, the check, the judges | |
| `fixtures.ts` | every fixture's generator, and `node tests/acceptance/3570/fixtures.ts <folder> [--large]` to write them | |
| `plant/` | the planted readers' entry (`plant.mjs.fixture`) and plug-in (`index.ts.fixture`) | |
| `twins.json`, `lane.json` | each criterion's ID to its planted names; the folder runs alone | |
| `BASE-FAILURE.txt` | the suite run once at the base | |

## Run them

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub runs packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 sh scripts/lease cargo build --locked -j 6 -p deep-hook -p deep-marks-render --bin deep-hook --bin deep-canvas-render
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 sh scripts/lease cargo build --locked -j 6 --bin deep-show   # the canvas core a data pack's install needs
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3570 --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/3570/tsconfig.json
```

The hub won't start without the debug `deep-hook`; `deep install` of a data pack needs the canvas core, the debug
`deep-show`; criterion 8's check is the debug `deep-canvas-render` (all from `target/debug`; a test names what it
lacks with `BLOCKED:`). Each file starts its own hub in a temp home under
`/tmp/dh3570-*` (criterion 8's two) and stops every process it started by its PID. Node built-ins, openssl for a test CA,
and vitest. No network past 127.0.0.1, no model, no GPU, no app. The folder runs alone (`lane.json`).

Nothing missing passes (invariant 2): a hub that doesn't start, a pack that doesn't install, a fetch that never lands or
a binary not built fails with a line starting `BLOCKED:`; a peak no scan read, a timing off a fit reference Mac and a
second machine not given fail with `INCONCLUSIVE:`.

## The surface under test

The issue names `import.from: table {…}`, its params, the receipt's fields and what each refusal names. It names no call
shape, output, receipt place or wording. **Every name marked *(chosen)* is this job's choice**, the least the criteria
need; the implementer builds exactly these, or a dispute goes to a blind redraft. A right implementation that differs
only in a refusal's sentences passes: refusals are matched by what the criterion says they name, never by a sentence.

### The fetch: a published file, by hash

Each test publishes its files the way a pack lists assets fetched on first use (#1820): an HTTPS server on 127.0.0.1
under a test CA the hub trusts (`NODE_EXTRA_CA_CERTS`) serves them, and a data pack `agency/tables<n>@1.0.0`, installed
with `deep install <folder>`, lists each by `url`, `sha256`, `size`, CC0 license and `upstream`. The test calls
`deep_kinds {op: "fetch", pack, asset}`, answers its one authority ask yes on the trusted path (`deep inbox answer`),
and calls again until it answers `{status: "fetched", asset: {sha256}}`. That path is the base's: a probe at the base
fetched `labels.csv` and the 42 MB `county.txt` through it (the server answers byte ranges, `Content-Range`, an ETag and
`If-Match`, as the Source block reads a large file). Nothing is fetched by the job.

### The job

- The kind is **`import`** in `packages/jobs/import`, installed with `deep install packages/jobs/import` (the base's).
  deep_job's list names exactly one tool of the kind whose name matches **`^table[a-z0-9_-]*@\d+\.\d+\.\d+$`**
  *(chosen)*, e.g. `table-import@1.0.0`, registered through `deep.registerJobTool('import', …)` with `run {dir, entry}`.
- A run *(chosen: params flat beside `from`, as `from: urdf` sits beside `look`; the file is the kind's input `file`,
  given by its fetched hash)*:

  ```json
  {"op": "run", "kind": "import", "tool": "table-import@1.0.0",
   "params": "{\"from\":\"table\",\"format\":\"csv\",\"delimiter\":\"pipe\",\"columns\":{\"GEO_ID\":{\"from\":\"GEO_ID\",\"dtype\":\"str\",\"unit\":\"text\"},\"NAME\":{\"from\":\"NAME\",\"dtype\":\"str\",\"unit\":\"text\"},\"POP\":{\"from\":\"POP\",\"dtype\":\"i64\",\"unit\":\"people\"}},\"key\":\"GEO_ID\",\"where\":[{\"column\":\"GEO_ID\",\"prefix\":\"0500000US\"}]}",
   "inputs": [{"name": "file", "sha256": "<the fetched file's hash>"}]}
  ```

  The Scope's field names and spellings: `member`, `format: csv | jsonl | xlsx`, `delimiter: comma | tab | pipe`,
  `sheet`, `encoding: utf-8 | latin-1`, `columns: {name → {from: header text, dtype: str | i64, unit, missing, group}}`,
  `key`, `where: [{column, prefix} | {column, in}]`. A column's `from` is always its header text (never an index),
  `dtype` the table probe's `str` or `i64`, and every column carries a `unit` string *(chosen: the Scope gives `unit`
  no default)*. `header`, `max_bytes` and `encoding` are left at their defaults unless a test says.
- **The table** is the output named **`table`** *(chosen)*, read by hash from the hub's evidence store
  (`<home>/.deepbuild/evidence/<2 hex>/<62 hex>`) as CSV with its header first, or JSON lines (one object a row) when
  its first line is an object. A missing cell is an empty CSV cell, a JSON null or a key left out. Its columns are
  the params' column names; their order and the other outputs' names aren't read.
- **The receipt** *(chosen: wherever it is first found)*: the reply's `receipt` when it holds `rows_read`, else the
  first other output that is a JSON object holding `rows_read` (or `{receipt: {rows_read, …}}`). Read: `rows_read`,
  `rows_kept`, `missing.<column>` (a count), `formula_cells`, and `member` matched as `{path, sha256, bytes}` (more
  fields allowed), `sha256` and `bytes` being the unpacked member's.
- **Peak memory** *(chosen)*: the reply's own `receipt.used.memory_peak_mb`, the supervisor's scan of the tool's run
  (#3220's `Used`) as the hub writes it, beside `kind`, `tool`, `key` and `cache`. A tool's word is never read for it:
  the field is the hub's receipt, not an output. Null or absent reads `INCONCLUSIVE:`; 0 fails.
- **A refusal** is the base's: `{status: "refused", reason: text}` with no `outputs`. Criterion 3 also holds the hub's
  evidence store to the same files before and after (every path under it, `tables/` included).

### What each refusal names (matched on `reason`)

| Refused | `reason` must hold |
|---|---|
| encrypted zip (`county.csv` with flag bit 0) | `/encrypt/i` |
| `member: "inner.zip/county.csv"` | `inner.zip` |
| `member: "../x.csv"` | `../x.csv` |
| the bomb's `big.csv` | `big.csv`, and `max_bytes` or `2147483648` or `2 GiB` (`/max_bytes\|2147483648\|2 ?GiB/i`) |
| a path held twice (Scope) | `county.csv` |
| `(D)` unlisted (criterion 5) | the row, and `pop` as a word |
| `1,234` in a plain column (criterion 6) | the row, and `pop` as a word |
| 0xE9 under utf-8 (criterion 7) | the row |

**"Naming the row"** *(chosen)*: the reason holds, as a whole number, the row's line in the file (header line 1), its
data row counted from 1 or from 0, or the row's key: line 58 or 57 or 56 or `48201` (criterion 5), 12, 11, 10 or
`20077` (6), 7, 6, 5 or `30011` (7).

### The planted readers

The judge of each is the kind's qualification, run by `deep install` with no person, as #3035's suite plants tools.
`helpers.ts` `plant()` makes a plug-in at test time: one tool for the kind `import`, registered under **the table
tool's own descriptor** (read from the import plug-in's default export called with a `deep` that only records), with
two fields changed: its `tool`, and its `run.entry`, `deep-3570-plant.mjs` (`plant/plant.mjs.fixture`), laid with
`deep-3570-plan.json` in a copy of the table tool's folder. That entry runs the table tool's own entry with stdin,
stdout and stderr handed through and **`DEEP_3570_PLANT=<plant name>` in its environment** *(chosen)*, and exits as it
does. **What the implementer adds**: the table tool, seeing `DEEP_3570_PLANT`, reads wrong exactly as the plant is named,
and does nothing else differently. `runs-as-is@1.0.0` sets nothing: it must qualify and be listed, which shows the
judge passes the right reader through the planted entry.

| Plant (`twins.json`) | Tool | Reads wrong | Criterion | At install |
|---|---|---|---|---|
| `takes_first_member` | `takes-first-member@1.0.0` | a zip's first member, whatever `member` names | 2 | refused (exit ≠ 0), not listed |
| `evaluates_formulas` | `evaluates-formulas@1.0.0` | a formula cell as its computed value | 4 | refused naming the cell: `B6` as a word, or both `Total` and `pop`; not listed |
| `reads_marker_as_zero` | `reads-marker-as-zero@1.0.0` | a cell equal to a `missing` marker as 0 | 5 | refused, not listed |

The kind's qualification holds, for `from: table`, **this suite's `sum.xlsx`, byte for byte** *(chosen)*, with
`sheet: Counties` and the two columns criterion 4 imports, so the formula plant's refusal names B6. Its other fixtures,
one a form each with a planted defect (Scope), are the implementer's: a zip whose named member isn't its first, and a
table with a listed marker in a numeric column, at least.

### The trace (criterion 8)

`deep-canvas-render check` with `{doc, look: "clean", evidence: <the hub's evidence store>}` (#397's and #406's
surface; its table columns are read through the resolver the hub's render-back shares, `deep-marks-vello`'s
`tables`, from `<evidence>/tables/<sha256>.json` beside the bytes). The document: one `marks@1` text mark set, `n: 1`,
showing the table's one `POP` cell from the asset `pop` by hash, and a reading bound into a text of its own
(`bound_values`, #406's form). It must answer `ok: true` with no error issue, and in `numbers` an entry with
`item: "label"` and `text: "10014009"` whose `source`, as JSON, holds the fetched file's URL, and a key `fetched`
anywhere in it whose value is a time *(chosen: ms or s since the epoch, or ISO 8601)* between your yes and the fetch
landing, ±1 s. How the source reaches the URL (inline, or through `job {kind, tool, input}`) isn't read.

### Two machines (criterion 8)

- **The Mac pair** (any Mac): a second hub in a clean home, its own server and CA, fetches and imports the same file;
  the table is the same hash and the same bytes. This is a first leg, not two machines.
- **This Mac and a Linux aarch64 host**, as #2892's suite names one: `DEEP_LINUX_AARCH64` (ssh destination) and
  `DEEP_LINUX_AARCH64_DIR` (a built checkout of the tested commit there, debug `deep-hook` included). The test runs
  `DEEP_3570_LEG=/tmp/deep-3570-leg.txt node node_modules/vitest/vitest.mjs run --root tests/acceptance/3570 ac8-trace.test.ts -t "one machine"`
  there over ssh, reads the line `#3570 table sha256 <hex>` that leg writes to that file, and compares. Without the two variables it reads
  **`INCONCLUSIVE:`**, never PASS; a host that prints no hash reads `BLOCKED:`.

### The budget (criterion 9)

One reading (AGENTS.md: a budget is best effort under load): a fresh hub's import of the 40 MB file, a cache miss,
timed from deep_job's call to its reply. On a fit reference Mac (`scripts/benchmark.mjs`'s `references` by model, chip
and memory; mains power, Low Power Mode off, thermal state nominal) at a one-minute load at most its cores: PASS within
5,000 ms, FAIL over. Anywhere else **`INCONCLUSIVE:`** with the reading, the load and the machine. The perf lane's
`benchmarks/budgets.json` isn't read *(chosen: the issue names no task)*.

## Fixtures

All written by `fixtures.ts`, none committed; the same bytes on every run (no clock or locale; every zip time
2026-01-01 00:00). `node tests/acceptance/3570/fixtures.ts <folder> --large` writes and hashes them. Zips and the
workbook's container are written byte by byte, deflate by Node's zlib.

| File | Bytes | SHA-256 | What |
|---|---|---|---|
| `county.txt` | 42,001,211 | `3ce01a7b217c711c841388b31d5e342ae7d37c47394912477f89eba9f342bc14` | seed **3570** (xorshift32): header of 30 columns (`GEO_ID`, `NAME`, `POP`, `C04`…`C30`), 600,000 rows; 3,200 counties `0500000US` + 5 digits at seeded places; 300 `0500000UT…` and 300 `X0500000US…` decoys; the rest `1400000US` + 6 digits; `NAME` the row number in base 36, `POP` 1–99,999, the rest a digit or empty |
| `two-members.zip` | 12,801,670 | `56b7a4468827f767370f38d6fbf79ad73bc4cd837499d5fe906acd12e76e9eab` | `a/towns.txt` first, then `county.txt` as `data/county.txt`, both deflated |
| `towns.txt` | 1,174 | `594b8d8f4bacb8bff3773a437ae503e0b2329c2763a2048c32f1fcbf78a0ebc6` | `GEO_ID\|NAME\|POP`, 40 rows, 12 counties |
| `encrypted.zip` | 193 | `d43bef3e34929165846a70dd94c85a71b8f1d07d48c7bafcf087094692c47fb6` | `county.csv`, flag bit 0 set, its bytes stored plain |
| `nested.zip` | 303 | `0676ded1dfe72f3292ce459d4e4592fc1617f5ac0f336b915372b21b06a292a2` | `inner.zip` (stored) holding `county.csv` |
| `dotdot.zip` | 183 | `f868609256cf5967755beb260a581000c61ca7ff02c07c88965e5affa6d8a53d` | `../x.csv` |
| `twice.zip` | 337 | `6efcfb009b9403b91646b7699fcba7be373d930259c58b535f2eb38d5559883f` | `county.csv` twice, other bytes each time |
| `bomb.zip` | 3,188,870 | `3515b48a166cba747cf14f467f40c9d881a48f90e0020508af5f5eae91089f30` | `big.csv`: `fips,name,pop` and line ends to 3,221,225,472 bytes (3 GiB), 3,188,758 deflated; its headers state 3,188,758 as its unpacked size |
| `sum.xlsx` | 2,423 | `ef8da2b41976e9485621719b5b9d14ac9378df65f8cd2234cf883a1e2bd4f9b0` | sheets `Notes` (7 rows) then `Counties`: `name`, `pop`; Adams 50, Baker 60, Clay 70, Dade 80, Total `=SUM(B2:B5)` stored 250 |
| `blank.xlsx` | 2,420 | `c75eccacf980017345acba910c3b1fe11ae3a1c25fa2bcb28ddca5a4bd49d8b0` | the same, B6 with no stored value |
| `marker.csv` | 1,902 | `90f66de2453441ae70549709419dd971475d9ff86f66df7991674e107d5d07b0` | 100 rows `fips,name,pop`; line 58 (`48201`) pop `(D)` |
| `groups.tsv` | 384 | `3af797d9836f5a19201a46a189055e21d5243479c772e305521c1febfd388579` | 20 rows, tab; line 12 (`20077`) pop `1,234` |
| `latin1.csv` | 183 | `0edefd4d34751d766d95e10b9e140a65dd3ec9a3fd93d3cd066082bf438de419` | 10 rows, latin-1; line 7 (`30011`) named `Andr` + 0xE9 |
| `labels.csv` | 181 | `3044e12a9dab4d2e68902521db29bf9145bd52f93620ae071ec20a7c28fd0b17` | 5 rows; `where … in` keeps `0500000US06037`, POP 10014009 |

Each criterion-3 member but the bomb's is a valid small table the params read, so a reader that overlooks the defect
writes one. The bomb's member is valid too: line ends are blank lines, no rows, as the table probe's reader reads them,
so only the count on the inflating stream stops it, and its headers' small stated size leaves nothing else to stop it.
The joined deflate pieces are checked by inflating a small twin before the bomb is written.

## Criteria to tests

| AC | Asserts | Fails on |
|---|---|---|
| 1 | the fixture as the criterion prints it (600,000 rows, 30 columns, 38–46 MB, 3,200 counties, decoys holding the prefix); then the table: exactly `GEO_ID`, `NAME`, `POP`, the generator's 3,200 rows in file order cell by cell; `rows_read` 600,000, `rows_kept` 3,200; `receipt.used.memory_peak_mb` a number in (0, 128) | the base (no table tool); a prefix matched anywhere; rows reordered; a reader that holds the file in memory |
| 2 | the zip's `data/county.txt` gives the plain file's table hash, `member` `{path, sha256, bytes}` of it; `a/towns.txt` gives another table with its 12 rows and its own `member`; planted reader refused, `runs-as-is` listed | the base; a member by position; a member's hash taken from the zip |
| 3 | each of four imports `refused`, no outputs, the store unchanged, the reason naming as tabled; Scope's duplicate path likewise | the base; a reader that ignores the flag, recurses, normalizes `../`, trusts the header's size, or picks one of two |
| 4 | `Counties`' 5 rows with Total 250 and `formula_cells` 1; with no stored value, Total missing; planted reader refused naming B6, not listed | the base; the first sheet; an evaluated formula; a missing value read as 0 |
| 5 | `(D)` listed: the cell missing, every other cell kept, `missing.pop` 1; unlisted: refused naming the row and `pop`; planted reader refused | the base; a marker read as 0; a refusal that names neither |
| 6 | plain: refused naming the row and `pop`; `group: ","`: the row reads 1234, the rest as written | the base; a group mark always stripped or never |
| 7 | latin-1: `André` (UTF-8 `C3 A9` in the table), every row as written; utf-8: refused naming the row | the base; bytes passed through; a replacement character |
| 8 | the one-row table; `check` ok with no error and a reading bound, the label's trace holding the URL and a `fetched` time in the window; the Mac pair's tables byte-identical; a Linux host's hash the same, else INCONCLUSIVE | the base; a table whose source is `agent` or holds no URL; a time or a URL in the table's bytes |
| 9 | the timed run is a miss and criterion 1's import; judged once | the base; over 5 s on a fit reference Mac |

## Open points

- The criterion-8 trace depends on a table record the shared resolver reads (`tables/<sha256>.json` in the store): the
  base's `deep-show` writes one for a table it imports; the hub writes none for a job's output today.
- The stdin protocol of a job tool (`{params, inputs}` in base64) can't hold criterion 1's file under 128 MB; how a
  large input reaches the tool is the implementer's. The planted entry hands every stream through unread for that.
- Not asserted (no criterion asks): a byte order mark, dates as ISO 8601, `windows-1252`, a header row other than 1,
  JSON lines input, macros, links and embedded objects, the receipt's `columns_kept`, the 16 MB cap on the table
  written, and the job's cache.
