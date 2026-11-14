# Acceptance tests for #548: preview on a throwaway copy, logic in the agent tools, and the budgets

Written first, from issue #548 (its Scope, Fields, seven acceptance criteria and Proof line: "The hex board's preview
with its planted twins, deep_query's arrays and region map, and the budgets against the merge base"), its Oracle page
(`doneright/oracles/issues/548.md` in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion),
the design sections it links and the base commit `54d307821` ("Merge pull request #2459 …"), by a job that never saw
an implementation; none existed, and no other branch, worktree or pull request was read. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 548 --repo windoliver/deepbuild --comments` (no comments), and its Oracle page.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Turn clock;
  Interpolated writes; Logic preview); Dogfooding. AGENTS.md. `docs/parallel-proof.md` §12a (budget windows).
- `docs/canvas-primitives.md`: Logic `logic@1` (fields, exports, the region map and `regions_digest`, Semantics: the
  read region's control slots); Logic: occurrences; Logic: turn clock; Logic: interpolated writes; Logic: preview;
  Logic: sandbox (trap kinds); Logic: checkpoints and bake (its Cost line's 32 MiB memory writing 3 pages); Control:
  point (hover, the 248 B record); Check input: logic kinds (`logic.trap {item, step, t, kind, function, offset,
  inputs}`, "so `deep_show` can replay to that step").
- At the base, for surfaces and conventions only: `crates/deep-logic` (`lib.rs`'s calls and planted names, `piece.rs`'s
  region map, `regions_digest` and the fields it refuses as "isn't built yet", `live.rs`'s `view` and `frame`,
  `point.rs`'s 248 B record and its flag bits); `crates/deep-show` (`main.rs`'s calls, `query.rs`, `kinds.rs`,
  `logic.rs`, `picks.rs`, `points.rs`); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`),
  `scripts/proof-change.mjs` (criterion IDs), `benchmarks/budgets.json`; the suites `531/` (its Rust program and
  `regions_digest`), `532/`, `539/` (the hex fixture, the scenario, `screen`, the taste call), `540/`, `544/wat` (the
  assembler, read only), `545/`, `546/` (deep_kinds through `deep-show run --planted`), `547/`, `412/` and
  `538-redraft-ac8/` (budgets), `411/`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs.

## What the base already does, and these tests don't credit

The logic module steps an item on a fixed clock or a turn clock, emits occurrences, blends linear writes in a live
view's `draws`, keeps a checkpoint ring of written pages (#547's `ring`), bakes, and refuses a program whose
`regions_digest` (an immutable i64 global) isn't its item's, naming the first entry whose offset differs from the
item's earlier layout in the same process. Its region map holds the reads (each control's slot, then `seed`) and the
writes, not the emit kinds. It refuses `preview` ("isn't built yet"). deep-show runs a document's logic items, has the
`logic` replay (#539), `deep_query` (#411) with no logic read, and `deep_kinds` (#412) with no bindings. No test here
can pass at the base, and none is a guard.

## Run them

```sh
npm ci                          # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH                 # rustup's cargo (helpers.ts also adds it when present)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/548 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/548/tsconfig.json
```

What a run builds (honoring `CARGO_TARGET_DIR`; each file builds what it drives in `beforeAll`, copied to a temporary
folder):

- **#544's assembler** (`tests/acceptance/544/wat`, read only) into `target/acceptance-548-wat/`.
- **`deep-logic`** and **`deep-show`**: `cargo build --locked --bin deep-logic` and `--bin deep-show` (the dev builds,
  `full` by default); on a reference Mac at rest only, `cargo build --locked --release --bin deep-logic` for criterion 3's
  timings.
- **The merge base's `deep-logic`** (criterion 3): `git archive` of `git merge-base HEAD origin/main` into
  `target/acceptance-548-base/<sha>/`, built there in its own target folder, kept so later runs build warm.
- **The Rust program** `flock-rs/` (crate `acceptance-548-flock`, no dependencies, outside the workspace, its own
  `Cargo.lock`): copied to `target/acceptance-548-flock/<tag>/` with the bindings deep_kinds gave as `src/regions.rs`,
  and built there with `cargo build --locked --release --target wasm32-unknown-unknown` (the copy sits in the checkout,
  so `rust-toolchain.toml`'s 1.99.1 with its wasm32 target and `.cargo/config.toml` apply, as for #531's `rules/`).

Every test passes its own timeout (up to 90 minutes). Temporary folders are deleted; only criterion 7 writes outside
them, its pictures to `docs/evidence/548/`. Node built-ins, vitest and `../467/helpers.ts`'s PNG reader and writers
(imported, read only). The only processes started are cargo, `git archive`/`tar`, the assembler, `deep-logic` and
`deep-show`; long-lived `deep-logic` processes are stopped by their PIDs.

**The lanes lines.** The implementer adds these to `scripts/lanes.mjs` (this README is the instruction):

```js
// #548's files build deep-logic, deep-show, a Rust program for wasm32 and the merge base's deep-logic, drive live views
// frame by frame, draw the app's window and time the logic module's budgets on the reference Mac.
alone.push('tests/acceptance/548/');
timed.push('tests/acceptance/548/ac3-budgets.test.ts');
```

Gates, none a pass: no cargo or an assembler that doesn't build is `BLOCKED:`; criterion 3's timings are `INCONCLUSIVE:`
off a reference Mac at rest (below), after every guard has passed; `screen` off macOS is `INCONCLUSIVE:`; criterion 7 is
`INCONCLUSIVE:` until its taste call is recorded.

`BASE-FAILURE.txt` is the run at the base (its first lines give the counts and why each test fails there). At the base
deep-show itself doesn't compile (`crates/deep-canvas-motion/src/cues.rs:841` uses `ParamType::Json` as a unit variant),
so criteria 4 to 6 fail there on deep-show's build; their own reasons are shown by a run on a throwaway copy of the
base with that line patched, which the file summarizes.

## The surface under test

The issue names the `preview` field and its export and global, preview arrays as `<logic ID>.preview.<name>`, a trap
in a preview, deep_kinds' bindings in Rust with `regions_digest`, deep_query's logic reads and region map with its
layout digest, deep_show's replay to a trap, `check`, the bake, planted programs and the budgets, but no call. As in
#545's and #547's suites the logic module's surface is `deep-logic`; the agent tools and the app are `deep-show run`
and `deep-show screen`, as in #539's and #546's. **Every call, field, reply key, byte layout, API name and planted name
below that the issue or the design doesn't give is this job's invention**, the smallest surface the criteria need,
extending the base's own; the implementer builds exactly these, or a dispute goes to a blind redraft. Calls and fields
not named here stay as #531's, #532's, #539's, #544's, #545's and #547's READMEs define them. Times in calls are flicks
(705,600,000 a second) except `view`'s `span` and `frame`'s `play` and `seek`, which are seconds (#545's).

### deep-logic: what this suite adds

**The logic item's `preview`** (the issue's field): `preview: {reads: ["<control>.hover" | control ID], writes: {name →
{type: bool | i32 | f64 | vec2 | vec3, count?}}}`, with the export `preview(k: i64)` and the immutable i32 global
`preview_at`. Check admits it (no longer "isn't built yet"), on the piece's controls as `check` takes them
(`{"place": {"kind": "point"}}`).

**The preview regions** (invention: the design gives "its read region, then its write region" at `preview_at` and
"fills 248 B as a point entry does"): the read region at `preview_at` holds each preview read in declaration order,
each at an 8-byte boundary; a point control's hover is its 248 B record as Control: point lays out a point entry
(`u8 phase, u8 button, u8 mods, u8 flags`, 4 zero bytes, `f64 x, y, z`, …), with flags bit 0 (value 1) set when it holds
a cell, as #540's record sets it, and x = cx, y = cy, z = 0; a hover that is none is 248 zero bytes. The write region
starts right after the read region at the next 8-byte boundary (here `preview_at` + 248) and holds each preview write
in declaration order, each at an 8-byte boundary, its elements as the item's own writes lay them out (bool and i32 4
bytes, f64 8, vec2 16, vec3 24).

**`view`'s `frame`** (#532's and #545's) takes, beside `play`, `seek` and `set`:

- `hover: {<control ID>: [cx, cy] | null}`: that point control's hover from this frame on (viewer state: never an
  entry on the input track); `null` when the pointer leaves. A frame without `hover` keeps it as it was.

and its reply adds:

| Key | Meaning |
|---|---|
| `draws["<logic ID>.preview.<name>"]` | each preview array as this frame draws it, laid out as `draws` lays out an array (an i32 a number, a bool a boolean): what the last preview wrote, its defaults (0, false) before any or after a trap clears them |
| `previews` | how many `preview` calls this frame ran, over every item (at most one an item: a frame previews only when a control the preview reads changed, a step ran or a seek landed) |
| `blends` | how many elements of linear writes this frame's `draws` blended |
| `traps` | `[LogicTrap]`: the traps raised during this frame (#531's form), a preview's with `"export": "preview"` beside `item`, `kind` and the rest |

**`{"call": "baked", "session": <view session>}`** → `{"ok": true, "track": [Entry], "steps": [StepRecord], "checkpoints":
{<logic ID>: [{"step", "deep_hash"}]}, "bake": base64}`: the bake a view's session holds of the steps it has run (here
always played forward from 0): `track` the input track it read, `steps` and `checkpoints` as a `bake` call of the same
piece and track to the same step gives them, and `bake` the bake's bytes as the logic module stores them (Logic:
checkpoints and bake).

**`check`'s layout** lists the emit region's entries after the writes, one per kind in declaration order: `{"region":
"emits", "name": <kind>, "offset": from emits_at, "size": 4 + max_per_step × (8 + its fields' bytes), "type": a
non-empty string}`, and the layout digest covers them (the design's region map holds "the read, write and emit
regions").

**`regions_digest`** is read either as an immutable i64 global holding the digest (as at the base) or as an immutable
i32 global holding the address of its 8 bytes, little-endian, inside an active data segment: how a Rust `#[no_mangle]
static` exports it, since Rust can't export an i64 global.

**The ring's checkpoints** (#547's `ring`): each `Kept` adds `ns`, the CPU time the logic module took to take and store
that checkpoint.

### deep-show: what this suite adds

| Call | What the tests send | What they read |
|---|---|---|
| `deep_query`, **`what: "logic"`** | `{session, doc, what: "logic", items: [<logic ID>], steps: [k], track?: [Entry], at}` | `logic: {<logic ID>: {region_map: Layout, steps: [{step, arrays: {"<logic ID>.<name>": [value]}, fuel}], trap: LogicTrap \| null}}` |
| `logic` (#539's), **`track`** | `{doc, steps, track: [Entry], at}` | `steps` (#539's), **`trap: LogicTrap \| null`** |
| `deep_kinds`, **`op: "bindings"`** | `{op: "bindings", doc, item: <logic ID>, language: "rust", at}` | `bindings: {language, item, digest, file, source, fields: [RegionEntry]}` |
| `deep_show`, `scope`, `input` (`move`), `view` (`snapshot.sha256`), `export` (`png_seq`), `deep-show screen` | as #539's suite sends them | as #539's suite reads them |

- **deep_query's logic read.** The item's bake, as the hub bakes the document's logic items over its span on the
  input track the query names (`track`, #504's field, else the hub's): for each step asked, every array as that step
  left it and the fuel that step used; `region_map` the item's region map with its layout digest, as `check` computes
  it (#531's Layout: `{digest: 16 hex, entries: [{region, name, offset, size, type}]}`, with the emit entries above);
  `trap` the item's `logic.trap` in that bake (`{item, step, t, kind, function: the function index in the program as
  given, offset, inputs: [Entry]}`), null when it never trapped.
- **`logic`'s `track` and `trap`.** The replay reads `track` in place of the hub's input track (as `eval`, `export` and
  `deep_query` take one). When an item traps, the replay stops there: `steps` holds the records of steps 0 through the
  trap's step and none after ("replays to that step and no further"), and `trap` is its `logic.trap`.
- **deep_kinds' bindings.** For the document's logic item: `digest` its layout digest; `fields` each read, write and
  emit entry the bindings declare, in the bindings' order, as `{region, name, offset, size, type}` (the region map's
  form); `file` the file's name; `source` the Rust module's text. The tests build `source` as `src/regions.rs` of
  `flock-rs/` (`mod regions;`).
- **The bindings' Rust API**, which `flock-rs/src/lib.rs` uses and nothing else: a `no_std` module that defines and
  exports (`#[no_mangle]`) the item's regions as `reads_at`, `writes_at` and, with emits, `emits_at`, and the digest as
  `regions_digest` (a `u64` static, see above), and gives:
  - `pub fn reads() -> &'static Reads`, `pub fn writes() -> &'static mut Writes`, `pub fn emits() -> &'static mut
    Emits` (called inside `unsafe` blocks, so either a safe or an unsafe fn builds);
  - `#[repr(C)]` structs `Reads`, `Writes`, `Emits` with one public field per entry, named as declared (`seed` too),
    each at its region map offset;
  - field types: a slider control's slot `Slot<f64>` with `pub count: u32` and `pub entries: [Entry<f64>; 16]`, an
    `Entry<V>` with `pub player: u32` and `pub value: V`; `seed: i64`; a write of count 1 its element, of count n `[T;
    n]`, with i32 `i32`, f64 `f64`, vec2 `[f64; 2]`, vec3 `[f64; 3]`; an emit kind `Rows<Row, N>` (any type with `pub
    count: u32` and `pub rows: [Row; N]`, N its `max_per_step`), whose row type is named after the kind in UpperCamelCase
    (`Crossing`), with public fields `a: u32`, `b: u32`, then its fields as declared (`boid: i32`, `side: i32`).
  A hand-written sample that `lib.rs` builds against is the "Sample bindings" block below.
- **The hex board document** (fixtures.ts `hexDoc`): the point control `place: {kind: "point", class: "document", label,
  role: "grid", on: "board"}` on a 24 × 24 pointy odd hex set, its hover reaching `game`'s preview; the route drawn by a
  mark set whose `alive` reads `game.preview.lit`. In the panel's live view (`view`, the window) the preview arrays draw
  as the preview wrote them; an export's frames draw them at their defaults.

### Planted twins

Each is one criterion's wrong program, reachable only by its name, and changes nothing else. `twins.json` maps each
criterion's ID to its twin. Each twin's test first runs the real program on the same input and asserts it passes.

| Name | Where | Criterion | The wrong program | What the failure names |
|---|---|---|---|---|
| `preview_writes_item_memory` | `deep-logic --planted` | 1 | `preview(k)` runs on the item's own instance, not a throwaway copy, so its regions' bytes stay in the item's memory | "the first checkpoint whose full-state hash differs from the run without hovering: checkpoint 120" |
| `preview_runs_on_hover_only` | `deep-logic --planted` | 2 | the preview runs only when a control it reads changes, never after a step or a seek | the frame: "frame n (t 2 s, the first frame of step 120's move)" |
| `region_map_reads_by_name` | scenario `planted` | 5 | deep_query's region map lists the reads by name (`gust` before `wind`), offsets and digest computed from that order; the program and check are unchanged | "the first entry that differs: reads wind" |
| `bindings_fields_by_name` | `deep-show run --planted` | 6 | the bindings generator orders each region's fields by name before laying them out | "the first field that differs from the region map: reads wind" |

### Sample bindings

Not generated; written by hand at the base to check that `flock-rs/src/lib.rs` builds against the API above (it does,
and its `wrong_score` build fails at `src/lib.rs:45` naming `score`). The digest is a placeholder.

```rust
#![allow(non_upper_case_globals, dead_code)]
pub const REGIONS_DIGEST: u64 = 0x0123_4567_89ab_cdef;
#[no_mangle] pub static regions_digest: u64 = REGIONS_DIGEST;
#[repr(C)] #[derive(Clone, Copy)] pub struct Entry<V> { pub player: u32, zero: u32, pub value: V }
#[repr(C)] pub struct Slot<V> { pub count: u32, zero: u32, pub entries: [Entry<V>; 16] }
#[repr(C, align(8))] pub struct Reads { pub wind: Slot<f64>, pub gust: Slot<f64>, pub seed: i64 }
#[repr(C, align(8))] pub struct Writes { pub pos: [[f64; 3]; 100], pub vel: [[f64; 2]; 100], pub score: i32 }
#[repr(C)] #[derive(Clone, Copy)] pub struct Crossing { pub a: u32, pub b: u32, pub boid: i32, pub side: i32 }
#[repr(C)] pub struct Rows<R, const N: usize> { pub count: u32, pub rows: [R; N] }
#[repr(C)] pub struct Emits { pub crossing: Rows<Crossing, 16> }
#[no_mangle] pub static mut reads_at: Reads = unsafe { core::mem::zeroed() };
#[no_mangle] pub static mut writes_at: Writes = unsafe { core::mem::zeroed() };
#[no_mangle] pub static mut emits_at: Emits = unsafe { core::mem::zeroed() };
pub fn reads() -> &'static Reads { unsafe { &*core::ptr::addr_of!(reads_at) } }
pub fn writes() -> &'static mut Writes { unsafe { &mut *core::ptr::addr_of_mut!(writes_at) } }
pub fn emits() -> &'static mut Emits { unsafe { &mut *core::ptr::addr_of_mut!(emits_at) } }
```

## Programs

`programs.ts`, WebAssembly text assembled by #544's assembler; each comment says what it does and the item it's for.
Programs that address region entries are built against the item's layout as `check` reports it, read first with the
layout probe `probe`, except the emit region's one kind, which starts the region by the design.

- `game` (criteria 1, 2, 7): the hex board, 24 × 24 cells, the selected unit at (12, 12), moved by the AI to (13, 12) at
  step 120. Writes `unit` (i32 × 2) and `here` (bool × 576). Its preview reads `place.hover` and writes `route` (i32 ×
  12: each cell of the route as its index + 1, row-major, the rest 0) and `lit` (bool × 576); the route is the walk
  from the unit's cell that steps one hex toward the hovered hex, (+1, −1) or (−1, +1) in axial coordinates while q and
  r must move opposite ways, else along q, else along r, the unit's cell first, at most 12 cells (`routeOf`). The 40
  hovered hexes are 40 of the 66 hexes 11 from the unit (a 12-cell route each), in a seeded order; the 41st is the trap
  hex, where the preview loops forever.
- `flock` (criteria 4, 5, 6): 100 boids reading the sliders `wind` then `gust`, writing `pos` (vec3 × 100), `vel` (vec2
  × 100) and `score` (i32), emitting `crossing {boid: i32, side: i32}` at most 16 a step.
- `judge` (criterion 4): reads `trigger`; its function 2 divides by an entry's value, so the entry of 0 at step 412
  traps with kind divide there.
- Criterion 3: `idle` (a turn clock, reads `tap`), `plain` (fixed clock, nothing else), `emitter` (64 rows of `hit {x:
  f64}` a step, and its twin with the same stores and a count of 0), `swarm` (10 Hz, vec3 × 1,000, linear or hold),
  `big` (a 4 MiB state, a preview of one i32), `pages3` (32 MiB, writes pages 0, 200 and 400 every step).

The Rust program `flock-rs/src/lib.rs` is the flock item's program for criterion 6: pos[i] = [i, the last wind so far,
k], vel[i] = [the gusts' sum so far, i], score the gusts counted, a `crossing` row {a: j, b: k, boid: j, side: ±1} per
gust entry this step; its `wrong_score` feature adds `let read: f64 = regions::writes().score;` on the line marked
`WRONG: score read as f64`.

## Fixtures

`fixtures.ts`: the pieces `deep-logic` takes (`gamePiece`, `flockPiece`), the flock's and the trap's tracks, and the
deep-show documents: `hexDoc` (an 800 × 520 u figure, 4 s at 60 fps: `game`, the board, the route and the unit as hex
mark sets on an atlas of four pointy hexagons), `flockDoc` and `judgeDoc` (12 s, the logic item and its sliders), each
program in the evidence store and listed in `assets`. The board set reads no array, so it names its rows with `n: 576`,
which the base requires of a set without one.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: `#548.` + the first 8 hex digits of the SHA-256 of each criterion's text,
trimmed, white space collapsed, from the live issue. Each describe and test name starts with its ID; each file quotes
its criterion in full. Test count: 3 + 1 + 4 + 2 + 1 + 1 + 1 = 13.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| 1 `#548.1e9cd89b` | `ac1-preview-copy.test.ts` (3) | A view of the board played 240 frames at 60 fps, hovering the 40 hexes two frames each from frame 61 (then the pointer leaves), against the same view never hovered: every frame lands at its time; each hovered frame draws `routeOf` from the unit's cell then (U1 from frame 120) and `lit` its cells, nothing after the pointer leaves; `previews` at most 1 a frame and 1 on each hover change; the session's bake (`baked`) holds a `bake` call's step hashes and checkpoints and an empty track; every frame's full-state hash, every step hash, every checkpoint's full-state hash, the bake's bytes and the input track equal the run without hovering. `preview_writes_item_memory`: the same comparison fails, naming checkpoint 120. The trap hex at frame 31, after a route drawn at frame 30: one trap `{item: game, export: preview, kind: fuel}` at frame 31, the preview's arrays clear from then on, every later frame shows its steps run with the run without hovering's full-state hash and `game.unit`, and every step keeps its step hash. deep-show: the board's live view under the pointer differs from the view never hovered, and its export's frames (png_seq, 4 fps) equal, byte for byte, the export of the board never hovered. Fails: a preview on the item's memory, a hover stamped as an entry, preview arrays hashed, baked or exported, a trap that stops the item or leaves the arrays |
| 2 `#548.9932c4df` | `ac2-ai-move.test.ts` (1) | The pointer set once at frame 100: frames 100 to 119 draw the route from U0, frame 120 (t 2 s, step 120's move to U1, checked through `game.unit`) and every later one the route from U1, and the seek to 1.5 s (the state after step 90) the route from U0. `preview_runs_on_hover_only` fails, naming frame 120 at 2 s. Fails: a preview run only on hover changes, after a seek's frame, or on a stale state |
| 3 `#548.154ef157` | `ac3-budgets.test.ts` (4) | Counters on any machine: an idle turn-clock item's frames after the first run no step, no preview and no blend, and the merge base's frames run the same steps; a plain fixed-clock piece's frames run no preview and no blend, the merge base's steps, and draw the merge base's arrays; `benchmarks/budgets.json` passes `validateBudgets` and holds a task whose `criteria` name `#548.154ef157`, whose command starts with `node`, and whose `targets` hold `occurrences_64_ms: 0.05`, `linear_1000_vec3_ms: 0.1`, `preview_4mib_ms: 1`, `checkpoint_3_pages_ms: 0.5`. Guards on any machine: the emitter's bake has 64 rows a step and its twin none; the linear swarm's frames blend 1,000 elements and the held one none; each hover change on the 4 MiB item runs one preview and no step, a still frame none; the 32 MiB item's checkpoints of pages hold exactly pages 0, 200 and 400, each with its `ns`. Timings (below) |
| 4 `#548.3c7384fe` | `ac4-query-arrays.test.ts` (2) | The flock document: deep_query's logic read at steps 600 and 300 on the flock's track gives every array (`pos` of 100 boids, `vel`, `score`) and the step's fuel of `deep-logic`'s bake of the same piece and track, and no trap. The trapping document: deep_query's trap is step 412, kind divide, function 2, inputs exactly the trigger entry at step 412; the `logic` replay of the same track runs steps 0 to 412 and none after, with the same trap. Fails: a read of another step or of a re-run, a trap with another step, function or entries, a replay that goes past the trap or stops before it |
| 5 `#548.eec090d8` | `ac5-region-map.test.ts` (1) | deep_query's map of the flock: entries reads `wind`, `gust`, `seed`, writes `pos`, `vel`, `score`, emits `crossing`, in that order, sizes 264, 264, 8, 2,400, 1,600, 4, 260 and types `i64`, `vec3`, `vec2`, `i32` where the design fixes them, offsets rising from each region's start without overlap; equal entry for entry and in digest to `check`'s layout of the same item, which the program is built against (check's layout also meets the same shape). `region_map_reads_by_name`: another digest, `wind` at an offset the program doesn't read it at, and the failure names reads `wind` as the first entry that differs. Fails: a map out of declaration order, without emits, with another digest than check's |
| 6 `#548.d9cc61ff` | `ac6-bindings.test.ts` (1) | The bindings' fields equal deep_query's map entry for entry (region, name, offset, size, type) and its digest, their language is rust, and the source names each field; `flock-rs` builds against them, exports `regions_digest` equal to the digest, is admitted by check with that digest and, baked 120 steps on a track of wind and gust entries, writes `pos`, `vel`, `score` and the `crossing` rows its rule gives at every step; with `wrong_score` it doesn't build and cargo's error names `score` and `src/lib.rs:<the marked line>`; built against the bindings of the flock reading `gust` first (another digest), it is admitted under that layout and then refused at check as the flock's program (`logic_refused`, item `flock`, no steps), naming the entry reads `wind`. `bindings_fields_by_name`: fails, naming reads `wind` as the first field that differs. Fails: bindings off the map, a digest that isn't exported or is another, a type the compiler doesn't hold, a refusal that names nothing or runs steps |
| 7 `#548.7c091366` | `ac7-taste.test.ts` (1) | The check run (below) checks by replies that the unit moves at step 120, writes the three pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

### Criterion 3's timings

Each limit is judged by `judgeLimit` on `fingerprint()` from `scripts/benchmark.mjs`, imported, not copied, on five
runs after one warm-up, with the one-minute load read at each run's start and end. First `judgeLimit` is asked about
five zero readings: anything but PASS (off the reference Macs, on battery, Low Power Mode on, thermal state not nominal,
or the load above the cores) fails `INCONCLUSIVE:` with its reason before anything is timed. On a reference Mac at
rest, on the release `deep-logic`, each run reads, in one long-lived process:

- `occurrences_64_ms`: the median of three pairs, each 600 steps of the emitter in an `open` session (#531's) less 600
  steps of its twin, timed per `step` call on this test's clock, ÷ 600;
- `linear_1000_vec3_ms`: the median frame time of 60 frames of the linear swarm less the held one's;
- `preview_4mib_ms`: the median frame time of 40 hover changes on the 4 MiB item less that of 40 still frames, no step
  in either;
- `checkpoint_3_pages_ms`: the median `ns` ÷ 10⁶ of the checkpoints of pages a 480-step bake of `pages3` keeps
  (`checkpoint: {every: 60, budget: 256 MiB}`, so the ring keeps all nine: 0 and 480 whole, the seven between of pages).

A FAIL fails the test; anything else that isn't PASS leaves it `INCONCLUSIVE:` with the readings; four PASSes pass.
"Compared with the merge base" is met for the timings by the budget window, which measures the budgets.json task
against each commit's merge base (docs/parallel-proof.md §12a), and for the counters by the merge base's own frames.

## Readings where the issue leaves a choice

- **The surface.** The hex board's hashes, bakes and frames are the logic module's (`deep-logic`'s live view), since
  a frame-by-frame view with full-state hashes and planted twins is there; the agent tools (deep_query, deep_kinds,
  `logic`), the export and the app's window are deep-show's.
- **"The 12-cell route from the selected unit to the hovered hex"**: `route`, 12 cells, the unit's cell first; each of
  the 40 hovered hexes is 11 from the unit, so each route fills all 12 (after the move, the route is the walk's first
  12 cells or fewer).
- **"Changes no full-state hash, step hash, bake byte or input-track entry against the same run without hovering"**:
  every frame's `deep_hash`, every step hash and checkpoint of the session's bake, its bytes and its track, against a
  second view of the same piece played the same frames with no `hover`.
- **"Naming the first checkpoint whose full-state hash differs"**: the planted run against the planted run without
  hovering; its first hovered frame shows the state after step 61, so checkpoint 120 (the state before step 120) is the
  first that holds what the preview wrote.
- **"Its arrays clear, and the item plays on"**: `route` all 0 and `lit` all false from the trapping frame on, while
  each frame shows its steps run, the full-state hash of the run without hovering, and every step keeps a step hash.
  Whether the preview runs again after the pointer leaves the trap hex isn't read.
- **"An export's frames draw the route array at its default"**: the export after hovering equals, frame for frame and
  byte for byte, the export of the board never hovered, while the live view under the pointer differs.
- **"That step's first frame with the pointer still"**: frame 120 at 2 s, the first whose state holds step 120, with
  no `hover` since frame 100. **"A seek to before the move"**: `seek: 1.5`, landing on the state after step 90.
- **"An idle item on the turn clock adds no work per frame"**: no step, no preview and no blend in any frame after the
  first, as the merge base's frames run no step. **"A piece that uses none of these gains no work per frame"**: a
  fixed-clock item with no emits, preview or linear write: its frames run no preview and no blend, and the steps and
  drawn arrays of the merge base's frames.
- **"64 occurrence rows add under 0.05 ms to a step"**, **"adds under 0.1 ms a frame"**: differences against twins that
  do the same work but that one (a count of 0, `hold`). **"A preview of a 4 MiB state takes under 1 ms"**: a hover
  frame's time less a still frame's. **"A checkpoint of 3 written pages"**: its store time as the logic module reports
  it (`ns`), since a test can't isolate one checkpoint's work from the step's.
- **"Per-step fuel equal to its bake's"**: the fuel the asked step used; **"its bake"**: `deep-logic`'s bake of the
  same piece, seed and track, which the hub's bake must equal.
- **"The trap's step, kind, function and the input entries that step read"**: step 412, kind divide, function index 2
  and exactly the entry at 412 (t, control, value). **"Which deep_show replays to that step and no further"**: the
  `logic` replay of the same track, whose records end at step 412, with the same trap.
- **"In declaration order"**: the reads as declared (`wind`, `gust`), then `seed`, the writes as declared, then the emit
  kinds as declared. **"The layout digest check computed for it"**: the digest `deep-logic`'s `check` gives the same
  item. **"Returns offsets the program doesn't use"**: `wind`'s offset in the planted map isn't where the program reads
  it (check's).
- **"The bindings list each of its reads, writes and emits with the offsets and types deep_query returns"**: `fields`,
  equal to the region map's entries, and a program that uses only names and types reading and writing the right bytes.
- **"Fails to build against them, the build naming the field and the line"**: cargo's error holds `score` and
  `src/lib.rs:<line>`.
- **"Bindings of another layout digest"**: the bindings of the flock declaring its reads `gust` first; the program built
  against them is checked under that layout first, in the same `deep-logic` process (the item's history: #531's
  README), then given as the flock's program, which `bake` must refuse at check with no step; "the first entry whose
  offset differs" is reads `wind`.
- **"A planted generator that orders fields by name … naming the first field"**: the first field, in declaration
  order, whose offset differs from the region map: reads `wind`.

## Not tested, because no criterion reaches it here

deep_kinds' logic@1 entry with its exports, subset and budgets, and its gallery example with source (Scope, no
criterion); deep_run's `logic.determinism` and `logic.budget` as hub checks (the logic module's own calls are #532's);
a preview reading a view or viewer control other than a point's hover; a logic item or world reading a driver of
preview arrays (refused at check); previews in a match; `preview_at` overlap refusals; bindings in a language other
than Rust; logic.budget's web run (#1044), rng.timing, logic arrays as columns and rollbacks (the issue's "Not in this
task").

## The taste call

`ac7-taste.test.ts` is the check run. Through `deep-show screen` (the app's window as #1162's check run draws it, the
panel filling the reference window, 1512 × 982 points), after a scenario that presents the board and moves the pointer
over eight of the 40 hexes 100 ms apart from 0.3 s, into `docs/evidence/548/`:

- `route-hover.png`: the window at 1.2 s, the route to the eighth hex, at 2× (3024 × 1964 px);
- `route-after-move.png`: the window at 2.6 s, the pointer still, after the AI's move at 2 s, at 2×;
- `route-hover.apng`: the recording, the window at 1× 100 ms after each move and at 2.6 s, 2 frames a second.

Each is re-encoded so the same pixels give the same bytes, and each SHA-256 is printed.
`tests/acceptance/548/TASTE.json`, written by whoever records the call after the pictures are attached to the PR and
shown in the session: `{"issue": 548, "criterion": "#548.7c091366", "verdict": "looks_right" | "looks_wrong", "who",
"when": ISO 8601, "screenshots": {<each of the three names>: sha256}, "note"?}`. A call stands while this run's three
hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## What the implementer adds outside this folder

- The lanes lines above, and the budgets.json task (Criterion 3).
- In the logic module (`deep-logic`): `preview` with its regions, the throwaway copy, at most once a frame, its trap;
  `frame`'s `hover`, `previews`, `blends`, `traps` and preview `draws`; `baked`; emit entries in the layout;
  `regions_digest` as a data symbol; the ring's `ns`; the two planted names.
- In deep-show: deep_query's logic read, `logic`'s `track` and `trap`, deep_kinds' `bindings` (Rust, the API above),
  previews drawn live from a point control's hover and at their defaults in exports, and the two planted names.
