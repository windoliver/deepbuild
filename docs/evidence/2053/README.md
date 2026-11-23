# #2053: normal pages on images in a lit 2D group

Two original scenes, played by the GPU layer's `film2d` (`deep-gpu run`, with the new `store`) at 30 fps for 4 s, in the
shipped look `clean` with one warm role, `torch` (#ffb066), added to its palette. The pictures are made in code: a
600 × 400 brick wall and a 360 × 360 stone medallion, each with a normal page built from a height field. Captions are
drawn by `deep-canvas-render` in a strip under each picture, outside it.

- `torch.mp4` (1440 × 480): the same brick wall twice, each in its own lit group (ambient 0.06) with one torch (energy
  1.8, range 520 u, height 60 u) circling it. The left wall has no `normal`; the right one names its normal page. The
  flames are `unlit` circles.
- `medallion.mp4` (960 × 480): the medallion turns a full circle under a fixed torch at the upper left (height 200 u).
  Left: as built, the normals turn with the image. Right: the same film under `--planted normal_unturned`.
- `sheet.png`: the torch film at its start and midway; then the medallion at a half turn, turned and unturned, and the
  same image in a group with no light.

## Read by pixel

| Check | Result |
|---|---|
| Paged wall at frames 0, 30, 60, 90 against the issue's f64 form from the page's bytes (c ÷ 255 × 2 − 1, z rebuilt, max(0, N·L) ÷ L.z) | 0 of 237,688 px more than 1 code off, each frame |
| Plain wall, same frames, against #2031's form | 0 of 237,688 px more than 1 code off, each frame |
| Vello CPU `raster` against the GPU window at 1 s, the paged wall | 0 of 240,000 px more than 1 code apart |
| Medallion at 0°, 90°, 180°, 270° against the form with the normals turned | 0 of 90,896 opaque px more than 1 code off, each angle |
| The planted unturned normals at 90°, 180°, 270° | 82,276, 85,417 and 82,094 px off, up to 170 codes |
| Bevels near the torch, facing it against facing away (mean luminance) | paged 111 against 23; plain 82 against 79 |
| A flat page (128, 128) against no page, window at 1 s | 37,814 of 691,200 px 2 codes apart, none more |

The last row is the 8-bit page's own limit: 128 reads as 1 ÷ 255, not 0, so a "flat" texel leans by about 0.2°. Under
this low, distant torch (height 60 u, up to 520 u away) that is 2 codes; under the issue's fixture (height 100 u over a
64 px image) it stays within 1, which AC2 checks.
