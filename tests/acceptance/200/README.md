# Acceptance tests for #200: registries and the closure rule

Written first, from issue #200 ("Registries and the closure rule: a canvas module declares a list others fill, with
its kit and a planted wrong entry, and every list is a registry, closed with its reason, or open": its Scope, its
Fields, its fifteen acceptance criteria and its Proof line), the design sections it links, and base commit
`a7e140b2` ("Merge pull request #1007 … worktree-github-issue-386-b3be11"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 200`, and its oracle page (`doneright/oracles/issues/200.md` in
  `DeepBuildAI/deepbuild`, branch `doneright`).
- `docs/canvas-primitives.md`: Canvas module (`declares: {registries}`, "the core declares any that more than one
  canvas module fills"); Canvas module: interface and implementation ("An interface's digest also covers each
  registry its module declares, with the entry schema and the module's own entries filled at the seal, and the
  entries the module fills at the seal into a registry the core declares; it never covers another canvas module's
  entries"); Registry and seal (`registries`, "publishes them at `deep://registries/<core version>`", "It can never
  … seal a registry whose kit admits one of its planted wrong entries"); Registry and seal: registries (every field,
  the semantics paragraph and its cost: "a lookup O(1) by interned name; nothing per frame"); Registries and closed
  lists (the whole table: the planted entries of `mark@1`, `builder@1`, `modifier@1`, `check.kind.doc@1`,
  `gpu.step@1`, `gpu.output@1`, `gpu.function@1`, `device.class@1`, `logic.service@1`; the Budget class row
  `closed: budget`; the hub slot row); Channel and key: table eases (`ease@1`); Control: kinds as a registry (a kit
  with a planted wrong entry per part).
- `docs/technical-design.md`: The canvas core; Socket roles and contract versions; Composition (hub slots: "Every
  hub slot … names its interface `name@major` with a frozen digest, how many pieces may fill it …, its kit … and a
  planted wrong fill"; "`deep_kinds` and `deep://registries` list the hub's slots beside the canvas's registries, in
  the same shape"); the agent-tools paragraph ("`deep://registries/<core version>` needs none either").
- At the base: `crates/deep-canvas/src/registry/mod.rs` (`Registrar`, `SealError`, `Fault`, `CORE_CHECK_KINDS`),
  `crates/deep-show` (`deep-show run`, `start_args`/`planted_named`, the `seal_refused` line, the `registry`,
  `schedule`, `fixtures`, `eval`, `kit`, `install_pack`, `packs`, `verdict` calls, the build-set and `test-*`
  features), `crates/deep-canvas-test-modules`, `crates/deep-canvas-effects/src/table.rs` (the op table, 83 base
  steps) and `check.rs` (today's operator outputs), `crates/deep-canvas-scene3d/src/module.rs` (today's marks and
  modifiers; no builders), `packages/contracts` (`canvas-registries.json`, `hub-slots.json`, `src/lint.ts`),
  `packages/conformance/src/closures.ts` (`serveAt`), `scripts/contract-diff.mjs`, `scripts/conformance-lint.mjs`,
  `scripts/slots-check.mjs`, `scripts/canvas-kit.mjs`, `scripts/lanes.mjs`; the suites `185` (layout, helpers,
  refusals, the budgets pattern), `305`, `306` (packs, failure functions run on planted programs), `138`, `139`
  (scratch trees for the contract step), `44`, `380`, `387` (`eval` nodes and content keys), `403` (claims and
  `verdict`).

## What the base already does, which these tests don't credit

`packages/contracts/canvas-registries.json` holds two preview rows (`kind@1`, `check.kind.doc@1`, tracking #200),
and `scripts/contract-diff.mjs` (#139) already diffs registry rows by their `entry` schema and reads a schema enum's
`x-closure.mark` (extensible additive, exhaustive a break) under `packages/contracts/schemas/`. The hub already has
its closure rule (#313: `x-closure` on every hub-schema enum, the conformance lint, `serveAt` mapping an unknown
member of an extensible enum to `unknown`) and its slot table (#349: `hub-slots.json`, the `check.kind@1` slot with
its kit and planted fills, `slots-check.mjs`). The op table names itself "the base entries of the registry
`gpu.step@1`" but is a closed Rust table inside the effects module. The seal refuses with `modules`, `arrays`,
`interface`; there is no registry, entry, kit, planted entry, `registries` call, `resolve` call, canvas schema,
closure lint or drift test, and none of this suite's test features or planted names.

## Run them

```sh
npm ci && npm run build --workspaces     # once: the contract step and the conformance package run from dist
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/200 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/200/tsconfig.json
```

Each file builds every feature set it lists once (`cargo build --locked --bin deep-show --no-default-features
--features <set>[,<test feature>…]`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary out under its own name, and fails each test that uses a
build that failed. `gpu.test.ts`, `core-registries.test.ts` and `budgets.test.ts` also build the merge base
(`git merge-base HEAD origin/main`, exported with `git archive` into `target/acceptance-200-base/<sha>/` and built
there with its own target folder, kept so later runs build warm), only after the candidate's own structural checks
pass. `closures.test.ts` and `listing.test.ts` run the scripts on scratch trees in temporary folders. Every
temporary folder is deleted. Node built-ins and vitest only, plus the repo's own built `packages/conformance` entry
(for `serveAt`) and `scripts/lanes.mjs`.

`scripts/lanes.mjs` needs `'tests/acceptance/200/'` added to its `alone` list (the files build cargo binaries and
`budgets.test.ts` times the seal), which also takes the folder off the parallel line; this README is the
instruction, and the implementer makes that edit.

Every test, here and in `redraft/`, passes an explicit timeout as the last argument of `it` (`1_800_000` ms, or the
longer one it already had), as the other `deep-show` suites do: each starts freshly built binaries, whose first exec
on macOS alone can take seconds, and AC10's pixel-hash test builds the merge base in its body, which vitest's 5 s
default can't hold. The blind job added these timeouts on the owner's approval; no assertion or expected value
changed.

Gates: `budgets.test.ts`'s two timings run only on a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off,
thermal state nominal, a 1-minute load at most the core count; mains power never gates); elsewhere they skip as
INCONCLUSIVE after their structural checks, and a reading between the limit and the margin also skips as
INCONCLUSIVE; none passes by skipping. The pixel-hash half of AC10's merge-base test needs the GPU (macOS): with
`unsupported_platform` it skips as INCONCLUSIVE after the content keys were compared. `BASE-FAILURE.txt` is the run
at the base.

## The surface under test

Everything is `deep-show run` as #393, #305, #306, #387, #403, #138 and #185 left it: JSON lines in, one reply per
call; the `registry`, `fixtures`, `eval`, `kit`, `install_pack`, `packs`, `verdict` calls; the scenario's `packs`
and `claims`; the startup `--planted <name>` argument (an unknown name answers `bad_input`, exit 2); build sets
`core` and `r2`; test canvas modules behind `test-*` features; the `seal_refused` startup line with exit 2. Plus
`scripts/contract-diff.mjs` (#139) unchanged in its interface. **Every name below that the issue doesn't give is
this job's invention**, the smallest surface consistent with the design and the base; the implementer builds
exactly these, or a dispute goes to a blind redraft.

### Test canvas modules and features of `deep-show` (none in a shipped build)

| Feature | What the build holds |
|---|---|
| `test-mark` | module `test.mark`, declaring `test.mark@1`: owner `test.mark`, entry schema `{name: string, size: integer 0..4294967295}` (`additionalProperties: false`, both required), `fill: [module, pack]`, `resolve: seal`, `binds: all`, `stability: stable`, `since: R2`, kit `[{rule: size_at_most_64, message}]`, planted `[{name: big, value: {name: big, size: 65}}]`; its own entry `dot {size: 8}`; a document check kind `test.mark.fits` whose check input `{kind, entry}` passes when the entry resolves through the deliverable's pinned packs and passes the kit |
| `test-mark-dot-9` | the same with `dot {size: 9}` |
| `test-mark-no-planted` / `test-mark-no-since` | the same, `test.mark@1` declared with no planted entry / with no `since` |
| `test-mark-dot-twice` | `test-mark` plus module `test.mark.other`, which also fills an entry `dot` into `test.mark@1` |
| `test-mark-binds-author` | `test-mark` with `binds: author` |
| `test-mark-schema-changed` | `test.mark@1` whose entry schema adds a required `color: string` (same major) |
| `test-mark-v2` | `test.mark@1` as in `test-mark`, with `deprecated_since: R3` and `replaced_by: test.mark@2`, beside `test.mark@2` (the changed schema, `since: R3`) |
| `test-mode-closed` | module `test.mode`, kind `test.swatch@1` `{box, mode: a \| b}` (drawn as a rect; its operator's result depends on the mode), the list closed; registers fixtures, one with an item in mode `b` |
| `test-mode-registry` | the same, the list opened as `test.mode@1` (owner `test.mode`), first entries `a` and `b` keeping their since and digest |
| `test-mode-renumbered` | planted: the opening that renumbers the entries |
| `test-fill-a`, `test-fill-b` | modules `test.fill.a` (entry `square`) and `test.fill.b` (entry `circle`), filling `test.shape@1`, which the core declares in any build with a `test-fill-*` feature |
| `test-fill-c`, `test-fill-b-part` | module `test.fill.c` declaring `test.part@1`; `test.fill.b` that also fills an entry `wheel` into `test.part@1` |
| `test-gpustep`, `test-gpustep-no-fixture`, `test-gpustep-no-twin` | module `test.gpustep` registering the step `test.gpustep.mix@1` in `gpu.step@1` with its exactness fixture and planted twin; without the fixture; without the twin |
| `test-leave-out-effects` | the set's list without `effects` (as `test-leave-out-look`) |
| `test-steps-in-effects` | planted layout: the base steps of `gpu.step@1` registered by the effects module instead of the core |
| `test-rules-shared` | module `test.rules` declaring `test.rules@1`, kit rules `size_at_most_64`, `size_even`, `name_lowercase`, one planted entry `{name: odd, size: 65}` (breaks the first two) |
| `test-rules-isolated` | the same kit, planted `{name: big, size: 66}`, `{name: odd, size: 7}`, `{name: Upper, size: 8}` |
| `test-registries-load` | module `test.load` declaring ten registries (owner `test.load`) of 100 entries each, with their kits and planted entries |

### Planted startup arguments (`--planted <name>`)

`kit_admits_all:<registry>` (that registry's kit replaced by one that admits every entry); `hashes_every_entry`
(the seal hashes every entry of a core registry into each filler's digest); `takes_foreign_entry` (the seal takes
a module's entry into the declaring module's digest instead of refusing it); `registries_without_slots` (the
listing leaves hub slots out); `slot_fill_as_entry` (the listing lists a slot's fills as entries of a registry).

### The startup refusal

#305's and #185's line gains `registry` (name@major), `entries` (each an entry's name, or a planted entry as
`{name, value}`), `rules` (kit rule IDs) and, where a pass is involved, `passes`. Reasons read:
`kit_admits_planted`, `registry_incomplete` (no kit, planted entry or since), `duplicate_entry` or `foreign_entry`
(both accepted for AC2's second `dot`), `foreign_entry` (AC8), `entry_refused` (an entry a module fills fails its
kit or lacks a required part, such as a step's exactness fixture or twin), `step_unresolved` (a pass's step has no
entry).

### `registries`: deep://registries/<core version>

`{"call": "registries"}` → `{"uri": "deep://registries/<core version>", "registries": [Listed]}`, one list holding
every registry and every hub slot:

```json
Listed (registry) = {"kind": "registry", "name": "name@major", "registry": "name@major", "owner": "core" | module,
  "entry": JSON Schema, "fill": [...], "resolve": "seal" | "check", "binds": "all" | "author",
  "kit": [{"rule", "message"}], "planted": [{"name", "value", "result": KitResult}],
  "since", "stability", "tracking"?, "deprecated_since"?, "replaced_by"?, "digest": d1 digest, "entries": [Entry]}
Entry = {"name", "registry", "origin": "first_party" | "pack" | "plugin" | "agent", "module"?: module | "core",
  "pack"?: "<owner>/<name>@<version>", "value", "since", "digest", "kit": KitResult,
  "twin_result"?: KitResult}           // gpu.step@1: its exactness fixture on its planted twin
KitResult = {"verdict": "PASS" | "FAIL", "rules": [{"rule", "verdict", "message"?}]}   // FAIL names the entry
Listed (slot) = {"kind": "slot", "name": interface, "interface", "digest", "how_many", "kit", "planted",
  "since", "fills": [{"name", "kit": KitResult}]}
```

A registry row's contract fields (`registry`, `owner`, `fill`, `resolve`, `since`, `stability`, `tracking`,
`deprecated_since`, `replaced_by`, `entry`) are its `canvas-registries.json` row: AC6 writes them to a scratch tree
and runs the contract step on them. Pack entries installed in the process are listed with origin `pack` (or
`agent` for a pack the working agent installed). A slot's `interface`, `digest`, `how_many` (the table's `fills`)
and `planted` are its `packages/contracts/hub-slots.json` row; its `fills` are the hub's installed fills, from the
scenario field `installed: [{slot, fill, kit: KitResult}]` (the kit result the hub recorded at install).

For a base step of `gpu.step@1`, `value` holds `signature`, `weight` and `exact` (as the op table), `fixture` (its
exactness fixture: add@1's holds the case 2147483647 + 1 = -2147483648) and `twin`. Planted entry names: `mark@1`
`bounds_miss_pixel`, `builder@1` `count_not_from_params`, `modifier@1` `deform_adds_vertices`, `check.kind.doc@1`
`uncatalogued_code`, `gpu.output@1` `vec3_read_as_vec4`, `gpu.function@1` `exact_takes_float_step`, `gpu.step@1`
`add_saturating`, `device.class@1` `frame_rate_dependent` and `plugin_257_bytes`, `logic.service@1`
`answers_after_next_step`.

### Other calls and fields

- **`install_pack`** gains `session` (the working agent's session: its entries get origin `agent`); a pack folder's
  `pack.json` gains `entries: {"name@major": [entry]}`, each entry named `<pack>.<name>`. A refused entry is an
  error issue whose JSON names the registry, the entry and the rule (or, for a first-party name, `dot`; for a
  registry packs can't fill, `module`).
- **`resolve`**: `{"call": "resolve", "doc", "registry", "name", "runs"?}` → `{"entry": Entry, "ns"?: [n]}`, the
  entry through the document's pinned packs, or `{"code"}` when that document resolves none; `ns` times each of
  `runs` lookups by interned name.
- **`registry`** gains `seal.registries: {ms, runs}` (the seal's registry checks, as #185's `seal.interfaces`) and
  each `passes[name].steps: [gpu.step@1 entry]` for a GPU pass, the steps it compiles from (a shadow pass and an
  object-ID pass among them in the r2 sets).
- **`verdict`** (#403) gains `asks: [{kind: "approval", requirement, …}]`.
- **`kit`** (#138) runs a part `registries` on a module that declares registries: each rule isolated by a planted
  entry that breaks it alone; a failure names the registry and the rule.

### Scripts

- **`node scripts/canvas-closures.mjs closures|drift [--root <tree>]`** (new; the lint lane runs both): `closures`
  reads `<tree>/packages/contracts/canvas-schemas/*.json` (the canvas schemas, JSON Schema) and requires on every
  enum an `x-closure` of `{registry: name@major}` (declared in `<tree>/packages/contracts/canvas-registries.json`),
  `{closed: ring|record|determinism|card|budget|interval_forms|draw_path, reopens_if, mark: exhaustive|extensible}`
  (extensible lists `unknown`), or `{open: item|pack}`; `drift` checks the table in
  `<tree>/docs/canvas-primitives.md`, Registries and closed lists, against the closure data
  (`packages/contracts/canvas-closures.json`, the implementer's shape, and the registries). Lines `PASS closures: …`
  / `FAIL closures: <list>: …` (and `drift`); exit 0, 1, or 3 when blocked.
- **`scripts/contract-diff.mjs`** (#139) covers the canvas schemas under `packages/contracts/canvas-schemas/` (a
  `dump` key holding the schema's name), so a member added to an exhaustive list fails `check`, naming the list.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 `#200.eec510cf` | `module.test.ts` (4): the listing of test.mark@1; dot's digest change at size 9; testpack.ring installed and resolved only through a board naming it; bigpack.huge refused naming test.mark@1, bigpack.huge, size_at_most_64 |
| AC2 `#200.d373067b` | `module.test.ts` (4): `kit_admits_all:test.mark@1` refused naming test.mark@1 and `"size":65` (control seals); no planted; no since; dot twice naming both modules |
| AC3 `#200.31886771` | `names.test.ts` (3): barepack refused naming dot; binds author INCONCLUSIVE with an approval ask; binds all PASS (control) |
| AC4 `#200.be794a42` | `closures.test.ts` (4): no closure fails naming test_mode; closed passes; registry closure passes only while declared; lint lane and checkout. `redraft/closures-drift-redraft.test.ts` (1): drift clean and planted Budget class row (the blind redraft replaced the first draft, which planted its row on the budget classes table; `redraft/REDRAFT.md`) |
| AC5 `#200.f96a94c8` | `opening.test.ts` (2): opening keeps keys, written bytes and snapshots; renumbered fails naming entry b and swatch-b |
| AC6 `#200.400aefd1` | `listing.test.ts` (2): listing of test.mark@1 and its entries; contract diff R2 → changed (FAIL naming test.mark@1) → v2 (PASS, replaced_by) |
| AC7 `#200.d93a89e4` | `listing.test.ts` (3): slot beside test.mark@1 with fills and kit results; `registries_without_slots` and `slot_fill_as_entry` fail naming check.kind@1 |
| AC8 `#200.a1b12018` | `fillers.test.ts` (4): a seals without b, a's digest equal; `hashes_every_entry` fails naming test.fill.a; c refused naming test.part@1, c, b; `takes_foreign_entry` seals and fails |
| AC9 `#200.8a760791` | `gpu.test.ts` (2): steppack refused naming gpu.step@1 and module; step without fixture or twin refused naming it (control seals) |
| AC10 `#200.70cd4e69` | `gpu.test.ts` (5): the build without effects with every base step, today's outputs, gpu.function@1; each twin refused naming its step (add@1's CTS case); shadow and object-ID passes from gpu.step@1; planted layout refused naming a base step and the shadow pass; the Map's 3D pixel hash and operator keys equal the merge base's |
| AC11 `#200.bd93251c` | `core-registries.test.ts` (8): the four registries with today's entries and the six planted entries refused; content keys equal the merge base's; `kit_admits_all` for each of the six |
| AC12 `#200.100d2ed4` | `budgets.test.ts` (3): startup with 10 × 100 entries against the merge base; lookup under 1 µs; nothing per frame |
| AC13 `#200.a10a9ddf` | `core-registries.test.ts` (4): the four planted entries refused naming them; `kit_admits_all` for device.class@1, logic.service@1, gpu.step@1 |
| AC14 `#200.78025075` | `kit-rules.test.ts` (2): shared planted entry fails the kit's registries part naming every unisolated rule; isolated passes, one rule each with its message |
| AC15 `#200.81fef80c` | `closures.test.ts` (3): extensible member added in R3 passes the contract step and reads unknown at R2; exhaustive member fails naming test_dir; closure without mark fails the lint naming test_tone |

Each test's name starts with its criterion. Where a criterion names a wrong program, the test runs it (a planted
startup argument or a planted test feature) and asserts the criterion's check fails, its failure naming what the
criterion says.

## Oracle

The oracle page lists upstream tests for 2 of 15 criteria, AC10 and AC13: webgpu-cts at `e325d0bcc2`,
`src/webgpu/shader/execution/expression/binary/i32_arithmetic.spec.ts:15-28` and its cache, which run `x + y` on
i32 extremes and expect the wrapped `i32(x + y)`, so 2147483647 + 1 reads -2147483648. This suite holds `add@1`'s
exactness fixture to that case (its value must hold both numbers) and requires the planted `add_saturating` twin to
fail; it does not run the CTS itself (#136's runner). The other 13 are ours, with no upstream test.

## Readings where the issue leaves a choice

- **"The kit part"** (AC1) is the kit's rule, `size_at_most_64`; kits list rules (Fields).
- **The planted entry {size: 65}** has a name (`big`) because the entry schema requires one; the refusal is read for
  `"size":65`.
- **"A second module entry named dot"** (AC2): test.mark@1 is test.mark's own registry, so a second module's `dot`
  there is refused either as a duplicate or as a foreign entry; both name both modules, and both reasons pass.
- **Binds author** (AC3): "the working agent wrote" is a pack installed through its session (`install_pack`'s
  `session`); the approval ask is a verdict `asks` row; the binds-all control shows the check itself passes.
- **"Fails the local preflight"** (AC4, AC15) is the new closure script's FAIL line and the lint lane running it;
  "the drift test" is its `drift` command, run on a copy of the docs whose Budget class row is planted. The
  committed table must pass it.
- **"Registered"/"declared"** (AC4) is a row in canvas-registries.json, the published registry data; the full-set
  listing and that file agreeing is the implementer's to keep (not read here).
- **"Golden"** (AC5) is the bytes each evaluated node wrote (`eval`'s `result`); "snapshot" the pixel sha256.
- **The contract diff** (AC6) runs on the contract rows the binary publishes, written to a scratch tree as R2 and
  R3, so it reads only the test registries; test.mark@1 is published `stable` (a preview entry is outside the diff).
- **"Marked as a slot"** (AC7) is `kind: "slot"`; "fails, naming the slot" is this suite's listing check, run on the
  two planted listings.
- **"Every operator key stays the same"** (AC10) is every `eval` node's content key (operator × item) on the Map's
  3D fixture, against the merge base; "the first step" is whichever base step the refusal names first.
- **"Today's outputs"** are the outputs the base's operator check types: pass `color`, `coverage`; material
  `base_color`, `emission`, `alpha`, `metallic`, `roughness` (an entry named `color`, `<x>.color` or `color@1`).
- **"Today's marks"** are the `mark.*` kinds of the merge base's r2 build; "today's builders" are none (the base has
  none), so builder@1 is read as declared with its planted entry; "today's check kinds" are the core's eleven.
- **"Refused by the preflight"** (AC14) is the canvas conformance kit's `registries` part, which the preflight's
  canvas kit lane runs.
- **The reader at the earlier minor** (AC15) is the conformance package's `serveAt`, the reader the design gives for
  a value a later minor added, applied to the canvas schema; the base already has it, so the test's new part is the
  contract step covering canvas schemas.

## Not tested, because no criterion asks

`deep_kinds` listing registries (the agent tools task); plug-in entries at install; the registries other tasks
declare beyond the planted entries AC13 names; `ease@1`'s opening (the canvas time task); the full-set listing
against canvas-registries.json; logic@1's exports and the library and provider interfaces as contract entries.
