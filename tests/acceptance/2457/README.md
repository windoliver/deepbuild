# Acceptance tests for #2457: soft volumes built from mesh assets, with their skins

Written first, blind, from issue #2457 as saved for the job on November 19, 2026 (its opening paragraph, "Why it was
left out", Scope and two acceptance criteria; it has no comments, no Proof line and no Oracle line), the design's
sections it names and base commit `85203f458` ("Merge pull request #2852 …", origin/main when the job started), by a
job that never saw an implementation, a diff of one, or any other worktree, branch, stash or pull request. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file per criterion, one test per clause that needs its own run.

| File | Criterion | Tests |
|---|---|---|
| `ac1-soft-cube-asset.test.ts` | `#2457.abde2f93`: a soft volume from a closed glTF cube asset with `inflate: 1.2` builds one soft body with one particle per welded vertex, holds 1.2 × its rest volume within 2% once settled, and its skin draws each vertex at its particle's interpolated position within 1e-6 m at 20 sampled times | 3 |
| `ac2-open-asset.test.ts` | `#2457.d36df7b1`: an open asset is refused at check, naming an open edge, as a built item is | 1 |
| `helpers.ts` | the two cube assets, their scenes and worlds, the runners, the readers and the judges, over `../524/helpers.ts` and `../522/helpers.ts` (imported read only) | |
| `BASE-FAILURE.txt` | each file's run at the base, and what the base already does | |

## What was read

- The issue as saved for the job (title, state, labels and body), and its body alone for the criterion IDs, each worked
  as `scripts/proof-change.mjs`'s `criterionId` works it and found equal to the ID its tests carry. For context only,
  as saved: #524's body and its one comment (the issue this one follows) and #97's body (its parent). The job had no
  access to the issue tracker.
- `docs/canvas-primitives.md`: Time and the flick; Units and axes; World and backend `physics.world@1`; `soft@1`;
  Physics output; Checkpoint ring; Bake; Physics: behavior kit; Builder (`mesh.asset {sha256 (glTF), node}`); Asset;
  Asset: meshes. `docs/technical-design.md`: Scenes, physics and the canvas core (Physics); The physics module (World;
  Soft body and checkpoint ring; Input, occurrence, output; Bake and golden; Behavior kit); Who drafts it; Proven on
  the base; Criteria to tests; Wrong programs; Dogfooding; Tests written first. AGENTS.md and CONTRIBUTING.md.
- At the base, for surfaces only: the suites `524/` (README, `helpers.ts`, `ac6-soft-cube.test.ts`,
  `BASE-FAILURE.txt`), `522/`, `1918/` and `2009/` (helpers), `1401/` (helpers: `gltf`, `seed`, its scenario's
  `evidence`), `1935/` (its binary glTF writer), `424/` (helpers, the asset item), `2241/` and `2306/` (READMEs,
  `BASE-FAILURE.txt`, helpers' shape); `crates/deep-physics-rapier` (`main.rs`, `source.rs`, `bound.rs`, `scene.rs`,
  `soft.rs`'s builder, `runner.rs`'s `check` and `bake` replies and its issue); `crates/deep-canvas-physics`
  (`doc/soft.rs`'s volume and its refusals, `skin.rs`, `check.rs`'s codes); `crates/deep-canvas-scene3d` (`gltf.rs`'s
  reader, `geom.rs`'s weld); `crates/deep-show` (`geometry.rs`, `physics.rs`'s head); `scripts/proof-change.mjs`
  (criterion IDs); `scripts/lanes.mjs` (its `alone` list).
- The pinned backend's source in cargo's registry (rapier3d 0.36.1, the version `Cargo.lock` pins): its file names
  alone, to see that it holds soft bodies with a volume constraint. No expected value comes from it.

What the base already does, which these tests don't credit:

- `deep-physics` refuses, at `check`, a world whose soft volume's `from` names a `mesh.asset@1` item, closed or open:
  `physics.unsupported` at `soft/<ID>/from`, in a sentence that names #2457. So "is refused at check" already holds
  at the base for the wrong reason, and no test here passes on a refusal alone. Every `bake` of such a world answers
  `{"ok": false, "issues": […]}`. It reads no call field `evidence`, and no call of it reads an asset.
- It builds a soft volume from a built item (#524): `check`'s `soft` and `backend`, a bake's `particles`, and for an
  open built item an error issue `physics.open_mesh` at `soft/<ID>/from` holding `"edge": ["v{i}", "v{j}"]`.
- `deep-show` presents a scene that places a `mesh.asset@1`, reading its glTF from its scenario's `evidence` folder by
  SHA-256, and `geometry` answers the asset's vertices as its file holds them, in the file's order, with the item's
  `world` matrix. It draws a built item through a volume's skin (#524). It refuses a scene whose world builds a volume
  from an asset (`physics_refused` at `worlds/<ID>`).

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/2457 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2457/tsconfig.json     # type-check
rm -rf tests/acceptance/2457/node_modules                                       # vitest's cache
```

`--no-file-parallelism` is required: both files build `deep-physics` in the one target folder, and each copies its
binary out after its own build. The builds, each once per file, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0`
and `CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present (#2009's `cargoError`):

| File | Builds |
|---|---|
| both | `cargo build --locked --bin deep-physics`, before the file's tests |
| `ac1-soft-cube-asset.test.ts` | also `cargo build --locked -p deep-show --bin deep-show`, when its third test first needs it; a test whose earlier assertion fails builds nothing more |

Every test and every hook passes #2009's 60-minute `TIMEOUT`; a `deep-physics` process gets 55 minutes and a
`deep-show run` 30. Node built-ins and vitest only, no network. No process is started but `cargo`, `deep-physics` and
`deep-show`, each waited for; none is stopped by name or port. Evidence stores and copied binaries are temporary
folders, removed after each test or file. No cargo on the machine is `BLOCKED:` (#2009's helper), a process that can't
be started `BLOCKED:`, one that doesn't finish `INCONCLUSIVE:`; each is a failed test, never a pass. No test times
anything, so none depends on the machine or its load.

## The surface under test

The issue names the document's words (a volume `from` a mesh asset, `inflate: 1.2`, `v{i}`, `max_particles`, the skin)
and no call, call field or reply field. These tests drive what #524's suite drives, as its README's surface stands:
`deep-physics`'s `check` and `bake` on a scene's world, `check`'s `soft`, `backend` and issues, a bake's `particles`,
and `deep-show`'s `deep_show` and `geometry`. **One name is this job's choice, marked *(ours)***: the call field that
tells `deep-physics` where its scene's mesh assets are. IDs of items, worlds, soft bodies and outputs are *(ours)*
too, and nothing reads them as more than IDs. The implementer builds exactly these, or a dispute goes to a blind
redraft.

### The documents

A scene in the agent's form (#421's payload, as #524's `sceneDoc` writes it), whose item is a mesh asset and whose
world builds a soft volume from that item and skins it back:

```text
scene.items.cube          {"kind": "mesh.asset@1", "params": {"sha256": "<64 hex>", "node": 0}, "at": {"pos": [1.5, 0.5, 0.75]}}
scene.worlds.lab          a physics.world@1 document:
  .bodies.ground          {"kind": "static", "shapes": [{"shape": "plane", "contact_material": "ground"}]}
  .soft.jelly             {"shape": "volume", "from": "cube", "inflate": 1.2, "masses": {"default": 1},
                           "stretch": {"hz": 8, "damping_ratio": 0.5}, "contact_material": "jelly"}
  .outputs.skin           {"from": "jelly", "read": "particle_positions", "to": {"skin": {"item": "auto"}}}
```

| Field | Whose word |
|---|---|
| `items.<ID>`: `kind: "mesh.asset@1"`, `params.sha256`, `params.node`, `at.pos` | the design's (Builder: `mesh.asset {sha256 (glTF), node}`); the base's (#420) |
| `worlds.<ID>`, and the world's `bodies`, `contact_materials`, `shapes`, `capacity`, `checkpoint` | the base's (#1918, #2009; #524's `softWorld` writes them) |
| `soft.<ID>`: `shape: "volume"`, `from: <item ID>`, `inflate` | the issue's and the design's (`soft@1`); `from` naming a mesh asset is what the issue adds |
| `soft.<ID>`: `masses`, `stretch`, `contact_material` | the design's (`soft@1`), with #524's cube's values |
| `outputs.<ID>`: `from`, `read: "particle_positions"`, `to: {"skin": {"item": "auto"}}` | the design's (Physics output: "for a volume, its source"); the base's (#524) |
| the IDs `cube`, `shut`, `open`, `lathe`; `lab`, `closed`, `holed`, `built`; `jelly`; `skin` | *(ours)* |

`max_particles` is left out (its default, 2,048).

### `deep-physics`

| Call, as the tests write it | Reply fields the tests read |
|---|---|
| `{"call": "check", "scene": Scene, "world": "lab", "evidence": "<folder>"}` | `{"ok": true, "issues": [Issue], "soft": {"jelly": {"shape": "volume", "particles": 8, …}}, "backend": {"soft_bodies": 1, "particles": 8, …}}`; a world is admitted when no issue has `severity: "error"` |
| `{"call": "bake", "scene": Scene, "world": "lab", "evidence": "<folder>", "steps": 360}` (also 1 and 200 steps) | `{"ok": true, "particles": {"jelly": {"addresses": ["v0", … "v7"], "positions": [[[x, y, z] × 8] × 361]}}}`: `positions[k][i]` is particle `addresses[i]`'s position after k steps, index 0 the state as built. A refused world answers `{"ok": false, "issues": […]}` |

```text
Issue (criterion 2)   {"severity": "error", "code": C, "edge": ["v1", "v2"], "path", "what", …}
```

| Name | Whose |
|---|---|
| `call`, `scene`, `world`, `steps` | the base's (#1918's form of #2009's calls) |
| **`evidence`** *(ours)* | the path of an evidence store folder, the one `deep-show`'s scenario names `evidence`, laid out the same way: a file is kept at `<first 2 hex>/<other 62 hex>` of its SHA-256. A call on a scene's world reads each `mesh.asset@1` its world's volumes name from it, by the item's `params.sha256`. The tests write it on `check` and on `bake` and on no other call. The base ignores it |
| `ok`, `issues`, an issue's `severity` and `code`, `soft.<ID>.shape`, `soft.<ID>.particles`, `backend.soft_bodies`, `backend.particles`, `particles.<ID>.addresses`, `particles.<ID>.positions` | the base's (#524's README: `check`'s `soft` and `backend`, `particles`) |
| an issue's `edge`: `["v{i}", "v{j}"]`, the two welded vertices of an open edge | the base's (#524's, for a built item); here on an asset's refusal, in the asset's own welded numbering |

An issue's `code` is never spelled here: the open asset's is held equal to the one the same program gives an open
built item in the same run.

### `deep-show`

Driven unchanged, as #524's suite drives it: #393's scenario `{"evidence", "sessions", "processes", "panels", "docs",
"calls"}`, its `evidence` the folder the test seeded; `{"call": "deep_show", "session", "doc", "document": Scene,
"include": ["issues"]}`, answered `{"outcome": "presented", …}`; and #420's `{"call": "geometry", "doc", "items":
["cube"], "t": flicks}`, answered `{"items": [{"id": "cube", "positions": [[x, y, z] × 24], "world"?: [[a, b, c, d] ×
3], …}]}`. Through the row's `world` matrix (identity when absent) the positions are where each vertex is drawn in
world metres. What the issue adds: the scene above is presented, and `geometry` answers the asset's 24 vertices, in
its file's order, as its skin draws them at `t`.

## The fixtures

Both assets are glTF 2.0 binaries (Asset: meshes: "a glTF 2.0 binary, .glb"), written by `helpers.ts`'s `glb` from
vertices and triangles it holds: a 12-byte header, a JSON chunk and a binary chunk; one scene, one node (node 0) with
no transform, one mesh of one triangle primitive with f32 `POSITION` and u32 indices, no normals. Each is put in a
temporary evidence store under its SHA-256 (`seed`) and placed by a `mesh.asset@1` item with `node: 0`.

**The closed cube** (`CUBE`), 0.5 m on a side, in its file's own space from (0.25, 0, −1.5) to (0.75, 0.5, −1): not
1 m, and not at the origin. Every coordinate here is a short binary fraction, so the f32 file holds exactly these
numbers. Each face has its own four vertices, so the file holds 24 vertices for 8 corners and 12 triangles; no two
faces share a vertex in the file. Every triangle is wound counter-clockwise seen from outside (glTF's front face), so
its normal points out and the triangles enclose +0.125 m³. In the file's vertex order, face by face (x, y, z in m):

| Face | File vertices | Positions, in order | Welded vertex of each | Triangles (file indices) |
|---|---|---|---|---|
| +Y (top) | 0 … 3 | (0.25, 0.5, −1.5), (0.25, 0.5, −1), (0.75, 0.5, −1), (0.75, 0.5, −1.5) | 0, 1, 2, 3 | (0, 1, 2), (0, 2, 3) |
| −X | 4 … 7 | (0.25, 0, −1), (0.25, 0.5, −1), (0.25, 0.5, −1.5), (0.25, 0, −1.5) | 4, 1, 0, 5 | (5, 6, 7), (5, 7, 4) |
| +Z | 8 … 11 | (0.75, 0.5, −1), (0.25, 0.5, −1), (0.25, 0, −1), (0.75, 0, −1) | 2, 1, 4, 6 | (8, 9, 10), (8, 10, 11) |
| −Y (bottom) | 12 … 15 | (0.25, 0, −1), (0.25, 0, −1.5), (0.75, 0, −1.5), (0.75, 0, −1) | 4, 5, 7, 6 | (13, 14, 15), (13, 15, 12) |
| +X | 16 … 19 | (0.75, 0.5, −1.5), (0.75, 0.5, −1), (0.75, 0, −1), (0.75, 0, −1.5) | 3, 2, 6, 7 | (16, 17, 18), (16, 18, 19) |
| −Z | 20 … 23 | (0.75, 0.5, −1.5), (0.75, 0, −1.5), (0.25, 0, −1.5), (0.25, 0.5, −1.5) | 3, 7, 5, 0 | (21, 22, 23), (21, 23, 20) |

The index buffer lists the triangles last face first (−Z's two, then +X's, … +Y's last), and a face is split from its
first file vertex on +Y, +Z and +X and from its second on −X, −Y and −Z. Welded (positions equal are one vertex,
numbered in the order the file's vertices first hold each), the cube has 8 vertices, every edge on exactly two
triangles:

```text
v0 (0.25, 0.5, −1.5)   v1 (0.25, 0.5, −1)   v2 (0.75, 0.5, −1)   v3 (0.75, 0.5, −1.5)
v4 (0.25, 0, −1)       v5 (0.25, 0, −1.5)   v6 (0.75, 0, −1)     v7 (0.75, 0, −1.5)
```

That order is the top's four corners and then the bottom's, neither sorted by position nor the order the indices first
name the vertices (which starts at file vertex 21), and not the order the base's `slab@1` cube welds to (its bottom
ring first). In criterion 1's scene the item `cube` sits at `at.pos` (1.5, 0.5, 0.75) with no turn or scale, so the
cube is drawn from (1.75, 0.5, −0.75) to (2.25, 1, −0.25), its underside 0.5 m above the ground plane y = 0, and
welded vertex i is drawn at its position above plus (1.5, 0.5, 0.75).

**The open cube** (`OPEN`): the same file with its first face, the top, left out, vertices and triangles both: 20
vertices and 10 triangles, the faces −X, +Z, −Y, +X, −Z as above. It welds to 8 vertices in another order, since its
file starts at another face:

```text
v0 (0.25, 0, −1)       v1 (0.25, 0.5, −1)   v2 (0.25, 0.5, −1.5)   v3 (0.25, 0, −1.5)
v4 (0.75, 0.5, −1)     v5 (0.75, 0, −1)     v6 (0.75, 0, −1.5)     v7 (0.75, 0.5, −1.5)
```

Its open edges, each on one triangle only, are the four round the missing top: v1–v2, v1–v4, v2–v7 and v4–v7. The test
works them out from the file's own triangles over these welded vertices.

**The worlds** (#524's soft cube's, its ball left out, through #524's `softWorld`): 120 Hz, 4 substeps, gravity
(0, −9.81, 0), seed 524, a checkpoint every 60 steps; the static ground plane y = 0; one soft volume `jelly` with
`inflate: 1.2`, 1 kg a particle, stretch 8 Hz at damping ratio 0.5, contact material `jelly` (friction 0.8). Criterion
1's world `lab` also holds the skin output. Criterion 2's scene holds three items, the closed asset `shut`, the open
one `open` and #524's built open cube `lathe` (`lathe@1`, 4 segments from 45°, a 1 m square 1 m tall, its outline
through the axis at the bottom only, `caps: "none"`), and a world for a volume from each: `closed`, `holed`, `built`.
Scenes are 4 s at 50 fps.

**The sampled times** (#524's): 50 fps frames 3, 7, … 79 (0.06 s to 1.58 s; frame f is step 2.4 f), 16 between steps
and 4 on one.

## Criteria to tests, and the wrong program each fails on

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed, computed from the saved body. Each `describe` and `it` title starts with its criterion's ID. The issue
names no planted program, so each test's wrong program is the base; no clause needed a planted one, since every clause
below fails on the base and on the wrong programs listed.

- **ac1, `#2457.abde2f93`.**
  1. *Builds one soft body with one particle per welded vertex.* `check` of `lab` raises no error issue; its `soft`
     holds `jelly` alone, `shape: "volume"`, `particles: 8`; `backend.soft_bodies` is 1 and `backend.particles` 8. A
     1-step bake addresses the particles `v0` to `v7`, and as built particle `v{i}` is within 1e-6 m of the asset's
     welded vertex i where the item is drawn. Fails on the base, which refuses the world. Also fails: a particle per
     file vertex (24), a weld numbered by the index buffer or by position, particles left in the file's own space.
  2. *Holds 1.2 × its rest volume within 2% once settled.* Over a 360-step bake, at every step from 300 to 360 the
     particles enclose 0.15 m³ within 2% (0.147 to 0.153 m³), measured here over the asset's own triangles; the
     measure reads 0.125 m³ on the fixture itself, and the body as built is outside the band. Fails on the base, which
     bakes nothing. Also fails: a volume built without `inflate`, or held to 1.2 m³ rather than 1.2 × 0.125 m³.
  3. *Its skin draws each vertex at its particle's interpolated position within 1e-6 m at 20 sampled times.* Over a
     200-step bake, `geometry` of `cube` at the 20 times answers 24 vertices, vertex k within 1e-6 m of the
     interpolated position of the particle of its welded vertex. Before that: the asset alone, in a document with no
     world, is drawn as its file holds it; at each of the 20 times some particle is more than 1e-6 m from its rest
     position; and at one at least a particle's interpolated position is more than 1e-6 m from its position at both
     steps around it. Fails on the base, which bakes nothing and refuses the scene. Also fails: the asset drawn at
     rest, a held step, the 8 welded vertices drawn in place of the 24, vertices matched to the wrong particles.
- **ac2, `#2457.d36df7b1`.** One test, three checks in one process. `closed` (the closed asset) raises no error issue.
  `holed` (the open asset) raises an error issue whose `edge` is two different `v{i}` with i under 8, one of the open
  asset's four open edges. `built` (the built open cube) raises an error issue with an `edge` too, as it does at the
  base, and the open asset's issue has the same `code`. Fails on the base, which refuses the closed asset and names no
  edge for the open one. Also fails: an open asset admitted; an asset whose split vertices aren't welded (the closed
  one reads open); an edge that isn't open, or named outside the asset's welded vertices; a refusal of another kind
  than a built item's.

Test count: 3 + 1 = 4.

## Readings, where the issue and the design leave a choice

1. **"A closed glTF cube asset".** A glTF 2.0 binary, as Asset: meshes names a mesh asset, placed by `mesh.asset@1`
   with `node: 0`. The issue sizes and places nothing. *(ours)*: 0.5 m, so 1.2 × its rest volume (0.15 m³) is not
   1.2 m³; off the origin in the file and in the scene, so a particle is where the item is drawn; within 3 m of the
   origin, because a bake's positions are f32, whose spacing passes 1e-6 m at 16 m from the origin.
2. **"One particle per welded vertex", "`v{i}` in welded order".** The design's "addressed `v{i}` in the source's vertex
   order" under #524's weld: positions equal to 1e-6 m are one vertex, numbered in the order the source's vertices
   first hold each. An asset's vertex order is its file's, the order the base's `geometry` already answers them in.
   The fixture's vertices are either equal or 0.5 m apart, so no tolerance of the weld is tested. A particle and its
   welded vertex agree within that same 1e-6 m (the numbers here are exact in f32).
3. **"Builds one soft body".** `check`'s `soft` lists it alone, and the backend's own counts read one soft body of 8
   particles (#524's `backend`).
4. **"Holds 1.2 × its rest volume within 2%".** The rest volume is the cube's, 0.5³ m³. The volume held is what the
   asset's own triangles enclose with each vertex at its particle: the sum over its triangles of a · (b × c) ÷ 6,
   worked here from the bake's particles and never read from a backend (Physics: behavior kit). #524's suite measured
   its built cube another way, each face as four triangles about its centre; for an asset the mesh's triangles are the
   test's own data, and the design gives a volume "its edges the mesh's, under the balloon's volume constraint", so
   the mesh's own enclosed volume is the plainer reading. "Within 2%" is |V − 1.2 V₀| ≤ 0.02 × 1.2 V₀, as #524's.
5. **"Once settled".** #524's reading: every step from 2.5 s to 3 s. The issue doesn't say "on the ground", so where
   the cube rests isn't asserted. The world is #524's cube's, so the same reading fits; the cube starts 0.5 m up
   *(ours)*, so it is still moving through the first sampled frames of the skin's test.
6. **"Its skin".** The world's output `to: {"skin": {"item": "auto"}}`, which for a volume is its source (Physics
   output). "Each vertex" is each of the 24 the file holds, in the file's order; vertex k's particle is the one of its
   welded vertex. "Draws" is `geometry`'s positions in world metres. "Interpolated" is Physics output's: k = ⌊t ÷
   step⌋, α exact from flicks, positions lerped. "20 sampled times" are #524's frames.
7. **"An open asset".** The cube asset with one face left out. **"Refused at check"**: `check` answers with an error
   issue. **"Naming an open edge"**: #524's `edge`, two welded vertices of the asset, held to being one of its four
   open edges; which of the four is the implementer's. **"As a built item is"**: the same field in the same form, and
   the same `code` the program gives an open built item in the same run (Scope: "the same closed-mesh … refusals").
   The code isn't spelled, and its `path` and sentence aren't read.
8. **Where the assets are.** The issue says the runner has no asset store. *(ours)*: the call field `evidence`, the
   word and the layout `deep-show`'s scenario already has for the folder a `mesh.asset@1` is read from.

## For the early question

Nothing was left out of the checks: each condition the two criteria state is held above, by a value the issue states,
a closed form from the fixture, or a reading #524's suite already took for the same clause. Two readings carry more
weight than the rest, and one sentence of design each would settle them for good:

- `#2457.abde2f93`, "holds 1.2 × its rest volume": which volume is measured (reading 4). A sentence such as "a closed
  soft body's volume is what its triangles enclose with each vertex at its particle" would fix it. The two measures
  named there differ by about 1% of the rest volume on a cube of 8 particles; both sit inside the 2% band on the
  base's own build of the fixture's welded mesh (`BASE-FAILURE.txt`).
- `#2457.abde2f93`, "once settled": the issue gives no time or measure (reading 5). A sentence such as "a soft volume
  counts as settled from 2.5 s after its world starts" would fix it.

Found in the inputs, not settled here, none of it untestable: Builder says `mesh.asset {sha256 (glTF), node}` and
Asset: meshes says a mesh asset is "a glTF 2.0 binary", while the base's reader also takes a glTF as JSON; these tests
write the binary alone. The criterion's 1e-6 m is finer than an f32 position's spacing from 16 m out (1.9e-6 m there),
and a bake's positions are f32, so the criterion can hold only near the origin, where the fixture sits.

## What isn't asserted, because no criterion says so

- An asset past `max_particles` refused naming the count (Scope names it; no criterion does).
- A store that lacks the asset, bytes that don't hash to their name (Asset: `asset_missing`, `asset_mismatch`), or a
  call that leaves `evidence` out.
- A glTF as JSON, an asset of several primitives or nodes, a node with a transform, an item turned or scaled, and
  vertices that are nearly equal.
- That no rigid body or joint stands in for the volume, its `target_volume_ratio`, a dent and its return, and where
  the settled cube rests (#524's clauses, for a built cube).
- Seeks, step hashes, checkpoints, the bake key, and `evidence` on any call but `check` and `bake`.
- The refusal's code as spelled, its `path` and its sentence, and which of the open edges it names.
- The skinned asset's normals, UVs and materials, a skin naming its item by ID, and any frame a renderer draws.
- The wasm32 runner (#2466), any timing or cost, and how the work fits a source file's size ceiling.

## What the implementer adds outside this folder

One line in `scripts/lanes.mjs` (the files build cargo binaries); this README is the instruction, the implementer
makes the edit:

```js
// #2457's files build deep-physics and deep-show.
alone.push('tests/acceptance/2457/');
```

`BASE-FAILURE.txt` is each file's run at the base, with each test's result and failing assertion.
