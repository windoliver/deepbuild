# Blind redraft for #2760, criterion 8: what 64 live rings add to a pond's GPU time

A blind redraft of the timing test for `#2760.6dfadd78`: "Budget, on the reference Mac in the local preflight,
compared with the merge base: 64 live rings on a pond that fills half a 1080p frame add under 0.3 ms of GPU". Written
from the issue, the design and base commit `9550dc0f`, before any implementation, by a job that saw neither the
implementing work nor the suite's first draft of this test. One test, in `budget-timing.test.ts`. The suite's other
test for this criterion, which reads the `benchmarks/budgets.json` task, is not redrafted and not here.

## What was read

- AGENTS.md; issue #2760's body; the suite's surface under test (the names the suite already asks an implementer for).
- `docs/canvas-primitives.md`: Material: water; Material: mirror; Logic: occurrences.
- `docs/technical-design.md`: The reference Macs; Dogfooding.
- At the base: `tests/acceptance/166/` (README, `budgets.test.ts`), `tests/acceptance/968/budgets.test.ts` and
  `tests/acceptance/968-redraft-1830/` (the model for the timing and the load); `tests/acceptance/544/programs.ts` (a
  logic program in WebAssembly text); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); and, for the three facts
  below only, the base's water shader `crates/deep-scene3d-render/src/water.wgsl` (how the rain's ring bends the normal
  and where the normal goes) and `view3d`'s call fields.

## What the base does

Checked at the base on a Mac17,10, on the fixture's own pond at 1920 × 1080, one frame a call.

1. **`view3d` runs a document's `logic@1` items in the call.** With the program's bytes in the call's `assets` under
   their SHA-256 the pond's document, logic item and all, draws. With `assets: {}` the same call is answered
   `{"code": "logic_refused", …}`, its refusal naming the item `drips`, the rule `asset` and the program's SHA-256.
2. **`view3d` takes `rings: true`.** Each captured frame then carries `rings`: `[]` for a water with no rain, and with
   `rain: 0.8` frame 120 listed 36 rows `{part: "pond", drop, at: [x, z], born, radius}`. A call with `timings: true`
   and no capture gives each frame a `gpu_ms` and the pixel hash the captured call gave that frame.
3. **A ring reaches the final picture only through the bent normal.** The rain's ring adds a slope to the pixel's
   normal: the slope of a bump 1.5 cm wide across the ring's radius, cut 4.5 cm either side of it, times 0.2, fading
   with age. The normal then does two things: it moves the mirror's lookup (and the bed's) by up to `distort` px, and
   it sets the Fresnel share that mixes the mirror's picture over the water's own color. A ring has no height and no
   color of its own. So:
   - **From straight above over an even sky a ring is nearly invisible.** The Fresnel share is flat near the normal,
     and the sky a few pixels away is the same sky. Measured: the pond with `rain: 0.8` against the pond with none, at
     frame 120, from straight above at the height where the pond fills half the frame: 36 rings alive, 73 pixels
     changed, two a ring.
   - **Where a pixel spans too much water, no ring is drawn at all.** The base fades the rain out where a pixel spans
     more than five ring widths of water along the view (7.5 cm), to nothing at ten (15 cm): a pond seen from far away
     or at a grazing angle draws none.
   - **From the fixture's view every ring shows.** The same 36 rings at the same frame changed 3,890 pixels. Over
     frames 120 and 141, each of 32 rain rings with no other within 0.4 m, aged 0.1 to 0.25 s (radius 3 to 7.5 cm,
     at 71% to 29% of full strength), changed 58 to 132 pixels in the far rows (z < −3 m), 83 to 177 in the
     middle and 153 to 261 in the near rows.

Also measured there, for the test's margins: the default water's surface at frame 120 stands between 9.5 cm under and
9.4 cm over the plate at rest, so the point of water a pixel shows lies up to 0.20 m (far rows; 0.17 m middle, 0.12 m
near) from where its ray meets the plate at rest. At frame 120 every pixel the rain changed lay within 0.072 m of a
listed ring's circle by the drawn surface (the `depth` target), 0.174 m by the plate at rest. Over the two frames, 9
of 9,143 changed pixels lay more than 0.3 m from every listed ring's circle by the plate at rest, all at frame 141.
Those were not traced. By the shader a pixel's color follows its own normal alone, and the look spreads no pixel, so
they can only be rings the record does not list, such as a drop centred just off the plate whose crest reaches onto
it; that is a deduction, not something seen. Every touch of the fixture lies 0.75 m or more inside the plate. The
pond is 49.750% of the frame's pixels.

An earlier pass of this same job, cut off before it delivered, left its log. Not repeated here: it baked the
fixture's list at the base and counted 64 rings alive at frames 120 to 660, and 65 if a ring also counted at its
`span`; and a pond filling half the frame from far away, 1,307 rain rings alive, changed no pixel.

These tests credit none of it: at the base no ring is started by an occurrence, so none is listed.

## The fixture

`fixture.ts`. Every choice follows from the criterion's words or from the facts above.

- **The pond**: a `plate@1` part `pond`, 12 m × 12 m of 256 × 256 cells, whose material carries `water: {rings: {on:
  {list: "drips.occurrences", kinds: ["drip"]}}}` and nothing else, so the ring's `speed`, `span` and `strength` and
  the water's waves and ripples are the Fields rows' defaults, with no rain. Under it, 1 m down, a dark bed that fills
  the rest of the frame; over it a day sky and a sun.
- **Half a 1080p frame, from a view in which a ring shows**: the camera stands 30° above the horizon, 23.15 m from the
  pond's centre, fov 40° across the width, at the distance where the pond's four corners enclose half the frame's
  area. The view meets the water 24° to 40° from its plane, where the Fresnel share turns with the normal. A pixel
  spans 0.7 to 1.1 cm of water across the view and 1.1 to 2.7 cm along it, well under the 7.5 cm at which the base
  starts to fade a ring.
- **64 live rings in every timed frame**: a logic item `drips` (60 steps a second, one kind `drip` with `{point:
  vec3}`) writes one row on 8 of every 15 steps: those whose step number mod 15 is even. Any 120 steps in a row (the
  rings' 2 s) hold exactly 64 touches, so from step 119 on exactly 64 rings are alive at every instant, never 65, of
  every age from 0 to 2 s. The rows walk an 8 × 8 grid of 1.5 m cells in order, so each cell is touched again as its
  last ring ends: one ring a cell, none within 0.9 m of another cell's centre, and the 64 cover the pond.
- **A steady state, not one burst**: every timed frame carries the same work, rings of every size at once, so the
  median frame is any frame. Sixty-four touches on one step would be alive together for 2 s only, all small and then
  all large.
- **Without**: the same document, logic item and all, whose water has no `rings`: what the merge base draws.
- **The film**: frames 120 to 419 at 60 frames a second (2 s to 6.98 s), 300 frames as the base's water suites time.

## Run it

```sh
npm ci                                                   # once, in a fresh checkout
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu   # so the file's own build is a no-op
NO_COLOR=1 npx vitest run --root tests/acceptance/2760-redraft-ac8 --no-file-parallelism --testTimeout=3600000
npx tsc -p tests/acceptance/2760-redraft-ac8/tsconfig.json
```

The file builds `deep-gpu` once and #544's assembler (`tests/acceptance/544/wat`, read only) under
`target/acceptance-2760-wat`. The timing must have the machine to itself, so this folder belongs in
`scripts/lanes.mjs`'s `alone` list beside the base's water suites; that edit is the implementer's. Delete Vitest's
cache in `tests/acceptance/2760-redraft-ac8/node_modules/.vite` after a run.

## The surface used

Nothing new: only names the suite's surface already asks for.

- The document: `water.rings: {on: {list: "drips.occurrences", kinds: ["drip"]}}` in the `material@1` item's
  `params.water`; a `logic@1` item whose kind declares `point: "vec3"`, its program in the call's `assets`.
- `view3d`: `doc`, `look`, `size`, `from`, `frames`, `fps`, `capture`, `targets` (`final`, `ids`), `timings`, `rings`,
  `assets`; read: each frame's `frame`, `pixel_hash`, `final`, `ids`, `picks`, `gpu_ms`, and with `rings: true` its
  `rings` rows' `part`, `occurrence`, `at` and `born`. `radius` is not read here.
- The budget: 0.3 ms, the task `canvas-water-rings`' target `rings_pond_gpu_ms`. The test holds the number; the task
  is the other test's.

## What the test proves, in order

`#2760.6dfadd78 64 live rings, each one drawn, on a pond that fills half a 1080p frame add under 0.3 ms of GPU to the
same pond without them, in five runs`

1. Off macOS it fails `INCONCLUSIVE:` before anything runs.
2. **What is timed is what the criterion names.** One process draws the film's 300 frames of both ponds and captures
   frames 120, 280, 320 and 419. These are pixel checks: they hold on any Mac and need no reference machine.
   - *64 live rings*: on the pond with rings each of the four frames lists exactly 64 rows, each on `pond`, each with
     its own `occurrence`, each alive at the frame's time by its `born`, one in each of the 64 cells by its `at`. The
     pond without lists `[]`.
   - *Each one drawn*: frames 120, 280 and 320 are 40 steps apart, so in one of them every cell's ring is 0.25 to 1 s
     old: its crest 7.5 to 30 cm out, at half strength or more. In that frame the two ponds' final pictures differ in
     at least 8 pixels whose rays meet the plate at rest within 0.4 m of the cell's centre. No other cell's ring comes
     within 0.85 m of that centre, and the waves move a drawn point by up to 0.2 m at the base. A failure names the
     cells.
   - *Half a 1080p frame*: the pixels of frame 120's object-ID target that are `pond` are 49% to 51% of the frame.
3. **The machine**: the lane's `judgeLimit` on five empty readings with the load read then. Anything but PASS fails
   `INCONCLUSIVE:` with its reason, before anything is timed.
4. **The timing**, as the base's water suites time theirs: a warm-up run, then five; each run one process drawing the
   two ponds with `timings: true`, the one-minute load average read right before and right after it. Each run's pixel
   hashes at the four frames are the checked pictures', so what is timed is what step 2 saw. A run's reading is the
   median `gpu_ms` with rings less the median without, a negative one read as 0. `judgeLimit` decides with the five
   loads: PASS passes; FAIL fails; INCONCLUSIVE or BLOCKED fails `INCONCLUSIVE:`, never a pass.

Wrong programs it fails on: the base (no ring listed); rings listed but not drawn, or drawn elsewhere, or fewer than
64 drawn (step 2); a film that draws something else when timed (step 4's hashes); rings that cost more than the
budget (the judge).

## Readings where the issue and design leave a choice

- **"64 live rings"** is 64 rings alive in every frame that is timed, not 64 touches somewhere in the film: a frame
  with fewer rings would pull the median down. The steady state holds because a ring is alive from its flick until
  `span` after it and not at `span` (the suite's surface; the issue's "fades to nothing at `span`"), so at the instant
  one ring ends and the next is born 64 are alive. A check that also counted a ring at its `span` would see 65 and
  refuse the document, and the test would fail saying the call was refused.
- **"A pond that fills half a 1080p frame"** is half of the frame's pixels, read from the object-ID target, within one
  point either way (the waves move the pond's edge; 49.75% at the base). The criterion names no view. This one is
  chosen so that a ring changes the picture and is drawn at full strength (What the base does, 3); a pond seen from
  straight above or from far away could meet the words and time rings nobody can see.
- **"Add"** is the difference of the two ponds' median `gpu_ms` over the same 300 frames in one process, as #166's
  and #968's suites read "adds". **"The same pond without"** is the same document with no `rings` in its water, the
  design's `none`; the logic item stays, so the two sides differ in that one field.
- **"Compared with the merge base"** is the lane's, through the `benchmarks/budgets.json` task the other test reads.
  Here it also fixes the side without: a document the merge base draws, as checked.
- **"On the reference Mac in the local preflight"** is the lane's `judgeLimit` on this machine's fingerprint with each
  run's load at its start and end, as #968's redraft reads it. The pixel checks run first because they need no
  reference machine, so a wrong program fails as itself on any Mac; nothing is timed before the machine is read.
- **"Drawn"** is at least 8 pixels changed in the cell's own patch. The rain's rings at the base, weaker than these
  (29% to 71% of full strength against 50% to 88%) and smaller (radius 3 to 7.5 cm against 7.5 to 30 cm), each
  changed 58 pixels or more, so 8 is far under what a drawn ring changes, and the pictures are otherwise equal. The
  ages, 0.25 to 1 s, keep the crest clear of the centre, where it has no length, and of the end, where it has faded.
- **The crest's width** is not in the issue, which says the ring is the rain's. The patch's margins take the base's
  rain: 1.5 cm, cut at three widths. With the waves' 0.2 m counted, a crest 0.25 m wider would still leave every
  other ring outside a patch.
- **`speed`, `span` and `strength`** are left unwritten, so the budget is held at the Fields row's defaults.
- **The film's length and rate**: 300 frames, as the base's water suites time, at the document's own 60 frames a
  second so that a frame and a logic step fall on one flick and every frame's 64 rings are known exactly.

## What isn't asserted

- A ring's radius, or its centre to the millimetre (criterion 1); seek against play (3); the cap's refusal (5). The
  rows are read only as far as "64, alive, one a cell".
- That the pictures are equal outside the rings (criterion 2 holds what remains of a ring), or that a ring looks
  right (criterion 9).
- The `benchmarks/budgets.json` task, its command and what its mode prints (the other test and the implementer).
- The reply's `passes_ms`, the rows' order, and the cost of the logic item's bake, which is not GPU time and is in
  both sides.

## The base run

At the base no ring exists, so the timing cannot run there and no `BASE-FAILURE.txt` is kept. What was run at the
base, on a Mac17,10 on mains with a load average of 120 to 290 on its 18 cores, so none of it is a timing:

- The checks under "What the base does", in two scratch files since deleted: the fixture's pond without rings drawn
  at frames 120, 121 and 141 with its logic item; the same pond with `rain: 0.8`; both from straight above; the
  `depth` target of frame 120.
- The test itself, once: the base takes the document with `water.rings`, draws both ponds' 300 frames and lists no
  ring, so the test fails at its first assertion of step 2, never at load and before the machine is read:
  `frame 120 (2.000 s) lists 64 rings on the pond: expected +0 to be 64`. Steps 3 and 4 did not run.
- The machine's gate, on its own: `judgeLimit` on five empty readings read INCONCLUSIVE, naming the thermal state
  (`fair`) and a load of 283.7 above the 18 cores. On that machine a program that passed step 2 would fail
  `INCONCLUSIVE:` at step 3; that path was not run through the test.
- `npx tsc -p tests/acceptance/2760-redraft-ac8/tsconfig.json`: exit 0.
