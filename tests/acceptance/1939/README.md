# Acceptance tests for #1939: light readings on every snapshot, deep_show returning render.exposure's numbers for the kept subject

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #1939
(its Scope, its Fields line for `render.exposure`, its two acceptance criteria, its Proof line "The under-exposure
fixture's snapshot readings beside render.exposure's numbers on the same revision, and the readings' added time on the
reference Mac, with the issues as data", and its Oracle line: no upstream test checks these criteria, so there is no
`1939-oracle/` folder), the design sections the issue links and those they lean on, and base commit `d3aa7c11d`
("Merge #2467 (#1938's render checks) as #1939's base").

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one test per criterion, and the one wrong program criterion 1 names.

## What was read

- Issue #1939 and its two dependencies' titles (#393 deep_show, #1938 the loop's render checks).
- `docs/canvas-primitives.md`: Render-back (the request `{doc, rev, t, size, camera, include}` and the reply's
  `snapshots: [{sha256, w, h}]`, "about 4 ms at 1936×1584"); Check input: loop kinds (`render.exposure {subject:
  collection | kept = kept, clipped_max, crushed_max, key_ev}`, "exposure … read pixels on one machine and are
  INCONCLUSIVE elsewhere", "pixel kinds one GPU reduction and a few KB read back per checked time (about 0.1 ms)");
  Camera `camera@1`: framing (`fit.keep`, the kept items) and its `exposure` (EV100).
- `docs/technical-design.md`: Render-back and Document check (the loop's checks, exposure among them); "Proven on the
  base"; Dogfooding; "Every task carries its own budgets" and the reference Macs (five runs after warm-up, the margin,
  INCONCLUSIVE off a reference Mac at rest).
- At the base, for surfaces and conventions only: `AGENTS.md`; `crates/deep-show/src/main.rs` (the `deep_show` call's
  fields, the scenario's `planted`, which refuses an unknown name as bad input), `hub.rs` (`present`: the snapshot
  entry, `draw3d`), `scene3d.rs` (the camera's `exposure` sets the look's exposure), `pixels.rs` (the frames a pixel
  check draws, at the document's size), `verdict.rs` (the row's `results`, the key's `revisions: [{doc, rev, hash}]`);
  `crates/deep-canvas-loop/src/exposure.rs` (`measure`, `report`'s `results` row: `{t, subject, px, clipped, crushed,
  key_ev, exposure, pass}`) and `scene.rs` (`kept`: the camera's `fit.keep` by default); `crates/deep-canvas/src/
  camera.rs` (what `fit` allows beside it); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`); `scripts/lanes.mjs`;
  `scripts/proof-change.mjs` (`criterionId`); and the suites `1938/` (and its contrast redraft's DISPUTE: a number in a
  text fails the document's own check), `393/`, `412/` (its readings budget) and `2017/` (its budgets).

Code was read only to learn the surface and what the base already does. Every expected value comes from the issue and
the design.

## What the base already does

- `deep_show` of a whole revision with `include: ['issues', 'pixels']` renders a 3D revision back on this Mac's GPU at
  the request's `size` and returns `{rev, outcome: presented, snapshots: [{sha256, w, h}], …}`: no readings.
- `render.exposure` (#1938) is the loop module's; as a claim's requirement, `verdict` draws the revision at the
  document's own size and returns a row with `results: [{doc, t, subject, px, clipped, crushed, key_ev, …}]`, FAIL
  past its limits, and `fingerprint`. Its subject defaults to the camera's `fit.keep`.
- `light_from_whole_frame` isn't a planted name at the base: a scenario carrying it is refused as bad input.

## Run them

Each file builds `deep-show` with cargo (`--no-default-features --features full`) and draws on this Mac's GPU, so they
run one file at a time. The implementer adds these lines to `scripts/lanes.mjs`, beside #1938's; this README is the
instruction, and this job edits nothing outside its folder:

```js
// #1939's files each build deep-show and draw on the GPU; ac2-budget judges the readings' added time on the reference
// Mac (building deep-show for release where it times).
alone.push('tests/acceptance/1939/');
timed.push('tests/acceptance/1939/ac2-budget.test.ts');
```

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1939 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1939/tsconfig.json   # type-check
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (with the 1.99.1
toolchain put on PATH), copies the binary out of `target/` (honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and
`CARGO_PROFILE_DEV_DEBUG` default to `0`), and fails each test whose build failed. Off macOS, without cargo, or where
the verdict's row says the frame couldn't be drawn on a GPU (`gpu_unavailable`, `unsupported_platform`, a
`software_adapter`), a test fails with a message starting `INCONCLUSIVE:`; none passes or skips. Tests print the
issue's proof as lines starting `PROOF #1939`. Every test writes into temporary folders it deletes.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (one scenario line in, one answer line out; for the
timings one process kept open, a scenario a line, as #412's budgets do) with #393's `deep_show` and `revisions`, #403's
`claims` and `verdict`, and #387's `planted`. It adds one field to a snapshot entry and one planted name.

- **The documents** are the working agent alpha's (`sess-alpha`): each scenario mints them on panel `main` with no
  revision, and alpha's `deep_show` sends each as a whole revision in the agent's form (no `id`, no `layers`, no item
  `layer`): `{call: "deep_show", session: "sess-alpha", doc, document, t: "0s", size, include: ["issues", "pixels"]}`.
- **render.exposure on the same revision** is a claim of alpha's whose one deliverable is the document and whose one
  requirement is `check: {kind: "render.exposure"}` (every field at its default, so its subject is the kept items),
  judged by `{call: "verdict", claim}` after the deep_show. The test reads the row's `results` entry for the document
  at `t: 0` (its `clipped`, `crushed`, `key_ev`), and the verdict's `key.revisions` entry for the document (`rev`,
  `hash`), which must be the deep_show reply's `rev` with the hash `{call: "revisions", doc}` gives that rev.

### Assumed surfaces

1. **The readings' field.** Each entry of a deep_show reply's `snapshots` that has pixels carries
   `light: {clipped, crushed, key_ev}`: the kept subject's clipped share, crushed share and key EV, numbers, computed
   by render.exposure's own measure on that snapshot. Other keys may sit beside them (the subject's IDs, its px). The
   readings pass or fail nothing.
2. **Nothing to read.** A snapshot whose kept subject shows no px carries no readings: `light` absent, null, or without
   the three numbers (render.exposure has no subject px to measure there). Criterion 2's "off" side is such a snapshot.
3. **The planted program** (the scenario's `planted`, reachable only there). The implementer adds it beside the
   scenario's other planted names and names it in `crates/deep-show/src/main.rs`'s planted match:

   | Name | The wrong program | Criterion |
   |---|---|---|
   | `light_from_whole_frame` | each snapshot's `light` is measured by the same measure over every px of the frame instead of the kept subject's; everything else, render.exposure's verdict included, as shipped | `#1939.398baf58` |

4. **Same draw.** A render-back at the document's own size and at `t: 0` reads the px render.exposure draws for that
   revision at its checked time, so the two compare within 1e-6. The criterion 1 render-back asks for the document's
   own size (320 × 240).

## Fixtures (helpers.ts `lightDoc`)

Metres, +Y up. A `scene` document of `requires.modules: {scene3d: "^1"}`, viewed through `cam`, with no number and no
number word in any text (title, description; the #1938 contrast redraft's dispute):

- `cam`: a perspective `camera@1` 40° across the wider side, `target` (0, 1, 0), `orbit {azimuth: 0, elevation: 0}`
  (level, from +Z), near 0.05 m, far 50 m, `fit: {keep: [<kept>]}` (framing sets the distance, so no position or orbit
  distance may sit beside it), and `exposure` an EV100, a scale of 1 ÷ (1.2 × 2^EV100) (render.exposure's own fix).
- `sky`: black, no ambient light. `grey-mat` and `pale-mat`: unlit, opaque, double-sided materials of linear grey 0.18
  (middle grey) and 0.72 (two stops over it), so each px is its grey at the camera's exposure.
- `subject`: a 0.2 m `mark.box@1` at (0, 1, 0) in `grey-mat`, the kept subject. `prop`: a 0.12 m box at (0.22, 1, 0)
  in `pale-mat`, which the camera doesn't keep. Both draw well inside the frame with black sky around them, so a
  whole-frame measure (mostly black px, crushed) and an all-items measure (the pale prop) both read other numbers than
  the subject's.

| Fixture | Camera exposure | Keeps | Size |
|---|---|---|---|
| criterion 1's planted under-exposure fixture | EV100 3 − log2 1.2 (scale 1/8: middle grey's key at −3 EV, nothing clipped or crushed) | `subject` | 320 × 240 |
| its clean twin | EV100 −log2 1.2 (scale 1: key 0 EV) | `subject` | 320 × 240 |
| criterion 2's "on" | as the planted fixture, plus `stand-in`: an invisible (`visible: false`) 0.2 m box where the subject is | `subject` | 1936 × 1584 |
| criterion 2's "off" | the same document | `stand-in` | 1936 × 1584 |

The planted fixture and its twin differ only by the exposure. Criterion 2's two documents differ only by the item the
camera keeps, which is in the same place and the same size either way, so they draw one picture (the test checks one
SHA-256) and their render-backs differ by the readings alone.

## Criteria to tests

IDs are `#1939.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`): `398baf58` and `9c67dc55`. Each file holds its
criterion's ID as a `const ID`, and every test's name starts with `${ID}`.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1939.398baf58` | `ac1-readings.test.ts` (1) | In one run: the verdict judged the revision deep_show rendered back (its `rev`, and the hash `revisions` gives it), and render.exposure reads the planted fixture under-exposed (key under −0.5 EV, FAIL). Each snapshot of that revision carries `light`, its clipped, crushed and key_ev each within 1e-6 of render.exposure's `results`. The clean twin's snapshot carries readings with key_ev in [−0.5, 0.5]. Under `light_from_whole_frame` the same judge fails, every failure naming the snapshot's SHA-256 |
| `#1939.9c67dc55` | `ac2-budget.test.ts` (1) | On any machine, on the debug build: at 1936 × 1584 the "on" render-back's snapshot carries readings, the "off" one's none, both one snapshot of 1936 × 1584 px with the same SHA-256. Then, only on a reference Mac at rest (else INCONCLUSIVE before timing): deep-show built for release and kept open, one warm-up run and five of 20 rounds each, on and off alternating which goes first; a run's value is median(on) − median(off) wall time (a negative one read as 0); `judgeLimit(20 ms)` from `scripts/benchmark.mjs`: FAIL fails, PASS passes, anything else INCONCLUSIVE |

Wrong programs each file fails on are in its header. Both fail on the base at an assertion (no `light` on a snapshot);
criterion 1 also fails on its named planted program.

## Readings where the issue and design leave a choice

- **`deep_run`'s render.exposure** is the claim verdict `deep-show run` gives through `{call: "verdict", claim}`, as
  #1938's suite judges it: the surface the base has for a requirement judged on a deliverable's current revision.
- **The same revision** is the verdict key's `{rev, hash}` for the document, equal to the deep_show reply's `rev` and to
  the hash `revisions` gives it.
- **For its snapshot** reads every snapshot entry a 3D render-back returns (one at the base). The readings are compared
  with render.exposure's `results` entry at `t: 0`, the time both draw.
- **The planted under-exposure fixture** is under-exposed through the camera's EV100, the field render.exposure's own
  fix sets, with unlit greys, so its numbers don't hang on a lighting model; the check FAILs it on its key.
- **The clean twin** is held only to its key EV, as the criterion says.
- **Measures the whole frame** is the planted program's: the same measure over every px. The fixture's black sky makes
  that differ in every number the judge compares (crushed share, key), and its pale prop makes a measure of every
  drawn item differ too. "Fails, naming the snapshot" is the test's judge: each failure names the snapshot's SHA-256.
- **"Add under 20 ms to a render-back"** is on against off in one process: the same picture rendered back with
  readings (the kept cube) and without (a kept stand-in that shows no px), so the difference is what the readings add.
  Timings count only on a reference Mac at rest (the perf lane's `judgeLimit`), on a release build, as #2017's budgets
  are judged; a debug build's or a loaded machine's time is a reading, not a result.

## Not tested

No criterion asks for these, so none is tested: readings on a 2D board or a contact sheet; readings with a `subject`
collection (the issue names the kept subject); `clipped_max`, `crushed_max` and `key_ev` as limits on the readings
(they pass or fail nothing); readings at other times than the start; the readings' memory; render.exposure's verdict
and fixes beyond what #1938 proved.
