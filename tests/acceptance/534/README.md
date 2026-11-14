# Acceptance tests for #534: saves bound to the state layout, written whole, migrated or refused

Written first, from issue #534 (its Scope, Fields, eight acceptance criteria and Proof line: "The dungeon saved, quit
and reopened bit for bit, the cut-short and killed saves, and the refused and migrated program changes"), the design
sections it names and the base commit, by a job that never saw an implementation; none existed, and no other branch,
worktree or PR was read. The base is this worktree's HEAD, `6042ef5a`, which holds #532 (`89a6fe7b`, "logic:
checkpoint ring, bakes and goldens, …"). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 534 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Saves; Interpolated
  writes; Saves across changes; World pages); Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic `logic@1`; Logic: interpolated writes; Logic: data layouts; Logic: checkpoints and
  bake; Logic: saves; Logic: saves across changes; Logic: carry records; Logic: world pages; Logic: between-step
  services; Logic: mirror reads; Carried state; Registry and seal and its runtime digest; World and backend
  `physics.world@1` (its fields only); the determinism classes' `same_machine`.
- At the base: `crates/deep-logic` (its calls and its `check`, only to learn the protocol), `scripts/benchmark.mjs`
  (the reference-Mac judge `judgeLimit`), `scripts/proof-change.mjs` (criterion IDs), and the suites
  `tests/acceptance/531/` and `532/` (the pattern this one follows: their READMEs, helpers.ts, programs.ts and
  assembler; copied and cut down, nothing imported but `scripts/benchmark.mjs`'s judge in criterion 4).

What the base already does, which these tests don't credit: everything #531's and #532's READMEs define (checks,
bakes with checkpoints and full-state hashes, restores, seeks, sessions, live views and frames). It refuses a logic
item's `saves` ("logic@1 has no field saves"), `pages`, `services` and `mirrors` ("isn't built yet"), and any item that
isn't `logic@1`; it parses `interpolate: linear` but draws nothing; it has no `open_save` call, no `saves_dir`,
`frames` or `adapter` field, and none of this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/534 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/534/tsconfig.json
rm -rf tests/acceptance/534/node_modules/.vite
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup or `~/.cargo/bin` on PATH when present):

- **The assembler** `tests/acceptance/534/wat/` (crate `acceptance-534-wat`, #532's renamed; `wat =1.263.0`,
  `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`, regenerated at this base because the
  repo's `.cargo/config.toml` patches have grown since #532's) into `target/acceptance-534-wat/`.
- **`deep-logic`**: `cargo build --locked --bin deep-logic` in the checkout.

Every test passes an explicit timeout (90 minutes). Saves folders, binaries and assembler output are temporary and
deleted. Node built-ins and vitest only. **`scripts/lanes.mjs` needs `'tests/acceptance/534/'` in its `alone` list**:
the files build cargo binaries, write 64 MiB saves, and criterion 4 reads timings. This README is the instruction; the
implementer makes that edit.

Hosts. The issue pins criterion 1's frames ("bit for bit on the reference Mac") and every budget of criterion 4 ("on
the reference Mac in the local preflight") to the reference Mac: on any other host those tests fail `BLOCKED: … is
pinned to the reference Mac` before they measure, never pass and never skip. On a Mac, criterion 4's readings are
judged by `scripts/benchmark.mjs`'s `judgeLimit` (five readings after a warm-up; one of the three reference Macs, on
mains power, Low Power Mode off, thermal state nominal, load under the core count); anything but PASS fails, naming the
judge's reason (INCONCLUSIVE off a reference Mac). Everything else runs on every host through `deep-logic`: full-state
hashes at every checkpoint, refusals and what they name, hashes caught, the killed write, frames of criterion 6.

`BASE-FAILURE.txt` is the run at the base (its first lines give the counts and why). Each test's first call is one the
base lacks (an item's `saves`, `open`, `open_save`, a planted name), so at the base it fails before its slow legs run.

The harness was checked against real components at the base: every program assembles (`big` is 1,082,196 bytes) and
the base `deep-logic` admits and runs them with no trap once the fields it doesn't build are taken out: the dungeon's
2,400 steps (its 40-move burst at step 1,798 reaches steps 1,798, 1,799 and 1,800, 16, 16 and 8 entries; `request` is 1
at steps 1,199 and 1,799 only; the `nop` variant gives the same arrays under another program hash), `dungeon_static`
(floor 7 at step 1,799, 9 at 2,399), `hoard` at 64 MiB and 4 MiB, `saver`, `crowd` and `fixture` at 20 Hz (its search
runs steps 10 to 19, `found` set at 19). Not checked: anything about saves (the base has none), the fixture's pages,
service and mirror (refused), `same_machine.counter@1`, the migration running, and every Mac leg (this host is Linux
aarch64).

## The surface under test

The issue names the `saves` field, the Save's fields, slots, migrations, the viewer opening a save "from the app or
the player", planted twins and a killed write, but no command line. As in #531's and #532's suites, the surface is
`deep-logic`: **every call, field, file format and planted name below that the issue or the design doesn't give is this
job's invention**, the smallest surface the criteria need, extending #531's JSON-lines protocol and #532's additions
(their READMEs: deep-logic); the implementer builds exactly these, or a dispute goes to a blind redraft. Calls and
fields not named here stay as those READMEs define them. "In the app" is the logic module's own code through
`deep-logic`; "the app quit" is the `deep-logic` process that wrote a save exiting before another process opens it.

### `deep-logic`: what this suite adds

- **A logic item's `saves`** is the design's field (Logic: saves): `{slots: 1 to 8 = 1, request: array name, ends?:
  array name, migrate: [{from: {layout, content, modules}, by: asset ID, remap?: asset ID}] = []}`. A migration's
  program (`by`) is carried in the piece's `assets` by sha256, as a program is.
- **`pages`, `services`, `mirrors`** on a logic item and `interpolate: linear` on a write are the design's fields.
  **A piece's items** may be of other canvas modules (`physics.world@1`; `same_machine.counter@1`, below).
- **`saves_dir`** (on `bake` and `open`): the folder the app keeps the piece's saves in, files the piece owns. A step
  that writes slot s into its item's `request` array saves slot s once the step ends; with no `saves_dir`, a save
  request writes nothing. A bake's reply, and each `step` reply of a session, lists in `saves` every save its steps
  asked for, in order, each once it has read back whole (the reply waits for it).
- **`frames`** (on `bake` and `open_save`): `[FrameSpan]`; the reply's `frames` holds, per span, its frames.
- **`adapter`** (on `bake`, `open` and `open_save`): the adapter fingerprint this run is on, a string standing for the
  environment fingerprint a same-machine result carries (default: this host's own).

| Call | Reply |
|---|---|
| `{"call": "bake", …#531's and #532's fields, "saves_dir"?, "frames"?, "adapter"?}` | `Bake`, plus `"saves": [SaveWritten]` and `"frames": [[Frame]]` |
| `{"call": "open", …#531's fields, "saves_dir"?, "adapter"?}` then `{"call": "step", …}` | #531's replies; `step`'s plus `"saves": [SaveWritten]` |
| `{"call": "open_save", "piece", "saves_dir", "slot", "track"?: [Entry], "steps": n, "frames"?, "adapter"?}` | `Opened`, or `Refused` |

```text
SaveWritten = {"item": logic ID, "slot", "step": s, "hash": 64 hex (the file's sha256), "file": path, "ended": bool,
               "deep_hash": {<item ID>: 16 hex}, "write_ns": ns, "on_ui_thread": bool}
FrameSpan   = {"from": flick, "count": n, "arrays": ["<item ID>.<name>"]}
Frame       = {"t": flick, "arrays": {"<item ID>.<name>": [value]}}
Opened      = {"ok": true, "opened": {"hash", "file", "step": s, "via": "straight" | "migration", "from"?: the migrated save's hash},
               "damaged": [{"hash", "file"}], "deep_hash": {<item ID>: 16 hex}, "steps": [StepRecord],
               "checkpoints": {<item ID>: [Checkpoint]}, "frames": [[Frame]]}
Refused     = {"ok": false, "code": "save_refused", "save": hash, "differs": [Differ], "damaged": [...]}
            | {"ok": false, "code": "migration_failed", "save": hash, "by": asset ID, "trap"?: LogicTrap, "damaged": [...]}
            | {"ok": false, "code": "no_save", "slot", "damaged": [...]}
Differ      = {"what": "layout" | "content" | "modules" | "segment" | "globals" | "fingerprint",
               "save"?: the save's value, "piece"?: the piece's value, "segment"?: index, "offset"?: byte address}
Checkpoint  = #531's {"step", "deep_hash"}, plus "ns"?: the CPU time taking it
```

What each field means:

- **A save's step.** A save made when step k ends holds the state a checkpoint at k + 1 holds (the state before step
  k + 1), and its `step` is k + 1: the dungeon asks at the ends of steps 1,199 and 1,799, so its saves are at 1,200 and
  1,800 ("saved at step 1,800"). `deep_hash` is each item's full-state hash of that state, "recorded when it was
  written". `write_ns` is the wall time from the step's end until the save read back whole; `on_ui_thread` says where
  it was written.
- **Save files.** The saves folder keeps each kept save as `<sha256>.save`, the sha256 of the file's whole bytes (the
  Save's `hash`). A save file is one JSON line, the header, holding every Save field but `state` and `hash` (`slot`,
  `layout`, `content`, `modules`, `runtime`, `document`, `program`, `step`, `input_at`, `track`, `ended`, and
  `fingerprint`, below), then a newline, then the state in the implementer's encoding: so every binding field decodes
  without decoding the state. A save being written is a file whose name ends in `.tmp` in the saves folder until it
  is renamed, once it reads back whole; the folder may hold other files of the implementer's (an index), never named
  `*.save` or `*.tmp`. Each slot keeps its newest save and the one before it.
- **Layouts.** A program that exports no `layout_at` has its program hash as its layout (Logic: saves across changes);
  a save's `layout`, and a refusal's `layout` sides, name it by the program's `hash` or `program` as `check` reports
  them (either is accepted; the design's Save names "the rewritten program by hash").
- **`open_save`** is the viewer opening a save from the app: it opens slot `slot`'s newest save in `saves_dir` that
  reads back whole (its sha256 equals its name), naming each newer one that doesn't in `damaged`, and restores it as a
  seek does into fresh instances; then it plays the given `track` (the input track from step 0) on from the save's
  input position, to step n − 1. `deep_hash` is each item's full-state hash of the opened state; `checkpoints` are
  those the run reaches, the opened state first (at s), then every checkpoint step after s up to n; `steps` are steps
  s to n − 1. A save whose layout, content, module set, globals or fingerprint doesn't match the piece's is refused
  (`save_refused`, one `Differ` for each that differs), unless the piece declares a migration from its `{layout,
  content, modules}`. Under a changed program, a save whose bytes inside one of its program's active data segments
  differ from the segment's own is refused with a `Differ` `{what: "segment", segment: the segment's index, offset:
  the first such byte's memory address}`, beside any other. A slot with no save that reads back whole answers
  `no_save`. A save that can't be decoded never reads as damaged: `damaged` names only saves whose hash fails.
- **Migrations** (Logic: saves across changes). The migration's program exports `memory`, the immutable i32 globals
  `old_at`, `remap_at` and `new_at`, and `migrate()` (no parameters, no results), which runs once. Before it, the logic
  module writes the old state block at `old_at` (and the remap table, when named, at `remap_at`); `migrate` writes the
  new state block at `new_at`. A state block: a u32 memory length n, the n bytes of memory, a u32 count g of the
  program's mutable globals, then each in declaration order as 8 little-endian bytes (an i32 or f32 in the low 4, the
  high 4 zero). The result is written as a new save in the same slot under the current layout (`via: "migration"`,
  `from` the old save's hash), and the old save's file is left as it was. A migration that traps answers
  `migration_failed`.
- **Frames.** A frame at flick t reads each named array as drawing reads it at t (Logic: interpolated writes): a hold
  array as the last step at or before t left it, a linear one blended from the step before's value toward it by α.
  Spans give `count` frames at 60 Hz from `from`. In `open_save`, `from` is at or after the time of the save's last
  step (s − 1); the dungeon's frames are from the saved state's time on. Two runs' frames are compared bit for bit,
  number by number as f64 bits.
- **Same-machine state.** `same_machine.counter@1` is a fixture canvas module item (no params) whose carried state is
  of the `same_machine` class: a counter of the steps it has seen, checkpointed and saved like any carried state. A
  save that holds same-machine state binds the adapter fingerprint that wrote it, in its header's `fingerprint` (null
  when it holds none); opened under another `adapter` it's refused with a `Differ` `{what: "fingerprint", save: the
  save's, piece: this run's}`. It's this job's invention, as the design's shipped modules hold no same-machine carried
  state yet; an implementer who wires a real one instead takes it to a redraft.
- **The fixture's service request** (criterion 6): `physics.cast@1`'s region holds, after its u32 count, one 72-byte
  ray request `{kind: u32 = 0 (ray), world: u32 (the world's index among the piece's worlds), from: vec3 f64, dir: vec3
  f64, max: f64, groups: u32, 4 zero bytes}`, then the u32 result count and its results (a u32 hit count, then up to 8
  hits of 64 bytes). This byte layout is this job's invention; the design gives the fields only.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else. A twin that
changes a save applies to the process that writes it and the one that opens it (the tests pass it to both):

| Name | Criterion | The wrong program |
|---|---|---|
| `save_drops_globals` | 1 | a save holds logic's memory pages but not its globals; opening one leaves the fresh instance's globals at their initial values |
| `save_drops_input_position` | 1 | a save holds no input position; opening one takes every entry stamped at or before the save's last step as read, so entries still waiting (more than 16 a control a step) are lost |
| `open_reapplies_segments` | 5 | opening a save under the program that wrote it writes the program's active data segments over the save's pages |
| `save_drops_linear_previous` | 6 | a save holds no previous values of linear writes; opening one starts them at zero |

## Programs

`programs.ts` holds the programs as WebAssembly text; each comment says what it does and the item it's built for.
`dungeon` (floor, health and a xorshift64 generator in mutable globals, an 8-slot inventory in memory, each `move`
entry adding its index in the step + 1 to a slot; saves at 1,200 and 1,800; `nop` its changed twin), `migration` (adds
1,000 to the dungeon's health), `dungeon_static` (its floor in active data segment 0 at byte 1024; a save at 1,800),
`hoard` (a nonzero byte in every page), `saver`, `fixture` and `crowd` (criterion 6), `flock` (#532's, unchanged) and
`big` (a 1 MB program). `dungeon.ts` builds the dungeon's pieces and its recorded track: seeded moves and a burst of 40
at step 1,798.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#534.facb3458` | `ac01-dungeon-reopen.test.ts` (4) | Saved at 1,800 in one process, opened in another and fed the same track to 2,400: the save opens straight at the hash and full-state hash it recorded, which is the never-quit run's at checkpoint 1,800; every checkpoint 1,800 to 2,400 and every step's hashes and arrays equal the never-quit run's. `save_drops_globals` fails the comparison naming checkpoint 1,800; `save_drops_input_position` fails it naming a checkpoint at or before 1,860. On the reference Mac (BLOCKED elsewhere): frames from the saved state on for 600 steps equal the never-quit run's bit for bit. Fails: a save without globals, memory or input position, an open that runs `init` again, a checkpoint numbering that misses the opened state |
| 2 `#534.a644d162` | `ac02-written-whole.test.ts` (2) | The slot keeps both saves as `<sha256>.save`; the newest cut short by a byte is named in `damaged` and the save at 1,200 opens at its recorded full-state hash (checkpoint 1,200's). A 64 MiB save frozen and killed while `*.tmp` exists and before any rename: the slot keeps only the earlier save, its bytes unchanged, and it opens at its recorded hash. Fails: a write in place, a slot that drops its last good save, a hash that isn't checked on opening |
| 3 `#534.8e544563` | `ac03-program-change.test.ts` (2) | Under the `nop` program with no migration: `save_refused`, a `layout` difference naming the old program hash (the save's) and the new (the piece's). With a migration from the save's header fields: opened `via: migration` from the newest save, written as a new save bound to the new layout at step 1,800; the old save stays with its bytes; health is the never-quit run's + 1,000 at each step 1,800 to 2,399, floor and inventory equal; the new save then opens straight. Fails: a save bound to the document or rewrite instead of its layout, a migration that overwrites the old save or isn't run |
| 4 `#534.e281f3dd` | `ac04-budgets.test.ts` (5) | Reference Mac only (BLOCKED elsewhere), each judged by `judgeLimit`: first `check` of a 1 MB program < 200 ms; the flock's simulate CPU a step < 0.5 ms; slowest checkpoint `ns` of a 4 MiB memory < 2 ms; a 4 MiB save's `write_ns` < 50 ms with `on_ui_thread` false; a view of a piece without logic runs 0 steps and 0 ns every frame |
| 5 `#534.e4ecebfc` | `ac05-static-floor.test.ts` (3) | `dungeon_static` saved at 1,800 (floor 7) opened under the same program: every checkpoint to 2,400 and every step equal the never-quit run's. `open_reapplies_segments`: the first checkpoint that differs is 1,800 and step 1,800 shows floor 1. Under the `nop` program: `save_refused` with `{what: segment, segment: 0, offset: 1024}`. Fails: an open that reapplies segments, a refusal that names no segment or offset |
| 6 `#534.73983bd0` | `ac06-fixture-state.test.ts` (2) | The fixture (a linear write, world pages, a mirror, physics.cast@1 against an empty world, a search across steps) saved at 20 seeded steps in [100, 700) (one queuing a page move, one mid-search), each by a process that stops there, and reopened: every checkpoint and every step for the next 600 equal the never-quit run's, and the 1,800 frames from the saved step's time are bit for bit the never-quit run's. `save_drops_linear_previous`: the first frame shows `fixture.pos` 0 and the comparison names `fixture.pos` and frame 0. Fails: a save without the page queue, pending mirror ranges, the unread answer, the search's progress or the linear write's previous values |
| 7 `#534.023b4bfb` | `ac07-adapter-fingerprint.test.ts` (1) | Saved on adapter A with a `same_machine.counter@1` item: the header's `fingerprint` is A; opened on B, `save_refused` with `{what: fingerprint, save: A, piece: B}`; opened on A, it opens at its recorded full-state hashes. Fails: a save that binds no fingerprint, a refusal that names one |
| 8 `#534.8a234a6f` | `ac08-binding-decodes.test.ts` (2) | A real save's header line holds every binding field, read without its state. A copy whose state is 4,096 seeded bytes, named by its own sha256: under the `nop` program with no migration, `save_refused` naming its layout, never in `damaged`; with a migration from its header's fields, opened `via: migration` from it, or `migration_failed` naming it and the migration, never in `damaged`; its bytes stay. Fails: a save whose binding sits inside its state, a decode failure read as a cut-short save |

Test count: 4 + 2 + 2 + 5 + 3 + 2 + 1 + 2 = 21.

## Readings where the issue leaves a choice

- **The surface.** `deep-logic` again: the criteria need saves written by one process and opened by another (the app
  quit), a write killed by its PID, planted twins and readings of the logic module's own times; deep-show's documents,
  the app's UI and the web player's storage (#172) aren't driven.
- **"Saved at step 1,800" and "opened … at the full-state hash recorded when it was written"**: the save holding the
  state before step 1,800, and the `deep_hash` its write reported (equal to the checkpoint's at that step).
- **"Naming the first checkpoint that differs"**: the comparison is the test's, against the never-quit run, and its
  message names the checkpoint. With the globals dropped the opened state itself differs (1,800). With the input
  position dropped, the opened state differs when the full-state hash holds the waiting entries, else the next
  checkpoint does, after step 1,800 reads 8 fewer moves: at or before 1,860.
- **"The same frames, bit for bit on the reference Mac"**: the frames the logic module gives the draw (Frames, above)
  compared by their f64 bits, on the reference Mac; a pixel render of the dungeon isn't reachable through any surface
  the issue names.
- **"Killed before its rename"**: the test freezes the writing process while its `*.tmp` exists and no new `*.save`
  has appeared, then kills it; if the rename had already happened the test fails, naming that, rather than retrying.
- **"Naming both program hashes"**: the `layout` difference's two sides, since the dungeon exports no state layout and
  its layout is its program hash.
- **"Naming the segment and the first offset"**: segment 0 by index and byte 1024 by memory address (the floor's low
  byte, 1 in the segment and 7 in the save).
- **Criterion 4's "compared with the merge base"**: the preflight's budget lane compares a change with its merge base
  (`benchmarks/budgets.json`, `scripts/benchmark.mjs`); this suite judges each reading against its absolute limit on
  the reference Mac with the same judge, and reads "gains no work per frame" as no step and no CPU time of the logic
  module for a piece without logic. The budget tasks the implementer adds to the preflight are theirs.
- **Criterion 6's frames**: 60 Hz frames over a 20 Hz fixture (three a step, so the linear write blends), from the
  time of the save's last step through the next 600 steps; the issue pins no host for them, so they run everywhere.
- **Criterion 8's "migrated"**: a migration given a state that doesn't decode either runs (and opens) or fails as the
  migration's own failure; both take the path the binding fields chose, and neither reads as cut short.

## Not tested, because no criterion reaches it here

Ended slots (`ends`) and opening them only at their end; a slot count above 1; carry records; the web player's
storage and export (#172); re-derivation when only the runtime digest differs; a state layout from `layout_at` and
field-table refusals (the saves for games task); `logic.layout`; remap tables; the migration's budget; a carried-on
run when a new revision becomes current; a piece's logic opening a save (no surface lets it try).
