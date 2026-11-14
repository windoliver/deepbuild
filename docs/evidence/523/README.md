# #523 evidence: the fixtures on film

`joints.mp4` is the product's own export (`deep-show run`'s `export`, H.264, 1280 × 720, 60 fps, 3 s), converted from
its `.mov` for viewing, of one scene holding the blind suite's fixtures (`tests/acceptance/523/helpers.ts`) as seven
worlds side by side, each body drawn through a pose output:

| Top row | Bottom row |
|---|---|
| the flywheel at 360 deg/s on its hinge | the gear of ratio 2, its first hinge driven at 90°/s |
| the arm resting on its limit, breaks_at 20 N·m: it breaks at step 6 and falls | the pulley of ratio 1, its left weight lowered by its driver |
| the arm its motor (50 N·m) presses up against a ball: it holds | the two-link arm whose hand slides out at 0.5 m/s: straight at 2 s, then jammed |
| 2 kg and 1 kg balls on fixed joints, breaks_at 15 N: the 2 kg one breaks and falls | |

`sheet.png` lays out the export's own lossless PNG frames (a `png_seq` export of the same document) beside charts of
the joint readings, which the film can't draw yet (#2248), baked by `deep-physics` at one sample a step
(`readings.json`).

- `export.mjs <deep-show> <out dir> [mov|png_seq]` writes the document and runs the export.
- `readings.mjs <deep-physics> <out dir>` bakes each world of that document and writes `readings.json` and the charts.
- `sheet.mjs <after dir> <before dir> <out.png> <frame>...` renders the sheet with headless Chrome.

## What filming found

The blind suite passed 21/21, but the film and its readings showed three gaps:

- **A broken joint kept reading its load.** The arm on its limit read 50 N·m of torque, and the 2 kg ball's hook read
  19.62 N, for the whole 3 s after each broke at step 6. Rapier keeps a disabled joint's last impulses. A broken or
  inactive joint now reads 0 (ee3824797).

The other two were fixed in 4959d72c2:

- **Past its reach, the two-link arm sagged and flipped.** It should hold straight toward its hand. Instead it bent at
  the elbow, its shoulder and elbow changed sign every step (0.69°, −0.68°, 0.97°…), and the elbow wrapped a full turn
  by 2.5 s (371°). The cause: the solve took Gauss–Newton steps that raised the residual near the straight arm. It now
  damps each step (Levenberg–Marquardt) until the step lowers the residual, and never takes one that raises it. After
  the jam it reads 0° and 0° at every step to 3 s.
- **Caps and jams repeated their faults.** The disc held at the 45°-a-step cap wrote `speed_cap` at steps 1, 5, 7 and
  on, and the jam wrote a row on every one of 120 steps. Each now writes one fault, on the step it starts. Whether the
  step before was capped or jammed is read from the world's own state, so a restore at step 240 writes the same jam at
  step 241 as play, and a restore at step 300 writes none, as play does past 241; both seeks equal play by step hash.

After the three fixes the blind suite's touched files pass again: criteria 2, 5 and 6 (9/9) after 4959d72c2, criteria
3 and 4 (5/5) after ee3824797. The film's motion comes from `deep-show` built at 4959d72c2. ee3824797 changes only a
broken joint's reading, which the film doesn't draw.

## Reading the film

- The scene has no floor. The broken arm and the 2 kg ball fall straight down through the bottom row: the arm crosses
  the pulley at about 1 s, and the ball crosses the two-link arm's label.
- The first framing, with the camera farther back, was refused by the export's own `film.blank` check: 98% of each
  frame was one luma window. The bars are drawn 0.16 m thick, thicker than their 0.1 m shapes, so the film isn't mostly
  white.
