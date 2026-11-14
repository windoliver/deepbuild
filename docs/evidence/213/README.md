# #213 evidence: between-step services and mirror reads on film

`hitscan.mp4` and `mirror.mp4` are the product's own export (`deep-show run`'s `export`, H.264, 1280 × 720, 60 fps,
3 s), remuxed from its `.mov` for viewing. `sheet.png` lays out frames of both films (taken from the H.264 films with
ffmpeg) beside the checks the same run's numbers passed (`checks.json`).

- **hitscan:** a logic item, `turret`, asks `physics.cast@1` a fan of 32 rays every step and, the step after, draws
  each hit it read as a dot and a beam from the turret to it: two instancers fed by its arrays. The world holds a wall
  whose face moves toward the turret at 1 m/s, two pillars and a ball that falls through the fan.
- **mirror:** `crowd` writes a 20 × 20 grid of points (teal), lifting one row a step. `copier` mirrors `crowd.pos` and
  draws its copy 12 m to the right (red). The copy trails by one row, because a mirror holds the writer's array as its
  earlier steps left it, exactly what a plain read gives.

## What the run's numbers show

| Check | Reading |
|---|---|
| Steps, traps | 180 steps for each film, no trap |
| The first step that reads a hit | step 1: step 0's rays are answered after it, before step 1 |
| Dots on the moving wall, and the farthest from its face at the state the asking step read | 1,393 dots, 1.4e-6 m (the world's f32) |
| Dots on the pillars and on the ball | 537 and 79 |
| Fuel at step 0 and at step 1 | 1,001 and 129,838: step 1 pays 32 × 4,000 for step 0's answers |
| copier's copy against crowd.pos as the step before left it | 71,600 elements compared, none differ |
| copier's range count per step | 1 at 171 steps (the lowered and the lifted row are adjacent, one run of 40), 2 at 8 steps (rows 19 and 0) |

## Run them

```sh
node docs/evidence/213/export.mjs target/debug/deep-show <out dir> mov   # writes both films, the documents and checks.json
node docs/evidence/213/sheet.mjs <out dir> <out dir>/sheet.png           # after ffmpeg -i <film>.mov <film>-frames/f%04d.png
```

The turret's label is cropped at the frame's left edge and the wall's falls outside the frame; neither carries a reading.
