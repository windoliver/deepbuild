# Acceptance tests for #1646: dither fills, cells() and the CRT afterglow, #464's scope lines no criterion covered

Written first, from issue #1646 (its three scope lines and three acceptance criteria), the design sections it links and
those they lean on, and base commit `a3efe5c8` ("Merge pull request #1746 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Lean: one file per criterion, one test per clause that needs its own
run, plus the one planted twin the criteria name.

## What was read

- Issue #1646, live (`gh issue view 1646 --repo windoliver/deepbuild`), and #464's scope lines it quotes.
- `docs/canvas-primitives.md`: Paint (the Fill kinds line); Paint: dither fill; Look `look@1`: print finishes (the CRT
  afterglow sentence); Text `text@1` (`reveal`, units, `<item>.reveal`); Text animator and counter, and its selectors
  and properties; Every public step (the Seeded row, `cells(p, seed, jitter = 1, metric) → {f1, f2, id: u32, center}`);
  The closed function list (no `cells` there; `last(list).field` reads a record by name).
- `docs/technical-design.md`: Look; GPU operator; Dogfooding; Tests written first.
- At the base, for call shapes only: AGENTS.md; `tests/acceptance/464/` (README, helpers, see-through, screen, grain,
  tables), `149/` (the noise fill's status-ramp refusal through `deep-canvas-render check`), `431/` (`cells@1`), `490/`
  (`deep-motion eval` and drivers), `496/` (`deep-canvas-render raster`'s `texts`); `crates/deep-gpu-layer/src/{main,
  film}.rs` (`film2d`, `refused`), `crates/deep-canvas-marks/src/{print,paint,scene,animator}.rs` (`BAYER4`, `bayer8`,
  `fill_of`, the screen's fields, `lay_out`), `crates/deep-canvas/src/{steps,expr}.rs` and
  `document/rules.rs` (`cells@1`, `cells`, the status-role rule), `crates/deep-canvas-effects/src/{emit,check}.rs`
  (`cells@1`'s ports), `crates/deep-canvas-motion/src/doc.rs` (`driver_of`), `crates/deep-motion/src/main.rs`,
  `crates/deep-marks-render/src/{lib,raster}.rs`, `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

## What the base already does, which these tests don't credit

- `deep_canvas_marks::print` has the 4 × 4 Bayer table `BAYER4` and `bayer8`, used by #464's indexed see-through. A 2D
  fill is a `role` or a `gradient` (`scene.rs`'s `fill_of`); there is no `dither` fill kind, so `film2d` and the
  document check both refuse a fill `{dither: …}` with `bad_paint` at `…/fill/role`, whatever its stops. The document check's status rule (`status_color_unbound`) looks for `role` keys and `range`
  lists; a dither's `stops` is a list of role names under neither.
- The GPU step `cells@1` (#431) has ports `f1`, `f2`, `id` and `center`. The closed function list's `cells(p, seed)`
  (`expr.rs`) answers one number, the distance to the nearest feature point; `cells(…).f1` is read as a swizzle and
  refused, and no `deep-motion eval` planted name touches cells.
- `deep-canvas-render raster` answers each text@1 item's glyphs and its animators' `coverage` (#496). text@1 has no
  `reveal` at the base, and #464's `screen` finish takes `kind`, `scanlines`, `mask`, `curvature`, `convergence`,
  `bleed`, … but no afterglow; nothing reports a unit's reveal time or afterglow.

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1646 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1646/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file builds what it drives once, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin
<name>` (`dither.test.ts`: `deep-gpu` and `deep-canvas-render`; `cells.test.ts`: `deep-motion`; `afterglow.test.ts`:
`deep-canvas-render`), adding the pinned toolchain (`~/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin`) to PATH
when cargo isn't on it, copies the binary out of the target folder (`CARGO_TARGET_DIR` honoured) to a temporary
folder, and fails each test that uses a build that failed. So the files run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/1646/'` in its `alone` list beside `'tests/acceptance/464/'`. This README is the instruction; the
implementer makes that edit. Each test writes into its own temporary folder and deletes it; Node built-ins and vitest
only. A run with `--root tests/acceptance/1646` leaves Vitest's cache in `tests/acceptance/1646/node_modules/.vite`;
delete it.

- The dither fill draws on Metal: off macOS its tests fail with a message starting `INCONCLUSIVE:`, never passing.
- **Two GPUs.** The dither fill's coverage mask (one letter per plate pixel, `h`, `l` or `?`, rows top-down, hashed with
  SHA-256) is written to `coverage-record-dither-<family>.json` in `DEEPBUILD_EVIDENCE_DIR` (else
  `$TMPDIR/deep-1646-evidence`) with this Mac's GPU family (its chip, as #464's suite reads it). The two-GPU test
  compares it with the same record made on a Mac of another GPU family, named by `DEEPBUILD_SECOND_GPU_1646`; with none
  it fails with a message starting `BLOCKED:` and its one unblock ask (run `dither.test.ts` on a Mac of another GPU
  family and name its record), never passing. It first holds this GPU's coverage to the matrix, so a wrong fill can't
  be recorded as a match.
- No criterion has a time budget, so nothing is gated on the reference Mac, power or load.

## The surface under test

**No new binary and no new call.** #377's `deep-gpu run` (`film2d`), #149's `deep-canvas-render check`, #496's
`deep-canvas-render raster` and #490's `deep-motion eval`, each with its JSON-lines protocol unchanged. Field names the
issue and design give are used as they give them; the rest are this suite's choices, marked **bold**, each the least a
criterion needs.

### AC1: the dither fill (`film2d`, `deep-canvas-render check`)

- An item's `paint.fill: {dither: {stops: [role], matrix: 4, by: "gradient", anchor: "world"}}`: the design's fill kind
  as **a one-key object**, as `{gradient: {…}}` and #149's `{noise: {…}}` are written.
- **`by: gradient` reads the item box's default linear gradient, 0 at its west edge and 1 at its east** (R1's two-stop
  gradient's direction, `paint.rs`), since the fill kind names no geometry of its own.
- **The gradient's step** at a pixel is ⌊n² × v⌋ (16 for `matrix: 4`), v the gradient at the pixel's centre; between two
  stops a pixel draws `stops[1]` where its matrix entry is below the step and `stops[0]` elsewhere.
- `film2d` (#417, #149, #464) with `fps`, `from`, `frames`, `hash`, `capture`; each captured frame's `final` PNG.
- `deep-canvas-render check {doc, look}` answers `{ok, issues: [{code, severity, path, ids}]}` as at the base; a stop
  naming a status role is **an error `status_color_unbound` naming the item in `ids`**, #374's and #149's code for a
  status color in paint.

### AC2: `cells(p, seed)` (`deep-motion eval`)

- Drivers (`{target, expr, vars: {t: "time"}}`, #490's) call the closed function list's `cells(p, seed)` with p a
  `vec2`; **its outputs are read by name**, `cells(p, seed).f1`, `.f2`, `.id` and `.center`, a vec2 for a 2D p read by
  swizzle (`.center.x`, `.center.y`), as `last(list).field` reads a record. Each driver writes one output into an
  item's `at/pos/<k>`, read back from the eval frame's `items.<id>.at.pos`.
- **`center` is the nearest feature point**, the one f1 measures to, so |p − center| = f1 under the two-argument
  form's metric, **euclidean**; `id` is the u32 that names its cell, so one id has one center.
- `deep-motion eval {doc, times, planted?}`: one line's times evaluated in order in one program state is **played**;
  a line with one time, in a fresh process, is **seeked**.

### AC3: the CRT afterglow (`deep-canvas-render raster`)

- text@1's `reveal: {mode: "fade", order: "reading", progress}` (the design's fields), its `progress` keyed by a
  channel on `items/<id>/params/reveal/progress`; units are graphemes.
- **The look's CRT screen takes `afterglow: s`**, the phosphor's decay time τ: `finish: [{screen: {kind: "crt",
  afterglow: "0.4s"}}]`, inline in `raster`'s `look` (a look object with a `palette`, as the base accepts). Absent, a
  screen has no afterglow, so #464's identity holds.
- **`raster`'s `texts.<item>` adds `reveal`, each unit's reveal time in flicks, and `afterglow`, each unit's afterglow
  at t**, one number per unit in reading order beside #496's `coverage`. A unit's reveal time is compiled at check
  (the design's `<item>.reveal`), so it is the same at every t.
- **The closed form**: a(t) = 0 for t < r and a(t) = e^(−(t − r) ÷ τ) for t ≥ r, r the unit's reveal time: 1 at the
  instant the unit is revealed, decaying as a phosphor does, a function of t and r alone.

### Planted programs

| Name | Where | The wrong program | Criterion |
|---|---|---|---|
| `cells_seeded_from_t` | `deep-motion eval`'s `planted` | The closed function list's `cells` takes its seed with the time t, so its outputs at a still point move from frame to frame | AC2 |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, `- [ ] ` dropped
(`scripts/proof-change.mjs: criterionId`), from the live issue. Each test's name starts with its ID.

| ID | Criterion | File: what it asserts |
|---|---|---|
| `#1646.23206300` | 1: dither fill | `dither.test.ts` (3): the plate [64, 32, 64, 32] between `lo` and `hi`: every pixel of each of its 128 blocks exactly `hi` where BAYER4[y mod 4][x mod 4] is below the block's step k (k = 0 … 15 west to east) and exactly `lo` elsewhere, at frames 0, 23 and 59 played and 41 opened cold, one mask throughout; stops [status.fail, hi] refused by the check with `status_color_unbound` naming `plate`, [lo, hi] accepted with no error; the mask on two GPUs, BLOCKED with one. |
| `#1646.7fba4dd6` | 2: cells | `cells.test.ts` (2): at 121 frames played, at a moving and a still point, f1 ≤ f2, id a u32, \|p − center\| = f1 within 1e-9, center within p's 3 × 3 cells, one center per id, the still point's outputs frame 0's at every frame, at least 8 ids and an f1 spread of 0.2; frames 1, 17, 45, 89 and 120 seeked equal played in all five outputs. Twin `cells_seeded_from_t` fails, naming a frame after 0 at the still point. |
| `#1646.5b6cd97b` | 3: afterglow | `afterglow.test.ts` (1): "READY." revealed from 0.5 s to 2.5 s under a CRT with afterglow 0.4 s: six reveal times, whole flicks, rising in reading order, inside [0.5 s, 2.5 s], the same at every frame; each unit's afterglow within 1e-6 of the closed form at frames 0 … 120 played, and at frames 17, 31, 46, 62, 75 and 90 seeked, each equal to the played frame's. |

## Readings where the issue and design leave a choice

- **The gradient's step per block.** Over a 64-u box a 16-step gradient steps every 4 u, so with v at pixel centres
  ⌊16v⌋ is one value across each 4 × 4 block, the step the criterion's "below the gradient's step" names. A rounding
  quantizer gives two steps in a block and fails; so do a transposed matrix and a threshold that moves with t.
- **The Bayer matrix** is the standard 4 × 4 recursive one, written out in `helpers.ts`, read at the pixel's world
  coordinate (`anchor: world`); with no camera and the plate on the 4-pixel grid, world and frame coordinates agree.
- **"The same at every t"** is the same mask at three played frames and one opened cold, each also held to the matrix.
- **"Refused at check"** is the document check, `deep-canvas-render check`, as #149 refuses a status role in a noise
  fill's ramp; `status.fail` is #374's form of a status role.
- **`cells(p, seed)`** is the closed function list's two-argument form (drivers and fields), the form the issue names;
  the GPU step `cells@1` already states its ports at the base (#431). Its outputs follow the op table's
  `{f1, f2, id: u32, center}`.
- **"Seeking equals playing"** for a driver is a one-time eval line in a fresh process against the same frame of a
  played line, exactly. A cells seeded from t is still a function of t, so seeking alone can't catch it; the still
  point catches it, and one center per id catches it at the moving point.
- **The afterglow's closed form** isn't given by the design, which says only that it is drawn by the text animator
  from each unit's reveal time, never from an earlier frame. A CRT phosphor's afterglow decays exponentially from its
  excitation, so a(t) = e^(−(t − r) ÷ τ) from the unit's reveal time r, with τ the screen's **`afterglow`**. A glow
  decayed from the previous frame's value agrees with it only between frames after the reveal; at a unit's first frame
  and at a seek it differs.
- **A unit's reveal time** is the implementation's, reported in `texts.<item>.reveal`; the design's reveal pins no
  per-unit formula for `fade`, so the tests hold the reveal times to what the design does fix (reading order, the
  progress's span, compiled at check) and the afterglow to its closed form from them.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- The dither fill's `matrix: 8`, `by: tone`, `anchor: frame`, more than two stops, and its "follow the screen during a
  camera move only when the anchor is frame".
- `cells` with `jitter`, `metric` or `period`, in 3D, and its interval form.
- How the afterglow draws (its color and where on the glyph), the afterglow without a CRT, and `reveal`'s `write`
  mode, `seeded` order and `emits`.
