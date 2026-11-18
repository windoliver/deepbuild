# #251 evidence: the renderer's own pictures for the taste call

Written by `tests/acceptance/251/ac10-taste.test.ts` with `DEEPBUILD_EVIDENCE_DIR` set to this folder: `view3d` final
targets from `deep-gpu`, kept byte for byte, each named by its SHA-256. Two runs, before and after merging main, wrote
the same bytes.

| File | What |
|---|---|
| `at-rest-1034a587….png` | the car set down on its springs, at 3 s (640 × 360) |
| `steering-a6254ad0….png` | rolling from 3 m/s with steer 15°, at 4 s (640 × 360) |
| `lap-590178fb….png` | the course lap, at 6 s (640 × 360) |
| `lap-b4a08ac0….apng` | the lap's recording, 10 s at 15 fps (320 × 180) |

The scenes and cameras are the blind suite's (`sceneOf` in the test). The taste call is yours: record it in a file named
by `DEEPBUILD_TASTE_251`, `{"criterion": "#251.74b37407", "by": "you", "screenshots": [the three hashes], "recordings":
["b4a08ac09ce07dbf53b8111a79ee58be9039def109579c4537164be2e1e5ab2b"], "call": "looks_right" | "looks_wrong"}`, and run
the test again. Until then criterion 10 reads INCONCLUSIVE, never PASS.
