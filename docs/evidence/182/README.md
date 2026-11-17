# #182 evidence: the character body as the renderer draws it

`deep-gpu`'s own `view3d` final targets, kept byte for byte and named by their SHA-256. Each scene document holds the
physics world as `lab`, and the drawn capsule is moved only by that world's `pose` output (`to: items/<body>/at`). The
recordings are those frames played unchanged, 480 × 270 at 15 fps. `calls.json` lists the `deep-gpu run` calls that
wrote them, with `look.json` and the scene documents `course.json`, `limits.json` and `path.json`.

| File | What |
|---|---|
| `course-0_3s-42a46adb….png` | the course at 0.3 s: walking off the start (1280 × 720) |
| `course-1_25s-2c474068….png` | at 1.25 s: at the top of the jump over the 1 m gap |
| `course-3_2s-147b1634….png` | at 3.2 s: climbing the 30° ramp |
| `course-5_9s-c32b2b87….png` | at 5.9 s: up the 0.3 m step |
| `course-8_4s-0053664d….png` | at 8.4 s: the second jump, on the step's floor |
| `course-9_95s-3514d8c1….png` | at 9.95 s: the end of the run |
| `course-35a1ba9a….apng` | the course, 10 s |
| `path-0s-a5741dbf….png` | the course's whole run: the frame's path from the bake, and the capsule at 0, 0.8, 1.25, 1.71, 3.2, 5.9, 8.45 and 10 s (a still, no world) |
| `limits-4_95s-20272f89….png` | four lanes at 2 m/s for 5 s: a 40° slope climbed, a 50° slope stopped at its foot, a 0.3 m step climbed, a 0.5 m step stopped (slope limit 45°, step height 0.35 m) |
| `limits-4ba55b14….apng` | the limits, 5 s |

The course is the blind suite's (`tests/acceptance/182/helpers.ts`: `courseStatics`, `courseTrack`): a walk at 2 m/s
from step 0 and jumps at steps 96 and 960, 1,200 steps at 120 Hz.

## Checked against the physics

The same worlds baked on `deep-physics` (`bake`) read:

| Moment | Bake |
|---|---|
| First jump | peaks 1.0185 m up at step 151, x 2.52 m (over the gap); lands on the shelf at step 205, x 3.42 m |
| 3.2 s | on the ramp at x 6.03 m, y 1.552 m: a capsule resting on 30° at its offset |
| Step-up | at step 711, x 10.70 m, when the capsule's front reaches the step's edge at 11 m; y 2.91 → 3.21 m |
| Second jump | peaks 1.0185 m up at step 1015 |
| End | x 18.83 m, y 3.211 m, z within 2e-5 m of 0, grounded on `step` |
| Limits at 5 s | 40°: on top (y 2.91 m). 50°: at its foot, x 2.856 m, never above 0.911 m. 0.3 m step: on it (y 1.21 m). 0.5 m step: stopped at x 2.69 m (the face less radius and offset) |

Frame by frame, the drawn capsule's centroid in every course frame lies on the bake's frame, projected through one
plane homography fitted over all frames: 0.4 px mean and 1.7 px worst at 960 px wide over the 300 frames at 30 fps, and
0.3 px mean and 1.5 px worst at 480 px wide in the 150 evidence frames. Shifting the bake by two frames makes the fit about five times
worse, so the drawing neither lags nor leads the physics.
