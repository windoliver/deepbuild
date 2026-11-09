# #1640 evidence: crease and border edges, rendered

Rendered on Metal by `deep-gpu run` at d408913d. `render.py` writes each scene with the acceptance fixture's items (`tests/acceptance/1640/fixtures/parity/geometry/crease-edges.scene`) and the suite's look, adds one sun, and saves frame 0's final target:

```bash
python3 -I docs/evidence/1640/render.py "$PWD" <out-dir> target/debug/deep-gpu
```

| Image | Lines | Segments drawn (`counts`) |
|---|---|---|
| `crease.png` | `kind: {crease: {angle: 30}}` on the cube, cylinder and ball; the plane with `border: true` | cube 12, cylinder 64, ball 0, plane 4 |
| `all.png` | `kind: all` on the same four, for comparison | cube 18, cylinder 192, ball 1440, plane 5 |
| `noborder.png` | as `crease.png`, the plane with `border: false` | cube 12, cylinder 64, ball 0, plane 0 |
| `dash_screen.png` | the AC4 cube, crease edges, `size_space: screen`, `dash: [8, 8]` px | 12 |
| `dash_world.png` | the AC4 cube, crease edges, `size_space: world`, width 0.02 m, `dash: [0.1, 0.1]` m | 12 |

What the images show:
- `crease.png`: the cube's 9 visible edges and no face diagonals; the cylinder's two rims and nothing on its side; nothing on the ball; the plane's 4 sides without its diagonal.
- `dash_screen.png`: dashes of one length on screen on every edge.
- `dash_world.png`: dashes of 0.1 m that shorten with distance.
- No far-side edge draws over a near face in either dash image.

Seen but not this issue's: where two segments of one line meet at an angle (the cylinder's bottom rim), a small notch shows between them. `all.png` shows the same notches on that rim, so they come from #420's per-segment drawing, not from crease.
