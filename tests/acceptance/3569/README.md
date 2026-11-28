# Acceptance tests for #3569: derived tables that keep their sources

Written first, blind, from issue #3569 (its Scope, Fields, ten acceptance criteria, Proof and Not in scope), the
design sections it links and the base commit `2daec1c4b` ("Merge pull request #3578 …", main after `de00a9c64`), by a
job that never saw an implementation; none exists at the base, and no other worktree, branch or PR was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- The issue, live (`gh issue view 3569 --repo windoliver/deepbuild`, body only). Each test's name starts
  `AC<n> #3569.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space
  collapsed (`scripts/proof-change.mjs`, `criterionId`).
- `node scripts/design-section.mjs --issue 3569`: `docs/canvas-primitives.md` Asset: tables; Asset job; Asset job:
  imports; Honest numbers; The closed function list; Scale and encode `scale@1`, `axis@1`, `legend@1`. `AGENTS.md`.
- At the base, for surfaces and conventions only: `packages/hub/src/jobs.ts` (deep_job's run, its key, its receipt,
  an output check's failure as `{status: failed, check, reason}`, nothing kept), `packages/hub/src/tools.ts`
  (deep_job's strict schema), `packages/hub/src/core.ts` (the job store is the hub's evidence store),
  `packages/extension-host/src/job-kinds.ts` (a kind's and a tool's descriptor, `run {dir, entry}`),
  `packages/contracts/src/manifest.ts` (check names), `packages/evidence/src/index.ts` (`<2 hex>/<62 hex>`),
  `packages/jobs/README.md` and `packages/jobs/score` (a first-party job plug-in), `crates/deep-show/src/media.rs`
  (`table_import` and the record `tables/<sha256>.json`), `crates/deep-codecs/src/table.rs` (the probe: `unit` is
  always null at the base, and a repeated key is refused at import), `crates/deep-marks-vello/src/tables.rs` and
  `crates/deep-canvas-marks/src/{check.rs,data.rs}` (`{from, column}`, `numbers`, `number_unsourced` for a table an
  agent wrote). The suites `1922` (the hub world, copied into `helpers.ts`), `3035` (first-party plug-in, planted tools
  that run the right one, copied and adapted), `397` (`table_import`, `deep-canvas-render check`, the timing gate),
  `406` (a bound reading), `154`, `155` and `162` as patterns.

## Run them

macOS; Node 24 and rustup's cargo first on `PATH`:

```sh
npm ci
npm run build --workspaces                       # the hubs run packages/cli/dist/main.js
NO_COLOR=1 node scripts/throttle.mjs test --wait 180 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/3569 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3569/tsconfig.json
```

A `--root` run leaves Vitest's cache in `tests/acceptance/3569/node_modules/.vite`; delete it.

- **Builds:** each file builds what it drives the first time it needs it, through the build throttle:
  `PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build
  --wait 1440 -- scripts/lease cargo build --locked -p deep-hook` (the hub won't start without it), then `--bin
  deep-show` (the table imports) and `--bin deep-canvas-render` (AC8). A test whose plug-in is missing fails before
  any build or hub starts. `packages/cli/dist/main.js` missing reads `BLOCKED:`.
- **One at a time:** `lane.json` puts the folder in `alone` (the sandbox log stream: every file starts real hubs that
  run sandboxed plug-ins and tools through the supervisor). The hubs need a shell that may start the supervisor's
  sandbox (in Claude Code, the Bash tool with its sandbox off).
- **Safety:** every folder is under `/tmp/dh3569-*`, removed after its file; every hub, `deep` command, `deep mcp`,
  `deep-show` and `deep-canvas-render` runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`,
  `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`; every process is stopped by its PID; nothing leaves 127.0.0.1 (the fetched
  tables are served by this process); no model is called.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-3569-proof/`, rewritten each run: the fixture
  tables' hashes, each job's outputs with the derived table, its receipt and lineage, the planted runs' failures (the
  recount beside the tool's cell), the two machines' outputs and keys, and AC10's readings with the load.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming it; a leg that can't run reads
`BLOCKED:` and fails; a timing that can't be judged is a skip reading `INCONCLUSIVE`, never a pass.

## Files

| File | What it holds |
|---|---|
| `helpers.ts` | the world (a hub, `deep mcp`, its socket as the cli role, `deep install`), the builds, the table imports, deep_job and its readers, the planted plug-ins, `deep-canvas-render check`, the timing gate |
| `ac1-group.test.ts` … `ac10-budget.test.ts` | one file a criterion, one test a criterion but AC8's two |
| `fixtures/*.csv` | the fixture tables (below) |
| `fixtures/planted/` | the planted tools: `tool.mjs.fixture` (the entry), `spoil.mjs` (what it rewrites), `index.ts.fixture` (its plug-in) |
| `lane.json` | the folder runs alone |
| `BASE-FAILURE.txt` | the run at the base |

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#3569.a88c0771` | `ac1-group.test.ts` (1) | counties.csv and metros.csv fetched; join by county, group by metro with `workers: sum(manufacturing)`, `counties: count`: A 250 and 4, B 307 and 2, two rows. Fails on the merge base, a join that drops or repeats a county, a sum that leaves one out, a count of groups |
| 2 | `#3569.22f062d8` | `ac2-derive.test.ts` (1) | one row of 120, 30, 0 in workers: `total` 150, its unit `workers` in the derived table's record; the same expression where mining is in dollars: refused, the reason naming `workers` and `dollars`, nothing kept. Fails on the merge base, a 0 read as missing, a column with no unit, a sum across units, a refusal naming one unit |
| 3 | `#3569.9a78233f` | `ac3-join.test.ts` (1) | control on metros.csv done; metros-twice.csv (county 3 twice, expect many_to_one): refused naming `3`, nothing kept; metros-short.csv (no county 6): done, `dropped` 1, A 250 and B 300. Fails on the merge base, a join keeping the first match, a refusal naming no county, an inner join that keeps county 6 or counts nothing |
| 4 | `#3569.becbb065` | `ac4-missing.test.ts` (1) | counties-gap.csv (county 2 empty): A's workers missing (empty), B 307; with `skip_missing: true` A 170 and `skipped.workers` 1; `runs-as-is` joins and passes; `reads-missing-as-zero` joins, and its run fails with `check: data.derived`, the reason naming `A` and `workers` and not `B`, nothing kept. Fails on the merge base, a sum reading empty as 0, a skip that counts nothing, a recount sharing the tool's reading |
| 5 | `#3569.5963e451` | `ac5-nonfinite.test.ts` (1) | ratios.csv: `q = a / b` is 2 for 6 / 3 and missing (empty) for 5 / 0, `nonfinite.q` 1. Fails on the merge base, inf, NaN or 0 written, nothing counted |
| 6 | `#3569.eb306d67` | `ac6-rank.test.ts` (1) | AC1's job then `rank {by: workers, desc: true, into: rank}`: B 1, A 2; counties-tie.csv with metros-tie.csv (A 250, B 250, C 400, B met first in the file): C 1, A 2, B 3. Fails on the merge base, ascending, a shared rank, a tie broken by arrival or reversed key, ranks from 0 |
| 7 | `#3569.f14e11fa` | `ac7-bytes.test.ts` (1) | first hub: a miss that starts the tool; the rerun a hit, same key, no process, same outputs; counties-changed.csv (one byte): another key and another table hash; a second hub, nothing shared, TZ and locale changed, tables in the other order: a miss, every output the same SHA-256, each store holding the bytes. Fails on the merge base, an output holding a time, locale, path or hash-map order, a key without the inputs' hashes, a rerun that runs |
| 8 | `#3569.d0a835ea` | `ac8-honest.test.ts` (2) | (fetched) the chart showing the derived `workers` with a reading bound passes `deep-canvas-render check`; `numbers`' entry for `labels#A` shows `250`, its trace holds both input files' SHA-256 and the key list 1, 2, 3, 4 and no list of B's keys; `labels#B` traces to 5, 6. (agent) the county table from an agent's session: `ok` false, a `number_unsourced` error naming `labels#A` or `labels`. Fails on the merge base, a trace to the derived table alone or one input, a job that is its own source, a number given its best input's source |
| 9 | `#3569.070ae844` | `ac9-planted.test.ts` (1) | counties-pay.csv (payroll in dollars, with cents): the right tool and `runs-as-is` pass; `sums-in-f32` (each metro's payroll summed in f32) and `counts-row-twice` (county 3 in B as well) each join, and each run fails with `check: data.derived`, the reason naming a cell it changed by metro and column, nothing kept. Fails on the merge base, a recount that reads the tool's numbers, compares loosely, checks integers only or holds no sum to its total, a failure naming no cell |
| 10 | `#3569.1d1485e8` | `ac10-budget.test.ts` (1) | 3,200 × 40 joined to 2,000 rows, 1,000 groups: a warm-up and five timed misses, each done with 1,000 groups; judged against 2,000 ms on a fit reference Mac, INCONCLUSIVE (a skip) anywhere else, with the readings printed. Fails on the merge base, a job that doesn't finish or writes other than 1,000 groups; on a reference Mac, one that takes 2 s every time |

## The surface under test

The issue and the design name the kind `table.derive`, its params (`inputs`, `steps`, `key`), the steps and their
fields, the receipt's fields, the output table with `source: job {kind, tool, input}` and `lineage: sha256`, the check
`data.derived`, `deep.registerJob` and `deep.registerCheck` in the asset-tools plug-in, and `deep_job`. Where they
leave a name or a shape open, this job picked the smallest surface the design and the base imply; **each choice is
listed here, so the implementer builds to it**, or a dispute goes to a blind redraft.

1. **The plug-in** is `packages/jobs/asset-tools` (the design's "asset-tools plug-in", beside `packages/jobs/score`),
   installed with `deep install`. Its manifest lists `table.derive` in `jobs`, exactly one tool for it in `job_tools`,
   and `data.derived` in `checks`; the tests take the tool's name@version from that manifest, so any name is fine.
   **Known tension:** `packages/contracts/src/manifest.ts` lets a plug-in name a check `<kind>.<name>`, `ext.<plugin>.…`
   or, in the hub's release only, a first-party name; `data.derived` is none of the first two, so the implementation
   must let it install, as #1922's suite noted for `test.upper_only`.
2. **Input tables** come into the hub's evidence store (`<home>/.deepbuild/evidence`) through `deep-show run`'s
   `table_import` (#397), the scenario's `evidence` that folder, as #155's suite points `deep-show` at a hub's store:
   by `url` (served on 127.0.0.1; the source the hub writes, `{url, fetched}`) or by `path` and `session` (source
   `agent`). **Units (new):** `table_import` takes `units: {column → unit}` and writes each named column's `unit` in
   the probe (`probe.table.columns[].unit`, which is always null at the base); the reply's probe shows it. A column
   not named keeps `unit: null`. A metro table's key is its `link` column, so a county may come twice in it (the
   probe refuses a repeated key at import, so AC3's repeat must reach the job through a non-key column).
3. **An empty cell is missing.** counties-gap.csv's manufacturing column holds integers and one empty cell; the job
   reads it as an integer column with one missing cell, never as text and never as 0.
4. **The run:** `deep_job {op: "run", kind: "table.derive", tool, params: <JSON text>, inputs: null}`, the params
   `{inputs: {<name>: <the table's SHA-256>}, steps: [...], key: <column>}`. The job reads each input as a table asset
   by that hash from the hub's evidence store, its bytes and its record; the call names no path and no file twice.
   Steps are one-key objects, in order:
   - `{join: {with: <input name>, on: [<column>], kind: "inner", expect: "many_to_one"}}`
   - `{group: {by: [<column>], agg: {<name>: "sum(<column>)" | "count" | "min(<column>)" | "max(<column>)" | "mean(<column>, weight: <column>)"}, skip_missing?: true}}`
   - `{derive: {<name>: {expr: <expression>, unit: <unit>}}}`
   - `{rank: {by: <column>, desc: true, within: [], into: <column>}}`; `filter` and `select` aren't run here.
   The table the first step reads is the job's one input, or, with two, the one the first step's `join` doesn't name
   (every job here is shaped so; the issue doesn't say how a first step names its table). `key` is the output's key
   column.
5. **The reply** when done: `{status: "done", outputs: {table: {sha256}, lineage: {sha256}, …}, receipt: {kind, tool,
   key, cache, …}}`, each output's bytes in the hub's evidence store under its hash.
   - **The derived table** (`outputs.table`) is a CSV as the table probe reads it: a header row of column names, one
     row per output row, the key column among them; integers written as integers (`250`), a missing cell empty.
   - **Its record** is kept beside it as `tables/<sha256>.json`, in the form `table_import` writes (`probe` with each
     column's `unit`, `cells`, `source: {job: {kind, tool, input}}`), with `lineage: <the lineage's sha256>`, so
     `{from, column}` reads it and honest numbers follows it (AC2 reads the unit there; AC8 reads it through the check).
   - **The kind's receipt** `{rows_in, rows_out, dropped, skipped: {column → cells}, nonfinite: {column → cells}}` is
     read from the reply's `receipt` when that holds any of those fields, else from an output named `receipt`, a JSON
     object in the store. `skipped` and `nonfinite` are keyed by the output column (`workers`, `q`).
   - The lineage's form is the implementer's; AC8 reads it only through honest numbers' trace.
6. **A refusal** (AC2, AC3): a tool error, or `{status: "refused", reason}`, with no outputs. "Naming" a unit, a county
   or a metro: the reason's text holds it as a word of its own, 64-hex hashes and absolute paths left out first.
7. **`data.derived`** is the kind's output check, run by the hub as #1922's jobs run one, given what it needs to recount
   from the input files' bytes. A failure is the base's reply: `{status: "failed", check: "data.derived", reason}`,
   nothing kept, no outputs. "Naming the output cell": the reason holds the cell's key (`A`, `B`) and its column
   (`workers`, `payroll`, `counties`).
8. **Honest numbers** (AC8) is `deep-canvas-render check {doc, look: "clean", evidence: <the hub's evidence store>}`
   (#397, #406). The chart names the derived table in `assets: {derived: {sha256, license}}`; `labels` is a text
   `marks@1` set, `n: 2`, `key: "key"`, `columns.key: {from: "derived", column: "metro"}`, `columns.text: {from:
   "derived", column: "workers"}`; the reading is #406's `bound_values` into a text item `reading`. `numbers`' entry
   `{item: "labels", row: "A", text: "250", source}` holds, anywhere in `source`, both input tables' SHA-256 as strings
   and a list whose items are exactly the county keys `1`, `2`, `3`, `4` (strings or integers, any order), and no list
   of keys 1 to 6 holding 5 or 6. With an agent's county table, an error `number_unsourced` whose `ids` hold
   `labels#A` or `labels`.

## The planted programs

The issue's three wrong programs are tools that must reach `data.derived`, so each must first join the kind, which
runs its qualification at install. Each is a plug-in made at test time (`helpers.ts` `installPlanted`), one tool for
`table.derive` registered under **the right tool's own descriptor** (read from `packages/jobs/asset-tools/index.ts`'s
default export called with a `deep` that only records), with two fields changed: its `tool` and its `run.entry`. Its
folder is a copy of the right tool's `run.dir` with three files laid beside it: `deep-3569-tool.mjs`
(`fixtures/planted/tool.mjs.fixture`), which runs the right entry on the same stdin; `deep-3569-spoil.mjs`; and
`deep-3569-plan.json`. The tool rewrites cells of `outputs.table` only when every cell its plan names holds the value
the plan expects there (computed by the test from the fixture), and hands every other output on byte for byte; so it
is right on every other input, the kind's qualification fixtures included, and joins. **The kind's qualification
must therefore not hold this suite's fixture tables byte for byte**, or a planted tool is refused before it reaches
the check.

| Tool | Criterion | What it writes wrong, on its job only |
|---|---|---|
| `runs-as-is@1.0.0` | 4, 9 | nothing: the control, which must join and pass `data.derived` |
| `reads-missing-as-zero@1.0.0` | 4 | metro A's `workers` 170 where the right tool writes it missing; the receipt untouched, so nothing skipped is reported |
| `sums-in-f32@1.0.0` | 9 | each metro's `payroll` summed in f32 in key order: A 8691358 for 8691357.9, B 10000001 for 10000001.12 (each about 1.2e-8 off) |
| `counts-row-twice@1.0.0` | 9 | county 3 counted in B too: B's `workers` 347, `counties` 3, `payroll` B's plus county 3's |

## Fixtures

| File | Key | Units | Holds |
|---|---|---|---|
| `counties.csv` | county | manufacturing: workers | counties 1 to 6: 120, 80, 40, 10, 300, 7 |
| `counties-changed.csv` | county | the same | one byte changed: county 6 holds 8 |
| `counties-gap.csv` | county | the same | county 2's cell empty |
| `counties-pay.csv` | county | manufacturing: workers, payroll: dollars | adds payroll with cents |
| `counties-tie.csv` | county | manufacturing: workers | counties 1 to 7: 200, 50, 120, 80, 40, 10, 400 |
| `metros.csv` | link | none | counties 1 to 4 in A, 5 and 6 in B |
| `metros-twice.csv` | link | none | metros.csv and a seventh row naming county 3 (A) again |
| `metros-short.csv` | link | none | counties 1 to 5 only |
| `metros-tie.csv` | link | none | counties 1 and 2 in B, 3 to 6 in A, 7 in C |
| `one-row.csv` | county | all three: workers | county 1: 120, 30, 0 |
| `one-row-dollars.csv` | county | mining: dollars, the others workers | county 2: 120, 30, 0 |
| `ratios.csv` | id | a, b: workers | 6 / 3 and 5 / 0 |

AC10's tables are made in the test: `big-0.csv` to `big-5.csv` (3,200 × 40, an offset each) and `links.csv`.

## Readings where the issue leaves a choice

- **Two machines** (AC7): no second machine is at hand, so it is a second hub with nothing shared (home, store, cache,
  record) and a different time zone, locale and import order. A claim across target triples is the tool's
  qualification's (`same_bytes`), which this suite doesn't read.
- **The trace** (AC8): "lists the two input files" is both input tables' SHA-256 in the entry's `source`; "the four
  county keys" is a list of exactly 1, 2, 3, 4 there. The files' URLs aren't required.
- **"Fails, naming the item"** (AC8): `number_unsourced`, the base's honest-numbers code, with `labels#A` or `labels`.
- **The budget** (AC10) times the deep_job call to its done reply, the output check included, since the job finishes
  only once its check passes. "In the local preflight" names where it runs; this suite adds no `benchmarks/budgets.json`
  task.
- **A derive's unit** (AC2): the derive states `unit: "workers"`, the unit of its columns, and the derived table's
  record must carry it.

## What the implementer adds outside this folder

- `table.derive`, `data.derived` and their tool in `packages/jobs/asset-tools` (manifest, `index.ts`, the tool's
  folder); the hub's reading of each input table by its hash (bytes and record) for the job and for its check; the
  derived table's record `tables/<sha256>.json` with `source.job` and `lineage`.
- `units` on `deep-show run`'s `table_import`; an empty cell read as missing in a number column.
- Honest numbers in `deep-canvas-render check` following a derived table's lineage to its inputs' files and sources.
- `ac10-budget.test.ts` in `timed` in `scripts/lanes-lists.mjs` (a timing file), if the lanes want it there. The
  folder's `alone` entry comes from `lane.json`.

## BLOCKED, INCONCLUSIVE and not tested

- AC10 is INCONCLUSIVE (a skip) off a reference Mac or under load; its five readings are still taken and printed.
- Not tested, because no criterion asks: `left` joins, `one_to_one`, `min`, `max` and `mean`, `filter`, `select`,
  `within`, an i64 overflow, a comparison across units, rows' order in the output, the lineage's own form, a formula or
  code a file carries, a fetch, and a derived table named by an item before `data.derived` passes (the planted runs
  check only that nothing of a failed run is kept).
