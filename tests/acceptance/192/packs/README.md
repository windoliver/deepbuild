# Acceptance tests for #192, packs: criteria 6, 11, 12 and 13 of gen@1 providers

Written first, blind, from issue #192 (live, November 16, 2026: its Scope, Fields, thirteen acceptance criteria and
Proof line), its oracle page (`doneright/oracles/issues/192.md`, branch `doneright` of DeepBuildAI/deepbuild: no
upstream test for these four criteria) and base commit `06e231702` ("Merge pull request #2735 …"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Two sibling blind suites cover the other criteria:
`tests/acceptance/192/voxel/` (1, 2, 3, 4, 9, 10) and `tests/acceptance/192/dungeon/` (5, 7, 8).

## What was read

- The issue, live (`gh issue view 192 --repo windoliver/deepbuild --comments`; no comments), and its oracle page.
- `docs/canvas-primitives.md`: Provider `gen@1`; Provider `gen@1`: links, meshes and the library form; Logic:
  sandbox; Logic: linked libraries; Pack and Pack: programs; Builder (the ten trusted builders and `mesh.asset`);
  Voxels `voxels@1`; Export: web player. `docs/technical-design.md`: Provider, The logic module (Logic, Sandbox and
  budgets), Dogfooding. AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/sandbox.rs` (`Host::provide`, `make`, `decode_mesh`, the
  `provider_trap` issue, `provided`), `crates/deep-sandbox-wasmtime/src/service.rs` (`Budget::of`, the check-time
  runner, the check's memory limit) and `crates/deep-canvas-sandbox/src/check.rs` (a memory over budget refused as a
  `limit`), `crates/deep-canvas/src/document/packs.rs` (no check of a providers entry), `crates/deep-show/src/packs.rs`
  (`install_pack`'s reply), `crates/deep-show/src/export/web.rs` and `run.rs` (the bundle, `module_missing` for a
  module the player lacks, the receipt's `files`), `crates/deep-player/web/dist/player.json` (the player's modules),
  `crates/deep-canvas-scene3d/src/spec.rs` (`mesh.asset@1`), `crates/deep-canvas-test-modules/src/sandbox.rs`
  (`test.mesh@1`), `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`; the suites `238/` (README,
  helpers, programs, seal and budgets tests), `172/` (README and helpers: the export call and receipt), `544/wat`
  (the assembler) and the helpers of `169/`.

What the base already does, which these tests don't credit: #238's sandbox module runs a provider at a document's
check once per content key (`provided`, the `sandbox` counts) and its `provider_trap` issue names the provider, the
item and the trap; #172's web export writes a bundle and its receipt. The base checks nothing of a providers entry at
install (no key list, no budget range, no run), and its `make` takes a provider's budget through `Budget::of` with no
ceiling, from `memory_mib` and not `memory`, and copies no params or assets into the program's memory.

## Run them

Put Homebrew's rustup first on PATH; in a fresh worktree run `npm ci` and `npm run build --workspaces` once; then one
file at a time under the machine's build grant and lease:

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
npm ci && npm run build --workspaces
for f in outside pack-check budget-ceilings budget-fields; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/192/packs $f.test.ts --testTimeout=600000
done
npx tsc -p tests/acceptance/192/packs/tsconfig.json   # type check
rm -rf tests/acceptance/192/packs/node_modules        # vitest's cache after a --root run
```

Each `it` passes its own 3,600,000 ms timeout, which overrides `--testTimeout`. What a run builds (each honoring
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set):

- **The fixture assembler**: #544's (`tests/acceptance/544/wat`, the `wat` crate outside the workspace), built with
  `--locked` into `target/acceptance-544-wat/`; it turns `fixtures/*.wat` into bytes after `wasmparser` validates
  them. #238's assembler fails `cargo build --locked` at the base ("cannot update the lock file … because --locked was
  passed"): its lockfile lists 7 `[[patch.unused]]` entries and the repo's `.cargo/config.toml` now patches 11 crates
  (citationberg, mitex, …); #533's lockfile lists the same 7. #544's lists the 11 and builds.
- **deep-show `full,test-mesh-item`** in the checkout, through #238's `deepShow` (`cargo build --locked --bin
  deep-show --no-default-features --features full,test-mesh-item`, copied out under its own name). Both features
  exist at the base; no new feature is needed.
- **The merge base's deep-show `full,test-mesh-item`** (`budget-ceilings` and `budget-fields`): `git merge-base HEAD
  origin/main`, exported by `git archive` into `target/acceptance-192-packs-base/<sha12>/` and built there with its
  own target folder, kept so later runs build warm. When that commit already holds this README (the work has merged
  and main holds it), the base is the parent of the commit that added this README, the commit the suite was written
  on.

Time (an estimate, not measured here): cold, about 45 to 60 minutes on an unloaded Mac (the two deep-show builds
dominate; the merge base's builds in its own target folder); warm, about 2 to 3 minutes for the four files (each
scenario runs in seconds; the 256 MiB provider runs four times). Temporary folders are deleted after each test. Node built-ins and vitest only. Off macOS each test
fails `INCONCLUSIVE:` first; cargo that can't run, or an assembler that doesn't build, is `BLOCKED:`. None is ever a
pass.

`scripts/lanes.mjs` lists `'tests/acceptance/192/packs/'` in `alone` (every file builds deep-show, two build the merge
base's, and the 256 MiB runs take memory).

`BASE-FAILURE.txt` says what ran at the base (the assemblers, every fixture in Node's engine, the type check and
`vitest list`) and, per file, the assertion it fails first there, read from the base's code: the deep-show legs didn't
run, because the machine's one build grant was hours away (load near 1,000 on 18 cores) and the request was withdrawn.
For the same reason the merge-base legs of `budget-ceilings` and `budget-fields`, and `baseShow`'s export and build,
have not run anywhere yet; their expectations are read from the base's `Host::make` and `Budget::of`.

## The surface

deep-show `run` scenarios as #238's README gives them (`install_pack`, `deep show`, `provided`, `sandbox`), driven
through `tests/acceptance/238/helpers.ts`, and #172's `export` with `video: {codec: "web"}` and its receipt. No new
call, binary or Cargo feature. **Every name below that the issue doesn't give is this job's invention**, the
smallest surface the four criteria need; the implementer builds exactly these, or a dispute goes to a blind redraft.

### Shared with the voxel and dungeon suites (the coordinating session's layout)

- **Params at `params_at`**: every param of the provider's schema, in the order of the param names sorted by byte,
  each 8 bytes little-endian: integer and bool types (`i32`, `i64`, `u32`, `u64`, `bool`) as i64, float types (`f32`,
  `f64`) as f64. A param the document leaves out takes its schema default.
- **Assets at `assets_at`**, as a logic item's are: each asset in the order the provider's `assets` lists them, as a
  u32 little-endian length followed by its bytes.
- **A mesh output at `out_at`**: little-endian `u32 vertex_count, u32 index_count, f32 positions[3n], f32 normals[3n],
  f32 uv0[2n], u32 indices[index_count]` (the base's layout). A data asset output: `u32 len` then its bytes.
- **The seed** is `gen`'s i64 argument.

### A providers entry in a pack (`install_pack`)

- Keys as the design's Fields: `program` (sha256 of a pack asset), `params: {name → {type, unit, default, range: [min,
  max]}}`, `assets: [sha256 of a pack asset]`, `out: {mesh: {max_vertices, closed}}`, `budget: {fuel, memory}`.
- **`check_kind`, `builder`, `operator`** (this suite's spellings for "a check kind, a builder or an operator" a
  providers entry names, each a string such as `checkkinds.watertight@1`): a pack whose providers entry holds one is
  refused at install, `outcome: "refused"`, with an issue whose `path` is `providers/<name>/<key>`.
- **The budget is checked at install, before any run**: `fuel` outside 1 to 10,000,000,000, `memory` (MiB) outside 1
  to 256, or any other key, refuses the pack with an issue whose `path` is `providers/<name>/budget/<field>`
  (`…/budget/fuel`, `…/budget/memory`, `…/budget/stack`); the `sandbox` call's `runs` doesn't change across that
  install.
- **The pack check's runs** (Scope: each numeric param's declared minimum and maximum, and 3 fixed seeds): a run that
  traps refuses the pack. A run at a param's minimum or maximum gives an issue whose `path` is
  `providers/<name>/params/<param>` and whose `actual.value` is the value it ran at; a run at a seed gives one whose
  `path` is `providers/<name>` or under it. Either holds the trap as `actual.trap: {kind, …}`.
- **Trap kind `memory`**: a provider whose program's memory is past its budget's `memory` traps with kind `memory`,
  `actual.trap.kind: "memory"`; a provider-level kind beside `over_cap`, not one of sandbox@1's engine kinds.

### A document and the web bundle

- **`mesh.asset@1` takes a provider**: in a scene, `params.sha256` may be `{gen: "<pack>.<name>", params}`, and the
  item draws the provider's mesh (`node` left out). This is how the voxel piece reaches the web player: the export
  refuses a kind of a module the player lacks (`module_missing`), `test.mesh` is in no player module set, and
  `mesh.asset@1` (scene3d, which the player holds) is the kind that names a mesh asset.
- **The bundle carries the output by hash**: the receipt's `files` lists a file whose `sha256` is that of the bytes
  the provider wrote at `out_at`, exactly `8 + 32 × vertex_count + 4 × index_count` bytes in the mesh layout above,
  under a `path` that starts with that sha256; the file holds those bytes.
- **No provider program in the bundle**: no file that is a WebAssembly module (`\0asm`) but the player
  (`receipt.player.hash`), and no file holding the program's bytes, their lowercase hex or their base64.

## Packs and fixtures

Written per test (owner `test`, version `1.0.0`, `requires.modules: {sandbox}`, every asset listed by sha256, MIT),
each a pack installed from a folder: an outside pack. `fixtures/*.wat`, written by this job, each file's comment
saying what it does:

| Fixture | What it does | Shown in Node's own engine (in each test, and once by hand) |
|---|---|---|
| `quad.wat` | writes a one-quad mesh (4 vertices, 6 indices); reads nothing | no trap, 4 and 6 |
| `trap_max.wat` | reads its i64 param `n`; `unreachable` when n is 16, else the quad | no trap at 0, 1, 4, 15, 17; traps at 16 |
| `ceiling.wat` | a 4,096-page (256 MiB) memory, min = max; the quad at out_at 268,431,360 (its top 4 KiB) | no trap, 268,435,456 bytes, 4 vertices |
| `memory_2mib.wat` | a 32-page (2 MiB) memory, min = max; writes byte 2,097,151, then the quad | no trap, 2,097,152 bytes, the byte set |
| `voxel_mesher.wat` | asset 0: a 32 × 32 × 32 grid (1 byte a voxel); one quad per exposed face, 0.25 m a voxel; `unreachable` when asset 0 isn't 32,768 bytes | the 10 × 10 × 10 block at [11, 21): 600 quads, 2,400 vertices, 3,600 indices, bounds 2.75 to 5.25 m, every triangle wound with its normal, every welded edge with exactly one opposite (closed); 91,208 bytes, sha256 `aeedba2f…e4c951`; traps with no asset |

| Pack | Provider: program, entry | Used by |
|---|---|---|
| `test/voxpack` | `mesher`: voxel_mesher, `assets: [grid.bin]`, `out.mesh {max_vertices: 4096, closed: true}` | 6 (the clean twin and the voxel piece) |
| `test/checkkinds`, `test/builders`, `test/operators` | the same entry plus `check_kind`, `builder` or `operator` | 6 (planted) |
| `test/trapmax` | `edge`: trap_max, `params: {n: {type: i32, unit: "", default: 4, range: [1, 16]}}` | 11 (planted) |
| `test/trapmaxok` | the same with `range: [1, 15]` | 11 (the clean twin) |
| `test/fuelover`, `test/memoryover` | `fuel_over`, `memory_over`: quad, `budget {fuel: 10000000001}`, `{memory: 257}` | 12 (planted) |
| `test/ceilings` | `at_ceiling`: ceiling, `budget {fuel: 10000000000, memory: 256}` | 12 (the boundary twin) |
| `test/memoryone` | `grows`: memory_2mib, `budget {memory: 1}` | 13 |
| `test/memoryneg`, `test/stackbig` | `negative`, `deep_stack`: quad, `budget {memory: -1}`, `{stack: 5000000000}` | 13 |

Documents: #238's board with one `test.mesh@1` item `mesh` naming `{gen: "<pack>.<name>", params: {}}` and pinning
its pack (11, 12, 13); and the voxel piece (6): a 3D scene, a camera and a `mesh.asset@1` item `block` naming
`{gen: "voxpack.mesher", params: {}}`.

## Criteria to tests

IDs are `#192.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts with its ID. One
test per criterion; each holds its planted twins.

| Criterion | ID | File | What it asserts | The wrong programs it fails on |
|---|---|---|---|---|
| 6 | `#192.562b7ffc` | `outside.test.ts` | `checkkinds`, `builders`, `operators` each refused at install with an issue at `providers/mesher/<key>`; `voxpack` installs; the voxel piece is presented with no error, exports to the web player, and the receipt lists the mesh's 91,208 bytes by their sha256 (from Node's run of the fixture), stored under that hash; no WebAssembly in the bundle but the player, no file holding the program in any form | the base (all three install); a pack check that refuses every providers entry (the clean twin); an export that leaves the mesh out or copies the program or its rewrite |
| 11 | `#192.ac23e07b` | `pack-check.test.ts` | `trapmaxok` installs and its document, with no params, runs at the default 4 to the quad with no error (the check at the defaults); `trapmax` is refused at install with an issue at `providers/edge/params/n`, `actual.value` 16 | the base (installs it); a pack check at the defaults or seeds only; one that copies no params (n reads 0); one that refuses every param (the twin); one that doesn't name the param and value |
| 12 | `#192.e8dea9d2` | `budget-ceilings.test.ts` | `fuelover` refused at `providers/fuel_over/budget/fuel`, `memoryover` at `providers/memory_over/budget/memory`, with no run (runs 0); `ceilings` installs and its document runs the 256 MiB program to its quad; then the merge base on the same scenario installs both, runs both at their documents' check (two quads, runs +2), and the test's own judge on its replies fails first naming `budget/fuel` | the merge base; a ceiling off by one (the boundary twin); a memory still read from `memory_mib` or left at 64 MiB (the 256 MiB program can't run) |
| 13 | `#192.e1a673a1` | `budget-fields.test.ts` | `memoryone` refused at install with an issue at `providers/grows` (or under it) whose `actual.trap.kind` is `memory`; `memoryneg` at `providers/negative/budget/memory` and `stackbig` at `providers/deep_stack/budget/stack`, with no run across them; then the merge base installs `memoryone` and runs `memoryone.grows` at its document's check with no trap, takes `stackbig` with no refusal and runs it, runs nothing at install, and the judge's first failure is the memory trap's | the merge base; a memory read as bytes or ignored; a budget check that lets other keys through |

Test count: 4.

## Readings where the issue leaves a choice

- **"Refused at check"** for a budget or a providers entry: the pack check at `install_pack` (Scope: "checked where
  its pack is checked, before any run"), the pack refused and not installed. "Before any run" and "with no run": the
  `sandbox` call's `runs` unchanged across the refused installs.
- **"Naming the provider and `budget/fuel`"**, **"naming the field"**, **"naming the entry"**: the issue's `path`,
  `providers/<name>/budget/fuel` and the like, which names both.
- **"A provider that states 10,000,000,000 and 256 runs"**: its pack installs and a document's check runs it to its
  mesh. The program holds all 256 MiB and writes at its top, so the 256 is the budget it runs under; it burns little
  fuel (a run past 1,000,000,000 units would take seconds), so the fuel ceiling is held by 10,000,000,001's refusal and
  10,000,000,000's admission.
- **"The check on the merge base runs both refused providers, returns no refusal"**: at the merge base both packs
  install and their documents' check runs both to their quads (the base runs nothing at install).
- **"Grows its memory to 2 MiB"**: a program whose one memory is 2 MiB (32 pages, minimum equal to maximum) and which
  writes its last byte. The subset refuses a memory that can grow, and the rewrite makes `memory.grow` trap `grow` on
  every build, the base included, which the criterion's "on the merge base the first runs … with no trap" rules out.
- **"Traps on memory, naming the provider"**: the pack check runs every provider at 3 fixed seeds (Scope, criterion
  11's rule), so the trap shows at install: the pack refused with an issue at `providers/grows` (or under it) whose
  `actual.trap.kind` is `memory`.
- **"On the merge base … the third's stack is read as the 32-bit number 705,032,704"**: not asserted, because it is
  not what the base does. Since `9b9532449` (November 10, "Whole-project audit"), `Budget::of` at the base clamps
  `stack` to under the native stack, 2 MiB − 1 = 2,097,151, and its unit test `a_stack_budget_stays_under_the_native_stack`
  pins that; the narrowing to 32 bits (5,000,000,000 → 705,032,704) is the code before it. The test asserts what the
  criterion needs of the base and the base does: no refusal at install, a run at the document's check, and the test
  failing first at `memory`. The issue's Scope sentence about `stack` is stale for the same reason; the owner may want
  the criterion's base clause corrected.
- **"On the merge base the first runs under the 64 MiB default with no trap"**: its document's check runs
  `memoryone.grows` (2 MiB under a budget the base reads as 64 MiB) to its quad with no trap.
- **"Passes a defaults-only check"** (11): the same program, in a pack whose range stops at 15, installs, and a
  document naming it with no params runs it at its default, 4, to its quad with no error. The merge base can't serve
  as the defaults-only check: it copies no params, so the program reads 0, not 4.
- **"An outside pack"**: a pack installed from a folder with `install_pack`, owner `test`. **"The voxel piece"**: this
  suite's own (a 32³ grid with one 10³ block, meshed by `voxel_mesher.wat`, drawn by `mesh.asset@1`); the voxel suite
  writes its own for criterion 1. **"Holds the mesh by hash"**: the provider's output bytes as written at `out_at`,
  their expected value from Node's run of the same program on the same grid. **"No provider program"**: neither the
  program as written nor any rewrite of it (any WebAssembly but the player), nor the program's bytes inside another
  file.

## Not covered, and why

Criteria 1 to 5 and 7 to 10 (the voxel and dungeon suites). A tool entry (the criterion names a check kind, a builder
and an operator). The pack check's 3 fixed seeds by themselves (they show only through criterion 13's trap at
install). A run that burns past 1,000,000,000 fuel. Playing the bundle in a browser (the criterion asks for its
listing). Linux.
