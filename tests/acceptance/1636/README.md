# Acceptance tests for #1636: trees from a seed, a branching builder with a pipe-model taper, leaf cards, wind weights and levels by error

These tests were written before any implementation existed. The writer had issue #1636 (its summary, Scope, nine
acceptance criteria, Proof line and Oracle line), its parent #442, its oracle page (no upstream test checks any
criterion, so no `1636-oracle/` folder), the design documents and base commit `3557b3489` ("Merge pull request #2626
…"). No implementation existed, and no other worktree, branch or pull request was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, at most two tests a file, and the two planted wrong
programs the criteria name.

## What was read

- Issue #1636 and its oracle page; issue #442's body, for what the sibling parts own: scatter (#2013), measures
  (#2015), wind on the GPU (#2016), the task's earlier budgets (#2017).
- `docs/canvas-primitives.md`: Builders, recipes, looks and cameras; Object (`material`, `materials` by named part);
  Builder (the build's outputs, "a vertex count computable from params ... so an over-budget build is refused before it
  runs", at most 262,144 vertices); Builder `extrude`: sweep along a curve (rings, "never flips at an inflection", no
  Frenet frames); Curve `curve@1` (rotation-minimizing frames by double reflection, `roll`); Attribute and field, and
  Attribute and field: distribute (point attributes, "the same on every machine"); Modifier (`sway`'s `weight: height |
  attribute name`, "a stored attribute such as a wind weight"); Modifier: store; Instance `instance@1`; Variant; Level
  of detail, Level of detail: levels by error (`levels: auto`, `lod_errors`, "never emit a level whose error is lower
  than the level before"), Level of detail: proxies (`params: {ratio, error, impostor, drop: [part]}`, "made offline by
  the simplify job from the item's evaluated mesh at its content key"); Geometry audit and Geometry audit: scenes; Golden
  (a linux/amd64 container on the arm64 Mac counts as the other architecture for CPU checks).
- `docs/technical-design.md`: "Every task carries its own budgets" (five runs after warm-up, the margin, the reference
  Mac); Speed claims name their baseline (the merge base by default); How we know version 0 works (wrong programs,
  criteria to tests, dogfooding).
- `docs/parallel-proof.md`: §3 (budgets count only on a reference Mac), §7a (slow and timed files), §12a (budget
  windows; a task of `benchmarks/budgets.json` names the criteria it proves; the reading rule for "in the local
  preflight").
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-show` (`main.rs`'s scenario fields
  `threads` and `planted`, `geometry.rs`'s `estimate_only`, `timings` with `build_ms`, builder rows and the mesh's
  `to_json`, `geometry_audit.rs`'s solids per item and its `tolerance`, `support.floating`); `crates/deep-canvas`
  (`geometry_audit.rs`'s capsule solids); `crates/deep-canvas-scene3d` (`builders.rs`'s `KINDS`, `Plants`, counts and
  cap; `geom.rs`'s `Mesh`, `parts` as triangle lists, point attributes; `stack.rs`'s GPU `Sway` with stored-attribute
  weights); `crates/deep-gpu-layer` (`simplify.rs`'s call and reply, `view3d.rs`'s `counts`, `sway`, `capture`); the
  scripts `benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`), `lanes.mjs` (`alone`, `timed`),
  `proof-change.mjs` (`criterionId`), `proof-runs.mjs` (twins), `lane-x86.json`; `benchmarks/budgets.json`; and the
  suites `2016/`, `2013/`, `2015/`, `441/`, `425/`, `2017/`, `378/`, `306/`, `2010/` and `225-redraft-ac5/`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## What the base already does, which these tests don't credit

`deep-show` builds the ten trusted builders, answers `geometry` rows with their mesh, parts and point attributes,
counts a builder's vertices from its params (`estimate_only`) and times a fresh build (`timings`, `build_ms`) on the
session's pool, which the scenario's `threads` sizes (#857). The geometry audit reads builders' true shapes, capsules
among them, one solid per item. `deep-gpu`'s `simplify` gives a glTF asset levels by error (`levels: auto`,
`lod_errors`); `view3d` draws instancers and reports #2016's GPU sway positions and encode counters. There is no
`tree@1`, no branch, fork or card rows, no `wind` from a builder, no per-branch audit solids, no `simplify` on an item,
no proxy with `drop`, no draw-call counter, no `canvas-tree` task and none of the planted names below.

## Run them

Each file builds `deep-show` (`full`) and, where it draws or simplifies, `deep-gpu`, so they run one file at a time.
The implementer adds these lines to `scripts/lanes.mjs`; this README is the instruction, and this job edits nothing
outside its folder.

```js
// #1636's files each build deep-show (full) and some deep-gpu; ac1-same-hash also builds deep-show for Linux x86_64
// in a linux/amd64 container; ac8-budget judges the build budget on the reference Mac.
alone.push('tests/acceptance/1636/');
timed.push('tests/acceptance/1636/ac8-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1636 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1636/tsconfig.json
rm -rf tests/acceptance/1636/node_modules/.vite
```

- **Build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (and
  `cargo build --locked --bin deep-gpu` for AC5, AC7, AC8 and AC9), with the pinned toolchain's folder and
  `/opt/homebrew/opt/rustup/bin` first on `PATH` and `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless already
  set, copies each binary out of the target folder (honoring `CARGO_TARGET_DIR`), and fails each test whose build
  failed. `ac8-budget.test.ts` builds `deep-show` for release too, but only on a machine that can judge a timing.
- **Linux x86_64** (AC1's second test). `full` deep-show's bindgen build scripts need libclang, which the pinned
  toolchain image of `scripts/lane-x86.json` lacks, so the test builds in a local image made once from the pin:

  ```sh
  docker build --platform linux/amd64 -t deepbuild-acceptance-1636-linux:1.99.1 - <<'EOF'
  FROM rust:1.99.1-bookworm@sha256:e6f2cff35d0f309acf8433b4f05878ed77092602c5065cc81801177da0bb3a9c
  RUN apt-get update && apt-get install -y --no-install-recommends libclang-dev && rm -rf /var/lib/apt/lists/*
  EOF
  ```

  The test never pulls or builds an image. Without Docker, the pinned image or this build image (made from the pin's
  layers), it fails `BLOCKED:` with that one ask. It builds with `docker run --rm --pull never --platform linux/amd64`,
  the checkout mounted read-only, caches under `target/acceptance-1636-linux/`, `CARGO_BUILD_JOBS=2`; an emulated
  compiler that dies on a signal resumes the same build at most twice, a third crash is `BLOCKED:`. Each run is one
  `deep-show run` in the image with `--network none`, and the container must report `x86_64`.
- **Platform.** Anything the GPU draws is drawn on Metal: off macOS AC5's second test, AC8's first and AC9 fail with a
  message starting `INCONCLUSIVE:`, never passing. The build time is INCONCLUSIVE anywhere the perf lane's `judgeLimit`
  doesn't pass a reference Mac at rest (the fingerprint, mains power, Low Power Mode off, thermal state nominal, the
  load within the cores), checked before anything is timed. Every other test is CPU only.
- **Isolation.** Each test writes into its own temporary folders and deletes them. `ac9-taste.test.ts` writes into
  `docs/evidence/1636/` and keeps what it writes; AC1 keeps the Linux build's caches under the target folder. Node
  built-ins and vitest only, plus `scripts/benchmark.mjs` and `scripts/lanes.mjs` as the lane's own.

## Fixtures

All generated in `helpers.ts`; no file on disk. Metres, degrees, +Y up. Documents in the agent's form (no `id`,
`layers` or item `layer`) for `deep-show`'s `deep_show`, and as a session holds them (one writer layer `main`, camera
`cam`, `budget.class: work_product`) for `deep-gpu`; each with a camera, a sun (no shadow), a day sky and the materials
`bark`, `leaf` and `soil`. A tree is `tree@1` with `material: bark` and `materials: {leaves: leaf}`, at the origin
unless placed.

- **The fixture tree** (`FIXTURE`; AC1 to AC7, AC9): `{seed: 1636, levels: 4, length: 4, radius: 0.15, split: 3,
  angle: 40, roll: 30, gravity: 0.3, leaves: {per_twig: 6, size: 0.12}, segments: 8, rings: 8}`, `exponent` left out
  (2.0). By the topology (Assumed surfaces 2): 40 branches (1 + 3 + 9 + 27), 13 forks, 36 twigs (levels 3 and 4), 27
  tips and 216 cards.
- **AC2's second tree**: the same with `exponent: 3`, placed 20 m along +X.
- **AC4's seeds**: 20 trees of the fixture's params at seeds 1 to 20, 30 m apart along +X; the trap: seeds 1 and 2,
  both at the origin.
- **AC5's sway**: the fixture with `mod.sway@1 {amount: 0.3, weight: wind, wind: {gust: {strength: 0}}, seed: 7}`
  (hz 0.4, direction 0° and speed at their defaults), and the same with the sway `enabled: false`.
- **AC6's second tree**: the fixture with `leaves {per_twig: 3, size: 0.12}`.
- **The budget tree** (`BUDGET_TREE`; AC8): the fixture's params with `seed: 2026, split: 4, segments: 12, rings: 10`:
  85 branches, 80 twigs, 480 cards, about 85 × 12 × 9 × 2 = 18,360 tube triangles and 960 or more card triangles.
- **The forest** (AC8): an `instance@1` `forest` of 10,000 elements (ids 0 … 9,999, 100 × 100 at 4 m, yaw k × 137.5°,
  scale 1, element k of prototype k mod 8) of `variant-1` … `variant-8`, hidden `tree@1` items of the fixture's params
  at seeds 1 to 8; a straight-down orthographic camera at (198, 120, 198), `view_width` 440 m, 512 × 512, which sees
  every element.
- **The taste scenes** (AC9): each tree alone on a 40 × 40 m ground plate under a casting sun, the camera at (0, 5, 17)
  looking at (0, 4.2, 0), fov 45, in a filmic look (tone map filmic, exposure 0).

## Criteria to tests

IDs are `#1636.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the
leading `- [ ] ` dropped (`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1636.<id>`. Each file's
header states its fixture, numbers and wrong programs in full.

| ID | Criterion (short) | File (tests): what it asserts |
|---|---|---|
| AC1 `#1636.d6af27c1` | Same params and seed, same vertex hash on macOS arm64 and Linux x86_64 and with 1, 4 and 8 threads; vertex count = the bound before the build | `ac1-same-hash.test.ts` (2): (1) the fixture with the scenario's `threads` at 1, 4 and 8: each build's vertex count equals its `estimate_only` bound (`builds` 0), the tree has its 40 branches and 13 forks, and the three vertex hashes are equal. (2) On this arm64 Mac and in a linux/amd64 container (with 1, 4 and 8 threads): every hash equals the Mac's; no Docker or no image is `BLOCKED:` with one ask. Catches: the base; seeds from thread order, the clock or the process; a platform libm or an fma on one architecture; a bound without the cards |
| AC2 `#1636.92e93acb` | At every fork of a 4-level tree, parentᵉ = Σ childᵉ within 1% on the built rings; a planted equal-radius builder fails, naming the fork | `ac2-pipe-model.test.ts` (2): (1) two fixture trees, exponent 2 (default) and 3: 13 forks of 3 children each, every fork within 1%. (2) `planted: tree_child_keeps_parent_radius`: every one of the 13 forks is named by a failure. Catches: the base; the plant; a fixed child ratio; the exponent 2 whatever is declared |
| AC3 `#1636.1bc36a69` | The frame turns ≤ roll + 0.5° between consecutive rings, from the rings' first vertices; a planted curvature-frame builder flips at an inflection, naming branch and ring | `ac3-frames.test.ts` (2): (1) the fixture's 280 ring pairs all turn ≤ 30.5°, and the fixture has an inflection. (2) `planted: tree_curvature_frames`: turns past 30.5°, each failure naming `branch b<k> ring <j>`, one at an inflection of the shipped build. Catches: the base; the plant; frames held to an up vector; a twist faster than the roll |
| AC4 `#1636.da99f8e9` | Over 20 seeds, the audit on a capsule chain per branch finds no overlap past 2 mm outside 1.5 parent radii of a shared fork | `ac4-no-overlap.test.ts` (2): (1) 20 seeds in one document: the audit's row PASS with no `geometry.overlap`, and the test's own judge (the same rule on capsules from the rings) finds none in any tree. (2) The trap: two trees at one place; the judge finds `a#b0 and b#b0`, and the audit fails, naming both. Catches: the base; siblings too close or crossing branches; an audit that reads a tree as one solid or skips it; an audit that excuses every pair at a fork wherever they meet |
| AC5 `#1636.03118491` | `wind` 0 at the trunk base and 1 at the farthest tip within 1e-4; under sway (weight wind, 0.3 m) the base moves 0 m and that tip 0.3 m within 1% | `ac5-wind.test.ts` (2): (1) `wind` within 1e-4 of 0 on the trunk's first ring and of 1 on the farthest tip's last ring; all of it in [0, 1]. (2) On the GPU over one 2.5 s period at 30 fps, against the still tree: each trunk-base vertex's largest move is at most 0.003 m, each tip vertex's between 0.297 and 0.303 m. Catches: the base; wind by height, level or ring count; unnormalized wind; a sway that ignores the stored weight |
| AC6 `#1636.0863f261` | `per_twig: 6` puts exactly 6 cards per twig, each centred in its last 20%; the card count is part of the bound before the build | `ac6-leaves.test.ts` (2): (1) 216 cards, 6 on each of the 36 twigs, none elsewhere, each centre within 0.12 m of its twig's centreline at 80% to 100% of its length, no vertex shared. (2) `per_twig` 6 and 3: each `estimate_only` bound equals its build, the tubes' vertices equal, so the bounds differ by the cards' vertices. Catches: the base; cards on the tips only or on every branch; cards along the whole twig; a bound without the cards |
| AC7 `#1636.3164f1b8` | A levels chain over the fixture has strictly growing errors; `drop: [twigs]` keeps trunk and first-level radii within 5% while removing only levels 3 and up, by part | `ac7-levels.test.ts` (2): (1) `simplify` on the item with `levels: auto`: at least 3 levels, level 0 the built tree at error 0, triangles falling and errors strictly growing. (2) `simplify` with `proxy: {drop: [twigs]}`: parts keep `trunk` and `branches`, lose `twigs`; by plane cuts measured alike on both meshes, the trunk's and each level-2 branch's radius within 5% of the full build's, and each of the 36 twigs gone. Catches: the base; a level no coarser or no worse; a drop of level 2 too, or of the last level only; kept tubes thinned |
| AC8 `#1636.2d5eb798` | Budget: a 4-level tree of about 20,000 triangles builds under 20 ms on the reference Mac against the merge base; 10,000 instances of 8 variants draw one instanced draw per (variant, material) | `ac8-budget.test.ts` (2): (1) the forest's color-pass `draws`: exactly 16, one per (variant, material), each of 1,250 instances. (2) `budgets.json` holds `canvas-tree` with this ID and the numbers, valid against the merge base's file, and `lanes.mjs` times this file; the budget tree has 17,000 to 23,000 triangles and answers `build_ms`; then on a reference Mac at rest only, release deep-show, five runs after warm-up, judged by `judgeLimit` against 20 ms. Catches: the base; a draw per instance, part or level; a slow build |
| AC9 `#1636.3cc39a14` | Stills of 8 variants and a 10 s clip under sway shown; one taste call recorded, else INCONCLUSIVE | `ac9-taste.test.ts` (1): writes the stills and the clip from this run's final targets (The taste call), prints their SHA-256s, then reads `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

No `twins.json`: every test fails on the merge base at an assertion of its own (`BASE-FAILURE.txt`), and the two
planted programs are run by the tests themselves.

## Assumed surfaces

The issue and the design name the behaviours but not these calls, fields and replies; each is this job's choice, the
most natural one beside the base's own calls. The implementer provides exactly these, or disputes them.

1. **`tree@1`, a trusted builder** of scene3d, in `builders::KINDS`, so `deep_show`, `geometry` (with `estimate_only`
   and `timings`), the audit, `view3d` and `instance@1` take it as they take `lathe@1`. Params, in m and degrees, as the
   issue lists them: `seed: u32`; `levels: 1..5` (the trunk is level 1); `length: m` (the trunk's); `radius: m` (the
   trunk's at its base); `exponent: f32 = 2.0`; `split: 1..8` (children per fork); `angle: deg` (a child's turn from
   its parent's tangent at their fork); `roll: deg`; `gravity: f32`; `leaves: {per_twig: 0..64, size: m}`. And two
   this suite adds, as `tube@1` and a sweep take them, so a tree's triangles follow from its params: `segments: u16 =
   8` (the sides of every tube) and `rings: u16 = 8` (the rings along every branch). How long the branches past the
   trunk are, and how `roll`, `gravity` and the seed shape them, is the implementer's, within items 2 and 3.
2. **Topology.** The trunk rises from the item's origin along +Y, its first ring centred there. Each branch of level
   l < `levels` ends in one fork, where `split` children of level l + 1 start; a branch of level `levels` ends in a
   tip. A twig is a branch of level 3 or more ("removing only levels 3 and up"), and each twig carries `per_twig` leaf
   cards. Parts, each a list of triangle indices as the base's `parts` are: `trunk` (level 1), `branches` (level 2),
   `twigs` (levels 3 and up) and `leaves` (the cards). `material` draws the three tube parts and `materials: {leaves:
   <material ID>}` the cards (Object: `materials` by named part).
3. **Branch paths.** Each branch's tube follows a smooth curve with rotation-minimizing frames, as the issue says. So
   that AC3's planted program is judged where it flips, the fixture tree has at least one inflection: a branch whose
   curvature, taken from its ring centres, reverses between two consecutive interior rings. A builder whose branches are
   arcs bent one way by gravity alone has none; a seeded wander of each branch's heading gives some. AC3's first test
   checks this on the shipped build.
4. **A `tree@1` row of `geometry`** (deep-show, #420's call, stage final: the item's mesh after its stack, in item
   space) carries, beside the base's `positions`, `normals`, `indices`, `parts`, `attributes`, `declared`, `key` and
   `stack`:
   - `branches: [{id, level, rings: [{vertices: [index]}]}]`: every branch, `id` from `b0` (the trunk) to `b<n − 1>`;
     its rings from its base to its end, `rings` of them; each ring one vertex index per side, `segments` of them, in
     order around the ring, a seam vertex duplicated for uv listed once.
   - `forks: [{id, parent, children}]`: one per branch that ends in a fork, `id` from `f0`; `parent` that branch,
     `children` the branches that start there. The fork's rings are the parent's last ring and each child's first.
   - `cards: [{twig, vertices: [index]}]`: each leaf card, the twig it hangs on, and every vertex its triangles use; no
     vertex is shared by two cards, or by a card and a tube.
   - `attributes.wind`: `{"domain": "point", "type": "f32", "values"}`, one value per vertex: the path length from the
     root to the vertex's place over the longest root-to-tip path (the issue's words).
   - With `estimate_only` the row's `declared.vertices` is the count from the params, cards included, with `builds: 0`
     (as at the base); a built row's `positions` hold exactly that many.
5. **Threads.** The scenario's `threads` (the base's own pool size, #857) sizes the pool a build runs on; `geometry`
   with `timings: true` builds the row afresh on that pool, as the base does for builders, and adds `build_ms`, the
   build's own time in ms on a monotonic clock.
6. **The audit** (#405's `geometry.audit`, scene scope, a requirement of a claim judged by `verdict`, with
   `tolerance.sunk` its overlap tolerance and `support.floating` as at the base): a tree item enters as one solid per
   branch, `<item>#<branch id>`, its capsule chain: a capsule between each two consecutive rings' centres (the mean of a
   ring's vertices), its radius the larger of the two rings' radii (the mean distance of a ring's vertices from its
   centre). Leaf cards are no solid. Two capsules of two solids overlap when their depth (the sum of their radii less
   the distance between their segments) passes `sunk`; the overlap is excused only when the two branches share a fork
   (two of its children, or its parent and one of them) and the midpoint of the segments' closest points lies within
   1.5 × the parent's radius at the fork (its last ring's) of the fork's point (that ring's centre). An overlap not
   excused is a `geometry.overlap` issue whose `ids` are the two solids. A tree item named in `support.floating`
   declares each of its solids floating.
7. **`simplify` on an item** (deep-gpu, #425's call): `{"call": "simplify", "doc": <session document path>, "item":
   <ID>, …}` in place of `asset` and `node` simplifies the item's evaluated mesh at t = 0 (its builder's mesh through
   its stack, in item space).
   - With `levels` (`auto`, or a list) it answers as at the base: `{sha256, levels: [{triangles}], lod_errors,
     measured_m}`, `levels[0]` the item's mesh at error 0.
   - With `proxy: {drop: [part], ratio?, error?}` (Level of detail: proxies' band params) in place of `levels`, it makes
     one proxy: the named parts' triangles gone and the rest simplified by `ratio` and `error` (when left out, by the
     implementer's defaults). It answers `{sha256, triangles, parts: [the names of the parts kept]}` and writes the
     proxy under `out` as `<sha256>.gltf`: a JSON glTF whose first mesh's first primitive is the proxy's triangles,
     POSITION a float vec3 accessor in the item's metres, indices unsigned int, short or byte, buffers inline as base64
     data URIs.
8. **`view3d`'s `counts` gains `draws`** (deep-gpu, #378's call): with `counts: true` each frame carries `draws:
   [{pass, of, mesh, material, instances}]`, one row per draw call the frame issues: `pass` (`color` for the main
   view's color pass), `of` (the item it draws for: the instancer, for its elements), `mesh` (the item whose mesh it
   draws: the prototype, for an instancer's elements), `material` (its material's ID) and `instances` (how many
   instances that one call draws).
9. **#2016's `sway` report** (`view3d` with `sway: [ID]`) lists a tree item's `positions` in the order its `geometry`
   row lists its vertices.
10. **Planted programs**, each reachable only through deep-show's scenario `planted` (the name added to scene3d's
    `PLANTED` and `Plants`, as #420's and #441's are); an unknown name is refused (`ok: false`) at the base.

    | Name | The wrong program | Criterion |
    |---|---|---|
    | `tree_child_keeps_parent_radius` | At every fork each child's first ring takes the parent's radius at the fork (its last ring's) in place of the pipe model's; everything else as shipped | AC2 `#1636.92e93acb` (issue-named: "a planted builder that gives each child its parent's radius") |
    | `tree_curvature_frames` | Every ring of every branch is set in the branch's curvature frame (its first axis along the curvature, its second the tangent × that) in place of the rotation-minimizing frame; ring centres, radii and everything else as shipped, so the frame turns by about 180° across an inflection | AC3 `#1636.1bc36a69` (issue-named: "a planted builder using curvature frames") |

11. **`benchmarks/budgets.json` gains the task `canvas-tree`**: `{"id": "canvas-tree", "command": ["node",
    "benchmarks/canvas.mjs", "tree"], "margin": 0.5, "limits": {}, "targets": {"tree_build_ms": 20,
    "forest_draws_per_variant_material": 1}, "initialReason": "<why, naming #1636>", "criteria": ["#1636.2d5eb798"]}`,
    which the lane's `validateBudgets` accepts against the merge base's file. `canvas.mjs tree` measures this suite's
    budget tree on a release build and the forest's draws, and `canvas.mjs judge` holds the targets, the time on a
    reference Mac and the count on any machine, as the other canvas tasks do; what the mode prints is the implementer's.
12. **`scripts/lanes.mjs`** gains the two lines under Run them.
13. **The taste call** is recorded in `tests/acceptance/1636/TASTE.json`, the one file anyone adds to this folder after
    this commit, and only to record the owner's answer: `{"issue": 1636, "criterion": "#1636.3cc39a14", "verdict":
    "looks_right" | "looks_wrong", "who", "when": ISO 8601, "screenshots": {name → sha256 for the eight stills and the
    clip}, "note"?}`.

## Readings where the issue leaves a choice

### Criterion 1

- **"The same vertex hash"** is the test's SHA-256 over the build's positions and normals (x, y, z as little-endian
  f64, as the reply's JSON numbers read back) and its indices (u32), in order. Two builds that differ in one bit of one
  coordinate differ; the report names the first differing vertex.
- **"Linux x86_64"** is a linux/amd64 container on this arm64 Mac (Golden), built from this checkout and run in the
  same test, never a digest recorded earlier. **"With 1, 4 and 8 threads"** is the scenario's `threads`, on both
  machines.
- **"The bound computed before the build"** is the `estimate_only` row's `declared.vertices`, with nothing built.

### Criterion 2

- **"The parent's ring radius"** is the parent's last ring, at the fork; **"its children's"** each child's first ring.
  A ring's radius is the mean distance of its vertices from their mean, measured on the built positions, never a
  reported radius. **"Within 1%"** is |Rᵉ − Σ rᵢᵉ| ≤ 0.01 × Rᵉ.
- **"For the declared exponent"**: the default (2.0, left out) and 3, so a builder that ignores `exponent` fails.

### Criterion 3

- **"The frame turns between consecutive rings ... measured from the rings' first vertices"**: ring k's first vertex,
  less its centre and taken into its plane (its normal by Newell's method over its vertices, turned along the branch),
  carried to ring k + 1's plane by the least rotation between the two normals, against ring k + 1's first vertex taken
  the same way; the turn is the signed angle about ring k + 1's normal. A rotation-minimizing frame reads about 0 here
  whatever the branch's bend (a double reflection differs from the least rotation by far less than 0.5°), so the
  bound, the fixture's roll 30° + 0.5°, is met whatever `roll` means to the builder: a turn of the children about their
  parent, or a twist along the branch of at most `roll` a ring.
- **"Flips at an inflection"**: a curvature frame turns by about 180° where the curvature reverses. The test finds the
  inflections on the shipped build (the curvature vector, from the ring centres, at two consecutive interior rings
  pointing more than 90° apart) and requires a planted failure on that branch within one ring of one.
- **Naming**: each failure reads `branch b<k> ring <j>`, the ring the frame turned into.

### Criterion 4

- **"Over 20 seeds"**: seeds 1 to 20, the fixture's other params, in one document and one audit.
- **"The geometry audit on a capsule chain per branch"** and **"outside 1.5 parent radii of their shared fork"** are
  read as Assumed surfaces 6 states them. The test's own judge applies the same rule to the capsules it measures from the
  rings, so a lax audit can't pass the geometry and a right one agrees with it. The trap shows the audit reads branch
  solids and reports them.

### Criterion 5

- **"The trunk base"** is the trunk's first ring; **"the farthest tip"** the end of the tip whose root-to-tip path is
  longest. The test measures path length along the ring centres, which the builder's curves may differ from by a
  little, so of the tips within 0.5% of the longest it judges the one whose last ring reads the most wind; a wind by
  height or by count puts its 1 elsewhere and fails.
- **"Under `sway {weight: wind, amount: 0.3 m}`"**: the base's GPU sway moves a vertex by amount × weight × ((1 −
  strength) sin(2π hz t + phase) + strength × gust). The gusts' strength is set to 0, so the full lean, amount ×
  weight, is reached once a period; the test reads the largest move over one period (2.5 s at the default 0.4 Hz) at
  30 fps, at most 0.1% short of the peak. **"Within 1%"** is 1% of the amount: the base at most 0.003 m, the tip
  0.297 to 0.303 m.

### Criterion 6

- **"A twig"** is a branch of level 3 or more, as the `twigs` part is ("removing only levels 3 and up").
- **"Centred in its twig's last 20% of length"**: the card's centre (the mean of its vertices) lies within the card's
  `size` of its twig's centreline (the polyline through the ring centres), at 80% to 100% of its length along it,
  with 0.5% of the length allowed for the polyline against the builder's curve.
- **"The card count is part of the bound"**: the bound equals the build with 6 cards a twig and with 3, and the tubes'
  vertices are the same in both, so the bounds differ by exactly the cards'.

### Criterion 7

- **"A levels chain"** is the simplify job's `levels: auto` on the tree item; **"strictly growing errors"** is each
  `lod_errors` entry above the one before, with each level's triangles fewer.
- **"Keeps the trunk and first-level radii within 5%"**: the first level is level 2, the first branch level. Each
  branch's radius is measured by a plane cut, the same on the full build and on the proxy: the plane between the two
  rings at its middle, normal along the branch, and the farthest crossing of either mesh's triangles within twice the
  wider ring's radius of the branch's centre there. So tessellation and simplification cancel, and the proxy's must be
  the full build's within 5%.
- **"Removing only levels 3 and up, by part"**: the proxy's parts lose `twigs` and keep `trunk` and `branches`, and at
  each twig's cut (30% of its rings, clear of its cards) the proxy has no triangle within twice its radius. The leaf
  cards are no level; whether they stay is not judged.

### Criterion 8

- **"Against the merge base"** is the perf lane's and the budget window's (`docs/parallel-proof.md` §12a and its
  reading rule for "in the local preflight"): the task `canvas-tree` names this criterion, the lane's validator accepts
  it against the merge base's `budgets.json`, and the lane and the window compare its p50 with the merge base at its
  50% margin. The test judges the issue's own number, 20 ms, five runs after warm-up, by the lane's `judgeLimit`.
- **"Builds in under 20 ms"** is `build_ms` on a release `deep-show`, each run a fresh process: the builder's time, its
  count included, with no stack. **"About 20,000 triangles"** is 17,000 to 23,000.
- **"One instanced draw per (variant, material)"** is counted, not timed, in the main view's color pass, on one frame
  that sees every element: the forest's draws are exactly one per prototype and material, 16, each of 1,250 instances.
  It needs no reference Mac, only the Metal device.

### Criterion 9

- **The pictures**: `variant-1.png` … `variant-8.png` and `sway-10s.apng` (TASTE.json's names), each the renderer's
  final target re-encoded without filtering at zlib level 9, so the same pixels give the same SHA-256.

## The taste call

`ac9-taste.test.ts` writes to `docs/evidence/1636/` and prints the SHA-256s. The implementer attaches them to the PR,
shows them in the session, and records the owner's answer in `TASTE.json` (Assumed surfaces 13). The pictures are
evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, so none is tested: the refusal at check of a tree past 262,144 vertices, naming the bound
(Scope only); `gravity`'s and `roll`'s own shapes; uv, normals' smoothness and the bark or leaf looks; a tree's true
shape anywhere but the audit; `wind` along a path past its two ends; sway's gusts on a tree; variants as a document's
`variants` sets; a proxy drawn by `lod` bands in a view, impostors and collection proxies; levels by error drawn in a
view; memory, p95 and the forest's GPU time; growth over time, space colonization and textures (the issue's "not in
this task"). The Proof line's order (the planted builders failing first, then the measures, the hashes and the budget)
is the implementer's to show in the PR.

## What the implementer adds outside this folder

- The two `scripts/lanes.mjs` lines under Run them.
- The `canvas-tree` task in `benchmarks/budgets.json`, and its `tree` mode and judge in `benchmarks/canvas.mjs`.
- In scene3d and `deep-show`: `tree@1`, its row fields, its audit solids, and the two planted names.
- In `deep-gpu`: `simplify` on an item with `levels` and `proxy`, and `counts`' `draws`.
- The Linux build image, once, by the command under Run them.
- After the owner's taste call: `TASTE.json`, and the pictures attached to the PR.
