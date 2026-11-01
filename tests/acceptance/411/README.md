# Acceptance tests for #411: reading a scene — deep_query, deep.canvas.read for check plug-ins, and deep_show's modes

Written first, blind, by a job that never saw an implementation of #411; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #411 (its Scope, its 10 acceptance criteria, its Proof line) and its oracle page
  (`doneright/oracles/issues/411.md` in `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks any of
  the 10 criteria.
- `docs/technical-design.md`: Extension API (TypeScript, in-process), with `deep.registerCheck`,
  `deep.canvas.read(doc, query)` and `deep.canvas.play`; the MCP tools row (`deep_query` "returns a revision's
  evaluated rows, series, provenance and diffs by stable ID, with a coverage block", its summary and its why,
  `deep_show` gaining modes and readings, `deep://modules`, `issues_since`); the Verdict and Check rows of Building
  blocks; Dogfooding and Tests written first.
- `docs/canvas-primitives.md`: Conventions (the path grammar, Handles: "a reply returns a value only to a caller that
  may read it"), Render-back and Render-back: diagnostic modes, Canvas module, Document envelope, Item and kind,
  Recipe, Modifier, Content key, Channel and key, Driver, Constraint, What holds a document to its rules, Check input
  and Check input: plug-in reads, Determinism class.
- At the base (`f41a5b3e`): the blind suites `tests/acceptance/393` (deep_show, the `deep-show run` scenario binary,
  handles and `ref_unresolved`, the evidence store), `387` and `857` (`eval`, `frames`, `planted`, Cargo feature
  builds), `96` (shared documents in `docs[…].document`), `305` (`registry`), `306` (packs and recipes), `403`
  (claims with requirements, `verdict`), `349` (`runCheck`, first-party test packages in the hub), `363` and `364`
  (the extension host, grants, manifests), `26`, `884`, `855`, `674`; `crates/deep-show` (`run` and the long-lived
  `canvas` the hub keeps, #806), `crates/deep-canvas`, `crates/deep-canvas-motion`, `crates/deep-canvas-scene3d`,
  `packages/extension-host` (`runCheck`, `registerCheck`, `EXTENSION_API`), `packages/hub/src/canvas.ts`,
  `packages/conformance` (`CheckResult`), `packages/evidence` and `scripts/lanes.mjs`.

What the base does: `deep-show run` and `deep-show canvas` answer a scenario or call holding `deep_query` with
`bad_input`; `deep_show` ignores a `mode` field and returns its plain snapshot with no `drawn`; an item's
`modifiers` field is `unknown_field`; `registry` has no `kinds`; a verdict's requirement rows carry no `machines`;
there is no `test-machines` feature and none of this suite's `planted` values; `ExtensionHostOptions` has no
`canvas`, `EXTENSION_API` no `deep.canvas.read`. It already presents the door (a pack recipe instance with a
driver), the stopped door (a channel and a constraint), the 5,000-item city, the shared gate board and the summary
scene, so the fixtures are valid documents there.

## Run them

They build `deep-show` per Cargo feature set and start sandbox-free hosts, so they run one file at a time.
`scripts/lanes.mjs` needs `'tests/acceptance/411/'` added to its `alone` list beside `'tests/acceptance/857/'`
(which leaves the folder out of the parallel vitest line and runs it on the one-at-a-time line), as #387's and
#857's READMEs asked for theirs. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/411 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/411/tsconfig.json
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features <set>[,test-machines]`
for each build it lists (`full`, `r1` — the build set without scene3d — and `full,test-machines`), copies each binary
to a temporary folder, and fails each test whose build failed. Every test opens its evidence store in a temporary
folder and deletes it; `plugin.test.ts` also opens a record, the asks core, the supervisor and an extension host in
temporary folders, under a temporary `HOME`, and stops the `deep-show canvas` process it started by its PID.
Everything runs headless on the CPU except `machines.test.ts`, whose test module runs GPU operators (Metal on the
Mac). `BASE-FAILURE.txt` is the run at the base: every test fails there, none passes.

## Surfaces this suite defines

Everything #393's, #96's, #305's, #306's, #387's and #403's READMEs define for `deep-show` holds unchanged: the
JSON-lines convention and `bad_input`, the scenario (`evidence`, `sessions`, `processes`, `panels`, `docs` with
`document` for a shared document, `record`, `claims` with `requirements`, `packs`, `planted`), `deep_show` and
`deep show` (`peer`, `check`, `claim`, `include`, `t`, `size`) and their replies, `registry` and `verdict`. The same
calls work on `deep-show canvas` (#806: one `{"world": …}` line, then one `{"call": …}` line per call, each answered
`{"ok": true, "reply": …}`). Times are the time grammar's text (`"1s"`); a content key is 32 lowercase hex (#387).

### `deep_query` (a call of `deep-show run` and `deep-show canvas`)

```json
{"call": "deep_query", "session": session ID | null, "doc": doc ID, "rev"?: u64,
 "what"?: "rows" | "summary" | "why",
 "items"?: [ID], "paths"?: [path], "at"?: [time], "cap"?: n, "expect"?: {"none": {"kind": kind}},
 "path"?: path, "t"?: time}
```

The agent's MCP tool, as the hub forwards it: `session` is the session the call bound to (a call bound to none is
refused with `no_session`, as #393's deep_show). `rev` defaults to the document's current revision. The calling
session reads only what its credential may: a value read through a handle it can't read is never returned.

**`what: "rows"`** (the default) answers

```json
{"rev": u64, "rows": [Row], "values": {path → [value | null]}, "keys": {path → [content key | null]},
 "unresolved": [{"path"?: path, "id"?: ID, "code": "ref_unresolved", "handle"?: handle}],
 "coverage": Coverage, "absent"?: bool, "code"?: "partial_result"}
Row = {"id": ID, "parent": ID | null, "kind": kind, "layer": layer ID, "module": canvas module | "core",
       "key": content key, "children_total": n, "code"?: "ref_unresolved"}
Coverage = {"complete": bool, "rows_total": n, "rows_shown": n,
            "cut": [{"parent": ID | null, "shown": n, "total": n}]}
```

- `rows`: one row per item, keyed by its stable ID, for the items `items` names (every item when it names none),
  each row after its parent (depth first), cut to `cap` rows (default 200). `children_total` is the number of
  children the item has in the whole result, whether or not they were kept. A row whose item binds a handle the
  caller can't read carries `code: "ref_unresolved"` and nothing read through it.
- `values` and `keys`: for each path in `paths`, one entry per time in `at` (default `["0s"]`), in `at`'s order: the
  evaluated value at that time, and the content key of the node that produced it. A path the caller can't read
  (through a handle, or for a plug-in outside its grant) gives `null` in both and an `unresolved` entry. Values are
  never cut.
- `coverage`: `rows_total` rows matched, `rows_shown` kept; `cut` names every place rows were left out: one entry
  for each kept row, or the top level (`parent: null`), some of whose children were cut, with how many were shown
  and its total. `complete` is true only when nothing was cut and nothing is unresolved. A cut is depth first: every
  kept row's parent is kept.
- `expect: {"none": {"kind": K}}` asks deep_query to conclude that no row is of kind K. On a complete result it
  answers `absent: true` or `absent: false`; on a partial one (`complete: false`) that holds no row of K it refuses
  with `code: "partial_result"` and never `absent: true`, since the rows left out may hold one.

**`what: "summary"`** answers `{"rev", "summary": {"items": n, "by_kind": {kind → n}, "by_layer": {layer ID → n},
"by_module": {canvas module | "core" → n}, …}}`: the document's counts over its items (budget use and open issues
beside them are the implementer's shape; the tests read the four fields named).

**`what: "why"`** with `path` and `t` (default `"0s"`) answers `{"rev", "why": Why}`:

```json
Why = {"path": path, "t": flicks, "value": value,
       "module": "<canvas module>@<semver>", "operator": operator, "reads": [read term],
       "writes": [Write], "sources": [{"path": path, "value": value}], "defaults": [Default]}
Write = {"entry": document entry path, "module": "<canvas module>@<semver>", "operator": operator, "value": value,
         "status": "stands" | "overwritten_by" | "clamped_by", "by"?: {"entry", "module", "operator"}}
Default = {"recipe": "<pack kind>", "pack": "<owner>/<name>@<version>", "input": name, "value": value}
```

- `module`, `operator`, `reads`: the canvas module (with its version) and operator whose write stands, with that
  operator's reads.
- `writes`: every write to the value at `t`, in evaluation order. `entry` is the document entry that made it, as a
  path: a channel key `channels/<channel>/keys/<key>`, a driver `drivers/<id>`, a constraint `constraints/<id>`.
  `status` is `stands` for the one that stands; a write a later one replaced is `overwritten_by`, one a later one
  held within its bounds is `clamped_by`, and `by` names that later write.
- `sources`: each document field (a path to a value the document itself holds) the standing write's operator read on
  the way to the value, nearest first, with its value. A field the document doesn't hold is never listed.
- `defaults`: each value on the way that traces to no document field because a recipe's input took its default,
  naming the recipe, its pack and the input with the default's value.

### `deep_show` and `deep show`: `mode`

`"mode": name` on a `deep_show` or `deep show` call with `include: ["pixels"]` renders the same frame at `t` in that
diagnostic mode. The closed list, spelled: `lighting_only`, `overdraw`, `normals`, `cascade_splits`,
`shadow_atlas`, `luminance_false_color`, `lights_per_cluster`, `lod_per_item`, `receivers_casters`, `skeleton`,
`lights_cameras`, `bounds`, `physics_shapes`, `uv_checker`. The reply adds:

- `mode`: the name; `display_only: true`; each snapshot (`{sha256, w, h}`, a PNG in the evidence store by its hash,
  as #393's) adds `display_only: true`. A mode's snapshot draws a view in place of the look, so it is not the plain
  snapshot's bytes.
- `drawn`: `[{"id": ID, "what": "box" | "joint" | "light" | "camera" | "shape", "pos": [x, y, z], …}]`, what the mode
  drew, by stable ID, with its world position at `t` (2D: `z` 0). `bounds` draws each item's evaluated bounds as the
  core's bounds array holds them at `t`, with `"what": "box"`, `"min": [x, y, z]`, `"max": [x, y, z]` in world units.
- With `check: true`, a mode's snapshots and readings never count as evidence: the `result` for a claim about code
  (one whose deliverables are source files) is never PASS.
- A mode whose canvas module the build lacks answers `"code": "module_missing"`, naming the module (the scene3d
  modes in the `r1` build name `scene3d`), with no snapshot and no `drawn`.

### `registry` gains `kinds`

`"kinds": {kind → canvas module | "core"}`: every item kind the build registers, as documents name it (`rect@1`,
`mark.box@1`), with the canvas module that registers it.

### `verdict` requirement rows gain `machines` and `determinism`

Each row of `verdict`'s `requirements` (#403) adds `"machines": "any" | "same"` and `"determinism": "exact" |
"same_machine" | "live_only"`, the class of what its check read: CPU data and GPU work read back from an exact
operator are `exact` and `any`; anything a float GPU operator wrote is `same_machine` and `same`.

### Documents: modifiers, drivers, constraints

- An item takes `"modifiers": [{"kind": "mod.<name>@<major>", "params": {…}}]` (Modifier); the tests use
  `mod.subdivide@1 {levels}`, `mod.array@1 {count, offset}` and `mod.mirror@1 {axes}` on a `mark.box@1`.
- `items/<id>/modifiers/<k>#out`, k the modifier's index from 0, reads the stack's result after modifier k:
  `{"vertices": n, "faces": n, "parts": n, "bounds": [[x, y, z], [x, y, z]], "key": content key}`, from the prefix
  cache, equal to the last prefix of the same stack cut after k. An array of `count` n multiplies the three counts
  by n.
- A driver: `"drivers": {id → {"target": path, "expr": string, "vars": {name → path}}}` (Driver).
- A limit constraint: `"constraints": {id → {"owner": ID, "kind": "limit", "what": "rotation", "bounds": [[min,
  max] | null, × 3]}}`, per-axis degrees, `null` for an axis it leaves free (Constraint: `limit {what, per-axis
  bounds}`).

### `planted` (scenario field), each reachable only there

| Value | Criterion | The wrong program |
|---|---|---|
| `prefix_reads_final` | AC7 | `items/<id>/modifiers/<k>#out` returns the stack's final result for every k |
| `why_names_operator_only` | AC8 | a why names the module and operator and no `sources` or `defaults` |
| `why_names_key_only` | AC9 | a why lists only the channel key's write |
| `cuts_by_row_order` | AC10 | the rows cut keeps the first `cap` items in ID order (code point), ignoring parents, listed in that order |

### Cargo feature `test-machines` (in no shipped build)

Canvas module `test.machines` 1.0.0 (in `crates/deep-canvas-test-modules`, or wherever a GPU operator may live).
Kind `test.machines.swatch@1` {`box`}, drawn as `rect@1`; documents name `requires.modules: {"test.machines":
"^1"}`. It registers, per swatch, an array a GPU operator writes with float ops (same machine), and one a GPU
operator writes with integer ops only (exact), read back; and three document check kinds that raise no error on a
swatch: `test.machines.cpu` reads only the items' params on the CPU, `test.machines.float` reads the float array,
and `test.machines.exact` reads the exact array through its readback.

### The extension host: `deep.canvas.read`

- `ExtensionHostOptions.canvas?: (call: Record<string, unknown>) => Promise<Record<string, unknown>>`: the canvas core
  the host reads through, the hub's own (`Canvas.call` on `deep-show canvas`). The tests pass one that writes the
  call to a `deep-show canvas` process and resolves with its `reply`.
- `InstallFrom.grant.docs?: string[]`: the documents (doc IDs) a plug-in may read; absent, none.
- `EXTENSION_API` gains `{ method: 'deep.canvas.read', needs: 'canvas' }`, a preview method (Lands R6): a manifest asks
  for it with `access.words: ["canvas"]` and `requires.preview: ["deep.canvas.read"]`.
- In a package: `await deep.canvas.read("<doc>@<rev>", {paths, at, lists?, bake?})` resolves with deep_query's rows
  reply for that revision (`values`, `keys`, `rows`, `coverage`, `unresolved`), evaluated as deep_query evaluates it,
  under the plug-in's grant: every path of a document the grant doesn't cover is `null` with a `ref_unresolved`
  entry in `unresolved`. The host sends the core `{"call": "deep_query", "plugin": {"id": <package ID>, "docs":
  <grant.docs>}, "doc", "rev", "paths", "at", …}` (or answers outside the grant itself); it never patches a document
  or writes the record.
- `runCheck` refuses a run that made `deep.canvas.read` calls and reports `outcome: 'passed'` without every content
  key those reads returned in its `evidence`: its outcome is another of check.kind@1's, never `passed`, and a
  failure message names the package ID. A run whose evidence holds them goes through unchanged.

## Fixtures

- `fixtures/packs/door-1.0.0/`: pack `test/door@1.0.0`, recipe `door.leaf@1`, inputs `open` (0..1, default 0) and
  `swing` (deg, default 90), one 80 × 8 leaf. The door documents (`helpers.ts`: `door`) are an instance `door` with
  `params {open: 0.5, swing: 90}` and the driver `swing`: `items/door/at/rot/2 = open × swing`.
- `fixtures/parity/agent/query-summary.scene`: the issue's scene, a board you, alpha and bravo share: 13 items of
  four kinds (`rect@1` 6, `text@1` 3, `circle@1` 3, `group@1` 1) over three writer layers (4, 4, 5). #387's suite kept
  its parity scenes in its own `fixtures/parity/` the same way, to move when the corpus lands.
- `fixtures/door-reader/`: the test check plug-in `test/door-reader`, check kind `ext.door-reader.open`, loaded
  first-party in the hub. Its runner reads `reader.json` (written at install: the config file's path) and at each
  run the config `{seen, reads: [{doc, rev, paths, at}], evidence: "keys" | "none"}`; it makes each read, appends
  `{doc, rev, reply}` to `seen`, and reports passed with every content key read (`keys`) or none (`none`, the planted
  runner).
- In `helpers.ts`: the stopped door (a `rect@1` door, channel `angle` keyed 0° at 0 s and 80° at 1 s, hold; constraint
  `stop` holding rotation about z within [0°, 45°]); the hull; the city (125 `group@1` blocks `town.block.NNN` of 39
  `rect@1` lamp posts `lamp.NNN.MM`, lamp posts listed first); the gate board (your shared layer, the gate's fill
  bound to an ask's state).

## Criteria to tests

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused | `rows.test.ts`: rows for `items: [c, a]` are exactly `a` and `c`, each `rect@1`, no parent, a content key, `children_total` 0, under a complete coverage block (2 of 2, nothing cut); `expect none circle@1` is `absent: true` on a board without one, `absent: false` with the fountain, and on the city cut to 400 rows refused with `partial_result`, never `absent: true` |
| AC2 | deep_show's modes return snapshots by hash with readings as numbers, and none of its results counts as evidence for a claim about code | `modes.test.ts`: `bounds` at 1 s on a sliding box: one display-only PNG in the evidence store whose SHA-256 is its name, of the size asked, unlike the plain snapshot; box a's bounds [100, 30, 0]–[140, 50, 0] at 1 s and from x 0 at 0 s, box b's where it stands; `deep show --check` in the mode for a claim about code: display only, never PASS; `lights_cameras` in `r1`: `module_missing` naming scene3d, no snapshot, no readings |
| AC3 | deep_query's summary matches the document's own counts by kind, writer layer and canvas module (parity/agent/query-summary.scene) | `summary.test.ts`: `items`, `by_kind`, `by_layer` and `by_module` equal the scene's own counts, by module through `registry`'s `kinds` |
| AC4 | A check result that read float GPU work says machines: same, and one marked any reads only CPU data or exact GPU work | `machines.test.ts` (`full,test-machines`): requirement rows of `document.validate` and `test.machines.cpu` say any/exact, `test.machines.float` same/same_machine, `test.machines.exact` any/exact. Fails a program that marks all any (the float row) or all same (the others) |
| AC5 | deep_query returns no value read through a handle the calling session can't read: a document that binds another session's open ask answers ref_unresolved for that item, never its value | `handles.test.ts`: on your shared gate board bound to bravo's open ask, bravo reads the gate's fill; alpha gets `[null]`, `ref_unresolved` for the path and on the gate's row, and neither `needs_you` nor bravo's value anywhere in its reply |
| AC6 | A test check plug-in reads items/door/params/open at 0, 1 and 2 s through deep.canvas.read and gets the values and content keys deep_query returns for the same revision; a read of a document its grant doesn't cover returns ref_unresolved for every path; and a result it reports as PASS without the read's content keys as evidence is refused by the validator, naming the plug-in | `plugin.test.ts`: one `deep-show canvas`; deep_query gives `[0.5, 0.5, 0.5]` with three keys; the plug-in, granted the first door only, reads the same values and keys and its PASS with them goes through; the second door: `open` and the angle each `ref_unresolved`, no value; the planted runner (`evidence: "none"`) is refused, the refusal naming `test/door-reader` |
| AC7 | deep_query reads `items/<id>/modifiers/<k>#out` for every k of a three-modifier stack, each equal to a clean evaluation of the stack cut after k; a planted read that returns the final result for k < 3 fails on a stack whose array modifier changes the counts | `modifiers.test.ts`: k = 0, 1, 2 each have counts, bounds and a key, each equal to a fresh process's read of the stack cut after k; the array triples the counts; `prefix_reads_final` fails `prefixFailures`, naming `items/hull/modifiers/0#out` |
| AC8 | On a fixture whose door's drawn angle is 45° because its driver multiplies open (0.5) by swing (90°), the why for the drawn angle names both paths with their values, and changing either path changes the value it names; a value from a recipe's default names that recipe and default; and a planted why that names only the operator fails, naming the value | `why-paths.test.ts`: the door drawn at 45°, its why naming open 0.5 and swing 90 with a module@version and operator; open 0.25 → 22.5 naming 0.25; swing 120 → 60 naming 120; swing left out → 45 naming open, not swing, and the default `door.leaf@1`/`test/door@1.0.0`/`swing` 90; `why_names_operator_only` fails `whySourceFailures`, naming `items/door/at/rot/2 = 45` |
| AC9 | On a fixture where a channel key sets the door's angle to 80° at 1 s and a limit constraint holds it at 45°, the why at 1 s lists the key's write marked clamped_by the constraint and the constraint's write marked stands; a planted why that names only the key fails, naming the value | `why-writes.test.ts`: drawn at 45° at 1 s; the key `channels/angle/keys/k1` writes 80 `clamped_by` `constraints/stop`, which writes 45 and `stands`, in that order, each with a module@version and operator; `why_names_key_only` fails `whyWriteFailures`, naming `items/door/at/rot/2 = 45` |
| AC10 | deep_query of a 5,000-item city under a 400-row cap returns rows whose parents are all present, each with `children_total`, and a coverage block that names the cut; a planted cut by row order returns lamp posts whose block was cut and fails, naming the first row without its parent | `cut.test.ts`: at most 400 rows, every parent kept, each `children_total` the item's (39 or 0), coverage `complete: false`, `rows_total` 5,000, `rows_shown` the rows kept, and one `cut` entry, right, for every kept row and the top level with children left out; `cuts_by_row_order` fails `parentFailures`, naming `lamp.000.00` without `town.block.000` first |

## Readings where the issue and design leave a choice

- **One binary standing in for the hub's canvas side** (as #393's): deep_query is an MCP tool the hub forwards to its
  canvas core (#806 does so for deep_show), so its criteria are read on `deep-show run`; the MCP forward, its schema
  and its tool description are the hub's and aren't read here.
- **A conclusion of absence** is `expect: {none: …}`: the tool, asked to conclude absence, refuses on a partial result
  (`partial_result`, this suite's code) and answers on a complete one, so an agent can't draw "none" from 400 rows of
  5,000.
- **"Readings as numbers"** are the mode's `drawn` rows, the design's "what it drew as numbers". **"Never evidence
  for a claim about code"** is read on `deep show --check` with a claim whose deliverable is a source file: never PASS,
  everything display only.
- **`keys` per time.** The design writes `keys: {path → content key}`; with several times each time's evaluation has
  its own node, so `keys` aligns with `values`, one key per time.
- **"The validator"** refusing a plug-in's PASS is the core's gate on a check result, `runCheck`, as #349 read "a
  check runner can't return a passed run without its results". The plug-in runs first-party in the hub so a test can
  read what it got; the grant applies there as anywhere.
- **The grant over documents** is `grant.docs` (doc IDs), this suite's spelling of "under the plug-in's grant".
- **Prefixes from 0.** `<k>` is a list index, as everywhere in the path grammar, so a three-modifier stack has k = 0,
  1, 2 and "the final result for k < 3" is the planted read's answer for every k; it fails on k = 0 and 1.
- **The why's sources** are document fields only; a value a recipe's default gave is in `defaults`, never a source.
  "Nearest first" orders `sources`; both of the door's are one step from the driver, so their order isn't read.
- **The planted cut** keeps rows in ID order: every lamp post (`lamp.…`) sorts before every block (`town.block.…`),
  so whether "row order" means ID order or the document's listing (lamp posts first), it keeps 400 lamp posts and no
  block, and `lamp.000.00` is the first row without its parent.
- **Machines on check results** are read on #403's `verdict` rows, the check results the design's check inputs
  produce; the determinism class names what the check read.

## Not covered (scope with no criterion)

`issues_since` on every reply, `deep://modules`, `deep_run` running check kinds canvas modules register as tool
entries, frames, shots, sheets, contact sheets and turntables on deep_show, the summary's budget use and open issues,
series, provenance and diffs, `deep.canvas.read`'s `lists` and `bake`, `deep.canvas.play`, the other thirteen modes'
drawings, and the closed list's refusal of an unknown mode. The 3D modes' criteria sit with #78, skeleton's with
#130 and physics shapes' with #97 (the issue's scope).

## Files

`README.md`, `BASE-FAILURE.txt`, `tsconfig.json`, `helpers.ts`, `rows.test.ts` (AC1), `modes.test.ts` (AC2),
`summary.test.ts` (AC3), `machines.test.ts` (AC4), `handles.test.ts` (AC5), `plugin.test.ts` (AC6),
`modifiers.test.ts` (AC7), `why-paths.test.ts` (AC8), `why-writes.test.ts` (AC9), `cut.test.ts` (AC10),
`fixtures/packs/door-1.0.0/`, `fixtures/parity/agent/query-summary.scene`, `fixtures/door-reader/`.
