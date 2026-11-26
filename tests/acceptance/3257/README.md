# Acceptance tests for #3257: a cutout keeps its coverage as it recedes, and color is averaged by alpha

Written first, blind, from issue #3257 (its scope, eight acceptance criteria, proof line and "Runs on" line), the design
sections it links and the base commit `b41a1b521` ("Merge pull request #3324 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). One file per
criterion, and exactly the two planted chains the criteria name.

## What was read

- The issue, live (`gh issue view 3257 --json title,body,comments`; it has no comments).
- `docs/canvas-primitives.md` (`node scripts/design-section.mjs --issue 3257`): Material (`alpha_mode`), Material:
  texture maps (`alpha_cutoff`, the formats, the decoded-image cap, "one transcode per map"), Decode worker.
  `docs/technical-design.md`: Dogfooding; Tests written first.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/423/` (maps, the receipt, `workers`,
  the taste call's record), `1040/maps.test.ts` and `taste.test.ts`, `424/picks.test.ts` (a mask material, the slab and
  its uv), `1634/` (helpers, the timing judge), `2034/` and `2054/` (README, `lane.json`), `3219/` (a pinned merge base),
  `172/` and `2892/` (the Linux leg); `crates/deep-codecs/src/{maps,lib}.rs` (the chain, `map_job`, `serve`),
  `crates/deep-gpu-layer/src/{main,textures}.rs` (the worker's entry, the receipt, the maps kept per run),
  `crates/deep-show/src/{main,maps}.rs`, `crates/deep-player/src/page.rs` (`ready_maps`), `crates/deep-canvas-scene3d/src/
  {light,uv,builders}.rs`, `scene3d.wgsl` (the discard), `scripts/{player-wasm,lanes,lanes-lists,benchmark,throttle}.mjs`.
  No expected value comes from them but the merge base's own chain, which the criteria compare with.

## What the base already does, which these tests don't credit

The decode worker answers a `transcode` job with the chain's format, size, mips and bytes and writes it to `out`; a PNG's
level 0 is the file's own; the receipt names each map once a run by hash and role with `transcoded`; a mask material
discards below its cutoff in the color and ID passes alike; a second load transcodes nothing. A map with alpha 255
throughout already gives the chain AC5 asks for. An unknown job field such as `alpha_cutoff` is ignored. There is no
`kept`, no `alpha_cutoff` in a row, no second chain for a second cutoff and no `map_chain` in the player.

## Run them

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 720 -- scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3257 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/3257
rm -rf tests/acceptance/3257/node_modules/.vite
```

- **Builds.** Every file builds `deep-gpu` (#1634's `useGpu`). `ac1`, `ac3`, `ac5` and `ac8` also build the merge base's:
  the base commit above is pinned (`BASE` in `helpers.ts`), so the comparison stays with the plain box after the change
  merges; its tree comes from `git archive` with every `GIT_*` variable removed, into
  `<target>/acceptance-3257-base/`, which the files share (a cold build the first time). `ac7` builds both for release,
  only where a timing can be judged. So the folder runs alone: `lane.json` says so. **The implementer adds
  `timed.push('tests/acceptance/3257/ac7-budget.test.ts');` to `scripts/lanes-lists.mjs`**; AC7's test reads that list.
- **Platform** (the issue's "Runs on"). The chains, the receipt and the player's wasm need no GPU: `ac1`, `ac2`, `ac4` and
  `ac5`'s first test run on any machine the binary builds on (`ac5`'s on `--backend noop`). The drawn criteria, `ac3`,
  `ac5`'s second test and `ac8`, need a reference Mac (the Macs `scripts/benchmark.mjs` lists), `ac6` needs macOS for
  its reference hashes, and its Linux test `DEEP_LINUX_AARCH64` and `DEEP_LINUX_AARCH64_DIR`; each is `INCONCLUSIVE:`
  without, never passing. `ac7` is `INCONCLUSIVE:` wherever the perf lane can't judge a timing.

## Criteria to tests

IDs are `#3257.` and the first 8 hex digits of SHA-256 of each criterion's text as its `- [ ] ` line reads, trimmed,
whitespace collapsed (the trace lane's `criterionId`). Each test's name starts with `AC<n> #3257.<id>`; each file's
header states its fixture, numbers and wrong programs. No test passes when every function it calls returns nothing: each
reads a chain, a row, a picture or a hash it names.

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#3257.99ce0129` | `ac1-coverage.test.ts` (1) | Decode worker, no GPU. The merge base's chain of the fence keeps 43.75% of level 1 and nothing from level 2, printed. The change's, at `alpha_cutoff: 0.5`: level 0 the file's own, levels 1 to 4 each within one point of 15 ÷ 64, the two stored alphas of the scope, `kept` what the bytes keep |
| AC2 `#3257.0856a85c` | `ac2-quadrants.test.ts` (1) | The planted first-row chain passes AC1's share check and fails at levels 1 to 4, its first fault naming level 1's top-left quadrant; the control passes; then the product's chain: each quadrant of levels 0 to 4 within two texels of its share |
| AC3 `#3257.699e8b81` | `ac3-drawn.test.ts` (1) | Metal, reference Mac. The merge base's four shares printed, 0 at 32 px; the change's within 3 points of 23.4375% at 256, 128, 64 and 32 px across |
| AC4 `#3257.09613218` | `ac4-color.test.ts` (1) | The planted plain-color chain fails naming level 1 and its texel (0, 0); the control passes; then the product's mask chain: every kept texel of nine levels within 2 codes of the green, and the same for a `blend` map's texels with alpha and for a four-color tile's alpha-weighted mean (the scope) |
| AC5 `#3257.d4ceba15` | `ac5-keys.test.ts` (2) | Any machine. Alpha-255 maps in two roles and two sizes are the merge base's chains byte for byte; one image at 0.5 and 0.3 is two chains keeping 15 ÷ 64 and 24 ÷ 64, two receipt rows, `transcoded` once, two transcode jobs. Reference Mac: two squares draw each its own share |
| AC6 `#3257.8b7b7fd8` | `ac6-targets.test.ts` (2) | Four chains' SHA-256 in the player's committed wasm, run in Node, and on Linux equal macOS's, and the chains at 0.5, 0.3 and none are three |
| AC7 `#3257.c1dee41c` | `ac7-budget.test.ts` (1) | `timed` lists the file and what is timed answers `kept`; then, where the lane can judge it, five release runs of a held-open worker each: the mask map under 1.5 times the merge base's time, a blend map and an opaque map under 1.05 |
| AC8 `#3257.389c0d78` | `ac8-taste.test.ts` (1) | The run's four pictures, the pairs different, and the recorded call on exactly them; without it INCONCLUSIVE |

The proof line: "each level's kept share on the merge base and after" and "the merge base's empty square" are AC1's and
AC3's printed runs, "the quadrant shares" AC2's, "the drawn shares" AC3's, "the green map's levels" AC4's, "the two keyed
chains" AC5's, "the hashes on the three targets" AC6's.

## The surface under test

The issue names `kept`, `alpha_cutoff` and the keys, and leaves how a job, a row and the player say them. These are this
job's choices, each the plainest extension of what the base has. The implementer provides exactly these.

1. **The `transcode` job gains `alpha_cutoff: number`**, the `mask` material's, sent where a `mask` material samples the
   map and absent where none does (so a job without it is today's job). Every other field is the base's.
2. **The `transcode` reply gains `kept: [number]`** where the job names `alpha_cutoff`: one share from 0 to 1 for each
   level, largest first, the fraction of that level's texels whose stored alpha ÷ 255 is at or above the cutoff, within
   1e-6 of what the bytes in `out` keep. A reply without a cutoff may carry one or not.
3. **`receipt.maps` (view3d's `receipt: true`) holds one row a chain**: for a map a `mask` material samples, the base's
   fields plus `alpha_cutoff` (within 1e-6 of the material's) and `kept` as in 2. Two cutoffs are two rows with one
   `sha256`; `transcoded` is each row's own. A map no `mask` material samples keeps the base's row.
4. **`material@1`'s `alpha_cutoff`, `alpha_mode: mask`, `maps.base_color`, the discard test and the uploads as at the
   base**: each material samples the chain of its own cutoff (AC5's drawn squares).
5. **The web player's full set exports `map_chain(bytes: Uint8Array, role: string, alpha_cutoff?: number): Uint8Array`**
   from its page glue, in the committed `crates/deep-player/web/dist/full/` (`player.js`, `player_bg.wasm`, `player.json`
   with the wasm's SHA-256), rebuilt by `scripts/player-wasm.mjs`: the chain of a PNG or a JPEG map, every level end to
   end, largest first, made by the code the page's `ready_maps` calls (Rust: `#[wasm_bindgen] fn map_chain(bytes: &[u8],
   role: &str, alpha_cutoff: Option<f64>) -> Result<Vec<u8>, JsValue>`, gated with the full set). It needs no GPU, font or
   document, so Node runs it.
6. **`deep-show decode-worker`** on Linux answers the same jobs as `deep-gpu decode-worker` (as at the base); AC6's Linux
   leg builds `deep-show`.
7. **No planted program**: the two wrong chains are built in the suite (`chains.ts`), since the criteria hold a chain, and
   they prove the checkers rather than the product.

## The chains made here (`chains.ts`)

- `boxChain`: the merge base's published rule, operation by operation in f32. Its alphas are the merge base's byte for
  byte (AC1 checks them against the binary's); its colors go through this engine's `pow` and are compared nowhere.
- `controlChain`: alphas spread by counts split down through the level's quarters, colors weighted by alpha. It isn't the
  issue's walk; it is here so that the checkers are seen to pass a chain that meets the criteria.
- `firstRowChain` (AC2's planted chain): each level's right count filled from the first row. `plainColorChain` (AC4's):
  the control's alphas, colors averaged with no regard for alpha.
- The exact weights of the walk aren't given, so no test holds a chain to a recorded hash or place: shares, counts per
  quadrant, stored alphas, colors, and equality between targets.

## Fixtures

Made in `chains.ts` and `helpers.ts`; none is on disk. Maps are 8-bit RGBA PNGs with no gamma or ICC chunk.

- **The fence**: 256 × 256, opaque white lines one texel wide every 8 texels each way (x or y a multiple of 8), alpha 0
  between: 15 ÷ 64 of level 0. **The green fence**: the same lines in (46, 139, 60), magenta stored under the gaps.
- **The two-cutoff image** (AC5): the fence's lines at alpha 255 and a 3 × 3 patch at alpha 100 (0.392) inside each cell.
- **The tile** (AC4): 64 × 64 of four texels, (255, 255, 255) at alpha 255, (20, 40, 200) at 160, (200, 30, 30) at 96
  and (0, 255, 0) at 0; its mean weighted by alpha in linear light is (205, 189, 215), its plain mean (169, 189, 169).
- **The noise** (AC6): 512 × 512 texels of random color and alpha from a fixed seed. **The opaque maps** (AC5): 256 × 256
  and 130 × 61 of random color. **The large map** (AC7): 2,048 × 2,048, a smooth gradient with the fence's alpha or 255.
- **The drawn square** (AC3, AC5): a `slab@1` 2 × 2 m, 2 mm thick, face at z = 0, `uv0: planar {axis: z}` over 2 m, an
  unlit `mask` material of white base color, 512 × 512 px, a 90° field of view (focal length 256 px), the eye on +z at 2,
  4, 8 and 16 m: 256, 128, 64 and 32 px, its pixel centres on the texel centres of levels 0, 1, 2 and 3, sampled with the
  look's default `filter_taps`. Black sky, no light.
- **The cards** (AC8): 560 × 288 px, four copies of the card at the four distances side by side, `mask` at 0.5, on a plain
  blue-grey sky. The leaf card is a bent stem and eleven pairs of thin leaflets with edges softened over a texel and
  near-white stored under its transparent texels.

## Readings where the issue and design leave a choice

- **"23.4%"** is 15 ÷ 64. **"Within one percentage point of that"**: the share of each level from 16 × 16 up, against
  15 ÷ 64; level 0 exactly. **"Kept"** is stored alpha ÷ 255 at or above the cutoff, the shader's test. **`kept: [f32]`** is
  a share from 0 to 1, not a percentage.
- **"Its share"** (AC2) is level 0's kept or not, box-filtered down to the level and summed over the quadrant. "Within two
  texels" is 2 or less, at level 0 too. Checked in a scratch script: walks of row order with four fixed 16ths weights that
  meet AC1, AC2 and AC4's green together on this fence exist (8 of 2,907 tried, counting how the edges carry), while the
  7-3-5-1 weights and dropped edges miss AC2 at level 2 (5 texels). So the criteria hold together, though not by any
  weights.
- **"The mean of the four texels above it weighted by their alpha"** in a mask chain: the stored alphas are the two
  thresholded ones, so a texel's weight is its own unthresholded box alpha (else AC4 couldn't hold). **"2 code values"**:
  each of R, G and B; the expected tile color (AC4) is also compared within 2, which allows for rounding.
- **"This holds for every base color map whose alpha isn't 255 throughout, mask or blend"**: a job without `alpha_cutoff`
  whose map has alpha below 255 averages color by alpha and keeps the box's mean alpha ("not in this task: alpha in
  `blend`"), within 1 code of the merge base's.
- **"A map with alpha 255 throughout"** (AC5) is a job without `alpha_cutoff`: "a map no `mask` material samples and whose
  alpha is 255 throughout keeps the chain it has today". With a cutoff, an opaque map stores the higher alpha.
- **"Under two keys"** is two receipt rows and two transcode jobs, the second load neither; no key's text is read.
- **"The same on macOS, on Linux and in the web player's wasm32 build"**: chains this issue makes, `mask` and `blend`; an
  opaque map's chain is the base's, which uses the platform's `pow`, and isn't compared across platforms. A wasm that isn't
  rebuilt fails by hash.
- **"The share of its px the object-ID pass keeps"** is the count of `ids` pixels naming the square over its px². Off
  framing isn't tested: a frame that isn't aligned to the texel grid filters between texels.
- **"That run is shown"**: the merge base's runs are printed by AC1 and AC3 and saved in `BASE-FAILURE.txt` when a grant
  came; the merge base is the commit the suite was written on, pinned.
- **"Takes under 1.5 times as long"**: the time from a job's line sent to its reply read in a decode worker, the PNG read
  and `out` write included, as a ratio of medians. **"No longer"**: within the lane's own 5% noise margin of the merge
  base's time, a limit of 1.05. "A map no `mask` material samples" is an opaque map and a `blend` map, each timed.
- **"The four distances"** (AC8) are AC3's; before and after are the merge base's and this checkout's frames.

Not tested, because no criterion asks: a KTX2 map's own chain and the transcode of a KTX2 without one, `add` materials,
the encode job's chains, emission, normal and occlusion maps, an image a `mask` material and another both sample, a
second cutoff in a web bundle or in `deep-show` (the code and key are shared, AC5 and AC6 hold them), the decoded-image
cap's count of two chains, and color under level 0's transparent texels.

## The taste call

`ac8-taste.test.ts` writes `target/acceptance/3257/{fence,leaf}-{before,after}.png`, the renderer's own final targets,
and prints each SHA-256. The owner's one call is recorded in `tests/acceptance/3257/TASTE.json`:
`{issue: 3257, criterion: "#3257.389c0d78", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots:
{"fence-before.png": <sha256>, "fence-after.png": …, "leaf-before.png": …, "leaf-after.png": …}, note?}`. None, or one
made on other pictures, is INCONCLUSIVE; no other test reads it.
