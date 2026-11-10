# Blind redraft of #405 criterion 4: the geometry audit's and determinism hashing's budgets

Criterion `#405.17969a94` (the first 8 hex digits of SHA-256 of its text, `- [ ] ` dropped, trimmed and whitespace
collapsed, as `scripts/proof-change.mjs`'s `criterionId` computes it; checked against the live issue): "Budgets, on the
reference Mac in the local preflight, compared with the merge base: the geometry audit of a 1,000-part figure takes
under 500 ms, and determinism hashing adds under 5% to render time".

Written from the issue, its oracle page, the design and base commit `903a1c07` ("Merge pull request #2162 …") by a job
that never saw an implementation, a diff, another session's work or the first draft in `tests/acceptance/405/`. The
implementing agent doesn't edit these files (AGENTS.md, Proof). Lean: this one criterion, two tests.

## What was read

- Issue #405 (scope, the Geometry audit and Control sweep fields, the four criteria, the proof line) and its oracle
  page `doneright/oracles/issues/405.md`: no upstream test checks criterion 4; budgets are measured on our build on
  the reference Mac.
- `docs/canvas-primitives.md`: What holds a document to its rules and Check input (8300–8317: `geometry.audit` and
  `document.determinism` among the core's kinds; issues as data `{check, code, severity, ids, path, actual, t, what,
  fix}`; an exception the document declares never passes a definition's check alone); Geometry audit (8840: "≤ 500 ms
  per 1,000 parts, off the UI thread"; each failure names the part IDs); Geometry audit: scenes (8858: `scope: figure |
  scene = figure`); Control sweep (8876); Determinism (9020: canonical renders hashed on the GPU, 16 bytes read back;
  "Cost: Hashing ≤ 5% of render time while checking"); Frame budget (9054); Marks in 3D (4622: `mark.box | mark.cylinder
  | mark.sphere {size: m}`, `paint`); Item and kind (323: `role: part | control | label | data | decoration`); Order
  keys (54); Budget classes (95).
- `docs/technical-design.md`: Document check (1566); Every task carries its own budgets (2543: five runs after warm-up,
  the margin, "compared with the merge base"); Criteria to tests, Criteria in a checked shape, Wrong programs and
  Dogfooding (2628–2660).
- At the base, to learn surfaces only: `crates/deep-show` (`src/verdict.rs`: `judge` runs `document.determinism` and
  returns the core's other kinds, `geometry.audit` among them, BLOCKED `not_run`, and #408's `timing.check_ms` on a
  row; `src/time.rs` `determinism` and `side`; `src/determinism.rs` `render_hash`; `src/hub.rs` Scenario, Claim,
  `shipped_look`, `draw3d`, render-back's `audit_of`); `crates/deep-canvas-scene3d` (`src/look.rs` roles,
  `src/scene.rs` `paint` and the solids, `src/module.rs` the `scene3d.lights` operator and the figure fixtures);
  `crates/deep-canvas-marks/looks/clean.json` (the shipped look's roles); `crates/deep-canvas/src/document/check.rs`
  (profiles, item roles), `src/budget.rs`; `crates/deep-canvas-motion/src/arrange.rs` (render-back's scene audit);
  `scripts/{benchmark,lanes,proof-change}.mjs`; the suites `tests/acceptance/408/` and its `408-redraft-ac5` swap note,
  `1899/`, `1897/`, `1637/`, `1732/`, `306/`. Every expected value comes from the issue and the design.

## The dispute

The first draft's determinism fixture showed the working agent's 1,000 `mark.box@1`, `mark.cylinder@1` and
`mark.sphere@1` parts with a `camera@1` and a `light.sun@1` and no `params.paint` on any part. At the base a lit scene3d
solid takes its colour from its `paint.fill.role` and a solid that names none is refused when shown (`outcome:
"refused"`, `ref_unresolved` at `items/plate/params/paint/fill/role`, "scene3d.lights can't evaluate this"), so no
check could run on that revision. Here every solid names a fill role the shipped clean look has (`accent`, `ink`,
`muted`, `raised`; `crates/deep-canvas-marks/looks/clean.json`, which `deep-show run` resolves when a document names no
look), and each test first requires the agent's show to come back `presented`.

## Run them

They build `deep-show`, and on a fit machine in release, so they run one file at a time and in the timed lane. The
implementer adds these lines to `scripts/lanes.mjs` (this README is the instruction; this job edits nothing outside
its folder):

```js
// #405's criterion 4 runs from its blind redraft: it builds deep-show in debug and, on a machine that can judge a
// timing now, in release, and times the geometry audit and determinism hashing against the lane's rule.
alone.push('tests/acceptance/405-redraft-ac4/');
timed.push('tests/acceptance/405-redraft-ac4/budgets.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/405-redraft-ac4 --no-file-parallelism
npx tsc -p tests/acceptance/405-redraft-ac4/tsconfig.json   # type-check
rm -rf tests/acceptance/405-redraft-ac4/node_modules/.vite
```

The file first runs `cargo build --locked --bin deep-show --no-default-features --features full` with
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` unless set, copies the binary out of `target/` (honoring
`CARGO_TARGET_DIR`) and fails each test if the build failed. It builds `--release` only after `judgeLimit` says this
machine can judge a timing now. Each run writes its evidence store into a temporary folder, deleted after the test.
Node built-ins and vitest only. A test that can't decide here fails with a message starting `INCONCLUSIVE:`, never
passing; the readings each timed run gives are printed.

## The surface under test

**No new binary, call or flag.** #393's `deep-show run` (one scenario line in, one answer line out), its `deep_show`
call from the working agent's session, and #403's scenario `claims` with their `requirements` and the `verdict` call.
Each run is one fresh process whose two calls are the agent's `deep_show` of the figure as a whole revision, then the
verdict on its claim, whose one requirement is the check input under test. A fresh process per run, so nothing an
earlier verdict kept is timed.

### The geometry audit's requirement

Check input `{"kind": "geometry.audit"}`, every other field at its default. Its row in the verdict:

- `result`: `FAIL`, decided, never `BLOCKED` with `not_run` as at the base.
- `issues`: the geometry audit's issues in the design's shape. For each planted pair, an issue with `severity:
  "error"` names both parts' IDs, in `ids` or in another field on it or in its `actual` (its `what` and `fix` text
  aside).
- **`timing.check_ms`**: the geometry audit's own wall time on the requirement, in ms: from the start of the audit of
  the deliverable's current revision to its issues, everything the audit does for it included (each state it audits,
  the parts' true shapes, every pair and every support). The verdict's other work, the show and the process aren't in
  it. It is a finite number, at least 0, and no longer than the whole process.

### The determinism requirement

Check input `{"kind": "document.determinism", "at_times": ["0s", "0.5s", "1s", "1.5s", "2s"]}`, `compare` at its
default (`same_machine`). The agent's show asks for `["issues", "pixels"]`, so render-back has opened the GPU before
the check runs. Its row:

- `result`: `PASS` (seeking to each time draws what playing to it draws, by the GPU pixel hash), `machines: "same"`.
- **`timing.render_ms`**: the wall time the check spends making the canonical renders it compares, in ms: both sides
  (play and seek) at every time, from evaluating the document to each frame's raw pixels. Hashing isn't in it, nor
  keeping a render as evidence (encoding or storing a PNG). Greater than 0.
- **`timing.hash_ms`**: the wall time the check spends hashing those renders, in ms: every step from a render's raw
  pixels to its 128-bit pixel hash (any upload, the GPU reduction, its 16-byte readback, and any pipeline the hash
  builds). At least 0.
- `render_ms + hash_ms` is no longer than the whole process. The reading is `hash_ms ÷ render_ms`.

A row `BLOCKED` with a `gpu…` code (no GPU to render and hash on) makes the test INCONCLUSIVE.

### The figure (helpers.ts `figure`)

A still `profile: "figure"` document, 1920 × 1080, `camera: "cam"`, `transport.span` 4 s, `requires.modules.scene3d`,
no `look` (so the shipped clean look), no `budget` and no `audit` or other exception. Its 1,000 parts are scene3d solids
with `role: "part"` and a name:

- `plate`: a `mark.box@1` 23.4 × 0.1 × 17.4 m whose top is y = 0, fill role `raised`.
- `part-0000` to `part-0998`: 999 solids 0.3 m across, a box (0.3 m), a cylinder (0.4 m tall) and a sphere in turn, fill
  roles `accent`, `ink` and `muted`, on a 37 × 27 grid 0.6 m apart (slot i at x = 0.6 (i mod 37), z = 0.6 ⌊i ÷ 37⌋),
  each standing on the plate (its bounds' bottom at y = 0).
- Planted: `part-0998` (the last in order, a box) stands at x = 0.2, z = 0, beside `part-0000` (the first, a box), and
  `part-0500` (a box) 0.2 m from `part-0499` (a box), so each pair passes 0.1 m into the other. Every other pair of
  parts is at least 0.1 m apart (checked by a scratch run of the generator over every pair's bounds, not kept).
- Not parts: a perspective `camera@1` at (10.8, 22, 36) looking at (10.8, 0, 7.2), fov 50°, which keeps the whole
  plate in frame, and one `light.sun@1` of 10,000 lx turned (−60°, 30°, 0).

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| `#405.17969a94` | `budgets.test.ts` (2) | **Geometry audit:** on the debug build, the agent's show of the 1,000-part figure is `presented`, the `geometry.audit` row FAILs with an error naming each planted pair, and reports `timing.check_ms`. Where judgeLimit says this machine can judge a timing now: a release build, one warm-up process and five more, each held to the same row, their `check_ms` judged against 500 ms. **Hashing:** on the debug build, the show (with pixels) is `presented`, the `document.determinism` row PASSes on `machines: same` and reports `timing.render_ms` and `timing.hash_ms`; on a fit machine, a warm-up and five release processes, each `hash_ms ÷ render_ms` judged against 0.05. FAIL fails; anything but PASS is `INCONCLUSIVE:` |

Wrong programs: the merge base (both tests fail on the debug build, `BASE-FAILURE.txt`); an audit that stops at its
first fault or looks at part of the figure (it misses a planted pair, at the start, middle or end of the item order);
an audit or hash slower than its budget on the reference Mac (judgeLimit's FAIL).

## Readings where the issue and design leave a choice

- **"A 1,000-part figure"** is a document of profile `figure` holding 1,000 items in the `part` role (Item and kind),
  each a scene3d solid with a true shape; the camera and the sun aren't parts. The plate is a part, so the figure's
  999 other parts have something to stand on.
- **The audit's states.** The figure has no channel, control, loop, take-apart or motion angles, so rest is the only
  state it reaches, and the audit at its defaults audits rest. No exception is declared anywhere, so the row can't be
  INCONCLUSIVE on an agent's exception (criterion 2's case); whether the plate itself counts as held isn't read, only
  that the row FAILs and names both planted pairs.
- **The planted pairs** are there so the timed audit is one that looked across the whole figure: a check that audits
  part of it, or stops at its first fault, misses one. They are boxes, so their 0.1 m overlap is the same on true shapes
  and bounds, far past any default tolerance (2 mm in Geometry audit: scenes).
- **"Takes under 500 ms"** is the audit's own time on its requirement row, `timing.check_ms`, as #408 reads
  film.layout's: the binary's clock, since process start, the show and the verdict's other work aren't the audit.
  "Under" is judgeLimit's rule: PASS when all five runs are within 500 ms.
- **"Determinism hashing adds under 5% to render time"** is the design's Cost line, "Hashing ≤ 5% of render time while
  checking", read per run as `hash_ms ÷ render_ms ≤ 0.05`, both from the check's own row on the same run. The figure
  is the same 1,000-part figure, at its 1920 × 1080, the size the design quotes pass costs at; it is still, so every
  render is of 1,000 lit solids and none is cheap because nothing moved. Five named times (0 to 2 s, every 0.5 s) keep
  a run bounded; the default times (start, keys, 100 seeded) would make each run minutes long. The GPU is opened by the
  show's render-back before the check, so neither time holds opening the device.
- **"On the reference Mac in the local preflight"**: `scripts/benchmark.mjs`'s `judgeLimit` and `fingerprint` (a
  reference Mac, on mains power, Low Power Mode off, thermal state nominal, a macOS build, the load at each run's start
  and end under the core count), five fresh release processes after one warm-up, in the lanes' timed list. Off a fit
  machine each test still checks its row on the debug build and then is INCONCLUSIVE.
- **"Compared with the merge base"**: the merge base has no geometry audit (its row is BLOCKED `not_run`) and its
  determinism check reports neither time, so there is no base reading to set beside these; the preflight's edit guard
  runs this file on the merge base, where both tests fail on their debug run. This suite adds no
  `benchmarks/budgets.json` task: the perf lane's own 20-sample comparison of a task with its merge base isn't this
  criterion's surface, and the limits here are the issue's absolute ones.
- **Fresh processes** for every run, warm-up included, so an implementation that keeps a verdict or an audit for a
  revision can't make a later run read 0.

Not tested, because criterion 4 doesn't ask: the audit's faults beyond the two planted pairs (criterion 1), exceptions
and asks (criterion 2), control sweeps (criterion 3), states other than rest, the audit off the UI thread, cross-machine
determinism, and the timings of anything but these two checks.
