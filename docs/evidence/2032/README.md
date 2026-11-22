# #2032: shadows in a lit 2D group

Two original scenes, each one lit `group@1` whose closed paths name `occlude`, drawn by the GPU layer's `window2d`
(`deep-gpu run`) at 960 × 540 in a role map of their own, and each again with `occlude` taken off every path.

- `lantern.png`: a yard at ambient 0.12 with two point lights, a warm lantern and a cool one at the top right, and seven
  occluding paths: an L-shaped wall, a wall, a crate, a bench and three round pillars. The lantern's bulb is `unlit`.
- `village.png`: ambient 0.3 and one sun at 24°, over four houses, a well, a tower and a fence, each an occluding path.
- `lantern-occlude-off.png`, `village-occlude-off.png`: the same documents with no `occlude`.

Read by pixel on the stills: the sand behind the first house reads 124, 113, 91 in the sun's shadow and 223, 191, 140
with `occlude` off; that house's own face reads 186, 93, 64 both ways, and so does sunlit sand at (60, 300), 223, 191,
140; the well, which stands in another house's shadow, is darker than with `occlude` off; the floor behind the
lantern's wall reads 61, 54, 45 against 174, 132, 105; and the `unlit` bulb is its role's color, 255, 196, 120, in both.
