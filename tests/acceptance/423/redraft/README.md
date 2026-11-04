# Blind redraft of #423's disputed tests

Written by the blind redraft of the acceptance-test job (technical design: Dogfooding, disputes), from issue #423, the
design (`docs/canvas-primitives.md`: Material: texture maps, its Semantics and Cost; Asset: meshes; Image `image@1`;
Builder `mesh.asset {sha256 (glTF), node}`; Asset: skinned playback: parts and shared skeletons), the base commit
`5f63620c` and the original suite (`28b7bf1f`, `../`). No implementation was seen. These files replace
`../khronos.test.ts` and `../taste.test.ts`; every other file of the original suite stands, and `../helpers.ts` is
imported unchanged. The original files are not edited; whoever settles the dispute swaps them.

## The disputes, checked against the files

Both files were fetched at the pinned commit and their SHA-256 checked (`ea8c41fd…50f2`, `37c3577d…b14e`).

- **D1 holds.** In NegativeScaleTest, PositiveScaleTest (det +1) has 10 triangles: two of them, at z 0.1 over the
  "back" column, are wound clockwise seen from +Z, so they are back faces; NegativeScaleFront (det −1) has 4, and the
  two over the "back" column are wound counter-clockwise in world space, so with the negative determinant they are
  back faces too. Both use ChecksAndXMaterial, single-sided. A raster of their front-facing triangles alone (80 px/m,
  pixel centres) covers 15,552 px and 5,184 px against summed areas of 25,920 and 10,368; PositiveScaleTest's "front"
  column also stacks two quads, z 0.1 over z 0. A renderer that culls back faces, as glTF and the sample's README
  ("the back face (counter-clockwise) should be culled") require, reaches 60% and 50%, never 90%.
- **D2 holds.** AlphaBlendModeTest holds three 2,048² JPEGs (MatBed's normal, occlusion/metallic-roughness and base
  color) and one 1,024² PNG (the five test materials). A PNG or JPEG map decodes to RGBA8 and counts w × h × 4 B ×
  1.33: 72.5 MB (72.7 MB at 4/3), over the 64 MiB (67,108,864 B) cap, so the design refuses the document on every
  machine. The bed's three maps alone take 66.9 MB.

## What changed, by test

| Test | Criterion | What it asserts now, and why |
|---|---|---|
| `khronos.test.ts` (1) | AC2 `#423.5a4d9d3b` | As the original, except that each model's `imports` entry is read whether its document was drawn or refused `over_budget` (redraft/helpers: `importDrawnOrOverCap`; Assumed surface 12). A refusal must be `over_budget` with `decoded_bytes` over 64 MiB; any other refusal fails as before. Every texture, sampler, texCoord set, UV transform and alpha mode AlphaBlendModeTest declares is still held to its file (`../helpers`: `importProblems`), so AC2 loses nothing; the suite no longer needs the cap broken to read it. |
| `khronos.test.ts` (2) | AC2 `#423.5a4d9d3b` | The spheres are as the original, word for word. The single-sided planes are held to the sample's README instead of to their summed area: front faces shown, back faces culled, so every cell of the "scale 1.0" and "scale -1.0" rows (columns "front", "back", "sample", the file's own labels) shows the check mark and none the red X. A CPU reference (redraft/helpers: `planesReference`) draws the front-facing triangles of PositiveScaleTest, NegativeScaleFront and NegativeScaleBack, nearest first, each with its base color map's texel. In each cell, 3 px in from its edges: the ID target picks the node the reference shows on 99% of pixels; the check's interior (reference-green pixels whose four neighbours are green too) reads green (linear g over twice r and b) on 80%; at most 1% of pixels read red where the reference shows no red. NegativeScaleBack is added because it is what the "scale -1.0" row's "back" and "sample" columns show once NegativeScaleFront's back face is culled. Catches: winding not flipped under a negative determinant (the "scale -1.0" row's "front" and "back" columns pick NegativeScaleBack and NegativeScaleFront the wrong way round and show the X); single-sided back faces drawn (the X in both rows' "back" column); a mirrored plane lit from behind (no green); node transforms ignored (wrong picks). |
| `taste.test.ts` (1) | AC7 `#423.35374578` | As the original, except `khronos-alpha-blend-mode.png`: the whole file can't be drawn within the cap, so the picture draws every node of its scene but `Bed`, each as its own `mesh.asset@1` item naming the node (`node: <name>`) at the node's world transform in the file (`at`: pos, rot as Rz·Ry·Rx in degrees, scale; redraft/helpers: `atOf`). Those eight nodes hold all five alpha-mode materials and their one 1,024² map (about 5.6 MB). The picture is still the renderer's own final target, copied byte for byte. The other seven pictures, `TASTE.json` and its rules are unchanged. |

The CPU reference was run on the fetched file: each of the six cells shows the check, none shows red, and the
"scale -1.0" row's "front" column shows NegativeScaleFront while its "back" and "sample" columns show
NegativeScaleBack. Fed CPU stand-ins for two wrong programs as the frame, the same three per-cell checks fail: no
culling fails the "back" column of both rows (1,157 red px of 4,225); winding not flipped fails the "scale -1.0"
row's "front" and "back" columns (0 correct picks, no green, over 1,000 red px). The stand-ins were scratch files,
not committed. Nothing here has run against a renderer.

## Assumed surfaces this redraft adds

The original suite's Assumed surfaces 1 to 11 (`../README.md`) stand. This redraft adds two, each beside an existing
call:

12. **A `view3d` reply refused `over_budget` (Assumed surface 8) still carries `imports` when the call sets `imports:
    true`**, in the form Assumed surface 4 gives: the import that makes the `material@1` fields comes before the
    decoded-image count that refuses the document, since the count is taken over the maps the import names.
13. **`mesh.asset@1` with `node: <name>`** (the design's own field: Builder `mesh.asset {sha256 (glTF), node}`; at the
    base, that node's mesh in its own space under the item's `at`) **draws the node's primitives with the materials
    they name, imported as Assumed surface 3 imports a scene's**, and the document's decoded-image count holds only
    the maps those materials use. Nodes of one file placed as several items share its maps by hash.

## Readings

- **"Keep their front faces outward"** for the planes is the sample's own pass picture: a check in every cell. The
  README calls the X in the "back" column a problem ("does not support glTF's `doubleSided: false` setting with
  back-face culling"), and without culling a renderer can't show which way a mirrored plane faces, so the redraft
  requires culling of single-sided back faces, which AC2's `double_sided` import already names.
- **Red and green** are read by dominance in the linear target (one channel over twice each other one, above 0.02),
  which needs no colour calibration: the check is pure green and the X pure red on a white field, and the sun of π lx
  along −Z lights the planes head on.
- **The AlphaBlendModeTest picture** leaves out the bed rather than downscaling anything: the design has no surface to
  draw a map smaller than it decodes, and the node-visibility channel (Asset: skinned playback: parts and shared
  skeletons) hides a node without saying its maps leave the count.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/423 --no-file-parallelism redraft/
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/423/tsconfig.json
```

`../tsconfig.json` already includes `redraft/`. The same `INCONCLUSIVE:` (off macOS, or no taste call) and `BLOCKED:`
(no network and no cache) rules hold as in `../README.md`. Only the typecheck has run here.
