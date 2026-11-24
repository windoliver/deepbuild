# Acceptance tests for #2660: marks, text, hover and cells copy nothing they only read

Written first, from issue #2660 (its table, scope, seven acceptance criteria and proof line), the design sections it
links (`docs/canvas-primitives.md`: Auto layout, Dirty classes, The cost model; `docs/technical-design.md`: Numbers
version 0 has to hold, Every task carries its own budgets) and the base commit `b6b99ad8c` ("Merge pull request #3003
… fix-2977-concurrent-warm"), by a job that never saw an implementation; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The job ran twice. Its first run wrote the ten Rust files and took the three fixtures' readings at the base. Its second
finished the suite from the same inputs, those files and their output on the base, run unchanged: it read each test
against the issue, the design and the base again, checked each fixture against that output, and wrote the base
readings up here and in `BASE-FAILURE.txt`. It changed no test file and no fixture, and it saw no implementation either.

What was read at the base, each site found by its code (the issue's line numbers are from `ccbdefd1f`):
`deep-canvas-marks`' `scene.rs` (`laid_out`, `build`, `Rank`, `rank_of`, `frame`), `layout.rs`, `check.rs`
(`check`, `numbers`, `text_numbers`), `animator.rs` (`held_keys`, `roll_at`) and `modules.rs` (`frame`, `replaced`,
`envelope_of`, `Drawing`); `deep-marks-render`'s `graphs.rs` (`sizes`) and `tests/no_alloc.rs`; `deep-play`'s
`drawing.rs` (`drawing_of`, where the `frames.rs` copies of the issue's table now live); `deep-text`'s `shape.rs`
(`Shaper::shape`, `run`) and `cache.rs` (`Key::of`, `ShapeKey::of`, `font_hash`); `deep-marks-gpui`'s `lib.rs`;
`deep-canvas`'s `scope.rs` (`targets`, `shown_targets`, `hit`, `input_with`, `Planted`); `deep-canvas-cells`'
`emulator.rs` (`byte`, `csi`, `sgr`); `scripts/canvas-lint.mjs` (its scope and what it refuses); `benchmarks/budgets.json`
and `scripts/proof-change.mjs` (`criterionId`). The second run read again the sites the tests drive (`scene.rs`'s
`Rank`, the build's sort and `layer_key`; `check.rs`; `modules.rs`' `replaced` and `Drawing`; `scope.rs`; `shape.rs`
and `cache.rs`; `deep-marks-gpui`'s `lib.rs`; `emulator.rs`; `tests/no_alloc.rs`; `criterionId`), and beside them
`deep-canvas`'s `area.rs` (`within`), the vendored GPUI's `Path` (`new`, `push_triangle`, `vertices`), which `mesh.rs`
is type checked against only once `path` exists, and the dev profile in the workspace's `Cargo.toml`.

## Run them

Each file is its own test binary, since each but `hover_planted.rs` installs a counting global allocator (`alloc.rs`), and each is wired into
a crate outside the canvas lint's scope: the lint refuses `unsafe` (which a global allocator needs) and a target root
outside the crate in every `deep-canvas*` crate. The implementer adds these entries (this suite doesn't commit them):

`crates/deep-marks-render/Cargo.toml`, at its end:

```toml
# Issue #2660: the acceptance tests written blind in tests/acceptance/2660, each its own binary
# since each installs a counting global allocator (here, not in a canvas crate, whose lint refuses
# `unsafe` and a target outside the crate).
[[test]]
name = "acceptance_2660_layout_marks"
path = "../../tests/acceptance/2660/layout_marks.rs"

[[test]]
name = "acceptance_2660_fast_path"
path = "../../tests/acceptance/2660/fast_path.rs"

[[test]]
name = "acceptance_2660_check_templates"
path = "../../tests/acceptance/2660/check_templates.rs"

[[test]]
name = "acceptance_2660_hover"
path = "../../tests/acceptance/2660/hover.rs"

[[test]]
name = "acceptance_2660_hover_planted"
path = "../../tests/acceptance/2660/hover_planted.rs"

[[test]]
name = "acceptance_2660_shape"
path = "../../tests/acceptance/2660/shape.rs"

[[test]]
name = "acceptance_2660_mesh"
path = "../../tests/acceptance/2660/mesh.rs"
```

`crates/deep-replica/Cargo.toml` (it depends on `deep-canvas-cells`; `deep-marks-render` reaches it only
through `deep-replica`), at its end:

```toml
# Issue #2660 criterion 6: the terminal's acceptance test, written blind in tests/acceptance/2660
# (here, not in deep-canvas-cells, whose canvas lint refuses `unsafe` and a target outside it).
[[test]]
name = "acceptance_2660_terminal"
path = "../../tests/acceptance/2660/terminal.rs"
```

Then, from the checkout root, with the toolchain on `PATH`:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 cargo test -p deep-marks-render --no-fail-fast \
  --test acceptance_2660_layout_marks --test acceptance_2660_fast_path --test acceptance_2660_check_templates \
  --test acceptance_2660_hover --test acceptance_2660_hover_planted --test acceptance_2660_shape --test acceptance_2660_mesh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease nice -n 10 cargo test -p deep-replica --no-fail-fast \
  --test acceptance_2660_terminal
```

They are fast tests on real components in a debug build: no GPU, no window, no timing. Counts don't depend on load.
Each prints its reading (`eprintln!`) before it asserts; `-- --nocapture` shows it on a pass.

## The surfaces under test

Every count is a heap count on the calling thread, as `crates/deep-marks-render/tests/no_alloc.rs` counts: each
`alloc` and each `realloc` while counting is on. Criteria 2 and 3 are in bytes: the counter sums the bytes each of
those asks for (its layout's size; a realloc's new size). Criterion 5's key builds are allocations of exactly the
text's length (below).

Existing surfaces, unchanged: `deep_canvas_marks::scene::frame` (a build) and its `Frame`'s layers (`id`, `marks`,
`key`), `deep_canvas::schedule::{Scheduler, Session}` with `Session::load`, `Session::revise_items`, `Session::frame`
and `Session::value`, and the `marks2d.frame` value's `Drawing` (`frame`, `built`, `damage`, `runs`, `animated`),
`deep_canvas_marks::check::check` in the shipped clean look and its issues' `code` and `ids`,
`deep_canvas::scope::Scope` with `new`, `input` (`Event::Move`) and `to_json` (`hover`), `deep_text::Shaper::shape`
of a `Spec` and its run's `glyphs`, `width` and `ellipsized`, `deep_canvas_marks::path::Mesh` (`vertices`, `indices`,
`triangles`), `deep_canvas_cells::emulator::Terminal` (`new`, `feed`, `rows`, `row`, `text_of`, `cursor`,
`history_len`) and a cell's `g`, `fg`, `bg`, `attrs` and `link`.

New, the implementer adds them:

- **The mesh's path**, in `crates/deep-marks-gpui/src/lib.rs`:

  ```rust
  /// The GPUI path `paint` paints for `mesh`, moved by `offset` px: its triangles in order, three
  /// vertices each; `None` for a mesh with no triangles.
  pub fn path(mesh: &Mesh, offset: [f32; 2]) -> Option<Path<Pixels>>
  ```

  `paint` paints exactly this path (`if let Some(p) = path(mesh, offset) { window.paint_path(p, color) }`), so
  counting its build counts what a painted mesh allocates for its vertices without a window. `paint_strip` is left as
  it is (the criterion names a mesh).

- **The planted scope**, a field of `deep_canvas::scope::Planted` (whose other fields are #383's), off by default:

  ```rust
  /// #2660 AC4's twin: the scope keeps the hit targets it built across a new revision of the
  /// document, so after a patch that moves an item a pointer move hits by the targets before it.
  pub keeps_targets_across_patch: bool,
  ```

  A test turns it on as `Planted { keeps_targets_across_patch: true, ..Planted::default() }` and passes it to
  `Scope::new`, as #383's suite plants its scopes.

- **The `[[test]]` entries** above, and nothing else: no counter in a crate.

## Criteria to tests

Each criterion's ID is `#2660.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `scripts/proof-change.mjs` (`criterionId`) works it out. Each test's name starts with its criterion
(`ac1_` …) and a comment above it gives the ID.

| Criterion | Test (file) | What it requires | The wrong program it fails on |
|---|---|---|---|
| AC1 `#2660.d3570005` A build of a 10,000-row mark set at depth 2 inside an auto-layout frame makes at least 50,000 fewer heap allocations than on the merge base … and its draw list hashes the same | `ac1_…` (`layout_marks.rs`) | A `row` frame (`board`, order `a0`) whose one flow child is a 10,000-point `marks@1` (`dots`, order `b0`, fixed 1000 × 700 box, f32 columns): its rank is two tree levels. After one warm-up build, the second `scene::frame` makes at least 50,000 fewer allocations than the base's count in `fixtures/layout-marks-base.json`; it draws at least 10,000 marks; its draw list's hash (each layer's ID, mark count and content key) equals the base's there | The merge base: its build makes 139685 allocations (16881063 bytes) for 10000 marks, draw list `main:10000:e58041e1c69a8c26bd5592be2ca43975`. The hash matches, and the test fails at its last assertion: 0 fewer than the merge base's 139685 |
| AC2 `#2660.1b678fb1` A one-item change on a document with 2,000 text items, taken by the fast path, allocates under 64 KB … On the merge base it copies both text maps, and the test fails, naming the bytes | `ac2_…` (`fast_path.rs`) | 2,000 `text@1` labels and 40 rects beside them, on the text, look, marks2d and data modules in the clean look. Three one-item changes, each a rect's move, each `revise_items` then `frame`; each is taken by the fast path (`built` 1, one damaged layer) and keeps every text's run. The third, counted from `revise_items` through `frame`, asks for under 65,536 bytes | The merge base: the third change asks for 195022 bytes in 2711 allocations, and a copy of the frame's two text maps alone asks for 137520 bytes in 2334. The test fails naming the bytes: 195022, where under 65536 are owed |
| AC3 `#2660.c8534ab1` A check of a document with 200 template items and 4 MiB of description allocates under 8 MiB. On the merge base it allocates at least 200 copies of the document | `ac3_…` (`check_templates.rs`) | 200 `text@1` items with `template: "Count: {data/count}"`, a story `data.count`, a bound reading elsewhere (so each template's story number is unsourced), and a description of 4 MiB. `check::check` in the clean look names each of the 200 templates `number_unsourced` and asks for under 8,388,608 bytes | The merge base: its check names all 200 templates and asks for 1905661789 bytes in 2559578 allocations, 450.1 times the document's 4234091 bytes. The test fails at the limit of 8388608 bytes |
| AC4 `#2660.86f235d7` 1,000 pointer moves over a 1,000-item document … allocate nothing after the first, and each hit names the item the merge base names. A planted scope that keeps its targets across a patch that moves an item fails, naming the item | `ac4_pointer_moves…` (`hover.rs`), `ac4_a_scope_that_keeps…` (`hover_planted.rs`) | 1,000 rects (every seventh overlapping its neighbours, stacked by order keys out of ID order) on a flat 800 × 500 scope. 1,000 `Event::Move`s with no button down, each to its own point: moves 2 to 1,000 allocate nothing; at least half hover an item; each move's hover equals the base's in `fixtures/hover-base.json`. Then a patch moving `n0123` to the empty corner, as a new revision: the next move there hovers `n0123` | The merge base: 995 of the 999 moves after the first allocate, 2994950 allocations in all, move 1 first with 3010 allocations of 623800 bytes; 839 moves hover an item. `hover.rs` fails at its allocation check. The planted scope, which after the patch hovers what its kept targets say, and the check's `Err` names `n0123`: on the merge base `hover_planted.rs` doesn't compile, since `Planted` has no field named `keeps_targets_across_patch` |
| AC5 `#2660.732be9a5` A warm `shape` of a text that fits builds its key once, and a painted 1,000-triangle mesh allocates its vertices once, each counted by the test | `ac5_a_warm_shape…` (`shape.rs`), `ac5_a_painted…` (`mesh.rs`) | Shape: a 48-byte label in a 600 px box, shaped cold, then warm: the warm shape returns the cached run and builds at most one key, counted as allocations of exactly 48 bytes. Mesh: `path` of a 1,000-triangle mesh holds 3,000 vertices, the mesh's moved by the offset, in order, and allocates once | The merge base: a warm shape builds its key 2 times (2 allocations of the text's 48 bytes, 2 allocations in all), and `shape.rs` fails: once is owed. `mesh.rs` doesn't compile there, since `deep_marks_gpui` has no function `path`, so the base's count for the mesh isn't read |
| AC6 `#2660.8d2a770c` 1 MB of colored terminal output allocates at most half of what it allocates on the merge base, and the grid it leaves is cell for cell the same | `ac6_…` (`terminal.rs`) | 1,000,000 bytes of words in 16-color, 256-color and truecolor SGR sequences, bold and reset, fed to a 120 × 40 terminal in 4 KiB reads: at most half the base's allocation count in `fixtures/terminal-base.json`, and the grid's digest (every visible cell's grapheme, colors, attributes and link, the cursor, the scrollback length) equals the base's there; the grid shows the words, colored | The merge base: 424317 allocations (26875416 bytes), grid `782133f73890ddd5`. The grid matches, and the test fails at its last assertion: at most 212158 (half) are owed |
| AC7 `#2660.b417fd59` `tests/acceptance/375/`, `896/`, `383/`, `160/` and `402/` pass unchanged, and `canvas-patch-settled`, `canvas-patch-dirty` and `terminal-60hz` … retire no more instructions than on the merge base | no new test (below) | | |

AC7 needs no new test: its suites exist, and the perf lane compares every budget in `benchmarks/budgets.json` with the
merge base on instructions retired, in pairs as `docs/technical-design.md` (Every task carries its own budgets) says.
Run them:

```sh
npx vitest run --root tests/acceptance/375 --no-file-parallelism
npx vitest run --root tests/acceptance/896 --no-file-parallelism
npx vitest run --root tests/acceptance/383 --no-file-parallelism
npx vitest run --root tests/acceptance/160 --no-file-parallelism
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/402 --no-file-parallelism
node scripts/preflight.mjs   # its perf lane: canvas-patch-settled, canvas-patch-dirty, terminal-60hz against the merge base
```

Each budget's own command, for one side's reading, is `node benchmarks/canvas.mjs patch-settled`, `… patch-dirty` and
`… terminal-60hz`; `scripts/perf.mjs` runs them on both sides and reads each count through `scripts/count-children.c`.
This job ran none of AC7.

## The base readings and how they were taken

`fixtures/layout-marks-base.json`, `fixtures/hover-base.json` and `fixtures/terminal-base.json` are the merge base's
readings, taken by the job's first run at `b6b99ad8c` on a Mac17,10 (macOS, aarch64, Rust 1.99.1) by the tests
themselves: each printed its reading and failed, and the reading was copied into the fixture by hand, unchanged. The counts are of a debug build
(`CARGO_PROFILE_DEV_DEBUG=0`), single-threaded code on the test's thread, and don't move with load.

The numbers in this file come from the job's second run: the same files, unchanged, at the same commit on the same Mac,
on 2026-11-21 (the logs' file dates; the run's own log prints only its times, 13:39:35 to 13:43:55). They are written
as its logs print them, without separators. The lines of each log that show the failure are in `BASE-FAILURE.txt`.

- **Commit, toolchain, machine:** `b6b99ad8c`, the checkout's HEAD; `rustc 1.99.1 (58cf8f9c3 2026-10-13)`; a
  `Mac17,10`, shared, at load averages of 105.29 126.33 97.21 when the run began and 69.54 98.44 92.55 when it ended.
- **Build:** cargo's `test` profile, as the workspace's `Cargo.toml` sets the dev profile: unoptimized, except the
  crates it builds at `opt-level = 3` there, `deep-canvas`, `deep-canvas-marks` and `deep-canvas-cells` among them.
  Flags: `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1`, and `--locked -j 8`. The fixtures' counts are
  this build's, so the change is read in the same one, as the commands under "Run them" build it.
- **Commands,** from the checkout root, with the `[[test]]` entries above in the two manifests. A cargo command builds
  every target it names before it runs one, so the two files that name a surface the base lacks each ran alone, and
  the five that compile ran together. Each of the four commands exited 101:

```sh
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1
cargo test --locked -j 8 -p deep-marks-render --no-fail-fast \
  --test acceptance_2660_layout_marks --test acceptance_2660_fast_path --test acceptance_2660_check_templates \
  --test acceptance_2660_hover --test acceptance_2660_shape -- --nocapture
cargo test --locked -j 8 -p deep-marks-render --no-fail-fast --test acceptance_2660_hover_planted -- --nocapture
cargo test --locked -j 8 -p deep-marks-render --no-fail-fast --test acceptance_2660_mesh -- --nocapture
cargo test --locked -j 8 -p deep-replica --no-fail-fast --test acceptance_2660_terminal -- --nocapture
```

| File | On the merge base | The reading it prints |
|---|---|---|
| `layout_marks.rs` | fails at `layout_marks.rs:100`, its last assertion: 0 fewer than the merge base's 139685 | `build: 139685 allocations, 16881063 bytes; 10000 marks; draw list main:10000:e58041e1c69a8c26bd5592be2ca43975` |
| `fast_path.rs` | fails at `fast_path.rs:114`, the limit: under 65536 bytes are owed | `one-item change: 195022 bytes in 2711 allocations (a copy of the two text maps alone: 137520 bytes in 2334 allocations)` |
| `check_templates.rs` | fails at `check_templates.rs:76`, the limit: under 8388608 bytes are owed | `check: 1905661789 bytes in 2559578 allocations (450.1 copies of the 4234091-byte document); 200 issues` |
| `hover.rs` | fails at `hover.rs:58`, the allocation check: move 1 first, 3010 allocations of 623800 bytes | `995 of 999 moves after the first allocated, 2994950 allocations in all; 839 moves hovered an item`, then the `base hover reading:` line |
| `hover_planted.rs` | doesn't compile: E0560 at `hover_planted.rs:13`, `Planted` has no field named `keeps_targets_across_patch` | none |
| `shape.rs` | fails at `shape.rs:48`, the key count: once is owed | `warm shape: 2 key builds (allocations of the text's 48 bytes), 2 allocations in all` |
| `mesh.rs` | doesn't compile: E0423 at `mesh.rs:46`, cannot find function `path` in crate `deep_marks_gpui` (E0603 beside it: the name reaches only that crate's private import of the `path` module) | none |
| `terminal.rs` | fails at `terminal.rs:105`, its last assertion: at most 212158 (half) are owed | `1 MB of colored output: 424317 allocations, 26875416 bytes; grid 782133f73890ddd5` |

**The fixtures against this run.** All three agree with it exactly, and none was changed. `layout-marks-base.json`
holds 139685 and the draw list's hash; `terminal-base.json` holds 424317 and the grid `782133f73890ddd5`;
`hover-base.json` is the `base hover reading:` line after its label, byte for byte: a hover for each of the 1,000
moves, 839 of them an item. So the first run's readings and the second's, taken at different times of one day, are the
same counts.

**What the base run doesn't reach.**

- `hover.rs` stops at its allocation check, before it compares each hover with the fixture and before its patch check.
  The fixture is that run's own print. The patch check on the scope as shipped is read from the base's `hit` instead:
  the corner lies in no item's box before the patch and in `n0123`'s after it.
- The log gives only the count of the moves after the first that don't allocate on the base, four of the 999. Read
  from the base's `hit`, they land on the canvas's full-screen button, which it answers before it builds a target.
- The planted scope's own failure, since its field doesn't exist there, and the mesh's count, since `path` doesn't.
  Once it compiles, `mesh.rs` itself counts the base's way of building the path (a path started empty, three vertices
  pushed a triangle) and requires more than one allocation of it, so its counter is proven to count.
- AC7 (above).

## Readings where the issue leaves a choice

- **"A build"** (AC1) is `scene::frame`, the draw list of a document's items, the second of two in one process (the
  first warms the shaper and tessellation caches); "inside an auto-layout frame" is a `row` frame whose flow child is
  the mark set; "at depth 2" is the set's rank of two tree levels, the frame's and its own, each with an order key and
  an ID, as the audit's count (a vector and two strings a level, and the item's ID, per mark) needs. Its draw list's
  hash is each layer's ID, mark count and content key, which covers each mark's content in draw order.
- **"A one-item change … taken by the fast path"** (AC2) is the session's whole handling of it: `revise_items` and the
  `frame` after it, every operator the frame runs, counted on the third such change (two warm the path). The change
  moves one of 40 rects beside the 2,000 texts, not a text: a text's own move shapes it again, and the base's fast
  path takes no change that gives a text a new run, so on a text's move there is no fast path to count. The fast path
  is read as `built == 1` with one damaged layer. Its 64 KB is 65,536 bytes asked for.
- **"A check"** (AC3) is the marks module's `check::check` in the shipped clean look. The document binds a reading, so
  each template's story number is unsourced and the check names it: that proves the check read every template. On the
  base this makes each template cost two copies of the document (`numbers` and `text_numbers`).
- **"Nothing changed"** (AC4): the same document value for every move, no patch, no view change. "Allocate nothing" is
  zero allocations per move, including a move whose hover changes from one item to another. The hover is read through
  `to_json` between moves, outside the count. The patch in the planted check is a new revision (a changed copy, the
  old one still held), so a scope may tell revisions apart by value or by identity; the test never mutates a document a
  scope has seen.
- **"Builds its key once"** (AC5): a run's key holds a copy of its text, so the test counts key builds as heap
  allocations of exactly the text's length (48 bytes; nothing else in a warm shape asks for that size on the base) and
  allows at most one. A key built without copying the text counts as none. The font hash, the other half of the
  audit's finding, isn't counted.
- **"Allocates its vertices once"** (AC5) is exactly one allocation while `path` builds the path of a 1,000-triangle
  mesh (`Path::new` allocates nothing).
- **"1 MB of colored terminal output"** (AC6) is 1,000,000 bytes fed in 4 KiB reads; "at most half" is a count of
  allocations at most half the base's. "Cell for cell the same" is read through a digest of the visible grid, the cursor
  and the scrollback length, compared with the base's.

## What is not tested

- The issue's other sites have no criterion of their own and aren't counted apart: the animator's document clones per
  rolling counter (`animator.rs`, F10's other half), an effect group's pass params cloned into each mark's key (F11),
  the `frame` operator's envelope hashed each run (F14), `graphs.rs`' copy (F5's other half, reached only with a graph),
  `paint_strip`'s path, and `deep-play`'s `drawing_of` copies of the text maps. AC1's count includes F5's copy in
  `laid_out`, since the document lays out.
- Animated texts: AC2's labels have no animation, so the base's copy it catches is the runs map's; the animated map's
  copy is then empty.
- AC7 (above) was not run by this job.
