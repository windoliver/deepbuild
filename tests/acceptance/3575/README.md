# Acceptance tests for #3575: where every number comes from, on screen

Written first, blind, from issue #3575 (its Scope, Fields, eight acceptance criteria, Proof and Not in scope), the
design sections it links and the base commit `94eacba01`, by a job that never saw an implementation; none exists at
the base, and no other worktree, branch or pull request was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). One test a criterion, plus the
two planted wrong programs the Proof line names.

## What was read

- The issue, live, body only (`gh issue view 3575 --repo windoliver/deepbuild --json body -q .body`). Each test's title
  starts `AC<n> #3575.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white
  space collapsed (`scripts/proof-change.mjs`, `criterionId`), recomputed from the live issue.
- `node scripts/design-section.mjs --issue 3575`: Asset: tables; Asset; Bound value; Honest numbers; Pack: assets
  fetched on first use; Selection (session state). `docs/technical-design.md`, Dogfooding. `AGENTS.md`.
- At the base, for surfaces and conventions only: `packages/hub/src/libraries.ts` and `packs.ts` (a pack's listed
  asset, the fetch's one authority ask and its plan, the fetched asset's record in the fetch's reply),
  `packages/hub/src/inbox.ts` (`deep inbox` prints an ask's question and its plan's steps),
  `packages/hub/src/jobs.ts` and `table-record.ts` (a job's table output and its record `tables/<sha256>.json`, each
  input file with the URL and time the hub fetched it, or `origin: agent`), `packages/hub/src/tools.ts` (`deep_job`,
  and the fetch, which was `deep_kinds`' at the base), `packages/jobs/import` and `packages/jobs/asset-tools` (the
  table import and `table.derive`),
  `crates/deep-marks-render/src/lib.rs` (`deep-canvas-render check`, its `issues`, `numbers` and `planted`),
  `crates/deep-canvas-marks/src/{check.rs,data.rs}` and `crates/deep-marks-vello/src/tables.rs` (`{from, column}`,
  the trace of a derived table, `number_unsourced`), `crates/deep-marks-raster/src/lib.rs` (the draw list the replica's
  core prepares), `crates/deep-replica/src/drive` and `snapshot.rs` (`deep-drive`:
  `launch`, `open`, `show`, `see`, `probe`, `act`, `clipboard`, `stored`, `screenshot`; a launch's evidence folder
  `<out>/<launch>/evidence`). The suites `3569` and `3570` (the hub world, the fetch, the import, `twins.json`, `lane.json`),
  `1820` (the fetch's ask), `397`, `406` and `392` (`check`, `numbers`, a bound reading), `1498` and `124` (the
  replica, its clipboard, a taste call) as patterns; their helpers are copied and cut down here, never imported.
- For the fetch's move, on `origin/main` after #3525 and nothing else there: `deep_job`'s schema in
  `packages/hub/src/tools.ts` and `tests/acceptance/1820-redraft-3525/REDRAFT.md`.

## Run them

macOS; Node 24 and rustup's cargo first on `PATH`:

```sh
npm ci
node scripts/throttle.mjs build --wait 60 -- npm run build --workspaces
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-hook
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-marks-render --bin deep-canvas-render
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-show --bin deep-show
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 60 -- scripts/lease cargo build --locked -p deep-replica --bin deep-drive
NO_COLOR=1 node scripts/throttle.mjs test --wait 60 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/3575 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3575/tsconfig.json
```

A `--root` run leaves the runner's cache in `tests/acceptance/3575/node_modules/.vite`; delete it.

- **Builds.** No test builds anything. The hub won't start without the debug `deep-hook`; `deep install` of a data
  pack needs the debug `deep-show`; the check is the debug `deep-canvas-render`; criteria 6 and 8 drive the debug
  `deep-drive` (all from `target/debug`). A test names what it lacks with `BLOCKED:` and fails.
- **One at a time.** `lane.json` puts the folder in `alone`: every file starts real hubs that run sandboxed job tools
  through the supervisor.
- **Safety.** Every folder is under `/tmp/dh3575-*`, removed after its file; every hub, `deep` command, `deep mcp`,
  `deep-canvas-render` and `deep-drive` runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`,
  `CLAUDE*`, `CODEX*`, `GIT_*`, `NODE_OPTIONS`; every process is stopped by its PID; nothing leaves 127.0.0.1 (the
  fetched files are served by the test process over TLS under a test CA made with `openssl`); no model is called.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-3575-proof/`, rewritten each run: the three
  fetch records (`ac1-fetch-records.json`), the list's rows beside them (`ac1-rows.json`,
  `ac2-rows-and-story-numbers.json`, `ac5-rows.json`), the source lines (`ac3-source-lines.json`), the check's
  failures (`ac4-check-failures.json`,
  `ac7-planted-list.json`), the asks as shown (`ac5-asks.json`), the replica's rows with the copied URL
  (`ac6-replica.json`) and the two pictures (`ac8-list-in-app.png`, `ac8-number-source-line.png`, their hashes in
  `ac8-pictures.json`).

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming it; a leg that can't run reads
`BLOCKED:` and fails; the taste call that isn't recorded is a skip reading `INCONCLUSIVE`, never a pass.

## Files

| File | What it holds |
|---|---|
| `helpers.ts` | the world (a hub, `deep mcp`, the cli socket, a TLS file server, a data pack), the fetch and its ask, the table import, `table.derive`, the fixture piece, `deep-canvas-render check` and its readers, the replica |
| `ac1-…` to `ac8-….test.ts` | one file a criterion, one test each |
| `fixtures/*.csv` | the fixture files (below) |
| `twins.json` | the two planted wrong programs by criterion ID |
| `lane.json` | the folder runs alone |
| `BASE-FAILURE.txt` | the run at the base |

## Criteria to tests

| AC | ID | File | Test, and the wrong programs it fails on |
|---|---|---|---|
| 1 | `#3575.1149d4e1` | `ac1-three-rows.test.ts` | Three files fetched after one yes each, imported as tables, the first two joined and summed into one. The piece: label `first` shows the derived cell 250, label `second` the third table's 48226, and a `sources@1` item with all ten fields. The check passes; `sources` lists three rows in the files' order; each record holds the listed title, publisher and edition, the served URL, the file's SHA-256, its size and its license; each row's field equals its record's as text; `used_by` reads 1; an uncredited license shows no credit. Fails on the merge base, a list of the document's assets (two tables, typed licenses), a row with a typed or reformatted field, a record without `source` |
| 2 | `#3575.cc5a5b34` | `ac2-two-rows.test.ts` | The same piece without `second` (its table still among the document's assets) and with a label of a table imported from an agent's file: two rows, the first label's two files. With a reading bound, the only error is `number_unsourced` naming `own#Northfold` or `own`. Fails on the merge base, a list of every asset, a row for the agent's table, a list that makes an agent's number pass |
| 3 | `#3575.b050d53d` | `ac3-source-line.test.ts` | `show: {source: true}` on `first`'s column read: `numbers`' entry for `first` holds `line`, one line with `County employment`, `2019`, `County to metro area crosswalk`, `2020`, `employed`, `workers`, `Northfold` and `sum of 4 rows`. A second hub fetches the same files from the same URLs with the first listed as edition `2018`: the document is byte-equal, the line reads 2018 and not 2019, and the list's row too. Fails on the merge base, a line typed in the document, one that names one input, the derived table or the wrong row count, an edition kept from the first fetch |
| 4 | `#3575.f439728a` | `ac4-check-failures.test.ts` | Control: the list of the whole document passes. `of: ["first"]` with `second` outside: `ok` false, a `data.sources` error naming the third file by title, URL or SHA-256. The patch `row_typed_over` (`add /items/sources/params/rows/0/title`): `ok` false, an error whose `ids` hold `sources`. Fails on the merge base, a check that reads only the scoped items, a list that takes typed rows |
| 5 | `#3575.e744d3c9` | `ac5-ask.test.ts` | Each of the three asks, as `deep inbox` prints it, holds the file's size, license, title, publisher and edition. A fourth file listed without the three, fetched and imported; a list grouped by publisher of it and the third file: two rows, the third file under its publisher, the fourth under `127.0.0.1` (with or without its port) with a dash for each of title, publisher and edition. Fails on the merge base, an ask that shows no title, a guessed title (the file's name, the path), an empty cell, a row under no heading |
| 6 | `#3575.1f2653c3` | `ac6-replica.test.ts` | The piece shown in `deep-drive` over a copy of the hub's evidence store: `see`'s tree holds three nodes of role `row` or `list_item`, each holding one file's URL whole, in order; your ⌥-drag across the first row then ⌘C puts a text on the replica's clipboard that holds the record's URL byte for byte; from the piece's opening to another page's, the replica's record gains no `source.called` and the files' server no request. Fails on the merge base, rows left out of the tree, a URL cut or wrapped with a break, a list that fetches |
| 7 | `#3575.397602e4` | `ac7-planted-list.test.ts` | Control: the list passes with three rows. `check` with `planted: "sources_leaves_out_uncredited"`: the list draws the credited file's row alone, `ok` false, the first `data.sources` error names the second file. Fails on the merge base, a check that trusts the list it checks, one that names the last file or none |
| 8 | `#3575.723dcdab` | `ac8-shown.test.ts` | The piece, `show.source` on `first`, in `deep-drive`: a picture of the window; the pointer over `first`, after which the snapshot holds `sum of 4 rows` where it held none; a second picture. Both PNGs go to the proof folder. With no `TASTE.json` here naming exactly those two hashes the test is skipped, `INCONCLUSIVE`; `looks_right` passes, anything else fails. No picture is read to judge it |

## The surface under test

The issue and the design name the kind `sources@1` and its fields `of`, `fields`, `group`; `show: {source: bool}` on a
column read; the check `data.sources`; the fetch's plan fields `title`, `publisher`, `edition` and its ask; the asset
record's `source: {url, fetched, title, publisher, edition}`; the app's replica. Where they leave a name or a shape
open, this job picked the smallest surface the design and the base imply. **Each choice is listed here, so the
implementer builds to it**, or a dispute goes to a blind redraft.

1. **The fetch** is the base's: a data pack installed with `deep install <folder>` lists each file in `assets` by
   `path`, `url`, `sha256`, `size`, `license {id, terms, shareable, credit}` and `upstream`;
   `deep_job {op: "fetch", pack, asset}` holds on one authority ask, your yes is `deep inbox answer`, and the call
   then answers `{status: "fetched", asset}`. At the base `94eacba01` that call was `deep_kinds {op: "fetch", pack,
   asset}`; main moved it to `deep_job` in #3525, with the same fields and replies, and refuses the old one with
   `enum`, so the suite calls the new form (`BASE-FAILURE.txt`, the note of November 27, 2026). **Chosen:** a listed
   asset may also carry `title`, `publisher` and `edition`, strings, each optional; they are what the fetch's plan
   shows and what your yes stores.
2. **The ask as shown** is what `deep inbox` prints for it: its line and the indented lines under it (the plan's
   steps). The test reads the file's size and license ID there, as at the base, and its title, publisher and edition.
3. **The asset's record** is `asset` in the fetch's reply. Read: `sha256`, `license.id`, `license.credit`,
   `files[].bytes` (the base's), and **`source: {url, fetched, title, publisher, edition}`** (new; the base's reply
   holds `fetched: {url, at}` and no `source`). `url` and `fetched` are a string or a number; a field your yes didn't
   store is null or absent. A row shows a record's value as its own text: a string as it is, a number as its JSON
   digits, so `bytes` shows `42` and `fetched` shows what the record holds, never another format of it.
4. **The tables** are the base's: `deep_job {op: "run", kind: "import", tool: <the table tool>, params: {from: "table",
   columns, key}, inputs: [{name: "file", sha256}]}` over a fetched file, and `kind: "table.derive"` over two of those
   tables: `join` on `county`, `derive {jobs: {expr: "manufacturing", unit: "workers"}}` (the import's record carries
   no unit at the base, so the unit is stated here), `group {by: ["metro"], agg: {employed: "sum(jobs)"}}`, key
   `metro`. A table an agent wrote is the same import over `inputs: [{name: "file", path}]`.
5. **The document** names tables as the base does (`assets: {id → {sha256, license}}`; a text `marks@1` set of one row
   whose `columns.text` is `{from, column}`). The license typed there is the table's and never the file's: the tests
   type `credit: "Typed in the document"` and no row may show it. **Chosen:**
   - the list is `{id: "sources", kind: "sources@1", at: {pos}, params: {of: "document" | [item ID], fields: [...],
     group: "none" | "publisher"}}`;
   - a column read that shows its source is `{from, column, show: {source: true}}`.
   Everything `sources@1` and the source line read lies in the evidence store's folder, as a table's record does:
   `check` is given only `evidence`, and the replica only its own evidence folder, a copy of the hub's.
6. **The rows the list draws** *(chosen)*: `deep-canvas-render check {doc, look: "clean", evidence}` answers, beside
   `numbers`, **`sources: [{item, rows: [{group, fields}]}]`**: one entry for each `sources@1` item, its rows in the
   order drawn, `fields` an object from each of the item's `fields` to the text the row shows for it, `group` the
   heading the row lists under (a string with `group: "publisher"`, null with `group: "none"`). It is answered
   whether or not the check passes, as `numbers` is. A field the record lacks shows a dash (`-` or U+2010 to U+2015 or
   U+2212, one character); the credit of a license that carries none isn't held to a dash, only to no letter or digit.
7. **The rows' order** isn't named by the issue. The fixture makes every order agree: the files' first use in the
   document, their fetch times, titles, publishers, editions, license IDs, URLs and SHA-256 all ascend from the first
   file to the third.
8. **The source line** *(chosen)*: `numbers`' entry for a number whose column read carries `show: {source: true}`
   holds **`line`**, the one line hover or focus shows, as a string with no line break. Each part is matched as a
   word of its own (not inside another word or number).
9. **`data.sources`** is an error of the check's `issues` whose `check`, the base's field for the check that raised an
   issue (`document.validate` at the base), or whose `code` is `data.sources`. It names a file when its `ids`, `path`,
   `actual` or `what` holds the file's title, URL or SHA-256.
10. **The planted list** is `check`'s `planted: "sources_leaves_out_uncredited"`, as the base's `check` takes a
    planted value: the list's rows are drawn by the wrong program and judged by the shipped `data.sources`.
11. **A row typed over** is the document after the patch `{op: "add", path: "/items/sources/params/rows/0/title",
    value: "Typed over"}`, applied by the test and handed whole to `check`.
12. **The replica** is `deep-drive --out <dir>` as #1498's suite drives it, launched on its own fixture record
    (`crates/deep-replica/fixtures/plain-words.events.jsonl`, given to `launch` by its path), with the hub's evidence
    store copied first to `<dir>/1/evidence`, the folder the base's first launch keeps its evidence in.
    `show {session, document}` takes the piece as a figure (800 × 450, an orthographic camera, no layer named).
    **Chosen:** each row of the list is a node of `see`'s `snapshot.tree` with role `row` or
    `list_item`, whose name or value, or its descendants', hold the row's text, its bounds the row's place; your
    ⌥-drag (`act {kind: "drag", point, to_point, mods: ["alt"], source: "hid"}`) from a pixel inside its top left to
    one inside its bottom right selects the row's text, and your ⌘C copies it. With `show.source`, the pointer held
    over the label for a second of the replica's clock puts the source line into the snapshot (the tree, the drawn
    strings or an item's value).

## The planted programs

| Name (`twins.json`) | Criterion | What it is | How the test plants it |
|---|---|---|---|
| `sources_leaves_out_uncredited` | 7 | a list that leaves out every file whose license carries no credit | `check`'s `planted` |
| `row_typed_over` | 4 | a list one row of which a patch set | the patched document |

## Fixtures

| File | Listed as | License | Holds |
|---|---|---|---|
| `counties.csv` | `a-counties.csv`, County employment, Tarn Vale Census Office, 2019 | CC-BY-4.0, credit The county returns of Tarn Vale | counties 1 to 4: 120, 80, 40, 10 manufacturing workers |
| `crosswalk.csv` | `b-crosswalk.csv`, County to metro area crosswalk, Tarn Vale Mapping Board, 2020 | CC0-1.0, no credit | each county in Northfold |
| `population.csv` | `c-population.csv`, Metro area population, Tarn Vale Residents Register, 2022 | CC0-1.0, no credit | Northfold, 48226 people |
| `unlisted.csv` | `d-unlisted.csv`, no title, publisher or edition | CC0-1.0, no credit | Northfold, 37 schools |
| `agent.csv` | never fetched: an agent's file | none | Northfold, 9120 visitors |

Every name is made up. Each license's terms are a file of the pack, so no fetch reads a license from a host.

## Readings where the issue leaves a choice

- **"Fetched files, replayed from a recording"**: the files are served by the test process, the same bytes each run,
  and each is fetched with `deep_job {op: "fetch", pack, asset}`.
- **A table and its file share a hash here**: the import writes each fixture file's own bytes as its table, so
  `assets.population` names the third file's SHA-256 too. The list's rows are the fetched files either way.
- **"A label shows a cell"**: a text mark set of one row over a table of one row, the base's only reader of a column.
- **"Lists under its host's name"**: with `group: "publisher"`, a file with no publisher is listed under the host of
  the URL the hub fetched it from. With `group: "none"` nothing is read of it.
- **"Its numbers stay story numbers"**: with a reading bound, the label of the agent's table fails `number_unsourced`,
  the base's code, and nothing else fails.
- **"Copies as the bytes of its record"**: the copy of the row holds the record's URL as a run of the same bytes.
- **"From the time the piece opens to the time it closes"**: from just before `show` to after another session's page
  opens.

## What the implementer adds outside this folder

- `title`, `publisher` and `edition` on a pack's listed asset, shown by the fetch's ask and its plan, stored by your
  yes in the fetched asset's record as `source: {url, fetched, title, publisher, edition}`.
- `sources@1` in the data module, the records it reads kept in the evidence store's folder, `show: {source}` on a
  column read, `check`'s `sources` and the `line` of a `numbers` entry, `data.sources`, and `check`'s planted
  `sources_leaves_out_uncredited`.
- In the replica: its copy of the canvas core reads a table's columns from its evidence folder (at the base it reads
  none, so `show` refuses the piece with `asset_missing` at the first label's column read; `BASE-FAILURE.txt`), the
  list's rows in `see`'s tree, and the source line under the pointer.

## BLOCKED, INCONCLUSIVE and not tested

- Criterion 8 is INCONCLUSIVE (a skip) until `TASTE.json` in this folder records the call on the run's two pictures:
  `{issue, criterion, verdict: "looks_right" | "looks_wrong", who, when, files: {name: sha256}, note}`, as #124's.
- Criteria 6 and 8 need macOS; elsewhere they fail `INCONCLUSIVE:`.
- Not tested, because no criterion asks: `group: "publisher"` with every file named, a list in a playable page or the
  web player, `used_by` above 1, a text or a readout (the base has neither reading a column), focus in place of hover,
  the unit of an imported table, a file the hub fetched for a job other than a table, and a library's fetch.
