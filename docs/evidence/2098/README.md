# Evidence for #2098: 2D worlds on rapier2d, the wind force and a body's explicit inertia

Read on November 19, 2026 from this change's release `deep-physics` on the reference Mac (arm64). Nothing here is
drawn by the app: the change has no app surface, and a scene's world is still held to rapier3d.

- `2098-run.mp4` and `2098-still.png`: the three criteria's worlds baked 3 s and drawn from their states by
  `render.py` over `make-data.mjs`'s output (`node make-data.mjs <deep-physics> > data.json`, then
  `python render.py data.json .` with Pillow 11.3.0).
- `same-as-base.txt`: `node same-as-base.mjs <base deep-physics> <change deep-physics>`, the base being 85203f458.
  Three 3D worlds (a drop, drag and a spring to a point, a hinge's motor) give the same runtime digest and pins, bake
  keys, 601 step hashes, occurrence hashes and checkpoint hashes on both.

| Criterion | Read | Bound |
|---|---|---|
| `#2098.07d55616` the 2D ball on rapier2d 0.36.1 | checkpoints name `rapier2d` `0.36.1`; first rebound 0.4783 m, 0.239 of the 2 m drop | within 0.05 of 0.25 |
| `#2098.07d55616` the same world named rapier3d | refused at `dimensions`, actual 2: "rapier3d 0.36.1 runs only 3D worlds, so dimensions is refused" | names `dimensions` and the backend |
| `#2098.7c1127fe` the wind's closed-form time | first within 1% of 2 m/s after step 275, 2.2917 s | steps 274 to 279, 2.303 s within 1% |
| `#2098.7c1127fe` the gusts | the wind the cube feels is the Force section's formula within 0.001 m/s at every step; the same seed repeats its step hashes in two processes | the blind suites' |
| `#2098.f0ef7a3d` inertia twice the shape's | 57.2976 and 28.6490 deg/s after 1 s, ratio 0.5000; planted `inertia_ignored` reads 1.0000 | 0.5 within 1% |

## After the merges with main

- `merged-d685cd167.txt`: the first merge (main 285c4e762, which brought #2240's `centre_of_mass`), run once inside
  one build grant on November 20, 2026. The two blind suites pass 11 of 11; #2240's suite passes 14 of 14, its written
  centre and this change's written inertia building one body's mass properties; the two physics crates' unit tests
  pass 20 of 20; clippy on the two crates is clean.
- `merged-7615b5d50-cargo.txt`: the second merge (main 54f9bdb94; `scripts/lanes.mjs` alone conflicted). `cargo test`
  of the seven crates the change reaches: 184 pass and 2 fail, deep-show's `recipe_frames` and `render_back_pipeline`,
  which fail the same way in the runs of #2240, #2241, #2243 and #2371 on this machine.
- Not run on the second merge: the blind suites and the wasm32 build, which waited more than two and a half hours for
  a build grant another session held; and `node scripts/affected.mjs`, INCONCLUSIVE twice for want of a test grant
  (0 of 526 files started) and stopped once, void, because the worktree's packages weren't built.
