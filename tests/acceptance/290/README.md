# Acceptance tests for #290: Hidden view — an item drawn only where nearer surfaces hide it, at an opacity, per copy

Written first, blind, from issue #290 (its Scope, its Fields, its eight acceptance criteria, its Proof line and its
Oracle line, as saved on 2026-11-20; it has no comments), the design sections it links and those they lean on, and the
base commit `16c400dcf` (main at `8fcfcb677` with the branch of #552 merged in), by a job that never saw an
implementation. No other worktree, branch, pull request, stash or plan was read, nothing was fetched, and nothing
outside those inputs was needed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the six planted twins the
criteria name. The issue's Oracle line says no upstream test checks these criteria, so there is no oracle lane and
nothing was ported; the page it links is in another repository and wasn't read.

## What was read

- The issue, from `issue-290.md` and `issue-290-body.md` (the body byte for byte; the criteria's IDs are computed from
  it with `criterionId`'s rule in `scripts/proof-change.mjs`).
- `docs/canvas-primitives.md`: Object; Object: see-through order; Object: hidden view; Net: this copy's player; Driver;
  the closed function list; Channel and key; Instance `instance@1`; Mark set: logic columns; the status-color rule;
  Status binding; Status guard; Place in the frame (the order of passes); Control: point. `docs/technical-design.md`:
  The net module (This copy's player); Criteria to tests, both ways; Criteria in a checked shape; Wrong programs;
  Failing on an assertion; Dogfooding; Built to be hard to get wrong. Its Scenes, physics and the canvas core says
  nothing of a hidden view. AGENTS.md and CONTRIBUTING.md.
- The suites `424/` (README, `helpers.ts`, which this suite imports, and its picks, additive, cutaway and taste
  tests), `552/` (README, `helpers.ts`, `fixtures.ts`, its fog-column, export and taste tests; imported), `549/` and
  `550/` (`helpers.ts`; imported), `1173/` (seek against play), `446/` (the shadow reports, a shadowed spot), `386/`
  (a status outline against depth), `419/` (a look's `samples`), `1164/` (a driver on a logic array's element),
  `2856/` and `2306/` (the taste record, `twins.json`).
- At the base, only for call shapes: `crates/deep-gpu-layer/src/{main.rs,view3d.rs,view3d/parse.rs,fed.rs}`,
  `crates/deep-scene3d-render/src/{lib.rs,module.rs,shadow.rs}` (the see-through pipelines' names, a frame's counts,
  the shadow map's format), `crates/deep-canvas-scene3d/src/{builders.rs,scene.rs,spec.rs,lib.rs}` (the lathe's
  triangles, the sun's cascades), `crates/deep-canvas-motion/src/doc.rs` (`driver_of`, `target_of`),
  `crates/deep-canvas/src/document/mod.rs` (an item's keys), `crates/deep-show/src/{matched.rs,main.rs}` (a copy's
  view, the scenario's `planted`), `scripts/proof-runs.mjs`, `scripts/lanes.mjs`, `scripts/throttle.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and the fixtures.

## What the base already does, and these tests don't credit

From the base's code and this job's probes there (scratch scripts, not committed; `BASE-FAILURE.txt` holds the runs):

- **`view3d` ignores `hidden_view`.** An item that carries it draws as without it (the same pixel hash), a channel
  whose target is `items/<id>/hidden_view/opacity` is accepted and moves nothing, and a driver var written `match.me`
  is refused, `ref_unresolved` at `drivers/<id>/vars/<name>`. `targets: ["shadow"]` is refused, `bad_input`. An unknown
  `--planted` name is `{"ok": false, "code": "bad_input"}`, exit 2.
- **`deep show` refuses it.** An item with `hidden_view` is `unknown_field` ("not a field of an item") and the piece is
  refused; a driver var written `match.me` is `ref_unresolved`. An unknown scenario `planted` is `{"ok": false, "code":
  "bad_input"}`.
- **Adjust opacity (#424)** already draws an item see-through after a depth pass of its own. No fixture here carries
  `adjust`, so it can't stand in for the hidden view. A scratch run of it at 0.4 over a wall passed this suite's blend
  judge on 20,194 of 20,194 pixels (largest error under 0.75 code), so the judge's arithmetic and its 1/255 are what
  the renderer's own blend gives.
- **A `seen` column (#552)** already leaves a row out on a copy whose bit it lacks, a status binding (#382, #386)
  already draws its outline and badge in the exact status color, and a seek already equals play. So half of AC5, AC6's
  status pixels and AC7's hashes hold at the base; each of those tests also asks for the hidden view itself, and fails
  there.
- The fixtures without `hidden_view` draw and play at the base: the sphere's and the torus's regions agree with the
  base's object-ID targets pixel for pixel, the final target is the sRGB coding of the linear target within 0.5 code,
  the pieces are presented, their matches play with every hash shared, and each copy's view puts the characters and
  the rows where the judges read them (seen with the wall left out, and with the characters lifted by the logic array).

None of it is a hidden view, a `shadow` target, a hidden pass in `draws`, `match.me` in a driver, or any planted name
below. Every test fails at the base and none is a guard. The base holds no planted program of this suite, so each
planted test stops there at the refused name; the judges it would run were tried instead on the base's own frames
and on made-up pictures of a right and a wrong program (`BASE-FAILURE.txt`).

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; `npm ci` once. Each file builds (`deep-gpu`, as #424's suite
does; `deep-show` with `--no-default-features --features full`, as #549's does; `ac8` both), so run one file at a
time, each under the machine's lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
for f in ac1-sphere ac2-torus ac3-shadow-ids ac4-match-me ac5-seen ac6-status ac7-seek-count ac8-taste; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/290 --no-file-parallelism --testTimeout=600000 $f.test.ts
done
node node_modules/typescript/bin/tsc -p tests/acceptance/290/tsconfig.json   # type check
rm -rf tests/acceptance/290/node_modules                                      # vitest's cache after a --root run
```

Every `it` passes its own timeout (5,400,000 ms), which `--testTimeout` doesn't shorten. No test reads a time or the
load. Temporary folders are deleted after each test; every `deep-show` is stopped by its PID (#549's `useChildren`),
and `deep-gpu` runs under `spawnSync` with a timeout that signals only that child. Nothing listens or opens a
connection. Only `ac8-taste.test.ts` writes outside its temporary folders, its pictures to `docs/evidence/290/`.

**Gates.** None is ever a pass. Off macOS every test fails `INCONCLUSIVE:` (the frames draw on the Mac's GPU);
`BLOCKED:` when cargo can't run; AC8 is `INCONCLUSIVE:` until its taste call is recorded on this run's pictures.

**The lanes line**, which the implementer adds to `scripts/lanes.mjs` beside #552's:

```js
// #290's files each build deep-gpu (ac4 and ac5 build deep-show instead, ac8 both) and draw on the GPU; ac4, ac5 and
// ac8 play matches in process, and ac8 waits on your taste call in tests/acceptance/290/TASTE.json.
alone.push('tests/acceptance/290/');
```

No file is `timed` and none is by hand.

## Criteria to tests

IDs are `#290.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed.
Each `describe` and each test's name starts `AC<n> #290.<h8>`; each file quotes its criterion in full.

| AC | ID | File (tests) | What it asserts | What fails it |
|---|---|---|---|---|
| 1 | `#290.052fe5e4` | `ac1-sphere.test.ts` (2) | On 10,178 pixels where the wall covers the sphere, the final code is within 1 of 255 · encode(0.6 · wall + 0.4 · sphere) in each channel, both taken from the same renderer's linear targets with the other left out. On 10,016 pixels where the sphere shows directly, the final bytes are those of the frame with no `hidden_view`, at `color: "base"` and at `color: "sand"`; the tinted hidden view differs from the untinted under the wall on at least half the pixels | The base (every pixel under the wall reads the wall alone); `hidden_view_draws_where_visible`, on the tinted frame, naming each pixel |
| 2 | `#290.8310b458` | `ac2-torus.test.ts` (2) | On 2,566 pixels where the torus's near tube stands before its far tube under the wall, the final code is within 1 of 255 · encode(0.6 · wall + 0.4 · torus alone) | The base; `hidden_view_without_own_depth`, naming each pixel |
| 3 | `#290.a677630a` | `ac3-shadow-ids.test.ts` (2) | At 0.4 against 0: the same `ids` file and `picks` table, the wall at every pixel where it covers the sphere, `wall` from five clicks there, and the same `shadow` file, with the sphere casting and with `cast_shadow: false`; the hidden view is drawn at 0.4 (99% of those pixels differ from 0), the maps aren't flat, and they differ when the sphere casts | The base (`shadow` refused); `hidden_view_writes_ids`, each pick naming its pixel and `sphere` |
| 4 | `#290.fba001a7` | `ac4-match-me.test.ts` (2) | After steps 60 and 160 each copy's view reads its own `match.me`, shows through the wall the character `cast.owner` gives its player and only the wall where the other's stands; both copies run 200 steps with no end and share every full-state hash (at least 3) | The base (piece refused at check); `hidden_view_opacity_ignores_match_me`, naming copy 1 with `hero_2` and copy 2 with `hero_1` |
| 5 | `#290.9e8b88d3` | `ac5-seen.test.ts` (2) | After step 100 each copy's view reads as the wall alone at every row its `seen` bit hides, and shows through the wall every row its player sees | The base (piece refused at check); `hidden_view_ignores_seen`, naming copy 1 with row 1 and copy 2 with row 2 |
| 6 | `#290.69fa44f2` | `ac6-status.test.ts` (2) | Every pixel of exact #bf232b where the wall covers the sphere (the gauge's outline and badge, at least 100; 663 at the base) is exact #bf232b with the hidden view too, while at least 90% of the wall's pixels around them differ | The base (nothing around them changes); `hidden_view_after_status`, naming each pixel |
| 7 | `#290.f96ca349` | `ac7-seek-count.test.ts` (1) | Frames 10 and 25 sought in fresh processes, and frame 25 as a render-back, have the played frame's `pixel_hash`; frames 0, 10 and 25 are three pictures and frame 0 is the document with no `hidden_view`. With no field, at `{opacity: 0}` and at frame 0: no hidden pass in `draws`, the other rows and the reply's `passes` unchanged. At 0.4 and at each played frame 1 to 30: exactly one `hidden_depth` and one `hidden_view`, of `sphere` | The base (the channel moves nothing; no frame lists a hidden pass) |
| 8 | `#290.005a3986` | `ac8-taste.test.ts` (1) | By replies first: each frame lists `hidden_view` of its item, the piece is presented, its match plays, each view read its own `match.me`. Then four pictures in `docs/evidence/290/` with their SHA-256s, and `TASTE.json` read: none or a call on other pictures is INCONCLUSIVE, `looks_wrong` fails, `looks_right` on exactly these passes. It judges no picture | The base (no frame lists the draw) |

Test count: 2 + 2 + 2 + 2 + 2 + 2 + 1 + 1 = 14. `twins.json` maps each of the six criteria to its twin, as #2306's
and #537's do.

## The surface under test

The issue names the field, the pass, the depth target, shadow maps, the object-ID pass, a pick, `match.me`, a `seen`
column, the status guard, a seek, render-back and a count, but no call. As #424's and #552's suites do, the renderer
is driven through `deep-gpu run` (#377: one JSON line `{out, calls}` in, one answer line `{"ok": true, "replies":
[...]}` out) and its `view3d` call, and a match through `deep-show run` (#393) and its `match` call. **Each name below
is marked the design's, the base's, or this job's; the implementer provides exactly these, or a dispute goes to a
blind redraft.**

### In a document

| Field | As the tests write it | Whose |
|---|---|---|
| `hidden_view` on a 3D item | `hidden_view: {opacity: 0.4, color: "base"}`, `{opacity: 0.4, color: "sand"}` (a role of the look), `{opacity: 0.4}`, `{opacity: 0}`; on a `ball@1`, a `lathe@1`, a `mark.box@1` and an `instance@1` | the design's; on an instancer, this job's reading (Readings) |
| A channel on its opacity | `channels: {fade: {target: "items/sphere/hidden_view/opacity", type: "f32", keys: {k0: {t: "0s", value: 0, interp: "linear"}, k1: {t: "1s", value: 0.8, interp: "linear"}}}}` | the path is this job's, after the base's `items/<id>/adjust/opacity` |
| A driver on its opacity | `drivers: {hero_1_view: {target: "items/hero_1/hidden_view/opacity", expr: "0.4 * max(0, 1 - abs(who - me))", vars: {who: "cast.owner[0]", me: "match.me"}}}` | the target path and the var written `"match.me"` are this job's; `cast.owner[0]` is the base's form (#1164) |

Through `deep show` the item field and the driver must pass the check; through `view3d` they must draw.

### `view3d` (`deep-gpu run`)

The base's call and fields (`doc`, `look`, `size`, `frames`, `fps`, `from`, `capture`, `targets`, `counts`, `states`,
`clicks`, `class: "render_back"`), its frames (`frame`, `pixel_hash`, `final`, `linear`, `ids`, `picks`, `clicks:
[{at, pick}]`, `draws`) and its reply's `passes: [{name}]`. This job adds:

- **The `shadow` target** (`targets: [..., "shadow"]`). Each captured frame gains **`shadow: <sha256>`**, naming
  `<out>/<sha256>.f32` as the other targets name their files: the depth texels of every shadow map the frame reads,
  in one file, each map whole (every layer of it) as little-endian f32, the key sun's cascades first in cascade
  order, then each local map in the order `shadows.maps` lists them. The tests compare the names of two frames, and
  read one file to see that it hashes to its name, holds whole f32s and more than one value. Why a new target: no
  field at the base reads a shadow map's texels back, and the criterion says byte for byte.
- **The hidden view's passes in `draws`.** Under `counts: true` a frame's `draws` (#1636's, `{pass: "color", of,
  mesh, material, instances}` a row) also lists one row for each draw the hidden view issues: **`{pass:
  "hidden_depth", of: <item ID>}`** for the depth pass of the item's own triangles and **`{pass: "hidden_view", of:
  <item ID>}`** for its blended draw (other members as the implementer likes; the tests read `pass` and `of`). A frame
  where the item's opacity is 0 lists neither. Example at 0.4: `[{pass: "color", of: "ground", …}, {pass: "color", of:
  "sphere", …}, {pass: "hidden_depth", of: "sphere"}, {pass: "hidden_view", of: "sphere"}]`. Why here: the criterion
  counts a depth pass and a blended draw, and `draws` is the base's count of draws by pass.

### `match` (`deep-show run`)

The base's, as #552's suite calls it: `{call: "match", doc, steps, relay: {seed: 290}, views: [{player, step}]}`
after `deep show` presents the piece; read: `copies` (`player`, `ran`, `end`, `hashes`, `desync`, `fault`) and `views:
[{player, step, me, snapshot}]`, `snapshot` the SHA-256 of that copy's frame, a PNG of the panel's size in the
scenario's evidence store. This job adds nothing to it but the two planted names.

### Planted programs

Each is one criterion's wrong program, reachable only through its plant, and changes nothing but what its row says:
its process must run and answer, and the check that passes the shipped program must fail on it. The names are this
job's; the programs are the issue's.

| Name | Where | AC | The wrong program, exactly | Its failure names |
|---|---|---|---|---|
| `hidden_view_draws_where_visible` | `deep-gpu run --planted` | 1 | The hidden view's blended draw runs without its test against the frame's depth target: the item's nearest surface draws at the opacity, tinted, wherever it is, hidden or in plain sight | each pixel where the sphere shows directly, on the frame at `color: "sand"` |
| `hidden_view_without_own_depth` | `deep-gpu run --planted` | 2 | The blended draw runs with no depth pass of the item's own triangles before it: every surface of the item that a nearer surface of the frame hides blends, one over another | each pixel of the band where the torus's two layers overlap |
| `hidden_view_writes_ids` | `deep-gpu run --planted` | 3 | The blended draw also writes the item's object ID into the object-ID target wherever it draws | each clicked pixel, and `sphere` |
| `hidden_view_opacity_ignores_match_me` | the scenario's `planted` | 4 | A driver whose target is a hidden view's opacity and which reads `match.me` is evaluated once for each player of the match (`match.me` = 1 … `players`) and the opacity takes the largest result, on every copy | `copy 1 at step 60 shows hero_2`, `copy 2 at step 60 shows hero_1` |
| `hidden_view_ignores_seen` | the scenario's `planted` | 5 | The hidden view's pass draws every live row of an instancer, whether or not its `seen` column holds this copy's bit; the rows' own draw, picks and tree still leave an unseen row out | `copy 1 at step 100 draws a hidden view of row 1 (enemies#1.1)`, `copy 2 … row 2 (enemies#2.1)` |
| `hidden_view_after_status` | `deep-gpu run --planted` | 6 | The blended draw is issued after the status guard and after the status colors, over the final target (still only where the core's depth target holds a nearer surface) | each status-colored pixel in front of the hidden sphere |

The four `deep-gpu` names join `Planted` in `crates/deep-gpu-layer/src/main.rs`; the two scenario names are accepted
by `deep-show run`'s `planted` and reach each copy's drawn form, as #552's `seen_reads_player_one` does. No test
reads an environment variable, and the only files read or written outside a temporary folder are `TASTE.json` and
`docs/evidence/290/` below.

### The taste call

`ac8-taste.test.ts` writes to `docs/evidence/290/`, each a byte copy of the renderer's own PNG, printing each SHA-256:

| File | What it shows |
|---|---|
| `sphere-behind-wall.png` | AC1's sphere behind its wall at `hidden_view: {opacity: 0.4, color: "base"}` (the frame's final target) |
| `torus-behind-wall.png` | AC2's torus behind its wall at `hidden_view: {opacity: 0.4}` (the frame's final target) |
| `match-copy-1.png`, `match-copy-2.png` | AC4's characters' piece after match step 60, as copy 1 and as copy 2 show it (each view's `snapshot`) |

They are attached to the PR and shown to the owner in the session. The answer is recorded in
`tests/acceptance/290/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 290, "criterion": "#290.005a3986", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<file name>": sha256, … all four}, "note"?: string}
```

No file, or a call on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's
pictures passes. No other test reads these pictures or the call.

## Fixtures

None on disk: every document and program is made in `helpers.ts` (documents, numbers, rays and judges; it loads in
plain Node) and `match.ts` (the match's run through `deep-show`). No personal data; CC0.

- **The sphere behind a wall** (`sphereDoc`; AC1, 3, 6, 7, 8). 480 × 360 through #378's pinhole at [0, 1.2, 8]
  looking at [0, 1, 0], 40° across, #424's plain look (tone map none, so the final target is the sRGB coding of the
  linear one). A `ball@1` of radius 1 m at [0, 1, 0], lit blue [0.1, 0.3, 0.85]; a wall 2.4 × 3 × 0.2 m at [−1.2, 1.5,
  2], lit warm grey [0.55, 0.5, 0.42], ending at x = 0, so it covers the sphere's left half; a grey ground; one sun of
  π lx turned [−35, 25, 0]; a black sky with no ambient. Nothing casts, so the wall alone and the sphere alone are lit
  as they are together (at the base the two frames agree with the joint one byte for byte in their regions). Options:
  the lights cast (AC3: the sun in two cascades, and a shadowed spot of 1,000 lm at [−3, 4, 6] aimed at the sphere,
  `light_policy: {shadowed: {spots: 1}}`), with the sphere's `cast_shadow` false; a gauge (AC6: a `mark.box@1` 0.4 ×
  0.4 × 0.1 m at [−0.35, 1.06, 2.3], its stroke and badge bound to a verdict in state fail); the channel (AC7).
- **Its judged pixels** (`sphereRegions`). A pixel is one "where the wall covers the sphere" when the rays through its
  centre and the eight points 1.5 px around it all meet the wall and then the sphere: **10,178**. It is one "where
  the sphere shows directly" when all nine meet the sphere and none the wall: **10,016**. Both regions are convex, so
  each judged pixel has a whole pixel of its region around it and no edge of the multisampled pass reaches it. AC3's
  clicks are five pixel centres at least 4 px inside the first region.
- **The torus behind a wall** (`torusDoc`; AC2, 8). The same frame from [0, 2.6, 7.5]. A `lathe@1` on a closed
  outline (a circle of radius 0.38 m in 32 points, 1 m from the axis, 96 segments), lit orange [0.85, 0.45, 0.1], lying
  flat at [0, 1, 0]; a wall 2.6 × 3 × 0.2 m at [−0.9, 1.5, 2.2], lit blue grey [0.3, 0.4, 0.6]. **Its judged pixels**
  (`torusOverlap`): the rays through the pixel's centre and ±0.5 px around it cross the lathe's triangles four times
  (#424's `referenceComposite`, f64), at every pixel within 2 px, and the nine rays 1.5 px around it meet the wall:
  **2,566**. At the base the triangles' silhouette is the ID target's and their nearest crossing is the depth target's
  within 13 mm (a sample's offset).
- **The characters' piece** (`heroesDoc`; AC4, 8). 640 × 360, orthographic along −Z, 32 px a metre, unlit, a black sky.
  `hero_1` (orange) at x = −4 and `hero_2` (cyan) at x = 4, 1.6 m boxes at z = 0 carrying `hidden_view: {opacity: 0}`;
  a wall 16 × 3 × 0.2 m at z = 2; the logic item `cast` at 20 Hz (`castProgram`, WebAssembly written as bytes: `owner`,
  two i32, [1, 2] while k < 100 and [2, 1] from it; run in Node's own WebAssembly, it writes exactly that); the two
  drivers above; a net item for 2 players (delay 4, window 0, a hash every 60 steps, relay `https://relay.test/290`,
  which nothing reaches). Each character is read at its centre, (192, 180) and (448, 180), and 10 px to each side,
  against the wall alone 36 px above.
- **The rows' piece** (`rowsDoc`; AC5). The same frame and wall (18 m wide, at z = 0). #552's `sight` (imported)
  writes four rows, 1.6 × 1 × 1.6 m boxes at x = −6 + 4i, z = −3, and `seen`: row 0 both players, row 1 player 2, row
  2 player 1, row 3 neither (at step 100). The instancer `enemies` reads them, `seen` included, and carries
  `hidden_view: {opacity: 0.4}`. Each row is read at its centre, (128 + 128i, 180), and 10 px to each side, against
  the wall alone 34 px above.

## Readings where the issue and the design leave a choice

- **"Equal … within 1/255", the target and the space** (AC1, AC2). The design says the surface is "blended over at
  `opacity`", as a see-through draw is: in the frame's linear target. So the blend is taken in linear light, 0.6 · W +
  0.4 · S with W and S read from the linear targets, and judged on the final target, the picture: each channel's code
  within 1 of 255 · encode(that light). W and S are the same renderer's frames of the fixture with the other left out,
  never a lighting formula of this job's.
- **`color: base`** leaves the item's own shading as it is; AC1's value is asked there. What "tinted toward" a role
  does to a color is asked only as far as the twin needs: at `color: "sand"` the hidden view under the wall isn't the
  untinted one on at least half the pixels.
- **AC1's twin is judged on the tinted frame.** A pass that also draws where the sphere is visible blends the sphere's
  shading over itself at `color: base` and changes no byte, so no check can see it there.
- **"Byte for byte as without the hidden view"** (AC1): the final target's bytes against the same document with no
  `hidden_view` field.
- **"Where its two layers overlap"** (AC2): where a ray crosses the torus's surface four times. **"One layer's
  blend"**: the nearest layer's, which is what the torus alone shows there.
- **"Shadow maps … byte for byte"** (AC3): every shadow map the frame reads, the sun's cascades and a local map, as
  the `shadow` target; asked with the sphere casting (the criterion's plain case) and with `cast_shadow: false`, where
  a hidden view that drew into a map would show. **"The object-ID pass"**: the `ids` target and its `picks` table.
  **"A pick on the hidden sphere's pixels"**: `clicks` with the base's hit margin of 3 px.
- **"Each setting opacity from `match.me` and a logic array of the players' characters"** (AC4): a driver per
  character, 0.4 where `cast.owner[i]` is `match.me` and 0 elsewhere; the array changes at step 100 so the views at 60
  and 160 differ. **"Show only their own character"**: every read pixel more than 12 codes from the wall alone where
  it shows, within 2 where it doesn't (a copy's view draws through the shipped look, so no exact value is asked;
  AC1 holds the 0.4). **"Their full-state hashes match"**: every hash both report, at least 3, with no end.
- **A row and its item** (AC5). The design gives `hidden_view` to a 3D item and says "a row or element that a `seen`
  column hides on this copy stays hidden in its hidden view too". An instancer is one item whose rows are what it
  draws, so the field sits on the `instance@1` and each row it draws takes it. "On this copy" is a copy of a match.
- **"A status color in front of the hidden item"** (AC6): a status binding's outline and badge on an item nearer than
  the occluder, over the hidden item's pixels. **"Drawn after the status guard"**: after the status colors too, since
  the criterion says it tints one.
- **"Seeking equals playing"** (AC7): frames 10 and 25 of 31, in fresh processes. **"Render-back equals the live
  frame"**: `view3d`'s `class: "render_back"` at frame 25, under a look that draws one sample a frame in both classes
  (`samples: {live: 1, export: 1, at_rest: "none"}`): by default an export draws 16 samples, which no live frame in
  motion holds, with or without a hidden view (at the base too).
- **"Adds no pass, counted"**: no hidden row in the frame's `draws`, its other rows and the reply's `passes` as with no
  field. **"Exactly one depth pass and one blended draw"**: one `hidden_depth` and one `hidden_view` row of the item.
- **"Taken by the check run from the renderer's own output"** (AC8): byte copies of the frames' final targets and of
  each copy's view, in `docs/evidence/290/`, where the base's newest taste tests put theirs.

Found in the issue: nothing contradictory. Two clauses can't be tested as written and are read as above (AC1's twin at
`color: base`; AC7's render-back under a default look), and "attached to the PR and shown to you in the session" is
the implementing agent's, which no test can see.

## Not asserted, because no criterion says so

Status roles refused in `color`; how far a role tints; that the hidden view writes no depth (beyond what AC1's pixels
show); shadow rays; a hit test or the accessibility tree through the occluder; a see-through occluder; items in two
writer layers and the order across them; the per-pixel resolve; a hidden view under a cutaway; an export or a
render-back of a recorded match with `match.me` as the record's player or `none` (the Scope names it, no criterion
does); a mark set's `seen`; the pass's cost. They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- `hidden_view` as an item field the check knows, with its channel and driver paths; a driver var `match.me`.
- The hidden view's depth pass and blended draw in the renderer; the `shadow` target and the two `draws` passes in
  `view3d`; the four `--planted` names.
- The two scenario `planted` names in `deep-show`, reaching each copy's drawn form.
- The lanes line above in `scripts/lanes.mjs`.
- `docs/evidence/290/` (written by AC8's run) and `TASTE.json`, once the owner's call on the pictures is recorded.
