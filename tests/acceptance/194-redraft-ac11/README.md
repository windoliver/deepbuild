# Acceptance test for #194 criterion 11, redrafted blind: the budgets

Criterion 11 (`#194.60b4ab87`): "Budgets, on the reference Mac in the local preflight, compared with the merge base:
packing 10,000 rows of 20 columns takes under 1 s, catalog.reach and catalog.economy over 5,000 recipes each take under
200 ms, and a piece that names a catalog gains no work per frame".

A blind run of the acceptance-test job for this one criterion (docs/technical-design.md: Dogfooding; AGENTS.md: Proof).
It was written at the base `6f225f46d` ("design(#194): name the catalog probe's, the catalog plug-in's and logic.tuning's
surface as built"), where no implementation of #194 exists (no `deep-catalog` crate, no `packages/checks/catalog`), by a
job that saw none, and without reading any other worktree, branch, stash, pull request or session. The implementing agent
doesn't edit this folder; a dispute goes to a blind redraft, never to an edit here.

## What was read

- The issue, live (`gh issue view 194 --repo windoliver/deepbuild --comments`; no comments): Scope, Fields, the 13
  criteria, Proof and the Oracle line (no upstream test for this criterion).
- `docs/canvas-primitives.md` at the base: Asset: tables; Asset: tables: catalogs `table.layout@1` and its "As built
  (#194)" (`deep-catalog pack`, its reply and `ms`, the record, the CSV and JSON lines cells, a document's catalog asset
  entry, a logic item naming it in `assets`, the layout's packing order); Check input: catalog kinds and its "As built
  (#194)" (`deepbuild/catalog` at `packages/checks/catalog`, the spec's input fields and `catalogs`, the result's
  `catalog: {kind, ms, found}`, `testsRun`, `evidence`, each kind's rules); Logic `logic@1` (`assets`, `assets_at`, the
  copy before the start function, a restore copying nothing); Logic: data layouts; Logic: checkpoints and bake.
- `docs/technical-design.md`: Checks for work beyond code (the Catalog bullet); Numbers version 0 has to hold ("Every
  task carries its own budgets", the reference Macs); How we know version 0 works (Dogfooding; tests written first).
  `AGENTS.md`.
- At the base, for surfaces and harness only: `tests/acceptance/538/helpers.ts` (imported), `538/ac8-budgets.test.ts`,
  `538/fixtures.ts`, `538/programs.ts`, `538-redraft-ac8/README.md`; `556/ac05-budgets.test.ts`,
  `556-redraft-ac5/README.md` and `BASE-FAILURE.txt`; `1048/helpers.ts` (`openHub`, `runCheck`); `535/fixtures.ts` (atlas
  tile sets reading a logic array); `532/README.md` (data assets); `213-redraft-ac3` (deep_query's logic read);
  `415/README.md` (data layouts); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`),
  `scripts/lanes.mjs` (`alone`, `timed`), `scripts/proof-change.mjs` (`criterionId`), `scripts/public-text.mjs`,
  `benchmarks/budgets.json`, `benchmarks/canvas.mjs` (how a task's targets map); `packages/checks/README.md`,
  `packages/checks/playtest/{deepbuild.json,index.ts}`, `packages/extension-host/src/host.ts` (`openExtensionHost`,
  `install`, `runCheck`), `packages/conformance/src/slot-types.ts` (`CheckSpec`, `CheckResult`);
  `crates/deep-show/src/{frames.rs,logic.rs,sandbox.rs,hub.rs,main.rs}` (`frames`' `ran`, `json_values`, `remaps`; the
  `sandbox` call's counts; the check-time validation of a data asset's layout; how plants parse);
  `crates/deep-logic/src/{play.rs,piece.rs,piece/checks.rs,world/world_impl.rs}` (a logic item's `assets` by SHA-256, the
  copy before `init`, fuel per step); `crates/deep-canvas-sandbox/src/layouts.rs` (the base's `table.layout@1` doc and
  validator: header, directory, column entries).

Every expected value comes from the issue, the design or where the fixtures below put it; none from an implementation.

## Run it

```sh
npm ci && npm run build --workspaces     # once, in a fresh worktree
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/194-redraft-ac11 ac11-budgets.test.ts --testTimeout=10800000 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/194-redraft-ac11/tsconfig.json
rm -rf tests/acceptance/194-redraft-ac11/node_modules/.vite
```

What it builds, honoring `CARGO_TARGET_DIR`, each copied to a temporary folder: `cargo build --locked --bin
deep-catalog`; `cargo build --locked --bin deep-show` and #544's assembler (`tests/acceptance/544/wat`, read only, into
`target/acceptance-538-wat/`) through `../538/helpers.ts`; and, on a reference Mac at rest only, `cargo build --locked
--release --bin deep-catalog`. The processes it starts are cargo, the assembler, `deep-catalog pack` and `deep-show run`
(and `fingerprint`'s `sysctl`, `pmset`, `osascript`, `sw_vers` reads through `judgeLimit`), each waited for; nothing is
stopped by name or port. The extension host runs in the test's own process. Temporary folders (fixtures, evidence
stores, the host's home and ledger, binaries) go under the OS temp folder and are deleted after the file. Node built-ins
and vitest only. The one test passes its own timeout, 4 hours.

**The lines the implementer adds** (this README is the instruction; this job writes only its folder):

`scripts/lanes.mjs`:

```js
// #194's criterion 11, redrafted blind: it builds deep-catalog and deep-show, packs 10,000 rows, runs the catalog
// plug-in's reach and economy over 5,000 recipes in a real extension host, and times release packs against judgeLimit.
alone.push('tests/acceptance/194-redraft-ac11/');
timed.push('tests/acceptance/194-redraft-ac11/ac11-budgets.test.ts');
```

`benchmarks/budgets.json`, one task in `tasks` *(chosen: its id, its bench mode and its target names)*:

```json
{
  "id": "catalog-budgets",
  "command": ["node", "benchmarks/canvas.mjs", "catalog"],
  "margin": 0.5,
  "limits": {},
  "targets": { "pack_10000_rows_ms": 1000, "reach_5000_recipes_ms": 200, "economy_5000_recipes_ms": 200, "idle_work": 0 },
  "criteria": ["#194.60b4ab87"],
  "initialReason": "Issue #194 first measurement: the merge base has no catalog probe, no catalog checks and no such task. …"
}
```

The test holds `command`, `margin` and `targets` exactly, `criteria` holding `#194.60b4ab87`, an `initialReason` naming
#194, and the file valid by the lane's `validateBudgets`; `limits` and the reason's wording are the implementer's. The
`catalog` mode of `benchmarks/canvas.mjs` and its judge (as `canvas-game-state`'s and `playtest-crawler`'s are) are the
implementer's too; this test doesn't run them.

## The test, part by part

One test, `AC11 #194.60b4ab87 …`. Parts 1 to 3 run on any machine and gather what is missing or wrong into one list,
asserted before any timing, so one run names all of it.

1. **What each budget times** (debug builds):
   - **Packing 10,000 rows of 20 columns.** `deep-catalog pack` of `parts` (below) answers `ok`, its `sha256` and `size`
     and its record's are the bytes it wrote to `out`, the record is `table.layout@1` with one table `parts` of 10,000 rows
     (10,000 `ids`) and exactly the 20 columns, `missing` is `[]`, and `ms` is a number from 0 to the call's own wall time.
   - **The 5,000 recipes.** `deep-catalog pack` of `workshop` (below): the same checks, its four tables with their rows.
     Then `deepbuild/catalog`, installed from `packages/checks/catalog` into a real extension host (its `deepbuild.json`
     naming it, its release digest `packageDigest` of the folder, `install`, `check` passing conformance, `load`
     loaded), runs `catalog.reach` and `catalog.economy` over it through `host.runCheck`: each `passed` with no failure,
     `testsRun` at least 5,000, `evidence` holding the catalog's asset ID, `catalog.kind` the kind, `catalog.found` `[]`,
     and `catalog.ms` a number from 0 to the run's wall time.
2. **No work per frame**, by the merge base's own counters, not time. `stores` (below) is presented and played in one
   `deep-show run` process: `deep_show`, `{call: "sandbox"}`, `frames` of 30 frames from 0 one frame apart, `frames` of
   10 from `5f` (a seek back), `{call: "sandbox"}` again, and `deep_query`'s logic read of `qm` at steps 0 to 59. Its
   twin, the same piece whose `workshop` entry is a plain data asset (`{sha256, license}`, no `kind`, no `layout`: the
   route the merge base has for the same bytes), is played the same way in a process of its own. Then:
   - both are presented with no error, and in both `qm.value` is 6256 at every step, tool1249's value as `items.csv`
     holds it, read by the program by hash from the bytes in its memory (so the piece did get its catalog);
   - no frame after the first of the piece runs more operators (`ran`) or writes more JSON values (`json_values`) than
     the twin's same frame, and each remaps the same rows (`remaps`);
   - the sandbox's `checks`, `links`, `rewrites` and `runs` are the same after the piece's 40 frames as before them;
   - each of the 60 steps spends the same fuel (above 0) and leaves the same arrays as the twin's.
   Then the piece again with the scenario's `planted: "catalog_validated_per_frame"` (Plant, below): the same judgement
   must fail it with a failure naming the sandbox, its `runs` and the catalog's SHA-256.
3. **The record**, "compared with the merge base": the task above in `benchmarks/budgets.json`, valid by the lane's
   validator (given no merge-base file: the test runs no git), and this file in `scripts/lanes.mjs`'s `timed`.
4. **The timings, only where the lane can judge them.** `judgeLimit` on five zero readings first: anything but PASS (off
   the reference Macs, on battery, Low Power Mode on, thermal state not nominal, or the load above the cores) fails
   `INCONCLUSIVE:` before anything is timed. Then release `deep-catalog`; for each number a warm-up and five readings,
   each with the load at its start and end: the pack's `ms` for `parts`, and `catalog.ms` of `catalog.reach` and of
   `catalog.economy` over `workshop` in the same host, every reading checked as in part 1. Each is judged by
   `judgeLimit` against 1,000, 200 and 200 ms: a FAIL fails the test; anything but PASS leaves it `INCONCLUSIVE:` with
   the readings; three PASSes pass.

## Criterion to test

| ID | File (test) | What it asserts, and the wrong programs it fails on |
|---|---|---|
| 11 `#194.60b4ab87` | `ac11-budgets.test.ts` (1) | Parts 1 to 4 above. Fails: the base (no `deep-catalog`, no plug-in, no record, no lanes line: `BASE-FAILURE.txt`); a probe that doesn't pack the 10,000 rows of 20 columns or reports no `ms`; a pack whose `ms` is over 1,000 in all five readings past the margin on a reference Mac; a reach or economy that doesn't pass the clean 5,000 recipes, judges fewer, reports no `catalog.ms`, or takes over 200 ms in all five readings; a piece whose catalog reaches no memory; a piece that runs an operator, writes a JSON value, remaps a row, runs the sandbox or spends fuel at frame or step time because it names a catalog (the plant shows the judgement catches one); a record without the task or the lanes line |

## The surface under test

The design's (As built), used as it names them:

- **`deep-catalog pack`**: one JSON line on stdin, `{op: "pack", tables: {<table>: {path}}, schema, out}`, one line out,
  `{ok: true, sha256, size, ms, record}`; the record's `layout`, `sha256`, `size`, `tables[].{name, rows, ids,
  columns[].name}` and `missing`. The schema's types as strings (`i32`, `f64`, `bool`, `ref <table>`, `refs <table>`,
  `copy <copy table>`) with `unit` and `range`; refs `;`-separated in CSV; the ID column packed as a column of its own
  name. The tables are CSV (the format from the path's extension).
- **`deepbuild/catalog`** at `packages/checks/catalog`, its kinds through the extension host's `runCheck(kind, spec,
  {checkout, deadline})`: the spec carries its input in `reach` or `economy` and the catalog in `catalogs: {<asset ID> →
  {bytes: base64, record}}`, the asset ID the bytes' SHA-256; the result's `outcome`, `failures`, `testsRun`, `evidence`
  and `catalog: {kind, ms, found}`. `catalog.reach {catalog, roots: [{table, column}], makes: [{table, inputs, tools,
  outputs}], every}`; `catalog.economy {catalog, makes, value: {table, column}, margin}`.
- **A document's catalog asset** `{sha256, kind: "catalog", layout: "table.layout@1"}` (with the film envelope's
  `license`), and a logic item naming its SHA-256 in `assets`.

The base's, unchanged: `deep-show run`'s `deep_show`, `frames` (`ran`, `json_values`, `remaps`), `{call: "sandbox"}`
(`checks`, `links`, `rewrites`, `runs`), `deep_query {what: "logic", items, steps}` (each step's `arrays` and `fuel`),
scenario `planted`; a logic item's `assets` and `assets_at`; atlas tile sets reading a logic array; a plain data asset.

This job's *(chosen)* names and fields, the smallest the criterion needs; the implementer builds exactly these, or a
dispute goes to a blind redraft:

- *(chosen)* **Plant `catalog_validated_per_frame`**, a deep-show scenario `planted` value: at every frame (`frames` and
  `eval`) of a document whose logic item names a catalog asset, deep-show runs that catalog's `table.layout@1` validator
  again, as if no verdict were kept, so the sandbox's `runs` rises by one a frame. Nothing else changes. It's the
  criterion's wrong program, "a piece that does work per frame because it names a catalog", reachable only through
  this value.
- *(chosen)* **The budgets task** `catalog-budgets`, its command `node benchmarks/canvas.mjs catalog`, and its targets
  `pack_10000_rows_ms`, `reach_5000_recipes_ms`, `economy_5000_recipes_ms` and `idle_work` (above).
- *(chosen)* **The spec's other fields** for a catalog kind: `runner: "deepbuild/catalog"`, `inputs: []`, `depth:
  "unit"`, `oracle: "code"`, `contract: null`.
- *(chosen)* **The host**: no replica, no grant, `builtBy: null`; loaded at whatever place the host gives it (the test
  reads `catalog.ms`, the check's own time, so the place doesn't move the reading).

## Fixtures

All written by the test, deterministic, into a temporary folder. A guard in the test refuses a fixture in which two IDs,
or two table or column names, share an FNV-1a hash (none do; it's the fixture's check, never a finding).

- **`parts`** (`parts.csv`): 10,000 rows, IDs `part00000` to `part09999`, and 20 columns: `id`, six `i32` (`level`,
  `stack`, `price`, `tier`, `durability`, `slots`), six `f64` (`weight`, `damage`, `speed`, `reach`, `crit`, `value`),
  two `bool` (`stackable`, `rare`), two `ref parts` (`upgrade`, `salvage`), two `refs parts` (`components`, three IDs a
  row; `drops`, two), and `name`, `copy parts` (keys 1,000 + row). Each cell is a function of its row (the test's
  `PART_COLUMNS`), each value in its column's range, every ref to a row the table holds. About 1.5 MB of CSV.
- **`workshop`** (`items.csv`, `recipes.csv`, `kits.csv`, `loot.csv`): 1,250 families f. Items: `hammer` (0), `ore<f>`
  (2), `wood<f>` (1), `ingot<f>` (5), `blade<f>` (10 + 5f), `tool<f>` (11 + 5f): 6,251 rows, column `value: f64`.
  Recipes, columns `inputs`, `tools`, `outputs` (`refs items`): `smelt<f>` (ore, ore, wood → ingot; hammer), its uncraft
  `salvage<f>` (ingot → ore, ore, wood; hammer), `forge0` (ingot0, ingot0 → blade0; hammer) or `temper<f>` (blade<f−1>,
  ingot<f> → blade<f>; hammer), `assemble<f>` (blade<f>, wood<f> → tool<f>; no tool): 5,000 rows. `kits`: `start`,
  `gear: hammer`. `loot`: `chest<f>`, `drops: ore<f>, wood<f>`. With the start kit's `gear` and the loot's `drops` as
  roots every item and recipe is reachable (the temper chain is 1,250 deep); each smelt and its salvage are a cycle that
  nets 0 of every row, the only cycles; each recipe's outputs are worth exactly its inputs, inside the margin of 5. So
  both checks pass, and their time is a full pass over 5,000 recipes.
- **`qm`** (WebAssembly text, assembled by #544's assembler): memory 32 pages, `reads_at` 0, `writes_at` 4,096,
  `assets_at` 65,536. At init, with an asset, it walks the directory as the base's `table.layout@1` doc lays it out
  (header of 20 bytes, then each table's name hash, row count and column count, and 16 bytes a column: name hash, type,
  `at`, target), finds `items` by the FNV-1a of its name, its `id` and `value` columns by theirs, and `tool1249`'s row by a
  binary search on its ID's hash over the ID column, and keeps that row's `value`; each step k writes (k + i) mod 8 to
  `tiles[i]`, i < 4, and the kept value to `value`. It spends 86 fuel a step at the base.
- **`stores`**: a 40 × 16 film over 1 s at 60 fps: `qm` (`writes: {tiles: i32 × 4, value: f64}`, `assets: [the
  workshop's SHA-256]`) and `strip`, an atlas tile set of 4 × 1 cells of 8 u reading `qm.tiles` as u16 over an atlas of
  eight solid 4 × 4 px cells; its assets `qm_program`, `strip_atlas` and `workshop`.

How these were checked at the base (by scratch files, not committed): the workshop's items table packed by hand to the
base's layout doc passes the base's `table.layout@1` validator at check, and `qm` reads 6256 from it in deep-show; the
per-frame leg's code, run on those bytes, finds no gap and only reports that the base refuses the plant
(`BASE-FAILURE.txt`). Nothing here was run against `deep-catalog` or the plug-in, which don't exist yet.

## Readings where the criterion leaves a choice

- **"On the reference Mac in the local preflight"**: the lane's own rule, `judgeLimit` with `fingerprint`, five readings
  after a warm-up; `timed` in `scripts/lanes.mjs`, which the local preflight runs under a timed grant. The counters of
  part 2 hold on any machine and are judged everywhere.
- **"Compared with the merge base"**: for the times, the perf lane's and the budget window's comparison of the task's
  command on both sides, which the record makes possible (the merge base has neither probe nor checks, so the first
  measurement reads INITIAL with its reason). For "no work per frame", the merge base's route for the same bytes: the
  same piece naming them as a plain data asset, which the base presents, measured by the base's own counters.
- **"Packing 10,000 rows of 20 columns"**: one table of 10,000 rows whose 20 columns count its ID column, so the record
  lists 20 columns; every column type the schema writes appears. "Takes" is the reply's `ms`, the pack's own wall time
  with the files' reads left out (As built), bounded by the call's wall time.
- **"catalog.reach and catalog.economy over 5,000 recipes each"**: one catalog of 5,000 recipes for both, each check
  passing over it; "takes" is the result's `catalog.ms`, the check's own work (As built), bounded by the run's wall time.
  Economy runs with its `value` column and a margin, so both of its rules run.
- **"A piece that names a catalog gains no work per frame"**: frames after the first (frame 0 may do first-frame work),
  plus every frame of a seek back. The two documents run in separate processes: in one run the scheduler reuses a node
  another document's identical item already computed (probed at the base: the second document's first frame ran 3
  operators where the first's ran 13, and two later frames 2), so frames of two documents in one run don't compare.
  `allocs` isn't compared: at the base it moves by up to 3 a frame between two runs of one document, rises by about 41 a
  frame for any named asset and by 1 for a `kind` field, so the catalog entry's two extra fields would read as work.
  Frame times aren't compared either. Fuel and arrays are compared at every step (init isn't a step). The sandbox's
  counts are held over every frame, the first included: a layout's validator runs at check and can never run in a
  frame (Logic: data layouts).

## Gates

- A missing build, plug-in, task or lanes line is a gap in part 1's list, which fails the test naming each; nothing reads
  `BLOCKED` here, since every missing piece is the change's to make.
- Off a reference Mac at rest, the test fails `INCONCLUSIVE:` with the lane's reason after part 1 to 3 passed, before any
  timing; on one, a timing that is neither all within nor all over its limit past the margin fails `INCONCLUSIVE:` with
  its five readings. Never a pass either way.

## What isn't settled

- The plant `catalog_validated_per_frame` and the record's names are this job's; the design names neither.
- Part 2 trusts the base's counters to show per-frame work. Work no counter sees, such as re-reading the asset's file
  at every frame without an operator, a sandbox run or fuel, would pass it; only the merge-base comparison of
  instructions retired in the perf lane would see that.
- `testsRun` is held to at least 5,000, not to an exact count, since "the rows it judged" for economy could be read as
  recipes or as rows of any table.
- The timed legs have never run: no implementation exists, and this Mac (Mac17,10, a reference Mac) was under a load
  of about 100 on 18 cores.

## Files

- `ac11-budgets.test.ts`: the test, its fixtures and program.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as the neighbours'.
- `BASE-FAILURE.txt`: the run at the base.
