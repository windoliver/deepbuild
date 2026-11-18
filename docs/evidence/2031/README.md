# #2031: lights in a 2D group

Two original scenes, each one lit `group@1`, played by the GPU layer's `film2d` (`deep-gpu run`) at 960 × 540 and 30 fps in
the shipped look `clean` with the scenes' own roles added to its palette.

- `dusk.mp4` (6 s): a village whose group's `ambient` is keyed from 1 to 0.1 while four street lamps' `energy` rise from 0
  to 1.5, the moon's cool light rises to 0.35 and a lantern's light moves along the road by a channel on its `at`. The
  lamp bulbs, the lantern and the title are `unlit`.
- `cave.mp4` (4 s): ambient 0.05, a torch whose `energy` and `at` flicker by channels, and a faint cool fill at the
  cave's mouth. The flame and the title are `unlit`.
- `sheet.png`: dusk at its start, midway and at night, the same night frame with the group's `light` removed, and the
  cave twice; each caption is drawn by `deep-canvas-render` in a strip under its frame, outside the picture.

Read by pixel on the stills: every unlit bulb, the lantern and the flame are their roles' exact colors in every frame and
in the frame with the light removed; the title's glyph cores (287 px) are the same with and without the light; the
night sky matches the issue's f64 closed form (decode, ambient plus each light's energy × reach × color, clamp, encode
once) with no code off over every third pixel of its top 200 rows; and along the road at night no two neighbouring pixels
differ by more than 2 codes.
