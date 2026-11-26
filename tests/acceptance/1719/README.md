# Acceptance tests for #1719: a 3D render-back ignores the document's look

Written first, from issue #1719 (its report, its scope, its eight acceptance criteria and its proof line), the design
sections it links and those they lean on, and the base commit `c8d9684f0` ("Merge pull request #3268 …"), by a job that
never saw an implementation; none existed in the tree. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, and the one
planted program AC2 names, inside its test.

## What was read

- Issue #1719, live; the bodies of its dependencies #417, #418 and #421; #1724, which it blocks, and #1722, the sibling
  whose render-back it draws through.
- `docs/canvas-primitives.md`: Render-back; Look `look@1` (roles, `basis`, `tone_map`, `exposure`, `finish`) and its rows
  tone mapping and samples ("Export and render-back render all N; live classes draw one"); Determinism class ("Exact
  excludes: every f32 operation", "a target the GPU rasterized … is same machine"); GPU operators' fields
  (`gpu.pass@1`: `outputs`, `blend`, `determinism`); Particles `particles@1`; Light and the light policy; Marks in 3D;
  the perceptual oracle; Document envelope (`look: {asset}`, `assets`).
- `docs/technical-design.md`: Render-back; How we know version 0 works (Criteria to tests, Wrong programs, the edit
  guard); Dogfooding; Tests written first. AGENTS.md, Proof.
- At the base, to learn the surfaces and to check that each fixture is one a right program can pass, never for an
  expected value: `crates/deep-show/src` (`hub.rs` `draw3d`, `look_of`, `look_def_of`, `deep_show` and `present`,
  `over3d.rs`, `probe.rs`, `ask.rs` `render_back`, `scene3d.rs`, `main.rs` the scenario's `planted` and `docs`),
  `crates/deep-play/src/scene.rs`, `crates/deep-canvas-scene3d/src/look.rs`, `crates/deep-canvas-marks/src/look.rs`
  (`resolve_in`), `crates/deep-canvas-effects/src` (`check`, `module.rs`), `crates/deep-gpu-layer/src` (`view3d.rs` and
  `view3d/parse.rs`, `effects.rs` `settings`, `golden.rs`), `crates/deep-gpu/src/guard.rs`, `packs/examples/`,
  `scripts/proof-change.mjs` (`criterionId`); and the suites `1722` and `1729` (the harness copied here), `1399`
  (`decide` and `golden`), `173`, `380`, `420`, `429`, `1561` and `2516`.

## The base

Measured on macOS's Metal device at `c8d9684f0` by `BASE-FAILURE.txt`'s run and by scratch probes, since removed:

- **AC1.** The red box document is presented with no issue, `visible` listing the box; its snapshot and its render-back
  are one color, #ffffff, on 100.00% of 64,000 pixels (the issue read 99.99% in its own document).
- **AC2.** Render-back of the castle is 38.5% #ffffff; against view3d's frame it reads FLIP mean 0.5321, worst window
  0.9695. Its light isn't all that is off (see "What AC2 asks beyond the look").
- **AC3.** Both looks draw one pixel hash, `991330f3…`.
- **AC4.** Presenting the document whose look the store lacks, and rendering back a stored one, answer `presented`, no
  issue and a snapshot.
- **AC5.** The small box's snapshot is 99.26% #f2f0ea and its reply has no `notices`; the castle's has none either.
- **AC6.** With and without the emitter: one pixel hash, `2de0ecd2…`. (Its reply also carries the notice `unknown_kind`
  for `sparks`: the base's check has no entry for `particles@1`.)
- **AC7.** The slab's mean luma is 0.7575 on both sides of the box.
- **AC8.** The box's mean red is 0.0790 with and without each pass.
- `planted: "render_back_drops_look"` answers `{"ok": false, "code": "bad_input"}`, the base's answer to a name it
  doesn't know; AC2 stops at its first assertion before it reaches the plant.

### What view3d draws

Each threshold is one that view3d's own frame of the same document, in the same look, meets at the base, so a
render-back that draws as view3d does passes (`view3d`: `frames: 1`, `targets: ["final"]`, its default class; its
`class: "render_back"` frames meet every threshold too):

| Test | Criterion | The base's render-back | view3d's frame |
|---|---|---|---|
| AC1 | one color at most 60%; red − green at least 0.2 | 100.00%; 0.000 | 33.39%; 0.836 − 0.338 = 0.498 |
| AC2 | FLIP mean at most 0.01, worst window at most 0.05 | 0.5321, 0.9695 | 0, 0 (its own frame) |
| AC3 | two pixel hashes | one, `991330f3…` | two, `17182b41…` (filmic), `4f0e00ac…` (neutral) |
| AC5 | one color at least 98% | 99.26%, pixel for pixel view3d's frame | 99.26% |
| AC6 | two pixel hashes | one, `2de0ecd2…` | `2de0ecd2…` without (the base's own pixels), `e5737bfa…` with: 3,438 pixels differ |
| AC7 | sunlit − shadow at least 0.1 | 0.7575 − 0.7575 = 0 | 0.7575 − 0.5001 = 0.257 |
| AC8 | red at least 0.3 above | 0.0790 against 0.0790 | 0.7961 (`declared`) and 0.8051 (`tint`) against 0.0790 |

In `plain-look@1` the base's render-back already draws AC5's, AC6's (without the emitter) and AC8's (without a pass)
documents with view3d's pixel hash, so what those tests measure is the post stage, not the look.

### What AC2 asks beyond the look

- **The castle's recipes.** At the base deep-show's 3D frame, presented or rendered back, leaves out every item the
  castle's eleven recipe instances expand to (both islands, five towers, the keep, both lamps and the cloud bank): the
  reply's `expansions` hold them, its `visible` lists only the walls, the gate and the windows, 27 rows, and the picture
  holds none of them. view3d lowers the document (`packs`) and draws them. So a render-back that only takes the look still
  fails AC2; "its packs installed" and "the same document" ask for the expansion too.
- **castle-dusk isn't resolved on the 2D path.** The scope says the look is "resolved as the 2D path resolves it and as
  `view3d` reads it". `look::resolve_in` refuses `castle.look.json`: on its near-black ground its status colors leave
  no label at 4.5:1 (3.14 to 3.20), so `Hub::look_of` answers `None`, and at the base a document in castle-dusk draws
  in the shipped look's roles (the ground #ffffff, the role `warm` unresolved). AC1, AC2 and AC5 need it drawn, and
  the scope's reasons to refuse a look (its asset missing, not a `look@1`, an unbundled font) aren't this one. These
  tests take it that `castle-dusk@1` is drawn, as `Look3::read` reads it.
- With the castle's expansion written out as items and its lights scaled to unit exposure, in a look the base can draw,
  the base's render-back at 1280 × 800 is view3d's default-class frame pixel for pixel (0 of 1,024,000 differ; FLIP 0),
  so the frame and light paths are the same ones, and the threshold is reachable. Against `class: "render_back"`
  (the look's 16 export samples) it reads FLIP mean 0.0016, worst window 0.0878: one sample against sixteen.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1719 --no-file-parallelism --testTimeout=1200000 --hookTimeout=3600000 --silent=false
node node_modules/typescript/bin/tsc -p tests/acceptance/1719/tsconfig.json
```

`PATH` only needs the line when cargo isn't on it already. Each file first builds `deep-show` and `deep-gpu` once
(`cargo build --locked --bin deep-show --bin deep-gpu`, in its own hook with a one-hour timeout), clones them out of
`target/debug` and fails each test if the build failed. Each test writes into its own temporary folder (the evidence
store, deep-gpu's output, the golden store) and deletes it. Nothing is gated on power or load, no test asserts a time,
no test uses the network. A run with `--root` may leave Vitest's cache in `tests/acceptance/1719/node_modules/.vite`;
delete it. Tests print the issue's Proof as lines starting `PROOF #1719`: the snapshots' shares, the two looks' hashes,
the castle's comparison and its planted twin's, and each post-stage reading.

At the base the three files took 35 s to 242 s with both binaries already built, at a 1-minute load of 108 to 212 on 18
cores; a cold build of both took about an hour at a load of 150 to 390.

## Legs that read BLOCKED or INCONCLUSIVE

- Off macOS every test fails with `INCONCLUSIVE: a 3D revision renders back on macOS's Metal device` before it runs
  anything, and a reply that says this machine can't draw (`unsupported_platform`, `gpu_unavailable`, `no_device`)
  fails with the same word; neither ever passes.
- None reads BLOCKED. In AC2 the golden comparison's own BLOCKED (the blank guard on a blank frame) is a failure there.

## What the implementer adds outside this folder

- The planted program `render_back_drops_look` in `crates/deep-show` (a name `planted` maps to, under whatever build
  feature the repo's plant rules ask for), so AC2's second half can run.
- No `scripts/lanes.mjs` line: this folder's own `lane.json` runs it alone (`shared: the GPU`), and lands with the
  suite unsigned (technical design: the edit guard).

## The surface under test

`deep-show run` (#393's stand-in for the hub's canvas side) and `deep-gpu run` (#377, #380), both as they are at the
base; nothing is added to either but AC2's planted name and the notice AC5 names.

- **Presenting** *(chosen)*: `{"call": "deep_show", "session", "doc", "document", "t": "0s", "size", "include":
  ["issues", "pixels"]}`, the agent's whole document; it makes rev 1, and its first snapshot is judged. AC2's and AC5's
  castle runs take `packs: [{"id": "deepbuild/composites", "dir": "packs/composites-1.0.0"}]` in the scenario.
- **Render-back** *(chosen)*: `{"call": "render_back", "session", "doc", "t", "rev", "size"}` in the same run, the call
  `deep-show run` takes for a `deep_show` with no document and no patch (#1722); `t` in flicks.
- **A document's look**: `look: {asset: "castle-dusk@1"}` with `assets: {"castle-dusk": {sha256, license}}`, the look's
  bytes in the evidence store by that hash (AC4: a hash no store holds).
- **A snapshot** is read from the evidence store at `<first 2 hex>/<other 62 hex>` of its `sha256`, checked to hash to
  its name and decoded as an 8-bit RGB or RGBA PNG of its `w` × `h`.
- **view3d options** for AC2: `frames: 1`, `targets: ["final"]`, `capture: [0]`, the document as sent, the look's own
  JSON, `size: [1280, 800]` (the castle's), `packs` as above, drawn twice: with no `class` (the one the goldens' own
  view3d snapshot takes) and with `class: "render_back"`. Nothing else: no surface scale, history, selection or
  window. At t = 0 nothing has played, so no seek or clock enters.
- **The comparison** for AC2: `decide` (`via: "you"`) blesses view3d's frame as a golden in a throwaway store, then
  `golden` compares the snapshot's PNG under the same fingerprint. Its verdict must be PASS and its `flip_mean` and
  `flip_worst_window` at most 0.01 and 0.05, which this suite holds too, so a looser oracle can't pass it.

### Planted program

Reachable only through the scenario's `planted`; at the base it is an unknown name, which `deep-show run` answers
`{"ok": false, "code": "bad_input"}`.

| `planted` | The wrong program | Test, and what its failure must name |
|---|---|---|
| `render_back_drops_look` *(chosen)* | A render-back that ignores the document's look and draws in the session's roles with no tone map at unit exposure, as the base does | AC2: its judge fails on the planted `render_back`, naming the look `castle-dusk`, on FLIP (a verdict FAIL, not BLOCKED or no snapshot) against each of view3d's frames |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`criterionId` in `scripts/proof-change.mjs`), checked against the live issue. Each test's name starts with
`AC<n> #1719.<id>`. Each file's header holds the criterion's text.

| ID | File | What it asserts, on presenting's reply and on render_back's, each |
|---|---|---|
| AC1 `#1719.7d3b0d01` | `look.test.ts` | The red box document in `castle-dusk@1` (castle.look.json, 320 × 200): no color over 60% of the snapshot's pixels, and the mean red over the `visible` box of `box` at least 0.2 above its mean green. The failure names the share and the color |
| AC2 `#1719.57f3f19b` | `castle.test.ts` | The castle in `castle-dusk@1` at 0 s and 1280 × 800, its packs installed, presented and rendered back: each matches view3d's final frame (Readings) by the goldens' comparison. Then under `planted`, the planted render_back fails it, naming `castle-dusk`, with verdict FAIL against both of view3d's frames |
| AC3 `#1719.a8f28cf0` | `look.test.ts` | The red box in `tone-filmic@1` and in `tone-neutral@1` (one look but for its ID and its tone map, both in `assets` of both documents): two pixel hashes |
| AC4 `#1719.da234c2b` | `look.test.ts` | The document whose look asset the store doesn't hold, presented (and, as a stored document, rendered back at revision 0): the reply carries an issue whose path is `look/asset`, and no snapshot |
| AC5 `#1719.60109185` | `look.test.ts` | A small box far off, its snapshot over 98% one color: the reply holds a `snapshot_blank` with that share in it. The clean castle (as AC2's, unplanted): no `snapshot_blank` anywhere in its reply |
| AC6 `#1719.ce14bb8d` | `post.test.ts` | A dark slab, with and without one `particles@1` emitter `sparks` (count 2,000), both at 1 s: different pixel hashes. The failure names `sparks` |
| AC7 `#1719.32afa26e` | `post.test.ts` | A painted box on a painted slab, no `material@1`, under `sun` with `shadow: true`: the slab's mean luma on the box's shadow side at least 0.1 below its sunlit side. The failure names `sun` |
| AC8 `#1719.15766d54` | `post.test.ts` | A one-box document with and without a `gpu.pass@1` that adds 0.6 to red, for each of two such passes (Readings): the mean red over the box's `visible` box at least 0.3 above. The failure names the pass |

### Wrong programs

- **The merge base** fails all eight, each at its criterion's own assertion (`BASE-FAILURE.txt`).
- **AC2's plant** fails AC2, which is AC2's own second half.
- By construction AC1 also fails a render-back that draws a blank, dark or clipped frame, or a box its box doesn't
  match; AC2 one that takes the look's tone map and exposure but drops its bloom (view3d's frame with and without it
  are FLIP mean 0.019, worst window 0.17 apart), or leaves the recipes out; AC3 one that takes a look's exposure but
  not its tone map; AC4 a silent fallback, and a refusal that names no path; AC5 a guard that fires on every frame or
  on none, or a share of some other measure; AC6 a render-back that skips the emitter; AC7 a render-back whose renderer is asked for no shadow map; AC8 one whose frame runs no
  operator of the document's.

## The fixtures

All generated in the test files and `helpers.ts`, but for `packs/examples/castle.json` and `castle.look.json`, read as
committed. One agent session, `sess-alpha` (thread `thread-alpha`); each document is presented whole in a fresh panel.

- **The red box** (AC1, AC3; 320 × 200, the issue's 64,000 pixels): `cam` (perspective, 34°), a 3,000 lx `light.sun@1`
  `sun` with `shadow: true`, a red `material@1` (base color 0.8, 0.05, 0.05) on `box` (1.6 m `mark.box@1` on the
  floor), a grey one on `floor` (a 40 m `slab@1`), which fills the frame. Lit in castle-dusk it is a red box on a grey
  floor, 33% its most common color.
- **`tone-filmic@1` and `tone-neutral@1`** (AC3): the suite's own look in the physical basis at EV100 9, alike but for
  ID and `tone_map`.
- **The lost look** (AC4): `look: {asset: "lost-look@1"}` with an asset hash no store holds; one painted box, 320 × 240.
- **The small box** (AC5; 320 × 240): a 1 m painted box 20 m from the camera in `plain-look@1`, whose light ground
  covers 99.26% of the frame (so neither the 0.98 the criterion sets nor 1, the share of a frame with nothing on it,
  reads as its share).
- **`plain-look@1`** (AC5 to AC8): the suite's own look: light ground (its status colors keep 3:1 and a 4.5:1 label on
  it, so the 2D path resolves it too), drawing basis, no tone map, unit exposure, no bloom, no deband, no ground grid.
- **The particles** (AC6): a dark painted `slab@1`, 5 × 4 m, upright 1 m behind the origin, and `sparks` at the origin,
  a `particles@1` of count 2,000 at 2,000 a second on a sphere, ballistic, size 3 px, dots in `sand` fading to
  `accent`; judged at 1 s, when all 2,000 live.
- **The shadow** (AC7): looking straight down, a 1.6 m painted box on a painted 10 m slab; the sun, from −x at 45°,
  throws the box's shadow 64 px to its right. The slab's strips judged are 24 px wide, 4 px off the box.
- **The passes** (AC8): a 2.4 m painted box in `coal` at 320 × 240, with one `gpu.pass@1` in its effects chain at full
  resolution: `declared` and `tint` (Readings).

## Readings where the issue leaves a choice

- **"Renders back", "a 3D snapshot"** are both of the replies a revision's snapshot comes back on: presenting's
  (`deep_show` with its document and its pixels, which the issue's own measurements read) and `render_back`'s (the
  call with no document; #1722, "drawn as presenting draws it"). A fix to one is not a fix to the other.
- **"A document naming a look"** names it in the design's envelope form (The surface under test). The castle's file has
  neither field, so AC2 and AC5 send it with them added, and view3d gets the same JSON with the look's own JSON beside.
- **"`deep-gpu view3d`'s final frame"** (AC2): view3d draws a frame in one of two classes, its default and
  `render_back`, and they differ by the look's sample count, 1 against 16 (worst window 0.054 apart on the castle,
  past the limit). The criterion names neither, so a snapshot that matches either one passes. The base's render-back
  draws one sample (it is pixel for pixel view3d's default frame on the lowered castle, above), and the design's
  Look: samples says export and render-back render all N, so a right render-back could be either; a snapshot that
  draws in some other look is neither.
- **"Matching" a color** (AC1, AC5): an exact (R, G, B) match, alpha ignored; the share is its count over the frame's.
- **"Its sunlit side" and "its shadow side"** (AC7): the strips beside the box on the side the sun comes from and the
  side it throws the shadow, by the fixture's geometry.
- **"Declared exact"** (AC8). The design's Determinism class refuses the criterion read plainly: a pass that reads the
  frame's color reads a target the GPU rasterized and adds floats, so it computes as same machine, and the base's check
  refuses `determinism: exact` on it, `not_exact` (checked on presenting, whichever way it reads the target). The one
  `gpu.pass@1` the check lets a document declare exact that adds red is a constant whose output is declared
  `blend: add`, so the test draws it as `declared`; and as `tint`, #429's pass, which reads the frame's color and adds
  0.6 red, with its class left to compute (`same_machine`), as "adds 0.6 to red" most plainly says. Both must reach
  the frame. view3d draws both (0.7961 and 0.8051); it draws `declared`'s `blend` as replace, so its frame is all
  red, and a render-back that does as view3d does, or that applies the blend, passes either way.
- **"Answered with an issue at `look/asset`"** (AC4): an object in the reply with `path` `look/asset` and a `code`
  (the base's presenting issues; its `render_back` refusals are `{code, path}` themselves). The code isn't fixed; the
  base's `asset_missing` is the expected name. **"No snapshot drawn in another look"** is no snapshot in the reply
  at all. The `render_back` half is of a document stored at revision 0, since presenting one may make no revision.
- **"Carries a `snapshot_blank` notice with that share"** (AC5): an object with `code` `snapshot_blank` anywhere in the
  reply, with a number within 0.005 of the share, as a fraction or a percentage. Expected shape *(chosen)*: an entry of
  the reply's `notices`, `{code: "snapshot_blank", severity: "notice", ids: [], path: "snapshots/0", actual: {measure,
  share}, what}`, the base's notice form; nothing here fixes where it sits or what it names beyond the code and the
  share.
- **AC2's planted program** drops the document's look from render_back; presenting isn't required to be planted, so
  only the planted render_back is judged.

## Not tested, because no criterion asks

The dark frame's notice (the scope's blank guard); that a look whose asset isn't a `look@1` or names an unbundled font
is an issue; the fallback to the session's roles when a document names none; the app's canvas panel; render-back of an
earlier revision in its own look; the look's light, finish or ground beyond what the castle's frame shows; a contact
sheet's and a diagnostic mode's looks; a seeked particle's or an operator's determinism.

## Files

- `look.test.ts` (AC1, AC3, AC4, AC5), `castle.test.ts` (AC2), `post.test.ts` (AC6 to AC8).
- `helpers.ts`: the builds, the two runners, the evidence store, the looks and documents, the PNG reader and the
  measures.
- `tsconfig.json`: the root's options for these files, as #1722's.
- `lane.json`: runs the folder alone (`shared: the GPU`).
- `BASE-FAILURE.txt`: the run at the base, home folders written as `~`.
