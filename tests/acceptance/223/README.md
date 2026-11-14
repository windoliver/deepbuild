# Acceptance tests for #223: warps, a group's paths and glyphs carried through a formula

Written first, blind, from issue #223 (its Scope, its Fields, its nine acceptance criteria, its Proof line and its
Oracle note; no comments), read live with `gh issue view 223 --repo windoliver/deepbuild --comments`; the design
sections it names and those they lean on; its Oracle page with the upstream files that page pins; and base commit
`65f383b3f` ("motion(#222): cues@1's param declares its form, so main builds again"), by a job that never saw an
implementation; none existed, and no other worktree, branch, PR or session was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one
file per criterion, plus the three planted wrong programs the criteria name. The Oracle page's upstream tests are
ported in `tests/acceptance/223-oracle/`.

## What was read

- Issue #223, live. Its criteria are quoted, exactly as their `- [ ]` lines, at the top of each test file.
- `docs/canvas-primitives.md`: Frame and group: warp (fields, semantics, cost, "It can never"); Path `path@1`: function
  (the `grid` form); The closed function list (the Complex row, already in `crates/deep-canvas/src/expr.rs`); Vector
  field `vector_field@1` (the stream table "in data layout `streams@1` (its `fn` with its vars' values, its `step` and
  each stream's points)"); Cue list `cues@1` (the `cue.kind@1` registry, the cue kit and its planted entries); Logic:
  data layouts (`data.layout@1`).
- `docs/technical-design.md`: Films and figures on the canvas; How we know version 0 works, with Criteria to tests,
  Wrong programs (plants live in test code or behind a build feature a release build refuses) and Dogfooding.
- At the base, for surfaces only: `crates/deep-marks-render` (`src/lib.rs`'s `parse`: `path`, `check`, `raster` and
  their `planted` values; `src/raster.rs`: `path_answer`, `planted_path`, `subpaths_of`); `crates/deep-canvas-marks`
  (`function.rs`: the fn forms; `path.rs`); `crates/deep-show` (`main.rs`'s calls, `path`, `eval` with `data_hash`
  and `clean`, `registry`, `registries`; `function.rs`'s `path_reply`; `data_hash.rs`; `Cargo.toml`'s
  `test-leave-out-data` and `test-*` features); `crates/deep-canvas-test-modules` (README: one cargo feature per test
  module, compiled into deep-show); `crates/deep-canvas-motion/src/cues/kit.rs` (the cue kit's rules and planted
  entries); `crates/deep-canvas/src/registry/core_lists.rs` (`data.layout@1`); `packs/verbs-1.0.0/`; the sibling
  suites `160/`, `490/`, `222/`, `222-oracle/`, `226/`, `226-oracle/`, `415/`, `524/` (READMEs, helpers, budget and
  taste tests); `scripts/proof-change.mjs` (`criterionId`). Code was read only to learn the surface; every expected
  value comes from the issue and the design.

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/223 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/223/tsconfig.json   # type-check
rm -rf tests/acceptance/223/node_modules/.vite
```

Each file builds what it uses once, in `beforeAll`, with `cargo build --locked` (`CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` unless set, honoring `CARGO_TARGET_DIR`), copies each binary out of the target folder right
after its build, and fails every test whose build failed:

| Binary | Build | Files |
|---|---|---|
| `render` | `--bin deep-canvas-render` | ac1, ac2, ac3, ac4, ac5, ac7, ac9 |
| `render-release` | `--release --bin deep-canvas-render`, only on a reference Mac | ac7 |
| `show` | `--bin deep-show --no-default-features --features full` | ac4, ac8 |
| `show-swirl` | `--bin deep-show --no-default-features --features full,test-leave-out-data,test-swirl` | ac6 |

The files build cargo binaries and one times a warp, so they run one at a time. The implementer adds to
`scripts/lanes.mjs` (this job writes only its two folders):

```js
alone.push('tests/acceptance/223/', 'tests/acceptance/223-oracle/');
timed.push('tests/acceptance/223/ac7-budgets.test.ts');
```

Every `it` passes a long timeout (`TIMEOUT`, 60 min; twice that for the budgets). Temporary folders are deleted;
`ac9-taste.test.ts` keeps its pictures (The taste call). Node built-ins and vitest only. A timing that can't be judged
here skips with a message starting `INCONCLUSIVE` (as #160's budgets); the taste call fails `INCONCLUSIVE:` without
its record. Neither is ever a pass.

## The surface under test

The issue names fields and no code API, so these tests extend the base's own surfaces: `deep-canvas-render`'s `path`
(#160), `check` and `raster` (#373); `deep-show run` (#393) with `deep show`, `eval` (`paths`, `data_hash`,
`clean`), `path`, `registry` and `registries`, and the scenario's `planted` and `packs`. **Every name below that the
issue or the design doesn't give is this job's choice, marked *(chosen)***; the implementer builds exactly these, or a
dispute goes to a blind redraft. Everything the earlier READMEs define for these calls stays as it is.

### Documents: the design's fields as the tests spell them

- **`warp`** is `params.warp` on a `group@1` in a 2D writer layer, an object holding exactly one of `map: {x: expr, y:
  expr}`, `linear: {matrix: [[a, b], [c, d]]}` or `complex: {f: expr}` (the design's `linear {matrix}` and `complex
  {f}` written as keys) *(chosen spelling)*, and `vars`, `mix`, `plane: {origin: [u, u], unit: u, y: "up" | "down"}`,
  `ends: "redraw" | "warp"`, `flow: {streams: ID, time: number}` as the design names them. A matrix is by rows: (x, y)
  ↦ (a x + b y, c x + d y). `vars` binds `{u: "time"}` (t in seconds, as drivers' vars do). `mix` is a number, and a
  channel moves it at `items/<group>/params/warp/mix` *(chosen path, the param's own)*. The fixtures put no `at` on a
  warped group or its children, so group space is document u.
- **`fn.grid`**: `params.fn: {grid: {x: [a, b, step], y: [a, b, step]}}` with no scales, in u. It draws one sub-path per
  line, at a, a + step, … b on each axis, each **one straight segment from end to end** *(reading: the grid's anchors
  are its lines' ends; criterion 1's anchors-only plant is only 100 u off on x = 1 if so)*. Sub-path order is the
  implementer's, but a warp keeps it: sub-path i of a warped item draws what sub-path i draws unwarped.
- Paint roles are named (`ink`); IDs are short; no document holds a text item.

### `deep-canvas-render path` (#160's line), what this suite adds

- `subpaths`, `segments` and `tessellation` of an item under a warping group are the item as drawn after every warp of
  its ancestor groups, in document u. A warped segment is drawn as a cubic (`C`), every cubic of the item cut into the
  same n = 1, 2, 4 … pieces, so `segments` is n × the unwarped item's.
- `ends.<end>` (#160's `{kind, tip, angle, length, width}`), under a warp: with `ends: redraw`, the head drawn at the
  mapped end (`tip`), along the mapped tangent (`angle`), at its own size (`length`, `width`); with `ends: warp`, the
  head's outline mapped with the path. **`outline`** *(chosen)*: on every end, the head's drawn outline as a list of
  its corners `[[x, y], …]` in document u (for an arrow, at least its tip and its two barbs), warped or not.
- With `timing: true`, on an item under a warp: **`warp_points`** *(chosen)*, the points the warp mapped for the item in
  this frame (0 when it reused them), and **`warp_ms`** *(chosen)*, this frame's wall time spent mapping them, its
  splitting included, measured by the binary (0 when it mapped none).
- Planted value **`warp_maps_anchors_only`** *(chosen)* on `path`: a warp that maps each segment's two ends and draws
  the segment straight between them, all else as shipped. Any other unknown value stays `bad_input`.

`check {doc, look}` passes each fixture with no error; `raster` draws warps as `path` reports them.

### `deep-show run`, what this suite adds

- **`{"call": "path", doc, item, t}`** *(chosen: `t`)*: `t` in flicks (or the time grammar's text), default 0. The
  reply's `subpaths` (each a list of points, as at the base) are the item as the presented document draws it at t,
  after every warp of its ancestor groups (its mix at t, its flow), in group space (document u in the fixtures).
- **`eval`'s `data_hash`** (#222's) covers each drawn item's geometry as its warps leave it at t, so a homotopy's hash
  moves with t *(reading)*; `eval`'s `paths` reads `items/<group>/params/warp/mix` at t.
- Scenario **`planted: "flow_by_vector_field_kind"`** *(chosen)*: a warp that resolves `flow.streams` by requiring the
  named item to be a `vector_field@1`, so any other item is refused at check with an error naming it; all else as
  shipped.
- **`data.layout@1`**, as `registries` lists it, holds the core's entry **`streams@1`** in every build, the build
  without the data module included (the issue: "`streams@1` enters the core's `data.layout@1`").

### The test canvas module (criterion 6) *(chosen)*

`test.swirl`, in `crates/deep-canvas-test-modules`, compiled into deep-show under the cargo feature **`test-swirl`**
(never in a shipped build). Its one kind, **`test.swirl@1`**, `params: {step: number}`, draws nothing and builds at
check a stream table in data layout `streams@1` for the field `fn: {x: "-y", y: "x"}` at its `step` (its streams may be
empty). A document using it names `requires: {modules: {"test.swirl": "^1"}}`.

### The warp verb (criterion 8)

The first-party verbs pack (`packs/verbs-1.0.0/`, `deepbuild/verbs@1.0.0`, #222) gains the `cue.kind@1` entry
**`warp`**. A cue plays it as `{id, kind: "warp", targets: [<group>], params: {warp: <group>}, span}` *(reading: the
cue is "over a group", and `warp: ID` names the group whose warp it keys, the same group)*. Its expansion keys
`items/<group>/params/warp/mix` from 0 at the cue's start to 1 at its end, every key inside the cue's span, on the cue's
ease. The registry's `planted` list gains an entry named **`warp`** *(chosen)*: the warp verb whose last key lands one
flick past its span, which must FAIL the kit's `inside_span` (#222's rule IDs), its message naming `warp`.

## Fixtures

All generated in `helpers.ts` and the test files; no file on disk. Figures are 800 × 600 u with the plane of origin
(400, 300) u, unit 100 u, y up, unless a test says otherwise.

| Fixture | What it is | Used by |
|---|---|---|
| the grid | `fn.grid` x [300, 500, 10], y [200, 400, 10]: 21 + 21 lines over the plane's [−1, 1]², stroke 1, a child of `g` warped by `complex {f: "cmul(z, z)"}` at mix 1; its twin in a plain group | ac1, ac7, ac9 |
| times i | `complex {f: "cmul(vec2(0, 1), z)"}`, plane `{unit: 100, y: up}` or `{unit: 100, y: down}`, origin left at its default (0, 0); the path M 100 0 L 150 0 | ac2 |
| the crossing | `complex {f: "cexp(z)"}`; `h` along y = 1 and `v` along x = 1, each from 0.8 to 1.2 | ac2 |
| the linear mixes | `linear {matrix}` at `mix: 0.5`, [[0, −1], [1, 0]] and [[2, 1], [1, 1]]; the path from the plane's (1, 0); and `turn`, M 0 0 L 100 0 at (400, 300), its `at/rot/2` keyed 0 → 90 over 1 s | ac3 |
| the homotopy | `map {x: "x", y: "y + 1.5 * u * sin(2 * x - 6 * u)"}`, `vars: {u: "time"}`, mix 1, on M 100 300 L 700 300 stroked 4 u, 1 s; for the recording, its mix keyed 0 → 1 over the second | ac4, ac9 |
| the arrow | M 400 400 L 400 200, stroke 3, `ends: {end: arrow, size: 4}`, under `linear {matrix: [[1, 1], [0, 1]]}` with `ends: redraw` or `warp`; its twin plain | ac5, ac9 |
| the flow | 640 × 480, plane origin (320, 240): `swirl` (`test.swirl@1`, step 0.01); `g`, identity `linear` at mix 1 with `flow: {streams: swirl, time: π/2}`; the unit square from the plane's (1, 0) to (2, 1), written back to its start | ac6 |
| the budgets | the grid with its mix keyed 0 → 1 over 2 s (moving); at mix 1 beside a moving dot (still) | ac7 |
| the warp cue | 640 × 360, plane origin (320, 180): `g` sheared by [[1, 1], [0, 1]] at `mix: 0`; `grid`, `fn.grid` x [270, 370, 10], y [130, 230, 10]; the cue list `list` with `{id: shear, kind: warp, targets: [g], params: {warp: g}, span: 1s}` | ac8 |

## Criteria to tests

IDs are `#223.` and the first 8 hex digits of SHA-256 of each criterion's text (`scripts/proof-change.mjs`). Each
test's name starts with `AC<n> <ID>`; each file's header states its fixtures, numbers and wrong programs in full.

| Criterion | File (tests) | What it asserts | The wrong program each fails on |
|---|---|---|---|
| AC1 `#223.532d1014` | `ac1-grid.test.ts` (2) | the plain grid is the 42 lines, each one segment; warped: 42 cubic sub-paths, every cubic cut into one power of two n ≤ 64 of pieces; each line's 10,000-point analytic z² image within 0.5 u of the drawn line and back. Under `warp_maps_anchors_only`: the line x = 1 more than 5 px off its image, and the judge fails naming it | the base (fn grid refused, no warp); the planted anchors-only warp; uneven or over-64 cuts |
| AC2 `#223.48c2501c` | `ac2-plane.test.ts` (2) | times i: (100, 0) → (0, −100) u with y up, (0, 100) u with y down, within 0.01 u; cexp: `h` and `v` cross within 0.5 u of e^(1 + i) at 90° ± 0.5° | the base (no warp); y read down by default; `y` ignored; a non-conformal or misplaced cexp |
| AC3 `#223.9d800d51` | `ac3-linear.test.ts` (1) | (1, 0) → (0.5, 0.5) and → (1.5, 0.5) within 1e-9 in the plane; the key's (1, 0) at 0.5 s reads (±0.7071, ±0.7071) within 1e-4, length 1 | the base; a matrix read by columns; a mix that interpolates the angle |
| AC4 `#223.bd85dee7` | `ac4-homotopy.test.ts` (2) | 1,000 seeded times: each clean `eval`'s `data_hash` equals the play's, and at least 990 are distinct; raster at 0.4 and 0.8 s: every column from 120 to 676 measures 4 ± 0.1 px across, centred on the image | the base (a still, straight line); a stroke mapped with its path; a seek that differs from the play |
| AC5 `#223.3a3308e4` | `ac5-arrow.test.ts` (2) | `redraw`: tip at (500, 200) within 0.5 u, angle −45° within 0.5°, length the twin's within 0.5 u; `warp`: the head's outline is the twin's sheared within 0.5 u, and not the redrawn one | the base; a head mapped under `redraw`; a head along the unmapped tangent; the two modes swapped |
| AC6 `#223.bc85d7ee` | `ac6-flow.test.ts` (2) | the build without data seals, holds marks2d, lists `streams@1`; the film presents and the square is carried to the plane's (0, 1)–(−1, 2) within 0.5 u both ways. Under `flow_by_vector_field_kind`: refused, an error naming `swirl`, and the judge fails naming it | the base (no test-swirl: the build fails); the planted kind-resolving flow; a flow that needs the data module; a field read y down |
| AC7 `#223.955a0bbf` | `ac7-budgets.test.ts` (2) | moving: median ns a point (warp_ms × 10⁶ ÷ warp_points) over frames 10–69 judged against 40; still: no point mapped after frame 0, and five release runs spending 0 ms; **INCONCLUSIVE off the reference Mac** | the base (no warp, no warp_points); a still warp that remaps; one dearer than 40 ns a point |
| AC8 `#223.7ab209fd` | `ac8-cue.test.ts` (2) | the film presents; marker `cues.shear` over [0, 1 s]; a channel on `items/g/params/warp/mix`, every key inside [0, 1 s]; mix 0 at the start, 1 at the end; the grid at 1 s within 0.5 u of the sheared grid; `warp` listed first_party, its kit PASS on all five rules. The planted `warp` FAILs `inside_span`, naming `warp` | the base (no warp verb); a verb keying outside its span or on another path; a kit that admits the plant |
| AC9 `#223.85ce0afe` | `ac9-taste.test.ts` (1) | writes the three screenshots and the recording from `raster`'s own frames, prints their SHA-256, then reads the record: none or another's is INCONCLUSIVE, `looks_wrong` fails | the base (the grid's fn refused); any run without your call |

## The taste call

`ac9-taste.test.ts` keeps, in `DEEPBUILD_EVIDENCE_DIR` (else `deep-223-taste` under the temporary folder), named by
their SHA-256: `grid-z-squared-<sha>.png` (the grid under cmul(z, z)), `homotopy-line-<sha>.png` (the homotopy at
0.75 s), `arrow-shear-<sha>.png` (the arrow, `ends: redraw`), each `raster`'s PNG byte for byte, and
`homotopy-mix-<sha>.apng`, the homotopy's 30 frames at 30 fps over its 1 s as its mix moves from 0 to 1, put into one
animated PNG unchanged. It prints their paths, for the PR and the session. You record the one call in a file named by
**`DEEPBUILD_TASTE_223`** (as #524's): `{"criterion": "#223.85ce0afe", "by": "you", "screenshots": [sha256 × 3],
"recordings": [sha256], "call": "looks_right" | "looks_wrong"}`. This job records none; attaching the files to the PR
and showing them in the session is the implementer's, outside any test. No other test reads a picture to judge it.

## Readings and choices where the issue leaves one

1. **One test surface per need.** Geometry, ends, rasters and timings come from `deep-canvas-render path` and `raster`,
   which already link marks2d and the motion program. Criteria 4 (by its evaluated-data hash), 6 (a build without the
   data module) and 8 (a cue list and the verbs pack) need `deep-show`, so its `path` gains `t`.
2. **px are u**: every figure draws at zoom 1.
3. **"21 × 21 line grid"**: 21 vertical and 21 horizontal lines over the plane's [−1, 1]², step 0.1; "the line x = 1"
   is the plane's. "At 10,000 points per line": 10,000 points evenly spaced along each line, mapped, each within 0.5 u
   of the drawn line, and the drawn line (each cubic at 32 steps) within 0.5 u of that image. "No cubic cut more than
   64 ways": the warped item's segments ÷ the unwarped item's, a power of two, at most 64, the same for every
   sub-path. "More than 5 px off": the largest distance from x = 1's image to its drawn sub-path.
4. **Times i** keeps the default origin (0, 0), the only way "(100, 0) u to (0, −100) u" reads literally; 0.01 u is
   this job's tolerance for a point the criterion gives without one. **The cexp crossing** is read where the two drawn
   lines cross, which must be the image of (1, 1) within 0.5 u, and its angle from the crossing segments' directions.
5. **"Maps (1, 0) to (0.5, 0.5) within 1e-9"** is read in the plane's coordinates (1e-7 u on screen). **"The same turn
   as an `at.rot` key"** is a key from 0° to 90° read at its midpoint; which way `at.rot` turns on screen isn't this
   criterion's, so the key's reading is held by size, (±0.7071, ±0.7071) at length 1, the contrast with the matrix's
   half-size 45° point.
6. **The homotopy's u is t in seconds** (`vars: {u: "time"}`, the film 1 s long), mix 1. **Seeking** is `eval` with
   `clean: true` (a fresh evaluation, nothing read from or written to the session's caches) at each time in a random
   order; **playing** is `eval` in one session at every 60 fps frame and each of the times, ascending. "Equals by
   evaluated-data hash": #222's `data_hash`, which must move with t (at least 990 distinct of 1,000), or the
   comparison could not fail. **"Measures 4 ± 0.1 px everywhere"**: in every fourth pixel column clear of the line's
   ends, at two times, the column's summed coverage over √(1 + s²) (a stroke of width w crosses a column over
   w·√(1 + s²), its curvature terms cancelling to second order); the column's ink must sit on the image, so a straight
   line can't pass.
7. **The shear** of criterion 5 (and 8) is [[1, 1], [0, 1]], the matrix criterion 8 names. **"Its angle to the mapped
   tangent"**: `ends.end.angle` against the sheared arriving tangent; **"keeps its tip's length"**: `length` against
   the unwarped twin's. **"The tip shears"** is read on the head's own outline, the field this suite adds, since a
   head's length and angle "as drawn" don't say how a sheared head is measured.
8. **The flow** sits on an identity `linear` warp, since the design lists a map as the warp's and `flow` as optional;
   the flow carries every split point for `time` along the table's field, (−y, x) in the plane, a turn of 90°
   counterclockwise about the plane's origin in π/2. `time: π/2` is written as a JSON number (its f32 rounding moves the
   square by about 1e-6 u). The test module's item is named only by `streams`; nothing in the film is a vector field.
   "Refuses that item, naming it": `deep show` refuses the film with an error whose JSON names `swirl`; "and fails
   this": the same judge that passes the honest build fails, a failure naming `swirl`.
9. **Budgets.** "40 ns a point" is warp_ms × 10⁶ ÷ warp_points per changed frame, median over frames 10–69 of a 60 fps
   play, five fresh release processes after a warm-up, judged by #160's rule; "costs nothing per frame" is no point
   mapped and no time spent in frames 1–69 of a still warp beside a moving dot. The reference-Mac gate is #160's. "Compared
   with the merge base": the merge base has no warp, so there is no base timing to compare; these tests judge the
   issue's absolute budgets, as #160's did.
10. **The warp cue.** "Keys the warp's mix from 0 to 1 inside the cue's span": the expansion's channel on the mix path,
    every key of the cue's channels inside [start, start + span], and `eval` reading 0 and 1 at the two ends. "Ends on
    the sheared grid": deep-show's `path` at the cue's end against the analytic shear of the grid's lines. "Passes the
    cue kit": the registry's own kit result for the entry, all five rules PASS. "Refused by the kit, naming the verb":
    the planted entry's kit result FAILs `inside_span` with a message naming `warp`.
11. **The taste call** follows #524's: the files from the canvas's own frames (here Vello CPU's, the 2D frames the
    check run draws), the record named by an environment variable, INCONCLUSIVE without it.

## Upstream tests (the Oracle lane)

The issue's Oracle page (`doneright/oracles/issues/223.md`, read from the local sparse clone at its pinned ref) links
upstream tests for criteria 1 to 5, from an upstream animation library and a fork of it, each pinned by commit; 6 to 9
have none. They are ported, re-expressed in this job's own code against our output, in `tests/acceptance/223-oracle/`
(its README). The two graphical tests whose control frames another renderer drew read `BLOCKED:` there, never a pass.

## What the base already does, and these tests don't credit

`deep-canvas-render path` (#160) answers an item's sub-paths, ends and tessellation; `deep-show`'s `eval` has
`data_hash` and `clean`, and `path` answers an item's own fn or `d`; the verbs pack and the cue kit exist (#222) with
planted `indicate`, `fade_in`, `nudge`, `shuffle` and `fade_out`; `data.layout@1` exists with the sandbox module's
first-party layouts; `test-leave-out-data` builds deep-show without the data module. Nothing at the base reads a
group's `warp` (group@1 has no param schema, so the check ignores it), the path fn has no `grid` form (a fn with no
expression and no `over` is refused at check), `path` has no `outline`, `warp_points` or `warp_ms` and no plant of
this suite's names, deep-show's `path` takes no `t`, the verbs pack has no `warp`, `data.layout@1` has no `streams@1`
and no `test-swirl` feature exists. Where each test then fails: `BASE-FAILURE.txt`.

## Not tested, because no criterion asks

A text item moving by its anchor and keeping its glyphs; a vector@1 formula bending with its parts' ids kept; status
colors, bound values and numbers drawn unwarped at their mapped anchor; `max_points` and its refusal naming the group;
`tolerance` other than its default; `vars` bound to a path, channel or control; the interval forms of the closed list
beyond what the cuts show; `streams@1`'s validator and twins (only its listing is read); vector fields writing their
tables (#225); "It can never" (an earlier frame, code). These are the implementer's own tests.
