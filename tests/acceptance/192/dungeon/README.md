# Acceptance tests for #192: providers gen@1, the dungeon part (criteria 5, 7 and 8)

Written first, from issue #192 (its Scope, its two Fields blocks, criteria 5, 7 and 8 of its thirteen and its Proof
line: "The voxel and dungeon packs with their outputs by hash, … each refusal and trap with what it names"), its
Oracle page, the design sections it links and base commit `06e23170` ("Merge pull request #2735 …"), by a job that
never saw an implementation; none existed. Two other blind jobs write `tests/acceptance/192/voxel/` (criteria 1, 2,
3, 4, 9, 10) and `tests/acceptance/192/packs/` (criteria 6, 11, 12, 13). The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 192 --repo windoliver/deepbuild --comments`: no comments), and its Oracle page
  (`doneright/oracles/issues/192.md`): none of criteria 5, 7 and 8 has an upstream test ("The tile graph's layout and
  its same bytes on two machines are ours", "mesh_in content keys and their refusals are ours", "The library form's
  equality fixture is ours").
- `docs/canvas-primitives.md`: Provider `gen@1`; Provider `gen@1`: links, meshes and the library form; Logic: sandbox
  (program roles: "a provider's library form (`gen(seed, params_at, out_at)`; inside a logic item, under its budget)");
  Logic: linked libraries; Logic: data layouts; Logic: work across steps; Logic `logic@1` (fields, exports, the data
  assets copied from `assets_at`, the region map); Pack; Builder; Instance `instance@1` and its logic columns.
- `docs/technical-design.md`: Provider; The logic module; Dogfooding. AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/sandbox.rs` (`Host::provide`, `provided`, the data asset a
  provider writes), `src/logic.rs` and `src/query.rs` (deep_query's logic read), `src/packs.rs` (`install_pack`'s
  reply); the `deep-sandbox` runner's crate (its calls, `Budget::of`); `crates/deep-logic` (an item's
  `assets` and `links`, `links.rs`, the region map in `piece/checks.rs`); `crates/deep-play/src/logic.rs` (the
  document's logic piece); `crates/deep-canvas/src/document/packs.rs` (the pack keys a build reads);
  `crates/deep-canvas-scene3d/src/builders.rs` (ball@1, slab@1); `scripts/proof-change.mjs` (criterion IDs),
  `scripts/lanes.mjs`; and the suites `tests/acceptance/238/` (deep-show's provider surfaces, deep-sandbox, Docker),
  `190/` (libraries, relocatable objects, the assembler copied here), `415/`, `531/`, `532/` (data assets), `533/`,
  `548/` (deep_query's logic read), `451/` and `2013/` (scene documents, a logic-fed instancer).

What the base already does, which these tests don't credit: a pinned pack's provider named by an item's param
`{gen, params}` runs at the document's check once per content key and `provided` lists it (#238); a provider's
`out: data` is validated by its pack layout's validator, and a pack layout is admitted only when its validator refuses
its twins (#415); `deep_query` reads a logic item's arrays at steps (#548); `deep-logic` links libraries (#190). It
fills no params at `params_at`, copies no assets or meshes in, takes no `{gen}` in a logic item's `assets` (refused:
"assets is a list of asset IDs"), carries neither data assets nor pack libraries into a document's logic items (its
`logic.step` operator's piece holds only each item's program, so an item naming a data asset by its ID is refused there
too), reads no `mesh_in`, `library` or provider `links`, and has no `provide` call.

## Run them

```sh
npm ci && npm run build --workspaces          # once, in a fresh worktree
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: criterion 5's Linux x86_64 host
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/192/dungeon --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/192/dungeon/tsconfig.json
rm -rf tests/acceptance/192/dungeon/node_modules
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set; helpers.ts puts Homebrew's rustup on PATH when it's there):

- **The assembler** `wat/` (crate `acceptance-192-dungeon-wat`, #190's copied: `wat =1.263.0`, `wasmparser
  =0.263.0`; outside the workspace, its own `Cargo.lock`) into `target/acceptance-192-dungeon-wat/`. It turns
  `programs.ts`'s text into modules and relocatable objects. It shares no code with the code under test.
- **`deep-show`** `--no-default-features --features full,test-mesh-item` (#238's test module `test.mesh`), every file.
- **`deep-sandbox`** for this Mac, and for Linux x86_64 in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm` (`<channel>` from `rust-toolchain.toml`), the checkout mounted read-only, its target
  and cargo caches under `target/acceptance-192-dungeon-linux/`: `ac05` only, after its deep-show checks.

Without Docker, or without that image for linux/amd64, `ac05` fails `BLOCKED:` with the `docker pull` command;
nothing is pulled. Cargo that can't run, or an assembler that doesn't build, is `BLOCKED:`. Off macOS each test fails
`INCONCLUSIVE:` before anything runs (and `ac05` off arm64). No test skips. A cold run takes about an hour on the
reference Mac at rest (two debug builds, then the Linux build under emulation, 20 to 60 minutes); a warm run a few
minutes. Every test passes its own timeout (90 minutes, `ac05` three hours). Temporary folders (packs, evidence
stores, binaries, assembler output) are deleted. Node built-ins and vitest only. `scripts/lanes.mjs` lists
`'tests/acceptance/192/dungeon/'` in `alone` (the files build deep-show and deep-sandbox and start Docker).

`BASE-FAILURE.txt` is one run of the suite at the base: 3 of 3 fail, each at its first check of a missing surface,
before any Linux leg.

## The surface

The issue and the design name the fields, but not the bytes, a few spellings, or any call. **Every name below
marked *invented* is this job's**, the smallest surface criteria 5, 7 and 8 need; the implementer builds exactly
these, or a dispute goes to a blind redraft. Reused as they are: `deep-show run` and its calls `install_pack`
(`{outcome, pack, version, issues, layouts}`), `deep_show` (the agent's form, `{session, doc, document, include:
["issues"]}`), `provided` (`{doc, provided: [{item, provider: "<pack>.<name>", key, trap, out}]}`, #238), `sandbox`
(`{…, runs}`, #238), `deep_query` with `what: "logic"` (`{logic: {<item>: {steps: [{step, arrays, fuel}], trap}}}`,
#548); `deep-sandbox`'s `about` (#238); a logic item's `links` (#190); `test.mesh@1`'s `mesh` param (#238).

### The provider's memory (coordinated with the other two #192 suites)

- Params at `params_at`: every param of the provider's schema, in the order of the param names sorted by byte, each
  8 bytes little-endian: integer and bool types (`i32`, `i64`, `u32`, `u64`, `bool`) as i64, float types (`f32`,
  `f64`) as f64. A param the document leaves out takes its schema default.
- Assets at `assets_at`, as a logic item's are: each asset in the order the provider's `assets` lists them, as a u32
  little-endian length followed by its bytes. A `mesh_in` param's mesh is copied after those assets, in `mesh_in`
  order, in the mesh output's byte layout below.
- A mesh output (and a mesh_in input), at `out_at`: little-endian `u32 vertex_count, u32 index_count, f32
  positions[3n], f32 normals[3n], f32 uv0[2n], u32 indices[index_count]` (the base's layout). A data asset output:
  `u32 len` then its bytes (the base's layout). `provided` reports a data asset as `out: {data: {layout, asset:
  sha256 of its bytes, size}}` and a mesh as `out: {mesh: {positions, normals, uv0, indices, parts, bounds}}` (#238).
- The seed is `gen`'s i64 argument: the document's seed (`seed` on the document). A library form's `gen(seed: i64,
  params_at: i32, out_at: i32) → i32` reads the same params layout at its `params_at` and writes the same output
  layout at its `out_at`.

This suite's readings of what that leaves open (*invented*): a param of `type: "mesh"` is a `mesh_in` param, whose
mesh comes in at `assets_at` and takes no 8-byte slot (the voxelizer's numeric param `cell` sorts before its mesh
param `source`, so it reads `cell` at `params_at` either way); a mesh_in mesh is copied as an asset is, a u32 length
then the mesh, and the voxelizer also finds it when the length word is left out, so either reading passes.

### A tile graph: the layout `<pack>.tiles@1` (*invented*)

A pack layout (Logic: data layouts), declared by the dungeon packs with a validator and a malformed twin, little
endian: `u32 width, u32 height, u32 node_count n`, then n nodes `{u16 x, u16 y, u16 w, u16 h}` (a room in tiles,
inside the floor), then n links `{u16 a, u16 b}` (node indices): 12 + 12n bytes. Its validator returns −1 for a
graph of that shape whose rooms lie inside the floor and whose links name nodes, else the first bad byte's offset;
the twin's link (1, 7) of a 2-node graph is bad at byte 32.

### A provider's data asset among a logic item's data assets (*invented* spelling)

An entry of a logic item's `assets` may be a provider use, `{gen: "<pack>.<name>", params}`, in place of an asset ID
("a document names `{gen: <pack>.<name>, params}` wherever it names an asset of the output's kind"). The provider runs
at the document's check once per content key; its data asset, validated by its layout, is copied into the item's
memory from `assets_at` as any data asset is (a u32 length, then its bytes) before the start function; and `provided`
lists it with `item` the logic item's ID. deep_query's logic read plays the document's logic items with it.

### `mesh_in` in a document (*invented* placement)

A provider use names `mesh_in` beside `gen` and `params`: `{gen: "vox.voxelize", params: {cell: 0.25}, mesh_in:
[{param: "source", item: "ball"}]}`; the pack's params schema declares `source: {type: "mesh"}`. The named item's
built mesh (a builder's output, before the item's own transform) comes in by its content key, which the provider's
content key covers. A mesh_in naming an instancer whose columns read logic arrays is refused at the document's check:
an error whose `path` starts with the provider use's path (`items/vox/params/mesh`) and which names the instancer, in
its `ids` or as `item: "<instancer ID>"` anywhere in the issue; the provider then gives no mesh.

### Provider `links`, and a library with fixtures unrun (*invented* spelling of the pack)

The pack carries the library as #190 lays a pack's libraries out, `libs: {"snap@1": {asset, exports: ["snap"],
fixtures: []}}`, and the provider names it, `providers.voxelize.links: [{name: "snap@1", asset}]`; the provider's
program is a relocatable object importing `lib:snap.snap` (#190's conventions). A library whose fixtures haven't run
(here: it ships none) never links: the pack is refused at install with an issue holding `library: "snap@1"`, or, if
the install admits it, the check of a document naming the provider refuses it with an error holding `library:
"snap@1"`, and the provider gives no output.

### The library form (*invented* spellings and convention)

- **In the pack**: `providers.<name>.library: {asset: sha256, fixture: {seed: integer, params: {name → value},
  expect: sha256 hex of the output's bytes}}`. The asset is a relocatable object (#190's conventions: memory imported
  as `env.__linear_memory`, no other import here) exporting `gen(seed: i64, params_at: i32, out_at: i32) → i32`.
- **Its name as a logic library**: `<pack>.<provider>@<pack version>` (here `dungeon.floor@1.0.0`), linked by a logic
  item's `links: [{name, asset}]` as any library is, its function imported as module `lib:<pack>.<provider>`, field
  `gen`. It links once its equality fixture has passed.
- **Shares**: the library form's `gen` does one share of its work a call and returns the shares left, 0 once the
  output at `out_at` is whole; its caller calls it again with the same arguments until it returns 0 (Logic: work across
  steps: "it keeps its progress in memory, does a share each step"). The dungeon's progress is its output's own length
  word, 0 in fresh memory.
- **The equality fixture** (at the pack check, once per pair of hashes): the provider form run with the fixture's seed
  and params (`gen(seed)` once), its output's sha256 required to be `expect`; and the library form run in its own
  zeroed memory with the same params laid out at its `params_at` and its output at its `out_at`, `gen` called until it
  returns 0, its output's bytes required to equal the provider form's. A difference refuses the pack at install
  (`outcome: "refused"`) with an issue holding `provider: "<pack>.<name>"` and `offset`: the first byte where the
  library form's output differs from the provider form's, counted in the output's bytes (a data asset's bytes after
  its u32 length; the shorter's length when one output is the other's start).

### `deep-sandbox`'s `provide` (*invented* call)

`{"call": "provide", "provider": {"program": base64, "params": ParamSchema, "out": Out, "budget"?}, "params": {name →
value}, "seed": integer}` → `{"ok": true, "trap": null | Trap, "bytes": base64 | null}`: one run of the provider as a
document's check runs it (the same params layout, seed, run and output decoding: the sandbox module's own code), off
any document or pack, so no layout validator runs. `bytes` is the output as the document receives it (a data asset's
bytes after its u32 length; a mesh's bytes as laid out at `out_at`), null after a trap. A line that lacks a field
answers `{"ok": false, "code": "bad_input"}`, as #238's calls do.

### Naming

A test finds a name by its key and value anywhere in an issue's JSON (`actual` or any nested object): `provider`,
`offset`, `library`, `item`; or an ID in the issue's `ids`. Prose (`what`) is never read.

## Packs and documents

`fixtures.ts` writes them per test; a pack folder holds `pack.json` and its assets, listed by sha256 (#238's form).

- `test/dungeon@1.0.0`: `requires.modules: {sandbox}` (with `library`, also `logic`); `providers.floor: {program:
  dungeon.wasm, params: {floor: {type: u32, default: 1, range: [1, 99]}, height: {type: u32, default: 40, range:
  [16, 64]}, width: {type: u32, default: 40, range: [16, 64]}}, out: {data: {layout: "dungeon.tiles@1", max_bytes:
  4096}}}`; `layouts["dungeon.tiles@1"]: {validator: tiles_validator.wasm, max_bytes: 4096, twins: [tiles_twin.bin],
  doc}`. Criterion 8's adds `library: {asset: dungeon_library.wasm, fixture: {seed: 1920040, params: {floor: 40,
  height: 40, width: 40}, expect}}`. `test/dungeonplant@1.0.0` is criterion 8's with the planted library form.
- `test/vox@1.0.0`: `providers.voxelize: {program: voxelizer.wasm, params: {cell: {type: f64, unit: m, default:
  0.25, range: [0.01, 10]}, source: {type: mesh}}, out: {mesh: {max_vertices: 24}}}`.
- `test/voxlink@1.0.0`: `libs["snap@1"]` with no fixture and `providers.voxelize` linking it (above).
- Documents in the agent's form (`format: 1`, `seed`, `packs: ["<owner/name>@<version>"]`, `requires.modules`): boards
  with logic items (`{kind: "logic@1", params: {program, step_rate: 60, writes, assets?, links?}}`, programs in the
  evidence store); scenes with `ball@1 {radius}`, `test.mesh@1 {mesh: <provider use>}`, and the swarm: `brain` (a logic
  item writing `pos` vec3 × 4, `live` bool × 4, `gen` i32 × 4), `probe` (a hidden ball@1) and `swarm` (`instance@1 {of:
  [probe], pos: {array: brain.pos}, live: {array: brain.live, as: bool}, gen: {array: brain.gen, as: u32}}`).

## Programs

`programs.ts` holds every program as WebAssembly text; each comment says what it does.

- **The dungeon generator**, one source built three ways: the provider (`gen(seed)` runs every share), its library
  form and the planted library form (each share seeded from its step, the share's number, instead of the given seed).
  A floor: n = 6 + hash(seed, floor) mod 7 rooms, room i from hash(seed, floor, i) after 10,000 rounds of mixing
  (340,164 fuel a room at the base, so a whole floor passes a logic step's default 1,000,000), each room 3 to 8 tiles a side
  inside the floor's border, and links i → i + 1 mod n. Share 0 writes the header, shares 1 to n the rooms, share
  n + 1 the links.
- **The tile graph's validator** and its twin; **the reader** (writes `head`: the first asset's length, width, height
  and node count); **the maker** (an object linking the library form: each step one `gen` call on its own params and
  seed, writing `floor`: the shares left, then its output region); **the brain** (writes nothing).
- **The voxelizer**: the box from floor(min ÷ cell) × cell to ceil(max ÷ cell) × cell around the input mesh's
  positions, 24 vertices and 36 indices wound counter-clockwise from outside; an empty mesh given none. **snap** and
  **the snap provider** (an object linking it).

Each logic program writes one array, so its write region holds it at offset 0 whatever order a region map takes.

The fixtures were checked in Node's own WebAssembly before the base run (a throwaway script, deleted): seed 1920040
floor 1 gives 6 rooms (84 bytes), seed 1920041 floor 1 gives 9 (120 bytes), seed 1920040 floor 40 gives 6 (84 bytes);
the library form called until 0 (8 calls) gives the provider's floor 40 byte for byte; the planted form gives 9 rooms,
first differing at byte 8; the validator passes all of these and every corner of the params' ranges and refuses the
twin at 32; the reader writes [84, 40, 40, 6]; the maker linked to the library form by hand (two modules sharing a
memory) shows 7, 6, … 1 shares left at steps 0 to 6 and floor 40 whole and equal at step 7; the voxelizer gives the
boxes ±0.5 and ±0.75 for point sets of radius 0.4 and 0.6, with and without the length word, every triangle wound
outward, and an empty mesh given none; every object assembles and validates.

And against the base's own deep-show (`full,test-mesh-item`, a throwaway script, deleted): test/vox@1.0.0 installs; the
ball scene with `vox` (without `mesh_in`) is presented with no issue and runs the provider once; the swarm scene's
`brain`, `probe` and `swarm` are presented with no issue (with `pos: {array: brain.pos}`: an `as: vec3` there is
refused by the base's column view); the board with `reader` (no asset) is presented and deep_query reads `reader.head`
at steps 0 and 1; and a logic item running the generator one share a step, its own params floor 40, height 40, width
40, used 80 fuel at step 0, 340,164 at each room's step (1 to 6) and 184 at the links' step 7, each under a step's
default 1,000,000, the whole floor about 2,041,000.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#192.` and the first 8 hex digits of the SHA-256 of the criterion's text,
trimmed, white space collapsed. Each test's name starts with its ID. One test per criterion.

| ID | File | What it asserts, and the wrong programs it fails on |
|---|---|---|
| 5 `#192.59d34e71` | `ac05-tile-graph.test.ts` | test/dungeon@1.0.0 installs. Boards of seeds 1920040 and 1920041 whose logic item `reader` names `{gen: dungeon.floor, params: {floor: 1, height: 40, width: 40}}` among its data assets are presented with no error; `provided` holds each `reader` asset from `dungeon.floor` in `dungeon.tiles@1`, its ID the sha256 of the bytes the program writes for that seed in Node (40 × 40, n rooms, n links: checked), its size theirs; the two keys differ and the two assets differ; deep_query's logic read gives `reader.head` = [length, 40, 40, n] at step 0. deep-sandbox's `provide` on this Mac (`about`: aarch64, macos) and on Linux (x86_64, linux) gives, for each seed, bytes whose sha256 is that seed's asset. Fails: params or seed not given as laid out, a logic item without the asset at step 0, a key without the seed, a host whose bytes differ |
| 7 `#192.f3c60337` | `ac07-mesh-in.test.ts` | test/vox@1.0.0 installs. Revision 1 (ball radius 0.4): presented; `vox`'s mesh from `vox.voxelize`, 24 vertices and 36 indices, bounds ±0.5 m within 1e-6; one sandbox run. Revision 2 (radius 0.6): another key, bounds ±0.75; one run. Revision 3 (the ball moved, its params left): revision 2's key and mesh; no run. The swarm scene: an error at `items/vox/params/mesh…` naming `swarm`; no mesh. test/voxlink@1.0.0: refused naming `library: snap@1` at install, or else at its document's check; no mesh. Fails: mesh_in not copied, a key not covering the built mesh's key, a rerun or new key per revision, an instancer fed by logic let through or refused unnamed, a link with fixtures unrun |
| 8 `#192.b641f8a3` | `ac08-library-form.test.ts` | test/dungeonplant@1.0.0 is refused at install with an issue holding `provider: dungeonplant.floor` and `offset` = the first byte where its library form's floor 40 differs from the provider's (in Node: 8); test/dungeon@1.0.0 installs. A board of seed 1920040: `atcheck`'s floor 40 asset (`provided`) is the provider program's bytes; `maker`, linking `dungeon.floor@1.0.0`, runs steps 0 to 23 without a trap, shows shares left at step 0 and, at the first step with none left, an output whose bytes hash to that asset. Fails: an equality fixture that doesn't run or compare the library form, a refusal without the provider or the byte, a library form that won't link or run across steps, a floor in play that isn't the provider's |

## Planted twins

None is a flag: each is a fixture of this suite, reachable only through the test that names it.

| Twin | Criterion | The wrong program |
|---|---|---|
| seed 1920041 | 5 | the same document with another seed: must give other bytes under another key |
| Linux x86_64 | 5 | the same provider and seed on another architecture: must give the same bytes |
| radius 0.6 | 7 | the builder's params changed: must change the provider's key and output |
| the ball moved | 7 | a revision that leaves the builder's params: must keep both, and run nothing |
| `swarm` | 7 | a logic-fed instancer named by mesh_in: must be refused, naming it |
| `snap@1` with no fixture | 7 | a library whose fixtures never ran, linked by a provider: must be refused, naming it |
| `dungeon_planted` (test/dungeonplant@1.0.0) | 8 | a library form that seeds from the step: must fail the equality fixture, naming the provider and the first byte that differs |
| the maker | 8 | floor 40 made in play, one share a step: must be the provider's floor 40 |

## Readings where the issue leaves a choice

- **"The same seed gives the same bytes on macOS arm64 and Linux x86_64"**: the app's asset on this Mac (deep-show)
  and the sandbox module's runner on this Mac and in a linux/amd64 container (`provide`), all one sha256. deep-show
  isn't built for Linux here: its `full` build needs more than the slim image holds, and the runner is the code that
  runs a provider.
- **"Another seed gives other bytes under another key"**: the document's seed (the provider's seed by default);
  `provided`'s `key` and `asset`.
- **"Reads width 40 and height 40 from it at step 0"**: the reader's `head` array at step 0, by deep_query's logic
  read, whose bake is the hub's play of the document's logic items.
- **"Makes floor 40 in play, inside a logic item sliced across steps"**: that same read of the maker, which makes the
  floor one share a step under the item's default budget (a whole floor passes it); "sliced" is shares left at step 0
  and the floor whole at a later step. **"The same bytes the provider writes for floor 40 at check"**: the asset
  `provided` holds for `atcheck`, which names floor 40 among its data assets.
- **"Fails the pack's equality fixture, naming the provider and the first byte that differs"**: the planted pack's
  install refused, one issue holding both; the byte is counted in the asset's bytes.
- **"Meshes it at check"**: the provider ran at the document's check (`provided`, the sandbox's `runs`), its box
  around the ball's built mesh. **"Keeps both"**: the same key and mesh, and no run. **"A revision that leaves
  them"**: the ball moved, its builder params as they were (its built mesh is the builder's output before the item's
  transform).
- **"A logic-fed instancer"**: an `instance@1` whose columns read a logic item's arrays (Instance: logic columns).
- **"A library with fixtures unrun"**: one that ships none, so none has run on this core; refused at install or at
  the document's check, whichever the implementation does first.

## Not covered

The issue's other ten criteria (the voxel and packs suites); `graph_in`; `out: pages` (#211); a mesh_in that depends
on the provider's own output (a cycle), one bound to time or from a logic item's mesh; a provider library's `needs`;
`deep_kinds`' and `deep_query`'s provider listings; the web player.
