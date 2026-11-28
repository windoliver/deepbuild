# Acceptance tests for #3506: one depth for the occluders and the geometry pass, and one resolved image for motion blur and depth of field

Written first, blind, from issue #3506 (its two opening paragraphs, `Runs on:`, Scope, five acceptance criteria, Proof
line and Depends on; it has no comments), the design sections it links and those they lean on, and base commit
`4471593fb` (origin/main, whose last merge is #3508) with what #3031 lands laid over it, by a job that never saw an
implementation; none existed. #3031's reader is carried byte for byte in this suite's first commit (`spikes/3031/`,
and `docs/spikes/3031/` beside the fixture the base already holds), as #3507's suite took it. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion, a file per suite where criterion 3 runs four, and the planted programs below.

## Files

| File | Criterion | What it runs |
|---|---|---|
| `ac1-device-bytes.test.mjs` | `#3506.86abd572` | #3031's reader, 300 frames of the every-pass fixture, built against the merge base's crates and against this checkout's |
| `ac2-one-depth.test.mjs` | `#3506.0dcb130c` | the reader's listing after 300 frames; then the same under the planted `occluders_own_depth` |
| `ac3-hashes-1637`, `-468`, `-419`, `-971.test.mjs` (the body is in `ac3.mjs`) | `#3506.55c33ada` | one of the four suites, whole, each of its frames drawn again by the merge base's build |
| `ac3-planted-dof.test.mjs` | `#3506.55c33ada` | the every-pass fixture's first five frames through `deep-gpu`'s `view3d`, under the planted `dof_reads_shared_before_write`, as shipped, and on the merge base |
| `ac4-estimate.test.mjs` | `#3506.39b8e6ca` | the check's estimate beside the reader's listing, on the merge base and the change; then under the planted `estimate_counts_occluders_depth` |
| `ac5-unedited.test.mjs` | `#3506.25e79c7f` | git: what differs from the merge base under `tests/acceptance/` |
| `judge.mjs` | | the judges: each decides a criterion from what a test read |
| `drive.mjs` | | the reader and its copies, `deep-gpu`, the merge base's checkout, the lease |
| `lane.json` | | the folder runs alone |
| `BASE-FAILURE.txt` | | the base's reading: no file run, for want of a test grant; what each is expected to read there, and what was checked without one |

Three helpers are #3507's, used as they are: `../3507/lease.mjs` (the GPU lease's file), `../3507/record.mjs` with
`../3507/record.config.mjs` (the recorder a suite runs beside, which draws each frame again by the merge base's
build), and `../3507/judge.mjs`'s `hashProblems` and `editedProblems` (the same words' judges: "hashes the same as on
the merge base", "No acceptance test is edited").

## What was read

- The issue, and what the checkout holds of the issues it names: #3031's fixture at the base
  (`docs/spikes/3031/fixtures/`), and its reader from the job that builds #3031 (`spikes/3031/Cargo.toml`,
  `Cargo.lock`, `src/main.rs`, `src/held.rs`; `docs/spikes/3031/README.md`, `count.mjs`, `trace.mjs`, `ron.mjs`,
  `fixtures.mjs`), copied read-only, with that job's `tests/acceptance/3031/README.md` for the listing's shape (not
  copied). #241, #3016 and #2888 were read only as the base holds them.
- `docs/canvas-primitives.md`: The cost model; GPU surface; Effect: dof; Motion blur: velocity.
  `docs/technical-design.md`: How we know version 0 works (Criteria to tests, Criteria in a checked shape, Wrong
  programs, The edit guard, Tests written first). `docs/parallel-proof.md` sections 5, 7 and 12a. AGENTS.md,
  CONTRIBUTING.md.
- At the base, for names, shapes and conventions, never for expected values: `crates/deep-scene3d-render/src/`
  `cull.rs` (`Pyramid` and its `scene3d occluders' depth`), `passes.rs`, `motion.rs` and `dof.rs` (their resolved
  images and the copy into the linear one), `local_tone.rs`, `held.rs` (`of`, `of_planted`, the cull's `samples ×
  DEPTH` and a mirror's view's quarter), `planted.rs` and `lib.rs` (`Planted`, `ms("scene3d depth ms", …)`);
  `crates/deep-gpu-layer/src/main.rs` (`--planted`, `Planted::parse`, `bad_input`), `session3.rs` (`planted3`),
  `view3d.rs` and `view3d/parse.rs` (`frames`, `fps`, `capture`, each frame's `pixel_hash`); `crates/deep-show`
  (the kit's lease); `scripts/proof-change.mjs` (`criterionId`), `lanes-lists.mjs`, `benchmark.mjs` (`fingerprint`,
  `references`), `throttle.mjs`; the suites `3507/` (README, `drive.mjs`, `lease.mjs`, `judge.mjs`, `ac4.mjs`,
  `record.mjs`) and `3016/` (README), and the four suites criterion 3 names, for their files and lane lists.
- Not read: any other checkout, branch or ref but the one dependency copy above, GitHub beyond the issue, the web,
  and nothing of the work.

## How to run

```sh
npm ci                                                # once, if node_modules is missing
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
# The reader and its copies (each file builds what it reads with when it isn't fresh; under the build queue first):
cargo build --release --locked --manifest-path spikes/3031/Cargo.toml
cargo build --locked --bin deep-gpu --bin deep-show   # ac3-planted-dof and the ac3 hash files
export DEEP_3506_BASE=<the merge base: a git checkout, or a `git archive` export>   # criteria 1, 3 and 4

node --test tests/acceptance/3506/ac1-device-bytes.test.mjs
node --test tests/acceptance/3506/ac2-one-depth.test.mjs
node --test tests/acceptance/3506/ac3-planted-dof.test.mjs
node --test tests/acceptance/3506/ac3-hashes-1637.test.mjs    # and -468, -419, -971
node --test tests/acceptance/3506/ac4-estimate.test.mjs
node --test tests/acceptance/3506/ac5-unedited.test.mjs
```

The test files are node:test's; never run vitest with this folder as its root (`drive.mjs` refuses to load inside a
vitest worker, so nothing of a file runs there). macOS on a Mac of a reference model, Node 24.22 first on `PATH`,
`git`, `cargo`. One file at a time: each draws on Metal under the machine's GPU lease.

| File | Needs | Takes |
|---|---|---|
| `ac1-device-bytes` | `DEEP_3506_BASE`; the reader built against it and against this checkout | two runs of 300 frames at 3456 × 2234; the first build of the reader against the merge base's crates compiles them in release |
| `ac2-one-depth` | the reader, and its copy with the planted renderer | two runs of 300 frames at 3456 × 2234 |
| `ac3-planted-dof` | `deep-gpu`; `DEEP_3506_BASE` with its `target/debug/deep-gpu` | three runs of 5 frames at 3456 × 2234 |
| `ac3-hashes-<n>` | `deep-gpu` and `deep-show`, `DEEP_3506_BASE` with both, vitest | the suite's own run with each of its frames drawn twice: hours |
| `ac4-estimate` | `DEEP_3506_BASE`; the reader against it, against this checkout, and its copy with the planted estimate | four runs of one frame |
| `ac5-unedited` | git | under a second |

Every build of the reader shares its target folder, `spikes/3031/target/`, so what the builds share (the registry's
crates) compiles once. A copy of the reader, against the merge base's crates or with a planted program set, is
written to `target/acceptance/3506/readers/<name>/` (`Cargo.toml`, `Cargo.lock`, `src/`), rewritten only when its
bytes would change, and built from there as its own package `<name>`, so its binary lands beside the reader's own.
Temporary folders are `deep-3506-*` under the system's temporary folder and are removed; the reader's API trace,
which it writes on every run, is one of them. A file's runs may take 110 minutes (an `ac3-hashes` file 8 hours, as
#3507's and #3016's suites allow theirs); past that a run is stopped by its own timeout and the file is INCONCLUSIVE.
The proof lanes stop any file at 20, and then it is not run, never passed. An `ac3-hashes` file runs another suite,
which writes what it writes (as #3507's README says of its `ac4` files); it removes only vitest's cache folder in
that suite's folder, when the run made it.

## The surface under test

Every name below that the issue or the design doesn't give is this suite's choice and a requirement on the
implementer, exactly as spelled here. Each failure starts with one of the four states: `FAIL` (the program says
otherwise; an assertion failure), `BLOCKED` (a reading is missing or unrun), `INCONCLUSIVE` (what was read can't
decide), `INVALID` (not in this shape); the last three end a test with a plain error, never a pass.

### 1. #3031's listing (#3031's)

"The listing" and "read from the device as #3031's listing reads it" are `spike-3031 frames --doc
docs/spikes/3031/fixtures/every-pass-plus.json --look docs/spikes/3031/fixtures/every-pass-plus.look.json --frames
<n> --fps 5 --out <dir> --lease-wait 600`, run from the checkout's root, and what it writes: its summary on stdout
(`status: "RAN"`, `lease: "file"`, `adapter.backend: "Metal"`, `raised: []`, `unlisted_calls: []`) and
`<dir>/resources.json`: `size`, `frames`, `allocated` (the device's own allocated size after the last frame), `on`
(`mirror`, `dof`, `motion_blur`, `ao`, `local_tone` and `glass`, each `true` for this fixture), `estimate: {per_px,
fixed}` (the check's estimate, `held::of` of the last frame's scene) and `resources`, each texture with `kind`,
`label`, `bytes`, `width`, `height`, `sample_count` and `mtl_pixel_format` (Metal's number). The tests read no other
field. A summary that says anything else is BLOCKED; a listing of another size, frame count, or with one of those
passes off is INVALID.

The reader stays as #3031 lands it, in two lines a copy rewrites: it makes its renderer with
`Renderer::new(&device, Planted::default())` and asks for the estimate with `deep_scene3d_render::held::of(scene)`,
once. A reader that says neither can't have a planted program set in it: INVALID.

### 2. The targets a listing is read by (yours)

- **The views.** The view is the fixture's 3456 × 2234; its mirror's view is half that, 1728 × 1117, as the merge
  base draws it. A texture is a view's by its width and height.
- **A 4-sample depth** is a texture of `sample_count` 4 in a depth format (`mtl_pixel_format` 250, 252, 255 or 260:
  Depth16Unorm, Depth32Float, Depth24Unorm_Stencil8, Depth32Float_Stencil8), whatever its label.
- **The resolved image** motion blur and depth of field share is labelled **`scene3d resolved`**. The test counts a
  view's textures under that label or either of the merge base's, `scene3d.motion resolved` and `scene3d.dof
  resolved`, so a change that keeps one of those for the shared image reads the same. If the local tone map resolves
  into it too (the Scope's third line), the label stays.

### 3. The planted programs (yours)

Each is a field of the renderer's `deep_scene3d_render::Planted` (or of one of its parts), `false` by default, which
no shipped program sets.

| Planted program | Reached by | What it does | Criterion |
|---|---|---|---|
| `Planted::occluders_own_depth: bool` | this suite's copy of the reader, `Planted { occluders_own_depth: true, ..Planted::default() }` | the renderer keeps a depth of the occluders' own, as the merge base does: the cull's occluders draw into a 4-sample depth of their own at the view's size, labelled `scene3d occluders' depth`, in each view that culls; everything else as shipped | 2 |
| `--planted dof_reads_shared_before_write` on `deep-gpu run` | the binary's `--planted`, mapped to the renderer's `Planted` as `session3.rs` maps the others | the depth of field reads the image it shares with motion blur before it writes it: it copies that image into the linear one before its gather writes it, so the frame shows motion blur's resolved image where depth of field's belongs; everything else as shipped | 3 |
| `Planted::estimate_counts_occluders_depth: bool` | `held::of_planted(scene, &planted)`, which this suite's copy of the reader asks in `held::of`'s place | the estimate still counts the occluders' 4-sample depth: 16 B a pixel of the view and of its mirror's view, as the merge base's estimate does; the renderer as shipped | 4 |

A build without one of them is BLOCKED for the test that runs it, by a plain error: the copy of the reader doesn't
compile, or `deep-gpu` answers `{"ok": false, "code": "bad_input"}`. That is not the planted program failing.

### 4. The merge base, `DEEP_3506_BASE` (yours)

An environment variable naming the merge base's sources: a path to read, not a switch. It is a git checkout at `git
merge-base HEAD origin/main` of this checkout with no change under `crates/`, `vendor/`, `Cargo.toml` and
`Cargo.lock`, or a folder with no `.git` (a `git archive` export of that commit) whose files under those four paths
are exactly the merge base's, byte for byte, by their git blob IDs. It is another folder than this checkout. Criteria
1 and 4 build #3031's reader against its `crates/` (this checkout's reader, its copy written as above); criterion 3
reads its `target/debug/deep-gpu` and `deep-show`, built as the acceptance helpers build them. Anything else is
BLOCKED.

Four more variables are #3507's recorder's wiring, set by `ac3.mjs` for the vitest run it starts and never by hand:
`DEEP_3507_FRAMES`, `DEEP_3507_OWN_BIN`, `DEEP_3507_TWIN_BIN` and `DEEP_3507_LEASE_PID` (#3507's README: The merge
base's checkout). None selects a program.

### What the base already has, which must stay as it is

- `deep-gpu run [--planted <name>]` with `{out, calls}`; `view3d` with `look`, `doc`, `size`, `fps`, `frames`,
  `capture: "every"`, and each frame's `pixel_hash`; an unknown `--planted` answered `bad_input`.
- `deep_scene3d_render::held::{of, of_planted}`, `Held {per_px, fixed}`, and `Renderer::new(&device, planted)`, which
  the reader calls; the four suites criterion 3 names, unedited, and `scripts/lanes-lists.mjs`'s `timed` and `byHand`.
- The GPU lease's file, `~/.cache/deepbuild-gpu/lease`. #3031's reader takes it itself and waits for it; `deep-gpu`
  takes none, so `ac3-planted-dof` and the `ac3` hash files take the file for what they draw, as #3507's suite does.

### The machine and the lease

- **Bytes and hashes** are read on a Mac of a reference model (`scripts/benchmark.mjs` `references`), headless. Off
  macOS there is no GPU: BLOCKED, as the issue's `Runs on:` line says. On another Mac a reading is a reading:
  INCONCLUSIVE. Power, thermal state and load decide nothing for bytes or a hash.
- **The lease.** A live process holding the lease's file when a reader's run would start is BLOCKED, naming the
  process, and nothing is drawn. A reader whose summary says it drew without the lease is BLOCKED. A `deep-gpu` run
  takes the file for this process and lets it go after; a lease another live process holds is BLOCKED.

## Criteria to tests

Each test's name starts with `AC<n> #3506.<h8>`: the first 8 hex digits of the SHA-256 of the criterion's text as
`scripts/proof-change.mjs`'s `criterionId` reads it, computed from the issue's body.

| Criterion | Test | What it asserts | Fails |
|---|---|---|---|
| AC1 `#3506.86abd572` the every-pass fixture holds at least 215 MB less on the device than on the merge base | `ac1-device-bytes.test.mjs` (`bytesProblems`) | both listings are the fixture's, after 300 frames; the merge base's `allocated` less the change's is at least 215,000,000 B | the base (0 B less); a change that shares one pair and not the other (126.0 + 31.5 or 62.5 MB); no merge base (BLOCKED) |
| AC2 `#3506.0dcb130c` one 4-sample depth a view and one resolved image; a planted renderer that keeps the occluders' own depth fails naming the target | `ac2-one-depth.test.mjs`, first test (`oneDepthProblems`) | in the change's listing the view and its mirror's view each hold one 4-sample depth; the view holds one resolved image of motion blur or depth of field, the mirror's view at most one | the base (two depths in each view, naming `scene3d occluders' depth`; two resolved images in the view); a change that drops the geometry pass's depth too |
| | second test (`plantedDepthProblems`) | under `occluders_own_depth` the same check fails, naming `scene3d occluders' depth` | the base (BLOCKED: no such planted program); a planted renderer that isn't one; a check that passes it or names no target |
| AC3 `#3506.55c33ada` every frame of the four suites hashes as on the merge base; a planted depth of field that reads the shared image first fails naming the frame | `ac3-hashes-<n>.test.mjs` (#3507's `hashProblems`) | every hash a child of the suite prints equals the merge base's build's from the same input; every file of the suite not set apart ran | a renderer that changes a pixel of any frame; a frame one build draws and the other doesn't; a run that stops early or draws nothing (BLOCKED); no merge base (BLOCKED) |
| | `ac3-planted-dof.test.mjs` | the every-pass fixture's frames 0 to 4: as shipped they hash as the merge base's; under `dof_reads_shared_before_write` the same check fails, naming a frame | the base (BLOCKED: no such planted program); a plant that draws as shipped; a change that draws the fixture otherwise as shipped (INCONCLUSIVE) |
| AC4 `#3506.39b8e6ca` the estimate falls by the occluders' depth: 16 B a pixel of the view and of its mirror's view; a planted estimate that still counts it fails naming the bytes | `ac4-estimate.test.mjs`, first test (`estimateProblems`) | at 3456 × 2234 (`per_px × w × h + fixed`), the merge base's estimate less the change's is 154,414,080 B, within 1 B: 16 × 3456 × 2234 + 16 × 1728 × 1117 | the base (falls by 0); an estimate that drops the view's depth alone (123,531,264 B) or drops more; no merge base (BLOCKED) |
| | second test (`plantedEstimateProblems`) | under `estimate_counts_occluders_depth` the same check fails, naming the bytes | the base (BLOCKED: no such planted program); a planted estimate that isn't one |
| AC5 `#3506.25e79c7f` no acceptance test is edited | `ac5-unedited.test.mjs` (#3507's `editedProblems`) | `git diff --name-status --no-renames <merge base> -- tests/acceptance` lists additions only | a file under `tests/acceptance/` edited, deleted or changed in type, committed or not. Passes at the base |

## Readings where the issue leaves a choice

- **The 300 frames.** #3031's: 5 a second, the whole of the fixture's 60 s, the camera once around; the listing is
  what the device holds after the last. Criterion 4's estimate is of the scene, which holds the same targets in every
  frame of the fixture, so it is read from one frame.
- **"215 MB"** is 215,000,000 B, the MB #3031's listing prints (10^6 B). **"On the merge base it holds 1,794 MB"** is
  the issue's reading of one Mac; the test prints the merge base's own beside it and decides nothing by it, since the
  criterion's line is the change against the merge base read the same way.
- **"Read the same way"** is the same reader, from the same sources, built against each side's `crates/`, drawing the
  same fixture under the same look on the same machine in the same file.
- **"One 4-sample depth for each view"** counts every 4-sample texture in a depth format at the view's size, so a
  depth kept for the occluders under any label counts. **"One resolved image for motion blur and depth of field"**:
  in the view, where both run, exactly one; in the mirror's view, which runs depth of field alone, at most one.
- **"Naming the target"**: the failure names `scene3d occluders' depth`, the label the planted renderer keeps.
- **"Every frame of" a suite** is as #3507's and #3016's suites read the same words; see #3507's README, Readings,
  for what is taken and left out. The lists of files set apart are read when the test runs.
- **The planted depth of field** is judged on #3031's every-pass fixture, where motion blur and depth of field are
  both on and so share an image; the four suites are criterion 3's for the change as shipped. "Draws motion blur's" is
  what the plant does (above), not a second thing the test asserts: it holds that the plant's frames fail the check,
  naming a frame, where the shipped frames pass it.
- **"Falls by the occluders' depth it counted"** is exact: the estimate's bytes at the fixture's size, from `per_px`
  and `fixed`, fall by 16 B a pixel of the view and 16 B a pixel of its mirror's view at half the size, and by nothing
  else. The 1 B is float rounding.

## What isn't asserted, because no criterion says so

- The Scope's usage reading (whether a texture made with two passes' usages holds more bytes on Metal) and whether
  the local tone map resolves into the shared image: the Proof line's, which the PR's report gives.
- "No pass list or public count changes", beyond criterion 3's pixels; and that a test or tool reading a shared
  target by its label keeps what it needs (the PR lists any reader it moved).
- The mirror's view's own depth of field, the velocity target's format, and whether the geometry pass keeps the
  occluders' depth instead of clearing it: not in this task.
- Spans of the shared targets frame by frame: #3031's trace reads them; the criteria read what is held.

## What the implementer adds outside the folder

- The three planted programs above, with `--planted dof_reads_shared_before_write` in `deep-gpu`'s parse and its
  mapping.
- Nothing in `scripts/lanes-lists.mjs`: the folder is alone by its own `lane.json`, and no file here judges a time.
- If a change to the crates the reader builds with changes their dependencies, the reader's `Cargo.lock` follows,
  as #3031's README builds it (`--locked`).
