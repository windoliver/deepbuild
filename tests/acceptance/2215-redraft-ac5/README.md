# Blind redraft for #2215, criterion 5: "Nothing else moves: every corpus document without both features on one material keeps its frame hashes in raster"

Criterion ID `#2215.8e4252d8`, the first 8 hex digits of SHA-256 of the criterion's text, trimmed, white space
collapsed (`criterionId` in `scripts/proof-change.mjs`). It is raster's half of the old criterion 5; the finals' half
moved to #3143 with the rest of the final, and isn't here. Written from issue #2215, the design sections it links and
base commit `eb3be2014` ("Merge pull request #3061 …"), by a job that never saw an implementation (AGENTS.md, Proof;
design: Dogfooding). One file, `corpus.test.ts`, with two tests, each named `AC5 #2215.8e4252d8 …`.

## What was read

- Issue #2215: its Scope (raster keeps its round blur; a frame that draws a part with both `transmission` above 0 and
  `anisotropy.strength` other than 0 lists the part and `anisotropic_transmission` in its receipt; goldens of documents
  with both features on one material are out of the task), criterion 5 and its Proof line ("the corpus's raster hashes
  against the merge base"). Criteria marked moved to #3143 were not read for tests.
- `node scripts/design-section.mjs --issue 2215`: Material (`anisotropy: {strength: −1..1 = 0, rotation}`,
  `transmission: f32 = 0`; anisotropy and transmission are features, each off at its zero, and "only parts that use one
  pay for it"; transmission samples a mipped copy of the opaque scene at a level its roughness sets) and Path-traced
  finals.
- The base, for surfaces only: `crates/deep-gpu-layer/src/main.rs` (the `run` line protocol and the `--planted` table,
  where #428's `transmission_ignores_roughness` lives), `view3d.rs` and `view3d/parse.rs` (`targets`, `capture`,
  `packs`, `fps`, `receipt: true` and the reply's `receipt`; each frame's `final` PNG and `linear` f32 RGBA named by
  their SHA-256), `crates/deep-canvas-scene3d/src/light.rs` (`material@1` into `Lobes`: `anisotropy` is
  `anisotropy.strength`, `transmission` is the top-level field), and, to learn which parts that plant reaches,
  `crates/deep-gpu-layer/src/session3.rs` (the plant is one bit of the lights' planted word) and
  `crates/deep-scene3d-render/src/scene3d.wgsl` (the bit is read only in `transmitted()`, where it sets the blur's
  roughness to 0, so it moves only a transmissive part whose roughness isn't 0).
- Suites, as models and imports: `tests/acceptance/428/` (`helpers.ts` for the build, `runGpu`, the documents and the
  looks; `transmission.test.ts` for the frosted panes; `sheen-anisotropy-translucency.test.ts` for the brushed ball),
  `tests/acceptance/422/` (`helpers.ts`'s `castle()`; its README's rule that a golden recorded under another
  environment reads INCONCLUSIVE), `tests/acceptance/481/`, and `tests/acceptance/268-redraft-ac4/` for this README's
  shape.

## The reading

- **Both features on one material** is one `material@1` whose `transmission` is above 0 and whose
  `anisotropy.strength` is other than 0. A transmissive material with `anisotropy: {strength: 0}`, an anisotropic one
  with `transmission: 0`, and a document holding transmission on one material and anisotropy on another all have
  neither, so the corpus holds each of them and they must not move.
- **The corpus** isn't named by the issue or the design, so this job chose one (below): four documents, each from the
  checkout or built as an existing suite builds it, and the test checks that none of them carries both features on one
  material before it draws.
- **Frame hashes in raster** are the SHA-256s `view3d` names frame 0's `final` and `linear` targets by, each file read
  and checked to hash to its name. Both are held: the linear target catches a change the tone map would round away.
  Every member is drawn with `receipt: true`, so the draw takes the reply the change touches; the receipt's content is
  criterion 4's and is not compared here.
- **Keeps** is byte for byte: both hashes equal those recorded at the base. "Against the merge base" is read as
  hashes recorded once at the base on one Mac (below), not a base binary drawn on each run.

## The corpus

| Member | What it is | Why it is in the corpus |
|---|---|---|
| `castle` | `packs/examples/castle.json` in `packs/examples/castle.look.json`, its recipes from `packs/composites-1.0.0`, frame 0 at its own 1280 × 800 and 30 fps (#422's castle, through `../422/helpers.ts`'s `castle()`) | The broad scene from the checkout: 64 point lights and a sun, a `sky@1` with its environment, height fog and stars, 28 puffs and a cloud bank, walls, towers, a house, two lamps, islands, a door, an emissive material and the look's paints, under a filmic look with bloom. Neither feature anywhere |
| `lobe-gallery` | Built here with #428's helpers: sixteen balls (uv0 about the sphere) in sixteen materials before a stone-courses wall on a floor, under #428's daylight sky with its environment, a shadowed sun and two point lights, 960 × 540, #428's `look('filmic', -1.5)` | Many materials and lights in one frame: plastic, metal, coat, sheen, thin and wrap translucency, iridescence, specular color, diffuse roughness, retroreflection, flakes, emission; anisotropy alone (`brushed`: strength 0.7 turned 30°; `satin`: strength −0.6 with `transmission: 0`); transmission alone (`glass`: with absorption and dispersion; `clear`: with `anisotropy: {strength: 0, rotation: 45}`). Both features in one document on separate materials, and both boundaries of "both" |
| `frosted-panes` | #428 AC3's panes, as `transmission.test.ts`'s `panesDoc(true)` builds them: three panes with `transmission: 1`, `ior: 1.5` at roughness 0, 0.3 and 0.6 over a black-to-white edge, no light, 512 × 512, #428's plain look | Transmission and no anisotropy, at three blur levels; the member the planted program moves |
| `brushed-ball` | #428 AC1's `brushed` sphere (`sphereDoc`): white metal at roughness 0.2 with `anisotropy: {strength: 1}` under a sun behind the camera, 320 × 320, #428's plain look | Anisotropy and no transmission, at full strength |

The four are drawn by one `deep-gpu run` with four `view3d` calls, frame 0 each, `targets: ["final", "linear"]`,
`receipt: true`. The gallery's two transmissive materials have roughness 0, so the planted program can't reach them.

## How the hashes were recorded

`hashes.json` was written by `corpus.test.ts` itself. With no `hashes.json` in this folder, test 1 draws the corpus,
writes the hashes it drew to `target/acceptance/2215-redraft-ac5/hashes.json` with each member's final PNG beside it,
and reads BLOCKED (both tests do, with no recorded hashes). At the base `eb3be2014`, with only this folder and the
`scripts/lanes.mjs` line added, on a Mac17,10 (`sysctl -n hw.model`) under macOS 27.2 (`sw_vers -productVersion`), not
a reference Mac, with `deep-gpu` built by the suite in debug (`cargo build --locked --bin deep-gpu`, Rust 1.99.1,
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`), on Nov 22, 2026, under a load near 200:

1. Run 1 drew the corpus, wrote the candidate and read BLOCKED. The four PNGs were looked at: the castle on its islands
   above the clouds; all sixteen gallery balls in frame, both glasses see-through and `brushed` streaked; the three
   panes over the edge, the 0.3 and 0.6 edges wider; the ball's highlight stretched across it. (A first draft of the
   gallery framed only ten of its balls, `clear` among those out of frame; it was reframed and run 1 drawn again.
   The other three members drew the same six hashes in both, from separate processes.)
2. The candidate was copied here unchanged.
3. Run 2, a separate process, drew the corpus again: test 1 read PASS, all eight hashes equal to run 1's, so the two
   runs agreed. Run 3, after a log line was added to test 2 (no input changed), read the same eight again.

Each member's entry also holds `input`, the SHA-256 of what its frames read besides the program: the generated
document, or for the castle the bytes of `castle.json`, `castle.look.json` and every file of `packs/composites-1.0.0`,
and the call's other fields (look, size, fps, targets, capture, `receipt`).

## What reads INCONCLUSIVE or BLOCKED

- On a machine whose `sysctl -n hw.model` or `sw_vers -productVersion` differs from the recording's, both tests read
  INCONCLUSIVE, never PASS or FAIL: another GPU or Metal driver may draw other bytes for the same program (#422's
  convention). This Mac is not a reference Mac; the test doesn't need one, only the recording's model and version.
  Checked once by hand: with the recorded model changed to Mac15,7, both read INCONCLUSIVE (`BASE-FAILURE.txt`).
- When a member's `input` isn't the recorded one (its document, look, packs or call changed), both read INCONCLUSIVE,
  naming the member: its frames can't be held to the base's.
- With no `hashes.json`, both read BLOCKED; a view3d `unsupported_platform` reply, or any platform but macOS, reads
  INCONCLUSIVE.

## The planted run

Test 2 draws the corpus under the base's `--planted transmission_ignores_roughness` (#428's: a transmissive part's
blur read at roughness 0, whatever its roughness) and requires the comparison to fail naming `frosted-panes` and no
other member. At the base it does (`BASE-FAILURE.txt`), so the comparison would catch a change to how one member draws
and pins it to that member.

## Run it

```sh
npm ci   # once, if node_modules is missing
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
CARGO_TARGET_DIR=<a build folder> CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2215-redraft-ac5 --silent=false --testTimeout=600000 --hookTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2215-redraft-ac5/tsconfig.json
```

It builds `deep-gpu` from the working tree through `../428/helpers.ts` (`useGpu`: `cargo build --locked --bin
deep-gpu`), so a run judges the working tree's program. It writes into temporary folders it deletes, except a
recording run, which keeps `target/acceptance/2215-redraft-ac5/`. `scripts/lanes.mjs` lists the folder in `alone`.
It times nothing.
