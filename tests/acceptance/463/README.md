# Acceptance tests for #463: art@1, twelve painterly looks named by technique

Written first, from issue #463 (its summary, Scope, Fields, three acceptance criteria, Proof line and Depends on), the
design sections it links and those they lean on, and base commit `0e5572731` ("Merge pull request #2529 …"), by a job
that never saw an implementation; none existed, and no other branch, worktree or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one file per criterion, plus exactly the planted programs the first criterion names.

## What was read

- Issue #463, live with `gh issue view 463 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: Films and figures on the canvas (Looks; Canvas done: "a dozen painterly looks with
  motifs, whose strokes hold in 3D (art@1)"); Look; Dogfooding; Tests written first. AGENTS.md.
- `docs/canvas-primitives.md`: Pack: art@1 painterly looks (fields, semantics: each look a look asset whose finish is
  a GPU operator from the closed step list, the pack data only; cost: "each look states its GPU ms at 1080p in 2D and
  3D, measured on the reference Mac, and fits the showpiece class"); Look `look@1` and its rows regions and edges
  ("About 2× the frame while an edge is in view: each look renders its side offscreen, then one composite pass"),
  motifs and strokes on surfaces; Pack: print@1 (for the shape of a look pack).
- At the base, only to find the surfaces that exist and how earlier suites drive them: `crates/deep-gpu-layer`
  (`main.rs`'s planted names, `film.rs` (`look`, `packs`, `events` and `switches`, `document`), `view3d.rs` (`look`,
  `packs`, `timings`), `regions.rs` (a shot's look and regions, a region's own edge, 2D masks), `golden.rs` (the
  `pixel_hash` oracle and the blank guard), `budget.rs`); `crates/deep-canvas-motion/src/shots.rs` (a shot needs a
  camera); `crates/deep-canvas-marks/looks/`, `packs/studio-1.0.0/looks/` and `packs/*/pack.json`;
  `benchmarks/canvas.mjs` (`look-frames`, `look-switch`, `drawn-frames`), `benchmarks/budgets.json`,
  `scripts/benchmark.mjs` (`judgeLimit`, `validateBudgets`, the reference Macs), `scripts/proof-change.mjs` (criterion
  IDs), `scripts/lanes.mjs` (`alone`); and the suites `tests/acceptance/149/` (goldens, `draws_black`, budgets, the
  taste call), `462/` (regions, README layout, `twins.json`), `422/` and `466/` (packs on calls), `449/` (the helpers
  this suite imports).

## What the base already does, which these tests don't credit

`deep-gpu run`'s `film2d` plays a 2D film under one look (a shipped look's ID or an inline look@1), with `packs`
(operators only), `capture` (each listed frame's `final` PNG), `hash`, `events` (a look switch at a frame) answered by
`switches: [{frame, ms, ground}]`, and `document: {opened, played}`; `view3d` draws a 3D document under an inline
look@1 with `packs` (recipes), `capture`, `targets: ["final"]` and `timings`. Both take `looks: {name → look@1}` for a
shot's look and its regions, each look drawing its side and one composite pass mixing them (#462). `golden` with
`oracle: "pixel_hash"` runs the blank guard first. `--planted draws_black` blacks every final frame in both. No pack
carries looks, no `art.*` look exists, `view3d` takes no look ID at all, and `benchmarks/canvas.mjs` has no mode that
times a look pack, a region's edge or a switch between pack looks.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/463 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/463/tsconfig.json
rm -rf tests/acceptance/463/node_modules/.vite
```

`ac1-goldens.test.ts` and `taste.test.ts` build `deep-gpu` once each, in `beforeAll` (#449's `useBins`: `cargo build
--locked --bin deep-gpu`, honoring `CARGO_TARGET_DIR`), and draw on the Metal device; `ac2-budgets.test.ts` runs
`node benchmarks/canvas.mjs <mode>`, which builds its own release binary. Each test writes into its own temporary
folder, deleted after it; processes are started by `spawnSync` and stopped only by their own timeout.

**`scripts/lanes.mjs` needs this suite in its `alone` list**, beside the other `deep-gpu` suites. This README is the
instruction; the implementer adds the line:

```js
alone.push('tests/acceptance/463/');
```

Gates: off macOS a drawing test fails `INCONCLUSIVE:`, never passing; no cargo is `BLOCKED:`, a failed test. A missing
golden, a golden from another machine, a timing off a reference Mac, on battery or under load, and a missing or stale
taste call each read `INCONCLUSIVE:`, never a pass.

## The surface under test

The issue names the pack and its twelve look IDs but no call. **Every pack layout, call field, planted name, golden
file, bench mode, budget task and report field below that the issue or the design doesn't give is this job's
invention**, the smallest the criteria need, on calls that already exist. The implementer builds exactly these, or a
dispute goes to a blind redraft. `deep-gpu run`'s scenario is #377's (`{"out", "calls"}` in, `{"ok": true,
"replies"}` out); #149's, #417's and #462's fields hold unchanged except where said below.

### The pack (invented layout)

`packs/art-1.0.0/pack.json`, as first-party packs ship, with:

```json
{"name": "art", "version": "1.0.0", …, "looks": {"art.flow_brush": …, "art.dab": …, …, "art.gold_leaf": …}}
```

`looks` is an object whose keys are exactly the issue's twelve IDs. What each value holds (a look@1, or a file of the
pack that holds one, with its motifs, transition, edge, preview, cost and limits) is the implementer's; the tests read
only the keys.

### `film2d` and `view3d`: a pack look by ID (invented)

```json
{"call": "film2d", "doc": {…}, "look": "art.dab", "packs": [{"id": "deepbuild/art", "dir": "<repo>/packs/art-1.0.0"}], …}
{"call": "view3d", "doc": "<path>", "look": "art.dab", "packs": [{"id": "deepbuild/art", "dir": "<repo>/packs/art-1.0.0"}], …}
```

- `look` may be the ID of a look in a pack the call's `packs` installs; it draws as that look@1 would inline. Today
  `film2d` takes only a shipped look's ID and `view3d` none.
- The same holds wherever these calls take a look: each value of `looks` (`{"outer": "art.dab", "inner": "art.dot"}`
  for a shot's look and its region) and `film2d`'s `events[].look`.
- Everything else is as at the base: `film2d` with `hash: true` and `capture: [n]` answers frame n's `pixel_hash` and
  `final`, and `document: {opened, played}`; `view3d` with `capture: [n]` and `targets: ["final"]` answers frame n's
  `pixel_hash` and `final`.

### Planted programs (`deep-gpu run --planted <name>`; `twins.json` maps criterion 1 to both)

| Name | The wrong program |
|---|---|
| `draws_black` | #149's: every final frame drawn black, in `film2d` and `view3d`, whatever the look |
| `halftone_pop_takes_dot_passes` (invented) | `art.halftone_pop` draws the scene with `art.dot`'s passes (its finish operator) instead of its own, in 2D and 3D; every other look, `art.dot` among them, draws as it does without the plant |

### The goldens (invented store)

`goldens/<look ID>.<2d|3d>.golden.json`, e.g. `goldens/art.flow_brush.2d.golden.json`, each `{"fixture", "fingerprint",
"pixels"}` as #149's: `golden`'s own fingerprint `{os, gpu, driver, wgpu}` and the frame's RGBA8 hash. They hold
hashes, not pictures. The implementing run records them once, on a reference Mac (Mac15,7, Mac15,12 or Mac17,10),
after every other criterion passes:

```sh
DEEP_463_RECORD_GOLDENS=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/463 ac1-goldens.test.ts -t "matching its golden"
```

That run writes only missing goldens, refuses off a reference Mac and on a blank frame, and ends `INCONCLUSIVE:`; run
the suite again without the variable. These goldens are set by the implementation, so each is `regression_only`: it
gates later changes and proves nothing else. `goldens/` and `TASTE.json` are the only things under this folder the
implementing run writes.

### AC2's reports (invented modes and tasks)

Three modes of `benchmarks/canvas.mjs`, each printing one JSON line last, from a release `deep-gpu`, one warm-up run
and five, each run a fresh process, as #149's and #417's modes do; and three tasks in `benchmarks/budgets.json`, each
`{"command": ["node", "benchmarks/canvas.mjs", <mode>], "margin": 0.5, "limits": {}, "targets": …, "initialReason":
"…#463…"}`, so the perf lane compares each with the merge base.

| Task | Mode | `targets` | Report |
|---|---|---|---|
| `canvas-art-frames` | `art-frames` | `{"frame_gpu_p95_ms": 10, "frame_cpu_p95_ms": 4}` | `{"task", "fingerprint": {…, "build": {"profile": "release"}}, "runs": [{"looks": {"<look ID>": {"2d": {"fixture": "tests/acceptance/463/fixtures/scene.json", "size": [1920, 1080], "frames": [{"gpu_ms", "cpu_ms"}, …]}, "3d": {…}}}}]}` |
| `canvas-art-regions` | `art-regions` | `{"edge_frame_ratio": 2}` | `{"task", "fingerprint", "runs": [{"pairs": [{"look", "region", "2d": {"fixture": "tests/acceptance/463/fixtures/scene-region.json", "outer": {"frames"}, "inner": {"frames"}, "edge": {"frames"}, "hashes": {"outer", "inner", "edge"}}, "3d": {…}}]}]}` |
| `canvas-art-switch` | `art-switch` | `{"switch_ms": 100}` | `{"task", "fixture": "tests/acceptance/463/fixtures/scene.json", "fingerprint", "runs": [{"samples": [{"from", "to", "ms", "ground"}, …]}]}` |

- `art-frames` plays the scene's 2D film (`film2d`) and 3D scene (`view3d`, `timings: true`) in every look at
  1920 × 1080, 30 frames a second, 30 warm frames then at least 300 timed, each frame's `gpu_ms` and `cpu_ms` as
  `film2d` and `view3d` answer them.
- `art-regions` takes each look with a region in the next look of the issue's list (`art.gold_leaf` with
  `art.flow_brush`). For each, in 2D and 3D, at 1920 × 1080, timed as above: `outer`, the plain scene
  (`fixtures/scene.json`) in `look`; `inner`, the plain scene in `region`; `edge`, `fixtures/scene-region.json` with
  `look` as the call's look and `looks: {"outer": look, "inner": region}`. `hashes` are each side's `pixel_hash` at
  frame 30.
- `art-switch` plays the scene's 2D film from the first look and switches through every ordered pair of distinct art@1
  looks with `film2d`'s `events`, each sample one `switches` entry: `ms` from the request to the first frame drawn in
  the new look, read back from the window, as `look-switch` does for the shipped looks.

### Fixtures

`fixtures/scene.json` is the shared test scene, an original subject: a lighthouse on a headland at dusk, the sun low
and a sailing boat crossing the bay, 1920 × 1080 and 12 s. `"2d"` is a film (`rect@1`, `circle@1`, `path@1`, an
orthographic `camera@1` that maps page u to pixels one to one); `"3d"` the same subject as a scene (`mark.box@1`,
`mark.sphere@1`, `mark.cylinder@1`, a perspective camera, a sun). In both the boat moves along a channel the whole 12 s.
Both paint only with the roles every shipped look names (`ground`, `ink`, `muted`, `accent`), with fills and strokes
the base already draws, and name no look, motif slot or pack. `fixtures/scene-region.json` is the same two documents
with an unseen mask `zone` covering the right half of the frame and one shot `scene`, 0 to 12 s, in look `outer` with
the region `{mask: "zone", look: "inner", width: 24, seed: 463}`, its `edge` left to the region look's own; the boat
crosses the edge.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, applied to the live issue). Every test title starts `AC<n> #463.<id>`.

| Criterion | File | What it reads and asserts | Wrong programs it fails |
|---|---|---|---|
| AC1 `#463.d6ee1ca5` the scene in every look, 2D and 3D, unchanged, matching its golden after the blank guard; black reads BLOCKED; another look's passes miss the golden, naming the look | `ac1-goldens.test.ts` (3) | `pack.json`'s `looks` are exactly the twelve. The scene at frame 30 in each look, 2D and 3D: drawn; the 2D film opens as one revision hash for all twelve and plays it unchanged, the 3D file's bytes unchanged; the twelve looks draw twelve different pixel hashes in each dimension; through `golden`: none blank, none FAIL, then each PASS (missing or foreign goldens INCONCLUSIVE). Under `draws_black` all 24 read `BLOCKED` `blank`. Under `halftone_pop_takes_dot_passes`, `art.halftone_pop`'s pixels change and `art.dot`'s don't, and the misses name `look art.halftone_pop 2d` and `3d` and no other look | `draws_black`; `halftone_pop_takes_dot_passes` (named: `look art.halftone_pop`); a pack short of a look; a look that edits the scene; looks that draw alike; a blank look |
| AC2 `#463.7c8d3f4b` budgets against the merge base: showpiece at 1080p in 2D and 3D, an edge in view at most 2× the frame, a switch under 100 ms | `ac2-budgets.test.ts` (4) | The three tasks in `budgets.json` with the numbers above, margin 0.5 and `#463` in the reason, through the lane's validator against the merge base's file. Each run's worst look p95 against 10 ms GPU and 4 ms CPU; each run's worst pair ratio (p95 GPU with the edge ÷ the costlier look alone) against 2, each edge frame differing from both looks alone; each run's slowest of the 132 switches against 100 ms; five runs by `judgeLimit` | a look over budget in either dimension; an edge that draws each side twice or more; a switch that recompiles; a bench that skips a look, a pair or a switch |
| AC3 `#463.fee183bf` shown to you, one taste call | `taste.test.ts` (1) | Writes the 24 screenshots from the renderer's own final PNGs to `target/acceptance/463/`; reads `TASTE.json` (below) | none: it is a person's call |

The Proof line's "each look's measured cost" is AC2's `art-frames` report, which names each look in each dimension.

## Readings where the issue and design leave a choice

- **"One test scene … in 2D and in 3D."** One subject with a 2D film and a 3D scene, as #149's families have; a single
  document can't be both, since `film2d` refuses a 3D item. "With no change to its data" is read across the looks: the
  same document goes to all twelve and none changes it while drawing.
- **A look by ID.** The design names looks by ID (`art.flow_brush`), so the calls do, with the pack installed through
  `packs` as #429's calls install packs, rather than the test reading look@1s out of the pack and sending them inline.
- **"Every art@1 look"** is the pack's `looks`, held to the issue's twelve.
- **The judged frame** is one per look and dimension, 1 s in, where the boat has moved; a look's frame is its pixel
  hash at 1920 × 1080, the size the budgets name.
- **"Another look's passes"** is a look's finish operator, the GPU operator the design says each look's finish is.
- **"Fails, naming the look"**: the test's own failure lines name the look (`look art.halftone_pop 2d misses its
  golden`), as #149 reads "naming the family".
- **The showpiece budget at 1080p** is the class's 10 ms GPU and 4 ms CPU a frame, at p95 over each run's frames.
- **"A region's edge costs at most twice the frame while in view"** follows the design's cost line, "about 2× the
  frame while an edge is in view: each look renders its side": the frame with an edge in view on every frame, against
  the costlier of its two looks drawing the same scene alone, by p95 GPU time. Every look takes the region role once
  and the outer role once.
- **"Switching looks"** is read in 2D, where a look switch exists (#417's `events`), over every ordered pair of art@1
  looks; the criterion places no switch in 3D.
- **"Compared with the merge base"** is the perf lane's comparison through `budgets.json`, as #149's AC10 reads it.
- **The load** is read at the bench command's start and end and given to `judgeLimit` for each of its five runs.

## The taste call

`taste.test.ts` writes, from one run, the scene at frame 30 in each look: `<look>-2d.png` and `<look>-3d.png`, the
look's ID less `art.` (`flow_brush-2d.png`, …, `gold_leaf-3d.png`), 24 files, 1920 × 1080, byte for byte the renderer's
final PNGs, in `target/acceptance/463/`, printing each SHA-256. Show them to the owner in the session and attach them to
the PR; record the one answer in `tests/acceptance/463/TASTE.json`:

```json
{"issue": 463, "criterion": "#463.fee183bf", "verdict": "looks_right" | "looks_wrong", "who": "…", "when": "<ISO 8601>",
 "screenshots": {"flow_brush-2d.png": "<sha256>", …, "gold_leaf-3d.png": "<sha256>"}, "note": "…"}
```

`screenshots` names all 24. With no file, or one made on other bytes, the test is INCONCLUSIVE; `looks_wrong` fails it.
No other test reads a picture to judge it.

## Not tested

The issue's fields that no criterion holds: each look's motifs, signature transition and edge style beyond drawing the
region pair; the pack's preview, its stated cost and known limits as data; "it can never" (carry code or shaders,
recolor status, name a living artist, a studio or a trademark); motion over time beyond the one judged frame; a look
switch in a 3D view; the CPU side of a region's edge; the later period-set pack.

## At the base

See `BASE-FAILURE.txt`: every test fails at a missing surface (no pack, no look by ID, no plant, no bench mode or
task), and the taste test fails before it can write a screenshot.
