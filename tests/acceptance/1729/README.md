# Acceptance tests for #1729: A glTF model placed through deep_show is silently not drawn: render-back reads no mesh assets

Written first, from issue #1729 (its body, Scope, eight acceptance criteria and Proof line: "The three models' snapshots
and `visible` tables beside `view3d`'s, the missing-asset refusal, and the base's empty frames"), the design sections it
links and those they lean on, and the base commit `ef869ad87` (the worktree's HEAD: main's `54d307821` with #2321
merged on top, which changes no crate), by a job that never saw an implementation; none existed, and no other branch,
pull request or worktree was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, the planted twin inside the test
that names it.

## What was read

- Issue #1729 (`gh issue view 1729`); the titles of #423 and #806 it depends on.
- `docs/canvas-primitives.md`: Render-back (the reply's `snapshots` and "a table of visible item IDs with screen boxes");
  Asset (one checked read of a store file by a 64-hex name, `asset_missing`); Asset: meshes; Material and Material:
  texture maps (`maps: {base_color, …: sha256}`, decoded in the worker, the 64 MB decoded-image cap); Sky `sky@1` and
  Sky `sky@1`: environment (`environment: {from: sky | studio | sha256}`, an HDR asset drawn behind the scene by
  default); Mesh sequence `mesh.sequence@1`; Document envelope (`requires.kinds`: "each kind's minor is the lowest its
  used fields need").
- `docs/technical-design.md`: Render-back; Dogfooding; Tests written first.
- At the base, only to learn the surfaces and what a fixture can hold: `crates/deep-show/src/main.rs` (the `deep_show`
  and `render_back` calls, the scenario's `planted`), `hub.rs` (`deep_show`'s 3D frame: `draw3d`, `present`, `visible`),
  `ask.rs` and `probe.rs` (`render_back` of a 3D revision), `scene3d.rs` (`Gpu3::draw` and `Gpu3::evaluate`),
  `media.rs` (`probe_assets`), `evidence.rs`; `crates/deep-canvas-scene3d/src/scene.rs` (`evaluate_any`, `asset_mesh`,
  `asset_scene`, `Scene::boxes`), `fixtures.rs` (`mesh.sequence@1`'s per-frame form), `sky.rs`, `spec.rs` (material@1's
  params); `crates/deep-scene3d-render/src/env.rs` (the Radiance reader and the black 2 × 1 fallback);
  `crates/deep-gpu-layer/src/view3d.rs`, `textures.rs` and `live.rs` (`view3d`'s `assets`, the `live` call, its
  `canonical` event and `render_canonical`); `crates/deep-canvas/src/document/check.rs` (`requires.kinds`, a field a
  required newer minor skips); `scripts/proof-change.mjs` (`criterionId`); and `tests/acceptance/1401/`, `423/`,
  `424/`, `429/`, `806/`, `1918/` and `2293/` for conventions and harness.

## What the base already does, which these tests don't credit

`deep-show run`'s `render_back` call evaluates a 3D revision with a reader of the evidence store, so it already draws a
`mesh.asset@1` (the Duck's revision renders back unlike the empty scene's), lights by a `sky@1` environment named by
hash, and refuses a missing mesh hash `asset_missing`; AC2's and AC4's `render_back` halves pass at the base. view3d
reads the files its `assets` names: it draws the Duck (object-ID box [96, 37, 228, 163] px) and the red panel (mean
colour (1, 0, 0) at its centre). Neither is credited: each test fails at the base on `deep_show`, the live canonical
render or a missing file, as its criterion says.

Checked by hand at the base (a scratch run, since removed) and seen again in `BASE-FAILURE.txt`: every fixture document
is checked with no issue. `deep_show` presents the three models, the Duck with a missing hash and the empty scene all
as one snapshot, `843d20ce…`, with `visible: []` and no issue; the lit, black and missing skies as one snapshot,
`babff43c…`, with no issue; the two sequences with `visible: []` and no issue (the check also skips `mesh.sequence@1`
as `unknown_kind`, a notice: the base registers no such kind); the mapped panel white (mean (1, 1, 1)), its `maps`
skipped with an `unknown_field` notice, since the base's material@1 is at minor 0 and has no `maps`; and the live
call's canonical renders of the Duck and the empty scene as one pixel hash, `2cb334e4…`. view3d draws the panel whose
map it isn't given, with no issue. None of the planted name exists.

## The base doesn't build

Main at `54d307821` (and so the base) doesn't compile: `crates/deep-canvas-motion/src/cues.rs` (line 841) writes
`ty: ParamType::Json,` where #1973 made the variant `ParamType::Json(&'static str)`. The base run in
`BASE-FAILURE.txt` used a local, uncommitted one-line fix of it, the coordinator's:
`ty: ParamType::Json("[{id?, when?, gap?, span?, ease?, lag?, order?, targets?, set?, kind?, params?}] ≤ 512"),`.
It touches the cue lists' param description only. Without it every test here fails at "the binaries build".

## Run them

They build `deep-show` and `deep-gpu` with cargo and draw on the GPU, so they run alone. `scripts/lanes.mjs` needs
`'tests/acceptance/1729/'` added to its `alone` list, beside `tests/acceptance/1401/`; this README is the instruction,
the implementer makes that edit. No other root file changes.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1729 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1729/tsconfig.json
```

Cargo must be on `PATH` (here `~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`). Every file first builds both
binaries by one call (`cargo build --locked --bin deep-show --bin deep-gpu`), copies them out of `target/debug` and
fails each test if the build failed. Each test writes into its own temporary folder (the evidence store, the documents,
deep-gpu's outputs) and deletes it. 3D render-back and the GPU layer draw on macOS's Metal device, so off macOS each
test fails with a message starting `INCONCLUSIVE:`, never passes, as does a reply that says `unsupported_platform`.
Nothing is gated on power or load. A run with `--root` may leave Vitest's cache in
`tests/acceptance/1729/node_modules/.vite`; delete it. Tests print the issue's Proof as lines starting `PROOF #1729`.

## The surfaces under test

All exist at the base; nothing is added to any call or reply but the planted name below.

- **Render-back** is `deep-show run` (#393's convention: one scenario line in, one answer with a reply per call). The
  agent's `deep_show` of a whole document with `include: ['issues', 'pixels']` and `size: [320, 240]` is the
  render-back the issue reproduces: its reply's `outcome`, `issues`, `snapshots[0].sha256` (a PNG in the evidence
  store) and `visible` (`[{id, box: [x, y, w, h]}]` px). The `render_back` call (`{session, doc, t: 0, rev: 1, size}`)
  re-renders the revision `deep_show` made; AC2, AC4 and AC7 read its snapshot too. Files go into the evidence store by
  its layout (`<first 2 hex>/<other 62 hex>`), named by the item's hash and listed in the document's `assets`.
- **view3d** is `deep-gpu run`'s `view3d` call on a session document, frame 0 captured, with `assets: {sha256: path}`;
  AC1 reads its object-ID target (`targets: ['ids']`: a PNG of pick IDs, `r + 2^8 g + 2^16 b + 2^24 a`, and `picks`,
  each pick's item), AC8 its reply.
- **The GPU layer's canonical render** is `deep-gpu run`'s `live` call (#379): two sessions opened at frame 1, each a
  payload file and its own writer, the call's `assets` naming the Duck's file by hash, and at frame 2 a `canonical`
  event `{session, purpose: 'render_back', frame: 2, size: [320, 240]}` for each; AC6 reads each one's `pixel_hash`.

**A reply carries `asset_missing` at a path** when it is the reply's own refusal (`{code, path}`, or deep-gpu's `{code,
reason}` naming the path) or an entry of its `issues` with that `code` and `path`. "At the item" (AC5) is the path
`items/<id>` or any path under it. **Nothing is presented as clean** follows: the issue is in the reply itself, so a
reply that carries it never presents the frame clean; one that doesn't, but is presented (`outcome: presented`) or
drawn (view3d's `frames`), fails, naming the item.

### Planted program

Reachable only through the `deep-show run` scenario's `planted`, only to prove AC3's check fails on a wrong program; an
unknown name stays `bad_input`.

| `planted` | The wrong program | Test, and what its failure must name |
|---|---|---|
| `skips_missing_mesh_asset` | Render-back (`deep_show`'s frame) skips a `mesh.asset@1` whose file isn't in the evidence store, as the base skips every one: it draws the rest and presents the frame with no issue and no notice for that item; everything else as the real path | AC3: the check fails on the missing Duck, its failure naming `duck` (its path `items/duck/params/sha256`) |

The other criteria name no wrong program; each file's header lists the wrong programs its test fails on.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1729.<id>`.

| ID | File | What it asserts |
|---|---|---|
| AC1 `#1729.f59f9cb0` | `models.test.ts` | The Duck, in the store and named by one `mesh.asset@1` (`duck`), renders back through `deep_show` with no error issue and `visible` rows of `duck` (`duck` or `duck#<part>`), whose union box is within 1 px, edge by edge, of the box of `duck`'s pixels in view3d's object-ID target for the same items, camera and 320 × 240 px |
| AC2 `#1729.797f90d5` | `models.test.ts` | Box, Duck and BoxTextured, each placed the same way, and the same scene with nothing placed: on `deep_show` and on `render_back`, the three models' snapshot hashes differ from each other and from the empty frame's |
| AC3 `#1729.1248be9e` | `models.test.ts` | The Duck's scene with a hash no store holds: `deep_show`'s reply carries `asset_missing` at `items/duck/params/sha256`, never presented as clean. Then `skips_missing_mesh_asset` fails the same check, naming `duck` |
| AC4 `#1729.6e5d2b27` | `environment.test.ts` | A box under a `sky@1` whose `environment.from` names a 64 × 32 px Radiance file of radiance 1, in the store, against the same document with an all-black file of that size: different snapshot hashes on `deep_show` and on `render_back`; with a hash no store holds, `asset_missing` at `items/sky/params/environment/from`, never presented as clean |
| AC5 `#1729.612df1ca` | `sequence.test.ts` | A one-frame `mesh.sequence@1` (`seq`) whose frame is in the store renders back with `seq` in `visible`; its twin naming a hash no store holds is answered `asset_missing` at the item (`items/seq` or under it) |
| AC6 `#1729.3e434fdf` | `canonical.test.ts` | The live call's canonical `render_back` of the Duck document has a pixel hash different from the same document's without `duck` |
| AC7 `#1729.50fb770a` | `maps.test.ts` | A panel under the white, unlit `paper` whose `maps.base_color` is the red 64 px PNG in the store: over the middle half of the panel's `visible` box, mean red − mean green ≥ 0.3 (0 to 1 a channel) in the `deep_show` snapshot and in the `render_back` one |
| AC8 `#1729.beae915f` | `maps.test.ts` | The same document with the map's hash missing: `deep_show`'s reply carries `asset_missing` at `items/paper/params/maps/base_color`, and so does view3d's, given no file for it |

## Fixtures

- **The sample models** (`fixtures/`): `Box.glb`, `Duck.glb` and `BoxTextured.glb`, unchanged from the Khronos glTF
  sample-assets repository at commit `edc7c9e6…`, each pinned by SHA-256 in `helpers.ts` (`model`). Their credits and
  licences are in `fixtures/LICENSE.md`. The issue calls all three CC BY 4.0; the Duck's own licence file there names
  the SCEA Shared Source License 1.0 for its model files, so its asset entry says so.
- **Made in `helpers.ts`, never committed:** the red PNG (64 × 64 texels of 255, 0, 0, 255, no gamma or colour chunk);
  two flat Radiance HDRs of 64 × 32 px, every pixel RGBE (128, 128, 128, 129), linear radiance 1, or (0, 0, 0, 0),
  black; a JSON glTF of a 1 m box (one node, one mesh, u32 indices, its buffer inline) for the sequence's frame; and
  `ABSENT`, a hash no test writes anywhere.
- **The documents** are scenes at 320 × 240 px, `requires.modules.scene3d: ^1`, a camera `cam` (fov 40° across the
  wider side), in two forms of the same items: the agent's payload (deep_show, live) and a session document with one
  writer layer (view3d). The models' scene: camera at (0.1, 0.6, 5.5) m looking at (0.1, 0.6, 0), a grey sky with
  ambient light, a 3 lx sun, and the model as `{kind: 'mesh.asset@1', params: {sha256, node: {scene: 0}}}`: the
  file's whole scene with its own materials (Asset: meshes; #423), listed in `assets` as `{sha256, kind: 'mesh',
  license}`. The Duck's vertices project to [96.8, 37.0, 227.5, 162.5] px there, and view3d's object-ID box is
  [96, 37, 228, 163], so AC1's bound holds with room. The environment's scene: a 1 m box in a grey physically based
  material under a sky of black gradient and no ambient light. The panel's: a `slab@1` 2 × 1.5 m with planar uv0 about
  z, 3 m in front of the camera. Displayed text holds no number and no number word.

## Readings where the issue and design leave a choice

- **"Render-back"** is `deep_show`'s pixels, the render the issue reproduces and whose reply holds `visible`; the
  `render_back` call is read too where the criterion is about the picture (AC2, AC4, AC7), since a revision should draw
  the same through both. `visible` isn't asked of the `render_back` call: its reply has none at the base and no
  criterion asks for one.
- **"Visible listing the item"** accepts rows `duck` or `duck#<part>`: a glTF scene placed whole draws its nodes as the
  item's parts (the base's view3d picks the Duck as `duck#2`). Its box is the union of those rows' boxes, and view3d's
  object-ID box is the box of every pixel whose pick is `duck` or a part of it. **"Within 1 px"** is each edge.
- **"Named by one mesh.asset@1 item"** places the file's whole scene (`node: {scene: 0}`): the Duck's mesh hangs under a
  scaled parent node, which only the scene form places as the file does.
- **"Three different snapshot hashes"** is also read as none equal to the empty frame's, the base's failure the
  criterion names.
- **A Radiance file and "an all-black file of the same size"**: flat RGBE files of 64 × 32 px, one uniform radiance 1,
  one zero. Lit by it reads as the snapshot changing with the file; the box under it is there so the environment lights
  something besides the background.
- **`mesh.sequence@1`'s "asset"** is its frame file in the per-frame glTF form the base's evaluator reads
  (`params: {frames: [sha256], frame_rate}`, #419's form), one frame, since the design's `asset` form has no file format
  yet. The base registers no `mesh.sequence@1` kind, so its check skips the item with an `unknown_kind` notice; drawing
  it needs the kind registered too.
- **"A white material@1 whose maps.base_color is a red PNG"**: the document requires `material@1.1` (`requires.kinds`),
  the lowest minor that can define `maps`, since the base's material@1 is at minor 0 and lacks it and the design adds a
  field by a new minor. At the base the check then skips `maps` with a notice and draws the panel white, as the issue
  says; without the requirement the base refuses the document `unknown_field`, a validation failure, not this issue's.
  The material is unlit, so white is (1, 1, 1) and the mapped red (1, 0, 0) whatever the light.
- **"The panel's mean red"** is the mean over the middle half (each side) of its `visible` box in the 8-bit snapshot,
  each channel ÷ 255; the `render_back` snapshot is read over the same box (same camera and size).
- **The GPU layer's canonical render**: the two documents are two sessions of one `live` call, each by its own writer,
  rendered at frame 2 at 320 × 240 px.

Not tested, because no criterion asks: the app's canvas panel (`window.rs`) and the `host` call, which the Scope names
but no criterion reaches; `normal_map` and the other maps; the decoded-image cap; a file the probe can't read; a
`mesh.sequence@1` with more than one frame; view3d drawing the mapped panel (it does at the base).
