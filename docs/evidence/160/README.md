# Issue 160: screenshots and recordings

The issue's last criterion asks for screenshots of a trim on a circle, a repeater, a tapered stroke and an arrow drawn on a path, with a recording of the trim and the arrow animating, all taken from the canvas's own frames. Each file here is a frame `deep-canvas-render raster` drew from the documents in `shots.mjs`, at view zoom 2, from branch `claude/issue-160-ac9`. Regenerate them with:

```bash
cargo build --locked -p deep-marks-render --bin deep-canvas-render
node docs/evidence/160/shots.mjs . docs/evidence/160 <frames dir>
ffmpeg -framerate 30 -i <frames dir>/a%03d.png -plays 0 -f apng docs/evidence/160/trim-arrow.apng
ffmpeg -framerate 30 -i <frames dir>/b%03d.png -plays 0 -f apng docs/evidence/160/loader.apng
```

| File | What it shows | Criterion |
|---|---|---|
| `trim-circle.png` | A trim from 0 to 0.25 with an offset of 90° on a circle of radius 70, over the full circle drawn thin | AC1 |
| `repeater.png` | A bar repeated 3.5 times: four copies, the last at half opacity | AC2 |
| `taper.png` | A 12 u stroke tapered to 0 over its last 80 u (20%) | AC6 |
| `arrow-on-path.png` | AC7's path drawn on by a trim, at 0.6 s, its arrow at the trim's end | AC7 |
| `trim-arrow.apng` | AC7's path drawn on from 0 to 1 s and held to 1.25 s, 30 fps | AC7 |
| `loader.apng` | The `loader.film` parity fixture over its 2 s: a trim that grows, follows and travels round a ring, an arrow at its end, 30 fps | AC1, AC7 |

Whether these look right is the owner's taste call, recorded on the PR. Until it is, this criterion reads INCONCLUSIVE, and no other criterion reads these pictures.

Every stroke draws with butt caps and miter joins: the stroke's `cap` and `join` fields are not read yet, on main as well, so these documents set neither.
