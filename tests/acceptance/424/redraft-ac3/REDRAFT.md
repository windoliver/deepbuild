# Blind redraft of #424's AC3 test

Written by a fresh run of the acceptance-test job (technical design: Dogfooding; "Tests written first, by a job that
never sees the code"), for one criterion of issue #424. It was written from the issue, the design and the base commit
`79d98cbc` ("Merge pull request #1242 …") only. No implementation, later commit, other branch, PR or existing
`tests/acceptance/424/` suite was opened. The folder stands alone: it imports only node built-ins and vitest, and its
tsconfig repeats the root's options instead of extending them.

## The criterion

| ID | Criterion |
|---|---|
| AC3 `#424.649ef843` | An engine block at adjust opacity 0.3 over its crankshaft shows each crankshaft pixel as 0.7 of its value with the block hidden plus 0.3 of the block's own shaded color, within 2 code values, with none of the block's back faces drawn; and a channel that keys a material's emission_strength from 0 to 4 changes only the pixels of the parts that use it and compiles no pipeline |

The ID was checked: SHA-256 of the text (trimmed, whitespace collapsed, the leading `- [ ] ` dropped) starts
`649ef843`. Each test's name starts `AC3 #424.649ef843`.

## What was read

- **Issue #424**: its scope ("opacity below 1 draws it see-through after a depth pass of its own, so only its nearest
  surface shows"), its fields, its eleven criteria and its proof line ("The engine block and beam fixtures read back
  within their code values"). #422 and #423 were read for vocabulary only.
- **The oracle page** (`doneright/oracles/issues/424.md` in DeepBuildAI/deepbuild, branch `doneright`) answered 404 on
  this account, and so did the repository itself. The issue says the oracle covers 1 of 11 criteria and doesn't say
  which one. Nothing from it is used here.
- **AGENTS.md** (Proof). **docs/technical-design.md** (Dogfooding).
- **docs/canvas-primitives.md**:
  - Object: `adjust` reaches 3D shading; "With opacity below 1 it draws see-through after a depth pass of its own, so
    only its nearest surface shows over what's behind it".
  - Object: see-through order.
  - Item and kind (`adjust: {opacity …}`, `visible`) and Item and kind: adjust.
  - Material: `emission`, `emission_strength`; "values live in a material buffer indexed per instance, so changing a
    value never recompiles"; "a channel or a driver keys any of its numbers at `items/<id>/params/<name>`"; "Materials
    are content-keyed assets"; features compiled once per feature set.
  - Channel and key; Builder (`extrude {outline; holes; depth: {from, to}}`, `lathe {outline [[r, y]], caps}`); Look
    `look@1`; The cost model ("a patch that changes only values and once for one that needs a new pipeline").
- **At the base, for conventions and surfaces only**:
  - `crates/deep-gpu-layer`: `main.rs` (the `run` scenario and the `Planted` table); `view3d.rs`'s fields (`targets:
    final | linear | ids`, `capture`, `frames`, `fps`, `counts`, and `cold`, whose report lists pipelines by name);
    `session3.rs`'s `pipelines`.
  - `crates/deep-canvas-scene3d`: `extrude@1`'s outline and holes; `lathe@1`'s outline; a document's `channels`
    section; an item's `adjust.opacity` and `material`; a `material@1`'s `emission × emission_strength`.
  - `crates/deep-scene3d-render/src/output.wgsl`: the sRGB encode.
  - The suites `tests/acceptance/378` (the final frame is the sRGB encoding of the linear target under tone map none
    at scale 1, within one code), `421`, `422` and `423` (helpers, the INCONCLUSIVE gate off macOS, the linear and ID
    target readers, all copied here), and `854` (pipelines named in a report).

## Assumed surfaces

The base already has every call and field used here except one.

1. **`view3d` with `counts: true` reports, on every frame, `compiled: [name]`.** It lists every pipeline compile the
   view's renderer ran since the previous frame drew, on any thread, one entry per compile, so a recompile of a name
   it already held counts too. Frame 0 lists the compiles since the call began. The names are the ones `cold`'s
   report uses (#854). The base keeps the renderer's compiled names (`session3::pipelines`), but it reports them only
   for the first frame, under `cold`, so nothing in the base can read a compile on a later frame.
2. Used as the base has them: `view3d`'s `targets` (the final PNG, the linear f32 target before exposure, the ID PNG
   with `picks`); an item's `adjust: {opacity}`; `material@1`'s `emission` and `emission_strength`; a document
   channel `{target: "items/glow/params/emission_strength", type: "f32", keys}`. One more assumption: **the linear
   target holds the frame after the see-through items composite**, as the frame the output pass encodes. The test
   reads the see-through frame only on its final target, and reads the linear target only for the block hidden and
   the block opaque, so the assumption is only that those two calls write their linear targets as they do today.

The criterion names no planted twin, so this redraft adds no `--planted` name. Its judges are pure functions, and
they were fed CPU stand-ins for the wrong programs instead (below).

## The fixture

**The engine** (`helpers.ts`: `engineDoc`), drawn at 480 × 360. The camera is at (2.4, 1.5, 0.5), aimed at the origin,
fov 50°. A sun of 2 lx shines from (0.557, 0.766, 0.321) with no shadow map. The sky is near black, with an even
ambient of 0.06 so back faces aren't black. The look is #378's plain look: tone map none, scale 1, no finish, deband,
bloom or grid.

- **The block** is `extrude@1`: a 1.2 × 1.0 m outline, from z −0.8 to 0.8 m, iron red `[0.5, 0.06, 0.05]`. Its holes
  are a 0.27 m bore and two water jackets, one slot above the bore and one beside it.
- **The crankshaft** is `lathe@1` turned onto z: journals of r 0.12, webs of r 0.22, z ±0.7 m, steel blue
  `[0.08, 0.2, 0.6]`. It sits wholly inside the bore. The bore's open ends face away from the camera, so the
  crankshaft shows nowhere except through the block.
- **Three calls in one process**:
  - `absent`: the block hidden. It is left out of the document, which changes no light because nothing casts a
    shadow.
  - `opaque`: no `adjust`, so the block shows its own shaded color.
  - `see_through`: `adjust: {opacity: 0.3}`.
- **A CPU ray cast of this geometry** (scratch, not committed) put the crankshaft on 13,479 pixels. On every one of
  them the ray passes, before the crankshaft, two front faces of the block (the outer wall and a jacket's far wall)
  and two back faces (the jacket's near wall and the bore's near wall). On 611 of them it passes three of each.

**The emission** (`helpers.ts`: `emissionDoc`), drawn at 480 × 360, six frames at 4 fps. It uses the same sun, sky and
look, and a grey floor.

- **Materials**: `glow` and `twin` hold identical numbers: base 0.4, emission `[1, 1, 1]`, `emission_strength: 0`.
- **The `glow` parts**: `glow_ball` (r 0.3) and `glow_box` (0.45 m).
- **The `twin` parts**: `twin_ball` and `twin_box`. The glow ball stands in front of the twin ball, so their
  silhouettes touch.
- **The channel** keys `items/glow/params/emission_strength`: 0 at 0 s to 4 at 1 s, linear. Frames 0 to 5 therefore
  draw at strength 0, 1, 2, 3, 4 and 4.

## The measure

**The block** (`judgeComposite`):

- **Which pixels.** The judged pixels are every pixel whose ID with the block hidden is `crankshaft`: "each crankshaft
  pixel", edge pixels included. A fixture check requires each of them to be `block` in the opaque call's ID target, so
  the block is over its crankshaft, and requires more than 5,000 of them.
- **The comparison.** At each judged pixel, every channel of the see-through call's final code (what is shown) must
  be within 2 of `code(0.7 × hidden + 0.3 × opaque)`. Here `hidden` and `opaque` are the other two calls' linear values
  at that pixel, and `code` is the sRGB encoding to an unrounded 8-bit value.
- **Why mix in linear light.** The design blends in linear light and never in gamma sRGB (Channel and key: "It can
  never: … blend in gamma sRGB"). The output pass encodes that light, which #378 holds to one code under this look.
- **Why edge pixels are fair.** The mix is linear in coverage. At an edge, the opaque call's pixel is a coverage mix of
  block and behind, and 0.7 × hidden + 0.3 × opaque is exactly what a coverage-weighted 0.3 layer over the hidden
  scene gives.
- **The 2 codes** are the criterion's own tolerance.

**The emission** (`judgeEmission`). Each frame is compared with frame 0, at strength 0:

- **Only those parts change.** Every pixel farther than 2 px (Chebyshev) from a `glow` pixel of the ID target must
  show the same code on every channel at every later frame. That covers both twin parts, the floor and the sky. The
  2 px margin leaves out the glow parts' antialiased edge, whose pixels are partly glow. The test requires more than
  500 judged pixels of each of `twin_ball`, `twin_box` and `floor`.
- **Those parts do change, in step with the keys.** Every pixel at least 1 px inside a glow part must change by more
  than 2 codes on some channel at strength 4. In linear light, its rise at strength s must be s ÷ 4 of its rise at
  strength 4, within 1% of that rise plus 1e-4. So the keyed values 0, 1, 2, 3 and 4 reach the shading as values. The
  test requires more than 1,000 such pixels per glow part.
- **No pipeline compiles.** Frames 1 to 5 report `compiled: []`. Frame 0 must report the view's opening compiles, or
  the report reads nothing.

## Wrong programs it catches

These were checked with CPU stand-ins fed to the two judges (scratch, not committed; the output is summarized):

| Wrong program | Result |
|---|---|
| The right program: the nearest surface over the opaque scene, in linear light | passes, worst 0.49 codes |
| Every face of the block drawn back to front, back faces included | fails by 17.6 codes, naming the pixel |
| Back faces culled but no depth pass of its own (both front faces blend) | fails by 19.6 codes, naming the pixel |
| Blended in sRGB codes | fails by 29.7 codes |
| Opacity applied twice (premultiplied, then blended at 0.3) | fails by 35.7 codes |
| The channel keys a content-shared material slot, so `twin`'s parts glow too | fails, naming a `twin_ball` pixel |
| Strength above 0 switches to an emissive pipeline variant | fails, naming the frame and the pipeline |
| Emission switched on or off, not keyed by value | fails, naming the frame, the pixel and the rise |
| Glow spilling 4 px past its part | fails, naming a `floor` pixel |
| The channel never reaching the shading | fails, naming a glow pixel that didn't change |

On a real run it also catches these:

- The base itself, at the `compiled` report it lacks: no frame reports `compiled`.
- A see-through block shaded differently from its opaque self.
- A see-through draw that hides what's behind.

## Readings

- **"With the block hidden"** is read as the block left out of the document. With no shadow map and no
  ambient-occlusion depth from a see-through item, hiding the block and removing it give the same crankshaft pixels.
- **"The block's own shaded color"** is the block drawn opaque, from the same camera, in the same process.
- **"Code values"** are the final target's 8-bit sRGB codes, what is shown.
- **"Parts"** are read as items, each with one `material`. "The parts that use it" are the items whose `material` is
  `glow`.
- **"Compiles no pipeline"** is read on every frame after the first, while the strength moves from 0 to 4, as
  compiles of any pipeline by name.

## Run them

```sh
npm ci                          # once, if node_modules is missing
node node_modules/.bin/tsc -p tests/acceptance/424/redraft-ac3/tsconfig.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/424/redraft-ac3
```

On macOS the file builds `deep-gpu` with cargo once, then draws on Metal. Off macOS it builds nothing, and each test
fails with a message starting `INCONCLUSIVE:`. Nothing is gated on the Mac's model, power or load. A run with
`--root` may leave Vitest's cache in `tests/acceptance/424/redraft-ac3/node_modules/.vite`; delete it.

## What ran here

On Linux (Node 24.22.0, at the base `79d98cbc`, with these files added):

- **The type check** (`node_modules/.bin/tsc -p tests/acceptance/424/redraft-ac3/tsconfig.json`) exits 0.
- **Vitest, run once** (checkout path shortened to `<repo>`):

```
 RUN  v5.0.5 <repo>/tests/acceptance/424/redraft-ac3

 ❯ ac3.test.ts (2 tests | 2 failed) 28ms
   ❯ AC3 #424.649ef843 see-through in 3D and a keyed emission (2)
     × AC3 #424.649ef843 an engine block at adjust opacity 0.3 shows each crankshaft pixel as 0.7 of it with the block hidden plus 0.3 of the block's own shaded color, within 2 codes, no back face drawn 14ms
     × AC3 #424.649ef843 a channel keying a material's emission_strength from 0 to 4 changes only the pixels of the parts that use it and compiles no pipeline 11ms

 FAIL  ac3.test.ts > … > AC3 #424.649ef843 an engine block at adjust opacity 0.3 shows each crankshaft pixel as 0.7 of it …
AssertionError: INCONCLUSIVE: the GPU layer draws these pixels on macOS's Metal device; this is linux; this is not a pass
 ❯ requireMetal helpers.ts:73:18
 ❯ ac3.test.ts:31:5

 FAIL  ac3.test.ts > … > AC3 #424.649ef843 a channel keying a material's emission_strength from 0 to 4 …
AssertionError: INCONCLUSIVE: the GPU layer draws these pixels on macOS's Metal device; this is linux; this is not a pass
 ❯ requireMetal helpers.ts:73:18
 ❯ ac3.test.ts:53:5

 Test Files  1 failed (1)
      Tests  2 failed (2)
```

**Not run here:**

- Nothing has drawn on Metal. The fixtures, the `compiled` report and the thresholds above are unproven against a
  renderer, whether the base or an implementation.
- The test's failure on the base was not recorded, since it needs a Mac.
