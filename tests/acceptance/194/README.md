# Acceptance tests for #194: catalogs in table.layout@1, and the checks that it holds together

Written first, blind, from issue #194 ("Catalogs: one documented layout for a game's content tables, and checks that it
holds together": its Scope, Fields, 13 acceptance criteria and Proof line), its Oracle page, the design at the base
commit `6f225f46d` ("design(#194): name the catalog probe's, the catalog plug-in's and logic.tuning's surface as built")
and the base's code and suites, by a job that never saw an implementation; none existed (no `deep-catalog` crate, no
`packages/checks/catalog`, no `logic.tuning`), and no other worktree, branch, stash, pull request or session was read.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one test file per criterion, the planted programs inside the files that name them. The
Oracle lane's criteria 1 and 9 upstream tests are in `tests/acceptance/194-oracle/`.

## What was read

- The issue, live (`gh issue view 194 --repo windoliver/deepbuild --comments`; no comments). Its 13 criteria are tagged
  by `scripts/proof-change.mjs`'s rule (`#194.` and the first 8 hex of SHA-256 of the text, white space collapsed),
  recomputed from the live body.
- Its Oracle page (`doneright/oracles/issues/194.md` in DeepBuildAI/deepbuild, branch `doneright`) and the files it
  pins under `doneright/oracles/vendor/` (go `022c863611`'s `src/hash/fnv/fnv_test.go`, csv-spectrum `b251546d5c`'s
  `csvs/` and `json/`): used by the oracle folder; no upstream test covers criteria 2 to 8 and 10 to 13.
- `docs/canvas-primitives.md`: Asset: tables; Asset: tables: catalogs `table.layout@1` and its **As built (#194)**;
  Check input: catalog kinds and its **As built (#194)**; Check input: logic kinds and its **As built (#194)**
  (logic.tuning, a logic item's `fires`, `deep_query`'s `bake_key`); Logic `logic@1` (`assets` at `assets_at`, each
  after a u32 of its length); Logic: data layouts; Logic: checkpoints and bake; Text `text@1`: keyed copy; Body
  `body@1`: character; Input track entries (`on: {logic: ID}`, `jump {height}`); Check input: playtest; Check input:
  plug-in reads. `docs/technical-design.md`: Checks for work beyond code (the Catalog bullet), Dogfooding. AGENTS.md.
- At the base, for surfaces only: `crates/deep-canvas-sandbox/src/layouts.rs` (table.layout@1's doc, validator and
  fixture); `crates/deep-show/src/main.rs` (the calls), `picks.rs` (`logic` and its `check`), `logic.rs` (`deep_query`
  logic: `region_map`, `steps`, `hash`), `physics.rs` and `physics/derive.rs` (`physics_bake`, `world`, entries a
  module fires), `sandbox.rs` (a logic item's data asset validated by its envelope entry's `layout`, `validate`), `hub.rs`
  (`sandbox` counts); `packages/extension-host/src/host.ts` (`install`, `check`, `load`, `runCheck` and its result
  rules); `packages/conformance` (`runKit`, `fail`, check.kind@1's types); `packages/checks/README.md` and
  `packages/checks/playtest` (`index.ts`, `kit.ts`, `deepbuild.json`); `scripts/benchmark.mjs` (`fingerprint`,
  `judgeLimit`, `validateBudgets`), `scripts/lanes.mjs`, `benchmarks/budgets.json` (#556's `playtest-crawler`); the
  suites `556/` and `1048/` (hub and kit helpers, README shape), `184/` (`judge`, `bench`, `load`, ac09), `538/` (deep-show
  run, keyed copy, `captionRef`, #544's assembler), `532/` (programs reading data assets, the Docker leg), `182/` (the
  character world, `discreteHeights`, `statesOf`, the jump's peak), `397/`, `415/`, `416/layouts/` (`validate`, a data
  asset's layout), `1723/`, `522/` (`physics_bake`'s `inputs`).

At the base every file fails at its first step: `cargo build --locked -p deep-catalog --bin deep-catalog` answers
"package ID specification `deep-catalog` did not match any packages" (BASE-FAILURE.txt). Behind it: no
`packages/checks/catalog`, no `catalog-checks` task in `benchmarks/budgets.json`, and, by the design, a logic item's
`fires` refused by name. What the base already does, which the tests rely on: table.layout@1's validator under
`validate` and on a logic item's data asset whose envelope entry names its layout (#415, #416); deep-show run's
`deep_show`, `eval` with a locale, `logic`, `deep_query` logic, `world`, `frames` and `sandbox`; #538's keyed copy and
`copy.missing`; #182's character body and its jump; the extension host's install, conformance check, load and
`runCheck`; the verdict engine.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces          # once, in a fresh worktree
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/194 --testTimeout=3600000 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/194/tsconfig.json
rm -rf tests/acceptance/194/node_modules
```

What a run builds, each once a file, honoring `CARGO_TARGET_DIR` (helpers put Homebrew's rustup on PATH):
`cargo build --locked -p deep-catalog --bin deep-catalog` (every file; `--release` too in ac11); `cargo build --locked
--bin deep-show` through #538's helpers (ac01, ac10, ac11, ac12); #544's assembler through #538's helpers, in
`target/acceptance-538-wat` (ac01, ac10, ac11, ac12; #532's assembler's lock doesn't take this base's patch set);
ac01's Linux leg builds the probe for linux/amd64 in Docker into `target/acceptance-194-linux/`. Every test passes its
own timeout (an hour; ac01's Linux leg and ac11 three). Folders are made under the OS temp folder (`dc194-*`) and
deleted after their file; processes are the tests' own children, stopped by the OS at exit or by `SIGKILL` on a timeout.

**Lines the implementer adds** (this job writes only its folders):

- `scripts/lanes.mjs`: `alone.push('tests/acceptance/194/', 'tests/acceptance/194-oracle/');` (the files build cargo
  binaries and open hubs) and `timed.push('tests/acceptance/194/ac11-budgets.test.ts');` (it calls `judgeLimit`).
- `benchmarks/budgets.json`: the task **`catalog-checks`** *(chosen)*: `command: ["node", "benchmarks/canvas.mjs",
  "catalog-checks"]`, `margin: 0.5`, `limits: {}`, `targets: {pack_10000x20_s: 1, reach_5000_s: 0.2, economy_5000_s: 0.2,
  frame_work: 0}`, `criteria: ["#194.60b4ab87"]`, an `initialReason` naming #194, valid by `validateBudgets`; and the
  workload behind that command in `benchmarks/canvas.mjs`.

Gates. Docker unreachable, or no linux/amd64 variant of `rust:<channel>-slim-bookworm` in the local image index, fails
ac01's Linux leg `BLOCKED:` (this suite pulls nothing; on this Mac the tag resolves to arm64 and the amd64 variant is in
the index, which `docker image inspect --platform linux/amd64` reads); that leg off macOS arm64 is `INCONCLUSIVE:`. Cargo
missing, or a fixture whose own truth doesn't hold (the colliding pair, the map's river, a table out of hash order), is
`BLOCKED:`. ac11's timings are judged only where the perf lane's rule holds (`judgeLimit` given five zero readings
against a limit of 1 reads PASS: a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load
under the core count); elsewhere the file fails `INCONCLUSIVE:` with the rule's reason after every part that doesn't
depend on the machine has passed. Nothing else depends on time or load.

## The surface under test

The design's As built paragraphs name it; **every name marked *(chosen)* is this job's**, the smallest the criteria
need, shaped like the neighbouring surfaces. The implementer builds exactly these, or a dispute goes to a blind redraft.

### The probe: `deep-catalog pack`

- `deep-catalog pack`: JSON lines on stdin, one line out per line: `{op: "pack", tables: {<table>: {path, format?}},
  schema, out?, planted?}` → `{ok: true, sha256, size, ms, record}`, the bytes written to `out`; or `{ok: false, code,
  …}`. Format from the path's extension (`.csv`, `.jsonl`). The schema as the design writes it: `{<table>: {id, inherit?,
  columns: {<name>: {type: "i32" | "f64" | "bool" | "ref <table>" | "refs <table>" | "copy <copy table>", unit?, range?}}}}`.
  Cells as the design reads them (a CSV list `a;b`, JSON lines an array; empty CSV cell or null is empty).
- The bytes, as `helpers.ts`'s `judgeLayout` reads them: the layout's doc (header `TBLE`, 1, table count, pool_at,
  pool_count; a directory entry per table and per column; `at` an offset from the asset's first byte; `target` the
  target table's directory index for ref and refs, else 0) and the As built rules (tables by name hash, columns by name
  hash, the ID column an i32 column of its own name holding each ID's hash, the inherit column not packed, rows by ID
  hash unsigned, values in directory order with no padding, the pool last). *(chosen readings)*: **a refs element naming
  an ID no row holds is 0xFFFFFFFF in the pool and listed in `missing`**, as a ref is; pool_at is checked only when the
  pool holds anything; the pool's own order is free (each refs cell's slice must hold its list in the cell's order).
- The record as the design lists it: `{layout, sha256, size, tables: [{name, hash, id, rows, ids, columns: [{name, hash,
  type, at, target, copy, unit, range, id}]}], missing: [{table, id, column, ref}]}`, tables and columns in directory
  order, hashes as unsigned numbers. *(chosen)*: a column's **`type` is its base name** (`i32`, `f64`, `bool`, `ref`,
  `refs`, `copy`), the table it names in `target`, the copy table in `copy`.
- Refusals read here: `hash_collision {table, ids: [the two, sorted], hash: the u32 as a number}` and `inherit_cycle
  {table, rows}` (rows compared as a set).
- Planted packers, by `planted`: `catalog_rows_not_columns` (its header and directory byte for byte the clean pack's),
  `catalog_copy_key_hashed` (a copy cell holds FNV-1a 32 of its text, as an i32), `catalog_jsonl_file_order`.

### deep-show

- `catalog_import {tables, schema}` (ac12): answers `{asset: {sha256, kind: "catalog", layout: "table.layout@1", …},
  record}`; its `sha256` is the one `deep-catalog pack` gives the same file, and the bytes and record land in the
  evidence store.
- A document's catalog asset entry: `{sha256, kind: "catalog", layout: "table.layout@1", license}` *(chosen: with the
  license every asset entry of #538's films carries)*; a logic item names the SHA-256 in `params.assets`.
- `validate {layout: "table.layout@1", path}` admits the fixture's bytes (#415's call).
- `logic {doc, steps, check: "logic.tuning"}` *(chosen: logic.determinism's call, with the other kind)* answers
  `check: {kind: "logic.tuning", verdict: "PASS" | "FAIL", failures, rows: [{row, from, to, steps, equal}]}` *(chosen:
  the report's rows in `check.rows`)*; a FAIL's `failures` name `tuning.<row ID>` somewhere in their JSON.
- `deep_query {what: "logic", items}`: each item's `hash` and **`bake_key`** beside it (the design's).
- `world {doc, world}` (#540's, `physics_bake` with bodies): `inputs` keep the jump the tuner fires as `{step, kind:
  "jump", target: "hero", data: {height}, input: "hop", from: "logic:tuner"}` (#522's Kept); `bodies.hero` its states.
- A logic item's fire region *(chosen reading of "an i32 count and then one f64")*: at `fires_at`, the count i32 at +0
  and the jump's height f64 at **+4**, no padding; a step leaving the count above 0 fires once.

### The plug-in `deepbuild/catalog` (packages/checks/catalog)

- Installed into a fresh extension host from its folder (`release` with its `packageDigest`), `check` passes, `load`
  places it in the hub; its manifest's `checks` holds the six kinds and `codes` the six codes.
- `runCheck(kind, spec, ctx)` with check.kind@1's fields (`runner: "deepbuild/catalog"` *(chosen)*, `inputs: []`,
  `depth: "journey"`, `oracle: "code"`, `contract: null`), the kind's input in `refs`, `reach`, `economy`, `bounds`,
  `copy` or `scenario`, and `catalogs: {<sha256>: {bytes: base64, record}}`, as the hub fills it.
- A result: `testsRun` above 0 when it passes, `evidence` holding the catalog's SHA-256, one failure per finding
  (`test` `<table>.<row ID>` or the cycle's recipes joined by ` → `; its message starting with the code and naming what
  the finding names, read here as whole words), and `catalog: {kind, ms, found}`, each finding matched by the design's
  fields (`toMatchObject`, so a finding may carry more).
- **Trigger table names as test prefixes** *(chosen)*: a scenario's failure `test` is `<trigger table>.<row ID>`, the
  rule for any table.
- `catalog.layout:` (ac09): one failure, its message naming the first table in directory order that breaks the open.
- `catalogSource(input)`, the entry's export: `own` with `by: "agent"`, else `definition`.
- **`kit.ts` exports `catalogKit()`** *(chosen)*: one check.kind@1 kit for the six kinds, whose fills' `run(spec, ctx)`
  run the kind `spec.kind` names; `clean()[0]` is the reference; `planted` holds **`reach_any_input`** and
  **`scenario_ignores_deny`** (the design's names) among its runners. `runKit(kit, fill, {parts: ["fixed"]})`: the
  reference reads PASS; `reach_any_input` reads FAIL at a case raising `catalog.unreachable`; `scenario_ignores_deny`
  reads FAIL at a case raising `scenario.unreachable` **whose message names its fixture, the case's ID** (as the playtest
  kit's `fail(…, ${c.id} …)` does).

## Fixtures (fixtures.ts, programs.ts; written as files at run time)

- **The catalog**: 40 items (`id, base, name, weight, value, stack, damage`), 15 recipes (`id, inputs, tools, outputs,
  time`) and 4 creatures (`id, name, hp, drops, speed`), its schema (`name: copy items` and `copy creatures`, ranges on
  weight [0, 50], value [0, 1000], damage [0, 100] and time [0, 600]; hp has none), and data.copy in en and fr. Cudgel:
  weight 1.8, name key 1042, Cudgel / Gourdin. spiked_cudgel's base is cudgel and its weight, stack and damage are
  empty. The start kit (11 IDs) and the loot table (`{table: creatures, column: drops}`) reach every item and recipe;
  the one cycle is make_board (plank × 2 → board) and uncraft_board (board → plank × 2); every recipe's outputs are worth
  0 to 2 more than its inputs.
- **Twins**: oak_panel (plank_oak, plank → board) and the item plank_oak; nail_board (plank, plank, nails → board, nails
  no row's ID); uncraft_board giving plank × 3; gem worth 30 (cut_gem: rough_gem 10 → gem 30 + gem_dust 0); golem hp
  400; fr without lantern's key 1011; items costarring and liquid (FNV-1a 32 both 0x5e4daa9d); cudgel's base set to
  spiked_cudgel; spiked_cudgel's row written out in full.
- **The scenario catalog**: forms, ends, flags, sides, resources, kinds (with `yields`), messages (`text: copy messages`,
  keys 7001 to 7004), a 10 × 6 map (`c<x>_<y>`, x = 5 closed, self at c1_2 and enemy at c2_4, both west), and seven
  trigger tables with the columns the design names: flag_twin / flag_fixed, ambush_twin (c7_2, c7_3) / ambush_fixed
  (c3_2, c3_3), shows (victory showing msg_win, 7003), mission_denied / mission_allowed (time 60 allows extractor).
- **The tuning table**: `id,value,min,max` / `jump_height,1.0,0.5,2.0`, patched to 1.5.
- **Budget catalogs**: 10,000 rows × 20 columns (seeded); a chain of 5,000 recipes; 2,500 recipe-and-uncraft pairs.
- **Programs** (WebAssembly text, #544's assembler): each finds a table, a column and a row by FNV-1a hashes in the
  bytes at `assets_at` + 4 (`f64Reader`, `keyReader`, `tuner` and its planted twin with 1.0 compiled in, `idle`). Before
  any implementation they were run in Node's own WebAssembly against a scratch packer of this README's reading (not part
  of the suite, deleted), with `judgeLayout` passing that packer's bytes for the catalog, the scenario catalog, the tuning
  table and csv-spectrum's records, and failing a reader that turns CR LF inside quotes to LF.

## Criteria to tests

| ID | Test, and the wrong program it fails on |
|---|---|
| 1 `#194.a290ef32` | `ac01-layout.test.ts`: the CSV fixture's bytes and record meet `judgeLayout`, `validate` admits them; the reader reads 1.8 from deep-show's logic run; `catalog_rows_not_columns` (same directory) fails the read's judge naming items.weight; spiked_cudgel's packed row equals the written-out row; Linux x86_64 packs the same bytes. Fails on the base, a row-major packer, one keying by position or unsorted, unresolved inheritance, host-dependent bytes |
| 2 `#194.55eeae36` | `ac02-refusals.test.ts`: `hash_collision` naming items, both IDs, the hash; `inherit_cycle` naming both rows; the clean fixture packs. Fails on a probe that keeps one of two colliding rows, names one, or stops a cycle silently |
| 3 `#194.3e12aff1` | `ac03-refs.test.ts`: the record lists plank_oak, packed 0xFFFFFFFF; catalog.refs fails `recipes.oak_panel` naming oak_panel, inputs, plank_oak; passes with the item. Fails on a refs check that passes anything or fails everything |
| 4 `#194.d88ec4fa` | `ac04-reach.test.ts`: reach passes the fixture; fails `recipes.nail_board` naming nails; `reach_any_input` passes the twin, the reference fails it, runKit reads FAIL on it and PASS on the reference. Fails on an any-input reach, a kit admitting it |
| 5 `#194.eeff314c` | `ac05-economy.test.ts`: passes the fixture; the 3-plank uncraft fails, test the cycle joined by ` → `, naming both recipes and plank, gain 1; with value and margin 5 the fixture passes and the 30-from-10 twin fails `recipes.cut_gem`. Fails on an economy that misses the cycle, counts tools, or ignores the margin |
| 6 `#194.248f0bd0` | `ac06-bounds-copy.test.ts`: bounds fails `creatures.golem` naming golem, hp, 400, [1, 200]; copy fails `items.lantern` naming 1011 and fr; both pass the clean. Fails on a check reading one locale, the schema's range only, or by position |
| 7 `#194.f1f3b867` | `ac07-scenario.test.ts`: flag_twin fails naming victory and bridge_burned; ambush_twin fails naming ambush, c7_2, c7_3 (this suite's search checks the river); shows without 7003 fails naming 7003; each fixed twin passes. Fails on a check that takes named flags as set, searches through closed cells, or skips copy |
| 8 `#194.d265d3bd` | `ac08-agent-roots.test.ts`: both runs pass; `catalogSource` gives own and definition; the verdict reads INCONCLUSIVE with one ask, and PASS. Fails on a source that reads every input one way |
| 9 `#194.04da1020` | `ac09-jsonl.test.ts`: a game project's JSON lines (paths from its brief.json) pack to the CSV's bytes and record; the five kinds agree on the clean catalog and the hp 400 twin; `catalog_jsonl_file_order` packs other bytes and each kind fails with one `catalog.layout:` failure naming recipes. Fails on a file-order reader, a check that opens unsorted bytes |
| 10 `#194.bdc9544a` | `ac10-keyed-copy.test.ts`: the record's items.name is copy over items, cudgel holds 1042; eval draws Cudgel (en) and Gourdin (fr) as the written-out captions do, no copy.missing; `catalog_copy_key_hashed` raises copy.missing naming items and FNV-1a("1042"), and the judge fails naming cudgel and items. Fails on a hashing packer, a lookup by position |
| 11 `#194.60b4ab87` | `ac11-budgets.test.ts`: the pack's `ms`, reach's and economy's `catalog.ms`, frames' `ran` and logic fuel equal with and without the catalog and no sandbox work in frames, the `catalog-checks` record and the timed line; on a reference Mac five readings each within 1 s, 0.2 s, 0.2 s. Fails on the base, a slow probe or check, per-frame work |
| 12 `#194.2ec78bb6` | `ac12-tuning.test.ts`: the bake's jump from `logic:tuner` at height 1 peaks 1.0185 ± 0.001 m; the 1.5 patch keeps `hash`, changes `bake_key` (the first catalog gives the first back) and peaks 1.5227 ± 0.001 m; logic.tuning passes the clean program (to 1.25, equal < 600) and fails the compiled-in one (equal 600) naming tuning.jump_height. Fails on the base, a module that fires nothing, a bake key blind to the catalog, a logic.tuning that passes a program the row never reaches |
| 13 `#194.c61ec22d` | `ac13-mission.test.ts`: mission_denied fails `mission_denied.victory` naming victory, built, extractor; mission_allowed passes; `scenario_ignores_deny` passes the denied mission, the reference fails it, runKit reads FAIL at a case naming its fixture. Fails on a check ignoring deny, a kit admitting it |

## Planted programs

| Planted | Where | Criterion | How the test catches it |
|---|---|---|---|
| `catalog_rows_not_columns` | the probe's `planted` | 1 | the reader's judge fails naming items.weight (a wrong value or a refused document) |
| `catalog_jsonl_file_order` | the probe's `planted` | 9 | other bytes; every kind fails `catalog.layout:` naming recipes |
| `catalog_copy_key_hashed` | the probe's `planted` | 10 | copy.missing for the hashed key; the judge fails naming cudgel and items |
| `reach_any_input` | the kit's planted runner | 4 | passes the nails twin; the kit's fixed part reads FAIL |
| `scenario_ignores_deny` | the kit's planted runner | 13 | passes the denied mission; the kit reads FAIL at a case naming its fixture |
| `tuner(true)` | programs.ts | 12 | 600 equal hashes with the row at 1.25; logic.tuning FAIL naming tuning.jump_height |

## Readings where the issue and design leave a choice

- **The start kit and the loot table** are roots in the three tables: `{table: items, ids: [11 IDs]}` from the brief,
  and `{table: creatures, column: drops}`, the creatures' drops being the loot table (the criterion keeps three tables).
- **"A recipe needing nails, which nothing yields"** is a recipe naming an ID no row holds, beside inputs that are
  reachable, its output made elsewhere: so the any-input runner passes that twin while the reference fails one row.
  An item nails no recipe makes would leave an unreachable item even under that runner.
- **"Naming the cycle"**: the test is the cycle's recipes joined by ` → ` in some order, read as a set.
- **The ambush** is a goal beside the victory (otherwise a victory needing it would name the ambush's flag, not its
  cells); the brief's goals list both.
- **"Fails, naming the first table"** (ac09) is the open's `catalog.layout:` failure in each of the five kinds.
- **"Fails that read, naming the column"** (ac01) and **"fails, naming the row and the table"** (ac10) are this suite's
  judges of what the logic item read and what the text showed, as #538's suite judges its planted programs.
- **"Compared with the merge base"** (ac11) is the perf lane's record; "no work per frame" compares the same film with
  and without the catalog in one build (the merge base has no catalog asset to compare with).
- **logic.tuning's 600 steps** are the platformer's 5 s span at 120 Hz; the logic call is given `steps: 600`.
- **"Re-bakes under the catalog's new hash"**: `bake_key` changes with the catalog and comes back with it.

## Not covered (scope with no criterion here)

Column-name and table-name collisions (`hash_collision` with `columns` or `tables`), `inherit_missing`, `duplicate_id`,
`bad_cell`, `column_missing`, `table_missing`, `table_unreadable`, `bad_schema`, `over_cap`; the decode worker's own
`catalog` job outside `catalog_import`; the codes' meaning and fix in the check catalog; `deep_kinds` listing the layout
and kinds; the kit run at install and in preflight; scenario triggers `defeated`, `killed`, `stored`, `spawn`;
`catalog.dominance`; `fires_and_reads`; a fire the world doesn't declare.

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts` (builds, the probe, the layout reader and judge, the
Docker leg, the hub, specs, the kit), `fixtures.ts` (the tables, schemas, copy, twins and budget catalogs), `programs.ts`
(the WebAssembly programs and the documents), and one test file per criterion: `ac01-layout`, `ac02-refusals`,
`ac03-refs`, `ac04-reach`, `ac05-economy`, `ac06-bounds-copy`, `ac07-scenario`, `ac08-agent-roots`, `ac09-jsonl`,
`ac10-keyed-copy`, `ac11-budgets`, `ac12-tuning`, `ac13-mission`.
