# Acceptance tests for #192, voxel part: the voxel mesher, running once per content key, traps and the import refusal, bound params, the key's module-version term and the budgets

Written first, from issue #192 (its scope, its Fields and criteria 1, 2, 3, 4, 9 and 10 of its thirteen), its Oracle
page (`doneright/oracles/issues/192.md` on branch `doneright` of DeepBuildAI/deepbuild), the design sections it links
and base commit `06e231702` ("Merge pull request #2735 …"), by a job that never saw an implementation; none existed.
Two other blind jobs write `tests/acceptance/192/dungeon/` (criteria 5, 7, 8) and `tests/acceptance/192/packs/`
(criteria 6, 11, 12, 13). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- The issue body (no comments) and its Oracle page. The page links an upstream mesh library's tests for criterion 1:
  a misconnected tetrahedron and an unwelded cube are refused as invalid input, and after welding the cube has 12
  triangles and 8 vertices. Its rule, "after welding, every edge joins exactly two faces", is ported here as `openEdges` in
  `helpers.ts` (written again, not copied). The 600-quad count, the bounds and naming the first open edge are ours.
- `docs/canvas-primitives.md`: Provider `gen@1`; Provider `gen@1`: links, meshes and the library form; Logic: sandbox;
  Logic `logic@1`; Logic: data layouts; Pack; Builder; Check input: loop kinds: shading defects; Driver; Control.
  `docs/technical-design.md`: Provider, The logic module (Sandbox and budgets), Dogfooding. `AGENTS.md`.
- At the base, for the surfaces these tests use: `crates/deep-show/src/sandbox.rs` (`Host::provide`: a param
  `{gen: <pack>.<provider>, params}` of a pinned pack run at the document's check, once per content key over
  program, params, seed, `assets: []`, out and the sandbox module's version; `provider_trap` errors with `actual:
  {provider, item, trap}`; the mesh decoded from `out_at`; `provided`), `crates/deep-sandbox-wasmtime/src/service.rs`
  (`Budget::of`, the runner: it copies no params and no assets into a provider's memory),
  `crates/deep-canvas-test-modules/src/sandbox.rs` (`test.mesh@1`), `crates/deep-show/src/main.rs` (startup
  `--planted` and `--cache`, the scenario's `planted`, `frames`' `from`/`step`/`pixels`), `hub.rs` (`sandbox`,
  `provided`), `frames.rs` (`registry`'s `versions`, `frames`' `ran` and `pixel_hash`), `kept.rs` (#1901's `--cache`),
  `logic.rs` and `evidence.rs` (a logic item's program read from the evidence store by sha256), `scripts/lanes.mjs`,
  `scripts/proof-change.mjs` (criterion IDs), and the suites `tests/acceptance/238/` (reused by import:
  `helpers.ts`), `453/` (geometry.shading's Result fields), `1901/`, `166/`, `504/`, `531/`, `544/` (document
  shapes: drivers, controls, logic items).

What the base already does, which these tests don't credit: a provider runs at a document's check once per content
key, its trap is an error naming the provider, the item and the kind, and a mesh past `max_vertices` is reported
`over_cap`. What it lacks: params and assets copied into memory (so the mesher here traps `unreachable` on its
missing grid), geometry.shading on a provider's mesh, the closed rule, a structured import refusal, refusing a bound
param, a provider output kept across processes, the two version-bump test builds and the two planted keys.

## Run them

```sh
npm ci && npm run build --workspaces            # once, in a fresh worktree
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # cargo
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1
node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/192/voxel --no-file-parallelism --testTimeout=600000 \
  ac01-mesher.test.ts ac02-content-key.test.ts ac03-traps.test.ts ac04-bound-params.test.ts ac09-module-version.test.ts
node scripts/throttle.mjs timed --wait 480 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/192/voxel --testTimeout=600000 ac10-budgets.test.ts
npx tsc -p tests/acceptance/192/voxel/tsconfig.json
rm -rf tests/acceptance/192/voxel/node_modules/.vite
```

`scripts/lanes.mjs` lists the folder in `alone` (each file builds deep-show) and `ac10-budgets.test.ts` in `timed`.
Every test passes its own timeout (one to two hours). What a run builds, all honouring `CARGO_TARGET_DIR`:

- #238's fixture assembler `tests/acceptance/238/wat`, which turns this suite's WebAssembly text (generated in
  `programs.ts`) into bytes: its three source files copied to a temporary folder outside the checkout and built there
  (`cargo build --offline`, else `cargo build`) into `target/acceptance-192-voxel-wat/`. Inside the checkout,
  `.cargo/config.toml`'s patches, newer than that crate's lockfile, make `cargo build --locked` refuse it at this
  base.
- `deep-show` with `full,test-mesh-item`; for criterion 9 also `full,test-mesh-item,test-logic-version-bump` and
  `full,test-mesh-item,test-sandbox-version-bump`; each `cargo build --locked --bin deep-show --no-default-features
  --features <set>`, copied out under its own name.
- For criterion 10, the merge base's `full,test-mesh-item` (`git merge-base HEAD origin/main`, exported with `git
  archive` into `target/acceptance-238-base/<sha12>/`, #238's kept folder, and built there with its own target folder).

How long: a first run, with every build cold, about 45 to 75 minutes on a quiet Mac (most of it the four builds); warm,
about 10 to 20 (criterion 2's two 3,600-frame plays and criterion 10's six processes are the slow runs).

Gates: criterion 10's timing is judged only on a fit reference Mac (#238's `environmentProblem`: Mac15,7 or Mac15,12,
Low Power Mode off, thermal state nominal, 1-minute load at most the core count; mains power never gates); elsewhere,
or between the limit and the margin, the test fails with `INCONCLUSIVE:`, never passes. Off macOS that is every run.
Cargo that can't run fails `BLOCKED:`.

## The surface

The issue names the provider's fields, its exports, its content key's terms, the refusals and traps and what each
names, but no call or field that shows them. **Every name below that the issue and the design don't give is this
job's invention**, the smallest surface these criteria need; the implementer builds exactly these, or a dispute goes
to a blind redraft. #238's surface (`deep-show run` scenarios, `install_pack`, `deep show` as `present`, `provided`,
`sandbox`, `frames`, `registry`, `test.mesh@1`, the pack folder form) is kept as it is.

**Memory a provider reads and writes** (the three #192 suites share this layout):

- Params at `params_at`: every param of the provider's schema, in the order of the param names sorted by byte, each 8
  bytes little-endian: integer and bool types (`i32`, `i64`, `u32`, `u64`, `bool`) as i64, float types (`f32`,
  `f64`) as f64. A param the document leaves out takes its schema default.
- Assets at `assets_at`, as a logic item's are: each asset in the order the provider's `assets` lists them, as a u32
  little-endian length followed by its bytes. A `mesh_in` param's mesh is copied after those assets, in `mesh_in`
  order, in the mesh output's byte layout below.
- A mesh output (and a mesh_in input), at `out_at`: little-endian `u32 vertex_count, u32 index_count, f32
  positions[3n], f32 normals[3n], f32 uv0[2n], u32 indices[index_count]` (the base's layout). A data asset output:
  `u32 len` then its bytes (the base's layout).
- The seed is `gen`'s i64 argument (the document's `seed` when the provider names none).

**A pack's provider entry** (Pack: `providers`; Provider `gen@1`): `{program: sha256, params: {name → {type, unit,
default, range: [min, max]}}, assets?: [sha256], out: {mesh: {max_vertices, closed}}}`, its program and assets among
the pack's `assets`.

**`provided` rows** (#238's `{item, provider, key, trap, out}`) gain:

- `shading`: geometry.shading's counts on a mesh output, by #453's Result names: `non_manifold_edges`,
  `non_manifold_vertices`, `inconsistent_edges`, `flipped_faces`, `degenerate_faces`, `boundary_edges` (more fields
  are allowed).
- `ms`: when this check ran the provider (not when it took the output by key), the run's own wall time in
  milliseconds on the one thread that ran it, from the rewritten bytes to the decoded output (compiling them in the
  engine, instantiating, copying params and assets in, `gen`, reading the output out).
- `out` is null after any trap or refusal ("keeps no output").

**Errors** (in `deep show`'s `issues`, or in `install_pack`'s where the pack's own check finds them):

- A mesh declared `closed` with an open edge: an error naming the provider (`<pack>.<name>` anywhere in it, or a path
  under `providers/<name>` at the pack's check) whose `actual` holds `edge: [[x, y, z], [x, y, z]]`, the first open
  edge's two welded positions in metres (which open edge is first is the implementer's; it must be one). Its code is
  the implementer's.
- A trap (`over_cap`, `fuel`, …): `provider_trap` (the base's code) with `actual: {provider: "<pack>.<name>", item,
  trap: {kind, …}}`.
- A program that imports a function: an error, at the pack's check or the document's, holding somewhere in it the
  object `{module, name}` of the import (#238's `Refusal.import`); `what` prose is never read.
- A provider param bound to time, a channel, a control, a reading or a logic array: **`provider_param_bound`**, an
  error with `actual.param` the param's name (here `size`), at the document's check. These tests bind with a driver
  (`drivers: {name: {target: "items/<id>/params/<param>/params/<name>", expr, vars}}`, a var `time`,
  `controls/<id>/value` or `<logic ID>.<array>`).

**Outputs across processes:** `deep-show run --cache <dir>` (#1901's startup argument) also keeps each provider output
in `<dir>` by its content key, and a later process given the same folder, of this build or another, takes it by key
without running the provider. The key is the issue's (program, params, seed, asset hashes, out, the sandbox module's
version) and nothing else, so no build digest or fingerprint.

**Test features of `deep-show`** (in no shipped build):

| Feature | What the build holds |
|---|---|
| `test-logic-version-bump` | the full set with the logic module's version raised (another version in `registry`'s `versions.logic`), nothing else changed |
| `test-sandbox-version-bump` | the full set with the sandbox module's version raised (`versions.sandbox`), nothing else changed |

**Planted twins of `deep-show`**, each given as the scenario's `planted` and changing nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `provider_key_omits_params` | 2 | a provider's content key leaves out its params |
| `provider_key_names_logic` | 9 | a provider's content key also names the logic module's version |

**Seeks:** a seek to frame k is `frames` with `count: 1, from: "<k>f", step: "1f", pixels: true`; a straight play is
`frames` from `0f` with `count: 3600`.

## Fixtures (`programs.ts`)

WebAssembly text, generated and assembled by #238's assembler; each program exports `memory` (minimum = maximum),
`gen(seed: i64) → i32` and the immutable globals `params_at` (16), `assets_at` and `out_at`, and imports nothing but
`clock_import`. `ac01` and `ac03` first run their fixtures in Node's WebAssembly engine with the layout above (no
rewrite, no metering) and check they write what is said here, so a fixture bug fails there and never blames the work;
`ac01` also takes the mesher's bytes as the expected mesh and the planted mesher's open edges from that run. Checked
while drafting, the same way: the mesher writes 600 quads, closed, 602 welded vertices, every triangle's winding
agreeing with its normal, signed volume +15.625 m³ (1,000 voxels of 0.25 m), the block's bounds exactly at sizes
0.0625, 0.125, 0.25, 0.375 and 1; the planted mesher leaves four edges of one face each, all on the −x face of voxel
(3, 11, 19); the fault provider writes 12 and 13 vertices at `fault` 0 and 1.

- `voxel_mesher`: its grid asset is 32,768 bytes, one byte a voxel, index x + 32 × (y + 32 × z), holding one solid
  block at x 3–12, y 11–20, z 19–28 (off centre, so a swapped axis shows); it traps `unreachable` unless that asset's
  length is 32,768. Its one param `size` (f64, m; default 0.5, range 0.0625–1) is the voxel edge. It counts the exposed
  faces, then writes four vertices (corners × size, the face normal, uv0 (0,0) (1,0) (1,1) (0,1)) and two triangles
  (0 1 2, 0 2 3), wound outward, per face: 600 quads, 2,400 vertices, 3,600 indices, closed after welding (602 welded
  vertices), bounds `[[3, 11, 19], [13, 21, 29]] × size`.
- `voxel_mesher_holey` (criterion 1's plant): the same, leaving out the first exposed face (the −x face of voxel (3,
  11, 19)): 599 quads and four edges with one face each.
- `tetra_faults` (criterion 3): a 12-vertex flat-shaded unit tetrahedron, wound outward, under `max_vertices: 12`;
  its param `fault` (i32, default 0, range 0–3) at 1 writes the same with a 13th vertex, at 2 loops forever. The
  pack's check, at the range's ends and the default, meets neither fault (criterion 11's check can't refuse the pack
  before the document's check runs it).
- `clock_import` (criterion 3): imports `env.now`.
- `grain_logic` (criterion 4): a logic item's program that writes 0.25 to its array `grain` (f64) each step.

Packs, each written per test with its assets' sha256s, `requires.modules: {sandbox}`: `test/voxpack@1.0.0`
(`voxpack.mesher`, `max_vertices: 2400, closed: true`, its grid in `assets`), `test/holeypack@1.0.0`
(`holeypack.holey`, the same declaration), `test/faultpack@1.0.0` (`faultpack.overcap` and `faultpack.spin`, two
entries of `tetra_faults`, `max_vertices: 12, closed: false`), `test/importpack@1.0.0` (`importpack.clock`).
Documents are #238's boards with a `test.mesh@1` item `{mesh: {gen, params}}`, `requires.modules: {"test.mesh":
"^1"}`, and their own `seed`. Their sizes (0.25, 0.375, 0.125) are exact in binary and none is the default or a range
end, so no output the pack's check made can stand in for a document's run.

## Criteria to tests

IDs are `#192.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with its ID. One test per criterion; each holds its plants.

**`#192.30d22948`** (criterion 1) — `ac01-mesher.test.ts`: `voxpack` installs; the voxel document at size 0.25 is
presented with no error; its `provided` row is `voxpack.mesher`'s, no trap, a content key, and its mesh equals what
the mesher writes (1,200 triangles, 600 quads), bounds within 1e-6 m of the block's, closed by the ported rule, and
`shading`'s six counts 0. The planted mesher: its document isn't presented; an error (at install or at the document's
check) names `holeypack.holey` and one of its four open edges; no row keeps a mesh. Wrong programs: params or assets
not copied in, a mesh not the program's bytes, no geometry.shading, a closed check that passes an open mesh or names
no edge, an output kept.

**`#192.8553dd58`** (criterion 2) — `ac02-content-key.test.ts`: one process: checked twice at size 0.25 (runs +1, then
+0 with the same key), at 0.375 (runs +1, a new key, the block at 0.375), a 3,600-frame straight play and 10 seeks to
frames drawn by mulberry32 from 192002 (runs +0, key unchanged, each seek's pixel hash the straight play's at that
frame; a channel-driven rect makes the frames differ). Plant: `provider_key_omits_params` fails it, a failure naming
`size`. Wrong programs: a provider run per check or per frame, a key without the params, a seek that draws another
frame.

**`#192.3a0faf7a`** (criterion 3) — `ac03-traps.test.ts`: `faultpack` installs; `fault: 1` and `fault: 2` documents
are each refused with `provider_trap` naming the provider, the item and the kind (`over_cap`, `fuel`) and keep no
output; the `importpack` provider is refused (at install or at check) with an error holding `{module: "env", name:
"now"}`, and keeps no output; the same fault provider at its default is presented with its 12 vertices. Wrong
programs: a cap not read, no metering, a trap that keeps an output, an import admitted or named only in prose.

**`#192.18162055`** (criterion 4) — `ac04-bound-params.test.ts`: the voxel document with `size` driven by `t`, by a
document control and by a logic item's array is refused each time with `provider_param_bound`, `actual.param:
"size"`; with `size` 0.125 it is presented, its mesh the block at 0.125. Wrong programs: a bound param admitted, a
refusal that doesn't name the param, a constant refused.

**`#192.aeb0ef10`** (criterion 9) — `ac09-module-version.test.ts`: on one `--cache` folder, `full,test-mesh-item` runs
the provider once; the logic bump build (its logic version differs, its sandbox version the same) runs it 0 times
with the same key and the same mesh; the sandbox bump build (sandbox version differs, logic the same) runs it once
with another key. Plant: `provider_key_names_logic`, on a fresh cache in the first two builds, fails it, a failure
naming the key's term, the logic module's version. Wrong programs: a key naming the logic module's version, a key
without the sandbox module's, an output not kept across processes.

**`#192.23382ecd`** (criterion 10) — `ac10-budgets.test.ts`: six fresh processes check the voxel document (each runs
the mesher once, 1,200 triangles, a positive `ms`); 60 frames of a document with the fault provider and a moving rect
run as many nodes per frame here as on the merge base's `full,test-mesh-item`, and the sandbox module's counts don't
move during them; then the five readings after the warm-up are judged against 200 ms on a fit reference Mac. Wrong
programs: a run past 200 ms, a provider re-checked or run in a frame, nodes added per frame.

## Readings where the issue leaves a choice

- **"In a test outside pack"**: a pack the test writes and installs with `install_pack`, as #238's quadpack.
- **The occupancy grid** comes as an asset by hash, so "reads assets by hash" is exercised; the voxel edge is a param
  so criterion 2 has a param whose change changes the output.
- **"Fails the check"** for the planted mesher and the importing provider: the design checks providers both at the
  pack's check (criterion 11) and at the document's, so either may refuse first; the naming is required wherever it
  happens. The over_cap and fuel faults hang on a param value the pack's check never runs, because criterion 3 asks
  for "the item", which only a document's check has.
- **"The first open edge"**: one of the open edges, as two welded positions; the order is the implementer's.
- **"Checked twice … a cache hit by content key"**: no run between the checks and an equal key; **"changing one param
  runs it once more"**: one run, a new key, an output of the new value.
- **"A 60 s playback with seeks to 10 seeded times"**: 3,600 frames at 60 per second; 10 frame numbers from a fixed
  seed, seeked out of order; "every frame's hash" is `frames`' `pixel_hash`, compared at each seeked frame.
- **"A test build that changes only the logic module's version"**: a deep-show feature; "reuses its output by key"
  across builds needs an output kept outside the process, read here as #1901's `--cache` folder.
- **"Naming the param" / "naming the key's term"** for the planted keys: this test's own failure message, since a
  planted key fails the test, not the check.
- **"Under 200 ms at check on one core"**: the run's own time on the one thread that ran it (a provider never spreads
  over threads); macOS gives no way to pin a process to a core. "Compared with the merge base": the merge base copies
  no params or assets in, so it can't run this mesher; the 200 ms is the issue's, and the merge base is compared
  per frame.
- **"A document with providers gains no work per frame"**: the fault provider at its default, which the merge base
  runs too, so the same document plays on both.

## Not covered here

Criteria 5–8 and 11–13 (the dungeon and packs suites). Rows and data-asset outputs, links, `mesh_in`, the library form,
`out: pages`, `deep_kinds` and `deep_query` listings, the web bundle, a seed other than the document's, budgets past
their defaults, a channel or a reading as the binding (the criterion names t, a control and a logic array).

## Base failure

`BASE-FAILURE.txt` holds what ran at the base (`06e231702`): the cargo feature check for criterion 9's two test
builds (both missing) and the fixtures in Node; and, read from the base's code, the first failure each file meets
there. No file ran through deep-show at the base: the shared Mac's one build slot stayed taken with five to ten builds
queued ahead while this suite was drafted. That base run is still owed; it replaces the file's last section.
