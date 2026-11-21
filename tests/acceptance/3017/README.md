# Acceptance tests for #3017: a 3D snapshot's visible table says what shows

Each row is `{id, box, px, at}` read from the frame's object-ID pass. An item nothing of which shows is listed under
`hidden`. A cut table says what it left out.

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #3017
(its Scope, its nine acceptance criteria, its Runs on and Proof lines), the bodies of the issues it names (#310, #133,
#1939, #2513, #2896), the design sections it links and those they lean on, and base commit `b6b99ad8c` (main on
2026-11-21, without the issue's work).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one test per criterion, two for criterion 9 (two kinds of machine), and one per
wrong program a criterion names.

## What was read

- Issue #3017. The bodies of #310 (the epic), #133 (the loop), #1939 and #2513 (light readings on every snapshot) and
  #2896 (what a client keeps of a reply). No comments, no pull requests.
- `docs/canvas-primitives.md`:
  - Render-back: the request, `probes ≤ 64` answered "through the object-ID pass and a CPU ray", hits nearest first,
    "Each reply carries a table of visible item IDs with screen boxes, at most 200 rows sorted by ID", display only.
  - Render-back: diagnostic modes.
  - Check input: loop kinds: ID view and observations ("a number at the visible center of each item in render-back's ID
    table"; "a kept item that doesn't show at all is listed … with no mark").
  - Check input: loop kinds: occluded share (rays on evaluated data stay `camera.framing`'s).
  - Cutaway `cutaway@1` (planes hide geometry "in every pass that draws the cut items").
  - Sheet `sheet@1` (a contact sheet is a sheet of times).
- `docs/technical-design.md`:
  - Five ways in, all onto the same core (`deep_show` gains shots, sheets, diagnostic modes and readings).
  - "Every task carries its own budgets": five runs after warm-up, under the GPU lease, with DeepBuild's own other GPU
    work held; the margin.
  - The reference Macs.
  - Dogfooding, and Tests written first.
- At the base, for surfaces and conventions only (never for expected values):
  - `AGENTS.md`.
  - `crates/deep-show/src/`:
    - `main.rs`: the `deep_show` and `render_back` calls' fields, and the scenario's `planted`, which refuses an unknown
      name as bad input.
    - `hub.rs` (`present`: the reply's `visible` from `Scene::boxes`).
    - `probe.rs`: `render_back_3d`, `view_sheet`, `Targets::pick`.
    - `ask.rs` (`render_back`), `modes.rs` (`mode_3d`'s `visible`), `scene3d.rs` (`Targets`, `GpuLease`'s users) and
      `review.rs` (the ID view's `at`).
    - `kit/goldens.rs` (`GpuLease`: `$HOME/.cache/deepbuild-gpu/lease`).
  - Elsewhere in `crates/`:
    - `crates/deep-canvas-scene3d/src/scene.rs` (`Scene::boxes`), `hit.rs` (`through`) and `cut.rs`.
    - `crates/deep-canvas-loop/src/review.rs` (`id_view`).
    - `crates/deep-marks-raster/src/lib.rs` (`visible`).
    - `crates/deep-canvas/src/camera.rs` (an orthographic camera's `view_width`).
  - `scripts/`: `proof-change.mjs` (`criterionId`), `lanes.mjs` (`alone`, `timed`, `redrafted`, the "design links and
    names" lane), `design-links.mjs` and `benchmark.mjs` (`fingerprint`, `judgeLimit`).
  - The suites:
    - `1939/` and `2513/`: the models for this suite's shape; parts copied into `helpers.ts`, never imported.
    - `456/` (the ID view, probes on a grid), `457/` (a cutaway in a document) and `1725/` (the sheet).
    - `2516/`: the GPU lease in a timing, and a suite run in a child vitest.
    - `427/`, `1729/` and `2293/`: which of their files read a 3D table.

## What the base already does

Seen in the base run (`BASE-FAILURE.txt`) and read in the code:

- `deep_show` of a whole 3D revision with `include: ['issues', 'pixels']` draws it on this Mac's GPU. Its reply holds
  `snapshots: [{sha256, w, h, …}]` and a top-level `visible: [{id, box: [x, y, w, h]}]`.
- Each row of that table comes from an item's projected extent (`Scene::boxes`). A row is kept when its box meets the
  frame. Rows are sorted by ID and cut at 200, with no field saying so.
- The table has no `px`, no `at`, no `hidden` and no `cut`.
- The chair behind the wall is a row of the table. So is a vase a cutaway removes whole.
- The far wall's row reads the same through a doorway and in full.
- `render_back` with `probes` answers each px with `hits`, nearest first, on the revision asked. A px where the
  object-ID pass drew nothing gets no hits.
- `render_back` with a `sheet` returns one snapshot per named view, each with its own `visible` of boxes.
- None of the planted names below exists at the base: a scenario carrying one is refused as `bad_input`.

## Run them

Each file builds `deep-show` with cargo (`--no-default-features --features full`) and draws on this Mac's GPU, so the
files run one at a time. From the repository root, with the root `vitest.config.ts`:

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 nice -n 10 node node_modules/vitest/vitest.mjs run tests/acceptance/3017 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3017/tsconfig.json   # type-check
```

How each file builds and judges:

- **The build.** Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` with
  the 1.99.1 toolchain and `/opt/homebrew/opt/rustup/bin` on PATH. It copies the binary out of `target/`, honoring
  `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` default to `0`. A test whose build failed
  fails.
- **Timeouts.** Every `it` passes its own timeout: an hour, four for the timing and the suites. That overrides
  `--testTimeout`.
- **Proof.** Tests print the issue's proof as lines starting `PROOF #3017`.
- **Clean-up.** Every test writes into temporary folders it deletes.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run`: one scenario line in, one answer line out. For
the timing, one process is kept open, a scenario a line, as #412's budgets do. It uses #393's `deep_show`, #1401's
`render_back` with `probes`, #1725's `render_back` with `sheet`, and #387's `planted`.

- **The documents** are the working agent alpha's (`sess-alpha`). Each scenario mints them on panel `main` with no
  revision.
- **The render-back** is alpha's `deep_show` of a whole revision in the agent's form, with no `id`, no `layers` and no
  item `layer`:
  `{call: "deep_show", session: "sess-alpha", doc, document, t: "0s", size, include: ["issues", "pixels"]}`.
  Its reply carries the table.
- **The sheet** is `{call: "render_back", session, doc, rev, t: 0, size, sheet: {views: [front, back, left, right,
  top, three_quarter]}}` on the revision the deep_show minted.
- **The picks** are read through `{call: "render_back", session, doc, rev, t: 0, size, probes: [[x, y], …]}`, 64 a
  call, on the revision a deep_show in the same run minted. That run draws the same picture: each probe reply's
  snapshot must carry the deep_show's SHA-256. The item a px's pick resolves to is the `item` of the px's first hit;
  `''` means no hits, so the object-ID pass drew nothing there.

### Assumed surfaces

1. **Where the table sits** *(chosen)*. For a deep_show, `visible`, `hidden` and `cut` are keys of the reply, where
   `visible` is at the base. For a sheet, they are keys of each view's snapshot entry, where each view's `visible` is
   at the base.
2. **A row** is `{id, box, px, at}`:
   - `box` is the base's `[x, y, w, h]`.
   - `px` is a whole number above 0.
   - `at` is a px `[x, y]` of whole numbers inside the frame *(chosen)*: the ID view's own `at` is two whole px.
   - Other keys may sit beside them.
3. **`hidden`** *(chosen)*:
   - An array whose entries are item IDs, or rows with an `id`; both read as the IDs.
   - Absent or null reads as empty. A test that needs an item listed fails on an absent `hidden`.
4. **`cut`** is `{visible: n, hidden: n}`. A `cut.hidden` that is absent reads as 0 *(chosen)*.
5. **The first revision.** A fresh scenario's first deep_show of a document mints revision 1. The sheet asks for it.
   The probe runs ask for the revision the first run's deep_show named. Both are checked.

### The planted programs

Each is reachable only through the scenario's `planted`. The implementer adds each beside the scenario's other planted
names and names it in `crates/deep-show/src/main.rs`'s planted match. Each must be read per scenario: the timing sends
honest and planted scenarios to one kept-open process.

| Name *(chosen)* | The wrong program: everything else as shipped | Criterion |
|---|---|---|
| `visible_table_as_boxes` | The merge base's table. Rows `{id, box}` come from each drawn item's projected extent, kept where the box meets the frame, sorted by ID, cut at 200 by ID. No `px`, `at`, `hidden` or `cut`, and nothing read from the object-ID pass. The same picture is drawn. | `#3017.0d5e9e4a` and `#3017.cdc4bd52` (the base they name), and `#3017.c9b75e03`'s "off" side |
| `visible_px_from_box` | Each row's `px` is the area of its box in px (w × h), not the count of its picks. | `#3017.f9dbec77` |
| `visible_at_box_centre` | Each row's `at` is the px at its box's centre. | `#3017.4a9dce0e` |
| `visible_first_200_by_id` | When more than 200 items show, the table keeps the first 200 by ID, not the 200 with the most px. It still reports `cut`. | `#3017.5f877f6f` |
| `visible_cut_unreported` | The table cuts to 200 as shipped (the most px, sorted by ID) and reports no `cut`. | `#3017.5f877f6f` |
| `visible_picks_before_cutaway` | Each item's `px`, `at` and hidden-ness come from the picks of the same frame drawn without the cutaways in effect. | `#3017.68944217` |

## Fixtures (`helpers.ts`)

Units are metres, +Y up; px have x right and y down. Documents are in the agent's form: a `scene` profile requiring
`scene3d`, with a black sky and no ambient light. Each item has an unlit, opaque, double-sided material, and no text
holds a number.

Every fixture but the sheet is seen by an orthographic `camera@1` level on +Z (`orbit {azimuth: 0, elevation: 0,
distance: 20}`, `view_width` set, near 0.5 m, far 60 m). So each box's face toward the camera covers a rectangle of
whole px, and every edge lies half a px from any px centre. A pick and a probe's ray through a px centre can't disagree
at an edge. `boxAt` sizes and places each box from its px rectangle.

| Fixture | Frame | What it holds | Criteria |
|---|---|---|---|
| `room()` | 960 × 540, 60 px/m | See below | 1, 2, 3 |
| `doorway(nearWall)` | 960 × 540, 60 px/m | See below | 4 |
| `grid(size)` | 960 × 540 (and 1936 × 1584), 20 px/m at 960 | See below | 5, 8 |
| `cutaway(cut)` | 960 × 540, 60 px/m | See below | 6 |
| `sheetScene()` | 640 × 360 | See below | 7 |

**`room()`:**

- A table, 120 × 60 px, at z 0, in plain view.
- A wall, 180 × 180 px, at z +1.
- A chair, 60 × 90 px, at z −1, wholly inside the wall's face.
- A lamp, 30 × 60 px at px [450, 240, 480, 300], at z −1.
- A pillar, px x 464 to 520, at z +1. It covers the lamp's right 16 columns, its box's centre (465, 270) among them.
- So the lamp shows 14 × 60 = 840 px, and its box is 1,800 px.

**`doorway(nearWall)`:**

- A far wall, 720 × 360 px, at z −3.
- With `nearWall`: a near wall at z 0 of three parts round a doorway 1 m (60 px) wide. The doorway runs from the
  lintel at y 210 to the frame's bottom edge: 19,800 px of the frame.
- The far wall shows 60 × 240 = 14,400 px through the doorway, and 259,200 px with the near wall removed.

**`grid(size)`:**

- 1,000 boxes, `box-000` to `box-999`, box k centred in cell (k mod 40, ⌊k ÷ 40⌋) of a 40 × 25 grid of 24 × 20 px
  cells. None hides another.
- 300 are large and 1 m nearer:
  - k mod 5 = 4: 200 boxes of 18 × 18 = 324 px.
  - k mod 10 = 2: 100 boxes of 14 × 14 = 196 px.
- The other 700 are small and far: 4 × 4 = 16 px each.
- The same metres at 1936 × 1584 keep all 1,000 in view.

**`cutaway(cut)`:**

- A vase, 60 × 120 px, spanning x 2 to 3 m.
- A stand, 120 × 120 px, spanning x −3 to −1 m.
- With `cut`, `section`: a `cutaway@1` in the document (view class, applying to all) whose plane x = 1 m hides x > 1:
  the vase whole, none of the stand.

**`sheetScene()`:**

- A 0.5 m cube at the origin.
- A screen, 2.4 m square and 0.1 m thick, 1 m behind it (−Z).
- Its own perspective camera, used only by the deep_show that mints the revision.
- The sheet's views orbit the bounds' centre (0, 0, −0.4):
  - back looks along +Z through the screen, which covers the cube whole;
  - front, left, right, top and three-quarter see the cube, the screen behind it or edge-on beside it.

## Criteria to tests

IDs are `#3017.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`). This job computed them from the saved issue body,
and they match the brief's. Every test's name starts `AC<n> #3017.<h8>`.

| AC | ID | File (tests) | What it asserts |
|---|---|---|---|
| 1 | `#3017.0d5e9e4a` | `room.test.ts` (2) | (1) The room's table: the chair isn't a row of `visible`; the table and the lamp are; `hidden` lists the chair. The chair's failure comes first, naming it. (2) Under `visible_table_as_boxes` the same judge fails first on the chair, naming it |
| 2 | `#3017.f9dbec77` | `room.test.ts` (2) | (1) The room shown again. On that revision render-back probes every px of the lamp's face grown by 2 px, and the probes' snapshot is the deep_show's SHA-256. The lamp's row's `px` equals the count of px whose first hit is the lamp, exactly. As a fixture check, the count is above 0 and no lamp px lies in the grown ring. (2) Under `visible_px_from_box` the lamp's `px` is more than that count, and every failure names the lamp and both counts |
| 3 | `#3017.4a9dce0e` | `room.test.ts` (2) | (1) Each row's `at`, from the first run, is a px of the frame. A probe there, on the same picture (one SHA-256), returns the row's item first. (2) Under `visible_at_box_centre` the lamp's `at` is on the pillar (the probe's first hit there), and the judge fails naming the lamp |
| 4 | `#3017.cdc4bd52` | `doorway.test.ts` (2) | (1) The far wall is a row of both tables. Through the doorway its `px` is above 0 and at most the doorway's 19,800. With the near wall removed it is more than ten times the through-doorway px. The two rows aren't equal. (2) Under `visible_table_as_boxes` the judge fails on two equal rows |
| 5 | `#3017.5f877f6f` | `cut.test.ts` (3) | (1) `visible` holds 200 rows, sorted by ID, each once. They are exactly the 200 boxes of 324 px. Nothing is hidden. `cut.visible` is 800 (`cut.hidden`, where given, 0). (2) Under `visible_first_200_by_id` the judge names a row kept and a larger one dropped, by their px. (3) Under `visible_cut_unreported` the table still holds 200 rows, and the judge fails naming 800 |
| 6 | `#3017.68944217` | `cutaway.test.ts` (2) | (1) Two revisions of one document. Before the cutaway the vase is a row and not hidden. With it the vase is no row and `hidden` lists it. The stand is a row of both, as a fixture check. (2) Under `visible_picks_before_cutaway` the judge fails naming the vase |
| 7 | `#3017.2b3c94b2` | `sheet.test.ts` (1) | The sheet of six views returns six snapshots, one a view. Each carries its own table, rows `{id, box, px, at}`. The back view's `hidden` lists the cube and its `visible` doesn't. No other view's `hidden` lists the cube |
| 8 | `#3017.c9b75e03` | `budget.test.ts` (1) | See below |
| 9 | `#3017.d0ed4366` | `suites.test.ts` (2) | See below |

**AC8 (`budget.test.ts`) asserts, in order:**

1. **The lease.** A lease file held by a live process the test starts (and stops by its PID) makes the timing read
   INCONCLUSIVE. Nothing is drawn, no number is reported, and the holder's lease is left as it was.
2. **The structure**, on the debug build at 1936 × 1584. The thousand boxes' render-back has one snapshot of
   1936 × 1584 px. Its table holds 200 rows of `{id, box, px, at}` and a `cut`. Under `visible_table_as_boxes` it
   draws the same picture.
3. **The timing**, only on a reference Mac at rest:
   - deep-show is built for release and kept open;
   - the machine's GPU lease is taken; if it is held or lost, the timing reads INCONCLUSIVE;
   - one warm-up run and five, each of 20 rounds, on and off alternating which goes first;
   - a run's value is median(on) − median(off), a negative one read as 0;
   - `judgeLimit(5 ms)`: FAIL fails, PASS passes, anything else INCONCLUSIVE.

**AC9 (`suites.test.ts`) has two tests:**

1. **The suites.** No file under `427/`, `1729/` or `2293/` differs from the merge base of HEAD with `origin/main`
   (else `main`), working tree included. Then the five files that read a 3D table run through vitest in a child
   process, and every test in them passes:
   - `427/live-redraft.test.ts`;
   - `1729/models.test.ts`, `maps.test.ts` and `sequence.test.ts`;
   - `2293/ac1-frame-box.test.ts`.

   A file `scripts/lanes.mjs`'s `redrafted` maps to a blind redraft runs as that redraft. If every test that didn't
   pass failed INCONCLUSIVE, the test reads INCONCLUSIVE.
2. **The design.** The Render-back section of `docs/canvas-primitives.md` has a sentence on the table naming `px` and
   `at` in code, and `node scripts/design-links.mjs` exits 0.

Wrong programs each file fails on are in its header.

## Readings where the issue leaves a choice

**The room:**

- **"Rendered back at 960 × 540"** is alpha's `deep_show` with pixels at that size. It is the render-back whose reply
  carries the table at the base.
- **"A chair wholly behind a wall", "a lamp half behind a pillar".** The chair's face lies inside the wall's face. The
  pillar hides 16 of the lamp's 30 columns, 53%. That puts the lamp's box centre on the pillar, which criterion 3's
  planted table needs.

**Counting px from the ID pass (criteria 2 and 3):**

- **"Counted by the test from the same frame's object-ID pass".** The base exposes a frame's object-ID pass to a
  client only through render-back's `probes`. Each probe px answers no hits where the pass drew nothing, and otherwise
  the nearest item a ray through that px's centre meets.
- The probes run in the same `deep-show run` as a deep_show of the room, on the revision it minted. Each probe reply's
  snapshot must be that deep_show's SHA-256, so they read the same picture.
- The test counts the px whose first hit is the lamp, over every px of the lamp's face grown by 2 px.
- Because every edge falls on a px boundary, a ray through a px centre names the item the pick names. A px whose
  first hit is the lamp is a px whose pick resolves to the lamp.
- **"A probe at `at` returns the item first"** is the first hit of a probe at that px.
- Criterion 3 learns `at` in one run and probes it in a second run that draws the same picture. The SHA-256 must be
  equal.

**Criterion 4:**

- **"The doorway's px"** is the doorway's rectangle within the frame, 60 × 330. "Ten times that" is ten times the px
  the wall reports through the doorway.
- **"On the merge base the two rows are equal"** is what the base run shows (`BASE-FAILURE.txt`). On every later run
  it is shown by `visible_table_as_boxes`, the base's table as a planted program.

**Criterion 5:**

- **"A frame of 1,000 boxes in view, 300 of them large and near".** All 1,000 show, none hiding another. The 300 large
  ones are 1 m nearer the camera and come in two sizes: 200 of 324 px and 100 of 196 px. So "the 200 with the most
  px" is one set with no tie at the cut, and the test needs no tie-break order.
- The test knows each box's px from its face, the fixture's own geometry; criterion 2 holds px to the picks.
- The first 200 by ID hold 140 small boxes, so a first-by-ID table keeps `box-000` (16 px) and drops `box-204` (324
  px).
- **"`cut.visible` is 800"** with nothing hidden; `cut.hidden`, where given, must be 0.

**Criterion 6:**

- **"A cutaway that removes an item's whole shape"** is a `cutaway@1` item added in a later revision of the same
  document. That is the document form #457's suite uses, view class, applying to all.
- **"Moves the item from `visible` to `hidden`"** compares the revision before it with the revision after it.

**Criterion 7:**

- **"A contact sheet of six views"** is the six named views render-back's `sheet` takes.
- **"Six tables"** is a `visible` table per view's snapshot, rows of the criterion-1 shape, with `hidden` beside it.

**Criterion 8:**

- **"The table adds under 5 ms to a render-back at 1936 × 1584"**: "on" is the shipped render-back. "Off" is the same
  render-back under `visible_table_as_boxes`, the base's table drawn from the same picture, so the difference is what
  the new table adds.
- The fixture is the thousand boxes at 1936 × 1584, a frame that both counts and cuts.
- **The reference Mac.** Timings come from a release build, only on a reference Mac at rest. That means the perf
  lane's `judgeLimit`: mains power, Low Power Mode off, thermal state nominal, and the load within the cores at each
  run's start and end. Elsewhere nothing is timed and the test reads INCONCLUSIVE.
- **"Another GPU job holds a lease"** is the machine's GPU lease file, `$HOME/.cache/deepbuild-gpu/lease`, the one
  `GpuLease` in `crates/deep-show/src/kit/goldens.rs` holds for kits and exports, held by another live process. The
  timing takes that lease before its warm-up and holds it to the end, as `GpuLease` does. Held by another job, or lost
  meanwhile, the reading is INCONCLUSIVE with no number.
- The test shows this on a lease file of its own, held by a process it starts. It never touches another job's lease.

**Criterion 9:**

- **"Every acceptance suite that reads a 3D snapshot's table today"**: the test runs the files of the three suites the
  criterion names that read one, as the brief bounds it.
- Two other suites read a 3D render-back's `visible` at the base: `1162/present.test.ts` (2D items over a 3D frame)
  and `1725/sheet.test.ts` (the sheet's tables). They aren't run here; the implementer runs them through
  `scripts/affected.mjs`.
- **"Passes with no edit"** is judged against the merge base of HEAD with main. The suite keeps running on main after
  later work edits those folders, so a fixed base commit would fail it then.
- **"Changes only by a blind redraft the PR lists"**: the listing is `scripts/lanes.mjs`'s `redrafted`, which maps an
  original file to the redraft that runs in its place.
- **"Render-back's line in the design says what a row holds"** is a sentence of the Render-back section that speaks of
  the table and names `px` and `at` in code. Who reads the line judges whether it says more; the test holds the two
  new fields.
- **"The design links and names lane"** is the lane of that name in `scripts/lanes.mjs`, `node
  scripts/design-links.mjs`.

## Legs that read BLOCKED or INCONCLUSIVE

- **Off macOS.** Every GPU test fails `INCONCLUSIVE:` before drawing. That covers each test but criterion 9's design
  test.
- **Without cargo.** The build can't run, so the test reads INCONCLUSIVE.
- **Criterion 8's timing** is INCONCLUSIVE in three cases:
  - off a reference Mac, or on one not at rest, before anything is timed;
  - when another GPU job holds or takes the lease;
  - when `judgeLimit` reads the runs INCONCLUSIVE.

  Its lease and structure legs run on any Mac first.
- **Criterion 9's suites.** INCONCLUSIVE where every test that didn't pass in them failed INCONCLUSIVE. That is the
  case on a Mac where `deep-show live` can't show a window: `427/live-redraft.test.ts` reads `no_display` there, as
  in this job's base run. BLOCKED where the checkout has no merge base with main.
- **Criterion 9's lane** reads INCONCLUSIVE where `design-links.mjs` couldn't read the open issues (offline, or gh
  signed out).

## What the implementer adds outside this folder

- **The six planted names** in the table above, in `crates/deep-show/src/main.rs`'s planted match and the `Planted`
  enum, each read per scenario.
- **These lines in `scripts/lanes.mjs`**, beside #1939's and #2513's. This README is the instruction; this job edits
  nothing outside its folder.

  ```js
  // #3017's files each build deep-show and draw on the GPU; budget.test.ts times the table on a reference Mac
  // (building deep-show for release there); suites.test.ts runs other suites' files that build and draw.
  alone.push('tests/acceptance/3017/');
  timed.push('tests/acceptance/3017/budget.test.ts');
  ```

- **Each file in `slow`** whose recorded run takes over two minutes. On the base only `suites.test.ts` did (7.5 min);
  the others took under 20 s there, since the base has no table to probe. On the change, `room.test.ts` makes about
  36 render-backs a probed run, and `budget.test.ts` builds for release on a reference Mac at rest.
- **Render-back's line in `docs/canvas-primitives.md`** saying what a row holds, `px` and `at` in code.

## Not tested

No criterion asks for these, so none is tested:

- The rest of the Scope: a part's px counted toward its item; a see-through item's px and its sentence in the design;
  a diagnostic mode's table; `cut` absent when nothing is cut; "no second render", beyond criterion 8's time.
- A 2D document's table, an occluded share for every item, and what a client keeps of a reply (#2896): out of scope by
  the issue.

## Files

- `README.md` (this file) and `BASE-FAILURE.txt`: the run on the base.
- `helpers.ts`: the build, the scenario, the calls, the fixtures, reading a table, reading picks through probes, and
  the timing rule and GPU lease.
- `room.test.ts` (criteria 1 to 3), `doorway.test.ts` (4), `cut.test.ts` (5), `cutaway.test.ts` (6), `sheet.test.ts`
  (7), `budget.test.ts` (8) and `suites.test.ts` (9).
- `tsconfig.json`: type-checks the folder against the repo's own config.
