# Issue 545: screenshots and a recording

The issue's last criterion asks for screenshots of the 10 Hz item's linear write at 0.15 s and 6.05 s and of the follow camera's hold, with a recording of the interpolated item, taken from the canvas's own frames. The positions are what `deep-logic`'s live view draws (`frame`'s `draws`, played a frame at a time). Each picture is a frame `deep-canvas-render raster` drew, at view zoom 2, from a figure in `shoot.mjs` that places a dot there. No canvas item reads a logic array yet (a shot's `move: logic` is #266, skinned poses #284), so the figure carries the value instead. Regenerate them with:

```bash
cargo build --locked --bin deep-logic
cargo build --locked -p deep-marks-render --bin deep-canvas-render
node docs/evidence/545/shoot.mjs . docs/evidence/545 <frames dir>
ffmpeg -framerate 60 -i <frames dir>/m%03d.png -plays 0 -f apng docs/evidence/545/linear.apng
```

`shoot.mjs` assembles its two programs with the #545 suite's assembler, which any run of `tests/acceptance/545` builds.

| File | What it shows |
|---|---|
| `linear-0.15s.png` | The 10 Hz mover's linear `pos` at 0.15 s: the dot at 0.5 m, between the rings at 0 m and 1 m that steps 0 and 1 stored. The rule's ticks are whole metres from 0 to 3 |
| `linear-6.05s.png` | The same item at 6.05 s, played to it: the dot at 59.5 m, between steps 59 and 60 (rings). Ticks from 57 to 62 m |
| `follow-hold.png` | The follow camera, a 60 Hz item writing its position with `hold` (3 m/s), one row per 120 Hz frame for 8 frames: the dot is what is drawn, the ring where the pose would be. The dot repeats for two frames and then jumps, which `logic.judder` raises |
| `linear.apng` | The mover from 0 to 1 s at 60 fps: the dot glides at 10 m/s, one step behind the ring of the last stored step |

Whether these look right is one taste call, recorded in `tests/acceptance/545/TASTE.json`. Until it is, the criterion reads INCONCLUSIVE, and no other criterion reads these pictures.
