# Spike #2435: four ray-query questions, counted on the reference Mac

Design: [Ray-traced light](../../docs/technical-design.md#ray-traced-light) and canvas primitives' Light: ray traced.
Four questions about ray queries on the pinned wgpu (30.0.1) and Metal decide whether #475's criteria can pass. None of
them depends on an M1 or a budget. This headless probe counts each one against a CPU reference in f64. Its counts are
checked. Its timings are readings from one machine: they set no budget and turn no ray class on. It draws nothing a
document names and adds no field.

```sh
node spikes/2435/record.mjs     # build, run all four parts and every plant, store record.json
spikes/2435/target/release/spike-2435 --part candidates|build_order|ties|rebuilds|all [--plant NAME]
```

The binary prints one JSON report: the host and adapter, then each part's status (`PASS`, `FAIL`, `BLOCKED`,
`INCONCLUSIVE` or `NOT_RUN`) with its reason, its counts and `form_for_475`, and the run's status. The run passes
only when every part asked for passes. A part asked for and not run makes the run `INCONCLUSIVE`. The binary exits
0 only on `PASS`. `record.json` holds the run of all four parts, the host, and each plant's report as the probe
printed it. The acceptance tests in `tests/acceptance/2435/` read it, and they rerun each plant live.

## What #475 takes

| Question | The form #475 takes | Why |
|---|---|---|
| Candidates | **`candidate_loop`**: one query per ray, with the candidate test confirming or passing each candidate | 0 misses and 0 extra hits in 1,000,000 rays. Forced-opaque restarts (`opaque_restart`) also count 0 and 0 here, but they cost up to 16 queries a ray |
| Build order | **`one_build`**: a bottom level built for the first time goes in the same `build_acceleration_structures` call as the top level that names it | One build: 100 of 100. The same order split across two builds loses the added mesh. Two builds in one encoder (`one_encoder`) and two command buffers (`two_command_buffers`) each drew it in 0 of 100 runs in the record, and in 0 to 3 of 100 in earlier runs. The pinned layer raised no error either way |
| Ties | **`merge`**: a surface on the same vertices as another is merged with it into one primitive at build, its layers ordered opaque first | As built, the pinned layer gives one hash in 10 runs, but the masked decal always answers the tie: the floor reads 34.33 lx against the reference's 74.39 lx (−53.8%). Merged, one hash and 74.39 lx |
| Rebuilds | **Rebuild every frame**, under **`fast_build`** by this record's readings: a skinned or deforming mesh builds its bottom level from the pose at t, and #475 counts a whole build per moving mesh per frame | wgpu-core 30.0.1 never updates. Asked to (`PreferUpdate` with `ALLOW_UPDATE`), it logs `only rebuild implemented` and rebuilds: at frame 2, 10,000 of 10,000 rays hit where a fresh build's do. The preference is the one whose rebuild and trace p50s, summed over the three sizes, are smaller: 5.54 ms against 5.77 ms. That 4% gap was read at load 145, so it is a reading, not a verdict |

**For #475's scope:** its line "the bottom-before-top build order #474 requires holds across command buffers too" does
not hold on the pinned layer. Put the new bottom level in an earlier command buffer of the same submission, or in an
earlier build call of the same encoder, and the ray through the added mesh reads the sky with no error raised.
wgpu-hal's Metal backend places no barrier between acceleration-structure builds
(`place_acceleration_structure_barrier` is empty). That fits the top level being built before its new bottom level is
done, though the probe counts the outcome, not the cause. Until that changes, #475 builds a new bottom level in the
same call as the top level that names it. The probe doesn't count a bottom level submitted and waited on before the
top level's submission.

## The four parts

The numbers below are from `record.json`. Its `host` field names the machine and the conditions it ran under.

### Candidates

An opaque floor at z = 0 sits under a layer of 10,000 triangles at z = 1 (a 100 × 50 grid of cells, each split in two).
The layer's alpha mask passes the half of each triangle nearer its second vertex (barycentrics b1 > b2). 1,000,000
rays go straight down from seeded points (`Rng` splitmix64, seed 24350001). Each point keeps 10⁻³, in barycentric
units, from its triangle's edges and from the mask's line. So the GPU's f32 test and the reference's f64 test can't
disagree on where a ray lands. Which side of a shared edge a grazing ray takes is not this part's question. The
reference tests every triangle in f64 for every ray: 499,330 rays stop at the layer and 500,670 reach the floor.

| Form | Misses | Extra hits | Wrong primitive |
|---|---|---|---|
| `candidate_loop` (named) | 0 | 0 | 0 |
| `opaque_restart`: forced opaque, restarted just past a failed candidate, up to 16 times | 0 | 0 | 0 |
| Plant `end_on_failed_candidate`: the traversal ends a ray when a candidate fails its test | 500,670 | 0 | 0 |

A miss is an answer deeper than the reference's: the floor where the layer stops the ray, or the sky. An extra hit
is an answer shallower than it.

### Build order

Mesh A is drawn from frame 0. Mesh B gets a new bottom level at frame 2, the frame that adds it. One ray goes down
through B's centre and one through A's. Each run builds everything fresh, and each form runs 100 times.

| Form | Frame 2 draws B | Frames 0 and 1 read the sky through B, and A beside it |
|---|---|---|
| `one_build`: both levels in one build (named) | 100 of 100 | 100 of 100 |
| `one_encoder`: two builds in one encoder, bottom first | 0 of 100 | 100 of 100 |
| `two_command_buffers`: submitted in order, bottom first | 0 of 100 | 100 of 100 |
| Plant `top_level_first`: each form with the top level recorded or submitted first | 0 of 100 in each, frame 2 reads the sky | wgpu-core refuses the submission: `Blas … is used before it is built` |

Earlier runs of the two split forms drew B in up to 3 of 100. That spread fits a race between the two builds.

### Ties

Two quads lie on the same four vertices, 1 m above a diffuse floor. One is opaque and emits 100 cd/m². The other is
alpha-masked and clear where x < 0. 100,000 cosine-weighted rays go up from the floor point (0.1, 0.05, 0), seed
24350003. Each keeps 10⁻⁴ m from the panel's edges and the clear line where it crosses the panel's plane. The
irradiance is π L × (rays the panel answers) ÷ N. The reference traces the same rays in f64, with the opaque emitting
panel answering where the two tie, and reads 74.390 lx. The closed form for the panel reads 74.162 lx. The
difference is the 100,000 rays' sampling noise, which the reference shares with the probe. Each run below builds every
structure fresh.

| Form | Hashes in 10 runs | Irradiance | Against the reference |
|---|---|---|---|
| `as_built`: two instances, the panel opaque, the decal masked | 1 | 34.334 lx | −53.8% |
| `merge`: merged at build, opaque first (named, the rule) | 1 | 74.390 lx | 0.0% |
| Plant `masked_answers_first`: merged with the masked quad's layer first | 1 | 34.334 lx | −53.8% |

The pinned layer does give one hash. A tie falls the same way from run to run, but always to the decal, and that
hides the panel. The rule #475's scene build takes: **a surface on the same vertices as another is merged with it into
one primitive at build, its layers ordered opaque first.** The opaque surface then answers, and the tie never
reaches traversal.

### Rebuilds

A sheet of 10,000, 50,000 or 100,000 triangles is posed anew each frame by a compute pass, as a pre-skin writes
positions. Its bottom level and a one-instance top level are rebuilt, and one ray per pixel is traced at 1920 × 1080.
Each case runs 30 warm-up frames and 300 timed frames. The timestamps come from compute-pass stamps and are resolved
after the frame, in a submission of their own (#1657). The rebuild reading spans from the end of the pose pass to the
start of the trace pass, so it holds the bottom level, the one-instance top level and the gap between encoders. The
trace reading is the trace pass. Times are in ms.

| Triangles | Preference | Rebuild p50 | Rebuild p95 | Trace p50 | Trace p95 |
|---|---|---|---|---|---|
| 10,000 | fast-build | 0.900 | 1.519 | 0.495 | 0.840 |
| 10,000 | fast-trace | 1.118 | 1.470 | 0.459 | 0.886 |
| 50,000 | fast-build | 1.447 | 2.180 | 0.642 | 1.248 |
| 50,000 | fast-trace | 1.376 | 1.913 | 0.507 | 0.892 |
| 100,000 | fast-build | 1.536 | 2.176 | 0.518 | 1.117 |
| 100,000 | fast-trace | 1.796 | 2.414 | 0.512 | 1.090 |

The update check builds a 10,000-triangle structure with `PreferUpdate` and `ALLOW_UPDATE` at frames 0, 1 and 2. At
frame 2, 10,000 rays down hit it where they hit a fresh build of the frame-2 pose: same primitive, same distance, for
10,000 of 10,000. A structure left at the frame-1 pose differs for all 10,000, so the check can tell a stale structure
apart. wgpu-core logs `only rebuild implemented` for each build asked to update.

## Readings, not verdicts

- The timings come from one Mac17,10 (M5 Max) shared with other work: mains power and Low Power Mode off, but
  thermal state fair and a one-minute load near 145. The design's timing conditions are recorded in `host`, not
  enforced. These numbers set no budget and turn no ray class on. #474's emulated class and every budget still wait
  for an M1.
- A timed run takes the machine's GPU lease (`~/.cache/deepbuild-gpu/lease`) without waiting. If another live GPU job
  holds it, the part reads `INCONCLUSIVE` with the holder named, and no timing is stored.
- On an adapter without ray queries, every part reads `BLOCKED` and names `EXPERIMENTAL_RAY_QUERY`. The plant
  `no_ray_queries` reads this Mac's feature table without that feature, which takes the same path.
- A runner that skips a part (`--plant skip_<part>`) reports it `NOT_RUN`, and the run reads `INCONCLUSIVE`, never
  `PASS` (#1115).

## Notes for whoever builds #475

- Metal's intersection query can be reset but never assigned. A `var q: ray_query` declared inside a loop doesn't
  compile on Metal ("overload resolution selected deleted operator '='"). Declare it once and call
  `rayQueryInitialize` each time round.
- A shader the pinned layer refuses on Metal reports as an internal error, not a validation error. A validation-only
  error scope misses it.
- #475's duplicate-candidate question (whether Metal offers a primitive twice when `NO_DUPLICATE_ANY_HIT_INVOCATION`
  is dropped) isn't counted here: an alpha test is the same however often it runs.

Not in this spike: the emulated ray class and every budget, which wait for #474; any drawing code; and #250's compute
tracer, which answers the same four questions for itself when it is built.
