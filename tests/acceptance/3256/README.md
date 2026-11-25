# #3256 acceptance tests: a struct the renderer writes and a shader reads has one layout

Written blind at the base `303bb6d73` (main, whose last merge is #3331), from issue #3256 (its opening paragraph, its
Scope, its `Runs on:` line, its seven criteria and its Proof line), the design and that base. The job saw no
implementation: it read no pull request, no other branch, worktree or commit after the base, and no notes folder. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- **The issue**, #3256, as saved for this job; it has no comments. The issues it names (#310, #78, #140, #380) were
  not read: none has a suite these criteria read.
- **The design.** `docs/technical-design.md`: Built to be hard to get wrong; Criteria to tests, Closed issues stay
  proven, Criteria in a checked shape, Wrong programs, The edit guard, Dogfooding; Every task carries its own budgets,
  The reference Macs. `docs/canvas-primitives.md`: The trusted compositor; Compile, validate and cache.
  `docs/parallel-proof.md`, sections 5 to 7. `AGENTS.md`, `CONTRIBUTING.md`.
- **The base, for names and shapes only.** `crates/deep-scene3d-render/src/`: `lib.rs` (`SHADER`, `shader`,
  `FrameUniform`, `SolidRecord` and the other records, `SOLID` and the other attribute lists, `mesh_buffers`), `ao.rs`
  (`AoUniform`, `shader`, where the uniform is written), `scene3d.wgsl` (`Frame`, `Element`, `mesh_vs`), `ao.wgsl`,
  `ao_shade.wgsl`, `print.rs`, `print.wgsl`, `planted.rs`, `sss.rs`, `op.rs`, and the three crates' manifests;
  `crates/deep-gpu-layer/src/` (`regions.rs`, `scene.rs`, their shaders); `crates/deep-groups-render/src/`
  (`indexed.rs`, `read.rs`, `lib.rs`, the shaders); `crates/deep-canvas-scene3d/src/` (`look.rs`'s `Ao`, `cut.rs`'s
  `MAX_PLANES`); `crates/deep-gpu/src/device.rs`. `scripts/`: `lanes.mjs` (`cargoResults`, `crates`, the unit lane,
  `stateOf`), `lanes-lists.mjs` (`timed`, a suite's lane file), `proof-change.mjs` (`criterionId`, `tagsIn`,
  `isTestFile`, `spans`), `proof-runs.mjs` (`twinsOf`, `twinOverlay`, `prepareRuns`, `before`, `atAssertion`),
  `twins-lint.mjs`, `alone-lint.mjs`, `wait-ratchet.mjs`, `repo-rules.mjs`, `benchmark.mjs` (`judgeLimit`,
  `fingerprint`), `throttle.mjs`. The suites `tests/acceptance/3171/` (the house form these tests follow: node tests
  that run a crate's `cargo test` and read it with `cargoResults`), `2657/`, `3016/`, `1636/` (a budget held with
  `judgeLimit`), `1523/`, `2694/` and `1832/` (twins and the line form).

## Run them

```sh
node --test tests/acceptance/3256/layout.test.mjs       # criteria 1 to 6
node --test tests/acceptance/3256/ac7-budget.test.mjs   # criterion 7, a timed file
```

Node 24 and the Rust toolchain of `rust-toolchain.toml` (`cargo` on PATH, or in `~/.cargo/bin`), and `node_modules`
(`npm ci`): the helper imports `scripts/lanes.mjs`. No package build (`npm run build`) is needed, and no GPU: the
lane parses shaders and reads struct layouts (`Runs on:` any machine). The helper gives cargo `CARGO_INCREMENTAL=0`
and `CARGO_PROFILE_DEV_DEBUG=0` unless the caller's environment sets them. Nothing is written in the checkout but
cargo's `target/`; each cargo call's output goes to a temporary folder that is removed.

Every cargo call names the three crates together, so its units are those of
`cargo test --locked --no-run -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render`:

| Call | Made by | What it runs |
|---|---|---|
| `cargo test --locked -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render --lib --bins --tests --no-fail-fast -- shader_layout --show-output` | every test, once a file; `ac7-budget.test.mjs` six times where a time can count | the lane: the three crates' unit and integration test targets, the tests with `shader_layout` in their names alone |
| `cargo test --locked -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render --test acceptance_3256_twin_shaders --no-fail-fast -- --show-output` | criterion 2's test | this suite's own Rust target (`twin_shaders.rs`) |
| `cargo test --locked -p deep-scene3d-render -p deep-gpu-layer -p deep-groups-render --features deep-groups-render/plant-3256-host-sizes --lib --no-fail-fast -- shader_layout --show-output` | criterion 4's test | the lane in `deep-scene3d-render`'s and `deep-groups-render`'s library tests, the second built with the planted comparison |
| `cargo metadata --no-deps --format-version 1 --offline` | `scripts/lanes.mjs`'s `crates`, once a file | the workspace's targets, which name each test |

With the targets built, a call is cargo's own check that they are fresh and one start of each test target; the third
compiles `deep-groups-render`'s library tests once more, with the feature (and whatever crate the feature is passed
on to, which is why it should stay inside that crate's test code). The first build of the three crates' test targets
is cargo's and takes many minutes; no time is read from it. That is how the calls are written, not something seen:
no cargo call of the suite ran at the base. What was run there, and what was not and why, is in `BASE-FAILURE.txt`.

**Lane needs.** `lane.json` puts the folder in the alone block (`timing`): `ac7-budget.test.mjs` holds a time with
`judgeLimit`, and both files start `cargo test` in the checkout's `target/`. `ac7-budget.test.mjs` belongs on the
timed list (below, What the implementer adds).

## The surface under test

The issue names the surface in words: "the crate's unit lane gets a test", "the lane prints both lists and the pairs
it compared", a pair "fails, naming" its fields. It gives no test name, no line and no message. **Every name in this
section is this job's**; each is the least its criterion needs to be read, and the tests spell and read them exactly
as written here. Nothing else is asked of the implementation: how a host struct names its shader struct "once, beside
its definition", where the comparison lives, and how many tests the lane has are the implementer's.

### 1. The lane: `shader_layout`

Every test of the lane, in each of the three crates, has `shader_layout` in its name (a module or a function, as in
`shader_layout::frame_uniform` or `ao::tests::shader_layout_ao`), and no other test of the three crates has. The
lane's tests are unit tests of their crate, so `cargo test -p <crate>` and the workspace's unit lane run them.

### 2. The lines the lane prints

Each on a line of its own in a lane test's output (`println!`; the tests read it with `--show-output`). `<host>` is a
`#[repr(C)]` struct as `<path of its .rs file from the checkout's root>:<Name>` (what `file!()` gives, then the
struct's name). `<shader>` is a shader struct as `<file>#<Name>`, `<file>` any path that ends in the name of the file
that declares the struct (`scene3d.wgsl`, `src/scene3d.wgsl`; for shader text in a Rust string, the `.rs` file).

| Line | Says | One example |
|---|---|---|
| `layout pair <host> = <shader>: <field>@<offset> … ; <size> bytes` | the lane compared the two and they agree: each field compared, in order, with the byte offset both sides have (a renamed field once, by either name; a padding field not at all), then the size both have. A pair that differs prints no such line | `layout pair crates/deep-scene3d-render/src/lib.rs:FrameUniform = scene3d.wgsl#Frame: clip@0 right@64 up@80 viewport@96 light@112 px@128 sky_top@144 sky_low@160 inverse_clip@176 eye@240 cut@256 cut_info@320 cap@336; 352 bytes` |
| `layout record <host> = <LIST>` (anything may follow `<LIST>` after a space or a mark) | the lane held the record three ways: its fields against the attribute list `<LIST>`'s offsets and formats, and each attribute's location against the shader input there, and they agree | `layout record crates/deep-scene3d-render/src/lib.rs:SolidRecord = SOLID` |
| `layout differs <host> = <shader>: <message>` | the lane compared a pair that is there to differ, and `<message>` is what the comparison says of it, on one line. Only criterion 4's second pair has one | `layout differs crates/deep-groups-render/src/indexed.rs:OffsetsDiffer3256 = indexed.rs#OffsetsDiffer3256: field b: host offset 12, shader offset 16` |
| `layout host-only <host>: <reason>` | the host-only list: a `#[repr(C)]` struct no shader reads, with its reason | `layout host-only crates/deep-scene3d-render/src/fill.rs:Record: read back from the GPU as bytes, never bound` |
| `layout gpu-only <shader>: <reason>` | the second list: a shader struct bound as `var<uniform>` or `var<storage>` that no host struct names, with its reason | `layout gpu-only exposure.wgsl#Partial: written by the reduction pass alone` |

The examples' reasons, and which structs stand on which list, are made up; the first example's numbers are derived
below. A struct may have several lines (a host struct compared with a shader struct two modules declare; a record
held against more than one vertex stage), and a line printed twice counts once. A line that starts `layout pair `,
`layout record `, `layout differs `, `layout host-only ` or `layout gpu-only ` and doesn't read as above fails
criteria 1 and 6.

### 3. What a failure names

A pair or a record that differs fails a lane test, and the failed test's own message names the words below, each as a
word of its own (`Frame` is not in `FrameUniform`, `144` is in `sky_top@144`). The message is what libtest prints
under `---- <test> stdout ----` for that test, what it printed and its panic's message alike, less the lines of the
listing, the line that says where it panicked (a file, a line and a column) and libtest's note. The tests run cargo
with `RUST_BACKTRACE=0`, so no numbered frame is in it.

| The wrong program | The message names |
|---|---|
| `scene3d.wgsl` with `sky_top` and `sky_low` swapped in `Frame` | `FrameUniform`, `Frame`, `sky_top`, `sky_low`, `144` and `160` |
| `AoUniform` with `opts` typed `[f32; 4]` | `AoUniform`, `opts`, `f32` and `u32` |
| `AoUniform` with one more field at its end | `AoUniform`, `208` and `224` |
| `SolidRecord` with `base` and `surface` swapped | `SolidRecord`, `10`, `11`, `base` and `surface` |
| a new `#[repr(C)]` struct `Unlisted3256` with neither a pair nor a reason | `Unlisted3256` |
| a new `var<uniform>` struct `Unnamed3256` no host struct names | `Unnamed3256` |

Nothing else of a message is read: not its wording, and not which test it comes from.

### 4. Criterion 4's two small pairs and its planted comparison

In `deep-groups-render`'s test code (`#[cfg(test)]`; no shipped build holds them), declared in plain text under its
`src/` (a `.rs` or `.wgsl` file; not inside a `format!` template, whose doubled braces the test can't read):

- `OffsetsAgree3256`: a `#[repr(C)]` host struct `{ a: [f32; 3], b: f32 }` and a shader struct of the same name
  `{ a: vec3<f32>, b: f32 }`. It is a pair like any other, and its line reads `… a@0 b@12; 16 bytes`.
- `OffsetsDiffer3256`: a `#[repr(C)]` host struct `{ a: [f32; 3], b: [f32; 3] }` and a shader struct of the same name
  `{ a: vec3<f32>, b: vec3<f32> }`. A `shader_layout` test runs the lane's own comparison on it, prints the
  `layout differs` line with the comparison's message, which names `b`, `12` and `16`, and fails, naming
  `OffsetsDiffer3256`, if the comparison passes it.
- **The feature `plant-3256-host-sizes` of `deep-groups-render`** (`[features]`, `plant-3256-host-sizes = []`): the
  planted comparison. With it, the comparison takes the shader side's offsets and size from the host: a shader
  field's offset is the sum of the sizes of the host fields before it, and the shader struct's size is the sum of all
  of them. Nothing else changes: the names, the order, the types, the count of fields and every line it prints are
  the shipped comparison's. Without it, nothing differs from the shipped build, and a release build refuses to compile
  it (design: Wrong programs). So with it `OffsetsAgree3256` still passes at 0 and 12, `OffsetsDiffer3256` passes
  (12 against 12, 24 bytes against 24) and the test that expects it to differ fails.

### 5. This suite's own Rust target

`twin_shaders.rs` is an integration test of `deep-scene3d-render` (naga and serde_json are its dev-dependencies). It
links nothing of the crate: it reads `lib.rs`'s `const SHADER: &str = concat!(include_str!("…"), …);` for the scene
module's files and their order, `scene3d.wgsl`, and this folder's `twins/frame-fields-swapped/lines.json`.

### 6. What the suite reads of the source itself

Criteria 1 and 6 hold the lane's lists to the source, read by the suite and not by the lane (`helpers.mjs`:
`hostStructs`, `uniformStructs`; the rules are under "How each criterion is read"). Two things follow for the work.
Test code under `src/` counts: a `#[repr(C)]` struct there wants a line, and so does a struct that a fixture shader
there binds as `var<uniform>` and declares. And a `<host>` is spelled with the path of the file that holds the
struct's `#[repr(C)]`, a `<shader>` with the name of the file that holds its `struct` line.

## Criteria to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, checked against the issue's body. Each test's name starts with
`AC<n> #3256.<id>`.

| ID | Test | What it asserts on the shipped program | Wrong programs it fails on |
|---|---|---|---|
| AC1 `#3256.b135fea1` | `layout.test.mjs` | The lane is there and no test of it fails; it prints at least one `layout pair` line; every `#[repr(C)]` struct this suite finds in the three crates' `src/` (44 at the base: 39, 3 and 2) has a `pair`, `record` or `differs` line or a `host-only` line with a reason. It states the counts | The base (no lane). Every twin: a pair fails, or a struct is neither compared nor listed |
| AC2 `#3256.7baa6339` | `layout.test.mjs` | A `layout pair` line for `crates/deep-scene3d-render/src/lib.rs:FrameUniform = scene3d.wgsl#Frame`, and each such line with 13 fields, `sky_top@144`, `sky_low@160` and 352 bytes. `twin_shaders.rs` passes: naga parses and validates the scene module with the two fields swapped, its `Frame` is 352 bytes, `FrameUniform`'s size, with `sky_low` at 144 and `sky_top` at 160 | The base. The twin `frame-fields-swapped`: the lane fails naming `FrameUniform`, `Frame`, `sky_top`, `sky_low`, 144 and 160, and the failure states that naga validated the swapped module at 352 bytes |
| AC3 `#3256.3bfcdd46` | `layout.test.mjs` | At least one `layout pair` line for `crates/deep-scene3d-render/src/ao.rs:AoUniform` with `ao.wgsl#Ao` or `ao_shade.wgsl#Ao`, each with `opts@144` and 208 bytes | The base. The twins `ao-opts-retyped` (the lane fails naming `opts`, `f32` and `u32`) and `ao-field-added` (naming 208 and 224) |
| AC4 `#3256.d9954e62` | `layout.test.mjs` | `deep-groups-render`'s source declares the two small pairs as the criterion gives them. A `layout pair` line for `OffsetsAgree3256` with exactly `a@0 b@12` and 16 bytes; no `layout pair` line for `OffsetsDiffer3256`; a `layout differs` line for it whose message names `b`, `12` and `16`. Then the same lane built with `plant-3256-host-sizes`: it runs, `OffsetsAgree3256` still reads `a@0 b@12`, a lane test fails naming `OffsetsDiffer3256`, and this test's own judge fails on that run | The base. The planted comparison, which the test runs itself |
| AC5 `#3256.6145ab27` | `layout.test.mjs` | A `layout record` line for `crates/deep-scene3d-render/src/lib.rs:SolidRecord` with the list `SOLID` | The base. The twin `solid-fields-swapped`: the lane fails naming `SolidRecord`, 10, 11, `base` and `surface` |
| AC6 `#3256.57afe6d0` | `layout.test.mjs` | Every `#[repr(C)]` struct of the source is compared or on the host-only list with its reason, and every shader struct the three crates bind as `var<uniform>` and declare (39 at the base: 30, 2 and 7) is named by a `pair` or `differs` line or on the gpu-only list with its reason: a struct the suite finds and the lane neither holds nor names in a failure is one the lane should have failed on | The base. The twins `host-struct-unlisted` (the lane fails naming `Unlisted3256`, or the test finds it unlisted) and `uniform-struct-unnamed` (`Unnamed3256`) |
| AC7 `#3256.029810e0` | `ac7-budget.test.mjs` | The lane is there and passes. Then, where a time can count, five runs after a warm-up: what libtest reports for the lane's tests, summed over a run's targets, is within 5,000 ms in all five | The base. A lane whose tests take more than 5 s on a reference Mac at rest |

On a wrong program a test fails at its assertion and its message carries the lane's own. Before that, it holds the
lane's message to the words of "What a failure names": a lane that fails without them fails the test with a message
that says which words are missing, so a person reading the failure (the Proof's "each twin shown failing with its
message") can tell the two apart.

Where the numbers come from, by hand, from the shader language's layout rules (`f32` and `u32`: align 4, size 4;
`vec3<f32>`: align 16, size 12; `vec4<f32>` and `vec4<u32>`: align 16, size 16; `mat4x4<f32>`: align 16, size 64; an
`array<vec4<f32>, 4>`: stride 16, size 64; a struct: its largest member's alignment, its size rounded up to it) and the
Rust structs at the base (every field an array of `f32` or `u32`, so `#[repr(C)]` pads nothing):

- `Frame` and `FrameUniform`: clip 0, right 64, up 80, viewport 96, light 112, px 128, sky_top 144, sky_low 160,
  inverse_clip 176, eye 240, cut 256 (`cut::MAX_PLANES` is 4), cut_info 320, cap 336; 352 bytes.
- `Ao` and `AoUniform`: clip 0, inv 64, size 128, opts 144, scale 160, contact 176, steps 192; 208 bytes. One more
  `[f32; 4]` at the host's end: 224.
- `SolidRecord`: rows 0, color 48, pick 52, flags 56, tie 60, emission 64, base 80, surface 96, specular 112, op 128.
  `SOLID`'s formats put location 10 at byte 80 and 11 at 96, and `mesh_vs`'s inputs there are `base` and `surface`.
- A host `[f32; 3]` then `f32`: 0 and 12, 16 bytes; `vec3<f32>` then `f32`: 0 and 12, 16 bytes. A host `[f32; 3]` then
  `[f32; 3]`: 0 and 12, 24 bytes; two `vec3<f32>`: 0 and 16, 32 bytes.

## How each criterion is read

- **"The crate's unit lane", "the three crates' unit lanes".** `cargo test` of the crate, as `scripts/affected.mjs`
  runs one and the workspace's unit lane runs all. The tests run the three crates in one call, and only the unit and
  integration targets (`--lib --bins --tests`): doc tests can't see a private struct. **"The lane"** is the tests
  those targets hold with `shader_layout` in their names.
- **"The lane prints".** What a lane test writes to its output, which reaches a reader as cargo passes it on: the
  tests ask for it with `--show-output`. `cargoResults` (`scripts/lanes.mjs`) reads which tests passed and failed and
  in what state, as the lanes do. It keeps one line of a failure and nothing a test printed, so the suite takes two
  more readings from the same output: each test's block under `---- <test> stdout ----` (the listing's lines from
  every block; a failed test's message from its own, as "What a failure names" gives it), and each target's
  `test result: …; finished in <s>s`.
- **AC1, "Every pair on main passes, or the PR lists each pair that differs on the merge base".** The Scope gives each
  such pair its fix, so on the change no pair differs: the test holds that no lane test fails. The list itself, with
  the field, both offsets and the fix, and whether a fix changes a drawn frame, is in a pull request, where no test
  reads it: it is the Proof's.
- **AC1 and AC6, "every `#[repr(C)]` struct of the three crates".** The suite's own reading of the source, never the
  lane's: every `.rs` file under `crates/<crate>/src/`, each `#[repr(C)]` or `#[repr(C, …)]` attribute at a line's
  start, passed over the attributes, comments and blank lines after it to a `struct`. Test code counts (so criterion
  4's two structs do); an enum or a union doesn't; `crates/<crate>/tests/` and `build.rs` aren't the crate's source.
- **AC1, "is a pair".** A record held three ways and criterion 4's pair that is there to differ are compared, so a
  `record` or `differs` line counts as a `pair` line does.
- **AC2, "naming … both fields and their offsets".** The two fields are `sky_top` and `sky_low` and their offsets are
  144 and 160, whichever side holds which. A message that gives the first place the two sides part (one name each, 144
  twice) names one offset, not theirs.
- **AC2, "naga validates the twin and its `Frame` is the size `FrameUniform` is … and the test shows both".** Shown by
  the suite itself, on every run, not taken from the lane: `twin_shaders.rs` lays the twin's lines over the checkout's
  `scene3d.wgsl`, joins the scene module, and has naga parse it, validate it (every validation flag, every capability:
  what a device could accept) and lay out `Frame`. `FrameUniform` is private, so its size is the 352 derived above;
  the same test checks naga's layout of the unswapped `Frame` against the same derivation.
- **AC3, "naming the field and both types".** The two types are `[f32; 4]` and `vec4<u32>`; a message names them when
  it holds `f32` and `u32`, which both spellings do. How a shape is spelled past that is not read.
- **AC3, the shader's `Ao`.** The shader declares it in `ao.wgsl` and in `ao_shade.wgsl`. A pair line with either
  holds criterion 3; criterion 6 wants both named or listed.
- **AC4.** The criterion names two small pairs that are in no crate, a passing and a failing comparison of them, and a
  planted comparison that "fails this test". They are read as part of the lane (section 4 above), in the smallest of
  the three crates, so the planted build compiles one test target. "This test" is this suite's test of criterion 4: it
  runs the planted build and asserts that its own judge fails there.
- **AC5, "naming locations 10 and 11".** The numbers `10` and `11` as words of their own, with both names. The word
  "location" is not asked for.
- **AC6, "a new `var<uniform>` struct no host struct names".** A shader struct is found by the suite as a binding
  `var<uniform> <name>: <Struct>` (or an array of it) in a `.wgsl` or `.rs` file under a crate's `src/`, `//` comments
  out, whose `struct <Struct> {` the same file declares, or else some file of that crate. `OpFrame`, bound in `op.rs`
  and declared by the core's emitter outside the three crates, is in no file of them and is left out.
- **AC7.** Below, under Not asserted and in the test's header.

## The wrong programs

The criteria name seven. Six stand on the base's own files and are twins in the line form (`twins.json`,
`twins/<name>/lines.json`: `scripts/proof-runs.mjs`, `twinOverlay`; `tests/acceptance/1832/README.md`, The line form).
Each is one place changed, marked `#3256's planted wrong program`. The seventh is a wrong comparison, which the base
doesn't have: the build feature of section 4.

| Criterion | Wrong program | What it changes | Fails |
|---|---|---|---|
| AC2 | twin `frame-fields-swapped` | `crates/deep-scene3d-render/src/scene3d.wgsl`: `sky_top` and `sky_low` change places in `Frame` | AC1, AC2 |
| AC3 | twin `ao-opts-retyped` | `crates/deep-scene3d-render/src/ao.rs`: `AoUniform`'s `opts` is `[f32; 4]`, and the one place that writes it gives `f32`s | AC1, AC3 |
| AC3 | twin `ao-field-added` | `ao.rs`: `AoUniform` ends in one more field, `more: [f32; 4]`, written as zeros | AC1, AC3 |
| AC5 | twin `solid-fields-swapped` | `crates/deep-scene3d-render/src/lib.rs`: `base` and `surface` change places in `SolidRecord`; `SOLID` and `mesh_vs` are untouched | AC1, AC5 |
| AC6 | twin `host-struct-unlisted` | `crates/deep-groups-render/src/read.rs`: a new `#[repr(C)] struct Unlisted3256 { a: [f32; 4] }` | AC1, AC6 |
| AC6 | twin `uniform-struct-unnamed` | `crates/deep-scene3d-render/src/print.wgsl`: a new `struct Unnamed3256 { v: vec4<f32> }` bound at group 0, binding 8, which no entry point reads | AC1, AC6 |
| AC4 | feature `plant-3256-host-sizes` | the comparison sums host sizes for the shader's offsets and size (section 4) | AC4, inside the test |

**How each is reached.** The feature: criterion 4's test builds and runs it on every run. A twin: the before lane lays
it over the change for a test that didn't fail on the merge base. Every test here fails on the merge base, where the
lane isn't there, so that lane has no need to lay one; the Proof asks for "each twin shown failing with its message",
which is a run by hand: in a scratch copy of the change, put each edit's `wrong` lines in place of its `find` lines,
run `node --test tests/acceptance/3256/layout.test.mjs` there unchanged, and keep the failing tests' messages.

**What a twin's run reads.** Its criterion's test fails, and the first line of its message says how. Any other
outcome is not the failure the criterion asks for: a test that passes on its twin met a lane blind to it.

| Twin | Its test's message starts | A lane that fails without the names starts |
|---|---|---|
| `frame-fields-swapped` | `the lane fails the pair FrameUniform = scene3d.wgsl#Frame, naming sky_top and sky_low and their offsets 144 and 160:` and ends with what `twin_shaders.rs` showed | `the lane fails FrameUniform without naming the pair, both fields and their offsets` |
| `ao-opts-retyped` | `the lane fails AoUniform, naming the field opts and both types, f32 and u32:` | `the lane fails AoUniform without naming the field and both types (opts, f32, u32) or both sizes (208, 224)` |
| `ao-field-added` | `the lane fails AoUniform, naming both sizes, 208 and 224:` | the same |
| `solid-fields-swapped` | `the lane fails SolidRecord, naming locations 10 and 11 and the names base and surface:` | `the lane fails SolidRecord without naming locations 10 and 11 and both names, base and surface` |
| `host-struct-unlisted` | `the lane fails, naming the new struct Unlisted3256, which has neither a pair nor a reason:` | `a #[repr(C)] struct with neither a pair nor a reason fails the lane, naming it; the lane fails, without naming it` (or `; the lane passes`) |
| `uniform-struct-unnamed` | `the lane fails, naming the new struct Unnamed3256, which has neither a pair nor a reason:` | `a var<uniform> struct no host struct names fails the lane, naming it; the lane fails, without naming it` (or `; the lane passes`) |

**At the base.** Every edit of every twin matches the base's file at exactly one place (checked by this job with the
lane's own rule). The two shader twins are valid shaders there: naga parses and validates the scene module with
`frame-fields-swapped` laid (`twin_shaders.rs`, built by hand) and `print.wgsl` with `uniform-struct-unnamed` laid (a
probe); both are in `BASE-FAILURE.txt`. They change no expression: a struct's members are read by name, and the new
uniform is read by nothing, so no pipeline asks a layout for it. No crate was built with a twin laid: that compiles
the crate again, which this job's machine queue didn't allow, and at the base a test would fail for the lane's
absence either way. Why the four Rust twins should build: the record and uniform structs are written by name in one
struct literal each, so a swap needs no other edit, `ao-opts-retyped` changes that literal's four values to `f32` and
`ao-field-added` adds its field there; `Unlisted3256` is a struct nothing uses, under `#[allow(dead_code)]`.

**When the work changes a file a twin edits.** The lines are laid over the file as the change holds it, so the work's
own lines beside a struct stay. If the work changes a line an edit finds, so that it matches nowhere or twice, the
lane reads the twin as stale (BLOCKED). Then the implementer may rewrite that one edit: its `find` to the lines the
change holds at the same place, its `wrong` to the same one-place change (the same two fields swapped, the same field
retyped, the same field or struct added), at the path the struct now lives at. The twin's name, `twins.json`, the
planted names `Unlisted3256` and `Unnamed3256` and the tests stay as they are; `twin_shaders.rs` reads
`frame-fields-swapped`'s lines from the same file. Anything more goes to a blind redraft.

## Not asserted

- **The pull request's list** (criterion 1's second arm; the Scope's "each pair that differs on the merge base is
  listed in the PR with its fix, and a fix that changes a drawn frame says so"): a pull request's text, which is the
  Proof's.
- **Which structs are pairs and which are host-only**, past the three the issue names (`FrameUniform`, `AoUniform`,
  `SolidRecord`): the issue compared no other pair, so a reason on the host-only or the gpu-only list is read only
  for being there.
- **The rule a pair agrees by, field by field, for every pair** (the Scope's second and third lines: names, order,
  shapes, renames, padding): the criteria hold it where they name a wrong program (an order, a type, a size, an
  offset, a location). That a rename is allowed only where the pair lists it, and that a padding field names no
  shader field, have no criterion.
- **Where the host's offsets come from** (`offset_of!`, `size_of`) and that naga's layout is asked: criterion 4 holds
  the outcome (12 against 16), not the call.
- **The other records** (`SEGMENT`, `LINE`, `POINT`, `TEXT`, `PUFF`, `INSTANCE`) held three ways: criterion 5 names
  `SolidRecord` alone. They are `#[repr(C)]` structs, so criterion 1 wants each compared or listed.
- **`var<storage>` structs** named or listed: the Scope closes coverage for them, and criterion 6 names `var<uniform>`
  alone. The gpu-only list is read for the `var<uniform>` structs.
- **That one line beside a struct's definition is all a pair costs** (the Scope's first line): no criterion reads the
  source's form.
- **The Scope's "Not in this task"** (flag constants, generating a side, bind group layouts, texture formats and
  pipeline state, `deep-effects-render` and `deep-gpu`): nothing here reads them.
- **AC7, "compared with the merge base".** The merge base holds no `shader_layout` test, so what the lane adds is its
  own tests' time, which one checkout can read; no test builds the merge base. The lanes' time before and after, as
  the Proof asks, is the preflight's record.
- **AC7, the time, on this job's machine.** A time counts only on a reference Mac on mains power at a load within its
  cores (design: The reference Macs; `judgeLimit`). Anywhere else, and under load, the test reads INCONCLUSIVE with
  the warm-up run's time as a reading, never PASS. The 5 s is the issue's and is marked drafted: a measurement made
  before the change may move it once (design: Every task carries its own budgets), by a redraft of this test.
- **AC7, "no GPU device opened".** The base has no surface that says whether a process opened a device
  (`deep-gpu`'s count of opened devices is private), and the lane's test binaries link the GPU crates whatever the
  lane does. Not read; a review of the lane's code holds it.
- **AC7, "no dependency added".** A property of the change against its merge base (`Cargo.lock` and the three
  manifests in the pull request's diff). A test that stays on main can't hold it: it would fail the next change that
  adds a dependency for its own reasons.
- **That the planted feature is refused by a release build**: stated as the design's rule; no test builds a release.

## What the implementer adds outside this folder

1. In `crates/deep-scene3d-render/Cargo.toml`, this suite's Rust target (the precedent is #2657's):

   ```toml
   # Issue #3256: the acceptance suite's own target, written blind in tests/acceptance/3256 (README there).
   [[test]]
   name = "acceptance_3256_twin_shaders"
   path = "../../tests/acceptance/3256/twin_shaders.rs"
   ```

2. In `crates/deep-groups-render/Cargo.toml`, criterion 4's planted comparison:

   ```toml
   [features]
   # Issue #3256 criterion 4's planted comparison (tests/acceptance/3256): the shader side's offsets and size summed
   # from the host's field sizes. No shipped build has it.
   plant-3256-host-sizes = []
   ```

3. In `scripts/lanes-lists.mjs`, beside the other timed files:

   ```js
   // #3256's folder (blind) runs alone by its lane.json; ac7-budget.test.mjs holds the shader_layout tests' time with judgeLimit.
   timed.push('tests/acceptance/3256/ac7-budget.test.mjs');
   ```

4. The lane itself, with the names of "The surface under test".

## Files

- `layout.test.mjs` (AC1 to AC6), `ac7-budget.test.mjs` (AC7), `helpers.mjs` (the cargo calls, the readings of a run
  and of the source, and one judge a criterion).
- `twin_shaders.rs`: criterion 2's swapped shader under naga; a `[[test]]` target of `deep-scene3d-render`.
- `twins.json`, `twins/<name>/lines.json`: the six twins. `lane.json`: the folder runs alone.
- `BASE-FAILURE.txt`: what was run at the base, each result, and what was left unrun there and why.
