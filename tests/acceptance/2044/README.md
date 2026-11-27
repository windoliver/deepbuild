# Acceptance tests for #2044: numbers and names read from outside bytes are bounded where they are read

Written first, from issue #2044 (its opening paragraph, scope, seven acceptance criteria, proof line and the tracker
review in its one comment), the four design sections it links and the base commit `ebf1e7f44` (main; its last merge is
#3411), by a job that never saw an implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, #2044, and its comment of Nov 9. It names #6 (its epic), #395 and #1414 (not in this task) and #1994,
  which waits on this issue; none of them has a suite these criteria read.
- **The design**, `docs/canvas-primitives.md`: Decode worker; Asset: meshes; Cell grid `cells@1`; Vector and formula
  `vector@1`. `docs/technical-design.md`: Criteria to tests, Closed issues stay proven, Criteria in a checked shape,
  Wrong programs, The edit guard, Dogfooding, Tests written first, Repo guards. `docs/parallel-proof.md`, sections 5
  to 7. AGENTS.md and CONTRIBUTING.md.
- **The base, for names, shapes and conventions**: `crates/deep-codecs/src/mp4.rs` (`parse`, `track`, `table`) and
  `lib.rs` (`run`, `format`, `probe`, `refused`, `serve`, `Caps`, `Planted`, `mux_h264`);
  `crates/deep-canvas-scene3d/src/gltf.rs` (whole) and `geom.rs` (`Mesh`, `unit`, `tri`);
  `crates/deep-canvas-cells/src/emulator.rs` (`Terminal`, `resize`, `save`, `restore`, `csi`, `private_mode`);
  `crates/deep-canvas-vector/src/svg.rs` (`import`, `scan`, `Refusal`, `Svg`, `Twin`); the four crates' manifests, the
  workspace's and `Cargo.lock`; the history of the four files since the issue was filed (`git log`, and what
  `9b9532449` changed in each); `scripts/canvas-lint.mjs` (its scope and what it refuses), `scripts/proof-change.mjs`
  (`criterionId`, `tagsIn`, `isTestFile`), `scripts/proof-runs.mjs` (`prepareRuns`, `atAssertion`, `twinsOf`,
  `twinOverlay`, `before`), `scripts/proof-binaries.mjs`, `scripts/lanes.mjs` (`testPaths`, `aloneReasons`),
  `scripts/alone-lint.mjs`, `scripts/proof-guard.mjs` (`laneFileProblem`), `scripts/twins-lint.mjs`,
  `scripts/wait-ratchet.mjs`; and the suites `tests/acceptance/2660/`, `3171/`, `3172/`, `2694/`, `1935/` and `1832/`
  for the house form.

No pull request, branch, other worktree or commit after the base was read, and nothing outside the checkout and the
job's inputs.

## Run them

```sh
node --test --test-concurrency=1 tests/acceptance/2044/mp4.test.mjs        # criteria 1 and 2
node --test --test-concurrency=1 tests/acceptance/2044/gltf.test.mjs       # criteria 3, 4 and 5
node --test --test-concurrency=1 tests/acceptance/2044/terminal.test.mjs   # criterion 6
node --test --test-concurrency=1 tests/acceptance/2044/svg.test.mjs        # criterion 7
```

Node 24 and the pinned Rust toolchain (`cargo` and `rustc` on `PATH`, or cargo in `~/.cargo/bin`). No `node_modules`,
no package build, no GPU, no window. Each file builds the reader once (below) and removes it when its tests are done;
nothing is written in the checkout but cargo's `target/`.

**The reader, and why it is built this way.** `reader.rs` is the suite's one Rust file: it calls one of the four
readers on one fixture and prints what it answered (The surface under test). It is test code, no target of any crate.
`helpers.mjs` builds it in two steps:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-codecs -p deep-canvas-scene3d \
  -p deep-canvas-cells -p deep-canvas-vector --message-format=json
rustc --edition 2021 --crate-name acceptance_2044_reader -C debuginfo=0 -o <a temporary folder>/reader \
  -L dependency=<target>/debug/deps --extern deep_codecs=<its .rlib> --extern deep_canvas_scene3d=<its .rlib> \
  --extern deep_canvas_cells=<its .rlib> --extern deep_canvas_vector=<its .rlib> tests/acceptance/2044/reader.rs
```

cargo builds the four crates' libraries, in the dev profile every acceptance helper builds in (the two variables
default to 0 and the caller's values win), and names each library's file in its JSON messages; rustc then builds the
reader against those four files, and finds what they link in turn beside them. A registered target was not possible
without loss:

- the canvas lint (`scripts/canvas-lint.mjs`) refuses a target rooted outside its crate in `deep-canvas-scene3d`,
  `deep-canvas-cells` and `deep-canvas-vector`, which are in its scope;
- `deep-codecs`, which is outside it, depends on `deep-canvas-cells` alone of the other three; a dev-dependency on
  the other two changes `Cargo.lock`, and the only crates outside the lint's scope whose manifests name all four
  are `deep-show`, the workspace's largest build, and `deep-player`, which builds 31 of the workspace's crates;
- a target wired in a manifest is not there on the merge base when the proof lanes run these tests on it: they lay
  only the test paths over the base (`scripts/proof-runs.mjs`, `prepareRuns`), so no test could fail there, where six
  of the seven criteria say it fails.

So the suite needs nothing outside its folder, and the merge base runs it as it is.

**Time.** With the four libraries built, cargo's part is a check of their freshness and rustc's a build of one small
file linked against them; a reader has a few hundred bytes to read. No criterion states a time and none is asserted.
Each reader run has a deadline of 300 s (`DEADLINE_S`), which only a reader that loops over a stated count or walks a
tree with no memory can reach, and each cargo and rustc call a bound of 60 and 20 minutes for a build that hangs. At
the base, with the libraries built, the four files took 1.9 s, 6.2 s, 1.0 s and 1.0 s (node's `duration_ms`, on a
shared machine at a one-minute load of 67; `BASE-FAILURE.txt`): the reader's build is under 1 s of each, and 5.2 s of
`gltf.test.mjs` is criterion 4's walk on the base. A first build of the four libraries took 1 m 20 s there with
`-j 8`.

**Lane needs.** `lane.json` puts the folder in the alone block, reason `binary`: each file starts cargo and reads
`target/`, so a sibling's cargo build would rewrite the libraries under it.

**Nothing unrun passes.** A cargo or rustc that can't run, or is stopped at its bound, is `INCONCLUSIVE`; a crate or a
reader that doesn't build, a fixture that isn't there or doesn't say what its criterion says, and a reader that never
ran are `BLOCKED`. Each is an error that names it, thrown before any assertion, so the lanes read it as a test that
did not reach its assertion, never as a pass and never as the criterion's failure.

## The surface under test

The four readers are reached through what their crates already make public at the base. `reader.rs` links these
names, so they stay as they are: **existing, unchanged**.

| Reader | Called as | What the reader prints |
|---|---|---|
| The decode worker's probe | `deep_codecs::run(job, &Caps::default(), &Planted::default())` with the job `{"op": "probe", "path": <file>}`; `Caps::json()` gives the JSON object the job is written into | the reply, as its JSON |
| The mesh import | `deep_canvas_scene3d::gltf::import(bytes, "fixture", 0, &|_| None)`, a `Result` of `Imported` (`nodes` with `index`, `name`, `world`, `primitives` with `mesh` and `material`; `lights`, `materials`, `images`, `dropped`) or a `Fault` that prints with `{:?}`; a `Mesh`'s `positions`, `normals`, `indices`, `uv0`, `uv1`, `tangents` | `{"refused": <the fault's Debug text>}` or `{"imported": {...}}` |
| The terminal | `deep_canvas_cells::emulator::Terminal`: `new(cols, rows, 0)`, `feed`, `resize`, `cols`, `rows`, `row`, `text_of`, `cursor` | the grid's size, its cursor, and each cell that isn't blank by row, column (from 1) and text |
| The SVG import | `deep_canvas_vector::svg::import(bytes, &[], Twin::Honest)`, a `Result` of `Svg` (which prints with `{:?}`) or a `Refusal` with `code()` and `found()` | `{"imported": <the Svg's Debug text>}` or `{"refused": {"code", "found"}}` |

**New, the implementer provides them** (each is this suite's reading where the issue leaves the interface open; see
Readings):

- **An MP4 refusal** is the probe's reply `{"refused": {"code": "<any code>", ...}}`, the shape `refused(code, extra)`
  gives every refusal of the worker at the base, at the top of the reply. Its JSON text holds the box's four letters
  as a word (`stsz`, `stts`) and, for criterion 1, the count's digits, `50000000` (written together or in groups of
  three, as a number or in a string). The code and every other field are free. Examples that pass:
  `{"refused": {"code": "unreadable", "why": "stsz states 50000000 samples, the file holds 4 bytes of them"}}`,
  `{"refused": {"code": "over_count", "box": "stsz", "count": 50000000, "limit": 4}}`.
- **A glTF refusal** is `gltf::import` returning `Err(fault)`. The fault's Debug text names the accessor or the node
  by its index in the file: the word `accessor` or `node` (or a name that starts with it, as `accessors` or
  `node_two_parents`), then the index, with at most three characters between them that are neither letters nor
  digits and, at most, the words `at`, `index`, `number`, `no.` or `#` (`names` in `helpers.mjs`). Examples that
  pass: `params/sha256: accessor 0 states 1000000 rows; its 12-byte buffer view holds 1`, `accessors/0`,
  `accessors[0]`, `params/sha256: node 1 is reached twice`, `node_two_parents: 1`, `nodes/1`. The fixtures give no
  accessor and no node a name, so the index is the only name each has. The code and the rest of the words are free.
- **No panic and no endless reader**: each reader returns for each fixture.

Nothing else is new: no test names a new function, type, field, feature or option, and no manifest changes.

## Criteria to tests

Each criterion's ID is `#2044.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out, checked against the issue's body. Each test's
name starts with `AC<n> #2044.<id>`, from a const string in its own file.

| Criterion | Test (file) | What it requires | The wrong program it fails on |
|---|---|---|---|
| AC1 `#2044.186e93e0` an MP4 under 1 KiB whose `stsz` states a fixed sample size of 1 and 50,000,000 samples is refused, naming `stsz` and the count | 1 in `mp4.test.mjs` | `fixtures/stsz.mp4` is under 1,024 bytes and its `stsz` states 1 and 50,000,000. The probe's reply is a refusal whose JSON names `stsz` and `50000000` | The merge base: it sizes its tables from the count and returns a probe with no refusal |
| AC2 `#2044.039601da` an MP4 under 1 KiB whose `stts` holds 2 runs of 4,000,000,000 samples each is refused, naming `stts` | 1 in `mp4.test.mjs` | `fixtures/stts.mp4` is under 1,024 bytes and its `stts` holds 2 runs of 4,000,000,000. The probe's reply is a refusal whose JSON names `stts` | The merge base: it returns a probe with no refusal |
| AC3 `#2044.5bc09669` a glTF under 1 KiB with one accessor of `count` 1,000,000 over a 12-byte buffer view with `byteStride` 0 is refused, naming the accessor | 1 in `gltf.test.mjs` | `fixtures/accessor.gltf` is under 1,024 bytes, with one accessor of count 1,000,000 over a 12-byte view with `byteStride` 0. The import is refused, and the fault names accessor 0 | The merge base: its refusal names no accessor. The twin `rows-by-count`, the importer the criterion describes: it reads 1,000,000 rows and refuses nothing |
| AC4 `#2044.e7ef5233` a glTF of 24 nodes, each listing the next node twice as its children, is refused, naming node 1 as reached twice | 1 in `gltf.test.mjs` | `fixtures/nodes.gltf` has 24 nodes, each but the last listing the next twice. The import is refused, and the fault names node 1 | The merge base: its walk visits 16,777,215 nodes and returns with no refusal, or is stopped at the deadline |
| AC5 `#2044.57d379a6` a glTF with two accessors interleaved in one buffer view at `byteStride` 24, and two nodes that use one mesh, imports to the same result as on the merge base | 1 in `gltf.test.mjs` | `fixtures/shared-mesh.gltf` is so made. The import is not refused and returns the merge base's result, value for value (Readings: The merge base's result) | The twin `mesh-used-twice`, the planted check the criterion names: the test fails naming mesh 0. The merge base passes, as the criterion says |
| AC6 `#2044.19a0d966` on a 200 by 50 grid a cursor moved to row 50, column 200 and saved, then restored after a resize to 80 by 24, prints `x` at row 24, column 80; the same when the program enters and leaves the alternate screen | 2 in `terminal.test.mjs`, one a run | After each run the grid is 80 by 24 and its one cell that isn't blank is the `x` at row 24, column 80 | The twin `restore-unclamped`, the emulator the criterion describes: it panics in both runs. The merge base passes (below) |
| AC7 `#2044.78e8c53e` an SVG whose root has an attribute named `aé` imports as the same file without that attribute does, and an attribute named `ONCLICK` is still refused as script | 1 in `svg.test.mjs`, three files | `fixtures/attribute.svg` and `attribute-none.svg` differ by the attribute alone, both import, and to the same `Svg`; `attribute-onclick.svg` is refused with the code `svg_script` | The merge base: it panics on the first file |

Every failure is an assertion in `helpers.mjs` or the test's own file, so it is the framework's own failure under the
test paths (design: Failing on an assertion). A reader that panics, dies or outlives its deadline fails the test at
an assertion that says which and quotes what the reader said.

## The merge base and the wrong programs

The issue was filed on 2026-11-10 at 00:35 UTC. `9b9532449` ("Whole-project audit", 2026-11-10 01:52 -0800), which is
behind the base, changed three of the readers after that, so three of the criteria's sentences about "the merge base"
describe older code than `ebf1e7f44`. The table was read from the base's source when the suite was written. The base
run has since shown each row's outcome (a refusal or none, a pass, a panic) to be as the table gives it; what a
reader does inside (a table sized from the count, 16,777,215 visits) stays read from the source (The base run):

| Criterion | The issue says the merge base | `ebf1e7f44` | So the wrong program is |
|---|---|---|---|
| 1 | sizes its table from the count, returns no refusal | the same: `table` builds `sizes` from the count (a fixed size never caps it) and reserves `samples` by it | the merge base |
| 2 | loops 8,000,000,000 times, returns no refusal | since `9b9532449` a run ends at the last sample, so it no longer loops; it still returns no refusal | the merge base, which fails for the refusal it doesn't give; no time is judged |
| 3 | reads 1,000,000 rows from the 12 bytes | since `9b9532449` it refuses a stride under its element, `params/sha256: a byte stride under its element`, naming no accessor | the merge base, which fails at the naming; and the twin `rows-by-count`, that refusal taken out again |
| 4 | visits 16,777,215 nodes, returns no refusal | the same: the walk's one bound is a depth of 64, and the fixture is 23 deep | the merge base |
| 5 | (passes) | reads interleaved accessors and a mesh used twice | the twin `mesh-used-twice` |
| 6 | panics in both runs | since `9b9532449` `restore` clamps the place it restores, so neither run panics and the `x` is at row 24, column 80 | the twin `restore-unclamped`, that clamp taken out again: a reverted fix (AGENTS.md, Proof) |
| 7 | panics on the first | the same: `scan` slices the name at byte 2 | the merge base |

Where the base already does what a criterion's first sentence asks (criterion 6), it can't be that criterion's wrong
program; the fix reverted is. Criterion 6's two tests therefore pass on the merge base and on any change that keeps
the behaviour, and prove the criterion only through their twin, which no run has built yet (The base run). The
Scope's line "a terminal resize clamps the saved cursor as it clamps the cursor" names where the clamp sits; no
criterion reaches that, and nothing here asserts it.

## Twins (`twins.json`)

A twin is laid over the program being judged and built, and the same test files run on it unchanged
(`scripts/proof-runs.mjs`). None replaces a file under the test paths.

| Criterion | Twin | Form | The wrong program |
|---|---|---|---|
| `#2044.5bc09669` | `rows-by-count` | `lines.json` over `crates/deep-canvas-scene3d/src/gltf.rs` | In `accessor_rows`, the four lines that refuse a stride under its element are taken out. The file's `count` alone says how many rows are read: 1,000,000 from the fixture's 12 bytes, and the import returns them |
| `#2044.57d379a6` | `mesh-used-twice` | `lines.json` over `crates/deep-canvas-scene3d/src/gltf.rs` | In `import`'s walk, after a node's mesh is found, a mesh that more than one node of the file uses is refused: `params/sha256: mesh 0 is used twice`. Nothing else changes |
| `#2044.19a0d966` | `restore-unclamped` | the whole of `crates/deep-canvas-cells/src/emulator.rs` at the base, one place changed | In `restore`, the cursor goes back to the place saved, unclamped. A resize clamps the cursor and not the saved cursor, so the `x` is written past the grid and the emulator panics |

Each changed place is marked `#2044's planted wrong program`. The two line twins match their `find` lines at exactly
one place in the base's file. `restore-unclamped` is a whole file because its wrong program is "no place clamps the
saved cursor": lines taken out of `restore` stop being wrong the moment a change clamps the saved cursor in `resize`,
as the Scope asks, and lines over `resize` can't be written before that change exists. The twins lint
(`scripts/twins-lint.mjs`, which no lane runs at the base) lists it as a whole file; that is known. `rows-by-count`
and `restore-unclamped` each take out a fix their crate has a unit test of, so that unit test fails on them; only
this suite's tests are run on a twin.

**When the file a twin edits has changed beside the work.** The wrong program stays what the table says. If a line
twin's `find` lines no longer match the change's `gltf.rs` at exactly one place, or `restore-unclamped` no longer
builds beside the change's files, make the same one-place change in the change's own file and replace the twin with
it, in the same form, at the same path: for `mesh-used-twice`, the check after a node's mesh is found; for
`rows-by-count`, an accessor's rows read by its `count` with no check of its stride or its buffer view; for
`restore-unclamped`, a saved cursor that neither `resize` nor `restore` clamps. The tests, the fixtures and
`helpers.mjs` stay as they are. `rows-by-count` is needed only while the merge base refuses the fixture without
naming its accessor; the lanes don't lay a twin for a test that fails on the merge base at its assertion.

No twin has been built or run, by this job in either of its runs or by the base run: laying one writes outside this
folder and compiles a workspace crate again. What was checked without a build: each line twin's `find` lines match
the base's file at exactly one place, each twin's file with its change parses and is formatted as the base's is
(`rustfmt --check`), and each judge fails the answer its twin gives, as read from the twin's source: an import that
returns 1,000,000 rows, a refusal `mesh 0 is used twice`, a reader that panics past the grid. So what each twin is
here to show is not shown yet (The base run: What the base run doesn't show).

## The fixtures (`fixtures/`, written by `make-fixtures.mjs`)

Files, so they can be opened; each test holds its fixture to what its criterion says of it before it reads the
reader's answer, and checks its size where the criterion gives one. Each states the one number or name its criterion
gives and is otherwise a small file with nothing wrong in it, so a refusal can only be for that number or name.

| File | Bytes | What it is |
|---|---|---|
| `stsz.mp4` | 611 | An MP4 of one video track laid out as the base's own writer lays one out (`mux_h264`): `ftyp`, an `mdat` of four bytes, `moov` with `mvhd` and one `trak` whose tables say one chunk of four one-byte samples. Its `stsz` alone states a fixed size of 1 and 50,000,000 samples |
| `stts.mp4` | 619 | The same file with a `stsz` of four samples; its `stts` alone holds 2 runs of 4,000,000,000 samples each |
| `accessor.gltf` | 391 | glTF JSON, its 12-byte buffer inline: one buffer view of 12 bytes with `byteStride` 0, one accessor of three floats a row and `count` 1,000,000, one mesh, one node |
| `nodes.gltf` | 541 | glTF JSON of 24 nodes: nodes 0 to 22 each list the next node twice, node 23 has no next and lists none. No node has a name or a mesh |
| `shared-mesh.gltf` | 656 | glTF JSON, its 72-byte buffer inline: one buffer view at `byteStride` 24 holding a position then a normal per vertex for three vertices, so the second accessor's last row ends on the view's last byte; one mesh of one triangle; nodes 0 and 1 both use it, at translations `[1, 2, 3]` and `[-4, 5, 6]` |
| `attribute.svg`, `attribute-none.svg`, `attribute-onclick.svg` | 124, 116, 128 | One SVG of one path, UTF-8, whose root has ` aé="1"`, no such attribute, or ` ONCLICK="1"` in its place |

## Readings where the issue and the design leave a choice

- **Where an MP4 refusal is read.** The decode worker's reply to a probe, through `deep_codecs::run`, which is what
  the worker's loop (`serve`) calls for each job and what the base's suites read as `reply.refused`. A refusal inside
  one stream of an asset that is otherwise admitted is not the file refused. The issue names no code, so none is
  asserted.
- **"Naming `stsz` and the count", "naming `stts`".** The refusal's JSON text holds the box's four letters as a word
  and the count's digits. Where they sit (a `why`, a field of its own) is free. Criterion 2 names no count, so none
  is read.
- **Where a glTF refusal is read.** `gltf::import`'s own `Err`, the fault its callers wrap in codes of their own
  (`asset_unreadable`, `mesh_unreadable`); `import` is the importer that walks the node tree and reads every
  accessor a scene's meshes use. The fault is read as its Debug text, the least a fault must have.
- **"Naming the accessor", "naming node 1".** By index, after the word, as above. The design gives a node reached
  twice the code `node_two_parents`; that is #1994's criterion, the tracker review says only that using it here
  would keep the two issues to one name, and criterion 4 names no code, so the code is accepted and not required.
- **"As reached twice".** Node 1 is the first node a walk reaches twice (node 0 lists it twice), so the test requires
  that node 1 is the node named. The words around it are free.
- **The merge base's result (criterion 5).** Worked out from the file's own numbers by `importOf` in `helpers.mjs`,
  not recorded from a run, so the suite is whole before any build and the expected value has a source outside the
  importer: the scene's two nodes in order, each by its index, named by its index (it has no name), at the matrix of
  its translation; one primitive each, with no material, whose positions and normals are the two accessors' rows
  read at the view's stride of 24, three vertices drawn in file order (indices 0, 1, 2), no uv0, uv1 or tangents;
  and no lights, materials, images or dropped inputs. The reader prints exactly these and the comparison is exact (0
  and -0 are one number). The base run showed that the merge base returns them: criterion 5's test passed there (The
  base run). A mesh's other fields (`faces`, `parts` and the rest of a builder's bookkeeping) are not compared.
- **The terminal's runs (criterion 6).** Rows and columns count from 1. "Moves the cursor to row 50, column 200" is
  `ESC [ 50 ; 200 H`; "saves" and "restores" are `ESC 7` and `ESC 8`; "enters the alternate screen" and "leaves it"
  are private mode 1049, `ESC [ ? 1049 h` and `l`, the alternate screen that keeps the cursor across it. The
  terminal has no scrollback. "The `x` is at row 24, column 80" is read as: that cell holds `x` and no other cell of
  the 80 by 24 grid holds anything.
- **"Imports as the same file without that attribute does" (criterion 7).** Both files import, and the two `Svg`s
  print the same Debug text; the honest importer, no part classes. Both clauses are one test, since the second
  passes on the merge base and the criterion names no wrong program for it alone. That it passes there is read from
  the base's source: the test ends at its first file on the base (The base run).
- **"Refused as script".** The refusal's code is `svg_script`, the code of `Refusal::Script` at the base. What it
  found is printed in a failure and not asserted.
- **"A new fixture"** is a file the suite adds. **"Under 1 KiB"** is under 1,024 bytes.
- **The deadline and the heap cap.** A reader runs in a process of its own, stopped by its PID after 300 s, and
  `reader.rs` ends itself when its heap passes 4 GiB, saying so. Both are bounds for the machine's sake, and the base
  run reached neither: criterion 1's reader ended with its reply, and criterion 4's after about 5 s. Read from the
  merge base's source, criterion 1's reader holds under 2 GiB there (a 50,000,000-entry size table and room reserved
  for as many samples); the run measured no memory. Neither is a criterion, and a reader that ends is never judged by
  its time or its memory.

## What is not asserted

- **The opening paragraph's "each refusal names the number and its limit" and "no option turns them off".** Each
  criterion says what its refusal names; none gives a limit's value or names an option.
- **Scope lines no criterion reaches.** A chunk count the file can't back (`stco`, `co64`, `stsc`), and the counts of
  `ctts` and `stss`; "before any table is sized from it", past the reader's heap cap; an accessor whose rows don't
  fit a view with a stride at or above its element; a stride under its element other than 0; a node listed twice in
  any other shape; where the saved cursor is clamped.
- **Other ways in.** `gltf::mesh`, `primitives`, `uv_sets` and `rig`, and `world`'s parent search; a GLB; the
  worker's loop, its sandbox and `Head::read`; the callers' codes; `ESC [ s` and `ESC [ u`, and private modes 47 and
  1047; attributes of elements other than the root, and other names.
- **Time and memory.** No criterion states either.
- **#395, #1414 and a corpus lane**, which the issue puts out of this task, and #1994's criteria (a node with two
  parents, a node that lists itself, an accessor with no buffer view, a 1 s line).
- **The Proof line's run on the branch.** The base was run for this job (The base run); the run on the change is the
  implementing change's.

## What the implementer adds outside this folder

Nothing. No manifest entry, dependency, feature, lane list or lock change; `lane.json` is in the folder.

## The base run

The job ran twice. Its first run, on 2026-11-24, wrote the suite with nothing built: no cargo, no rustc and no test
file was run. What it checked: every script with `node --check`, `reader.rs` and the twins' Rust with `rustfmt
--check --edition 2021`, each fixture's bytes against what its criterion says, and each judge against planted answers
(a good one passes; each wrong program's answer, as read from its source, fails at an assertion that names what its
criterion names; a reader that never ran reads `BLOCKED`).

Between the two, the job's caller built the four libraries in the job's checkout at `ebf1e7f44` and ran each test
file there once, unchanged, by the commands under Run them. The job's second run, on 2026-11-25, finished the suite
from the same inputs and that run's logs. It read each test against the issue, the four design sections and the four
readers at the base again, checked each log against its criterion and against what this README had said the base
would do, ran the first run's probe of the judges again (it passes), and wrote the run up here and in
`BASE-FAILURE.txt`. It changed no test file, helper, reader, fixture or twin, so the files the base ran are the
files here. It ran no test file, no cargo and no rustc, and it saw no implementation either. Beside what the first
run read, it read `frames` in `scripts/proof-runs.mjs`, how `scripts/throttle.mjs` admits a run, and the
`BASE-FAILURE.txt` of `tests/acceptance/2660/`, `3171/` and `2256/` for the house form.

- **Commit, toolchain, machine:** `ebf1e7f44`, the checkout's HEAD, with this folder beside it, untracked, and
  nothing else; Node v24.22.0 and `rustc 1.99.1 (58cf8f9c3 2026-10-13)`; a shared Mac at load averages of 66.69
  34.88 29.09.
- **Build:** `cargo build --locked -j 8 -p deep-codecs -p deep-canvas-scene3d -p deep-canvas-cells -p
  deep-canvas-vector` under `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`, 16:57:34 to 16:58:54, exit 0.
- **Run:** the four commands under Run them, one at a time, 16:58:54 to 16:59:05. They exited 1, 1, 0 and 1.

| Test | On the merge base | Against its criterion's sentence about the merge base |
|---|---|---|
| AC1 `#2044.186e93e0` | fails at `helpers.mjs:219`: the probe's reply is an asset and no refusal | as it says: "returns no refusal" |
| AC2 `#2044.039601da` | fails at `helpers.mjs:219`: no refusal, in a test of 10 ms | "returns no refusal", as it says; it doesn't loop 8,000,000,000 times, since `9b9532449` |
| AC3 `#2044.5bc09669` | fails at `helpers.mjs:229`: refused as `params/sha256: a byte stride under its element`, which names no accessor | not as it says: nothing reads 1,000,000 rows, since `9b9532449`. The test fails at the naming |
| AC4 `#2044.e7ef5233` | fails at `helpers.mjs:228`: the import returns no node and no refusal, after 5.2 s | as it says: "returns no refusal" |
| AC5 `#2044.57d379a6` | passes: the import is `importOf`'s value, value for value | as it says: the fixture imports |
| AC6 `#2044.19a0d966`, both tests | pass: the `x` is at row 24, column 80, alone on the 80 by 24 grid | not as it says: nothing panics, since `9b9532449` |
| AC7 `#2044.78e8c53e` | fails at `helpers.mjs:148`: the reader panicked at `svg.rs:340:38`, "end byte index 2 is not a char boundary" | as it says: "panics on the first" |

Each failure is node's `AssertionError`, its innermost frame in `helpers.mjs`, so `atAssertion` reads it as a failure
at its assertion; that is read from the script, since no lane was run. `BASE-FAILURE.txt` holds each failure's lines
and the times.

**This README against the run.** Every outcome in the table under "The merge base and the wrong programs" held.
`reader.rs` built in each of the four files, and no test read `BLOCKED` or `INCONCLUSIVE`. Each fixture passed its
test's check of what its criterion says of it. Criterion 5's expected value, worked out by hand, is what the base
returned. The three places where the base differs from the issue's sentences are the base's, each made by
`9b9532449`, and no test was changed for them.

**What the base run doesn't show.**

- **The twins.** None was laid, built or run. So no run yet shows a wrong program failing criterion 5's test
  (`mesh-used-twice`) or either of criterion 6's (`restore-unclamped`): those three tests have only been seen to
  pass. That is unrun, not proven. It is shown when each twin is laid over the program being judged and its test
  file run, as the proof lanes do (`scripts/proof-runs.mjs`). Criterion 3's test fails on the base at the naming;
  that it also fails on an importer that reads the 1,000,000 rows (`rows-by-count`) is unshown, and so is that
  `accessor.gltf` is otherwise a file the base imports, since the base stops at its stride.
- **Two of criterion 7's three readings.** The test ends at its first reader on the base, so the run doesn't show
  that `attribute-none.svg` imports there or that `attribute-onclick.svg` is refused as `svg_script` there. Both are
  read from the base's `import` and `scan` instead: no refusal is reached for the first file's bytes, and a name
  that starts with `on` in any case is `Refusal::Script`.
- **What a reader does inside.** The run shows no refusal for criteria 1 and 4. That the base sizes its table from
  the count and visits 16,777,215 nodes is read from its source; the run measured no memory and counted no visit.
- **A second run, and the lanes.** Each file ran once. No lane and no lint was run: `node_modules` is not installed
  in the job's checkout.
