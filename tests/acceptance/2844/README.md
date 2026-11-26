# Acceptance tests for #2844: shadows in a lit 2D group within budget, without changing a pixel

Written first, blind, from issue #2844 (its opening paragraph, scope, two acceptance criteria, Proof and "Runs on" line),
the design sections it links, and base commit `5fcfb690b` ("Merge pull request #3079 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
for each half of criterion 2, one wrong program laid over the tree for both, and for criterion 1 the test the issue
names, registered under this issue's ID and not written again.

Out of scope here, as the issue says: soft penumbras, another look for a shadow's edge, and #2031's own budget.

## What the base already does

Everything the criteria name is in the base: both suites, their planted programs and the budget's redraft. So the two
kinds of test here start from opposite sides.

- **Criterion 1** fails at the base on the reference Mac at rest (2.82 to 2.85 ms against 2), and is INCONCLUSIVE
  anywhere else.
- **Criterion 2** is a promise that nothing changes, so its tests hold at the base by construction: there the merge
  base is the base, and the two sides are one program built twice. A pass at the base proves nothing. What makes the
  tests count is the wrong programs below: nine that the suites draw themselves, and one laid over the tree.

## Criteria to tests

IDs are `#2844.` and the first 8 hex digits of SHA-256 of each criterion's text, as its `- [ ] ` line reads after that
prefix. Each test's name starts with `AC[n] #2844.<id>`, and the file that carries a criterion quotes it in full.

| ID | Criterion | Test file: what it asserts |
|---|---|---|
| `AC1 #2844.1a4ae9f6` | 1: 16 lights and 4,096 occluder segments at 1920 × 1080 under 2 ms of GPU time a frame | `ac1-budget.test.ts` (1, not its own): the one test of `../2032-redraft-ac8/ac8-budget.test.ts`, registered under this ID. Its fixture, warm-up, five runs with each run's loads and verdict are that file's. PASS passes, FAIL fails, anything else is INCONCLUSIVE |
| `AC2 #2844.11438f50` | 2, first half: every frame the two suites draw is byte-identical to the merge base | `ac2-frames.test.ts`, first test: for every call a file of the two suites makes to draw, without `--planted`, each picture, frame hash and refusal is the merge base's for the same request. Before that, the windows the suites draw under nine planted programs must each differ from the merge base's, two of them at a named frame |
| `AC2 #2844.11438f50` | 2, second half: both suites pass unchanged | `ac2-frames.test.ts`, second test: every file of the two folders and every helper they import holds the merge base's bytes, none added, none gone; and in a run of every test file of the two folders, each reports its tests and every judged test passed |

## Criterion 1: what this folder holds, and why

The issue's Proof names the test: `tests/acceptance/2032-redraft-ac8/ac8-budget.test.ts`. This job didn't edit it and
didn't write a second measurement. What it had to decide is whether #2844's first criterion is traced to that test as
the repo traces criteria. It is not, by the tag alone:

- A criterion's ID is `#<issue>.` and eight digits of its text's hash. The criterion's text is #2032's eighth,
  unchanged, so the digits are the same, `1a4ae9f6`, and the issue's number differs.
- The trace reads the number. `scripts/proof-runs.mjs` counts a test for the issue a change names only when its
  reported name holds a tag starting `#<that issue>.`, and `scripts/closed-sweep.mjs` holds a closed issue's criterion
  only when a test on main names its ID. The redraft's test is named `AC8 #2032.1a4ae9f6 …`.
- It keeps that name. #2032 says of the moved criterion: "Its text stays above unchanged, so its tests keep their tag."
  So the tag isn't moved, as #854's was for #896 (`tests/acceptance/854/AC1-MOVE.md`), and retagging would be an
  edit of an acceptance test, which is neither this job's nor the implementer's.

So with nothing here, `#2844.1a4ae9f6` has no test: the trace lists it open, and the sweep reopens #2844 after it
closes. `ac1-budget.test.ts` is the least that fixes it. It holds one `describe` named with this criterion's ID, and
inside it imports the redraft's file, so the runner registers the redraft's `describe`, hooks and test there. The test
is reported once, as
`AC1 #2844.1a4ae9f6 … › AC8 #2032.1a4ae9f6 the budget of … › AC8 #2032.1a4ae9f6 16 lights and … on the reference Mac`:
one test, both tags, one source.

What follows from that:

- **Its wrong program is the merge base.** It fails there at its own assertion (`FAIL: …`) on a reference Mac at
  rest, as `scripts/known-failures.json` records of the redraft.
- **Two runs where both files are selected.** A run that takes both this file and the redraft's measures twice, one
  after the other. Nothing in this folder can make that one run; taking the redraft out of a lane, or retagging it,
  is the owner's call.
- **It is timed.** See the `scripts/lanes.mjs` line below.
- **Its name, if it must be listed.** If this folder lands before the budget holds, the test fails on the reference
  Mac as the redraft does. Its full name is `tests/acceptance/2844/ac1-budget.test.ts › AC1 #2844.1a4ae9f6 the budget
  of 16 lights and 4,096 occluder segments, judged by #2032's redrafted criterion 8 ›` followed by the redraft's two
  names as `scripts/known-failures.json` holds them.

## How a frame is enumerated

The suites build their documents in code, inside their test files, so a list of frames written here could miss one.
Instead the suites list their own frames: `ac2-frames.test.ts` runs every test file the merge base holds under
`tests/acceptance/2031/` and `tests/acceptance/2032/` (17 at this base), unchanged, with the checkout's own vitest, one
file a process, and `recorder.mjs` stands where each file finds its binaries.

- **Where it stands.** Every file of the two suites builds what it drives with `cargo build --locked --bin <bin>` and
  copies it out of `$CARGO_TARGET_DIR/debug` (#467's `useBin`, #2031's `useMergeBase`). The inner run gets a target
  folder of its own and a `cargo` first on its PATH that is the recorder: it builds nothing and lays a stand-in for
  each binary named. A file has no other way to a binary, and a file none of whose calls was recorded fails the run.
- **What a stand-in does.** It runs the real binary with the same arguments, input and working folder, hands its
  output, its errors and its exit on untouched, and writes the call down. The real binaries are built once, by the
  test itself, with the suites' own command: the checkout's by `useBin`, the merge base's by `useMergeBase`.
- **The merge base's side.** For a call that draws (`deep-gpu run`, `deep-canvas-render raster`) by the checkout's
  binary, the stand-in also takes what the merge base's binary draws for the same request, without `--planted`. The
  suites' two AC7 files ask the merge base themselves, and that answer is the one used. Any other request the merge
  base draws once, when it is first asked; an answer is kept by the request's hash and read again for the same
  request, such as the planted run of a document just drawn. So each request is drawn once on each side.
- **A frame** is `png <SHA-256 of the file's bytes>` for every file in `out` the answer names (`window2d`'s `window`,
  each side and glyph run of `layers`, a film's captured frame) and for each `raster` picture; `pixel_hash <hash>`
  for each `pixel_hash` of a `film2d` frame; and `code <code> <path>` for each refusal. A run that exits other than
  0, or answers no JSON, is `failed`. A frame is named by its file, its place in the request, its call, its
  document's ID and its place in the answer:
  `tests/acceptance/2032/ac5-edge.test.ts: [0] window2d of shadow-edge: window`.
- **What is compared.** Calls without `--planted`: each frame against the merge base's frame of the same name.
- **What is not.** `check` and `path` draw nothing. A frame the suites draw with the merge base's own binaries is
  the other side already. A frame drawn under `--planted` is no frame of the right program.

What this changes about the suites' run, and nothing in their files: `cargo` isn't run again by each file; each call
goes through one more process, and waits for the merge base's draw where it wasn't asked yet; the two AC7 files find
the merge base's tree already exported (a link to the kept one); and a binary that hangs is stopped after 25 minutes,
not 30. No file's timing is judged here.

## Wrong programs

| Where | The wrong program | Where the tests fail |
|---|---|---|
| The suites' own planted runs, in every run of `ac2-frames.test.ts` | `deep-gpu run --planted` with `light_linear_falloff`, `light_encoded_sum`, `light_default_ambient_zero`, `light_every_child` (#2031) and `shadow_bounding_boxes`, `sun_far_point_light`, `shadow_inside_outline`, `shadow_removes_ambient`, `shadow_edge_aliased` (#2032), on the windows the suites draw under them | The comparison, run on them as on the right program's frames with the merge base drawing without the plant, must find a difference in each call; a plant none of whose windows is drawn, or whose windows compare as the merge base's, fails the first test. Two are held to their frame: `[0] window2d of shadow-edge: window, drawn under --planted shadow_edge_aliased` and `[0] window2d of lit-falloff: window, drawn under --planted light_linear_falloff` |
| `twins.json`, twin `default-ambient-zero` | The right program draws a lit group that leaves `ambient` out with ambient 0, as #2031's `light_default_ambient_zero` does, on every run: one line of the base's `crates/deep-canvas-marks/src/light.rs` (line 443, `=> AMBIENT,` to `=> 0.0,`) | First test, at its list of differing frames: the window of #2031's `lit-default` and the film hashes of `lit-budget` and of #2032's `shadow-budget`. Second test, at its list of failed tests: #2031's AC3 reads 0 where it holds 137 |
| The merge base | The shadow pass as #2825 left it | `ac1-budget.test.ts`, at the redraft's `FAIL:` |

Each planted window differs because the suites' own tests say so: each plant's test reads a pixel one way under the
plant and the right program's test reads it another (188 for 198, 255 for 188, 0 for 137, a darker badge, the other
answer at a named point, ambient at a wall's centre, no pixel strictly between). `film2d` under `light_stale_list` is
not held to differ: a sought frame may be right under it.

**How the twin is laid and built.** By the proof lanes (`scripts/proof-runs.mjs`, `twinsOf`): each file under
`twins/default-ambient-zero/` is copied over the same path in a copy of the change before its build, and the tagged
tests run there, building `deep-gpu` and `deep-canvas-render` from it as they build any checkout. By hand, in a scratch
copy of the tree: `cp tests/acceptance/2844/twins/default-ambient-zero/crates/deep-canvas-marks/src/light.rs
crates/deep-canvas-marks/src/light.rs`, then the run below. The twin is the base's whole file, 792 lines, with that one
line changed. Over a change that also edits `light.rs` it undoes that edit and may not build, which the lanes read as
BLOCKED or as a failure, never as a pass. `light.rs` is not among the files the issue's scope points the work at.

## Run them

```sh
npm ci                          # once, if node_modules is missing
# criterion 2
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2844/ac2-frames.test.ts
# criterion 1, on a reference Mac at rest
PATH=$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/2844/ac1-budget.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2844    # type-check
```

Run from the checkout's root, as above, so no tool's cache is left in this folder. The inner run always starts at the
root with the root's vitest config, whose test files are those under `tests/` from the root, so the merge base's
exported tree under the target folder holds none of them.

- **Lanes.** The folder runs alone by its own `lane.json`. The implementer adds one line to `scripts/lanes.mjs`; this
  README is the instruction, and this job edits nothing outside its folder.

  ```js
  // #2844's ac1 registers #2032's redrafted budget test under #2844's criterion: it builds deep-gpu, draws on Metal and
  // judges the shadows' GPU budget with each run's load.
  timed.push('tests/acceptance/2844/ac1-budget.test.ts');
  ```

  `ac2-frames.test.ts` reads no timing. Its run is far over two minutes; whether it joins `slow` is that list's own
  rule, by its recorded time.
- **Build.** `ac2-frames.test.ts` builds `deep-canvas-render` and `deep-gpu` in the checkout (`cargo build --locked
  --bin <bin>`, #467's `useBin`) and both at the merge base through #2031's `useMergeBase`, which keeps them under
  `<target>/acceptance-2031-base` for the next run at the same merge base and shares them with both suites' AC7. In a
  fresh worktree that is two cold builds of each binary, the checkout's and the merge base's, even where the two are
  one commit. The 17 files it runs build nothing. `ac1-budget.test.ts` builds `deep-gpu`, as the
  redraft does. A failed checkout build fails each test; a merge base that can't be exported or built is
  INCONCLUSIVE.
- **Platform.** The issue's "Runs on" line: "the reference Mac for the budget and the frames, INCONCLUSIVE elsewhere;
  Spark for the CPU tests". Both tests of criterion 2 need macOS's Metal device and fail `INCONCLUSIVE:` off it, where
  `deep-gpu` answers `unsupported_platform`, and where a test of the suites is itself INCONCLUSIVE; never passing.
  Criterion 1 is judged where the redraft judges it.
- **Time.** Not measured by this job. A run of `ac2-frames.test.ts` is the two suites' own run, their two AC7 files
  and two budget files included, plus the merge base's draw of each request the suites don't ask it themselves.
  #2031's AC7 alone was reported at about 500 s on this Mac, so expect well over ten minutes after the builds. The
  proof lanes stop a runner after 20 minutes (`scripts/proof-runs.mjs`) and read its files as not run.
- **Isolation.** The run's folder is under the OS temp folder (`deep-2844-suites-…`) and is removed at the end; the merge
  base's tree and build stay under the target folder, as the suites keep them.

## Readings where the issue and design leave a choice

- **"Every frame that the two suites draw"** is every frame, as defined above, of every call a test file of the two
  folders makes to the checkout's binaries without `--planted`. That takes in the documents each test draws beside
  its fixture (the same document with `occlude` off, with its `light` removed, with no lights), the unlit parity
  fixtures #2031's AC7 draws, and the films of the two budget files: the scene at the cap, 16 lights and 4,096
  occluder segments at 1920 × 1080, is drawn by `tests/acceptance/2032/ac8-budget.test.ts` and by no other file.
- **Frames drawn under `--planted`** are frames of wrong programs. They are not held to the merge base; they are what
  the comparison is shown failing on.
- **"Byte-identical"** is the SHA-256 of a picture's bytes, read from the file by the recorder and not from the
  name the binary gives it. A film's frame leaves the binary only as its `pixel_hash`, which is how the suites read
  it, so it compares by that. A refusal compares by code and path. Each layer's draw path, which the suites' AC7
  compare too, is not a frame and is left to them.
- **"The merge base"** is `git merge-base HEAD origin/main`, else `main`, exported and built by #2031's `useMergeBase`,
  as both suites' AC7 take it.
- **"Both suites"** are the test files under the two folders at the merge base. `tests/acceptance/2032-redraft-ac8/`
  is not one of the two: it is criterion 1's.
- **"Unchanged"** is against the merge base, not against this job's base: a file's bytes in the checkout are its bytes
  in the merge base's tree. It covers every file of the two folders, their READMEs and recorded runs too, and the
  helpers their TypeScript imports from other suites, followed to the end (`../467/helpers.ts`, `../465/helpers.ts`
  at this base). A file added to either folder is a change; what a tool leaves under `node_modules` is not. An
  approved change that reaches main moves with the merge base.
- **"Pass"** is: each test file reports its tests, and every judged test passed. A test of theirs that fails
  `INCONCLUSIVE:` makes the second test INCONCLUSIVE; any other failure, a skip or a test that didn't run fails it.
- **The two budget files** (`ac8-budget.test.ts` in each folder) are run, for their frames, and their tests are not
  judged, whatever they say; the outcome is printed. #2032's is this issue's criterion 1, judged by its redraft, and
  the lanes run that first draft by hand only (`scripts/lanes.mjs`, `redrafted`). #2031's is "not in this task". And
  neither can pass anywhere: both judge through #465's helper, which gives the lane's judge no loads, so both end
  INCONCLUSIVE on every machine (`../2032-redraft-ac8/README.md`, Why). A reading that held them to "pass" could
  never be met. If one of them fails before it draws, its frames are missing or `failed`, and the first test fails.
- **The first test and the suites' tests.** If no drawn frame differs but a judged test of the suites didn't pass,
  the frames that test draws may be missing, so the first test is INCONCLUSIVE, never PASS.
- **"The reference Mac for the frames"** is read as the suites read it: macOS's Metal device. The tests don't ask
  which Mac.
- **"Spark for the CPU tests".** This suite has none of its own. The suites' CPU checks (their f64 fixtures, their
  refusals) run inside the run of criterion 2, which needs Metal, so on Spark both of its tests are INCONCLUSIVE.

## Left open by the issue and the design

Each is read above; none is decided by the text alone, and a dispute goes to a blind redraft.

- **Whether "both suites pass" takes in their two budget tests.** Read as no, for the reasons above.
- **Whether a film's frames count as frames.** Read as yes, by `pixel_hash`.
- **Whether "unchanged" takes in a suite's README and recorded base run.** Read as yes: every file of the folder.
- **How criterion 1 is traced.** By a second name for the redraft's test, registered here, since its tag stays.

## Not asserted, because no criterion says so

The implementer owes these a mapping or a note (AGENTS.md: review requirement → change → proof):

- A layer's draw path, and the answers of `check` and `path`, against the merge base's. The suites hold what they hold.
- Frames under a planted program against the merge base's frames under the same plant: a plant's own pixels may move.
- Any frame the two suites don't draw: other suites' lit documents (#2053's, #2054's), a sun beside point lights, a
  curved occluder, shadows on Vello CPU.
- The CPU f64 segment test and each light's bins (`crates/deep-canvas-marks`) by a test of their own.
- Any time but criterion 1's, and where in the pass the time goes.

## What was read

- The issue, live (`gh issue view 2844`): it reads as the brief gave it. #2032, live: its criteria and its note on the
  moved budget.
- `docs/technical-design.md`: 2D marks and paint; Dogfooding; Tests written first; Criteria to tests, both ways;
  Closed issues stay proven; Wrong programs; the parity suite and reftests. `docs/canvas-primitives.md`: Frame and
  group `frame@1`, `group@1`; Path `path@1`. `docs/parallel-proof.md`: sections 5 to 7a and 12a.
- At the base, only to learn how surfaces are driven: AGENTS.md; `tests/acceptance/2031/`, `2032/` and
  `2032-redraft-ac8/` (README, helpers, every test, BASE-FAILURE.txt); the helpers of `467/` and `465/`;
  `1297-redraft-2047/` (a suite that runs other suites unchanged, and its twins); `854/AC1-MOVE.md`;
  `scripts/{lanes,proof,proof-change,proof-runs,proof-guard,closed-sweep,known-failures-check,size-ratchet}.mjs`,
  `scripts/known-failures.json`, `vitest.config.ts`, `tests/vitest-setup.ts`; `crates/deep-gpu-layer/src/{main,film}.rs`
  (the planted names, a film's reply), `crates/deep-groups-render/src/lightfx.rs` (which plants reach the light pass)
  and `crates/deep-canvas-marks/src/light.rs` (the default ambient). No expected value comes from them.

## What was run, and what was not

Not run, by instruction (a shared, loaded Mac): cargo, any build, any draw on the GPU, the two suites, the redraft,
and so neither test file of this folder against the real binaries. The twin was not built. The proof lanes
(`scripts/proof.mjs`) and `scripts/affected.mjs` were not run. The repository's own vitest config was not loaded: this
job's worktree was installed with `npm ci --ignore-scripts`, which builds no package, and the config needs them built.
No base run is recorded here: the lead records it.

Run:

- `node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2844`: exit 0. `node --check recorder.mjs`: exit 0.
- The twin against the base's file: `diff` shows line 443 alone.
- **The harness, on stand-ins.** In a scratch repository of its own under `target/`, with the base's real helpers of
  `467/`, `465/`, `2031/` and `2032/`, this folder's `helpers.ts`, `recorder.mjs` and `ac2-frames.test.ts` as they
  are, nine stand-in suite files that drive those helpers (windows, films, `framesOf` on both sides, `check`, `path`,
  all nine plants, two budget files that end INCONCLUSIVE), stand-in `deep-gpu` and `deep-canvas-render` that write
  real PNGs from a hash of the request, and a stand-in `cargo` that copies them out of the tree it is run in:
  - at the scratch base both tests pass: 10 drawing calls, 38 frames, 30 of them pictures or hashes, none differing;
    the merge base drew 8 requests for the comparison and the stand-in AC7 asked it the rest; 9 planted calls, all
    caught; the outer `cargo` ran three times, and none of the nine files' builds reached it;
  - a checkout whose binary draws another pixel in three documents: the first test fails, naming the five frames;
    the second passes;
  - a checkout whose plants draw as the right program: the first test fails, naming the nine plants;
  - a suite file edited and a file added: the second test fails, naming both; the first passes;
  - a suite test that fails: the second test fails, naming it; the first is INCONCLUSIVE;
  - `unsupported_platform` from the checkout's binary: both tests are INCONCLUSIVE;
  - a checkout whose binary exits 101 on the budget file's document: the first test fails, naming its frames.
  It also showed that vitest takes a file's path as a filter: with a config that takes test files from anywhere, the
  same file in the merge base's exported tree ran too. The repository's config doesn't, and a run that reports
  another file fails the run.
- **The recorder alone.** A stand-in binary's 6 MB answer to an 8 MB request, its 200 KB of errors, an exit of 7 and
  an end by SIGABRT each reach the caller through the recorder as they do without it. The recorder's `cargo` refuses
  another binary's name, another target folder and `cargo metadata`, each with exit 101.
- **The second name.** With two stand-in files, vitest 5.0.5 reports a test imported inside a `describe` under that
  `describe`'s name with its own hooks run, passing and failing as the imported test does.
- **The lanes' reader.** `scripts/proof-change.mjs`'s `spans` reads both test files' names, and `tagsWithImports` finds
  `#2844.1a4ae9f6` in the first and `#2844.11438f50` in the second; the twin's file is outside the test paths, as a
  twin must be.
