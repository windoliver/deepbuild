# Hand e2e for #2033

The real `deep-gpu` draws AC4's 16 m wall scene from `tests/acceptance/2033/helpers.ts` (a 0.5 m wall on a plane,
light 16 m out) under a shadowed spot light and a shadowed point light. It draws each scene with the base binary
(1b4929ae7) and with this branch's (code commit 326fedcd5). `e2e.ts` casts CPU rays to pick the plane pixels whose
ray to the light runs at least 0.25 m inside the wall. A pixel the shadowed frame lights more than 4 codes above the
unshadowed frame counts as reached, and is painted magenta. Run on Mac18,1, macOS 27.2, Node 24.22, 2026-11-25.

| Light at 16 m | Plane px behind the wall | Reached, base | Reached, fix |
|---|---|---|---|
| spot | 29,837 | 896 | 488 |
| point | 29,837 | 435 | 392 |

- `e2e.txt`: the run's transcript.
- `e2e.png`: the four frames side by side with their counts.
- `e2e.sh` and `e2e.ts`: the run. Usage: `bash docs/evidence/2033/e2e.sh <base deep-gpu> <fix deep-gpu> <out dir>`.
  The transcript came from these scripts' scratch originals, which had the same logic, wrote the same lines and used
  local paths.

On the base, the leak runs along two edges: the far edge, cast by the wall's top, and the edge cast by the wall's near
vertical end. With the fix the far edge is fully dark. What is left lies only on the end edge. There, a ray 0.25 m
inside the wall is about one texel (6.6 cm) from the wall's silhouette in a 512 px map, inside the tent filter's
reach. So AC4 (`#2033.4b94b05f`) is BLOCKED for a bias; the PR names the owner's options.

A separate agent checked the four frames:
- Each is a valid render with no error text.
- Its magenta counts equal the transcript's.
- The fix adds no acne or striping on the lit plane or the wall faces.
