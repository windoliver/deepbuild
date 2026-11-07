# Acceptance tests for #1173: 3D frames draw single-sample though the surface reports MSAA, and half-resolution puffs draw as blocks

Written first, from issue #1173 (its two findings, its three scope lines, its five acceptance criteria and its proof
line: "Edge coverage read back from the resolved targets, the surface reply against the targets' sample count, the
puff's blocks, and seek against play"), the design sections it links and those they lean on, and base commit
`e2e6e1cc` ("Merge pull request #1211 …"), by a job that never saw an implementation; none existed. No upstream test
is ported. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

What was read:

- AGENTS.md; `docs/technical-design.md`: Dogfooding and "Tests written first, by a job that never sees the code";
  Scenes, physics and the canvas core (the scene renderer's pass chain; "stateless particles"; seeking equals playing);
  the conformance list's MSAA mentions (the GPU backend's feature table with "MSAA counts"; GPUI's 4× MSAA).
- `docs/canvas-primitives.md`: GPU surface (`msaa: transient`), Determinism class and "Temporal effects in canonical
  renders" ("MSAA and sample-based motion blur cover exports, render-back and checks. Only the live view reprojects its
  own frames"), the per-pixel terms ("about 33 with transient MSAA"), the showpiece row ("256 MB per window, with
  transient MSAA"), Particles (`resolution: half`, a puff "drawn as a depth-sorted soft particle, at half resolution
  when the class says so"), the depth-aware upsample from half resolution that light shafts use.
- The suites of the issues it cites and depends on: `tests/acceptance/378/` (`view3d`, its documents, `pixel_hash`,
  `final` and `ids` targets), `380/` (`effectScene`, the effects look, `selection`, `from` seeks), `386/` (`surface`
  on view3d, `cityDoc`, the PNG reader, the INCONCLUSIVE gate off macOS), `420/` (the drift puff at `resolution:
  half`, the house), `1174/` (the taste call's record, `TASTE.json`, screenshot encoding), `379/` (`canonical` and its
  purposes), `377/` (the `surface` call; its handoff test holds `msaa` at `"transient"`), `671/`.
- At the base: `crates/deep-gpu-layer` (`main.rs`: the `surface` call's `"msaa": "transient"`, `Planted`, the call
  table; `view3d.rs`: `Args`, the `surface` reply; `live.rs`: `canonical`, `render_canonical`, `Purpose`;
  `effects.rs`: a puff's `half`), `crates/deep-scene3d-render/src/lib.rs` (every target `sample_count: 1`, every
  pipeline `multisample: Default::default()`), `crates/deep-effects-render/src/particles.wgsl` (a half-resolution
  puff shaded once per 2 × 2 block, its value written to all four pixels), `frame.rs` (`Sparks.half`),
  `scripts/proof-change.mjs` (criterion IDs).

What the base already does and these tests don't credit: `view3d` and `canonical` draw scene3d single-sample and
report no sample count; the `surface` call answers `"msaa": "transient"` for #377's handoff scenes, which draw no
scene3d; a half-resolution puff is a mosaic of 2 × 2 blocks; `canonical` writes no picture, only its pixel hash.

## Run them

They build `deep-gpu` (the shipped feature set), as #378's, #386's and #1174's suites do, so they run with
`--no-file-parallelism`. `scripts/lanes.mjs` needs this folder in its `alone` list, beside `tests/acceptance/386/`;
this README is the instruction, and the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1173 --no-file-parallelism
npx tsc -p tests/acceptance/1173/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

On macOS every file first runs `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu` in
the checkout, copies the binary out of `target/debug` to a temporary folder, and fails each test that uses a build that
failed. Each test writes into its own temporary folder and deletes it; `taste.test.ts` also writes the screenshots to
`target/acceptance/1173/` (kept: they are what the owner is shown) and builds the merge base there (below). The tests
use node built-ins and vitest. A run with `--root tests/acceptance/1173` leaves Vitest's cache in
`tests/acceptance/1173/node_modules/.vite`; delete it.

Every test draws with the GPU layer on Metal, on macOS: off macOS it fails with a message that starts `INCONCLUSIVE:`
and never passes there (nothing is built off macOS); a reply of `unsupported_platform` reads the same way. No test is
gated on a reference Mac, power, Low Power Mode, thermal state or load (the owner's rule, as #386's suite): the issue's
proof names no timing. C4's "on the same machine" is each run's: played and sought frames are drawn by the same
binary on the same Mac. `BASE-FAILURE.txt` is the run at the base on this job's Linux box, so all 9 tests there are
INCONCLUSIVE; on a Mac at the base each criterion test fails for the base's behavior or a missing reply field, and
each planted test with `bad_input`, since the base has no such `--planted` name.

## The surface under test

The issue names the surface reply's `msaa`, scene3d's targets and their sample count, half-resolution particles and
the live view, exports, render-back and checks, but no code API. The live view whose pixels a test can read is
#378's `view3d`; a canonical render (export, render-back, a frame-budget check's frame) is #379's `canonical`. So these
tests add **reply fields to both, one call field to `canonical`, and planted programs**. No new binary, no new call.

### `view3d` (#378's call, with #380's `from` and `selection` and #386's `surface`)

The reply adds:

- `surface.msaa`: a number, the sample count the view's GPU surface reports, the count scene3d's targets for this view
  are made with: 4 on Metal at internal scale 1 (the tests use only internal scale 1 and the default `surface`).
- `render_targets: [{"name": string, "sample_count": n}]`: every target scene3d's geometry pass draws into for this
  view, as made: at least `color` (its linear color target) and `depth` (its depth target), and any other attachment
  of that pass, each with the `sample_count` it was created with. Resolve targets and the post passes' targets are not
  listed. With MSAA on, the post passes read the color target resolved.

### `canonical` (#379's call: `{"call": "canonical", "look", "writer", "doc", "size", "frame", "fps", "purpose"}`)

- New call field `"targets"?: ["final"]`: the canonical render's picture is read back and written into the scenario's
  `out` as an 8-bit RGBA PNG named by its SHA-256 (`<out>/<sha256>.png`), the same bytes, reordered from BGRA, that its
  `pixel_hash` hashes (as `view3d`'s `final`).
- The reply adds `"final": sha256` (with `targets: ["final"]`), `"msaa": n` and `"render_targets"` as `view3d`'s, for
  every `purpose` (`export`, `render_back`, `frame_budget`). The same fields on a `live` window's `canonicals[]` are
  welcome but not tested.

The `surface` call (#377's) is unchanged: it answers for #377's handoff scene sessions, which draw no scene3d, and
#377's suite holds its `msaa` at `"transient"` (README: Readings).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

Each is added to `Planted` in `crates/deep-gpu-layer/src/main.rs`; everything else draws as the shipped program.

| Name | The wrong program | Criterion |
|---|---|---|
| `single_sample_targets` | scene3d makes its geometry pass's color and depth targets, and its pipelines, single-sample (the base's drawing) in `view3d` and `canonical` alike; the replies report what was made (`render_targets` sample counts 1, `msaa` 1) | C1 (issue-named: "a planted single-sample target") |
| `claims_msaa_over_single_sample` | As `single_sample_targets`, but `surface.msaa` and a canonical render's `msaa` say 4 while `render_targets` report the sample count 1 they were made with | C2 (issue-named: "a reply that claims MSAA over single-sample targets") |
| `puff_block_copy` | A half-resolution puff is shaded once per 2 × 2 px block on the even grid and that value written to all four pixels (the base's `particles.wgsl`) | C3 (issue-named: "a planted block copy") |
| `resolve_accumulates_frames` | The MSAA resolve of each frame blends in half of the view's previous resolved frame (none before a view's first frame), so a frame depends on how it was reached | C4 (a mutant: the criterion names none) |

## Fixtures (`helpers.ts`)

- Looks: `BOX_LOOK` (#386's `PLAIN_LOOK` palette: paper ground #f7f6f2, the box teal #2a7f86), `PUFF_LOOK` (night
  ground #101114, puff #f2f2f2), `SCENE_LOOK` (#380's `fixtures/look.json` roles and palette with its bloom
  `{intensity 0.3, radius 0.85}` and ground grid on, as #380's `all` scene, plus a puff role). All physical basis, tone
  map none at the exposure whose scale is 1, finish identity, no deband.
- `boxDoc()` (C1, C2, C4): 640 × 480; an orthographic camera looking along −Z, 8 m across (80 px a metre); a 3 m box at
  the origin in `accent`, its front face a 240 px square; a sun shining along −Z, face on; a channel on
  `items/box/at/rot/2` rolls the box from 10° at t 0 to 40° at t 1 s, so each frame's silhouette is a square turned off
  the pixel grid and frames differ. Drawn at 30 fps, frames 0 … 29; canonical frame k is t = (k − 1) ÷ 30 (#379's).
- `puffDoc(puffs)` (C3): 640 × 480; a still perspective camera; a 0.2 m stone box `src`; with `puffs`, one
  `particles@1` emitter `puffs`: count 8, emitted from a 1.6 m sphere about `src` at 4 a second, life 3 s, drifting
  (amplitude 0.3, frequency 0.3), size 80 px, color `puff`, `draw: puff`, `resolution: half`; document seed 7. Frame
  45 (t 1.5 s at 30 fps) is read, with and without the emitter.
- C5's scenes, 960 × 540, frame 30 at 30 fps: `cityDoc()` (#386's `cityDoc` grid cut to 24 × 24 boxes of seven
  heights, `accent` and `muted`, under a sun, a perspective camera at elevation 35°); `effectsDoc(puffs)` (#380's
  `effectScene('all')`: lamp, block and crate on a floor, a casting sun, sparks, the lamp selected, bloom and the grid,
  plus a half-resolution puff emitter over the block); `houseDoc()` (#420's small house: two walls meeting at a corner,
  a door, a floor slab with the stair's well, a gable roof, a straight stair, under a casting sun). These are the
  screenshot audit's three: the city, the effects scene and the house.
- `payload(doc)`: a view3d document as the writer's payload `canonical` takes (no `id`, `layers` or item `layer`).

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text as the issue writes it, trimmed, with whitespace
collapsed and the leading `- [ ] ` dropped (`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with
its criterion's ID.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#1173.b5284ee0` (C1) | A box silhouette drawn at 4× MSAA has pixels of partial coverage along its edge on every frame and every export, and a planted single-sample target fails, naming the target | `edges.test.ts`: one process draws `boxDoc` by `view3d` for frames 0 … 29 (every final target read back, each equal to its pixel hash, 0 ≠ 29) and by `canonical` as an export at frames 1, 15 and 30, a render-back and a frame-budget frame at 15 (each `final` read back and equal to its pixel hash). Every reply reports msaa 4. In every picture the box's edge has partial coverage (`coverageOf`): pixels 0.15 to 0.85 of the way from the ground to the face, within 10 codes of the line between them, number at least 40% of the box's boundary pixels, and 90% of them lie within 2 px of that boundary (fixture checks: the face stands 150 codes or more from the ground; the boundary is 500 to 1,500 px). A failure reads `frame n: the box's edge has k pixels of partial coverage for b boundary pixels, under 40%; scene3d's color target was made with s sample(s)` (or `export frame k: …`, `render_back frame k: …`). Wrong programs: the base; `--planted single_sample_targets`, which must fail on a frame and on an export, naming the color target made with 1 sample |
| `#1173.8d6404d5` (C2) | The surface reply's `msaa` equals the sample count scene3d's targets were made with; a reply that claims MSAA over single-sample targets fails, naming both | `samples.test.ts`: one process draws `boxDoc` by `view3d` (one frame) and by `canonical` as export, render-back and frame budget. Each reply's count (`surface.msaa`, `msaa`) is 4, `render_targets` lists `color` and `depth`, and every listed target's `sample_count` equals the reply's count. A failure reads `view3d: the surface reply says msaa 4, but scene3d's color target was made with 1 sample` (or `export: …`). Wrong programs: the base (no count, no targets); `--planted claims_msaa_over_single_sample`, which must fail on view3d and on the export, naming the claim and the target |
| `#1173.478ff552` (C3) | A half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge; a planted block copy fails, naming the emitter | `puffs.test.ts`: one process draws `puffDoc`'s frame 45 with and without the emitter. What the puffs add at a pixel is the RGB sum of the frame with them less the frame without (clamped at 0); the soft edge is where that is 20% to 80% of its largest value (fixture checks: at least 2,000 px and 1,000 2 × 2 windows). No 2 × 2 window there, at any offset, has four identical pixels. A failure reads `puffs: n of the m 2 × 2 blocks inside the half-resolution puffs' soft edge are four identical pixels, the first at (x, y)`. Wrong programs: the base; `--planted puff_block_copy`, which must fail naming `puffs` |
| `#1173.5b817fce` (C4) | Seeking equals playing by pixel hash on the same machine with MSAA on | `seek.test.ts`: `boxDoc` played by `view3d` for frames 0 … 29 in one process, and sought in fresh processes to frames 11 and 29; each view reports msaa 4; each sought frame's pixel hash equals the played frame's (11 ≠ 29 played). A failure reads `frame n: seeking draws …, playing drew …`. Wrong programs: the base (no msaa reported); `--planted resolve_accumulates_frames`, which must fail naming the frame |
| `#1173.2197a951` (C5) | Shown to you: screenshots of the city, the effects scene and the house before and after, zoomed on an edge and a puff, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it | `taste.test.ts`: writes the ten screenshots below from one run's pixels (the puffs must change at least 200 px; each view must show an item's edge), then reads `TASTE.json`: absent, or recorded on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

### The taste call (C5)

"Before" is the change's merge base (`git merge-base HEAD origin/main`, else `main`): when the checkout's `crates`,
`vendor`, `Cargo.toml` and `Cargo.lock` equal the merge base's, its renderer is this checkout's build; otherwise the
test unpacks `git archive <merge base>` into `target/acceptance/1173/before-<12 hex>/` and builds `deep-gpu` there into
`target/acceptance/1173/before-target/` (kept between runs). "After" is this checkout's build. Each scene's frame 30 is
drawn by `view3d` with its final and ID targets by both builds; the edge zoom is centred on the pixel nearest the
view's centre whose pick ID differs from its right neighbour's (in the after build's ID target); the puff zoom is
centred on the centroid of the pixels the puffs change by more than 30 codes (the after frame against the same scene
without its puffs). The run writes these 8-bit RGB PNGs (no filter, zlib level 9) to `target/acceptance/1173/`,
printing each one's SHA-256:

| File | What it shows |
|---|---|
| `city-before.png`, `city-after.png` | the city's frame by the merge base and by the change |
| `city-edge-x6.png` | an 80 × 60 px crop on an edge, before (left) and after (right), 6 × 6 per pixel (nearest) |
| `effects-before.png`, `effects-after.png` | the effects scene's frame |
| `effects-edge-x6.png` | the same zoom on an edge of the effects scene |
| `effects-puff-x4.png` | a 120 × 90 px crop on the puffs, before and after, 4 × 4 per pixel |
| `house-before.png`, `house-after.png` | the house's frame |
| `house-edge-x6.png` | the same zoom on an edge of the house |

Those files are attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/1173/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record that
answer:

```json
{"issue": 1173, "criterion": "#1173.2197a951", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"<each of the ten names>": sha256}, "note"?: string}
```

No file is INCONCLUSIVE; a call whose `screenshots` don't equal this run's SHA-256s (it was made on other pictures) is
INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this run's pictures passes. No other test reads these
pictures or the call.

## Readings where the issue and design leave a choice

- **"The surface reply"** is the GPU surface a scene3d view reports: `view3d`'s `surface` (#386's object, which
  already names what the view drew through) and a canonical render's own reply. The `surface` call answers for #377's
  handoff scenes, which draw no scene3d, and #377's suite (which no one may edit) holds its `msaa` at `"transient"`,
  the design's word for how MSAA targets are stored; so its value isn't the one compared here. "Equals the sample
  count" makes the compared `msaa` a number.
- **"At 4× MSAA"**: no input chooses the count; the surface reports the count scene3d is made with on this device, and
  the tests require 4 on the Mac's Metal device (the reference Macs' Apple GPUs support 4×). Nothing here tests
  another count.
- **"Pixels of partial coverage along its edge"**: read in the resolved, encoded final picture against the box's own
  face and the ground, so the lighting's exact value stays the implementer's. A pixel at 4× MSAA resolves to a blend
  of 1, 2 or 3 quarters; single-sample it is the ground or the face. "Along its edge" is at least 40% as many such
  pixels as the silhouette's boundary pixels (a 4× resolve gives about 60% to 90% on a square turned 10° to 40°, by
  the rasterization rule; single-sample gives none), 90% of them within 2 px of the boundary.
- **"Every frame and every export"**: every frame of a 30-frame play, and canonical renders for all three purposes
  (export at three frames, render-back and the frame-budget check's frame at one), so the scope's "exports,
  render-back and checks alike" are covered; "checks" are the frame-budget run's frame, the canonical render a check
  reads.
- **"Naming the target"**: the failure names the picture (`frame n`, `export frame k`) and scene3d's color target with
  the sample count it reports making it with.
- **"Inside its soft edge"**: the puffs' falloff, 20% to 80% of what they add at most, which excludes their saturated
  core and the faint outer ring; every 2 × 2 window there is checked, at every offset. The puff is large (80 px) so its
  falloff spans many pixels and a filtered upsample's neighbours differ there by several codes.
- **"Seeking equals playing … with MSAA on"** is read on C1's turning box, whose edges are the multisampled pixels,
  in fresh processes on the same machine; the puffs' seek is #420's criterion.
- **"Before and after"**: the merge base's renderer and the change's, both run by the check; "the effects scene" is
  #380's `all` scene with half-resolution puffs added, since the issue's puff finding needs one in it.

Not tested, because no criterion asks or the surface can't reach it: the scope's third line (re-recording goldens and
expected hashes only through an approved proposal, each with old and new hash), which is a process the PR follows;
MSAA counts other than 4; internal scales below 1 with MSAA; the `live` window's canonical events; particles drawn as
dots, sparks or streaks; GPU memory or time with MSAA on.
