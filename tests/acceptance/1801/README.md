# Acceptance tests for #1801: what names an item, and what costs most — `refs_to` and `cost` on deep_query

Written first, blind, by a job that never saw an implementation of #1801; none existed. Written from the issue (its
body, Scope, the seven acceptance criteria, Proof and Depends on), `docs/technical-design.md`,
`docs/canvas-primitives.md` and the base commit `f6ddd396f` ("Merge pull request #2628 …"). The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- The design: in `docs/canvas-primitives.md`, Document session, Meter and degrade ladder, Registry and seal (and its
  registries section), The cost model (per-item and per-pixel terms, "Before it shows"), Document envelope, Item and
  kind (and its relations), Patch, Revision, Writer layer, Path and handle, Driver, Constraint, Instance
  `instance@1`, Material and Material: texture maps, Image `image@1`, Clip and Placement, Text `text@1`: keyed copy,
  Array and table, Object. In `docs/technical-design.md`, How we know version 0 works (wrong programs, Dogfooding,
  Tests written first, kits with planted wrong fills), the MCP tools row of Five ways in, Numbers version 0 has to
  hold with Every task carries its own budgets and The reference Macs.
- Issues #411, #379, #200 and #1725, only for the words #1801 cites ("the same row cap and coverage block", "a
  conclusion of absence drawn from a partial result is refused", "what the meter refuses on", "the registries
  declare").
- At the base: the suites `tests/acceptance/411` (deep_query, scenario plants, the city cut), `1725` (deep_query
  through `deep mcp`, the hub world), `379` (the meter's refusal and its `actual`), `96` (shared documents, patches,
  timing by differencing two runs), `138` (the kit call, its report, the `test-kit-*` modules), `18/kit` (the adapter
  kit on a shipped fill), `304` (tool kinds and the hub's read list), `1729` (pictures in the evidence store);
  `crates/deep-show/src/query.rs`, `main.rs` (`query_call`, the scenario's `planted`), `hub.rs`,
  `shared/calls.rs`, `kit/mod.rs` and `kit/modules.rs`; `crates/deep-canvas/src/document/check.rs` (`Referrers`, the
  budget refusal), `apply.rs` (`delete`), `patch_schema.rs`, `cost.rs`, `budget.rs`, `costs.json`;
  `crates/deep-canvas-motion/src/doc.rs` (constraints), `crates/deep-canvas-scene3d/src/{cut,spec,light,builders}.rs`;
  `packages/hub/src/{tools,hookmap}.ts`, `adapters/index.mjs` (`call`), `adapters/*.facts.json`,
  `packages/adapters`, `packages/conformance` (`runKit`, `shippedFill`, the adapter@1 kit), `scripts/benchmark.mjs`
  (`fingerprint`, `judgeLimit`) and `scripts/lanes.mjs`.

What the base does (seen in scratch runs and in `BASE-FAILURE.txt`, except the kit's refusal of an unknown part,
read in `kit/mod.rs` `KitCall::parse`):

- `deep_query` with `what: "refs_to"` or `"cost"` doesn't parse (`query_call` knows rows, summary, why and logic), so
  a scenario holding one answers `{"ok": false, "code": "bad_input"}`; so does an unknown `planted` value.
- On the door scene, a patch that deletes the door is refused with two `ref_unresolved` errors, one per handle's
  `parent` (`actual: "door"`), and nothing for the constraint, the driver or the instancer that also name it. A
  patch `{"op": "delete", "id": "aim"}` is refused `ref_unresolved` at `items/aim`, "no such item": `delete` reaches
  items only.
- The cost scene presents in the export class; its twin with caps nothing fits is refused with one `over_budget`
  whose `actual` is `{cpu_ms: 3.78, gpu_ms: 0.016, gpu_mb: 8.60, operators, fingerprint}` and whose top three are
  `panel.a`, `panel.b`, `cam`: the meter counts neither the texture's bytes nor the plate's 200,000 triangles (the
  estimate counts a `plate@1` as 4 vertices), and the frame's per-pixel targets (28 B a pixel, 8.6 MB at 640 × 480)
  belong to no item.
- Both agents' facts resolve `mcp__deep__deep_query` to `mcp` by the `mcp__` prefix (which `adapters/index.mjs`
  `call` checks before the tools table), so it counts as change; their `toolKinds.conformance` name
  `claude/toolKinds/unknown-otherwise` and `codex/toolKinds/unknown-otherwise`, which no kit runs.
- The kit has no `references` part (a `kit` call naming it is `bad_input`) and deep-show no `test-kit-pointer`
  features; `deep mcp` lists `deep_query` with `what: rows | summary | why`.

## Run them

```sh
npm ci --ignore-scripts && npm run build --workspaces      # the hub, deep mcp and the conformance runner (AC7)
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0       # the same for every cargo call below and inside the tests
cargo build --locked -q -p deep-show -p deep-hook          # the hub's canvas core and hook client (AC7)
npx vitest run --root tests/acceptance/1801 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1801/tsconfig.json
```

Each file that drives `deep-show run` first runs `cargo build --locked --bin deep-show --no-default-features
--features <set>` for each set it lists (`full`; `kit.test.ts` also `full,test-kit-pointer` and
`full,test-kit-pointer-declared`), copies each binary to a temporary folder, and fails each test whose build failed.
The tests' cargo calls inherit the environment, so run them with the `CARGO_*` settings the binaries were built with,
or the first file rebuilds every crate.
`listed.test.ts` starts a real hub with #1725's world (#806's `startHub`, two agent stand-ins bound by their hooks,
#26's MCP client) under `/tmp/dh806-*` with `HOME` there, and stops what it started by PID. Every other test opens its
evidence store in a temporary folder, runs under a temporary `HOME`, and deletes both. The files build deep-show
per feature set, start a real hub and time a read, so they run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/1801/'` in its `alone` list, as #411's and #1725's READMEs asked for theirs. This README is the
instruction; the implementer makes that edit. With `--root` here Vitest writes `node_modules/.vite` in this folder;
delete it before committing.

## Surface choices

Everything #393's, #96's, #411's, #379's and #138's READMEs define for `deep-show run` holds unchanged: the JSON-lines
convention and `bad_input`, the scenario (`evidence`, `sessions`, `processes`, `panels`, `docs` with `document` for a
shared document, `planted`, `calls`), `deep_show` with a whole revision or a patch, `deep_query`'s rows reply and
its coverage block, the budget refusal, and the `kit` call and its report. The same calls work on `deep-show canvas`
(#806), the canvas core the hub runs. What follows is added; every name is this job's choice, and the implementation
matches it.

### `deep_query` `what: "refs_to"`

```json
{"call": "deep_query", "session": session ID, "doc": doc ID, "rev"?: u64, "what": "refs_to", "target": text,
 "cap"?: n, "cursor"?: text}
```

- `target` names what is named: an item by its ID (`"door"`), or an asset by its SHA-256, 64 lowercase hex. (The
  scope's other two, a table row and a pack entry, take the forms the implementer gives them, such as
  `<id>#<row key>` and `<pack>.<name>`; no criterion reads them.)
- It answers `{"rev": u64, "rows": [Ref], "coverage": Coverage}`, `Ref = {"path": path, "kind": kind}` (a row may
  carry more fields; the tests read these two, and AC4 compares whole rows):
  - one row per field of the revision whose value names the target, in every writer layer and every map keyed by ID:
    an item's own fields and its `params` at any depth, and every entry of `constraints`, `drivers`, `channels`,
    `placements`, `bound_values`, `status_bindings` and the rest. `path` is that field's path in the path grammar,
    to the value itself, a list's index included: `items/handle.left/parent`, `items/doors/params/of/0`,
    `constraints/aim/target`, `drivers/sway/vars/a` (a var whose value is a path into the target names it),
    `items/mat.green/params/maps/base_color`.
  - `kind`, one word of the issue's list: `parent` (an item's `parent`); `target` (a path that writes the item: a
    channel's, a driver's, a bound value's or a status binding's `target`); `driver_binding` (a driver's var bound to
    a path of the item); `constraint` (a constraint's field naming the item, its `target` among them); `instancer`
    (an `instance@1`'s `of` entry); `material` (an item's `material` or `materials` entry naming a material);
    `clip` (a placement's slot bound to the item); `copy_key` (a keyed copy naming a table row).
  - Rows are in `path` order, by code point; a cap keeps the first `cap` (default 200, as #411's rows).
- `coverage` is #411's block: `rows_total`, every row that names the target in the whole revision; `rows_shown`,
  those kept; `cut`, `[{"parent": null, "shown", "total"}]` when the cap cut the rows (they are flat, so the cut is at
  the top level), else `[]`; `complete`, true only when every layer and map was read and nothing was cut. An answer
  with no rows and `complete: true` says nothing in the whole revision names the target.
- A reply past 64 KB pages with `next` as #412 says; 400 rows of the city (under 60 B each) fit in one.

### `deep_query` `what: "cost"`

```json
{"call": "deep_query", "session", "doc", "rev"?, "what": "cost", "t"?: time = "0s",
 "by"?: "cpu_ms" | "gpu_ms" | "gpu_mb" | "decoded_mb" = "gpu_ms", "cap"?: n, "cursor"?}
```

- It answers `{"rev", "t": flicks, "by", "rows": [CostRow], "coverage": Coverage}`: the meter's estimate of one frame
  at `t`, split into rows so that every term the meter sums is in exactly one row, ranked by `by`, highest first,
  ties by the row's `id`, `asset` or `pass` in code point order, under the same cap and coverage block as refs_to.
  A reply past 64 KB pages with `next` (#412), and the same read with `cursor` set to it gives the next page; the
  cost scene's 300-odd rows may take two, and `cost.test.ts` follows them.
- `CostRow` is one of `{"id": item ID, …}` (what the meter charges that item: its operators' per-item, per-vertex and
  per-glyph terms, its draws, its own GPU memory such as its instance record), `{"asset": SHA-256, …}` (an asset the
  revision names by hash, counted once however many fields name it: its decoded bytes and the GPU memory its decoded
  form takes, such as a texture's whole mip chain) and `{"pass": pass name, …}` (a render pass's per-pixel terms over
  the frame: its GPU time and its targets' bytes), each with `"cpu_ms"`, `"gpu_ms"`, `"gpu_mb"` and `"decoded_mb"`
  (numbers ≥ 0, MB as 10^6 bytes as `budget.rs` writes them) and `"share": {the same four}`, each the row's fraction
  of the document's total in that column, 0 to 1.
- The meter's own totals: the budget refusal's `over_budget` `actual` (`{cpu_ms, gpu_ms, gpu_mb, operators,
  fingerprint}` at the base, #379) gains `decoded_mb`, so each of the four columns has the total the meter refuses
  on. The tests read "the meter's total for the frame" there.

### Patches (`deep_show` with `patch`, #96)

- `{"op": "delete", "id": <constraint ID>}` removes that entry of the document's `constraints` map, as it removes an
  item, for the writer whose layer holds it.
- A patch whose `delete` leaves fields naming the deleted item is refused as today (`outcome: "refused"`, errors
  `ref_unresolved`, the revision unchanged), and one of its `ref_unresolved` issues has the deleted item's ID in its
  `ids` and, as its `actual`, the rows refs_to gives for that item at the patch's base: the same row objects, in the
  same order. (The base's issue per referring field may stay beside it.)

### `planted` (scenario field), each reachable only there

| Value | Criterion | The wrong program |
|---|---|---|
| `refs_parents_only` | AC1 | refs_to walks only items' `parent` fields |
| `refs_read_one_layer` | AC2 | refs_to reads only the calling writer's own layer, and answers from it |
| `refusal_names_first_ref` | AC4 | the delete's refusal's `actual` lists only the first row refs_to gives |
| `cost_without_shared_assets` | AC5 | cost leaves out every asset row; the meter is unchanged |

### The kit: part `references`, and the test canvas module `test.kit.pointer`

- The `kit` call (#138) takes one more part, `references`. Over each module's fixtures, every field of the module's
  kinds whose value names an ID the fixture holds (a string at any depth of an item's params equal to an ID of any
  map keyed by ID) must be a reference the kind declares; each that isn't fails the module with the failure
  `{"code": "undeclared_reference", "module", "part": "references", "kind", "field": "<kind>/params/<name>",
  "fixture", "id"}` (#138's failure shape, coverage's field spelling). How a kind declares a reference, with its
  reference kind, is the implementer's; refs_to follows exactly the references the registries declare.
- Cargo features of deep-show, each with `test-kit`, never in a shipped build: `test-kit-pointer` and
  `test-kit-pointer-declared`. Both hold the canvas module `test.kit.pointer` 1.0.0, kind `test.kit.pointer@1`
  {`box`, `points_to: ID | null = null`}, drawn as `rect@1`, with the fixture `parity/kernel/pointer.board`: a
  `rect@1` `t1` and a `test.kit.pointer@1` `p1` whose `points_to` is `t1` (sidecar: `document.validate`, oracle
  `analytic`, codes `[]`). Under `test-kit-pointer`, `points_to` is not declared a reference; under
  `-declared`, it is declared a reference to an item, of kind `target`.

### `deep mcp`: `deep_query`'s schema

`what` becomes the nullable enum `rows | summary | why | refs_to | cost`; it gains the nullable properties `target`
(a string) and `by` (the nullable enum of the four columns), and `t` also serves cost. The hub forwards them to the
canvas core as it forwards the rest.

### The adapter facts and their conformance case

- Both reads are modes of one tool, so an agent calls them as `mcp__deep__deep_query`. `adapters/claude-code.facts.json`
  and `adapters/codex.facts.json` list it in `toolKinds.tools` as `read` (the list the hub's guards count reads by,
  `hookmap.ts` `toolClasses`), and each adapter maps a PreToolUse of it to a `tool.before` whose `data.kind` is
  `read` (at the base the `mcp__` prefix wins over the tools table; the implementer decides how the entry is reached).
- Each facts file's `toolKinds.conformance` names an adapter@1 case (this suite suggests `toolKinds/deep-reads`; the
  tests read the name from the facts) that passes on the shipped adapter's fill and fails, with a message naming
  `mcp__deep__deep_query`, on a fill whose facts count it as anything but `read` or `search`.

## Fixtures

All are made by `helpers.ts`; the two pictures are PNGs the tests write into the evidence store by their hash.

- **The door** (AC1, AC4): a document alpha shares, revision 0 its envelope and alpha's empty layer (#96's seed), and
  alpha's whole revision of a scene through `cam` (scene3d, motion): the box `door`; `handle.left` and
  `handle.right` with `parent: door`; `lamp` with the constraint `aim` `{owner: lamp, kind: look_at, target: door}`;
  `sign`, written by the driver `sway` `{target: items/sign/at/rot/1, expr: "a * 0.5", vars: {a:
  items/door/at/rot/1}}`; and the instancer `doors` `{of: [door], pos: two rows}`. Five fields name the door:
  `constraints/aim/target` (constraint), `drivers/sway/vars/a` (driver_binding), `items/doors/params/of/0`
  (instancer), `items/handle.left/parent` and `items/handle.right/parent` (parent).
- **The posters** (AC2): a document alpha shares with you, revision 0: alpha's layer holds a box; yours holds the
  camera, three `mark.image@1` posters whose `asset` is the picture (a 4 × 4 PNG) and the `material@1` `mat.green`
  whose `maps.base_color` is the picture. It has no `assets` map. The hash nothing names is the SHA-256 of a text no
  test writes anywhere.
- **The city** (AC3): alpha's own scene of 5,000 items: `cam`, the `material@1` `stone` and 4,998 `mark.box@1`
  blocks `b0000`–`b4997`, of which every eighth of the first 4,800 (600) has `material: stone`.
- **The cost scene** (AC5): alpha's own scene in the export class: one 4,096 × 2,048 PNG, the base color map of the
  material `poster` that the boxes `panel.a` and `panel.b` wear; the plate `ground`, a `plate@1` of 500 × 200 cells
  (200,000 triangles); 300 `rect@1` `r000`–`r299`; and `cam`. Its twin names the same class with every cap the
  document can tighten (`frame_cpu_ms`, `frame_gpu_ms`, `gpu_mb`) at 0.0001, so the meter refuses it.
- **The pointer board** (AC6): alpha's own board needing `test.kit.pointer`: the rect `t1` and the pointer `p1`
  whose `points_to` is `t1`.

## Criteria to tests

The issue's checkboxes carry no IDs; AC1–AC7 are their order, and each test's name starts with its criterion's.

| ID | Criterion | Tests, and the wrong program each fails on | On the base |
|---|---|---|---|
| AC1 | In a fixture scene where a door is the target of one constraint, bound in one driver, the parent of two handles and named by one instancer, `refs_to` the door returns exactly five rows with those four kinds and each field's path; removing the constraint by patch makes it four. A planted read that walks only parents returns two and fails, naming the missing kinds | `refs.test.ts`: the five rows, by path and kind, of four kinds, under a complete coverage block; `delete aim` applies and refs_to gives the other four. `refs_parents_only` returns the two parent rows and `refsFailures` fails, naming `constraint`, `driver_binding` and `instancer` | FAIL: `bad_input` (refs_to; `refs_parents_only`) |
| AC2 | `refs_to` an asset hash used by three items and by one material returns four rows; for a hash nothing names it returns no rows with a coverage block that says the whole document was read. A planted read that returns no rows after reading one layer fails, since "a conclusion of absence drawn from a partial result is refused" (#411) | `absence.test.ts`: the picture's four rows, all in your layer, alpha calling; the unnamed hash: no rows, `complete: true`, 0 of 0, no cut. `refs_read_one_layer` returns no rows and fails, naming the picture and each of the four rows it missed (and, when it claims to be complete, the conclusion of absence) | FAIL: `bad_input` |
| AC3 | In a city of 5,000 items where 600 name one shared material, `refs_to` under a 400-row cap returns 400 rows and a coverage block with the total of 600, in under 50 ms on the reference Mac | `city.test.ts`: 400 distinct rows, each a stone block's `material`, coverage `complete: false`, 600, 400, cut `[{parent: null, shown: 400, total: 600}]`; then five runs after a warm-up of the time n reads add to a run that shows the city, over n, judged against 50 ms by `judgeLimit` (INCONCLUSIVE off a reference Mac or under load) | FAIL: `bad_input` (both) |
| AC4 | A patch that removes an item five rows name is refused as today, and the refusal's `actual` now lists the same five rows `refs_to` returns, in the same order; a planted refusal that names only the first fails | `refusal.test.ts`: refs_to the door gives its five rows; the patch deleting the door is refused, revision 1 kept, and a `ref_unresolved` naming the door has refs_to's five rows, in order, as its `actual`. `refusal_names_first_ref` fails `refusalFailures`, naming the four rows after the first | FAIL: `bad_input` |
| AC5 | `cost` on a fixture with one 4,096 px texture, one 200,000-triangle mesh and 300 small rects ranks the texture first by GPU memory and the mesh first by GPU time, and each column's rows sum to the meter's total for the frame within 1%. A planted table that leaves out shared assets sums short and fails, naming the asset | `cost.test.ts`: the meter's four totals from the twin's `over_budget`, each above 0; cost by `gpu_mb`, every row its coverage block counts (through its pages), each once, ranked, the texture's asset row first; by `gpu_ms` ranked, `ground` first; each column's rows within 1% of the meter's total, shares summing to 1. `cost_without_shared_assets` sums short and fails `sumFailures`, naming the texture's hash | FAIL: `bad_input` |
| AC6 | A test canvas module that names an item ID in a field it didn't declare as a reference fails its kit, naming the field; with the declaration added, `refs_to` lists it | `kit.test.ts`: under `test-kit-pointer` the kit's `references` part fails `test.kit.pointer` with `undeclared_reference` naming `test.kit.pointer@1/params/points_to`; under `-declared` the part and the module pass, and refs_to `t1` gives one row, `items/p1/params/points_to`, kind `target` | FAIL: cargo can't build either feature set |
| AC7 | Both reads appear in `tools/list` through `deep mcp` and are counted as read by the Claude Code and Codex facts; a facts file that counts either as change fails its conformance case | `listed.test.ts`: both sessions' `deep_query` takes `what: refs_to` and `cost`, `target` and `by`; each agent's facts list `mcp__deep__deep_query` as read and its adapter maps a PreToolUse of it to kind read, and the case its `toolKinds.conformance` names passes; the planted facts (test code, below) fail that case, naming the tool | FAIL: the schema lacks both; the facts count it `mcp`; the case is no kit's |

The planted facts file of AC7 is test code (`listed.test.ts` `countedAsChange`): the agent's shipped facts with
`toolKinds.tools["mcp__deep__deep_query"]` set to `mcp` and any prefix entry longer than `mcp__` that the name starts
with removed, so both the hub's read list and the adapter's mapping count it as change; the fill is the shipped
fill with an adapter that maps by those facts (`factsAdapter`, the adapters' public entry).

## Ambiguities

Each reading below is where the issue and the design leave a choice; the tests hold the implementation to it.

- **Five rows** (AC1) are one per naming field. Here every naming entry names the door in one field, so one per field
  and one per naming row agree: the door is the parent of two handles, so `parent` appears twice.
- **"The target of one constraint"** is kind `constraint`, though the constraint's field is spelled `target`: the
  issue lists `target` and `constraint` apart, and `target` is kept for a path that writes the item. **"Bound in one
  driver"** is a driver's var bound to a path of the door (`driver_binding`); the driver writes another item.
  **"Named by one instancer"** is an `instance@1`'s `of` entry, its path carrying the list index.
- **"Removing the constraint by patch"** is the patch op `delete` naming the constraint's ID, as it names an item's.
  At the base `delete` reaches items only, so the implementer extends it to the constraint. The door scene is a
  shared document because patches apply to shared documents at the base; alpha draws it as one whole revision so
  its layer holds the constraint and the driver it then patches.
- **"Each field's path"** goes to the value itself: a list's index included, a driver var's own path though its
  value is a path into the door.
- **"A hash nothing names"** is in no field and no `assets` entry. An entry of the document's `assets` map is the
  asset's own record (its hash and license), not a field that names it, so it is no row: a hash only `assets` holds is
  one nothing names. The posters carry no `assets` map, so no test reads that case. **"Says the whole document was
  read"** is #411's block with `complete: true`, `rows_total` 0 and no cut; for refs_to, `complete` also means every
  layer and map was read.
- **"After reading one layer"** (AC2's plant) is the calling writer's own layer. The posters put every naming field in
  your layer and none in alpha's, so the plant returns no rows; the judge fails it on the four rows the document
  holds, and, when its coverage claims to be complete, on the conclusion of absence it drew.
- **AC2's kinds aren't read**: the issue's list names no kind for an image mark's `asset`.
- **The cut** (AC3) of flat rows is the top level's entry, `{parent: null, shown: 400, total: 600}`; which 400 rows
  are kept (the first by path) isn't read. **Under 50 ms** is read off the dev binary, as #96's budgets are (the
  workspace builds the canvas crates at release speed in dev; the implementer may add deep-show there): each run is
  (a run that shows the city and reads refs_to n times, less a run that only shows it) ÷ n, five runs after a
  warm-up that also sizes n to about 2 s of reads (5 to 200); a difference under 0, a read faster than the two runs'
  jitter, reads 0. The rows and coverage counts are a separate test that holds under any load.
- **"Refused as today"** (AC4) is `outcome: refused` with a `ref_unresolved` error and the revision unchanged;
  **"the refusal's actual"** is the `actual` of a `ref_unresolved` issue whose `ids` hold the door; **"the same five
  rows … in the same order"** is the same row objects in refs_to's order.
- **"4,096 px"** (AC5) is the texture's width: 4,096 × 2,048, whose RGBA8 mip chain (about 44.7 MB) fits the
  document's 64 MB decoded cap, which a 4,096 × 4,096 one (about 89.5 MB) passes.
- **"The texture"** is its asset row: a texture is an asset, counted once whatever number of items use it, so it is a
  row of its own, never charged to one of them; this one is shared, a map of one material two panels wear. **"The
  mesh"** is the plate item. **"Each column's rows sum to the meter's total"** needs every term in a row, so a pass's
  per-pixel terms are rows of their own. **"The meter's total for the frame"** is the `over_budget` `actual` of the
  twin the meter refuses, one total per column, `decoded_mb` added; **"at a time t"** is 0 s, the scene being still.
- **"Fails its kit, naming the field"** (AC6) is the kit's verdict FAIL with `undeclared_reference` naming
  `<kind>/params/<name>`, from a kit part that reads the module's fixtures; **"with the declaration added"** is the
  twin build where `points_to` is declared, of kind `target`. Any module whose kind holds an ID in an undeclared
  field fails the same part where its fixtures fill that field (`test.kit.fixer`'s `link: ID` is such a field at
  the base); no test here reads another module.
- **"Both reads … counted as read"** (AC7) is one tool name, `mcp__deep__deep_query`, both reads being its modes.
  **"Counted as read by the facts"** must hold for both readers of the facts: the hub's read list (`toolKinds.tools`)
  and the adapter's mapping (`tool.before`'s kind). **"Its conformance case"** is the adapter@1 case the facts'
  `toolKinds.conformance` names, run by `runKit`; **"a facts file that counts either as change"** is the planted one
  above, deep_query counted `mcp`.

## Not covered (scope with no criterion)

Table rows and pack entries as targets; the kinds `target`, `clip` and `copy_key`; refs_to paging past 64 KB and its
cursor; cost at a time other than 0 s, on a moving scene or cut by its cap; that both reads change nothing
(no revision, no event); the reads on `deep-show canvas` and called through the hub (beyond the list); the shipped
modules under the `references` part; a picture of the graph and a rename tool (out of the issue's scope).

## Files

- `helpers.ts`: builds per feature set, `deep-show run`, the world, the fixtures, pictures in the evidence store, the
  judges (`refsFailures`, `refusalFailures`, `sumFailures`) and the timing judge.
- `refs.test.ts` (AC1), `absence.test.ts` (AC2), `city.test.ts` (AC3), `refusal.test.ts` (AC4), `cost.test.ts`
  (AC5), `kit.test.ts` (AC6), `listed.test.ts` (AC7).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run at the base.
