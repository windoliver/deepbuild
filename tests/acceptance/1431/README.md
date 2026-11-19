# Acceptance tests for #1431: honest memory, the app's footprint split into what we can name and what we can't

Written first and blind, from issue #1431 (its problem, Scope, seven acceptance criteria and Proof line), the design
sections it links and those they lean on, and base commit `f6ddd396f` (main, "Merge pull request #2628 …"; this
worktree's HEAD), by a job that never saw an implementation; none existed, and no other branch, pull request or worktree
was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding). Lean: one test per criterion, the wrong program each criterion names asserted inside it.

## What was read

- Issue #1431, live (`gh issue view 1431`); for scope only, its dependency #379 (the meter, the degrade ladder, memory
  counted on the device) and its epic #241.
- `AGENTS.md` (Proof).
- `docs/technical-design.md`: Numbers version 0 has to hold (the rows Memory, The app's footprint and The canvas; Every
  task carries its own budgets; The reference Macs); How we know version 0 works (Dogfooding, Wrong programs, Criteria
  to tests both ways, Criteria in a checked shape, Built to be hard to get wrong with its Repo guards).
- `docs/canvas-primitives.md`: The cost model and the budget class table; Frame budget; Meter and degrade ladder (counts
  at the sizes the device reports); Render-back; Replica `deep_drive`; Level of detail and its proxies; Builder
  `extrude`; Image `image@1` (one cache bounded in bytes and entries; the 64 MB decode cap); Carried state and its cache
  manifest.
- At the base, only to learn where things live and how surfaces are driven: the holders the issue names
  (`crates/deep-marks-render/src/macos.rs`'s `Session` with `images` and `resampled`, `crates/deep-app/src/show.rs`'s
  `CanvasPanel.pictures`, `crates/deep-gpu-layer/src/textures.rs`'s `Made.ready`,
  `crates/deep-scene3d-render/src/renderer.rs`'s `Renderer::meshes`, `maps.rs`'s `Store::textures` and `Store::groups`,
  `crates/deep-canvas-scene3d/src/lod.rs`'s `proxy_of`, `crates/deep-show/src/hub.rs`'s `Hub::gpu3`);
  `crates/deep-gpu/src/{alloc,memory,meter}.rs`; `crates/deep-gpu-layer/src/{main,allocations,budget}.rs`;
  `crates/deep-replica` (`Cargo.toml`, `src/deep_drive.rs`, `src/drive/{mod,plant,frames}.rs`, `src/lib.rs`);
  `crates/deep-app` (`Cargo.toml`, `src/lib.rs`, `src/canvas_fixture.rs`, `src/address.rs`, `src/open.rs`,
  `lists_1477.rs`'s footprint read); `crates/deep-show/src/{main,answer}.rs`; `crates/deep-canvas-scene3d/src/builders.rs`
  (`extrude@1`'s params); `packages/hub/src/{doctor,canvas-doctor,plant}.ts`; `scripts/proof-change.mjs` (`criterionId`,
  through `readIssue`), `scripts/proof-runs.mjs` (how `twins.json` is read), `scripts/lanes.mjs` (the `lint` check,
  `alone`, `timed`), `scripts/benchmark.mjs` (`references`, `fingerprint`, `judgeLimit`), `scripts/plant-lint.mjs`,
  `scripts/blocking-call-guard.mjs`, `scripts/loads-lint.mjs`'s README, `scripts/lease`.
- Prior suites, for conventions only (nothing imported): `tests/acceptance/379/`, `1899/`, `140/view/doctor.test.ts`,
  `1485/`, `1729/`, `1482/`, `124/helpers.ts`, `1477/README.md`, `1830/`, `69/timing.ts`, `159/helpers.ts`.

## What the base already does, which these tests don't credit

There is no reading: no process reads its physical footprint beside its heap and gauges (only #1477's list bench reads
`ri_phys_footprint`, for its own report), no gauge, no `unaccounted`, no unknown or void value, no cache declaration and
no cache lint. `deep-gpu`'s memory module reads Metal's allocated sizes for #379's meter. The canvas panel already keeps
only the pictures a shown revision uses (#995), so AC6's `held` half would hold there; the session's `images` map
already lets go of sprites the last two frames didn't draw, and the image paths cap decoded bytes (`asset::CAP`) with no
entry bound. `Renderer::meshes` gains an entry for each distinct mesh and never frees one, so 200 render-backs of 200
depths leave 200 entries in one process. None of the calls, fields, plants or the lint below exists: `deep-drive`
answers `"footprint" is no call`, `deep-show run` refuses a scenario holding a call it doesn't know (`bad_input`), the
canvas fixture's report carries no `readings` and `scripts/cache-lint.mjs` doesn't exist. `BASE-FAILURE.txt` is the
run of each file at the base; each fails at its first assertion on the missing reading, field or lint.

Checked by hand at the base with scratch scripts (not committed), so each test fails only on what this issue is about:
AC3's journey answers ok on every call (its seven sessions' pages open; one round of its 37 calls takes about 0.7 s);
AC7's 200 revisions, without the `footprint` calls, are each made in turn (revisions 1 to 200), and each render-back is
presented with a snapshot unlike the last, all 400 calls in about 3 s; AC6's run hands over all 1,000 revisions and
paints the last picture within the run (991 of the 1,000 pictures were painted on this loaded Mac, at about 26 frames a
second). A Metal probe on this Mac (Mac17,10) read how GPU memory shows in the physical footprint: a 1,000,000 B
shared buffer whose bytes the CPU wrote added 1,015,808 B to both the footprint and the device's allocated size; a
200,052,736 B texture (allocated size 203,964,416 B) in shared storage written by the CPU added 205,930,664 B to the
footprint; a private render target of that size, cleared on the GPU, added 273,154,048 B the first time in a process
and 203,980,800 B the second time. The planted texture's 10% therefore holds for a texture made as the second ones
were, not for the process's first large render-target clear.

## Run them

```sh
npm ci                          # once, if node_modules is missing
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/1431 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/1431/tsconfig.json
```

- **Builds.** Each file builds what it uses once, before its test, and copies the binary out of `target/` into a
  temporary folder, so another file's build can't replace it mid-run; a build that fails fails the test with cargo's
  words. AC1, AC2 and AC3: `cargo build --locked -p deep-replica --bin deep-drive --features env-plants` (#124's
  debug build with the planted programs; a release build refuses `env-plants`). AC5 and AC6: `cargo build --locked
  --release -p deep-app --bin deep-app --features canvas-fixture` (#1485's: the app's own binary, in release, as it
  ships). AC7: `cargo build --locked --bin deep-show` (the shipped build set, `full`). AC4 builds nothing.
- **Machine.** The replica, the app's window and 3D render-back draw with Metal: off macOS each of those tests fails
  `INCONCLUSIVE:`, never passing. AC5 opens the app's window (a pop-up that never takes focus) on this Mac's screen for
  about five minutes, AC6 for about two; each first runs a 2.5 s probe. AC5's timing is judged as the design judges a
  limit (below); everything else is judged on any Mac.
- **Time.** AC3 replays for the full hour, its two replicas side by side, so its wall time is about 62 minutes; AC5
  about 6 and AC6 about 3 after the builds; AC1, AC2, AC4 and AC7 under a minute.
- **Processes and folders.** Every process is started by these tests and stopped by its PID, never by name or port.
  Scratch folders are under `/tmp/d1431-*` and are removed when each file ends. A run with `--root` leaves Vitest's cache
  in `tests/acceptance/1431/node_modules/.vite`; delete it.
- **Lanes.** These files build binaries, start replicas and windows and time a reading, so `scripts/lanes.mjs` needs
  (this README is the instruction; the implementer makes the edit), beside its `scripts/cache-lint.mjs` entry in the
  `lint` check:

  ```js
  // #1431: each file builds a binary and starts a replica, the app's window or deep-show; AC3 replays for an hour and
  // AC5 times the gauges' reading on the reference Mac.
  alone.push('tests/acceptance/1431/');
  timed.push('tests/acceptance/1431/ac5-cost.test.ts');
  ```

## The surface under test

The issue names the reading's parts (the footprint, the heap, gauges, `unaccounted`), unknown and void, the bounds,
the lint lane, `deep doctor`, budget runs, the holders and the planted programs, but no API. These tests add the
smallest surface consistent with the design and the base: **one reading shape**, answered by **one new call,
`footprint`**, on the two binaries the criteria run in (the replica `deep-drive` and `deep-show run`) and carried in the
app's canvas fixture's report; **one test call and three planted programs** on the replica's `env-plants` build; **one
scenario field and two report fields** on the canvas fixture; **one cache declaration** in Rust comments; and **one lint
script** in the lint lane. No new binary. Every name below that the issue or design doesn't give is this job's choice; the implementer builds
exactly these, or a dispute goes to a blind redraft.

### The reading

Every process that reads the app's footprint answers one JSON object, the same in every binary:

```json
{"footprint": B | null,
 "heap": B | null,
 "gauges": [Gauge],
 "unaccounted": B | null,
 "device": B | null,
 "unknown": [Unknown],
 "gauges_ms": ms}
Gauge   = {"name": string, "on": "device" | "heap" | "other", "bytes": B | null,
           "entries"?: n | null, "bound"?: {"entries": n, "bytes": B}}
Unknown = {"field": "footprint" | "heap" | "device" | "gauges/<name>", "read": string, "error": string}
```

`B` is bytes, a whole number; `n` a count; `ms` milliseconds, a number.

- `footprint`: the process's physical footprint, as macOS reports it (`phys_footprint`, which counts the GPU memory
  the process's device allocated).
- `heap`: the bytes the heap allocator holds that no gauge counts. A gauge whose bytes live on the heap (decoded
  pictures, the text cache, record projections) takes them out of `heap`, so nothing is counted twice and the footprint
  splits exactly into `heap`, the gauges and `unaccounted`.
- `gauges`: one row per gauge, names unique: GPU textures and surfaces, the glyph atlas, the text cache, record
  projections, panels, and each holder the Scope names (the image holders' decoded bytes and GPU image bytes, the 3D
  renderer's holders). `on` says where its bytes are: `device`, memory the GPU device allocated; `heap`; or `other`.
  Gauge names are the implementer's, except a cache's.
- **A long-lived cache's row** also carries `entries` (now) and `bound`, the bounds it declares (The cache lint,
  below), and is named as the lint names it: `<Type>::<field>` for a field, its own name for a static. The tests read
  `Renderer::meshes` by that name; the others the Scope names would be `Store::textures`, `Store::groups`,
  `Session::images`, `Session::resampled`, `CanvasPanel::pictures`, `Made::ready` and the proxies' static.
- `unaccounted`: `footprint − heap − Σ gauges[].bytes`, exactly; `null` when any of them is `null`.
- `device`: the device's report, the allocated size the process's GPU device reports (Metal's
  `currentAllocatedSize`); `null` where the process has opened no device or that read failed.
- **Unknown.** A value that can't be read is `null`, never `0`, and has one row in `unknown`: the field, the read that
  failed (for the footprint, a text naming the footprint's read, such as `proc_pid_rusage RUSAGE_INFO_V2
  ri_phys_footprint`) and the error it gave.
- `gauges_ms`: the wall time this reading spent reading its gauges, in ms, on the process's own monotonic clock.
- **Void.** In a series of minute readings (AC3's replay, and the app's own series), a minute whose reading is missing
  or whose `unaccounted` is `null` is void: it is listed as void with the reads its `unknown` names, and is never
  compared and never averaged in.

### The replica: `deep-drive --out <dir>` (#124)

The JSON-lines protocol holds unchanged (`{"ready": true}`, then one reply line per call; a reply is `{"ok": true,
"t": flicks, …}` or `{"ok": false, "t", "error": {code, message}}`).

- `{"call": "footprint"}` → `{"ok": true, "t", "reading": Reading}`: the replica process's reading, taken now, on a
  launched replica. It passes no frame of the replica's clock.
- **The planted texture** (`env-plants` builds only; every other build refuses the call):
  `{"call": "texture", "texture": {"bytes": B, "gauge": bool}}` → `{"ok": true, "t", "texture": {"bytes": B,
  "device_bytes": B}}`. It makes a GPU texture of at least `bytes` on the replica's GPU device, writes every byte of it
  and waits for the device, so its pages are resident, and holds it until the replica closes. With `gauge: true` a gauge
  counts it, as every texture the app makes is counted; with `gauge: false` no gauge does. `device_bytes` is the size
  the device reports for it.
- **Planted programs** (`DEEP_DRIVE_PLANT=<name>`, read only in an `env-plants` build, as the replica's other plants):
  - `footprint-read-fails`: every read of the footprint fails as the system call does when it returns an error. This is
    no wrong program: it stands for a machine whose read fails, so the honest reader's answer can be judged.
  - `footprint-reads-zero`: the read fails the same way, and the planted reader returns `0` for it, with no `unknown`
    row (the wrong program).
  - `leaks-ungauged-buffer`: at each whole minute of wall time since launch, at the next frame, a buffer of 1,000,000 B
    on the replica's GPU device, outside the heap allocator, every byte written, kept until the replica closes and
    counted by no gauge (the wrong program).

### The app's canvas fixture: `deep-app --canvas <scenario.json>` (#1485)

The `canvas-fixture` build of the app's binary, its canvas panel alone in the app's real window. #1485's scenario and
report hold unchanged, with:

- Scenario field `"read_every_ms": ms` (optional): the app takes a reading on its UI thread at the first frame whose
  start is at or after each whole multiple of `read_every_ms` from the first frame's start, 0 included, until the run
  ends. With none, it takes no reading.
- Each `frames` row gains `"held": n`: how many pictures `CanvasPanel.pictures` holds when the row is recorded, as
  `pictures` (the painted list) is read.
- The report gains `"readings": [{"at_ms": ms, "frame": k, "reading": Reading}]`, in order: the frame's `at_ms` and
  index, and the reading taken after it.

### `deep-show run` (#393)

- `{"call": "footprint"}` → `{"reading": Reading}`: the deep-show process's reading, taken when the call is played, its
  gauges holding the 3D renderer's holders (`Renderer::meshes`, `Store::textures`, `Store::groups`, the proxies' map).
  One scenario line is one hub and so one 3D renderer (`Hub::gpu3`) for every session and revision in it.

### The cache lint: `node scripts/cache-lint.mjs [--root <checkout>]`

- **The declaration.** A long-lived cache declares its bounds where it is held, in a line comment:
  `// cache: entries <bound>, bytes <bound>` (or `///`), either part first. Each part is `entries <bound>` or
  `bytes <bound>`, `<bound>` an integer expression or a constant's path, read up to the next comma. The comment sits on
  the holder's own line after its code, or on a line of the unbroken run of comment and attribute lines just above it.
  The holder is a struct field (the cache is named `<Type>::<field>`, `<Type>` the struct it is in) or a `static` (its
  own name). For example, in `crates/deep-marks-render/src/macos.rs`:

  ```rust
  pub struct Session {
      /// #1486: each sprite made from a level at an opacity, with the last frame that drew it; …
      // cache: entries IMAGE_ENTRIES, bytes IMAGE_BYTES
      images: HashMap<ImageKey, (Arc<RenderImage>, u64)>,
  ```

  Every long-lived cache in the app carries one, the holders the Scope names among them, and its gauge reports the same
  bounds (`bound`).
- **The lint** reads every `.rs` file under `<root>/crates` and `<root>/vendor` (GPUI's holders are vendored), `target/`
  folders left out; `<root>` is the checkout holding the script unless `--root` names another. A declaration with one
  part and not the other is a finding: one line `FAIL cache: <path from root>:<line>: <message naming the cache>`, such
  as `FAIL cache: crates/deep-marks-render/src/macos.rs:310: Session::images declares a byte bound and no entry bound`,
  where `<line>` is the declaration's or the holder's. With any finding it exits 1 and prints no PASS line; with none it
  prints one line `PASS cache` (or `PASS cache: <what it read>`) and exits 0.
- **The lint lane** (`scripts/lanes.mjs`'s `checks`, name `lint`) runs `[process.execPath, 'scripts/cache-lint.mjs']`.

### What `deep doctor` prints and what a budget run records

The Scope's two other surfaces. No criterion reads them, so no test here drives them (What is not tested); they carry
the same reading.

- `deep doctor` shows the app's reading as one doctor.item@1, item `app.footprint`, agent `deepbuild`: code `healthy`,
  level `ok` when every value is known, with evidence `footprint <B> B = heap <B> B + gauges <B> B (<name> <B> B, …) +
  unaccounted <B> B`; code `footprint_unknown`, level `warn`, when any is unknown, each unknown value written
  `unknown (<read>)`; `not_checked`, level `skip`, when no reading could be taken. How the doctor reaches the app's
  process is the implementer's.
- A budget run records the reading taken after its timed runs: `deep-gpu run`'s `frame_budget` Result (#1899) and the
  envelope's report (#1903) gain `"footprint": Reading`.

## Planted programs

| Name | Criterion | The wrong program | Selected by |
|---|---|---|---|
| `ungauged_texture_200mb` | AC1 `#1431.aea056b4` | A 200,000,000 B GPU texture no gauge counts, in the running replica | `{"call": "texture", "texture": {"bytes": 200000000, "gauge": false}}` on the `env-plants` build |
| `footprint-reads-zero` | AC2 `#1431.aa066358` | A footprint reader that returns 0 when its read fails, naming nothing unknown | `DEEP_DRIVE_PLANT=footprint-reads-zero` (`env-plants`) |
| `leaks-ungauged-buffer` | AC3 `#1431.ee4481cb` | A buffer outside the heap, no gauge counting it, 1,000,000 B more each minute | `DEEP_DRIVE_PLANT=leaks-ungauged-buffer` (`env-plants`) |
| `planted_cache_bytes_only` | AC4 `#1431.415d33d4` | A crate whose field cache `PlantedHolder::planted_cache` and static cache `PLANTED_STATIC` each declare `bytes` and no `entries` | Written by the test into a scratch checkout the lint reads with `--root` |
| `images_without_entry_bound` | AC6 `#1431.46593b19` | This checkout's `macos.rs` with the `images` declaration's entry bound taken out, its byte bound kept | Written by the test into a scratch checkout the lint reads with `--root` |
| the merge base | AC7 `#1431.c01cc90e` | The renderer that frees no mesh: 200 entries or more after the 200 render-backs | The base commit; no plant (a fix's wrong program is its merge base) |

`twins.json` lists the five planted names by criterion ID. Each is run by its criterion's own test, beside the program
under test; none is a folder laid over the checkout, and each test fails at the base at its assertion, so the proof
lane needs no twin checkout. AC5 names no wrong program. `footprint-read-fails` is a fault, not a wrong program.

## Fixtures

All made in the tests, none committed:

- **The replica's record** is its own fixture (`launch.from: "fixture"`, the base's
  `docs/spikes/338/fixtures/needs-you.events.jsonl`); AC3's journey opens its seven sessions' pages by ID, and an
  `open` of an address the record lacks answers what became of it and changes nothing.
- **Pictures** (AC5, AC6 and the probe): opaque RGBA PNGs, one flat color plus a row of black and white texels spelling
  the picture's number, so each is its own file; AC6's are 500 × 500 px, 1,000,000 B decoded, small files. They go
  into a scratch evidence store by its layout (`<sha[0..2]>/<sha[2..]>`); each revision is one agent layer holding one
  picture on one panel.
- **The 3D document** (AC7): the agent's payload of a scene, 320 × 240 px, a camera, a grey sky, a sun, a material and
  `block`, an `extrude@1` of a 0.8 m square outline whose `depth` is 0.1 + 0.01 k m at revision k; no displayed text
  holds a number.
- **The planted crate** (AC4) and **the planted `macos.rs`** (AC6) are written into scratch checkouts.

## Criteria to tests

IDs are `criterionId` of each criterion's text, computed with `scripts/proof-change.mjs`'s `readIssue` from the live
issue. Each test's name starts with its ID.

| ID | Criterion | Test | Wrong program, asserted in the test |
|---|---|---|---|
| `#1431.aea056b4` | A planted 200 MB GPU texture with no gauge raises `unaccounted` by 200 MB within 10%. With its gauge, `unaccounted` doesn't move by more than 10 MB | `ac1-unaccounted.test.ts`: one replica, launched: a reading; the 200,000,000 B texture with no gauge (the device holds at least that); a reading; a second with its gauge; a reading. Each reading known, with `unaccounted` = footprint − heap − gauges exactly. The first texture raises `unaccounted` by 200,000,000 B ± 20,000,000 B; the second moves it 10,000,000 B at most | `ungauged_texture_200mb`, which must show in `unaccounted`; the merge base (no reading) |
| `#1431.aa066358` | With the footprint read failing, the report says unknown and names the read. A planted reader that returns 0 fails, naming the field | `ac2-unknown.test.ts`: the replica as it ships reads a footprint above 0 and names no unknown footprint; with `footprint-read-fails` its reading's `footprint` and `unaccounted` are `null` and `unknown` has a `footprint` row whose `read` names the footprint's read; the same judge on `footprint-reads-zero` fails with a problem naming `footprint` and its 0 | `footprint-reads-zero`; the merge base |
| `#1431.ee4481cb` | A one-hour replica replay ends with `unaccounted` within 50 MB of its value at minute 5. A planted leak of 1 MB a minute in an ungauged buffer fails | `ac3-replay.test.ts`: the replica as it ships and `leaks-ungauged-buffer`, side by side on the real clock, replaying one journey for 60 minutes, each read at every whole minute (the series, printed as `PROOF` lines). The shipped replica's minute 60 is within 50,000,000 B of its minute 5; the planted one's isn't, its minutes 5 and 60 read (not void) | `leaks-ungauged-buffer`; the merge base |
| `#1431.415d33d4` | A cache with a byte bound and no entry bound fails the lint lane, naming the cache | `ac4-lint.test.ts`: over this checkout the lint exits 0 with one `PASS cache` line, and the lint lane runs it; over the planted crate it exits 1 with exactly two FAIL lines, naming `planted_cache` and `PLANTED_STATIC` at their file and line; the same crate with both bounds passes | `planted_cache_bytes_only`; the merge base (no lint) |
| `#1431.77e19bb8` | Reading the gauges costs under 1 ms a minute on the reference Mac | `ac5-cost.test.ts`: the app's canvas fixture in release, a few pictures shown, a reading a minute for five minutes; each reading known (footprint over 10 MB, gauges read, `gauges_ms` above 0); the minutes 1 to 5's `gauges_ms` judged against 1 ms by `judgeLimit` with each minute's load: PASS only on a reference Mac, otherwise FAIL or `INCONCLUSIVE:` | Names none; the merge base (no readings) |
| `#1431.46593b19` | The session's `images` map with no entry bound fails the lint, naming it. A 1,000-revision run of 1 MB images holds `pictures` at the shown count, with gauges within 10 MB of the device's report | `ac6-images.test.ts`: `macos.rs` as this checkout has it passes the lint and declares `images` with both bounds; without its entry bound it fails, one FAIL line naming `images` at that file. The app's canvas fixture in release: 1,000 revisions 100 ms apart, each its own 500 × 500 px picture; every one handed over and the last painted; from the first painted frame every frame's `held` is 1; every reading (one a second) has its gauges on the device within 10,000,000 B of `device`, and while a picture is shown both hold at least its 1,000,000 B | `images_without_entry_bound`; the merge base |
| `#1431.c01cc90e` | In one `deep-show` process, 200 render-backs of a document whose `extrude@1` depth changes each revision leave the renderer's mesh entries within their declared entry bound and its mesh bytes within its byte bound, read from their gauges. On the merge base the entries count 200 or more and the test fails, naming `meshes`. | `ac7-meshes.test.ts`: one `deep-show run` scenario: a reading, 200 × (deep_show of the next depth, render_back of that revision), a reading. After them `Renderer::meshes` has entries ≤ its `bound.entries` (which is under 200), bytes ≤ its `bound.bytes`, and at least one entry; each deep_show made revision k and each render_back is presented with a snapshot unlike the last | The merge base: its scenario is refused and the test fails at the meshes check, naming `Renderer::meshes` |

## Readings where the issue leaves a choice

1. **Which process each criterion reads.** The reading is the app's, so each criterion is read in the process nearest
   the app that the base can drive. AC1, AC2 and AC3 in the replica, a headless copy of the app's views drawn with the
   app's own renderer on a Metal device, whose `env-plants` build already carries planted programs; AC3 names it. AC5
   and AC6 in the app's own binary (its canvas fixture, in release), since AC6's `pictures` is the app's panel's and AC5
   is a cost on the reference Mac, timed in the build that ships. AC7 in `deep-show`, as it says.
2. **"A minute" in the replay** is a minute of wall time: both replicas launch on the real clock (`clock: "real"`),
   readings are taken at each whole minute from the replay's start, and the plant leaks at each whole minute from its
   launch. "Ends" is minute 60. The journey is the base's own calls (`open`, `act` hover at a point, `see`), all of
   which exist at the base, so the replay fails only on the reading. The plant adds about 55 MB between minutes 5 and
   60, 5 MB past the bound, so the criterion asks the replica as it ships to hold `unaccounted` steady within a few MB
   for the plant to fail; the test asserts exactly the criterion's 50 MB both ways.
3. **Planted programs in the replica are chosen by `DEEP_DRIVE_PLANT`**, the replica's own convention (#1408): the
   variable is read only in an `env-plants` build, which a release build refuses to compile, so no shipped program can
   be bent by it, as the design's Wrong programs asks of a plant behind a build feature. The planted texture is a call
   that build alone answers, so a reading before and after it come from one process.
4. **"Within 10%"** is ±20,000,000 B of 200,000,000 B; MB is 10^6 B throughout, as the design writes it.
5. **"The report"** (AC2) is the reading the process answers; its `unknown` row is where it names the read. "Naming the
   field" is the judge's failure: a problem that starts `footprint:` and shows the 0.
6. **"The device's report"** (AC6) is the reading's `device`, Metal's allocated size for the app's device, and "gauges"
   are the reading's gauges whose bytes are on the device (`on: "device"`), summed. A picture on screen is on the
   device, so while one is shown both must hold at least its 1,000,000 B; this keeps a reading of nothing from
   passing.
7. **"1 MB images"** are 500 × 500 px RGBA, 1,000,000 B decoded each, one picture per revision, each its own.
   **"The shown count"** is 1: one panel shows one revision of one layer at a time. While a newer revision's picture
   decodes, the panel still shows the one before (#1485), so `held` stays 1; a decoded picture whose revision a newer
   one replaced before it was shown is used by no revision, and holding it is past the shown count.
8. **"Reading the gauges costs under 1 ms a minute"**: the app reads its gauges once a minute, so a minute's cost is
   that reading's `gauges_ms`. Five runs are the readings at minutes 1 to 5 after the one at the run's start, judged by
   the design's rule.
9. **How 200 render-backs run in one `deep-show` process**: one `deep-show run` scenario, since one scenario line is one
   hub with one 3D renderer for every revision in it. Each revision is the agent's `deep_show` of the whole document,
   then its `render_back`. Depths step 1 cm so each render-back's snapshot differs from the last.
10. **The declared entry bound must be under 200.** "On the merge base the entries count 200 or more and the test
    fails": a count of 200 must fail the bound, so a bound at or past 200 can't be the criterion's.
11. **A cache's name** is its holder's: `<Type>::<field>` or a static's name. The lint's FAIL line must name it; the
    tests read the holder's identifier (`images`, `planted_cache`, `PLANTED_STATIC`) in it, at the declaration's or the
    holder's line.

## What is not tested

- `deep doctor`'s display of the reading and a budget run's record of it: they are the Scope's, no criterion reads
  them, and a failing read can't reach the doctor's own process. Their shapes are above.
- The averaging of a minute series and its void minutes beyond AC3's judge, which never compares a void minute.
- That every holder the Scope names declares both bounds and has a gauge: AC6 reads `Session::images`'s declaration and
  AC7 `Renderer::meshes`'s gauge. The others aren't checked here: the lint fails a declaration with one bound, and no
  lint can find a cache that declares none.
- A cache with an entry bound and no byte bound (the Scope's other half of "one and not the other"); AC4 names the byte
  half.
- The Memory row's own limits (the app under 300 MB) and the canvas row's GPU memory per window: other issues' budgets.
- Off macOS everything here is `INCONCLUSIVE:`; the Scope's readers on other platforms aren't judged.
