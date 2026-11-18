# Acceptance tests for #416: library interfaces, the layouts part (criteria 5 and 6, and criterion 7's layout half)

Written first, from issue #416 ("Library interfaces: lib.interface@1, fixtures from the interface, and physics2d.lib@1,
fsm@1 and nn.mlp@1": its Scope, its Fields, criteria 5, 6 and 7 of its seven and its Proof line), its Oracle page, the
design sections it links and base commit `3c124dee5` ("Merge pull request #2754 …"), by a job that never saw an
implementation; none existed. Another blind job writes `tests/acceptance/416/interfaces/` (criteria 1 to 4, and
criterion 7's interface half) and owns the three interfaces' exports, fixtures and planted libraries; this suite reads
only what the design's fields name for them. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 416 --repo windoliver/deepbuild --comments`: no comments), and its Oracle page
  (`doneright/oracles/issues/416.md` in `DeepBuildAI/deepbuild`, branch `doneright`): criteria 5 and 6 have no
  upstream test ("the NaN validator, deep_kinds, the registry's fill and fn.table@1 and pages@1 caps are our
  interfaces, layouts and record rules"), nor does 7 ("a time or cost budget on the reference Mac, compared with the
  merge base").
- `docs/canvas-primitives.md`: Logic: data layouts; Logic: library interfaces; Logic: linked libraries; Logic: sandbox
  (the validator role, its budget); Logic `logic@1` (`assets`, copied from `assets_at`); Provider `gen@1` and its links
  section (`out: data`); Pack (`interfaces`, `layouts`); Registry and seal: registries; Registries and closed lists;
  Document envelope (`assets`); Asset. `docs/technical-design.md`: The logic module (Library interfaces, Data
  layouts), the Canvas modules paragraph on registries, the `deep_kinds` row, Dogfooding. AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/sandbox.rs` (`validate`, `validate_bytes`, the pack check of a
  layout's twins, a provider's `out: data` refusal), `src/registries.rs` (#213's `fill_checked`), `src/kinds.rs` and
  `src/kinds/replies.rs` (`deep_kinds` `list`, its pages), `src/logic.rs`, `src/hub.rs` (`install_pack`, `sandbox`,
  `refused_reply`), `src/frames.rs` (`ran`), `src/sandbox/providers.rs` (the pack check's runs, a provider use's
  path); `crates/deep-play/src/logic.rs` (a logic item's assets by hash from the evidence store);
  `crates/deep-canvas/src/registry/{core_lists,lists}.rs` (`data.layout@1`, a registry row's `fill`);
  `crates/deep-canvas-sandbox/src/layouts.rs` (the first-party layouts' caps and docs);
  `crates/deep-sandbox-wasmtime/src/service.rs` (the validator's budget, `param_bytes`); `scripts/proof-change.mjs`
  (criterion IDs), `scripts/lanes.mjs`; the suites `415/` (closest: `validate`, packs with layouts), `192/dungeon`,
  `192/voxel` and `192/packs` (a provider's data output in a logic item's assets, the merge-base budget pattern),
  `238/` (the sandbox counts, the reference-Mac judge), `213/` (a plug-in's refused fill), `412/` (`deep_kinds`,
  `plugin_entries`), `531/` (the assembler copied here).

What the base already does, which these tests don't credit: `validate` validates an asset in a first-party or pack
layout once per asset hash and validator hash (#415); a pack layout is admitted only when its validator refuses every
twin, else the pack is refused naming the twin (#238, #415); a provider's `out: data` is validated by its layout and a
refusal names the asset, the layout and the offset (#415, #192); `deep_kinds` lists data.layout@1's first-party
entries with their `value` (#412), and a plug-in's entry in a registry whose fill doesn't take plug-ins listed
unavailable and refused naming the fill (#213). There is no `lib.interface@1`, no pack `interfaces` key, no first-party
interface, no validation of a logic item's data assets (nothing at the base reads a data asset's `layout`), and no
time on a `validate` verdict.

## Run them

```sh
npm ci && npm run build --workspaces          # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/416/layouts --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/416/layouts/tsconfig.json
rm -rf tests/acceptance/416/layouts/node_modules
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when it's there):

- **The assembler** `wat/` (crate `acceptance-416-layouts-wat`, cut down from #531's: `wat =1.263.0`, `wasmparser
  =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-416-layouts-wat/`. It turns
  `fixtures.ts`' text into validated modules and shares no code with the code under test. A crate inside the checkout
  picks up `.cargo/config.toml`'s patches, so its lock lists the base's eleven as `[[patch.unused]]` (written here by
  `cargo metadata --offline` in `wat/`); a change to that patch set makes `--locked` fail until the lock is written again.
- **`deep-show`** `--no-default-features --features full`, once per file.
- **The merge base's `deep-show`** (`budgets.test.ts` only, after its own checks pass): `git merge-base HEAD
  origin/main`, exported with `git archive` into `target/acceptance-238-base/<sha12>/` (the folder #238's and #192's
  suites keep it in) and built there with its own target folder, `deep-show-full`, kept so later runs build warm.

Every test passes its own timeout (three hours; `budgets.test.ts` four), so the `--testTimeout` above is only a
floor. Warm, the tests themselves take under a minute; cold, a run first builds deep-show twice (this checkout's and
the merge base's), about 20 minutes each here at low priority under a load near 300.
`budgets.test.ts` writes seven 16 MiB weights files (112 MiB); every temporary folder (packs, evidence stores, files,
binaries) is deleted after its test. Node built-ins and vitest only. `scripts/lanes.mjs` lists the folder in `alone`
(the files build deep-show and an assembler) and `budgets.test.ts` in `timed`.

Gates: off macOS `budgets.test.ts` fails `INCONCLUSIVE:` before anything runs. Its timing is judged only on a fit
reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal state nominal, a 1-minute load at most the core count;
mains power never gates); elsewhere, or with a reading between the limit and the margin, it fails `INCONCLUSIVE:` after
all its other checks, never passes. Cargo that can't run, or an assembler that doesn't build, fails `BLOCKED:`.

`BASE-FAILURE.txt` is one run of the suite at the base: 3 of 3 fail, each at its first check of a missing surface. The
fixtures are checked in Node's own WebAssembly at the start of each test that uses them (`checkFixtures`), and were run
once against the base's own deep-show before that run (a throwaway file, deleted; what it showed is in
`BASE-FAILURE.txt`): the packs, both boards without the NaN, the provider's refusal, a 16 MiB file within its
validator's fuel, the piece that names no layout, and the listing as criterion 6 reads it.

## The surface

The issue and the design name the fields but not the bytes, the calls or where a data asset says its layout. **Every
name below marked *invented* is this job's**, the smallest surface the criteria need; the implementer builds exactly
these, or a dispute goes to a blind redraft. Reused as they are: `deep-show run` and its calls `install_pack` (`{outcome,
pack, version, issues, layouts}`), `deep_show` (the agent's form, `{session, doc, document, include: ["issues"]}`, a
refused revision `outcome: "refused"`), `validate` (#415: `{layout, asset, size, max_bytes, outcome, code, offset,
field, trap}`), `sandbox` (#238's counts `{checks, links, rewrites, runs}`), `frames` (`frames: [{ran, …}]`),
`deep_kinds` with `op: "list"` and `registry` (#412: `registries: [row]`, each row with `fill` and `entries`, each
entry with `name`, `origin`, `value`, `available`; pages by `next` and `cursor`); the scenario's `plugin_entries`
(#412) and its listing as #213 left it (`refused: {code: "fill_refused", registry, fill}`); a logic item's `assets` by
sha256 from the evidence store, or a provider use `{gen, params}` there (#192); a provider's `out: data` refusal
(`layout_refused` at the use's path, `actual: {provider, item, layout, asset, offset, field, trap}`, #415).

### A data asset's layout, and its refusal in a logic item's assets (*invented placement*)

- The design's "On a data asset: `layout: name@version`" is a field of the document envelope's data asset:
  `assets: {id → {sha256, license, layout?}}`.
- At a document's check, each asset ID (sha256) in a logic item's `assets` whose envelope entry (the one whose
  `sha256` is that ID) names a layout is validated by that layout's validator, the layout resolved through
  `data.layout@1` (a first-party entry, or a layout of a pack the document pins), once per asset hash and validator
  hash, as `validate` does.
- A refusal is an error issue at the asset's place, `items/<item>/params/assets/<i>`, with code `layout_refused` (as a
  provider's `out: data` refusal is; `layout_trap` for a validator's trap, `over_cap` past `max_bytes`), whose
  `actual` names `asset` (the sha256), `layout` and `offset` (the validator's return), as the provider's does (`item`,
  `field` and `trap` beside them); the revision is refused. An asset whose envelope entry names no layout, or that has
  none, is validated by nothing, as at the base.
- Every validator run, wherever the asset is named, counts in `sandbox`'s `runs`.

### `validate`'s `ms` (*invented field*)

`validate`'s reply gains `ms`: the wall time in milliseconds of the validator run that gave the verdict (its instance
made and sized, the asset's bytes copied in at `in_at`, `validate(len)` called and returned), not counting the
validator's once-per-program check and rewrite; null when no validator ran (`over_cap`). A verdict held from an
earlier run of the same asset hash and validator hash is returned as first given, `ms` included, and runs nothing.

### The nn.weights layout (*invented*: this suite's layout, declared by its test packs)

Little-endian: `magic` 4 bytes `NNWT` at 0, `count` u32 at 4, then `weights[i]` f32 at 8 + 4i. Valid when the bytes are
exactly 8 + 4 × count long and no weight is a NaN (an f32 whose bits past the sign are above 0x7f800000). Its validator
(`fixtures.ts`, `weightsValidator(false)`) returns −1 when valid, else the first bad byte: 0 for bytes shorter than the
header or another magic, 4 (the count) when the bytes don't hold count weights, 8 + 4i for a NaN at `weights[i]`. Its
memory is one page as written (`in_at` 1024); the runner sizes a validator's memory to its asset plus 4 MiB.

- **The criterion's file**: 2,048 weights, `weights[i]` = i ÷ 1024 (8,200 bytes); with the NaN, `weights[1022]`, whose
  first byte is byte 4,096, holds the canonical NaN's bits 0x7fc00000.
- **Its twins**: two weights, the second a NaN (refused at 12); and the file without the NaN cut to 4,100 bytes, its
  count still 2,048 (refused at 4).
- **16 MiB files** (`budgets.test.ts`): 4,194,302 weights, 16,777,216 bytes, `weights[0]` = k for the k-th file.

### Test packs (written by the tests; *invented names*)

- `test/nnweights@1.0.0`: `requires.modules: {sandbox}`; `layouts: {"nnweights.nn.weights@1": {validator, max_bytes:
  16,777,216, twins: [the NaN twin, the truncated twin], doc}}`; `providers.weights: {program, params: {nan: {type:
  bool, default: false}}, out: {data: {layout: "nnweights.nn.weights@1", max_bytes: 16,777,216}}}`, whose program
  writes the criterion's file, with the NaN when `nan` is true (#192's layout: the param an i64 at `params_at`, the
  output a u32 length then the bytes at `out_at`). A bool is no numeric param, so #192's pack check runs it at its
  default only.
- `test/nnplanted@1.0.0`: `layouts: {"nnplanted.nn.weights@1": …}` with the same twins under the planted validator
  (below).

### Documents (agent's form)

Boards (`format: 1`, `seed: 416`, `requires.modules: {logic}`) whose logic item `reader` (`fixtures.ts`: copies its
first asset's length and count into `head`, i32 × 2) names one data asset: by hash, with the envelope entry `weights`
naming `nnweights.nn.weights@1` and the board pinning `test/nnweights@1.0.0`; or as the provider use `{gen:
"nnweights.weights", params: {nan}}`. The piece that names no layout (`budgets.test.ts`) names the file without the NaN
by hash, its envelope entry naming no layout, beside a rect a channel moves over a 2 s span.

### First-party interfaces and layouts in `deep_kinds` (*invented reading*)

- The three interfaces ship in first-party packs: the packs under `packs/` whose `pack.json` `interfaces` declares
  `physics2d.lib@1`, `fsm@1` or `nn.mlp@1` (exactly one pack each), installed with `install_pack` (no session) as
  `deepbuild/<name>`, so their entries are `origin: "first_party"`.
- `deep_kinds` `list` of `lib.interface@1` holds a row whose entries include the three, each `value` its pack's
  `interfaces` entry as declared, so `value.exports` is `[{name, params: [type], results: [type]}]` and
  `value.fixtures` is `[asset ID]`, each a sha256 of an asset its pack carries.
- `deep_kinds` `list` of `data.layout@1` holds `nav.graph@1`, `table.layout@1` and `pages@1` with `value.doc` and
  `value.max_bytes`, as the base lists them.

### Naming

A refusal names a thing by a key and its value anywhere in the issue's JSON (`actual` or a nested object): `asset`,
`layout`, `offset`, `twin`. Prose (`what`) is never read.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#416.` and the first 8 hex digits of the SHA-256 of the criterion's `- [ ]`
text, trimmed, white space collapsed (checked against the live issue). Each test's name starts with its ID. One test
per criterion.

| ID | File | What it asserts, and the wrong programs it fails on |
|---|---|---|
| 5 `#416.4afd3a43` | `weights.test.ts` | In Node: the validator gives the file −1, the file with the NaN 4,096, the twins 12 and 4; the planted one admits the truncated twin; the provider writes the two files' bytes. In deep-show: test/nnweights@1.0.0 installs; test/nnplanted@1.0.0 is refused, naming the truncated twin and not the NaN twin; the board naming the file with the NaN by hash, and the one naming the provider's output with `nan: true`, are each refused with `layout_refused` at `items/reader/params/assets/0` naming the asset's sha256, `nnweights.nn.weights@1` and offset 4,096; the same two boards without the NaN are presented with no error; `validate` refuses the one file at 4,096 and admits the other. Fails: a logic item's data asset never validated, a refusal that names no asset, layout or offset, a layout or envelope that refuses the good file, a provider's output not validated, a pack check that doesn't run a validator on its twins or doesn't name the one it accepted |
| 6 `#416.d1f5f8b8` | `kinds.test.ts` | Exactly one first-party pack declares each interface, and each installs. `deep_kinds` lists `lib.interface@1` with the three, each first-party, its exports a non-empty list of `{name, params, results}` and its fixtures a non-empty list of asset IDs its pack carries, both the ones its pack declares; `data.layout@1` with `nav.graph@1`, `table.layout@1` and `pages@1`, each with a doc of 1 to 2,000 characters and the cap `validate` enforces for it (pages@1's 268,451,852); the plug-in's entry listed `origin: plugin`, `available: false`, `refused: {code: fill_refused, registry: data.layout@1, fill: [module, first_party_pack, pack]}`, the registry's own fill; `validate` with the plug-in's layout gives no verdict. Fails: an interface missing, listed without its exports or fixtures or with others than its pack's; a layout without its doc or with a cap it doesn't enforce; a plug-in's fill admitted or refused without the fill |
| 7 `#416.0e66795c` (layout half) | `budgets.test.ts` | Six 16 MiB files of six hashes each admitted once (`runs` + 6) with an `ms`; the first's bytes under another path keep its verdict and run nothing. The piece naming no layout, on this build and on the merge base's: presented on both, its check adds the same `sandbox` counts on both, each of 60 frames runs as many nodes on both, and here the frames run nothing in the sandbox. Then, on a fit reference Mac only, the five `ms` after the first are judged against 200 ms (PASS all within, FAIL all past the margin, the larger of 5% and their spread, else INCONCLUSIVE). Fails: a verdict without its time, a rerun for a hash already run, a validation past 0.2 s, a piece naming no layout that runs a validator at check or adds work per frame |

## Planted twins

None is a flag: each is a fixture of this suite, reachable only through the test that names it.

| Twin | Criterion | The wrong program |
|---|---|---|
| `test/nnplanted@1.0.0` (`weightsValidator(true)`) | 5 | the nn.weights validator without its count check, which reads the weights the bytes hold and accepts its own truncated twin: its pack must be refused, naming that twin |
| the provider with `nan: true` | 5 | a provider whose `out: data` holds the NaN at byte 4,096: refused naming the asset, the layout and the offset |
| the plug-in `test.weights` and its entry `test.weights.nn@1` | 6 | a plug-in that fills data.layout@1 outside a pack, its kit passed: refused, naming the registry's fill |
| the piece that names no layout | 7 | a document with a data asset and no layout, beside a moving rect: no more sandbox work at check, and no more nodes per frame, than on the merge base |

## Readings where the issue leaves a choice

- **"An nn.weights asset in a pack's layout"**: a layout a pack declares, here the tests' own pack, not a first-party
  layout the implementation ships; "nn.weights" names what the bytes are, and the layout's bytes are this suite's.
- **"With a NaN at byte 4,096 … naming … offset 4,096"**: the f32 whose first byte is 4,096 is a NaN, and the refusal's
  `offset` is 4,096, the validator's return.
- **"Wherever it's named, in a logic item's assets and in a provider's out: data"**: one file, one sha256, named by hash
  in a logic item's `assets` and written by a provider whose `out` is data in the layout (named where #192 names a
  provider's data, a logic item's `assets`); both refused at the asset's place with `layout_refused`. Any other error
  beside it (the base's logic module also refuses an item whose provider use gave no asset) is neither required nor
  forbidden.
- **"The same file without the NaN passes"**: the same bytes with `weights[1022]` = 1022 ÷ 1024: admitted by `validate`,
  and both boards naming it are presented.
- **"A planted validator that accepts its own truncated twin makes its pack refused, naming the twin"**: a second test
  pack whose layout's validator is the shipped one without its count check; the refusal names the truncated twin by its
  sha256 as `twin`, and not the NaN twin, which that validator refuses.
- **"Docs and caps"**: a listed layout's `value.doc` and `value.max_bytes`, the cap being the one `validate` enforces
  (the reply's `max_bytes` for that layout); pages@1's is its own, 12 + 4,096 × 65,540 bytes (#415).
- **"With their exports and fixtures"**: what the pack declares for each, as the design's fields spell it; this suite
  reads nothing of the other job's export names, fixtures or planted libraries.
- **"A plug-in that tries to fill data.layout@1 outside a pack"**: a plug-in's entry (#412's `plugin_entries`) whose kit
  passed, so only the fill refuses it; "naming the registry's fill" is #213's `refused` with `registry` and `fill`.
- **"Validates once per hash in under 0.2 s"**: the validator's run on a 16,777,216-byte asset, its `ms`; six hashes run
  six times, the same bytes again run nothing. "Compared with the merge base": the merge base gives no `ms`, so the
  limit is the issue's 200 ms; the no-work half is read against the merge base's own build.
- **"A piece that names no interface or layout gains no work at check or per frame"**: counts, not times: the `sandbox`
  counts its check adds, and each frame's `ran`, equal the merge base's for the same scenario, with the nn.weights pack
  installed so a layout is in reach and none named.

## Not covered, because no criterion of this suite asks

Criteria 1 to 4 and criterion 7's interface half (`tests/acceptance/416/interfaces/`); a validator's trap or
`over_cap` at a logic item's asset; a world's `init` and a provider's `out: pages`; a layout from a pack the document
doesn't pin; the libraries that implement an interface, and the pack that declares a layout, in `deep_kinds`;
`lib.interface@1`'s own row (`fill`, `resolve`, `binds`, kit, planted); `deep_query`'s library names.
