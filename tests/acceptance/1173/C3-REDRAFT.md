# C3 blind redraft: a half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge

Criterion `#1173.478ff552`: "A half-resolution puff has no 2 × 2 block of identical pixels inside its soft edge; a
planted block copy fails, naming the emitter".

Files (all new; no other file of this suite was seen or touched): `puffs-redraft.test.ts` (one `describe`, two `it`s,
both carrying the ID), `puffs-redraft-helpers.ts` (the documents, the look, the binary driver, a PNG reader copied
from #386's helpers, and the measure) and `tsconfig.redraft.json` (a copy of #386's `tsconfig.json`).

## The base and what I read

Base `e2e6e1cc` ("Merge pull request #1211 …"), detached. No implementation of #1173 exists there, and I saw no other
branch, commit or ref, and not the suite's first draft.

- Issue #1173 (body, scope, five criteria, proof line).
- AGENTS.md (Proof); `docs/technical-design.md`: Dogfooding, "Tests written first, by a job that never sees the code".
- `docs/canvas-primitives.md`: Particles `particles@1` (4814–4834: `draw: puff | spark | dot | streak`,
  `resolution: full | half = half` for puffs, `emit`, `life`, `motion`, `size`/`opacity` over life, `color` roles),
  and Puff `puff@1` (4350–4360) for what a puff is (a soft sprite, at half resolution when the class says so).
- At the base: `crates/deep-effects-render/src/particles.wgsl` (the puff's shape `0.35 · exp(−3 r²)`, discarded past
  r = 1, added to the linear target; at half resolution `at` is taken at the 2 × 2 block's centre on the even grid,
  lines 134–138, which is what `--planted puff_block_copy` keeps), `crates/deep-gpu-layer/src/effects.rs`
  (`sparks_of`: how a `particles@1` item's params reach the draw; a puff is half resolution unless
  `resolution: "full"`; the emitter's origin is its anchor's position), `crates/deep-canvas-scene3d` (particles@1 is an
  item another module draws).
- The format of earlier GPU suites: `tests/acceptance/386/` (README "The surface under test", `helpers.ts`,
  `upscale.test.ts`, `tsconfig.json`), `tests/acceptance/420/` (`particles.test.ts` and `helpers.ts`: how a
  particles document is authored, `requires: {modules: {scene3d, effects}}`), and `tests/acceptance/378/C1-REDRAFT.md`.

## The surface it uses

Only what the task names for this suite: `deep-gpu run [--planted puff_block_copy]`, one scenario `{out, calls}` per
line, and #378's `view3d` call with `from`, `frames: 1`, `capture: [60]`, `targets: ["final"]`, whose reply's
`frames[i].final` names an 8-bit RGBA PNG in `out` by its SHA-256. No new call, field or reply field. The planted name
is `puff_block_copy`: a half-resolution puff shaded once per 2 × 2 px block on the even grid, that value written to
all four pixels (the base's `particles.wgsl`).

## The fixture

A 320 × 240 view of a scene under an orthographic camera looking along −Z, 8 m across (40 px per m), on a near-black
ground (`#101114`), with tone map none at the exposure whose scale is 1, no finish, deband, bloom or ground grid. Two
`particles@1` emitters, `draw: puff`, each one particle from a point, at rest (ballistic, `v0: [0, 0]`, no gravity, no
drag), `life: [10, 10]`, `size: 48` px, `opacity: 1`, in a mid-grey role (`#808080`): `puff-half` at
`resolution: half` at x = −1.8 m, and `puff-full` at `resolution: full` at x = +1.8 m, 144 px apart. Their anchors
are boxes 2 cm across (under 1 px) in the ground's role. Frame 60 (1 s at 60 fps) of four variants is drawn in one run:
both emitters (the frame measured), each emitter alone, and neither.

Mid grey keeps the crown well below white, so nothing clips: with the base's shading constants the crown is about
code 150 and the falloff drops about 3 to 6 codes per px through the ring.

## The measure: what "inside its soft edge" means

- **Footprint** of an emitter: the pixels where its alone-frame differs from the bare frame by at least 4 codes in R,
  G or B; its centre is their centroid and its radius R that of a disc of their area. It must be within half to one and
  a half times the asked 24 px, or the test fails naming the emitter (the puff didn't draw as asked).
- **Inside its soft edge**: the puff's falloff ring, pixel centres from 0.25 R to 0.8 R from the centre. Inside 0.25 R
  is the crown, where the falloff flattens to its peak and pixels symmetric about the centre may correctly round to one
  code. Outside 0.8 R is the rim, where the tail is a few codes above the ground and the sprite ends.
- **The check**: in the frame with both emitters, every 2 × 2 block (at every offset, not only the even grid) whose
  four pixel centres are all in an emitter's ring is examined; a block whose four pixels have equal R, G and B fails
  with `emitter <id>: N of the M 2 × 2 blocks inside its puff's soft edge are four identical pixels, the first at …`.
  At least 200 blocks must be examined per emitter, or it fails as too few to judge.

`puff-full` is a control: the block copy leaves it alone, so the planted test requires a failure naming `puff-half`
and none naming `puff-full`. That shows the failure names the right emitter, not just any emitter.

A simulation of the measure in the scratchpad (not part of the suite), using the base's shading curve with the
fixture's numbers and four sub-pixel centre offsets, gives 0 identical blocks of about 950 for per-pixel shading
and for a half-resolution target upsampled bilinearly, and 230 to 285 for the block copy. That holds at full
brightness and at a quarter of it.

## Wrong programs

- The base: `puff-half` is drawn by block copy, so the first test fails naming `puff-half` (on a Mac).
- `--planted puff_block_copy`: the second test requires that failure.

## Type check and the run here

`node_modules/.bin/tsc -p tests/acceptance/1173/tsconfig.redraft.json` exits 0 with no output.

Run on this Linux box (linux, Node at ~/.local/bin). The repo's `vitest.config.ts` doesn't load in this
worktree, because the workspace package `@deepbuild/config-eval` isn't built. So the run used a one-line config that
only includes this file:

```
node node_modules/vitest/vitest.mjs run --root . --config <scratch>/vitest.c3.config.mjs tests/acceptance/1173/puffs-redraft.test.ts
```

Both tests fail INCONCLUSIVE, as intended. Nothing is built or drawn off macOS:

```
AssertionError: INCONCLUSIVE: the GPU layer draws these pixels on macOS's Metal device; this is linux; this is not a pass
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

On a Mac, run it with `npx vitest run tests/acceptance/1173/puffs-redraft.test.ts`. That run has not been done.
